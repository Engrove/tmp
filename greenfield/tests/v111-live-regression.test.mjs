import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normalizeHjalmarDecision,
  reconcileHjalmarRuntimeFacts,
  validateHjalmarEvidenceBinding
} from "../lib/hjalmar-d2.mjs";
import { evaluateContinuationAdmission } from "../lib/continuation-guard.mjs";

const fixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/v1.1.0-live-false-fail-closed.json", import.meta.url), "utf8")
);

test("v1.1.0 live false-fail-closed fixture is corrected rather than blocked", () => {
  assert.equal(fixture.sourceAuditEvents, 97);
  assert.equal(fixture.nanoTask.status, "COMPLETED");
  assert.equal(fixture.nanoTask.promptCalls, 1);
  assert.match(fixture.nanoTask.result, /NANO_TEST_ANSWER=703/);
  assert.equal(fixture.modelDecision.nanoTaskAssessment, "NOT_REQUESTED");
  assert.match(fixture.modelDecision.nextPrompt, /^NANO_TASK:/);
  assert.equal(fixture.observedAdmission.code, "NANO_TASK_REISSUE");

  const model = normalizeHjalmarDecision(fixture.modelDecision);
  const rawBinding = validateHjalmarEvidenceBinding(model, {
    targetDisposition: fixture.targetDisposition,
    nanoTask: fixture.nanoTask
  });
  assert.equal(rawBinding.ok, false);
  assert.ok(rawBinding.errors.includes("NANO_TASK_REQUESTED_MISMATCH"));

  const reconciled = reconcileHjalmarRuntimeFacts(model, {
    targetDisposition: fixture.targetDisposition,
    nanoTask: fixture.nanoTask
  });
  assert.equal(reconciled.decision.nanoTaskAssessment, "UNVERIFIED");
  assert.doesNotMatch(reconciled.decision.nextPrompt, /(^|\n)\s*NANO_TASK\s*:/i);
  assert.ok(reconciled.corrections.some((x) => x.code === "CONSUMED_NANO_TASK_DIRECTIVE_REMOVED"));

  const finalBinding = validateHjalmarEvidenceBinding(reconciled.decision, {
    targetDisposition: fixture.targetDisposition,
    nanoTask: fixture.nanoTask
  });
  assert.deepEqual(finalBinding, { ok: true, errors: [] });

  const admission = evaluateContinuationAdmission({
    targetDisposition: fixture.targetDisposition,
    currentObjective: fixture.currentObjective,
    targetNextSuggestedAction: fixture.targetNextSuggestedAction,
    previousDecision: null,
    decision: reconciled.decision,
    nanoTask: fixture.nanoTask,
    operatorInstructionPending: false
  });
  assert.equal(admission.ok, true);
  assert.equal(admission.code, "ADMISSIBLE");
});
