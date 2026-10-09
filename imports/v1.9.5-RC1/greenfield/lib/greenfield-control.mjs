import { consumedNanoContinuation } from "./hjalmar-d2.mjs";

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

// v1.9.3: objective when an EIC terminal arrives while an operator instruction
// is pending; the instruction itself is attached to the same prompt.
export const TERMINAL_DEFERRED_CONTINUATION = "Your previous response requested terminal closure, but an operator instruction queued before it is attached to this prompt and takes precedence. Apply that instruction first against fresh owner state. Afterwards return status=DONE again only if supported owner-verified terminal closure still holds; otherwise continue with the next single bounded slice.";

// v1.9.3: objective when a session control (rotation or queue yield) or an
// advisory BLOCKED recovery carries neither an EIC handoff nor a usable local
// prompt. The EIC resumes from fresh owner state; nothing waits for a person.
export const OWNER_RESUME_CONTINUATION = "Re-read fresh owner state and continue the current mission with the next single bounded slice. If no executable slice remains, return a truthful no-delta status with a restart-safe nextSuggestedAction, a concrete real blocker, or status=DONE only with supported owner-verified terminal closure.";

// v1.9.3: no operator is present in a GFW session. A local DONE repeated
// without EIC terminal status or handoff is a no-delta state, not a stop:
// Greenfield pauses (a queue slot is paused and the next runnable slot runs;
// a mission without a queue gets a timed process pause) and then asks the EIC
// again. The pause doubles per repeat, the same shape as the recovery backoff
// (15 min doubling to 6 h).
export const ADVISORY_NO_DELTA_PAUSE_BASE_SECONDS = 15 * 60;
export const ADVISORY_NO_DELTA_PAUSE_MAX_SECONDS = 6 * 60 * 60;
const ADVISORY_DONE_REASONS = new Set(["ADVISORY_DONE_WITHOUT_EIC_TERMINAL", "ADVISORY_DONE_NO_DELTA_PAUSE"]);

// The prompt sent after the pause names the pause, so consecutive no-delta
// prompts differ and the EIC sees why Greenfield waited.
export function advisoryNoDeltaResumePrompt({ streak = 1, pauseSeconds = ADVISORY_NO_DELTA_PAUSE_BASE_SECONDS, cause = "" } = {}) {
  const observation = cause === "EIC_BLOCKED"
    ? "Your previous response reported status=BLOCKED. Re-check that blocker against fresh owner state."
    : "The previous responses supplied no new handoff or owner-reported work/evidence, and Greenfield observed no new committed runtime effect. Re-read fresh owner state.";
  return `Greenfield no-delta pause ${Math.max(1, Math.floor(Number(streak) || 1))} (${Math.round(Number(pauseSeconds) || 0)} s) has ended. ${observation} If the mission is complete, return status=DONE with supported owner-verified terminal closure. Otherwise continue with the next single bounded slice, or return a truthful no-delta status (with a session control your responseContract offers) and a restart-safe nextSuggestedAction.`;
}

export function advisoryNoDeltaPauseSeconds(streak) {
  const n = Math.max(1, Math.floor(Number(streak) || 1));
  return Math.min(ADVISORY_NO_DELTA_PAUSE_MAX_SECONDS, ADVISORY_NO_DELTA_PAUSE_BASE_SECONDS * (2 ** Math.min(5, n - 1)));
}

// Fallback objective without any NANO_TASK directive: a consumed Nano task
// gets its own resume text, otherwise the given default.
function fallbackObjective(nanoTask, fallback) {
  return nanoTask?.requested === true ? consumedNanoContinuation(nanoTask) : fallback;
}

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
  // v1.9.3: the previous turn's control decision (reason, no-delta streak).
  previousReason = "",
  previousNoDeltaStreak = 0,
  // Persisted pacing policy, independent of advisory model availability.
  noDeltaPause = null,
  noDeltaObserved = false,
  // Runtime-proven standalone context. Omitted for queue decisions and legacy
  // callers; a local advisory blocker must not weaken an effect/owner fence.
  standaloneAdvisoryRetry = null,
  // v1.9.3: a one-shot operator instruction is waiting for the next prompt.
  operatorInstructionPending = false
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
  const terminalRequested = session === "STOP_PROCESS" || (
    target === "DONE" && !["ROTATE_SESSION_NOW", "YIELD_TO_QUEUE"].includes(session)
  );

  // v1.9.3: operator input outranks an AI terminal control (contract
  // precedence). The terminal is not committed; the pending instruction rides
  // on the next prompt and the EIC re-confirms closure afterwards. Before
  // 1.9.3 this case looped in technical recovery without applying either.
  if (terminalRequested && operatorInstructionPending === true) {
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.NEXT,
      reason: "EIC_TERMINAL_DEFERRED_FOR_OPERATOR_INSTRUCTION",
      deferredTerminalReason: structuredComplete
        ? "EIC_RUNTIME_CONTROL_COMPLETE_MISSION"
        : session === "STOP_PROCESS" ? "EIC_EXPLICIT_STOP_PROCESS" : "EIC_EXPLICIT_STATUS_DONE",
      hardStop: false,
      effectiveDisposition: "CONTINUE",
      effectiveNextPrompt: TERMINAL_DEFERRED_CONTINUATION,
      controllerOverride: true
    };
  }

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

  const standaloneLocalBlocker = standaloneAdvisoryRetry && disposition === "BLOCKED" &&
    ["CONTINUE", "UNKNOWN"].includes(target) && !nextSuggestedAction &&
    session === "KEEP" && !terminal && !humanAuthorityRequired;
  if (standaloneLocalBlocker) {
    // Classify before ordinary no-delta pacing, which may already be armed.
    // No timer can turn an ambiguous dispatch or owner decision into permission.
    if (standaloneAdvisoryRetry.allowed !== true || decision?.humanAuthorityRequired !== false ||
        upper(decision?.reversibility) !== "YES" || upper(decision?.materialAmbiguity) !== "NONE") {
      return {
        state: GREENFIELD_STATES.ACTIVE, action: GREENFIELD_ACTIONS.BLOCK,
        reason: "NO_EXECUTABLE_AUTONOMOUS_NEXT_STEP", hardStop: true,
        effectiveDisposition: "BLOCKED", effectiveNextPrompt: ""
      };
    }
    if (operatorInstructionPending) {
      return {
        state: GREENFIELD_STATES.ACTIVE, action: GREENFIELD_ACTIONS.NEXT,
        reason: "LOCAL_ADVISORY_BLOCKED_OPERATOR_CONTINUATION", hardStop: false,
        effectiveDisposition: "CONTINUE", effectiveNextPrompt: OWNER_RESUME_CONTINUATION,
        controllerOverride: true
      };
    }
    const previous = standaloneAdvisoryRetry.previous;
    const priorCount = Number(previous?.streak);
    const priorStreak = Number.isFinite(priorCount)
      ? Math.max(0, Math.min(1_000_000, Math.floor(priorCount))) : 0;
    const sameResponse = Boolean(standaloneAdvisoryRetry.responseId &&
      previous?.responseId === standaloneAdvisoryRetry.responseId);
    const streak = sameResponse ? Math.max(1, priorStreak) : Math.min(1_000_000, priorStreak + 1);
    const pauseSeconds = Math.min(ADVISORY_NO_DELTA_PAUSE_MAX_SECONDS,
      Math.max(advisoryNoDeltaPauseSeconds(streak), Number(noDeltaPause?.pauseSeconds) || 0));
    return {
      state: GREENFIELD_STATES.ACTIVE, action: GREENFIELD_ACTIONS.NEXT,
      reason: "LOCAL_ADVISORY_BLOCKED_RETRY_PAUSE", hardStop: false,
      effectiveDisposition: "CONTINUE", controllerOverride: true,
      effectiveNextPrompt: `Local advisory blocker retry ${streak}: Greenfield scheduled ${pauseSeconds} s before this owner-state recheck because its local advisory analysis supplied no executable continuation. Re-read fresh owner state. Continue only with a newly authorized, bounded next slice. Preserve completed work and do not replay effects whose result is uncertain. If preconditions remain unsatisfied, report the blocker truthfully; return status=DONE only with supported owner-verified terminal closure.`,
      noDeltaPause: { streak, pauseSeconds, cause: "LOCAL_ADVISORY_BLOCKED" },
      advisoryBlockedRetry: { streak, responseId: String(standaloneAdvisoryRetry.responseId || "") }
    };
  }

  // EIC BLOCKED retries are timed even if Hjalmar is unavailable or says
  // CONTINUE. A session rotation/yield cannot bypass the persisted backoff.
  const pacingPause = operatorInstructionPending || humanAuthorityRequired || target === "DONE" ? null : noDeltaPause || (target === "BLOCKED" ? {
    streak: Math.max(1, Math.floor(Number(previousNoDeltaStreak) || 0) + 1),
    pauseSeconds: advisoryNoDeltaPauseSeconds(Number(previousNoDeltaStreak || 0) + 1),
    cause: "EIC_BLOCKED"
  } : null);
  if (pacingPause) {
    return {
      state: GREENFIELD_STATES.ACTIVE, action: GREENFIELD_ACTIONS.NEXT,
      reason: target === "BLOCKED" ? "EIC_BLOCKED_RETRY_PAUSE"
        : disposition === "DONE" && !handoff ? "ADVISORY_DONE_NO_DELTA_PAUSE" : "EIC_NO_DELTA_PAUSE",
      hardStop: false, effectiveDisposition: "CONTINUE",
      effectiveNextPrompt: handoff || advisoryNoDeltaResumePrompt(pacingPause),
      controllerOverride: true, noDeltaPause: pacingPause
    };
  }

  // v1.9.3: an explicit rotation or queue yield keeps its session effect, but
  // the objective follows the same rules as without it: only the EIC closes a
  // mission (a local DONE or BLOCKED is advisory), the EIC's own handoff is
  // forwarded verbatim, and a consumed NANO_TASK line is never re-sent.
  if (session === "ROTATE_SESSION_NOW" || session === "YIELD_TO_QUEUE") {
    const reason = session === "ROTATE_SESSION_NOW" ? "EIC_EXPLICIT_SESSION_ROTATION" : "EIC_EXPLICIT_QUEUE_YIELD";
    if (!["CONTINUE", "READ_REQUIRED"].includes(disposition)) {
      return {
        state: GREENFIELD_STATES.ACTIVE,
        action: GREENFIELD_ACTIONS.NEXT,
        reason,
        hardStop: false,
        effectiveDisposition: "CONTINUE",
        effectiveNextPrompt: handoff || fallbackObjective(nanoTask,
          disposition === "DONE" ? ADVISORY_DONE_CONTINUATION : OWNER_RESUME_CONTINUATION),
        controllerOverride: true
      };
    }
    const localPrompt = trim(decision?.nextPrompt);
    if (handoff && target === "CONTINUE") {
      return {
        state: GREENFIELD_STATES.ACTIVE,
        action: GREENFIELD_ACTIONS.NEXT,
        reason,
        hardStop: false,
        effectiveDisposition: disposition,
        effectiveNextPrompt: handoff,
        handoffForwarded: true
      };
    }
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.NEXT,
      reason,
      hardStop: false,
      effectiveDisposition: disposition,
      effectiveNextPrompt: localPrompt || handoff || fallbackObjective(nanoTask, OWNER_RESUME_CONTINUATION),
      ...(localPrompt ? {} : { handoffForwarded: true })
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
    // Repeated without any EIC terminal status or handoff: no delta. Pause
    // and ask again; no operator is present to decide.
    if (!noDeltaObserved && !operatorInstructionPending && ADVISORY_DONE_REASONS.has(upper(previousReason))) {
      const streak = upper(previousReason) === "ADVISORY_DONE_NO_DELTA_PAUSE"
        ? Math.max(1, Math.floor(Number(previousNoDeltaStreak) || 1)) + 1
        : 1;
      const noDeltaPause = { streak, pauseSeconds: advisoryNoDeltaPauseSeconds(streak) };
      return {
        state: GREENFIELD_STATES.ACTIVE,
        action: GREENFIELD_ACTIONS.NEXT,
        reason: "ADVISORY_DONE_NO_DELTA_PAUSE",
        hardStop: false,
        effectiveDisposition: "CONTINUE",
        effectiveNextPrompt: advisoryNoDeltaResumePrompt(noDeltaPause),
        controllerOverride: true,
        noDeltaPause
      };
    }
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.NEXT,
      reason: "ADVISORY_DONE_WITHOUT_EIC_TERMINAL",
      hardStop: false,
      effectiveDisposition: "CONTINUE",
      effectiveNextPrompt: handoff || fallbackObjective(nanoTask, ADVISORY_DONE_CONTINUATION),
      controllerOverride: true
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
        // v1.9.3: a consumed NANO_TASK line is never sent back to the EIC; a
        // handoff that was only that line resumes from the Nano outcome.
        effectiveNextPrompt: handoff || fallbackObjective(nanoTask, OWNER_RESUME_CONTINUATION),
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
  // A Nano result travels separately in analysisEvidence.nanoTask, and an
  // advisory READ_REQUIRED keeps its message type around the EIC's slice.
  if (["CONTINUE", "READ_REQUIRED"].includes(disposition) && target === "CONTINUE" && handoff) {
    return {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.NEXT,
      reason: "EIC_HANDOFF_FORWARDED",
      hardStop: false,
      effectiveDisposition: disposition,
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
