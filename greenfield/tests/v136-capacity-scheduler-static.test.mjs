import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const scheduler = fs.readFileSync(new URL("../lib/global-capacity-scheduler.mjs", import.meta.url), "utf8");
const operator = fs.readFileSync(new URL("../lib/operator-settings.mjs", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");

test("v1.3.6 bounds active ChatGPT turns with a profile-global capacity scheduler", () => {
  assert.match(background, /requestGlobalTurnSlot/);
  assert.match(background, /releaseGlobalTurnSlot/);
  assert.match(background, /adoptGlobalTurnSlot/);
  assert.match(background, /GLOBAL_CAPACITY_SLOT_ACQUIRED/);
  assert.match(background, /GLOBAL_CAPACITY_WAITING/);
  assert.match(background, /RESPONSE_CAPTURED/);
  assert.match(background, /releaseSchedulerTurn\(next/);
  assert.match(scheduler, /DEFAULT_MAX_ACTIVE_SESSIONS = 2/);
  assert.match(scheduler, /MAX_MAX_ACTIVE_SESSIONS = 4/);
});

test("v1.3.6 priority is non-starving through aging plus oldest-ready tie break", () => {
  assert.match(scheduler, /PRIORITY_AGING_STEP_MS = 3 \* 60 \* 1000/);
  assert.match(scheduler, /LOW_TO_TOP_PRIORITY_MAX_AGING_MS/);
  assert.match(scheduler, /effectiveSchedulerPriority/);
  assert.match(scheduler, /a\.readySinceMs - b\.readySinceMs/);
  assert.match(scheduler, /a\.ticketSeq - b\.ticketSeq/);
  assert.match(background, /updateGlobalTurnPriority/);
  assert.doesNotMatch(scheduler, /MAX_WAITERS/);
});

test("v1.3.6 recovery controls effective capacity without preempting active turns", () => {
  assert.match(background, /if \(rateLimitState === "COOLDOWN"\) return 0/);
  assert.match(background, /if \(rateLimitState === "SERIAL_RECOVERY"\) return 1/);
  assert.match(background, /effectiveSchedulerCapacity/);
  assert.doesNotMatch(scheduler, /activeTurns:\s*current\.activeTurns\.slice\(0,\s*effectiveCapacity/);
});

test("v1.3.6 reconstructs active turn ownership before hydrated ticks", () => {
  const reconcileIndex = background.indexOf("reconcileSchedulerAfterHydration(migrated)");
  const hydratedTickIndex = background.indexOf("scheduleFast(current.processId, 100)", reconcileIndex);
  assert.ok(reconcileIndex >= 0);
  assert.ok(hydratedTickIndex > reconcileIndex);
  assert.match(background, /potentialActiveTurnDescriptor/);
  assert.match(background, /MIGRATED_EFFECT_UNKNOWN/);
});

test("v1.3.6 side panel exposes capacity 1..4 and per-session priorities", () => {
  assert.match(html, /id="maxActiveSessions"[^>]+min="1"[^>]+max="4"/);
  assert.match(html, /id="schedulerPriority"/);
  assert.match(html, /value="LOW">Låg/);
  assert.match(html, /value="NORMAL" selected>Normal/);
  assert.match(html, /value="HIGH">Hög/);
  assert.match(html, /value="URGENT">Brådskande/);
  assert.match(panel, /EIC_GF_SET_MAX_ACTIVE_SESSIONS/);
  assert.match(panel, /EIC_GF_SET_SCHEDULER_PRIORITY/);
  assert.match(panel, /schedulerPriority: state\.startSchedulerPriority/);
  assert.match(panel, /globalCapacityScheduler/);
});

test("v1.3.6 operator settings persist maxActiveSessions with default two", () => {
  assert.match(operator, /maxActiveSessions/);
  assert.match(operator, /DEFAULT_MAX_ACTIVE_SESSIONS/);
  assert.match(operator, /operator-settings\.v3/);
});

test("capacity wait is event-driven instead of the previous one-second gate polling loop", () => {
  const waitIndex = background.indexOf('"GLOBAL_CAPACITY_WAITING"');
  assert.ok(waitIndex >= 0);
  const window = background.slice(Math.max(0, waitIndex - 1800), waitIndex + 1800);
  assert.match(window, /wakeSchedulerProcesses/);
  assert.doesNotMatch(window, /scheduleFast\(process\.processId,\s*1000\)/);
  assert.match(background, /Math\.min\(30_000,/);
});
