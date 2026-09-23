import test from "node:test";
import assert from "node:assert/strict";
import {
  GREENFIELD_ACTIONS,
  GREENFIELD_STATES,
  applyGreenfieldControlToDecision,
  resolveGreenfieldControl
} from "../lib/greenfield-control.mjs";

function blockedDecision(overrides = {}) {
  return {
    schema: "eic.hjalmar.analysis.v2",
    disposition: "BLOCKED",
    targetDisposition: "CONTINUE",
    objectiveStatus: "BLOCKED",
    nanoTaskAssessment: "NOT_REQUESTED",
    progressEvidence: "Bounded package completed; two scoped evidence ceilings remain.",
    analysis: "Two target blocker strings were present.",
    nextPrompt: "",
    exactTarget: "Continue the mission.",
    ownerEvidence: "Target response and runtime evidence.",
    reversibility: "YES",
    rollbackPath: "No mutation.",
    readbackPlan: "Read next owner evidence.",
    materialAmbiguity: "NONE",
    humanAuthorityRequired: false,
    confidence: "MEDIUM",
    ...overrides
  };
}

test("v1.2.2 maps CONTINUE + executable nextSuggestedAction to NEXT even when target blocker strings made Hjalmar say BLOCKED", () => {
  const control = resolveGreenfieldControl({
    targetDisposition: "CONTINUE",
    targetNextSuggestedAction: "GF-006 Micro33: resolve incremental rotors / ID granularity.",
    decision: blockedDecision(),
    nanoTask: null
  });
  assert.equal(control.state, GREENFIELD_STATES.ACTIVE);
  assert.equal(control.action, GREENFIELD_ACTIONS.NEXT);
  assert.equal(control.controllerOverride, true);
  assert.equal(control.reason, "TARGET_CONTINUE_EXECUTABLE_NEXT_RECOVERY");

  const effective = applyGreenfieldControlToDecision(blockedDecision(), control);
  assert.equal(effective.disposition, "CONTINUE");
  assert.equal(effective.objectiveStatus, "PENDING");
  assert.equal(effective.nextPrompt, "GF-006 Micro33: resolve incremental rotors / ID granularity.");
  assert.equal(effective.humanAuthorityRequired, false);
});

test("v1.2.2 keeps human authority distinct as OPERATOR", () => {
  const control = resolveGreenfieldControl({
    targetDisposition: "CONTINUE",
    targetNextSuggestedAction: "Continue autonomously",
    decision: blockedDecision({ humanAuthorityRequired: true }),
    nanoTask: null
  });
  assert.equal(control.action, GREENFIELD_ACTIONS.OPERATOR);
  assert.equal(control.hardStop, true);
  assert.equal(control.reason, "HUMAN_AUTHORITY_REQUIRED");
});

test("v1.2.2 keeps exact-once unknown effect as hard BLOCK", () => {
  const control = resolveGreenfieldControl({
    targetDisposition: "CONTINUE",
    targetNextSuggestedAction: "Try again",
    decision: blockedDecision(),
    nanoTask: { requested: true, status: "UNKNOWN_EFFECT" }
  });
  assert.equal(control.action, GREENFIELD_ACTIONS.BLOCK);
  assert.equal(control.reason, "NANO_TASK_UNKNOWN_EFFECT");
});

test("v1.2.2 does not invent NEXT when both controller and target have no executable continuation", () => {
  const control = resolveGreenfieldControl({
    targetDisposition: "CONTINUE",
    targetNextSuggestedAction: "",
    decision: blockedDecision(),
    nanoTask: null
  });
  assert.equal(control.action, GREENFIELD_ACTIONS.BLOCK);
  assert.equal(control.reason, "NO_EXECUTABLE_AUTONOMOUS_NEXT_STEP");
});

test("v1.2.2 carries normal CONTINUE and DONE without remapping", () => {
  const next = resolveGreenfieldControl({
    targetDisposition: "CONTINUE",
    targetNextSuggestedAction: "target candidate",
    decision: blockedDecision({
      disposition: "CONTINUE",
      objectiveStatus: "PENDING",
      nextPrompt: "controller prompt"
    })
  });
  assert.equal(next.action, GREENFIELD_ACTIONS.NEXT);
  assert.equal(next.effectiveNextPrompt, "controller prompt");

  const done = resolveGreenfieldControl({
    targetDisposition: "DONE",
    decision: blockedDecision({
      disposition: "DONE",
      targetDisposition: "DONE",
      objectiveStatus: "SATISFIED"
    })
  });
  assert.equal(done.state, GREENFIELD_STATES.DONE);
  assert.equal(done.action, GREENFIELD_ACTIONS.NONE);
});


test("v1.2.3 explicit EIC session rotation remains ACTIVE/NEXT even when local Hjalmar is BLOCKED", () => {
  const control = resolveGreenfieldControl({
    targetDisposition: "CONTINUE",
    targetNextSuggestedAction: "",
    decision: blockedDecision(),
    sessionAction: "ROTATE_SESSION_NOW"
  });
  assert.equal(control.state, GREENFIELD_STATES.ACTIVE);
  assert.equal(control.action, GREENFIELD_ACTIONS.NEXT);
  assert.equal(control.reason, "EIC_EXPLICIT_SESSION_ROTATION");
  assert.equal(control.controllerOverride, true);
  assert.equal(control.hardStop, false);
});

test("v1.2.3 explicit EIC STOP_PROCESS and legacy status=DONE are terminal controls", () => {
  const stopped = resolveGreenfieldControl({
    targetDisposition: "CONTINUE",
    targetNextSuggestedAction: "Continue",
    decision: blockedDecision({ disposition: "CONTINUE", objectiveStatus: "PENDING" }),
    sessionAction: "STOP_PROCESS"
  });
  assert.equal(stopped.state, GREENFIELD_STATES.DONE);
  assert.equal(stopped.action, GREENFIELD_ACTIONS.NONE);
  assert.equal(stopped.reason, "EIC_EXPLICIT_STOP_PROCESS");

  const legacyDone = resolveGreenfieldControl({
    targetDisposition: "DONE",
    decision: blockedDecision({ disposition: "CONTINUE", objectiveStatus: "PENDING" }),
    sessionAction: "KEEP"
  });
  assert.equal(legacyDone.state, GREENFIELD_STATES.DONE);
  assert.equal(legacyDone.action, GREENFIELD_ACTIONS.NONE);
  assert.equal(legacyDone.reason, "EIC_EXPLICIT_STATUS_DONE");
});
