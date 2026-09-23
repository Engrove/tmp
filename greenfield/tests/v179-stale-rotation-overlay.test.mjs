import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow, saveProcess } from "../lib/process-store.mjs";
import {
  addMissionWorkItem,
  createQueueContext,
  loadMissionWorkQueue,
  normalizeMissionWorkItem,
  saveMissionWorkQueue
} from "../lib/mission-work-queue.mjs";
import {
  WAITING_REFRESH_ACTIONS,
  WAITING_STALE_INTERVAL_MS,
  evaluateWaitingRefresh,
  waitingRefreshSchedule
} from "../lib/waiting-refresh.mjs";
import { gfwIdentity, managedOverlayOverview } from "../lib/overlay-summary.mjs";
import { buildA2AEnvelope } from "../lib/a2a.mjs";

const MINUTE = 60 * 1000;

// ---------------------------------------------------------------------------
// Stale-session ladder: 120 minutes without a completed response is a full
// queue rotation to the next runnable slot.

async function queuedWaitingProcess(h, slots) {
  await h.mod.startRun({ windowId: 1, goal: slots[0].goal });
  let p = await loadProcessForWindow(1);
  const storage = h.chrome.storage.local;
  for (const slot of slots) {
    await addMissionWorkItem(1, slot.goal, {
      storage,
      workerId: p.workerId,
      savedMissionId: slot.savedMissionId,
      priority: slot.priority || "NORMAL",
      maxInteractions: slot.maxInteractions || 5
    });
  }
  let queue = await loadMissionWorkQueue(1, storage, { workerId: p.workerId });
  queue.items[0] = { ...queue.items[0], status: "ACTIVE" };
  queue.activeItemId = queue.items[0].itemId;
  queue.enabled = true;
  queue = await saveMissionWorkQueue(queue, storage);
  await saveProcess({ ...p, queueContext: createQueueContext(queue, queue.items[0], { interactionCount: 2 }) });
  p = await h.mod.tickSending(await loadProcessForWindow(1));
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");
  return { p, queue };
}

async function runLadder(h, process, minutes) {
  const realNow = Date.now;
  const reloads = [];
  h.chrome.tabs.reload = async (_tabId, options) => {
    reloads.push(options?.bypassCache ? "CTRL_F5" : "F5");
    h.page.documentId = `document-${reloads.length}`;
  };
  let p = process;
  try {
    for (const minute of minutes) {
      Date.now = () => realNow() + minute * MINUTE;
      p = await h.mod.tickWaiting(p);
    }
  } finally {
    Date.now = realNow;
  }
  return { p, reloads };
}

test("v1.7.9 E2E: 120 minutes without a completed response rotates the queue to the next GFW", async () => {
  const h = await harness({ extraExports: ["activateQueueItem", "queueRuntimeSettings"] });
  const { p: waiting } = await queuedWaitingProcess(h, [
    { goal: "Projekt: 59 - EIC Backend - Gf: GF-002.", savedMissionId: "gfw-002", priority: "HIGH" },
    { goal: "Projekt: 59 - EIC Backend - Gf: GF-044.", savedMissionId: "gfw-044" },
    { goal: "Projekt: 67 - EIC Learning - Gf: GF-008.", savedMissionId: "gfw-008", maxInteractions: 3 }
  ]);
  const unansweredPromptHash = waiting.lastPrompt.hash;

  const { p: afterNinety, reloads } = await runLadder(h, waiting, [31, 61, 91]);
  assert.deepEqual(reloads, ["F5", "CTRL_F5", "CTRL_F5"]);
  assert.equal(afterNinety.queueContext.savedMissionId, "gfw-002", "90 minutes is still the same GFW");

  const { p: switched } = await runLadder(h, afterNinety, [121]);
  assert.equal(switched.queueContext.savedMissionId, "gfw-044", "full rotation to the next slot in order");
  assert.notEqual(switched.processId, waiting.processId);
  assert.equal(switched.pendingPrompt.a2a.messageType, "MISSION_START");
  assert.equal(switched.pendingPrompt.promptProfile.profile, "FULL");

  const queue = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: waiting.workerId });
  const byMission = Object.fromEntries(queue.items.map((item) => [item.savedMissionId, item]));
  assert.equal(byMission["gfw-044"].status, "ACTIVE");
  assert.equal(byMission["gfw-002"].status, "READY", "the stalled GFW is parked, not retired");
  assert.equal(byMission["gfw-002"].quantumProgress, 2, "the unanswered turn does not consume quantum");
  assert.equal(byMission["gfw-002"].lastOutcome, "STALE_SESSION_120M_QUEUE_ROTATION");
  assert.equal(byMission["gfw-002"].resume.previousDisposition, "SESSION_UNRESPONSIVE");
  assert.equal(byMission["gfw-002"].resume.sourceResponseState, "PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE");
  assert.equal(byMission["gfw-002"].resume.processStatusRequest, "");
  assert.equal(byMission["gfw-002"].processSnapshot.lastPrompt.hash, unansweredPromptHash);
  assert.equal(queue.history.length, 0);

  // When the parked GFW comes around again it resumes in a fresh chat that is
  // told its previous prompt produced no completed response.
  const settings = await h.mod.queueRuntimeSettings();
  const resumed = await h.mod.activateQueueItem({
    queue,
    item: byMission["gfw-002"],
    settings,
    windowId: 1,
    priorProcess: switched,
    auditSessionId: ""
  });
  const envelope = resumed.process.pendingPrompt.a2a;
  assert.equal(envelope.messageType, "SESSION_ROTATION");
  assert.equal(envelope.continuity.previousDisposition, "SESSION_UNRESPONSIVE");
  assert.equal(envelope.continuity.sessionRotation.sourceResponseState, "PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE");
  assert.equal(resumed.process.queueContext.interactionCount, 2);
  assert.equal(resumed.process.processId, waiting.processId, "same logical process resumes");
});

test("v1.7.9 E2E: with no other runnable slot the stalled GFW rotates into a fresh chat (fallback)", async () => {
  const h = await harness();
  const { p: waiting } = await queuedWaitingProcess(h, [
    { goal: "Projekt: 59 - EIC Backend - Gf: GF-002.", savedMissionId: "gfw-002" }
  ]);
  const { p } = await runLadder(h, waiting, [31, 61, 91, 121]);
  assert.equal(p.phase, "ROTATING");
  assert.equal(p.sessionRotation.reasonCode, "STALE_SESSION_120M_EXHAUSTED");
  assert.equal(p.queueContext.savedMissionId, "gfw-002");
  assert.equal(p.sessionSeq, 2);
  assert.equal(p.pendingPrompt.a2a.messageType, "SESSION_ROTATION");
});

test("v1.7.9 FULL prompt tells a queued EIC what happens after 120 stalled minutes", () => {
  const process = {
    processId: "p",
    runId: "r",
    generation: 1,
    turn: 1,
    sessionSeq: 1,
    goal: "Mission",
    queueContext: createQueueContext({ queueId: "q" }, normalizeMissionWorkItem({ itemId: "i", goal: "Mission", savedMissionId: "s" }))
  };
  const semantics = buildA2AEnvelope({ process, objective: "Start.", messageType: "MISSION_START" })
    .responseContract.queueControl.staleSessionSemantics;
  assert.match(semantics, /120 minutes/);
  assert.match(semantics, /advances to the next runnable queue slot/);
  assert.match(semantics, /PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE/);
  assert.match(semantics, /re-read owner state/);
});

test("v1.7.9 stale-ladder schedule matches the ladder's own thresholds", () => {
  const anchor = "2026-09-23T08:00:00.000Z";
  const anchorMs = Date.parse(anchor);
  for (const [stage, action, intervals] of [
    ["", WAITING_REFRESH_ACTIONS.F5, 1],
    ["F5_30", WAITING_REFRESH_ACTIONS.CTRL_F5, 2],
    ["CTRL_F5_60", WAITING_REFRESH_ACTIONS.CTRL_F5, 3],
    ["CTRL_F5_90", WAITING_REFRESH_ACTIONS.ROTATE, 4]
  ]) {
    const schedule = waitingRefreshSchedule({ staleSince: anchor, stage });
    assert.equal(schedule.nextAction, action);
    assert.equal(schedule.nextAtMs, anchorMs + intervals * WAITING_STALE_INTERVAL_MS);
    assert.equal(schedule.rotateAtMs, anchorMs + 4 * WAITING_STALE_INTERVAL_MS);
    const before = evaluateWaitingRefresh({ now: schedule.nextAtMs - 1, staleSince: anchor, acknowledged: true, stage });
    const at = evaluateWaitingRefresh({ now: schedule.nextAtMs, staleSince: anchor, acknowledged: true, stage });
    assert.equal(before.action, WAITING_REFRESH_ACTIONS.WAIT, stage);
    assert.equal(at.action, action, stage);
  }
  assert.equal(waitingRefreshSchedule({ staleSince: "" }), null);
});

// ---------------------------------------------------------------------------
// Operator overview

function overviewFixture(patch = {}) {
  // Real queue items always carry their mission goal; queue normalization drops
  // goal-less rows, so the fixture mirrors that shape.
  const slot = (itemId, order, status, label, savedMissionId, extra = {}) =>
    ({ itemId, order, status, label, goal: label, savedMissionId, ...extra });
  const queue = {
    queueId: "q1",
    items: [
      slot("a", 0, "ACTIVE", "Projekt: 59 - EIC Backend / ELLM Backend - Gf: GF-002.", "m-002"),
      slot("b", 1, "READY", "Projekt: 59 - EIC Backend / ELLM Backend - Gf: GF-044.", "m-044"),
      slot("c", 2, "PAUSED", "Projekt: 67 - EIC Learning - Gf: GF-008.", "m-008", { pauseUntilMs: Date.now() + 3_600_000 }),
      slot("d", 3, "READY", "Projekt: 67 - EIC Learning - Gf: GF-WC-RISK-001.", "m-risk")
    ]
  };
  const sentAt = "2026-09-23T08:00:00.000Z";
  const process = {
    processId: "process-edaa1b79-x",
    windowId: 1,
    tabId: 11,
    phase: "WAITING",
    turn: 3,
    sessionSeq: 1,
    goal: "Projekt: 59 - EIC Backend / ELLM Backend - Gf: GF-002.\nMore text.",
    queueContext: { queueId: "q1", itemId: "a", savedMissionId: "m-002", interactionCount: 1, maxInteractions: 5, priority: "HIGH", activationCount: 2 },
    lastPrompt: { hash: "h1", acknowledged: true, sentAt, promptProfile: { profile: "COMPACT" } },
    ...patch
  };
  return { process, queue, sentAtMs: Date.parse(sentAt) };
}

test("v1.7.9 GFW identity is taken from the Gf tag", () => {
  assert.equal(gfwIdentity("Projekt: 59 - EIC Backend / ELLM Backend - Gf: GF-002."), "GF-002");
  assert.equal(gfwIdentity("Projekt: 67 - EIC Learning - Gf: GF-WC-RISK-001."), "GF-WC-RISK-001");
  assert.equal(gfwIdentity("GF-049 EIC Historian"), "GF-049");
  assert.equal(gfwIdentity("Mission without id"), "");
});

test("v1.7.9 overview: GFW, slot, priority, interaction/quantum, TTL to queue rotation and next slot", () => {
  const { process, queue, sentAtMs } = overviewFixture();
  const overview = managedOverlayOverview(process, { queue });
  assert.equal(overview.mission, "GF-002 · Plats 1/4 · Hög · Interaktion 2/5 (kvant 5)");
  assert.deepEqual(overview.countdown, [
    { template: "TTL {t} → köbyte till GF-044", atMs: sentAtMs + 120 * MINUTE },
    { template: "nästa F5 om {t}", atMs: sentAtMs + 30 * MINUTE }
  ]);
  assert.equal(overview.status, "Tur 3 · Session 1 · Aktivering #2 · Prompt COMPACT · Nästa i kö: GF-044");
  assert.match(overview.title, /savedMissionId: m-002/);
});

test("v1.7.9 overview follows the stale stage, a pending quantum, holds and the no-other-slot fallback", () => {
  const staleSince = "2026-09-23T09:00:00.000Z";
  const { process, queue } = overviewFixture({
    waitingRefresh: { promptHash: "h1", turn: 3, stage: "CTRL_F5_90", staleSince },
    safety: { hold: { code: "MODEL_DEGRADED" } }
  });
  process.queueContext = { ...process.queueContext, pendingMaxInteractions: 8 };
  const late = managedOverlayOverview(process, { queue });
  assert.deepEqual(late.countdown, [
    { template: "TTL {t} → köbyte till GF-044", atMs: Date.parse(staleSince) + 120 * MINUTE }
  ]);
  assert.match(late.mission, /Interaktion 2\/5 \(kvant 5 → 8 nästa\)$/);
  assert.match(late.status, /Spärr: MODEL_DEGRADED$/);

  const lonely = managedOverlayOverview(process, { queue: { queueId: "q1", items: [queue.items[0]] } });
  assert.equal(lonely.countdown[0].template, "TTL {t} → ny chatt");
  assert.match(lonely.status, /Nästa i kö: ingen annan körbar/);

  const single = managedOverlayOverview({ ...process, queueContext: null }, {});
  assert.equal(single.mission, "GF-002 · ej köstyrd");
  assert.equal(single.countdown[0].template, "TTL {t} → ny chatt");

  const sending = managedOverlayOverview({ ...process, phase: "SENDING", pendingPrompt: { promptProfile: { profile: "FULL" } } }, { queue });
  assert.deepEqual(sending.countdown, []);
  assert.equal(sending.phaseText, "Förbereder utskick");
  assert.match(sending.status, /Prompt FULL/);

  const resumeAt = "2026-09-23T12:00:00.000Z";
  const paused = managedOverlayOverview({ ...process, phase: "PAUSED", missionPause: { resumeNotBeforeAt: resumeAt } }, { queue });
  assert.deepEqual(paused.countdown, [{ template: "Paus · återupptas om {t}", atMs: Date.parse(resumeAt) }]);
});

// ---------------------------------------------------------------------------
// content.js renders the overview and ticks the countdown locally.

function loadContentScript() {
  const source = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
  const elements = new Map();
  const intervals = new Map();
  let nextTimer = 1;
  let listener = null;
  let fakeNow = Date.parse("2026-09-23T08:00:00.000Z");
  class FakeDate extends Date {
    static now() { return fakeNow; }
  }
  const context = {
    chrome: {
      runtime: {
        sendMessage: () => Promise.resolve({}),
        onMessage: { addListener: (fn) => { listener = fn; }, removeListener: () => {} }
      }
    },
    crypto: { randomUUID: () => "document-vm" },
    document: {
      getElementById: (id) => elements.get(id) || null,
      createElement: () => {
        const element = { dataset: {}, style: {}, textContent: "", title: "", remove() { elements.delete(this.id); } };
        return element;
      },
      documentElement: { appendChild: (element) => elements.set(element.id, element) },
      querySelector: () => null,
      body: {}
    },
    window: { addEventListener: () => {}, removeEventListener: () => {} },
    location: { href: "https://chatgpt.com/g/g-test/c/abc" },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: () => nextTimer++,
    clearTimeout: () => {},
    setInterval: (fn) => { const id = nextTimer++; intervals.set(id, fn); return id; },
    clearInterval: (id) => { intervals.delete(id); },
    Date: FakeDate,
    Map,
    Set,
    Promise,
    JSON,
    Math,
    String,
    Number,
    Array,
    Object,
    console
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  const send = (message) => new Promise((resolve) => listener(message, {}, resolve));
  return {
    send,
    overlay: () => elements.get("eic-gf-linked-overlay") || null,
    tick: (ms) => { fakeNow += ms; for (const fn of intervals.values()) fn(); },
    intervals,
    now: () => fakeNow
  };
}

test("v1.7.9 content overlay renders the overview lines and counts the TTL down locally", async () => {
  const page = loadContentScript();
  const start = page.now();
  const overlay = {
    linked: true,
    reason: "transition",
    processId: "process-edaa1b79-1234",
    windowId: 1,
    tabId: 11,
    phase: "WAITING",
    overview: {
      mission: "GF-002 · Plats 1/4 · Hög · Interaktion 2/5 (kvant 5)",
      status: "Tur 3 · Session 1 · Aktivering #2 · Prompt COMPACT · Nästa i kö: GF-044",
      phaseText: "",
      countdown: [
        { template: "TTL {t} → köbyte till GF-044", atMs: start + 107 * MINUTE + 12_000 },
        { template: "nästa F5 om {t}", atMs: start + 17 * MINUTE + 12_000 }
      ],
      title: "Projekt: 59 - EIC Backend / ELLM Backend - Gf: GF-002."
    }
  };
  const first = await page.send({ type: "EIC_GF_OVERLAY_UPDATE", overlay });
  assert.equal(first.changed, true);
  const lines = page.overlay().textContent.split("\n");
  assert.match(lines[0], /^EIC Greenfield v\d+\.\d+\.\d+ · CONNECTED · WAITING · P:edaa1b79$/);
  assert.equal(lines[1], "GF-002 · Plats 1/4 · Hög · Interaktion 2/5 (kvant 5)");
  assert.equal(lines[2], "TTL 1:47:12 → köbyte till GF-044 · nästa F5 om 17:12");
  assert.equal(lines[3], "Tur 3 · Session 1 · Aktivering #2 · Prompt COMPACT · Nästa i kö: GF-044");
  assert.match(page.overlay().style.cssText, /white-space:pre-line/);
  assert.match(page.overlay().title, /Gf: GF-002/);
  assert.equal(page.intervals.size, 1);

  page.tick(62_000);
  assert.equal(page.overlay().textContent.split("\n")[2], "TTL 1:46:10 → köbyte till GF-044 · nästa F5 om 16:10");

  const repeat = await page.send({ type: "EIC_GF_OVERLAY_UPDATE", overlay: { ...overlay, reason: "observation" } });
  assert.equal(repeat.changed, false, "idempotent for an unchanged payload");

  const sending = await page.send({
    type: "EIC_GF_OVERLAY_UPDATE",
    overlay: { ...overlay, phase: "SENDING", overview: { ...overlay.overview, countdown: [], phaseText: "Förbereder utskick" } }
  });
  assert.equal(sending.changed, true);
  assert.equal(page.overlay().textContent.split("\n")[2], "Förbereder utskick");
  assert.equal(page.intervals.size, 0, "countdown timer stops when no deadline exists");

  await page.send({ type: "EIC_GF_OVERLAY_UPDATE", overlay: { linked: false, reason: "terminal" } });
  assert.equal(page.overlay(), null);
});
