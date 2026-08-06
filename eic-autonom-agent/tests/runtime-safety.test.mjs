import test from "node:test";
import assert from "node:assert/strict";
import {
  appendRecoveryAttempt,
  classifyConversationLocatorChange,
  compactEffectJournal,
  mergeSeenUserTurnIds,
  normalizeBackgroundAction,
  shouldPauseForLoop
} from "../lib/runtime-safety.mjs";
import {
  createRun,
  PAUSE_ORIGINS,
  STATES,
  transitionRun
} from "../lib/state-machine.mjs";
import {
  deriveDeterministicProgress,
  resolveCompletionDisposition,
  validateDecisionGrounding,
  COMPLETION_DISPOSITIONS
} from "../lib/decision-grounding.mjs";

test("locator promoveras från GPT/root till exakt conversation", () => {
  assert.equal(
    classifyConversationLocatorChange("chatgpt.com:g:gpt-1", "chatgpt.com:c:conv-1").kind,
    "PROMOTION"
  );
  assert.equal(
    classifyConversationLocatorChange("chatgpt.com:/", "chatgpt.com:c:conv-1").kind,
    "PROMOTION"
  );
  assert.equal(
    classifyConversationLocatorChange("", "chatgpt.com:c:conv-1").kind,
    "BIND"
  );
});

test("annan conversation är mismatch och får inte övertas", () => {
  assert.equal(
    classifyConversationLocatorChange("chatgpt.com:c:a", "chatgpt.com:c:b").kind,
    "MISMATCH"
  );
});

test("recovery attempts är bounded", () => {
  const run = { recovery: { attempts: [] } };
  for (let i = 0; i < 100; i += 1) appendRecoveryAttempt(run, { i });
  assert.equal(run.recovery.attempts.length, 40);
  assert.equal(run.recovery.attempts[0].i, 60);
});

test("journal behåller full prompt endast för aktiv tur", () => {
  const result = compactEffectJournal([
    { turnId: "old", prompt: "secretly-large-old-prompt", promptDigest: "a" },
    { turnId: "active", prompt: "active-prompt", promptDigest: "b" }
  ], "active");
  assert.equal("prompt" in result[0], false);
  assert.equal(result[1].prompt, "active-prompt");
});

test("okänd background action normaliseras fail-closed till PAUSE", () => {
  assert.equal(normalizeBackgroundAction("EXECUTE"), "PAUSE");
});

test("safety pause från Mjölnar readback kastar inte", () => {
  const run = createRun({ windowId: 1, targetTabId: 2 });
  run.state = STATES.MJOLNAR_READBACK;
  const next = transitionRun(run, STATES.SOFT_PAUSED, {
    origin: PAUSE_ORIGINS.TAB_NAVIGATED_AWAY,
    reason: "navigation"
  });
  assert.equal(next.state, STATES.SOFT_PAUSED);
});

test("terminal run muteras inte av sen tab-event", () => {
  const run = createRun({ windowId: 1, targetTabId: 2 });
  run.state = STATES.PROGRAM_DONE;
  assert.equal(transitionRun(run, STATES.SOFT_PAUSED).state, STATES.PROGRAM_DONE);
});

test("modellens progressDelta ignoreras för meta-only action", () => {
  const result = deriveDeterministicProgress({
    priorResponseHash: "a",
    currentResponseHash: "b",
    requestedAction: "Verifiera hjälpande script",
    priorWorkUnit: "A",
    workUnit: "B",
    targetResult: { valid: true, status: "CONTINUE" }
  });
  assert.equal(result.value, 0);
});

test("Nano-formulerad konkret action kan inte ensam skapa lokal progress", () => {
  const result = deriveDeterministicProgress({
    priorResponseHash: "a",
    currentResponseHash: "b",
    requestedAction: "Patcha lib/graph.mjs och returnera testlogg",
    priorWorkUnit: "A",
    workUnit: "B"
  });
  assert.equal(result.value, 0);
  assert.equal(result.concreteAction, true);
});

test("ändrad response med giltig turn-bunden konkret EIC_NEXT ger progress", () => {
  const result = deriveDeterministicProgress({
    priorResponseHash: "a",
    currentResponseHash: "b",
    requestedAction: "Patcha lib/graph.mjs och returnera testlogg",
    targetResult: {
      valid: true,
      status: "CONTINUE",
      next: "Patcha lib/graph.mjs och returnera testlogg"
    }
  });
  assert.equal(result.value, 1);
  assert.equal(result.targetNextIsConcrete, true);
});

test("modellens DONE kan inte avsluta utan turn-bundet target DONE", () => {
  assert.notEqual(resolveCompletionDisposition({
    completionConfirmed: true,
    completionEvidence: "påstådd output",
    completionScope: "STABLE_GOAL"
  }), COMPLETION_DISPOSITIONS.TERMINATE_STABLE_GOAL);
});

test("turn-bundet target DONE med evidens kan tillåta stabil completion", () => {
  assert.equal(resolveCompletionDisposition({
    completionConfirmed: true,
    completionEvidence: "artifact 42",
    completionScope: "STABLE_GOAL"
  }, {
    targetResult: { valid: true, status: "DONE", completionEvidence: "artifact 42" }
  }), COMPLETION_DISPOSITIONS.TERMINATE_STABLE_GOAL);
});

test("loop correction är hard pause signal", () => {
  assert.equal(shouldPauseForLoop({ triggered: true, code: "STOP_META_LOOP" }), true);
});


test("alla aktiva states kan fail-closed pausas utan throw", () => {
  const terminal = new Set([
    STATES.PROGRAM_DONE,
    STATES.STOPPED,
    STATES.ERROR_TERMINAL,
    STATES.PROGRAM_BLOCKED,
    STATES.AWAITING_OPERATOR_DECISION
  ]);
  for (const state of Object.values(STATES)) {
    if (terminal.has(state)) continue;
    const run = createRun({ windowId: 1, targetTabId: 2 });
    run.state = state;
    assert.doesNotThrow(() => transitionRun(run, STATES.SOFT_PAUSED, {
      origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
      reason: `pause from ${state}`
    }));
  }
});

test("Mjölnar PAUSE till CONTINUE måste omgrundas och meta-action avvisas", () => {
  const result = validateDecisionGrounding({
    action: "CONTINUE",
    taskIntent: "Slutför WP25",
    workUnit: "Graph repair",
    requestedAction: "Verifiera state",
    targetClaims: ["En effekt rapporterades."],
    inferences: [],
    contextEvidence: [],
    requiredEvidence: ["owner readback"]
  }, {
    intent: "Slutför WP25",
    position: { workUnit: "Graph repair" },
    verifiedFacts: [],
    targetClaims: [],
    inferences: []
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("META_ONLY_ACTION"));
});


test("turn-ID-set bevaras över DOM-virtualisering och är bounded", () => {
  const oldIds = Array.from({ length: 100 }, (_, index) => `turn-old-${index}`);
  const freshIds = Array.from({ length: 50 }, (_, index) => `turn-new-${index}`);
  const merged = mergeSeenUserTurnIds(oldIds, freshIds);
  assert.equal(merged.length, 128);
  assert.ok(merged.includes("turn-new-49"));
  assert.ok(merged.includes("turn-old-99"));
  assert.equal(merged.includes("turn-old-0"), false);
});
