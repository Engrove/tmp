import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as pe from "../lib/progress-engine.mjs";
import * as ps from "../lib/progress-store.mjs";
import {
  composeA2APrompt, validateA2AEnvelope, A2A_GFW_POLICY_COMPLIANCE_NOTE
} from "../lib/a2a.mjs";
import { lintA2AEnvelope } from "../lib/prompt-lint.mjs";
import { parseTargetResponse, validateTargetResponse } from "../lib/response-contract.mjs";
import { createProcess } from "../lib/state.mjs";
import { PROMPT_PROFILE } from "../lib/prompt-profile.mjs";
import { publicMissionWorkQueue } from "../lib/mission-work-queue.mjs";

const NOW = Date.UTC(2026, 0, 1);
const background = await readFile(new URL("../background.js", import.meta.url), "utf8");

function fn(name, deps) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(background);
  assert.ok(match, `function ${name} not found in background.js`);
  const tail = background.slice(match.index);
  const end = /^}\s*$/m.exec(tail);
  return Function(...Object.keys(deps), tail.slice(0, end.index + end[0].length) + `;return ${name};`)(...Object.values(deps));
}
function storage(seed = {}) {
  const data = structuredClone(seed);
  return {
    data,
    async get(keys) {
      if (keys == null) return structuredClone(data);
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(v) { Object.assign(data, structuredClone(v)); },
    async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; }
  };
}
const makeProcess = (extra = {}) => ({
  ...createProcess({ workerId: "w1", windowId: 1, tabId: 2, goal: "GFW GF-1.2.3: synthetic mission", initialPrompt: "work", now: NOW }),
  processId: "process-1", runId: "run-1", turn: 1, phase: "ANALYZING",
  queueContext: { queueId: "q1", itemId: "i1", savedMissionId: "m1" },
  lastResponse: { hash: "h1" }, ...extra
});
const plan = [
  { id: "S1", title: "First", deliverable: "d1", acceptance: "a1" },
  { id: "S2", title: "Second", deliverable: "d2", acceptance: "a2" }
];
const validResponse = (extra = {}) => ({
  schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "synthetic summary",
  workPerformed: ["did a thing"], evidence: ["evidence one"], blockers: [], nextSuggestedAction: "next", ...extra
});
const ledgerWith = (patch = {}, key = "m1") => ({ ...pe.createProgressLedger({ missionKey: key, now: NOW }), ...patch });

// ------------------------------------------------------------------ 1
for (const profileName of ["FULL", "COMPACT"]) {
  test(`composeA2APrompt carries the progress capsule (${profileName})`, () => {
    let ledger = pe.createProgressLedger({ missionKey: "m1", now: NOW });
    ledger = pe.applyTurn(ledger, { targetResponse: validResponse({ progress: { plan } }), turn: 1, now: NOW }).ledger;
    const capsule = pe.buildProgressCapsule(ledger, { now: NOW });
    const compact = profileName === "COMPACT";
    const promptProfile = { schema: "eic.greenfield.prompt-profile.v1", profile: PROMPT_PROFILE[profileName], ordinal: compact ? 2 : 1, lastFullOrdinal: 1, ...(compact ? { anchorConversationKey: "c1" } : {}) };
    const composed = composeA2APrompt({
      process: makeProcess(), objective: "The next bounded owner task", messageType: compact ? "CONTINUATION" : "SESSION_ROTATION",
      promptProfile, progress: capsule, at: NOW
    });
    assert.equal(validateA2AEnvelope(composed.envelope).ok, true);
    assert.equal(lintA2AEnvelope(composed.envelope).ok, true);
    assert.deepEqual(composed.envelope.progress, capsule);
    const keys = Object.keys(composed.envelope);
    assert.equal(keys[keys.indexOf("objective") + 1], "progress");
    const note = composed.envelope.responseContract.note;
    if (compact) {
      assert.match(note, /MANDATORY GFW POLICY COMPLIANCE/);
      assert.ok(note.length < 1000);
      assert.equal(note.includes(A2A_GFW_POLICY_COMPLIANCE_NOTE), false);
    } else {
      assert.ok(note.includes(A2A_GFW_POLICY_COMPLIANCE_NOTE));
    }
  });
}

// ------------------------------------------------------------------ 2
test("response contract admits an object progress field and flags a non-object", () => {
  const ok = validateTargetResponse(validResponse({ progress: { delta: ["x"], plan } }));
  assert.deepEqual(ok.errors.filter((e) => /ADDITIONAL_PROPERTY|PROGRESS/.test(e)), []);
  assert.equal(ok.ok, true);
  const bad = validateTargetResponse(validResponse({ progress: [] }));
  assert.ok(bad.errors.includes("PROGRESS"));
  assert.equal(bad.ok, false);
  assert.ok(validateTargetResponse(validResponse({ progress: null })).errors.includes("PROGRESS"));
  const parsed = parseTargetResponse(JSON.stringify(validResponse({ progress: { delta: ["x"] } })));
  assert.ok(parsed, "parse result");
  assert.equal(JSON.stringify(parsed).includes("ADDITIONAL_PROPERTY"), false);
  const parsedBad = parseTargetResponse(JSON.stringify(validResponse({ progress: [] })));
  assert.ok(JSON.stringify(parsedBad).includes("PROGRESS"));
});

// ------------------------------------------------------------------ 3
test("progress store roundtrip, index and open operator requests", async () => {
  const s = storage();
  const open = ledgerWith({ operatorRequest: { requestId: "r1", ask: "need file", why: "", then: "", options: [], source: "AI", status: "OPEN", createdAt: "", turn: 1, answer: "", answeredAt: "" } }, "open");
  const answered = ledgerWith({ operatorRequest: { requestId: "r2", ask: "a", why: "", then: "", options: [], source: "AI", status: "ANSWERED", createdAt: "", turn: 1, answer: "yes", answeredAt: "" } }, "answered");
  await ps.saveProgressRecord({ missionKey: "open", ledger: open, lastAppliedResponseKey: "k1", lastResult: { verdict: "BLOCKED", alert: "NONE", alertReason: "", parkRequest: null } }, { storage: s });
  await ps.saveProgressRecord({ missionKey: "answered", ledger: answered }, { storage: s });
  await ps.saveProgressRecord({ missionKey: "plain", ledger: ledgerWith({}, "plain") }, { storage: s });
  await ps.saveProgressRecord({ missionKey: "open", ledger: open, lastAppliedResponseKey: "k2" }, { storage: s });
  const loaded = await ps.loadProgressRecord("open", { storage: s });
  assert.equal(loaded.lastAppliedResponseKey, "k2");
  assert.equal(loaded.ledger.missionKey, "open");
  assert.equal(loaded.ledger.operatorRequest.ask, "need file");
  assert.deepEqual(s.data[ps.PROGRESS_STORE_INDEX_KEY], ["answered", "plain", "open"]);
  const fresh = await ps.loadProgressRecord("never-saved", { storage: s });
  assert.equal(fresh.ledger.missionKey, "never-saved");
  assert.equal(fresh.lastResult, null);
  const requests = await ps.openOperatorRequests({ storage: s });
  assert.deepEqual(requests.map((r) => r.missionKey), ["open"]);
  assert.equal(requests[0].operatorRequest.status, "OPEN");
  await assert.rejects(ps.loadProgressRecord("", { storage: s }), /PROGRESS_MISSION_KEY_REQUIRED/);
  assert.equal((await ps.listProgressRecords({ storage: s, keys: ["plain", "missing"] })).length, 1);
});

// ------------------------------------------------------------------ 4
function observer(s, audits = []) {
  const badge = { calls: 0 };
  return {
    badge, audits,
    observe: fn("observeProgressTurn", {
      progressMissionKey: pe.progressMissionKey,
      loadProgressRecord: (k) => ps.loadProgressRecord(k, { storage: s }),
      saveProgressRecord: (r) => ps.saveProgressRecord(r, { storage: s }),
      consumeOperatorAnswer: pe.consumeOperatorAnswer,
      applyProgressTurn: pe.applyTurn,
      audit: async (...a) => { audits.push(a); },
      refreshOperatorAttentionBadge: async () => { badge.calls++; }
    })
  };
}
const stuckWordings = [
  "The shared repository remains unreachable because credentials are missing",
  "Missing credentials still make the shared repository unreachable",
  "Still unreachable: shared repository, credentials missing",
  "Credentials missing, therefore shared repository remains unreachable",
  "Repository (shared) unreachable; the credentials are still missing"
];
const stuckResponse = (i) => validResponse({
  status: "BLOCKED", summary: "No change, still blocked.", workPerformed: ["checked again"], evidence: ["re-read same state"],
  blockers: [stuckWordings[i]], nextSuggestedAction: "retry the same access check"
});

test("observeProgressTurn parks a stuck mission by the 5th identical-blocker turn", async () => {
  const s = storage();
  const { observe, badge, audits } = observer(s);
  let last = null, parkedAt = 0;
  for (let i = 0; i < 5; i++) {
    const process = makeProcess({ turn: i + 1, lastResponse: { hash: `hash-${i}` } });
    last = await observe(process, { targetResponse: stuckResponse(i) });
    assert.ok(last, "observation returned");
    if (last.parkRequest && !parkedAt) parkedAt = i + 1;
  }
  assert.ok(parkedAt >= 1 && parkedAt <= 5, `parked at turn ${parkedAt}`);
  assert.equal(last.alert, "OPERATOR_REQUIRED");
  assert.equal(last.parkRequest.operatorRequest.status, "OPEN");
  assert.ok(badge.calls >= 1);
  assert.ok(audits.some((a) => a[1] === "PROGRESS_TURN_CLASSIFIED"));
  const record = await ps.loadProgressRecord("m1", { storage: s });
  assert.equal(record.ledger.operatorRequest.status, "OPEN");
  assert.equal(record.ledger.counters.turns, 5);
  assert.equal((await ps.openOperatorRequests({ storage: s })).length, 1);
});

test("observeProgressTurn is idempotent for the same turn and response hash", async () => {
  const s = storage();
  const { observe } = observer(s);
  const process = makeProcess({ turn: 3, lastResponse: { hash: "same" } });
  const first = await observe(process, { targetResponse: stuckResponse(0) });
  const countersAfterFirst = structuredClone((await ps.loadProgressRecord("m1", { storage: s })).ledger.counters);
  const second = await observe(process, { targetResponse: stuckResponse(0) });
  assert.deepEqual(second, first);
  assert.deepEqual((await ps.loadProgressRecord("m1", { storage: s })).ledger.counters, countersAfterFirst);
  assert.equal(countersAfterFirst.turns, 1);
  // A different hash is a new turn.
  await observe(makeProcess({ turn: 4, lastResponse: { hash: "other" } }), { targetResponse: stuckResponse(1) });
  assert.equal((await ps.loadProgressRecord("m1", { storage: s })).ledger.counters.turns, 2);
});

test("observeProgressTurn consumes a delivered operator answer and survives storage failure", async () => {
  const s = storage();
  const answered = pe.recordOperatorAnswer(ledgerWith({}), { answer: "use token T", now: NOW });
  await ps.saveProgressRecord({ missionKey: "m1", ledger: answered }, { storage: s });
  const { observe } = observer(s);
  const process = makeProcess({ turn: 9, lastResponse: { hash: "z" }, lastPrompt: { a2a: { progress: { operatorAnswer: { ask: "", answer: "use token T" } } } } });
  await observe(process, { targetResponse: validResponse() });
  assert.equal((await ps.loadProgressRecord("m1", { storage: s })).ledger.operatorRequest, null);
  const broken = observer({ get: async () => { throw new Error("boom"); }, set: async () => {} });
  assert.equal(await broken.observe(makeProcess(), { targetResponse: validResponse() }), null);
  assert.ok(broken.audits.some((a) => a[1] === "PROGRESS_LEDGER_UNAVAILABLE"));
  assert.equal(await broken.observe({}, {}), null);
});

// ------------------------------------------------------------------ 5
const objectiveFor = fn("progressObjectiveFor", {
  PROGRESS_ALERT: pe.PROGRESS_ALERT,
  composeProgressObjective: pe.composeProgressObjective,
  progressAlertInstruction: pe.progressAlertInstruction
});
test("progressObjectiveFor: NONE keeps the handoff verbatim", () => {
  assert.equal(objectiveFor(ledgerWith({}), "  Do the next thing  "), "Do the next thing");
  assert.equal(objectiveFor(null, "plain"), "plain");
});
test("progressObjectiveFor: STRATEGY_SWITCH drops the AI's own handoff but keeps a Greenfield objective", () => {
  let ledger = pe.createProgressLedger({ missionKey: "m1", now: NOW });
  ledger = pe.applyTurn(ledger, { targetResponse: validResponse({ progress: { plan } }), turn: 1, now: NOW }).ledger;
  ledger = { ...ledger, alert: "STRATEGY_SWITCH", alertReason: "BLOCKER_REPEAT", lastHandoff: "AI own handoff text" };
  const dropped = objectiveFor(ledger, "AI own handoff text");
  assert.match(dropped, /STRATEGY_SWITCH/);
  assert.equal(dropped.includes("AI own handoff text"), false);
  assert.equal(dropped.includes("Context objective"), false);
  const kept = objectiveFor(ledger, "Greenfield rotation objective");
  assert.match(kept, /^PROGRESS ALERT STRATEGY_SWITCH/);
  assert.match(kept, /\nContext objective: Greenfield rotation objective$/);
});
test("progressObjectiveFor: an ANSWERED operator request leads with OPERATOR ANSWER", () => {
  const ledger = pe.recordOperatorAnswer(ledgerWith({}), { answer: "use the backup key", now: NOW });
  const out = objectiveFor(ledger, "old handoff");
  assert.ok(out.startsWith("OPERATOR ANSWER: use the backup key"));
  assert.match(out, /Previous handoff: old handoff/);
});

// ------------------------------------------------------------------ 6
function operatorFixture({ withWaitingItem = true } = {}) {
  const s = storage();
  const persisted = [], wakes = [], audits = [];
  const queue = {
    queueId: "q1", windowId: 1, enabled: true,
    items: [
      withWaitingItem && { itemId: "i1", savedMissionId: "m1", status: "PAUSED", pauseUntilMs: Date.now() + 1e9, resume: { operatorWait: { state: "WAIT", missionKey: "m1" } } },
      { itemId: "i2", savedMissionId: "other", status: "PAUSED", pauseUntilMs: 5, resume: { operatorWait: { state: "WAIT", missionKey: "different" } } },
      { itemId: "i3", savedMissionId: "plain", status: "READY", pauseUntilMs: 0, resume: null }
    ].filter(Boolean)
  };
  const respond = fn("progressOperatorResponse", {
    loadProgressRecord: (k) => ps.loadProgressRecord(k, { storage: s }),
    saveProgressRecord: (r) => ps.saveProgressRecord(r, { storage: s }),
    cancelOperatorRequest: pe.cancelOperatorRequest,
    recordOperatorAnswer: pe.recordOperatorAnswer,
    progressSummaryForUi: pe.progressSummaryForUi,
    missionQueueForWindow: async () => ({ queue, settings: { s: 1 } }),
    persistMissionQueue: async (q, settings, ...rest) => { persisted.push({ q: structuredClone(q), settings, rest }); },
    enqueueMissionQueueWake: async (...a) => { wakes.push(a); },
    refreshOperatorAttentionBadge: async () => {},
    appendAudit: async (e) => { audits.push(e); },
    QUEUE_STATUS: { READY: "READY", PAUSED: "PAUSED" },
    nowIso: (t = Date.now()) => new Date(t).toISOString(),
    BACKGROUND_AUDIT_SESSION_ID: "bg"
  });
  return { s, respond, persisted, wakes, audits };
}
async function seedOpen(s) {
  const base = pe.createProgressLedger({ missionKey: "m1", now: NOW });
  base.operatorRequest = { requestId: "r1", ask: "need access", why: "", then: "", options: [], source: "GREENFIELD", status: "OPEN", createdAt: "", turn: 1, answer: "", answeredAt: "" };
  await ps.saveProgressRecord({ missionKey: "m1", ledger: base }, { storage: s });
}

test("progressOperatorResponse ANSWER releases the parked slot and wakes the queue", async () => {
  const f = operatorFixture();
  await seedOpen(f.s);
  const result = await f.respond({ windowId: 1, missionKey: "m1", answer: "  here is the key  ", mode: "ANSWER" });
  assert.equal(result.ok, true);
  assert.equal(result.released, 1);
  assert.equal(result.progress.operatorRequest.status, "ANSWERED");
  assert.equal((await ps.loadProgressRecord("m1", { storage: f.s })).ledger.operatorRequest.answer, "here is the key");
  assert.equal(f.persisted.length, 1);
  const items = f.persisted[0].q.items;
  assert.equal(items[0].status, "READY");
  assert.equal(items[0].pauseUntilMs, 0);
  assert.equal(items[0].resume.operatorWait.state, "ANSWERED");
  assert.equal(items[0].lastOutcome, "PROGRESS_OPERATOR_ANSWERED");
  assert.equal(items[1].status, "PAUSED", "unrelated waiting slot untouched");
  assert.equal(items[1].resume.operatorWait.state, "WAIT");
  assert.equal(items[2].status, "READY");
  assert.equal(f.persisted[0].settings.s, 1);
  assert.deepEqual(f.wakes, [[1, "PROGRESS_OPERATOR_ANSWERED"]]);
  assert.equal(f.audits[0].kind, "PROGRESS_OPERATOR_RESPONSE");
  assert.equal(f.audits[0].payload.released, 1);
  assert.equal((await ps.openOperatorRequests({ storage: f.s })).length, 0);
});
test("progressOperatorResponse CONTINUE cancels the request", async () => {
  const f = operatorFixture();
  await seedOpen(f.s);
  const result = await f.respond({ windowId: 1, missionKey: "m1", mode: "continue" });
  assert.equal(result.released, 1);
  assert.equal(result.progress.operatorRequest.status, "CANCELLED");
  assert.equal(f.persisted[0].q.items[0].status, "READY");
  assert.equal(f.audits[0].payload.mode, "CONTINUE");
});
test("progressOperatorResponse rejects an empty answer and a missing mission key", async () => {
  const f = operatorFixture();
  await seedOpen(f.s);
  await assert.rejects(f.respond({ windowId: 1, missionKey: "m1", answer: "   ", mode: "ANSWER" }), /OPERATOR_ANSWER_REQUIRED/);
  await assert.rejects(f.respond({ windowId: 1, missionKey: "", answer: "x" }), /PROGRESS_MISSION_KEY_REQUIRED/);
  assert.equal(f.persisted.length, 0);
  assert.equal((await ps.loadProgressRecord("m1", { storage: f.s })).ledger.operatorRequest.status, "OPEN");
});
test("progressOperatorResponse with no waiting slot releases nothing and does not wake", async () => {
  const f = operatorFixture({ withWaitingItem: false });
  await seedOpen(f.s);
  const result = await f.respond({ windowId: 1, missionKey: "m1", answer: "ok" });
  assert.equal(result.released, 0);
  assert.equal(f.persisted.length, 0);
  assert.equal(f.wakes.length, 0);
});

// ------------------------------------------------------------------ 7
test("publicMissionWorkQueue exposes operatorWait only for a waiting item", () => {
  const queue = {
    queueId: "q", workerId: "w", windowId: 1, enabled: true, activeItemId: "", cursorOrder: 0,
    items: [
      { itemId: "a", savedMissionId: "m1", label: "A", goal: "Project 1 GFW GF-1.1.1", status: "PAUSED", order: 0, priority: "NORMAL", maxInteractions: 5, pauseUntilMs: Date.now() + 1e6,
        resume: { operatorWait: { state: "WAIT", missionKey: "m1", requestId: "r1", ask: "need file", since: "2026-01-01T00:00:00.000Z" } } },
      { itemId: "b", savedMissionId: "m2", label: "B", goal: "Project 1 GFW GF-1.1.2", status: "PAUSED", order: 1, priority: "NORMAL", maxInteractions: 5,
        resume: { operatorWait: { state: "ANSWERED", missionKey: "m2" } } },
      { itemId: "c", savedMissionId: "m3", label: "C", goal: "Project 1 GFW GF-1.1.3", status: "READY", order: 2, priority: "NORMAL", maxInteractions: 5 }
    ]
  };
  const items = publicMissionWorkQueue(queue, Date.now()).items;
  assert.deepEqual(items[0].operatorWait, { missionKey: "m1", requestId: "r1", ask: "need file", since: "2026-01-01T00:00:00.000Z" });
  assert.equal(items[1].operatorWait, null);
  assert.equal(items[2].operatorWait, null);
});

// ------------------------------------------------------------------ glue extras
test("progressForPrompt returns capsule and alert-aware objective, and degrades safely", async () => {
  const s = storage();
  const answered = pe.recordOperatorAnswer(ledgerWith({}), { answer: "use key K", now: NOW });
  await ps.saveProgressRecord({ missionKey: "m1", ledger: answered }, { storage: s });
  const audits = [];
  const deps = {
    progressMissionKey: pe.progressMissionKey,
    loadProgressRecord: (k) => ps.loadProgressRecord(k, { storage: s }),
    buildProgressCapsule: pe.buildProgressCapsule,
    progressObjectiveFor: objectiveFor,
    audit: async (...a) => { audits.push(a); }
  };
  const forPrompt = fn("progressForPrompt", deps);
  const out = await forPrompt(makeProcess(), "handoff");
  assert.equal(out.progress.schema, pe.PROGRESS_CAPSULE_SCHEMA);
  assert.equal(out.progress.operatorAnswer.answer, "use key K");
  assert.ok(out.objective.startsWith("OPERATOR ANSWER: use key K"));
  assert.deepEqual(await forPrompt({}, "x"), { progress: null, objective: "x" });
  const failing = fn("progressForPrompt", { ...deps, loadProgressRecord: async () => { throw new Error("nope"); } });
  assert.deepEqual(await failing(makeProcess(), "keep"), { progress: null, objective: "keep" });
  assert.equal(audits.at(-1)[1], "PROGRESS_LEDGER_UNAVAILABLE");
});

test("progressSnapshotForWindow summarises active and queued missions", async () => {
  const s = storage();
  await ps.saveProgressRecord({ missionKey: "m1", ledger: ledgerWith({}, "m1") }, { storage: s });
  await ps.saveProgressRecord({ missionKey: "m2", ledger: ledgerWith({}, "m2") }, { storage: s });
  const snap = fn("progressSnapshotForWindow", {
    progressMissionKey: pe.progressMissionKey,
    listProgressRecords: (o) => ps.listProgressRecords({ ...o, storage: s }),
    progressSummaryForUi: pe.progressSummaryForUi
  });
  const out = await snap(makeProcess(), { items: [{ savedMissionId: "m2" }, { savedMissionId: "nope" }, {}] });
  assert.deepEqual(out.map((x) => x.missionKey).sort(), ["m1", "m2"]);
});

test("buildPendingA2A injects progressForPrompt and tickAnalyzing observes the turn", () => {
  assert.match(background, /const progressState = await progressForPrompt\(process, objective\);\s*objective = progressState\.objective;/);
  assert.match(background, /progress: progressState\.progress/);
  assert.match(background, /const progressTurn = await observeProgressTurn\(current, result\);/);
});
