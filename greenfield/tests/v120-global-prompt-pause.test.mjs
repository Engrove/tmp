import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteMissionPreset,
  loadOperatorSettings,
  normalizePostDelaySeconds,
  saveMissionPreset,
  saveOperatorSettings
} from "../lib/operator-settings.mjs";
import {
  claimGlobalPromptSend,
  commitGlobalPromptPost,
  readGlobalPromptGate,
  releaseGlobalPromptLease,
  reserveGlobalPromptSlot
} from "../lib/global-prompt-gate.mjs";

function mockStorage() {
  const data = {};
  return {
    async get(key) {
      if (key == null) return { ...data };
      if (typeof key === "string") return { [key]: data[key] };
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

test("operator delay is bounded to 0..300 seconds and persists with readback", async () => {
  const storage = mockStorage();
  assert.equal(normalizePostDelaySeconds(-10), 0);
  assert.equal(normalizePostDelaySeconds(301), 300);
  assert.equal(normalizePostDelaySeconds(12.6), 13);

  let settings = await saveOperatorSettings({ postDelaySeconds: 37 }, storage);
  assert.equal(settings.postDelaySeconds, 37);
  settings = await loadOperatorSettings(storage);
  assert.equal(settings.postDelaySeconds, 37);
});


test("operator max active sessions persists with default two and 1..4 bounds", async () => {
  const storage = mockStorage();
  let settings = await loadOperatorSettings(storage);
  assert.equal(settings.maxActiveSessions, 2);

  settings = await saveOperatorSettings({ maxActiveSessions: 3 }, storage);
  assert.equal(settings.maxActiveSessions, 3);
  settings = await loadOperatorSettings(storage);
  assert.equal(settings.maxActiveSessions, 3);

  settings = await saveOperatorSettings({ maxActiveSessions: 99 }, storage);
  assert.equal(settings.maxActiveSessions, 4);
});

test("saved missions are reusable, deduplicated by goal and deletable", async () => {
  const storage = mockStorage();
  let settings = await saveMissionPreset("Mission A\nDo the thing", {
    storage,
    now: 1_000,
    id: "mission-a"
  });
  assert.equal(settings.savedMissions.length, 1);
  assert.equal(settings.savedMissions[0].id, "mission-a");

  settings = await saveMissionPreset("Mission A\nDo the thing", {
    storage,
    now: 2_000,
    id: "ignored-new-id"
  });
  assert.equal(settings.savedMissions.length, 1);
  assert.equal(settings.savedMissions[0].id, "mission-a");
  assert.equal(settings.savedMissions[0].updatedAt, new Date(2_000).toISOString());

  settings = await deleteMissionPreset("mission-a", storage);
  assert.equal(settings.savedMissions.length, 0);
});

test("global reservations serialize two Greenfield windows into spaced prompt slots", async () => {
  const storage = mockStorage();
  const now = 1_000_000;
  const first = await reserveGlobalPromptSlot({
    processId: "p1",
    windowId: 1,
    promptHash: "h1",
    delaySeconds: 10,
    now,
    storage
  });
  const second = await reserveGlobalPromptSlot({
    processId: "p2",
    windowId: 2,
    promptHash: "h2",
    delaySeconds: 10,
    now,
    storage
  });

  assert.equal(first.notBeforeAtMs, now + 10_000);
  assert.equal(second.notBeforeAtMs, now + 20_000);
  assert.equal(second.reservationSeq, first.reservationSeq + 1);
  const gate = await readGlobalPromptGate(storage);
  assert.equal(gate.nextPromptNotBeforeAtMs, second.notBeforeAtMs);
});

test("send lease prevents simultaneous page effects and actual post time re-establishes spacing", async () => {
  const storage = mockStorage();
  const now = 2_000_000;
  const first = await reserveGlobalPromptSlot({
    processId: "p1",
    windowId: 1,
    promptHash: "h1",
    delaySeconds: 10,
    now,
    storage
  });
  const second = await reserveGlobalPromptSlot({
    processId: "p2",
    windowId: 2,
    promptHash: "h2",
    delaySeconds: 10,
    now,
    storage
  });

  const claim1 = await claimGlobalPromptSend({
    reservationId: first.reservationId,
    processId: "p1",
    windowId: 1,
    promptHash: "h1",
    delaySeconds: 10,
    reservationNotBeforeAtMs: first.notBeforeAtMs,
    now: first.notBeforeAtMs,
    storage
  });
  assert.equal(claim1.allowed, true);

  const claim2Busy = await claimGlobalPromptSend({
    reservationId: second.reservationId,
    processId: "p2",
    windowId: 2,
    promptHash: "h2",
    delaySeconds: 10,
    reservationNotBeforeAtMs: second.notBeforeAtMs,
    now: first.notBeforeAtMs,
    storage
  });
  assert.equal(claim2Busy.allowed, false);
  assert.equal(claim2Busy.reason, "GLOBAL_PROMPT_SEND_LEASE_BUSY");

  const lateActualPost = first.notBeforeAtMs + 8_000;
  await commitGlobalPromptPost({
    reservationId: first.reservationId,
    processId: "p1",
    windowId: 1,
    promptHash: "h1",
    postedAtMs: lateActualPost,
    storage
  });

  const claim2TooEarly = await claimGlobalPromptSend({
    reservationId: second.reservationId,
    processId: "p2",
    windowId: 2,
    promptHash: "h2",
    delaySeconds: 10,
    reservationNotBeforeAtMs: second.notBeforeAtMs,
    now: second.notBeforeAtMs,
    storage
  });
  assert.equal(claim2TooEarly.allowed, false);
  assert.equal(claim2TooEarly.reason, "GLOBAL_PROMPT_POST_PAUSE");
  assert.equal(claim2TooEarly.notBeforeAtMs, lateActualPost + 10_000);

  const claim2 = await claimGlobalPromptSend({
    reservationId: second.reservationId,
    processId: "p2",
    windowId: 2,
    promptHash: "h2",
    delaySeconds: 10,
    reservationNotBeforeAtMs: second.notBeforeAtMs,
    now: lateActualPost + 10_000,
    storage
  });
  assert.equal(claim2.allowed, true);
  await releaseGlobalPromptLease({ reservationId: second.reservationId, now: lateActualPost + 10_001, storage });
  assert.equal((await readGlobalPromptGate(storage)).activeLease, null);
});
