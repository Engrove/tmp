import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  MISSION_WORK_QUEUE_REGISTRY_KEY,
  QUEUE_STATUS,
  isRunnableQueueItem,
  loadMissionWorkQueue,
  missionWorkQueueKey,
  missionWorkQueueWorkerKey,
  normalizeMissionWorkQueue,
  requeueBlockedMissionWorkItem,
  saveMissionWorkQueue,
  selectNextMissionItem
} from "../lib/mission-work-queue.mjs";
import {
  loadOperatorSettings,
  saveOperatorSettings
} from "../lib/operator-settings.mjs";

function storageMock(initial = {}) {
  const state = structuredClone(initial);
  return {
    state,
    async get(key) {
      if (key == null) return structuredClone(state);
      if (typeof key === "string") return { [key]: structuredClone(state[key]) };
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((entry) => [entry, structuredClone(state[entry])]));
      }
      return structuredClone(state);
    },
    async set(values) {
      Object.assign(state, structuredClone(values));
    }
  };
}

test("v1.3.9 BLOCKED remains in the active mission queue, yields to other work, then becomes retryable", () => {
  const now = Date.parse("2026-09-06T10:00:00Z");
  const queue = normalizeMissionWorkQueue({
    queueId: "q-block",
    windowId: 7,
    enabled: true,
    activeItemId: "blocked",
    items: [
      {
        itemId: "blocked",
        goal: "Blocked mission",
        status: "ACTIVE",
        priority: "HIGH",
        order: 0
      },
      {
        itemId: "other",
        goal: "Other mission",
        status: "READY",
        priority: "NORMAL",
        order: 1,
        readySinceMs: now
      }
    ],
    history: []
  }, { windowId: 7, now });

  const parked = requeueBlockedMissionWorkItem(queue, "blocked", {
    processSnapshot: { processId: "p1", runId: "r1", phase: "BLOCKED" },
    resume: { objective: "Continue from durable state." },
    lastOutcome: "GREENFIELD_BLOCKED",
    lastSummary: "Owner dependency unavailable.",
    retryAfterSeconds: 60,
    now
  });

  assert.equal(parked.activeItemId, "");
  assert.equal(parked.items.length, 2);
  assert.equal(parked.history.length, 0);
  const blocked = parked.items.find((item) => item.itemId === "blocked");
  assert.equal(blocked.status, QUEUE_STATUS.BLOCKED);
  assert.equal(blocked.blockedCount, 1);
  assert.equal(blocked.blockedRetryAtMs, now + 60_000);
  assert.equal(isRunnableQueueItem(blocked, now + 59_999), false);
  assert.equal(isRunnableQueueItem(blocked, now + 60_000), true);

  assert.equal(selectNextMissionItem(parked, { now })?.itemId, "other");
  assert.equal(selectNextMissionItem(parked, {
    now: now + 60_000,
    excludeItemId: "other"
  })?.itemId, "blocked");
});

test("v1.5.1 quarantines legacy window-keyed queue state instead of importing it into a fresh worker", async () => {
  const key = missionWorkQueueKey(11);
  const storage = storageMock({
    [key]: {
      schema: "eic.greenfield.mission-work-queue.v1",
      queueId: "legacy-q",
      windowId: 11,
      enabled: true,
      activeItemId: "",
      items: [{
        itemId: "legacy-ready",
        goal: "Must not leak",
        label: "Legacy queue item",
        priority: "HIGH",
        maxInteractions: 5,
        status: "READY",
        order: 0
      }],
      history: []
    }
  });

  const queue = await loadMissionWorkQueue(11, storage, { workerId: "worker-new" });
  assert.equal(queue.workerId, "worker-new");
  assert.equal(queue.windowId, 11);
  assert.equal(queue.items.length, 0);
  assert.notEqual(queue.queueId, "legacy-q");
  assert.equal(storage.state[key].queueId, "legacy-q", "legacy bytes remain quarantined and untouched");
});

test("v1.5.1 worker-keyed queues never orphan-rebind across Chrome windows or worker identities", async () => {
  const storage = storageMock();
  const queue = normalizeMissionWorkQueue({
    queueId: "durable-q",
    workerId: "worker-a",
    windowId: 21,
    enabled: true,
    activeItemId: "active",
    items: [
      {
        itemId: "active",
        goal: "Continue mission",
        status: "ACTIVE",
        priority: "HIGH",
        order: 0
      },
      {
        itemId: "ready",
        goal: "Queued mission",
        status: "READY",
        priority: "NORMAL",
        order: 1
      }
    ]
  }, { workerId: "worker-a", windowId: 21 });

  await saveMissionWorkQueue(queue, storage);
  assert.equal(Boolean(storage.state[MISSION_WORK_QUEUE_REGISTRY_KEY]), true);
  assert.equal(storage.state[missionWorkQueueWorkerKey("worker-a")].queueId, "durable-q");

  const fresh = await loadMissionWorkQueue(22, storage, { workerId: "worker-b" });
  assert.equal(fresh.workerId, "worker-b");
  assert.equal(fresh.windowId, 22);
  assert.equal(fresh.items.length, 0);
  assert.equal(fresh.activeItemId, "");
  assert.notEqual(fresh.queueId, "durable-q");
  assert.equal(storage.state[missionWorkQueueWorkerKey("worker-b")], undefined);

  const original = await loadMissionWorkQueue(21, storage, { workerId: "worker-a" });
  assert.equal(original.queueId, "durable-q");
  assert.equal(original.items.length, 2);
  assert.equal(original.activeItemId, "active");

  const registry = storage.state[MISSION_WORK_QUEUE_REGISTRY_KEY];
  const row = registry.entries.find((entry) => entry.workerId === "worker-a");
  assert.ok(row);
  assert.equal(row.queueId, "durable-q");
  assert.equal(row.itemCount, 2);
  assert.equal("queue" in row, false, "global registry contains metadata only, never another worker's queue body");
});

test("v1.3.9 queue base parameters round-trip through profile-local operator settings", async () => {
  const storage = storageMock();
  const saved = await saveOperatorSettings({
    defaultMissionQuantumInteractions: 17,
    queuePriorityAgingSeconds: 420,
    queueSwitchDelaySeconds: 23,
    queueSwitchHardReload: false,
    queueSwitchSettleSeconds: 7
  }, storage, { restoreSavedMissions: false, bookmarks: null });

  assert.equal(saved.defaultMissionQuantumInteractions, 17);
  assert.equal(saved.queuePriorityAgingSeconds, 420);
  assert.equal(saved.queueSwitchDelaySeconds, 23);
  assert.equal(saved.queueSwitchHardReload, false);
  assert.equal(saved.queueSwitchSettleSeconds, 7);

  const readback = await loadOperatorSettings(storage, { restoreSavedMissions: false, bookmarks: null });
  assert.deepEqual(readback, saved);
});

test("v1.3.9 UI captures queue settings before busy-state render can rewrite the controls", () => {
  const sidepanel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");

  const match = sidepanel.match(/async function saveQueueSettings\(\) \{([\s\S]*?)\n\}/);
  assert.ok(match);
  const body = match[1];
  assert.ok(body.indexOf("const patch = {") >= 0);
  assert.ok(body.indexOf("const patch = {") < body.indexOf("renderOperatorSettings();"));
  assert.match(body, /\.\.\.patch/);
  assert.match(html, /Klart \/ avslutade/);
  assert.doesNotMatch(html, /Klart \/ blockerade/);
  assert.match(background, /MISSION_QUEUE_ITEM_BLOCKED_REQUEUED/);
  assert.match(background, /blockedRetryAtMs/);
});
