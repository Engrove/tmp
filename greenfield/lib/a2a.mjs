import {
  A2A_MESSAGE_SCHEMA,
  A2A_PROTOCOL,
  A2A_RESPONSE_SCHEMA,
  APP_NAME,
  APP_VERSION
} from "./contracts.mjs";
import { nowIso, randomId, text } from "./common.mjs";
import { languageContextCapsule } from "./language-contract.mjs";
import {
  MISSION_PAUSE_ACTION,
  MISSION_PAUSE_MAX_SECONDS,
  MISSION_PAUSE_MIN_SECONDS
} from "./mission-pause.mjs";
import { sessionHealthCapsule } from "./session-health.mjs";
import { queueTurnControl } from "./mission-work-queue.mjs";
import {
  MAX_RESPONSE_MISSION_DELEGATIONS,
  MISSION_DELEGATION_RELATION
} from "./mission-delegation.mjs";
import {
  RUNTIME_CONTROL_COMPACT_REMINDER,
  runtimeControlContract,
  runtimeControlJsonSchema,
  runtimeControlPromptState
} from "./runtime-control.mjs";
import {
  EIC_LEARNING_CONTROL_CONTRACT,
  LEARNING_CONTEXT_SCHEMA,
  LEARNING_CONTROL_COMPACT_REMINDER,
  LEARNING_CONTROL_RESULT_JSON_SCHEMA,
  buildLearningControlContext
} from "./learning-control.mjs";
import {
  FULL_PROMPT_REFRESH_INTERVAL,
  PROMPT_PROFILE,
  PROMPT_PROFILE_SCHEMA,
  missionFingerprint
} from "./prompt-profile.mjs";

export const A2A_MESSAGE_TYPES = Object.freeze([
  "MISSION_START",
  // Queue activation of a slot that carries a resume objective without a
  // same-worker process snapshot. background.js has emitted this type since the
  // v1.7.x queue restore path; v1.7.7 admits it instead of failing the envelope.
  "MISSION_RESTORE",
  "CONTINUATION",
  "READ_REQUIRED",
  "IDLE_KEEPALIVE",
  "SESSION_ROTATION"
]);

export const A2A_OWNER_STATE_CURRENT_FOCUS_RULE = "OWNER_STATE / CURRENT_FOCUS CONTRACT. Before selecting the first bounded work package, read fresh subject-project owner state. When project-bound, read and reconcile project.current_focus as STEERING_POINTER_NOT_FACT_OWNER. If current_focus conflicts with newer exact owner evidence, the newer owner evidence governs. Do not repeat a completed objective/effect merely because current_focus is stale. Update current_focus only when a material steering/restart state has changed; a current_focus write is complete only after owner readback. If current_focus cannot be written but safe work can continue, preserve the restart pointer through another correct durable owner/chronology route, route the metadata defect to its owner, do not blind-retry, and do not block unrelated safe work. Before any material effect, revalidate the exact effect target and owner. Before pause/yield/block/done/handoff, persist material mission state and update current_focus only if the restart/lead state materially changed. The same objective/effect probe must not repeat without a material owner-state delta.";

export const A2A_OWNER_STATE_CURRENT_FOCUS_CONTRACT = Object.freeze({
  subjectProjectOwnerState: "FRESH_READ_BEFORE_FIRST_BOUNDED_WORK_PACKAGE",
  currentFocus: Object.freeze({
    role: "STEERING_POINTER_NOT_FACT_OWNER",
    readReconcileWhenProjectBound: true,
    conflictRule: "NEWER_EXACT_OWNER_EVIDENCE_WINS",
    writeWhen: "MATERIAL_STEERING_OR_RESTART_DELTA_ONLY",
    noWriteWithoutMaterialDelta: true,
    writeReadbackRequired: true,
    writeUnavailable: "PERSIST_RESTART_POINTER_THROUGH_CORRECT_DURABLE_OWNER_OR_CHRONOLOGY;ROUTE_METADATA_DEFECT_TO_OWNER;NO_BLIND_RETRY;CONTINUE_UNRELATED_SAFE_WORK"
  }),
  completedEffectReplayFromStaleFocus: false,
  beforeMaterialEffect: "REVALIDATE_EXACT_EFFECT_OWNER_AND_TARGET",
  handoff: "PERSIST_MATERIAL_MISSION_STATE;UPDATE_CURRENT_FOCUS_ONLY_ON_MATERIAL_RESTART_DELTA",
  repeatProbe: "SAME_OBJECTIVE_OR_EFFECT_REQUIRES_MATERIAL_OWNER_STATE_DELTA"
});

export const A2A_RUNTIME_CONTROL_NOTE = "Optional runtimeControl requests typed runtime effects on the current GFW (responseContract.runtimeControlContract, control.runtimeControl): copy control.runtimeControl.target verbatim; Greenfield validates every request, may accept or reject it, reports receipts in the next prompt, and operator runtime control always wins. status=DONE or sessionAction=STOP_PROCESS is normalized to COMPLETE_MISSION for this prompt's own target. Runtime effects never come from prose.";

export const A2A_LEARNING_CONTROL_NOTE = "Retained learning is governed by responseContract.learningControlContract (EIC Learning & Continuity Control Contract) and the per-prompt control.learningControl obligations decided by Greenfield: execute every REQUIRED check or report its scoped unavailable outcome, report outcomes in the optional learningControl response field, and never let AIK, Memory or lessons replace fresh factual-owner truth.";

export const A2A_PROMPT_PROFILE_NOTE = `Greenfield prompts carry promptProfile. FULL prompts contain the complete session-wide contract and are sent at every session boundary (new chat, rotation, queue activation, conversation change) and every ${FULL_PROMPT_REFRESH_INTERVAL}th prompt. A page reload of the same conversation is not a boundary because the conversation keeps its history. COMPACT follow-up prompts in the same ChatGPT conversation omit unchanged session-wide sections, which stay fully in force from the most recent FULL prompt; per-turn state in a COMPACT prompt is current and authoritative. greenfieldStatusRequest=FULL_NEXT_PROMPT also makes the next prompt FULL.`;

function promptProfileCapsule(profile) {
  const p = profile && typeof profile === "object" ? profile : null;
  const isCompact = p?.profile === PROMPT_PROFILE.COMPACT;
  return {
    schema: PROMPT_PROFILE_SCHEMA,
    profile: isCompact ? PROMPT_PROFILE.COMPACT : PROMPT_PROFILE.FULL,
    ordinal: Math.max(1, Math.floor(Number(p?.ordinal) || 1)),
    lastFullOrdinal: Math.max(1, Math.floor(Number(p?.lastFullOrdinal) || 1)),
    nextFullOrdinal: Math.max(2, Math.floor(Number(p?.nextFullOrdinal) || FULL_PROMPT_REFRESH_INTERVAL + 1)),
    refreshInterval: FULL_PROMPT_REFRESH_INTERVAL,
    reason: text(p?.reason || "SESSION_BOUNDARY_OR_DEFAULT", 120),
    rule: isCompact
      ? "COMPACT prompt. Sections omitted here are unchanged from the most recent FULL Greenfield prompt in this ChatGPT conversation (ordinal lastFullOrdinal) and remain fully in force. Every per-turn field present here is current and authoritative."
      : "FULL prompt. This envelope carries the complete session-wide contract. Later prompts in this same conversation may be COMPACT."
  };
}

const COMPACT_WORK_QUEUE_STATIC_FIELDS = Object.freeze([
  "checkpointInstruction",
  "schedulerMode",
  "orderRule",
  "quantumRule",
  "priorityRule",
  "duplicateRule",
  "loopRule"
]);

// A COMPACT envelope is derived from the FULL envelope built from the same
// inputs, so per-turn state is byte-identical and only unchanged session-wide
// sections are replaced by references.
function compactEnvelope(full, profile) {
  const workQueue = full.control.workQueue ? { ...full.control.workQueue } : null;
  if (workQueue) {
    for (const key of COMPACT_WORK_QUEUE_STATIC_FIELDS) {
      if (key === "checkpointInstruction" && workQueue.checkpointRequired === true) continue;
      delete workQueue[key];
    }
  }
  const fingerprint = text(profile?.missionFingerprint || missionFingerprint(full.mission), 64);
  return {
    ...full,
    sender: {
      actor: full.sender.actor,
      applicationId: full.sender.applicationId,
      name: full.sender.name,
      version: full.sender.version,
      role: full.sender.role
    },
    languageContext: {
      schema: full.languageContext.schema,
      internalControlLanguage: full.languageContext.internalControlLanguage,
      a2aLanguage: full.languageContext.a2aLanguage,
      profile: "UNCHANGED_FROM_LAST_FULL_PROMPT"
    },
    mission: `UNCHANGED: identical to the mission text of the most recent FULL Greenfield prompt in this ChatGPT conversation (missionFingerprint=${fingerprint}).`,
    control: {
      selfContinuationAuthority: full.control.selfContinuationAuthority,
      ownerState: full.control.ownerState,
      ...(workQueue ? { workQueue } : {}),
      runtimeControl: full.control.runtimeControl,
      learningControl: full.control.learningControl
    },
    responseContract: {
      ownerStateRule: full.responseContract.ownerStateRule,
      schema: full.responseContract.schema,
      format: full.responseContract.format,
      language: full.responseContract.language,
      profile: "COMPACT_REFERENCE",
      rule: "The complete responseContract (jsonSchema, session/queue/pause/delegation/Nano/status controls, runtimeControlContract and note) from the most recent FULL prompt in this conversation remains fully in force; it is omitted here only to avoid repetition.",
      runtimeControl: RUNTIME_CONTROL_COMPACT_REMINDER,
      learningControl: LEARNING_CONTROL_COMPACT_REMINDER
    }
  };
}

export function initialMissionObjective() {
  return "Start the mission from fresh subject-project owner state. When project-bound, reconcile project.current_focus as a steering/restart pointer, never factual authority. Select and execute the first bounded work package within mission scope, then continue autonomously.";
}

export const A2A_RESPONSE_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "status",
    "summary",
    "workPerformed",
    "evidence",
    "blockers",
    "nextSuggestedAction"
  ],
  properties: {
    schema: { type: "string", enum: [A2A_RESPONSE_SCHEMA] },
    status: { type: "string", enum: ["CONTINUE", "DONE", "BLOCKED"] },
    sessionAction: { type: "string", enum: ["KEEP", "ROTATE_SESSION_NOW", MISSION_PAUSE_ACTION, "STOP_PROCESS"] },
    greenfieldStatusRequest: { type: "string", enum: ["FULL_NEXT_PROMPT"] },
    sessionReason: { type: "string", maxLength: 2000 },
    pauseSeconds: {
      type: "integer",
      minimum: MISSION_PAUSE_MIN_SECONDS,
      maximum: MISSION_PAUSE_MAX_SECONDS
    },
    summary: { type: "string", minLength: 1, maxLength: 12000 },
    workPerformed: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1, maxLength: 4000 }
    },
    evidence: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1, maxLength: 4000 }
    },
    blockers: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 4000 }
    },
    nextSuggestedAction: { type: "string", maxLength: 12000 },
    runtimeControl: runtimeControlJsonSchema({ queueManaged: false }),
    learningControl: LEARNING_CONTROL_RESULT_JSON_SCHEMA
  }
});

export const A2A_ENVELOPE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "schema", "protocol", "messageType", "messageId", "correlationId",
    "objectiveId", "process", "sender", "recipient", "languageContext", "mission", "objective",
    "operatorInstruction", "analysisEvidence", "processStatus", "continuity", "control", "sessionHealth", "responseContract"
  ],
  properties: {
    schema: { type: "string", enum: [A2A_MESSAGE_SCHEMA] },
    protocol: { type: "string", enum: [A2A_PROTOCOL] },
    messageType: { type: "string", enum: A2A_MESSAGE_TYPES },
    messageId: { type: "string", minLength: 1 },
    correlationId: { type: "string", minLength: 1 },
    objectiveId: { type: "string", minLength: 1 },
    process: { type: "object" },
    sender: { type: "object" },
    recipient: { type: "object" },
    languageContext: { type: "object" },
    mission: { type: "string", minLength: 1 },
    objective: { type: "string", minLength: 1 },
    operatorInstruction: { type: ["object", "null"] },
    analysisEvidence: { type: ["object", "null"] },
    processStatus: { type: ["object", "null"] },
    continuity: { type: "object" },
    control: { type: "object" },
    sessionHealth: { type: "object" },
    responseContract: { type: "object" },
    promptProfile: { type: "object" }
  }
});

function cleanInstruction(value) {
  if (!value?.text) return null;
  return {
    instructionId: text(value.instructionId, 200),
    text: text(value.text, 12000),
    oneShot: true
  };
}

function cleanAnalysisEvidence(value) {
  if (!value || typeof value !== "object") return null;
  const nanoTask = value.nanoTask && typeof value.nanoTask === "object"
    ? {
        requestId: text(value.nanoTask.requestId, 200),
        status: text(value.nanoTask.status, 64),
        semanticStatus: text(value.nanoTask.semanticStatus, 64),
        result: text(value.nanoTask.result, 4000),
        error: text(value.nanoTask.error, 2000),
        promptLanguage: text(value.nanoTask.promptLanguage, 32),
        promptPolicy: text(value.nanoTask.promptPolicy, 128),
        knowledgeBoundary: text(value.nanoTask.knowledgeBoundary, 32) || "PROMPT_ONLY",
        promptClosure: value.nanoTask.promptClosure && typeof value.nanoTask.promptClosure === "object"
          ? {
              ok: value.nanoTask.promptClosure.ok === true,
              format: text(value.nanoTask.promptClosure.format, 32),
              reasons: Array.isArray(value.nanoTask.promptClosure.reasons)
                ? value.nanoTask.promptClosure.reasons.slice(0, 4).map((item) => text(item, 100)).filter(Boolean)
                : []
            }
          : null
      }
    : null;
  const nano = value.nano && typeof value.nano === "object"
    ? {
        summary: text(value.nano.summary, 2000),
        confidence: text(value.nano.confidence, 32),
        continuityRisk: text(value.nano.continuityRisk, 32),
        knowledgeBoundary: text(value.nano.knowledgeBoundary, 32) || "PROMPT_ONLY",
        inputScope: text(value.nano.inputScope, 100) || "BOUNDED_PROMPT_FIELDS_ONLY"
      }
    : null;
  const hjalmar = value.hjalmar && typeof value.hjalmar === "object"
    ? {
        disposition: text(value.hjalmar.disposition, 64),
        targetDisposition: text(value.hjalmar.targetDisposition, 64),
        objectiveStatus: text(value.hjalmar.objectiveStatus, 64),
        nanoTaskAssessment: text(value.hjalmar.nanoTaskAssessment, 64),
        progressEvidence: text(value.hjalmar.progressEvidence, 3000),
        runtimeCorrections: Array.isArray(value.hjalmar.runtimeCorrections)
          ? value.hjalmar.runtimeCorrections.slice(0, 20).map((item) => text(item, 200))
          : []
      }
    : null;
  const responseObservation = value.responseObservation && typeof value.responseObservation === "object"
    ? {
        documentId: text(value.responseObservation.documentId, 200),
        messageId: text(value.responseObservation.messageId, 300),
        ownerKind: text(value.responseObservation.ownerKind, 100),
        ownerTrusted: value.responseObservation.ownerTrusted === true,
        ownerAdmissionMode: text(value.responseObservation.ownerAdmissionMode, 100),
        assistantReplicaCount: Number(value.responseObservation.assistantReplicaCount || 0),
        expectedUserTurnId: text(value.responseObservation.expectedUserTurnId, 300),
        pairedUserTurnId: text(value.responseObservation.pairedUserTurnId, 300),
        pairedUserResolvedBy: text(value.responseObservation.pairedUserResolvedBy, 100),
        causalMatch: value.responseObservation.causalMatch === true,
        visibilityState: text(value.responseObservation.visibilityState, 40),
        textLength: Number(value.responseObservation.textLength || 0),
        assistantCount: Number(value.responseObservation.assistantCount || 0),
        parseMode: text(value.responseObservation.parseMode, 100),
        externalInterleave: value.responseObservation.externalInterleave &&
            typeof value.responseObservation.externalInterleave === "object"
          ? {
              observed: value.responseObservation.externalInterleave.observed === true,
              latestUserTurnId: text(value.responseObservation.externalInterleave.latestUserTurnId, 300),
              latestAssistantTurnId: text(value.responseObservation.externalInterleave.latestAssistantTurnId, 300),
              autonomousUserTurnId: text(value.responseObservation.externalInterleave.autonomousUserTurnId, 300),
              autonomousAssistantTurnId: text(value.responseObservation.externalInterleave.autonomousAssistantTurnId, 300),
              admissibleAsAutonomousResponse:
                value.responseObservation.externalInterleave.admissibleAsAutonomousResponse === true,
              observedAt: text(value.responseObservation.externalInterleave.observedAt, 100)
            }
          : {
              observed: false,
              latestUserTurnId: "",
              latestAssistantTurnId: "",
              autonomousUserTurnId: "",
              autonomousAssistantTurnId: "",
              admissibleAsAutonomousResponse: false,
              observedAt: ""
            }
      }
    : null;
  const protocol = value.protocol && typeof value.protocol === "object"
    ? {
        found: value.protocol.found === true,
        fullSchemaValid: value.protocol.fullSchemaValid === true,
        controlValid: value.protocol.controlValid === true,
        disposition: text(value.protocol.disposition, 64) || "UNKNOWN",
        sessionAction: text(value.protocol.sessionAction, 64) || "KEEP",
        sessionReason: text(value.protocol.sessionReason, 1200),
        pauseSeconds: Number.isInteger(value.protocol.pauseSeconds) ? value.protocol.pauseSeconds : null,
        parseMode: text(value.protocol.parseMode, 100) || "NONE",
        errors: Array.isArray(value.protocol.errors)
          ? value.protocol.errors.slice(0, 12).map((item) => text(item, 200)).filter(Boolean)
          : []
      }
    : null;
  return {
    responseHash: text(value.responseHash, 128),
    targetDisposition: text(value.targetDisposition, 64) || "UNKNOWN",
    responseObservation,
    protocol,
    nanoTask,
    nano,
    hjalmar
  };
}

export function buildA2AEnvelope({
  process,
  objective,
  objectiveId = "",
  messageType = "CONTINUATION",
  operatorInstruction = null,
  previousResponseHash = "",
  previousDisposition = "",
  analysisEvidence = null,
  processStatus = null,
  sessionRotation = null,
  pauseResume = null,
  promptProfile = null,
  at = Date.now()
}) {
  if (!process?.processId || !process?.runId) throw new Error("A2A_PROCESS_REQUIRED");
  const mission = text(process.goal, 120000).trim();
  const task = text(objective, 120000).trim();
  if (!mission) throw new Error("A2A_MISSION_REQUIRED");
  if (!task) throw new Error("A2A_OBJECTIVE_REQUIRED");
  if (!A2A_MESSAGE_TYPES.includes(messageType)) throw new Error("A2A_MESSAGE_TYPE_INVALID");
  const workQueue = queueTurnControl(process);
  const responseJsonSchema = workQueue
    ? {
        ...A2A_RESPONSE_JSON_SCHEMA,
        properties: {
          ...A2A_RESPONSE_JSON_SCHEMA.properties,
          sessionAction: {
            ...A2A_RESPONSE_JSON_SCHEMA.properties.sessionAction,
            enum: [
              ...A2A_RESPONSE_JSON_SCHEMA.properties.sessionAction.enum.slice(0, -1),
              "BACKGROUND_SLEEP",
              "YIELD_TO_QUEUE",
              A2A_RESPONSE_JSON_SCHEMA.properties.sessionAction.enum.at(-1)
            ]
          },
          missionDelegations: {
            type: "array",
            maxItems: MAX_RESPONSE_MISSION_DELEGATIONS,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["requestId", "mission", "priority", "relation"],
              properties: {
                requestId: { type: "string", minLength: 1, maxLength: 200 },
                label: { type: "string", maxLength: 200 },
                mission: { type: "string", minLength: 1, maxLength: 120000 },
                priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
                relation: {
                  type: "string",
                  enum: [
                    MISSION_DELEGATION_RELATION.SUPPORTS_CURRENT,
                    MISSION_DELEGATION_RELATION.UNBLOCKS_CURRENT
                  ]
                }
              }
            }
          },
          runtimeControl: runtimeControlJsonSchema({ queueManaged: true })
        }
      }
    : A2A_RESPONSE_JSON_SCHEMA;

  const envelope = {
    schema: A2A_MESSAGE_SCHEMA,
    protocol: A2A_PROTOCOL,
    messageType,
    messageId: randomId("a2a"),
    correlationId: process.runId,
    objectiveId: text(objectiveId, 200) || randomId("objective"),
    process: {
      processId: process.processId,
      runId: process.runId,
      generation: process.generation,
      turn: process.turn,
      sessionSeq: Number(process.sessionSeq || 1),
      windowBinding: "ONE_MANAGED_TAB_PER_CHROME_WINDOW"
    },
    sender: {
      actor: "AGENT",
      applicationId: "GREENFIELD",
      name: APP_NAME,
      version: APP_VERSION,
      role: "AUTONOMOUS_CONTINUITY_CONTROLLER",
      presentation: {
        purpose: "Keep this operator-owned mission progressing autonomously across recoverable ChatGPT session boundaries.",
        loop: ["SEND", "WAIT", "CAPTURE", "NANO", "HJALMAR_D2", "CONTINUE"],
        policy: "Hjalmar D2 is fixed. Audit is mandatory. No runtime mode selection exists.",
        authorityBoundary: "This envelope grants no authority beyond the operator mission and the capabilities available to the receiving EIC session. Session rotation never widens authorization."
      }
    },
    recipient: {
      actor: "EIC_AI_SESSION",
      role: "TARGET_SESSION"
    },
    languageContext: languageContextCapsule(),
    mission,
    objective: task,
    operatorInstruction: cleanInstruction(operatorInstruction),
    analysisEvidence: cleanAnalysisEvidence(analysisEvidence),
    processStatus: processStatus && typeof processStatus === "object" ? processStatus : null,
    continuity: {
      previousResponseHash: text(previousResponseHash, 128),
      // Controller disposition for the previous completed autonomous turn.
      // Structured target protocol status is carried separately as analysisEvidence.protocol.
      previousDisposition: text(previousDisposition, 64),
      continuityPriority: true,
      responseCompletionIndependentOfProtocol: true,
      sessionRotation: sessionRotation && typeof sessionRotation === "object" ? {
        rotationId: text(sessionRotation.rotationId, 200),
        sessionSeq: Number(sessionRotation.sessionSeq || process.sessionSeq || 1),
        reasonCode: text(sessionRotation.reasonCode, 200),
        reason: text(sessionRotation.reason, 2000),
        requestedBy: text(sessionRotation.requestedBy, 100),
        sourceResponseState: text(sessionRotation.sourceResponseState, 100),
        resumeFromOwners: true,
        replayCompletedWork: false,
        newChatContinuation: true
      } : null,
      pauseResume: pauseResume && typeof pauseResume === "object" ? {
        pauseId: text(pauseResume.pauseId, 200),
        requestedSeconds: Number(pauseResume.requestedSeconds || 0),
        resumeNotBeforeAt: text(pauseResume.resumeNotBeforeAt, 100),
        reason: text(pauseResume.reason, 1200),
        timing: "NOT_BEFORE_BEST_EFFORT",
        independentOfGlobalPromptPostGate: true
      } : null
    },
    control: {
      failureAcceptance: {
        failureIsValid: true,
        blockerIsValid: true,
        truthfulNonCompletionBeforeApparentSuccess: true,
        neverFabricate: [
          "file_read",
          "command_or_test_execution",
          "evidence",
          "completion",
          "verification",
          "system_state"
        ]
      },
      claimBoundary: {
        noExternalEvidenceNoStrongClaim: true,
        noExecutionReceiptNoExecutionClaim: true,
        noReadableOwnerSourceNoSourceInspectionClaim: true,
        noSufficientEvidenceNoPassCompleteClaim: true
      },
      sourceInferenceSeparation: true,
      ownerState: A2A_OWNER_STATE_CURRENT_FOCUS_CONTRACT,
      selfContinuationAuthority: false,
      ...(workQueue ? {
        workQueue: {
          ...workQueue,
          checkpointInstruction: "QUEUE CHECKPOINT RULE. If checkpointRequired=true OR you are about to return status=DONE, status=BLOCKED, sessionAction=BACKGROUND_SLEEP, sessionAction=YIELD_TO_QUEUE, sessionAction=PAUSE_PROCESS, or sessionAction=STOP_PROCESS, this response is the last response Greenfield may use from this ChatGPT conversation. Before returning, persist every durable mission-status item needed for later continuation to its correct owner surface: material progress, decisions, true blockers, evidence/locator pointers, and reusable knowledge only when its actual owner is appropriate. Use route-native write/readback when available. Do not dump transient chat text or hidden reasoning. For CONTINUE/YIELD/PAUSE, return nextSuggestedAction as a restart-safe fresh-session handoff that does not replay completed work.",
          schedulerMode: "ORDERED_CYCLIC_SLOTS",
          orderRule: "The explicit queue slot order is authoritative inside this Greenfield worker. After a slot yields, pauses, blocks, reaches its quantum or terminates, continue from the next runnable slot in order and wrap after the last slot. Do not reorder the inner queue by priority.",
          quantumRule: "maxInteractions is a per-slot quantum. Early yield/pause/block preserves the slot's unfinished quantum progress; only completion of that quantum resets the slot counter for its next cycle.",
          priorityRule: "A slot's priority becomes the profile-global capacity-scheduler priority while that slot is active. Priority does not change the explicit ordering of slots inside this worker queue.",
          duplicateRule: "The same saved GFW may exist in multiple queue slots with independent itemId, position, priority and maxInteractions. savedMissionId identifies shared logical mission continuity across those slots.",
          loopRule: "The queue keeps cycling while enabled and at least one runnable slot remains. status=DONE or STOP_PROCESS closes the logical saved GFW and retires all of its duplicate slots; operator queue edits/stops remain authoritative runtime controls. runtimeControl COMPLETE_MISSION is the structured form of that same terminal effect; SET_QUANTUM and SET_PRIORITY change only the target slot."
        }
      } : {}),
      runtimeControl: runtimeControlPromptState(process),
      learningControl: buildLearningControlContext({
        process,
        messageType,
        previousDisposition,
        analysisEvidence,
        sessionRotation,
        operatorInstruction,
        checkpointRequired: workQueue?.checkpointRequired === true
      })
    },
    sessionHealth: sessionHealthCapsule(process.sessionHealth, {
      turn: process.turn,
      sessionSeq: process.sessionSeq,
      sessionStartTurn: process.turn
    }),
    responseContract: {
      ownerStateRule: A2A_OWNER_STATE_CURRENT_FOCUS_RULE,
      schema: A2A_RESPONSE_SCHEMA,
      format: "JSON",
      language: "en",
      operatorFacingLanguage: "preserve_operator_language_when_practical",
      mixedLanguageExpected: true,
      ambientLanguages: ["en", "sv", "fi"],
      rawEvidenceLanguage: "preserve",
      nanoTaskLanguage: "en",
      nanoTaskExecutionPolicy: "PROMPT_CLOSED_EXECUTION_V2",
      nanoTaskKnowledgeBoundary: "PROMPT_ONLY",
      nanoTaskCapabilities: {
        eicState: false,
        projectState: false,
        files: false,
        tools: false,
        browser: false,
        web: false,
        api: false,
        chatHistory: false,
        previousTurns: false,
        hiddenContext: false,
        reasoningDepth: "MODEL_CAPABILITY_NOT_ARTIFICIALLY_LIMITED"
      },
      nanoTaskAdmission: {
        invariant: "Every fact/data item required for the Nano answer must be present in the single NANO_TASK prompt itself.",
        complexityRule: "Do not reject a Nano task merely because it is analytically difficult; reject or keep it in EIC when it depends on information not embedded in the prompt.",
        structuredRequestSchema: "eic.greenfield.nano-task.request.v2",
        structuredFields: ["schema", "knowledgeBoundary", "instruction", "context", "output"],
        contextFailureSignal: "NANO_CONTEXT_REQUIRED:"
      },
      pauseControl: {
        action: MISSION_PAUSE_ACTION,
        pauseSecondsMin: MISSION_PAUSE_MIN_SECONDS,
        pauseSecondsMax: MISSION_PAUSE_MAX_SECONDS,
        semantics: workQueue
          ? "Use only when time itself is the next dependency. In queue-managed mode Greenfield checkpoints and sleeps this logical GFW until its not-before time, then immediately advances to the next runnable queue slot; only when no other slot is runnable does the worker itself pause. This is independent of the global 0-300 s prompt-post gate."
          : "Use only when time itself is the next dependency. Greenfield pauses before the next autonomous ChatGPT post and resumes automatically; this is independent of the global 0-300 s prompt-post gate."
      },
      ...(workQueue ? {
        queueControl: {
          actions: ["BACKGROUND_SLEEP", "YIELD_TO_QUEUE"],
          action: "YIELD_TO_QUEUE",
          available: true,
          scheduling: "ORDERED_CYCLIC_SLOTS",
          backgroundSleepSemantics: "BACKGROUND_SLEEP with pauseSeconds 300..86400 checkpoints the logical saved GFW, pauses all duplicate slots of that GFW until its not-before time, and immediately advances to the next runnable queue slot. If no other slot is runnable, Greenfield falls back to a normal timed process pause.",
          pauseProcessSemantics: "PAUSE_PROCESS uses the same non-blocking queue-local behavior when this process is queue-managed: checkpoint the logical GFW, preserve unfinished quantum progress, pause its duplicate slots and advance in queue order when another runnable slot exists.",
          staleSessionSemantics: "If no completed response is captured within 120 minutes (Greenfield reloads the same conversation at 30, 60 and 90 minutes), Greenfield abandons that conversation, parks this slot with its unfinished quantum (the unanswered turn is not counted) and advances to the next runnable queue slot in explicit order; with no other runnable slot it rotates this GFW into a fresh chat. A GFW resumed after this carries continuity.previousDisposition=SESSION_UNRESPONSIVE and continuity.sessionRotation.sourceResponseState=PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE: the abandoned prompt's effects are unknown, so re-read owner state before any effect and never assume it completed. Keep each response well inside this bound.",
          semantics: "YIELD_TO_QUEUE checkpoints the current slot and advances to the next runnable slot in explicit order. Greenfield auto-yields when that slot reaches maxInteractions, resets only that completed slot quantum, and wraps cyclically after the last runnable slot. Early yield/pause/block preserves unfinished quantum progress. Slot priority is used only by the profile-global capacity scheduler while active and does not reorder this worker's queue. status must be CONTINUE and nextSuggestedAction must be a restart-safe handoff."
        },
        missionDelegationControl: {
          field: "missionDelegations",
          maxItemsPerResponse: MAX_RESPONSE_MISSION_DELEGATIONS,
          target: "ANOTHER_LIVE_QUEUE_MANAGED_GREENFIELD_WORKER",
          supervisorSelfCreation: false,
          sourceContinuesByDefault: true,
          noWorkerFallback: "PERSIST_PENDING_NEVER_SELF_CREATE",
          temporaryWorkRule: "Temporary bounded work that genuinely belongs inside the supervising Greenfield mission may still be performed in the supervising Chrome session. Use missionDelegations only for durable schedulable follow-up missions.",
          idempotency: "requestId must remain stable across retries for the same logical delegated mission.",
          priorityRule: "Browser clamps delegated mission priority so it can never exceed the source mission priority.",
          relationSemantics: {
            SUPPORTS_CURRENT: "Delegate durable supporting work while the supervising mission continues normally.",
            UNBLOCKS_CURRENT: "Delegate work intended to remove a blocker; if the supervising queue item becomes BLOCKED, child DONE may make it immediately retryable."
          }
        }
      } : {}),
      processStatusControl: {
        field: "greenfieldStatusRequest",
        request: "FULL_NEXT_PROMPT",
        semantics: "Set greenfieldStatusRequest=FULL_NEXT_PROMPT in a valid EIC-A2A response when the receiving EIC needs a bounded full Greenfield control-plane status capsule. Greenfield will include processStatus in this same logical GFW's next prompt. The request is one-shot and follows the mission across queue parking/rotation; it is never leaked to another queued GFW.",
        promptProfileEffect: "FULL_NEXT_PROMPT also forces the next prompt to promptProfile=FULL with the complete session-wide contract."
      },
      runtimeControlContract: runtimeControlContract({ queueManaged: Boolean(workQueue) }),
      learningControlContract: EIC_LEARNING_CONTROL_CONTRACT,
      sessionHealthControl: {
        telemetry: "ADVISORY_PROXY_NOT_TOKEN_COUNT",
        responseRoundTrip: "sessionHealth.responseRoundTripMs and control.workQueue.responseRoundTripApproxMs are browser-observed approximate prompt-post-to-completed-response timings, not provider billing or server compute time.",
        queueLoopRoundTrip: "control.workQueue.loopRoundTripApproxMs is the approximate elapsed browser time from the prior departure of this exact queue slot until its next activation. It includes time spent on other slots and waits.",
        decision: "Corroborate pressure with semantic drift, repetition, contradiction or stale assumptions before ROTATE_SESSION_NOW; Nano may provide a prompt-only second opinion when ambiguity remains."
      },
      jsonSchema: responseJsonSchema,
      note: [workQueue
        ? "Return the requested work truthfully. Structured EIC-A2A response JSON is preferred but optional for ordinary continuation. Continuation decisions do not depend on protocol presence. Optional sessionAction is a separate machine control: KEEP (default), ROTATE_SESSION_NOW for a fresh EIC chat, PAUSE_PROCESS with integer pauseSeconds 300..86400 to checkpoint/sleep this logical GFW and advance to the next runnable queue slot when available, BACKGROUND_SLEEP with integer pauseSeconds 300..86400 to do the same explicit background sleep, YIELD_TO_QUEUE to checkpoint and advance this queued slot, or STOP_PROCESS to terminate the logical saved GFW. PAUSE_PROCESS, BACKGROUND_SLEEP and YIELD_TO_QUEUE require status=CONTINUE and a non-empty nextSuggestedAction; it is mission-level scheduling and is never the global 0-300 s prompt-post gate. Use ROTATE_SESSION_NOW proactively for material context-noise, context-drift, contradiction, stale-assumption, overload, or session-health risk; do not encode rotation only in prose or blockers. status=DONE remains an explicit terminal mission signal for backward compatibility. All Greenfield/A2A machine-control prose and NANO_TASK directives must be English. UI/operator/source evidence may continuously mix English, Swedish and Finnish; preserve quoted labels verbatim, resolve structural control identity and local language/context before lexical ranking, and never reinterpret an incidental token solely by another language's meaning. Nano is a stateless prompt-only model endpoint: it has no EIC/project/file/tool/web/API/chat-history access. To request one isolated Nano task, place one dedicated English line beginning exactly 'NANO_TASK:' in nextSuggestedAction; the directive ends at the first newline. The task may be simple or complex, but every fact/data item needed to answer must be embedded in that one prompt. For data-bearing tasks prefer a compact one-line JSON object using schema eic.greenfield.nano-task.request.v2 with knowledgeBoundary=PROMPT_ONLY plus instruction/context/output fields. Never ask Nano to inspect existing/current files, projects, repositories, artifacts, mail, owner routes or other external state unless the necessary content has first been read by EIC and embedded inline. For a queued mission, obey control.workQueue.checkpointInstruction whenever checkpointRequired=true or you are returning a terminal/yield/pause/stop control; Greenfield may switch missions immediately and will not spend an extra checkpoint prompt. The queue is an ordered cyclic slot list: run the configured quantum for the active slot, advance to the next runnable slot by explicit position, wrap after the last slot, preserve unfinished quantum progress across early yield/pause/block, and keep cycling until an AI terminal control closes a logical GFW or the operator edits/stops the queue. The same saved GFW may appear in several slots with different position, priority and quantum; those slots share logical continuation but keep independent scheduling parameters. control.workQueue.operatorDisplay/planningHint tell you the exact current quantum position; use them to size this turn instead of overpacking work. Approximate response and loop roundtrip timing is supplied when observed. To request one bounded full Greenfield control-plane status capsule in this logical GFW's next prompt, return greenfieldStatusRequest=FULL_NEXT_PROMPT; this request is one-shot and follows this GFW across queue parking/rotation. A supervising queued EIC may request durable new work only through missionDelegations. Greenfield must never create that delegated mission in the supervising Chrome queue: persist the request and let another already-running queue-managed Greenfield worker accept it into that worker's own Chrome queue. If no other eligible worker exists, keep the request pending and never self-create it. Delegation itself does not yield, pause, rotate, or stop the supervising mission. Temporary bounded work that is actually part of the supervising mission may still be performed locally and should not be emitted as missionDelegations. Reuse the same requestId for retries of the same logical delegated mission; child priority is capped at source priority. Session rotation never authorizes replay of completed work; the receiving EIC must resume from Greenfield Works and fresh owner state."
        : "Return the requested work truthfully. Structured EIC-A2A response JSON is preferred but optional for ordinary continuation. Continuation decisions do not depend on protocol presence. Optional sessionAction is a separate machine control: KEEP (default), ROTATE_SESSION_NOW for a fresh EIC chat, PAUSE_PROCESS with integer pauseSeconds 300..86400 to defer the next autonomous prompt when time itself is the dependency, or STOP_PROCESS to terminate. PAUSE_PROCESS requires status=CONTINUE and a non-empty nextSuggestedAction; it is mission-level scheduling and is never the global 0-300 s prompt-post gate. Use ROTATE_SESSION_NOW proactively for material context-noise, context-drift, contradiction, stale-assumption, overload, or session-health risk; do not encode rotation only in prose or blockers. status=DONE remains an explicit terminal mission signal for backward compatibility. All Greenfield/A2A machine-control prose and NANO_TASK directives must be English. UI/operator/source evidence may continuously mix English, Swedish and Finnish; preserve quoted labels verbatim, resolve structural control identity and local language/context before lexical ranking, and never reinterpret an incidental token solely by another language's meaning. Nano is a stateless prompt-only model endpoint: it has no EIC/project/file/tool/web/API/chat-history access. To request one isolated Nano task, place one dedicated English line beginning exactly 'NANO_TASK:' in nextSuggestedAction; the directive ends at the first newline. The task may be simple or complex, but every fact/data item needed to answer must be embedded in that one prompt. For data-bearing tasks prefer a compact one-line JSON object using schema eic.greenfield.nano-task.request.v2 with knowledgeBoundary=PROMPT_ONLY plus instruction/context/output fields. Never ask Nano to inspect existing/current files, projects, repositories, artifacts, mail, owner routes or other external state unless the necessary content has first been read by EIC and embedded inline. To request one bounded full Greenfield control-plane status capsule in the next prompt, return greenfieldStatusRequest=FULL_NEXT_PROMPT. Session rotation never authorizes replay of completed work; the receiving EIC must resume from Greenfield Works and fresh owner state.",
      A2A_RUNTIME_CONTROL_NOTE,
      A2A_PROMPT_PROFILE_NOTE,
      A2A_LEARNING_CONTROL_NOTE].join(" ")
    },
    promptProfile: promptProfileCapsule(promptProfile),
    issuedAt: nowIso(at)
  };
  return promptProfile?.profile === PROMPT_PROFILE.COMPACT
    ? compactEnvelope(envelope, promptProfile)
    : envelope;
}

export function validateA2AEnvelope(value) {
  const errors = [];
  const v = value && typeof value === "object" ? value : {};
  if (v.schema !== A2A_MESSAGE_SCHEMA) errors.push("SCHEMA");
  if (v.protocol !== A2A_PROTOCOL) errors.push("PROTOCOL");
  if (!A2A_MESSAGE_TYPES.includes(v.messageType)) errors.push("MESSAGE_TYPE");
  if (!String(v.messageId || "").trim()) errors.push("MESSAGE_ID");
  if (!String(v.correlationId || "").trim()) errors.push("CORRELATION_ID");
  if (!String(v.objectiveId || "").trim()) errors.push("OBJECTIVE_ID");
  if (!v.process?.processId || !v.process?.runId || !Number.isInteger(v.process?.generation)) errors.push("PROCESS");
  if (v.sender?.actor !== "AGENT") errors.push("SENDER");
  if (v.recipient?.actor !== "EIC_AI_SESSION") errors.push("RECIPIENT");
  if (v.languageContext?.schema !== "eic.greenfield.language-context.v1" || v.languageContext?.internalControlLanguage !== "en") errors.push("LANGUAGE_CONTEXT");
  if (!String(v.mission || "").trim()) errors.push("MISSION");
  if (!String(v.objective || "").trim()) errors.push("OBJECTIVE");
  if (v.analysisEvidence !== null && typeof v.analysisEvidence !== "object") errors.push("ANALYSIS_EVIDENCE");
  if (v.processStatus !== null && typeof v.processStatus !== "object") errors.push("PROCESS_STATUS");
  if (v.sessionHealth?.schema !== "eic.greenfield.session-health.v1") errors.push("SESSION_HEALTH");
  if (v.responseContract?.schema !== A2A_RESPONSE_SCHEMA) errors.push("RESPONSE_CONTRACT");
  if (v.control?.selfContinuationAuthority !== false) errors.push("AUTHORITY_BOUNDARY");
  if (v.control?.ownerState?.currentFocus?.role !== "STEERING_POINTER_NOT_FACT_OWNER") errors.push("OWNER_STATE_CURRENT_FOCUS_ROLE");
  if (v.control?.ownerState?.currentFocus?.readReconcileWhenProjectBound !== true) errors.push("OWNER_STATE_CURRENT_FOCUS_RECONCILE");
  if (v.control?.ownerState?.currentFocus?.conflictRule !== "NEWER_EXACT_OWNER_EVIDENCE_WINS") errors.push("OWNER_STATE_CURRENT_FOCUS_CONFLICT");
  if (v.control?.ownerState?.currentFocus?.writeWhen !== "MATERIAL_STEERING_OR_RESTART_DELTA_ONLY") errors.push("OWNER_STATE_CURRENT_FOCUS_WRITE_POLICY");
  if (v.control?.ownerState?.currentFocus?.noWriteWithoutMaterialDelta !== true) errors.push("OWNER_STATE_CURRENT_FOCUS_NO_DELTA");
  if (v.control?.ownerState?.currentFocus?.writeReadbackRequired !== true) errors.push("OWNER_STATE_CURRENT_FOCUS_READBACK");
  if (v.control?.ownerState?.completedEffectReplayFromStaleFocus !== false) errors.push("OWNER_STATE_CURRENT_FOCUS_REPLAY");
  if (v.control?.ownerState?.beforeMaterialEffect !== "REVALIDATE_EXACT_EFFECT_OWNER_AND_TARGET") errors.push("OWNER_STATE_EFFECT_OWNER_REVALIDATION");
  if (v.control?.ownerState?.repeatProbe !== "SAME_OBJECTIVE_OR_EFFECT_REQUIRES_MATERIAL_OWNER_STATE_DELTA") errors.push("OWNER_STATE_REPEAT_PROBE");
  if (v.responseContract?.ownerStateRule !== A2A_OWNER_STATE_CURRENT_FOCUS_RULE) errors.push("OWNER_STATE_CURRENT_FOCUS_RULE");
  // v1.8.0: every prompt, FULL or COMPACT, carries Greenfield's learning obligations.
  if (v.control?.learningControl?.schema !== LEARNING_CONTEXT_SCHEMA ||
      !v.control?.learningControl?.obligations) {
    errors.push("LEARNING_CONTROL_CONTEXT");
  }
  return { ok: errors.length === 0, errors };
}

export function composeA2APrompt(args) {
  const envelope = buildA2AEnvelope(args);
  const validation = validateA2AEnvelope(envelope);
  if (!validation.ok) {
    const error = new Error(`A2A_ENVELOPE_INVALID:${validation.errors.join(",")}`);
    error.code = "A2A_ENVELOPE_INVALID";
    error.validation = validation;
    throw error;
  }
  return {
    envelope,
    validation,
    text: JSON.stringify(envelope)
  };
}
