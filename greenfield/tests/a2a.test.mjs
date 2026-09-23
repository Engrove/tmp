import test from "node:test";
import assert from "node:assert/strict";
import { A2A_RESPONSE_JSON_SCHEMA, buildA2AEnvelope, composeA2APrompt, validateA2AEnvelope } from "../lib/a2a.mjs";
import { A2A_MESSAGE_SCHEMA, A2A_PROTOCOL, A2A_RESPONSE_SCHEMA } from "../lib/contracts.mjs";

const process = {
  processId: "process-1",
  runId: "run-1",
  generation: 1,
  turn: 1,
  goal: "Complete the mission"
};

test("A2A envelope carries standard Agent presentation and response schema", () => {
  const e = buildA2AEnvelope({ process, objective: "Start", messageType: "MISSION_START" });
  assert.equal(e.schema, A2A_MESSAGE_SCHEMA);
  assert.equal(e.protocol, A2A_PROTOCOL);
  assert.equal(e.sender.actor, "AGENT");
  assert.equal(e.sender.presentation.loop.includes("NANO"), true);
  assert.equal(e.responseContract.schema, A2A_RESPONSE_SCHEMA);
  assert.equal(e.responseContract.jsonSchema, A2A_RESPONSE_JSON_SCHEMA);
  assert.equal(e.control.ownerState.currentFocus.role, "STEERING_POINTER_NOT_FACT_OWNER");
  assert.match(e.responseContract.ownerStateRule, /OWNER_STATE \/ CURRENT_FOCUS CONTRACT/);
  assert.deepEqual(validateA2AEnvelope(e), { ok: true, errors: [] });
});

test("one-shot operator instruction is structured and one-shot", () => {
  const e = buildA2AEnvelope({
    process,
    objective: "Continue",
    operatorInstruction: { instructionId: "i-1", text: "Verify export." }
  });
  assert.deepEqual(e.operatorInstruction, {
    instructionId: "i-1",
    text: "Verify export.",
    oneShot: true
  });
});

test("A2A prompt is valid JSON and not a trailer protocol", () => {
  const out = composeA2APrompt({ process, objective: "Continue" });
  const parsed = JSON.parse(out.text);
  assert.equal(parsed.protocol, A2A_PROTOCOL);
  assert.equal(out.text.includes("EIC_NEXT_STATUS"), false);
});

test("A2A native control contains failure acceptance and claim boundaries", () => {
  const e = buildA2AEnvelope({ process, objective: "Continue" });
  assert.equal(e.control.failureAcceptance.failureIsValid, true);
  assert.equal(e.control.claimBoundary.noExecutionReceiptNoExecutionClaim, true);
  assert.equal(e.control.selfContinuationAuthority, false);
});


test("A2A binds previousDisposition from explicit controller disposition", () => {
  const e = buildA2AEnvelope({
    process,
    objective: "Continue with new evidence",
    previousResponseHash: "hash-1",
    previousDisposition: "BLOCKED",
    // ignored legacy-shaped field must not override explicit controller disposition
    decision: { disposition: "CONTINUE" }
  });
  assert.equal(e.continuity.previousDisposition, "BLOCKED");
});

test("A2A carries objective identity and bounded local analysis evidence", () => {
  const e = buildA2AEnvelope({
    process,
    objective: "Use Nano result",
    objectiveId: "objective-123",
    previousDisposition: "CONTINUE",
    analysisEvidence: {
      responseHash: "hash-2",
      targetDisposition: "CONTINUE",
      responseObservation: {
        documentId: "doc-1",
        messageId: "assistant-1",
        ownerKind: "EXPLICIT_TURN_SHELL",
        ownerTrusted: true,
        expectedUserTurnId: "user-auto-1",
        pairedUserTurnId: "user-auto-1",
        causalMatch: true,
        visibilityState: "visible",
        textLength: 420,
        assistantCount: 4,
        parseMode: "STRICT",
        externalInterleave: {
          observed: true,
          latestUserTurnId: "manual-user-1",
          latestAssistantTurnId: "manual-assistant-1",
          autonomousUserTurnId: "user-auto-1",
          autonomousAssistantTurnId: "assistant-1",
          admissibleAsAutonomousResponse: false,
          observedAt: "2026-09-01T10:30:00.000Z"
        }
      },
      protocol: {
        found: true,
        fullSchemaValid: true,
        controlValid: true,
        disposition: "CONTINUE",
        parseMode: "STRICT",
        errors: []
      },
      nanoTask: {
        requestId: "nano-task-1",
        status: "COMPLETED",
        semanticStatus: "UNVERIFIED",
        result: "703",
        error: "",
        promptLanguage: "en",
        promptPolicy: "PROMPT_CLOSED_EXECUTION_V2"
      },
      nano: {
        summary: "Observed completion",
        confidence: "HIGH",
        continuityRisk: "NONE"
      },
      hjalmar: {
        disposition: "CONTINUE",
        targetDisposition: "CONTINUE",
        objectiveStatus: "SATISFIED",
        nanoTaskAssessment: "UNVERIFIED",
        progressEvidence: "Nano task returned 703.",
        runtimeCorrections: ["NANO_TASK_ASSESSMENT_RUNTIME_OVERRIDE"]
      }
    }
  });
  assert.equal(e.objectiveId, "objective-123");
  assert.equal(e.analysisEvidence.responseObservation.documentId, "doc-1");
  assert.equal(e.analysisEvidence.responseObservation.expectedUserTurnId, "user-auto-1");
  assert.equal(e.analysisEvidence.responseObservation.pairedUserTurnId, "user-auto-1");
  assert.equal(e.analysisEvidence.responseObservation.causalMatch, true);
  assert.equal(e.analysisEvidence.responseObservation.parseMode, "STRICT");
  assert.equal(e.analysisEvidence.responseObservation.externalInterleave.observed, true);
  assert.equal(e.analysisEvidence.responseObservation.externalInterleave.latestUserTurnId, "manual-user-1");
  assert.equal(e.analysisEvidence.responseObservation.externalInterleave.admissibleAsAutonomousResponse, false);
  assert.equal(e.analysisEvidence.protocol.disposition, "CONTINUE");
  assert.equal(e.analysisEvidence.protocol.found, true);
  assert.equal(e.analysisEvidence.nanoTask.result, "703");
  assert.equal(e.analysisEvidence.nanoTask.semanticStatus, "UNVERIFIED");
  assert.equal(e.analysisEvidence.nanoTask.promptLanguage, "en");
  assert.equal(e.analysisEvidence.nanoTask.promptPolicy, "PROMPT_CLOSED_EXECUTION_V2");
  assert.equal(e.analysisEvidence.hjalmar.nanoTaskAssessment, "UNVERIFIED");
  assert.deepEqual(e.analysisEvidence.hjalmar.runtimeCorrections, ["NANO_TASK_ASSESSMENT_RUNTIME_OVERRIDE"]);
});


test("A2A requires Nano task directives to be authored in English", () => {
  const e = buildA2AEnvelope({ process, objective: "Continue" });
  assert.equal(e.responseContract.nanoTaskLanguage, "en");
  assert.equal(e.responseContract.nanoTaskExecutionPolicy, "PROMPT_CLOSED_EXECUTION_V2");
  assert.equal(e.responseContract.nanoTaskKnowledgeBoundary, "PROMPT_ONLY");
  assert.equal(e.responseContract.nanoTaskCapabilities.eicState, false);
  assert.equal(e.responseContract.nanoTaskCapabilities.projectState, false);
  assert.equal(e.responseContract.nanoTaskCapabilities.files, false);
  assert.equal(e.responseContract.nanoTaskCapabilities.web, false);
  assert.equal(e.responseContract.nanoTaskCapabilities.chatHistory, false);
  assert.equal(e.responseContract.nanoTaskCapabilities.reasoningDepth, "MODEL_CAPABILITY_NOT_ARTIFICIALLY_LIMITED");
  assert.match(e.responseContract.nanoTaskAdmission.invariant, /fact\/data item required/i);
  assert.match(e.responseContract.note, /dedicated English line beginning exactly/);
  assert.match(e.responseContract.note, /ends at the first newline/);
  assert.match(e.responseContract.note, /stateless/i);
  assert.match(e.responseContract.note, /prompt-only/i);
  assert.match(e.responseContract.note, /simple or complex/i);
  assert.match(e.responseContract.note, /do not depend on protocol presence/i);
});


test("v1.3.7 queued A2A envelope exposes YIELD_TO_QUEUE and checkpoint control only for queue-managed missions", () => {
  const queued = buildA2AEnvelope({
    process: {
      ...process,
      queueContext: {
        schema: "eic.greenfield.queue-context.v1",
        queueId: "queue-1",
        itemId: "item-1",
        interactionCount: 4,
        maxInteractions: 5,
        priority: "HIGH",
        activatedAt: "2026-09-05T08:00:00.000Z"
      }
    },
    objective: "Complete the fifth bounded interaction"
  });
  assert.ok(queued.responseContract.jsonSchema.properties.sessionAction.enum.includes("YIELD_TO_QUEUE"));
  assert.equal(queued.control.workQueue.checkpointRequired, true);
  assert.match(queued.control.workQueue.checkpointInstruction, /correct owner surface/);

  const ordinary = buildA2AEnvelope({ process, objective: "Continue" });
  assert.equal(ordinary.responseContract.jsonSchema.properties.sessionAction.enum.includes("YIELD_TO_QUEUE"), false);
  assert.equal("workQueue" in ordinary.control, false);
});
