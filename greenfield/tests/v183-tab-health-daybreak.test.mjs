import test from "node:test";
import assert from "node:assert/strict";

import {
  TAB_CONDITION,
  TAB_HEALTH,
  TAB_RECOVERY_STEP,
  advanceTabHealth,
  conditionFromBridgeError,
  pageConditionFromHealth
} from "../lib/tab-health.mjs";
import {
  PROVIDER_BLOCK,
  providerBlockObjective,
  providerNoticeBlocks,
  recordProviderBlock
} from "../lib/provider-notice.mjs";
import { buildLearningControlContext } from "../lib/learning-control.mjs";
import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow, saveProcess } from "../lib/process-store.mjs";
import {
  addMissionWorkItem,
  createQueueContext,
  loadMissionWorkQueue,
  saveMissionWorkQueue
} from "../lib/mission-work-queue.mjs";

const HOUR = 60 * 60 * 1000;
const NOTICE_EN = {
  kind: "CONTENT_BLOCKED_DAYBREAK",
  outsideMessageTurns: true,
  headlineMatched: true,
  cyberWordMatched: true,
  afterExpectedUserTurn: true,
  sample: "This content can’t be shown We take extra care with some cybersecurity requests. If you’re doing authorized security work, apply for Daybreak to get broader access.",
  noticeKey: "/g/g-x/c/abc|u1"
};

// ---------------------------------------------------------------------------
// Tab health (pure).

test("v1.8.3 bridge errors map to tab conditions; page conditions only when they block progress", () => {
  assert.equal(conditionFromBridgeError("CONTENT_BRIDGE_TIMEOUT"), TAB_CONDITION.BRIDGE_UNRESPONSIVE);
  assert.equal(conditionFromBridgeError("CONTENT_BRIDGE_MISSING"), TAB_CONDITION.BRIDGE_MISSING);
  assert.equal(conditionFromBridgeError("MANAGED_TAB_DISCARDED"), TAB_CONDITION.TAB_DISCARDED);
  assert.equal(conditionFromBridgeError("MANAGED_TAB_MISSING"), "", "a closed tab keeps the existing rebind path");

  const base = { readyState: "complete", visibilityState: "visible", visibleForMs: 120_000, frameGapMs: 0, composerPresent: true, conversationUrl: true, turnCount: 4 };
  assert.equal(pageConditionFromHealth(base, { phase: "WAITING" }), "");
  assert.equal(pageConditionFromHealth({ ...base, frameGapMs: 60_000 }, { phase: "WAITING" }), TAB_CONDITION.RENDER_STALLED);
  assert.equal(pageConditionFromHealth({ ...base, frameGapMs: 60_000, visibilityState: "hidden" }, { phase: "WAITING" }), "", "hidden pages are never judged");
  assert.equal(pageConditionFromHealth({ ...base, frameGapMs: 60_000, visibleForMs: 20_000 }, { phase: "WAITING" }), "", "must be visible long enough");
  assert.equal(pageConditionFromHealth({ ...base, composerPresent: false }, { phase: "SENDING" }), TAB_CONDITION.COMPOSER_MISSING);
  assert.equal(pageConditionFromHealth({ ...base, composerPresent: false }, { phase: "WAITING" }), "", "no composer is needed while waiting");
  assert.equal(pageConditionFromHealth({ ...base, turnCount: 0 }, { phase: "WAITING" }), TAB_CONDITION.THREAD_MISSING);
  assert.equal(pageConditionFromHealth({ ...base, readyState: "loading", composerPresent: false }, { phase: "SENDING" }), "");
});

test("v1.8.3 recovery ladder: reload, hard reload, same URL, new tab, give up - spaced and budgeted", () => {
  let now = Date.parse("2026-09-25T08:00:00Z");
  let state = null;
  const steps = [];
  for (let i = 0; i < 40 && steps.at(-1) !== TAB_RECOVERY_STEP.GIVE_UP; i += 1) {
    const result = advanceTabHealth(state, TAB_CONDITION.BRIDGE_UNRESPONSIVE, { now });
    state = result.state;
    if (result.action) steps.push(result.action);
    now += 20_000;
  }
  assert.deepEqual(steps, ["RELOAD", "HARD_RELOAD", "NAVIGATE_SAME_URL", "REPLACE_TAB", "GIVE_UP"]);
  const spacing = state.incident.steps.map((row, i, all) => i ? row.atMs - all[i - 1].atMs : 0).slice(1);
  assert.ok(spacing.every((ms) => ms >= TAB_HEALTH.STEP_SETTLE_MS), "each step waits for the previous one to settle");

  const missing = advanceTabHealth(null, TAB_CONDITION.BRIDGE_MISSING, { now });
  assert.equal(missing.action, TAB_RECOVERY_STEP.REINJECT_BRIDGE, "a live page without the bridge is re-injected first");

  const ui = advanceTabHealth(null, TAB_CONDITION.COMPOSER_MISSING, { now });
  assert.equal(ui.action, "", "UI conditions get a grace period");
  const uiLater = advanceTabHealth(ui.state, TAB_CONDITION.COMPOSER_MISSING, { now: now + TAB_HEALTH.UI_PARTIAL_GRACE_MS });
  assert.equal(uiLater.action, TAB_RECOVERY_STEP.RELOAD);

  const budget = { incident: null, budget: Array.from({ length: TAB_HEALTH.BUDGET_MAX_ACTIONS }, (_, i) => now - i * 60_000) };
  assert.equal(advanceTabHealth(budget, TAB_CONDITION.BRIDGE_UNRESPONSIVE, { now }).action, "BUDGET_EXHAUSTED");
  const healed = advanceTabHealth({ incident: { condition: "RENDER_STALLED", sinceMs: now } }, "", { now });
  assert.equal(healed.state.incident, null);
});

// ---------------------------------------------------------------------------
// Provider content block (pure).

test("v1.8.3 Daybreak: rotate first, then pause 2 h / 6 h / 24 h; the chain resets after 24 h; never BLOCKED", () => {
  assert.equal(providerNoticeBlocks(NOTICE_EN), true);
  assert.equal(providerNoticeBlocks({ ...NOTICE_EN, outsideMessageTurns: false }), false);
  assert.equal(providerNoticeBlocks({ ...NOTICE_EN, headlineMatched: false, cyberWordMatched: false }), false);
  assert.equal(providerNoticeBlocks({ ...NOTICE_EN, afterExpectedUserTurn: false }), false, "an older notice above our turn");

  let now = Date.parse("2026-09-25T08:00:00Z");
  let history = null;
  const actions = [];
  for (let i = 0; i < 5; i += 1) {
    const decision = recordProviderBlock(history, { noticeKey: `k${i}`, now });
    history = decision.history;
    actions.push([decision.action, decision.pauseMs / HOUR]);
    now += HOUR;
  }
  assert.deepEqual(actions, [["ROTATE", 0], ["PAUSE", 2], ["PAUSE", 6], ["PAUSE", 24], ["PAUSE", 24]]);
  const duplicate = recordProviderBlock(history, { noticeKey: "k4", now });
  assert.equal(duplicate.counted, false, "the same notice is never counted twice");
  const afterQuietDay = recordProviderBlock(history, { noticeKey: "k5", now: now + 25 * HOUR });
  assert.deepEqual([afterQuietDay.action, afterQuietDay.chainLength], ["ROTATE", 1]);

  const objective = providerBlockObjective("Run package P4.", NOTICE_EN, { chainLength: 2 });
  assert.match(objective, /This content can’t be shown/);
  assert.match(objective, /effects are unknown: re-read the factual owner state/);
  assert.match(objective, /Do not resend the same request verbatim/);
  assert.match(objective, /status=BLOCKED with the notice as evidence/);
  assert.match(objective, /block 2 for this GFW within 24 hours/);
  assert.match(objective, /Run package P4\./);
});

test("v1.8.3 learning control treats a provider block as post-failure and a repeat as a recurring family", () => {
  const process = {
    processId: "p", runId: "r", generation: 2, turn: 5, sessionSeq: 2, goal: "Projekt: 67 - EIC Learning - Gf: GF-051.",
    providerContentBlocks: { events: [{ atMs: Date.now() - HOUR, noticeKey: "a" }, { atMs: Date.now() - 1000, noticeKey: "b" }] }
  };
  const context = buildLearningControlContext({
    process,
    messageType: "SESSION_ROTATION",
    previousDisposition: "PROVIDER_CONTENT_BLOCKED",
    sessionRotation: { sourceResponseState: "PROMPT_BLOCKED_BY_PROVIDER" }
  });
  const keypoints = context.keypoints.map((row) => `${row.keypoint}:${row.trigger}`);
  assert.ok(keypoints.includes("POST_FAILURE_FALSE_BLOCKER_UNKNOWN_EFFECT_RECOVERY:PREVIOUS_DISPOSITION_PROVIDER_CONTENT_BLOCKED"), keypoints.join(","));
  assert.ok(keypoints.includes("RECURRING_SOFT_BLOCKER_OR_FAILURE_FAMILY:PROVIDER_CONTENT_BLOCK_REPEATED"));
});

// ---------------------------------------------------------------------------
// E2E through background.js.

function realClock() {
  const realNow = Date.now;
  let offset = 0;
  return {
    advance(ms) { offset += ms; Date.now = () => realNow() + offset; },
    restore() { Date.now = realNow; }
  };
}

async function waiting(h, goal = "Projekt: 67 - EIC Learning - Gf: GF-051.") {
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  await h.mod.startRun({ windowId: 1, goal });
  let p = await loadProcessForWindow(1);
  p = await h.mod.tickSending(p);
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");
  return p;
}

// The harness never runs timers by itself. Expire every page-call deadline
// (and only those) until the promise settles, as Chrome would after the delay.
async function settleWithDeadlines(h, promise) {
  let settled = false;
  const tracked = promise.then((value) => { settled = true; return value; }, (error) => { settled = true; throw error; });
  const fired = new Set();
  const until = Date.now() + 5000;
  while (!settled && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const row of h.timers) {
      if (!settled && row.fn?.deadlineCode && !fired.has(row)) {
        fired.add(row);
        row.fn();
      }
    }
  }
  return tracked;
}

test("v1.8.3 E2E: a hung page no longer freezes the tick; the recovery ladder acts on the tab", async () => {
  const h = await harness();
  const t = realClock();
  try {
    let p = await waiting(h);
    const reloads = [];
    h.chrome.tabs.reload = async (tabId, options = {}) => { reloads.push(options.bypassCache ? "CTRL_F5" : "F5"); };
    const bridge = h.chrome.tabs.sendMessage;
    h.chrome.tabs.sendMessage = () => new Promise(() => {}); // renderer never answers

    p = await settleWithDeadlines(h, h.mod.tickWaiting(p));
    assert.equal(p.phase, "DETACHED");
    assert.equal(p.detached.reason, "CONTENT_BRIDGE_TIMEOUT");

    const recover = () => settleWithDeadlines(h, h.mod.tickProcess(p.processId, "test"));
    p = await recover();
    assert.deepEqual(reloads, ["F5"]);
    assert.equal(p.tabHealth.incident.condition, "BRIDGE_UNRESPONSIVE");
    assert.ok(p.responseObservationTrace.some((row) => row.reason === "TAB_RECOVERY_RELOAD:BRIDGE_UNRESPONSIVE"));

    t.advance(TAB_HEALTH.STEP_SETTLE_MS);
    p = await recover();
    assert.deepEqual(reloads, ["F5", "CTRL_F5"]);

    // The page answers again: the process resumes and the incident closes.
    h.chrome.tabs.sendMessage = bridge;
    p = await h.mod.tickProcess(p.processId, "test");
    assert.equal(p.phase, "WAITING");
    assert.equal(p.tabHealth.incident, null);
  } finally {
    t.restore();
  }
});

test("v1.8.3 E2E: a missing composer in SENDING is reloaded after the grace period; never during a dispatch", async () => {
  const h = await harness();
  const t = realClock();
  try {
    await h.mod.startRun({ windowId: 1, goal: "Projekt: 67 - EIC Learning - Gf: GF-051." });
    let p = await loadProcessForWindow(1);
    assert.equal(p.phase, "SENDING");
    const reloads = [];
    h.chrome.tabs.reload = async () => { reloads.push("F5"); };
    h.page.pageHealth = { readyState: "complete", visibilityState: "visible", visibleForMs: 0, frameGapMs: 0, composerPresent: false, conversationUrl: true, turnCount: 2, providerNotice: null };
    p = await h.mod.tickSending(p);
    assert.equal(reloads.length, 0, "grace period first");
    assert.equal(p.tabHealth.incident.condition, "COMPOSER_MISSING");
    t.advance(TAB_HEALTH.UI_PARTIAL_GRACE_MS);
    p = await h.mod.tickSending(await loadProcessForWindow(1));
    assert.deepEqual(reloads, ["F5"]);

    // With a dispatch whose effect is being reconciled, the page is left alone.
    const inFlight = await loadProcessForWindow(1);
    await saveProcess({ ...inFlight, pendingPrompt: { ...inFlight.pendingPrompt, dispatch: { operationId: "d1", status: "SUBMITTED", effectPossible: true, acknowledged: false } } });
    t.advance(TAB_HEALTH.STEP_SETTLE_MS * 2);
    await h.mod.tickSending(await loadProcessForWindow(1)).catch(() => undefined);
    assert.deepEqual(reloads, ["F5"]);
  } finally {
    t.restore();
  }
});

test("v1.8.3 E2E: a Daybreak notice after Greenfield's turn rotates the same GFW into a fresh chat", async () => {
  const h = await harness();
  const t = realClock();
  try {
    let p = await waiting(h);
    const turnBefore = p.turn;
    h.page.generating = false; // ChatGPT stopped: the answer was withheld
    h.page.pageHealth = { readyState: "complete", visibilityState: "visible", visibleForMs: 0, frameGapMs: 0, composerPresent: true, conversationUrl: true, turnCount: 3, providerNotice: NOTICE_EN };
    p = await h.mod.tickWaiting(p);
    assert.equal(p.phase, "WAITING", "first sighting is only recorded");
    assert.equal(p.providerNoticePending.noticeKey, NOTICE_EN.noticeKey);
    t.advance(4000);
    p = await h.mod.tickWaiting(p);
    assert.equal(p.phase, "ROTATING");
    assert.equal(p.sessionRotation.reasonCode, "PROVIDER_CONTENT_BLOCKED");
    assert.equal(p.sessionSeq, 2);
    assert.equal(p.turn, turnBefore + 1);
    const envelope = p.pendingPrompt.a2a;
    assert.equal(envelope.messageType, "SESSION_ROTATION");
    assert.equal(envelope.continuity.previousDisposition, "PROVIDER_CONTENT_BLOCKED");
    assert.equal(envelope.continuity.sessionRotation.sourceResponseState, "PROMPT_BLOCKED_BY_PROVIDER");
    assert.match(envelope.objective, /This content can’t be shown/);
    assert.equal(p.pendingPrompt.promptProfile.profile, "FULL");
    assert.equal(p.providerContentBlocks.events.length, 1);
    assert.equal(p.providerContentBlocks.pauseUntilMs, 0);
  } finally {
    t.restore();
  }
});

test("v1.8.3 E2E: a repeated Daybreak block pauses the queue slot for 2 h (never BLOCKED) and the queue advances", async () => {
  const h = await harness();
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 67 - EIC Learning - Gf: GF-051." });
  let p = await loadProcessForWindow(1);
  const storage = h.chrome.storage.local;
  for (const [goal, id] of [["Projekt: 67 - EIC Learning - Gf: GF-051.", "gfw-051"], ["Projekt: 59 - EIC Backend - Gf: GF-002.", "gfw-002"]]) {
    await addMissionWorkItem(1, goal, { storage, workerId: p.workerId, savedMissionId: id, maxInteractions: 5 });
  }
  let queue = await loadMissionWorkQueue(1, storage, { workerId: p.workerId });
  queue.items[0] = { ...queue.items[0], status: "ACTIVE" };
  queue.activeItemId = queue.items[0].itemId;
  queue.enabled = true;
  queue = await saveMissionWorkQueue(queue, storage);
  await saveProcess({
    ...p,
    queueContext: createQueueContext(queue, queue.items[0], { interactionCount: 1 }),
    providerContentBlocks: { events: [{ atMs: Date.now() - HOUR, noticeKey: "earlier" }], lastNoticeKey: "earlier" }
  });
  p = await h.mod.tickSending(await loadProcessForWindow(1));
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");

  const t = realClock();
  try {
    h.page.generating = false; // ChatGPT stopped: the answer was withheld
    h.page.pageHealth = { readyState: "complete", visibilityState: "visible", visibleForMs: 0, frameGapMs: 0, composerPresent: true, conversationUrl: true, turnCount: 3, providerNotice: NOTICE_EN };
    const startedAt = Date.now();
    p = await h.mod.tickWaiting(p);
    t.advance(4000);
    p = await h.mod.tickWaiting(p);
    assert.equal(p.queueContext.savedMissionId, "gfw-002", "the queue advanced to the next GFW");
    const after = await loadMissionWorkQueue(1, storage, { workerId: p.workerId });
    const paused = after.items.find((item) => item.savedMissionId === "gfw-051");
    assert.equal(paused.status, "READY", "never BLOCKED");
    assert.equal(paused.lastOutcome, "PROVIDER_CONTENT_BLOCKED_PAUSED");
    assert.equal(paused.schedule.updatedBy, "GREENFIELD");
    const pauseHours = (paused.schedule.pauseUntilMs - startedAt) / HOUR;
    assert.ok(pauseHours > 1.99 && pauseHours < 2.01, `paused ~2 h (${pauseHours})`);
    assert.equal(paused.quantumProgress, 1, "the blocked turn is not counted");
    assert.equal(paused.resume.previousDisposition, "PROVIDER_CONTENT_BLOCKED");
    assert.equal(paused.resume.sourceResponseState, "PROMPT_BLOCKED_BY_PROVIDER");
    assert.equal(paused.processSnapshot.providerContentBlocks.events.length, 2);
  } finally {
    t.restore();
  }
});

test("v1.8.3 E2E: a tick stalled beyond 3 minutes is rescued by reloading the tab", async () => {
  const h = await harness({ extraExports: ["enqueueTick", "rescueStalledTick"] });
  const t = realClock();
  try {
    const p = await waiting(h);
    const reloads = [];
    h.chrome.tabs.reload = async () => { reloads.push("F5"); };
    h.chrome.tabs.sendMessage = () => new Promise(() => {});
    void h.mod.enqueueTick(p.processId, "test");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(await h.mod.rescueStalledTick(p.processId), false, "not stalled yet");
    t.advance(TAB_HEALTH.TICK_STALL_MS + 1000);
    assert.equal(await h.mod.rescueStalledTick(p.processId), true);
    assert.deepEqual(reloads, ["F5"]);
    assert.equal(await h.mod.rescueStalledTick(p.processId), false, "rescues are spaced");
  } finally {
    t.restore();
  }
});

test("v1.8.3 E2E: the REPLACE_TAB step opens the same conversation in a new tab and the process re-binds to it", async () => {
  const h = await harness();
  const t = realClock();
  try {
    let p = await waiting(h);
    const oldTabId = h.tab.id;
    const bridge = h.chrome.tabs.sendMessage;
    const tabs = new Map([[oldTabId, h.tab]]);
    const created = [];
    h.chrome.tabs.get = async (id) => { if (!tabs.has(id)) throw new Error("No tab with id"); return tabs.get(id); };
    h.chrome.tabs.query = async (q) => [...tabs.values()].filter((tab) => !q?.windowId || tab.windowId === q.windowId);
    h.chrome.tabs.create = async ({ windowId, url, active }) => {
      const tab = { ...h.tab, id: 991, windowId, url, active };
      tabs.set(tab.id, tab);
      created.push({ windowId, url, active });
      return tab;
    };
    h.chrome.tabs.remove = async (id) => { tabs.delete(id); };
    // The old renderer hangs; the new tab shows the same, healthy conversation
    // (the harness page simulator only answers for its original tab id).
    h.chrome.tabs.sendMessage = (tabId, message) => tabId === oldTabId ? new Promise(() => {}) : bridge(oldTabId, message);
    h.chrome.tabs.reload = async () => {};
    h.chrome.tabs.update = async (id, patch) => Object.assign(tabs.get(id) || {}, patch);

    p = await settleWithDeadlines(h, h.mod.tickWaiting(p));
    assert.equal(p.phase, "DETACHED");
    // Walk the ladder to its fourth step (reload, hard reload, same URL, new tab).
    for (let i = 0; i < 4; i += 1) {
      p = await settleWithDeadlines(h, h.mod.tickProcess(p.processId, "test"));
      t.advance(TAB_HEALTH.STEP_SETTLE_MS);
    }
    assert.deepEqual(created, [{ windowId: h.tab.windowId, url: h.tab.url, active: true }]);
    assert.equal(tabs.has(oldTabId), false, "the hung tab was closed");
    p = await settleWithDeadlines(h, h.mod.tickProcess(p.processId, "test"));
    assert.equal(p.tabId, 991, "re-bound by the existing single-tab rebind");
    p = await settleWithDeadlines(h, h.mod.tickProcess(p.processId, "test"));
    assert.equal(p.phase, "WAITING");
    assert.equal(p.tabHealth.incident, null);
    assert.equal(p.sessionSeq, 1, "the conversation was kept, not rotated");
  } finally {
    t.restore();
  }
});
