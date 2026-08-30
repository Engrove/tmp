import { sanitizeText } from "./common.mjs";
import { EFFECT_JOURNAL_STATUS } from "./effect-journal.mjs";

export const CONTROL_PLANE_PHASE = Object.freeze({
  TERMINAL_OWNER: "TERMINAL_OWNER",
  HUMAN_OWNER: "HUMAN_OWNER",
  SAFETY_OWNER: "SAFETY_OWNER",
  EFFECT_OWNER: "EFFECT_OWNER",
  RESPONSE_OWNER: "RESPONSE_OWNER",
  SESSION_INIT_OWNER: "SESSION_INIT_OWNER",
  NANO_OWNER: "NANO_OWNER",
  RECOVERY_OWNER: "RECOVERY_OWNER",
  DELIVERY_OWNER: "DELIVERY_OWNER"
});

const TERMINAL_RUN_STATES = new Set(["PROGRAM_DONE", "STOPPED", "ERROR_TERMINAL"]);
const HUMAN_RUN_STATES = new Set(["AWAITING_OPERATOR_ACTION", "AWAITING_OPERATOR_DECISION"]);
const ACTIVE_EFFECT_STATES = new Set([
  EFFECT_JOURNAL_STATUS.PREPARED,
  EFFECT_JOURNAL_STATUS.RETRY_PREPARED,
  EFFECT_JOURNAL_STATUS.SUBMITTING,
  EFFECT_JOURNAL_STATUS.SUBMITTED_UNCONFIRMED
]);
const ACTIVE_NANO_STATES = new Set(["PENDING", "DETERMINISTIC_PENDING", "RUNNING"]);
const RECOVERY_RUN_STATES = new Set(["RECOVERING", "SOFT_PAUSED", "ERROR_RETRYABLE"]);
const SESSION_INIT_ACTIVE = new Set([
  "WAITING_CHAT_READY", "CATCH_ARMED", "CATCH_CAPTURED",
  "BASELINE_REQUEST_DISPATCHED", "WAITING_BASELINE_RESPONSE", "NANO_ANALYZING"
]);

export function selectControlPlanePhase({
  run = {},
  effect = null,
  responseOwnership = null,
  page = {}
} = {}) {
  const runState = sanitizeText(run?.state, 120);
  if (TERMINAL_RUN_STATES.has(runState)) {
    return { phase: CONTROL_PLANE_PHASE.TERMINAL_OWNER, reason: runState };
  }
  if (HUMAN_RUN_STATES.has(runState)) {
    return { phase: CONTROL_PLANE_PHASE.HUMAN_OWNER, reason: runState };
  }
  if (page?.boundarySignals?.captcha || page?.boundarySignals?.authenticationRequired) {
    return {
      phase: CONTROL_PLANE_PHASE.SAFETY_OWNER,
      reason: page?.boundarySignals?.captcha ? "CAPTCHA" : "AUTHENTICATION"
    };
  }
  const effectStatus = sanitizeText(effect?.status, 80).toUpperCase();
  if (effect && ACTIVE_EFFECT_STATES.has(effectStatus)) {
    return { phase: CONTROL_PLANE_PHASE.EFFECT_OWNER, reason: effectStatus };
  }
  if (run?.responseCandidate &&
      responseOwnership?.disposition === "ACTIVE" &&
      !responseOwnership?.candidateIsSource &&
      !responseOwnership?.candidateIsPendingObservation) {
    return { phase: CONTROL_PLANE_PHASE.RESPONSE_OWNER, reason: "ACTIVE_CAUSAL_RESPONSE_CANDIDATE" };
  }
  const initState = sanitizeText(run?.sessionContextInit?.state, 120);
  if (SESSION_INIT_ACTIVE.has(initState)) {
    return { phase: CONTROL_PLANE_PHASE.SESSION_INIT_OWNER, reason: initState };
  }
  const nanoState = sanitizeText(run?.pendingNanoRequest?.status, 80).toUpperCase();
  if (ACTIVE_NANO_STATES.has(nanoState) ||
      sanitizeText(run?.nanoTelemetry?.lastStatus, 80).toUpperCase() === "RUNNING") {
    return { phase: CONTROL_PLANE_PHASE.NANO_OWNER, reason: nanoState || "RUNNING_TELEMETRY" };
  }
  if (RECOVERY_RUN_STATES.has(runState)) {
    return { phase: CONTROL_PLANE_PHASE.RECOVERY_OWNER, reason: runState };
  }
  return { phase: CONTROL_PLANE_PHASE.DELIVERY_OWNER, reason: runState || "NONE" };
}

export function controlPlanePhaseInvariant({
  phase = "",
  run = {},
  effect = null,
  responseOwnership = null,
  page = {}
} = {}) {
  const selected = selectControlPlanePhase({ run, effect, responseOwnership, page });
  const problems = [];
  if (phase && phase !== selected.phase) problems.push("PHASE_SELECTION_MISMATCH");
  if (selected.phase === CONTROL_PLANE_PHASE.RESPONSE_OWNER &&
      responseOwnership?.disposition !== "ACTIVE") {
    problems.push("RESPONSE_OWNER_WITHOUT_ACTIVE_CANDIDATE");
  }
  if (selected.phase === CONTROL_PLANE_PHASE.RESPONSE_OWNER &&
      (responseOwnership?.candidateIsSource ||
       responseOwnership?.candidateIsPendingObservation ||
       responseOwnership?.pageIsSource ||
       responseOwnership?.pageIsPendingObservation)) {
    problems.push("RESPONSE_OWNER_OWNS_CAUSAL_SOURCE");
  }
  if (selected.phase === CONTROL_PLANE_PHASE.EFFECT_OWNER &&
      !ACTIVE_EFFECT_STATES.has(sanitizeText(effect?.status, 80).toUpperCase())) {
    problems.push("EFFECT_OWNER_WITHOUT_ACTIVE_EFFECT");
  }
  if (selected.phase === CONTROL_PLANE_PHASE.NANO_OWNER &&
      !ACTIVE_NANO_STATES.has(sanitizeText(run?.pendingNanoRequest?.status, 80).toUpperCase()) &&
      sanitizeText(run?.nanoTelemetry?.lastStatus, 80).toUpperCase() !== "RUNNING") {
    problems.push("NANO_OWNER_WITHOUT_ACTIVE_NANO");
  }
  return { valid: problems.length === 0, problems, selected };
}
