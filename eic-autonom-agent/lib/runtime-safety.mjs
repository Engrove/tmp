import { normalizeWhitespace, sanitizeText } from "./common.mjs";
import { isMetaOnlyAction } from "./decision-grounding.mjs";

export const MAX_RECOVERY_ATTEMPTS = 40;
export const MAX_EFFECT_JOURNAL = 12;
export const MAX_SEEN_USER_TURN_IDS = 128;
export const MAX_SEEN_USER_MESSAGE_HASHES = 128;

export function mergeSeenUserTurnIds(...collections) {
  const seen = new Set();
  const result = [];
  for (const collection of collections) {
    for (const value of Array.isArray(collection) ? collection : []) {
      const id = sanitizeText(value, 180);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
  }
  return result.slice(-MAX_SEEN_USER_TURN_IDS);
}

export function mergeSeenUserMessageHashes(...collections) {
  const seen = new Set();
  const result = [];
  for (const collection of collections) {
    for (const value of Array.isArray(collection) ? collection : []) {
      const hash = sanitizeText(value, 128).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash) || seen.has(hash)) continue;
      seen.add(hash);
      result.push(hash);
    }
  }
  return result.slice(-MAX_SEEN_USER_MESSAGE_HASHES);
}

export function appendRecoveryAttempt(run, attempt, max = MAX_RECOVERY_ATTEMPTS) {
  run.recovery ||= { attempts: [] };
  run.recovery.attempts = [...(run.recovery.attempts || []), attempt].slice(-max);
  return run;
}

export function compactEffectJournal(entries, activeTurnId = "", max = MAX_EFFECT_JOURNAL) {
  return (Array.isArray(entries) ? entries : []).slice(-max).map((entry) => {
    const copy = { ...entry };
    if (copy.turnId !== activeTurnId) delete copy.prompt;
    return copy;
  });
}

export function classifyConversationLocatorChange(currentValue, nextValue) {
  const current = sanitizeText(currentValue, 1200);
  const next = sanitizeText(nextValue, 1200);
  if (!next || next === current) return { kind: "UNCHANGED", next: current || next };
  if (!current) return { kind: "BIND", next };
  const sameHost = current.split(":")[0] && current.split(":")[0] === next.split(":")[0];
  const promotable = sameHost &&
    (current.endsWith(":/") || current.includes(":g:")) &&
    next.includes(":c:");
  return promotable
    ? { kind: "PROMOTION", next }
    : { kind: "MISMATCH", next };
}

export function shouldPauseForLoop(loopCorrection) {
  return Boolean(loopCorrection?.triggered &&
    ["STOP_META_LOOP", "PRODUCE_SMALLEST_DELIVERABLE", "STOP_REAUDITING", "REDUCE_SCOPE"].includes(loopCorrection.code));
}

export function normalizeBackgroundAction(value) {
  const action = String(value || "PAUSE").toUpperCase();
  return ["CONTINUE", "DONE", "PAUSE"].includes(action) ? action : "PAUSE";
}

export function isSubstantiveAction(value) {
  const text = normalizeWhitespace(value);
  return Boolean(text && !isMetaOnlyAction(text));
}


export function acquireNanoDispatchLock(state, requestId, token) {
  if (!state || !requestId || !token) return false;
  if (state.modelBusy || state.activeNanoRequestId || state.activeNanoInvocationToken) return false;
  state.modelBusy = true;
  state.activeNanoRequestId = requestId;
  state.activeNanoInvocationToken = token;
  return true;
}

export function releaseNanoDispatchLock(state, token) {
  if (!state || !token || state.activeNanoInvocationToken !== token) return false;
  state.activeNanoInvocationToken = null;
  state.activeNanoRequestId = null;
  state.modelBusy = false;
  return true;
}

export function resolveLifecycleDeadlineExtension({
  gapMs = 0,
  responseTimeoutMs = 0,
  alreadyExtendedMs = 0,
  thresholdMs = 180_000,
  graceMs = 30_000,
  absoluteCapMs = 300_000,
  timeoutFraction = 0.1
} = {}) {
  const gap = Math.max(0, Number(gapMs) || 0);
  const already = Math.max(0, Number(alreadyExtendedMs) || 0);
  const timeout = Math.max(0, Number(responseTimeoutMs) || 0);
  const cap = Math.max(0, Math.min(
    Number(absoluteCapMs) || 0,
    timeout > 0 ? timeout * Math.max(0, Number(timeoutFraction) || 0) : Number(absoluteCapMs) || 0
  ));
  const requested = gap > Math.max(0, Number(thresholdMs) || 0)
    ? Math.max(0, gap - Math.max(0, Number(graceMs) || 0))
    : 0;
  const remaining = Math.max(0, cap - already);
  const applied = Math.min(requested, remaining);
  return {
    requestedMs: requested,
    appliedMs: applied,
    priorExtensionMs: already,
    totalExtensionMs: already + applied,
    capMs: cap,
    capped: requested > applied
  };
}
