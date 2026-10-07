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

// The EIC's own continuation handoff without a NANO_TASK directive line (the
// directive ends at its newline and is consumed locally, never re-sent).
export function eicHandoffWithoutNanoTask(value) {
  return String(value || "")
    .split("\n")
    .filter((line) => !/^\s*NANO_TASK\s*:/i.test(line))
    .join("\n")
    .trim();
}

// v1.9.3: the local advisory model judged the current objective satisfied but
// the EIC returned no terminal status. A satisfied slice is not a closed
// mission (contract terminalProgressContract: DONE requires supported
// terminal closure), so Greenfield continues and asks for the EIC's verdict.
export const ADVISORY_DONE_CONTINUATION = "Greenfield's local advisory analysis judged the previous objective satisfied, but your response carried no terminal status, so the mission continues. Re-read fresh owner state and continue with the next single bounded slice. Return status=DONE only with supported owner-verified terminal closure; if no executable slice remains, return a truthful no-delta status with a restart-safe nextSuggestedAction or a real blocker.";

/**
 * Resolve the browser-side Greenfield control action from structured runtime facts.
 *
 * Domain/protocol blocker text is evidence only and never a stop primitive.
 * A CONTINUE target with an executable nextSuggestedAction may therefore recover
 * from an advisory Hjalmar BLOCKED decision unless a hard runtime or human-
 * authority condition independently requires a stop.
 *
 * v1.7.7: an EIC terminal control (status=DONE, sessionAction=STOP_PROCESS or
 * runtimeControl COMPLETE_MISSION) is an owner-validated runtime effect, not an
 * advisory hint. When accepted it overrides the local controller disposition
 * (controllerOverride), so the DONE commit and logical-GFW queue retirement
 * actually run. terminalControl is the verdict of runtime-control.mjs; when it
 * rejects the terminal (e.g. a well-formed but mismatching target) Greenfield
 * fails closed to BLOCKED instead of retiring or continuing.
 */
export function resolveGreenfieldControl({
  targetDisposition = "UNKNOWN",
  targetNextSuggestedAction = "",
  decision = null,
  nanoTask = null,
  sessionAction = "KEEP",
  terminalControl = null,
  // v1.9.3: reason of the previous turn's control decision.
  previousReason = ""
} = {}) {
  const target = upper(targetDisposition, "UNKNOWN");
  const nextSuggestedAction = trim(targetNextSuggestedAction);
  const handoff = eicHandoffWithoutNanoTask(targetNextSuggestedAction);
  const disposition = upper(decision?.disposition);
  const humanAuthorityRequired = decision?.humanAuthorityRequired === true;
  const nanoStatus = upper(nanoTask?.status);
  const session = upper(sessionAction, "KEEP");
  const terminal = terminalControl && typeof terminalControl === "object" && terminalControl.requested === true
    ? terminalControl
    : null;

  if (terminal && terminal.accepted !== true) {
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.BLOCK,
      reason: "RUNTIME_CONTROL_TERMINAL_REJECTED",
      errorCode: "RUNTIME_CONTROL_TERMINAL_REJECTED",
      hardStop: true,
      effectiveDisposition: "BLOCKED",
      effectiveNextPrompt: "",
      controllerOverride: true
    };
  }

  const structuredComplete = terminal?.source === "RUNTIME_CONTROL";

  if (session === "STOP_PROCESS") {
    return {
      state: GREENFIELD_STATES.DONE,
      action: GREENFIELD_ACTIONS.NONE,
      reason: structuredComplete ? "EIC_RUNTIME_CONTROL_COMPLETE_MISSION" : "EIC_EXPLICIT_STOP_PROCESS",
      hardStop: false,
      effectiveDisposition: "DONE",
      effectiveNextPrompt: "",
      controllerOverride: true
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
      reason: structuredComplete ? "EIC_RUNTIME_CONTROL_COMPLETE_MISSION" : "EIC_EXPLICIT_STATUS_DONE",
      hardStop: false,
      effectiveDisposition: "DONE",
      effectiveNextPrompt: "",
      controllerOverride: true
    };
  }

  // v1.9.3 (contract C14/F16): a prompt-only Nano task has no external
  // effect, so an unknown result is a missing advisory result, not a mission
  // blocker. It is never replayed (continuation-guard keeps NANO_TASK_REISSUE)
  // and the EIC continues from its own handoff.
  void nanoStatus;

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

  // v1.9.3: only the EIC closes a mission (status=DONE, STOP_PROCESS or an
  // accepted COMPLETE_MISSION, all handled above). The local advisory DONE
  // follows the EIC status instead.
  if (disposition === "DONE") {
    if (target === "BLOCKED") {
      return {
        state: GREENFIELD_STATES.ACTIVE,
        action: GREENFIELD_ACTIONS.BLOCK,
        reason: "ADVISORY_DONE_TARGET_BLOCKED",
        hardStop: true,
        effectiveDisposition: "BLOCKED",
        effectiveNextPrompt: "",
        controllerOverride: true
      };
    }
    if (handoff && target === "CONTINUE") {
      return {
        state: GREENFIELD_STATES.ACTIVE,
        action: GREENFIELD_ACTIONS.NEXT,
        reason: "ADVISORY_DONE_EIC_CONTINUES",
        hardStop: false,
        effectiveDisposition: "CONTINUE",
        effectiveNextPrompt: handoff,
        controllerOverride: true
      };
    }
    // Twice in a row without any EIC terminal status or handoff: the EIC is
    // not closing the mission and gives no next step; an operator decides
    // instead of an unbounded generic loop.
    if (upper(previousReason) === "ADVISORY_DONE_WITHOUT_EIC_TERMINAL") {
      return {
        state: GREENFIELD_STATES.ACTIVE,
        action: GREENFIELD_ACTIONS.BLOCK,
        reason: "ADVISORY_DONE_REPEATED_WITHOUT_EIC_TERMINAL",
        hardStop: true,
        effectiveDisposition: "BLOCKED",
        effectiveNextPrompt: "",
        controllerOverride: true
      };
    }
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.NEXT,
      reason: "ADVISORY_DONE_WITHOUT_EIC_TERMINAL",
      hardStop: false,
      effectiveDisposition: "CONTINUE",
      effectiveNextPrompt: handoff || ADVISORY_DONE_CONTINUATION,
      controllerOverride: true
    };
  }

  if (disposition === "BLOCKED") {
    if (target === "CONTINUE" && (handoff || nextSuggestedAction)) {
      return {
        state: GREENFIELD_STATES.ACTIVE,
        action: GREENFIELD_ACTIONS.NEXT,
        reason: "TARGET_CONTINUE_EXECUTABLE_NEXT_RECOVERY",
        hardStop: false,
        effectiveDisposition: "CONTINUE",
        // v1.9.3: a consumed NANO_TASK line is never sent back to the EIC.
        effectiveNextPrompt: handoff || nextSuggestedAction,
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

  // v1.9.3 (point 2): when the EIC answered with a structured CONTINUE and an
  // executable handoff, that handoff is the next objective verbatim. The local
  // model only previews 260 characters of it and may not rewrite the EIC's
  // slice plan (contract: the prompt engine is not a second semantic owner).
  // A requested Nano task keeps the local text, which carries its result.
  if (disposition === "CONTINUE" && target === "CONTINUE" && handoff && nanoTask?.requested !== true) {
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.NEXT,
      reason: "EIC_HANDOFF_FORWARDED",
      hardStop: false,
      effectiveDisposition: "CONTINUE",
      effectiveNextPrompt: handoff,
      handoffForwarded: true
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

function overriddenObjectiveStatus(decision, effectiveDisposition) {
  if (effectiveDisposition === "BLOCKED") return "BLOCKED";
  if (effectiveDisposition === "DONE") {
    const original = upper(decision?.objectiveStatus);
    return ["SATISFIED", "FAILED"].includes(original) ? original : "SATISFIED";
  }
  return "PENDING";
}

export function applyGreenfieldControlToDecision(decision, control) {
  const d = decision && typeof decision === "object" ? { ...decision } : {};
  if (control?.handoffForwarded === true && !control.controllerOverride) {
    const forwarded = trim(control.effectiveNextPrompt);
    if (!forwarded || forwarded === trim(d.nextPrompt)) return d;
    return {
      ...d,
      nextPrompt: forwarded,
      greenfieldHandoff: {
        reason: control.reason,
        advisoryNextPrompt: trim(d.nextPrompt).slice(0, 4000)
      }
    };
  }
  if (!control?.controllerOverride) return d;
  return {
    ...d,
    disposition: control.effectiveDisposition,
    objectiveStatus: overriddenObjectiveStatus(d, control.effectiveDisposition),
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
