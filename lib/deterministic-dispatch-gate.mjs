import { deepClone, nowIso } from "./common.mjs";

export const DETERMINISTIC_CALLBACK_LEASE_MS = 15_000;
export const DETERMINISTIC_CALLBACK_MAX_ATTEMPTS = 2;

/**
 * v0.10.11: how many times a *whole* dispatch generation may be re-armed after
 * the application step threw before it persisted anything.
 *
 * v0.10.10 applied the decision from a detached `setTimeout` callback whose
 * rejection went to `console.warn`, so the two lease attempts were two identical
 * replays of an invisible failure and the source was burned 52 s later. The
 * decision is applied in-band from v0.10.11, so a throw is observed
 * immediately; each re-arm therefore rebuilds the decision and re-reads the
 * page instead of replaying the same generation.
 */
export const DETERMINISTIC_CALLBACK_MAX_REARMS = 2;

export const DETERMINISTIC_GATE_ACTIONS = Object.freeze({
  SCHEDULE: "SCHEDULE",
  WAIT: "WAIT",
  RECOVER: "RECOVER"
});

/**
 * Pure state gate for a DETERMINISTIC_PENDING callback.
 *
 * The caller must persist the DISPATCHED state before scheduling the callback.
 * While a lease is live, any watchdog/content/panel tick must return without a
 * durable write. After the final expired attempt, the source is exhausted and
 * the caller must move to bounded reconciliation.
 */
export function evaluateDeterministicDispatch(requestValue = {}, {
  now = Date.now(),
  leaseMs = DETERMINISTIC_CALLBACK_LEASE_MS,
  maxAttempts = DETERMINISTIC_CALLBACK_MAX_ATTEMPTS
} = {}) {
  const request = requestValue || {};
  const state = String(request.deterministicDispatchState || "ARMED");
  const attempts = Math.max(0, Number(request.deterministicDispatchAttempts || 0));
  const scheduledAtMs = Date.parse(request.deterministicScheduledAt || "");
  const leaseAgeMs = Number.isFinite(scheduledAtMs)
    ? Math.max(0, Number(now) - scheduledAtMs)
    : Number.POSITIVE_INFINITY;

  if (state === "DISPATCHED" && Number.isFinite(scheduledAtMs) && leaseAgeMs < leaseMs) {
    return {
      action: DETERMINISTIC_GATE_ACTIONS.WAIT,
      state,
      attempts,
      leaseAgeMs,
      leaseRemainingMs: Math.max(0, leaseMs - leaseAgeMs),
      reason: "CALLBACK_LEASE_ACTIVE"
    };
  }

  if (state === "DISPATCHED" && attempts >= maxAttempts) {
    return {
      action: DETERMINISTIC_GATE_ACTIONS.RECOVER,
      state,
      attempts,
      leaseAgeMs,
      leaseRemainingMs: 0,
      reason: "CALLBACK_ATTEMPTS_EXHAUSTED"
    };
  }

  return {
    action: DETERMINISTIC_GATE_ACTIONS.SCHEDULE,
    state,
    attempts,
    leaseAgeMs,
    leaseRemainingMs: 0,
    reason: state === "DISPATCHED"
      ? "CALLBACK_LEASE_EXPIRED_RETRY"
      : "CALLBACK_ARMED"
  };
}

export function prepareDeterministicDispatch(requestValue = {}, {
  decisionDigest = "",
  now = Date.now()
} = {}) {
  const request = deepClone(requestValue || {});
  return {
    ...request,
    deterministicScheduledAt: nowIso(now),
    deterministicDecisionDigest: String(decisionDigest || ""),
    deterministicDispatchState: "DISPATCHED",
    deterministicDispatchAttempts: Math.max(
      0,
      Number(request.deterministicDispatchAttempts || 0)
    ) + 1
  };
}


/**
 * Re-arm a dispatch generation whose in-band application threw before it
 * persisted anything. The requestId is deliberately preserved so telemetry and
 * audit stay bound to the same logical request; only the dispatch bookkeeping
 * is reset, which makes `evaluateDeterministicDispatch` return SCHEDULE again.
 */
export function rearmDeterministicDispatch(requestValue = {}) {
  const request = deepClone(requestValue || {});
  return {
    ...request,
    deterministicScheduledAt: null,
    deterministicDecisionDigest: "",
    deterministicDispatchState: "ARMED",
    deterministicDispatchAttempts: 0
  };
}

/**
 * Drive a dispatch generation straight to the RECOVER verdict without waiting
 * for a lease to age out. Clearing `deterministicScheduledAt` skips the WAIT
 * branch, and the attempt ceiling makes the next gate evaluation return
 * RECOVER, so the established bounded-reconciliation path still owns the
 * terminal handling.
 */
export function exhaustDeterministicDispatch(requestValue = {}, {
  maxAttempts = DETERMINISTIC_CALLBACK_MAX_ATTEMPTS
} = {}) {
  const request = deepClone(requestValue || {});
  return {
    ...request,
    deterministicScheduledAt: null,
    deterministicDispatchState: "DISPATCHED",
    deterministicDispatchAttempts: Math.max(
      Math.max(0, Number(request.deterministicDispatchAttempts || 0)),
      Math.max(1, Number(maxAttempts || DETERMINISTIC_CALLBACK_MAX_ATTEMPTS))
    )
  };
}

export function deterministicSourceExhausted(runValue = {}, {
  source = "",
  observationId = ""
} = {}) {
  const failure = runValue?.deterministicGroundingFailure;
  if (!failure || typeof failure !== "object") return false;
  return Boolean(
    String(failure.source || "") === String(source || "") &&
    String(failure.observationId || "") === String(observationId || "") &&
    String(failure.digest || "")
  );
}
