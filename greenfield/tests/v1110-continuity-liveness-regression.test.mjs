import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { PHASES } from "../lib/contracts.mjs";
import { createProcess, transitionProcess } from "../lib/state.mjs";
import { evaluateContinuationAdmission } from "../lib/continuation-guard.mjs";
import {
  autonomousResponseObservation,
  externalAssistantInterleaveEvidence
} from "../lib/turn-causality.mjs";

function decision(nextPrompt, patch = {}) {
  return {
    disposition: "CONTINUE",
    nextPrompt,
    nanoTaskAssessment: "NOT_REQUESTED",
    ...patch
  };
}

test("repeated current objective is replanned instead of terminally blocked", () => {
  const fixture = JSON.parse(fs.readFileSync(
    new URL("./fixtures/v1.1.9-continuation-repeat.json", import.meta.url),
    "utf8"
  ));
  const currentObjective = fixture.currentObjective;
  assert.equal(fixture.candidateNextPrompt, currentObjective);
  assert.match(fixture.observedBlockerMessage, /identical to the current objective/i);
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective,
    decision: decision(fixture.candidateNextPrompt)
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, "REPLANNED_STALE_OBJECTIVE_REPEAT");
  assert.equal(r.replanned, true);
  assert.ok(r.effectiveNextPrompt);
  assert.notEqual(r.effectiveNextPrompt.toLowerCase(), currentObjective.toLowerCase());
  assert.match(r.effectiveNextPrompt, /alternative continuation/i);
});

test("repeated prior decision adopts materially newer target guidance when safe", () => {
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective: "Inspect current owner state.",
    targetNextSuggestedAction: "Run one discriminating owner read and compare the result.",
    previousDecision: decision("Repeat old task."),
    decision: decision("Repeat old task.")
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, "REPLANNED_STALE_DECISION_REPEAT");
  assert.equal(r.replanned, true);
  assert.equal(
    r.effectiveNextPrompt,
    "Run one discriminating owner read and compare the result."
  );
});

test("repeated prior decision is replanned even when target offers no newer guidance", () => {
  const currentObjective = "Inspect current owner state.";
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective,
    targetNextSuggestedAction: "",
    previousDecision: decision("Repeat old task."),
    decision: decision("Repeat old task.")
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, "REPLANNED_STALE_DECISION_REPEAT");
  assert.equal(r.replanned, true);
  assert.equal(r.recoveryKind, "DETERMINISTIC_ALTERNATIVE");
  assert.ok(r.effectiveNextPrompt);
  assert.notEqual(r.effectiveNextPrompt.toLowerCase(), "repeat old task.");
});

test("recoverable repetition never masks a real unknown-effect Nano boundary", () => {
  const currentObjective = "Continue exact owner reconciliation.";
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective,
    decision: decision(currentObjective),
    nanoTask: {
      requested: true,
      status: "UNKNOWN_EFFECT",
      result: ""
    }
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NANO_TASK_EFFECT_UNKNOWN");
});

test("closed autonomous response slot is classified as producer loss, not indefinite waiting", () => {
  const fixture = JSON.parse(fs.readFileSync(
    new URL("./fixtures/v1.1.9-waiting-producer-loss.json", import.meta.url),
    "utf8"
  ));
  const process = {
    lastPrompt: {
      dispatchedUserTurnId: fixture.expectedUserTurnId,
      dispatchedUserTurnIndex: fixture.expectedUserIndex
    }
  };
  const page = {
    documentId: "fixture-doc",
    lastUserId: fixture.laterUserTurnId,
    lastAssistantId: fixture.laterAssistantTurnId,
    assistantHash: "later-assistant-hash",
    assistantCount: 1,
    generating: false,
    autonomousTurn: {
      expectedUserTurnId: fixture.expectedUserTurnId,
      expectedUserIndex: fixture.expectedUserIndex,
      resolvedUserTurnId: fixture.expectedUserTurnId,
      resolvedBy: "USER_TURN_ID",
      assistantFound: false,
      assistantId: "",
      assistantHash: "",
      responseSlotClosed: true,
      nextUserTurnId: fixture.laterUserTurnId
    }
  };
  const r = autonomousResponseObservation(process, page);
  assert.equal(r.ready, false);
  assert.equal(r.reason, "AUTONOMOUS_RESPONSE_PRODUCER_LOST");
  assert.equal(r.auto.responseSlotClosed, true);

  const external = externalAssistantInterleaveEvidence(page, {
    expectedUserTurnId: fixture.expectedUserTurnId,
    pairedUserTurnId: fixture.expectedUserTurnId,
    lastAssistantId: "",
    assistantHash: ""
  });
  assert.equal(external.observed, true);
  assert.equal(external.admissibleAsAutonomousResponse, false);
});


test("content resolver proves the old response slot is closed by the next user boundary", () => {
  const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
  const start = content.indexOf("function resolveAutonomousTurn");
  const end = content.indexOf("function messageText", start);
  assert.ok(start >= 0 && end > start);
  const resolveAutonomousTurn = Function(
    `${content.slice(start, end)}; return resolveAutonomousTurn;`
  )();

  const resolved = resolveAutonomousTurn([
    { role: "user", id: "auto-user" },
    { role: "user", id: "manual-user" },
    { role: "assistant", id: "manual-assistant" }
  ], "auto-user", 0);

  assert.equal(resolved.resolvedUserTurnId, "auto-user");
  assert.equal(resolved.assistantEntry, null);
  assert.equal(resolved.nextUserTurnId, "manual-user");
  assert.equal(resolved.responseSlotClosed, true);
});

test("WAITING may transition directly to SENDING for bounded continuity rearm", () => {
  const created = createProcess({
    windowId: 1,
    tabId: 2,
    goal: "mission",
    initialPrompt: "first"
  });
  const waiting = transitionProcess(created, PHASES.WAITING);
  const rearmed = transitionProcess(waiting, PHASES.SENDING);
  assert.equal(rearmed.phase, PHASES.SENDING);
});

test("background handles producer loss before the generic long-idle keepalive path", () => {
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const producerLoss = background.indexOf("AUTONOMOUS_RESPONSE_PRODUCER_LOST");
  const keepalive = background.indexOf("const keepaliveDue");
  assert.ok(producerLoss >= 0, "producer-loss branch must exist");
  assert.ok(keepalive >= 0, "keepalive branch must remain as fallback");
  assert.ok(producerLoss < keepalive, "producer loss must be resolved before generic idle keepalive");
  assert.match(background, /INTERRUPTED_CONTINUATION_REARMED/);
});
