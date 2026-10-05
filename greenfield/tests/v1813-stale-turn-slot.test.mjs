// v1.8.13: a turn that, after the 30-minute F5, shows neither a generation nor
// an answer gives its capacity slot back. Diagnostics 2026-10-05 (4 windows,
// v1.8.12, Max parallella 2, one reserved): 30 dispatches never got an answer;
// each held its slot for the full 120-minute ladder. In the shared pool that
// was 1 918 of 5 810 minutes (33 %), and the other windows waited behind it.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow } from "../lib/process-store.mjs";
import { readGlobalCapacityScheduler } from "../lib/global-capacity-scheduler.mjs";

const MIN = 60_000;

function clock() {
  const RealDate = globalThis.Date;
  let now = RealDate.now();
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  return {
    set(value) { now = value; },
    advance(ms) { now += ms; },
    restore() { globalThis.Date = RealDate; }
  };
}

async function waiting(extraExports = []) {
  const h = await harness({ extraExports });
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt testprojekt - Gf: GF-900." });
  let p = await loadProcessForWindow(1);
  p = await h.mod.tickSending(p);
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");
  // ChatGPT has stopped: no stop button, no streaming, no answer.
  h.page.generating = false;
  h.page.signals = { stopVisible: false, streaming: false, composerBusy: false };
  h.page.pageHealth = { readyState: "complete", visibilityState: "hidden", composerPresent: true, conversationUrl: true, turnCount: 1 };
  const reloads = [];
  h.chrome.tabs.reload = async (_id, options) => { reloads.push(options?.bypassCache ? "CTRL_F5" : "F5"); };
  return { h, p, reloads, sentAt: Date.parse(p.lastPrompt.sentAt) };
}

const activeIds = async (h) => (await readGlobalCapacityScheduler(h.chrome.storage.local)).activeTurns.map((t) => t.processId);

test("v1.8.13 reproduction: a turn without generation after the 30 min F5 gives its slot back and keeps waiting", async () => {
  const t = clock();
  try {
    const { h, p: p0, reloads, sentAt } = await waiting();
    assert.deepEqual(await activeIds(h), [p0.processId], "the dispatched turn holds a slot");

    t.set(sentAt + 29 * MIN);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.deepEqual(await activeIds(h), [p0.processId], "before the first reload nothing is judged");

    t.set(sentAt + 31 * MIN);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.deepEqual(reloads, ["F5"]);
    assert.deepEqual(await activeIds(h), [p0.processId], "the reload must settle first");

    t.set(sentAt + 32 * MIN + 1000);
    const p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.equal(p.phase, "WAITING", "the turn still waits for a late answer");
    assert.deepEqual(await activeIds(h), [], "no generation after the reload: the slot is given back");
    assert.equal(p.waitingRefresh.capacityReleased?.promptHash, p.lastPrompt.hash);
    assert.equal(h.sent.length, 1, "nothing is resent");
  } finally { t.restore(); }
});

test("v1.8.13: the one-minute recovery scan does not take the given-back slot again", async () => {
  const t = clock();
  try {
    const { h, sentAt } = await waiting();
    t.set(sentAt + 31 * MIN);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    t.set(sentAt + 32 * MIN + 1000);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.deepEqual(await activeIds(h), []);
    await h.mod.hydrateProcesses("recovery-scan");
    assert.deepEqual(await activeIds(h), [], "reconcile must respect the released slot");
  } finally { t.restore(); }
});

test("v1.8.13: generation seen again after the release takes the slot back (reality wins)", async () => {
  const t = clock();
  try {
    const { h, p: p0, sentAt } = await waiting();
    t.set(sentAt + 31 * MIN);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    t.set(sentAt + 32 * MIN + 1000);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.deepEqual(await activeIds(h), []);
    h.page.generating = true;
    h.page.signals = { stopVisible: true, streaming: false, composerBusy: true };
    t.set(sentAt + 34 * MIN);
    const p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.deepEqual(await activeIds(h), [p0.processId]);
    assert.equal(p.waitingRefresh.capacityReleased || null, null);
  } finally { t.restore(); }
});

test("v1.8.13: a visible generation at 31 min keeps the slot (no release while ChatGPT works)", async () => {
  const t = clock();
  try {
    const { h, p: p0, reloads, sentAt } = await waiting();
    h.page.generating = true;
    h.page.signals = { stopVisible: true, streaming: false, composerBusy: true };
    for (const minutes of [31, 33, 61]) {
      t.set(sentAt + minutes * MIN);
      await h.mod.tickWaiting(await loadProcessForWindow(1));
    }
    assert.deepEqual(reloads, []);
    assert.deepEqual(await activeIds(h), [p0.processId]);
  } finally { t.restore(); }
});

test("v1.8.13: the ladder is unchanged after the release: Ctrl-F5 at 60 and 90, switch at 120, nothing resent", async () => {
  const t = clock();
  try {
    const { h, reloads, sentAt } = await waiting();
    let p;
    for (const minutes of [31, 32.5, 61, 91]) {
      t.set(sentAt + minutes * MIN);
      p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    }
    assert.deepEqual(reloads, ["F5", "CTRL_F5", "CTRL_F5"]);
    assert.equal(p.phase, "WAITING");
    t.set(sentAt + 121 * MIN);
    p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.equal(p.phase, "ROTATING");
    assert.equal(h.sent.length, 1);
    assert.deepEqual(await activeIds(h), []);
  } finally { t.restore(); }
});

test("v1.8.13 E2E: with one shared slot, a window waiting behind a dead turn gets the slot when it is given back", async () => {
  const { OPERATOR_SETTINGS_KEY } = await import("../lib/operator-settings.mjs");
  const { requestGlobalTurnSlot } = await import("../lib/global-capacity-scheduler.mjs");
  const t = clock();
  try {
    const h = await harness({ seed: { [OPERATOR_SETTINGS_KEY]: { maxActiveSessions: 1 } } });
    h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
    await h.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt testprojekt - Gf: GF-900." });
    let p = await loadProcessForWindow(1);
    p = await h.mod.tickSending(p);
    p = await h.mod.tickSending(p);
    assert.equal(p.phase, "WAITING");
    Object.assign(h.page, { generating: false, signals: { stopVisible: false, streaming: false, composerBusy: false },
      pageHealth: { readyState: "complete", visibilityState: "hidden", composerPresent: true, conversationUrl: true, turnCount: 1 } });
    h.chrome.tabs.reload = async () => {};
    const OTHER = "process-00000000-0000-4000-8000-0000000000b2";
    const ask = () => requestGlobalTurnSlot({ processId: OTHER, windowId: 2,
      workerId: "worker-00000000-0000-4000-8000-0000000000b2", promptHash: "b2", capacity: 1, configuredCapacity: 1, storage: h.chrome.storage.local });
    const other = await ask();
    assert.equal(other.allowed, false, "the other window waits behind the dead turn");
    assert.equal(other.reason, "GLOBAL_CAPACITY_WAIT");
    const sentAt = Date.parse(p.lastPrompt.sentAt);
    t.set(sentAt + 31 * MIN);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    t.set(sentAt + 32 * MIN + 1000);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    const scheduler = await readGlobalCapacityScheduler(h.chrome.storage.local, { capacity: 1, configuredCapacity: 1 });
    assert.deepEqual(scheduler.runnableProcessIds, [OTHER], "the release wakes the waiting window");
    const granted = await ask();
    assert.equal(granted.allowed, true, "the waiting window runs after 32 min instead of 120");
    assert.deepEqual(await activeIds(h), [OTHER]);
  } finally { t.restore(); }
});

test("v1.8.13 E2E: a late answer after the hand-back is still captured, nothing is resent", async () => {
  const { sha256Hex } = await import("../lib/common.mjs");
  const { ANALYSIS_SCHEMA } = await import("../lib/contracts.mjs");
  const t = clock();
  try {
    const { h, sentAt } = await waiting();
    h.chrome.runtime.sendMessage = async (message) => message?.type === "EIC_GF_ANALYZE_PIPELINE"
      ? { ok: true, nano: null, decision: { schema: ANALYSIS_SCHEMA, disposition: "CONTINUE", targetDisposition: "CONTINUE", objectiveStatus: "PENDING",
          nanoTaskAssessment: "NOT_REQUESTED", progressEvidence: "Bounded progress.", analysis: "Mocked.", nextPrompt: "Continue.",
          exactTarget: "Objective.", ownerEvidence: "Response.", reversibility: "YES", rollbackPath: "Owner state.", readbackPlan: "Readback.",
          materialAmbiguity: "NONE", humanAuthorityRequired: false, confidence: "HIGH" } }
      : { ok: true };
    t.set(sentAt + 31 * MIN);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    t.set(sentAt + 32 * MIN + 1000);
    let p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.deepEqual(await activeIds(h), []);
    const answer = JSON.stringify({ schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "sent svar" });
    const hash = await sha256Hex(answer);
    Object.assign(h.page, { assistantCount: 1, lastAssistantId: "assistant-late-1", assistantText: answer, assistantHash: hash,
      autonomousTurn: { resolvedUserTurnId: p.lastPrompt.dispatchedUserTurnId, resolvedBy: "USER_TURN_ID", assistantFound: true,
        assistantId: "assistant-late-1", assistantText: answer, assistantTextLength: answer.length, assistantHash: hash,
        assistantOwnerKind: "SHELL_MESSAGE", assistantOwnerTrusted: true, assistantReplicaCount: 1, assistantGenerating: false, assistantSignals: {} } });
    for (let i = 0; i < 12 && p.phase === "WAITING"; i += 1) {
      t.advance(4000);
      p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    }
    assert.notEqual(p.phase, "WAITING", "the late answer is admitted");
    assert.equal(p.lastResponse?.hash, hash);
    assert.equal(h.sent.length, 1, "nothing is resent");
    assert.deepEqual(await activeIds(h), [], "no slot is left behind");
  } finally { t.restore(); }
});

test("v1.8.13: a busy composer alone neither releases nor takes back the slot", async () => {
  const t = clock();
  try {
    const { h, p: p0, sentAt } = await waiting();
    h.page.signals = { stopVisible: false, streaming: false, composerBusy: true };
    t.set(sentAt + 31 * MIN);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    t.set(sentAt + 32 * MIN + 1000);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.deepEqual(await activeIds(h), [p0.processId], "a busy composer may be a generation: keep the slot");
    h.page.signals = { stopVisible: false, streaming: false, composerBusy: false };
    t.set(sentAt + 33 * MIN);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.deepEqual(await activeIds(h), []);
    h.page.signals = { stopVisible: false, streaming: false, composerBusy: true };
    h.page.generating = true;
    t.set(sentAt + 34 * MIN);
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.deepEqual(await activeIds(h), [], "a loading page's busy composer does not take the slot back");
  } finally { t.restore(); }
});

test("v1.8.13 guard: a release after a generation deferral leaves the ended deferral at 0", async () => {
  const t = clock();
  try {
    const { h, sentAt } = await waiting();
    h.page.generating = true;
    h.page.signals = { stopVisible: true, streaming: false, composerBusy: true };
    t.set(sentAt + 31 * MIN);
    let p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.ok(p.waitingRefresh.generationHoldUntilMs > 0, "deferral while ChatGPT generates");
    h.page.generating = false;
    h.page.signals = { stopVisible: false, streaming: false, composerBusy: false };
    t.set(sentAt + 32 * MIN);
    p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.equal(p.waitingRefresh.stage, "F5_30");
    t.set(sentAt + 33 * MIN + 1000);
    p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.equal(p.waitingRefresh.capacityReleased?.promptHash, p.lastPrompt.hash);
    assert.equal(Number(p.waitingRefresh.generationHoldUntilMs || 0), 0, "the ended deferral is not written back");
    assert.deepEqual(await activeIds(h), []);
  } finally { t.restore(); }
});
