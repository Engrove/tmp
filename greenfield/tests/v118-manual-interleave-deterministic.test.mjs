import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  autonomousResponseObservation,
  externalAssistantInterleaveEvidence
} from "../lib/turn-causality.mjs";
import { advanceResponseCandidate } from "../lib/response-stability.mjs";
import { parseTargetResponse } from "../lib/response-contract.mjs";
import { buildA2AEnvelope } from "../lib/a2a.mjs";

const fixture = JSON.parse(fs.readFileSync(
  new URL("./fixtures/v1.1.8-deterministic-manual-interleave.json", import.meta.url),
  "utf8"
));

const process = {
  processId: "process-test",
  runId: "run-test",
  generation: 1,
  turn: 8,
  goal: "manual interleave deterministic acceptance",
  lastPrompt: {
    dispatchedUserTurnId: fixture.expectedUserTurnId,
    dispatchedUserTurnIndex: fixture.expectedUserTurnIndex
  }
};


test("exact content resolver keeps the autonomous assistant before the next manual user boundary", () => {
  const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
  const start = content.indexOf("function resolveAutonomousTurn");
  const end = content.indexOf("function messageText", start);
  assert.ok(start >= 0 && end > start);
  const resolverSource = content.slice(start, end);
  const resolveAutonomousTurn = Function(
    `${resolverSource}; return resolveAutonomousTurn;`
  )();

  const entries = [
    { role: "user", id: fixture.expectedUserTurnId },
    { role: "assistant", id: fixture.autonomousAssistant.id },
    { role: "user", id: fixture.manualPair.userTurnId },
    { role: "assistant", id: fixture.manualPair.assistantTurnId }
  ];
  const resolved = resolveAutonomousTurn(
    entries,
    fixture.expectedUserTurnId,
    fixture.expectedUserTurnIndex
  );

  assert.equal(resolved.resolvedUserTurnId, fixture.expectedUserTurnId);
  assert.equal(resolved.assistantEntry.id, fixture.autonomousAssistant.id);
  assert.notEqual(resolved.assistantEntry.id, fixture.manualPair.assistantTurnId);
});

test("deterministic interleave preserves autonomous ownership when manual pair becomes latest", () => {
  const [before, interleaved, stable] = fixture.stages;

  const first = autonomousResponseObservation(process, before.page);
  assert.equal(first.ready, true);
  assert.equal(first.observation.lastAssistantId, fixture.autonomousAssistant.id);
  assert.equal(
    externalAssistantInterleaveEvidence(before.page, first.observation).observed,
    false
  );

  let step = advanceResponseCandidate(null, first.observation, {
    now: before.nowMs,
    minStableMs: 100,
    minStableReads: 2
  });
  assert.equal(step.complete, false);
  assert.equal(step.candidate.messageId, fixture.autonomousAssistant.id);

  const during = autonomousResponseObservation(process, interleaved.page);
  assert.equal(during.ready, true);
  assert.equal(during.observation.expectedUserTurnId, fixture.expectedUserTurnId);
  assert.equal(during.observation.pairedUserTurnId, fixture.expectedUserTurnId);
  assert.equal(during.observation.lastAssistantId, fixture.autonomousAssistant.id);
  assert.notEqual(during.observation.lastAssistantId, fixture.manualPair.assistantTurnId);

  const external = externalAssistantInterleaveEvidence(interleaved.page, during.observation);
  assert.deepEqual(external, {
    observed: true,
    latestUserTurnId: fixture.manualPair.userTurnId,
    latestAssistantTurnId: fixture.manualPair.assistantTurnId,
    latestAssistantHash: fixture.manualPair.assistantHash,
    autonomousUserTurnId: fixture.expectedUserTurnId,
    autonomousAssistantTurnId: fixture.autonomousAssistant.id,
    autonomousAssistantHash: fixture.autonomousAssistant.hash,
    admissibleAsAutonomousResponse: false
  });

  // The global assistantCount changed when the manual pair appeared, so the
  // stability identity restarts once. It must restabilize on the autonomous
  // assistant rather than switch to the manual latest assistant.
  step = advanceResponseCandidate(step.candidate, during.observation, {
    now: interleaved.nowMs,
    minStableMs: 100,
    minStableReads: 2
  });
  assert.equal(step.complete, false);
  assert.equal(step.candidate.messageId, fixture.autonomousAssistant.id);
  assert.equal(step.candidate.reads, 1);

  const after = autonomousResponseObservation(process, stable.page);
  step = advanceResponseCandidate(step.candidate, after.observation, {
    now: stable.nowMs,
    minStableMs: 100,
    minStableReads: 2
  });
  assert.equal(step.complete, true);
  assert.equal(step.candidate.messageId, fixture.autonomousAssistant.id);
  assert.notEqual(step.candidate.messageId, fixture.manualPair.assistantTurnId);

  const parsed = parseTargetResponse(after.observation.assistantText);
  assert.equal(parsed.status, "CONTINUE");
  assert.equal(parsed.found, true);
});

test("external interleave evidence is bounded into next A2A responseObservation", () => {
  const stage = fixture.stages[1];
  const causal = autonomousResponseObservation(process, stage.page);
  const external = externalAssistantInterleaveEvidence(stage.page, causal.observation);

  const envelope = buildA2AEnvelope({
    process,
    objective: "continue after deterministic interleave",
    objectiveId: "objective-test",
    previousResponseHash: "response-hash",
    previousDisposition: "CONTINUE",
    analysisEvidence: {
      responseHash: "response-hash",
      targetDisposition: "CONTINUE",
      responseObservation: {
        documentId: causal.observation.documentId,
        messageId: causal.observation.lastAssistantId,
        ownerKind: causal.observation.lastAssistantOwnerKind,
        ownerTrusted: causal.observation.lastAssistantOwnerTrusted,
        expectedUserTurnId: causal.observation.expectedUserTurnId,
        pairedUserTurnId: causal.observation.pairedUserTurnId,
        causalMatch: true,
        visibilityState: causal.observation.signals.visibilityState,
        textLength: causal.observation.assistantTextLength,
        assistantCount: causal.observation.assistantCount,
        parseMode: "STRICT",
        externalInterleave: {
          ...external,
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
      }
    }
  });

  const observation = envelope.analysisEvidence.responseObservation;
  assert.equal(observation.expectedUserTurnId, fixture.expectedUserTurnId);
  assert.equal(observation.pairedUserTurnId, fixture.expectedUserTurnId);
  assert.equal(observation.causalMatch, true);
  assert.equal(observation.externalInterleave.observed, true);
  assert.equal(observation.externalInterleave.latestUserTurnId, fixture.manualPair.userTurnId);
  assert.equal(observation.externalInterleave.latestAssistantTurnId, fixture.manualPair.assistantTurnId);
  assert.equal(observation.externalInterleave.autonomousAssistantTurnId, fixture.autonomousAssistant.id);
  assert.equal(observation.externalInterleave.admissibleAsAutonomousResponse, false);
});

test("deterministic acceptance uses fixtures only and adds no production admission delay", () => {
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.doesNotMatch(background, /MANUAL_INTERLEAVE_HOLD_MS/);
  assert.doesNotMatch(background, /TEST_ONLY_ADMISSION_DELAY/);
});
