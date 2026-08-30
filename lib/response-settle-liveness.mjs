import { nullableInteger, sanitizeText } from "./common.mjs";

export const RESPONSE_SETTLE_FAILURE_CODE = "RESPONSE_SETTLE_LIVENESS_TIMEOUT";
export const RESPONSE_SETTLE_MAX_AGE_MS = 60_000;
export const RESPONSE_SETTLE_ALARM_PREFIX = "eic-autonom-agent-response-settle-v1200:";

function iso(value) {
  return new Date(value).toISOString();
}

function parsedAt(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function responseSettleAlarmName(windowId) {
  const numeric = nullableInteger(windowId);
  return `${RESPONSE_SETTLE_ALARM_PREFIX}${numeric === null ? "invalid" : numeric}`;
}

export function responseSettleAlarmWindowId(name = "") {
  const text = String(name || "");
  if (!text.startsWith(RESPONSE_SETTLE_ALARM_PREFIX)) return null;
  return nullableInteger(text.slice(RESPONSE_SETTLE_ALARM_PREFIX.length));
}

export function bindResponseSettleCandidate(candidateValue, {
  now = Date.now(),
  maxAgeMs = RESPONSE_SETTLE_MAX_AGE_MS
} = {}) {
  if (!candidateValue || typeof candidateValue !== "object") return null;
  const firstSeenAt = parsedAt(candidateValue.firstSeenAt);
  const base = Number.isFinite(firstSeenAt) ? firstSeenAt : Number(now);
  const configuredMax = Math.max(5_000, Number(maxAgeMs) || RESPONSE_SETTLE_MAX_AGE_MS);
  const existingDeadline = parsedAt(candidateValue.settleDeadlineAt);
  const settleDeadlineAt = Number.isFinite(existingDeadline)
    ? existingDeadline
    : base + configuredMax;
  return {
    ...candidateValue,
    settleDeadlineAt: iso(settleDeadlineAt)
  };
}

export function responseSettleCandidateIdentity(candidate = {}) {
  return [
    sanitizeText(candidate?.hash, 128),
    sanitizeText(candidate?.documentEpoch, 240)
  ].join("|");
}

export function pageResponseCandidateIdentity(page = {}) {
  return [
    sanitizeText(page?.latestAssistantHash, 128),
    sanitizeText(page?.documentEpoch, 240)
  ].join("|");
}

export function evaluateResponseSettleLiveness(candidateValue, page = {}, {
  now = Date.now(),
  maxAgeMs = RESPONSE_SETTLE_MAX_AGE_MS
} = {}) {
  const candidate = bindResponseSettleCandidate(candidateValue, { now, maxAgeMs });
  if (!candidate) {
    return {
      candidate: null,
      sameCandidate: false,
      overdue: false,
      ageMs: 0,
      deadlineAt: "",
      code: ""
    };
  }
  const sameCandidate = Boolean(
    sanitizeText(candidate.hash, 128) &&
    responseSettleCandidateIdentity(candidate) === pageResponseCandidateIdentity(page)
  );
  const first = parsedAt(candidate.firstSeenAt);
  const deadline = parsedAt(candidate.settleDeadlineAt);
  const ageMs = Number.isFinite(first) ? Math.max(0, Number(now) - first) : 0;
  const overdue = Boolean(
    sameCandidate &&
    Number.isFinite(deadline) &&
    Number(now) >= deadline
  );
  return {
    candidate,
    sameCandidate,
    overdue,
    ageMs,
    deadlineAt: Number.isFinite(deadline) ? iso(deadline) : "",
    code: overdue ? RESPONSE_SETTLE_FAILURE_CODE : ""
  };
}

export function responseSettleWakePlan(candidateValue, {
  now = Date.now(),
  defaultDelayMs = 1_500,
  minDelayMs = 100,
  maxDelayMs = 10_000
} = {}) {
  const candidate = bindResponseSettleCandidate(candidateValue, { now });
  if (!candidate) {
    return { due: false, delayMs: 0, nextProbeAt: "", deadlineAt: "" };
  }
  const requestedAt = parsedAt(candidate.nextProbeAt);
  const delay = Number.isFinite(requestedAt)
    ? requestedAt - Number(now)
    : Number(defaultDelayMs);
  const bounded = Math.max(
    Number(minDelayMs) || 100,
    Math.min(Number(maxDelayMs) || 10_000, Number.isFinite(delay) ? delay : Number(defaultDelayMs))
  );
  return {
    due: !Number.isFinite(requestedAt) || requestedAt <= Number(now),
    delayMs: bounded,
    nextProbeAt: Number.isFinite(requestedAt) ? iso(requestedAt) : iso(Number(now) + bounded),
    deadlineAt: candidate.settleDeadlineAt || ""
  };
}

export function authoritativeTerminalResponse(page = {}) {
  const foreground = page?.foregroundSignals || {};
  const background = page?.backgroundSignals || {};
  return Boolean(
    foreground?.trusted === true &&
    foreground?.sourceClass === "TRUSTED_PAGE_CHROME" &&
    foreground?.protocolCompletionOverride === true &&
    foreground?.streamingAssistant !== true &&
    foreground?.composerBusy !== true &&
    background?.active !== true &&
    background?.cancelled !== true &&
    background?.error !== true &&
    String(page?.latestMessageRole || "").toLowerCase() === "assistant" &&
    sanitizeText(page?.latestAssistantHash, 128)
  );
}


export function responseSettlePriorityPlan(candidateValue, page = {}, {
  now = Date.now(),
  maxAgeMs = RESPONSE_SETTLE_MAX_AGE_MS
} = {}) {
  const evaluation = evaluateResponseSettleLiveness(candidateValue, page, { now, maxAgeMs });
  const wake = responseSettleWakePlan(evaluation.candidate, { now });
  const authoritative = authoritativeTerminalResponse(page);
  return {
    candidate: evaluation.candidate,
    sameCandidate: evaluation.sameCandidate,
    authoritative,
    due: Boolean(evaluation.sameCandidate && wake.due),
    overdue: evaluation.overdue,
    priority: Boolean(
      evaluation.sameCandidate &&
      authoritative &&
      (wake.due || evaluation.overdue)
    ),
    deadlineAt: evaluation.deadlineAt,
    nextProbeAt: wake.nextProbeAt,
    ageMs: evaluation.ageMs
  };
}

export function responseSettleFailureRecord(candidateValue, page = {}, {
  now = Date.now(),
  reason = ""
} = {}) {
  const evaluation = evaluateResponseSettleLiveness(candidateValue, page, { now });
  if (!evaluation.overdue) return null;
  return {
    schema: "eic.autonom.response-settle-failure.v1",
    code: RESPONSE_SETTLE_FAILURE_CODE,
    responseHash: sanitizeText(page?.latestAssistantHash || candidateValue?.hash, 128),
    documentEpoch: sanitizeText(page?.documentEpoch || candidateValue?.documentEpoch, 240),
    stableReads: Math.max(0, Number(candidateValue?.stableReads || 0)),
    firstSeenAt: sanitizeText(candidateValue?.firstSeenAt, 80),
    nextProbeAt: sanitizeText(candidateValue?.nextProbeAt, 80),
    deadlineAt: evaluation.deadlineAt,
    ageMs: evaluation.ageMs,
    reason: sanitizeText(reason || "Assistant response remained unsettled beyond the bounded owner-observation window.", 800),
    detectedAt: iso(now)
  };
}
