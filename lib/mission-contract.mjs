import { deepClone } from "./common.mjs";

export const MISSION_SCHEMA = "eic.autonom.mission.v1";
export const MISSION_STORE_SCHEMA = "eic.autonom.mission-store.v1";
export const MISSION_MODE_REGISTRY_SCHEMA = "eic.autonom.mission-mode-registry.v1";

export const MISSION_SURFACE_ROLES = Object.freeze({
  CHATGPT_CONTROLLER: "CHATGPT_CONTROLLER",
  WEB_TARGET: "WEB_TARGET"
});

export const MISSION_BUILD_PROFILES = Object.freeze({
  STANDARD: "STANDARD",
  BROWSER: "BROWSER"
});

export const MISSION_MODE_IDS = Object.freeze({
  CHATGPT_CONTINUATION: "CHATGPT_CONTINUATION",
  CHATGPT_NEW_SESSION: "CHATGPT_NEW_SESSION",
  APP_AUDIT_LONG: "APP_AUDIT_LONG",
  ARCHAEOLOGY_LONG: "ARCHAEOLOGY_LONG",
  AI_WEB_RESEARCH: "AI_WEB_RESEARCH"
});

export const MISSION_POLICY_PROFILES = Object.freeze({
  STANDARD_SAFE: "STANDARD_SAFE",
  AUDIT_READ_MOSTLY: "AUDIT_READ_MOSTLY",
  RESEARCH_READ_MOSTLY: "RESEARCH_READ_MOSTLY",
  BROWSER_RESEARCH_GUARDED: "BROWSER_RESEARCH_GUARDED"
});

export const MISSION_EVIDENCE_PROFILES = Object.freeze({
  CONTINUITY_ONLY: "CONTINUITY_ONLY",
  AUDIT_BOUNDED: "AUDIT_BOUNDED",
  RESEARCH_BOUNDED: "RESEARCH_BOUNDED",
  BROWSER_DIAGNOSTIC_BOUNDED: "BROWSER_DIAGNOSTIC_BOUNDED"
});

function mode({
  modeId,
  title,
  runMode = null,
  buildProfile,
  requiredSurfaceRoles,
  optionalSurfaceRoles = [],
  policyProfile,
  evidenceProfile,
  enabled = true
}) {
  return Object.freeze({
    schema: "eic.autonom.mission-mode.v1",
    version: 1,
    modeId,
    title,
    runMode,
    buildProfile,
    requiredSurfaceRoles: Object.freeze([...requiredSurfaceRoles]),
    optionalSurfaceRoles: Object.freeze([...optionalSurfaceRoles]),
    policyProfile,
    evidenceProfile,
    enabled
  });
}

export const MISSION_MODE_REGISTRY = Object.freeze({
  schema: MISSION_MODE_REGISTRY_SCHEMA,
  version: 1,
  modes: Object.freeze({
    [MISSION_MODE_IDS.CHATGPT_CONTINUATION]: mode({
      modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
      title: "Fortsätt befintlig ChatGPT/EIC-session",
      runMode: "WAITING_CONTINUE",
      buildProfile: MISSION_BUILD_PROFILES.STANDARD,
      requiredSurfaceRoles: [MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER],
      policyProfile: MISSION_POLICY_PROFILES.STANDARD_SAFE,
      evidenceProfile: MISSION_EVIDENCE_PROFILES.CONTINUITY_ONLY
    }),
    [MISSION_MODE_IDS.CHATGPT_NEW_SESSION]: mode({
      modeId: MISSION_MODE_IDS.CHATGPT_NEW_SESSION,
      title: "Starta ny ChatGPT/EIC-session",
      runMode: "NEW_SESSION",
      buildProfile: MISSION_BUILD_PROFILES.STANDARD,
      requiredSurfaceRoles: [MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER],
      policyProfile: MISSION_POLICY_PROFILES.STANDARD_SAFE,
      evidenceProfile: MISSION_EVIDENCE_PROFILES.CONTINUITY_ONLY
    }),
    [MISSION_MODE_IDS.APP_AUDIT_LONG]: mode({
      modeId: MISSION_MODE_IDS.APP_AUDIT_LONG,
      title: "Lång applikationsaudit",
      runMode: "APP_AUDIT_LONG",
      buildProfile: MISSION_BUILD_PROFILES.STANDARD,
      requiredSurfaceRoles: [MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER],
      policyProfile: MISSION_POLICY_PROFILES.AUDIT_READ_MOSTLY,
      evidenceProfile: MISSION_EVIDENCE_PROFILES.AUDIT_BOUNDED
    }),
    [MISSION_MODE_IDS.ARCHAEOLOGY_LONG]: mode({
      modeId: MISSION_MODE_IDS.ARCHAEOLOGY_LONG,
      title: "Lång arkeologi/reverse engineering",
      runMode: "ARCHAEOLOGY_LONG",
      buildProfile: MISSION_BUILD_PROFILES.STANDARD,
      requiredSurfaceRoles: [MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER],
      policyProfile: MISSION_POLICY_PROFILES.RESEARCH_READ_MOSTLY,
      evidenceProfile: MISSION_EVIDENCE_PROFILES.RESEARCH_BOUNDED
    }),
    [MISSION_MODE_IDS.AI_WEB_RESEARCH]: mode({
      modeId: MISSION_MODE_IDS.AI_WEB_RESEARCH,
      title: "AI-webbresearch",
      runMode: null,
      buildProfile: MISSION_BUILD_PROFILES.BROWSER,
      requiredSurfaceRoles: [
        MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER,
        MISSION_SURFACE_ROLES.WEB_TARGET
      ],
      policyProfile: MISSION_POLICY_PROFILES.BROWSER_RESEARCH_GUARDED,
      evidenceProfile: MISSION_EVIDENCE_PROFILES.BROWSER_DIAGNOSTIC_BOUNDED,
      enabled: true
    })
  })
});

const RUN_MODE_INDEX = Object.freeze(
  Object.fromEntries(
    Object.values(MISSION_MODE_REGISTRY.modes)
      .filter((entry) => entry.runMode)
      .map((entry) => [entry.runMode, entry.modeId])
  )
);

export function missionModeForRunMode(runMode) {
  return RUN_MODE_INDEX[String(runMode || "")] || null;
}

export function resolveMissionMode(modeId) {
  const resolved = MISSION_MODE_REGISTRY.modes[String(modeId || "")];
  if (!resolved) throw new Error(`MISSION_MODE_UNKNOWN:${modeId}`);
  return resolved;
}

export function listMissionModes({ includeDisabled = true } = {}) {
  return Object.values(MISSION_MODE_REGISTRY.modes)
    .filter((entry) => includeDisabled || entry.enabled)
    .map((entry) => deepClone(entry));
}

export function createDefaultMissionStore() {
  return {
    schema: MISSION_STORE_SCHEMA,
    version: 1,
    revision: 0,
    missions: {},
    updatedAt: null
  };
}

export function normalizeMissionStore(value) {
  const store = value && typeof value === "object" && !Array.isArray(value)
    ? deepClone(value)
    : createDefaultMissionStore();
  store.schema = MISSION_STORE_SCHEMA;
  store.version = 1;
  store.revision = Math.max(0, Number(store.revision || 0));
  store.missions = store.missions && typeof store.missions === "object" && !Array.isArray(store.missions)
    ? store.missions
    : {};
  store.updatedAt = store.updatedAt || null;
  return store;
}
