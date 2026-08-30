import { deepClone, nowIso, nullableInteger, sanitizeText } from "./common.mjs";
import { BROWSER_LOOP_STATES, createBrowserLoopState, normalizeBrowserLoopState } from "./browser-controller-loop.mjs";
import { CDP_SESSION_STATES, createCdpSession, normalizeCdpSession } from "./cdp-session.mjs";
import { BUILD_PROFILES } from "./build-profile.mjs";

export const BROWSER_RECOVERY_SCHEMA = "eic.autonom.browser-recovery.v1";
export const IMPORT_ROLLBACK_SCHEMA = "eic.autonom.import-rollback.v1";

export const BROWSER_RECOVERY_STATES = Object.freeze({
  IDLE: "IDLE",
  REQUIRED: "REQUIRED",
  REBIND_REQUIRED: "REBIND_REQUIRED",
  RECOVERING: "RECOVERING",
  READY: "READY",
  PAUSED: "PAUSED",
  FAILED: "FAILED"
});

const RECOVERY_STATE_SET = new Set(Object.values(BROWSER_RECOVERY_STATES));
const MAX_RECOVERY_ATTEMPTS = 32;
export const MAX_IMPORT_ROLLBACK_BYTES = 1_500_000;

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
}

function nullableInt(value) {
  return nullableInteger(value) !== null ? Number(value) : null;
}

function normalizeLocator(value = {}) {
  const source = record(value) ? value : {};
  return {
    tabId: nullableInt(source.tabId),
    surfaceId: String(source.surfaceId || ""),
    documentEpoch: String(source.documentEpoch || ""),
    origin: String(source.origin || ""),
    url: String(source.url || "").slice(0, 4096)
  };
}

export function createBrowserRecoveryState(windowId, now = Date.now()) {
  const normalizedWindowId = nullableInt(windowId);
  if (normalizedWindowId === null) throw new Error("BROWSER_RECOVERY_WINDOW_ID_REQUIRED");
  return {
    schema: BROWSER_RECOVERY_SCHEMA,
    version: 1,
    windowId: normalizedWindowId,
    state: BROWSER_RECOVERY_STATES.IDLE,
    reason: "",
    target: normalizeLocator(),
    missionId: "",
    browserLoopState: BROWSER_LOOP_STATES.IDLE,
    pendingStepId: "",
    pendingActionId: "",
    controllerResponseHash: "",
    attempts: [],
    lastRequiredAt: null,
    lastReadyAt: null,
    updatedAt: nowIso(now)
  };
}

export function normalizeBrowserRecoveryState(value, {
  windowId,
  now = Date.now()
} = {}) {
  const base = createBrowserRecoveryState(windowId ?? value?.windowId, now);
  const source = record(value) ? value : {};
  return {
    ...base,
    ...source,
    schema: BROWSER_RECOVERY_SCHEMA,
    version: 1,
    windowId: nullableInt(windowId ?? source.windowId) ?? base.windowId,
    state: RECOVERY_STATE_SET.has(source.state) ? source.state : base.state,
    reason: sanitizeText(source.reason, 1200),
    target: normalizeLocator(source.target),
    missionId: String(source.missionId || ""),
    browserLoopState: String(source.browserLoopState || BROWSER_LOOP_STATES.IDLE),
    pendingStepId: String(source.pendingStepId || ""),
    pendingActionId: String(source.pendingActionId || ""),
    controllerResponseHash: String(source.controllerResponseHash || ""),
    attempts: Array.isArray(source.attempts)
      ? deepClone(source.attempts).filter(record).slice(-MAX_RECOVERY_ATTEMPTS)
      : [],
    lastRequiredAt: source.lastRequiredAt ? String(source.lastRequiredAt) : null,
    lastReadyAt: source.lastReadyAt ? String(source.lastReadyAt) : null,
    updatedAt: String(source.updatedAt || nowIso(now))
  };
}

function latestLoopStep(loop) {
  const ids = Array.isArray(loop?.stepIds) ? loop.stepIds : [];
  const id = ids.at(-1);
  return id && record(loop?.steps?.[id]) ? loop.steps[id] : null;
}

export function markBrowserRecoveryRequired(value, {
  reason = "BROWSER_RECOVERY_REQUIRED",
  surface = null,
  missionId = "",
  browserLoop = null,
  now = Date.now()
} = {}) {
  const state = normalizeBrowserRecoveryState(value, {
    windowId: value?.windowId,
    now
  });
  const loop = normalizeBrowserLoopState(browserLoop || createBrowserLoopState(state.windowId, now), {
    windowId: state.windowId,
    now
  });
  const step = latestLoopStep(loop);
  const rebindReason = /NAVIGAT|RELOAD|REPLAC|MOVING|CLOSED|IMPORT|REBIND/i.test(String(reason || ""));
  state.state = !surface?.surfaceId || rebindReason
    ? BROWSER_RECOVERY_STATES.REBIND_REQUIRED
    : BROWSER_RECOVERY_STATES.REQUIRED;
  state.reason = sanitizeText(reason, 1200);
  state.target = normalizeLocator(surface || state.target);
  state.missionId = String(missionId || state.missionId || "");
  state.browserLoopState = loop.state;
  state.pendingStepId = String(step?.stepId || "");
  state.pendingActionId = String(step?.actionId || "");
  state.controllerResponseHash = String(loop.controllerResponseHash || "");
  state.lastRequiredAt = nowIso(now);
  state.updatedAt = state.lastRequiredAt;
  return state;
}

function identityMatches(expected, actual) {
  return Boolean(
    nullableInteger(actual?.tabId) !== null &&
    Number(expected?.tabId) === Number(actual.tabId) &&
    String(expected?.surfaceId || "") === String(actual?.surfaceId || "") &&
    String(expected?.documentEpoch || "") === String(actual?.documentEpoch || "") &&
    String(expected?.origin || "") === String(actual?.origin || "")
  );
}

export function prepareBrowserRecoveryResume(value, {
  surface,
  permissionGranted = false,
  cdpSession,
  evidenceObservation,
  now = Date.now()
} = {}) {
  const state = normalizeBrowserRecoveryState(value, {
    windowId: value?.windowId,
    now
  });
  if (![BROWSER_RECOVERY_STATES.REQUIRED, BROWSER_RECOVERY_STATES.REBIND_REQUIRED,
        BROWSER_RECOVERY_STATES.PAUSED, BROWSER_RECOVERY_STATES.FAILED].includes(state.state)) {
    throw new Error(`BROWSER_RECOVERY_NOT_REQUIRED:${state.state}`);
  }
  if (!surface?.surfaceId) throw new Error("BROWSER_RECOVERY_TARGET_REBIND_REQUIRED");
  if (state.state === BROWSER_RECOVERY_STATES.REBIND_REQUIRED) {
    if (state.target.origin && String(state.target.origin) !== String(surface.origin || "")) {
      throw new Error("BROWSER_RECOVERY_TARGET_ORIGIN_MISMATCH");
    }
    state.target = normalizeLocator(surface);
  } else if (!identityMatches(state.target, surface)) {
    throw new Error("BROWSER_RECOVERY_TARGET_IDENTITY_MISMATCH");
  }
  if (!permissionGranted) throw new Error("BROWSER_RECOVERY_ORIGIN_PERMISSION_REQUIRED");
  const session = normalizeCdpSession(cdpSession, {
    profile: BUILD_PROFILES.BROWSER,
    surface,
    now
  });
  if (session.state !== CDP_SESSION_STATES.ATTACHED || !identityMatches(session, surface)) {
    throw new Error("BROWSER_RECOVERY_CDP_ATTACH_REQUIRED");
  }
  if (String(evidenceObservation?.state || "") !== "ACTIVE" ||
      !identityMatches(evidenceObservation?.target || {}, surface)) {
    throw new Error("BROWSER_RECOVERY_EVIDENCE_OBSERVATION_REQUIRED");
  }
  state.state = BROWSER_RECOVERY_STATES.READY;
  state.reason = "RECOVERY_PRECONDITIONS_VERIFIED";
  state.attempts.push({
    attemptId: `recovery-${now}-${state.attempts.length + 1}`,
    state: BROWSER_RECOVERY_STATES.READY,
    reason: state.reason,
    target: normalizeLocator(surface),
    at: nowIso(now)
  });
  state.attempts = state.attempts.slice(-MAX_RECOVERY_ATTEMPTS);
  state.lastReadyAt = nowIso(now);
  state.updatedAt = state.lastReadyAt;
  return state;
}

export function completeBrowserRecovery(value, {
  reason = "RECOVERY_COMPLETED_WITHOUT_REPLAY",
  now = Date.now()
} = {}) {
  const state = normalizeBrowserRecoveryState(value, {
    windowId: value?.windowId,
    now
  });
  if (state.state !== BROWSER_RECOVERY_STATES.READY) {
    throw new Error(`BROWSER_RECOVERY_NOT_READY:${state.state}`);
  }
  state.state = BROWSER_RECOVERY_STATES.IDLE;
  state.reason = sanitizeText(reason, 1200);
  state.pendingStepId = "";
  state.pendingActionId = "";
  state.controllerResponseHash = "";
  state.browserLoopState = BROWSER_LOOP_STATES.WAITING_CONTROLLER;
  state.updatedAt = nowIso(now);
  return state;
}

export function sanitizeImportedWindowContext(value, {
  windowId,
  profile = BUILD_PROFILES.STANDARD,
  now = Date.now(),
  reason = "IMPORTED_STATE_REQUIRES_LIVE_REBIND"
} = {}) {
  const source = record(value) ? deepClone(value) : {};
  const target = source?.surfacePair?.surfaces?.WEB_TARGET || null;
  const normalizedWindowId = nullableInt(windowId);
  if (normalizedWindowId === null) throw new Error("BROWSER_RECOVERY_WINDOW_ID_REQUIRED");
  source.windowId = normalizedWindowId;
  source.selectedTabId = null;
  source.linkedTabs = {};
  source.browserApproval = null;
  source.browserActionLedger = Array.isArray(source.browserActionLedger)
    ? source.browserActionLedger.slice(-128)
    : [];
  source.browserSession = createCdpSession({ profile, surface: target, now });
  if (profile === BUILD_PROFILES.BROWSER) {
    source.browserSession.state = CDP_SESSION_STATES.DETACHED;
    source.browserSession.lastReason = reason;
  }
  const loop = normalizeBrowserLoopState(source.browserLoop, { windowId, now });
  loop.state = BROWSER_LOOP_STATES.PAUSED;
  loop.lastReason = reason;
  loop.controllerResponseHash = "";
  source.browserLoop = loop;
  source.browserRecovery = markBrowserRecoveryRequired(
    createBrowserRecoveryState(windowId, now),
    {
      reason,
      surface: target,
      missionId: source.activeMissionId || "",
      browserLoop: loop,
      now
    }
  );
  if (target) {
    target.tabId = null;
    target.lifecycleState = "RECONNECTING";
    target.permissionState = profile === BUILD_PROFILES.BROWSER
      ? "NOT_REQUESTED"
      : "UNAVAILABLE_STANDARD_PROFILE";
    target.permissionOriginPattern = "";
    target.debuggerState = profile === BUILD_PROFILES.BROWSER
      ? CDP_SESSION_STATES.DETACHED
      : CDP_SESSION_STATES.UNAVAILABLE_STANDARD_PROFILE;
    target.debuggerSessionId = "";
    target.lifecycleReason = reason;
  }
  const controller = source?.surfacePair?.surfaces?.CHATGPT_CONTROLLER;
  if (controller) {
    controller.tabId = null;
    controller.lifecycleState = "RECONNECTING";
    controller.lifecycleReason = reason;
  }
  source.importRollback = null;
  source.updatedAt = nowIso(now);
  return source;
}

export function createImportRollback({
  rollbackId,
  digest = "",
  config,
  continuity,
  windowContext,
  missionStore,
  now = Date.now()
} = {}) {
  if (!rollbackId) throw new Error("IMPORT_ROLLBACK_ID_REQUIRED");
  const snapshot = {
    config: deepClone(config || {}),
    continuity: deepClone(continuity || {}),
    windowContext: deepClone(windowContext || {}),
    missionStore: deepClone(missionStore || {})
  };
  const snapshotBytes = jsonBytes(snapshot);
  if (snapshotBytes > MAX_IMPORT_ROLLBACK_BYTES) {
    throw new Error(`IMPORT_ROLLBACK_TOO_LARGE:${snapshotBytes}`);
  }
  return normalizeImportRollback({
    schema: IMPORT_ROLLBACK_SCHEMA,
    version: 1,
    rollbackId,
    digest,
    snapshot,
    snapshotBytes,
    consumed: false,
    createdAt: nowIso(now),
    consumedAt: null,
    updatedAt: nowIso(now)
  });
}

export function normalizeImportRollback(value) {
  if (!record(value)) return null;
  const snapshot = record(value.snapshot) ? value.snapshot : {};
  const snapshotBytes = jsonBytes(snapshot);
  if (snapshotBytes > MAX_IMPORT_ROLLBACK_BYTES) return null;
  return {
    schema: IMPORT_ROLLBACK_SCHEMA,
    version: 1,
    rollbackId: String(value.rollbackId || ""),
    digest: String(value.digest || ""),
    snapshotBytes,
    snapshot: {
      config: deepClone(snapshot.config || {}),
      continuity: deepClone(snapshot.continuity || {}),
      windowContext: deepClone(snapshot.windowContext || {}),
      missionStore: deepClone(snapshot.missionStore || {})
    },
    consumed: value.consumed === true,
    createdAt: String(value.createdAt || ""),
    consumedAt: value.consumedAt ? String(value.consumedAt) : null,
    updatedAt: String(value.updatedAt || value.createdAt || "")
  };
}

export function consumeImportRollback(value, now = Date.now()) {
  const rollback = normalizeImportRollback(value);
  if (!rollback?.rollbackId) throw new Error("IMPORT_ROLLBACK_MISSING");
  if (rollback.consumed) throw new Error("IMPORT_ROLLBACK_ALREADY_CONSUMED");
  rollback.consumed = true;
  rollback.consumedAt = nowIso(now);
  rollback.updatedAt = rollback.consumedAt;
  return rollback;
}
