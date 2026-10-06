// v1.9.0 Arbetsläge: checked and active at startup, and a live worker polls.
// Operator request 2026-10-06: "Aktivera Arbetsläge ska vara ikryssat och
// aktivt vid uppstart." Real background.js in the Chrome harness; fetch is a
// local stub (no network); synthetic ids only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow } from "../lib/process-store.mjs";
import { OPERATOR_SETTINGS_KEY, normalizeOperatorSettings } from "../lib/operator-settings.mjs";
import { readIncidentLog } from "../lib/incident-log.mjs";
import { workModeStartupPatch, workModeSupervisorDecision } from "../lib/work-mode-supervisor.mjs";

const STALE_WORKER = "worker-00000000-0000-4000-8000-0000000000f1";
const RESERVED_WORKER = "worker-00000000-0000-4000-8000-0000000000f2";

function stubFetch() {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    return new Response(null, { status: 204 });
  };
  return { calls, restore() { globalThis.fetch = real; } };
}

async function storedSettings(h) {
  return (await h.chrome.storage.local.get(OPERATOR_SETTINGS_KEY))[OPERATOR_SETTINGS_KEY] || null;
}

test("v1.9.0 work mode: startup patch and supervisor decision", () => {
  assert.deepEqual(workModeStartupPatch({}), { workModeEnabled: true });
  assert.deepEqual(workModeStartupPatch({ workModeEnabled: false }), { workModeEnabled: true });
  assert.equal(workModeStartupPatch({ workModeEnabled: true }), null);

  const on = { workModeEnabled: true };
  assert.equal(workModeSupervisorDecision({ settings: { workModeEnabled: false }, workerId: "w1" }).action, "DISABLED");
  assert.equal(workModeSupervisorDecision({ settings: { ...on, workModeSupervisorWorkerId: "w1" }, workerId: "w1" }).action, "POLL");
  // a live supervisor keeps the role
  assert.deepEqual(
    workModeSupervisorDecision({ settings: { ...on, workModeSupervisorWorkerId: "w2" }, workerId: "w1", liveWorkerIds: ["w2"] }),
    { action: "SKIP", code: "NOT_SUPERVISOR" });
  // a supervisor that is gone is replaced
  assert.deepEqual(
    workModeSupervisorDecision({ settings: { ...on, workModeSupervisorWorkerId: "w2" }, workerId: "w1", liveWorkerIds: [] }),
    { action: "CLAIM", code: "SUPERVISOR_NOT_LIVE", previousWorkerId: "w2" });
  // no supervisor: the first ticking worker claims, unless the reserved worker is live
  assert.equal(workModeSupervisorDecision({ settings: on, workerId: "w1" }).code, "NO_SUPERVISOR");
  assert.deepEqual(
    workModeSupervisorDecision({ settings: { ...on, reservedWorkerId: "w3" }, workerId: "w1", liveWorkerIds: ["w3"] }),
    { action: "SKIP", code: "WAIT_FOR_RESERVED_WORKER" });
  assert.equal(workModeSupervisorDecision({ settings: { ...on, reservedWorkerId: "w3" }, workerId: "w3" }).action, "CLAIM");
  assert.equal(workModeSupervisorDecision({ settings: { ...on, reservedWorkerId: "w3" }, workerId: "w1", liveWorkerIds: [] }).action, "CLAIM");
});

test("v1.9.0 work mode: a Chrome start turns Arbetsläge on (stored, read back, logged)", async () => {
  const h = await harness({
    seed: { [OPERATOR_SETTINGS_KEY]: normalizeOperatorSettings({ workModeEnabled: false }) },
    extraExports: ["enableWorkModeAtStartup"]
  });
  assert.equal((await storedSettings(h)).workModeEnabled, false);
  const result = await h.mod.enableWorkModeAtStartup("startup");
  assert.equal(result.ok, true);
  assert.equal(result.state, "ENABLED");
  assert.equal((await storedSettings(h)).workModeEnabled, true);
  const log = await readIncidentLog(h.chrome.storage.local);
  const row = log.rows.find((item) => item.kind === "WORK_MODE_ENABLED_AT_STARTUP");
  assert.ok(row, "incident row written");
  assert.equal(row.code, "startup");
  // already on: no second write
  assert.equal((await h.mod.enableWorkModeAtStartup("installed")).state, "ALREADY_ENABLED");
});

test("v1.9.0 work mode: a new profile without settings gets Arbetsläge on at install", async () => {
  const h = await harness({ extraExports: ["enableWorkModeAtStartup"] });
  assert.equal(await storedSettings(h), null);
  assert.equal((await h.mod.enableWorkModeAtStartup("installed")).state, "ENABLED");
  const stored = await storedSettings(h);
  assert.equal(stored.workModeEnabled, true);
  // the rest of the settings are the normal defaults
  assert.equal(stored.warmQueueResume, true);
  assert.equal(stored.workModeEndpoint, normalizeOperatorSettings({}).workModeEndpoint);
});

test("v1.9.0 work mode: a supervisor that no longer exists does not keep Arbetsläge idle", async () => {
  const net = stubFetch();
  try {
    const h = await harness({
      seed: { [OPERATOR_SETTINGS_KEY]: normalizeOperatorSettings({ workModeEnabled: true, workModeSupervisorWorkerId: STALE_WORKER }) },
      extraExports: ["syncWorkModeForWorker"]
    });
    await h.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt testprojekt - Gf: GF-901." });
    const process = await loadProcessForWindow(1, h.chrome.storage.local);
    assert.ok(process?.workerId && process.workerId !== STALE_WORKER);
    net.calls.length = 0;
    const result = await h.mod.syncWorkModeForWorker(process, { force: true });
    assert.notEqual(result.state, "NOT_SUPERVISOR");
    assert.equal(result.ok, true);
    const polls = net.calls.filter((call) => call.url.includes("/tasks/next"));
    assert.equal(polls.length, 1, "the live worker polled the endpoint");
    assert.ok(polls[0].url.includes(encodeURIComponent(process.workerId)));
    assert.equal((await storedSettings(h)).workModeSupervisorWorkerId, process.workerId, "role taken over and stored");
  } finally {
    net.restore();
  }
});

test("v1.9.0 work mode: with no supervisor the first ticking worker claims the role; a reserved worker that is not running does not block it", async () => {
  const net = stubFetch();
  try {
    const h = await harness({
      seed: { [OPERATOR_SETTINGS_KEY]: normalizeOperatorSettings({ workModeEnabled: true }) },
      extraExports: ["syncWorkModeForWorker"]
    });
    await h.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt testprojekt - Gf: GF-902." });
    const process = await loadProcessForWindow(1, h.chrome.storage.local);
    await h.mod.syncWorkModeForWorker(process, { force: true });
    assert.equal((await storedSettings(h)).workModeSupervisorWorkerId, process.workerId);
    assert.equal(net.calls.filter((call) => call.url.includes("/tasks/next")).length, 1);

    // A reserved worker that is not running does not block the claim.
    const h2 = await harness({
      seed: { [OPERATOR_SETTINGS_KEY]: normalizeOperatorSettings({ workModeEnabled: true, reservedWorkerId: RESERVED_WORKER }) },
      extraExports: ["syncWorkModeForWorker"]
    });
    await h2.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt testprojekt - Gf: GF-903." });
    const p2 = await loadProcessForWindow(1, h2.chrome.storage.local);
    const r2 = await h2.mod.syncWorkModeForWorker(p2, { force: true });
    assert.notEqual(r2.state, "WAIT_FOR_RESERVED_WORKER");
    assert.equal((await storedSettings(h2)).workModeSupervisorWorkerId, p2.workerId);
  } finally {
    net.restore();
  }
});

test("v1.9.0 work mode: switched off, nothing polls and a service-worker wake does not turn it on", async () => {
  const net = stubFetch();
  try {
    const h = await harness({
      seed: { [OPERATOR_SETTINGS_KEY]: normalizeOperatorSettings({ workModeEnabled: false }) },
      extraExports: ["syncWorkModeForWorker"]
    });
    await h.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt testprojekt - Gf: GF-904." });
    const process = await loadProcessForWindow(1, h.chrome.storage.local);
    const result = await h.mod.syncWorkModeForWorker(process, { force: true });
    assert.equal(result.state, "DISABLED");
    assert.equal(net.calls.length, 0);
    // the harness evaluated background.js (hydrateProcesses("service-worker-evaluation")) and started a run
    assert.equal((await storedSettings(h)).workModeEnabled, false);
  } finally {
    net.restore();
  }
});

test("v1.9.0 work mode: only runtime.onStartup and runtime.onInstalled turn it on", () => {
  const source = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const listener = (name) => {
    const start = source.indexOf(`chrome.runtime.${name}.addListener(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf("\n});", start));
  };
  assert.match(listener("onStartup"), /enableWorkModeAtStartup\("startup"\)/);
  assert.match(listener("onInstalled"), /enableWorkModeAtStartup\("installed"\)/);
  assert.equal(source.match(/enableWorkModeAtStartup\(/g).length, 3, "definition + two start hooks");
  const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(panel, /workModeEnabled: true,/, "panel shows Arbetsläge checked before the stored settings load");
});
