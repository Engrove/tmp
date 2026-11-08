import { test } from "node:test";
import assert from "node:assert/strict";
import * as pe from "../lib/progress-engine.mjs";

const NOW = Date.UTC(2026, 0, 1);
const fresh = (key = "gfw:GF-1.1.1") => pe.createProgressLedger({ missionKey: key, now: NOW });
const hex = (n) => (n.toString(16).padStart(2, "0")).repeat(7);
const plan3 = [
  { id: "S1", title: "First", deliverable: "d1", acceptance: "a1" },
  { id: "S2", title: "Second", deliverable: "d2", acceptance: "a2" },
  { id: "S3", title: "Third", deliverable: "d3", acceptance: "a3" }
];
const step = (L, resp, turn) => pe.applyTurn(L, { targetResponse: resp, turn, now: NOW + turn * 1000 });

test("mission key derivation", () => {
  assert.equal(pe.progressMissionKey({ queueContext: { savedMissionId: "m-1" }, goal: "GF-1.2.3" }), "m-1");
  assert.equal(pe.progressMissionKey({ goal: "do GF-4.5.6 now", processId: 9 }), "gfw:GF-4.5.6");
  assert.equal(pe.progressMissionKey({ goal: "nothing", processId: 9 }), "process:9");
  assert.equal(pe.progressMissionKey({}), "");
  assert.throws(() => pe.createProgressLedger({}), /PROGRESS_MISSION_KEY_REQUIRED/);
});

test("normalize handles malformed input, wrong key and caps", () => {
  assert.equal(pe.normalizeProgressLedger("junk", { missionKey: "k" }).missionKey, "k");
  assert.equal(pe.normalizeProgressLedger({ schema: "x" }, { missionKey: "k" }).stages.length, 0);
  assert.equal(pe.normalizeProgressLedger(fresh("other"), { missionKey: "k" }).missionKey, "k");
  const big = fresh("k");
  big.stages = Array.from({ length: 30 }, (_, i) => ({ id: `S${i}`, title: "t".repeat(500), state: "PENDING" }));
  big.seenIds = Array.from({ length: 900 }, (_, i) => `id${i}`);
  big.deadEnds = Array.from({ length: 50 }, (_, i) => ({ route: `r${i}`, reason: "x" }));
  const n = pe.normalizeProgressLedger(big, { missionKey: "k" });
  assert.equal(n.stages.length, 12);
  assert.equal(n.stages[0].title.length, 200);
  assert.equal(n.seenIds.length, 400);
  assert.equal(n.seenIds.at(-1), "id899");
  assert.equal(n.deadEnds.length, 20);
});

test("parseResponseProgress", () => {
  assert.equal(pe.parseResponseProgress({ summary: "x" }), null);
  assert.equal(pe.parseResponseProgress(null), null);
  const p = pe.parseResponseProgress({ progress: {
    delta: ["a"], stageUpdate: { id: "S1", state: "DONE", evidence: ["e"] }, plan: plan3, bogus: 1,
    deadEnds: [{ route: "r", reason: "x" }], knownLimitations: [{ surface: "S", code: "c" }],
    operatorRequest: { ask: "need", options: ["a"] }, sideFindings: ["f"]
  } });
  assert.deepEqual(p.delta, ["a"]);
  assert.equal(p.stageUpdate.state, "DONE");
  assert.equal(p.plan.length, 3);
  assert.equal(p.operatorRequest.ask, "need");
  assert.equal("bogus" in p, false);
  assert.deepEqual(p.errors, []);
  const bad = pe.parseResponseProgress({ progress: { stageUpdate: { id: "S1", state: "WEIRD" }, operatorRequest: { why: "no ask" } } });
  assert.equal(bad.stageUpdate, null);
  assert.equal(bad.operatorRequest, null);
  assert.equal(bad.errors.length, 2);
});

test("extractIdentifiers", () => {
  const ids = pe.extractIdentifiers([
    "commit 0123456789abcdef0123 and hr_AABBCCDDEEFF0011 cell-deploy-112233445566",
    "see A12345 and Artifact #678, issue #123, P123, M456, Project1:P22, short abc123"
  ]);
  assert.deepEqual(ids, ["0123456789abcdef0123", "aabbccddeeff0011", "112233445566", "A12345", "A678"]);
  assert.deepEqual(pe.extractIdentifiers(null), []);
  assert.equal(pe.jaccard([], []), 0);
  assert.equal(pe.jaccard(["a", "b"], ["b", "c"]), 1 / 3);
  assert.deepEqual(pe.blockerTokens(["BLOCKER: The gateway rejects tokens 123 abcdef012345"]), ["gateway", "rejects", "tokens"]);
});

test("stuck loop with reworded blocker reaches OPERATOR_REQUIRED by turn 5", () => {
  let L = fresh();
  const blockers = [
    "gateway denies session credential for deployment",
    "deployment credential rejected by gateway session",
    "session gateway still denies the deployment credential",
    "credential for deployment denied: gateway session",
    "gateway session credential denied for deployment again"
  ];
  const alerts = [];
  let last;
  blockers.forEach((b, i) => {
    last = step(L, { status: "CONTINUE", summary: "retry", workPerformed: ["retried"], evidence: [], blockers: [b], nextSuggestedAction: "retry deploy" }, i + 1);
    L = last.ledger; alerts.push(L.alert);
  });
  assert.equal(alerts[0], "CHANGE_ROUTE");
  assert.ok(alerts.indexOf("OPERATOR_REQUIRED") <= 4);
  assert.equal(L.operatorRequest.source, "GREENFIELD");
  assert.equal(L.operatorRequest.status, "OPEN");
  assert.ok(last.parkRequest.operatorRequest);
  for (let i = 1; i < alerts.length; i++) assert.ok(pe.alertRank(alerts[i]) >= pe.alertRank(alerts[i - 1]));
});

test("healthy loop stays NONE", () => {
  let L = fresh();
  for (let t = 1; t <= 6; t++) {
    const r = step(L, { status: "CONTINUE", summary: `s${t}`, workPerformed: [`commit ${hex(t)}${hex(t + 50)}`], evidence: [`test run ${hex(t + 100)} exit 0`], blockers: [], nextSuggestedAction: `next ${t}` }, t);
    L = r.ledger;
    assert.equal(r.classification.verdict, "ADVANCED");
    assert.equal(L.alert, "NONE");
  }
  assert.equal(L.counters.advanced, 6);
});

test("plan turn, stage completion, DONE without evidence ignored", () => {
  let r = step(fresh(), { status: "CONTINUE", progress: { plan: plan3 } }, 1);
  assert.equal(r.classification.verdict, "PLANNED");
  assert.equal(r.ledger.stages.length, 3);
  assert.equal(r.ledger.currentStageId, "S1");
  assert.equal(r.ledger.stages[0].state, "ACTIVE");
  r = step(r.ledger, { status: "CONTINUE", progress: { delta: ["x"], stageUpdate: { id: "S1", state: "DONE", evidence: [] } } }, 2);
  assert.equal(r.ledger.currentStageId, "S1");
  assert.equal(r.ledger.counters.stagesDone, 0);
  r = step(r.ledger, { status: "CONTINUE", progress: { delta: ["x"], stageUpdate: { id: "S1", state: "DONE", evidence: [`built ${hex(9)}${hex(8)}`] } } }, 3);
  assert.equal(r.classification.reasons[0], "STAGE_DONE");
  assert.equal(r.ledger.currentStageId, "S2");
  assert.equal(r.ledger.counters.stagesDone, 1);
  assert.equal(r.ledger.acceptedEvidence.length, 1);
  // already DONE stage cannot be completed again
  r = step(r.ledger, { status: "CONTINUE", progress: { stageUpdate: { id: "S1", state: "DONE", evidence: ["again"] } } }, 4);
  assert.notEqual(r.classification.reasons[0], "STAGE_DONE");
});

test("planChange keeps DONE stages", () => {
  let r = step(fresh(), { progress: { plan: plan3 } }, 1);
  r = step(r.ledger, { progress: { stageUpdate: { id: "S1", state: "DONE", evidence: ["ev"] } } }, 2);
  r = step(r.ledger, { progress: { delta: ["d"], planChange: { reason: "new info", stages: [{ id: "S1", title: "Redo", deliverable: "d", acceptance: "a" }, { id: "N2", title: "Next", deliverable: "d", acceptance: "a" }] } } }, 3);
  assert.equal(r.ledger.stages[0].state, "DONE");
  assert.equal(r.ledger.stages.length, 3);
  assert.equal(new Set(r.ledger.stages.map((s) => s.id)).size, 3);
  assert.ok(r.ledger.turnLog.at(-1).reasons.some((x) => x.startsWith("PLAN_CHANGE")));
});

test("stage turn budget triggers STRATEGY_SWITCH", () => {
  let r = step(fresh(), { progress: { plan: plan3 } }, 1);
  let L = r.ledger;
  for (let t = 2; t <= pe.PROGRESS_LIMITS.maxTurnsPerStage; t++) {
    r = step(L, { status: "CONTINUE", summary: "s", evidence: [`ev ${hex(t)}${hex(t + 1)}`], progress: { delta: [`d ${hex(t)}${hex(t + 1)}`] } }, t);
    L = r.ledger;
  }
  assert.equal(L.stages[0].turnsSpent, pe.PROGRESS_LIMITS.maxTurnsPerStage);
  assert.equal(L.alert, "STRATEGY_SWITCH");
  assert.equal(L.alertReason, "STAGE_TURN_BUDGET");
});

test("AI operator request, answer, compose, consume", () => {
  let r = step(fresh(), { status: "BLOCKED", blockers: ["need key"], nextSuggestedAction: "wait", progress: { operatorRequest: { ask: "Provide the key", why: "locked", then: "deploy", options: ["a", "b"] } } }, 1);
  assert.equal(r.alert, "OPERATOR_REQUIRED");
  assert.equal(r.ledger.alertReason, "AI_OPERATOR_REQUEST");
  assert.equal(r.ledger.operatorRequest.source, "AI");
  assert.deepEqual(r.ledger.operatorRequest.options, ["a", "b"]);
  assert.ok(r.parkRequest);
  assert.throws(() => pe.recordOperatorAnswer(r.ledger, { answer: "  " }), /OPERATOR_ANSWER_REQUIRED/);
  const ans = pe.recordOperatorAnswer(r.ledger, { answer: "use key K", now: NOW });
  assert.equal(ans.operatorRequest.status, "ANSWERED");
  assert.equal(ans.alert, "NONE");
  assert.equal(ans.alertReason, "OPERATOR_ANSWERED");
  assert.equal(ans.counters.churnStreak, 0);
  const obj = pe.composeProgressObjective({ ledger: ans, handoff: "old handoff" });
  assert.match(obj, /^OPERATOR ANSWER: use key K\n\(Your request was: Provide the key\)/);
  assert.match(obj, /Previous handoff: old handoff/);
  assert.equal(pe.consumeOperatorAnswer(ans).operatorRequest, null);
  const cancelled = pe.cancelOperatorRequest(r.ledger, { now: NOW });
  assert.equal(cancelled.operatorRequest.status, "CANCELLED");
  assert.equal(pe.consumeOperatorAnswer(cancelled).operatorRequest, null);
  const orphan = pe.recordOperatorAnswer(fresh(), { answer: "hi" });
  assert.equal(orphan.operatorRequest.source, "OPERATOR");
});

test("composeProgressObjective by alert", () => {
  const L = fresh();
  assert.equal(pe.composeProgressObjective({ ledger: L, handoff: "do X" }), "do X");
  assert.equal(pe.composeProgressObjective({ ledger: L, handoff: "" }), "");
  const staged = step(L, { progress: { plan: plan3 } }, 1).ledger;
  assert.match(pe.composeProgressObjective({ ledger: staged, handoff: "" }), /^Deliver stage S1 — First: d1\. Acceptance: a1\./);
  const cr = { ...staged, alert: "CHANGE_ROUTE", alertReason: "CHURN_STREAK_1" };
  assert.match(pe.composeProgressObjective({ ledger: cr, handoff: "old route" }), /reference only, change the route\): old route/);
  const ss = { ...staged, alert: "STRATEGY_SWITCH", alertReason: "CHURN_STREAK_2" };
  const o = pe.composeProgressObjective({ ledger: ss, handoff: "old route" });
  assert.ok(!o.includes("old route"));
  assert.match(o, /S2, S3/);
  assert.ok(!pe.progressAlertInstruction(ss).includes("YIELD_TO_QUEUE"));
  assert.ok(pe.progressAlertInstruction(ss).length <= 700);
  const op = { ...staged, alert: "OPERATOR_REQUIRED" };
  assert.match(pe.composeProgressObjective({ ledger: op, handoff: "x" }), /waiting for the operator/);
});

test("capsule stays bounded and serializable", () => {
  let L = fresh();
  L = { ...L, stages: Array.from({ length: 12 }, (_, i) => ({ id: `S${i}`, title: "t".repeat(200), deliverable: "d".repeat(600), acceptance: "a".repeat(600), state: "PENDING", needsOperator: false, evidence: [], turnsSpent: 0, doneAt: "" })),
    acceptedEvidence: Array.from({ length: 24 }, (_, i) => ({ ref: "e".repeat(600) + i, stageId: "S0", turn: i, at: "" })),
    deadEnds: Array.from({ length: 20 }, (_, i) => ({ route: "r".repeat(400) + i, reason: "x".repeat(400), turn: i, at: "" })),
    lastHandoff: "h".repeat(2000) };
  L = pe.normalizeProgressLedger(L, { missionKey: L.missionKey });
  const cap = pe.buildProgressCapsule(L, { now: NOW });
  assert.ok(JSON.stringify(cap).length <= pe.PROGRESS_LIMITS.capsuleMaxChars);
  assert.equal(cap.schema, pe.PROGRESS_CAPSULE_SCHEMA);
  assert.equal(pe.buildProgressCapsule(fresh()).planRequired, true);
  assert.ok(pe.PROGRESS_DOCTRINE.length <= 900);
  assert.ok(!pe.PROGRESS_DOCTRINE.includes("YIELD_TO_QUEUE"));
  assert.ok(JSON.stringify(pe.progressSummaryForUi(L)));
});

test("known limitation detection and dedupe", () => {
  let r = step(fresh(), { status: "CONTINUE", summary: "x", blockers: ["aik_trusted_session_required", "foo_bar_baz_required"], evidence: [`e ${hex(1)}${hex(2)}`] }, 1);
  r = step(r.ledger, { status: "CONTINUE", summary: "aik_trusted_session_required again", evidence: [] }, 2);
  const lims = r.ledger.knownLimitations;
  assert.equal(lims.filter((l) => l.code === "aik_trusted_session_required" && l.surface === "AIK").length, 1);
  assert.ok(lims.some((l) => l.code === "foo_bar_baz_required" && l.surface === "UNKNOWN"));
});

test("null response is churn and input ledger is not mutated", () => {
  const L = step(fresh(), { progress: { plan: plan3 } }, 1).ledger;
  const before = JSON.stringify(L);
  const r = step(L, null, 2);
  assert.equal(r.classification.verdict, "CHURN");
  assert.equal(r.classification.reasons[0], "NO_STRUCTURED_RESPONSE");
  step(L, { status: "CONTINUE", progress: { delta: ["x"], deadEnds: [{ route: "r", reason: "y" }] } }, 3);
  assert.equal(JSON.stringify(L), before);
  pe.classifyTurn(L, { targetResponse: { evidence: [hex(1) + hex(2)] } });
  assert.equal(JSON.stringify(L), before);
});

test("operator answer gives the current stage a fresh turn budget", () => {
  let L = fresh();
  L = step(L, { status: "CONTINUE", summary: "plan", workPerformed: [], evidence: [], blockers: [], nextSuggestedAction: "go",
    progress: { plan: plan3, delta: ["planned"] } }, 1).ledger;
  for (let t = 2; t <= 2 + pe.PROGRESS_LIMITS.maxTurnsPerStage; t++) {
    L = step(L, { status: "CONTINUE", summary: `s${t}`, workPerformed: [], evidence: [`commit ${hex(t)}`], blockers: [],
      nextSuggestedAction: "go", progress: { delta: [`commit ${hex(t)}`] } }, t).ledger;
  }
  assert.equal(L.alert, pe.PROGRESS_ALERT.STRATEGY_SWITCH);
  const answered = pe.recordOperatorAnswer(L, { answer: "Split S1 differently.", now: NOW });
  assert.equal(answered.stages.find((s) => s.id === answered.currentStageId).turnsSpent, 0);
  const next = step(answered, { status: "CONTINUE", summary: "n", workPerformed: [], evidence: ["commit 0123456789abcdef"], blockers: [],
    nextSuggestedAction: "go", progress: { delta: ["commit 0123456789abcdef"] } }, 20);
  assert.equal(next.alert, pe.PROGRESS_ALERT.NONE);
});
