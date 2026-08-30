import { nowIso, nullableInteger, randomId, sanitizeText, stableStringify } from "./common.mjs";
import { sanitizeApplicationLogData } from "./application-log.mjs";
import { APP_VERSION } from "./contracts.mjs";

export const FULL_AUDIT_QUEUE_SCHEMA = "eic.autonom.full-audit-queue.v1";
export const FULL_AUDIT_SINK_SCHEMA = "eic.autonom.full-audit-sink.v1";
export const FULL_AUDIT_MAX_QUEUE_ENTRIES = 2000;
export const FULL_AUDIT_MAX_BATCH_ENTRIES = 200;
export const FULL_AUDIT_MAX_SEGMENT_BYTES = 4 * 1024 * 1024;
export const FULL_AUDIT_MAX_SEGMENTS = 8;

function byteLength(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return typeof TextEncoder === "function"
    ? new TextEncoder().encode(text).byteLength
    : text.length;
}

export function createFullAuditQueue() {
  return {
    schema: FULL_AUDIT_QUEUE_SCHEMA,
    version: 1,
    nextSequence: 1,
    entries: [],
    droppedEntries: 0,
    updatedAt: nowIso()
  };
}

export function normalizeFullAuditQueue(value) {
  const queue = value?.schema === FULL_AUDIT_QUEUE_SCHEMA
    ? structuredClone(value)
    : createFullAuditQueue();
  queue.schema = FULL_AUDIT_QUEUE_SCHEMA;
  queue.version = 1;
  queue.nextSequence = Math.max(1, Number(queue.nextSequence || 1));
  queue.entries = Array.isArray(queue.entries) ? queue.entries.slice(-FULL_AUDIT_MAX_QUEUE_ENTRIES) : [];
  queue.droppedEntries = Math.max(0, Number(queue.droppedEntries || 0));
  queue.updatedAt ||= nowIso();
  return queue;
}

export function createFullAuditEntry({
  level = "info",
  event = "audit.event",
  message = "",
  windowId = null,
  tabId = null,
  runId = null,
  missionId = null,
  correlationId = null,
  data = {},
  at = nowIso()
} = {}) {
  return {
    schema: "eic.autonom.full-audit-entry.v1",
    entryId: randomId("full-audit"),
    at: sanitizeText(at, 80) || nowIso(),
    appVersion: APP_VERSION,
    agentVersion: APP_VERSION,
    level: sanitizeText(level, 24) || "info",
    event: sanitizeText(event, 180) || "audit.event",
    message: sanitizeText(message, 1600),
    windowId: nullableInteger(windowId) !== null ? Number(windowId) : null,
    tabId: nullableInteger(tabId) !== null ? Number(tabId) : null,
    runId: sanitizeText(runId, 180) || null,
    missionId: sanitizeText(missionId, 180) || null,
    correlationId: sanitizeText(correlationId, 240) || null,
    data: sanitizeApplicationLogData(data, { maxDepth: 5 })
  };
}

export function appendFullAuditEntries(queueValue, entries = [], {
  maxEntries = FULL_AUDIT_MAX_QUEUE_ENTRIES
} = {}) {
  const queue = normalizeFullAuditQueue(queueValue);
  for (const entryValue of entries) {
    const entry = createFullAuditEntry(entryValue);
    entry.sequence = queue.nextSequence++;
    queue.entries.push(entry);
  }
  while (queue.entries.length > maxEntries) {
    queue.entries.shift();
    queue.droppedEntries += 1;
  }
  queue.updatedAt = nowIso();
  return queue;
}

export function fullAuditBatch(queueValue, {
  limit = FULL_AUDIT_MAX_BATCH_ENTRIES
} = {}) {
  const queue = normalizeFullAuditQueue(queueValue);
  const entries = queue.entries.slice(0, Math.max(1, Math.min(FULL_AUDIT_MAX_BATCH_ENTRIES, Number(limit || 1))));
  return {
    schema: "eic.autonom.full-audit-batch.v1",
    entries,
    firstSequence: entries[0]?.sequence || null,
    lastSequence: entries.at(-1)?.sequence || null,
    droppedEntries: queue.droppedEntries,
    digestInput: stableStringify(entries),
    updatedAt: queue.updatedAt
  };
}

export function acknowledgeFullAuditBatch(queueValue, lastSequence) {
  const queue = normalizeFullAuditQueue(queueValue);
  const sequence = Number(lastSequence);
  if (!Number.isInteger(sequence) || sequence <= 0) return queue;
  queue.entries = queue.entries.filter((entry) => Number(entry.sequence || 0) > sequence);
  queue.updatedAt = nowIso();
  return queue;
}

export function fullAuditNdjson(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => JSON.stringify(entry))
    .join("\n") + (entries.length ? "\n" : "");
}

export function fullAuditSegmentName({
  appVersion = "unknown",
  sessionId = "session",
  sequence = 1,
  at = Date.now()
} = {}) {
  const stamp = new Date(at).toISOString().replace(/[:.]/g, "-");
  const safeSession = sanitizeText(sessionId, 80).replace(/[^A-Za-z0-9._-]/g, "_") || "session";
  return `eic-autonom-agent-v${sanitizeText(appVersion, 40)}-${safeSession}-${String(sequence).padStart(4, "0")}-${stamp}.ndjson`;
}

export function validateFullAuditDirectoryName(name) {
  const normalized = String(name || "").trim();
  if (!normalized || normalized.length > 240) return false;
  // File System Access intentionally exposes only the selected handle's basename.
  // Validate a safe existing directory handle name, never pretend this proves an
  // absolute Windows path such as C:\\temp.
  return !/[\\/\0]/u.test(normalized) && normalized !== "." && normalized !== "..";
}

export function isFullAuditSegmentName(name) {
  return /^eic-autonom-agent-v\d+\.\d+\.\d+-.*\.ndjson$/u.test(String(name || ""));
}

export function fullAuditSinkStatus({
  enabled = false,
  handleGranted = false,
  directoryName = "",
  writeProbeVerified = false,
  writeProbeAt = null,
  writeProbeBytes = 0,
  lastFlushAt = null,
  lastError = "",
  segmentSequence = 1,
  segmentBytes = 0,
  segmentName = ""
} = {}) {
  return {
    schema: FULL_AUDIT_SINK_SCHEMA,
    version: 1,
    enabled: Boolean(enabled),
    handleGranted: Boolean(handleGranted),
    directoryName: sanitizeText(directoryName, 260),
    targetHint: "Operator-selected existing audit directory (C:\\temp is recommended, not path-verifiable in-browser)",
    claimBoundary: "Verified permission plus write/readback proves the selected directory handle is writable. Browser File System Access does not expose or prove its absolute Windows path.",
    writeProbeVerified: Boolean(writeProbeVerified),
    writeProbeAt: writeProbeAt ? sanitizeText(writeProbeAt, 80) : null,
    writeProbeBytes: Math.max(0, Number(writeProbeBytes || 0)),
    lastFlushAt: lastFlushAt ? sanitizeText(lastFlushAt, 80) : null,
    lastError: sanitizeText(lastError, 1000),
    segmentSequence: Math.max(1, Number(segmentSequence || 1)),
    segmentBytes: Math.max(0, Number(segmentBytes || 0)),
    segmentName: sanitizeText(segmentName, 300),
    maxSegmentBytes: FULL_AUDIT_MAX_SEGMENT_BYTES,
    maxSegments: FULL_AUDIT_MAX_SEGMENTS,
    updatedAt: nowIso()
  };
}

export function projectedSegmentBytes(currentBytes, entries = []) {
  return Math.max(0, Number(currentBytes || 0)) + byteLength(fullAuditNdjson(entries));
}
