import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CURRENT_RUN_ADAPTER,
  MISSION_EXECUTION_OWNER,
  MISSION_INPUT_SCHEMA,
  MISSION_MODE_TEMPLATE_ORDER,
  MISSION_MODE_TEMPLATE_REGISTRY,
  MISSION_START_SCHEMA,
  listMissionModeTemplates,
  normalizeMissionStartRequest,
  resolveMissionModeTemplate
} from "../lib/mission-mode-adapter.mjs";
import {
  MISSION_MODE_IDS
} from "../lib/mission-contract.mjs";
import {
  MISSION_STATES,
  activateMissionForRun,
  reconcileRuntimeMissions
} from "../lib/mission-state-machine.mjs";
import {
  UI_COMMANDS,
  UI_COMMAND_SPECS,
  createUiCommand
} from "../lib/ui-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));
const NOW = Date.parse("2026-08-04T09:00:00.000Z");

function runtimeContext() {
  const context = {
    schema: "eic.autonom.window-context.v7",
    windowId: 7,
    selectedTabId: 42,
    linkedTabs: { "42": { tabId: 42 } },
    run: null,
    missionIds: [],
    activeMissionId: null
  };
  return {
    runtime: {
      schema: "eic.autonom.runtime.v13",
      version: 10,
      revision: 1,
      windows: { "7": context },
      missionStore: null
    },
    context
  };
}

function adapterRun(mode = "WAITING_CONTINUE") {
  return {
    schema: "eic.autonom.run.v8",
    runId: `run-${mode.toLowerCase()}`,
    mode,
    state: "WAITING_FOR_RESPONSE",
    targetTabId: 42,
    conversationKey: "https://chatgpt.com/c/wp04",
    activeWorkUnit: "Observe next response",
    nextAction: "Wait"
  };
}

test("WP04 template registry is closed over five approved Mission modes", () => {
  assert.deepEqual(MISSION_MODE_TEMPLATE_ORDER, [
    MISSION_MODE_IDS.CHATGPT_CONTINUATION,
    MISSION_MODE_IDS.CHATGPT_NEW_SESSION,
    MISSION_MODE_IDS.APP_AUDIT_LONG,
    MISSION_MODE_IDS.ARCHAEOLOGY_LONG,
    MISSION_MODE_IDS.AI_WEB_RESEARCH
  ]);
  assert.equal(Object.keys(MISSION_MODE_TEMPLATE_REGISTRY).length, 5);
  assert.equal(listMissionModeTemplates({ includeDisabled: false }).length, 5);
  assert.equal(resolveMissionModeTemplate(MISSION_MODE_IDS.AI_WEB_RESEARCH).enabled, true);
  assert.throws(() => resolveMissionModeTemplate("EXECUTE_JAVASCRIPT"), /MISSION_MODE_TEMPLATE_UNKNOWN/);
});

test("WP04 continuation normalizes to one bounded Mission start request", () => {
  const request = normalizeMissionStartRequest({
    modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
    input: {}
  });
  assert.equal(request.schema, MISSION_START_SCHEMA);
  assert.equal(request.modeId, MISSION_MODE_IDS.CHATGPT_CONTINUATION);
  assert.equal(request.missionInput.schema, MISSION_INPUT_SCHEMA);
  assert.equal(request.missionInput.activation, "WAIT_FOR_NEXT_COMPLETED_ASSISTANT");
  assert.deepEqual(request.runtimeInput, {});
});

test("WP04 new-session Mission stores only bounded prompt metadata", () => {
  const request = normalizeMissionStartRequest({
    modeId: MISSION_MODE_IDS.CHATGPT_NEW_SESSION,
    input: {
      startPrompt: "secret prompt body",
      analysis: {
        promptDigest: "sha256:test",
        taskIntent: "Test intent",
        firstWorkUnit: "Read baseline"
      }
    }
  });
  assert.equal(request.runtimeInput.startPrompt, "secret prompt body");
  assert.equal(request.missionInput.startPromptLength, 18);
  assert.equal(request.missionInput.startPromptDigest, "sha256:test");
  assert.equal(Object.hasOwn(request.missionInput, "startPrompt"), false);
});

test("WP04 mode inputs fail closed for missing, unknown and disabled inputs", () => {
  assert.throws(
    () => normalizeMissionStartRequest({
      modeId: MISSION_MODE_IDS.APP_AUDIT_LONG,
      input: {}
    }),
    /MISSION_APP_AUDIT_TEST_NEED_REQUIRED/
  );
  assert.throws(
    () => normalizeMissionStartRequest({
      modeId: MISSION_MODE_IDS.ARCHAEOLOGY_LONG,
      input: { question: "x", arbitraryScript: "alert(1)" }
    }),
    /MISSION_INPUT_KEY_NOT_ALLOWED/
  );
  assert.throws(
    () => normalizeMissionStartRequest({
      modeId: MISSION_MODE_IDS.AI_WEB_RESEARCH,
      input: {}
    }),
    /MISSION_BUILD_PROFILE_UNAVAILABLE/
  );
});

test("WP04 activation makes Mission the owner of one legacy adapter run", () => {
  const { runtime, context } = runtimeContext();
  const run = adapterRun();
  const result = activateMissionForRun(runtime, context, run, {
    modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
    input: normalizeMissionStartRequest({
      modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
      input: {}
    }).missionInput,
    selectedTabId: 42,
    now: NOW
  });
  assert.equal(result.mission.execution.owner, MISSION_EXECUTION_OWNER);
  assert.equal(result.mission.execution.adapter, CURRENT_RUN_ADAPTER);
  assert.equal(result.mission.execution.adapterRunId, run.runId);
  assert.equal(result.run.missionId, result.mission.missionId);
  assert.equal(result.run.missionModeId, MISSION_MODE_IDS.CHATGPT_CONTINUATION);
  assert.equal(context.activeMissionId, result.mission.missionId);
  assert.deepEqual(context.missionIds, [result.mission.missionId]);
  assert.equal(result.mission.state, MISSION_STATES.WAITING_TARGET);
});

test("WP04 activation blocks Mission/run mode mismatch", () => {
  const { runtime, context } = runtimeContext();
  assert.throws(
    () => activateMissionForRun(runtime, context, adapterRun("APP_AUDIT_LONG"), {
      modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
      input: {},
      selectedTabId: 42,
      now: NOW
    }),
    /MISSION_ADAPTER_MODE_MISMATCH/
  );
});

test("WP04 reconciliation preserves the Mission identity selected at start", () => {
  const { runtime, context } = runtimeContext();
  const activated = activateMissionForRun(runtime, context, adapterRun(), {
    modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
    input: {},
    selectedTabId: 42,
    now: NOW
  });
  context.run = activated.run;
  const missionId = activated.mission.missionId;
  context.run.state = "ASSESSING";
  reconcileRuntimeMissions(runtime, { now: NOW + 1 });
  assert.equal(context.activeMissionId, missionId);
  assert.equal(context.run.missionId, missionId);
  assert.equal(runtime.missionStore.missions[missionId].modeId, MISSION_MODE_IDS.CHATGPT_CONTINUATION);
  assert.equal(runtime.missionStore.missions[missionId].state, MISSION_STATES.WAITING_EVIDENCE);
});

test("WP04 START_MISSION command has a closed payload envelope", () => {
  const command = createUiCommand({
    command: UI_COMMANDS.START_MISSION,
    windowId: 7,
    requestId: "wp04-start",
    payload: {
      modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
      input: {}
    }
  });
  assert.equal(command.command, "START_MISSION");
  assert.deepEqual(UI_COMMAND_SPECS.START_MISSION.requiredPayloadKeys, ["modeId", "input"]);
  assert.throws(
    () => createUiCommand({
      command: UI_COMMANDS.START_MISSION,
      windowId: 7,
      payload: { modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION, input: {}, script: "x" }
    }),
    /UI_COMMAND_PAYLOAD_KEY_NOT_ALLOWED/
  );
});

test("WP04 background routes generic and compatibility starts through Mission validation", () => {
  const background = read("background.js");
  assert.match(background, /async function startMission\(windowId, payload = \{\}/);
  assert.match(background, /normalizeMissionStartRequest\(\{[\s\S]{0,180}modeId,[\s\S]{0,180}buildProfile:\s*runtimeBuildProfile\(\)/);
  assert.match(background, /\[UI_COMMANDS\.START_MISSION\][\s\S]*startMission\(windowId, payload/);
  for (const command of ["START_WAITING", "START_NEW_SESSION", "START_APP_AUDIT", "START_ARCHAEOLOGY"]) {
    assert.match(background, new RegExp(`\\[UI_COMMANDS\\.${command}\\][\\s\\S]{0,500}startMission\\(`));
  }
  assert.match(background, /activateMissionForRun\(runtime, context, run/);
});

test("WP04 panel emits only the generic Mission start command", () => {
  const panel = read("sidepanel.js");
  assert.match(panel, /command\("START_MISSION", \{ modeId, input \}\)/);
  for (const legacy of ["START_WAITING", "START_NEW_SESSION", "START_APP_AUDIT", "START_ARCHAEOLOGY"]) {
    assert.doesNotMatch(panel, new RegExp(`command\\("${legacy}"`));
  }
});

test("WP04 Mission selector exposes four standard modes and the WP10 browser mode", () => {
  const html = read("sidepanel.html");
  assert.match(html, /id="missionModeSelect"/);
  for (const modeId of MISSION_MODE_TEMPLATE_ORDER) {
    assert.match(html, new RegExp(`data-mission-mode-panel="${modeId}"`));
  }
  const webPanel = html.match(/<div[^>]*data-mission-mode-panel="AI_WEB_RESEARCH"[\s\S]*?<\/div>/)?.[0] || "";
  assert.match(webPanel, /hidden/);
  assert.match(webPanel, /startWebResearchButton/);
  assert.match(webPanel, /startWebResearchButton/);
  assert.doesNotMatch(webPanel, /disabled=/);
});

test("WP04 retains all 44 baseline interactive controls exactly once", () => {
  const inventory = read("docs/V0_9_0_CONTROL_INVENTORY.md");
  const baseline = inventory.slice(
    inventory.indexOf("## Interactive controls"),
    inventory.indexOf("## Background command surface")
  );
  const ids = [...baseline.matchAll(/\| `([^`]+)` \|/g)].map((match) => match[1]);
  assert.equal(ids.length, 44);
  const html = read("sidepanel.html");
  for (const id of ids) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, id);
  }
});

test("WP04 moves policy controls to their declared Mission Control views", () => {
  const html = read("sidepanel.html");
  const runView = html.slice(html.indexOf('id="missionViewRun"'), html.indexOf('id="missionViewSurfaces"'));
  const evidenceView = html.slice(html.indexOf('id="missionViewEvidence"'), html.indexOf('id="missionViewMissions"'));
  const settingsView = html.slice(html.indexOf('id="missionViewSettings"'), html.indexOf('class="action-dock"'));
  assert.match(runView, /id="boundaryAuthorization"/);
  assert.match(evidenceView, /id="mjolnarState"/);
  assert.doesNotMatch(evidenceView, /id="mjolnarEnabled"/);
  for (const id of ["maxAutonomousMode", "backgroundWaitEnabled", "maxTurns", "responseTimeout", "mjolnarEnabled", "mjolnarRolloutMode"]) {
    assert.match(settingsView, new RegExp(`id="${id}"`));
  }
});

test("WP04 preserves schemas and standard permissions in the final release", () => {
  const manifest = json("manifest.json");
  const pkg = json("package.json");
  const contracts = read("lib/contracts.mjs");
  assert.equal(manifest.version, "0.10.11");
  assert.equal(pkg.version, "0.10.11");
  assert.deepEqual(manifest.permissions, ["sidePanel", "storage", "tabs", "scripting", "alarms"]);
  assert.deepEqual(manifest.host_permissions, ["https://chatgpt.com/*", "https://chat.openai.com/*"]);
  assert.doesNotMatch(JSON.stringify(manifest), /debugger/);
  assert.match(contracts, /eic\.autonom\.config\.v13/);
  assert.match(contracts, /eic\.autonom\.runtime\.v13/);
  assert.match(contracts, /eic\.autonom\.export\.v20/);
});

test("historical WP04 receipt remains archival and does not constrain the current contract", () => {
  const contract = read("docs/V0_9_0_WP04_MISSION_MODE_MIGRATION.md");
  const ledger = read("docs/V0_9_0_EXECUTION_LEDGER.md");
  const eic = read("EIC.md");
  assert.match(contract, /Mission is the execution owner from WP04/);
  assert.match(ledger, /\| WP04 \|[^|]+\| IMPLEMENTED \|/);
  assert.match(eic, /Historical files describe history; they do not constrain current implementation/);
  assert.match(read("docs/V0_9_3_FORWARD_ONLY_POLICY.md"), /Backward compatibility is not/i);
});
