import { nullableInteger } from "./common.mjs";
const SECRET_KEY_PATTERN = /(secret|token|password|credential|authorization|cookie|session[_-]?locator|lock[_-]?token|confirmation[_-]?token|private[_-]?key|api[_-]?key)/iu;
const BODY_KEY_PATTERN = /^(prompt|content|body|raw|responseText|sourceText|mandateText)$/iu;
const TRANSPORT_SECRET_PATTERN = /\b(?:Bearer\s+[A-Za-z0-9._~+\/=-]+|eicsl1\.[A-Za-z0-9._~-]+\.[A-Za-z0-9._~-]+)\b/giu;

export const APPLICATION_LOG_SCHEMA = "eic.autonom.application-log.v1";
export const APPLICATION_LOG_VERSION = 1;
export const APPLICATION_LOG_MAX_SEGMENTS = 6;
export const APPLICATION_LOG_MAX_ENTRIES_PER_SEGMENT = 120;
export const APPLICATION_LOG_MAX_SEGMENT_BYTES = 64 * 1024;
export const APPLICATION_LOG_MAX_SESSIONS = 12;
export const APPLICATION_LOG_SESSION_IDLE_MS = 30 * 60 * 1000;

function iso(now) {
  return new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()).toISOString();
}

function bytes(value) {
  const text = JSON.stringify(value);
  if (typeof TextEncoder === "function") return new TextEncoder().encode(text).byteLength;
  return text.length;
}

function cleanString(value, maxLength = 800) {
  return String(value ?? "")
    .replace(TRANSPORT_SECRET_PATTERN, "[REDACTED_TRANSPORT_SECRET]")
    .slice(0, maxLength);
}

export function sanitizeApplicationLogData(value, {
  depth = 0,
  maxDepth = 3
} = {}) {
  if (value === null || value === undefined) return null;
  if (depth > maxDepth) return "[TRUNCATED_DEPTH]";
  if (typeof value === "string") return cleanString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) =>
      sanitizeApplicationLogData(item, { depth: depth + 1, maxDepth })
    );
  }
  if (typeof value !== "object") return cleanString(value);

  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 24)) {
    const safeKey = cleanString(key, 120);
    if (SECRET_KEY_PATTERN.test(safeKey) || BODY_KEY_PATTERN.test(safeKey)) {
      result[safeKey] = "[REDACTED]";
      continue;
    }
    result[safeKey] = sanitizeApplicationLogData(item, {
      depth: depth + 1,
      maxDepth
    });
  }
  return result;
}

function sessionRecord(sessionId, appVersion, now) {
  return {
    sessionId: cleanString(sessionId, 160),
    appVersion: cleanString(appVersion, 40),
    startedAt: iso(now),
    lastSeenAt: iso(now),
    endedAt: null
  };
}

function segmentRecord(segmentId, sessionId, sequence, now) {
  return {
    segmentId: cleanString(segmentId, 160),
    sessionId: cleanString(sessionId, 160),
    sequence: Math.max(1, Number(sequence || 1)),
    startedAt: iso(now),
    endedAt: null,
    entryCount: 0,
    bytes: 0,
    entries: []
  };
}

export function createApplicationLog({
  appVersion,
  sessionId,
  segmentId,
  now = Date.now()
} = {}) {
  if (!sessionId || !segmentId) throw new Error("APPLICATION_LOG_ID_REQUIRED");
  return {
    schema: APPLICATION_LOG_SCHEMA,
    version: APPLICATION_LOG_VERSION,
    appVersion: cleanString(appVersion, 40),
    currentSessionId: cleanString(sessionId, 160),
    sessions: [sessionRecord(sessionId, appVersion, now)],
    segments: [segmentRecord(segmentId, sessionId, 1, now)],
    droppedSegments: 0,
    droppedEntries: 0,
    revision: 0,
    updatedAt: iso(now)
  };
}

function validLog(log) {
  return Boolean(
    log &&
    typeof log === "object" &&
    log.schema === APPLICATION_LOG_SCHEMA &&
    Number(log.version) === APPLICATION_LOG_VERSION &&
    Array.isArray(log.sessions) &&
    Array.isArray(log.segments)
  );
}

export function ensureApplicationLogSession(logValue, {
  appVersion,
  sessionId,
  segmentId,
  now = Date.now(),
  idleMs = APPLICATION_LOG_SESSION_IDLE_MS,
  forceNew = false
} = {}) {
  let log = validLog(logValue)
    ? structuredClone(logValue)
    : createApplicationLog({ appVersion, sessionId, segmentId, now });

  if (!validLog(logValue)) return { log, created: true, sessionStarted: true };

  const current = log.sessions.find((item) =>
    item.sessionId === log.currentSessionId
  );
  const lastSeenMs = Date.parse(current?.lastSeenAt || "");
  const idleExpired = Number.isFinite(lastSeenMs) &&
    Number(now) - lastSeenMs > Number(idleMs);
  const versionChanged = String(current?.appVersion || log.appVersion || "") !==
    String(appVersion || "");

  if (forceNew || !current || versionChanged || idleExpired) {
    if (!sessionId || !segmentId) throw new Error("APPLICATION_LOG_ID_REQUIRED");
    if (current && !current.endedAt) current.endedAt = iso(now);
    const next = sessionRecord(sessionId, appVersion, now);
    log.sessions = [...log.sessions, next].slice(-APPLICATION_LOG_MAX_SESSIONS);
    log.currentSessionId = next.sessionId;
    log.appVersion = next.appVersion;
    const sequence = Math.max(0, ...log.segments.map((item) => Number(item.sequence || 0))) + 1;
    log.segments.push(segmentRecord(segmentId, next.sessionId, sequence, now));
    log.updatedAt = iso(now);
    log.revision = Math.max(0, Number(log.revision || 0)) + 1;
    return { log, created: false, sessionStarted: true };
  }

  current.lastSeenAt = iso(now);
  log.updatedAt = iso(now);
  return { log, created: false, sessionStarted: false };
}

function normalizeEntry(input, {
  entryId,
  sessionId,
  appVersion,
  now
}) {
  return {
    entryId: cleanString(entryId, 160),
    at: iso(now),
    level: cleanString(input?.level || "info", 24),
    event: cleanString(input?.event || "application.event", 160),
    message: cleanString(input?.message || "", 1000),
    appSessionId: cleanString(sessionId, 160),
    appVersion: cleanString(appVersion, 40),
    agentVersion: cleanString(appVersion, 40),
    hostId: cleanString(input?.hostId || "", 160) || null,
    windowId: input?.windowId !== null && input?.windowId !== undefined &&
      nullableInteger(input.windowId) !== null
      ? Number(input.windowId)
      : null,
    tabId: input?.tabId !== null && input?.tabId !== undefined &&
      nullableInteger(input.tabId) !== null
      ? Number(input.tabId)
      : null,
    runId: cleanString(input?.runId || "", 160) || null,
    missionId: cleanString(input?.missionId || "", 160) || null,
    correlationId: cleanString(input?.correlationId || "", 160) || null,
    data: sanitizeApplicationLogData(input?.data || {})
  };
}

export function appendApplicationLog(logValue, input, {
  entryId,
  nextSegmentId,
  now = Date.now(),
  maxSegments = APPLICATION_LOG_MAX_SEGMENTS,
  maxEntriesPerSegment = APPLICATION_LOG_MAX_ENTRIES_PER_SEGMENT,
  maxSegmentBytes = APPLICATION_LOG_MAX_SEGMENT_BYTES
} = {}) {
  if (!validLog(logValue)) throw new Error("APPLICATION_LOG_INVALID");
  if (!entryId || !nextSegmentId) throw new Error("APPLICATION_LOG_ID_REQUIRED");

  const log = structuredClone(logValue);
  const session = log.sessions.find((item) =>
    item.sessionId === log.currentSessionId
  );
  if (!session) throw new Error("APPLICATION_LOG_SESSION_MISSING");
  session.lastSeenAt = iso(now);

  let segment = [...log.segments].reverse().find((item) =>
    item.sessionId === log.currentSessionId && !item.endedAt
  );
  if (!segment) {
    const sequence = Math.max(0, ...log.segments.map((item) => Number(item.sequence || 0))) + 1;
    segment = segmentRecord(nextSegmentId, log.currentSessionId, sequence, now);
    log.segments.push(segment);
  }

  const entry = normalizeEntry(input, {
    entryId,
    sessionId: log.currentSessionId,
    appVersion: session.appVersion,
    now
  });
  const projectedEntries = [...segment.entries, entry];
  const projectedBytes = bytes(projectedEntries);
  if (
    segment.entries.length >= maxEntriesPerSegment ||
    (segment.entries.length > 0 && projectedBytes > maxSegmentBytes)
  ) {
    segment.endedAt = iso(now);
    segment.entryCount = segment.entries.length;
    segment.bytes = bytes(segment.entries);
    const sequence = Math.max(0, ...log.segments.map((item) => Number(item.sequence || 0))) + 1;
    segment = segmentRecord(nextSegmentId, log.currentSessionId, sequence, now);
    log.segments.push(segment);
  }

  segment.entries.push(entry);
  segment.entryCount = segment.entries.length;
  segment.bytes = bytes(segment.entries);

  while (log.segments.length > maxSegments) {
    const removed = log.segments.shift();
    log.droppedSegments = Math.max(0, Number(log.droppedSegments || 0)) + 1;
    log.droppedEntries = Math.max(0, Number(log.droppedEntries || 0)) +
      Number(removed?.entryCount || removed?.entries?.length || 0);
  }

  log.revision = Math.max(0, Number(log.revision || 0)) + 1;
  log.updatedAt = iso(now);
  return { log, entry };
}

export function applicationLogForExport(logValue, {
  windowId = null
} = {}) {
  if (!validLog(logValue)) return null;
  const log = structuredClone(logValue);
  if (
    windowId !== null &&
    windowId !== undefined &&
    nullableInteger(windowId) !== null
  ) {
    const numericWindowId = nullableInteger(windowId);
    log.segments = log.segments
      .map((segment) => {
        const entries = (segment.entries || []).filter((entry) =>
          entry.windowId === null || Number(entry.windowId) === numericWindowId
        );
        return {
          ...segment,
          entries,
          entryCount: entries.length,
          bytes: bytes(entries)
        };
      })
      .filter((segment) => segment.entries.length > 0);
  }
  return log;
}

export function applicationLogSummary(logValue, {
  windowId = null
} = {}) {
  const exported = applicationLogForExport(logValue, { windowId });
  if (!exported) return null;
  const entryCount = exported.segments.reduce(
    (sum, segment) => sum + Number(segment.entryCount || 0),
    0
  );
  return {
    schema: "eic.autonom.application-log-summary.v1",
    version: 1,
    currentSessionId: exported.currentSessionId,
    sessionCount: exported.sessions.length,
    segmentCount: exported.segments.length,
    entryCount,
    droppedSegments: Number(exported.droppedSegments || 0),
    droppedEntries: Number(exported.droppedEntries || 0),
    updatedAt: exported.updatedAt
  };
}
