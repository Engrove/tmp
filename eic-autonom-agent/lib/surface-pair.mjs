import {
  conversationKeyFromUrl,
  deepClone,
  isAllowedChatUrl,
  nowIso,
  randomId,
  sanitizeText
} from "./common.mjs";
import {
  MISSION_MODE_IDS,
  MISSION_SURFACE_ROLES,
  resolveMissionMode
} from "./mission-contract.mjs";

export const SURFACE_PAIR_SCHEMA = "eic.autonom.surface-pair.v1";
export const SURFACE_SCHEMA = "eic.autonom.surface.v1";

export const SURFACE_LIFECYCLE_STATES = Object.freeze({
  DETACHED: "DETACHED",
  READY: "READY",
  LOADING: "LOADING",
  NAVIGATING: "NAVIGATING",
  RECONNECTING: "RECONNECTING",
  MOVING: "MOVING",
  CLOSED: "CLOSED",
  UNSUPPORTED: "UNSUPPORTED"
});

export const SURFACE_PAIR_STATES = Object.freeze({
  EMPTY: "EMPTY",
  CONTROLLER_ONLY: "CONTROLLER_ONLY",
  TARGET_ONLY: "TARGET_ONLY",
  READY: "READY",
  DEGRADED: "DEGRADED"
});

const SAFE_WEB_PROTOCOLS = new Set(["http:", "https:"]);
const ROLE_SET = new Set(Object.values(MISSION_SURFACE_ROLES));
const LIFECYCLE_SET = new Set(Object.values(SURFACE_LIFECYCLE_STATES));

function text(value, max = 800) {
  return sanitizeText(value || "", max);
}

function integerOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function safeOrigin(url) {
  try {
    const parsed = new URL(String(url || ""));
    return SAFE_WEB_PROTOCOLS.has(parsed.protocol) ? parsed.origin : "";
  } catch {
    return "";
  }
}

export function isSafeWebTargetUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (!SAFE_WEB_PROTOCOLS.has(parsed.protocol)) return false;
    if (isAllowedChatUrl(parsed.href)) return false;
    return true;
  } catch {
    return false;
  }
}

function validateRoleUrl(role, url) {
  if (role === MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER) {
    if (!isAllowedChatUrl(url)) throw new Error("SURFACE_CONTROLLER_URL_UNSUPPORTED");
    return;
  }
  if (role === MISSION_SURFACE_ROLES.WEB_TARGET) {
    if (!isSafeWebTargetUrl(url)) throw new Error("SURFACE_TARGET_URL_UNSUPPORTED");
    return;
  }
  throw new Error(`SURFACE_ROLE_UNKNOWN:${role}`);
}

function newDocumentEpoch(role, now = Date.now()) {
  return `${role.toLowerCase()}-epoch-${now}-${randomId("doc").slice(-12)}`;
}

function normalizeSurface(value, role, {
  windowId = null,
  fallbackSurfaceId = null,
  now = Date.now()
} = {}) {
  if (!ROLE_SET.has(role)) throw new Error(`SURFACE_ROLE_UNKNOWN:${role}`);
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? deepClone(value)
    : {};
  const lifecycleState = LIFECYCLE_SET.has(source.lifecycleState)
    ? source.lifecycleState
    : SURFACE_LIFECYCLE_STATES.DETACHED;
  const url = text(source.url, 4000);
  return {
    schema: SURFACE_SCHEMA,
    version: 1,
    surfaceId: String(source.surfaceId || fallbackSurfaceId || randomId("surface")),
    role,
    tabId: integerOrNull(source.tabId),
    windowId: integerOrNull(source.windowId ?? windowId),
    title: text(source.title, 500),
    url,
    origin: safeOrigin(source.origin || url),
    conversationKey: role === MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER
      ? text(source.conversationKey || conversationKeyFromUrl(url), 1000)
      : "",
    lifecycleState,
    documentEpoch: String(source.documentEpoch || newDocumentEpoch(role, now)),
    epochRevision: Math.max(0, Number(source.epochRevision || 0)),
    active: Boolean(source.active),
    discarded: Boolean(source.discarded),
    frozen: Boolean(source.frozen),
    permissionState: role === MISSION_SURFACE_ROLES.WEB_TARGET
      ? String(source.permissionState || "NOT_REQUESTED")
      : "NOT_APPLICABLE",
    permissionOriginPattern: role === MISSION_SURFACE_ROLES.WEB_TARGET
      ? text(source.permissionOriginPattern, 4000)
      : "",
    permissionUpdatedAt: role === MISSION_SURFACE_ROLES.WEB_TARGET
      ? source.permissionUpdatedAt || null
      : null,
    debuggerState: role === MISSION_SURFACE_ROLES.WEB_TARGET
      ? String(source.debuggerState || "NOT_AVAILABLE_WP05")
      : "NOT_APPLICABLE",
    debuggerSessionId: role === MISSION_SURFACE_ROLES.WEB_TARGET
      ? text(source.debuggerSessionId, 500)
      : "",
    debuggerUpdatedAt: role === MISSION_SURFACE_ROLES.WEB_TARGET
      ? source.debuggerUpdatedAt || null
      : null,
    lastReason: text(source.lastReason, 500),
    createdAt: source.createdAt || nowIso(now),
    updatedAt: source.updatedAt || nowIso(now),
    lastSeenAt: source.lastSeenAt || null
  };
}

function pairState(pair) {
  const controller = pair.surfaces[MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER];
  const target = pair.surfaces[MISSION_SURFACE_ROLES.WEB_TARGET];
  const controllerBound = Number.isInteger(controller?.tabId);
  const targetBound = Number.isInteger(target?.tabId);
  const healthy = (surface) => surface && [
    SURFACE_LIFECYCLE_STATES.READY,
    SURFACE_LIFECYCLE_STATES.LOADING,
    SURFACE_LIFECYCLE_STATES.NAVIGATING,
    SURFACE_LIFECYCLE_STATES.RECONNECTING
  ].includes(surface.lifecycleState);

  if (!controllerBound && !targetBound) return SURFACE_PAIR_STATES.EMPTY;
  if (controllerBound && targetBound) {
    return healthy(controller) && healthy(target)
      ? SURFACE_PAIR_STATES.READY
      : SURFACE_PAIR_STATES.DEGRADED;
  }
  if (controllerBound) {
    return healthy(controller)
      ? SURFACE_PAIR_STATES.CONTROLLER_ONLY
      : SURFACE_PAIR_STATES.DEGRADED;
  }
  return healthy(target)
    ? SURFACE_PAIR_STATES.TARGET_ONLY
    : SURFACE_PAIR_STATES.DEGRADED;
}

function finalizePair(pair, now = Date.now()) {
  pair.schema = SURFACE_PAIR_SCHEMA;
  pair.version = 1;
  pair.pairState = pairState(pair);
  pair.revision = Math.max(0, Number(pair.revision || 0));
  pair.updatedAt = nowIso(now);
  return pair;
}

export function createEmptySurfacePair(windowId, {
  pairId = randomId("surface-pair"),
  now = Date.now()
} = {}) {
  const numericWindowId = integerOrNull(windowId);
  if (numericWindowId === null) throw new Error("SURFACE_PAIR_WINDOW_ID_INVALID");
  return finalizePair({
    schema: SURFACE_PAIR_SCHEMA,
    version: 1,
    pairId: String(pairId),
    windowId: numericWindowId,
    revision: 0,
    pairState: SURFACE_PAIR_STATES.EMPTY,
    surfaces: {
      [MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER]: null,
      [MISSION_SURFACE_ROLES.WEB_TARGET]: null
    },
    createdAt: nowIso(now),
    updatedAt: nowIso(now)
  }, now);
}

export function normalizeSurfacePair(value, {
  windowId,
  linkedTabs = {},
  selectedTabId = null,
  now = Date.now()
} = {}) {
  const numericWindowId = integerOrNull(windowId ?? value?.windowId);
  if (numericWindowId === null) throw new Error("SURFACE_PAIR_WINDOW_ID_INVALID");
  const pair = value && typeof value === "object" && !Array.isArray(value)
    ? deepClone(value)
    : createEmptySurfacePair(numericWindowId, {
        pairId: `surface-pair-window-${numericWindowId}`,
        now
      });
  pair.schema = SURFACE_PAIR_SCHEMA;
  pair.version = 1;
  pair.pairId = String(pair.pairId || `surface-pair-window-${numericWindowId}`);
  pair.windowId = numericWindowId;
  pair.revision = Math.max(0, Number(pair.revision || 0));
  pair.surfaces = pair.surfaces && typeof pair.surfaces === "object"
    ? pair.surfaces
    : {};

  const legacyRecord = linkedTabs?.[String(selectedTabId)] || null;
  const controllerValue = pair.surfaces[MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER] ||
    (legacyRecord ? {
      surfaceId: `surface-controller-${numericWindowId}-${legacyRecord.tabId}`,
      tabId: legacyRecord.tabId,
      windowId: legacyRecord.windowId ?? numericWindowId,
      title: legacyRecord.title,
      url: legacyRecord.url,
      conversationKey: legacyRecord.conversationKey,
      documentEpoch: legacyRecord.documentEpoch,
      lifecycleState: legacyRecord.status === "UNSUPPORTED"
        ? SURFACE_LIFECYCLE_STATES.UNSUPPORTED
        : SURFACE_LIFECYCLE_STATES.READY,
      active: Number(legacyRecord.tabId) === Number(selectedTabId),
      lastSeenAt: legacyRecord.lastSeenAt
    } : null);

  pair.surfaces[MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER] = controllerValue
    ? normalizeSurface(controllerValue, MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER, {
        windowId: numericWindowId,
        fallbackSurfaceId: `surface-controller-${numericWindowId}-${controllerValue.tabId || "detached"}`,
        now
      })
    : null;
  pair.surfaces[MISSION_SURFACE_ROLES.WEB_TARGET] =
    pair.surfaces[MISSION_SURFACE_ROLES.WEB_TARGET]
      ? normalizeSurface(
          pair.surfaces[MISSION_SURFACE_ROLES.WEB_TARGET],
          MISSION_SURFACE_ROLES.WEB_TARGET,
          {
            windowId: numericWindowId,
            fallbackSurfaceId: `surface-target-${numericWindowId}-${pair.surfaces[MISSION_SURFACE_ROLES.WEB_TARGET].tabId || "detached"}`,
            now
          }
        )
      : null;
  pair.createdAt ||= nowIso(now);
  return finalizePair(pair, now);
}

export function bindSurfaceRole(pairValue, role, {
  tab,
  page = null,
  now = Date.now()
} = {}) {
  if (!tab || !Number.isInteger(Number(tab.id))) throw new Error("SURFACE_TAB_INVALID");
  validateRoleUrl(role, tab.url || "");
  const pair = normalizeSurfacePair(pairValue, {
    windowId: tab.windowId ?? pairValue?.windowId,
    now
  });
  const otherRole = role === MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER
    ? MISSION_SURFACE_ROLES.WEB_TARGET
    : MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER;
  if (Number(pair.surfaces[otherRole]?.tabId) === Number(tab.id)) {
    throw new Error(`SURFACE_ROLE_TAB_CONFLICT:${tab.id}`);
  }
  const previous = pair.surfaces[role];
  const surface = normalizeSurface({
    ...previous,
    tabId: Number(tab.id),
    windowId: Number(tab.windowId ?? pair.windowId),
    title: tab.title || previous?.title || "",
    url: tab.url || previous?.url || "",
    origin: safeOrigin(tab.url || previous?.url),
    conversationKey: role === MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER
      ? page?.conversationKey || conversationKeyFromUrl(tab.url || "")
      : "",
    lifecycleState: tab.status === "loading"
      ? SURFACE_LIFECYCLE_STATES.LOADING
      : SURFACE_LIFECYCLE_STATES.READY,
    documentEpoch: page?.documentEpoch || newDocumentEpoch(role, now),
    epochRevision: Math.max(0, Number(previous?.epochRevision || 0)) + 1,
    active: Boolean(tab.active),
    discarded: Boolean(tab.discarded),
    frozen: Boolean(tab.frozen),
    permissionState: role === MISSION_SURFACE_ROLES.WEB_TARGET
      ? "NOT_REQUESTED"
      : "NOT_APPLICABLE",
    debuggerState: role === MISSION_SURFACE_ROLES.WEB_TARGET
      ? "NOT_AVAILABLE_WP05"
      : "NOT_APPLICABLE",
    lastReason: "EXPLICIT_BIND",
    lastSeenAt: nowIso(now),
    updatedAt: nowIso(now)
  }, role, {
    windowId: pair.windowId,
    fallbackSurfaceId: previous?.surfaceId || randomId(
      role === MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER ? "surface-controller" : "surface-target"
    ),
    now
  });
  pair.surfaces[role] = surface;
  pair.revision += 1;
  return finalizePair(pair, now);
}

export function detachSurfaceRole(pairValue, role, {
  reason = "EXPLICIT_DETACH",
  now = Date.now()
} = {}) {
  const pair = normalizeSurfacePair(pairValue, {
    windowId: pairValue?.windowId,
    now
  });
  const previous = pair.surfaces[role];
  if (!previous) return pair;
  pair.surfaces[role] = normalizeSurface({
    ...previous,
    tabId: null,
    active: false,
    lifecycleState: SURFACE_LIFECYCLE_STATES.DETACHED,
    lastReason: reason,
    updatedAt: nowIso(now)
  }, role, { windowId: pair.windowId, now });
  pair.revision += 1;
  return finalizePair(pair, now);
}

export function updateSurfaceForTab(pairValue, tabId, {
  tab = {},
  changeInfo = {},
  reason = "TAB_UPDATED",
  now = Date.now()
} = {}) {
  const pair = normalizeSurfacePair(pairValue, {
    windowId: tab.windowId ?? pairValue?.windowId,
    now
  });
  const role = findSurfaceRoleByTab(pair, tabId);
  if (!role) return pair;
  const previous = pair.surfaces[role];
  const url = tab.url || changeInfo.url || previous.url;
  let lifecycleState = previous.lifecycleState;
  let rotateEpoch = false;

  if (changeInfo.url) {
    rotateEpoch = true;
    lifecycleState = SURFACE_LIFECYCLE_STATES.NAVIGATING;
  } else if (changeInfo.status === "loading") {
    rotateEpoch = ![
      SURFACE_LIFECYCLE_STATES.NAVIGATING,
      SURFACE_LIFECYCLE_STATES.LOADING
    ].includes(previous.lifecycleState);
    lifecycleState = SURFACE_LIFECYCLE_STATES.LOADING;
  } else if (changeInfo.status === "complete") {
    lifecycleState = SURFACE_LIFECYCLE_STATES.READY;
  }

  try {
    validateRoleUrl(role, url);
  } catch {
    lifecycleState = SURFACE_LIFECYCLE_STATES.UNSUPPORTED;
  }

  pair.surfaces[role] = normalizeSurface({
    ...previous,
    windowId: tab.windowId ?? previous.windowId,
    title: tab.title || changeInfo.title || previous.title,
    url,
    origin: safeOrigin(url),
    conversationKey: role === MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER
      ? conversationKeyFromUrl(url) || previous.conversationKey
      : "",
    lifecycleState,
    documentEpoch: rotateEpoch ? newDocumentEpoch(role, now) : previous.documentEpoch,
    epochRevision: Number(previous.epochRevision || 0) + (rotateEpoch ? 1 : 0),
    active: tab.active ?? previous.active,
    discarded: tab.discarded ?? previous.discarded,
    frozen: tab.frozen ?? previous.frozen,
    lastReason: reason,
    lastSeenAt: nowIso(now),
    updatedAt: nowIso(now)
  }, role, { windowId: pair.windowId, now });
  pair.revision += 1;
  return finalizePair(pair, now);
}

export function replaceSurfaceTab(pairValue, removedTabId, addedTab, {
  now = Date.now()
} = {}) {
  if (!addedTab || !Number.isInteger(Number(addedTab.id))) throw new Error("SURFACE_REPLACEMENT_TAB_INVALID");
  const pair = normalizeSurfacePair(pairValue, {
    windowId: pairValue?.windowId ?? addedTab.windowId,
    now
  });
  const role = findSurfaceRoleByTab(pair, removedTabId);
  if (!role) return pair;
  const previous = pair.surfaces[role];
  let lifecycleState = SURFACE_LIFECYCLE_STATES.RECONNECTING;
  try {
    validateRoleUrl(role, addedTab.url || previous.url);
  } catch {
    lifecycleState = SURFACE_LIFECYCLE_STATES.UNSUPPORTED;
  }
  pair.surfaces[role] = normalizeSurface({
    ...previous,
    tabId: Number(addedTab.id),
    windowId: Number(addedTab.windowId ?? previous.windowId),
    title: addedTab.title || previous.title,
    url: addedTab.url || previous.url,
    origin: safeOrigin(addedTab.url || previous.url),
    conversationKey: role === MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER
      ? conversationKeyFromUrl(addedTab.url || previous.url) || previous.conversationKey
      : "",
    lifecycleState,
    documentEpoch: newDocumentEpoch(role, now),
    epochRevision: Number(previous.epochRevision || 0) + 1,
    active: Boolean(addedTab.active),
    discarded: Boolean(addedTab.discarded),
    frozen: Boolean(addedTab.frozen),
    lastReason: "TAB_REPLACED",
    lastSeenAt: nowIso(now),
    updatedAt: nowIso(now)
  }, role, { windowId: pair.windowId, now });
  pair.revision += 1;
  return finalizePair(pair, now);
}

function markSurfaceLifecycle(pairValue, tabId, lifecycleState, reason, now = Date.now()) {
  const pair = normalizeSurfacePair(pairValue, {
    windowId: pairValue?.windowId,
    now
  });
  const role = findSurfaceRoleByTab(pair, tabId);
  if (!role) return pair;
  const previous = pair.surfaces[role];
  pair.surfaces[role] = normalizeSurface({
    ...previous,
    tabId: lifecycleState === SURFACE_LIFECYCLE_STATES.CLOSED ? null : previous.tabId,
    active: false,
    lifecycleState,
    lastReason: reason,
    updatedAt: nowIso(now)
  }, role, { windowId: pair.windowId, now });
  pair.revision += 1;
  return finalizePair(pair, now);
}

export function markSurfaceClosed(pairValue, tabId, options = {}) {
  return markSurfaceLifecycle(
    pairValue,
    tabId,
    SURFACE_LIFECYCLE_STATES.CLOSED,
    options.reason || "TAB_CLOSED",
    options.now
  );
}

export function markSurfaceMoving(pairValue, tabId, options = {}) {
  return markSurfaceLifecycle(
    pairValue,
    tabId,
    SURFACE_LIFECYCLE_STATES.MOVING,
    options.reason || "TAB_MOVING",
    options.now
  );
}

export function setWebTargetCapabilityState(pairValue, {
  permissionState,
  permissionOriginPattern,
  debuggerState,
  debuggerSessionId,
  reason = "CAPABILITY_STATE_UPDATED",
  now = Date.now()
} = {}) {
  const pair = normalizeSurfacePair(pairValue, {
    windowId: pairValue?.windowId,
    now
  });
  const role = MISSION_SURFACE_ROLES.WEB_TARGET;
  const previous = pair.surfaces[role];
  if (!previous) return pair;
  pair.surfaces[role] = normalizeSurface({
    ...previous,
    permissionState: permissionState ?? previous.permissionState,
    permissionOriginPattern: permissionOriginPattern ?? previous.permissionOriginPattern,
    permissionUpdatedAt: permissionState !== undefined ? nowIso(now) : previous.permissionUpdatedAt,
    debuggerState: debuggerState ?? previous.debuggerState,
    debuggerSessionId: debuggerSessionId ?? previous.debuggerSessionId,
    debuggerUpdatedAt: debuggerState !== undefined ? nowIso(now) : previous.debuggerUpdatedAt,
    lastReason: reason,
    updatedAt: nowIso(now)
  }, role, { windowId: pair.windowId, now });
  pair.revision += 1;
  return finalizePair(pair, now);
}

export function setSurfaceActiveTab(pairValue, activeTabId, {
  now = Date.now()
} = {}) {
  const pair = normalizeSurfacePair(pairValue, {
    windowId: pairValue?.windowId,
    now
  });
  let changed = false;
  for (const role of ROLE_SET) {
    const surface = pair.surfaces[role];
    if (!surface) continue;
    const active = Number(surface.tabId) === Number(activeTabId);
    if (surface.active !== active) {
      surface.active = active;
      surface.updatedAt = nowIso(now);
      changed = true;
    }
  }
  if (changed) pair.revision += 1;
  return finalizePair(pair, now);
}

export function findSurfaceRoleByTab(pairValue, tabId) {
  if (!pairValue?.surfaces) return null;
  for (const role of ROLE_SET) {
    if (Number(pairValue.surfaces[role]?.tabId) === Number(tabId)) return role;
  }
  return null;
}

export function surfacePairMissionBindings(pairValue, modeId = MISSION_MODE_IDS.CHATGPT_CONTINUATION) {
  const pair = normalizeSurfacePair(pairValue, {
    windowId: pairValue?.windowId
  });
  const mode = resolveMissionMode(modeId);
  const controller = pair.surfaces[MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER];
  const target = pair.surfaces[MISSION_SURFACE_ROLES.WEB_TARGET];
  const controllerRequired = mode.requiredSurfaceRoles.includes(
    MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER
  );
  const targetRelevant = [
    ...(mode.requiredSurfaceRoles || []),
    ...(mode.optionalSurfaceRoles || [])
  ].includes(MISSION_SURFACE_ROLES.WEB_TARGET);
  return {
    controllerSurfaceId: controllerRequired && Number.isInteger(controller?.tabId)
      ? controller.surfaceId
      : null,
    targetSurfaceId: targetRelevant && Number.isInteger(target?.tabId)
      ? target.surfaceId
      : null
  };
}
