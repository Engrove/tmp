import { deepClone, nowIso, nullableInteger, randomId, sanitizeText } from "./common.mjs";
import {
  DIRECT_MISSION_ADAPTER,
  CURRENT_RUN_ADAPTER,
  MISSION_EXECUTION_OWNER
} from "./mission-mode-adapter.mjs";
import {
  MISSION_EVIDENCE_PROFILES,
  MISSION_MODE_IDS,
  MISSION_POLICY_PROFILES,
  MISSION_SCHEMA,
  MISSION_STORE_SCHEMA,
  MISSION_SURFACE_ROLES,
  createDefaultMissionStore,
  missionModeForRunMode,
  normalizeMissionStore,
  resolveMissionMode
} from "./mission-contract.mjs";
import { surfacePairMissionBindings } from "./surface-pair.mjs";
import { deriveRunNextAction, deriveRunWorkUnit } from "./runtime-hardening.mjs";

export const MISSION_STATES = Object.freeze({
  DRAFT: "DRAFT",
  READY: "READY",
  RUNNING: "RUNNING",
  WAITING_TARGET: "WAITING_TARGET",
  WAITING_EVIDENCE: "WAITING_EVIDENCE",
  RECOVERING: "RECOVERING",
  PAUSED: "PAUSED",
  BLOCKED: "BLOCKED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED"
});

export const MISSION_TERMINAL_STATES = new Set([
  MISSION_STATES.COMPLETED,
  MISSION_STATES.FAILED,
  MISSION_STATES.CANCELLED
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  [MISSION_STATES.DRAFT]: new Set([
    MISSION_STATES.READY, MISSION_STATES.BLOCKED, MISSION_STATES.CANCELLED
  ]),
  [MISSION_STATES.READY]: new Set([
    MISSION_STATES.RUNNING, MISSION_STATES.PAUSED,
    MISSION_STATES.BLOCKED, MISSION_STATES.CANCELLED
  ]),
  [MISSION_STATES.RUNNING]: new Set([
    MISSION_STATES.WAITING_TARGET, MISSION_STATES.WAITING_EVIDENCE,
    MISSION_STATES.RECOVERING, MISSION_STATES.PAUSED,
    MISSION_STATES.BLOCKED, MISSION_STATES.COMPLETED,
    MISSION_STATES.FAILED, MISSION_STATES.CANCELLED
  ]),
  [MISSION_STATES.WAITING_TARGET]: new Set([
    MISSION_STATES.RUNNING, MISSION_STATES.WAITING_EVIDENCE,
    MISSION_STATES.RECOVERING, MISSION_STATES.PAUSED,
    MISSION_STATES.BLOCKED, MISSION_STATES.COMPLETED,
    MISSION_STATES.FAILED, MISSION_STATES.CANCELLED
  ]),
  [MISSION_STATES.WAITING_EVIDENCE]: new Set([
    MISSION_STATES.RUNNING, MISSION_STATES.WAITING_TARGET,
    MISSION_STATES.RECOVERING, MISSION_STATES.PAUSED,
    MISSION_STATES.BLOCKED, MISSION_STATES.COMPLETED,
    MISSION_STATES.FAILED, MISSION_STATES.CANCELLED
  ]),
  [MISSION_STATES.RECOVERING]: new Set([
    MISSION_STATES.RUNNING, MISSION_STATES.WAITING_TARGET,
    MISSION_STATES.WAITING_EVIDENCE, MISSION_STATES.PAUSED,
    MISSION_STATES.BLOCKED, MISSION_STATES.FAILED,
    MISSION_STATES.CANCELLED
  ]),
  [MISSION_STATES.PAUSED]: new Set([
    MISSION_STATES.READY, MISSION_STATES.RUNNING,
    MISSION_STATES.RECOVERING, MISSION_STATES.BLOCKED,
    MISSION_STATES.CANCELLED
  ]),
  [MISSION_STATES.BLOCKED]: new Set([
    MISSION_STATES.READY, MISSION_STATES.RECOVERING,
    MISSION_STATES.CANCELLED
  ]),
  [MISSION_STATES.COMPLETED]: new Set(),
  [MISSION_STATES.FAILED]: new Set(),
  [MISSION_STATES.CANCELLED]: new Set()
});

const LEGACY_STATE_MAP = Object.freeze({
  IDLE: MISSION_STATES.READY,
  PREPARING: MISSION_STATES.RUNNING,
  WAITING_FOR_RESPONSE: MISSION_STATES.WAITING_TARGET,
  WAITING_FOREGROUND: MISSION_STATES.WAITING_TARGET,
  WAITING_BACKGROUND: MISSION_STATES.WAITING_TARGET,
  ASSESSING: MISSION_STATES.WAITING_EVIDENCE,
  CONTINUING: MISSION_STATES.RUNNING,
  RECOVERING: MISSION_STATES.RECOVERING,
  SOFT_PAUSED: MISSION_STATES.PAUSED,
  PROGRAM_BLOCKED: MISSION_STATES.BLOCKED,
  HARD_BLOCKED: MISSION_STATES.BLOCKED,
  PROGRAM_DONE: MISSION_STATES.COMPLETED,
  DONE: MISSION_STATES.COMPLETED,
  STOPPED: MISSION_STATES.CANCELLED,
  ERROR_RETRYABLE: MISSION_STATES.RECOVERING,
  ERROR_TERMINAL: MISSION_STATES.FAILED,
  MJOLNAR_ADJUDICATING: MISSION_STATES.WAITING_EVIDENCE,
  MJOLNAR_DISPATCH: MISSION_STATES.RUNNING,
  MJOLNAR_READBACK: MISSION_STATES.WAITING_EVIDENCE,
  AWAITING_OPERATOR_ACTION: MISSION_STATES.PAUSED,
  AWAITING_OPERATOR_DECISION: MISSION_STATES.PAUSED,
  HUMAN_REQUIRED: MISSION_STATES.PAUSED
});

function text(value, max = 600) {
  return sanitizeText(value || "", max);
}

function normalizeStringArray(value, maxItems = 64, maxChars = 400) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => text(item, maxChars))
    .filter(Boolean))]
    .slice(0, maxItems);
}

function defaultEvidencePolicy(mode) {
  return {
    schema: "eic.autonom.mission-evidence-policy.v1",
    profileId: mode.evidenceProfile || MISSION_EVIDENCE_PROFILES.CONTINUITY_ONLY,
    bounded: true,
    responseBodies: false,
    redactBeforePersist: true
  };
}

function applySurfacePairBindings(missionValue, surfacePair) {
  const mission = missionValue;
  if (!surfacePair) return mission;
  const bindings = surfacePairMissionBindings(surfacePair, mission.modeId);
  mission.controllerSurfaceId = bindings.controllerSurfaceId;
  mission.targetSurfaceId = bindings.targetSurfaceId;
  mission.surfaceRoles = {
    [MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER]: bindings.controllerSurfaceId,
    [MISSION_SURFACE_ROLES.WEB_TARGET]: bindings.targetSurfaceId
  };
  return mission;
}

function normalizeMissionInput(value, modeId) {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? deepClone(value)
    : {};
  input.schema = "eic.autonom.mission-input.v1";
  input.version = 1;
  input.modeId = modeId;
  return input;
}

function normalizeMissionExecution(value, {
  adapterRunId = null,
  adapterRunMode = null,
  now = Date.now()
} = {}) {
  const execution = value && typeof value === "object" && !Array.isArray(value)
    ? deepClone(value)
    : {};
  execution.schema = "eic.autonom.mission-execution.v1";
  execution.version = 1;
  execution.owner = MISSION_EXECUTION_OWNER;
  execution.adapter = execution.adapter ||
    (adapterRunId || execution.adapterRunId ? CURRENT_RUN_ADAPTER : DIRECT_MISSION_ADAPTER);
  if (![CURRENT_RUN_ADAPTER, DIRECT_MISSION_ADAPTER].includes(execution.adapter)) {
    execution.adapter = adapterRunId || execution.adapterRunId
      ? CURRENT_RUN_ADAPTER
      : DIRECT_MISSION_ADAPTER;
  }
  execution.adapterRunId = adapterRunId || execution.adapterRunId || null;
  execution.adapterRunMode = adapterRunMode || execution.adapterRunMode || null;
  execution.status = text(execution.status || (execution.adapterRunId ? "BOUND" : "READY"), 80);
  execution.lastSynchronizedAt = execution.lastSynchronizedAt || nowIso(now);
  return execution;
}

export function canTransitionMission(from, to) {
  if (from === to) return true;
  return Boolean(ALLOWED_TRANSITIONS[from]?.has(to));
}

export function transitionMission(missionValue, to, {
  reason = "",
  currentStep,
  nextAction,
  force = false,
  now = Date.now()
} = {}) {
  const mission = normalizeMission(missionValue);
  if (!Object.values(MISSION_STATES).includes(to)) {
    throw new Error(`MISSION_STATE_UNKNOWN:${to}`);
  }
  if (!force && !canTransitionMission(mission.state, to)) {
    throw new Error(`MISSION_TRANSITION_NOT_ALLOWED:${mission.state}->${to}`);
  }
  if (mission.state !== to) mission.stateRevision = Number(mission.stateRevision || 0) + 1;
  mission.state = to;
  if (currentStep !== undefined) mission.currentStep = text(currentStep, 800);
  if (nextAction !== undefined) mission.nextAction = text(nextAction, 1200);
  mission.stateReason = text(reason, 1200);
  mission.updatedAt = nowIso(now);
  if (MISSION_TERMINAL_STATES.has(to)) mission.completedAt ||= nowIso(now);
  return mission;
}

export function runStateToMissionState(runState) {
  return LEGACY_STATE_MAP[String(runState || "")] || MISSION_STATES.BLOCKED;
}

export function createMission({
  missionId = randomId("mission"),
  modeId = MISSION_MODE_IDS.CHATGPT_CONTINUATION,
  state = MISSION_STATES.DRAFT,
  windowId = null,
  currentStep = "",
  nextAction = "",
  controllerSurfaceId = null,
  targetSurfaceId = null,
  policyProfile = null,
  evidencePolicy = null,
  originGrants = [],
  input = null,
  execution = null,
  runBinding = null,
  now = Date.now()
} = {}) {
  const mode = resolveMissionMode(modeId);
  if (!Object.values(MISSION_STATES).includes(state)) throw new Error(`MISSION_STATE_UNKNOWN:${state}`);
  const mission = {
    schema: MISSION_SCHEMA,
    version: 1,
    missionId: String(missionId),
    modeId: mode.modeId,
    state,
    stateRevision: 0,
    stateReason: "",
    windowId: nullableInteger(windowId) !== null ? Number(windowId) : null,
    currentStep: text(currentStep, 800),
    nextAction: text(nextAction, 1200),
    controllerSurfaceId: controllerSurfaceId ? String(controllerSurfaceId) : null,
    targetSurfaceId: targetSurfaceId ? String(targetSurfaceId) : null,
    surfaceRoles: {
      [MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER]: controllerSurfaceId ? String(controllerSurfaceId) : null,
      [MISSION_SURFACE_ROLES.WEB_TARGET]: targetSurfaceId ? String(targetSurfaceId) : null
    },
    policyProfile: policyProfile || mode.policyProfile || MISSION_POLICY_PROFILES.STANDARD_SAFE,
    originGrants: normalizeStringArray(originGrants, 64, 500),
    risk: {
      schema: "eic.autonom.mission-risk.v1",
      status: "UNASSESSED",
      level: null,
      approvalRequired: false,
      reason: ""
    },
    approval: {
      schema: "eic.autonom.mission-approval.v1",
      state: "NOT_REQUIRED",
      requestId: null,
      reason: ""
    },
    evidencePolicy: evidencePolicy ? deepClone(evidencePolicy) : defaultEvidencePolicy(mode),
    evidenceIndex: [],
    receipts: [],
    recovery: {
      schema: "eic.autonom.mission-recovery.v1",
      state: "IDLE",
      reason: "",
      attempts: []
    },
    input: normalizeMissionInput(input, mode.modeId),
    execution: normalizeMissionExecution(execution, { now }),
    runBinding: runBinding ? deepClone(runBinding) : null,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    completedAt: null
  };
  return normalizeMission(mission);
}

export function normalizeMission(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MISSION_INVALID");
  }
  const mode = resolveMissionMode(value.modeId);
  const mission = deepClone(value);
  mission.schema = MISSION_SCHEMA;
  mission.version = 1;
  mission.missionId = String(mission.missionId || randomId("mission"));
  mission.modeId = mode.modeId;
  mission.state = Object.values(MISSION_STATES).includes(mission.state)
    ? mission.state
    : MISSION_STATES.BLOCKED;
  mission.stateRevision = Math.max(0, Number(mission.stateRevision || 0));
  mission.stateReason = text(mission.stateReason, 1200);
  mission.windowId = nullableInteger(mission.windowId) !== null ? Number(mission.windowId) : null;
  mission.currentStep = text(mission.currentStep, 800);
  mission.nextAction = text(mission.nextAction, 1200);
  mission.controllerSurfaceId = mission.controllerSurfaceId ? String(mission.controllerSurfaceId) : null;
  mission.targetSurfaceId = mission.targetSurfaceId ? String(mission.targetSurfaceId) : null;
  mission.surfaceRoles = {
    [MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER]: mission.controllerSurfaceId,
    [MISSION_SURFACE_ROLES.WEB_TARGET]: mission.targetSurfaceId
  };
  mission.policyProfile = mission.policyProfile || mode.policyProfile || MISSION_POLICY_PROFILES.STANDARD_SAFE;
  mission.originGrants = normalizeStringArray(mission.originGrants, 64, 500);
  mission.risk = mission.risk && typeof mission.risk === "object" ? mission.risk : {};
  mission.risk = {
    schema: "eic.autonom.mission-risk.v1",
    status: text(mission.risk.status || "UNASSESSED", 80),
    level: Number.isFinite(Number(mission.risk.level)) ? Number(mission.risk.level) : null,
    approvalRequired: Boolean(mission.risk.approvalRequired),
    reason: text(mission.risk.reason, 1200)
  };
  mission.approval = mission.approval && typeof mission.approval === "object" ? mission.approval : {};
  mission.approval = {
    schema: "eic.autonom.mission-approval.v1",
    state: text(mission.approval.state || "NOT_REQUIRED", 80),
    requestId: mission.approval.requestId ? String(mission.approval.requestId) : null,
    reason: text(mission.approval.reason, 1200)
  };
  mission.evidencePolicy = mission.evidencePolicy && typeof mission.evidencePolicy === "object"
    ? mission.evidencePolicy
    : defaultEvidencePolicy(mode);
  mission.evidencePolicy = {
    schema: "eic.autonom.mission-evidence-policy.v1",
    profileId: text(mission.evidencePolicy.profileId || mode.evidenceProfile, 120),
    bounded: mission.evidencePolicy.bounded !== false,
    responseBodies: Boolean(mission.evidencePolicy.responseBodies),
    redactBeforePersist: mission.evidencePolicy.redactBeforePersist !== false
  };
  mission.evidenceIndex = Array.isArray(mission.evidenceIndex) ? deepClone(mission.evidenceIndex).slice(-128) : [];
  mission.receipts = Array.isArray(mission.receipts) ? deepClone(mission.receipts).slice(-128) : [];
  mission.recovery = mission.recovery && typeof mission.recovery === "object" ? mission.recovery : {};
  mission.recovery = {
    schema: "eic.autonom.mission-recovery.v1",
    state: text(mission.recovery.state || "IDLE", 80),
    reason: text(mission.recovery.reason, 1200),
    attempts: Array.isArray(mission.recovery.attempts) ? deepClone(mission.recovery.attempts).slice(-32) : []
  };
  mission.input = normalizeMissionInput(mission.input, mode.modeId);
  mission.execution = normalizeMissionExecution(mission.execution, {
    adapterRunId: mission.runBinding?.runId || mission.execution?.adapterRunId || null,
    adapterRunMode: mission.runBinding?.runMode || mission.execution?.adapterRunMode || null
  });
  mission.runBinding = mission.runBinding && typeof mission.runBinding === "object"
    ? deepClone(mission.runBinding)
    : null;
  mission.createdAt ||= nowIso();
  mission.updatedAt ||= mission.createdAt;
  mission.completedAt ||= null;
  return mission;
}

export function createMissionFromRun(run, {
  windowId,
  selectedTabId = null,
  surfacePair = null,
  input = null,
  now = Date.now()
} = {}) {
  if (!run || typeof run !== "object") return null;
  const modeId = missionModeForRunMode(run.mode) || MISSION_MODE_IDS.CHATGPT_CONTINUATION;
  const mission = createMission({
    modeId,
    state: runStateToMissionState(run.state),
    windowId,
    currentStep: run.activeWorkUnit || run.currentStep || "",
    nextAction: run.resumePlan?.nextAction || run.nextAction || "",
    input: input || run.missionInput || {
      schema: "eic.autonom.mission-input.v1",
      version: 1,
      modeId,
      activation: "CURRENT_RUN_ADOPTION"
    },
    execution: {
      schema: "eic.autonom.mission-execution.v1",
      version: 1,
      owner: MISSION_EXECUTION_OWNER,
      adapter: CURRENT_RUN_ADAPTER,
      adapterRunId: run.runId || null,
      adapterRunMode: run.mode || null,
      status: "BOUND",
      lastSynchronizedAt: nowIso(now)
    },
    runBinding: {
      schema: "eic.autonom.legacy-run-binding.v1",
      runId: run.runId || null,
      runMode: run.mode || null,
      runState: run.state || null,
      selectedTabId: nullableInteger(selectedTabId) !== null ? Number(selectedTabId) : null,
      targetTabId: nullableInteger(run.targetTabId) !== null ? Number(run.targetTabId) : null,
      conversationKey: text(run.conversationKey, 1000),
      syncedAt: nowIso(now)
    },
    now
  });
  return normalizeMission(applySurfacePairBindings(mission, surfacePair));
}

function findMissionForRun(store, run) {
  if (!run?.runId) return null;
  if (run.missionId && store.missions?.[run.missionId]) {
    return store.missions[run.missionId];
  }
  return Object.values(store.missions || {}).find(
    (mission) =>
      mission?.execution?.adapterRunId === run.runId ||
      mission?.runBinding?.runId === run.runId
  ) || null;
}

export function synchronizeMissionFromRun(missionValue, run, {
  selectedTabId = null,
  surfacePair = null,
  now = Date.now()
} = {}) {
  const mission = normalizeMission(missionValue);
  if (!run || typeof run !== "object") return mission;

  const adapterModeId = missionModeForRunMode(run.mode);
  const expectedMode = resolveMissionMode(mission.modeId);
  const modeMismatch = !adapterModeId ||
    adapterModeId !== mission.modeId ||
    expectedMode.runMode !== run.mode;

  mission.execution = normalizeMissionExecution(mission.execution, {
    adapterRunId: run.runId || null,
    adapterRunMode: run.mode || null,
    now
  });
  mission.execution.lastSynchronizedAt = nowIso(now);

  mission.runBinding = {
    schema: "eic.autonom.legacy-run-binding.v1",
    runId: run.runId || null,
    runMode: run.mode || null,
    runState: run.state || null,
    selectedTabId: nullableInteger(selectedTabId) !== null ? Number(selectedTabId) : null,
    targetTabId: nullableInteger(run.targetTabId) !== null ? Number(run.targetTabId) : null,
    conversationKey: text(run.conversationKey, 1000),
    syncedAt: nowIso(now)
  };

  if (modeMismatch) {
    mission.state = MISSION_STATES.BLOCKED;
    mission.stateReason = `MISSION_ADAPTER_MODE_MISMATCH:${mission.modeId}:${run.mode || "UNKNOWN"}`;
    mission.execution.status = "ADAPTER_MODE_MISMATCH";
    mission.updatedAt = nowIso(now);
    return normalizeMission(applySurfacePairBindings(mission, surfacePair));
  }

  const priorProjection = JSON.stringify({
    state: mission.state,
    stateReason: mission.stateReason,
    currentStep: mission.currentStep,
    nextAction: mission.nextAction,
    risk: mission.risk,
    approval: mission.approval
  });
  mission.state = runStateToMissionState(run.state);
  mission.stateReason = text(run.lastTransition?.reason || mission.stateReason, 1200);
  mission.currentStep = text(deriveRunWorkUnit(run) || mission.currentStep, 800);
  mission.nextAction = text(deriveRunNextAction(run) || mission.nextAction, 1200);
  const riskLevel = Number(run.destructiveness?.level);
  const humanRequired = run.destructiveness?.humanDecisionRequired === true ||
    Number.isFinite(riskLevel) && riskLevel >= 10;
  mission.risk = {
    schema: "eic.autonom.mission-risk.v1",
    status: run.destructiveness?.classified ? "ASSESSED" : "UNASSESSED",
    level: Number.isFinite(riskLevel) ? riskLevel : null,
    approvalRequired: humanRequired,
    reason: text(
      run.destructiveness?.rationale ||
      run.destructiveness?.reasonCode ||
      mission.risk?.reason,
      1200
    )
  };
  mission.approval = {
    schema: "eic.autonom.mission-approval.v1",
    state: humanRequired ? "REQUIRED" : "NOT_REQUIRED",
    requestId: humanRequired
      ? String(run.operatorDecision?.decisionId || run.operatorAction?.actionId || "")
      : null,
    reason: humanRequired
      ? text(run.pause?.reason || "LEVEL_10_HUMAN_AUTHORITY_REQUIRED", 1200)
      : ""
  };
  mission.execution.status = MISSION_TERMINAL_STATES.has(mission.state)
    ? "TERMINAL"
    : run.pendingNanoRequest
      ? "NANO_RUNNING"
      : "BOUND";
  const nextProjection = JSON.stringify({
    state: mission.state,
    stateReason: mission.stateReason,
    currentStep: mission.currentStep,
    nextAction: mission.nextAction,
    risk: mission.risk,
    approval: mission.approval
  });
  if (nextProjection !== priorProjection) {
    mission.stateRevision = Number(mission.stateRevision || 0) + 1;
  }
  mission.updatedAt = nowIso(now);
  if (MISSION_TERMINAL_STATES.has(mission.state)) mission.completedAt ||= nowIso(now);
  return normalizeMission(applySurfacePairBindings(mission, surfacePair));
}


export function activateMissionForRun(runtimeValue, context, run, {
  modeId,
  input = null,
  selectedTabId = null,
  now = Date.now()
} = {}) {
  if (!runtimeValue || typeof runtimeValue !== "object") throw new Error("MISSION_RUNTIME_INVALID");
  if (!context || typeof context !== "object") throw new Error("MISSION_CONTEXT_INVALID");
  if (!run || typeof run !== "object" || !run.runId) throw new Error("MISSION_ADAPTER_RUN_INVALID");

  const mode = resolveMissionMode(modeId);
  if (!mode.enabled) throw new Error(`MISSION_MODE_DISABLED:${mode.modeId}`);
  if (!mode.runMode) throw new Error(`MISSION_MODE_HAS_NO_LEGACY_ADAPTER:${mode.modeId}`);
  if (mode.runMode !== run.mode) {
    throw new Error(`MISSION_ADAPTER_MODE_MISMATCH:${mode.modeId}:${run.mode || "UNKNOWN"}`);
  }

  const store = normalizeMissionStore(runtimeValue.missionStore);
  runtimeValue.missionStore = store;
  context.missionIds = normalizeStringArray(context.missionIds, 128, 180);
  context.activeMissionId = context.activeMissionId ? String(context.activeMissionId) : null;

  const active = context.activeMissionId ? store.missions[context.activeMissionId] : null;
  if (active && !MISSION_TERMINAL_STATES.has(active.state) &&
      active.execution?.adapterRunId !== run.runId) {
    throw new Error(`MISSION_ACTIVE_EXISTS:${active.missionId}`);
  }

  let mission = createMission({
    modeId: mode.modeId,
    state: MISSION_STATES.READY,
    windowId: context.windowId,
    currentStep: run.activeWorkUnit || run.currentStep || "",
    nextAction: run.resumePlan?.nextAction || run.nextAction || "",
    input,
    execution: {
      owner: MISSION_EXECUTION_OWNER,
      adapter: CURRENT_RUN_ADAPTER,
      adapterRunId: run.runId,
      adapterRunMode: run.mode,
      status: "BOUND",
      lastSynchronizedAt: nowIso(now)
    },
    runBinding: {
      schema: "eic.autonom.legacy-run-binding.v1",
      runId: run.runId,
      runMode: run.mode,
      runState: run.state || null,
      selectedTabId: nullableInteger(selectedTabId) !== null ? Number(selectedTabId) : null,
      targetTabId: nullableInteger(run.targetTabId) !== null ? Number(run.targetTabId) : null,
      conversationKey: text(run.conversationKey, 1000),
      syncedAt: nowIso(now)
    },
    now
  });

  run.missionId = mission.missionId;
  run.missionModeId = mode.modeId;
  run.missionInput = deepClone(mission.input);
  mission = synchronizeMissionFromRun(mission, run, {
    selectedTabId,
    surfacePair: context.surfacePair,
    now
  });

  store.missions[mission.missionId] = mission;
  context.activeMissionId = mission.missionId;
  if (!context.missionIds.includes(mission.missionId)) context.missionIds.push(mission.missionId);
  context.missionIds = context.missionIds.slice(-128);
  store.revision = Number(store.revision || 0) + 1;
  store.updatedAt = nowIso(now);
  return { mission, run, created: true };
}

export function activateStandaloneMission(runtimeValue, context, {
  modeId,
  input = null,
  state = MISSION_STATES.RUNNING,
  currentStep = "",
  nextAction = "",
  originGrants = [],
  now = Date.now()
} = {}) {
  if (!runtimeValue || typeof runtimeValue !== "object") throw new Error("MISSION_RUNTIME_INVALID");
  if (!context || typeof context !== "object") throw new Error("MISSION_CONTEXT_INVALID");
  const mode = resolveMissionMode(modeId);
  if (!mode.enabled) throw new Error(`MISSION_MODE_DISABLED:${mode.modeId}`);
  if (mode.runMode) throw new Error(`MISSION_MODE_REQUIRES_LEGACY_ADAPTER:${mode.modeId}`);
  if (!Object.values(MISSION_STATES).includes(state)) throw new Error(`MISSION_STATE_UNKNOWN:${state}`);

  const store = normalizeMissionStore(runtimeValue.missionStore);
  runtimeValue.missionStore = store;
  context.missionIds = normalizeStringArray(context.missionIds, 128, 180);
  context.activeMissionId = context.activeMissionId ? String(context.activeMissionId) : null;
  const active = context.activeMissionId ? store.missions[context.activeMissionId] : null;
  if (active && !MISSION_TERMINAL_STATES.has(active.state)) {
    throw new Error(`MISSION_ACTIVE_EXISTS:${active.missionId}`);
  }

  let mission = createMission({
    modeId: mode.modeId,
    state,
    windowId: context.windowId,
    currentStep,
    nextAction,
    originGrants,
    input,
    execution: {
      owner: MISSION_EXECUTION_OWNER,
      adapter: DIRECT_MISSION_ADAPTER,
      adapterRunId: null,
      adapterRunMode: null,
      status: "ACTIVE",
      lastSynchronizedAt: nowIso(now)
    },
    now
  });
  mission = normalizeMission(applySurfacePairBindings(mission, context.surfacePair));
  for (const role of mode.requiredSurfaceRoles || []) {
    if (!mission.surfaceRoles?.[role]) {
      throw new Error(`MISSION_REQUIRED_SURFACE_MISSING:${role}`);
    }
  }
  store.missions[mission.missionId] = mission;
  context.activeMissionId = mission.missionId;
  if (!context.missionIds.includes(mission.missionId)) context.missionIds.push(mission.missionId);
  context.missionIds = context.missionIds.slice(-128);
  store.revision = Number(store.revision || 0) + 1;
  store.updatedAt = nowIso(now);
  return { mission, created: true };
}

export function reconcileWindowMission(runtimeValue, context, {
  now = Date.now()
} = {}) {
  const runtime = runtimeValue;
  runtime.missionStore = normalizeMissionStore(runtime.missionStore);
  context.missionIds = normalizeStringArray(context.missionIds, 128, 180);
  context.activeMissionId = context.activeMissionId ? String(context.activeMissionId) : null;

  if (!context.run) {
    if (context.activeMissionId && !runtime.missionStore.missions[context.activeMissionId]) {
      context.activeMissionId = null;
    }
    return { changed: false, mission: context.activeMissionId
      ? runtime.missionStore.missions[context.activeMissionId] || null
      : null };
  }

  let mission = context.activeMissionId
    ? runtime.missionStore.missions[context.activeMissionId]
    : null;
  if (!mission ||
      (mission?.execution?.adapterRunId !== context.run.runId &&
       mission?.runBinding?.runId !== context.run.runId)) {
    mission = findMissionForRun(runtime.missionStore, context.run);
  }

  let created = false;
  if (!mission) {
    mission = createMissionFromRun(context.run, {
      windowId: context.windowId,
      selectedTabId: context.selectedTabId,
      surfacePair: context.surfacePair,
      input: context.run.missionInput || null,
      now
    });
    context.run.missionId = mission.missionId;
    context.run.missionModeId = mission.modeId;
    context.run.missionInput = deepClone(mission.input);
    created = true;
  } else {
    mission = synchronizeMissionFromRun(mission, context.run, {
      selectedTabId: context.selectedTabId,
      surfacePair: context.surfacePair,
      now
    });
  }

  runtime.missionStore.missions[mission.missionId] = mission;
  context.activeMissionId = mission.missionId;
  if (!context.missionIds.includes(mission.missionId)) context.missionIds.push(mission.missionId);
  context.missionIds = context.missionIds.slice(-128);
  runtime.missionStore.revision = Number(runtime.missionStore.revision || 0) + (created ? 1 : 0);
  runtime.missionStore.updatedAt = nowIso(now);
  return { changed: true, created, mission };
}

export function reconcileRuntimeMissions(runtime, {
  now = Date.now()
} = {}) {
  runtime.missionStore = normalizeMissionStore(runtime.missionStore || createDefaultMissionStore());
  let changed = false;
  for (const context of Object.values(runtime.windows || {})) {
    if (!context || typeof context !== "object") continue;
    const result = reconcileWindowMission(runtime, context, { now });
    changed ||= result.changed;
  }
  return { runtime, changed };
}

export function missionViewForWindow(runtimeValue, windowId) {
  const runtime = runtimeValue || {};
  const store = normalizeMissionStore(runtime.missionStore);
  const context = runtime.windows?.[String(windowId)] || {};
  const missionIds = normalizeStringArray(context.missionIds, 128, 180)
    .filter((missionId) => Boolean(store.missions[missionId]));
  const activeMissionId = missionIds.includes(context.activeMissionId)
    ? context.activeMissionId
    : null;
  const missions = Object.fromEntries(
    missionIds.map((missionId) => [missionId, normalizeMission(store.missions[missionId])])
  );
  return {
    schema: "eic.autonom.mission-view.v1",
    version: 1,
    activeMissionId,
    missionIds,
    missions
  };
}

export function importMissionView(runtimeValue, context, view, {
  now = Date.now()
} = {}) {
  if (!view) return { imported: 0, activeMissionId: context.activeMissionId || null };
  if (view.schema !== "eic.autonom.mission-view.v1" || Number(view.version) !== 1) {
    throw new Error("MISSION_VIEW_SCHEMA_UNSUPPORTED");
  }
  const store = normalizeMissionStore(runtimeValue.missionStore);
  runtimeValue.missionStore = store;
  const sourceIds = normalizeStringArray(view.missionIds, 128, 180);
  const importedIds = [];
  for (const sourceId of sourceIds) {
    const raw = view.missions?.[sourceId];
    if (!raw) continue;
    let mission = normalizeMission(raw);
    mission.windowId = Number(context.windowId);
    if (store.missions[mission.missionId] &&
        store.missions[mission.missionId]?.runBinding?.runId !== mission.runBinding?.runId) {
      mission.missionId = randomId("mission-import");
    }
    mission.updatedAt = nowIso(now);
    store.missions[mission.missionId] = mission;
    importedIds.push(mission.missionId);
  }
  context.missionIds = [...new Set([...(context.missionIds || []), ...importedIds])].slice(-128);
  const requestedActive = view.activeMissionId && view.missions?.[view.activeMissionId]
    ? importedIds.find((id) => id === view.activeMissionId) || null
    : null;
  if (requestedActive) context.activeMissionId = requestedActive;
  store.revision = Number(store.revision || 0) + (importedIds.length ? 1 : 0);
  store.updatedAt = nowIso(now);
  return { imported: importedIds.length, activeMissionId: context.activeMissionId || null };
}
