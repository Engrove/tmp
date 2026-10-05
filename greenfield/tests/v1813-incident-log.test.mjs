// v1.8.13 durable incident log and diagnostics. Diagnostics 2026-10-05 could
// not show why 30 turns never got an answer, why all windows stood still for
// 2-12 hours or which automatic rotations happened, because the audit log is
// volatile by default and the safety events keep about 15 hours.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { harness, memory } from "./helpers/background-harness.mjs";
import { loadProcessForWindow } from "../lib/process-store.mjs";
import {
  appendIncident,
  INCIDENT_LOG_KEY,
  INCIDENT_LOG_MAX_ROWS,
  makeIncidentRow,
  readIncidentLog
} from "../lib/incident-log.mjs";
import { safetyPolicyChanges, updateSafetyPolicy, readSafety } from "../lib/usage-governor.mjs";
import { createStartupDiagnostics } from "../lib/startup-diagnostics.mjs";
import { GLOBAL_CAPACITY_SCHEDULER_KEY } from "../lib/global-capacity-scheduler.mjs";
import { staleTurnSlotNote } from "../lib/operations-view.mjs";

const MIN = 60_000;

function clock() {
  const RealDate = globalThis.Date;
  let now = RealDate.now();
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  return { set(value) { now = value; }, restore() { globalThis.Date = RealDate; } };
}

test("v1.8.13 incident rows keep ids, codes, numbers and flags only", () => {
  const row = makeIncidentRow({
    kind: "STALE_LADDER_STEP", code: "STALE_SESSION_30M_F5", processId: "process-1", turn: "7", promptHash: "0123456789abcdef0123",
    detail: { generating: false, waitMin: 31, nested: { text: "secret" }, list: [1, 2], text: "x".repeat(500), fn() {} }
  });
  assert.equal(row.turn, 7);
  assert.equal(row.promptHash, "0123456789abcdef");
  assert.deepEqual(Object.keys(row.detail).sort(), ["generating", "text", "waitMin"]);
  assert.equal(row.detail.text.length, 120);
});

test("v1.8.13 incident log is a bounded ring and counts what it dropped", async () => {
  const storage = memory();
  for (let i = 0; i < INCIDENT_LOG_MAX_ROWS + 5; i += 1) {
    await appendIncident({ atMs: 1000 + i, kind: "K", code: String(i) }, storage);
  }
  const log = await readIncidentLog(storage);
  assert.equal(log.rows.length, INCIDENT_LOG_MAX_ROWS);
  assert.equal(log.droppedRows, 5);
  assert.equal(log.rows[0].code, "5");
});

test("v1.8.13 concurrent appends do not lose rows", async () => {
  const storage = memory();
  await Promise.all(Array.from({ length: 30 }, (_, i) => appendIncident({ kind: "K", code: String(i) }, storage)));
  assert.equal((await readIncidentLog(storage)).rows.length, 30);
});

test("v1.8.13 E2E: a dead turn leaves its whole story in the log, without prompt text", async () => {
  const t = clock();
  try {
    const h = await harness();
    h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
    await h.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt testprojekt - Gf: GF-900." });
    let p = await loadProcessForWindow(1);
    p = await h.mod.tickSending(p);
    p = await h.mod.tickSending(p);
    assert.equal(p.phase, "WAITING");
    Object.assign(h.page, { generating: false, signals: { stopVisible: false, streaming: false, composerBusy: false },
      pageHealth: { readyState: "complete", visibilityState: "hidden", composerPresent: true, conversationUrl: true, turnCount: 1 } });
    h.chrome.tabs.reload = async () => {};
    const sentAt = Date.parse(p.lastPrompt.sentAt);
    for (const minutes of [31, 32.5, 61, 91, 121]) {
      t.set(sentAt + minutes * MIN);
      p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    }
    assert.equal(p.phase, "ROTATING");
    const log = await readIncidentLog(h.chrome.storage.local);
    const story = log.rows.map((row) => `${row.kind}:${row.code}`);
    assert.deepEqual(story, [
      "STALE_LADDER_STEP:STALE_SESSION_30M_F5",
      "STALE_TURN_SLOT_RELEASED:STALE_TURN_NO_GENERATION_AFTER_RELOAD",
      "STALE_LADDER_STEP:STALE_SESSION_60M_CTRL_F5",
      "STALE_LADDER_STEP:STALE_SESSION_90M_CTRL_F5",
      "STALE_LADDER_STEP:STALE_SESSION_120M_ROTATE",
      "SESSION_ROTATION_ARMED:STALE_SESSION_120M_EXHAUSTED"
    ]);
    const f5 = log.rows[0];
    assert.equal(f5.processId, p.processId);
    assert.equal(f5.detail.generating, false);
    assert.equal(f5.detail.stopVisible, false);
    assert.equal(f5.detail.readyState, "complete");
    assert.equal(f5.detail.assistantFound, false);
    assert.equal(f5.detail.waitMin, 31);
    assert.equal(log.rows[4].detail.slotReleased, true);
    assert.equal(log.rows[5].detail.requestedBy, "STALE_RECOVERY");
    const raw = JSON.stringify(log);
    assert.equal(raw.includes(p.lastPrompt.text.slice(20, 80)), false, "no prompt text");
    assert.equal(raw.includes("Syntetiskt testprojekt"), false, "no mission text");
  } finally { t.restore(); }
});

test("v1.8.13 E2E: a budget hold is logged when it starts; pacing waits are not", async () => {
  const h = await harness();
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt testprojekt - Gf: GF-900." });
  let p = await loadProcessForWindow(1);
  p = await h.mod.holdForSafety(p, { code: "LOCAL_PACING_WAIT", retryAtMs: Date.now() + 60_000 });
  p = await h.mod.holdForSafety(p, { code: "LOCAL_TOKENS24H_BUDGET", retryAtMs: Date.now() + 7_200_000 });
  p = await h.mod.holdForSafety(p, { code: "LOCAL_TOKENS24H_BUDGET", retryAtMs: Date.now() + 7_200_000 });
  const rows = (await readIncidentLog(h.chrome.storage.local)).rows.filter((row) => row.kind === "SAFETY_HOLD_STARTED");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, "LOCAL_TOKENS24H_BUDGET");
  assert.equal(rows[0].detail.priorCode, "LOCAL_PACING_WAIT");
  assert.ok(rows[0].detail.retryAtMs > Date.now());
});

test("v1.8.13 a policy update says what changed", async () => {
  assert.deepEqual(safetyPolicyChanges({ messages7d: 400, tokens24h: 2600000, messages3h: 36 }, { messages7d: 1000, tokens24h: 3200000, messages3h: 36 }),
    ["messages7d 400→1000", "tokens24h 2600000→3200000"]);
  const storage = memory();
  await readSafety(storage);
  await updateSafetyPolicy({ messages7d: 1000 }, storage);
  const v = await readSafety(storage);
  const event = v.events.at(-1);
  assert.equal(event.code, "SAFETY_POLICY_UPDATED");
  assert.match(event.detail, /^messages7d \d+→1000$/);
});

test("v1.8.13 diagnostics export carries the incident log, the capacity scheduler and an index", async () => {
  const storage = memory({
    [GLOBAL_CAPACITY_SCHEDULER_KEY]: { activeTurns: [], waiters: [] },
    "eic.gf.unrelated.secret": { token: "do-not-export" }
  });
  await appendIncident({ kind: "STALE_LADDER_STEP", code: "STALE_SESSION_30M_F5" }, storage);
  await appendIncident({ kind: "STALE_LADDER_STEP", code: "STALE_SESSION_120M_ROTATE" }, storage);
  await appendIncident({ kind: "SESSION_ROTATION_ARMED", code: "STALE_SESSION_120M_EXHAUSTED" }, storage);
  const d = await createStartupDiagnostics(storage, { version: "test" });
  assert.ok(d.storage[INCIDENT_LOG_KEY]);
  assert.ok(d.storage[GLOBAL_CAPACITY_SCHEDULER_KEY]);
  assert.equal(d.storage["eic.gf.unrelated.secret"], undefined);
  assert.equal(d.incidents.rows, 3);
  assert.equal(d.incidents.byKind.STALE_LADDER_STEP.count, 2);
  assert.equal(d.incidents.byKind.SESSION_ROTATION_ARMED.codes.STALE_SESSION_120M_EXHAUSTED, 1);
});

test("v1.8.13 restart report rows carry their own time", () => {
  const source = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function hydrateProcesses"), source.indexOf("async function hydrateBoundProcesses"));
  assert.match(body, /report\.restored=stamp\(report\.restored\)/);
  assert.match(body, /report\.unresolved=stamp\(report\.unresolved\)/);
  assert.match(body, /"RESTART_RESTORED"/);
});

test("v1.8.13 worker card note for a turn that gave its slot back", () => {
  const p = { phase: "WAITING", lastPrompt: { hash: "h1" }, waitingRefresh: { capacityReleased: { promptHash: "h1", turn: 3, atMs: 0 } } };
  assert.match(staleTurnSlotNote(p), /^Platsen lämnad tillbaka: ingen generering efter omladdningen\. Svaret läses ändå om det kommer\.$/);
  assert.match(staleTurnSlotNote({ ...p, waitingRefresh: { capacityReleased: { promptHash: "h1", atMs: 1 } } }, () => "08:15"), /^Platsen lämnad tillbaka 08:15:/);
  assert.equal(staleTurnSlotNote({ ...p, phase: "ANALYZING" }), "");
  assert.equal(staleTurnSlotNote({ ...p, lastPrompt: { hash: "h2" } }), "", "a new prompt clears the note");
});

test("v1.8.13 E2E queue: a dead turn's 120 min switch is logged as park + activation of the next slot", async () => {
  const { addMissionWorkItem } = await import("../lib/mission-work-queue.mjs");
  const { ensureWorkerBinding } = await import("../lib/worker-identity.mjs");
  const t = clock();
  try {
    const h = await harness({ extraExports: ["startMissionQueue", "tickRotating"] });
    h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
    const worker = await ensureWorkerBinding(1);
    for (const gf of ["GF-901", "GF-902"]) {
      await addMissionWorkItem(1, `Projekt: 900 - Syntetiskt testprojekt - Gf: ${gf}.`, { storage: h.chrome.storage.local, workerId: worker.workerId });
    }
    await h.mod.startMissionQueue({ windowId: 1 });
    let p = await loadProcessForWindow(1);
    for (let i = 0; i < 20 && p.phase !== "WAITING"; i += 1) {
      const tick = p.phase === "ROTATING" ? h.mod.tickRotating : h.mod.tickSending;
      await tick(p);
      t.set(Date.now() + 5000);
      p = await loadProcessForWindow(1);
    }
    assert.equal(p.phase, "WAITING", `reached ${p.phase}`);
    const first = p;
    Object.assign(h.page, { generating: false, signals: { stopVisible: false, streaming: false, composerBusy: false },
      pageHealth: { readyState: "complete", visibilityState: "hidden", composerPresent: true, conversationUrl: true, turnCount: 1 } });
    h.chrome.tabs.reload = async () => {};
    const sentAt = Date.parse(p.lastPrompt.sentAt);
    for (const minutes of [31, 32.5, 61, 91, 121]) {
      t.set(sentAt + minutes * MIN);
      p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    }
    assert.notEqual(p.processId, first.processId, "the queue moved on to the next slot");
    const rows = (await readIncidentLog(h.chrome.storage.local)).rows;
    const park = rows.find((row) => row.kind === "QUEUE_SLOT_PARKED");
    assert.equal(park.code, "STALE_SESSION_120M_QUEUE_ROTATION");
    assert.equal(park.processId, first.processId);
    assert.ok(park.detail.nextItemId);
    const activations = rows.filter((row) => row.kind === "QUEUE_ITEM_ACTIVATED");
    assert.equal(activations.length, 2, "first start and the switch");
    assert.equal(activations[1].processId, p.processId);
    assert.equal(activations[1].detail.itemId, park.detail.nextItemId);
    assert.ok(rows.some((row) => row.kind === "STALE_TURN_SLOT_RELEASED" && row.processId === first.processId));
  } finally { t.restore(); }
});
