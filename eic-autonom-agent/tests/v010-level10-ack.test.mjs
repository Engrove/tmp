import test from "node:test";
import assert from "node:assert/strict";

import {
  acknowledgementMetrics,
  acceptOperatorDecisionReceipt,
  createOperatorDecision
} from "../lib/level10-ack.mjs";

test("v0.10 level-10 block twins reject 11 normalized characters and whitespace", () => {
  assert.equal(acknowledgementMetrics("abcdefghijk").valid, false);
  assert.equal(acknowledgementMetrics(" \n\t  ").valid, false);
  // Reproduces the historical UTF-16 bug: six emoji have .length 12 but only six graphemes.
  assert.equal("😀😀😀😀😀😀".length, 12);
  assert.equal(acknowledgementMetrics("😀😀😀😀😀😀").valid, false);
});

test("v0.10 level-10 emit twin accepts at least 12 meaningful characters", () => {
  const metrics = acknowledgementMetrics("Jag godkänner 1");
  assert.equal(metrics.valid, true);
  assert.ok(metrics.characterCount >= 12);
  assert.ok(metrics.semanticCharacterCount >= 6);
});

test("v0.10 decision receipt binds decision, mission, run and boundary", () => {
  const decision = createOperatorDecision({
    missionId: "mission-1",
    runId: "run-1",
    boundaryKey: "boundary-1",
    instruction: "Välj om den irreversibla åtgärden ska utföras."
  }, { decisionId: "decision-1", now: 1_700_000_000_000 });
  assert.throws(() => acceptOperatorDecisionReceipt(decision, {
    decisionId: "decision-stale",
    missionId: "mission-1",
    runId: "run-1",
    boundaryKey: "boundary-1",
    justification: "Jag godkänner beslutet"
  }), /ID_STALE_OR_WRONG/);
  const accepted = acceptOperatorDecisionReceipt(decision, {
    decisionId: "decision-1",
    missionId: "mission-1",
    runId: "run-1",
    boundaryKey: "boundary-1",
    receiptId: "decision-receipt-1",
    justification: "Jag godkänner beslutet"
  }, { now: 1_700_000_001_000 });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.decision.status, "ACCEPTED");
  const duplicate = acceptOperatorDecisionReceipt(accepted.decision, {
    decisionId: "decision-1",
    missionId: "mission-1",
    runId: "run-1",
    boundaryKey: "boundary-1",
    justification: "Jag godkänner beslutet"
  });
  assert.equal(duplicate.idempotent, true);
});
