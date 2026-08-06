import { deepClone } from "./common.mjs";
import { isAssistantResponseCandidate } from "./response-trigger.mjs";
import {
  NANO_DECISION_SOURCE,
  NANO_REQUEST_STATUS
} from "./nano-pipeline.mjs";

export const PROTOCOL_DECISION_PATHS = Object.freeze({
  NANO: "NANO",
  REPAIR: "REPAIR",
  FAST_PATH: "FAST_PATH"
});

export function selectProtocolDecisionPath({
  targetResult = {},
  analysisMode = "",
  continuityGrounded = false,
  currentTurnKind = ""
} = {}) {
  if (String(analysisMode) === "TAKEOVER_BOOTSTRAP") {
    return PROTOCOL_DECISION_PATHS.NANO;
  }
  if (String(currentTurnKind) === "PROTOCOL_REPAIR") {
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

export function protocolFastPathEligible(targetResult = {}) {
  if (!targetResult?.valid) return false;
  const status = String(targetResult.status || "").toUpperCase();
  const next = String(targetResult.next || "").trim();
  const completionEvidence = String(targetResult.completionEvidence || "").trim();
  const completionState = String(targetResult.completionState || "").toUpperCase();

  if (status === "CONTINUE") {
    return Boolean(
      next &&
      completionEvidence &&
      ["UNIT_DONE", "MILESTONE_CONTINUE"].includes(completionState)
    );
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
