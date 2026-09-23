import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  ensureWorkerBinding,
  getWorkerBinding,
  releaseWorkerBinding,
  workerBindingWindowKey,
  workerBindingWorkerKey
} from "../lib/worker-identity.mjs";
import {
  MISSION_WORK_QUEUE_REGISTRY_KEY,
  loadMissionWorkQueue,
  missionWorkQueueKey,
  missionWorkQueueWorkerKey,
  normalizeMissionWorkQueue,
  saveMissionWorkQueue
} from "../lib/mission-work-queue.mjs";
import {
  applyMissionQueueSet,
  loadMissionQueueSets,
  saveMissionQueueSet
} from "../lib/mission-queue-sets.mjs";
import {
  QUEUE_AFTER_RESPONSE,
  queueAfterResponseAction
} from "../lib/queue-control-policy.mjs";
import {
  createMissionPauseRecord,
  missionPauseDue,
  missionPauseRemainingMs
} from "../lib/mission-pause.mjs";
import { parseTargetResponse } from "../lib/response-contract.mjs";
import {
  createProcess,
  isCurrentToken,
  ownerToken
} from "../lib/state.mjs";
import {
  loadAllProcesses,
  loadProcessForWindow,
  processKey,
  processWorkerKey,
  saveProcess
} from "../lib/process-store.mjs";

function storageMock(initial = {}, { delayMs = 0 } = {}) {
  const state = structuredClone(initial);
  const pause = async () => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  };
  return {
    state,
    async get(key) {
      await pause();
      if (key == null) return structuredClone(state);
      if (typeof key === "string") return { [key]: structuredClone(state[key]) };
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((entry) => [entry, structuredClone(state[entry])]));
      }
      return structuredClone(state);
    },
    async set(values) {
      await pause();
      Object.assign(state, structuredClone(values));
    },
    async remove(keys) {
      await pause();
      for (const key of (Array.isArray(keys) ? keys : [keys])) delete state[key];
    }
  };
}

test("v1.5.1 worker identity is stable across service-worker style re-reads and distinct per Chrome window", async () => {
  const session = storageMock();
  const a1 = await ensureWorkerBinding(10, session, { now: 1_000 });
  const a2 = await ensureWorkerBinding(10, session, { now: 2_000 });
  const b = await ensureWorkerBinding(11, session, { now: 3_000 });

  assert.equal(a2.workerId, a1.workerId);
  assert.notEqual(b.workerId, a1.workerId);
  assert.equal((await getWorkerBinding(10, session)).workerId, a1.workerId);
  assert.equal(session.state[workerBindingWorkerKey(a1.workerId)].windowId, 10);
});

test("v1.5.1 closed-window binding release prevents numeric Chrome window-id reuse from inheriting worker identity", async () => {
  const session = storageMock();
  const first = await ensureWorkerBinding(42, session, { now: 1_000 });
  await releaseWorkerBinding(42, session);
  assert.equal(session.state[workerBindingWindowKey(42)], undefined);
  assert.equal(session.state[workerBindingWorkerKey(first.workerId)], undefined);

  const second = await ensureWorkerBinding(42, session, { now: 2_000 });
  assert.notEqual(second.workerId, first.workerId);
});

test("v1.5.1 fresh worker never adopts another worker queue or legacy window-keyed queue", async () => {
  const local = storageMock({
    [missionWorkQueueKey(20)]: {
      schema: "eic.greenfield.mission-work-queue.v2",
      queueId: "legacy-window-q",
      windowId: 20,
      enabled: true,
      items: [{ itemId: "legacy", goal: "Do not inherit", status: "READY" }]
    }
  });

  const queueA = normalizeMissionWorkQueue({
    queueId: "worker-a-q",
    workerId: "worker-a",
    windowId: 10,
    enabled: true,
    items: [{ itemId: "a", goal: "A", status: "READY" }]
  }, { workerId: "worker-a", windowId: 10 });
  await saveMissionWorkQueue(queueA, local);

  const freshB = await loadMissionWorkQueue(20, local, { workerId: "worker-b" });
  assert.equal(freshB.workerId, "worker-b");
  assert.equal(freshB.windowId, 20);
  assert.equal(freshB.items.length, 0);
  assert.notEqual(freshB.queueId, "worker-a-q");
  assert.notEqual(freshB.queueId, "legacy-window-q");
});

test("v1.5.1 global queue registry is serialized and metadata-only under concurrent worker writes", async () => {
  const local = storageMock({}, { delayMs: 2 });
  const qa = normalizeMissionWorkQueue({
    queueId: "qa",
    workerId: "worker-a",
    windowId: 1,
    items: [{ itemId: "a", goal: "A", status: "READY" }]
  }, { workerId: "worker-a", windowId: 1 });
  const qb = normalizeMissionWorkQueue({
    queueId: "qb",
    workerId: "worker-b",
    windowId: 2,
    items: [{ itemId: "b", goal: "B", status: "READY" }]
  }, { workerId: "worker-b", windowId: 2 });

  await Promise.all([
    saveMissionWorkQueue(qa, local),
    saveMissionWorkQueue(qb, local)
  ]);

  const registry = local.state[MISSION_WORK_QUEUE_REGISTRY_KEY];
  assert.equal(registry.entries.length, 2);
  assert.deepEqual(new Set(registry.entries.map((row) => row.workerId)), new Set(["worker-a", "worker-b"]));
  assert.ok(registry.entries.every((row) => !("queue" in row)));
  assert.equal(local.state[missionWorkQueueWorkerKey("worker-a")].queueId, "qa");
  assert.equal(local.state[missionWorkQueueWorkerKey("worker-b")].queueId, "qb");
});


test("v1.5.1 same-worker concurrent queue writes fail stale instead of silently losing an update", async () => {
  const local = storageMock({}, { delayMs: 2 });
  const initial = await saveMissionWorkQueue(normalizeMissionWorkQueue({
    queueId: "same-worker-q",
    workerId: "worker-a",
    windowId: 1,
    enabled: false,
    items: [{ itemId: "a", goal: "A", status: "READY" }]
  }, { workerId: "worker-a", windowId: 1 }), local);

  assert.equal(initial.revision, 1);
  const a = await loadMissionWorkQueue(1, local, { workerId: "worker-a" });
  const b = await loadMissionWorkQueue(1, local, { workerId: "worker-a" });
  a.enabled = true;
  b.items[0].label = "second-writer";

  const results = await Promise.allSettled([
    saveMissionWorkQueue(a, local),
    saveMissionWorkQueue(b, local)
  ]);
  assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(results.filter((entry) =>
    entry.status === "rejected" && entry.reason?.code === "MISSION_WORK_QUEUE_STALE_WRITE"
  ).length, 1);

  const stored = await loadMissionWorkQueue(1, local, { workerId: "worker-a" });
  assert.equal(stored.revision, 2);
  assert.equal(local.state[MISSION_WORK_QUEUE_REGISTRY_KEY].entries[0].revision, 2);
});

test("v1.5.1 process store ignores legacy window state and only returns a live exact worker binding", async () => {
  const local = storageMock({
    [processKey(33)]: {
      schema: "eic.greenfield.process.v1",
      version: "1.5.0",
      processId: "legacy-process",
      runId: "legacy-run",
      workerId: "legacy-worker",
      generation: 1,
      phase: "SENDING",
      windowId: 33
    }
  });
  const session = storageMock();
  const binding = await ensureWorkerBinding(33, session);

  assert.equal(await loadProcessForWindow(33, local, session), null);

  const process = createProcess({
    workerId: binding.workerId,
    windowId: 33,
    tabId: 9,
    goal: "Isolated",
    initialPrompt: "Start"
  });
  await saveProcess(process, local, session);
  assert.equal((await loadProcessForWindow(33, local, session)).processId, process.processId);
  assert.equal(local.state[processWorkerKey(binding.workerId)].workerId, binding.workerId);

  const live = await loadAllProcesses(local, session);
  assert.equal(live.length, 1);
  assert.equal(live[0].workerId, binding.workerId);
  assert.equal(live.some((entry) => entry.processId === "legacy-process"), false);
});

test("v1.5.1 process owner token fences worker, run and generation", () => {
  const process = createProcess({
    workerId: "worker-a",
    windowId: 1,
    tabId: 2,
    goal: "Fence",
    initialPrompt: "Start"
  });
  const token = ownerToken(process, "op-1");
  assert.equal(isCurrentToken(process, token), true);
  assert.equal(isCurrentToken(process, { ...token, workerId: "worker-b" }), false);
  assert.equal(isCurrentToken(process, { ...token, runId: "other-run" }), false);
  assert.equal(isCurrentToken(process, { ...token, generation: token.generation + 1 }), false);
});

test("v1.7.4 queue-managed PAUSE_PROCESS parks and advances instead of holding the worker", () => {
  assert.equal(queueAfterResponseAction({
    queueManaged: true,
    queueQuantumReached: true,
    sessionAction: "PAUSE_PROCESS"
  }), QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH);

  assert.equal(queueAfterResponseAction({
    queueManaged: true,
    queueQuantumReached: false,
    sessionAction: "YIELD_TO_QUEUE"
  }), QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH);

  assert.equal(queueAfterResponseAction({
    queueManaged: true,
    queueQuantumReached: true,
    sessionAction: "KEEP"
  }), QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH);
});

test("v1.7.4 600-second PAUSE_PROCESS parses and becomes queue-local while preserving not-before timing", () => {
  const parsed = parseTargetResponse(JSON.stringify({
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    sessionAction: "PAUSE_PROCESS",
    pauseSeconds: 600,
    sessionReason: "Wait ten minutes",
    summary: "Timed dependency.",
    workPerformed: [],
    evidence: [],
    blockers: [],
    nextSuggestedAction: "Re-read mutable owner state after wake."
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.pauseSeconds, 600);
  assert.equal(queueAfterResponseAction({
    queueManaged: true,
    queueQuantumReached: true,
    sessionAction: parsed.value.sessionAction
  }), QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH);

  const now = Date.parse("2026-09-07T08:00:00.000Z");
  const pause = createMissionPauseRecord({
    processId: "p600",
    generation: 1,
    durationSeconds: parsed.value.pauseSeconds,
    reason: parsed.value.sessionReason,
    now
  });
  assert.equal(pause.durationSeconds, 600);
  assert.equal(pause.resumeAtMs, now + 600_000);
  assert.equal(missionPauseRemainingMs(pause, now + 599_999), 1);
  assert.equal(missionPauseDue(pause, now + 599_999), false);
  assert.equal(missionPauseDue(pause, now + 600_000), true);
});

test("v1.5.1 queue sets save configuration only and apply fresh READY identities to each worker", async () => {
  const local = storageMock();
  const source = normalizeMissionWorkQueue({
    queueId: "source-q",
    workerId: "worker-source",
    windowId: 1,
    enabled: false,
    items: [{
      itemId: "runtime-item",
      savedMissionId: "saved-a",
      label: "A",
      goal: "Mission A",
      priority: "HIGH",
      maxInteractions: 7,
      status: "PAUSED",
      pauseUntilMs: Date.now() + 999_999,
      processSnapshot: { workerId: "worker-source", processId: "p", runId: "r" },
      resume: { objective: "runtime resume" },
      delegation: { requestId: "runtime-delegation" },
      lastError: { code: "runtime" }
    }]
  }, { workerId: "worker-source", windowId: 1 });

  const saved = await saveMissionQueueSet({ name: "Morgon", queue: source }, local);
  assert.equal(saved.set.items.length, 1);
  assert.deepEqual(Object.keys(saved.set.items[0]).sort(), [
    "goal", "label", "maxInteractions", "order", "priority", "savedMissionId"
  ].sort());

  const baseA = normalizeMissionWorkQueue({ workerId: "worker-a", windowId: 10 }, { workerId: "worker-a", windowId: 10 });
  const baseB = normalizeMissionWorkQueue({ workerId: "worker-b", windowId: 20 }, { workerId: "worker-b", windowId: 20 });
  const appliedA = applyMissionQueueSet(baseA, saved.set, { workerId: "worker-a", windowId: 10, now: 1000 });
  const appliedB = applyMissionQueueSet(baseB, saved.set, { workerId: "worker-b", windowId: 20, now: 1000 });

  assert.equal(appliedA.items[0].status, "READY");
  assert.equal(appliedA.items[0].processSnapshot, null);
  assert.equal(appliedA.items[0].resume, null);
  assert.equal(appliedA.items[0].delegation, null);
  assert.equal(appliedA.items[0].lastError, null);
  assert.notEqual(appliedA.items[0].itemId, "runtime-item");
  assert.notEqual(appliedA.items[0].itemId, appliedB.items[0].itemId);
});

test("v1.5.1 concurrent named-set writes preserve both sets", async () => {
  const local = storageMock({}, { delayMs: 2 });
  const qa = normalizeMissionWorkQueue({
    workerId: "worker-a",
    windowId: 1,
    items: [{ goal: "A", status: "READY" }]
  }, { workerId: "worker-a", windowId: 1 });
  const qb = normalizeMissionWorkQueue({
    workerId: "worker-b",
    windowId: 2,
    items: [{ goal: "B", status: "READY" }]
  }, { workerId: "worker-b", windowId: 2 });

  await Promise.all([
    saveMissionQueueSet({ name: "Set A", queue: qa }, local, { now: 1000 }),
    saveMissionQueueSet({ name: "Set B", queue: qb }, local, { now: 2000 })
  ]);
  const store = await loadMissionQueueSets(local);
  assert.deepEqual(new Set(store.sets.map((set) => set.name)), new Set(["Set A", "Set B"]));
});

test("v1.5.1 static wiring has no orphan queue adoption and validates sidepanel worker ownership", () => {
  const queueSource = fs.readFileSync(new URL("../lib/mission-work-queue.mjs", import.meta.url), "utf8");
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const sidepanel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");

  assert.doesNotMatch(queueSource, /liveWindowIds|rebindQueueWindow|orphan/i);
  assert.match(background, /withVerifiedWorkerMessage/);
  assert.match(background, /WORKER_BINDING_MISMATCH/);
  assert.match(background, /queueAfterResponseAction/);
  assert.doesNotMatch(background, /queuePauseCanYield/);
  assert.match(sidepanel, /workerId: state\.workerId/);
  assert.match(sidepanel, /eic\.gf\.mission-work-queue\.worker\.\$\{state\.workerId\}/);
  assert.match(html, /Sparade kö-set/);
  assert.match(html, /nytt Chrome-fönster startar med en tom .*kö/i);
});
