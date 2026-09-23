import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAX_ACTIVE_SESSIONS,
  LOW_TO_TOP_PRIORITY_MAX_AGING_MS,
  adoptGlobalTurnSlot,
  PRIORITY_AGING_STEP_MS,
  effectiveSchedulerPriority,
  normalizeMaxActiveSessions,
  readGlobalCapacityScheduler,
  reconcileGlobalCapacityScheduler,
  releaseGlobalTurnSlot,
  requestGlobalTurnSlot,
  updateGlobalTurnPriority
} from "../lib/global-capacity-scheduler.mjs";

function mockStorage() {
  const data = {};
  return {
    async get(key) {
      if (key == null) return { ...data };
      if (typeof key === "string") return { [key]: structuredClone(data[key]) };
      return {};
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(key) {
      delete data[key];
    }
  };
}

test("capacity defaults to two and is bounded to 1..4", () => {
  assert.equal(DEFAULT_MAX_ACTIVE_SESSIONS, 2);
  assert.equal(normalizeMaxActiveSessions(undefined), 2);
  assert.equal(normalizeMaxActiveSessions(0), 1);
  assert.equal(normalizeMaxActiveSessions(5), 4);
  assert.equal(normalizeMaxActiveSessions(3.6), 4);
});

test("priority aging raises one level every three minutes and LOW reaches URGENT after nine", () => {
  const start = 1_000_000;
  assert.equal(PRIORITY_AGING_STEP_MS, 180_000);
  assert.equal(LOW_TO_TOP_PRIORITY_MAX_AGING_MS, 540_000);
  assert.equal(effectiveSchedulerPriority("LOW", start, start).priority, "LOW");
  assert.equal(
    effectiveSchedulerPriority("LOW", start, start + PRIORITY_AGING_STEP_MS).priority,
    "NORMAL"
  );
  assert.equal(
    effectiveSchedulerPriority("LOW", start, start + LOW_TO_TOP_PRIORITY_MAX_AGING_MS).priority,
    "URGENT"
  );
});

test("two active turns are admitted, third waits, and release wakes the next waiter", async () => {
  const storage = mockStorage();
  const now = 2_000_000;
  const p1 = await requestGlobalTurnSlot({
    processId: "p1", windowId: 1, promptHash: "h1", priority: "NORMAL",
    capacity: 2, configuredCapacity: 2, now, storage
  });
  const p2 = await requestGlobalTurnSlot({
    processId: "p2", windowId: 2, promptHash: "h2", priority: "NORMAL",
    capacity: 2, configuredCapacity: 2, now: now + 1, storage
  });
  const p3 = await requestGlobalTurnSlot({
    processId: "p3", windowId: 3, promptHash: "h3", priority: "NORMAL",
    capacity: 2, configuredCapacity: 2, now: now + 2, storage
  });

  assert.equal(p1.allowed, true);
  assert.equal(p2.allowed, true);
  assert.equal(p3.allowed, false);
  assert.equal(p3.queueRank, 1);

  const released = await releaseGlobalTurnSlot({
    processId: "p1", promptHash: "h1",
    capacity: 2, configuredCapacity: 2, now: now + 3, storage
  });
  assert.equal(released.released, true);
  assert.deepEqual(released.runnableProcessIds, ["p3"]);

  const p3AfterWake = await requestGlobalTurnSlot({
    processId: "p3", windowId: 3, promptHash: "h3", priority: "NORMAL",
    capacity: 2, configuredCapacity: 2, now: now + 4, storage
  });
  assert.equal(p3AfterWake.allowed, true);
  assert.equal(p3AfterWake.scheduler.activeCount, 2);
});

test("higher priority overtakes an older lower priority waiter while both are young", async () => {
  const storage = mockStorage();
  const now = 3_000_000;
  await requestGlobalTurnSlot({
    processId: "low", windowId: 1, promptHash: "low-h", priority: "LOW",
    capacity: 0, configuredCapacity: 2, now, storage
  });
  await requestGlobalTurnSlot({
    processId: "high", windowId: 2, promptHash: "high-h", priority: "HIGH",
    capacity: 0, configuredCapacity: 2, now: now + 1_000, storage
  });

  const lowRetry = await requestGlobalTurnSlot({
    processId: "low", windowId: 1, promptHash: "low-h", priority: "LOW",
    capacity: 1, configuredCapacity: 2, now: now + 2_000, storage
  });
  assert.equal(lowRetry.allowed, false);
  assert.deepEqual(lowRetry.runnableProcessIds, ["high"]);

  const high = await requestGlobalTurnSlot({
    processId: "high", windowId: 2, promptHash: "high-h", priority: "HIGH",
    capacity: 1, configuredCapacity: 2, now: now + 2_001, storage
  });
  assert.equal(high.allowed, true);
});

test("anti-starvation: an old LOW waiter eventually outranks later URGENT arrivals by age tie-break", async () => {
  const storage = mockStorage();
  const now = 4_000_000;
  await requestGlobalTurnSlot({
    processId: "low-old", windowId: 1, promptHash: "low-h", priority: "LOW",
    capacity: 0, configuredCapacity: 2, now, storage
  });
  await requestGlobalTurnSlot({
    processId: "urgent-later", windowId: 2, promptHash: "urgent-h", priority: "URGENT",
    capacity: 0, configuredCapacity: 2, now: now + 1_000, storage
  });
  await requestGlobalTurnSlot({
    processId: "urgent-newest", windowId: 3, promptHash: "urgent-new-h", priority: "URGENT",
    capacity: 0, configuredCapacity: 2, now: now + 30_000, storage
  });

  const agedAt = now + LOW_TO_TOP_PRIORITY_MAX_AGING_MS + 1;
  const low = await requestGlobalTurnSlot({
    processId: "low-old", windowId: 1, promptHash: "low-h", priority: "LOW",
    capacity: 1, configuredCapacity: 2, now: agedAt, storage
  });
  assert.equal(low.allowed, true);
  assert.equal(low.activeTurn.processId, "low-old");
  assert.equal(
    effectiveSchedulerPriority("LOW", now, agedAt).priority,
    "URGENT"
  );
});

test("same effective priority is deterministic FIFO by readySince then ticket", async () => {
  const storage = mockStorage();
  const now = 5_000_000;
  await requestGlobalTurnSlot({
    processId: "first", windowId: 1, promptHash: "h1", priority: "NORMAL",
    capacity: 0, configuredCapacity: 2, now, storage
  });
  await requestGlobalTurnSlot({
    processId: "second", windowId: 2, promptHash: "h2", priority: "NORMAL",
    capacity: 0, configuredCapacity: 2, now: now + 1, storage
  });
  const view = await readGlobalCapacityScheduler(storage, {
    capacity: 1, configuredCapacity: 2, now: now + 2
  });
  assert.deepEqual(view.runnableProcessIds, ["first"]);
  assert.equal(view.waiters[0].processId, "first");
  assert.equal(view.waiters[0].queueRank, 1);
});

test("priority update reorders waiters but never preempts already active turns", async () => {
  const storage = mockStorage();
  const now = 6_000_000;
  await requestGlobalTurnSlot({
    processId: "active", windowId: 1, promptHash: "ha", priority: "LOW",
    capacity: 1, configuredCapacity: 2, now, storage
  });
  await requestGlobalTurnSlot({
    processId: "queued", windowId: 2, promptHash: "hq", priority: "LOW",
    capacity: 1, configuredCapacity: 2, now: now + 1, storage
  });

  const update = await updateGlobalTurnPriority({
    processId: "queued", priority: "URGENT",
    capacity: 1, configuredCapacity: 2, now: now + 2, storage
  });
  assert.equal(update.scheduler.activeTurns[0].processId, "active");
  assert.equal(update.scheduler.waiters[0].processId, "queued");
  assert.equal(update.scheduler.waiters[0].priority, "URGENT");
  assert.equal(update.scheduler.availableSlots, 0);
});

test("lowering capacity is non-preemptive and blocks new slots until active count falls", async () => {
  const storage = mockStorage();
  const now = 7_000_000;
  await requestGlobalTurnSlot({
    processId: "p1", windowId: 1, promptHash: "h1", priority: "NORMAL",
    capacity: 2, configuredCapacity: 2, now, storage
  });
  await requestGlobalTurnSlot({
    processId: "p2", windowId: 2, promptHash: "h2", priority: "NORMAL",
    capacity: 2, configuredCapacity: 2, now: now + 1, storage
  });
  const view = await readGlobalCapacityScheduler(storage, {
    capacity: 1, configuredCapacity: 1, now: now + 2
  });
  assert.equal(view.activeCount, 2);
  assert.equal(view.availableSlots, 0);
});


test("anti-starvation queue never drops an older waiter when more sessions arrive", async () => {
  const storage = mockStorage();
  const now = 9_000_000;
  await requestGlobalTurnSlot({
    processId: "old-low", windowId: 1, promptHash: "old-low-h", priority: "LOW",
    capacity: 0, configuredCapacity: 2, now, storage
  });
  for (let index = 0; index < 140; index += 1) {
    await requestGlobalTurnSlot({
      processId: `later-${index}`,
      windowId: index + 2,
      promptHash: `h-${index}`,
      priority: "URGENT",
      capacity: 0,
      configuredCapacity: 2,
      now: now + 1_000 + index,
      storage
    });
  }
  const view = await readGlobalCapacityScheduler(storage, {
    capacity: 0,
    configuredCapacity: 2,
    now: now + 2_000
  });
  assert.equal(view.waitingCount, 141);
  assert.equal(view.waiters.some((item) => item.processId === "old-low"), true);
});

test("reconciliation preserves observed active turns and eligible queued waiters after worker restart", async () => {
  const storage = mockStorage();
  const now = 8_000_000;
  await requestGlobalTurnSlot({
    processId: "queued", windowId: 2, promptHash: "hq", priority: "HIGH",
    capacity: 0, configuredCapacity: 2, now, storage
  });
  const reconciled = await reconcileGlobalCapacityScheduler({
    activeTurns: [{
      processId: "active",
      windowId: 1,
      promptHash: "ha",
      priority: "NORMAL",
      acquiredAtMs: now - 1_000
    }],
    eligibleWaiters: [{
      processId: "queued",
      windowId: 2,
      promptHash: "hq",
      priority: "HIGH",
      readySinceMs: now
    }],
    capacity: 2,
    configuredCapacity: 2,
    now: now + 1_000,
    storage
  });
  assert.equal(reconciled.scheduler.activeCount, 1);
  assert.equal(reconciled.scheduler.waitingCount, 1);
  assert.deepEqual(reconciled.runnableProcessIds, ["queued"]);
});


test("v1.3.8 observed-effect adoption cannot be used as an ordinary capacity bypass", async () => {
  const storage = mockStorage();
  await assert.rejects(
    adoptGlobalTurnSlot({
      processId: "observed",
      windowId: 10,
      promptHash: "h-observed",
      capacity: 1,
      configuredCapacity: 1,
      now: 10_000_000,
      storage
    }),
    /GLOBAL_CAPACITY_ADOPT_REQUIRES_OBSERVED_EFFECT/
  );

  const adopted = await adoptGlobalTurnSlot({
    processId: "observed",
    windowId: 10,
    promptHash: "h-observed",
    capacity: 1,
    configuredCapacity: 1,
    observedEffect: true,
    now: 10_000_001,
    storage
  });
  assert.equal(adopted.adopted, true);
  assert.equal(adopted.observedEffect, true);
  assert.equal(adopted.observedOverCapacity, false);
});

test("v1.3.8 owner-observed in-flight effects remain truthful even when configured capacity is already full", async () => {
  const storage = mockStorage();
  await requestGlobalTurnSlot({
    processId: "active",
    windowId: 1,
    promptHash: "ha",
    priority: "NORMAL",
    capacity: 1,
    configuredCapacity: 1,
    now: 11_000_000,
    storage
  });
  const adopted = await adoptGlobalTurnSlot({
    processId: "already-in-flight",
    windowId: 2,
    promptHash: "hb",
    priority: "NORMAL",
    capacity: 1,
    configuredCapacity: 1,
    observedEffect: true,
    now: 11_000_001,
    storage
  });
  assert.equal(adopted.scheduler.activeCount, 2);
  assert.equal(adopted.observedOverCapacity, true);
  assert.equal(adopted.scheduler.availableSlots, 0);
});
