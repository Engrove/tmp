import test from "node:test";
import assert from "node:assert/strict";
import {
  applyNanoDecision,
  compactContinuity,
  createContinuity,
  classifyActionKey,
  expireStaleBlockers,
  normalizeContinuity,
  projectContinuity
} from "../lib/continuity.mjs";
import {
  deriveDeterministicProgress,
  isMetaOnlyAction
} from "../lib/decision-grounding.mjs";
import {
  allocateNanoSectionBudget,
  nanoBudgetExhausted,
  nanoDegradeLadder,
  resolveNanoInputBudget
} from "../lib/nano-input-budget.mjs";
import { buildNanoDecisionPromptDetailed } from "../lib/nano-pipeline.mjs";
import { buildDeterministicDecision } from "../lib/fallback-planner.mjs";
import {
  SESSION_INIT_STATES,
  advanceReadinessStability,
  advanceSessionInitGate,
  createSessionInitGate,
  evaluateNewSessionReadiness,
  sessionInitBlocksDispatch
} from "../lib/session-readiness.mjs";

// The exact EIC_NEXT text observed in the v0.6.3 runtime export that was
// misclassified as META_ONLY and zeroed deterministic progress.
const INCIDENT_NEXT = "WP25.2.4 V6R1a — rekonstruera endast den immutable v6-kandidaten i en ny " +
  "timestampad /tmp/wp25/versions-katalog; verifiera 111/111 postimages mot manifest v6, använd " +
  "f8d9ea9e3a2a11349907921f34d880804bee1f52 som källa vid mismatch, sätt filer 0444 och samtliga " +
  "kataloger inklusive root 0555, verifiera noll write-bits och exakt digest, och frys ett " +
  "mode-0444-kvitto utan republish, PR-mutation eller merge";
const INCIDENT_WORK_UNIT = "Reconcile/recreate immutable v6 candidate and verify publication status.";

function readyPage(overrides = {}) {
  return {
    ok: true,
    supported: true,
    composerFound: true,
    sendFound: true,
    generating: false,
    backgroundSignals: { active: false },
    documentEpoch: "epoch-1",
    version: "0.6.4",
    url: "https://chatgpt.com/",
    conversationKey: "chatgpt.com:/",
    assistantCount: 0,
    userCount: 0,
    ...overrides
  };
}

test("D4: svenska implementationsverb klassas inte längre som META_ONLY", () => {
  assert.equal(isMetaOnlyAction(INCIDENT_NEXT), false);
  const progress = deriveDeterministicProgress({
    priorResponseHash: "a".repeat(64),
    currentResponseHash: "b".repeat(64),
    requestedAction: INCIDENT_NEXT,
    priorWorkUnit: INCIDENT_WORK_UNIT,
    workUnit: INCIDENT_WORK_UNIT,
    targetResult: { valid: true, status: "CONTINUE", next: INCIDENT_NEXT }
  });
  assert.equal(progress.targetNextIsConcrete, true);
  assert.equal(progress.value, 1);
});

test("D4: rena metaåtgärder är fortfarande META_ONLY", () => {
  assert.equal(isMetaOnlyAction("Verifiera hjälpande script"), true);
  assert.equal(isMetaOnlyAction("Läs och kontrollera samma preflight"), true);
  assert.equal(isMetaOnlyAction("Granska target claims"), true);
});

test("D3: workUnit-prefixet får inte göra varje åtgärd till en auditåtgärd", () => {
  const compositeKey = `${INCIDENT_WORK_UNIT}|${INCIDENT_NEXT}`;
  assert.equal(classifyActionKey(compositeKey), "CONCRETE");

  let continuity = createContinuity({ intent: "Slutför WP25", workUnit: INCIDENT_WORK_UNIT, now: 1000 });
  continuity = applyNanoDecision(continuity, {
    action: "CONTINUE",
    progressDelta: 1,
    workUnit: INCIDENT_WORK_UNIT,
    requestedAction: INCIDENT_NEXT,
    reason: "deterministisk continuation"
  }, { turnIndex: 1, actionKey: compositeKey, now: 2000 });

  assert.equal(continuity.antiLoop.productiveActionCount, 1);
  assert.equal(continuity.antiLoop.auditActionCount, 0);
  assert.equal(continuity.antiLoop.concreteActionCount, 1);
  assert.equal(continuity.antiLoop.stagnationCycles, 0);
});

test("D3: verifierad progress rankar över verifieringsord i åtgärdstexten", () => {
  let continuity = createContinuity({ intent: "i", workUnit: "w", now: 1000 });
  continuity = applyNanoDecision(continuity, {
    action: "CONTINUE",
    progressDelta: 1,
    workUnit: "w",
    requestedAction: "Verifiera commit-parent och rapportera exakt digest",
    reason: "r"
  }, { turnIndex: 1, actionKey: "w|Verifiera commit-parent och rapportera exakt digest", now: 2000 });
  assert.equal(continuity.antiLoop.productiveActionCount, 1);
});

test("D1: beslutsprompten hålls inom värdmodellens contextfönster", () => {
  const budget = resolveNanoInputBudget({ contextWindow: 9216, contextUsage: 1778 });
  assert.ok(budget.maxPromptChars > 0);
  assert.ok(budget.availableTokens < 9216);

  const projection = projectContinuity(
    normalizeContinuity({
      intent: "Slutför WP25.2.4",
      position: { workUnit: INCIDENT_WORK_UNIT, turnIndex: 15 },
      targetClaims: Array.from({ length: 20 }, (_, index) => ({
        id: `t${index}`, claim: `Målsessionen påstod ${index}: ${INCIDENT_NEXT}`, turn: index
      })),
      inferences: Array.from({ length: 20 }, (_, index) => ({
        id: `i${index}`, claim: `Inferens ${index}: ${INCIDENT_NEXT}`, turn: index
      }))
    })
  );

  const built = buildNanoDecisionPromptDetailed({
    run: { runId: "run-1", state: "ASSESSING", turnIndex: 16 },
    request: { requestId: "req-1", mode: "CONTINUATION_ANALYSIS" },
    observation: { responseText: "X".repeat(20_000), conversationExcerpt: "Y".repeat(12_000) },
    config: { targetMandate: "M".repeat(5_359) },
    continuityProjection: projection,
    maxPromptChars: budget.maxPromptChars
  });

  assert.equal(built.budget.withinBudget, true);
  assert.ok(built.prompt.length <= budget.maxPromptChars);
  assert.match(built.prompt, /REFERENCE_PLUS_DELTA/);
  assert.doesNotMatch(built.prompt, /LATEST COMPLETE TARGET RESPONSE|DURABLE CONTINUITY/);
});

test("D1: obudgeterad byggväg använder current compact default budget", () => {
  const built = buildNanoDecisionPromptDetailed({
    run: { runId: "run-1", state: "ASSESSING" },
    request: { requestId: "req-1", mode: "CONTINUATION_ANALYSIS" },
    observation: { responseText: "X".repeat(20_000), conversationExcerpt: "Y".repeat(12_000) },
    config: { targetMandate: "M".repeat(5_359) },
    continuityProjection: { intent: "i", position: { workUnit: "w" } }
  });
  assert.equal(built.budget.maxPromptChars, 12000);
  assert.ok(built.prompt.length <= 12_000);
});

test("D1: degraderingsstegen är bounded och avslutas", () => {
  assert.equal(nanoDegradeLadder(0), 1);
  assert.ok(nanoDegradeLadder(1) < 1);
  assert.ok(nanoDegradeLadder(2) < nanoDegradeLadder(1));
  assert.equal(nanoBudgetExhausted(3), true);

  const full = resolveNanoInputBudget({ contextWindow: 9216, contextUsage: 1778 });
  const degraded = resolveNanoInputBudget({
    contextWindow: 9216, contextUsage: 1778, degradeFactor: nanoDegradeLadder(1)
  });
  assert.ok(degraded.maxPromptChars < full.maxPromptChars);

  const tiny = allocateNanoSectionBudget(1_000, { fixedChars: 800 });
  assert.equal(tiny.conversationChars, 0);
  assert.ok(tiny.projectionChars > 0);
});

test("D2: continuity kompakteras semantiskt i stället för att växa till bytetaket", () => {
  const duplicated = normalizeContinuity({
    position: { turnIndex: 20 },
    inferences: [
      { id: "a", claim: "Samma inferens", turn: 1 },
      { id: "b", claim: "samma   inferens", turn: 2 },
      { id: "c", claim: "Ny inferens", turn: 20 }
    ],
    targetClaims: Array.from({ length: 8 }, (_, index) => ({
      id: `t${index}`, claim: `Gammal claim ${index}`, turn: 1
    }))
  });
  const compacted = compactContinuity(duplicated, { now: 1000 });
  assert.equal(compacted.inferences.length, 2);
  assert.ok(compacted.targetClaims.length <= 4);
  assert.ok(compacted.compactionGeneration > 0);
  assert.ok(compacted.compaction.mergedItems > 0 || compacted.compaction.removedItems > 0);
});

test("D2: projektionen kan bindas till ett teckentak utan att tappa bärande fält", () => {
  const projection = projectContinuity(normalizeContinuity({
    intent: { text: "Bärande intent", setBy: "operator" },
    position: { workUnit: INCIDENT_WORK_UNIT, turnIndex: 9 },
    blockers: [{ id: "b1", statement: "workspace_trusted_session_required", open: true, turn: 9, lastAssertedTurn: 9 }],
    inferences: Array.from({ length: 6 }, (_, index) => ({
      id: `i${index}`, claim: `Inferens ${index}: ${INCIDENT_NEXT}`, turn: 9
    }))
  }), { maxChars: 1_500 });

  assert.equal(projection.intent, "Bärande intent");
  assert.equal(projection.position.workUnit, INCIDENT_WORK_UNIT);
  assert.equal(projection.blockers.length, 1);
  assert.ok(projection.projectionCompaction.trimmedLists.length > 0);
});

test("D6: blockers återasserteras och förfaller explicit utan falsk resolution", () => {
  let continuity = createContinuity({ intent: "i", workUnit: "w", now: 1000 });
  continuity = applyNanoDecision(continuity, {
    action: "CONTINUE", progressDelta: 0, workUnit: "w", requestedAction: "Skapa artefakt",
    blockers: [{ statement: "workspace_trusted_session_required" }]
  }, { turnIndex: 1, actionKey: "w|Skapa artefakt", now: 2000 });
  assert.equal(continuity.blockers[0].open, true);
  assert.equal(continuity.blockers[0].lastAssertedTurn, 1);

  continuity = applyNanoDecision(continuity, {
    action: "CONTINUE", progressDelta: 0, workUnit: "w", requestedAction: "Skapa artefakt 2",
    blockers: [{ statement: "workspace_trusted_session_required" }]
  }, { turnIndex: 4, actionKey: "w|Skapa artefakt 2", now: 3000 });
  assert.equal(continuity.blockers.length, 1);
  assert.equal(continuity.blockers[0].lastAssertedTurn, 4);
  assert.equal(continuity.blockers[0].open, true);

  const expired = expireStaleBlockers(continuity, { turnIndex: 12, now: 4000 });
  assert.equal(expired.expired, 1);
  assert.equal(expired.continuity.blockers[0].open, false);
  assert.match(expired.continuity.blockers[0].closedReason, /STALE_NO_REASSERTION/);
  assert.equal(expired.continuity.blockers[0].unlockedBy, "");
});

test("D7: deterministisk CONTINUE härleder arbetsenhet ur turn-bundet EIC_NEXT", () => {
  const decision = buildDeterministicDecision({
    run: { targetTabId: 7, conversationKey: "chatgpt.com:c:abc" },
    observation: { targetResult: { valid: true, status: "CONTINUE", next: INCIDENT_NEXT } },
    continuityProjection: {
      intent: "Slutför WP25",
      position: { workUnit: INCIDENT_WORK_UNIT },
      blockers: [{ statement: "workspace_trusted_session_required" }]
    },
    maxAutonomousMode: true
  });
  assert.equal(decision.workUnit, INCIDENT_NEXT);
  assert.equal(decision.workUnitSource, "target-eic-next-claim");
  // The planner must not re-assert carried blockers as new evidence.
  assert.deepEqual(decision.blockers, []);
  assert.equal(decision.carriedBlockers.length, 1);
  assert.deepEqual(decision.verifiedFacts, []);
});

test("D7: position avancerar med arbetsenheten och får provenance", () => {
  let continuity = createContinuity({ intent: "i", now: 1000 });
  continuity = applyNanoDecision(continuity, {
    action: "CONTINUE", progressDelta: 1, workUnit: INCIDENT_NEXT,
    workUnitSource: "target-eic-next-claim", requestedAction: INCIDENT_NEXT, reason: "r"
  }, { turnIndex: 3, actionKey: `x|${INCIDENT_NEXT}`, now: 2000 });
  assert.equal(continuity.position.workUnit, INCIDENT_NEXT);
  assert.equal(continuity.position.workUnitSource, "target-eic-next-claim");
  assert.equal(continuity.position.phase, "active");
  assert.ok(continuity.position.updatedAt);
});

test("R5: readiness kräver stabil composer/epoch/version men inte en tom send-control", () => {
  assert.equal(evaluateNewSessionReadiness(readyPage({ sendFound: false })).ready, true);
  assert.deepEqual(
    evaluateNewSessionReadiness(readyPage({ sendFound: false }), { requireSendControl: true }).reasons,
    ["SEND_CONTROL_MISSING"]
  );
  assert.equal(evaluateNewSessionReadiness(readyPage({ generating: true })).ready, false);
  assert.equal(evaluateNewSessionReadiness(readyPage({ documentEpoch: "" })).ready, false);
  assert.equal(
    evaluateNewSessionReadiness(readyPage(), { expectedContentVersion: "0.6.4" }).ready,
    true
  );
  assert.deepEqual(
    evaluateNewSessionReadiness(readyPage({ version: "0.6.3" }), { expectedContentVersion: "0.6.4" }).reasons,
    ["CONTENT_BRIDGE_VERSION_MISMATCH"]
  );
});

test("R5: stabilitet kräver flera identiska probes och nollställs vid identitetsbyte", () => {
  let stability = advanceReadinessStability(null, readyPage(), { requiredStableProbes: 3 });
  assert.equal(stability.settled, false);
  stability = advanceReadinessStability(stability, readyPage(), { requiredStableProbes: 3 });
  assert.equal(stability.settled, false);
  stability = advanceReadinessStability(stability, readyPage({ documentEpoch: "epoch-2" }), { requiredStableProbes: 3 });
  assert.equal(stability.stableProbes, 1);
  stability = advanceReadinessStability(stability, readyPage({ documentEpoch: "epoch-2" }), { requiredStableProbes: 3 });
  stability = advanceReadinessStability(stability, readyPage({ documentEpoch: "epoch-2" }), { requiredStableProbes: 3 });
  assert.equal(stability.settled, true);
});

test("R5: gaten spärrar autonom dispatch tills första svaret finns", () => {
  let gate = createSessionInitGate({ now: 1000 });
  assert.equal(sessionInitBlocksDispatch(gate), true);

  gate = advanceSessionInitGate(gate, { tabReady: true, composerSettled: true }, { now: 2000 });
  assert.equal(gate.state, SESSION_INIT_STATES.PENDING_PROMPT_ACK);
  // The one-shot start delivery itself must be allowed through this phase.
  assert.equal(sessionInitBlocksDispatch(gate), false);

  gate = advanceSessionInitGate(gate, { promptAcked: true }, { now: 3000 });
  assert.equal(gate.state, SESSION_INIT_STATES.PENDING_FIRST_RESPONSE);
  assert.equal(sessionInitBlocksDispatch(gate), true);

  gate = advanceSessionInitGate(gate, { firstResponseComplete: true }, { now: 4000 });
  assert.equal(gate.state, SESSION_INIT_STATES.INITIALIZED);
  assert.equal(sessionInitBlocksDispatch(gate), false);
  assert.ok(gate.initializedAt);
});

test("R5: gaten tidsgränsar bara före leverans och aldrig under målsessionens tänkande", () => {
  let gate = createSessionInitGate({ now: 0, timeoutMs: 5_000 });
  gate = advanceSessionInitGate(gate, { reasons: ["COMPOSER_MISSING"] }, { now: 60_000 });
  assert.equal(gate.state, SESSION_INIT_STATES.FAILED_TIMEOUT);

  let waiting = createSessionInitGate({ now: 0, timeoutMs: 5_000 });
  waiting = advanceSessionInitGate(waiting, { tabReady: true, composerSettled: true }, { now: 100 });
  waiting = advanceSessionInitGate(waiting, { promptAcked: true }, { now: 200 });
  waiting = advanceSessionInitGate(waiting, {}, { now: 10_000_000 });
  assert.equal(waiting.state, SESSION_INIT_STATES.PENDING_FIRST_RESPONSE);
});

test("R5: saknad gate på en äldre run blockerar ingenting", () => {
  assert.equal(sessionInitBlocksDispatch(null), false);
  assert.equal(sessionInitBlocksDispatch(undefined), false);
});

