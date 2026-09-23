import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cancelGlobalTurnProcess,
  requestGlobalTurnSlot
} from "../lib/global-capacity-scheduler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");

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

function sliceBetween(start, end) {
  const startIndex = background.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = background.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return background.slice(startIndex, endIndex);
}

test("v1.5.0 same-process prompt replacement is safe only after explicit scheduler cancellation", async () => {
  const storage = mockStorage();
  const first = await requestGlobalTurnSlot({
    processId: "p1",
    windowId: 1,
    promptHash: "old-prompt",
    priority: "NORMAL",
    capacity: 1,
    configuredCapacity: 1,
    now: 1_000,
    storage
  });
  assert.equal(first.allowed, true);

  const mismatch = await requestGlobalTurnSlot({
    processId: "p1",
    windowId: 1,
    promptHash: "new-prompt",
    priority: "NORMAL",
    capacity: 1,
    configuredCapacity: 1,
    now: 1_001,
    storage
  });
  assert.equal(mismatch.allowed, false);
  assert.equal(mismatch.reason, "GLOBAL_CAPACITY_ACTIVE_PROMPT_MISMATCH");

  const cancelled = await cancelGlobalTurnProcess({
    processId: "p1",
    capacity: 1,
    configuredCapacity: 1,
    now: 1_002,
    storage
  });
  assert.equal(cancelled.removed, true);
  assert.equal(cancelled.hadActive, true);

  const rearmed = await requestGlobalTurnSlot({
    processId: "p1",
    windowId: 1,
    promptHash: "new-prompt",
    priority: "NORMAL",
    capacity: 1,
    configuredCapacity: 1,
    now: 1_003,
    storage
  });
  assert.equal(rearmed.allowed, true);
  assert.equal(rearmed.activeTurn.promptHash, "new-prompt");
});

test("v1.5.0 producer-loss recovery cancels stale scheduler ownership before new prompt re-arm", () => {
  const branch = sliceBetween(
    'causal.reason === "AUTONOMOUS_RESPONSE_PRODUCER_LOST"',
    'if (!causal.ready) {'
  );
  const cancelIndex = branch.indexOf(
    'cancelSchedulerProcess(\n      process,\n      "AUTONOMOUS_RESPONSE_PRODUCER_LOST_REARM"'
  );
  const commitIndex = branch.indexOf("commitTransition(process, PHASES.SENDING");
  assert.ok(cancelIndex >= 0);
  assert.ok(commitIndex > cancelIndex);
});

test("v1.5.0 idle keepalive cancels stale scheduler ownership before replacing the prompt", () => {
  const branch = sliceBetween(
    "const keepaliveDue =",
    "scheduleFast(process.processId, FAST_RECHECK_MS);"
  );
  const cancelIndex = branch.indexOf(
    'cancelSchedulerProcess(\n        process,\n        "IDLE_KEEPALIVE_REARM"'
  );
  const commitIndex = branch.indexOf("commitTransition(process, PHASES.SENDING");
  assert.ok(cancelIndex >= 0);
  assert.ok(commitIndex > cancelIndex);
});

test("v1.5.0 release package does not ship the temporary capacity probe", () => {
  assert.equal(fs.existsSync(path.join(root, "tmp_probe.mjs")), false);
});

test("v1.5.0 sending path self-heals a stale same-process active prompt before entering capacity wait", () => {
  const branch = sliceBetween(
    "const capacityClaim = await requestGlobalTurnSlot",
    'await audit(process, "GLOBAL_CAPACITY_SLOT_ACQUIRED"'
  );
  assert.match(branch, /GLOBAL_CAPACITY_ACTIVE_PROMPT_MISMATCH/);
  assert.match(branch, /!pending\.dispatch/);
  const cancelIndex = branch.indexOf(
    'cancelSchedulerProcess(\n        process,\n        "STALE_ACTIVE_PROMPT_REARM"'
  );
  const waitIndex = branch.indexOf(
    'await audit(process, "GLOBAL_CAPACITY_WAITING"'
  );
  assert.ok(cancelIndex >= 0);
  assert.ok(waitIndex > cancelIndex);
  assert.match(branch, /GLOBAL_CAPACITY_STALE_PROMPT_REARMED/);
});
