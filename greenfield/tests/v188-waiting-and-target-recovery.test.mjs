import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow } from "../lib/process-store.mjs";
import { addMissionWorkItem } from "../lib/mission-work-queue.mjs";
import { ensureWorkerBinding } from "../lib/worker-identity.mjs";
import { evaluateWaitingRefresh, waitingRefreshSchedule } from "../lib/waiting-refresh.mjs";
import { resolveManagedGptRoot, EIC_SURFACE_STATE_KEY } from "../lib/managed-eic-surface.mjs";
import { managedOverlayOverview } from "../lib/overlay-summary.mjs";

const MIN = 60_000;
const ROOT = "https://chatgpt.com/g/g-test-eic";
const OTHER = "https://chatgpt.com/g/g-other-matlogg";
const CONV = `${ROOT}/c/abc-123`;
const BASE = Date.parse("2026-09-26T08:00:00Z");
const iso = (n) => new Date(n).toISOString();

// Mock the entire clock, not only Date.now: write-ahead ISO receipts must
// advance with the ticks being tested.
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
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 71 - Greenfield Works - Gf: GF-052." });
  let p = await loadProcessForWindow(1);
  p = await h.mod.tickSending(p);
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");
  h.page.signals = { ...h.page.signals, stopVisible: true, streaming: false, composerBusy: true };
  return { h, p };
}

test("v1.8.8 regression: observed generation defers every stale-ladder action before the bounded limit", () => {
  for (const [minutes, stage] of [[31, ""], [61, "F5_30"], [91, "CTRL_F5_60"], [121, "CTRL_F5_90"]]) {
    const d = evaluateWaitingRefresh({
      now: BASE + minutes * MIN, staleSince: iso(BASE), waitingSince: iso(BASE),
      acknowledged: true, stage, generating: true
    });
    assert.equal(d.action, "WAIT", `generation must not be interrupted at ${minutes}m`);
    assert.equal(d.code, "WAITING_ACTIVE_GENERATION");
    assert.equal(d.stage, stage, "do not consume a stage while deferring it");
  }
});

test("v1.8.8 generation hold is bounded and never weakens unacknowledged/completed-response gates", () => {
  const params = { staleSince: iso(BASE), waitingSince: iso(BASE), acknowledged: true, generating: true };
  assert.equal(evaluateWaitingRefresh({ ...params, now: BASE + 240 * MIN - 1 }).action, "WAIT");
  assert.equal(evaluateWaitingRefresh({ ...params, now: BASE + 240 * MIN }).action, "F5");
  assert.equal(evaluateWaitingRefresh({ ...params, now: BASE + 31 * MIN, acknowledged: false }).code, "PROMPT_NOT_ACKNOWLEDGED");
  assert.equal(evaluateWaitingRefresh({ ...params, now: BASE + 31 * MIN, responseComplete: true }).code, "RESPONSE_READY");
  assert.equal(evaluateWaitingRefresh({ ...params, now: BASE + 31 * MIN, generating: false }).action, "F5");
});

test("v1.8.8 regression: overdue recovery steps have a real settle interval, not one destructive action per tick", () => {
  const r = evaluateWaitingRefresh({
    now: BASE + 121 * MIN + 1000,
    staleSince: iso(BASE), waitingSince: iso(BASE), acknowledged: true,
    stage: "F5_30", requestedAt: iso(BASE + 121 * MIN)
  });
  assert.equal(r.action, "WAIT");
  assert.equal(r.code, "WAITING_RECOVERY_SETTLING");
  assert.equal(evaluateWaitingRefresh({
    now: BASE + 122 * MIN, staleSince: iso(BASE), acknowledged: true,
    stage: "F5_30", requestedAt: iso(BASE + 121 * MIN)
  }).action, "CTRL_F5");
});

test("v1.8.8 countdown uses the same late-stage timing as the recovery evaluator", () => {
  const s = waitingRefreshSchedule({ staleSince: iso(BASE), stage: "F5_30", requestedAt: iso(BASE + 121 * MIN) });
  assert.equal(s.nextAtMs, BASE + 122 * MIN);
  assert.equal(s.rotateAtMs, BASE + 124 * MIN);
});

test("v1.8.8 E2E: a long generated response is not reloaded or resent at 31/121 minutes", async () => {
  const t = clock();
  try {
    const { h } = await waiting();
    let p = await loadProcessForWindow(1);
    const sentAt = Date.parse(p.lastPrompt.sentAt);
    const reloads = [];
    h.chrome.tabs.reload = async (_id, options) => { reloads.push(options); };
    for (const minutes of [31, 121]) {
      t.set(sentAt + minutes * MIN);
      p = await h.mod.tickWaiting(await loadProcessForWindow(1));
      assert.deepEqual(reloads, []);
      assert.equal(p.phase, "WAITING");
      assert.equal(h.sent.length, 1);
    }
    const overview = managedOverlayOverview(p);
    assert.ok(overview.countdown.some((s) => /respit/i.test(s.template)),
      "the UI must disclose the generation deferral instead of a stuck 0:00 TTL");
  } finally { t.restore(); }
});

test("v1.8.8 E2E: model-evidence hold preserves bounded generation wait but cannot deadlock recovery", async () => {
  const t = clock();
  try {
    const { h } = await waiting();
    let p = await loadProcessForWindow(1);
    const sentAt = Date.parse(p.lastPrompt.sentAt);
    h.page.modelEvidence = { ...h.page.modelEvidence, modelLabel: "Direkt", effortLabel: "", reasoningControlSeen: false, effortControlSeen: false };
    const reloads = [];
    h.chrome.tabs.reload = async (_id, options) => { reloads.push(options?.bypassCache ? "CTRL_F5" : "F5"); };
    t.set(sentAt + 31 * MIN);
    p = await h.mod.tickWaiting(p);
    assert.deepEqual(reloads, []);
    assert.equal(p.safety.hold.code, "THINKING_MODE_UNVERIFIED");
    t.set(sentAt + 240 * MIN);
    p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.deepEqual(reloads, ["F5"]);
    for (const minutes of [240 + 1/60, 240.5]) {
      t.set(sentAt + minutes * MIN);
      p = await h.mod.tickWaiting(await loadProcessForWindow(1));
      assert.deepEqual(reloads, ["F5"], "catch-up must not storm the renderer");
    }
    t.set(sentAt + 241 * MIN);
    p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.deepEqual(reloads, ["F5", "CTRL_F5"]);
    t.set(sentAt + 242 * MIN);
    p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.deepEqual(reloads, ["F5", "CTRL_F5", "CTRL_F5"]);
    t.set(sentAt + 243 * MIN);
    p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.equal(p.phase, "ROTATING", "a stuck positive signal cannot retain the slot forever");
    assert.equal(h.sent.length, 1, "all recovery steps remain non-sending");
  } finally { t.restore(); }
});

test("v1.8.8 E2E: generation ending without a response resumes the ordinary bounded ladder", async () => {
  const t = clock();
  try {
    const { h } = await waiting();
    const p0 = await loadProcessForWindow(1);
    const sentAt = Date.parse(p0.lastPrompt.sentAt);
    const reloads = [];
    h.chrome.tabs.reload = async (_id, options) => { reloads.push(options); };
    t.set(sentAt + 40 * MIN);
    await h.mod.tickWaiting(p0);
    assert.equal(reloads.length, 0);
    h.page.generating = false;
    t.advance(1000);
    const p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.equal(reloads.length, 1);
    assert.equal(p.waitingRefresh.stage, "F5_30");
  } finally { t.restore(); }
});

test("v1.8.8 regression: current or remembered EIC identity wins over an unrelated active GPT URL", () => {
  assert.equal(resolveManagedGptRoot(`${OTHER}/c/xyz`, ROOT, ""), ROOT);
  assert.equal(resolveManagedGptRoot(`${OTHER}/c/xyz`, "", ROOT), ROOT);
  assert.equal(resolveManagedGptRoot("https://chatgpt.com/g/g-test/c/x", ROOT, OTHER), ROOT);
  assert.equal(resolveManagedGptRoot("https://chatgpt.com/", "", ROOT), ROOT);
  assert.equal(resolveManagedGptRoot(CONV, "", ""), ROOT, "operator first-use custom GPT selection is preserved");
});

test("v1.8.8 E2E: a queue started from a different GPT navigates to remembered EIC", async () => {
  const h = await harness({ extraExports: ["startMissionQueue", "tickRotating"] });
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  await h.chrome.storage.local.set({ [EIC_SURFACE_STATE_KEY]: { lastKnownGoodEicUrl: ROOT } });
  h.tab.url = `${OTHER}/c/xyz`;
  h.page.url = h.tab.url;
  h.page.modelEvidence.gptSurface = { composerName: "Matlogg", headerName: "Matlogg" };
  const worker = await ensureWorkerBinding(1);
  await addMissionWorkItem(1, "Projekt: 71 - Greenfield Works - Gf: GF-052.", {
    storage: h.chrome.storage.local, workerId: worker.workerId, savedMissionId: "mission-052"
  });
  await h.mod.startMissionQueue({ windowId: 1 });
  let p = await loadProcessForWindow(1);
  assert.equal(p.gptRoot, ROOT);
  p = await h.mod.tickRotating(p);
  assert.equal(h.tab.url, ROOT);
  assert.equal(h.sent.length, 0);
});

test("v1.8.8 regression: an in-flight EIC root redirect must not erase the last conversation address", async () => {
  const { h } = await waiting(["observeSafetyForProcess"]);
  let p = await loadProcessForWindow(1);
  assert.equal(p.lastManagedUrl, CONV);
  h.tab.url = ROOT;
  Object.assign(h.page, { url: ROOT, userCount: 0, assistantCount: 0, generating: false });
  await h.mod.observeSafetyForProcess(p, h.page);
  p = await loadProcessForWindow(1);
  assert.equal(p.lastManagedUrl, CONV, "a landing page is not the unanswered conversation");
});

test("v1.8.8 E2E: tab recovery restores the known unanswered conversation, not its redirected landing root", async () => {
  const { h } = await waiting(["executeTabRecoveryStep"]);
  let p = await loadProcessForWindow(1);
  p.lastManagedUrl = CONV;
  h.tab.url = ROOT;
  h.page.url = ROOT;
  const reloads = [];
  h.chrome.tabs.reload = async (_id, options) => { reloads.push(options); };
  await h.mod.executeTabRecoveryStep(p, "RELOAD");
  assert.equal(h.tab.url, CONV);
  assert.equal(reloads.length, 0, "navigate to the proven thread instead of reloading the wrong page");
  assert.equal(h.sent.length, 1);
});

test("v1.8.8 E2E: a healthy empty landing page cannot clear a missing in-flight thread incident", async () => {
  const t = clock();
  try {
    const { h } = await waiting();
    let p = await loadProcessForWindow(1);
    h.tab.url = ROOT;
    Object.assign(h.page, {
      url: ROOT, generating: false, userCount: 0, assistantCount: 0,
      lastUserId: "", lastUserHash: "", lastUserText: "",
      pageHealth: { readyState: "complete", visibilityState: "visible", visibleForMs: 10000,
        frameGapMs: 10, composerPresent: true, conversationUrl: false, turnCount: 0 }
    });
    p = await h.mod.tickWaiting(p);
    assert.equal(p.tabHealth?.incident?.condition, "THREAD_MISSING");
    t.advance(91_000);
    p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.equal(h.tab.url, CONV);
    assert.equal(h.sent.length, 1);
  } finally { t.restore(); }
});
