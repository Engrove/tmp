import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  SURFACE_LIFECYCLE_STATES,
  SURFACE_PAIR_SCHEMA,
  SURFACE_PAIR_STATES,
  bindSurfaceRole,
  createEmptySurfacePair,
  detachSurfaceRole,
  findSurfaceRoleByTab,
  isSafeWebTargetUrl,
  markSurfaceClosed,
  markSurfaceMoving,
  normalizeSurfacePair,
  replaceSurfaceTab,
  setSurfaceActiveTab,
  surfacePairMissionBindings,
  updateSurfaceForTab
} from "../lib/surface-pair.mjs";
import {
  MISSION_MODE_IDS,
  MISSION_SURFACE_ROLES
} from "../lib/mission-contract.mjs";
import {
  createMissionFromRun,
  reconcileRuntimeMissions
} from "../lib/mission-state-machine.mjs";
import { createDefaultRuntime } from "../lib/contracts.mjs";
import { UI_COMMANDS, UI_COMMAND_SPECS, createUiCommand } from "../lib/ui-contract.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const controllerTab = {
  id: 11,
  windowId: 7,
  title: "EIC conversation",
  url: "https://chatgpt.com/c/abc",
  status: "complete",
  active: true
};
const targetTab = {
  id: 22,
  windowId: 7,
  title: "Example",
  url: "https://example.com/docs",
  status: "complete",
  active: false
};

function paired() {
  let pair = createEmptySurfacePair(7, { pairId: "pair-7", now: 1 });
  pair = bindSurfaceRole(pair, MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER, {
    tab: controllerTab,
    page: { conversationKey: "chatgpt.com:c:abc", documentEpoch: "controller-doc-1" },
    now: 2
  });
  pair = bindSurfaceRole(pair, MISSION_SURFACE_ROLES.WEB_TARGET, {
    tab: targetTab,
    now: 3
  });
  return pair;
}

test("WP05 defines a versioned closed surface pair", () => {
  const pair = createEmptySurfacePair(7, { pairId: "pair-7", now: 1 });
  assert.equal(pair.schema, SURFACE_PAIR_SCHEMA);
  assert.equal(pair.pairState, SURFACE_PAIR_STATES.EMPTY);
  assert.deepEqual(Object.keys(pair.surfaces).sort(), ["CHATGPT_CONTROLLER", "WEB_TARGET"]);
});

test("WEB_TARGET allows only http(s) non-ChatGPT URLs", () => {
  assert.equal(isSafeWebTargetUrl("https://example.com/a"), true);
  assert.equal(isSafeWebTargetUrl("http://localhost:3000/a"), true);
  assert.equal(isSafeWebTargetUrl("https://chatgpt.com/c/a"), false);
  assert.equal(isSafeWebTargetUrl("chrome://extensions"), false);
  assert.equal(isSafeWebTargetUrl("file:///tmp/a"), false);
});

test("controller and target bind to distinct tabs and produce READY pair", () => {
  const pair = paired();
  assert.equal(pair.pairState, SURFACE_PAIR_STATES.READY);
  assert.equal(pair.surfaces.CHATGPT_CONTROLLER.tabId, 11);
  assert.equal(pair.surfaces.WEB_TARGET.tabId, 22);
  assert.equal(pair.surfaces.WEB_TARGET.permissionState, "NOT_REQUESTED");
  assert.equal(pair.surfaces.WEB_TARGET.debuggerState, "NOT_AVAILABLE_WP05");
});

test("one tab cannot own both roles", () => {
  let pair = createEmptySurfacePair(7);
  pair = bindSurfaceRole(pair, MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER, {
    tab: controllerTab,
    page: { conversationKey: "chatgpt.com:c:abc" }
  });
  assert.throws(
    () => bindSurfaceRole(pair, MISSION_SURFACE_ROLES.WEB_TARGET, {
      tab: { ...targetTab, id: 11 }
    }),
    /SURFACE_ROLE_TAB_CONFLICT/
  );
});

test("ChatGPT cannot be bound as WEB_TARGET", () => {
  assert.throws(
    () => bindSurfaceRole(createEmptySurfacePair(7), MISSION_SURFACE_ROLES.WEB_TARGET, {
      tab: controllerTab
    }),
    /SURFACE_TARGET_URL_UNSUPPORTED/
  );
});

test("navigation rotates document epoch while retaining surface identity", () => {
  const before = paired();
  const surfaceId = before.surfaces.WEB_TARGET.surfaceId;
  const epoch = before.surfaces.WEB_TARGET.documentEpoch;
  const after = updateSurfaceForTab(before, 22, {
    tab: { ...targetTab, url: "https://example.com/other" },
    changeInfo: { url: "https://example.com/other", status: "loading" },
    now: 10
  });
  assert.equal(after.surfaces.WEB_TARGET.surfaceId, surfaceId);
  assert.notEqual(after.surfaces.WEB_TARGET.documentEpoch, epoch);
  assert.equal(after.surfaces.WEB_TARGET.lifecycleState, SURFACE_LIFECYCLE_STATES.NAVIGATING);
});

test("tab replacement retains surface identity but rotates epoch and tab id", () => {
  const before = paired();
  const surfaceId = before.surfaces.WEB_TARGET.surfaceId;
  const epoch = before.surfaces.WEB_TARGET.documentEpoch;
  const after = replaceSurfaceTab(before, 22, {
    ...targetTab,
    id: 23,
    url: "https://example.com/replaced"
  }, { now: 20 });
  assert.equal(after.surfaces.WEB_TARGET.surfaceId, surfaceId);
  assert.equal(after.surfaces.WEB_TARGET.tabId, 23);
  assert.notEqual(after.surfaces.WEB_TARGET.documentEpoch, epoch);
  assert.equal(after.surfaces.WEB_TARGET.lifecycleState, SURFACE_LIFECYCLE_STATES.RECONNECTING);
});

test("close and explicit detach preserve identity but release tab", () => {
  const before = paired();
  const id = before.surfaces.WEB_TARGET.surfaceId;
  const closed = markSurfaceClosed(before, 22, { now: 30 });
  assert.equal(closed.surfaces.WEB_TARGET.surfaceId, id);
  assert.equal(closed.surfaces.WEB_TARGET.tabId, null);
  assert.equal(closed.surfaces.WEB_TARGET.lifecycleState, SURFACE_LIFECYCLE_STATES.CLOSED);
  const detached = detachSurfaceRole(closed, MISSION_SURFACE_ROLES.WEB_TARGET, { now: 31 });
  assert.equal(detached.surfaces.WEB_TARGET.surfaceId, id);
  assert.equal(detached.surfaces.WEB_TARGET.lifecycleState, SURFACE_LIFECYCLE_STATES.DETACHED);
});

test("moved surfaces are not auto-rebound", () => {
  const before = paired();
  const moving = markSurfaceMoving(before, 22, { now: 40 });
  assert.equal(moving.surfaces.WEB_TARGET.lifecycleState, SURFACE_LIFECYCLE_STATES.MOVING);
  const detached = detachSurfaceRole(
    moving,
    MISSION_SURFACE_ROLES.WEB_TARGET,
    { reason: "TAB_ATTACHED_REQUIRES_EXPLICIT_REBIND", now: 41 }
  );
  assert.equal(detached.surfaces.WEB_TARGET.tabId, null);
  assert.equal(detached.surfaces.WEB_TARGET.lastReason, "TAB_ATTACHED_REQUIRES_EXPLICIT_REBIND");
});

test("activation is tracked independently for both surfaces", () => {
  const pair = paired();
  const targetActive = setSurfaceActiveTab(pair, 22, { now: 50 });
  assert.equal(targetActive.surfaces.CHATGPT_CONTROLLER.active, false);
  assert.equal(targetActive.surfaces.WEB_TARGET.active, true);
  assert.equal(findSurfaceRoleByTab(targetActive, 22), MISSION_SURFACE_ROLES.WEB_TARGET);
});

test("standard missions bind only controller while browser mission binds both", () => {
  const pair = paired();
  const standard = surfacePairMissionBindings(pair, MISSION_MODE_IDS.CHATGPT_CONTINUATION);
  const browser = surfacePairMissionBindings(pair, MISSION_MODE_IDS.AI_WEB_RESEARCH);
  assert.ok(standard.controllerSurfaceId);
  assert.equal(standard.targetSurfaceId, null);
  assert.ok(browser.controllerSurfaceId);
  assert.ok(browser.targetSurfaceId);
});

test("current-run mission reconciliation materializes controller surface id", () => {
  const pair = paired();
  const run = {
    runId: "run-1",
    mode: "WAITING_CONTINUE",
    state: "WAITING_FOR_RESPONSE",
    targetTabId: 11,
    conversationKey: "chatgpt.com:c:abc"
  };
  const mission = createMissionFromRun(run, {
    windowId: 7,
    selectedTabId: 11,
    surfacePair: pair,
    now: 70
  });
  assert.equal(mission.controllerSurfaceId, pair.surfaces.CHATGPT_CONTROLLER.surfaceId);
  assert.equal(mission.targetSurfaceId, null);
});

test("runtime reconciliation preserves pair-bound mission surface ids", () => {
  const pair = paired();
  const runtime = createDefaultRuntime();
  runtime.windows["7"] = {
    schema: "eic.autonom.window-context.v7",
    windowId: 7,
    selectedTabId: 11,
    linkedTabs: {},
    surfacePair: pair,
    missionIds: [],
    activeMissionId: null,
    run: {
      runId: "run-2",
      mode: "WAITING_CONTINUE",
      state: "WAITING_FOR_RESPONSE",
      targetTabId: 11,
      conversationKey: "chatgpt.com:c:abc"
    }
  };
  reconcileRuntimeMissions(runtime, { now: 80 });
  const mission = runtime.missionStore.missions[runtime.windows["7"].activeMissionId];
  assert.equal(mission.controllerSurfaceId, pair.surfaces.CHATGPT_CONTROLLER.surfaceId);
  assert.equal(mission.targetSurfaceId, null);
});

test("WP05 closed target commands remain registered after WP06", () => {
  assert.equal(UI_COMMANDS.BIND_ACTIVE_WEB_TARGET, "BIND_ACTIVE_WEB_TARGET");
  assert.equal(UI_COMMANDS.DETACH_WEB_TARGET, "DETACH_WEB_TARGET");
  assert.ok(UI_COMMAND_SPECS.BIND_ACTIVE_WEB_TARGET);
  assert.ok(UI_COMMAND_SPECS.DETACH_WEB_TARGET);
  assert.equal(Object.keys(UI_COMMANDS).length, 54);
  assert.equal(createUiCommand({
    command: UI_COMMANDS.BIND_ACTIVE_WEB_TARGET,
    windowId: 7,
    payload: {},
    requestId: "request-1"
  }).command, UI_COMMANDS.BIND_ACTIVE_WEB_TARGET);
});

test("source wiring tracks both role lifecycle and explicit target controls", () => {
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const panel = fs.readFileSync(path.join(root, "sidepanel.html"), "utf8");
  assert.match(background, /bindActiveWebTarget/);
  assert.match(background, /replaceSurfaceTab/);
  assert.match(background, /TAB_ATTACHED_REQUIRES_EXPLICIT_REBIND/);
  assert.match(panel, /id="bindActiveWebTargetButton"/);
  assert.match(panel, /id="targetPermissionStatus"/);
  assert.match(panel, /id="targetDebuggerStatus"/);
});

test("WP05 standard manifest boundary remains intact after WP06", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.deepEqual(
    manifest.permissions,
    ["sidePanel", "storage", "tabs", "scripting", "alarms"]
  );
  assert.deepEqual(
    manifest.host_permissions,
    ["https://chatgpt.com/*", "https://chat.openai.com/*"]
  );
  assert.equal(manifest.permissions.includes("debugger"), false);
  assert.equal("optional_host_permissions" in manifest, false);
  const ledger = fs.readFileSync(path.join(root, "docs/V0_9_0_EXECUTION_LEDGER.md"), "utf8");
  assert.match(ledger, /WP05 \| Controller\/target pairing and tab lifecycle \| IMPLEMENTED/);
});
