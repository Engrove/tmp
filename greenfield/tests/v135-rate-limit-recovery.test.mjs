import test from "node:test";
import assert from "node:assert/strict";
import {
  claimGlobalPromptSend,
  commitGlobalPromptPost,
  GLOBAL_RATE_LIMIT_STATES,
  markGlobalRateLimitPreflightComplete,
  markGlobalRateLimitWarning,
  RATE_LIMIT_COOLDOWN_SECONDS,
  RATE_LIMIT_REQUIRED_SUCCESS_COUNT,
  RATE_LIMIT_SERIAL_DELAYS_SECONDS,
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

async function reserve(storage, processId, windowId, promptHash, now) {
  return reserveGlobalPromptSlot({
    processId,
    windowId,
    promptHash,
    delaySeconds: 0,
    now,
    storage
  });
}

async function claim(storage, reservation, processId, windowId, promptHash, now) {
  return claimGlobalPromptSend({
    reservationId: reservation.reservationId,
    processId,
    windowId,
    promptHash,
    delaySeconds: 0,
    reservationNotBeforeAtMs: reservation.notBeforeAtMs,
    now,
    storage
  });
}

test("rate-limit warning globally blocks all affected clients and deduplicates the same incident", async () => {
  const storage = mockStorage();
  const now = 10_000;
  const p1 = await reserve(storage, "p1", 1, "h1", now);
  const p2 = await reserve(storage, "p2", 2, "h2", now);

  const first = await markGlobalRateLimitWarning({
    processId: "p1",
    windowId: 1,
    incidentKey: "send:op-1:sig-a",
    warningSignature: "sig-a",
    activeProcessIds: ["p1", "p2"],
    now: now + 100,
    storage
  });
  assert.equal(first.newIncident, true);
  assert.equal(first.rateLimit.state, GLOBAL_RATE_LIMIT_STATES.COOLDOWN);
  assert.equal(first.rateLimit.epoch, 1);
  assert.equal(first.rateLimit.level, 1);
  assert.equal(first.cooldownSeconds, RATE_LIMIT_COOLDOWN_SECONDS[0]);
  assert.deepEqual(first.rateLimit.affectedProcessIds, ["p1", "p2"]);

  const duplicate = await markGlobalRateLimitWarning({
    processId: "p1",
    windowId: 1,
    incidentKey: "send:op-1:sig-a",
    warningSignature: "sig-a",
    activeProcessIds: ["p1", "p2"],
    now: now + 500,
    storage
  });
  assert.equal(duplicate.newIncident, false);
  assert.equal(duplicate.rateLimit.epoch, 1);
  assert.equal(duplicate.rateLimit.level, 1);

  const blocked1 = await claim(storage, p1, "p1", 1, "h1", now + 1_000);
  const blocked2 = await claim(storage, p2, "p2", 2, "h2", now + 1_000);
  assert.equal(blocked1.allowed, false);
  assert.equal(blocked1.reason, "GLOBAL_RATE_LIMIT_COOLDOWN");
  assert.equal(blocked2.allowed, false);
  assert.equal(blocked2.reason, "GLOBAL_RATE_LIMIT_COOLDOWN");
});

test("recovery is serialized and each affected client must complete its first-release preflight", async () => {
  const storage = mockStorage();
  const detectedAt = 1_000_000;
  const p1 = await reserve(storage, "p1", 1, "h1", detectedAt - 1_000);
  const p2 = await reserve(storage, "p2", 2, "h2", detectedAt - 1_000);
  const warning = await markGlobalRateLimitWarning({
    processId: "p1",
    windowId: 1,
    incidentKey: "send:op-a:sig",
    warningSignature: "sig",
    activeProcessIds: ["p1", "p2"],
    now: detectedAt,
    storage
  });
  const releaseAt = warning.rateLimit.cooldownUntilMs;

  let firstClaim = await claim(storage, p1, "p1", 1, "h1", releaseAt);
  assert.equal(firstClaim.allowed, true);
  assert.equal(firstClaim.recovery.state, GLOBAL_RATE_LIMIT_STATES.SERIAL_RECOVERY);
  assert.equal(firstClaim.recovery.preflightRequired, true);

  const otherDuringLease = await claim(storage, p2, "p2", 2, "h2", releaseAt);
  assert.equal(otherDuringLease.allowed, false);
  assert.equal(otherDuringLease.reason, "GLOBAL_PROMPT_SEND_LEASE_BUSY");

  const prepared1 = await markGlobalRateLimitPreflightComplete({
    processId: "p1",
    windowId: 1,
    epoch: firstClaim.recovery.epoch,
    now: releaseAt + 1,
    storage
  });
  assert.equal(prepared1.ok, true);

  firstClaim = await claim(storage, p1, "p1", 1, "h1", releaseAt + 2);
  assert.equal(firstClaim.allowed, true);
  assert.equal(firstClaim.recovery.preflightRequired, false);

  const post1 = await commitGlobalPromptPost({
    reservationId: p1.reservationId,
    processId: "p1",
    windowId: 1,
    promptHash: "h1",
    postedAtMs: releaseAt + 2,
    storage
  });
  assert.equal(post1.rateLimit.serialSuccessCount, 1);
  assert.equal(
    post1.rateLimit.nextSerialNotBeforeAtMs,
    releaseAt + 2 + RATE_LIMIT_SERIAL_DELAYS_SECONDS[1] * 1000
  );

  const p2TooEarly = await claim(
    storage, p2, "p2", 2, "h2",
    post1.rateLimit.nextSerialNotBeforeAtMs - 1
  );
  assert.equal(p2TooEarly.allowed, false);
  assert.equal(p2TooEarly.reason, "GLOBAL_RATE_LIMIT_SERIAL_PAUSE");

  const p2Release = await claim(
    storage, p2, "p2", 2, "h2",
    post1.rateLimit.nextSerialNotBeforeAtMs
  );
  assert.equal(p2Release.allowed, true);
  assert.equal(p2Release.recovery.preflightRequired, true);
  assert.equal(p2Release.recovery.serialSuccessCount, 1);

  const prepared2 = await markGlobalRateLimitPreflightComplete({
    processId: "p2",
    windowId: 2,
    epoch: p2Release.recovery.epoch,
    now: post1.rateLimit.nextSerialNotBeforeAtMs + 1,
    storage
  });
  assert.equal(prepared2.ok, true);
  await releaseGlobalPromptLease({
    reservationId: p2.reservationId,
    now: post1.rateLimit.nextSerialNotBeforeAtMs + 2,
    storage
  });
});

test("a new warning during serial recovery immediately starts a new, escalated epoch", async () => {
  const storage = mockStorage();
  const detectedAt = 2_000_000;
  const reservation = await reserve(storage, "p1", 1, "h1", detectedAt - 100);
  const first = await markGlobalRateLimitWarning({
    processId: "p1",
    windowId: 1,
    incidentKey: "send:first",
    warningSignature: "sig-a",
    activeProcessIds: ["p1", "p2"],
    now: detectedAt,
    storage
  });

  let claim1 = await claim(storage, reservation, "p1", 1, "h1", first.rateLimit.cooldownUntilMs);
  assert.equal(claim1.allowed, true);
  await markGlobalRateLimitPreflightComplete({
    processId: "p1",
    windowId: 1,
    epoch: claim1.recovery.epoch,
    now: first.rateLimit.cooldownUntilMs + 1,
    storage
  });
  claim1 = await claim(storage, reservation, "p1", 1, "h1", first.rateLimit.cooldownUntilMs + 2);
  assert.equal(claim1.recovery.preflightRequired, false);

  const second = await markGlobalRateLimitWarning({
    processId: "p1",
    windowId: 1,
    incidentKey: "send:second",
    warningSignature: "sig-b",
    activeProcessIds: ["p1", "p2"],
    now: first.rateLimit.cooldownUntilMs + 3,
    storage
  });
  assert.equal(second.newIncident, true);
  assert.equal(second.rateLimit.state, GLOBAL_RATE_LIMIT_STATES.COOLDOWN);
  assert.equal(second.rateLimit.epoch, 2);
  assert.equal(second.rateLimit.level, 2);
  assert.equal(second.cooldownSeconds, RATE_LIMIT_COOLDOWN_SECONDS[1]);
  assert.deepEqual(second.rateLimit.preparedProcessIds, []);
  assert.equal(second.gate.activeLease, null);
});

test("serial recovery returns to NORMAL only after the full success ramp", async () => {
  const storage = mockStorage();
  const detectedAt = 3_000_000;
  let reservation = await reserve(storage, "p1", 1, "h1-0", detectedAt - 100);
  const warning = await markGlobalRateLimitWarning({
    processId: "p1",
    windowId: 1,
    incidentKey: "send:ramp",
    warningSignature: "sig-ramp",
    activeProcessIds: ["p1"],
    now: detectedAt,
    storage
  });
  let now = warning.rateLimit.cooldownUntilMs;
  let gate;

  for (let index = 0; index < RATE_LIMIT_REQUIRED_SUCCESS_COUNT; index += 1) {
    if (index > 0) {
      reservation = await reserve(storage, "p1", 1, `h1-${index}`, now,);
    }
    let c = await claim(storage, reservation, "p1", 1, `h1-${index}`, now);
    assert.equal(c.allowed, true);
    if (c.recovery.preflightRequired) {
      const prepared = await markGlobalRateLimitPreflightComplete({
        processId: "p1",
        windowId: 1,
        epoch: c.recovery.epoch,
        now: now + 1,
        storage
      });
      assert.equal(prepared.ok, true);
      c = await claim(storage, reservation, "p1", 1, `h1-${index}`, now + 2);
      assert.equal(c.allowed, true);
      now += 2;
    }
    gate = await commitGlobalPromptPost({
      reservationId: reservation.reservationId,
      processId: "p1",
      windowId: 1,
      promptHash: `h1-${index}`,
      postedAtMs: now,
      storage
    });
    if (index < RATE_LIMIT_REQUIRED_SUCCESS_COUNT - 1) {
      assert.equal(gate.rateLimit.state, GLOBAL_RATE_LIMIT_STATES.SERIAL_RECOVERY);
      now = gate.rateLimit.nextSerialNotBeforeAtMs;
    }
  }

  assert.equal(gate.rateLimit.serialSuccessCount, RATE_LIMIT_REQUIRED_SUCCESS_COUNT);
  assert.equal(gate.rateLimit.state, GLOBAL_RATE_LIMIT_STATES.NORMAL);
  assert.equal(gate.rateLimit.nextSerialNotBeforeAtMs, 0);
  const readback = await readGlobalPromptGate(storage);
  assert.equal(readback.rateLimit.state, GLOBAL_RATE_LIMIT_STATES.NORMAL);
});
