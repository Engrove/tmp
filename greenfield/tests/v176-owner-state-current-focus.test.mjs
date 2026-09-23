import test from "node:test";
import assert from "node:assert/strict";
import {
  buildA2AEnvelope,
  composeA2APrompt,
  validateA2AEnvelope
} from "../lib/a2a.mjs";

const process = {
  processId: "v176-owner-state",
  runId: "v176-owner-state-run",
  generation: 1,
  turn: 1,
  goal: "Exercise owner-state/current_focus semantics"
};

function envelope(overrides = {}) {
  return buildA2AEnvelope({ process, objective: "Continue bounded work", ...overrides });
}

test("v1.7.6 fresh current_focus: reconcile is mandatory but write is conditional", () => {
  const c = envelope().control.ownerState;
  assert.equal(c.subjectProjectOwnerState, "FRESH_READ_BEFORE_FIRST_BOUNDED_WORK_PACKAGE");
  assert.equal(c.currentFocus.readReconcileWhenProjectBound, true);
  assert.equal(c.currentFocus.noWriteWithoutMaterialDelta, true);
  assert.equal(c.currentFocus.writeWhen, "MATERIAL_STEERING_OR_RESTART_DELTA_ONLY");
});

test("v1.7.6 stale current_focus: newer exact owner evidence governs", () => {
  const c = envelope().control.ownerState.currentFocus;
  assert.equal(c.role, "STEERING_POINTER_NOT_FACT_OWNER");
  assert.equal(c.conflictRule, "NEWER_EXACT_OWNER_EVIDENCE_WINS");
});

test("v1.7.6 material steering delta: update requires owner readback", () => {
  const c = envelope().control.ownerState.currentFocus;
  assert.equal(c.writeWhen, "MATERIAL_STEERING_OR_RESTART_DELTA_ONLY");
  assert.equal(c.writeReadbackRequired, true);
});

test("v1.7.6 no material delta: no focus write and no repeated probe loop", () => {
  const c = envelope().control.ownerState;
  assert.equal(c.currentFocus.noWriteWithoutMaterialDelta, true);
  assert.equal(c.repeatProbe, "SAME_OBJECTIVE_OR_EFFECT_REQUIRES_MATERIAL_OWNER_STATE_DELTA");
});

test("v1.7.6 current_focus write unavailable: metadata failure is scoped", () => {
  const rule = envelope().control.ownerState.currentFocus.writeUnavailable;
  assert.match(rule, /PERSIST_RESTART_POINTER/);
  assert.match(rule, /ROUTE_METADATA_DEFECT_TO_OWNER/);
  assert.match(rule, /NO_BLIND_RETRY/);
  assert.match(rule, /CONTINUE_UNRELATED_SAFE_WORK/);
});

test("v1.7.6 completed effect plus stale pointer: effect replay remains forbidden", () => {
  const e = envelope({
    sessionRotation: {
      rotationId: "r-1",
      sessionSeq: 2,
      reasonCode: "STALE_CONTEXT",
      reason: "rotate",
      requestedBy: "EIC",
      sourceResponseState: "CONTINUE"
    }
  });
  assert.equal(e.control.ownerState.completedEffectReplayFromStaleFocus, false);
  assert.equal(e.continuity.sessionRotation.replayCompletedWork, false);
});

test("v1.7.6 before material effect: exact effect owner and target revalidation is explicit", () => {
  assert.equal(
    envelope().control.ownerState.beforeMaterialEffect,
    "REVALIDATE_EXACT_EFFECT_OWNER_AND_TARGET"
  );
});

test("v1.7.6 handoff: material mission state persists and focus changes only on material delta", () => {
  const handoff = envelope().control.ownerState.handoff;
  assert.match(handoff, /PERSIST_MATERIAL_MISSION_STATE/);
  assert.match(handoff, /UPDATE_CURRENT_FOCUS_ONLY_ON_MATERIAL_RESTART_DELTA/);
});

test("v1.7.6 contradiction: removing exact-owner precedence invalidates the envelope", () => {
  const e = envelope();
  e.control.ownerState = {
    ...e.control.ownerState,
    currentFocus: {
      ...e.control.ownerState.currentFocus,
      conflictRule: "CURRENT_FOCUS_WINS"
    }
  };
  const out = validateA2AEnvelope(e);
  assert.equal(out.ok, false);
  assert.ok(out.errors.includes("OWNER_STATE_CURRENT_FOCUS_CONFLICT"));
});

test("v1.7.6 regression: every composed A2A prompt carries the owner-state rule", () => {
  const out = composeA2APrompt({ process, objective: "Continue bounded work" });
  const parsed = JSON.parse(out.text);
  assert.equal(parsed.control.ownerState.currentFocus.role, "STEERING_POINTER_NOT_FACT_OWNER");
  assert.match(parsed.responseContract.ownerStateRule, /the newer owner evidence governs/i);
  assert.match(parsed.responseContract.ownerStateRule, /do not blind-retry/i);
  assert.deepEqual(out.validation, { ok: true, errors: [] });
});
