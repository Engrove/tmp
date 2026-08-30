import { nullableInteger } from "./common.mjs";
import { BUILD_PROFILES, exactOriginPattern } from "./build-profile.mjs";

export const CDP_SESSION_SCHEMA = "eic.autonom.cdp-session.v1";
export const CDP_PROTOCOL_VERSION = "1.3";

export const CDP_SESSION_STATES = Object.freeze({
  DETACHED: "DETACHED",
  ATTACHING: "ATTACHING",
  ATTACHED: "ATTACHED",
  DETACHING: "DETACHING",
  STALE: "STALE_REQUIRES_REATTACH",
  ERROR: "ERROR",
  UNAVAILABLE_STANDARD_PROFILE: "UNAVAILABLE_STANDARD_PROFILE"
});

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function id(prefix = "cdp-session") {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function createCdpSession({
  profile = BUILD_PROFILES.STANDARD,
  surface = null,
  now = Date.now()
} = {}) {
  const browser = profile === BUILD_PROFILES.BROWSER;
  return {
    schema: CDP_SESSION_SCHEMA,
    version: 1,
    sessionId: id(),
    state: browser
      ? CDP_SESSION_STATES.DETACHED
      : CDP_SESSION_STATES.UNAVAILABLE_STANDARD_PROFILE,
    tabId: nullableInteger(surface?.tabId),
    surfaceId: surface?.surfaceId ? String(surface.surfaceId) : null,
    documentEpoch: surface?.documentEpoch ? String(surface.documentEpoch) : null,
    origin: surface?.origin ? String(surface.origin) : null,
    originPattern: surface?.url ? exactOriginPattern(surface.url) : null,
    protocolVersion: CDP_PROTOCOL_VERSION,
    attachedAt: null,
    detachedAt: null,
    lastReason: browser ? "CREATED" : "STANDARD_PROFILE",
    lastError: "",
    updatedAt: nowIso(now)
  };
}

export function normalizeCdpSession(value, {
  profile = BUILD_PROFILES.STANDARD,
  surface = null,
  now = Date.now()
} = {}) {
  const base = createCdpSession({ profile, surface, now });
  const source = value && typeof value === "object" ? value : {};
  const allowed = new Set(Object.values(CDP_SESSION_STATES));
  return {
    ...base,
    ...source,
    schema: CDP_SESSION_SCHEMA,
    version: 1,
    state: allowed.has(source.state) ? source.state : base.state,
    tabId: nullableInteger(source.tabId ?? surface?.tabId),
    surfaceId: source.surfaceId || surface?.surfaceId || null,
    documentEpoch: source.documentEpoch || surface?.documentEpoch || null,
    origin: source.origin || surface?.origin || null,
    originPattern: source.originPattern || (surface?.url ? exactOriginPattern(surface.url) : null),
    protocolVersion: CDP_PROTOCOL_VERSION,
    updatedAt: source.updatedAt || nowIso(now)
  };
}

export function cdpSessionMatchesSurface(sessionValue, surface) {
  const session = sessionValue || {};
  const sessionTabId = nullableInteger(session.tabId);
  const surfaceTabId = nullableInteger(surface?.tabId);
  return Boolean(
    sessionTabId !== null &&
    surfaceTabId !== null &&
    sessionTabId === surfaceTabId &&
    String(session.surfaceId || "") === String(surface.surfaceId || "") &&
    String(session.documentEpoch || "") === String(surface.documentEpoch || "") &&
    String(session.origin || "") === String(surface.origin || "")
  );
}

function assertAttachPreconditions({ profile, surface, permissionGranted }) {
  if (profile !== BUILD_PROFILES.BROWSER) throw new Error("CDP_BROWSER_PROFILE_REQUIRED");
  if (nullableInteger(surface?.tabId) === null) throw new Error("CDP_TARGET_TAB_REQUIRED");
  if (!surface?.surfaceId || !surface?.documentEpoch) throw new Error("CDP_TARGET_IDENTITY_REQUIRED");
  if (surface.lifecycleState !== "READY") throw new Error(`CDP_TARGET_NOT_READY:${surface.lifecycleState || "UNKNOWN"}`);
  exactOriginPattern(surface.url || surface.origin);
  if (!permissionGranted) throw new Error("CDP_EXACT_ORIGIN_PERMISSION_REQUIRED");
}

export async function attachBoundedCdp(chromeApi, {
  profile,
  surface,
  permissionGranted,
  now = Date.now()
} = {}) {
  assertAttachPreconditions({ profile, surface, permissionGranted });
  if (!chromeApi?.debugger?.attach) throw new Error("CDP_DEBUGGER_API_UNAVAILABLE");
  const session = createCdpSession({ profile, surface, now });
  session.state = CDP_SESSION_STATES.ATTACHING;
  session.lastReason = "EXPLICIT_ATTACH";
  await chromeApi.debugger.attach({ tabId: nullableInteger(surface.tabId) }, CDP_PROTOCOL_VERSION);
  session.state = CDP_SESSION_STATES.ATTACHED;
  session.attachedAt = nowIso(now);
  session.updatedAt = session.attachedAt;
  return session;
}

export async function detachBoundedCdp(chromeApi, sessionValue, {
  reason = "EXPLICIT_DETACH",
  now = Date.now(),
  tolerateMissing = true
} = {}) {
  const session = normalizeCdpSession(sessionValue, {
    profile: BUILD_PROFILES.BROWSER,
    now
  });
  session.state = CDP_SESSION_STATES.DETACHING;
  try {
    if (nullableInteger(session.tabId) !== null && chromeApi?.debugger?.detach) {
      await chromeApi.debugger.detach({ tabId: nullableInteger(session.tabId) });
    }
  } catch (error) {
    if (!tolerateMissing) throw error;
    session.lastError = String(error?.message || error);
  }
  session.state = CDP_SESSION_STATES.DETACHED;
  session.detachedAt = nowIso(now);
  session.lastReason = reason;
  session.updatedAt = session.detachedAt;
  return session;
}

export function markCdpSessionStale(sessionValue, {
  reason = "TARGET_IDENTITY_CHANGED",
  now = Date.now()
} = {}) {
  const session = normalizeCdpSession(sessionValue, {
    profile: BUILD_PROFILES.BROWSER,
    now
  });
  session.state = CDP_SESSION_STATES.STALE;
  session.lastReason = reason;
  session.updatedAt = nowIso(now);
  return session;
}
