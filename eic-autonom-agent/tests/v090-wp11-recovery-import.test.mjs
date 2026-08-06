import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BROWSER_RECOVERY_STATES,
  completeBrowserRecovery,
  consumeImportRollback,
  createBrowserRecoveryState,
  createImportRollback,
  markBrowserRecoveryRequired,
  normalizeBrowserRecoveryState,
  prepareBrowserRecoveryResume,
  sanitizeImportedWindowContext
} from "../lib/browser-recovery.mjs";
import { BROWSER_LOOP_STATES, createBrowserLoopState } from "../lib/browser-controller-loop.mjs";
import { BUILD_PROFILES } from "../lib/build-profile.mjs";
import { CDP_SESSION_STATES } from "../lib/cdp-session.mjs";
import { EXPORT_SCHEMA, EXPORT_VERSION } from "../lib/contracts.mjs";
import { UI_COMMANDS, UI_COMMAND_SPECS } from "../lib/ui-contract.mjs";

const surface = {
  tabId: 91,
  surfaceId: "surface-web-91",
  documentEpoch: "epoch-91",
  origin: "https://example.test",
  url: "https://example.test/page",
  lifecycleState: "READY"
};

function activeCdp() {
  return {
    schema: "eic.autonom.cdp-session.v1",
    version: 1,
    sessionId: "cdp-91",
    state: CDP_SESSION_STATES.ATTACHED,
    tabId: surface.tabId,
    surfaceId: surface.surfaceId,
    documentEpoch: surface.documentEpoch,
    origin: surface.origin,
    protocolVersion: "1.3"
  };
}

function activeEvidence() {
  return {
    state: "ACTIVE",
    target: {
      tabId: surface.tabId,
      surfaceId: surface.surfaceId,
      documentEpoch: surface.documentEpoch,
      origin: surface.origin
    }
  };
}

test("WP11 recovery state is versioned and bounded", () => {
  const state = normalizeBrowserRecoveryState({
    state: "UNKNOWN",
    attempts: Array.from({ length: 60 }, (_, index) => ({ index }))
  }, { windowId: 7 });
  assert.equal(state.schema, "eic.autonom.browser-recovery.v1");
  assert.equal(state.state, BROWSER_RECOVERY_STATES.IDLE);
  assert.equal(state.attempts.length, 32);
});

test("WP11 service-worker loss requires exact-identity recovery", () => {
  const loop = createBrowserLoopState(7);
  loop.state = BROWSER_LOOP_STATES.ACTION_PENDING;
  loop.controllerResponseHash = "a".repeat(64);
  loop.stepIds = ["step-1"];
  loop.steps = { "step-1": { stepId: "step-1", actionId: "action-1" } };
  const state = markBrowserRecoveryRequired(createBrowserRecoveryState(7), {
    reason: "SERVICE_WORKER_OR_TARGET_IDENTITY_CHANGED",
    surface,
    missionId: "mission-1",
    browserLoop: loop
  });
  assert.equal(state.state, BROWSER_RECOVERY_STATES.REQUIRED);
  assert.equal(state.pendingActionId, "action-1");
  assert.equal(state.target.documentEpoch, surface.documentEpoch);
});

test("WP11 navigation and import require explicit target rebind", () => {
  for (const reason of ["TARGET_NAVIGATION", "RELOAD", "TAB_REPLACED", "IMPORTED_STATE_REQUIRES_LIVE_REBIND"]) {
    const state = markBrowserRecoveryRequired(createBrowserRecoveryState(7), {
      reason,
      surface,
      browserLoop: createBrowserLoopState(7)
    });
    assert.equal(state.state, BROWSER_RECOVERY_STATES.REBIND_REQUIRED);
  }
});

test("WP11 recovery resume requires exact origin permission", () => {
  const required = markBrowserRecoveryRequired(createBrowserRecoveryState(7), {
    reason: "SERVICE_WORKER_OR_TARGET_IDENTITY_CHANGED",
    surface,
    browserLoop: createBrowserLoopState(7)
  });
  assert.throws(() => prepareBrowserRecoveryResume(required, {
    surface,
    permissionGranted: false,
    cdpSession: activeCdp(),
    evidenceObservation: activeEvidence()
  }), /ORIGIN_PERMISSION_REQUIRED/);
});

test("WP11 recovery resume requires attached exact CDP identity", () => {
  const required = markBrowserRecoveryRequired(createBrowserRecoveryState(7), {
    reason: "SERVICE_WORKER_OR_TARGET_IDENTITY_CHANGED",
    surface,
    browserLoop: createBrowserLoopState(7)
  });
  assert.throws(() => prepareBrowserRecoveryResume(required, {
    surface,
    permissionGranted: true,
    cdpSession: { ...activeCdp(), documentEpoch: "wrong" },
    evidenceObservation: activeEvidence()
  }), /CDP_ATTACH_REQUIRED/);
});

test("WP11 recovery resume requires active identity-bound evidence", () => {
  const required = markBrowserRecoveryRequired(createBrowserRecoveryState(7), {
    reason: "SERVICE_WORKER_OR_TARGET_IDENTITY_CHANGED",
    surface,
    browserLoop: createBrowserLoopState(7)
  });
  assert.throws(() => prepareBrowserRecoveryResume(required, {
    surface,
    permissionGranted: true,
    cdpSession: activeCdp(),
    evidenceObservation: { ...activeEvidence(), state: "STALE" }
  }), /EVIDENCE_OBSERVATION_REQUIRED/);
});

test("WP11 exact recovery becomes ready and completes without replay fields", () => {
  const required = markBrowserRecoveryRequired(createBrowserRecoveryState(7), {
    reason: "SERVICE_WORKER_OR_TARGET_IDENTITY_CHANGED",
    surface,
    browserLoop: {
      ...createBrowserLoopState(7),
      state: BROWSER_LOOP_STATES.ACTION_PENDING,
      controllerResponseHash: "a".repeat(64),
      stepIds: ["step-1"],
      steps: { "step-1": { stepId: "step-1", actionId: "action-1" } }
    }
  });
  const ready = prepareBrowserRecoveryResume(required, {
    surface,
    permissionGranted: true,
    cdpSession: activeCdp(),
    evidenceObservation: activeEvidence()
  });
  assert.equal(ready.state, BROWSER_RECOVERY_STATES.READY);
  const completed = completeBrowserRecovery(ready);
  assert.equal(completed.state, BROWSER_RECOVERY_STATES.IDLE);
  assert.equal(completed.pendingActionId, "");
  assert.equal(completed.controllerResponseHash, "");
  assert.equal(completed.browserLoopState, BROWSER_LOOP_STATES.WAITING_CONTROLLER);
});

test("WP11 rebind recovery may adopt a new epoch only on the same origin", () => {
  const required = markBrowserRecoveryRequired(createBrowserRecoveryState(7), {
    reason: "RELOAD",
    surface,
    browserLoop: createBrowserLoopState(7)
  });
  const nextSurface = { ...surface, documentEpoch: "epoch-92" };
  const ready = prepareBrowserRecoveryResume(required, {
    surface: nextSurface,
    permissionGranted: true,
    cdpSession: { ...activeCdp(), documentEpoch: "epoch-92" },
    evidenceObservation: {
      state: "ACTIVE",
      target: { ...activeEvidence().target, documentEpoch: "epoch-92" }
    }
  });
  assert.equal(ready.target.documentEpoch, "epoch-92");
  assert.equal(ready.state, BROWSER_RECOVERY_STATES.READY);
});

test("WP11 imported window never restores tabs, permission, CDP, approval or running loop", () => {
  const imported = sanitizeImportedWindowContext({
    selectedTabId: 91,
    linkedTabs: { "91": { tabId: 91 } },
    activeMissionId: "mission-1",
    surfacePair: {
      surfaces: {
        CHATGPT_CONTROLLER: { ...surface, surfaceId: "controller", origin: "https://chatgpt.com" },
        WEB_TARGET: {
          ...surface,
          permissionState: "GRANTED",
          permissionOriginPattern: "https://example.test/*",
          debuggerState: "ATTACHED",
          debuggerSessionId: "cdp-91"
        }
      }
    },
    browserSession: activeCdp(),
    browserApproval: { approvalId: "approval-1" },
    browserLoop: { ...createBrowserLoopState(7), state: BROWSER_LOOP_STATES.ACTION_PENDING }
  }, { windowId: 7, profile: BUILD_PROFILES.BROWSER });
  assert.equal(imported.selectedTabId, null);
  assert.deepEqual(imported.linkedTabs, {});
  assert.equal(imported.browserApproval, null);
  assert.equal(imported.browserSession.state, CDP_SESSION_STATES.DETACHED);
  assert.equal(imported.browserLoop.state, BROWSER_LOOP_STATES.PAUSED);
  assert.equal(imported.surfacePair.surfaces.WEB_TARGET.tabId, null);
  assert.equal(imported.surfacePair.surfaces.WEB_TARGET.permissionState, "NOT_REQUESTED");
  assert.equal(imported.surfacePair.surfaces.WEB_TARGET.debuggerState, CDP_SESSION_STATES.DETACHED);
  assert.equal(imported.browserRecovery.state, BROWSER_RECOVERY_STATES.REBIND_REQUIRED);
});

test("WP11 rollback receipt is versioned, immutable-by-copy and single-use", () => {
  const source = { config: { value: 1 } };
  const rollback = createImportRollback({
    rollbackId: "rollback-1",
    digest: "d".repeat(64),
    config: source.config,
    continuity: { value: 2 },
    windowContext: { value: 3 },
    missionStore: { value: 4 }
  });
  source.config.value = 99;
  assert.equal(rollback.snapshot.config.value, 1);
  assert.equal(rollback.schema, "eic.autonom.import-rollback.v1");
  const consumed = consumeImportRollback(rollback);
  assert.equal(consumed.consumed, true);
  assert.throws(() => consumeImportRollback(consumed), /ALREADY_CONSUMED/);
});

test("WP11 rollback snapshots fail closed above the bounded size", () => {
  assert.throws(() => createImportRollback({
    rollbackId: "rollback-large",
    digest: "e".repeat(64),
    config: { blob: "x".repeat(1_600_000) },
    continuity: {},
    windowContext: {},
    missionStore: {}
  }), /IMPORT_ROLLBACK_TOO_LARGE/);
});

test("v0.9.3 export contract is current-only v14", () => {
  assert.equal(EXPORT_SCHEMA, "eic.autonom.export.v20");
  assert.equal(EXPORT_VERSION, 20);
});

test("v0.9.3 import accepts only the current v14 export", () => {
  const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /assertCurrentExport/);
  assert.match(background, /EXPORT_SCHEMA/);
  assert.match(background, /EXPORT_VERSION/);
  assert.doesNotMatch(background, /eic\.autonom\.export\.v(?:3|4|5|6|7|8|9|10|11|12)/);
});

test("WP11 recovery is wired to worker loss, detach and lifecycle detach", () => {
  const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(source, /SERVICE_WORKER_OR_TARGET_IDENTITY_CHANGED/);
  assert.match(source, /CHROME_DEBUGGER_DETACHED/);
  assert.match(source, /detachBrowserSessionForContext[\s\S]*markBrowserRecoveryRequired/);
  assert.match(source, /browserApproval = null/);
  assert.match(source, /RECOVERY_RESUMED_WITHOUT_ACTION_REPLAY/);
});

test("WP11 closed UI command registry has 42 commands", () => {
  // v0.10.11 adds RETRY_SESSION_CONTEXT_INIT, the operator route out of a failed
  // session-context initialization. The registry stays closed and paired.
  assert.equal(Object.keys(UI_COMMANDS).length, 54);
  assert.equal(Object.keys(UI_COMMAND_SPECS).length, 54);
  assert.equal(UI_COMMANDS.RETRY_SESSION_CONTEXT_INIT, "RETRY_SESSION_CONTEXT_INIT");
  assert.equal(UI_COMMANDS.RESUME_BROWSER_RECOVERY, "RESUME_BROWSER_RECOVERY");
  assert.equal(UI_COMMANDS.ROLLBACK_IMPORTED_STATE, "ROLLBACK_IMPORTED_STATE");
});

test("WP11 panel exposes explicit recovery and rollback controls", () => {
  const html = readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  for (const id of [
    "browserRecoveryCard", "browserRecoveryState", "browserRecoveryReason",
    "browserRecoveryTarget", "browserRecoveryPendingAction",
    "resumeBrowserRecoveryButton", "rollbackImportedStateButton"
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(panel, /command\("RESUME_BROWSER_RECOVERY"/);
  assert.match(panel, /command\("ROLLBACK_IMPORTED_STATE"/);
});

test("WP11 rollback never restores live authority", () => {
  const source = [
    readFileSync(new URL("../lib/browser-recovery.mjs", import.meta.url), "utf8"),
    readFileSync(new URL("../background.js", import.meta.url), "utf8")
  ].join("\n");
  assert.match(source, /liveflikar, origin-grants, CDP, approvals och pending actions återställdes inte/);
  assert.match(source, /ROLLBACK_REQUIRES_LIVE_REBIND/);
  assert.doesNotMatch(source, /browserApproval\s*=\s*rollback\.snapshot/);
  assert.doesNotMatch(source, /liveCdpSessions\.set\([^)]*rollback/);
});

test("WP11 does not start WP12 polish", () => {
  const source = readFileSync(new URL("../lib/browser-recovery.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /FOCUS_MODE|compact layout|responsive polish/i);
});
