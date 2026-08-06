import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONFIG_SCHEMA,
  EXPORT_SCHEMA,
  EXPORT_VERSION,
  RUNTIME_SCHEMA,
  createDefaultConfig,
  createDefaultRuntime
} from "../lib/contracts.mjs";
import {
  MISSION_BUILD_PROFILES,
  MISSION_MODE_IDS,
  MISSION_MODE_REGISTRY,
  MISSION_STORE_SCHEMA,
  MISSION_SURFACE_ROLES,
  listMissionModes,
  resolveMissionMode
} from "../lib/mission-contract.mjs";
import {
  MISSION_STATES,
  canTransitionMission,
  createMission,
  importMissionView,
  runStateToMissionState,
  missionViewForWindow,
  reconcileRuntimeMissions,
  transitionMission
} from "../lib/mission-state-machine.mjs";
import {
  UI_SNAPSHOT_SCHEMA,
  createUiSnapshot,
  readUiSnapshotModel
} from "../lib/ui-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));
const NOW = Date.parse("2026-08-04T08:00:00.000Z");

function legacyRuntime(run = null) {
  return {
    schema: "eic.autonom.runtime.v8",
    version: 8,
    revision: 17,
    windows: {
      "7": {
        schema: "eic.autonom.window-context.v6",
        windowId: 7,
        alias: "Fönster 7",
        targetMode: "LOCKED",
        selectedTabId: 42,
        linkedTabs: {},
        run,
        continuity: null,
        continuityBackup: null,
        startPromptReceipts: [],
        nanoHostTelemetry: {},
        lastActiveTabId: 42
      }
    },
    orphanedRuns: [],
    orphanedContinuities: [],
    startPromptReceipts: [],
    updatedAt: "2026-08-04T07:00:00.000Z"
  };
}

test("WP02 mission mode registry contains four migrated modes and separate AI_WEB_RESEARCH", () => {
  assert.equal(MISSION_MODE_REGISTRY.schema, "eic.autonom.mission-mode-registry.v1");
  assert.equal(listMissionModes().length, 5);
  for (const modeId of [
    MISSION_MODE_IDS.CHATGPT_CONTINUATION,
    MISSION_MODE_IDS.CHATGPT_NEW_SESSION,
    MISSION_MODE_IDS.APP_AUDIT_LONG,
    MISSION_MODE_IDS.ARCHAEOLOGY_LONG
  ]) {
    const mode = resolveMissionMode(modeId);
    assert.equal(mode.buildProfile, MISSION_BUILD_PROFILES.STANDARD);
    assert.deepEqual(mode.requiredSurfaceRoles, [MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER]);
    assert.equal(mode.enabled, true);
  }
  const browserMode = resolveMissionMode(MISSION_MODE_IDS.AI_WEB_RESEARCH);
  assert.equal(browserMode.buildProfile, MISSION_BUILD_PROFILES.BROWSER);
  assert.deepEqual(browserMode.requiredSurfaceRoles, [
    MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER,
    MISSION_SURFACE_ROLES.WEB_TARGET
  ]);
  assert.equal(browserMode.enabled, true);
  assert.throws(() => resolveMissionMode("EXECUTE_JAVASCRIPT"), /MISSION_MODE_UNKNOWN/);
});

test("WP02 mission state machine is closed and fail-closed", () => {
  assert.equal(canTransitionMission(MISSION_STATES.DRAFT, MISSION_STATES.READY), true);
  assert.equal(canTransitionMission(MISSION_STATES.READY, MISSION_STATES.RUNNING), true);
  assert.equal(canTransitionMission(MISSION_STATES.COMPLETED, MISSION_STATES.RUNNING), false);

  const draft = createMission({
    missionId: "mission-1",
    modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
    windowId: 7,
    now: NOW
  });
  const ready = transitionMission(draft, MISSION_STATES.READY, {
    reason: "baseline verified",
    now: NOW + 1
  });
  assert.equal(ready.state, MISSION_STATES.READY);
  assert.equal(ready.stateRevision, 1);
  assert.throws(
    () => transitionMission(ready, MISSION_STATES.COMPLETED),
    /MISSION_TRANSITION_NOT_ALLOWED/
  );
});

test("WP02 mission record separates controller and web target roles", () => {
  const mission = createMission({
    missionId: "mission-role-test",
    modeId: MISSION_MODE_IDS.AI_WEB_RESEARCH,
    controllerSurfaceId: "surface-chatgpt-1",
    targetSurfaceId: "surface-web-1",
    originGrants: ["https://example.com"],
    now: NOW
  });
  assert.equal(mission.schema, "eic.autonom.mission.v1");
  assert.equal(mission.controllerSurfaceId, "surface-chatgpt-1");
  assert.equal(mission.targetSurfaceId, "surface-web-1");
  assert.equal(mission.surfaceRoles.CHATGPT_CONTROLLER, "surface-chatgpt-1");
  assert.equal(mission.surfaceRoles.WEB_TARGET, "surface-web-1");
  assert.equal(mission.evidencePolicy.responseBodies, false);
  assert.equal(mission.evidencePolicy.redactBeforePersist, true);
});

test("WP02 maps legacy run states into bounded mission lifecycle states", () => {
  assert.equal(runStateToMissionState("WAITING_BACKGROUND"), MISSION_STATES.WAITING_TARGET);
  assert.equal(runStateToMissionState("ASSESSING"), MISSION_STATES.WAITING_EVIDENCE);
  assert.equal(runStateToMissionState("DONE"), MISSION_STATES.COMPLETED);
  assert.equal(runStateToMissionState("UNKNOWN_FUTURE_STATE"), MISSION_STATES.BLOCKED);
});

test("WP02 uiSnapshot v3 exposes only the current model", () => {
  const missions = {
    schema: "eic.autonom.mission-view.v1",
    version: 1,
    activeMissionId: "mission-1",
    missionIds: ["mission-1"],
    missions: {
      "mission-1": createMission({
        missionId: "mission-1",
        modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
        now: NOW
      })
    }
  };
  const snapshot = createUiSnapshot({
    appVersion: "0.10.11",
    windowId: 7,
    snapshotId: "snapshot-v3",
    capturedAt: new Date(NOW).toISOString(),
    config: {},
    continuity: {},
    window: {},
    missions,
    audit: []
  });
  assert.equal(snapshot.schema, UI_SNAPSHOT_SCHEMA);
  assert.equal(snapshot.snapshotVersion, 3);
  const model = readUiSnapshotModel(snapshot);
  assert.equal(model.missions.activeMissionId, "mission-1");
  missions.activeMissionId = null;
  assert.equal(model.missions.activeMissionId, "mission-1");
});

test("WP02 persistence contracts retain schemas while release version and permissions remain coherent", () => {
  const manifest = json("manifest.json");
  const pkg = json("package.json");
  assert.equal(CONFIG_SCHEMA, "eic.autonom.config.v13");
  assert.equal(RUNTIME_SCHEMA, "eic.autonom.runtime.v13");
  assert.equal(EXPORT_SCHEMA, "eic.autonom.export.v20");
  assert.equal(EXPORT_VERSION, 20);
  assert.equal(createDefaultRuntime().missionStore.schema, MISSION_STORE_SCHEMA);
  assert.equal(pkg.version, "0.10.11");
  assert.equal(manifest.version, "0.10.11");
  assert.deepEqual(manifest.permissions, ["sidePanel", "storage", "tabs", "scripting", "alarms"]);
  assert.deepEqual(manifest.host_permissions, ["https://chatgpt.com/*", "https://chat.openai.com/*"]);
});

test("WP02 source wiring persists and snapshots the mission domain", () => {
  const background = read("background.js");
  const panel = read("sidepanel.js");
  assert.doesNotMatch(background, /migrateV\d|migrateLegacy/);
  assert.match(background, /reconcileRuntimeMissions\(runtime\)/);
  assert.match(background, /missionViewForWindow\(runtime, windowId\)/);
  assert.match(background, /importMissionView\(bundle\.runtime, importedContext, payload\.missions\)/);
  assert.match(panel, /missions:\s*uiModel\(\)\.missions/);
});

test("WP02 documentation closes the gate before WP03", () => {
  const ledger = read("docs/V0_9_0_EXECUTION_LEDGER.md");
  const contract = read("docs/V0_9_0_WP02_MISSION_DOMAIN.md");
  assert.match(ledger, /\| WP02 \|.*\| IMPLEMENTED \|/);
  assert.match(ledger, /## WP02 receipt[\s\S]*WP03 remains blocked until explicit operator approval/);
  assert.match(contract, /Mission domain/i);
  assert.match(contract, /No Mission Control visual redesign/i);
  assert.match(contract, /WP03/i);
});
