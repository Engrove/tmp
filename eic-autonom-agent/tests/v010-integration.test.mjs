import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { UI_COMMANDS, UI_COMMAND_SPECS } from "../lib/ui-contract.mjs";
import { STATES } from "../lib/state-machine.mjs";
import { SCENARIO_PRESETS } from "../lib/core-profiles.mjs";
import { QUICK_PROFILE_IDS, DEFAULT_QUICK_PROFILE_ID } from "../lib/quick-profiles.mjs";

const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");

test("v0.10.0 operator action and operator decision use separate closed UI commands", () => {
  assert.deepEqual(UI_COMMAND_SPECS[UI_COMMANDS.SUBMIT_OPERATOR_ACTION_RECEIPT].requiredPayloadKeys, [
    "actionId", "missionId", "runId", "evidence"
  ]);
  assert.deepEqual(UI_COMMAND_SPECS[UI_COMMANDS.AUTHORIZE_BOUNDARY].requiredPayloadKeys, [
    "boundaryKey", "decisionId", "missionId", "runId", "acknowledgement"
  ]);
});

test("v0.10.0 awaiting operator action suppresses Nano and ordinary response deadlines", () => {
  assert.equal(STATES.AWAITING_OPERATOR_ACTION, "AWAITING_OPERATOR_ACTION");
  assert.match(background, /run\.state === STATES\.AWAITING_OPERATOR_ACTION/);
  assert.match(background, /run\.pendingNanoRequest = null/);
  assert.match(background, /run\.responseDeadlineAt = null/);
  assert.match(background, /run\.timeoutSuspended = true/);
});

test("v0.10.0 transcript capture is transcript-only, restores scroll and treats attachments as references", () => {
  assert.match(content, /EIC_CAPTURE_TRANSCRIPT/);
  assert.match(content, /scroll\.scrollTo\?\.\(\{ top: initialTop, left: initialLeft/);
  assert.match(content, /attachments:/);
  assert.match(content, /reasoningSummaryVisible/);
  assert.doesNotMatch(content, /document\.documentElement\.outerHTML|document\.body\.innerHTML/);
  assert.doesNotMatch(content, /document\.cookie/);
});

test("v0.10.0 capture and memory are persisted to IndexedDB with only small local pointers", () => {
  for (const store of ["captures", "turns", "sections", "sectionSummaries", "sessionMemories"]) {
    assert.match(background, new RegExp(`db\\.put\\("${store}"`));
  }
  assert.match(background, /SESSION_DB_POINTER_KEYS\.ACTIVE_CAPTURE_ID/);
  assert.match(background, /SESSION_DB_POINTER_KEYS\.ACTIVE_MEMORY_ID/);
  assert.match(background, /SESSION_DB_POINTER_KEYS\.READINESS/);
});

test("v0.10.0 export v18 includes bounded summaries and excludes raw session bodies", () => {
  assert.match(panel, /sessionContext: \{/);
  assert.match(panel, /sessionCapture: uiModel\(\)\.window\?\.run\?\.sessionCaptureSummary/);
  assert.match(panel, /sessionMemory: uiModel\(\)\.window\?\.run\?\.sessionMemorySummary/);
  assert.match(panel, /operatorAction: uiModel\(\)\.window\?\.run\?\.operatorAction/);
  const exportBlock = panel.slice(panel.indexOf("async function exportState"), panel.indexOf("async function importFile"));
  assert.doesNotMatch(exportBlock, /rawTranscript|rawHtml|turnBodies|credentials|cookies/);
});

test("v0.10.0 exposes exactly four whole-app profiles with verified analysis as default", () => {
  assert.equal(DEFAULT_QUICK_PROFILE_ID, QUICK_PROFILE_IDS.VERIFIED_ANALYSIS);
  assert.deepEqual(SCENARIO_PRESETS.map((profile) => profile.id), [
    "VERIFIED_ANALYSIS",
    "BOUNDED_DELIVERY",
    "STRICT_OPERATIONS_RECOVERY",
    "EXPLORATION_DESIGN"
  ]);
  assert.match(panel, /SCENARIO_PRESETS/);
  assert.match(panel, /elements\.scenarioPreset/);
  assert.match(panel, /markCoreCombinationCustom/);
});
