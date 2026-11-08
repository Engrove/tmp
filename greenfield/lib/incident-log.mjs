import { readStorage } from "./storage-read.mjs";
import { fifoRowsByBytes, MAX_LOG_BYTES } from "./log-byte-budget.mjs";
// v1.8.13 durable incident log.
//
// Diagnostics 2026-10-05 could not say why 30 turns never got an answer, why
// a GFW moved to a fresh chat after 54 minutes, or why all four windows stood
// still for 2-12 hours: the audit log is volatile by default and the safety
// events keep only the last 200 rows (about 15 hours). This ring keeps the
// automatic decisions that change what runs: stale-ladder steps with what the
// page showed, session rotations and queue switches with their reason, slot
// hand-backs, safety holds that start or change, policy changes and restart
// restores. Ids, codes, numbers and flags only: no prompt, answer or page
// text is stored.

export const INCIDENT_LOG_KEY = "eic.gf.incident-log.v1";
export const INCIDENT_LOG_SCHEMA = "eic.greenfield.incident-log.v1";
export const INCIDENT_LOG_MAX_ROWS = 400;
export const INCIDENT_LOG_MAX_BYTES = MAX_LOG_BYTES;
export const INCIDENT_LOG_CRITICAL_RESERVE = 200;
// v1.9.3: 28 so the stale-ladder rows keep every page flag with the two
// provider-notice flags added (up to 5 decision keys + 20 page keys).
export const INCIDENT_DETAIL_MAX_KEYS = 28;
export const INCIDENT_TEXT_MAX_CHARS = 120;

let writeQueue = Promise.resolve();

function serialize(work) {
  const next = writeQueue.then(work, work);
  writeQueue = next.catch(() => undefined);
  return next;
}

function shortText(value, max = INCIDENT_TEXT_MAX_CHARS) {
  return String(value ?? "").slice(0, max);
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Flat detail: numbers, booleans, null and short strings only. */
export function sanitizeIncidentDetail(detail = {}) {
  const out = {};
  if (!detail || typeof detail !== "object") return out;
  for (const [key, value] of Object.entries(detail).slice(0, INCIDENT_DETAIL_MAX_KEYS)) {
    const name = shortText(key, 48);
    if (typeof value === "number") out[name] = Number.isFinite(value) ? value : null;
    else if (typeof value === "boolean" || value === null) out[name] = value;
    else if (typeof value === "string") out[name] = shortText(value);
  }
  return out;
}

export function makeIncidentRow({
  eventId = "",
  appVersion = "",
  atMs = Date.now(),
  kind = "",
  code = "",
  workerId = "",
  processId = "",
  windowId = null,
  generation = null,
  sessionSeq = null,
  turn = null,
  promptHash = "",
  detail = {}
} = {}) {
  return {
    eventId: shortText(eventId, 100),
    appVersion: shortText(appVersion, 32),
    atMs: finiteOrNull(atMs) ?? Date.now(),
    kind: shortText(kind, 64),
    code: shortText(code, 96),
    workerId: shortText(workerId, 80),
    processId: shortText(processId, 80),
    windowId: finiteOrNull(windowId),
    generation: finiteOrNull(generation),
    sessionSeq: finiteOrNull(sessionSeq),
    turn: finiteOrNull(turn),
    promptHash: shortText(promptHash, 16),
    detail: sanitizeIncidentDetail(detail)
  };
}

export function normalizeIncidentLog(value = {}) {
  const rows = Array.isArray(value?.rows) ? value.rows.filter((row) => row && typeof row === "object") : [];
  const bounded = fifoRowsByBytes(retainedRows(rows.map((row) => makeIncidentRow(row))), INCIDENT_LOG_MAX_BYTES);
  return {
    schema: INCIDENT_LOG_SCHEMA,
    rows: bounded.rows,
    droppedRows: Math.max(0, Number(value?.droppedRows || 0) | 0) + bounded.dropped
  };
}

function retainedRows(rows) {
  const critical = row => /SAFETY_HOLD|SESSION_ROTATION|WARM_RESUME_ABANDONED|RESPONSE_CAPTURE_REPAIR|RESPONSE_CAPTURE_INVALIDATED|MISSION_OWNERSHIP|STALE_LADDER|DELIVERY_RETRY/.test(row.kind);
  const recent = rows.slice(-INCIDENT_LOG_MAX_ROWS);
  const reserved = rows.slice(0, -INCIDENT_LOG_MAX_ROWS).filter(critical).slice(-INCIDENT_LOG_CRITICAL_RESERVE);
  return [...reserved, ...recent];
}

export async function readIncidentLog(storage = chrome.storage.local) {
  const stored = await readStorage(storage,INCIDENT_LOG_KEY);
  return normalizeIncidentLog(stored?.[INCIDENT_LOG_KEY] || {});
}

export async function appendIncident(row, storage = chrome.storage.local) {
  return serialize(async () => {
    const current = await readIncidentLog(storage);
    const rows = [...current.rows, makeIncidentRow({ ...row, eventId: row.eventId || globalThis.crypto.randomUUID() })];
    const capped = fifoRowsByBytes(retainedRows(rows), INCIDENT_LOG_MAX_BYTES);
    const retained = capped.rows;
    const overflow = rows.length - retained.length;
    const next = {
      schema: INCIDENT_LOG_SCHEMA,
      rows: retained,
      droppedRows: current.droppedRows + overflow
    };
    await storage.set({ [INCIDENT_LOG_KEY]: next });
    return next.rows[next.rows.length - 1];
  });
}
