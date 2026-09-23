import test from "node:test";
import assert from "node:assert/strict";
import { evaluateContinuationAdmission } from "../lib/continuation-guard.mjs";

function decision(nextPrompt = "Do the materially new step.", patch = {}) {
  return {
    disposition: "CONTINUE",
    nextPrompt,
    nanoTaskAssessment: "NOT_REQUESTED",
    ...patch
  };
}


test("protocol UNKNOWN is advisory and does not block a materially new controller continuation", () => {
  const r = evaluateContinuationAdmission({
    targetDisposition: "UNKNOWN",
    currentObjective: "Current objective",
    decision: decision("Continue despite absent structured protocol.")
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, "ADMISSIBLE");
});

test("protocol BLOCKED is advisory metadata, not a continuation barrier", () => {
  const r = evaluateContinuationAdmission({
    targetDisposition: "BLOCKED",
    currentObjective: "Old objective",
    decision: decision("Continue from the actual completed assistant response.")
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, "ADMISSIBLE");
});

test("protocol DONE is advisory metadata and cannot terminate the controller by itself", () => {
  const r = evaluateContinuationAdmission({
    targetDisposition: "DONE",
    currentObjective: "Old objective",
    decision: decision("Continue because the runtime objective is still pending.")
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, "ADMISSIBLE");
});

test("pending operator instruction remains ordinary controller input even when protocol says DONE", () => {
  const r = evaluateContinuationAdmission({
    targetDisposition: "DONE",
    currentObjective: "Old objective",
    decision: decision("Apply the queued operator instruction."),
    operatorInstructionPending: true
  });
  assert.equal(r.ok, true);
});

test("same unresolved objective is converted into a materially different alternative", () => {
  const currentObjective = "Nano: solve 37 x 19";
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective,
    decision: decision(currentObjective)
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, "REPLANNED_STALE_OBJECTIVE_REPEAT");
  assert.equal(r.replanned, true);
  assert.ok(r.effectiveNextPrompt);
  assert.notEqual(r.effectiveNextPrompt.toLowerCase(), currentObjective.toLowerCase());
});

test("stale previous Hjalmar prompt yields to newer target guidance", () => {
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective: "Current",
    targetNextSuggestedAction: "Inspect the actual Nano result.",
    previousDecision: decision("Repeat old task"),
    decision: decision("Repeat old task")
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, "REPLANNED_STALE_DECISION_REPEAT");
  assert.equal(r.effectiveNextPrompt, "Inspect the actual Nano result.");
});

test("running Nano task must reach a terminal state before normal CONTINUE", () => {
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective: "Current",
    decision: decision("Continue with result."),
    nanoTask: { requested: true, status: "RUNNING", result: "" }
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NANO_TASK_INCOMPLETE");
});

test("terminal Nano task failure may continue with failure evidence instead of blocking the whole run", () => {
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective: "Current",
    decision: decision("Continue using the persisted Nano failure evidence.", {
      nanoTaskAssessment: "FAILED"
    }),
    nanoTask: { requested: true, status: "FAILED", result: "", error: "MODEL_ERROR" }
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, "ADMISSIBLE");
});

test("Nano CONTEXT_REQUIRED may continue in EIC without replaying the impossible local task", () => {
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective: "Classify project metadata",
    decision: decision("Read the needed metadata in EIC or embed it into a new prompt-closed Nano task.", {
      nanoTaskAssessment: "CONTEXT_REQUIRED"
    }),
    nanoTask: {
      requested: true,
      status: "CONTEXT_REQUIRED",
      result: "",
      error: "NANO_CONTEXT_REQUIRED: project metadata was not supplied"
    }
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, "ADMISSIBLE");
});

test("unknown Nano task effect remains a hard exact-once boundary", () => {
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective: "Current",
    decision: decision("Continue"),
    nanoTask: { requested: true, status: "UNKNOWN_EFFECT", result: "" }
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NANO_TASK_EFFECT_UNKNOWN");
});


test("completed Nano task directive cannot be reissued back to target", () => {
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective: "Inspect local analysis",
    decision: decision("NANO_TASK: Calculate 37 * 19"),
    nanoTask: { requested: true, status: "COMPLETED", result: "703" }
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NANO_TASK_REISSUE");
});


test("completed Nano task with sanitized materially-new prompt is admissible", () => {
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective: "Run Nano task",
    targetNextSuggestedAction: "NANO_TASK: Calculate 37 * 19",
    decision: decision("The local Nano task completed exactly once. Continue using bounded analysis evidence."),
    nanoTask: {
      requested: true,
      status: "COMPLETED",
      result: "NANO_TEST_ANSWER=703"
    }
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, "ADMISSIBLE");
});
