// v1.9.1 durable owner for the run requirements (Körkrav).
//
// chrome.storage.local belongs to one extension identity. An unpacked
// extension's identity is derived from its folder path, and every release zip
// unpacks into a new version-named folder, so loading a release from its own
// folder started with an empty store and the default run requirements
// (operator report 2026-10-07, reproduced in Chromium: same profile, new
// folder -> new extension id -> 24 / 96 / 400 / 800000 / 24000).
// Saved missions (v1.2.2) and queue sets already survive this through the
// Chrome profile bookmark store; this vault gives the run requirements the
// same owner. Same pattern as mission-queue-set-vault.mjs: staged write,
// byte readback, then commit; a damaged or foreign record reads as absent.

export const SAFETY_POLICY_VAULT_SCHEMA = "eic.greenfield.safety-policy-vault.v1";
export const SAFETY_POLICY_VAULT_FOLDER = "EIC Greenfield · Run requirements v1";
const FINAL_TITLE = "GFK1:ACTIVE";
const STAGE_PREFIX = "GFK1-STAGE:";
const CHUNK_URL_PREFIX = "https://greenfield.invalid/safety-policy-v1/chunk/";
const CHUNK_CHARS = 1800;

const t = (v) => String(v ?? "");
function enc(value) {
  const bytes = new TextEncoder().encode(t(value));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function dec(value) {
  const normalized = t(value).replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(normalized + padding);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}
function chunks(value) {
  const source = t(value);
  const out = [];
  for (let i = 0; i < source.length; i += CHUNK_CHARS) out.push(source.slice(i, i + CHUNK_CHARS));
  return out.length ? out : [""];
}
function findFolder(node, title) {
  if (!node || typeof node !== "object") return null;
  if (!node.url && node.title === title) return node;
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const found = findFolder(child, title);
    if (found) return found;
  }
  return null;
}
async function root(bookmarks, create = false) {
  if (!bookmarks?.getTree) throw new Error("SAFETY_POLICY_VAULT_UNAVAILABLE");
  const tree = await bookmarks.getTree();
  for (const node of tree || []) {
    const found = findFolder(node, SAFETY_POLICY_VAULT_FOLDER);
    if (found) return found;
  }
  if (!create) return null;
  const folders = (tree?.[0]?.children || []).filter((n) => n && !n.url && n.id);
  const parent = folders.find((n) => String(n.id) === "2") || folders.at(-1) || folders[0];
  if (!parent) throw new Error("SAFETY_POLICY_VAULT_PARENT_UNAVAILABLE");
  const made = await bookmarks.create({ parentId: parent.id, title: SAFETY_POLICY_VAULT_FOLDER });
  if (!made?.id) throw new Error("SAFETY_POLICY_VAULT_CREATE_FAILED");
  return made;
}

/**
 * A vault record: { policy, savedAtMs, appVersion }. The policy is validated
 * by the caller-supplied normalizePolicy (the same one storage uses), so a
 * record that the current policy rules reject reads as absent.
 */
const MAX_CLOCK_SKEW_MS = 86400000;
function decodeRecord(parsed, normalizePolicy, now = Date.now()) {
  if (parsed?.schema !== SAFETY_POLICY_VAULT_SCHEMA) return null;
  const savedAtMs = Number(parsed.savedAtMs);
  // A far-future stamp would outrank every real save; it reads as absent and
  // the next save or startup seed replaces it.
  if (!Number.isSafeInteger(savedAtMs) || savedAtMs <= 0 || savedAtMs > now + MAX_CLOCK_SKEW_MS) return null;
  // normalizePolicy fills missing keys with defaults; a record missing any key
  // is damaged and must never be adopted as "the defaults".
  const policy = parsed.policy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return null;
  try {
    const normalized = normalizePolicy(policy);
    if (Object.keys(normalized).some((key) => !Object.hasOwn(policy, key))) return null;
    return { policy: normalized, savedAtMs, appVersion: t(parsed.appVersion).slice(0, 40) };
  } catch {
    return null;
  }
}

async function readSnapshot(folder, bookmarks, normalizePolicy) {
  if (!folder?.id) return null;
  const children = await bookmarks.getChildren(folder.id);
  const parts = [];
  for (const child of children || []) {
    if (!child?.url || !t(child.url).startsWith(CHUNK_URL_PREFIX)) continue;
    let url;
    try { url = new URL(child.url); } catch { continue; }
    const m = url.pathname.match(/\/safety-policy-v1\/chunk\/(\d+)\/(\d+)$/);
    if (!m) continue;
    parts.push({ index: Number(m[1]), total: Number(m[2]), data: url.hash.slice(1) });
  }
  parts.sort((a, b) => a.index - b.index);
  if (!parts.length || parts.length !== parts[0].total || parts.some((p, i) => p.index !== i || p.total !== parts.length)) return null;
  try {
    return decodeRecord(JSON.parse(dec(parts.map((p) => p.data).join(""))), normalizePolicy);
  } catch {
    return null;
  }
}

export async function loadSafetyPolicyVault(bookmarks, { normalizePolicy }) {
  const folder = await root(bookmarks, false);
  if (!folder) return null;
  const children = await bookmarks.getChildren(folder.id);
  // Normally one committed copy; with Chrome Sync two may meet in any order,
  // so the newest save is chosen by its own time, not by position.
  let newest = null;
  for (const node of (children || []).filter((n) => !n.url && t(n.title) === FINAL_TITLE)) {
    const record = await readSnapshot(node, bookmarks, normalizePolicy);
    if (record && (!newest || record.savedAtMs > newest.savedAtMs)) newest = record;
  }
  return newest;
}

export async function writeSafetyPolicyVault({ policy, savedAtMs, appVersion = "" }, { bookmarks, normalizePolicy, nonce = "" }) {
  if (!bookmarks?.create || !bookmarks?.getChildren || !bookmarks?.update || !bookmarks?.removeTree) {
    throw new Error("SAFETY_POLICY_VAULT_UNAVAILABLE");
  }
  const record = decodeRecord({ schema: SAFETY_POLICY_VAULT_SCHEMA, policy, savedAtMs, appVersion }, normalizePolicy);
  if (!record) throw new Error("SAFETY_POLICY_VAULT_RECORD_INVALID");
  const folder = await root(bookmarks, true);
  // A stage left by an interrupted write (browser closed mid-write) is never a committed copy.
  for (const node of (await bookmarks.getChildren(folder.id)) || []) {
    if (!node.url && t(node.title).startsWith(STAGE_PREFIX)) await bookmarks.removeTree(node.id).catch(() => undefined);
  }
  const payload = enc(JSON.stringify({ schema: SAFETY_POLICY_VAULT_SCHEMA, ...record }));
  const parts = chunks(payload);
  const stage = await bookmarks.create({ parentId: folder.id, title: `${STAGE_PREFIX}${nonce || savedAtMs}` });
  let committed = false;
  try {
    for (let i = 0; i < parts.length; i += 1) {
      await bookmarks.create({
        parentId: stage.id,
        title: `chunk ${i + 1}/${parts.length}`,
        url: `${CHUNK_URL_PREFIX}${i}/${parts.length}#${parts[i]}`
      });
    }
    const staged = await readSnapshot(stage, bookmarks, normalizePolicy);
    if (JSON.stringify(staged) !== JSON.stringify(record)) throw new Error("SAFETY_POLICY_VAULT_STAGE_READBACK_MISMATCH");
    await bookmarks.update(stage.id, { title: FINAL_TITLE });
    committed = true;
    for (const node of (await bookmarks.getChildren(folder.id)) || []) {
      if (node.id !== stage.id && !node.url && t(node.title) === FINAL_TITLE) await bookmarks.removeTree(node.id);
    }
    const readback = await loadSafetyPolicyVault(bookmarks, { normalizePolicy });
    if (JSON.stringify(readback) !== JSON.stringify(record)) throw new Error("SAFETY_POLICY_VAULT_COMMIT_READBACK_MISMATCH");
    return readback;
  } catch (error) {
    // After the rename the stage IS the newest committed copy (older copies
    // may already be gone); removing it here could leave no copy at all.
    if (!committed) await bookmarks.removeTree(stage.id).catch(() => undefined);
    throw error;
  }
}

/**
 * What to do at startup. The newest operator save in this Chrome profile wins:
 *   ADOPT_VAULT  the vault was saved later than this installation's policy
 *                (or this installation never saved one, e.g. a new extension id);
 *   SEED_VAULT   this installation's policy is newer than the vault, or the
 *                vault is empty and the local policy differs from the defaults
 *                (a value saved before v1.9.1, or a vault write that failed);
 *   NONE         nothing to reconcile.
 * Pure: `local` is the stored safety record (or null), `vault` a vault record (or null).
 */
export function safetyPolicyVaultPlan({ local, vault, defaults, equalPolicy }) {
  const localPolicy = local?.policy || defaults;
  const localAt = Number(local?.policyUpdatedAtMs || 0);
  const localIsDefault = equalPolicy(localPolicy, defaults);
  if (vault) {
    if (vault.savedAtMs > localAt) {
      return equalPolicy(vault.policy, localPolicy)
        ? { action: "NONE", reason: "VAULT_NEWER_SAME_POLICY" }
        : { action: "ADOPT_VAULT", reason: localAt ? "VAULT_NEWER_THAN_LOCAL" : "LOCAL_HAS_NO_SAVE_TIME" };
    }
    if (localAt > vault.savedAtMs && !equalPolicy(vault.policy, localPolicy)) {
      return { action: "SEED_VAULT", reason: "LOCAL_NEWER_THAN_VAULT" };
    }
    return { action: "NONE", reason: "IN_SYNC" };
  }
  if (!localIsDefault) return { action: "SEED_VAULT", reason: localAt ? "VAULT_EMPTY" : "VAULT_EMPTY_LEGACY_LOCAL_POLICY" };
  return { action: "NONE", reason: "DEFAULTS_NO_VAULT" };
}

export function safetyPolicyVaultContract() {
  return {
    schema: SAFETY_POLICY_VAULT_SCHEMA,
    owner: "CHROME_PROFILE_BOOKMARK_STORE",
    extensionInstallIndependent: true,
    extensionIdIndependent: true,
    precedence: "NEWEST_OPERATOR_SAVE_IN_PROFILE"
  };
}
