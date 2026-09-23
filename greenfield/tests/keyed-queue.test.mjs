import test from "node:test";
import assert from "node:assert/strict";
import { createKeyedQueue } from "../lib/keyed-queue.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("same process is serialized", async () => {
  const q = createKeyedQueue();
  const events = [];
  const a = q.enqueue("A", async () => {
    events.push("a1");
    await sleep(25);
    events.push("a2");
  });
  const b = q.enqueue("A", async () => {
    events.push("b1");
  });
  await Promise.all([a, b]);
  assert.deepEqual(events, ["a1", "a2", "b1"]);
});

test("different processes are not globally serialized", async () => {
  const q = createKeyedQueue();
  const events = [];
  const a = q.enqueue("A", async () => {
    events.push("a-start");
    await sleep(35);
    events.push("a-end");
  });
  const b = q.enqueue("B", async () => {
    events.push("b-start");
    await sleep(5);
    events.push("b-end");
  });
  await Promise.all([a, b]);
  assert.ok(events.indexOf("b-end") < events.indexOf("a-end"));
});
