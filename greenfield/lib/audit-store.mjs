import {
  APP_VERSION,
  AUDIT_SCHEMA,
  AUDIT_DB_VERSION,
  MAX_AUDIT_TEXT_CHARS,
  MAX_PERSISTED_AUDIT_EVENTS
} from "./contracts.mjs";
import { bounded, errorRecord, nowIso, randomId } from "./common.mjs";
import { serializedUtf8Bytes, MAX_LOG_BYTES } from "./log-byte-budget.mjs";

const DB_NAME = "eic-autonom-agent-greenfield";
const DB_VERSION = AUDIT_DB_VERSION;
const EVENT_STORE = "auditEvents";
const COUNTER_STORE = "auditCounters";
export const AUDIT_MAX_LOG_BYTES = MAX_LOG_BYTES;
const FIFO_COUNTER_KEY = '__global-audit-fifo-bytes-v1__';
let runtimeSequence = 0;
// Local journal operations should finish within one watchdog interval. Five
// seconds is a product deadline, not a claim of a universal IndexedDB default.
export const AUDIT_IO_TIMEOUT_MS = 5000;

function ensureIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
}

function openDb() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error("AUDIT_DB_OPEN_TIMEOUT")); }, AUDIT_IO_TIMEOUT_MS);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (settled) { request.transaction.abort(); return; }
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
    request.onerror = () => { clearTimeout(timer); if (!settled) { settled = true; reject(request.error || new Error("AUDIT_DB_OPEN_FAILED")); } };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) { request.result.close(); return; }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { tx.abort(); } catch {}
      reject(new Error("AUDIT_TX_TIMEOUT"));
    }, AUDIT_IO_TIMEOUT_MS);
    tx.oncomplete = () => { clearTimeout(timer); resolve(); };
    tx.onerror = () => { clearTimeout(timer); reject(tx.error || new Error("AUDIT_TX_FAILED")); };
    tx.onabort = () => { clearTimeout(timer); reject(tx.error || new Error("AUDIT_TX_ABORTED")); };
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

// Insertion and oldest-first evictions share one IndexedDB transaction: a
// crash cannot leave an unbounded journal or a mismatched byte count. The
// metadata is recalculated after older extension versions/prune paths.
export async function writeAuditEvent(event) {
  const db = await openDb();
  try {
    const tx = db.transaction([EVENT_STORE, COUNTER_STORE], "readwrite");
    const store = tx.objectStore(EVENT_STORE);
    const counters = tx.objectStore(COUNTER_STORE);
    const done = txDone(tx);
    let previousEvent, previousCounter, hasEvent = false, hasCounter = false;
    const fail = () => { try { tx.abort(); } catch {} };
    const schedulePrune = (knownTotal = null) => {
      let total = Number(knownTotal);
      let recalculating = knownTotal === null;
      const cursor = store.index('byTimestamp').openCursor(null, 'next');
      const entries = [];
      cursor.onerror = fail;
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (row) {
          const size = serializedUtf8Bytes(row.value);
          if (recalculating) entries.push({ key:row.primaryKey, size });
          else if (total > AUDIT_MAX_LOG_BYTES) {
            row.delete();
            total -= size;
          }
          row.continue();
          return;
        }
        if (recalculating) {
          total = entries.reduce((sum, entry) => sum + entry.size, 0);
          for (const entry of entries) {
            if (total <= AUDIT_MAX_LOG_BYTES) break;
            store.delete(entry.key);
            total -= entry.size;
          }
        }
        counters.put({ processId:FIFO_COUNTER_KEY, totalBytes:Math.max(0,total),
          format:'JSON_UTF8', budgetBytes:AUDIT_MAX_LOG_BYTES });
      };
    };
    const begin = () => {
      if (!hasEvent || !hasCounter) return;
      store.put(event);
      const bytes = serializedUtf8Bytes(event);
      const prior = previousEvent ? serializedUtf8Bytes(previousEvent) : 0;
      const counterValid = Number.isFinite(Number(previousCounter?.totalBytes)) &&
        previousCounter?.format === 'JSON_UTF8' && previousCounter.budgetBytes === AUDIT_MAX_LOG_BYTES;
      schedulePrune(counterValid ? Math.max(0, Number(previousCounter.totalBytes) + bytes - prior) : null);
    };
    const existing = store.get(event.eventKey);
    existing.onerror = fail;
    existing.onsuccess = () => { previousEvent = existing.result; hasEvent = true; begin(); };
    const metadata = counters.get(FIFO_COUNTER_KEY);
    metadata.onerror = fail;
    metadata.onsuccess = () => { previousCounter = metadata.result; hasCounter = true; begin(); };
    await done;
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
  // {limit} and {since} are global queries, not an empty owner predicate.
  return !processId && !runId && !auditSessionId && !Number.isInteger(windowId);
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
    const done = txDone(tx);
    const candidates = await Promise.race([indexedCandidates(store, filter, limit), done.then(() => [])]);
    await done;

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
    const tx = db.transaction([EVENT_STORE, COUNTER_STORE], "readwrite");
    const store = tx.objectStore(EVENT_STORE);
    tx.objectStore(COUNTER_STORE).delete(FIFO_COUNTER_KEY);
    const index = store.index("byTimestamp");
    let seen = 0;
    let deleted = 0;

    const done = txDone(tx);
    await Promise.race([new Promise((resolve, reject) => {
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
    }), done]);
    await done;
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
