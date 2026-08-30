import { sanitizeText } from "./common.mjs";

/**
 * v0.12.13 introduced a bounded liveness for stranded response ownership;
 * v0.12.14 makes that liveness autonomous.
 *
 * v0.12.12's only response-liveness bound lived on `run.responseCandidate`
 * (RESPONSE_SETTLE_MAX_AGE_MS). When the admission gates disagreed, no
 * candidate was ever established, so the 60 s bound had nothing to attach to
 * and `clearResponseStabilityProbe()` additionally cancelled the Chrome alarm
 * that would have woken the controller. The run sat in WAITING_FOR_RESPONSE
 * with a complete, stable assistant response on screen and no subsystem that
 * owned getting it through. Liveness therefore has to be owned by the turn,
 * not by a candidate that may never exist.
 *
 * v0.12.13 got the detection right and the remedy wrong, in three ways the
 * 15:08 field log made unambiguous:
 *
 *   1. The failure code is `CAUSAL_OWNER_STRANDED_NO_PRODUCER`, but nothing
 *      ever asked whether a producer existed. At 15:08:16.844 the strand was
 *      opened in the same millisecond `NANO_CLAIM` took ownership of exactly
 *      this turn. Nano then ran normally for 49 s and returned ACCEPT.
 *   2. The strand was only cleared on the healthy branch of the preflight, so
 *      once `latestEffect(run)` went null — the ordinary outcome of finishing
 *      a turn — the stale strand survived and kept ageing, while escalation
 *      ran unconditionally and never re-validated it.
 *   3. Escalation was `ERROR_TERMINAL`. At 15:09:06.547 session-init reported
 *      READY ("Vanlig agentbearbetning får nu fortsätta"); 95 ms later the
 *      strand killed the run and it polled a dead snapshot for ten minutes.
 *
 * So: a producer check gates the strand, clearing is unconditional, and an
 * overdue strand re-arms admission rather than demanding a human. Terminal
 * escalation is not this module's decision to make — a strand that outlives
 * its re-arm budget hands the run to the recovery ladder that already knows
 * how to escalate.
 */
export const CAUSAL_OWNERSHIP_STRAND_SCHEMA = "eic.autonom.causal-ownership-strand.v1";
export const CAUSAL_OWNERSHIP_STRAND_CODE = "CAUSAL_OWNER_STRANDED_NO_PRODUCER";
export const CAUSAL_OWNERSHIP_STRAND_MAX_AGE_MS = 45_000;
export const CAUSAL_OWNERSHIP_REARM_SCHEMA = "eic.autonom.causal-ownership-rearm.v1";
export const CAUSAL_OWNERSHIP_STRAND_MAX_REARM = 2;

/**
 * Subsystems that legitimately own the next step of a turn. While any of these
 * holds the turn there is a producer by definition, so the strand must not be
 * open — regardless of what the two control planes say about each other.
 */
export const CAUSAL_OWNERSHIP_PRODUCER = Object.freeze({
  NANO_PENDING: "NANO_PENDING",
  SESSION_INIT: "SESSION_INIT",
  RESPONSE_CANDIDATE: "RESPONSE_CANDIDATE",
  PENDING_OBSERVATION: "PENDING_OBSERVATION",
  WAITING_OBSERVATION: "WAITING_OBSERVATION",
  PREPARED_EFFECT: "PREPARED_EFFECT",
  OPERATOR_PENDING: "OPERATOR_PENDING",
  PAGE_GENERATING: "PAGE_GENERATING",
  NONE: "NONE"
});

export const CAUSAL_OWNERSHIP_RECOVERY_ACTION = Object.freeze({
  CLEAR: "CLEAR",
  HOLD: "HOLD",
  REARM: "REARM",
  RECOVER: "RECOVER"
});

const ACTIVE_NANO_STATUS = new Set(["PENDING", "DETERMINISTIC_PENDING", "RUNNING"]);
const ACTIVE_SESSION_INIT_STATE = new Set([
  "WAITING_CHAT_READY",
  "CATCH_ARMED",
  "CATCH_CAPTURED",
  "BASELINE_REQUEST_DISPATCHED",
  "WAITING_BASELINE_RESPONSE",
  "NANO_ANALYZING"
]);
const LIVE_LEGACY_EFFECT_STATUS = new Set([
  "PREPARED",
  "RETRY_PREPARED",
  "SUBMITTING",
  "SUBMITTED_UNCONFIRMED"
]);

function iso(value) {
  return new Date(value).toISOString();
}

function parsedAt(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Is some subsystem already responsible for producing the next step?
 *
 * This is deliberately generous: a false "producer active" costs one more tick
 * of waiting, whereas a false "no producer" is what killed the 15:08 run while
 * Nano was mid-analysis. The bound that catches a genuinely wedged producer
 * belongs to that producer (Nano deadlines, RESPONSE_SETTLE_MAX_AGE_MS,
 * session-init retries), not here.
 */
export function classifyCausalOwnershipProducer(run = {}, {
  legacyEffect = null,
  pageGenerating = false
} = {}) {
  const nanoStatus = sanitizeText(run?.pendingNanoRequest?.status, 80);
  if (run?.pendingNanoRequest && ACTIVE_NANO_STATUS.has(nanoStatus)) {
    return {
      active: true,
      producer: CAUSAL_OWNERSHIP_PRODUCER.NANO_PENDING,
      detail: `${sanitizeText(run.pendingNanoRequest.requestId, 120) || "nano"}:${nanoStatus}`
    };
  }

  const initState = sanitizeText(run?.sessionContextInit?.state, 80);
  if (ACTIVE_SESSION_INIT_STATE.has(initState)) {
    return {
      active: true,
      producer: CAUSAL_OWNERSHIP_PRODUCER.SESSION_INIT,
      detail: initState
    };
  }

  if (run?.responseCandidate) {
    return {
      active: true,
      producer: CAUSAL_OWNERSHIP_PRODUCER.RESPONSE_CANDIDATE,
      detail: sanitizeText(run.responseCandidate.hash, 24)
    };
  }

  if (run?.pendingObservation) {
    return { active: true, producer: CAUSAL_OWNERSHIP_PRODUCER.PENDING_OBSERVATION, detail: "" };
  }

  if (run?.waitingObservation) {
    return { active: true, producer: CAUSAL_OWNERSHIP_PRODUCER.WAITING_OBSERVATION, detail: "" };
  }

  const legacyStatus = sanitizeText(legacyEffect?.status, 80);
  if (LIVE_LEGACY_EFFECT_STATUS.has(legacyStatus)) {
    return {
      active: true,
      producer: CAUSAL_OWNERSHIP_PRODUCER.PREPARED_EFFECT,
      detail: legacyStatus
    };
  }

  if (run?.operatorAction || run?.operatorDecision) {
    return { active: true, producer: CAUSAL_OWNERSHIP_PRODUCER.OPERATOR_PENDING, detail: "" };
  }

  if (pageGenerating === true) {
    return { active: true, producer: CAUSAL_OWNERSHIP_PRODUCER.PAGE_GENERATING, detail: "" };
  }

  return { active: false, producer: CAUSAL_OWNERSHIP_PRODUCER.NONE, detail: "" };
}

export function openCausalOwnershipStrand(existing, ownership = {}, {
  now = Date.now(),
  maxAgeMs = CAUSAL_OWNERSHIP_STRAND_MAX_AGE_MS,
  turnId = "",
  responseHash = ""
} = {}) {
  const effectId = sanitizeText(ownership?.effectId, 180);
  if (!effectId) return null;
  const previous = existing && typeof existing === "object" ? existing : null;
  // The same strand keeps its original deadline; a different effect restarts it.
  const continues = previous && previous.effectId === effectId;
  const firstSeen = continues ? parsedAt(previous.firstSeenAt) : NaN;
  const base = Number.isFinite(firstSeen) ? firstSeen : Number(now);
  const bound = Math.max(5_000, Number(maxAgeMs) || CAUSAL_OWNERSHIP_STRAND_MAX_AGE_MS);
  // A re-arm restarts the clock from the grant, so the deadline is measured
  // from the last remedy attempt rather than from first sight.
  const rearmedAt = continues ? parsedAt(previous.rearmedAt) : NaN;
  const deadlineBase = Number.isFinite(rearmedAt) && rearmedAt > base ? rearmedAt : base;
  return {
    schema: CAUSAL_OWNERSHIP_STRAND_SCHEMA,
    code: CAUSAL_OWNERSHIP_STRAND_CODE,
    verdict: sanitizeText(ownership?.verdict, 80),
    effectId,
    turnId: sanitizeText(turnId || previous?.turnId, 180),
    legacyStatus: sanitizeText(ownership?.legacyStatus, 80),
    causalStatus: sanitizeText(ownership?.causalStatus, 80),
    closeReason: sanitizeText(ownership?.closeReason, 240),
    responseHash: sanitizeText(responseHash || previous?.responseHash, 128),
    observations: Math.max(0, Number(continues ? previous.observations : 0)) + 1,
    rearmCount: Math.max(0, Number(continues ? previous.rearmCount : 0) || 0),
    rearmedAt: continues ? sanitizeText(previous?.rearmedAt, 40) : "",
    firstSeenAt: iso(base),
    lastSeenAt: iso(now),
    deadlineAt: iso(deadlineBase + bound)
  };
}

export function clearCausalOwnershipStrand() {
  return null;
}

export function evaluateCausalOwnershipStrand(strand, { now = Date.now() } = {}) {
  if (!strand || typeof strand !== "object") {
    return { open: false, overdue: false, ageMs: 0, deadlineAt: "", code: "", rearmCount: 0 };
  }
  const first = parsedAt(strand.firstSeenAt);
  const deadline = parsedAt(strand.deadlineAt);
  const ageMs = Number.isFinite(first) ? Math.max(0, Number(now) - first) : 0;
  const overdue = Number.isFinite(deadline) && Number(now) >= deadline;
  return {
    open: true,
    overdue,
    ageMs,
    deadlineAt: strand.deadlineAt || "",
    code: overdue ? CAUSAL_OWNERSHIP_STRAND_CODE : "",
    rearmCount: Math.max(0, Number(strand.rearmCount || 0))
  };
}

/**
 * The remedy ladder. Nothing here ends a run: the worst outcome is handing the
 * turn to the recovery ladder, which owns its own escalation budget.
 */
export function planCausalOwnershipRecovery({
  strand = null,
  producer = null,
  ownership = null,
  now = Date.now(),
  priorRearms = 0,
  maxRearm = CAUSAL_OWNERSHIP_STRAND_MAX_REARM
} = {}) {
  if (!strand || typeof strand !== "object") {
    return { action: CAUSAL_OWNERSHIP_RECOVERY_ACTION.CLEAR, reason: "NO_STRAND", ageMs: 0, rearmCount: 0 };
  }
  const evaluation = evaluateCausalOwnershipStrand(strand, { now });
  // A re-arm retires the legacy effect, so the next tick sees no strand at all
  // and the strand-local counter resets. Budget therefore has to be carried at
  // run level across strands, or a divergence that keeps re-appearing re-arms
  // forever and never reaches recovery. The caller zeroes `priorRearms` once
  // the run makes real progress, so only unproductive re-arms accumulate.
  evaluation.rearmCount = Math.max(evaluation.rearmCount, Math.max(0, Number(priorRearms) || 0));
  if (producer?.active) {
    return {
      action: CAUSAL_OWNERSHIP_RECOVERY_ACTION.CLEAR,
      reason: `PRODUCER_ACTIVE:${sanitizeText(producer.producer, 80)}`,
      ageMs: evaluation.ageMs,
      rearmCount: evaluation.rearmCount
    };
  }
  if (ownership && ownership.desynced !== true) {
    return {
      action: CAUSAL_OWNERSHIP_RECOVERY_ACTION.CLEAR,
      reason: `OWNERSHIP_RESYNCED:${sanitizeText(ownership.verdict, 80)}`,
      ageMs: evaluation.ageMs,
      rearmCount: evaluation.rearmCount
    };
  }
  if (!evaluation.overdue) {
    return {
      action: CAUSAL_OWNERSHIP_RECOVERY_ACTION.HOLD,
      reason: "WITHIN_BOUND",
      ageMs: evaluation.ageMs,
      rearmCount: evaluation.rearmCount
    };
  }
  const bound = Math.max(0, Number(maxRearm) === 0 ? 0 : Number(maxRearm) || CAUSAL_OWNERSHIP_STRAND_MAX_REARM);
  if (evaluation.rearmCount < bound) {
    return {
      action: CAUSAL_OWNERSHIP_RECOVERY_ACTION.REARM,
      reason: `STRAND_OVERDUE:${evaluation.rearmCount + 1}/${bound}`,
      ageMs: evaluation.ageMs,
      rearmCount: evaluation.rearmCount
    };
  }
  return {
    action: CAUSAL_OWNERSHIP_RECOVERY_ACTION.RECOVER,
    reason: `REARM_EXHAUSTED:${evaluation.rearmCount}/${bound}`,
    ageMs: evaluation.ageMs,
    rearmCount: evaluation.rearmCount
  };
}

/**
 * A one-shot admission grant. It names the effect it was issued against and
 * the response hash that was already consumed, so a gate can admit only a
 * genuinely new response and never re-admit the consumed one.
 */
export function grantCausalOwnershipRearm(strand, page = {}, { now = Date.now() } = {}) {
  const effectId = sanitizeText(strand?.effectId, 180);
  if (!effectId) return null;
  return {
    schema: CAUSAL_OWNERSHIP_REARM_SCHEMA,
    code: CAUSAL_OWNERSHIP_STRAND_CODE,
    effectId,
    turnId: sanitizeText(strand?.turnId, 180),
    verdict: sanitizeText(strand?.verdict, 80),
    consumedResponseHash: sanitizeText(strand?.responseHash, 128),
    observedResponseHash: sanitizeText(page?.latestAssistantHash, 128),
    documentEpoch: sanitizeText(page?.documentEpoch, 240),
    attempt: Math.max(0, Number(strand?.rearmCount || 0)) + 1,
    grantedAt: iso(now)
  };
}

export function markCausalOwnershipRearm(strand, { now = Date.now() } = {}) {
  if (!strand || typeof strand !== "object") return null;
  return {
    ...strand,
    rearmCount: Math.max(0, Number(strand.rearmCount || 0)) + 1,
    rearmedAt: iso(now),
    lastSeenAt: iso(now),
    deadlineAt: iso(Number(now) + CAUSAL_OWNERSHIP_STRAND_MAX_AGE_MS)
  };
}

/**
 * Does an outstanding grant admit the response currently on screen? Only when
 * it is bound to this effect and the page actually shows something other than
 * the already-consumed response. A grant can never resurrect the consumed one.
 */
export function causalOwnershipRearmAdmits(rearm, legacyEffect = null, page = {}) {
  if (!rearm || rearm.schema !== CAUSAL_OWNERSHIP_REARM_SCHEMA) return false;
  const effectId = sanitizeText(legacyEffect?.effectId, 180);
  // Retiring the stranded legacy claim is part of the same remedy, so an empty
  // journal is the expected state here and the grant remains the authority for
  // this turn. A *different* live effect has its own owner and never borrows it.
  if (effectId && effectId !== sanitizeText(rearm.effectId, 180)) return false;
  const observed = sanitizeText(page?.latestAssistantHash, 128);
  if (!observed) return false;
  return observed !== sanitizeText(rearm.consumedResponseHash, 128);
}

export function causalOwnershipStrandFailure(strand, page = {}, { now = Date.now() } = {}) {
  const evaluation = evaluateCausalOwnershipStrand(strand, { now });
  if (!evaluation.overdue) return null;
  return {
    schema: "eic.autonom.causal-ownership-failure.v1",
    code: CAUSAL_OWNERSHIP_STRAND_CODE,
    verdict: sanitizeText(strand?.verdict, 80),
    effectId: sanitizeText(strand?.effectId, 180),
    turnId: sanitizeText(strand?.turnId, 180),
    legacyStatus: sanitizeText(strand?.legacyStatus, 80),
    causalStatus: sanitizeText(strand?.causalStatus, 80),
    closeReason: sanitizeText(strand?.closeReason, 240),
    responseHash: sanitizeText(page?.latestAssistantHash || strand?.responseHash, 128),
    documentEpoch: sanitizeText(page?.documentEpoch, 240),
    observations: Math.max(0, Number(strand?.observations || 0)),
    rearmCount: Math.max(0, Number(strand?.rearmCount || 0)),
    ageMs: evaluation.ageMs,
    deadlineAt: evaluation.deadlineAt,
    detectedAt: iso(now)
  };
}
