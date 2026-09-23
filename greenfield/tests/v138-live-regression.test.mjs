import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildLiveManagedSurfaceIndex,
  managedSurfaceIsLive
} from "../lib/managed-surface-liveness.mjs";
import {
  reconcileGlobalCapacityScheduler,
  requestGlobalTurnSlot
} from "../lib/global-capacity-scheduler.mjs";
import { parseTargetResponse } from "../lib/response-contract.mjs";

function mockStorage() {
  const data = {};
  return {
    async get(key) {
      if (typeof key === "string") return { [key]: structuredClone(data[key]) };
      return {};
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    }
  };
}

test("v1.3.8 live managed-surface index rejects closed window/tab ghosts while retaining two real sessions", () => {
  const index = buildLiveManagedSurfaceIndex([
    { id: 101, tabs: [{ id: 1001, url: "https://chatgpt.com/g/g-abc" }] },
    { id: 102, tabs: [{ id: 1002, url: "https://chatgpt.com/g/g-abc/c/def" }] }
  ], {
    isSupportedUrl: (url) => /^https:\/\/chatgpt\.com\//.test(url)
  });

  const processes = [
    { processId: "live-1", windowId: 101, tabId: 1001 },
    { processId: "live-2", windowId: 102, tabId: 1002 },
    { processId: "ghost-window", windowId: 103, tabId: 1003 },
    { processId: "ghost-tab", windowId: 101, tabId: 9999 }
  ];
  assert.deepEqual(
    processes.filter((process) => managedSurfaceIsLive(process, index)).map((p) => p.processId),
    ["live-1", "live-2"]
  );
});

test("v1.3.8 ghost scheduler slots reconcile from 4 active records down to two live managed surfaces", async () => {
  const storage = mockStorage();
  const now = 12_000_000;
  for (let i = 1; i <= 4; i += 1) {
    const admitted = await requestGlobalTurnSlot({
      processId: `p${i}`,
      windowId: 200 + i,
      promptHash: `h${i}`,
      capacity: 4,
      configuredCapacity: 4,
      now: now + i,
      storage
    });
    assert.equal(admitted.allowed, true);
  }

  const liveIndex = buildLiveManagedSurfaceIndex([
    { id: 201, tabs: [{ id: 3001, url: "https://chatgpt.com/g/g-abc" }] },
    { id: 202, tabs: [{ id: 3002, url: "https://chatgpt.com/g/g-abc" }] }
  ]);
  const persistedProcesses = [
    { processId: "p1", windowId: 201, tabId: 3001, promptHash: "h1" },
    { processId: "p2", windowId: 202, tabId: 3002, promptHash: "h2" },
    { processId: "p3", windowId: 203, tabId: 3003, promptHash: "h3" },
    { processId: "p4", windowId: 204, tabId: 3004, promptHash: "h4" }
  ];
  const activeTurns = persistedProcesses
    .filter((process) => managedSurfaceIsLive(process, liveIndex))
    .map((process) => ({
      processId: process.processId,
      windowId: process.windowId,
      promptHash: process.promptHash,
      priority: "NORMAL",
      acquiredAtMs: now
    }));

  const reconciled = await reconcileGlobalCapacityScheduler({
    activeTurns,
    eligibleWaiters: [],
    capacity: 4,
    configuredCapacity: 4,
    now: now + 100,
    storage
  });
  assert.equal(reconciled.scheduler.activeCount, 2);
  assert.deepEqual(
    reconciled.scheduler.activeTurns.map((item) => item.processId),
    ["p1", "p2"]
  );
});

test("v1.3.8 full PAUSE_PROCESS response remains parseable after the lifecycle-fragment guard", () => {
  const source = JSON.stringify({
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    sessionAction: "PAUSE_PROCESS",
    sessionReason: "GF cycle is owner-closed; next checkpoint in 300 s.",
    pauseSeconds: 300,
    summary: "cycle closed",
    workPerformed: ["owner readback complete"],
    evidence: ["receipt"],
    blockers: [],
    nextSuggestedAction: "After 300 s, refresh owner state."
  }) + "\nStatus: CONTINUE — cycle closed\nTime: 2026-09-05T11:41:07.691280Z";
  const parsed = parseTargetResponse(source);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.sessionAction, "PAUSE_PROCESS");
  assert.equal(parsed.value.pauseSeconds, 300);
});

test("v1.3.8 runtime wiring prunes stale surfaces and releases scheduler ownership on tab/window close", () => {
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");

  assert.match(background, /chrome\.windows\.getAll\(\{ populate: true \}\)/);
  assert.match(background, /managedSurfaceIsLive\(process,\s*liveSurfaceProbe\.index\)/);
  assert.match(background, /GLOBAL_CAPACITY_STALE_SURFACE_PRUNED/);
  assert.match(background, /cancelSchedulerProcess\(current,\s*"MANAGED_TAB_CLOSED"\)/);
  assert.match(background, /cancelSchedulerProcess\(current,\s*"MANAGED_WINDOW_CLOSED"\)/);
  assert.match(background, /WORKER_DETACHED_QUEUE_QUARANTINED_NO_IMPLICIT_REBIND/);
  assert.match(background, /releaseWorkerBinding\(windowId, chrome\.storage\.session\)/);

  assert.match(content, /function assistantLifecycleStatusText/);
  assert.match(content, /function stripAssistantPresentationChrome/);
  assert.match(content, /semanticMessageText\(entry,\s*rendered\)/);
  assert.match(content, /Arbetade\|Worked/);
});
