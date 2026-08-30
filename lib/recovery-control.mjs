import { PAUSE_ORIGINS, STATES } from "./state-machine.mjs";

export const LOCAL_UNLOCK_EVENT = Object.freeze({
  AGENT_NANO_READY_STATE: "AGENT_NANO_READY_STATE"
});

export const CONNECTIVITY_RECOVERY_ORIGINS = Object.freeze([
  PAUSE_ORIGINS.TRANSIENT_TRANSPORT,
  PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
  PAUSE_ORIGINS.TAB_CLOSED,
  PAUSE_ORIGINS.TAB_MOVED,
  PAUSE_ORIGINS.TAB_NAVIGATED_AWAY,
  PAUSE_ORIGINS.WINDOW_CLOSED,
  PAUSE_ORIGINS.TARGET_FROZEN_OR_DISCARDED,
  PAUSE_ORIGINS.BACKGROUND_CANCELLED,
  PAUSE_ORIGINS.BACKGROUND_ERROR
]);

const CONNECTIVITY_ORIGIN_SET = new Set(CONNECTIVITY_RECOVERY_ORIGINS);
const LOCAL_UNLOCK_TOKEN_PATTERN = /\b(?:AGENT|SESSION_CONTEXT)_[A-Z0-9_]+(?:_STATE|_READY)\b/gu;

export function recoveryOrigin(run = {}) {
  if (run?.lastTransition?.to === STATES.RECOVERING && run.lastTransition.origin) {
    return String(run.lastTransition.origin);
  }
  return String(run?.pause?.origin || PAUSE_ORIGINS.NONE);
}

export function readablePageMayResolveRecovery(run = {}, page = {}) {
  if (![STATES.RECOVERING, STATES.ERROR_RETRYABLE].includes(run?.state)) return false;
  if (!page?.supported || !page?.sessionExists) return false;
  if (String(run?.waitingForUnlockEvent || "").trim()) return false;
  return CONNECTIVITY_ORIGIN_SET.has(recoveryOrigin(run));
}

export function extractLocalUnlockToken(value = "") {
  const matches = String(value || "").toUpperCase().match(LOCAL_UNLOCK_TOKEN_PATTERN) || [];
  return matches[0] || "";
}

export function evaluateLocalUnlockDirective(value = "", run = {}) {
  const token = extractLocalUnlockToken(value);
  if (!token) {
    return {
      requested: false,
      token: "",
      supported: false,
      satisfied: false,
      producer: ""
    };
  }

  if (token === LOCAL_UNLOCK_EVENT.AGENT_NANO_READY_STATE) {
    const satisfied = run?.sessionContextInit?.state === "READY";
    return {
      requested: true,
      token,
      supported: true,
      satisfied,
      producer: "run.sessionContextInit.state",
      observedValue: String(run?.sessionContextInit?.state || "")
    };
  }

  return {
    requested: true,
    token,
    supported: false,
    satisfied: false,
    producer: "",
    observedValue: ""
  };
}


export function activeOperatorCandidateForDecision(decision = {}) {
  const origin = String(decision?.pauseOrigin || PAUSE_ORIGINS.NONE).toUpperCase();
  if (![PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE, PAUSE_ORIGINS.USER_PAUSE].includes(origin)) {
    return null;
  }
  const candidate = decision?.operatorCandidate;
  return candidate && typeof candidate === "object" ? candidate : null;
}

export function normalizeSatisfiedLocalUnlockDecision(decision = {}, directive = {}) {
  const normalized = { ...decision };
  const changedFields = [];

  if (!directive?.requested || !directive?.supported || !directive?.satisfied) {
    return {
      decision: normalized,
      changed: false,
      changedFields,
      reason: "LOCAL_UNLOCK_NOT_SATISFIED"
    };
  }

  const action = String(normalized.action || "").toUpperCase();
  const pauseOrigin = String(normalized.pauseOrigin || PAUSE_ORIGINS.NONE).toUpperCase();
  if (action !== "CONTINUE" || pauseOrigin === PAUSE_ORIGINS.USER_PAUSE) {
    return {
      decision: normalized,
      changed: false,
      changedFields,
      reason: pauseOrigin === PAUSE_ORIGINS.USER_PAUSE
        ? "EXPLICIT_USER_PAUSE_PRESERVED"
        : "LOCAL_UNLOCK_ACTION_NOT_CONTINUE"
    };
  }

  if (String(normalized.completionState || "").toUpperCase() === "PROGRAM_BLOCKED") {
    normalized.completionState = "MILESTONE_CONTINUE";
    changedFields.push("completionState");
  }
  if (normalized.completionConfirmed === true) {
    normalized.completionConfirmed = false;
    changedFields.push("completionConfirmed");
  }
  if (normalized.boundedStop === true) {
    normalized.boundedStop = false;
    changedFields.push("boundedStop");
  }
  if (pauseOrigin !== PAUSE_ORIGINS.NONE) {
    normalized.pauseOrigin = PAUSE_ORIGINS.NONE;
    changedFields.push("pauseOrigin");
  }
  if (String(normalized.boundaryEvidence || "")) {
    normalized.boundaryEvidence = "";
    changedFields.push("boundaryEvidence");
  }

  const candidate = normalized.operatorCandidate;
  const stalePauseCandidate = candidate && typeof candidate === "object" && (
    String(candidate.actionCode || "").toUpperCase() === "USER_PAUSE" ||
    String(candidate.humanAuthorityClass || "").toUpperCase() === "REQUIRED"
  );
  if (stalePauseCandidate) {
    normalized.operatorCandidate = null;
    changedFields.push("operatorCandidate");
  }

  if ("eicAutonomy" in normalized && String(normalized.eicAutonomy || "").toUpperCase() !== "CONTINUE") {
    normalized.eicAutonomy = "CONTINUE";
    changedFields.push("eicAutonomy");
  }
  if ("eicNextActor" in normalized && String(normalized.eicNextActor || "").toUpperCase() !== "AGENT") {
    normalized.eicNextActor = "AGENT";
    changedFields.push("eicNextActor");
  }

  return {
    decision: normalized,
    changed: changedFields.length > 0,
    changedFields,
    reason: changedFields.length
      ? "SATISFIED_LOCAL_UNLOCK_CLEARED_STALE_TERMINAL_METADATA"
      : "SATISFIED_LOCAL_UNLOCK_ALREADY_COHERENT"
  };
}

export function effectiveDecisionProgressDelta(decision = {}) {
  const progressDelta = Number(decision?.progressDelta || 0);
  const directProgramDelta = Number(decision?.directProgramDelta || 0);
  return Math.max(
    Number.isFinite(progressDelta) ? progressDelta : 0,
    Number.isFinite(directProgramDelta) ? directProgramDelta : 0
  );
}
