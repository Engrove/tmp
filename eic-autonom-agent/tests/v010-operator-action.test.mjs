import test from "node:test";
import assert from "node:assert/strict";

import {
  EIC_AUTONOMY_STATES,
  EIC_NEXT_ACTORS,
  OPERATOR_ACTION_STATUS,
  PROGRAM_STATES,
  createOperatorAction,
  submitOperatorActionReceipt,
  validateAutonomyTuple
} from "../lib/operator-action.mjs";

test("v0.10 operator action block twin rejects actor mismatch", () => {
  const result = validateAutonomyTuple({
    autonomy: EIC_AUTONOMY_STATES.OPERATOR_ACTION_REQUIRED,
    nextActor: EIC_NEXT_ACTORS.OPERATOR_DECISION,
    next: "Klicka Exportera.",
    completionState: "MILESTONE_CONTINUE"
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "OPERATOR_ACTION_REQUIRES_OPERATOR_ACTION_ACTOR");
});

test("v0.10 operator action emit twin accepts a mechanical action", () => {
  const result = validateAutonomyTuple({
    autonomy: EIC_AUTONOMY_STATES.OPERATOR_ACTION_REQUIRED,
    nextActor: EIC_NEXT_ACTORS.OPERATOR_ACTION,
    next: "Klicka Exportera och bifoga JSON-filen.",
    completionState: "MILESTONE_CONTINUE"
  });
  assert.deepEqual(result, { valid: true, reason: "OK" });
});

test("v0.10 user pause and done require their exact actors", () => {
  assert.equal(validateAutonomyTuple({
    autonomy: "USER_PAUSE",
    nextActor: "OPERATOR_ACTION",
    next: "Välj A eller B.",
    completionState: "PROGRAM_BLOCKED"
  }).valid, false);
  assert.equal(validateAutonomyTuple({
    autonomy: "USER_PAUSE",
    nextActor: "OPERATOR_DECISION",
    next: "Välj A eller B.",
    completionState: "PROGRAM_BLOCKED"
  }).valid, true);
  assert.equal(validateAutonomyTuple({
    autonomy: "DONE",
    nextActor: "NONE",
    next: "NONE",
    completionState: "PROGRAM_DONE"
  }).valid, true);
});

test("v0.10 operator action persists exact mission/run and resumes only after evidence", () => {
  const action = createOperatorAction({
    actionType: "EXPORT_FILE",
    instruction: "Klicka Exportera och välj oförändrad JSON.",
    targetSurface: "SIDE_PANEL",
    targetLocator: "button#exportButton",
    riskLevel: "LEVEL_1_READ_ONLY",
    decisionRequired: false,
    operatorPresenceRequired: true,
    expectedEvidence: { kind: "OWNER_RECEIPT" },
    resumeCondition: { type: "OWNER_RECEIPT" },
    missionId: "mission-1",
    runId: "run-1"
  }, { id: "action-1", now: 1_700_000_000_000 });
  assert.equal(action.status, OPERATOR_ACTION_STATUS.PENDING);
  assert.equal(PROGRAM_STATES.AWAITING_OPERATOR_ACTION, "AWAITING_OPERATOR_ACTION");
  assert.throws(() => submitOperatorActionReceipt(action, {
    actionId: "action-1",
    missionId: "mission-2",
    runId: "run-1",
    evidence: { evidenceClass: "OWNER_RECEIPT", ownerRef: "file:1" }
  }), /MISSION_MISMATCH/);
  assert.throws(() => submitOperatorActionReceipt(action, {
    actionId: "action-1",
    missionId: "mission-1",
    runId: "run-1",
    evidence: { evidenceClass: "DERIVED_VIEW", ownerRef: "file:1" }
  }), /OWNER_RECEIPT_REQUIRED/);
  const accepted = submitOperatorActionReceipt(action, {
    actionId: "action-1",
    missionId: "mission-1",
    runId: "run-1",
    receiptId: "receipt-1",
    evidence: { evidenceClass: "OWNER_RECEIPT", ownerRef: "artifact:42" }
  }, { now: 1_700_000_001_000 });
  assert.equal(accepted.resumeAllowed, true);
  assert.equal(accepted.action.status, OPERATOR_ACTION_STATUS.COMPLETED);
  const duplicate = submitOperatorActionReceipt(accepted.action, {
    actionId: "action-1",
    missionId: "mission-1",
    runId: "run-1",
    evidence: { evidenceClass: "OWNER_RECEIPT", ownerRef: "artifact:42" }
  });
  assert.equal(duplicate.idempotent, true);
});
