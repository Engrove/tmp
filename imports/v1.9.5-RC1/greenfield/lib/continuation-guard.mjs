import { consumedNanoContinuation } from "./hjalmar-d2.mjs";

function norm(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function shortFingerprint(value) {
  const input = String(value || "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// v1.9.3: a NANO_TASK directive line is consumed locally and never re-sent.
function withoutNanoTaskLines(value) {
  return String(value || "")
    .split("\n")
    .filter((line) => !/^\s*NANO_TASK\s*:/i.test(line))
    .join("\n")
    .trim();
}

function alternativeContinuationPrompt(currentObjective, { queueManaged = false } = {}) {
  return [
    `[EIC alternative continuation ${shortFingerprint(currentObjective)}]`,
    "The previous continuation repeated the active objective and is not material progress.",
    "Continue the same mission by choosing exactly one materially different, bounded next step.",
    "Do not repeat the current objective or the previous nextSuggestedAction.",
    "Priority: (1) the next unmet dependency or acceptance criterion; (2) one discriminating owner read or test that can change the plan; (3) a non-conflicting parallel item.",
    "Preserve verified completed work and avoid replaying already-consumed effects.",
    // v1.9.3 (contract C18/C20/F18): no-delta work is status, not progress;
    // only controls offered by the current responseContract are named.
    queueManaged
      ? "If no authorized alternative exists, do not repeat the prompt: return a truthful no-delta status (with sessionAction YIELD_TO_QUEUE or BACKGROUND_SLEEP, or runtimeControl SET_SCHEDULE when time is the dependency), a concrete real blocker, or status=DONE only with supported terminal closure."
      : "If no authorized alternative exists, do not repeat the prompt: return a truthful no-delta status (with sessionAction PAUSE_PROCESS and pauseSeconds when time is the dependency), a concrete real blocker, or status=DONE only with supported terminal closure."
  ].join(" ");
}

function safeTargetAlternative(targetNextSuggestedAction, {
  currentObjective = "",
  previousPrompt = "",
  nanoTask = null
} = {}) {
  const target = withoutNanoTaskLines(targetNextSuggestedAction);
  if (!target) return "";
  const targetNorm = norm(target);
  if (!targetNorm ||
      targetNorm === norm(currentObjective) ||
      targetNorm === norm(previousPrompt)) {
    return "";
  }
  if (nanoTask?.requested === true && /(^|\n)\s*NANO_TASK\s*:/i.test(target)) {
    return "";
  }
  return target;
}


function recoverLossyPrefix(nextPrompt, targetNextSuggestedAction) {
  const candidate = String(nextPrompt || "").trim();
  const target = withoutNanoTaskLines(targetNextSuggestedAction);
  if (!candidate || !target) return "";
  const candidateNorm = norm(candidate);
  const targetNorm = norm(target);
  if (!candidateNorm || candidateNorm === targetNorm) return "";
  // A strict normalized prefix is objective evidence of information loss,
  // independent of any fixed character threshold or model-specific truncation.
  return targetNorm.startsWith(candidateNorm) ? target : "";
}

export function evaluateContinuationAdmission({
  targetDisposition = "UNKNOWN",
  currentObjective = "",
  targetNextSuggestedAction = "",
  previousDecision = null,
  decision = null,
  nanoTask = null,
  operatorInstructionPending = false,
  greenfieldControlReason = "",
  queueManaged = false
} = {}) {
  const disposition = String(decision?.disposition || "").toUpperCase();
  const nextPrompt = String(decision?.nextPrompt || "").trim();

  // A2A targetDisposition is advisory metadata only. Continuation admission is
  // decided by the controller/Hjalmar result plus runtime invariants, never by
  // protocol presence or protocol status alone.
  void targetDisposition;

  if (!["CONTINUE", "READ_REQUIRED"].includes(disposition)) {
    return { ok: true, code: "NO_CONTINUATION", effectiveNextPrompt: "" };
  }
  if (!nextPrompt) {
    return {
      ok: false,
      code: "NEXT_PROMPT_EMPTY",
      detail: "Continuation requires a next prompt."
    };
  }

  // Real exact-once / evidence boundaries are evaluated before recoverable
  // no-progress checks. A repeated prompt must never hide an unknown effect.
  // v1.9.3 (contract C14/F16): a consumed NANO_TASK directive is never sent
  // back to the EIC (no replay), and Nano bookkeeping never stops a mission:
  // the directive line is removed instead of blocking.
  if (nanoTask?.requested === true && /(^|\n)\s*NANO_TASK\s*:/i.test(nextPrompt)) {
    return {
      ok: true,
      code: "REPLANNED_NANO_TASK_DIRECTIVE_REMOVED",
      replanned: true,
      recoveryKind: "NANO_TASK_NOT_REISSUED",
      originalNextPrompt: nextPrompt,
      effectiveNextPrompt: withoutNanoTaskLines(nextPrompt) || consumedNanoContinuation(nanoTask),
      detail: "A Nano task requested by the current target response is consumed locally; its directive line was removed from the continuation instead of being sent back to the target."
    };
  }

  // v1.9.3 (contract C14/F16): a Nano task without a terminal or known result
  // (PENDING, RUNNING, UNKNOWN_EFFECT) is an absent prompt-only advisory
  // result. It is never replayed (directive removal above) and never blocks
  // the mission.

  if (decision?.nanoTaskAssessment === "SATISFIED" &&
      (!nanoTask || nanoTask.requested !== true || nanoTask.status !== "COMPLETED")) {
    return {
      ok: false,
      code: "NANO_TASK_FALSE_SATISFIED",
      detail: "Hjalmar claimed Nano task satisfaction without a completed Nano task."
    };
  }

  // An operator owns a new instruction even when the EIC again requests
  // closure. Its deferral objective intentionally repeats; preserve that
  // meaning after the Nano/evidence checks rather than calling it stale work.
  if (operatorInstructionPending === true &&
      greenfieldControlReason === "EIC_TERMINAL_DEFERRED_FOR_OPERATOR_INSTRUCTION") {
    return {
      ok: true, code: "OPERATOR_TERMINAL_DEFERRAL_ADMITTED",
      replanned: false, effectiveNextPrompt: nextPrompt
    };
  }

  const recoveredTargetPrompt = recoverLossyPrefix(nextPrompt, targetNextSuggestedAction);
  if (recoveredTargetPrompt) {
    return {
      ok: true,
      code: "REPLANNED_LOSSY_TARGET_PREFIX",
      replanned: true,
      recoveryKind: "TARGET_GUIDANCE_NON_LOSSY",
      originalNextPrompt: nextPrompt,
      effectiveNextPrompt: recoveredTargetPrompt,
      detail: "Candidate nextPrompt was a strict prefix of the full target continuation; controller preserved the complete target handoff."
    };
  }

  const candidate = norm(nextPrompt);
  const current = norm(currentObjective);
  const previousPrompt = String(previousDecision?.nextPrompt || "").trim();
  const previous = norm(previousPrompt);

  // Repetition is a liveness/no-progress condition, not a real owner/safety
  // boundary. Prefer materially newer target guidance; otherwise synthesize a
  // bounded replan instruction. The fingerprint guarantees that a repeated
  // recovery prompt itself produces a different next prompt rather than a loop.
  if (candidate && current && candidate === current) {
    const targetAlternative = safeTargetAlternative(targetNextSuggestedAction, {
      currentObjective,
      previousPrompt,
      nanoTask
    });
    const effectiveNextPrompt = targetAlternative || alternativeContinuationPrompt(currentObjective, { queueManaged });
    return {
      ok: true,
      code: "REPLANNED_STALE_OBJECTIVE_REPEAT",
      replanned: true,
      recoveryKind: targetAlternative ? "TARGET_GUIDANCE" : "DETERMINISTIC_ALTERNATIVE",
      originalNextPrompt: nextPrompt,
      effectiveNextPrompt,
      detail: "Candidate nextPrompt repeated the current objective; controller selected a materially different continuation instead of terminally blocking."
    };
  }

  if (candidate && previous && candidate === previous) {
    const targetAlternative = safeTargetAlternative(targetNextSuggestedAction, {
      currentObjective,
      previousPrompt: nextPrompt,
      nanoTask
    });
    const effectiveNextPrompt = targetAlternative || alternativeContinuationPrompt(currentObjective || nextPrompt, { queueManaged });
    return {
      ok: true,
      code: "REPLANNED_STALE_DECISION_REPEAT",
      replanned: true,
      recoveryKind: targetAlternative ? "TARGET_GUIDANCE" : "DETERMINISTIC_ALTERNATIVE",
      originalNextPrompt: nextPrompt,
      effectiveNextPrompt,
      detail: targetAlternative
        ? "Candidate repeated the previous Hjalmar prompt; controller adopted materially newer target guidance instead of repeating it."
        : "Candidate repeated the previous Hjalmar prompt; controller synthesized a materially different bounded continuation instead of repeating it."
    };
  }

  return {
    ok: true,
    code: "ADMISSIBLE",
    replanned: false,
    effectiveNextPrompt: nextPrompt
  };
}
