import test from "node:test";
import assert from "node:assert/strict";

import {
  checkpointKeys,
  compactCheckpoint,
  readCheckpoint,
  writeCheckpoint
} from "../lib/durable-checkpoint.mjs";
import {
  maintainStorageHeadroom,
  STORAGE_RETENTION_TARGET_RATIO,
  STORAGE_RETENTION_TRIGGER_RATIO
} from "../lib/storage-retention.mjs";

function area(seed = {}, quota = 10 * 1024 * 1024) {
  const state = structuredClone(seed);
  const api = {
    state,
    QUOTA_BYTES: quota,
    async get(keys) {
      if (keys == null) return structuredClone(state);
      const list = typeof keys === "string"
        ? [keys]
        : Array.isArray(keys)
          ? keys
          : Object.keys(keys || {});
      return Object.fromEntries(
        list.filter((key) => Object.hasOwn(state, key))
          .map((key) => [key, structuredClone(state[key])])
      );
    },
    async set(rows) {
      Object.assign(state, structuredClone(rows));
    },
    async remove(keys) {
      for (const key of (typeof keys === "string" ? [keys] : keys)) delete state[key];
    },
    async getBytesInUse(keys = null) {
      const selected = keys == null
        ? Object.keys(state)
        : (typeof keys === "string" ? [keys] : keys);
      let bytes = 0;
      for (const key of selected) {
        if (!Object.hasOwn(state, key)) continue;
        bytes += new TextEncoder().encode(String(key)).length;
        bytes += new TextEncoder().encode(JSON.stringify(state[key])).length;
      }
      return bytes;
    }
  };
  return api;
}

test("v1.7.5 durable checkpoint steady state keeps primary plus one verified slot", async () => {
  const store = area();
  const key = "eic.gf.test.record";
  await writeCheckpoint(key, {schema:"test", value:"one"}, store);
  await writeCheckpoint(key, {schema:"test", value:"two"}, store);

  const slots = checkpointKeys(key).filter((slot) => store.state[slot]);
  assert.equal(slots.length, 1);
  const record = await readCheckpoint(key, store);
  assert.equal(record.health, "VERIFIED");
  assert.equal(record.value.value, "two");
});

test("v1.7.5 checkpoint compactor removes an older duplicate slot without changing the record", async () => {
  const store = area();
  const key = "eic.gf.test.compact";
  await writeCheckpoint(key, {schema:"test", value:"stable"}, store);
  const slots = checkpointKeys(key);
  const existing = slots.find((slot) => store.state[slot]);
  const other = slots.find((slot) => slot !== existing);
  store.state[other] = structuredClone(store.state[existing]);

  const result = await compactCheckpoint(key, store);
  assert.equal(result.changed, true);
  assert.equal(checkpointKeys(key).filter((slot) => store.state[slot]).length, 1);
  assert.equal((await readCheckpoint(key, store)).value.value, "stable");
});

async function seedWorker(store, workerId, at, chars = 5200, phase = "RECOVERING") {
  const processKey = `eic.gf.process.worker.${workerId}`;
  const queueKey = `eic.gf.mission-work-queue.worker.${workerId}`;
  await writeCheckpoint(processKey, {
    schema:"eic.greenfield.process.v1",
    processId:`process-${workerId}`,
    runId:`run-${workerId}`,
    workerId,
    windowId:1,
    phase,
    updatedAt:at,
    goal:`goal-${workerId}`
  }, store);
  await writeCheckpoint(queueKey, {
    schema:"eic.greenfield.mission-work-queue.v4",
    queueId:`queue-${workerId}`,
    revision:1,
    workerId,
    windowId:1,
    enabled:true,
    activeItemId:"",
    cursorOrder:-1,
    items:[{itemId:`item-${workerId}`,goal:"x".repeat(chars),status:"READY",createdAt:at,updatedAt:at}],
    history:[],
    createdAt:at,
    updatedAt:at
  }, store);
}

test("v1.7.5 high-water retention deletes oldest unbound workers first and preserves live workers", async () => {
  const store = area({}, 32_000);
  await seedWorker(store, "oldest", "2026-01-01T00:00:00.000Z");
  await seedWorker(store, "middle", "2026-02-01T00:00:00.000Z");
  await seedWorker(store, "live", "2026-03-01T00:00:00.000Z");
  const session = area({
    "eic.gf.worker-binding.worker.live": {
      schema:"eic.greenfield.worker-binding.v1",
      workerId:"live",
      windowId:3,
      createdAt:"2026-03-01T00:00:00.000Z",
      updatedAt:"2026-03-01T00:00:00.000Z"
    }
  });

  const before = (await store.getBytesInUse(null)) / store.QUOTA_BYTES;
  assert.ok(before >= STORAGE_RETENTION_TRIGGER_RATIO);

  const result = await maintainStorageHeadroom(store, session, {reason:"test", force:true});
  assert.equal(result.action, "CLEANED");
  assert.ok(result.removedWorkers.length >= 1);
  assert.equal(result.removedWorkers[0].workerId, "oldest");
  assert.ok(store.state["eic.gf.process.worker.live"]);
  assert.ok(store.state["eic.gf.mission-work-queue.worker.live"]);
  assert.equal(store.state["eic.gf.process.worker.oldest"], undefined);
  assert.ok(result.afterRatio <= STORAGE_RETENTION_TARGET_RATIO || result.removedWorkers.length === 2);
});

test("v1.7.5 retention is a no-op below the high-water trigger", async () => {
  const store = area({}, 1_000_000);
  await seedWorker(store, "quiet", "2026-01-01T00:00:00.000Z", 100);
  const result = await maintainStorageHeadroom(store, area(), {reason:"test"});
  assert.equal(result.action, "NO_ACTION");
  assert.ok(store.state["eic.gf.process.worker.quiet"]);
});
