import { deepClone } from "./common.mjs";
import {
  CURRENT_NANO_MANDATE,
  CURRENT_TARGET_MANDATE
} from "./core-profiles.mjs";

export const APP_VERSION = "0.12.14";
export const CONFIG_SCHEMA = "eic.autonom.config.v23";
export const CONTINUITY_SCHEMA = "eic.nano.continuity.v5";
export const RUNTIME_SCHEMA = "eic.autonom.runtime.v23";
export const AUDIT_SCHEMA = "eic.autonom.audit.v13";
export const EXPORT_SCHEMA = "eic.autonom.export.v27";
export const CONFIG_VERSION = 23;
export const RUNTIME_VERSION = 23;
export const AUDIT_VERSION = 14;
export const EXPORT_VERSION = 27;
export const CONTENT_SCRIPT_VERSION = "0.12.14";

export const STORAGE_KEYS = Object.freeze({
  CONFIG: "eicAutonomAgent.v1200.config",
  CONTINUITY: "eicAutonomAgent.v1200.continuity",
  CONTINUITY_BACKUP: "eicAutonomAgent.v1200.continuityBackup",
  RUNTIME: "eicAutonomAgent.v1200.runtime",
  AUDIT: "eicAutonomAgent.v1200.audit",
  APPLICATION_LOG: "eicAutonomAgent.v1200.applicationLog",
  FULL_AUDIT_QUEUE: "eicAutonomAgent.v1200.fullAuditQueue"
});


export const TARGET_MODES = Object.freeze({
  FOLLOW: "FOLLOW",
  LOCKED: "LOCKED"
});

export const RUN_MODES = Object.freeze({
  WAITING_CONTINUE: "WAITING_CONTINUE",
  NEW_SESSION: "NEW_SESSION",
  // v0.7.5: long systematic application audit. Orthogonal to the Mjölnar D0–D2 rollout —
  // D2 governs privileged owner-route effects and must not be reused as a test profile.
  APP_AUDIT_LONG: "APP_AUDIT_LONG",
  // v0.8.0: isolated long-running research/reverse-engineering mode.
  ARCHAEOLOGY_LONG: "ARCHAEOLOGY_LONG"
});

export const NANO_WALL_TIMEOUT_MS = 1_800_000;

export const DEFAULT_NANO_MANDATE = CURRENT_NANO_MANDATE;
export const DEFAULT_TARGET_MANDATE = CURRENT_TARGET_MANDATE;

export const DEFAULT_CONFIG = Object.freeze({
  schema: CONFIG_SCHEMA,
  version: CONFIG_VERSION,
  nanoMandate: DEFAULT_NANO_MANDATE,
  nanoMandateProfile: "STANDARD_DELIVERY",
  nanoMandateVersion: "nano-core-v11",
  nanoMandateCanary: "",
  targetMandate: DEFAULT_TARGET_MANDATE,
  targetMandateProfile: "STANDARD_DELIVERY",
  targetMandateVersion: "target-core-v9",
  targetAuthorityScope: "GENERIC",
  activeTaskProjectId: 63,
  continuityViewProfile: "COMPACT",
  scenarioPreset: "VERIFIED_ANALYSIS",
  quickProfileId: "VERIFIED_ANALYSIS",
  quickProfileBinding: null,
  profileRecommendation: null,
  sessionCapturePolicy: "OPTIONAL_OR_INCREMENTAL",
  sessionMemoryPolicy: "SCOPED_REUSE",
  autoSessionCaptureEnabled: true,
  autoApplyCoreSurfaceReviewEnabled: true,
  autoRestartNanoOnChange: true,
  fullAuditLoggingEnabled: false,
  autostartPresetId: "VERIFIED_ANALYSIS",
  newSessionPrompt: "",
  maxAutonomousMode: true,
  backgroundWaitEnabled: true,
  allowTargetAuthoredFallback: true,
  mjolnarEnabled: true,
  mjolnarRolloutMode: "D1_LIVE",
  targetMode: TARGET_MODES.LOCKED,
  maxTurns: 30,
  appAuditTestNeed: "",
  appAuditContext: "",
  appAuditTargetReadOnly: true,
  appAuditAllowWorkbenchFiles: true,
  appAuditAllowForgejoSink: true,
  archaeologyScenario: "GENERAL_RESEARCH",
  archaeologyQuestion: "",
  archaeologyContext: "",
  archaeologyAllowWorkspaceEvidence: true,
  archaeologyAllowExport: true,
  responseTimeoutMs: 7_200_000,
  nanoWallTimeoutMs: NANO_WALL_TIMEOUT_MS,
  mandateRegistry: { schema: "eic.autonom.mandate-registry.v1", entries: {} },
  settleMs: 2_500,
  recoveryBudget: 9,
  promptHistoryLimit: 5,
  uiDensity: "compact",
  defaultMissionModeId: "CHATGPT_CONTINUATION",
  missionPolicyProfile: "STANDARD_SAFE",
  missionEvidenceProfile: "CONTINUITY_ONLY",
  updatedAt: null
});

export function createDefaultConfig() {
  return deepClone(DEFAULT_CONFIG);
}

export function createDefaultRuntime() {
  return {
    schema: RUNTIME_SCHEMA,
    version: RUNTIME_VERSION,
    revision: 0,
    windows: {},
    missionStore: {
      schema: "eic.autonom.mission-store.v1",
      version: 1,
      revision: 0,
      missions: {},
      updatedAt: null
    },
    orphanedRuns: [],
    orphanedContinuities: [],
    orphanedMissions: [],
    orphanedSurfacePairs: [],
    startPromptReceipts: [],
    updatedAt: null
  };
}

export function createDefaultAudit() {
  return {
    schema: AUDIT_SCHEMA,
    version: AUDIT_VERSION,
    items: []
  };
}
