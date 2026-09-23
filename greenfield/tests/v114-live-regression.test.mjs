import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluateNanoTaskSemanticStatus
} from "../lib/nano-task.mjs";
import {
  normalizeHjalmarDecision,
  reconcileHjalmarRuntimeFacts
} from "../lib/hjalmar-d2.mjs";
import { evaluateContinuationAdmission } from "../lib/continuation-guard.mjs";

const fixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/v1.1.4-live-stage-loss.json", import.meta.url), "utf8")
);

function baseDecision(nextPrompt) {
  return normalizeHjalmarDecision({
    disposition: "CONTINUE",
    targetDisposition: "CONTINUE",
    objectiveStatus: "PENDING",
    nanoTaskAssessment: "NOT_REQUESTED",
    progressEvidence: "Canonical target and Nano evidence available.",
    analysis: "Continue from persisted runtime evidence.",
    nextPrompt,
    exactTarget: "Continue current objective",
    ownerEvidence: "Canonical runtime evidence",
    reversibility: "YES",
    rollbackPath: "Retain persisted process state",
    readbackPlan: "Read back next target response",
    materialAmbiguity: "NONE",
    humanAuthorityRequired: false,
    confidence: "HIGH"
  });
}

test("v1.1.4 live Nano result is deterministically SATISFIED despite later observed state corruption", () => {
  assert.equal(fixture.nanoTask.status, "COMPLETED");
  assert.equal(fixture.nanoTask.promptCalls, 1);
  assert.equal(fixture.observed.stalePersistedTaskStatus, "RUNNING");
  assert.equal(fixture.observed.finalPersistedTaskStatus, "FAILED");
  assert.equal(fixture.observed.replayBlockedCount, 5);
  assert.equal(evaluateNanoTaskSemanticStatus(fixture.nanoTask), "SATISFIED");
});

test("v1.1.5 reconciliation consumes the v1.1.4 reissued directive instead of blocking", () => {
  const nanoTask = {
    ...fixture.nanoTask,
    semanticStatus: evaluateNanoTaskSemanticStatus(fixture.nanoTask)
  };
  const reconciled = reconcileHjalmarRuntimeFacts(
    baseDecision(fixture.observed.modelNextPrompt),
    { targetDisposition: fixture.parser.status, nanoTask }
  );
  assert.equal(reconciled.decision.nanoTaskAssessment, "SATISFIED");
  assert.doesNotMatch(reconciled.decision.nextPrompt, /(^|\n)\s*NANO_TASK\s*:/i);
  assert.ok(reconciled.corrections.some((x) => x.code === "CONSUMED_NANO_TASK_DIRECTIVE_REMOVED"));

  const admission = evaluateContinuationAdmission({
    targetDisposition: fixture.parser.status,
    currentObjective: "v1.1.4 is active",
    targetNextSuggestedAction: fixture.observed.modelNextPrompt,
    decision: reconciled.decision,
    nanoTask
  });
  assert.equal(admission.ok, true);
  assert.equal(admission.code, "ADMISSIBLE");
});
