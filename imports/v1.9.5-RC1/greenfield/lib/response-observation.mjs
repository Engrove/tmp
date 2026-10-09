// v1.8.2 response observation safeguards.
//
// 1. Structural completeness. A live diagnostics export (2026-09-24) showed 45
//    of 78 recorded turns captured as a few characters of a JSON response that
//    was still being written ("{", "{\"", "{\n\"schema\": "), after 5-30 min:
//    Greenfield's generation signal was false and the stability window
//    admitted the prefix. An EIC A2A response is a JSON object, so an object
//    that has been opened but not closed is by construction unfinished and is
//    never admitted as a completed response. Replayed against that export: all
//    17 short captures are held and all 9 full answers pass.
//    Greenfield keeps waiting; the 30/60/90/120-minute stale ladder remains the
//    bound. This depends only on the response text, not on ChatGPT DOM details.
//
// 2. Durable observation trace. With Persistent Audit off, the reason a
//    response was held was only in a 25-event memory FIFO and the queue park
//    cleared the last candidate state, so an export could not show why a
//    completed answer was never admitted. The trace is a bounded ring kept in
//    process state (and therefore in the parked processSnapshot and in the
//    diagnostics export). It holds ids, lengths and reasons, never response text.

// Bounded for storage: a full live ring is ~10 KB, a parked snapshot keeps the
// most recent entries only (snapshots are copied to duplicate slots and to the
// checkpoint slots).
export const RESPONSE_TRACE_MAX = 16;
export const RESPONSE_TRACE_PARKED_MAX = 8;
export const RESPONSE_TRACE_REFRESH_MS = 60_000;
export const STRUCTURAL_INCOMPLETE = Object.freeze({
  UNTERMINATED_JSON_OBJECT: "UNTERMINATED_JSON_OBJECT"
});

const LEADING_LABEL_RE = /^(?:```\s*json|```|json)\s*(?=\{)/i;
// First JSON object with a string key anywhere in the text. The live export
// also held answers where an attachment chip ("…v2.jsonFil", "…pdfPDF")
// preceded the streaming object, so the object need not lead the text.
const KEYED_OBJECT_RE = /\{\s*"/;
const TRAILING_BRACE_RE = /\{\s*$/;

// Scan one JSON value starting at `start` ("{"). Returns the index after the
// closing brace, or -1 when the text ends before the object is closed.
function closingIndex(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Is this assistant text structurally finished?
 *  - text that starts (after an optional "JSON"/```json code-block label) with
 *    "{" must contain that object's closing brace;
 *  - the first keyed JSON object ({"...) anywhere in the text must be closed;
 *  - a text that ends with an opening brace is unfinished.
 * Prose, closed JSON and closed JSON followed by prose are complete.
 */
export function responseStructuralCompleteness(value) {
  const raw = String(value ?? "");
  const trimmed = raw.replace(/^\s+/, "");
  const body = trimmed.replace(LEADING_LABEL_RE, "");
  const starts = [];
  if (body.startsWith("{")) starts.push(raw.length - body.length);
  for (const re of [KEYED_OBJECT_RE, TRAILING_BRACE_RE]) {
    const match = re.exec(raw);
    if (match && !starts.includes(match.index)) starts.push(match.index);
  }
  for (const start of starts) {
    if (closingIndex(raw, start) < 0) {
      return {
        complete: false,
        reason: STRUCTURAL_INCOMPLETE.UNTERMINATED_JSON_OBJECT,
        jsonStart: start,
        textLength: raw.length
      };
    }
  }
  return { complete: true, reason: "", jsonStart: starts.length ? starts[0] : -1, textLength: raw.length };
}

function bounded(value, max = 120) {
  return String(value ?? "").slice(0, max);
}

function num(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

/**
 * Closed, bounded detail record built from a page observation. Only ids,
 * lengths, flags and short hashes: never assistant or user text.
 */
export function responseTraceDetail(page = {}, extra = {}) {
  const auto = page?.autonomousTurn && typeof page.autonomousTurn === "object" ? page.autonomousTurn : {};
  const full = {
    documentId: bounded(page?.documentId, 80),
    pageGenerating: page?.generating === true,
    pageUserCount: num(page?.userCount),
    pageAssistantCount: num(page?.assistantCount),
    pageLastUserId: bounded(page?.lastUserId, 80),
    pageLastAssistantId: bounded(page?.lastAssistantId, 80),
    pageAssistantHash: bounded(page?.assistantHash, 12),
    expectedUserTurnId: bounded(auto.expectedUserTurnId, 80),
    resolvedUserTurnId: bounded(auto.resolvedUserTurnId, 80),
    resolvedBy: bounded(auto.resolvedBy, 40),
    assistantFound: auto.assistantFound === true,
    assistantId: bounded(auto.assistantId, 80),
    assistantHash: bounded(auto.assistantHash, 12),
    assistantTextLength: num(auto.assistantTextLength),
    assistantGenerating: auto.assistantGenerating === true,
    ownerKind: bounded(auto.assistantOwnerKind, 40),
    ownerTrusted: auto.assistantOwnerTrusted === true,
    replicaCount: num(auto.assistantReplicaCount),
    nextUserTurnId: bounded(auto.nextUserTurnId, 80),
    responseSlotClosed: auto.responseSlotClosed === true,
    visibilityState: bounded(page?.signals?.visibilityState, 20),
    ...Object.fromEntries(Object.entries(extra || {}).map(([key, value]) => [
      bounded(key, 40),
      typeof value === "number" || typeof value === "boolean" || value === null ? value : bounded(value, 160)
    ]))
  };
  // Compact: an absent field means empty/false/null. Numbers (including 0) and
  // true flags are kept because they carry the evidence.
  return Object.fromEntries(Object.entries(full).filter(([, value]) =>
    value !== "" && value !== null && value !== false && value !== undefined));
}

/** Keep only the newest entries (used when a process is parked in a queue slot). */
export function trimResponseTrace(trace, max = RESPONSE_TRACE_PARKED_MAX) {
  return Array.isArray(trace) ? trace.slice(-Math.max(0, max)) : [];
}

function signature(entry) {
  const d = entry.detail || {};
  // Hashes and lengths change on every streamed chunk; they are detail, not
  // identity, so a streaming answer does not cause a write per tick.
  return [entry.reason, entry.turn, entry.promptHash, d.expectedUserTurnId, d.resolvedUserTurnId, d.assistantId, d.assistantGenerating, d.pageGenerating].join("|");
}

/**
 * Append or refresh a trace entry. Returns { trace, changed }: changed is true
 * when the entry is new (different reason/identity) or an unchanged entry is
 * refreshed after refreshMs; callers persist only when changed.
 */
export function appendResponseTrace(trace, { reason, turn = 0, promptHash = "", detail = {} } = {}, {
  now = Date.now(),
  refreshMs = RESPONSE_TRACE_REFRESH_MS,
  max = RESPONSE_TRACE_MAX
} = {}) {
  const rows = Array.isArray(trace) ? trace.slice(-max) : [];
  const entry = {
    reason: bounded(reason, 96),
    turn: Number(turn) || 0,
    promptHash: bounded(promptHash, 16),
    firstAt: new Date(Number(now)).toISOString(),
    lastAt: new Date(Number(now)).toISOString(),
    count: 1,
    detail: detail && typeof detail === "object" ? detail : {}
  };
  const last = rows[rows.length - 1];
  if (last && signature(last) === signature(entry)) {
    if (Number(now) - Date.parse(last.lastAt || last.firstAt || 0) < refreshMs) {
      return { trace: rows, changed: false };
    }
    const refreshed = { ...last, lastAt: entry.lastAt, count: Number(last.count || 1) + 1, detail: entry.detail };
    return { trace: [...rows.slice(0, -1), refreshed], changed: true };
  }
  return { trace: [...rows, entry].slice(-max), changed: true };
}
