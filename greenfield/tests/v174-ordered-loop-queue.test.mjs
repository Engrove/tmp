import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  addMissionWorkItem,
  createQueueContext,
  normalizeMissionWorkQueue,
  queueTurnControl,
  requeueBlockedMissionWorkItem,
  selectNextMissionItem
} from "../lib/mission-work-queue.mjs";
import { applyMissionQueueSet, normalizeMissionQueueSet } from "../lib/mission-queue-sets.mjs";
import { QUEUE_AFTER_RESPONSE, queueAfterResponseAction } from "../lib/queue-control-policy.mjs";
import {
  activatedQueueSlotTelemetry,
  applyQueueParkTransition,
  queuePlanningFields
} from "../lib/queue-planning.mjs";
import { buildA2AEnvelope } from "../lib/a2a.mjs";
import { buildFullProcessStatus } from "../lib/process-status.mjs";
import { parseTargetResponse } from "../lib/response-contract.mjs";

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

test("v1.7.4 same saved GFW can occupy multiple independent queue slots", async () => {
  const storage = storageMock();
  let queue = await addMissionWorkItem(1, "Mission A", {
    storage,
    workerId: "worker-a",
    savedMissionId: "gfw-a",
    label: "A first",
    priority: "HIGH",
    maxInteractions: 10,
    now: 1000
  });
  queue = await addMissionWorkItem(1, "Mission A", {
    storage,
    workerId: "worker-a",
    savedMissionId: "gfw-a",
    label: "A second",
    priority: "NORMAL",
    maxInteractions: 2,
    now: 2000
  });
  assert.equal(queue.items.length, 2);
  assert.notEqual(queue.items[0].itemId, queue.items[1].itemId);
  assert.deepEqual(queue.items.map((item) => item.savedMissionId), ["gfw-a", "gfw-a"]);
  assert.deepEqual(queue.items.map((item) => item.priority), ["HIGH", "NORMAL"]);
  assert.deepEqual(queue.items.map((item) => item.maxInteractions), [10, 2]);
  assert.deepEqual(queue.items.map((item) => item.order), [0, 1]);
});

test("v1.7.4 inner queue is explicit-order cyclic even when slot priorities differ", () => {
  const now = 10_000;
  const queue = normalizeMissionWorkQueue({
    queueId: "q",
    workerId: "w",
    windowId: 1,
    cursorOrder: -1,
    items: [
      { itemId: "a", savedMissionId: "ga", goal: "A", order: 0, priority: "LOW", status: "READY" },
      { itemId: "b", savedMissionId: "gb", goal: "B", order: 1, priority: "URGENT", status: "READY" },
      { itemId: "c", savedMissionId: "gc", goal: "C", order: 2, priority: "HIGH", status: "READY" }
    ]
  }, { workerId: "w", windowId: 1, now });
  assert.equal(selectNextMissionItem(queue, { now }).itemId, "a");
  assert.equal(selectNextMissionItem(queue, { now, afterItemId: "a" }).itemId, "b");
  assert.equal(selectNextMissionItem(queue, { now, afterItemId: "b" }).itemId, "c");
  assert.equal(selectNextMissionItem(queue, { now, afterItemId: "c" }).itemId, "a");
});

test("v1.7.4 unfinished per-slot quantum progress survives a queue reactivation context", () => {
  const queue = normalizeMissionWorkQueue({
    queueId: "q",
    workerId: "w",
    windowId: 1,
    items: [{
      itemId: "a",
      savedMissionId: "ga",
      goal: "A",
      order: 0,
      priority: "HIGH",
      maxInteractions: 10,
      quantumProgress: 8,
      status: "READY"
    }]
  }, { workerId: "w", windowId: 1 });
  const ctx = createQueueContext(queue, queue.items[0]);
  assert.equal(ctx.interactionCount, 8);
  const control = queueTurnControl({ queueContext: ctx });
  assert.equal(control.interactionInQuantum, 9);
  assert.equal(control.maxInteractions, 10);
  assert.equal(control.savedMissionId, "ga");
  assert.equal(control.slotOrder, 0);
});

test("v1.7.4 BLOCKED applies to every duplicate slot of one logical saved GFW", () => {
  const now = 100_000;
  const queue = normalizeMissionWorkQueue({
    queueId: "q",
    workerId: "w",
    windowId: 1,
    enabled: true,
    activeItemId: "a1",
    items: [
      { itemId: "a1", savedMissionId: "ga", goal: "A", order: 0, status: "ACTIVE", maxInteractions: 10 },
      { itemId: "b", savedMissionId: "gb", goal: "B", order: 1, status: "READY", maxInteractions: 3 },
      { itemId: "a2", savedMissionId: "ga", goal: "A", order: 2, status: "READY", maxInteractions: 2 }
    ]
  }, { workerId: "w", windowId: 1, now });
  const blocked = requeueBlockedMissionWorkItem(queue, "a1", {
    processSnapshot: { queueContext: { interactionCount: 8 }, updatedAt: new Date(now).toISOString() },
    resume: { objective: "Resume A" },
    retryAfterSeconds: 180,
    now
  });
  const same = blocked.items.filter((item) => item.savedMissionId === "ga");
  assert.equal(same.length, 2);
  assert.ok(same.every((item) => item.status === "BLOCKED"));
  assert.ok(same.every((item) => item.blockedRetryAtMs === now + 180_000));
  assert.equal(blocked.items.find((item) => item.savedMissionId === "gb").status, "READY");
  assert.equal(blocked.activeItemId, "");
  assert.equal(blocked.cursorOrder, 0);
});

test("v1.7.4 queue sets preserve duplicate saved GFW slots and their independent scheduling parameters", () => {
  const set = normalizeMissionQueueSet({
    name: "Loop",
    items: [
      { savedMissionId: "ga", label: "A high", goal: "A", priority: "HIGH", maxInteractions: 10, order: 0 },
      { savedMissionId: "gb", label: "B", goal: "B", priority: "NORMAL", maxInteractions: 1, order: 1 },
      { savedMissionId: "ga", label: "A short", goal: "A", priority: "LOW", maxInteractions: 2, order: 2 }
    ]
  }, { now: 1000 });
  const base = normalizeMissionWorkQueue({
    workerId: "w",
    windowId: 1,
    cursorOrder: 99
  }, { workerId: "w", windowId: 1, now: 1000 });
  const queue = applyMissionQueueSet(base, set, { workerId: "w", windowId: 1, now: 2000 });
  assert.equal(queue.items.length, 3);
  assert.deepEqual(queue.items.map((item) => item.savedMissionId), ["ga", "gb", "ga"]);
  assert.deepEqual(queue.items.map((item) => item.maxInteractions), [10, 1, 2]);
  assert.deepEqual(queue.items.map((item) => item.priority), ["HIGH", "NORMAL", "LOW"]);
  assert.equal(queue.cursorOrder, -1);
});

test("v1.7.4 PAUSE_PROCESS is worker-nonblocking in queue mode and ordinary outside queue mode", () => {
  assert.equal(queueAfterResponseAction({
    queueManaged: true,
    queueQuantumReached: false,
    sessionAction: "PAUSE_PROCESS"
  }), QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH);
  assert.equal(queueAfterResponseAction({
    queueManaged: false,
    queueQuantumReached: false,
    sessionAction: "PAUSE_PROCESS"
  }), QUEUE_AFTER_RESPONSE.CONTINUE_CURRENT);
});

test("v1.7.4 background runtime carries ordered-loop, quantum-preservation and logical-duplicate terminal invariants", () => {
  const bg = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(bg, /resumedQuantumProgress/);
  assert.match(bg, /quantumReached:\s*queueQuantumReached/);
  assert.match(bg, /queue\.cursorOrder\s*=\s*Number\(item\.order\)/);
  assert.match(bg, /String\(candidate\.savedMissionId/);
  assert.match(bg, /retiredSlotCount/);
  assert.match(bg, /afterOrder:\s*saved\.cursorOrder/);
  assert.match(bg, /processStatusRequest:\s*result\.targetResponse\?\.greenfieldStatusRequest/);
  assert.match(bg, /processStatusMode:\s*item\.resume\?\.processStatusRequest/);
  assert.match(bg, /consumedProcessStatusRequest/);
  assert.match(bg, /const promptCurrent = nextQueueContext/);
});

test("v1.7.4 A2A advertises ordered cyclic slots, duplicate logical continuity and queue-local pause semantics", () => {
  const a2a = fs.readFileSync(new URL("../lib/a2a.mjs", import.meta.url), "utf8");
  assert.match(a2a, /ORDERED_CYCLIC_SLOTS/);
  assert.match(a2a, /same saved GFW may exist in multiple queue slots/i);
  assert.match(a2a, /preserves the slot's unfinished quantum progress/i);
  assert.match(a2a, /PAUSE_PROCESS uses the same non-blocking queue-local behavior/i);
  assert.match(a2a, /priority does not change the explicit ordering of slots/i);
});


test("v1.7.4 queue prompt exposes quantum planning and approximate timing to EIC", () => {
  const ctx = {
    schema: "eic.greenfield.queue-context.v1",
    queueId: "q",
    workerId: "w",
    itemId: "a",
    savedMissionId: "gfw-a",
    slotOrder: 0,
    priority: "HIGH",
    interactionCount: 0,
    maxInteractions: 1,
    activationCount: 3,
    responseRoundTripApproxMs: 12345,
    loopRoundTripApproxMs: 67890
  };
  const planning = queuePlanningFields(ctx);
  assert.equal(planning.operatorDisplay, "Hög · 1 interaktioner/kvant · 0/1 slutförda i kvanten");
  assert.equal(planning.interactionInQuantum, 1);
  assert.equal(planning.remainingInteractionsIncludingCurrent, 1);
  assert.equal(planning.responseRoundTripApproxMs, 12345);
  assert.equal(planning.loopRoundTripApproxMs, 67890);

  const envelope = buildA2AEnvelope({
    process: {
      processId: "p",
      runId: "r",
      generation: 1,
      turn: 1,
      sessionSeq: 1,
      goal: "Mission",
      queueContext: ctx,
      sessionHealth: null
    },
    objective: "Do bounded work.",
    messageType: "CONTINUATION",
    at: 1000
  });
  assert.equal(envelope.control.workQueue.operatorDisplay, planning.operatorDisplay);
  assert.match(envelope.control.workQueue.planningHint, /interaction 1 of 1/i);
  assert.equal(envelope.control.workQueue.responseRoundTripApproxMs, 12345);
  assert.equal(envelope.control.workQueue.loopRoundTripApproxMs, 67890);
});

test("v1.7.4 activation telemetry measures a queue-slot loop roundtrip", () => {
  assert.deepEqual(
    activatedQueueSlotTelemetry({ activationCount: 0, lastLeftAtMs: 0 }, 10_000),
    { activationCount: 1, lastLoopRoundTripMs: null }
  );
  assert.deepEqual(
    activatedQueueSlotTelemetry({ activationCount: 2, lastLeftAtMs: 10_000 }, 70_000),
    { activationCount: 3, lastLoopRoundTripMs: 60_000 }
  );
});

test("v1.7.4 CONTINUE plus BACKGROUND_SLEEP on final quantum parks instead of terminalizing", () => {
  const now = 100_000;
  const queue = normalizeMissionWorkQueue({
    queueId: "q",
    workerId: "w",
    windowId: 1,
    enabled: true,
    activeItemId: "gf045",
    items: [
      {
        itemId: "gf045",
        savedMissionId: "GF-045",
        goal: "Supervise",
        order: 0,
        priority: "HIGH",
        maxInteractions: 1,
        quantumProgress: 0,
        status: "ACTIVE"
      },
      {
        itemId: "gf007",
        savedMissionId: "GF-007",
        goal: "Backend",
        order: 1,
        priority: "HIGH",
        maxInteractions: 10,
        status: "READY"
      }
    ],
    history: []
  }, { workerId: "w", windowId: 1, now });

  assert.equal(queueAfterResponseAction({
    queueManaged: true,
    queueQuantumReached: true,
    sessionAction: "BACKGROUND_SLEEP"
  }), QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH);

  queue.items = applyQueueParkTransition(queue.items, queue.items[0], {
    pauseUntilMs: now + 1_800_000,
    resumedQuantumProgress: 0,
    parkedSnapshot: { processId: "p045", runId: "r045" },
    resume: { objective: "Resume GF-045", processStatusRequest: "" },
    outcome: "EIC_BACKGROUND_SLEEP",
    summary: "CYCLE155 checkpointed",
    now,
    responseRoundTripMs: 42_000
  });
  queue.activeItemId = "";
  queue.cursorOrder = 0;

  const gf045 = queue.items.find((item) => item.itemId === "gf045");
  assert.equal(gf045.status, "PAUSED");
  assert.equal(gf045.quantumProgress, 0);
  assert.equal(gf045.lastSelfRoundTripMs, 42_000);
  assert.equal(queue.history.length, 0);
  assert.equal(selectNextMissionItem(queue, { now, afterOrder: 0 })?.itemId, "gf007");
});

test("v1.7.4 EIC can request one full Greenfield process status capsule", () => {
  const response = JSON.stringify({
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    greenfieldStatusRequest: "FULL_NEXT_PROMPT",
    summary: "Need process context.",
    workPerformed: [],
    evidence: [],
    blockers: [],
    nextSuggestedAction: "Continue after status."
  });
  const parsed = parseTargetResponse(response);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.greenfieldStatusRequest, "FULL_NEXT_PROMPT");

  const status = buildFullProcessStatus({
    processId: "p",
    runId: "r",
    workerId: "w",
    generation: 2,
    turn: 13,
    sessionSeq: 3,
    windowId: 4,
    tabId: 5,
    phase: "ANALYZING",
    schedulerPriority: "HIGH",
    goal: "secret mission text must not be copied",
    queueContext: {
      schema: "eic.greenfield.queue-context.v1",
      queueId: "q",
      workerId: "w",
      itemId: "i",
      savedMissionId: "GF-007",
      slotOrder: 1,
      priority: "HIGH",
      interactionCount: 4,
      maxInteractions: 10,
      activationCount: 2,
      responseRoundTripApproxMs: 20_000,
      loopRoundTripApproxMs: 500_000
    },
    sessionHealth: {
      schema: "eic.greenfield.session-health.v1",
      sessionSeq: 3,
      sessionStartTurn: 13,
      promptsPosted: 1,
      managedPromptChars: 100,
      capturedResponseChars: 200,
      recoveryChurn: 0,
      activeTurn: null,
      samples: [{ turn: 12, ttfrMs: 1000, completionMs: 9000, totalMs: 10_000, responseChars: 200, clean: true }]
    },
    pendingPrompt: { text: "DO NOT LEAK", hash: "ph", createdAt: "2026-09-10T10:00:00Z", sendAttempts: 0 },
    lastResponse: { text: "DO NOT LEAK RESPONSE", hash: "rh", contract: { found: true, ok: true, status: "CONTINUE", value: { sessionAction: "KEEP" } } },
    recovery: { attempts: 0 }
  }, { at: 100_000 });
  assert.equal(status.schema, "eic.greenfield.process-status.v1");
  assert.equal(status.mode, "FULL_NEXT_PROMPT");
  assert.equal(status.queue.interactionInQuantum, 5);
  assert.equal(status.queue.maxInteractions, 10);
  assert.equal(status.sessionHealth.responseRoundTripMs, 10_000);
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /DO NOT LEAK/);
  assert.match(status.privacyBoundary, /Prompt\/response bodies/);
});

test("v1.7.4 A2A can carry one-shot processStatus alongside standard prompt information", () => {
  const processStatus = { schema: "eic.greenfield.process-status.v1", mode: "FULL_NEXT_PROMPT" };
  const envelope = buildA2AEnvelope({
    process: {
      processId: "p",
      runId: "r",
      generation: 1,
      turn: 2,
      sessionSeq: 1,
      goal: "Mission",
      sessionHealth: null
    },
    objective: "Continue.",
    messageType: "CONTINUATION",
    processStatus,
    at: 1000
  });
  assert.deepEqual(envelope.processStatus, processStatus);
  assert.equal(envelope.responseContract.processStatusControl.request, "FULL_NEXT_PROMPT");
  assert.equal(envelope.responseContract.jsonSchema.properties.greenfieldStatusRequest.enum[0], "FULL_NEXT_PROMPT");
});
