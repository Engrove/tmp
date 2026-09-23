export const GREENFIELD_STATES = Object.freeze({
  ACTIVE: "ACTIVE",
  DONE: "DONE"
});

export const GREENFIELD_ACTIONS = Object.freeze({
  NEXT: "NEXT",
  BLOCK: "BLOCK",
  OPERATOR: "OPERATOR",
  NONE: "NONE"
});

function upper(value, fallback = "") {
  return String(value || fallback).trim().toUpperCase();
}

function trim(value) {
  return String(value || "").trim();
}

/**
 * Resolve the browser-side Greenfield control action from structured runtime facts.
 *
 * Domain/protocol blocker text is evidence only and never a stop primitive.
 * A CONTINUE target with an executable nextSuggestedAction may therefore recover
 * from an advisory Hjalmar BLOCKED decision unless a hard runtime or human-
 * authority condition independently requires a stop.
 */
export function resolveGreenfieldControl({
  targetDisposition = "UNKNOWN",
  targetNextSuggestedAction = "",
  decision = null,
  nanoTask = null,
  sessionAction = "KEEP"
} = {}) {
  const target = upper(targetDisposition, "UNKNOWN");
  const nextSuggestedAction = trim(targetNextSuggestedAction);
  const disposition = upper(decision?.disposition);
  const humanAuthorityRequired = decision?.humanAuthorityRequired === true;
  const nanoStatus = upper(nanoTask?.status);
  const session = upper(sessionAction, "KEEP");

  if (session === "STOP_PROCESS") {
    return {
      state: GREENFIELD_STATES.DONE,
      action: GREENFIELD_ACTIONS.NONE,
      reason: "EIC_EXPLICIT_STOP_PROCESS",
      hardStop: false,
      effectiveDisposition: "DONE",
      effectiveNextPrompt: ""
    };
  }

  if (session === "ROTATE_SESSION_NOW") {
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.NEXT,
      reason: "EIC_EXPLICIT_SESSION_ROTATION",
      hardStop: false,
      effectiveDisposition: "CONTINUE",
      effectiveNextPrompt: nextSuggestedAction || trim(decision?.nextPrompt),
      controllerOverride: disposition === "BLOCKED"
    };
  }

  if (session === "YIELD_TO_QUEUE") {
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.NEXT,
      reason: "EIC_EXPLICIT_QUEUE_YIELD",
      hardStop: false,
      effectiveDisposition: "CONTINUE",
      effectiveNextPrompt: nextSuggestedAction || trim(decision?.nextPrompt),
      controllerOverride: disposition === "BLOCKED"
    };
  }

  if (target === "DONE") {
    return {
      state: GREENFIELD_STATES.DONE,
      action: GREENFIELD_ACTIONS.NONE,
      reason: "EIC_EXPLICIT_STATUS_DONE",
      hardStop: false,
      effectiveDisposition: "DONE",
      effectiveNextPrompt: ""
    };
  }

  if (nanoTask?.requested === true && nanoStatus === "UNKNOWN_EFFECT") {
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.BLOCK,
      reason: "NANO_TASK_UNKNOWN_EFFECT",
      hardStop: true,
      effectiveDisposition: "BLOCKED",
      effectiveNextPrompt: ""
    };
  }

  if (humanAuthorityRequired) {
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.OPERATOR,
      reason: "HUMAN_AUTHORITY_REQUIRED",
      hardStop: true,
      effectiveDisposition: "BLOCKED",
      effectiveNextPrompt: ""
    };
  }

  if (disposition === "DONE") {
    return {
      state: GREENFIELD_STATES.DONE,
      action: GREENFIELD_ACTIONS.NONE,
      reason: "HJALMAR_OBJECTIVE_DONE",
      hardStop: false,
      effectiveDisposition: "DONE",
      effectiveNextPrompt: ""
    };
  }

  if (disposition === "BLOCKED") {
    if (target === "CONTINUE" && nextSuggestedAction) {
      return {
        state: GREENFIELD_STATES.ACTIVE,
        action: GREENFIELD_ACTIONS.NEXT,
        reason: "TARGET_CONTINUE_EXECUTABLE_NEXT_RECOVERY",
        hardStop: false,
        effectiveDisposition: "CONTINUE",
        effectiveNextPrompt: nextSuggestedAction,
        controllerOverride: true
      };
    }
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.BLOCK,
      reason: "NO_EXECUTABLE_AUTONOMOUS_NEXT_STEP",
      hardStop: true,
      effectiveDisposition: "BLOCKED",
      effectiveNextPrompt: ""
    };
  }

  if (["CONTINUE", "READ_REQUIRED"].includes(disposition)) {
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.NEXT,
      reason: disposition === "READ_REQUIRED" ? "READ_REQUIRED_NEXT" : "HJALMAR_CONTINUE",
      hardStop: false,
      effectiveDisposition: disposition,
      effectiveNextPrompt: trim(decision?.nextPrompt)
    };
  }

  return {
    state: GREENFIELD_STATES.ACTIVE,
    action: GREENFIELD_ACTIONS.BLOCK,
    reason: "UNSUPPORTED_CONTROLLER_DISPOSITION",
    hardStop: true,
    effectiveDisposition: disposition || "BLOCKED",
    effectiveNextPrompt: ""
  };
}

export function applyGreenfieldControlToDecision(decision, control) {
  const d = decision && typeof decision === "object" ? { ...decision } : {};
  if (!control?.controllerOverride) return d;
  return {
    ...d,
    disposition: control.effectiveDisposition,
    objectiveStatus: "PENDING",
    nextPrompt: trim(control.effectiveNextPrompt),
    materialAmbiguity: "NONE",
    humanAuthorityRequired: false,
    greenfieldControllerOverride: {
      reason: control.reason,
      originalDisposition: upper(decision?.disposition),
      action: control.action
    }
  };
}
