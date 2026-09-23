import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MISSION_QUANTUM_INTERACTIONS,
  DEFAULT_QUEUE_PRIORITY_AGING_SECONDS,
  DEFAULT_QUEUE_SWITCH_DELAY_SECONDS,
  DEFAULT_QUEUE_SWITCH_HARD_RELOAD,
  DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS,
  MISSION_WORK_QUEUE_SCHEMA,
  QUEUE_STATUS,
  addMissionWorkItem,
  createQueueContext,
  isRunnableQueueItem,
  loadMissionWorkQueue,
  normalizeMissionQuantumInteractions,
  normalizeMissionWorkQueue,
  normalizeQueuePriorityAgingSeconds,
  normalizeQueueSwitchDelaySeconds,
  normalizeQueueSwitchSettleSeconds,
  queueTurnControl,
  saveMissionWorkQueue,
  selectNextMissionItem,
  updateMissionWorkItem
} from "../lib/mission-work-queue.mjs";
import { normalizeOperatorSettings } from "../lib/operator-settings.mjs";

function storageMock(initial = {}) {
  const state = structuredClone(initial);
  return {
    state,
    async get(key) {
      if (typeof key === "string") return { [key]: structuredClone(state[key]) };
      return structuredClone(state);
    },
    async set(values) {
      Object.assign(state, structuredClone(values));
    }
  };
}

test("v1.3.7 queue operational tuning values normalize to bounded global settings", () => {
  assert.equal(normalizeMissionQuantumInteractions(undefined), DEFAULT_MISSION_QUANTUM_INTERACTIONS);
  assert.equal(normalizeMissionQuantumInteractions(0), 1);
  assert.equal(normalizeMissionQuantumInteractions(999), 50);
  assert.equal(normalizeQueuePriorityAgingSeconds(undefined), DEFAULT_QUEUE_PRIORITY_AGING_SECONDS);
  assert.equal(normalizeQueuePriorityAgingSeconds(1), 30);
  assert.equal(normalizeQueuePriorityAgingSeconds(99999), 3600);
  assert.equal(normalizeQueueSwitchDelaySeconds(undefined), DEFAULT_QUEUE_SWITCH_DELAY_SECONDS);
  assert.equal(normalizeQueueSwitchDelaySeconds(-2), 0);
  assert.equal(normalizeQueueSwitchDelaySeconds(999), 300);
  assert.equal(normalizeQueueSwitchSettleSeconds(undefined), DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS);
  assert.equal(normalizeQueueSwitchSettleSeconds(-1), 0);
  assert.equal(normalizeQueueSwitchSettleSeconds(99), 30);

  const settings = normalizeOperatorSettings({
    defaultMissionQuantumInteractions: 7,
    queuePriorityAgingSeconds: 240,
    queueSwitchDelaySeconds: 12,
    queueSwitchHardReload: false,
    queueSwitchSettleSeconds: 4
  });
  assert.equal(settings.defaultMissionQuantumInteractions, 7);
  assert.equal(settings.queuePriorityAgingSeconds, 240);
  assert.equal(settings.queueSwitchDelaySeconds, 12);
  assert.equal(settings.queueSwitchHardReload, false);
  assert.equal(settings.queueSwitchSettleSeconds, 4);
});

test("queue add is durable and allows the same saved mission in independent scheduling slots", async () => {
  const storage = storageMock();
  let queue = await addMissionWorkItem(77, "Mission alpha", {
    storage,
    workerId: "worker-77",
    savedMissionId: "saved-a",
    label: "Alpha",
    maxInteractions: 3,
    priority: "HIGH",
    now: Date.parse("2026-09-05T08:00:00Z")
  });
  assert.equal(queue.schema, MISSION_WORK_QUEUE_SCHEMA);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].maxInteractions, 3);
  assert.equal(queue.items[0].priority, "HIGH");

  queue = await addMissionWorkItem(77, "Mission alpha", {
    storage,
    workerId: "worker-77",
    savedMissionId: "saved-a",
    label: "Alpha duplicate"
  });
  assert.equal(queue.items.length, 2);
  assert.notEqual(queue.items[0].itemId, queue.items[1].itemId);
  assert.equal(queue.items[0].savedMissionId, "saved-a");
  assert.equal(queue.items[1].savedMissionId, "saved-a");

  const readback = await loadMissionWorkQueue(77, storage, { workerId: "worker-77" });
  assert.equal(readback.queueId, queue.queueId);
  assert.equal(readback.items.length, 2);
  assert.ok(readback.items.every((item) => item.savedMissionId === "saved-a"));
});

test("queue selection follows explicit cyclic slot order and skips unavailable slots", () => {
  const now = Date.parse("2026-09-05T10:00:00Z");
  const queue = normalizeMissionWorkQueue({
    queueId: "q",
    windowId: 8,
    cursorOrder: -1,
    items: [
      { itemId: "low-first", goal: "First low", priority: "LOW", status: "READY", order: 0, readySinceMs: now - 10 * 60_000 },
      { itemId: "urgent-second", goal: "Second urgent", priority: "URGENT", status: "READY", order: 1, readySinceMs: now - 1_000 },
      { itemId: "paused-third", goal: "Paused", priority: "URGENT", status: "PAUSED", order: 2, readySinceMs: now - 50_000, pauseUntilMs: now + 60_000 },
      { itemId: "normal-fourth", goal: "Fourth", priority: "NORMAL", status: "READY", order: 3, readySinceMs: now - 1_000 }
    ]
  }, { windowId: 8, now });

  // Inner queue order is authoritative regardless of per-slot priority.
  assert.equal(selectNextMissionItem(queue, { now, agingSeconds: 30 }).itemId, "low-first");
  assert.equal(selectNextMissionItem(queue, { now, afterItemId: "low-first" }).itemId, "urgent-second");
  assert.equal(selectNextMissionItem(queue, { now, afterItemId: "urgent-second" }).itemId, "normal-fourth");
  assert.equal(selectNextMissionItem(queue, { now, afterItemId: "normal-fourth" }).itemId, "low-first");
  assert.equal(isRunnableQueueItem(queue.items.find((x) => x.itemId === "paused-third"), now), false);
  assert.equal(isRunnableQueueItem(queue.items.find((x) => x.itemId === "paused-third"), now + 61_000), true);
  assert.equal(selectNextMissionItem(queue, { now: now + 61_000, afterItemId: "urgent-second" }).itemId, "paused-third");
});

test("queue turn control marks the final permitted interaction before it is sent", () => {
  const queue = normalizeMissionWorkQueue({
    queueId: "q",
    windowId: 9,
    items: [{ itemId: "a", goal: "A", maxInteractions: 3, status: "ACTIVE" }],
    activeItemId: "a"
  }, { windowId: 9 });
  const item = queue.items[0];

  const first = queueTurnControl({ queueContext: createQueueContext(queue, item, { interactionCount: 0 }) });
  assert.equal(first.interactionInQuantum, 1);
  assert.equal(first.finalInteractionInQuantum, false);
  assert.equal(first.checkpointRequired, false);

  const third = queueTurnControl({ queueContext: createQueueContext(queue, item, { interactionCount: 2 }) });
  assert.equal(third.interactionInQuantum, 3);
  assert.equal(third.finalInteractionInQuantum, true);
  assert.equal(third.checkpointRequired, true);
});

test("active queue item quantum cannot be changed mid-flight but priority remains mutable", async () => {
  const storage = storageMock();
  let queue = normalizeMissionWorkQueue({
    queueId: "q-active",
    workerId: "worker-10",
    windowId: 10,
    enabled: true,
    activeItemId: "a",
    items: [{ itemId: "a", goal: "A", maxInteractions: 5, priority: "NORMAL", status: "ACTIVE" }]
  }, { windowId: 10 });
  await saveMissionWorkQueue(queue, storage);

  await assert.rejects(
    updateMissionWorkItem(10, "a", { maxInteractions: 2 }, storage, { workerId: "worker-10" }),
    /MISSION_WORK_QUEUE_ACTIVE_QUANTUM_IMMUTABLE/
  );

  queue = await updateMissionWorkItem(10, "a", { priority: "URGENT", maxInteractions: 5 }, storage, { workerId: "worker-10" });
  assert.equal(queue.items[0].priority, "URGENT");
  assert.equal(queue.items[0].maxInteractions, 5);
});

test("normalization never preserves an activeItemId that does not name an ACTIVE item", () => {
  const queue = normalizeMissionWorkQueue({
    queueId: "q-stale",
    windowId: 11,
    activeItemId: "stale",
    items: [
      { itemId: "ready", goal: "Ready", status: "READY" },
      { itemId: "active", goal: "Active", status: "ACTIVE" }
    ]
  }, { windowId: 11 });
  assert.equal(queue.activeItemId, "active");

  const noneActive = normalizeMissionWorkQueue({
    queueId: "q-none",
    windowId: 11,
    activeItemId: "ready",
    items: [{ itemId: "ready", goal: "Ready", status: "READY" }]
  }, { windowId: 11 });
  assert.equal(noneActive.activeItemId, "");
});

test("queue persistence readback rejects no state in the normal durable path", async () => {
  const storage = storageMock();
  const queue = normalizeMissionWorkQueue({
    queueId: "q-readback",
    workerId: "worker-12",
    windowId: 12,
    enabled: true,
    items: [{ itemId: "a", goal: "A", status: QUEUE_STATUS.READY }]
  }, { windowId: 12 });
  const saved = await saveMissionWorkQueue(queue, storage);
  assert.equal(saved.queueId, "q-readback");
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].status, QUEUE_STATUS.READY);
});
