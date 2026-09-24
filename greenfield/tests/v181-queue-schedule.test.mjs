import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SCHEDULE_WINDOWS,
  SCHEDULE_BLOCK,
  isoWeekday,
  nextScheduleOpenAtMs,
  normalizeQueueSchedule,
  parseScheduleEdit,
  queueItemNextRunnableAtMs,
  scheduleBlockReason,
  scheduleClosesAtMs,
  schedulePromptState,
  scheduleSummarySv
} from "../lib/queue-schedule.mjs";
import {
  addMissionWorkItem,
  createQueueContext,
  isRunnableQueueItem,
  loadMissionWorkQueue,
  normalizeMissionWorkItem,
  normalizeMissionWorkQueue,
  publicMissionWorkQueue,
  queueTurnControl,
  saveMissionWorkQueue,
  selectNextMissionItem,
  updateMissionWorkItem
} from "../lib/mission-work-queue.mjs";
import { applyMissionQueueSet, saveMissionQueueSet } from "../lib/mission-queue-sets.mjs";
import {
  applyRuntimeControlEffects,
  evaluateRuntimeControl,
  parseRuntimeControlRequest,
  runtimeControlContract,
  runtimeControlJsonSchema
} from "../lib/runtime-control.mjs";
import { QUEUE_AFTER_RESPONSE, queueAfterResponseAction } from "../lib/queue-control-policy.mjs";
import { buildA2AEnvelope, composeA2APrompt } from "../lib/a2a.mjs";
import { managedOverlayOverview } from "../lib/overlay-summary.mjs";
import { harness, memory } from "./helpers/background-harness.mjs";
import { loadProcessForWindow, saveProcess } from "../lib/process-store.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { ANALYSIS_SCHEMA } from "../lib/contracts.mjs";

// All times are built in the runtime's local zone, exactly as the extension
// computes them, so the assertions hold in any TZ.
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const HOUR = 60 * 60 * 1000;
// 2026-09-24 is a Thursday.
const THU = at(2026, 9, 24);
const NIGHTS = { windows: [{ days: [1, 2, 3, 4, 5], start: "22:00", end: "06:00" }] };

// ---------------------------------------------------------------------------
// Schedule arithmetic.

test("v1.8.1 run windows: same-day, across midnight, 24:00 and chained windows", () => {
  assert.equal(isoWeekday(new Date(THU)), 4);
  const nights = normalizeQueueSchedule(NIGHTS);
  assert.equal(scheduleBlockReason(nights, at(2026, 9, 24, 21, 59)), SCHEDULE_BLOCK.OUTSIDE_WINDOW);
  assert.equal(scheduleBlockReason(nights, at(2026, 9, 24, 22, 0)), "");
  assert.equal(scheduleBlockReason(nights, at(2026, 9, 25, 5, 59)), "", "Thursday's window runs into Friday");
  assert.equal(scheduleBlockReason(nights, at(2026, 9, 25, 6, 0)), SCHEDULE_BLOCK.OUTSIDE_WINDOW);
  assert.equal(scheduleBlockReason(nights, at(2026, 9, 26, 3, 0)), "", "Friday's window runs into Saturday");
  assert.equal(scheduleBlockReason(nights, at(2026, 9, 27, 3, 0)), SCHEDULE_BLOCK.OUTSIDE_WINDOW, "no Saturday window");
  assert.equal(scheduleClosesAtMs(nights, at(2026, 9, 24, 23, 0)), at(2026, 9, 25, 6, 0));
  assert.equal(nextScheduleOpenAtMs(nights, at(2026, 9, 24, 12, 0)), at(2026, 9, 24, 22, 0));
  assert.equal(nextScheduleOpenAtMs(nights, at(2026, 9, 26, 12, 0)), at(2026, 9, 28, 22, 0), "Saturday noon -> Monday night");

  const endOfDay = normalizeQueueSchedule({ windows: [{ days: [4], start: "20:00", end: "24:00" }] });
  assert.equal(scheduleBlockReason(endOfDay, at(2026, 9, 24, 23, 59)), "");
  assert.equal(scheduleClosesAtMs(endOfDay, at(2026, 9, 24, 21, 0)), at(2026, 9, 25, 0, 0));

  const chained = normalizeQueueSchedule({ windows: [
    { days: [4], start: "20:00", end: "24:00" },
    { days: [5], start: "00:00", end: "03:00" }
  ] });
  assert.equal(scheduleClosesAtMs(chained, at(2026, 9, 24, 21, 0)), at(2026, 9, 25, 3, 0), "adjacent windows chain");
  assert.equal(scheduleSummarySv(nights), "Mån–Fre 22:00–06:00");
});

test("v1.8.1 pauseUntil blocks until its time and composes with windows", () => {
  const now = at(2026, 9, 24, 12, 0);
  const paused = normalizeQueueSchedule({ pauseUntilMs: now + 3 * HOUR }, { now });
  assert.equal(scheduleBlockReason(paused, now), SCHEDULE_BLOCK.PAUSED);
  assert.equal(nextScheduleOpenAtMs(paused, now), now + 3 * HOUR);
  assert.equal(scheduleClosesAtMs(paused, now), null);
  const both = normalizeQueueSchedule({ ...NIGHTS, pauseUntilMs: at(2026, 9, 25, 2, 0) }, { now });
  assert.equal(nextScheduleOpenAtMs(both, now), at(2026, 9, 25, 2, 0), "pause ends inside Thursday's night window");
  assert.equal(normalizeQueueSchedule({ pauseUntilMs: now - 1 }, { now }), null, "an expired pause is no schedule");
  assert.equal(normalizeQueueSchedule({ windows: [] }, { now }), null);
});

test("v1.8.1 schedule edits are parsed strictly; absent fields keep their value", () => {
  const now = at(2026, 9, 24, 12, 0);
  const errors = [
    [{}, "SCHEDULE_EMPTY_EDIT"],
    [{ windows: "22-06" }, "SCHEDULE_WINDOWS_NOT_ARRAY"],
    [{ windows: [{ days: [], start: "22:00", end: "06:00" }] }, "WINDOW_DAYS_INVALID"],
    [{ windows: [{ days: [8], start: "22:00", end: "06:00" }] }, "WINDOW_DAYS_INVALID"],
    [{ windows: [{ days: [1, 1], start: "22:00", end: "06:00" }] }, "WINDOW_DAYS_DUPLICATE"],
    [{ windows: [{ days: [1], start: "25:00", end: "06:00" }] }, "WINDOW_START_INVALID"],
    [{ windows: [{ days: [1], start: "24:00", end: "06:00" }] }, "WINDOW_START_INVALID"],
    [{ windows: [{ days: [1], start: "10:00", end: "10:00" }] }, "WINDOW_EMPTY"],
    [{ windows: [{ days: [1], start: "10:00", end: "11:00", tz: "UTC" }] }, "WINDOW_UNKNOWN_FIELD:tz"],
    [{ windows: Array.from({ length: MAX_SCHEDULE_WINDOWS + 1 }, () => ({ days: [1], start: "10:00", end: "11:00" })) }, "SCHEDULE_TOO_MANY_WINDOWS"],
    [{ pauseUntil: "tomorrow" }, "SCHEDULE_PAUSE_UNTIL_FORMAT"],
    [{ pauseUntil: "2026-09-24T13:00:00" }, "SCHEDULE_PAUSE_UNTIL_FORMAT"],
    [{ pauseUntil: new Date(now - 60_000).toISOString() }, "SCHEDULE_PAUSE_UNTIL_NOT_FUTURE"],
    [{ pauseUntil: new Date(now + 31 * 24 * HOUR).toISOString() }, "SCHEDULE_PAUSE_UNTIL_TOO_FAR"],
    [{ timezone: "UTC" }, "SCHEDULE_UNKNOWN_FIELD:timezone"]
  ];
  for (const [raw, error] of errors) {
    assert.deepEqual(parseScheduleEdit(raw, { now }), { ok: false, error }, JSON.stringify(raw));
  }
  const current = normalizeQueueSchedule(NIGHTS, { now });
  const withPause = parseScheduleEdit({ pauseUntil: new Date(now + 2 * HOUR).toISOString() }, { now, current, editor: "AI" });
  assert.equal(withPause.ok, true);
  assert.deepEqual(withPause.schedule.windows, NIGHTS.windows, "windows kept when absent");
  assert.equal(withPause.schedule.pauseUntilMs, now + 2 * HOUR);
  assert.equal(withPause.schedule.updatedBy, "AI");
  const cleared = parseScheduleEdit({ windows: [], pauseUntil: "" }, { now, current: withPause.schedule });
  assert.deepEqual(cleared, { ok: true, schedule: null });
});

// ---------------------------------------------------------------------------
// Queue model.

test("v1.8.1 a slot outside its schedule is not runnable and is skipped in explicit order", () => {
  const now = at(2026, 9, 24, 12, 0);
  const queue = normalizeMissionWorkQueue({
    queueId: "q", workerId: "w", windowId: 1, enabled: true, cursorOrder: -1,
    items: [
      { itemId: "a", goal: "A", order: 0, status: "READY", schedule: NIGHTS },
      { itemId: "b", goal: "B", order: 1, status: "READY", schedule: { pauseUntilMs: now + HOUR } },
      { itemId: "c", goal: "C", order: 2, status: "READY" }
    ]
  }, { now });
  assert.equal(isRunnableQueueItem(queue.items[0], now), false);
  assert.equal(isRunnableQueueItem(queue.items[1], now), false);
  assert.equal(selectNextMissionItem(queue, { now }).itemId, "c");
  assert.equal(selectNextMissionItem(queue, { now: at(2026, 9, 24, 22, 30) }).itemId, "a");
  assert.equal(queueItemNextRunnableAtMs(queue.items[0], now), at(2026, 9, 24, 22, 0));
  assert.equal(queueItemNextRunnableAtMs(queue.items[1], now), now + HOUR);
  assert.equal(queueItemNextRunnableAtMs({ ...queue.items[2], status: "PAUSED", pauseUntilMs: now + 5 * HOUR, schedule: NIGHTS }, now),
    at(2026, 9, 24, 22, 0), "status pause and schedule compose (later of both)");

  const view = publicMissionWorkQueue(queue, now);
  assert.equal(view.items[0].scheduleBlockReason, "OUTSIDE_RUN_WINDOW");
  assert.equal(view.items[0].scheduleNextOpenAtMs, at(2026, 9, 24, 22, 0));
  assert.equal(view.items[0].scheduleSummary, "Mån–Fre 22:00–06:00");
  assert.equal(view.items[2].schedule, null);
});

test("v1.8.1 operator schedule edit: null clears, other fields and the priority ceiling are untouched", async () => {
  const storage = memory();
  const now = at(2026, 9, 24, 12, 0);
  let queue = await addMissionWorkItem(1, "Mission A", { storage, workerId: "w", priority: "HIGH", maxInteractions: 4 });
  const itemId = queue.items[0].itemId;
  queue.items[0] = { ...queue.items[0], priority: "LOW" };
  await saveMissionWorkQueue(queue, storage);
  queue = await updateMissionWorkItem(1, itemId, { schedule: normalizeQueueSchedule(NIGHTS, { now }) }, storage, { workerId: "w", now });
  assert.deepEqual(queue.items[0].schedule.windows, NIGHTS.windows);
  assert.equal(queue.items[0].operatorPriority, "HIGH", "a schedule edit does not adopt an AI-lowered priority as ceiling");
  assert.equal(queue.items[0].maxInteractions, 4);
  assert.equal(queue.items[0].operatorEditedAtMs, now);
  queue = await updateMissionWorkItem(1, itemId, { schedule: null }, storage, { workerId: "w", now });
  assert.equal(queue.items[0].schedule, null);
});

test("v1.8.1 queue sets keep run windows but never a one-shot pause", async () => {
  const storage = memory();
  const now = at(2026, 9, 24, 12, 0);
  const source = normalizeMissionWorkQueue({
    queueId: "q", workerId: "w", windowId: 1,
    items: [{ itemId: "a", goal: "A", schedule: { ...NIGHTS, pauseUntilMs: now + HOUR } }]
  }, { now });
  const saved = await saveMissionQueueSet({ name: "Natt", queue: source }, storage, { now, bookmarks: null });
  assert.deepEqual(saved.set.items[0].scheduleWindows, NIGHTS.windows);
  const applied = applyMissionQueueSet(normalizeMissionWorkQueue({ workerId: "x", windowId: 2 }), saved.set, { workerId: "x", windowId: 2, now });
  assert.deepEqual(applied.items[0].schedule.windows, NIGHTS.windows);
  assert.equal(applied.items[0].schedule.pauseUntilMs, 0);
});

// ---------------------------------------------------------------------------
// AI SET_SCHEDULE.

function owner(slotPatch = {}, extra = {}) {
  return {
    runId: "run-1", turn: 3, queueManaged: true, queueId: "q", itemId: "slot-a", savedMissionId: "gfw-a",
    item: { itemId: "slot-a", status: "ACTIVE", priority: "HIGH", operatorPriority: "HIGH", maxInteractions: 5, operatorEditedAtMs: 0, schedule: null, ...slotPatch },
    promptIssuedAtMs: at(2026, 9, 24, 11, 0), responseHash: "hash-1", ledger: [], nowMs: at(2026, 9, 24, 12, 0),
    ...extra
  };
}
const TARGET = { runId: "run-1", turn: 3, queueId: "q", itemId: "slot-a", savedMissionId: "gfw-a" };
function scheduleRequest(action) {
  return parseRuntimeControlRequest({ target: TARGET, actions: [{ op: "SET_SCHEDULE", ...action }] });
}

test("v1.8.1 SET_SCHEDULE is validated, bound to the slot, idempotent and loses to the operator", () => {
  const pauseUntil = new Date(at(2026, 9, 24, 18, 0)).toISOString();
  const applied = evaluateRuntimeControl({ request: scheduleRequest({ windows: NIGHTS.windows, pauseUntil }), owner: owner() });
  assert.equal(applied.receipts[0].status, "APPLIED");
  assert.equal(applied.receipts[0].reason, "SLOT_SCHEDULE_UPDATED");
  assert.equal(applied.effects[0].field, "schedule");
  assert.deepEqual(applied.effects[0].value.windows, NIGHTS.windows);
  const items = applyRuntimeControlEffects([owner().item], applied.effects, { now: at(2026, 9, 24, 12, 0) });
  assert.equal(items[0].schedule.updatedBy, "AI");
  assert.equal(items[0].schedule.pauseUntilMs, at(2026, 9, 24, 18, 0));

  const same = evaluateRuntimeControl({
    request: scheduleRequest({ windows: NIGHTS.windows }),
    owner: owner({ schedule: normalizeQueueSchedule(NIGHTS) })
  });
  assert.equal(same.receipts[0].status, "ALREADY_APPLIED");

  const precedence = evaluateRuntimeControl({ request: scheduleRequest({ pauseUntil }), owner: owner({ operatorEditedAtMs: at(2026, 9, 24, 11, 30) }) });
  assert.deepEqual([precedence.receipts[0].status, precedence.receipts[0].reason], ["REJECTED", "OPERATOR_PRECEDENCE"]);
  assert.equal(precedence.effects.length, 0);

  for (const [action, reason] of [
    [{ windows: [{ days: [0], start: "22:00", end: "06:00" }] }, "WINDOW_DAYS_INVALID"],
    [{ pauseUntil: new Date(at(2026, 9, 24, 11, 0)).toISOString() }, "SCHEDULE_PAUSE_UNTIL_NOT_FUTURE"],
    [{ pauseUntil: new Date(at(2026, 11, 30)).toISOString() }, "SCHEDULE_PAUSE_UNTIL_TOO_FAR"],
    [{}, "SCHEDULE_EMPTY_EDIT"]
  ]) {
    const result = evaluateRuntimeControl({ request: scheduleRequest(action), owner: owner() });
    assert.deepEqual([result.receipts[0].status, result.receipts[0].reason], ["INVALID", reason], JSON.stringify(action));
    assert.equal(result.effects.length, 0);
  }
  const extra = parseRuntimeControlRequest({ target: TARGET, actions: [{ op: "SET_SCHEDULE", windows: [], timezone: "UTC" }] });
  assert.equal(extra.actions[0].error, "UNKNOWN_FIELD:timezone");
});

test("v1.8.1 FULL prompt instructs and mandates the scheduler; COMPACT keeps the live schedule state", () => {
  const now = at(2026, 9, 24, 21, 55);
  const item = normalizeMissionWorkItem({ itemId: "slot-a", savedMissionId: "gfw-a", goal: "Mission A", schedule: { windows: [{ days: [4], start: "12:00", end: "22:00" }] } }, { now });
  const process = {
    processId: "p", runId: "run-1", generation: 1, turn: 3, sessionSeq: 1, goal: "Mission A",
    queueContext: createQueueContext({ queueId: "q", workerId: "w" }, item, { interactionCount: 1 })
  };
  const full = buildA2AEnvelope({ process, objective: "Continue.", messageType: "CONTINUATION", at: now });
  const rule = full.control.workQueue.scheduleRule;
  assert.match(rule, /MANDATORY: manage this slot's time with runtimeControl SET_SCHEDULE/);
  assert.match(rule, /never posts a new prompt outside it, and never interrupts a turn in flight/);
  assert.match(full.responseContract.note, /using runtimeControl SET_SCHEDULE for time-dependent work is mandatory/);
  const contract = full.responseContract.runtimeControlContract;
  assert.match(contract.operations.SET_SCHEDULE, /at most 7 weekly run windows/);
  assert.equal(contract.constraints.scheduleMaxWindows, 7);
  assert.equal(contract.constraints.schedulePauseMaxDays, 30);
  assert.equal(runtimeControlJsonSchema({ queueManaged: true }).properties.actions.items.oneOf.length, 4);
  assert.ok(runtimeControlContract({ queueManaged: false }).operations.SET_SCHEDULE === undefined);

  const schedule = full.control.workQueue.schedule;
  assert.equal(schedule.openNow, true);
  assert.equal(schedule.closesAt.slice(0, 16), "2026-09-24T22:00");
  assert.equal(schedule.likelyLastTurnInWindow, true, "5 minutes left is less than the default turn estimate");
  assert.equal(full.control.workQueue.checkpointRequired, true, "the last turn in a window must checkpoint");
  assert.equal(full.control.learningControl.keypoints[0].keypoint, "CHECKPOINT_HANDOFF_STOP_OR_TERMINAL_CLOSE");
  assert.deepEqual(full.control.runtimeControl.current.scheduleWindows, [{ days: [4], start: "12:00", end: "22:00" }]);

  const compact = composeA2APrompt({
    process, objective: "Continue.", messageType: "CONTINUATION", at: now,
    promptProfile: { profile: "COMPACT", ordinal: 3, lastFullOrdinal: 1, nextFullOrdinal: 11 }
  }).envelope;
  assert.equal(compact.control.workQueue.scheduleRule, undefined);
  assert.deepEqual(compact.control.workQueue.schedule, schedule);
  assert.match(compact.responseContract.runtimeControl, /slot scheduler \(SET_SCHEDULE, control.workQueue.schedule\) remains mandatory/);

  const early = queueTurnControl(process, { now: at(2026, 9, 24, 13, 0) });
  assert.equal(early.schedule.likelyLastTurnInWindow, false);
  assert.equal(early.checkpointRequired, false);
});

test("v1.8.1 a blocked schedule parks the slot after the response; nothing else changes the policy", () => {
  assert.equal(queueAfterResponseAction({ queueManaged: true, scheduleBlocked: true }), QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH);
  assert.equal(queueAfterResponseAction({ queueManaged: true }), QUEUE_AFTER_RESPONSE.CONTINUE_CURRENT);
  assert.equal(queueAfterResponseAction({ queueManaged: false, scheduleBlocked: true }), QUEUE_AFTER_RESPONSE.CONTINUE_CURRENT);
});

// ---------------------------------------------------------------------------
// E2E through background.js.

function hjalmarContinue() {
  return {
    schema: ANALYSIS_SCHEMA, disposition: "CONTINUE", targetDisposition: "CONTINUE", objectiveStatus: "PENDING",
    nanoTaskAssessment: "NOT_REQUESTED", progressEvidence: "Bounded progress.", analysis: "Mocked controller verdict.",
    nextPrompt: "Continue with the next bounded owner-verified work package.", exactTarget: "Objective.",
    ownerEvidence: "Response.", reversibility: "YES", rollbackPath: "Owner state.", readbackPlan: "Readback.",
    materialAmbiguity: "NONE", humanAuthorityRequired: false, confidence: "HIGH"
  };
}

function mockAnalyzer(h) {
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  h.chrome.runtime.sendMessage = async (message) => message?.type === "EIC_GF_ANALYZE_PIPELINE"
    ? { ok: true, decision: hjalmarContinue(), nano: null, nanoRawOutput: "", rawOutput: "" }
    : { ok: true };
}

// A schedule that excludes "now" in any TZ: every weekday except today, all day.
function closedToday(now = Date.now()) {
  const today = isoWeekday(new Date(now));
  return { windows: [{ days: [1, 2, 3, 4, 5, 6, 7].filter((day) => day !== today), start: "00:00", end: "24:00" }] };
}

async function queuedWaiting(h, slots) {
  mockAnalyzer(h);
  await h.mod.startRun({ windowId: 1, goal: slots[0].goal });
  let p = await loadProcessForWindow(1);
  const storage = h.chrome.storage.local;
  for (const slot of slots) {
    await addMissionWorkItem(1, slot.goal, { storage, workerId: p.workerId, savedMissionId: slot.savedMissionId, maxInteractions: 5 });
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

async function setSchedule(h, p, itemId, schedule) {
  const storage = h.chrome.storage.local;
  const queue = await loadMissionWorkQueue(1, storage, { workerId: p.workerId });
  queue.items = queue.items.map((item) => item.itemId === itemId ? { ...item, schedule } : item);
  return saveMissionWorkQueue(queue, storage);
}

async function analyzeResponse(h, p, response) {
  const text = JSON.stringify({
    schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "Bounded work was performed.",
    workPerformed: ["Read owner state."], evidence: ["Owner readback."], blockers: [],
    nextSuggestedAction: "Continue with the next bounded owner-verified work package.",
    ...response
  });
  await saveProcess({
    ...p,
    phase: "ANALYZING",
    lastResponse: { text, hash: await sha256Hex(text), messageId: "assistant-1", observation: { documentId: h.page.documentId, messageId: "assistant-1" } }
  });
  return h.mod.tickAnalyzing(await loadProcessForWindow(1));
}

test("v1.8.1 E2E: the window closes during a turn; the turn finishes, then the slot parks and the next GFW starts", async () => {
  const h = await harness();
  const { p, queue } = await queuedWaiting(h, [
    { goal: "Projekt: 59 - EIC Backend - Gf: GF-002.", savedMissionId: "gfw-002" },
    { goal: "Projekt: 59 - EIC Backend - Gf: GF-044.", savedMissionId: "gfw-044" }
  ]);
  const sentBefore = h.sent.length;
  await setSchedule(h, p, queue.items[0].itemId, closedToday());
  const switched = await analyzeResponse(h, p, {});
  assert.equal(switched.queueContext.savedMissionId, "gfw-044");
  assert.equal(h.sent.length, sentBefore, "no prompt was posted to the closed slot");
  const after = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  const parked = after.items.find((item) => item.savedMissionId === "gfw-002");
  assert.equal(parked.status, "READY");
  assert.equal(parked.lastOutcome, "SCHEDULE_WINDOW_CLOSED");
  assert.equal(parked.quantumProgress, 3, "the answered turn counts; the quantum is kept");
  assert.ok(parked.processSnapshot);
  assert.equal(after.activeItemId, after.items.find((item) => item.savedMissionId === "gfw-044").itemId);
});

test("v1.8.1 E2E: with no other runnable slot the worker idles in QUEUE_WAIT and wakes when the slot opens", async () => {
  const h = await harness({ extraExports: ["wakeMissionQueue"] });
  const { p, queue } = await queuedWaiting(h, [
    { goal: "Projekt: 67 - EIC Learning - Gf: GF-008.", savedMissionId: "gfw-008" }
  ]);
  const sentBefore = h.sent.length;
  const pauseUntilMs = Date.now() + 2 * HOUR;
  await setSchedule(h, p, queue.items[0].itemId, { pauseUntilMs });
  const idle = await analyzeResponse(h, p, {});
  assert.equal(idle.phase, "QUEUE_WAIT");
  assert.equal(idle.queueContext, null);
  assert.equal(idle.queueWait.reason, "SCHEDULE_PAUSED");
  assert.equal(idle.queueWait.nextWakeAtMs, pauseUntilMs);
  assert.equal(h.sent.length, sentBefore);
  const wake = [...h.alarms].find(([name]) => name.startsWith("eic.gf.mission-queue-wake."));
  assert.equal(wake?.[1]?.when, pauseUntilMs, "queue wake alarm armed for the pause end");
  const idleQueue = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  assert.equal(idleQueue.activeItemId, "");
  assert.equal(idleQueue.items[0].status, "READY");

  const overview = managedOverlayOverview(idle, { queue: idleQueue });
  assert.equal(overview.phaseText, "Kön väntar på schemalagd köplats");
  assert.equal(overview.countdown[0].atMs, pauseUntilMs);

  const stillClosed = await h.mod.wakeMissionQueue(1, "TEST");
  assert.equal(stillClosed.phase, "QUEUE_WAIT", "no activation while the schedule blocks");
  await setSchedule(h, p, queue.items[0].itemId, null);
  const resumed = await h.mod.wakeMissionQueue(1, "TEST");
  assert.equal(resumed.phase, "ROTATING");
  assert.equal(resumed.queueContext.savedMissionId, "gfw-008");
  assert.equal(resumed.queueContext.interactionCount, 3);
});

test("v1.8.1 E2E: an AI SET_SCHEDULE pause is applied, receipted, and parks the slot after this response", async () => {
  const h = await harness();
  const { p, queue } = await queuedWaiting(h, [
    { goal: "Projekt: 59 - EIC Backend - Gf: GF-002.", savedMissionId: "gfw-002" },
    { goal: "Projekt: 59 - EIC Backend - Gf: GF-044.", savedMissionId: "gfw-044" }
  ]);
  const pauseUntil = new Date(Date.now() + 3 * HOUR).toISOString();
  const switched = await analyzeResponse(h, p, {
    runtimeControl: {
      target: { runId: p.runId, turn: p.turn, queueId: queue.queueId, itemId: queue.items[0].itemId, savedMissionId: "gfw-002" },
      actions: [{ op: "SET_SCHEDULE", pauseUntil, reason: "The external build finishes in three hours." }]
    }
  });
  assert.equal(switched.queueContext.savedMissionId, "gfw-044");
  const after = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  const parked = after.items.find((item) => item.savedMissionId === "gfw-002");
  assert.equal(parked.lastOutcome, "SCHEDULE_PAUSED");
  assert.equal(parked.schedule.updatedBy, "AI");
  assert.equal(parked.schedule.pauseUntilMs, Date.parse(pauseUntil));
  assert.equal(parked.processSnapshot.runtimeControl.lastReceipts[0].op, "SET_SCHEDULE");
  assert.equal(parked.processSnapshot.runtimeControl.lastReceipts[0].status, "APPLIED");
});

test("v1.8.1 E2E dispatch gate: a prompt that was never dispatched is not posted outside the schedule", async () => {
  const h = await harness();
  const { p, queue } = await queuedWaiting(h, [
    { goal: "Projekt: 67 - EIC Learning - Gf: GF-008.", savedMissionId: "gfw-008" }
  ]);
  const sending = await analyzeResponse(h, p, {});
  assert.equal(sending.phase, "SENDING", "schedule open: normal continuation");
  assert.ok(!sending.pendingPrompt.dispatch, "no dispatch attempt recorded yet");
  const sentBefore = h.sent.length;
  await setSchedule(h, p, queue.items[0].itemId, closedToday());
  const gated = await h.mod.tickSending(await loadProcessForWindow(1));
  assert.equal(gated.phase, "QUEUE_WAIT");
  assert.equal(gated.queueWait.reason, "SCHEDULE_WINDOW_CLOSED");
  assert.equal(h.sent.length, sentBefore, "the pending prompt was not posted");
  const after = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  assert.equal(after.items[0].status, "READY");
  assert.equal(after.items[0].resume.sessionReason, "OUTSIDE_RUN_WINDOW");
});

test("v1.8.1 E2E: re-saving the selected queue set overwrites it from the active queue and keeps its identity", async () => {
  const h = await harness({ extraExports: ["mutateMissionQueueSet"] });
  mockAnalyzer(h);
  await h.mod.startRun({ windowId: 1, goal: "Mission A" });
  const p = await loadProcessForWindow(1);
  const storage = h.chrome.storage.local;
  await addMissionWorkItem(1, "Mission A", { storage, workerId: p.workerId, savedMissionId: "gfw-a" });
  const first = await h.mod.mutateMissionQueueSet({ windowId: 1, operation: "SAVE", name: "Morgon" });
  const setId = first.missionQueueSets.find((set) => set.name === "Morgon").setId;
  await addMissionWorkItem(1, "Mission B", { storage, workerId: p.workerId, savedMissionId: "gfw-b" });
  await setSchedule(h, p, (await loadMissionWorkQueue(1, storage, { workerId: p.workerId })).items[1].itemId, NIGHTS);
  const updated = await h.mod.mutateMissionQueueSet({ windowId: 1, operation: "UPDATE", setId });
  const row = updated.missionQueueSets.find((set) => set.setId === setId);
  assert.equal(row.name, "Morgon");
  assert.equal(row.itemCount, 2);
  assert.equal(updated.missionQueueSets.length, 1, "no new set was created");
  await assert.rejects(
    h.mod.mutateMissionQueueSet({ windowId: 1, operation: "UPDATE", setId: "missing" }),
    /MISSION_QUEUE_SET_NOT_FOUND/
  );
});

test("v1.8.1 side panel wires 'Uppdatera valt' and the per-slot schedule editor to the verified mutations", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  const js = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  for (const id of ["queueSetUpdate", "queueScheduleEditor", "queueScheduleSave", "queueScheduleClear", "queueSchedulePause", "queueScheduleAddWindow"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(js, /mutateMissionQueueSet\("UPDATE", \{ setId \}\)/);
  assert.match(js, /mutateMissionQueue\("UPDATE", \{ itemId: editor\.itemId, schedule \}\)/);
  assert.match(js, /data-queue-action="schedule"/);
  assert.match(js, /queueSetUpdateConfirm/, "overwrite needs a confirming second click");
});
