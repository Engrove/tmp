import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AUTOSTART_PRESETS,
  DEFAULT_AUTOSTART_PRESET_ID,
  buildAutostartPlan
} from "../lib/autostart-presets.mjs";

test("autostart presets are uniquely and logically ordered", () => {
  const ids = AUTOSTART_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    AUTOSTART_PRESETS.map((preset) => preset.order),
    [...AUTOSTART_PRESETS].sort((a, b) => a.order - b.order).map((preset) => preset.order)
  );
  assert.equal(DEFAULT_AUTOSTART_PRESET_ID, "VERIFIED_ANALYSIS");
});

test("Mjolnar D2 requires confirmation and selects strict operations", () => {
  const plan = buildAutostartPlan("MJOLNAR_D2");
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(plan.configPatch.mjolnarRolloutMode, "D2_LIVE");
  assert.equal(plan.configPatch.quickProfileId, "STRICT_OPERATIONS_RECOVERY");
});

test("context-only does not start Nano or a mission", () => {
  const plan = buildAutostartPlan("CONTEXT_ONLY");
  assert.equal(plan.linkActiveTab, true);
  assert.equal(plan.activateNano, false);
  assert.equal(plan.startMission, false);
  assert.equal(plan.configPatch.autoSessionCaptureEnabled, true);
});

test("Autostart begins LanguageModel activation before the first await", async () => {
  const js = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  const start = js.indexOf("async function autostartClick()");
  const body = js.slice(start, js.indexOf("async function activateNanoClick", start));
  assert.ok(body.indexOf("beginNanoCreateFromGestureWithConfig(preparedConfig)") < body.indexOf("await command"));
  assert.match(body, /LINK_ACTIVE_TAB/);
  assert.match(body, /startMissionMode/);
});
