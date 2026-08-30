import {
  nowIso,
  nullableInteger,
  randomId,
  sanitizeText,
  sha256Hex,
  stableStringify
} from "./common.mjs";

export const EVIDENCE_STORE_SCHEMA = "eic.autonom.evidence-store.v1";
export const EVIDENCE_ITEM_SCHEMA = "eic.autonom.evidence-item.v1";
export const EVIDENCE_OBSERVATION_SCHEMA = "eic.autonom.evidence-observation.v1";

export const EVIDENCE_TYPES = Object.freeze({
  AX_TREE: "AX_TREE",
  DOM_SNAPSHOT: "DOM_SNAPSHOT",
  SCREENSHOT: "SCREENSHOT",
  CONSOLE: "CONSOLE",
  NETWORK: "NETWORK",
  NAVIGATION: "NAVIGATION",
  BROWSER_OBSERVATION: "BROWSER_OBSERVATION",
  BROWSER_ACTION_RECEIPT: "BROWSER_ACTION_RECEIPT",
  BROWSER_ATTACHMENT_RECEIPT: "BROWSER_ATTACHMENT_RECEIPT",
  RECEIPT: "RECEIPT"
});

export const EVIDENCE_OBSERVATION_STATES = Object.freeze({
  INACTIVE: "INACTIVE",
  STARTING: "STARTING",
  ACTIVE: "ACTIVE",
  STOPPING: "STOPPING",
  STALE: "STALE",
  ERROR: "ERROR"
});

export const EVIDENCE_LIMITS = Object.freeze({
  MAX_ITEMS: 200,
  MAX_DURABLE_BYTES: 1_500_000,
  MAX_SCREENSHOTS: 4,
  MAX_SCREENSHOT_BYTES: 4_000_000,
  MAX_AX_NODES: 500,
  MAX_LAYOUT_BOUNDS: 250,
  MAX_CONSOLE_ITEMS: 60,
  MAX_NETWORK_ITEMS: 80,
  MAX_NAVIGATION_ITEMS: 40,
  MAX_BROWSER_OBSERVATIONS: 12,
  MAX_BROWSER_ACTION_RECEIPTS: 100,
  MAX_BROWSER_ATTACHMENT_RECEIPTS: 40,
  MAX_RECEIPTS: 40,
  MAX_TEXT: 2_000
});

const TYPE_SET = new Set(Object.values(EVIDENCE_TYPES));
const STATE_SET = new Set(Object.values(EVIDENCE_OBSERVATION_STATES));
const SENSITIVE_KEY = /(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|credential|session[-_]?(?:id|locator)|lock[-_]?token|confirmation[-_]?token|preflight[-_]?receipt|credential[-_]?ref|secret[-_]?ref)/i;
const SECRET_PATTERNS = Object.freeze([
  /\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}\b/gi,
  /\bBasic\s+[A-Za-z0-9+\/=]{8,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi,
  /\b[A-Fa-f0-9]{32,}\b/g
]);

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).byteLength;
}

export function redactEvidenceText(value, max = EVIDENCE_LIMITS.MAX_TEXT) {
  let output = sanitizeText(value ?? "", max * 2);
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, "[REDACTED]");
  output = output.replace(
    /((?:password|passwd|secret|token|api[-_]?key|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi,
    "$1[REDACTED]"
  );
  return sanitizeText(output, max);
}

export function sanitizeEvidenceUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return redactEvidenceText(`${parsed.origin}${parsed.pathname || "/"}`, 2000);
  } catch {
    return "";
  }
}

export function sanitizeEvidenceHeaders(headers = {}) {
  const allowed = new Set(["content-type", "content-length", "cache-control"]);
  const result = {};
  for (const [key, value] of Object.entries(headers && typeof headers === "object" ? headers : {})) {
    const normalized = String(key || "").toLowerCase();
    if (SENSITIVE_KEY.test(normalized) || !allowed.has(normalized)) continue;
    result[normalized] = redactEvidenceText(value, 300);
  }
  return result;
}

export function redactEvidenceValue(value, {
  key = "",
  depth = 0,
  maxDepth = 5
} = {}) {
  if (SENSITIVE_KEY.test(String(key || ""))) return "[REDACTED]";
  if (depth > maxDepth) return "[TRUNCATED]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    if (/(?:digest|hash|sha256)/i.test(String(key || "")) && /^[a-f0-9]{64}$/i.test(value)) {
      return value.toLowerCase();
    }
    return redactEvidenceText(value);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) =>
      redactEvidenceValue(item, { key, depth: depth + 1, maxDepth }));
  }
  if (typeof value === "object") {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 200)) {
      result[childKey] = redactEvidenceValue(childValue, {
        key: childKey,
        depth: depth + 1,
        maxDepth
      });
    }
    return result;
  }
  return redactEvidenceText(String(value));
}

export function createEvidenceObservation({
  state = EVIDENCE_OBSERVATION_STATES.INACTIVE,
  sessionId = "",
  surface = null,
  reason = "CREATED",
  now = Date.now()
} = {}) {
  const validState = STATE_SET.has(state) ? state : EVIDENCE_OBSERVATION_STATES.INACTIVE;
  return {
    schema: EVIDENCE_OBSERVATION_SCHEMA,
    version: 1,
    state: validState,
    sessionId: String(sessionId || ""),
    tabId: nullableInteger(surface?.tabId) !== null ? Number(surface.tabId) : null,
    surfaceId: String(surface?.surfaceId || ""),
    documentEpoch: String(surface?.documentEpoch || ""),
    origin: String(surface?.origin || ""),
    startedAt: validState === EVIDENCE_OBSERVATION_STATES.ACTIVE ? nowIso(now) : null,
    stoppedAt: null,
    lastReason: redactEvidenceText(reason, 400),
    updatedAt: nowIso(now)
  };
}

export function createEvidenceStore(windowId, now = Date.now()) {
  return {
    schema: EVIDENCE_STORE_SCHEMA,
    version: 1,
    windowId: Number(windowId),
    revision: 0,
    observation: createEvidenceObservation({ now }),
    items: [],
    durableBytes: 0,
    updatedAt: nowIso(now)
  };
}

export function normalizeEvidenceStore(value, {
  windowId,
  now = Date.now()
} = {}) {
  const source = value && typeof value === "object" ? value : {};
  const store = createEvidenceStore(windowId ?? source.windowId, now);
  const observationSource = source.observation && typeof source.observation === "object"
    ? source.observation
    : {};
  const state = STATE_SET.has(observationSource.state)
    ? observationSource.state
    : EVIDENCE_OBSERVATION_STATES.INACTIVE;
  store.revision = Math.max(0, Number(source.revision || 0));
  store.observation = {
    ...createEvidenceObservation({ state, now }),
    ...observationSource,
    schema: EVIDENCE_OBSERVATION_SCHEMA,
    version: 1,
    state,
    tabId: nullableInteger(observationSource.tabId) !== null
      ? Number(observationSource.tabId)
      : null,
    updatedAt: observationSource.updatedAt || nowIso(now)
  };
  store.items = Array.isArray(source.items)
    ? source.items
      .filter((item) => item && typeof item === "object" && TYPE_SET.has(item.type))
      .map((item) => ({
        ...item,
        schema: EVIDENCE_ITEM_SCHEMA,
        version: 1,
        id: String(item.id || randomId("evidence")),
        type: item.type,
        stale: Boolean(item.stale),
        payload: redactEvidenceValue(item.payload || {})
      }))
    : [];
  return enforceEvidenceQuotas(store, now);
}

function typeLimit(type) {
  if (type === EVIDENCE_TYPES.SCREENSHOT) return EVIDENCE_LIMITS.MAX_SCREENSHOTS;
  if (type === EVIDENCE_TYPES.CONSOLE) return EVIDENCE_LIMITS.MAX_CONSOLE_ITEMS;
  if (type === EVIDENCE_TYPES.NETWORK) return EVIDENCE_LIMITS.MAX_NETWORK_ITEMS;
  if (type === EVIDENCE_TYPES.NAVIGATION) return EVIDENCE_LIMITS.MAX_NAVIGATION_ITEMS;
  if (type === EVIDENCE_TYPES.BROWSER_OBSERVATION) return EVIDENCE_LIMITS.MAX_BROWSER_OBSERVATIONS;
  if (type === EVIDENCE_TYPES.BROWSER_ACTION_RECEIPT) return EVIDENCE_LIMITS.MAX_BROWSER_ACTION_RECEIPTS;
  if (type === EVIDENCE_TYPES.BROWSER_ATTACHMENT_RECEIPT) return EVIDENCE_LIMITS.MAX_BROWSER_ATTACHMENT_RECEIPTS;
  if (type === EVIDENCE_TYPES.RECEIPT) return EVIDENCE_LIMITS.MAX_RECEIPTS;
  return EVIDENCE_LIMITS.MAX_ITEMS;
}

export function enforceEvidenceQuotas(value, now = Date.now()) {
  const store = {
    ...value,
    items: Array.isArray(value?.items) ? [...value.items] : []
  };
  const counts = new Map();
  const kept = [];
  let durableBytes = 0;
  for (const item of store.items) {
    if (kept.length >= EVIDENCE_LIMITS.MAX_ITEMS) break;
    const count = counts.get(item.type) || 0;
    if (count >= typeLimit(item.type)) continue;
    const bytes = byteLength(stableStringify(item));
    if (durableBytes + bytes > EVIDENCE_LIMITS.MAX_DURABLE_BYTES) continue;
    counts.set(item.type, count + 1);
    kept.push(item);
    durableBytes += bytes;
  }
  store.items = kept;
  store.durableBytes = durableBytes;
  store.updatedAt = nowIso(now);
  return store;
}

export async function createEvidenceItem({
  type,
  source = "CDP",
  surface,
  windowId,
  payload = {},
  bodyStorage = "NONE",
  bodyKey = "",
  bodyBytes = 0,
  bodyDigest = "",
  readbackVerified = false,
  now = Date.now()
} = {}) {
  if (!TYPE_SET.has(type)) throw new Error(`EVIDENCE_TYPE_UNSUPPORTED:${type}`);
  if (nullableInteger(windowId) === null) throw new Error("EVIDENCE_WINDOW_ID_REQUIRED");
  const cleanPayload = redactEvidenceValue(payload);
  const canonical = stableStringify({
    type,
    source,
    windowId: Number(windowId),
    tabId: nullableInteger(surface?.tabId) !== null ? Number(surface.tabId) : null,
    surfaceId: String(surface?.surfaceId || ""),
    documentEpoch: String(surface?.documentEpoch || ""),
    origin: String(surface?.origin || ""),
    payload: cleanPayload,
    bodyStorage,
    bodyKey,
    bodyBytes,
    bodyDigest
  });
  return {
    schema: EVIDENCE_ITEM_SCHEMA,
    version: 1,
    id: randomId("evidence"),
    type,
    source: sanitizeText(source, 80),
    at: nowIso(now),
    windowId: Number(windowId),
    tabId: nullableInteger(surface?.tabId) !== null ? Number(surface.tabId) : null,
    surfaceId: String(surface?.surfaceId || ""),
    documentEpoch: String(surface?.documentEpoch || ""),
    origin: String(surface?.origin || ""),
    stale: false,
    digest: await sha256Hex(canonical),
    bodyStorage: String(bodyStorage || "NONE"),
    bodyKey: String(bodyKey || ""),
    bodyBytes: Math.max(0, Number(bodyBytes || 0)),
    bodyDigest: String(bodyDigest || ""),
    readbackVerified: Boolean(readbackVerified),
    payload: cleanPayload
  };
}

export function appendEvidenceItem(storeValue, item, now = Date.now()) {
  const store = normalizeEvidenceStore(storeValue, { windowId: item.windowId, now });
  store.items = [item, ...store.items.filter((entry) => entry.id !== item.id)];
  store.revision += 1;
  return enforceEvidenceQuotas(store, now);
}

export function markEvidenceStoreStale(storeValue, {
  reason = "TARGET_IDENTITY_CHANGED",
  surface = null,
  now = Date.now()
} = {}) {
  const store = normalizeEvidenceStore(storeValue, {
    windowId: storeValue?.windowId,
    now
  });
  store.observation = {
    ...store.observation,
    state: EVIDENCE_OBSERVATION_STATES.STALE,
    stoppedAt: nowIso(now),
    lastReason: redactEvidenceText(reason, 400),
    updatedAt: nowIso(now)
  };
  store.items = store.items.map((item) => ({
    ...item,
    stale: item.stale || !surface ||
      String(item.surfaceId || "") !== String(surface.surfaceId || "") ||
      String(item.documentEpoch || "") !== String(surface.documentEpoch || "")
  }));
  store.revision += 1;
  return enforceEvidenceQuotas(store, now);
}

export function evidenceStoreSummary(storeValue) {
  const store = normalizeEvidenceStore(storeValue, {
    windowId: storeValue?.windowId
  });
  const counts = {};
  for (const item of store.items) counts[item.type] = (counts[item.type] || 0) + 1;
  return {
    schema: EVIDENCE_STORE_SCHEMA,
    version: 1,
    windowId: store.windowId,
    revision: store.revision,
    observation: { ...store.observation },
    count: store.items.length,
    counts,
    durableBytes: store.durableBytes,
    latest: store.items.slice(0, 50).map((item) => ({
      id: item.id,
      type: item.type,
      at: item.at,
      stale: item.stale,
      digest: item.digest,
      bodyStorage: item.bodyStorage,
      bodyBytes: item.bodyBytes,
      bodyDigest: item.bodyDigest,
      readbackVerified: item.readbackVerified,
      payload: item.payload,
      surfaceId: item.surfaceId,
      documentEpoch: item.documentEpoch,
      origin: item.origin
    }))
  };
}
