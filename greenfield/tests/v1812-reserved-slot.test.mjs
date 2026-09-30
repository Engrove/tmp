import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  GLOBAL_CAPACITY_SCHEDULER_KEY,
  PRIORITY_AGING_STEP_MS,
  readGlobalCapacityScheduler,
  reconcileGlobalCapacityScheduler,
  releaseGlobalTurnSlot,
  requestGlobalTurnSlot
} from "../lib/global-capacity-scheduler.mjs";
import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow } from "../lib/process-store.mjs";
import { reservedSlotConfirmText, reservedSlotMessage, reservedSlotView } from "../lib/operations-view.mjs";

// Operator request 2026-09-30: "Det bör gå att prioritera ett Greenfield
// Chrome fönster/session så att den instansen alltid körs med förtur i kö om
// Max parallella Greenfield >1. Detta ska alltid låsa en av platserna
// exklusivt för detta fönster." Prioritized GFWs run 24/7 in that window; the
// other windows share the remaining slots. Synthetic ids.
const R = "worker-reserved";
const A = "worker-a";
const B = "worker-b";

function mockStorage() {
  const data = {};
  return {
    data,
    async get(key) {
      if (key == null) return structuredClone(data);
      if (typeof key === "string") return data[key] === undefined ? {} : { [key]: structuredClone(data[key]) };
      return {};
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(key) { delete data[key]; }
  };
}

const ask = (storage, { id, worker, priority = "NORMAL", now, capacity = 2, reserved = "" }) => requestGlobalTurnSlot({
  processId: `process-${id}`, windowId: 1, workerId: worker, promptHash: `hash-${id}`, priority,
  capacity, configuredCapacity: Math.max(capacity, 2), reservedWorkerId: reserved, now, storage
});

test("v1.8.12 repro: without a reservation two other windows can hold both slots and the 24/7 window waits, even as URGENT", async () => {
  const storage = mockStorage();
  const now = 5_000_000;
  assert.equal((await ask(storage, { id: "a", worker: A, priority: "LOW", now })).allowed, true);
  assert.equal((await ask(storage, { id: "b", worker: B, priority: "LOW", now: now + 1 })).allowed, true);
  const urgent = await ask(storage, { id: "r", worker: R, priority: "URGENT", now: now + 2 });
  assert.equal(urgent.allowed, false);
  assert.equal(urgent.reason, "GLOBAL_CAPACITY_WAIT");
  // Non-preemptive aging: an older LOW waiter reaches URGENT and goes first.
  const storage2 = mockStorage();
  await ask(storage2, { id: "a", worker: A, now });
  await ask(storage2, { id: "b", worker: B, now });
  await ask(storage2, { id: "c", worker: A, priority: "LOW", now });
  const later = now + 3 * PRIORITY_AGING_STEP_MS;
  await ask(storage2, { id: "r", worker: R, priority: "URGENT", now: later });
  await releaseGlobalTurnSlot({ processId: "process-a", capacity: 2, storage: storage2, now: later });
  const view = await readGlobalCapacityScheduler(storage2, { capacity: 2, now: later });
  assert.deepEqual(view.runnableProcessIds, ["process-c"], "the aged LOW waiter wins the freed slot");
});

test("v1.8.12: with a reservation the reserved window always finds its slot; the others share capacity - 1", async () => {
  const storage = mockStorage();
  const now = 6_000_000;
  const a = await ask(storage, { id: "a", worker: A, now, reserved: R });
  assert.equal(a.allowed, true);
  const b = await ask(storage, { id: "b", worker: B, priority: "URGENT", now: now + 1, reserved: R });
  assert.equal(b.allowed, false, "the second slot is the reserved one");
  const r = await ask(storage, { id: "r", worker: R, priority: "LOW", now: now + 2, reserved: R });
  assert.equal(r.allowed, true);
  assert.equal(r.activeTurn.workerId, R);
  assert.equal(r.scheduler.reservation.mode, "EXCLUSIVE");
  assert.equal(r.scheduler.reservation.reservedActive, true);
  assert.equal(r.scheduler.reservation.sharedCapacity, 1);
});

test("v1.8.12: the reserved slot stays locked while the reserved window is idle, however long others wait", async () => {
  const storage = mockStorage();
  const now = 7_000_000;
  await ask(storage, { id: "a", worker: A, now, reserved: R });
  const b = await ask(storage, { id: "b", worker: B, priority: "URGENT", now, reserved: R });
  assert.equal(b.allowed, false);
  const hourLater = now + 60 * 60_000;
  const again = await ask(storage, { id: "b", worker: B, priority: "URGENT", now: hourLater, reserved: R });
  assert.equal(again.allowed, false, "aging never opens the reserved slot");
  const view = await readGlobalCapacityScheduler(storage, { capacity: 2, reservedWorkerId: R, now: hourLater });
  assert.deepEqual(view.runnableProcessIds, []);
  assert.equal(view.reservation.reservedSlotFree, true);
  assert.equal(view.availableSlots, 1, "one slot is physically free - it is the reserved one");
});

test("v1.8.12: turns running when the reservation is set are not interrupted; the first freed slot goes to the reserved window", async () => {
  const storage = mockStorage();
  const now = 8_000_000;
  await ask(storage, { id: "a", worker: A, now });
  await ask(storage, { id: "b", worker: B, now });
  await ask(storage, { id: "c", worker: A, priority: "URGENT", now });
  const r = await ask(storage, { id: "r", worker: R, now: now + 1, reserved: R });
  assert.equal(r.allowed, false, "no pre-emption");
  const released = await releaseGlobalTurnSlot({ processId: "process-a", capacity: 2, reservedWorkerId: R, storage, now: now + 2 });
  assert.deepEqual(released.runnableProcessIds, ["process-r"], "the older URGENT waiter from another window does not get it");
  assert.equal((await ask(storage, { id: "c", worker: A, priority: "URGENT", now: now + 3, reserved: R })).allowed, false);
  assert.equal((await ask(storage, { id: "r", worker: R, now: now + 4, reserved: R })).allowed, true);
});

test("v1.8.12: with 3 slots the others share 2; after the reserved turn ends its slot stays reserved", async () => {
  const storage = mockStorage();
  const now = 9_000_000;
  const opts = { capacity: 3, reserved: R };
  assert.equal((await ask(storage, { id: "a", worker: A, now, ...opts })).allowed, true);
  assert.equal((await ask(storage, { id: "b", worker: B, now, ...opts })).allowed, true);
  assert.equal((await ask(storage, { id: "c", worker: A, now, ...opts })).allowed, false);
  assert.equal((await ask(storage, { id: "r", worker: R, now, ...opts })).allowed, true);
  const released = await releaseGlobalTurnSlot({ processId: "process-r", capacity: 3, reservedWorkerId: R, storage, now: now + 1 });
  assert.deepEqual(released.runnableProcessIds, [], "the freed reserved slot is not handed to a waiting window");
  assert.equal((await ask(storage, { id: "r2", worker: R, now: now + 2, ...opts })).allowed, true, "the reserved window's next turn starts at once");
});

test("v1.8.12: at 1 slot (serial rate-limit recovery) the reserved window only goes first; at 0 nobody runs", async () => {
  const storage = mockStorage();
  const now = 10_000_000;
  await ask(storage, { id: "a", worker: A, priority: "URGENT", now, capacity: 0, reserved: R });
  const r = await ask(storage, { id: "r", worker: R, priority: "LOW", now: now + 1, capacity: 0, reserved: R });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "GLOBAL_CAPACITY_SUSPENDED");
  assert.equal(r.scheduler.reservation.mode, "SUSPENDED");
  const view = await readGlobalCapacityScheduler(storage, { capacity: 1, reservedWorkerId: R, now: now + 2 });
  assert.equal(view.reservation.mode, "FIRST_IN_LINE");
  assert.deepEqual(view.runnableProcessIds, ["process-r"], "first in line, ahead of an older URGENT waiter");
  const other = mockStorage();
  const alone = await ask(other, { id: "a", worker: A, now, capacity: 1, reserved: R });
  assert.equal(alone.allowed, true, "the single slot is not locked while the reserved window is idle");
});

test("v1.8.12: an empty reservation id keeps v1.8.11's behaviour, and reconciliation keeps the worker id", async () => {
  const storage = mockStorage();
  const now = 11_000_000;
  assert.equal((await ask(storage, { id: "a", worker: A, now })).allowed, true);
  assert.equal((await ask(storage, { id: "r", worker: R, now })).allowed, true);
  const view = await readGlobalCapacityScheduler(storage, { capacity: 2, now });
  assert.equal(view.reservation.mode, "NONE");
  const reconciled = await reconcileGlobalCapacityScheduler({
    activeTurns: [{ processId: "process-r", workerId: R, windowId: 1, promptHash: "hash-r", priority: "NORMAL" }],
    eligibleWaiters: [{ processId: "process-x", workerId: B, windowId: 2, promptHash: "hash-x", priority: "NORMAL" }],
    capacity: 2, reservedWorkerId: R, storage, now: now + 1
  });
  assert.equal(reconciled.scheduler.activeTurns[0].workerId, R);
  assert.equal(reconciled.scheduler.waiters[0].workerId, B);
  assert.deepEqual(reconciled.runnableProcessIds, ["process-x"], "one shared slot is free next to the reserved turn");
  assert.equal(storage.data[GLOBAL_CAPACITY_SCHEDULER_KEY].activeTurns[0].workerId, R, "persisted");
});

async function seedOthers(h, { active = [], waiters = [] }) {
  const now = Date.now();
  await h.chrome.storage.local.set({ [GLOBAL_CAPACITY_SCHEDULER_KEY]: {
    ticketSeq: 10,
    activeTurns: active.map((w, i) => ({ processId: `process-other-${i}`, workerId: w, windowId: 90 + i, promptHash: `h${i}`,
      priority: "NORMAL", readySinceMs: now - 60_000, ticketSeq: i + 1, acquiredAtMs: now - 60_000, updatedAtMs: now })),
    waiters: waiters.map((w, i) => ({ processId: `process-waiting-${i}`, workerId: w, windowId: 80 + i, promptHash: `w${i}`,
      priority: "URGENT", readySinceMs: now - 30 * 60_000, ticketSeq: i + 5, updatedAtMs: now }))
  } });
}

test("v1.8.12 E2E: the reserved window sends although another window holds the shared slot and an older URGENT waiter queues", async () => {
  const h = await harness({ extraExports: ["setReservedSlot", "setMaxActiveSessions"] });
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 71 - Greenfield Works - Gf: GF-900." });
  const p = await loadProcessForWindow(1);
  const set = await h.mod.setReservedSlot({ windowId: 1, workerId: p.workerId, enabled: true });
  assert.equal(set.ok, true, JSON.stringify(set));
  assert.equal(set.appliesNow, true, "default Max parallella is 2");
  await seedOthers(h, { active: [A], waiters: [B] });
  let sent = await h.mod.tickSending(await loadProcessForWindow(1));
  assert.equal(h.sent.length, 1, "the reserved window posted its prompt");
  sent = await h.mod.tickSending(sent);
  assert.equal(sent.phase, "WAITING");
  const view = await readGlobalCapacityScheduler(h.chrome.storage.local, { capacity: 2, reservedWorkerId: p.workerId });
  assert.equal(view.activeTurns.find((t) => t.processId === p.processId)?.workerId, p.workerId);
  assert.equal(view.reservation.reservedActive, true);
  assert.deepEqual(view.runnableProcessIds, [], "the other window's waiter still waits for the shared slot");
  const fleet = await h.mod.fleetStatusSnapshot();
  assert.equal(fleet.reservation.workerId, p.workerId);
  assert.equal(fleet.reservation.mode, "EXCLUSIVE");
  assert.equal(fleet.reservation.appliesNow, true);
});

test("v1.8.12 E2E: without the reservation the same window waits behind the other windows", async () => {
  const h = await harness({ extraExports: ["setReservedSlot"] });
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 71 - Greenfield Works - Gf: GF-900." });
  await seedOthers(h, { active: [A, B] });
  const p = await h.mod.tickSending(await loadProcessForWindow(1));
  assert.equal(h.sent.length, 0);
  assert.equal(p.phase, "SENDING");
});

test("v1.8.12: Max parallella = 1 keeps the reservation but applies none; reserving elsewhere moves it; releasing elsewhere does not clear it", async () => {
  const h = await harness({ extraExports: ["setReservedSlot", "setMaxActiveSessions"] });
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 71 - Greenfield Works - Gf: GF-900." });
  const p = await loadProcessForWindow(1);
  await h.mod.setMaxActiveSessions({ windowId: 1, maxActiveSessions: 1 });
  const set = await h.mod.setReservedSlot({ windowId: 1, workerId: p.workerId, enabled: true });
  assert.equal(set.ok, true);
  assert.equal(set.appliesNow, false);
  let fleet = await h.mod.fleetStatusSnapshot();
  assert.equal(fleet.reservation.workerId, p.workerId);
  assert.equal(fleet.reservation.appliesNow, false);
  assert.equal(fleet.reservation.mode, "NONE");
  const notHere = await h.mod.setReservedSlot({ windowId: 1, workerId: "worker-elsewhere", enabled: false });
  assert.equal(notHere.reservedWorkerId, p.workerId, "a window that holds no reservation cannot release another's");
  const moved = await h.mod.setReservedSlot({ windowId: 1, workerId: "worker-elsewhere", enabled: true });
  assert.equal(moved.previousWorkerId, p.workerId);
  assert.equal(moved.reservedWorkerId, "worker-elsewhere");
  const cleared = await h.mod.setReservedSlot({ windowId: 1, workerId: "worker-elsewhere", enabled: false });
  assert.equal(cleared.reservedWorkerId, "");
  fleet = await h.mod.fleetStatusSnapshot();
  assert.equal(fleet.reservation.workerId, "");
});

test("v1.8.12 panel: the reserved slot is shown and set per window, with Swedish texts", () => {
  const none = reservedSlotView({ workerId: "", appliesNow: false }, "w1");
  assert.equal(none.label, "Ingen");
  assert.equal(none.toggleText, "Reservera en plats för detta fönster");
  const here = reservedSlotView({ workerId: "w1", appliesNow: true, mode: "EXCLUSIVE", sharedCapacity: 1, workerHasProcess: true }, "w1");
  assert.equal(here.label, "Detta fönster");
  assert.match(here.detail, /1 plats är låst för detta fönster\. Övriga fönster delar på 1 plats\./);
  assert.equal(here.toggleText, "Ta bort reservationen");
  assert.match(reservedSlotView({ workerId: "w1", appliesNow: false }, "w2").detail, /Max parallella är 2 eller fler/);
  assert.match(reservedSlotView({ workerId: "w1", appliesNow: true, mode: "FIRST_IN_LINE" }, "w2").detail, /går först/);
  assert.match(reservedSlotConfirmText(true, { movesFromOtherWindow: true }), /flyttas från ett annat fönster.*Pågående svar avbryts inte/);
  assert.equal(reservedSlotConfirmText(false), "");
  assert.match(reservedSlotMessage({ ok: true, reservedWorkerId: "w1", appliesNow: true }), /reserverad plats/);
  const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  assert.match(html, /id="reservedSlotToggle"/);
  assert.match(panel, /type: "EIC_GF_SET_RESERVED_SLOT", windowId, workerId, enabled: reserve === true/);
  assert.match(panel, /data-slot-action="\$\{reservedHere \? "release" : "reserve"\}"/);
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /case "EIC_GF_SET_RESERVED_SLOT":\s*return respond\(withVerifiedWorkerMessage/);
  assert.match(background, /const reservedWorkerId = configuredCapacity >= 2 \? reservedWorkerSetting : "";/);
  assert.equal((background.match(/reservedWorkerId: (context|capacityContext)\.reservedWorkerId/g) || []).length, 11,
    "every scheduler call applies the reservation (10 existing call sites + the setter's read-back)");
});
