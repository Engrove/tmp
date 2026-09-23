import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseTargetResponse } from "../lib/response-contract.mjs";
import { evaluateContinuationAdmission } from "../lib/continuation-guard.mjs";
import { advanceResponseCandidate } from "../lib/response-stability.mjs";
import { autonomousResponseObservation, isExternalAssistantInterleaved } from "../lib/turn-causality.mjs";

const fixture = JSON.parse(fs.readFileSync(
  new URL("./fixtures/v1.1.7-live-protocol-manual-interleave.json", import.meta.url),
  "utf8"
));

test("v1.1.7 protocol DONE incident cannot directly terminate WAITING in current semantics", () => {
  const admission = evaluateContinuationAdmission({
    targetDisposition: fixture.doneProtocolIncident.protocolStatus,
    currentObjective: "Objective remains pending",
    decision: {
      disposition: "CONTINUE",
      nextPrompt: "Continue from runtime evidence.",
      nanoTaskAssessment: "NOT_REQUESTED"
    },
    nanoTask: null
  });
  assert.equal(admission.ok, true);
  assert.equal(admission.code, "ADMISSIBLE");
});

test("v1.1.7 manual prose may lack A2A without becoming a continuation blocker", () => {
  const parsed = parseTargetResponse(fixture.manualInterleaveIncident.manualAssistantText);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, "UNKNOWN");
  for (const code of fixture.manualInterleaveIncident.legacyProtocolErrors) {
    assert.ok(parsed.errors.includes(code));
  }

  const admission = evaluateContinuationAdmission({
    targetDisposition: "UNKNOWN",
    currentObjective: "Keep autonomous continuity",
    decision: {
      disposition: "CONTINUE",
      nextPrompt: "Continue autonomously after the completed response.",
      nanoTaskAssessment: "NOT_REQUESTED"
    },
    nanoTask: null
  });
  assert.equal(admission.ok, true);
});

test("v1.1.7 manual interleave cannot hijack causally paired autonomous response candidate", () => {
  const process = {
    lastPrompt: {
      dispatchedUserTurnId: fixture.autonomousDispatch.userTurnId,
      dispatchedUserTurnIndex: fixture.autonomousDispatch.userTurnIndex
    }
  };
  const page = {
    documentId: fixture.autonomousDispatch.documentId,
    assistantCount: 5,
    lastUserId: fixture.manualInterleaveIncident.manualUserTurnId,
    lastAssistantId: fixture.manualInterleaveIncident.manualAssistantId,
    autonomousTurn: {
      expectedUserTurnId: fixture.autonomousDispatch.userTurnId,
      expectedUserIndex: fixture.autonomousDispatch.userTurnIndex,
      resolvedUserTurnId: fixture.autonomousDispatch.userTurnId,
      resolvedBy: "USER_TURN_ID",
      assistantFound: true,
      assistantId: "autonomous-assistant",
      assistantOwnerKind: "EXPLICIT_TURN_SHELL",
      assistantOwnerTrusted: true,
      assistantText: '{"schema":"eic.a2a.response.v1","status":"CONTINUE","summary":"ok","workPerformed":[],"evidence":[],"blockers":[],"nextSuggestedAction":"continue"}',
      assistantTextLength: 147,
      assistantHash: "auto-response-hash",
      assistantGenerating: false,
      assistantSignals: { visibilityState: "visible" }
    }
  };
  const causal = autonomousResponseObservation(process, page);
  assert.equal(causal.ready, true);
  assert.equal(causal.observation.lastAssistantId, "autonomous-assistant");
  assert.equal(isExternalAssistantInterleaved(page, causal.observation), true);

  let step = advanceResponseCandidate(null, causal.observation, { now: 0, minStableMs: 100, minStableReads: 2 });
  step = advanceResponseCandidate(step.candidate, causal.observation, { now: 150, minStableMs: 100, minStableReads: 2 });
  assert.equal(step.complete, true);
  assert.equal(step.candidate.messageId, "autonomous-assistant");
  assert.notEqual(step.candidate.messageId, fixture.manualInterleaveIncident.manualAssistantId);
});
