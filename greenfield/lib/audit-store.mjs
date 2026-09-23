import {
  APP_VERSION,
  AUDIT_SCHEMA,
  AUDIT_DB_VERSION,
  MAX_AUDIT_TEXT_CHARS,
  MAX_PERSISTED_AUDIT_EVENTS
} from "./contracts.mjs";
import { bounded, errorRecord, nowIso, randomId } from "./common.mjs";

const DB_NAME = "eic-autonom-agent-greenfield";
const DB_VERSION = AUDIT_DB_VERSION;
const EVENT_STORE = "auditEvents";
const COUNTER_STORE = "auditCounters";
let runtimeSequence = 0;

function ensureIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      let eventStore;
      if (!db.objectStoreNames.contains(EVENT_STORE)) {
        eventStore = db.createObjectStore(EVENT_STORE, { keyPath: "eventKey" });
      } else {
        eventStore = request.transaction.objectStore(EVENT_STORE);
      }

      // Legacy single-key indexes are retained for upgrade compatibility.
      ensureIndex(eventStore, "byProcess", "processId");
      ensureIndex(eventStore, "byRun", "runId");
      ensureIndex(eventStore, "byWindow", "windowId");
      ensureIndex(eventStore, "bySession", "auditSessionId");
      ensureIndex(eventStore, "byScope", "scope");

      // v1.1.12: time-bearing indexes allow bounded reverse reads without getAll().
      ensureIndex(eventStore, "byTimestamp", "timestamp");
      ensureIndex(eventStore, "byProcessTime", ["processId", "timestamp"]);
      ensureIndex(eventStore, "byRunTime", ["runId", "timestamp"]);
      ensureIndex(eventStore, "byWindowTime", ["windowId", "timestamp"]);
      ensureIndex(eventStore, "bySessionTime", ["auditSessionId", "timestamp"]);
      ensureIndex(eventStore, "byScopeTime", ["scope", "timestamp"]);

      // Keep the legacy store so upgrades never require destructive schema surgery.
      if (!db.objectStoreNames.contains(COUNTER_STORE)) {
        db.createObjectStore(COUNTER_STORE, { keyPath: "processId" });
      }
    };
    request.onerror = () => reject(request.error || new Error("AUDIT_DB_OPEN_FAILED"));
    request.onsuccess = () => resolve(request.result);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("AUDIT_TX_FAILED"));
    tx.onabort = () => reject(tx.error || new Error("AUDIT_TX_ABORTED"));
  });
}

function normalizeContext({
  process = null,
  scope = "",
  auditSessionId = "",
  windowId = null,
  tabId = null,
  processId = "",
  runId = "",
  generation = null,
  turn = null,
  phase = ""
} = {}) {
  const p = process || {};
  const resolvedScope = scope || (p.processId ? "RUN" : Number.isInteger(windowId) ? "WINDOW" : "APP");
  return {
    scope: resolvedScope,
    auditSessionId: String(auditSessionId || p.auditSessionId || ""),
    processId: String(processId || p.processId || ""),
    runId: String(runId || p.runId || ""),
    generation: Number.isInteger(generation) ? generation : (Number.isInteger(p.generation) ? p.generation : null),
    windowId: Number.isInteger(windowId) ? windowId : (Number.isInteger(p.windowId) ? p.windowId : null),
    tabId: Number.isInteger(tabId) ? tabId : (Number.isInteger(p.tabId) ? p.tabId : null),
    turn: Number.isInteger(turn) ? turn : (Number.isInteger(p.turn) ? p.turn : null),
    phase: String(phase || p.phase || "")
  };
}

export function makeAuditEvent({
  process = null,
  scope = "",
  auditSessionId = "",
  windowId = null,
  tabId = null,
  processId = "",
  runId = "",
  generation = null,
  turn = null,
  phase = "",
  kind,
  component = "runtime",
  operationId = "",
  payload = {},
  severity = "INFO",
  at = Date.now()
}) {
  const context = normalizeContext({
    process, scope, auditSessionId, windowId, tabId, processId, runId, generation, turn, phase
  });
  const timestamp = nowIso(at);
  runtimeSequence = (runtimeSequence + 1) % 1000;
  const seq = (Number(at) * 1000) + runtimeSequence;
  return {
    schema: AUDIT_SCHEMA,
    appVersion: APP_VERSION,
    eventKey: `time:${timestamp}:${randomId("audit")}`,
    eventId: randomId("audit"),
    seq,
    timestamp,
    severity: String(severity || "INFO"),
    ...context,
    kind: String(kind || "event"),
    component: String(component || "runtime"),
    operationId: String(operationId || ""),
    payload: bounded(payload, MAX_AUDIT_TEXT_CHARS)
  };
}

export async function writeAuditEvent(event) {
  const db = await openDb();
  try {
    const tx = db.transaction(EVENT_STORE, "readwrite");
    tx.objectStore(EVENT_STORE).put(event);
    await txDone(tx);
    return event;
  } finally {
    db.close();
  }
}

export async function appendAudit(input) {
  const event = makeAuditEvent(input);
  await writeAuditEvent(event);
  return event;
}

export async function appendAuditError({
  error,
  kind = "UNHANDLED_ERROR",
  component = "runtime",
  severity = "ERROR",
  payload = {},
  ...context
}) {
  return appendAudit({
    ...context,
    kind,
    component,
    severity,
    payload: {
      error: errorRecord(error),
      ...bounded(payload, MAX_AUDIT_TEXT_CHARS)
    }
  });
}

function matchesFilter(row, filter) {
  if (!filter) return true;
  if (typeof filter === "string") return row.processId === filter;
  const {
    processId = "",
    runId = "",
    windowId = null,
    auditSessionId = "",
    since = "",
    includeWindowPrelude = false,
    includeAppEvents = false
  } = filter;
  const after = since ? Date.parse(since) : NaN;
  if (Number.isFinite(after) && Date.parse(row.timestamp || "") < after) return false;

  if (includeAppEvents && row.scope === "APP" && !row.processId) return true;
  if (auditSessionId && row.auditSessionId === auditSessionId) return true;
  if (processId && row.processId === processId) return true;
  if (runId && row.runId === runId) return true;
  if (includeWindowPrelude && Number.isInteger(windowId) && row.windowId === windowId && !row.processId) return true;
  if (!processId && !runId && !auditSessionId && Number.isInteger(windowId)) return row.windowId === windowId;
  return false;
}

function cursorRows(source, range, direction, limit) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const request = source.openCursor(range, direction);
    request.onerror = () => reject(request.error || new Error("AUDIT_CURSOR_FAILED"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || rows.length >= limit) return resolve(rows);
      rows.push(cursor.value);
      cursor.continue();
    };
  });
}

function compoundRange(value) {
  return IDBKeyRange.bound([value, ""], [value, "\uffff"]);
}

async function indexedCandidates(store, filter, limit) {
  const reads = [];
  const boundedLimit = Math.max(1, Number(limit || 25));

  if (typeof filter === "string") {
    reads.push(cursorRows(store.index("byProcessTime"), compoundRange(filter), "prev", boundedLimit));
  } else if (filter && typeof filter === "object") {
    if (filter.processId) reads.push(cursorRows(store.index("byProcessTime"), compoundRange(String(filter.processId)), "prev", boundedLimit));
    if (filter.runId) reads.push(cursorRows(store.index("byRunTime"), compoundRange(String(filter.runId)), "prev", boundedLimit));
    if (filter.auditSessionId) reads.push(cursorRows(store.index("bySessionTime"), compoundRange(String(filter.auditSessionId)), "prev", boundedLimit));
    if (Number.isInteger(filter.windowId)) reads.push(cursorRows(store.index("byWindowTime"), compoundRange(filter.windowId), "prev", boundedLimit));
    if (filter.includeAppEvents) reads.push(cursorRows(store.index("byScopeTime"), compoundRange("APP"), "prev", boundedLimit));
  }

  if (!reads.length) {
    reads.push(cursorRows(store.index("byTimestamp"), null, "prev", boundedLimit));
  }

  return (await Promise.all(reads)).flat();
}

export async function readAudit(filter = null) {
  const requestedLimit = typeof filter === "object" && filter
    ? Number(filter.limit || 25)
    : 25;
  const limit = Math.max(1, Math.min(requestedLimit, MAX_PERSISTED_AUDIT_EVENTS));
  const db = await openDb();
  try {
    const tx = db.transaction(EVENT_STORE, "readonly");
    const store = tx.objectStore(EVENT_STORE);
    const candidates = await indexedCandidates(store, filter, limit);
    await txDone(tx);

    const unique = new Map();
    for (const row of candidates) {
      if (matchesFilter(row, filter)) unique.set(row.eventKey || row.eventId, row);
    }
    return [...unique.values()]
      .sort((a, b) => {
        const ta = Date.parse(a.timestamp || "") || 0;
        const tb = Date.parse(b.timestamp || "") || 0;
        return (ta - tb) || (Number(a.seq || 0) - Number(b.seq || 0));
      })
      .slice(-limit);
  } finally {
    db.close();
  }
}

export async function pruneAudit({
  maxEvents = MAX_PERSISTED_AUDIT_EVENTS,
  maxDeletes = 2500
} = {}) {
  const keep = Math.max(0, Number(maxEvents || 0));
  const deleteCap = Math.max(1, Number(maxDeletes || 1));
  const db = await openDb();
  try {
    const tx = db.transaction(EVENT_STORE, "readwrite");
    const store = tx.objectStore(EVENT_STORE);
    const index = store.index("byTimestamp");
    let seen = 0;
    let deleted = 0;

    await new Promise((resolve, reject) => {
      const request = index.openCursor(null, "prev");
      request.onerror = () => reject(request.error || new Error("AUDIT_PRUNE_CURSOR_FAILED"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || deleted >= deleteCap) return resolve();
        seen += 1;
        if (seen > keep) {
          store.delete(cursor.primaryKey);
          deleted += 1;
        }
        cursor.continue();
      };
    });
    await txDone(tx);
    return { deleted, maxEvents: keep, capped: deleted >= deleteCap };
  } finally {
    db.close();
  }
}

export async function auditAsNdjson(filter = null) {
  const effective = typeof filter === "object" && filter
    ? { ...filter, limit: Math.min(Number(filter.limit || MAX_PERSISTED_AUDIT_EVENTS), MAX_PERSISTED_AUDIT_EVENTS) }
    : { limit: MAX_PERSISTED_AUDIT_EVENTS };
  const rows = await readAudit(effective);
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}${rows.length ? "\n" : ""}`;
}
