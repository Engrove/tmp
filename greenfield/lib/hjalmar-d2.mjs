import { ANALYSIS_SCHEMA } from "./contracts.mjs";
import { text } from "./common.mjs";
import { GREENFIELD_MIXED_LANGUAGE_PROMPT_RULE } from "./language-contract.mjs";

export const DISPOSITIONS = Object.freeze({
  CONTINUE: "CONTINUE",
  READ_REQUIRED: "READ_REQUIRED",
  DONE: "DONE",
  BLOCKED: "BLOCKED"
});

export const TARGET_DISPOSITIONS = Object.freeze([
  "CONTINUE",
  "DONE",
  "BLOCKED",
  "UNKNOWN"
]);

export const OBJECTIVE_STATUSES = Object.freeze([
  "PENDING",
  "SATISFIED",
  "FAILED",
  "BLOCKED"
]);

export const NANO_TASK_ASSESSMENTS = Object.freeze([
  "NOT_REQUESTED",
  "SATISFIED",
  "UNSATISFIED",
  "UNVERIFIED",
  "CONTEXT_REQUIRED",
  "FAILED"
]);

export const ANALYSIS_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "disposition",
    "targetDisposition",
    "objectiveStatus",
    "nanoTaskAssessment",
    "progressEvidence",
    "analysis",
    "nextPrompt",
    "exactTarget",
    "ownerEvidence",
    "reversibility",
    "rollbackPath",
    "readbackPlan",
    "materialAmbiguity",
    "humanAuthorityRequired",
    "confidence"
  ],
  properties: {
    schema: { type: "string", enum: [ANALYSIS_SCHEMA] },
    disposition: { type: "string", enum: Object.values(DISPOSITIONS) },
    targetDisposition: { type: "string", enum: TARGET_DISPOSITIONS },
    objectiveStatus: { type: "string", enum: OBJECTIVE_STATUSES },
    nanoTaskAssessment: { type: "string", enum: NANO_TASK_ASSESSMENTS },
    progressEvidence: { type: "string", minLength: 1, maxLength: 3000 },
    analysis: { type: "string", minLength: 1, maxLength: 5000 },
    nextPrompt: { type: "string", maxLength: 120000 },
    exactTarget: { type: "string", minLength: 1, maxLength: 1000 },
    ownerEvidence: { type: "string", minLength: 1, maxLength: 3000 },
    reversibility: { type: "string", enum: ["YES", "NO", "UNKNOWN"] },
    rollbackPath: { type: "string", minLength: 1, maxLength: 2000 },
    readbackPlan: { type: "string", minLength: 1, maxLength: 2000 },
    materialAmbiguity: { type: "string", minLength: 1, maxLength: 2000 },
    humanAuthorityRequired: { type: "boolean" },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] }
  }
});

function known(value) {
  const v = String(value || "").trim();
  return Boolean(v && !/^(UNKNOWN|NONE|N\/A)$/i.test(v));
}

export function validateHjalmarDecision(value) {
  const errors = [];
  const d = value && typeof value === "object" ? value : {};
  if (d.schema !== ANALYSIS_SCHEMA) errors.push("SCHEMA");
  if (!Object.values(DISPOSITIONS).includes(d.disposition)) errors.push("DISPOSITION");
  if (!TARGET_DISPOSITIONS.includes(d.targetDisposition)) errors.push("TARGET_DISPOSITION");
  if (!OBJECTIVE_STATUSES.includes(d.objectiveStatus)) errors.push("OBJECTIVE_STATUS");
  if (!NANO_TASK_ASSESSMENTS.includes(d.nanoTaskAssessment)) errors.push("NANO_TASK_ASSESSMENT");
  if (!known(d.progressEvidence)) errors.push("PROGRESS_EVIDENCE");
  if (!known(d.analysis)) errors.push("ANALYSIS");
  if (!known(d.exactTarget)) errors.push("EXACT_TARGET");
  if (!known(d.ownerEvidence)) errors.push("OWNER_EVIDENCE");
  if (!["YES", "NO", "UNKNOWN"].includes(d.reversibility)) errors.push("REVERSIBILITY");
  if (!known(d.rollbackPath)) errors.push("ROLLBACK_PATH");
  if (!known(d.readbackPlan)) errors.push("READBACK_PLAN");
  if (!String(d.materialAmbiguity || "").trim()) errors.push("MATERIAL_AMBIGUITY");
  if (typeof d.humanAuthorityRequired !== "boolean") errors.push("HUMAN_AUTHORITY");
  if (!["HIGH", "MEDIUM", "LOW"].includes(d.confidence)) errors.push("CONFIDENCE");

  if ([DISPOSITIONS.CONTINUE, DISPOSITIONS.READ_REQUIRED].includes(d.disposition) &&
      !String(d.nextPrompt || "").trim()) {
    errors.push("NEXT_PROMPT_REQUIRED");
  }
  if ([DISPOSITIONS.DONE, DISPOSITIONS.BLOCKED].includes(d.disposition) &&
      String(d.nextPrompt || "").trim()) {
    errors.push("NEXT_PROMPT_MUST_BE_EMPTY");
  }
  if (d.humanAuthorityRequired === true && d.disposition !== DISPOSITIONS.BLOCKED) {
    errors.push("HUMAN_AUTHORITY_MUST_BLOCK");
  }
  if (d.disposition === DISPOSITIONS.CONTINUE &&
      String(d.materialAmbiguity || "").trim().toUpperCase() !== "NONE") {
    errors.push("AMBIGUITY_REQUIRES_READ");
  }

  return { ok: errors.length === 0, errors };
}

export function normalizeHjalmarDecision(value) {
  return {
    schema: ANALYSIS_SCHEMA,
    disposition: String(value?.disposition || "").toUpperCase(),
    targetDisposition: String(value?.targetDisposition || "UNKNOWN").toUpperCase(),
    objectiveStatus: String(value?.objectiveStatus || "PENDING").toUpperCase(),
    nanoTaskAssessment: String(value?.nanoTaskAssessment || "NOT_REQUESTED").toUpperCase(),
    progressEvidence: text(value?.progressEvidence, 3000),
    analysis: text(value?.analysis, 5000),
    nextPrompt: text(value?.nextPrompt, 120000),
    exactTarget: text(value?.exactTarget, 1000),
    ownerEvidence: text(value?.ownerEvidence, 3000),
    reversibility: String(value?.reversibility || "UNKNOWN").toUpperCase(),
    rollbackPath: text(value?.rollbackPath, 2000),
    readbackPlan: text(value?.readbackPlan, 2000),
    materialAmbiguity: text(value?.materialAmbiguity, 2000) || "UNKNOWN",
    humanAuthorityRequired: value?.humanAuthorityRequired === true,
    confidence: String(value?.confidence || "LOW").toUpperCase()
  };
}


export function runtimeNanoTaskAssessment(nanoTask) {
  if (!nanoTask?.requested) return "NOT_REQUESTED";
  const status = String(nanoTask.status || "").toUpperCase();
  const semantic = String(nanoTask.semanticStatus || "UNVERIFIED").toUpperCase();
  if (status === "CONTEXT_REQUIRED") return "CONTEXT_REQUIRED";
  if (status === "FAILED") return "FAILED";
  if (status === "UNKNOWN_EFFECT") return "UNVERIFIED";
  if (status === "COMPLETED") {
    if (semantic === "SATISFIED") return "SATISFIED";
    if (semantic === "UNSATISFIED") return "UNSATISFIED";
  }
  // Generic completed tasks remain UNVERIFIED unless a deterministic verifier
  // can prove their requested output semantics.
  return "UNVERIFIED";
}

function containsNanoTaskDirective(value) {
  return /(^|\n)\s*NANO_TASK\s*:/i.test(String(value || ""));
}

function consumedNanoContinuation(nanoTask) {
  const status = String(nanoTask?.status || "").toUpperCase();
  if (status === "CONTEXT_REQUIRED") {
    return [
      "The previous Nano directive was not executable as a prompt-closed task because required context was absent from its single prompt.",
      "Continue the objective in EIC using the required owner/context data, or construct a new Nano task that embeds every required input inline.",
      "Do not replay the same missing-context Nano directive."
    ].join(" ");
  }
  if (status === "FAILED") {
    return [
      "The local Nano task requested by the previous target response was consumed and failed.",
      "Continue the current objective using the bounded Nano failure evidence attached to this continuation.",
      "Do not request the same Nano task again."
    ].join(" ");
  }
  return [
    "The local Nano task requested by the previous target response completed exactly once.",
    "Continue the current objective using the bounded analysisEvidence attached to this continuation.",
    "Do not request the same Nano task again."
  ].join(" ");
}

export function reconcileHjalmarRuntimeFacts(decision, {
  targetDisposition = "UNKNOWN",
  nanoTask = null,
  operatorInstructionPending = false
} = {}) {
  const d = normalizeHjalmarDecision(decision);
  const corrections = [];
  const target = String(targetDisposition || "UNKNOWN").toUpperCase();
  const runtimeAssessment = runtimeNanoTaskAssessment(nanoTask);

  if (target !== "UNKNOWN" && d.targetDisposition !== target) {
    corrections.push({
      code: "TARGET_DISPOSITION_RUNTIME_OVERRIDE",
      from: d.targetDisposition,
      to: target
    });
    d.targetDisposition = target;
  }

  if (d.nanoTaskAssessment !== runtimeAssessment) {
    corrections.push({
      code: "NANO_TASK_ASSESSMENT_RUNTIME_OVERRIDE",
      from: d.nanoTaskAssessment,
      to: runtimeAssessment
    });
    d.nanoTaskAssessment = runtimeAssessment;
  }

  const taskStatus = String(nanoTask?.status || "").toUpperCase();
  if (nanoTask?.requested === true &&
      ["COMPLETED", "CONTEXT_REQUIRED", "FAILED"].includes(taskStatus) &&
      containsNanoTaskDirective(d.nextPrompt)) {
    const replacement = consumedNanoContinuation(nanoTask);
    corrections.push({
      code: "CONSUMED_NANO_TASK_DIRECTIVE_REMOVED",
      from: text(d.nextPrompt, 4000),
      to: replacement
    });
    d.nextPrompt = replacement;
  }

  // Missing prompt context is a Nano capability-boundary result, not a mission
  // blocker. EIC still owns the surrounding objective and may read the needed
  // owner data itself or author a new, fully prompt-closed Nano task.
  if (nanoTask?.requested === true && taskStatus === "CONTEXT_REQUIRED") {
    const replacement = String(d.nextPrompt || "").trim() || consumedNanoContinuation(nanoTask);
    if (d.disposition !== DISPOSITIONS.CONTINUE ||
        d.objectiveStatus === "BLOCKED" ||
        !String(d.nextPrompt || "").trim()) {
      corrections.push({
        code: "NANO_TASK_CONTEXT_REQUIRED_CONTINUATION_OVERRIDE",
        from: {
          disposition: d.disposition,
          objectiveStatus: d.objectiveStatus,
          nextPrompt: text(d.nextPrompt, 4000)
        },
        to: {
          disposition: DISPOSITIONS.CONTINUE,
          objectiveStatus: "PENDING",
          nextPrompt: replacement
        }
      });
    }
    d.disposition = DISPOSITIONS.CONTINUE;
    d.objectiveStatus = "PENDING";
    d.nextPrompt = replacement;
  }

  // UNKNOWN_EFFECT is a real exact-once ambiguity. It cannot be repaired by
  // sending the task back to the target or asking Hjalmar to guess.
  if (nanoTask?.requested === true && taskStatus === "UNKNOWN_EFFECT") {
    if (d.disposition !== DISPOSITIONS.BLOCKED ||
        d.objectiveStatus !== "BLOCKED" ||
        String(d.nextPrompt || "").trim()) {
      corrections.push({ code: "NANO_TASK_UNKNOWN_EFFECT_RUNTIME_OVERRIDE" });
    }
    d.disposition = DISPOSITIONS.BLOCKED;
    d.objectiveStatus = "BLOCKED";
    d.nextPrompt = "";
  }

  return {
    decision: d,
    corrections,
    runtimeNanoTaskAssessment: runtimeAssessment
  };
}

export function validateHjalmarEvidenceBinding(decision, {
  targetDisposition = "UNKNOWN",
  nanoTask = null,
  operatorInstructionPending = false
} = {}) {
  const d = decision && typeof decision === "object" ? decision : {};
  const errors = [];
  const target = String(targetDisposition || "UNKNOWN").toUpperCase();

  if (target !== "UNKNOWN" && d.targetDisposition !== target) {
    errors.push("TARGET_DISPOSITION_MISMATCH");
  }
  if (!nanoTask?.requested) {
    if (d.nanoTaskAssessment !== "NOT_REQUESTED") errors.push("NANO_TASK_NOT_REQUESTED");
  } else if (nanoTask.status === "CONTEXT_REQUIRED") {
    if (d.nanoTaskAssessment !== "CONTEXT_REQUIRED") errors.push("NANO_TASK_CONTEXT_REQUIRED_MISMATCH");
  } else if (nanoTask.status === "FAILED") {
    if (d.nanoTaskAssessment !== "FAILED") errors.push("NANO_TASK_FAILED_MISMATCH");
  } else if (nanoTask.status === "UNKNOWN_EFFECT") {
    if (d.nanoTaskAssessment === "SATISFIED") errors.push("NANO_TASK_FALSE_SATISFIED");
  } else if (nanoTask.status === "COMPLETED" && String(nanoTask.result || "").trim()) {
    const runtimeAssessment = runtimeNanoTaskAssessment(nanoTask);
    if (d.nanoTaskAssessment === "NOT_REQUESTED") errors.push("NANO_TASK_REQUESTED_MISMATCH");
    if (d.nanoTaskAssessment === "FAILED") errors.push("NANO_TASK_COMPLETED_MISMATCH");
    if (["SATISFIED", "UNSATISFIED"].includes(runtimeAssessment) &&
        d.nanoTaskAssessment !== runtimeAssessment) {
      errors.push("NANO_TASK_SEMANTIC_MISMATCH");
    }
  } else {
    if (d.nanoTaskAssessment === "SATISFIED") errors.push("NANO_TASK_FALSE_SATISFIED");
  }

  return { ok: errors.length === 0, errors };
}

function compactHjalmarTarget(value) {
  if (!value || typeof value !== "object") return null;
  return {
    status: String(value.status || "UNKNOWN").toUpperCase(),
    summary: text(value.summary, 170),
    blockers: Array.isArray(value.blockers)
      ? value.blockers.slice(0, 2).map((item) => text(item, 60)).filter(Boolean)
      : [],
    // Hjalmar is a bounded advisory surface. Keep a compact preview here, but
    // expose whether it is complete. The controller retains the canonical
    // target handoff and continuation-guard restores it if an advisory output
    // is only a strict prefix, so execution never depends on this preview.
    nextSuggestedAction: text(value.nextSuggestedAction, 260),
    nextSuggestedActionLength: String(value.nextSuggestedAction || "").length,
    nextSuggestedActionComplete: String(value.nextSuggestedAction || "").length <= 260,
    schemaDegraded: value.schemaDegraded === true
  };
}

function compactHjalmarNanoTask(value) {
  if (!value?.requested) return null;
  return {
    requestId: text(value.requestId, 120),
    status: String(value.status || "UNKNOWN").toUpperCase(),
    semanticStatus: String(value.semanticStatus || "UNVERIFIED").toUpperCase(),
    sourceTask: text(value.sourceTask || value.task, 180),
    result: text(value.result, 220),
    error: text(value.error, 120),
    knowledgeBoundary: text(value.knowledgeBoundary, 32) || "PROMPT_ONLY",
    promptClosure: value.promptClosure && typeof value.promptClosure === "object"
      ? {
          ok: value.promptClosure.ok === true,
          format: text(value.promptClosure.format, 32),
          reasons: Array.isArray(value.promptClosure.reasons)
            ? value.promptClosure.reasons.slice(0, 3).map((item) => text(item, 60)).filter(Boolean)
            : []
        }
      : null
  };
}

function compactNanoObservation(value) {
  if (!value || typeof value !== "object") return null;
  return {
    summary: text(value.summary, 170),
    materialFacts: Array.isArray(value.materialFacts)
      ? value.materialFacts.slice(0, 3).map((item) => text(item, 80)).filter(Boolean)
      : [],
    uncertainties: Array.isArray(value.uncertainties)
      ? value.uncertainties.slice(0, 2).map((item) => text(item, 80)).filter(Boolean)
      : [],
    continuityRisk: text(value.continuityRisk, 40),
    recommendedFocus: text(value.recommendedFocus, 170),
    confidence: text(value.confidence, 20),
    knowledgeBoundary: text(value.knowledgeBoundary, 32) || "PROMPT_ONLY",
    inputScope: text(value.inputScope, 80) || "BOUNDED_PROMPT_FIELDS_ONLY"
  };
}

function compactPreviousDecision(value) {
  if (!value || typeof value !== "object") return null;
  return {
    disposition: text(value.disposition, 40),
    objectiveStatus: text(value.objectiveStatus, 40),
    progressEvidence: text(value.progressEvidence, 170),
    nextPrompt: text(value.nextPrompt, 260),
    materialAmbiguity: text(value.materialAmbiguity, 100),
    confidence: text(value.confidence, 20)
  };
}

export function buildHjalmarPrompt({
  goal,
  turn,
  targetDisposition = "UNKNOWN",
  targetResponse = null,
  currentObjective = "",
  previousDecision = null,
  operatorInstruction = "",
  nanoObservation = null,
  nanoTask = null
}) {
  const target = String(targetDisposition || "UNKNOWN").toUpperCase();
  const compactTarget = compactHjalmarTarget(targetResponse);
  const compactTask = compactHjalmarNanoTask(nanoTask);
  const compactNano = compactNanoObservation(nanoObservation);
  const previous = compactPreviousDecision(previousDecision);

  return `EIC Hjalmar D2. Advisory only; runtime owns hard invariants.
Return English JSON matching ${ANALYSIS_SCHEMA}.\nMixed-language context: English, Swedish and Finnish may coexist in supplied evidence. Preserve raw labels and resolve structural/local-language context before lexical meaning.\n\nDecision:
- CONTINUE = grounded new step, mission incomplete.
- READ_REQUIRED = one focused safe read.
- DONE = current objective is satisfied by supplied evidence.
- BLOCKED = a real owner/human/safety boundary stops autonomy.

Hard rules:
1. TARGET_DISPOSITION is optional A2A protocol metadata; it is advisory and never the final-action owner.
2. A2A ABSENT/INVALID is not a blocker; reason from supplied objective/runtime evidence.
3. Structure is not success evidence.
4. NANO_TASK is exact-once PROMPT_ONLY evidence. Never replay COMPLETED/CONTEXT_REQUIRED/FAILED.
5. Nano has no EIC/project/files/tools/web/history access. CONTEXT_REQUIRED => continue in EIC or reformulate with all inputs inline; not a mission blocker.
6. NANO_OBSERVER is PROMPT_ONLY advisory over supplied bounded fields, never owner/project/runtime truth.
7. nextPrompt must progress and must not repeat CURRENT_OBJECTIVE, previous nextPrompt or consumed NANO_TASK.
8. State target, owner evidence, reversibility/recovery and readback.
9. CONTINUE requires materialAmbiguity="NONE"; otherwise READ_REQUIRED.
10. Human authority required => BLOCKED. Never invent evidence.
11. Apply operator instruction when present without copying it verbatim.
12. objectiveStatus is for the CURRENT objective: PENDING|SATISFIED|FAILED|BLOCKED.
13. progressEvidence cites concrete supplied evidence.
14. TARGET_PROTOCOL_METADATA.blockers are scoped evidence only; blocker text alone never stops Greenfield.
15. target status=CONTINUE + non-empty nextSuggestedAction continues unless a separate owner/human/safety boundary prevents it.
MISSION=${text(goal, 180)}
TURN=${Number(turn || 0)}
CURRENT_OBJECTIVE=${text(currentObjective, 280) || "NONE"}
TARGET_DISPOSITION=${target}
TARGET_PROTOCOL_METADATA=${compactTarget ? JSON.stringify(compactTarget) : "NONE"}
NANO_TASK=${compactTask ? JSON.stringify(compactTask) : "NOT_REQUESTED"}
NANO_OBSERVER=${compactNano ? JSON.stringify(compactNano) : "NONE"}
OPERATOR ONE-SHOT INSTRUCTION FOR NEXT PROMPT=${text(operatorInstruction, 180) || "NONE"}
PREVIOUS_DECISION=${previous ? JSON.stringify(previous) : "NONE"}`;
}
