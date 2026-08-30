import { deepClone } from "./common.mjs";
import { isAssistantResponseCandidate } from "./response-trigger.mjs";
import {
  NANO_DECISION_SOURCE,
  NANO_REQUEST_STATUS
} from "./nano-pipeline.mjs";

export const PROTOCOL_DECISION_PATHS = Object.freeze({
  NANO: "NANO",
  REPAIR: "REPAIR",
  REPAIR_EXHAUSTED: "REPAIR_EXHAUSTED",
  FAST_PATH: "FAST_PATH"
});

export function selectProtocolDecisionPath({
  targetResult = {},
  analysisMode = "",
  continuityGrounded = false,
  currentTurnKind = ""
} = {}) {
  if (String(currentTurnKind) === "PROTOCOL_REPAIR") {
    // A protocol-repair turn is the one bounded transport repair for its parent
    // response. A valid repaired footer is consumed deterministically exactly
    // once; an invalid repair must typed-fail instead of becoming ordinary Nano
    // semantic work (which v0.11.21 could turn into READ_LOCAL_SESSION_STATE /
    // WAIT_OWNER_EVENT control churn).
    if (!targetResult?.valid) return PROTOCOL_DECISION_PATHS.REPAIR_EXHAUSTED;
    return PROTOCOL_DECISION_PATHS.FAST_PATH;
  }
  if (String(analysisMode) === "TAKEOVER_BOOTSTRAP") {
    return PROTOCOL_DECISION_PATHS.NANO;
  }
  if (!targetResult?.valid) {
    return PROTOCOL_DECISION_PATHS.REPAIR;
  }
  if (continuityGrounded && protocolFastPathEligible(targetResult)) {
    return PROTOCOL_DECISION_PATHS.FAST_PATH;
  }
  return PROTOCOL_DECISION_PATHS.NANO;
}

export function operatorActionBoundaryEligible(targetResult = {}) {
  if (!targetResult?.valid) return false;
  const status = String(targetResult.status || "").toUpperCase();
  const nextActor = String(targetResult.nextActor || "").toUpperCase();
  const next = String(targetResult.next || "").trim();
  const completionEvidence = String(targetResult.completionEvidence || "").trim();
  const completionState = String(targetResult.completionState || "").toUpperCase();
  return Boolean(
    status === "OPERATOR_ACTION_REQUIRED" &&
    nextActor === "OPERATOR_ACTION" &&
    next &&
    completionEvidence &&
    ["UNIT_DONE", "MILESTONE_CONTINUE"].includes(completionState)
  );
}

export function protocolFastPathEligible(targetResult = {}) {
  if (!targetResult?.valid) return false;
  const status = String(targetResult.status || "").toUpperCase();
  const next = String(targetResult.next || "").trim();
  const completionEvidence = String(targetResult.completionEvidence || "").trim();
  const completionState = String(targetResult.completionState || "").toUpperCase();

  // v0.11.12: all explicit human boundaries are deterministic control-plane
  // outcomes. OPERATOR_ACTION_REQUIRED is also latched directly at response
  // observation time in background.js; fast-path eligibility is the defensive
  // recovery/reconciliation contract for preserved observations.
  if (operatorActionBoundaryEligible(targetResult)) {
    return true;
  }

  // v0.10.23: ordinary continuation is a semantic routing decision, not a
  // transport shortcut. Even a syntactically complete EIC-AA/5 CONTINUE must
  // pass through Nano so the controller can choose a registered micro-action
  // and its execution surface. Only terminal/human-boundary protocol outcomes
  // remain eligible for the deterministic fast path.
  if (status === "CONTINUE") {
    return false;
  }
  if (status === "USER_PAUSE") {
    return Boolean(next && completionEvidence && completionState === "PROGRAM_BLOCKED");
  }
  if (status === "DONE") {
    return Boolean(completionEvidence && !next && completionState === "PROGRAM_DONE");
  }
  return false;
}

export function markDeterministicPending(requestValue, source, decisionDigest = "") {
  const allowed = new Set([
    NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL,
    NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY
  ]);
  if (!allowed.has(source)) {
    throw new TypeError(`Unsupported deterministic source: ${String(source)}`);
  }
  const request = deepClone(requestValue);
  if (!request?.requestId || !request?.observationId) {
    throw new TypeError("A deterministic request requires requestId and observationId.");
  }
  return {
    ...request,
    status: NANO_REQUEST_STATUS.DETERMINISTIC_PENDING,
    deterministicSource: source,
    deterministicDecisionDigest: decisionDigest,
    deterministicScheduledAt: null,
    deterministicDispatchState: "ARMED",
    deterministicDispatchAttempts: 0,
    deterministicFailureDigest: "",
    deterministicFailureCount: 0,
    claimId: null,
    claimedAt: null,
    startedAt: null,
    heartbeatAt: null,
    claimLeaseUntil: null,
    firstTokenAt: null,
    deadlineAt: null
  };
}


export function preservedProtocolPageMatch({
  run = {},
  observation = null,
  page = null
} = {}) {
  if (!observation || !isAssistantResponseCandidate(page) || !page?.latestAssistantHash) return false;
  if (String(observation.responseHash || "") !== String(page.latestAssistantHash || "")) return false;
  if (run.conversationKey && page.conversationKey &&
      String(run.conversationKey) !== String(page.conversationKey)) return false;

  const observationEpoch = String(observation.documentEpoch || "");
  const pageEpoch = String(page.documentEpoch || "");
  if (!observationEpoch || observationEpoch === pageEpoch) return true;

  const targetResult = observation.targetResult || {};
  const expectedTurnId = String(
    run.currentTurn?.responseExpectedTurnId ||
    run.currentTurn?.turnId ||
    ""
  );
  const observedTurnId = String(targetResult.turnId || "");
  return Boolean(
    protocolFastPathEligible(targetResult) &&
    expectedTurnId &&
    observedTurnId === expectedTurnId &&
    run.currentTurn?.effectState === "ACKED"
  );
}

export function preservedProtocolRecoveryEligible({
  pendingNanoRequest = null,
  targetResult = null,
  pageMatches = false,
  humanPause = false
} = {}) {
  return Boolean(
    !pendingNanoRequest &&
    protocolFastPathEligible(targetResult) &&
    pageMatches &&
    !humanPause
  );
}
