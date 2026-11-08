// v2.0.0: durable storage for the per-mission progress ledger.
// One record per logical mission (progressMissionKey), plus a small index so
// the side panel can list open operator requests without scanning storage.
import { readStorage } from "./storage-read.mjs";
import {
  createProgressLedger,
  normalizeProgressLedger
} from "./progress-engine.mjs";

export const PROGRESS_STORE_PREFIX = "eic.gf.progress.v1.";
export const PROGRESS_STORE_INDEX_KEY = "eic.gf.progress.v1.__index";
export const PROGRESS_STORE_INDEX_LIMIT = 200;
const RECORD_SCHEMA = "eic.greenfield.progress-record.v1";

export function progressStoreKey(missionKey) {
  return `${PROGRESS_STORE_PREFIX}${encodeURIComponent(String(missionKey || ""))}`;
}

function defaultStorage() {
  return globalThis.chrome?.storage?.local;
}

function normalizeRecord(value, missionKey, now) {
  const v = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const ledger = v.ledger
    ? normalizeProgressLedger(v.ledger, { missionKey, now })
    : createProgressLedger({ missionKey, now });
  const last = v.lastResult && typeof v.lastResult === "object" ? v.lastResult : null;
  return {
    schema: RECORD_SCHEMA,
    missionKey,
    ledger,
    lastAppliedResponseKey: typeof v.lastAppliedResponseKey === "string" ? v.lastAppliedResponseKey.slice(0, 600) : "",
    lastResult: last ? {
      verdict: String(last.verdict || ""),
      alert: String(last.alert || ""),
      alertReason: String(last.alertReason || ""),
      parkRequest: last.parkRequest && typeof last.parkRequest === "object" ? last.parkRequest : null
    } : null
  };
}

export async function loadProgressRecord(missionKey, { storage = defaultStorage(), now = Date.now() } = {}) {
  const key = String(missionKey || "").trim();
  if (!key) throw new Error("PROGRESS_MISSION_KEY_REQUIRED");
  const storeKey = progressStoreKey(key);
  const result = storage ? await readStorage(storage, storeKey) : {};
  return normalizeRecord(result?.[storeKey], key, now);
}

async function readIndex(storage) {
  const result = await readStorage(storage, PROGRESS_STORE_INDEX_KEY);
  const list = result?.[PROGRESS_STORE_INDEX_KEY];
  return Array.isArray(list) ? list.filter((x) => typeof x === "string" && x) : [];
}

export async function saveProgressRecord(record, { storage = defaultStorage() } = {}) {
  if (!storage) throw new Error("PROGRESS_STORAGE_UNAVAILABLE");
  const key = String(record?.missionKey || record?.ledger?.missionKey || "").trim();
  if (!key) throw new Error("PROGRESS_MISSION_KEY_REQUIRED");
  const normalized = normalizeRecord(record, key, Date.now());
  const index = await readIndex(storage);
  const nextIndex = [...index.filter((x) => x !== key), key].slice(-PROGRESS_STORE_INDEX_LIMIT);
  await storage.set({ [progressStoreKey(key)]: normalized, [PROGRESS_STORE_INDEX_KEY]: nextIndex });
  return normalized;
}

export async function listProgressRecords({ storage = defaultStorage(), keys = null, now = Date.now() } = {}) {
  if (!storage) return [];
  const wanted = Array.isArray(keys) ? [...new Set(keys.filter((x) => typeof x === "string" && x))] : await readIndex(storage);
  if (!wanted.length) return [];
  const storeKeys = wanted.map(progressStoreKey);
  const result = await readStorage(storage, storeKeys);
  return wanted
    .map((key, i) => (result?.[storeKeys[i]] ? normalizeRecord(result[storeKeys[i]], key, now) : null))
    .filter(Boolean);
}

export async function openOperatorRequests({ storage = defaultStorage() } = {}) {
  const records = await listProgressRecords({ storage });
  return records
    .filter((r) => r.ledger.operatorRequest?.status === "OPEN")
    .map((r) => ({ missionKey: r.missionKey, operatorRequest: r.ledger.operatorRequest }));
}
