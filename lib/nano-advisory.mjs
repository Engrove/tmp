import { sanitizeText } from "./common.mjs";
import { MICRO_ACTION_IDS } from "./execution-routing.mjs";

export const NANO_ADVISORY_SCHEMA_ID = "eic.nano.advisory.v4";

/**
 * v0.12.6: Nano is a bounded semantic adviser, not a parallel controller.
 *
 * Keep the model contract deliberately small. `selectedActionId` is the only
 * control-shaped field and is still advisory: the runtime action catalog binds
 * the actual transition. `analysis` is the model's free semantic workspace.
 * `proposal` is optional because many local/wait actions need no new target text.
 */
export const NANO_ADVISORY_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "selectedActionId",
    "analysis"
  ],
  properties: {
    selectedActionId: { type: "string", enum: Object.values(MICRO_ACTION_IDS) },
    analysis: { type: "string", minLength: 1, maxLength: 4800 },
    proposal: { type: "string", maxLength: 3200 },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    uncertainty: { type: "string", maxLength: 1600 },
    evidenceNeed: { type: "string", maxLength: 1600 }
  }
});

function validAnalysisMode(value, fallback = "CONTINUATION_ANALYSIS") {
  const mode = sanitizeText(value, 80).toUpperCase();
  return ["TAKEOVER_BOOTSTRAP", "CONTINUATION_ANALYSIS", "OPERATOR_RESUME"].includes(mode)
    ? mode
    : fallback;
}

function validActionId(value) {
  const id = sanitizeText(value, 120).toUpperCase();
  return Object.values(MICRO_ACTION_IDS).includes(id) ? id : MICRO_ACTION_IDS.STOP;
}

export function normalizeNanoAdvisory(value = {}, {
  analysisMode = "CONTINUATION_ANALYSIS"
} = {}) {
  const selectedActionId = validActionId(value?.selectedActionId ?? value?.microActionId);
  const analysis = sanitizeText(
    value?.analysis ?? value?.rationale ?? value?.reason,
    4800
  );
  const proposal = sanitizeText(
    value?.proposal ?? value?.proposedAction ?? value?.requestedAction,
    3200
  );
  const confidence = ["HIGH", "MEDIUM", "LOW"].includes(
    sanitizeText(value?.confidence, 40).toUpperCase()
  )
    ? sanitizeText(value.confidence, 40).toUpperCase()
    : "MEDIUM";

  return {
    schema: NANO_ADVISORY_SCHEMA_ID,
    analysisMode: validAnalysisMode(analysisMode),
    selectedActionId,
    analysis: analysis || proposal || "Bounded runtime action selected.",
    proposal,
    confidence,
    uncertainty: sanitizeText(value?.uncertainty, 1600),
    evidenceNeed: sanitizeText(value?.evidenceNeed, 1600)
  };
}

/**
 * Compatibility projection for the existing controller pipeline.
 *
 * Nano supplies only an advisory. All transition membership, actor identity,
 * effect class, waits, completion, progress and safety policy remain
 * runtime-owned. These fields are intentionally neutral placeholders;
 * background.js resolves the actual execution plan before any effect.
 */
export function nanoAdvisoryToControllerDecision(value = {}, {
  analysisMode = "CONTINUATION_ANALYSIS"
} = {}) {
  const advisory = normalizeNanoAdvisory(value, { analysisMode });
  const semanticNext = advisory.proposal || advisory.analysis;

  return {
    nanoAdvisory: advisory,
    analysisMode: advisory.analysisMode,
    intent: semanticNext,
    taskIntent: semanticNext,
    // Advisory text never owns terminality. The runtime catalog resolves STOP,
    // WAIT or effect execution after this projection.
    action: "CONTINUE",
    progressDelta: 0,
    primaryProgramGoal: "",
    activeMilestone: "",
    boundedCurrentUnit: semanticNext,
    // Controller-owned fields are neutral at the model boundary.
    directProgramDelta: 0,
    requiredControl: false,
    omissionFailure: "",
    unlocksNextAction: "",
    evidenceClass: "LOCAL_CANDIDATE",
    completionState: "MILESTONE_CONTINUE",
    boundedStop: false,
    reason: advisory.analysis,
    workUnit: semanticNext,
    requestedAction: semanticNext,
    microActionId: advisory.selectedActionId,
    requiredEvidence: advisory.evidenceNeed ? [advisory.evidenceNeed] : [],
    verifiedFacts: [],
    targetClaims: [],
    inferences: [],
    contextEvidence: [],
    evidenceAnchors: [],
    attempts: [],
    blockers: [],
    alternatives: [],
    candidateSource: "NANO",
    candidateActions: [],
    selectionRelation: "PROPOSE_NEW",
    rejectedAlternatives: [],
    decisionBasis: advisory.analysis,
    criticalUncertainty: advisory.uncertainty,
    evidenceNeed: advisory.evidenceNeed,
    executorActor: "",
    stopCondition: "",
    noMaterialAlternative: false,
    continueCriteria: [],
    stopCriteria: [],
    completionEvidence: "",
    completionScope: "WORK_UNIT",
    completionConfirmed: false,
    pauseOrigin: "NONE",
    boundaryEvidence: "",
    ownerRoute: "",
    exactTarget: "",
    unlockEvent: "",
    hjalmarVerdict: "UNTRUSTED_MODEL_OUTPUT",
    hjalmarEvidenceLimit: "",
    trackControl: null,
    operatorCandidate: null,
    nanoConfidence: advisory.confidence
  };
}
