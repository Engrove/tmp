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

function alternativeContinuationPrompt(currentObjective) {
  return [
    `[EIC alternative continuation ${shortFingerprint(currentObjective)}]`,
    "The previous continuation repeated the active objective and is not material progress.",
    "Continue the same mission by choosing exactly one materially different, bounded next step.",
    "Do not repeat the current objective or the previous nextSuggestedAction.",
    "Priority: (1) the next unmet dependency or acceptance criterion; (2) one discriminating owner read or test that can change the plan; (3) a non-conflicting parallel item.",
    "Preserve verified completed work and avoid replaying already-consumed effects.",
    "If no authorized alternative exists, return a concrete real blocker or DONE with evidence instead of repeating the prompt."
  ].join(" ");
}

function safeTargetAlternative(targetNextSuggestedAction, {
  currentObjective = "",
  previousPrompt = "",
  nanoTask = null
} = {}) {
  const target = String(targetNextSuggestedAction || "").trim();
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
  const target = String(targetNextSuggestedAction || "").trim();
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
  operatorInstructionPending = false
} = {}) {
  const disposition = String(decision?.disposition || "").toUpperCase();
  const nextPrompt = String(decision?.nextPrompt || "").trim();

  // A2A targetDisposition is advisory metadata only. Continuation admission is
  // decided by the controller/Hjalmar result plus runtime invariants, never by
  // protocol presence or protocol status alone.
  void targetDisposition;
  void operatorInstructionPending;

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
  if (nanoTask?.requested === true && /(^|\n)\s*NANO_TASK\s*:/i.test(nextPrompt)) {
    return {
      ok: false,
      code: "NANO_TASK_REISSUE",
      detail: "A Nano task requested by the current target response must be consumed locally, not sent back to the target as another Nano task directive."
    };
  }

  if (nanoTask?.requested === true &&
      ["PENDING", "RUNNING"].includes(String(nanoTask.status || "").toUpperCase()) &&
      disposition === "CONTINUE") {
    return {
      ok: false,
      code: "NANO_TASK_INCOMPLETE",
      detail: "A requested Nano task is still in progress and has no terminal result."
    };
  }

  if (nanoTask?.requested === true &&
      String(nanoTask.status || "").toUpperCase() === "UNKNOWN_EFFECT") {
    return {
      ok: false,
      code: "NANO_TASK_EFFECT_UNKNOWN",
      detail: "Exact-once Nano task effect is unknown; continuation is not safe without new local evidence."
    };
  }

  if (decision?.nanoTaskAssessment === "SATISFIED" &&
      (!nanoTask || nanoTask.requested !== true || nanoTask.status !== "COMPLETED")) {
    return {
      ok: false,
      code: "NANO_TASK_FALSE_SATISFIED",
      detail: "Hjalmar claimed Nano task satisfaction without a completed Nano task."
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
  const targetNext = norm(targetNextSuggestedAction);

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
    const effectiveNextPrompt = targetAlternative || alternativeContinuationPrompt(currentObjective);
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
    const effectiveNextPrompt = targetAlternative || alternativeContinuationPrompt(currentObjective || nextPrompt);
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
