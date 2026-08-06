import test from "node:test";
import assert from "node:assert/strict";
import {
  applyNanoDecision,
  createContinuity,
  detectLoopCorrection,
  projectContinuity
} from "../lib/continuity.mjs";

function metaDecision(action) {
  return {
    analysisMode: "CONTINUATION_ANALYSIS",
    intent: "Slutför WP25",
    action: "CONTINUE",
    progressDelta: 0,
    reason: "Kontrollsteg",
    workUnit: "Graph repair",
    requestedAction: action,
    targetClaims: [],
    inferences: [],
    contextEvidence: []
  };
}

test("svenska metaåtgärder utan progress triggar STOP_META_LOOP", () => {
  let continuity = createContinuity({ intent: "Slutför WP25", workUnit: "Graph repair", now: 1000 });
  continuity = applyNanoDecision(continuity, metaDecision("Verifiera hjälpande script"), {
    actionKey: "Verifiera hjälpande script",
    turnIndex: 1,
    now: 2000
  });
  continuity = applyNanoDecision(continuity, metaDecision("Läs och kontrollera samma script"), {
    actionKey: "Läs och kontrollera samma script",
    turnIndex: 2,
    now: 3000
  });
  const correction = detectLoopCorrection(continuity);
  assert.equal(correction.triggered, true);
  assert.equal(correction.code, "STOP_META_LOOP");
  assert.equal(continuity.antiLoop.productiveActionCount, 0);
  assert.equal(continuity.antiLoop.auditActionCount, 2);
});

test("takeover binder continuity till exakt konversation och task fingerprint", () => {
  let continuity = createContinuity();
  continuity = applyNanoDecision(continuity, {
    analysisMode: "TAKEOVER_BOOTSTRAP",
    conversationKey: "chatgpt.com:project-eic",
    taskFingerprint: "task-abc",
    intent: "Slutför WP25",
    action: "CONTINUE",
    progressDelta: 1,
    reason: "Grundad takeover",
    workUnit: "Reparera graph summary",
    requestedAction: "Patcha lib/graph.mjs och returnera testlogg.",
    targetClaims: ["Målsessionen beskriver en summary-budgetblocker."],
    inferences: [],
    contextEvidence: ["Aktuell respons namnger graph summary."]
  }, { turnIndex: 1, now: 2000 });
  const projection = projectContinuity(continuity);
  assert.equal(projection.position.conversationKey, "chatgpt.com:project-eic");
  assert.equal(projection.position.taskFingerprint, "task-abc");
  assert.equal(projection.intent, "Slutför WP25");
});


test("20 omskrivna meta-turer med påstådd modellprogress stoppas deterministiskt", () => {
  let continuity = createContinuity({ intent: "Slutför WP25", workUnit: "Graph repair", now: 1000 });
  for (let index = 1; index <= 20; index += 1) {
    const action = index % 2
      ? `Verifiera kontrollspår ${index}`
      : `Granska samma preflight ${index}`;
    continuity = applyNanoDecision(continuity, {
      ...metaDecision(action),
      // Background trust boundary must replace this model-authored value with 0.
      progressDelta: 0
    }, {
      actionKey: action,
      turnIndex: index,
      now: 1000 + index
    });
    if (index >= 2) {
      const correction = detectLoopCorrection(continuity);
      assert.equal(correction.triggered, true);
      assert.equal(correction.code, index >= 8 ? "NO_PROGRESS_CHECKPOINT" : "STOP_META_LOOP");
    }
  }
  assert.equal(continuity.antiLoop.productiveActionCount, 0);
  assert.equal(continuity.antiLoop.stagnationCycles, 20);
});
