import {
  EVIDENCE_LIMITS,
  EVIDENCE_OBSERVATION_STATES,
  appendEvidenceItem,
  createEvidenceItem,
  createEvidenceStore,
  evidenceStoreSummary,
  markEvidenceStoreStale,
  normalizeEvidenceStore
} from "./evidence-contract.mjs";
import { sha256Hex, stableStringify } from "./common.mjs";

const ROOT_SCHEMA = "eic.autonom.evidence-root.v1";
const ROOT_KEY = "eicAutonomAgent.v3.browserEvidence";
const BODY_PREFIX = "eicAutonomAgent.v3.browserEvidenceBody";

function rootValue(value = {}) {
  return {
    schema: ROOT_SCHEMA,
    version: 1,
    windows: value?.windows && typeof value.windows === "object" ? { ...value.windows } : {},
    updatedAt: value?.updatedAt || new Date().toISOString()
  };
}

function screenshotBodyKey(windowId, itemId) {
  return `${BODY_PREFIX}.${Number(windowId)}.${String(itemId)}`;
}

function decodedBase64Bytes(value) {
  const clean = String(value || "").replace(/\s+/g, "");
  if (!clean || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error("EVIDENCE_SCREENSHOT_BASE64_INVALID");
  }
  let binary;
  try {
    binary = atob(clean);
  } catch {
    throw new Error("EVIDENCE_SCREENSHOT_BASE64_INVALID");
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64ByteLength(value) {
  return decodedBase64Bytes(value).byteLength;
}

async function base64BodyDigest(value) {
  const digest = await crypto.subtle.digest("SHA-256", decodedBase64Bytes(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function removePrunedSessionBodies(chromeApi, previousStore, nextStore) {
  if (!chromeApi?.storage?.session?.remove) return;
  const retained = new Set((nextStore.items || []).map((item) => item.bodyKey).filter(Boolean));
  const removed = (previousStore.items || [])
    .map((item) => item.bodyKey)
    .filter((key) => key && !retained.has(key));
  if (removed.length) await chromeApi.storage.session.remove(removed);
}

async function localRoot(chromeApi) {
  const data = await chromeApi.storage.local.get(ROOT_KEY);
  return rootValue(data?.[ROOT_KEY]);
}

async function saveRootReadback(chromeApi, root, windowId, expectedRevision) {
  const value = {
    ...root,
    schema: ROOT_SCHEMA,
    version: 1,
    updatedAt: new Date().toISOString()
  };
  await chromeApi.storage.local.set({ [ROOT_KEY]: value });
  const readback = rootValue((await chromeApi.storage.local.get(ROOT_KEY))?.[ROOT_KEY]);
  const stored = readback.windows[String(Number(windowId))];
  if (!stored || Number(stored.revision) !== Number(expectedRevision)) {
    throw new Error("EVIDENCE_LOCAL_READBACK_FAILED");
  }
  return normalizeEvidenceStore(stored, { windowId });
}

export async function loadWindowEvidenceStore(chromeApi, windowId) {
  const root = await localRoot(chromeApi);
  return normalizeEvidenceStore(root.windows[String(Number(windowId))], { windowId });
}

export async function saveWindowEvidenceStore(chromeApi, storeValue) {
  const store = normalizeEvidenceStore(storeValue, { windowId: storeValue?.windowId });
  const root = await localRoot(chromeApi);
  root.windows[String(store.windowId)] = store;
  return saveRootReadback(chromeApi, root, store.windowId, store.revision);
}

export async function setEvidenceObservation(chromeApi, windowId, observation) {
  const store = await loadWindowEvidenceStore(chromeApi, windowId);
  store.observation = {
    ...store.observation,
    ...observation,
    schema: "eic.autonom.evidence-observation.v1",
    version: 1,
    updatedAt: new Date().toISOString()
  };
  store.revision += 1;
  return saveWindowEvidenceStore(chromeApi, store);
}

export async function persistEvidenceItem(chromeApi, {
  windowId,
  type,
  source,
  surface,
  payload,
  screenshotBase64 = ""
} = {}) {
  let bodyStorage = "NONE";
  let bodyKey = "";
  let bodyBytes = 0;
  let bodyDigest = "";
  let bodyReadbackVerified = false;

  if (screenshotBase64) {
    if (!chromeApi?.storage?.session?.set || !chromeApi?.storage?.session?.get) {
      throw new Error("EVIDENCE_SESSION_STORAGE_UNAVAILABLE");
    }
    bodyBytes = base64ByteLength(screenshotBase64);
    if (bodyBytes > EVIDENCE_LIMITS.MAX_SCREENSHOT_BYTES) {
      throw new Error(`EVIDENCE_SCREENSHOT_TOO_LARGE:${bodyBytes}`);
    }
    bodyDigest = await base64BodyDigest(screenshotBase64);
    const provisional = await createEvidenceItem({
      type,
      source,
      surface,
      windowId,
      payload,
      bodyStorage: "SESSION_RAW_PNG",
      bodyBytes,
      bodyDigest,
      readbackVerified: false
    });
    bodyKey = screenshotBodyKey(windowId, provisional.id);
    await chromeApi.storage.session.set({ [bodyKey]: screenshotBase64 });
    const bodyReadback = (await chromeApi.storage.session.get(bodyKey))?.[bodyKey];
    if (typeof bodyReadback !== "string" ||
        base64ByteLength(bodyReadback) !== bodyBytes ||
        await base64BodyDigest(bodyReadback) !== bodyDigest) {
      await chromeApi.storage.session.remove?.(bodyKey);
      throw new Error("EVIDENCE_SCREENSHOT_READBACK_FAILED");
    }
    bodyStorage = "SESSION_RAW_PNG";
    bodyReadbackVerified = true;
    provisional.bodyKey = bodyKey;
    provisional.readbackVerified = true;
    provisional.digest = await sha256Hex(stableStringify({
      ...provisional,
      digest: ""
    }));

    try {
      const store = await loadWindowEvidenceStore(chromeApi, windowId);
      const next = appendEvidenceItem(store, provisional);
      const saved = await saveWindowEvidenceStore(chromeApi, next);
      await removePrunedSessionBodies(chromeApi, store, saved);
      const item = saved.items.find((entry) => entry.id === provisional.id);
      if (!item || item.bodyDigest !== bodyDigest || item.bodyKey !== bodyKey) {
        throw new Error("EVIDENCE_ITEM_READBACK_FAILED");
      }
      return { store: saved, item };
    } catch (error) {
      await chromeApi.storage.session.remove?.(bodyKey);
      throw error;
    }
  }

  const item = await createEvidenceItem({
    type,
    source,
    surface,
    windowId,
    payload,
    bodyStorage,
    bodyKey,
    bodyBytes,
    bodyDigest,
    readbackVerified: bodyReadbackVerified
  });
  const store = await loadWindowEvidenceStore(chromeApi, windowId);
  const next = appendEvidenceItem(store, item);
  const saved = await saveWindowEvidenceStore(chromeApi, next);
  await removePrunedSessionBodies(chromeApi, store, saved);
  const readbackItem = saved.items.find((entry) => entry.id === item.id);
  if (!readbackItem || readbackItem.digest !== item.digest) {
    throw new Error("EVIDENCE_ITEM_READBACK_FAILED");
  }
  return { store: saved, item: readbackItem };
}


export async function readScreenshotEvidenceBody(chromeApi, item) {
  if (!item || item.type !== "SCREENSHOT" ||
      item.bodyStorage !== "SESSION_RAW_PNG" ||
      !item.bodyKey || !item.bodyDigest ||
      item.readbackVerified !== true) {
    throw new Error("EVIDENCE_SCREENSHOT_ITEM_NOT_READBACK_VERIFIED");
  }
  if (!chromeApi?.storage?.session?.get) {
    throw new Error("EVIDENCE_SESSION_STORAGE_UNAVAILABLE");
  }
  const body = (await chromeApi.storage.session.get(item.bodyKey))?.[item.bodyKey];
  if (typeof body !== "string") throw new Error("EVIDENCE_SCREENSHOT_BODY_MISSING");
  const bytes = base64ByteLength(body);
  const digest = await base64BodyDigest(body);
  if (bytes !== Number(item.bodyBytes) || digest !== String(item.bodyDigest)) {
    throw new Error("EVIDENCE_SCREENSHOT_BODY_READBACK_MISMATCH");
  }
  return {
    base64: body,
    bodyBytes: bytes,
    bodyDigest: digest,
    bodyKey: item.bodyKey,
    readbackVerified: true
  };
}

export async function markWindowEvidenceStale(chromeApi, windowId, {
  reason,
  surface = null
} = {}) {
  const store = await loadWindowEvidenceStore(chromeApi, windowId);
  if (!store.items.length &&
      store.observation.state === EVIDENCE_OBSERVATION_STATES.INACTIVE) {
    return store;
  }
  return saveWindowEvidenceStore(
    chromeApi,
    markEvidenceStoreStale(store, { reason, surface })
  );
}

export async function clearWindowEvidence(chromeApi, windowId) {
  const root = await localRoot(chromeApi);
  const key = String(Number(windowId));
  const store = normalizeEvidenceStore(root.windows[key], { windowId });
  const bodyKeys = store.items.map((item) => item.bodyKey).filter(Boolean);
  if (bodyKeys.length && chromeApi?.storage?.session?.remove) {
    await chromeApi.storage.session.remove(bodyKeys);
  }
  delete root.windows[key];
  await chromeApi.storage.local.set({ [ROOT_KEY]: root });
  const readback = rootValue((await chromeApi.storage.local.get(ROOT_KEY))?.[ROOT_KEY]);
  if (readback.windows[key]) throw new Error("EVIDENCE_CLEAR_READBACK_FAILED");
  return createEvidenceStore(windowId);
}

export async function loadWindowEvidenceSummary(chromeApi, windowId) {
  return evidenceStoreSummary(await loadWindowEvidenceStore(chromeApi, windowId));
}

export async function evidenceRootDigest(chromeApi) {
  return sha256Hex(stableStringify(await localRoot(chromeApi)));
}

export const EVIDENCE_STORAGE_KEYS = Object.freeze({
  ROOT: ROOT_KEY,
  BODY_PREFIX
});
