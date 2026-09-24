import "./lib/safety-policy.js";
import { readSafety, usageSummary, budgetDecision, reserveUsage, authorizeUsageSend, recordUsageOutput, usageIdentity, observeProviderQuota, probeProviderRecovery, updateSafetyPolicy, pauseAdmission } from "./lib/usage-governor.mjs";
import { conversationKey, reconcileRestart } from "./lib/restart-recovery.mjs";
import { reconcileRecoveryReportWithLiveObservation } from "./lib/recovery-report.mjs";
import { createOperatorBackup, restoreOperatorBackup } from "./lib/operator-backup.mjs";
import { storageHealth } from "./lib/storage-health.mjs";
import { maintainStorageHeadroom, readStorageRetentionStatus } from "./lib/storage-retention.mjs";
import { recoverRc1Checkpoints } from "./lib/rc1-checkpoint-migration.mjs";
import { createStartupDiagnostics } from "./lib/startup-diagnostics.mjs";
import { probeStorageContract } from "./lib/storage-contract-probe.mjs";
import { loadPersistedProcessInventory } from "./lib/process-store.mjs";
const Safety = globalThis.GreenfieldSafetyPolicy;
let restartReport = {atMs:0,restored:[],unresolved:[],errors:[]};
let runtimeFault = "";
let hydrationInFlight = null;
let storageContractProof = null;
let storageRetentionStatus = null;
const RECOVERY_SCAN_ALARM = "eic.gf.recovery-scan.v1";

async function maintainLocalStorage(reason, options = {}) {
  try {
    storageRetentionStatus = await maintainStorageHeadroom(
      chrome.storage.local,
      chrome.storage.session,
      { reason, ...options }
    );
  } catch (error) {
    storageRetentionStatus = {
      schema: "eic.greenfield.storage-retention.v1",
      at: new Date().toISOString(),
      reason,
      known: false,
      action: "ERROR",
      error: String(error?.message || error)
    };
  }
  return storageRetentionStatus;
}
import {
  APP_VERSION,
  PHASES,
  TERMINAL_PHASES,
  WATCHDOG_MINUTES,
  FAST_RECHECK_MS,
  IDLE_KEEPALIVE_MS,
  IDLE_KEEPALIVE_MIN_MS,
  MAX_PROMPT_CHARS,
  MAX_NEXT_INSTRUCTION_CHARS,
  AUDIT_DEFAULT_ENABLED,
  AUDIT_FIFO_LIMIT,
  MAX_PERSISTED_AUDIT_EVENTS,
  AUDIT_NOISE_SAMPLE_MS
} from "./lib/contracts.mjs";
import {
  makeAuditEvent,
  writeAuditEvent,
  readAudit,
  pruneAudit
} from "./lib/audit-store.mjs";
import { createKeyedQueue } from "./lib/keyed-queue.mjs";
import {
  createProcess,
  isCurrentToken,
  ownerToken,
  resetRecovery,
  transitionProcess,
  withRecovery
} from "./lib/state.mjs";
import {
  loadAllProcesses,
  loadProcessForWindow,
  saveProcess
} from "./lib/process-store.mjs";
import {
  ensureWorkerBinding,
  getWorkerBinding,
  releaseWorkerBinding,
  workerBindingMatches
} from "./lib/worker-identity.mjs";
import { advanceResponseCandidate } from "./lib/response-stability.mjs";
import {
  clearNextInstruction,
  readNextInstruction,
  writeNextInstruction
} from "./lib/instruction-store.mjs";
import { composeA2APrompt, initialMissionObjective } from "./lib/a2a.mjs";
import {
  DISPOSITIONS,
  normalizeHjalmarDecision,
  reconcileHjalmarRuntimeFacts,
  validateHjalmarDecision,
  validateHjalmarEvidenceBinding
} from "./lib/hjalmar-d2.mjs";
import { deepClone, errorRecord, nowIso, randomId, sha256Hex, text } from "./lib/common.mjs";
import { reconcileDispatchObservation } from "./lib/dispatch-reconciliation.mjs";
import { reconcileSafetyHoldWithFreshProof } from "./lib/safety-hold-reconciliation.mjs";
import { parseTargetResponse, targetResponseEvidence } from "./lib/response-contract.mjs";
import { createNanoTask, splitNanoTaskDirective, NANO_TASK_STATUS } from "./lib/nano-task.mjs";
import { evaluateContinuationAdmission } from "./lib/continuation-guard.mjs";
import { applyGreenfieldControlToDecision, resolveGreenfieldControl } from "./lib/greenfield-control.mjs";
import {
  autonomousResponseObservation,
  expectedAutonomousUserTurn,
  externalAssistantInterleaveEvidence
} from "./lib/turn-causality.mjs";
import {
  createWaitingRefreshState,
  evaluateWaitingRefresh,
  resetWaitingRefreshOnAssistantResponse,
  WAITING_REFRESH_ACTIONS,
  WAITING_STALE_INTERVAL_MS
} from "./lib/waiting-refresh.mjs";
import {
  createSessionRotationRecord,
  deriveGptRoot,
  isExplicitBackgroundSleepAction,
  isExplicitPauseAction,
  isExplicitQueueYieldAction,
  isExplicitRotationAction,
  isExplicitStopAction,
  SESSION_ACTIONS,
  SESSION_ROTATION_STATES,
  sessionRotationObjective
} from "./lib/session-rotation.mjs";
import {
  loadOperatorSettings,
  saveOperatorSettings
} from "./lib/operator-settings.mjs";
import {
  claimGlobalPromptSend,
  commitGlobalPromptPost,
  markGlobalRateLimitPreflightComplete,
  markGlobalRateLimitWarning,
  readGlobalPromptGate,
  releaseGlobalPromptLease,
  reserveGlobalPromptSlot
} from "./lib/global-prompt-gate.mjs";
import {
  DEFAULT_GREENFIELD_PRIORITY,
  DEFAULT_MAX_ACTIVE_SESSIONS,
  adoptGlobalTurnSlot,
  cancelGlobalTurnProcess,
  normalizeGreenfieldPriority,
  readGlobalCapacityScheduler,
  reconcileGlobalCapacityScheduler,
  releaseGlobalTurnSlot,
  requestGlobalTurnSlot,
  updateGlobalTurnPriority
} from "./lib/global-capacity-scheduler.mjs";
import {
  buildLiveManagedSurfaceIndex,
  managedSurfaceIsLive
} from "./lib/managed-surface-liveness.mjs";
import {
  classifyManagedEicSurface,
  readEicSurfaceState,
  rememberGoodEicUrl,
  recoveryDecision
} from "./lib/managed-eic-surface.mjs";
import {
  MISSION_PAUSE_ACTION,
  MISSION_PAUSE_STATES,
  createMissionPauseRecord,
  missionPauseDue,
  missionPauseRemainingMs,
  resumeMissionPauseRecord
} from "./lib/mission-pause.mjs";
import {
  DEFAULT_MISSION_QUANTUM_INTERACTIONS,
  MAX_QUEUE_HISTORY,
  DEFAULT_QUEUE_PRIORITY_AGING_SECONDS,
  DEFAULT_QUEUE_SWITCH_HARD_RELOAD,
  DEFAULT_QUEUE_SWITCH_DELAY_SECONDS,
  DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS,
  QUEUE_STATUS,
  addMissionWorkItem,
  createQueueContext,
  loadMissionWorkQueue,
  moveMissionWorkItem,
  normalizeMissionQuantumInteractions,
  publicMissionWorkQueue,
  removeMissionWorkItem,
  requeueBlockedMissionWorkItem,
  saveMissionWorkQueue,
  selectNextMissionItem,
  updateMissionWorkItem
} from "./lib/mission-work-queue.mjs";
import {
  activatedQueueSlotTelemetry,
  applyQueueParkTransition,
  latestResponseRoundTripMs,
  retireLogicalMissionSlots
} from "./lib/queue-planning.mjs";
import {
  SCHEDULE_BLOCK,
  nextScheduleOpenAtMs,
  parseScheduleEdit,
  queueItemNextRunnableAtMs,
  scheduleBlockReason
} from "./lib/queue-schedule.mjs";
import {
  applyRuntimeControlEffects,
  evaluateRuntimeControl,
  nextRuntimeControlState,
  settleRuntimeControlReceipts,
  withTerminalReceiptsRejected
} from "./lib/runtime-control.mjs";
import { managedOverlayOverview } from "./lib/overlay-summary.mjs";
import {
  PROMPT_PROFILE,
  compactPromptStillValid,
  selectPromptProfile,
  upgradedFullProfile
} from "./lib/prompt-profile.mjs";
import { buildFullProcessStatus, PROCESS_STATUS_REQUEST } from "./lib/process-status.mjs";
import {
  QUEUE_AFTER_RESPONSE,
  queueAfterResponseAction
} from "./lib/queue-control-policy.mjs";
import {
  applyMissionQueueSet,
  deleteMissionQueueSet,
  loadMissionQueueSets,
  publicMissionQueueSets,
  saveMissionQueueSet
} from "./lib/mission-queue-sets.mjs";
import {
  completeSessionHealthTurn,
  markSessionHealthFirstResponse,
  markSessionHealthPromptPosted,
  markSessionHealthRecovery,
  resetSessionHealthForRotation,
  sessionHealthCapsule
} from "./lib/session-health.mjs";
import {
  WORK_MODE_POLL_MS,
  claimNextWorkModePointer,
  completeWorkModePointer,
  enqueueWorkModePointer,
  validateWmtPointer,
  wmtPointerMission,
  workModeStatusPayload
} from "./lib/work-mode.mjs";
import {
  MISSION_DELEGATION_RELATION,
  claimPendingMissionDelegationForWorker,
  markMissionDelegationApplied,
  markMissionDelegationCompleted,
  registerMissionDelegationRequests,
  releaseMissionDelegation
} from "./lib/mission-delegation.mjs";

const queues = createKeyedQueue();
const instructionQueues = createKeyedQueue();
const missionDelegationQueues = createKeyedQueue();
const fastTimers = new Map();
const eicSurfaceWrongSince = new Map();
const workModeLastPoll = new Map();
const WATCH_PREFIX = "eic.gf.watch.";
const MISSION_PAUSE_PREFIX = "eic.gf.mission-pause.";
const MISSION_QUEUE_WAKE_PREFIX = "eic.gf.mission-queue-wake.";
const BACKGROUND_AUDIT_SESSION_ID = randomId("background-session");
let offscreenCreating = null;

const AUDIT_SETTING_KEY = "eic.gf.audit.enabled";
const AUDIT_NOISE_KINDS = new Set([
  "PROCESS_TICK",
  "PAGE_STATE_OBSERVED",
  "RESPONSE_OBSERVATION_HELD",
  "RESPONSE_STABILITY_SAMPLE"
]);
const volatileAuditByWindow = new Map();
const volatileAppAudit = [];
const auditNoiseState = new Map();
const auditBroadcastTimers = new Map();
let auditEnabled = AUDIT_DEFAULT_ENABLED;
let persistedAuditWrites = 0;

const auditSettingsReady = (async () => {
  try {
    const stored = await chrome.storage.local.get(AUDIT_SETTING_KEY);
    auditEnabled = stored?.[AUDIT_SETTING_KEY] === true;
  } catch {
    auditEnabled = AUDIT_DEFAULT_ENABLED;
  }
  return auditEnabled;
})();

function auditFeedEvent(event) {
  return {
    schema: event.schema,
    appVersion: event.appVersion,
    eventKey: event.eventKey,
    eventId: event.eventId,
    seq: event.seq,
    timestamp: event.timestamp,
    severity: event.severity,
    scope: event.scope,
    auditSessionId: event.auditSessionId,
    processId: event.processId,
    runId: event.runId,
    generation: event.generation,
    windowId: event.windowId,
    tabId: event.tabId,
    turn: event.turn,
    phase: event.phase,
    kind: event.kind,
    component: event.component,
    operationId: event.operationId
  };
}

function pushRing(ring, event) {
  ring.push(auditFeedEvent(event));
  if (ring.length > AUDIT_FIFO_LIMIT) ring.splice(0, ring.length - AUDIT_FIFO_LIMIT);
}

function scheduleAuditBroadcast(windowId) {
  if (!Number.isInteger(windowId) || auditBroadcastTimers.has(windowId)) return;
  const timer = setTimeout(async () => {
    auditBroadcastTimers.delete(windowId);
    try {
      await chrome.runtime.sendMessage({
        type: "EIC_GF_AUDIT_CHANGED",
        windowId,
        audit: await auditSnapshotForWindow(windowId)
      });
    } catch {
      // Side panel is optional.
    }
  }, 150);
  auditBroadcastTimers.set(windowId, timer);
}

function pushVolatileAudit(event) {
  if (Number.isInteger(event.windowId)) {
    const ring = volatileAuditByWindow.get(event.windowId) || [];
    pushRing(ring, event);
    volatileAuditByWindow.set(event.windowId, ring);
    scheduleAuditBroadcast(event.windowId);
  } else {
    pushRing(volatileAppAudit, event);
  }
}

function auditNoiseSignature(event) {
  const p = event.payload || {};
  switch (event.kind) {
    case "PROCESS_TICK":
      return `${event.phase}|${p.reason || ""}|${p.phase || ""}`;
    case "PAGE_STATE_OBSERVED":
      return [
        p.documentId || "",
        p.lastUserId || "",
        p.lastAssistantId || "",
        p.assistantHash || "",
        p.assistantCount ?? "",
        p.generating === true ? "1" : "0",
        p.composerReady === true ? "1" : "0",
        p.autonomousTurn?.assistantId || "",
        p.autonomousTurn?.assistantHash || "",
        p.autonomousTurn?.responseSlotClosed === true ? "1" : "0"
      ].join("|");
    case "RESPONSE_OBSERVATION_HELD":
      return [
        p.reason || "",
        p.documentId || "",
        p.messageId || p.latestAssistantTurnId || "",
        p.expectedUserTurnId || "",
        p.pairedUserTurnId || p.resolvedUserTurnId || "",
        p.assistantCount ?? ""
      ].join("|");
    case "RESPONSE_STABILITY_SAMPLE":
      return [
        p.reason || "",
        p.identityKey || "",
        p.messageId || "",
        p.assistantCount ?? "",
        p.complete === true ? "1" : "0"
      ].join("|");
    default:
      return "";
  }
}

function shouldPersistAuditEvent(event) {
  if (!AUDIT_NOISE_KINDS.has(event.kind)) return true;
  const owner = event.processId || `window:${event.windowId ?? "app"}`;
  const key = `${owner}:${event.kind}`;
  const signature = auditNoiseSignature(event);
  const at = Date.parse(event.timestamp || "") || Date.now();
  const prior = auditNoiseState.get(key);
  if (prior && prior.signature === signature && (at - prior.persistedAt) < AUDIT_NOISE_SAMPLE_MS) {
    prior.suppressed += 1;
    auditNoiseState.set(key, prior);
    return false;
  }
  auditNoiseState.set(key, { signature, persistedAt: at, suppressed: 0 });
  return true;
}

async function appendAudit(input) {
  await auditSettingsReady;
  const event = makeAuditEvent(input);
  pushVolatileAudit(event);

  if (!auditEnabled) return { ...event, persisted: false, persistenceMode: "FIFO_ONLY" };
  if (!shouldPersistAuditEvent(event)) {
    return { ...event, persisted: false, persistenceMode: "COALESCED" };
  }

  await writeAuditEvent(event);
  persistedAuditWrites += 1;
  if (persistedAuditWrites === 1 || persistedAuditWrites % 100 === 0) {
    void pruneAudit({
      maxEvents: MAX_PERSISTED_AUDIT_EVENTS,
      maxDeletes: 2500
    }).catch(() => undefined);
  }
  return { ...event, persisted: true, persistenceMode: "PERSISTENT" };
}

async function appendAuditError({
  error,
  kind = "UNHANDLED_ERROR",
  component = "runtime",
  severity = "ERROR",
  payload = {},
  ...context
}) {
  return appendAudit({
    ...context,
    kind,
    component,
    severity,
    payload: {
      error: errorRecord(error),
      ...payload
    }
  });
}

function fifoRowsForWindow(windowId) {
  const rows = [
    ...volatileAppAudit,
    ...(volatileAuditByWindow.get(windowId) || [])
  ];
  return rows
    .sort((a, b) => {
      const ta = Date.parse(a.timestamp || "") || 0;
      const tb = Date.parse(b.timestamp || "") || 0;
      return (ta - tb) || (Number(a.seq || 0) - Number(b.seq || 0));
    })
    .slice(-AUDIT_FIFO_LIMIT);
}

async function auditSnapshotForWindow(windowId, process = null) {
  await auditSettingsReady;
  let events = fifoRowsForWindow(windowId);
  if (auditEnabled && events.length === 0) {
    const current = process || (Number.isInteger(windowId)
      ? await loadProcessForWindow(windowId).catch(() => null)
      : null);
    const filter = current
      ? {
          processId: current.processId,
          auditSessionId: current.auditSessionId || "",
          windowId,
          since: current.startedAt || "",
          includeWindowPrelude: true,
          includeAppEvents: true,
          limit: AUDIT_FIFO_LIMIT
        }
      : {
          windowId,
          includeWindowPrelude: true,
          includeAppEvents: true,
          limit: AUDIT_FIFO_LIMIT
        };
    events = (await readAudit(filter).catch(() => [])).map(auditFeedEvent);
  }
  return {
    enabled: auditEnabled,
    mode: auditEnabled ? "PERSISTENT" : "FIFO_ONLY",
    fifoLimit: AUDIT_FIFO_LIMIT,
    persistedMaxEvents: MAX_PERSISTED_AUDIT_EVENTS,
    events: events.slice(-AUDIT_FIFO_LIMIT)
  };
}

async function setAuditEnabled(windowId, enabled, auditSessionId = "") {
  const next = enabled === true;
  await chrome.storage.local.set({ [AUDIT_SETTING_KEY]: next });
  auditEnabled = next;

  if (next) {
    void pruneAudit({
      maxEvents: MAX_PERSISTED_AUDIT_EVENTS,
      maxDeletes: 2500
    }).catch(() => undefined);
  }

  const process = Number.isInteger(windowId)
    ? await loadProcessForWindow(windowId).catch(() => null)
    : null;
  await appendAudit({
    process,
    scope: process ? "RUN" : (Number.isInteger(windowId) ? "WINDOW" : "APP"),
    auditSessionId,
    windowId,
    kind: next ? "AUDIT_ENABLED" : "AUDIT_DISABLED",
    component: "audit-control",
    payload: {
      enabled: next,
      fifoLimit: AUDIT_FIFO_LIMIT,
      persistentRetentionMaxEvents: MAX_PERSISTED_AUDIT_EVENTS
    }
  }).catch(() => undefined);

  return { ok: true, audit: await auditSnapshotForWindow(windowId, process) };
}

function supportedUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.protocol === "https:" &&
      (parsed.hostname === "chatgpt.com" || parsed.hostname === "chat.openai.com");
  } catch {
    return false;
  }
}

async function pingContentBridge(tabId) {
  const result = await chrome.tabs.sendMessage(tabId, { type: "EIC_GF_PING" });
  if (!result?.ok) {
    const error = new Error(result?.error || "CONTENT_BRIDGE_PING_FAILED");
    error.code = result?.code || "CONTENT_BRIDGE_PING_FAILED";
    throw error;
  }
  return result;
}

async function injectContentBridge(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["lib/safety-policy.js", "lib/model-observation.js", "content.js"]
  });
}

async function ensureContentBridgeVersion(tabId) {
  let observedVersion = "";
  try {
    const ping = await pingContentBridge(tabId);
    observedVersion = String(ping.version || "");
    if (observedVersion === APP_VERSION) {
      return { refreshed: false, observedVersion, currentVersion: APP_VERSION };
    }
  } catch {
    observedVersion = "";
  }

  await injectContentBridge(tabId);
  const ping = await pingContentBridge(tabId);
  const refreshedVersion = String(ping.version || "");
  if (refreshedVersion !== APP_VERSION) {
    const error = new Error(`CONTENT_BRIDGE_VERSION_MISMATCH:${refreshedVersion || "MISSING"}!=${APP_VERSION}`);
    error.code = "CONTENT_BRIDGE_VERSION_MISMATCH";
    error.observedVersion = refreshedVersion;
    error.expectedVersion = APP_VERSION;
    throw error;
  }
  return {
    refreshed: true,
    observedVersion,
    currentVersion: refreshedVersion
  };
}


function hasCanonicalResponseControl(contract) {
  return contract?.ok === true || contract?.controlOk === true;
}

function protocolDisposition(contract) {
  return hasCanonicalResponseControl(contract)
    ? String(contract.status || "UNKNOWN").toUpperCase()
    : "UNKNOWN";
}

function compactResponseExcerpt(value, maxChars = 650) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  const limit = Math.max(120, Number(maxChars || 650));
  if (normalized.length <= limit) return normalized;
  const tail = Math.min(180, Math.floor(limit * 0.3));
  const head = Math.max(80, limit - tail - 3);
  return `${normalized.slice(0, head).trimEnd()} … ${normalized.slice(-tail).trimStart()}`;
}

function alarmName(processId) {
  return `${WATCH_PREFIX}${processId}`;
}

function missionPauseAlarmName(processId) {
  return `${MISSION_PAUSE_PREFIX}${processId}`;
}

async function setWatchdog(process) {
  if (!process || TERMINAL_PHASES.has(process.phase) || process.phase === PHASES.PAUSED) {
    if (process?.processId) await chrome.alarms.clear(alarmName(process.processId));
    return;
  }
  await chrome.alarms.create(alarmName(process.processId), {
    periodInMinutes: WATCHDOG_MINUTES
  });
}

async function syncMissionPauseAlarm(process) {
  if (!process?.processId ||
      process.phase !== PHASES.PAUSED ||
      process.missionPause?.state !== MISSION_PAUSE_STATES.ARMED) {
    if (process?.processId) await chrome.alarms.clear(missionPauseAlarmName(process.processId));
    return;
  }

  const resumeAtMs = Number(process.missionPause.resumeAtMs || 0);
  if (!Number.isFinite(resumeAtMs) || resumeAtMs <= 0) {
    const error = new Error("MISSION_PAUSE_RESUME_TIME_INVALID");
    error.code = "MISSION_PAUSE_RESUME_TIME_INVALID";
    throw error;
  }

  if (resumeAtMs <= Date.now()) {
    await chrome.alarms.clear(missionPauseAlarmName(process.processId));
    scheduleFast(process.processId, 50);
    return;
  }

  // Do not rely on Chrome alarm persistence alone. missionPause is durable process state,
  // and hydrateProcesses recreates this one-shot alarm after service-worker/browser restart.
  await chrome.alarms.create(missionPauseAlarmName(process.processId), { when: resumeAtMs });
}

function scheduleFast(processId, delayMs = FAST_RECHECK_MS) {
  if (!processId || fastTimers.has(processId)) return;
  const timer = setTimeout(() => {
    fastTimers.delete(processId);
    void enqueueTick(processId, "fast-recheck");
  }, Math.max(100, Number(delayMs || FAST_RECHECK_MS)));
  fastTimers.set(processId, timer);
}

async function findProcessById(processId) {
  const all = await loadAllProcesses();
  const matches = all.filter((item) => item.processId === processId);
  if (matches.length > 1) {
    const error = new Error("PROCESS_IDENTITY_COLLISION");
    error.code = "PROCESS_IDENTITY_COLLISION";
    throw error;
  }
  return matches[0] || null;
}

function effectiveSchedulerCapacity(rateLimitState, configuredCapacity) {
  const configured = Number.isFinite(Number(configuredCapacity))
    ? Number(configuredCapacity)
    : DEFAULT_MAX_ACTIVE_SESSIONS;
  if (rateLimitState === "COOLDOWN") return 0;
  if (rateLimitState === "SERIAL_RECOVERY") return 1;
  return configured;
}

async function schedulerCapacityContext({
  gate = null,
  settings = null
} = {}) {
  const operatorSettings = settings || await loadOperatorSettings(
    chrome.storage.local,
    { restoreSavedMissions: false, bookmarks: null }
  ).catch(() => ({ maxActiveSessions: DEFAULT_MAX_ACTIVE_SESSIONS }));
  const globalGate = gate || await readGlobalPromptGate().catch(() => null);
  const configuredCapacity = Number(
    operatorSettings?.maxActiveSessions ?? DEFAULT_MAX_ACTIVE_SESSIONS
  );
  const effectiveCapacity = effectiveSchedulerCapacity(
    globalGate?.rateLimit?.state || "NORMAL",
    configuredCapacity
  );
  return {
    configuredCapacity,
    effectiveCapacity,
    rateLimitState: globalGate?.rateLimit?.state || "NORMAL",
    gate: globalGate,
    settings: operatorSettings
  };
}

function wakeSchedulerProcesses(processIds = [], delayMs = 50) {
  let offset = 0;
  for (const raw of Array.isArray(processIds) ? processIds : []) {
    const processId = String(raw || "").trim();
    if (!processId) continue;
    scheduleFast(processId, Math.max(100, Number(delayMs || 50)) + offset);
    offset += 25;
  }
}

async function currentSchedulerSnapshot({ gate = null, settings = null } = {}) {
  const context = await schedulerCapacityContext({ gate, settings });
  const scheduler = await readGlobalCapacityScheduler(chrome.storage.local, {
    capacity: context.effectiveCapacity,
    configuredCapacity: context.configuredCapacity
  });
  return { context, scheduler };
}

async function releaseSchedulerTurn(process, {
  promptHash = "",
  reason = "TURN_COMPLETE"
} = {}) {
  if (!process?.processId) return null;
  const context = await schedulerCapacityContext();
  const result = await releaseGlobalTurnSlot({
    processId: process.processId,
    promptHash: promptHash || process.lastPrompt?.hash || process.pendingPrompt?.hash || "",
    capacity: context.effectiveCapacity,
    configuredCapacity: context.configuredCapacity
  });
  wakeSchedulerProcesses(result?.runnableProcessIds || []);
  await audit(process, "GLOBAL_CAPACITY_SLOT_RELEASED", "capacity-scheduler", {
    reason,
    released: result?.released === true,
    activeCount: result?.scheduler?.activeCount ?? null,
    waitingCount: result?.scheduler?.waitingCount ?? null,
    configuredCapacity: context.configuredCapacity,
    effectiveCapacity: context.effectiveCapacity
  }).catch(() => undefined);
  return result;
}

async function cancelSchedulerProcess(process, reason = "PROCESS_CANCELLED") {
  if (!process?.processId) return null;
  const context = await schedulerCapacityContext();
  const result = await cancelGlobalTurnProcess({
    processId: process.processId,
    capacity: context.effectiveCapacity,
    configuredCapacity: context.configuredCapacity
  });
  wakeSchedulerProcesses(result?.runnableProcessIds || []);
  await audit(process, "GLOBAL_CAPACITY_PROCESS_CANCELLED", "capacity-scheduler", {
    reason,
    removed: result?.removed === true,
    hadActive: result?.hadActive === true,
    hadWaiter: result?.hadWaiter === true,
    activeCount: result?.scheduler?.activeCount ?? null,
    waitingCount: result?.scheduler?.waitingCount ?? null
  }).catch(() => undefined);
  return result;
}

async function adoptSchedulerTurnForObservedEffect(process, promptHash, reason) {
  if (!process?.processId || !promptHash) return null;
  const context = await schedulerCapacityContext();
  const result = await adoptGlobalTurnSlot({
    processId: process.processId,
    windowId: process.windowId,
    promptHash,
    priority: process.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY,
    capacity: context.effectiveCapacity,
    configuredCapacity: context.configuredCapacity,
    observedEffect: true
  });
  await audit(process, "GLOBAL_CAPACITY_SLOT_ADOPTED", "capacity-scheduler", {
    reason,
    adopted: result?.adopted === true,
    alreadyActive: result?.alreadyActive === true,
    activeCount: result?.scheduler?.activeCount ?? null,
    configuredCapacity: context.configuredCapacity,
    effectiveCapacity: context.effectiveCapacity
  }).catch(() => undefined);
  return result;
}


// v1.7.9: the overlay carries an operator overview (GFW, slot, quantum, stale
// TTL, next slot, prompt profile). The queue is read-only here; when it cannot
// be read the overview simply omits queue position and next slot.
async function managedOverlayPayload(process, { linked = true, reason = "state" } = {}) {
  let queue = null;
  if (linked && (process.queueContext?.itemId || process.phase === PHASES.QUEUE_WAIT) && process.workerId) {
    queue = await loadMissionWorkQueue(process.windowId, chrome.storage.local, { workerId: process.workerId })
      .catch(() => null);
  }
  return {
    linked,
    reason,
    processId: process.processId,
    runId: process.runId,
    generation: process.generation,
    windowId: process.windowId,
    tabId: process.tabId,
    phase: process.phase,
    overview: linked ? managedOverlayOverview(process, { queue }) : null
  };
}

async function syncOverlay(process, reason = "state") {
  if (!process?.tabId) return;
  // v1.8.1: an idle queue worker still owns its tab; keep the overview visible.
  const linked = !TERMINAL_PHASES.has(process.phase) || process.phase === PHASES.QUEUE_WAIT;
  try {
    const overlayResult = await chrome.tabs.sendMessage(process.tabId, {
      type: "EIC_GF_OVERLAY_UPDATE",
      overlay: await managedOverlayPayload(process, { linked, reason })
    });
    const overlayChanged = overlayResult?.changed !== false;
    if (overlayChanged || reason !== "observation") {
      await appendAudit({
        process,
        kind: linked ? "MANAGED_TAB_OVERLAY_SYNCED" : "MANAGED_TAB_OVERLAY_CLEARED",
        component: "overlay",
        payload: { reason, phase: process.phase, changed: overlayChanged }
      }).catch(() => undefined);
    }
  } catch {
    // Content bridge may be between page lifecycles; content-ready will reconcile.
  }
}

async function broadcast(process, reason = "state") {
  try {
    const nextInstruction = process?.processId
      ? await readNextInstruction(process.processId).catch(() => null)
      : null;
    await chrome.runtime.sendMessage({
      type: "EIC_GF_SNAPSHOT_CHANGED",
      reason,
      process: publicSnapshot(process),
      nextInstruction,
      audit: Number.isInteger(process?.windowId)
        ? await auditSnapshotForWindow(process.windowId, process)
        : null
    });
  } catch {
    // UI is optional; process state is durable.
  }
  if (process) await syncOverlay(process, reason);
}

function publicSnapshot(process) {
  if (!process) return null;
  return {
    schema: process.schema,
    version: process.version,
    processId: process.processId,
    runId: process.runId,
    workerId: process.workerId || "",
    auditSessionId: process.auditSessionId || "",
    generation: process.generation,
    windowId: process.windowId,
    tabId: process.tabId,
    phase: process.phase,
    safety: process.safety || null,
    lastManagedUrl: process.lastManagedUrl || "",
    restartRecovery: process.restartRecovery || null,
    storageRecoveryRequired: process.storageRecoveryRequired === true,
    sessionSeq: process.sessionSeq,
    schedulerPriority: normalizeGreenfieldPriority(process.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY),
    queueContext: process.queueContext ? {
      schema: process.queueContext.schema || "",
      queueId: process.queueContext.queueId || "",
      itemId: process.queueContext.itemId || "",
      interactionCount: Number(process.queueContext.interactionCount || 0),
      maxInteractions: normalizeMissionQuantumInteractions(process.queueContext.maxInteractions),
      priority: normalizeGreenfieldPriority(process.queueContext.priority || process.schedulerPriority)
    } : null,
    goal: process.goal,
    turn: process.turn,
    lastPrompt: process.lastPrompt,
    lastResponse: process.lastResponse,
    responseInterleave: process.responseInterleave || null,
    waitingRefresh: process.waitingRefresh || null,
    lastNano: process.lastNano || null,
    lastNanoTask: process.lastNanoTask || null,
    lastDecision: process.lastDecision,
    greenfieldControl: process.greenfieldControl || null,
    objectiveState: process.objectiveState || null,
    sessionHealth: sessionHealthCapsule(process.sessionHealth, {
      turn: process.turn,
      sessionSeq: process.sessionSeq,
      sessionStartTurn: process.turn
    }),
    missionPause: process.missionPause
      ? {
          pauseId: process.missionPause.pauseId || "",
          state: process.missionPause.state || "",
          durationSeconds: Number(process.missionPause.durationSeconds || 0),
          reason: process.missionPause.reason || "",
          requestedAtMs: Number(process.missionPause.requestedAtMs || 0),
          resumeAtMs: Number(process.missionPause.resumeAtMs || 0),
          resumeNotBeforeAt: process.missionPause.resumeNotBeforeAt || "",
          resumedAtMs: Number(process.missionPause.resumedAtMs || 0),
          resumedAt: process.missionPause.resumedAt || "",
          resumeReason: process.missionPause.resumeReason || "",
          remainingMs: missionPauseRemainingMs(process.missionPause)
        }
      : null,
    promptPause: process.pendingPrompt?.promptPause
      ? {
          reservationId: process.pendingPrompt.promptPause.reservationId || "",
          reservationSeq: Number(process.pendingPrompt.promptPause.reservationSeq || 0),
          delaySeconds: Number(process.pendingPrompt.postDelaySeconds || 0),
          reservedAtMs: Number(process.pendingPrompt.promptPause.reservedAtMs || 0),
          notBeforeAtMs: Number(process.pendingPrompt.promptPause.notBeforeAtMs || 0),
          scope: "CHROME_PROFILE"
        }
      : null,
    lastConsumedInstructionId: process.lastConsumedInstructionId || null,
    recovery: process.recovery,
    detached: process.detached,
    lastError: process.lastError,
    lastMaterialAt: process.lastMaterialAt || process.updatedAt || process.startedAt,
    idleKeepaliveSeq: Number(process.idleKeepaliveSeq || 0),
    startedAt: process.startedAt,
    updatedAt: process.updatedAt,
    completedAt: process.completedAt
  };
}

async function markAuditFailure(process, error, operationId = "") {
  const failed = {
    ...process,
    phase: PHASES.AUDIT_FAILURE,
    generation: Number(process.generation || 1) + 1,
    lastError: {
      code: "AUDIT_WRITE_FAILED",
      operationId,
      ...errorRecord(error)
    },
    completedAt: nowIso(),
    updatedAt: nowIso()
  };
  try { await saveProcess(failed); } catch {}
  try { await chrome.alarms.clear(alarmName(process.processId)); } catch {}
  try { await chrome.alarms.clear(missionPauseAlarmName(process.processId)); } catch {}
  await broadcast(failed, "audit-failure");
  return failed;
}

async function audit(process, kind, component, payload = {}, operationId = "") {
  try {
    return await appendAudit({
      process,
      kind,
      component,
      operationId,
      payload
    });
  } catch (error) {
    await markAuditFailure(process, error, operationId);
    throw Object.assign(new Error("AUDIT_WRITE_FAILED"), { cause: error });
  }
}

async function activeGreenfieldProcessIds() {
  const processes = await loadAllProcesses().catch(() => []);
  return processes
    .filter((item) => item?.processId && !TERMINAL_PHASES.has(item.phase))
    .map((item) => String(item.processId));
}

async function registerGlobalRateLimitWarning(process, pageOrResult, source, operationId = "") {
  const warning = pageOrResult?.rateLimitWarning || pageOrResult?.after?.rateLimitWarning || null;
  if (warning?.active !== true) return null;

  const documentId = String(
    pageOrResult?.documentId ||
    pageOrResult?.after?.documentId ||
    pageOrResult?.before?.documentId ||
    ""
  );
  const signature = String(warning.signature || "");
  const incidentKey = operationId
    ? `send:${operationId}:${signature}`
    : `page:${documentId}:${signature}`;
  const activeProcessIds = await activeGreenfieldProcessIds();
  const marked = await markGlobalRateLimitWarning({
    processId: process.processId,
    windowId: process.windowId,
    warningSignature: signature,
    incidentKey,
    activeProcessIds
  });

  if (marked?.newIncident) {
    await audit(process, "GLOBAL_RATE_LIMIT_WARNING_DETECTED", "prompt-gate", {
      source,
      detector: warning.detector || "",
      confidence: warning.confidence || "",
      signature,
      incidentKey,
      epoch: marked.rateLimit?.epoch ?? null,
      level: marked.rateLimit?.level ?? null,
      cooldownSeconds: marked.cooldownSeconds ?? null,
      cooldownUntilMs: marked.rateLimit?.cooldownUntilMs ?? null,
      affectedProcessCount: marked.rateLimit?.affectedProcessIds?.length ?? 0,
      acknowledgementTextUsedAsSelector: false,
      rawDialogTextStored: false
    }, operationId).catch(() => undefined);

    const processes = await loadAllProcesses().catch(() => []);
    for (const item of processes) {
      if (!item?.processId || TERMINAL_PHASES.has(item.phase)) continue;
      scheduleFast(item.processId, 100);
      if (Number.isInteger(item.windowId)) {
        void broadcast(item, "global-rate-limit-warning").catch(() => undefined);
      }
    }
  }
  return marked;
}

async function directManagedPageState(process, source = "rate-limit-recovery") {
  const expectedTurn = expectedAutonomousUserTurn(process);
  const result = await chrome.tabs.sendMessage(process.tabId, {
    type: "EIC_GF_GET_PAGE_STATE",
    source,
    expectedUserTurnId: expectedTurn.id,
    expectedUserIndex: expectedTurn.index
  });
  if (!result?.ok) {
    const error = new Error(result?.error || "RATE_LIMIT_PAGE_STATE_UNAVAILABLE");
    error.code = result?.code || "RATE_LIMIT_PAGE_STATE_UNAVAILABLE";
    throw error;
  }
  return result.state || {};
}

async function waitForRateLimitReloadReady(process, timeoutMs = 45_000) {
  const started = Date.now();
  let lastState = null;
  while (Date.now() - started < timeoutMs) {
    let tab = null;
    try {
      tab = await chrome.tabs.get(process.tabId);
    } catch {
      tab = null;
    }
    if (tab && tab.windowId === process.windowId && supportedUrl(tab.url) && tab.status === "complete") {
      try {
        await ensureContentBridgeVersion(process.tabId);
        const state = await directManagedPageState(process, "rate-limit-after-ctrl-f5");
        lastState = state;
        if (String(state.bridgeVersion || "") === APP_VERSION &&
            state.composerReady === true &&
            state.rateLimitWarning?.active !== true) {
          return state;
        }
      } catch {
        // The content bridge can be unavailable briefly while Ctrl-F5 settles.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const error = new Error("RATE_LIMIT_CTRL_F5_READBACK_TIMEOUT");
  error.code = "RATE_LIMIT_CTRL_F5_READBACK_TIMEOUT";
  error.lastState = lastState;
  throw error;
}

async function executeRateLimitRecoveryPreflight(process, gateClaim) {
  const epoch = Number(gateClaim?.recovery?.epoch || 0);
  if (!epoch || gateClaim?.recovery?.preflightRequired !== true) {
    return { ok: true, mode: "NOT_REQUIRED", epoch };
  }

  let contentResult = null;
  try {
    contentResult = await chrome.tabs.sendMessage(process.tabId, {
      type: "EIC_GF_RATE_LIMIT_RECOVERY_PREFLIGHT"
    });
  } catch (error) {
    contentResult = {
      ok: false,
      action: "RELOAD_REQUIRED",
      reason: "RECOVERY_PREFLIGHT_CONTENT_UNAVAILABLE",
      error: errorRecord(error)
    };
  }

  let mode = "CTRL_F5";
  let page = null;
  if (contentResult?.ok === true && contentResult?.action === "DISMISSED_SAFE") {
    try {
      page = await directManagedPageState(process, "rate-limit-after-safe-dismiss");
    } catch {
      page = null;
    }
    if (page?.rateLimitWarning?.active !== true && page?.composerReady === true) {
      mode = "SAFE_STRUCTURAL_ACK";
    } else {
      page = null;
    }
  }

  if (mode !== "SAFE_STRUCTURAL_ACK") {
    await audit(process, "GLOBAL_RATE_LIMIT_CTRL_F5_ARMED", "prompt-gate", {
      epoch,
      contentAction: contentResult?.action || "",
      contentReason: contentResult?.reason || "",
      bypassCache: true
    }).catch(() => undefined);
    await chrome.tabs.reload(process.tabId, { bypassCache: true });
    page = await waitForRateLimitReloadReady(process);
    await audit(process, "GLOBAL_RATE_LIMIT_CTRL_F5_VERIFIED", "prompt-gate", {
      epoch,
      bridgeVersion: page.bridgeVersion || "",
      documentId: page.documentId || "",
      composerReady: page.composerReady === true,
      warningActive: page.rateLimitWarning?.active === true,
      bypassCache: true
    }).catch(() => undefined);
  } else {
    await audit(process, "GLOBAL_RATE_LIMIT_SAFE_ACK_VERIFIED", "prompt-gate", {
      epoch,
      detector: contentResult?.warning?.detector || "",
      signature: contentResult?.warning?.signature || "",
      structuralAck: true,
      literalButtonTextSelectorUsed: false,
      documentId: page?.documentId || ""
    }).catch(() => undefined);
  }

  const prepared = await markGlobalRateLimitPreflightComplete({
    processId: process.processId,
    windowId: process.windowId,
    epoch
  });
  if (prepared?.ok !== true) {
    return {
      ok: false,
      mode,
      epoch,
      reason: prepared?.reason || "GLOBAL_RATE_LIMIT_PREFLIGHT_COMMIT_FAILED",
      page,
      rateLimit: prepared?.rateLimit || null
    };
  }

  await audit(process, "GLOBAL_RATE_LIMIT_RECOVERY_PREFLIGHT_COMMITTED", "prompt-gate", {
    epoch,
    mode,
    prepared: true,
    warningActive: page?.rateLimitWarning?.active === true,
    composerReady: page?.composerReady === true
  }).catch(() => undefined);

  return { ok: true, mode, epoch, page, rateLimit: prepared.rateLimit };
}

async function commitTransition(process, nextPhase, patch, {
  kind = "STATE_TRANSITION",
  component = "runtime",
  detail = {}
} = {}) {
  const operationId = randomId("transition");
  await audit(process, `${kind}_INTENT`, component, {
    from: process.phase,
    to: nextPhase,
    stateBefore: publicSnapshot(process),
    patch,
    ...detail
  }, operationId);

  const next = transitionProcess(process, nextPhase, patch);
  try {
    await saveProcess(next);
    const readback = await loadProcessForWindow(next.windowId);
    const matches = Boolean(
      readback &&
      readback.processId === next.processId &&
      readback.generation === next.generation &&
      readback.phase === next.phase &&
      readback.updatedAt === next.updatedAt
    );
    await audit(next, "STATE_PERSIST_READBACK", "storage", {
      matches,
      expected: {
        processId: next.processId,
        generation: next.generation,
        phase: next.phase,
        updatedAt: next.updatedAt
      },
      observed: readback ? {
        processId: readback.processId,
        generation: readback.generation,
        phase: readback.phase,
        updatedAt: readback.updatedAt
      } : null
    }, operationId);
    if (!matches) {
      const error = new Error("STATE_PERSIST_READBACK_MISMATCH");
      error.code = "STATE_PERSIST_READBACK_MISMATCH";
      throw error;
    }
  } catch (error) {
    await audit(process, "STATE_PERSIST_FAILED", "storage", {
      from: process.phase,
      to: nextPhase,
      error: errorRecord(error)
    }, operationId).catch(() => undefined);
    throw error;
  }

  await audit(next, `${kind}_COMMIT`, component, {
    from: process.phase,
    to: nextPhase,
    stateAfter: publicSnapshot(next),
    ...detail
  }, operationId);
  await setWatchdog(next);
  try {
    await syncMissionPauseAlarm(next);
  } catch (error) {
    await audit(next, "MISSION_PAUSE_ALARM_SYNC_FAILED", "mission-pause", {
      error: errorRecord(error),
      fallback: next.phase === PHASES.PAUSED ? "WATCHDOG" : "NONE"
    }, operationId).catch(() => undefined);
    if (next.phase === PHASES.PAUSED) {
      await chrome.alarms.create(alarmName(next.processId), {
        periodInMinutes: WATCHDOG_MINUTES
      }).catch(() => undefined);
    }
  }
  await broadcast(next, "transition");
  if (TERMINAL_PHASES.has(nextPhase) && next.queueContext?.itemId) {
    return finalizeQueueTerminalAndMaybeAdvance(next);
  }
  return next;
}

async function saveObserved(process, patch, kind, payload = {}) {
  const operationId = randomId("observe");
  const next = { ...process, ...patch, updatedAt: nowIso() };
  await saveProcess(next);
  await audit(next, kind, "response", payload, operationId);
  await broadcast(next, "observation");
  return next;
}

async function executeWaitingRefresh(process, decision) {
  const action = decision?.action;
  const bypassCache = action === WAITING_REFRESH_ACTIONS.CTRL_F5;
  const stage = String(decision?.stage || (bypassCache ? "CTRL_F5_60" : "F5_30"));
  const requestedAt = nowIso();
  const requestId = randomId("reload");
  const waitingRefresh = {
    ...(process.waitingRefresh || {}),
    stage,
    requestedAt,
    requestId,
    waitMs: Number(decision?.waitMs || 0),
    triggerCode: decision?.code || "",
    promptHash: process.lastPrompt?.hash || "",
    turn: Number(process.turn || 0),
    bypassCache
  };

  const armKind = stage === "F5_30"
    ? "WAITING_F5_ARMED"
    : stage === "CTRL_F5_90"
      ? "WAITING_CTRL_F5_90_ARMED"
      : "WAITING_CTRL_F5_60_ARMED";
  const triggerKind = stage === "F5_30"
    ? "WAITING_F5_TRIGGERED"
    : stage === "CTRL_F5_90"
      ? "WAITING_CTRL_F5_90_TRIGGERED"
      : "WAITING_CTRL_F5_60_TRIGGERED";
  const failedKind = stage === "F5_30"
    ? "WAITING_F5_TRIGGER_FAILED"
    : stage === "CTRL_F5_90"
      ? "WAITING_CTRL_F5_90_TRIGGER_FAILED"
      : "WAITING_CTRL_F5_60_TRIGGER_FAILED";

  // Write-ahead the exact stale-session milestone before the page effect. A
  // service-worker restart/reload callback loss must not repeat the same
  // F5/Ctrl-F5 milestone. The next effect is never due before the next 30m edge.
  const armed = await saveObserved(process, {
    waitingRefresh,
    sessionHealth: markSessionHealthRecovery(process.sessionHealth)
  }, armKind, {
    requestId,
    stage,
    bypassCache,
    waitMs: waitingRefresh.waitMs,
    staleSince: waitingRefresh.staleSince || "",
    resetCount: Number(waitingRefresh.resetCount || 0),
    promptHash: waitingRefresh.promptHash,
    turn: waitingRefresh.turn,
    exactOnceStage: true,
    nextEscalationAfterMs: WAITING_STALE_INTERVAL_MS
  });

  try {
    await chrome.tabs.reload(armed.tabId, { bypassCache });
    await audit(armed, triggerKind, "chrome", {
      requestId,
      stage,
      bypassCache,
      waitMs: waitingRefresh.waitMs,
      staleSince: waitingRefresh.staleSince || "",
      resetCount: Number(waitingRefresh.resetCount || 0),
      nextEscalationAfterMs: WAITING_STALE_INTERVAL_MS,
      promptHash: waitingRefresh.promptHash,
      turn: waitingRefresh.turn
    });
  } catch (error) {
    await audit(armed, failedKind, "chrome", {
      requestId,
      stage,
      bypassCache,
      error: errorRecord(error),
      nextEscalationStillBounded: true,
      nextEscalationAfterMs: WAITING_STALE_INTERVAL_MS
    }).catch(() => undefined);
  }

  scheduleFast(armed.processId, 2500);
  return armed;
}

async function maybeResetStaleSessionCounter(process, page) {
  if (process.phase !== PHASES.WAITING ||
      process.lastPrompt?.acknowledged !== true) {
    return process;
  }

  const promptHash = process.lastPrompt?.hash || "";
  const turn = Number(process.turn || 0);
  const refreshStateMatches = Boolean(
    process.waitingRefresh &&
    process.waitingRefresh.promptHash === promptHash &&
    Number(process.waitingRefresh.turn || 0) === turn
  );

  const baselinePage = {
    lastAssistantId: process.lastPrompt?.baselineAssistantId || "",
    assistantHash: process.lastPrompt?.baselineAssistantHash || "",
    assistantCount: process.lastPrompt?.baselineAssistantCount ?? null
  };
  const current = refreshStateMatches
    ? process.waitingRefresh
    : createWaitingRefreshState({
        now: Date.parse(process.lastPrompt?.sentAt || "") || Date.now(),
        page: baselinePage,
        promptHash,
        turn,
        staleSince: process.lastPrompt?.sentAt || nowIso()
      });

  const reset = resetWaitingRefreshOnAssistantResponse({
    current,
    page,
    now: Date.now(),
    promptHash,
    turn
  });

  if (!reset.reset) {
    if (!refreshStateMatches) {
      return saveObserved(process, { waitingRefresh: reset.state },
        "STALE_SESSION_COUNTER_INITIALIZED", {
          staleSince: reset.state.staleSince || "",
          promptHash,
          turn,
          baselineAssistantId: reset.state.lastAssistantId || "",
          baselineAssistantHash: reset.state.assistantHash || "",
          baselineAssistantCount: reset.state.assistantCount ?? null
        });
    }
    return process;
  }

  return saveObserved(process, {
    waitingRefresh: reset.state,
    lastMaterialAt: nowIso()
  }, "STALE_SESSION_COUNTER_RESET", {
    reason: "ANY_COMPLETED_ASSISTANT_RESPONSE",
    priorStage: current.stage || "",
    priorStaleSince: current.staleSince || "",
    staleSince: reset.state.staleSince || "",
    resetCount: Number(reset.state.resetCount || 0),
    lastAssistantId: reset.state.lastAssistantId || "",
    assistantHash: reset.state.assistantHash || "",
    assistantCount: reset.state.assistantCount ?? null,
    protocolAgnostic: true,
    causalBindingRequiredForReset: false
  });
}

async function maybeEscalateWaitingRefresh(process, page, {
  reason = "WAITING_UNRESOLVED"
} = {}) {
  if (process.phase !== PHASES.WAITING) {
    return { handled: false, process };
  }

  const refreshStateMatches = Boolean(
    process.waitingRefresh &&
    process.waitingRefresh.promptHash === (process.lastPrompt?.hash || "") &&
    Number(process.waitingRefresh.turn || 0) === Number(process.turn || 0)
  );
  const refreshState = refreshStateMatches ? process.waitingRefresh : null;
  const refreshDecision = evaluateWaitingRefresh({
    now: Date.now(),
    staleSince: refreshState?.staleSince || "",
    waitingSince: process.lastPrompt?.sentAt || process.lastMaterialAt || process.startedAt || "",
    acknowledged: process.lastPrompt?.acknowledged === true,
    responseComplete: false,
    stage: refreshState?.stage || ""
  });

  if (refreshDecision.action === WAITING_REFRESH_ACTIONS.F5 ||
      refreshDecision.action === WAITING_REFRESH_ACTIONS.CTRL_F5) {
    await audit(process, "WAITING_REFRESH_ESCALATION_EVALUATED", "continuity", {
      action: refreshDecision.action,
      stage: refreshDecision.stage || "",
      code: refreshDecision.code,
      waitMs: refreshDecision.waitMs || 0,
      staleSince: refreshState?.staleSince || process.lastPrompt?.sentAt || "",
      resetCount: Number(refreshState?.resetCount || 0),
      unresolvedReason: reason,
      generating: page.generating === true,
      promptHash: process.lastPrompt?.hash || "",
      turn: process.turn,
      policy: "30M_F5_60M_CTRL_F5_90M_CTRL_F5_120M_ROTATE"
    });
    return {
      handled: true,
      process: await executeWaitingRefresh(process, refreshDecision)
    };
  }

  if (refreshDecision.action === WAITING_REFRESH_ACTIONS.ROTATE) {
    await audit(process, "WAITING_REFRESH_ESCALATION_ROTATE", "continuity", {
      policy: "30M_F5_60M_CTRL_F5_90M_CTRL_F5_120M_ROTATE",
      waitMs: refreshDecision.waitMs || 0,
      staleSince: refreshState?.staleSince || process.lastPrompt?.sentAt || "",
      resetCount: Number(refreshState?.resetCount || 0),
      unresolvedReason: reason,
      generating: page.generating === true,
      promptHash: process.lastPrompt?.hash || "",
      turn: process.turn,
      staleSessionOnly: true
    });
    if (process.queueContext?.itemId) {
      const switched = await parkQueueMissionAfterStale(process);
      if (switched) {
        await audit(switched, "WAITING_REFRESH_ROTATE_QUEUE_SWITCHED", "mission-work-queue", {
          previousProcessId: process.processId,
          previousQueueItemId: process.queueContext.itemId,
          nextQueueItemId: switched.queueContext?.itemId || "",
          unansweredPromptHash: process.lastPrompt?.hash || "",
          interactionCounted: false
        }).catch(() => undefined);
        return { handled: true, process: switched };
      }
    }
    const rotated = await armSessionRotation(process, {
      reasonCode: "STALE_SESSION_120M_EXHAUSTED",
      reason: "F5/Ctrl-F5 recovery was exhausted without a completed assistant response.",
      requestedBy: "STALE_RECOVERY",
      objective: process.objectiveState?.objective || process.lastPrompt?.a2a?.objective || process.goal,
      previousResponseHash: process.lastResponse?.hash || "",
      previousDisposition: "SESSION_UNRESPONSIVE",
      sourceResponseState: "PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE"
    });
    return { handled: true, process: rotated };
  }

  return { handled: false, process };
}

async function tabState(process, source = "tick") {
  let tab;
  try {
    tab = await chrome.tabs.get(process.tabId);
  } catch {
    const error = new Error("MANAGED_TAB_MISSING");
    error.code = "MANAGED_TAB_MISSING";
    throw error;
  }
  if (tab.windowId !== process.windowId || !supportedUrl(tab.url)) {
    const error = new Error("MANAGED_TAB_BINDING_INVALID");
    error.code = "MANAGED_TAB_BINDING_INVALID";
    throw error;
  }
  try {
    const expectedTurn = expectedAutonomousUserTurn(process);
    const result = await chrome.tabs.sendMessage(process.tabId, {
      type: "EIC_GF_GET_PAGE_STATE",
      source,
      expectedUserTurnId: expectedTurn.id,
      expectedUserIndex: expectedTurn.index
    });
    if (!result?.ok) {
      const error = new Error(result?.error || "PAGE_STATE_UNAVAILABLE");
      error.code = result?.code || "PAGE_STATE_UNAVAILABLE";
      throw error;
    }
    let state = result.state || {};
    if (String(state.bridgeVersion || "") !== APP_VERSION) {
      await audit(process, "CONTENT_BRIDGE_VERSION_MISMATCH", "content-observation", {
        source,
        observedVersion: state.bridgeVersion || "",
        expectedVersion: APP_VERSION
      }).catch(() => undefined);

      const bridge = await ensureContentBridgeVersion(process.tabId);
      const refreshed = await chrome.tabs.sendMessage(process.tabId, {
        type: "EIC_GF_GET_PAGE_STATE",
        source: `${source}-after-bridge-refresh`,
        expectedUserTurnId: expectedTurn.id,
        expectedUserIndex: expectedTurn.index
      });
      if (!refreshed?.ok) {
        const error = new Error(refreshed?.error || "PAGE_STATE_UNAVAILABLE_AFTER_BRIDGE_REFRESH");
        error.code = refreshed?.code || "PAGE_STATE_UNAVAILABLE_AFTER_BRIDGE_REFRESH";
        throw error;
      }
      state = refreshed.state || {};
      if (String(state.bridgeVersion || "") !== APP_VERSION) {
        const error = new Error("CONTENT_BRIDGE_VERSION_READBACK_MISMATCH");
        error.code = "CONTENT_BRIDGE_VERSION_READBACK_MISMATCH";
        throw error;
      }
      await audit(process, "CONTENT_BRIDGE_VERSION_REFRESHED", "content-observation", {
        source,
        observedVersion: bridge.observedVersion || "",
        currentVersion: state.bridgeVersion,
        documentId: state.documentId || ""
      }).catch(() => undefined);
    }

    await observeSafetyForProcess(process, state);

    if (state.rateLimitWarning?.active === true) {
      await registerGlobalRateLimitWarning(process, state, source).catch(async (error) => {
        await audit(process, "GLOBAL_RATE_LIMIT_WARNING_REGISTRATION_FAILED", "prompt-gate", {
          source,
          error: errorRecord(error)
        }).catch(() => undefined);
      });
    }

    await audit(process, "PAGE_STATE_OBSERVED", "content-observation", {
      source,
      bridgeVersion: state.bridgeVersion || "",
      documentId: state.documentId || "",
      url: state.url || "",
      title: state.title || "",
      userCount: state.userCount ?? null,
      assistantCount: state.assistantCount ?? null,
      lastUserId: state.lastUserId || "",
      lastUserHash: state.lastUserHash || "",
      lastAssistantId: state.lastAssistantId || "",
      lastAssistantOwnerKind: state.lastAssistantOwnerKind || "NONE",
      lastAssistantOwnerTrusted: state.lastAssistantOwnerTrusted === true,
      lastAssistantReplicaCount: Number(state.lastAssistantReplicaCount || 0),
      assistantHash: state.assistantHash || "",
      assistantTextLength: Number(state.assistantTextLength ?? String(state.assistantText || "").length),
      generating: state.generating === true,
      composerReady: state.composerReady === true,
      composerEmpty: state.composerEmpty === true,
      composerTextHash: state.composerTextHash || "",
      signals: state.signals || {},
      autonomousTurn: state.autonomousTurn ? {
        expectedUserTurnId: state.autonomousTurn.expectedUserTurnId || "",
        expectedUserIndex: Number.isInteger(state.autonomousTurn.expectedUserIndex) ? state.autonomousTurn.expectedUserIndex : null,
        resolvedUserTurnId: state.autonomousTurn.resolvedUserTurnId || "",
        userTextHash: state.autonomousTurn.userTextHash || "",
        resolvedBy: state.autonomousTurn.resolvedBy || "NONE",
        assistantFound: state.autonomousTurn.assistantFound === true,
        assistantId: state.autonomousTurn.assistantId || "",
        assistantOwnerKind: state.autonomousTurn.assistantOwnerKind || "NONE",
        assistantOwnerTrusted: state.autonomousTurn.assistantOwnerTrusted === true,
        assistantReplicaCount: Number(state.autonomousTurn.assistantReplicaCount || 0),
        assistantTextLength: Number(state.autonomousTurn.assistantTextLength || 0),
        assistantHash: state.autonomousTurn.assistantHash || "",
        assistantGenerating: state.autonomousTurn.assistantGenerating === true,
        assistantSignals: state.autonomousTurn.assistantSignals || {},
        nextUserTurnId: state.autonomousTurn.nextUserTurnId || "",
        responseSlotClosed: state.autonomousTurn.responseSlotClosed === true
      } : null
    }).catch(() => undefined);

    const priorRecoveryUnresolved = Number(restartReport?.unresolved?.length || 0);
    const reconciledRecovery = reconcileRecoveryReportWithLiveObservation(
      restartReport,
      process,
      state
    );
    if (reconciledRecovery !== restartReport) {
      restartReport = reconciledRecovery;
      await audit(process, "RECOVERY_REPORT_LIVE_OBSERVATION_RESOLVED", "recovery", {
        source,
        priorUnresolved: priorRecoveryUnresolved,
        remainingUnresolved: Number(restartReport?.unresolved?.length || 0),
        conversationUrl: state.url || ""
      }).catch(() => undefined);
    }
    return state;
  } catch (error) {
    error.code ||= "CONTENT_BRIDGE_UNAVAILABLE";
    throw error;
  }
}

async function contentSend(process, pending, operationId) {
  await audit(process, "PROMPT_DISPATCH_ATTEMPT", "prompt", {
    prompt: pending.text,
    promptHash: pending.hash,
    a2a: pending.a2a || null,
    sendAttempts: Number(pending.sendAttempts || 0)
  }, operationId);

  let result;
  try {
    result = await chrome.tabs.sendMessage(process.tabId, {
      type: "EIC_GF_SUBMIT_PROMPT",
      prompt: pending.text,
      promptHash: pending.hash,
      dispatchId: pending.dispatch?.operationId || operationId,
      safetyContext: { policy:(await readSafety()).policy, gptRoot:process.gptRoot }
    });
  } catch (error) {
    await audit(process, "PROMPT_DISPATCH_TRANSPORT_ERROR", "prompt", {
      promptHash: pending.hash,
      effectStatus: "UNKNOWN",
      error: errorRecord(error)
    }, operationId);
    const wrapped = new Error(error?.message || "PROMPT_SEND_TRANSPORT_FAILED");
    wrapped.code = "PROMPT_SEND_EFFECT_UNKNOWN";
    wrapped.effectPossible = null;
    throw wrapped;
  }

  await audit(process, "PROMPT_DISPATCH_RESULT", "prompt", {
    ok: result?.ok === true,
    effectPossible: result?.effectPossible === true,
    acknowledged: result?.acknowledged === true,
    acknowledgementEvidence: result?.acknowledgementEvidence || "",
    dispatchId: result?.dispatchId || pending.dispatch?.operationId || operationId,
    documentId: result?.documentId || "",
    method: result?.method || "",
    promptHash: pending.hash,
    before: result?.before || null,
    after: result?.after || null,
    materializedReceipt: result?.materializedReceipt || null,
    elapsedMs: result?.elapsedMs ?? null,
    rateLimitDetected: result?.rateLimitDetected === true,
    rateLimitNoEffectConfirmed: result?.rateLimitNoEffectConfirmed === true,
    rateLimitWarning: result?.rateLimitWarning || result?.after?.rateLimitWarning || null,
    error: result?.error || ""
  }, operationId);

  if (result?.rateLimitDetected === true || result?.rateLimitWarning?.active === true) {
    return result;
  }

  if (!result?.ok && result?.effectPossible !== true) {
    const error = new Error(result?.error || "PROMPT_SEND_FAILED");
    error.code = result?.code || "PROMPT_SEND_FAILED";
    error.effectPossible = result?.effectPossible === false ? false : null;
    throw error;
  }
  return result || { ok: false, effectPossible: true, code: "PROMPT_SEND_EFFECT_UNKNOWN" };
}

async function buildPendingA2A(process, {
  objective,
  objectiveId = "",
  messageType,
  operatorInstruction = null,
  previousResponseHash = "",
  previousDisposition = "",
  analysisEvidence = null,
  sessionRotation = null,
  pauseResume = null,
  processStatusMode = "",
  baselineAssistantHash = "",
  turn = process.turn
}) {
  const virtual = { ...process, turn };
  const processStatus = String(processStatusMode || "").toUpperCase() === PROCESS_STATUS_REQUEST
    ? buildFullProcessStatus(virtual, { at: Date.now() })
    : null;
  // v1.7.7: session-boundary prompts are FULL; same-conversation follow-ups may
  // be COMPACT only with positive conversation continuity evidence (v1.7.8:
  // a reload of the same conversation is not a boundary).
  const promptProfile = selectPromptProfile({
    process: virtual,
    messageType,
    previous: process.lastPrompt?.promptProfile || null,
    observed: {
      responseConversationKey: process.lastResponse?.observation?.conversationKey || ""
    },
    forceFull: Boolean(processStatus),
    forceReason: "AI_REQUESTED_FULL_PROMPT"
  });
  const composeArgs = {
    process: virtual,
    objective,
    objectiveId,
    messageType,
    operatorInstruction,
    previousResponseHash,
    previousDisposition,
    analysisEvidence,
    processStatus,
    sessionRotation,
    pauseResume
  };
  const composed = composeA2APrompt({ ...composeArgs, promptProfile });
  const hash = await sha256Hex(composed.text);
  let fullFallback = null;
  if (promptProfile.profile === PROMPT_PROFILE.COMPACT) {
    const fallbackProfile = upgradedFullProfile(promptProfile);
    const fallback = composeA2APrompt({ ...composeArgs, promptProfile: fallbackProfile });
    fullFallback = {
      text: fallback.text,
      hash: await sha256Hex(fallback.text),
      a2a: fallback.envelope,
      promptProfile: fallbackProfile
    };
  }
  const operatorSettings = await loadOperatorSettings(chrome.storage.local, { restoreSavedMissions: false, bookmarks: null }).catch(() => ({ postDelaySeconds: 0 }));
  return {
    text: composed.text,
    hash,
    postDelaySeconds: Number(operatorSettings.postDelaySeconds || 0),
    promptPause: null,
    baselineAssistantHash: baselineAssistantHash || previousResponseHash || "",
    createdAt: nowIso(),
    sendAttempts: 0,
    dispatch: null,
    a2a: composed.envelope,
    promptProfile,
    fullFallback,
    oneShotInstruction: operatorInstruction ? {
      instructionId: operatorInstruction.instructionId,
      text: operatorInstruction.text,
      createdAt: operatorInstruction.createdAt || nowIso()
    } : null
  };
}


async function queueRuntimeSettings() {
  const settings = await loadOperatorSettings(
    chrome.storage.local,
    { restoreSavedMissions: false, bookmarks: null }
  ).catch(() => ({}));
  return {
    defaultMissionQuantumInteractions: normalizeMissionQuantumInteractions(
      settings.defaultMissionQuantumInteractions ?? DEFAULT_MISSION_QUANTUM_INTERACTIONS
    ),
    queuePriorityAgingSeconds: Number(
      settings.queuePriorityAgingSeconds ?? DEFAULT_QUEUE_PRIORITY_AGING_SECONDS
    ),
    queueSwitchHardReload: settings.queueSwitchHardReload == null
      ? DEFAULT_QUEUE_SWITCH_HARD_RELOAD
      : settings.queueSwitchHardReload === true,
    queueSwitchDelaySeconds: Number(
      settings.queueSwitchDelaySeconds ?? DEFAULT_QUEUE_SWITCH_DELAY_SECONDS
    ),
    queueSwitchSettleSeconds: Number(
      settings.queueSwitchSettleSeconds ?? DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS
    )
  };
}

async function missionQueueForWindow(windowId) {
  if (!Number.isInteger(Number(windowId))) throw new Error("WINDOW_ID_REQUIRED");
  const binding = await ensureWorkerBinding(Number(windowId), chrome.storage.session);
  const settings = await queueRuntimeSettings();
  const queue = await loadMissionWorkQueue(Number(windowId), chrome.storage.local, {
    workerId: binding.workerId,
    defaultMaxInteractions: settings.defaultMissionQuantumInteractions
  });
  return { queue, settings, worker: binding };
}

function queueItemForProcess(queue, process) {
  const itemId = String(process?.queueContext?.itemId || "");
  return itemId ? queue?.items?.find((item) => item.itemId === itemId) || null : null;
}

function missionQueueWakeAlarmName(windowId, workerId) {
  const id = String(workerId || "").trim();
  if (!id) throw new Error("MISSION_QUEUE_WAKE_WORKER_REQUIRED");
  return `${MISSION_QUEUE_WAKE_PREFIX}${encodeURIComponent(id)}:${Number(windowId)}`;
}

function parseMissionQueueWakeAlarmName(name) {
  const suffix = String(name || "").slice(MISSION_QUEUE_WAKE_PREFIX.length);
  const split = suffix.lastIndexOf(":");
  if (split <= 0) return null;
  const workerId = decodeURIComponent(suffix.slice(0, split));
  const windowId = Number(suffix.slice(split + 1));
  if (!workerId || !Number.isInteger(windowId)) return null;
  return { workerId, windowId };
}

async function syncMissionQueueWakeAlarm(queue) {
  if (!Number.isInteger(queue?.windowId)) return;
  const name = missionQueueWakeAlarmName(queue.windowId, queue.workerId);
  const now = Date.now();
  // v1.8.1: a slot becomes runnable at the later of its status time (pause,
  // blocked retry) and its schedule's next opening (run window, pauseUntil).
  const wakeTimes = (queue.items || [])
    .map((item) => queueItemNextRunnableAtMs(item, now))
    .filter((when) => Number.isFinite(when) && when > now)
    .sort((a,b) => a-b);
  if (!queue.enabled || wakeTimes.length === 0) {
    await chrome.alarms.clear(name).catch(() => undefined);
    return;
  }
  await chrome.alarms.create(name, { when: wakeTimes[0] }).catch(() => undefined);
}

async function persistMissionQueue(queue, settings, process = null, kind = "MISSION_QUEUE_UPDATED", detail = {}) {
  const saved = await saveMissionWorkQueue(queue, chrome.storage.local, {
    defaultMaxInteractions: settings?.defaultMissionQuantumInteractions ?? DEFAULT_MISSION_QUANTUM_INTERACTIONS
  });
  await syncMissionQueueWakeAlarm(saved);
  await appendAudit({
    process: process || undefined,
    scope: process ? "RUN" : "WINDOW",
    auditSessionId: process?.auditSessionId || BACKGROUND_AUDIT_SESSION_ID,
    windowId: process?.windowId ?? saved.windowId,
    tabId: process?.tabId ?? null,
    kind,
    component: "mission-work-queue",
    payload: {
      queueId: saved.queueId,
      activeItemId: saved.activeItemId,
      enabled: saved.enabled,
      itemCount: saved.items.length,
      historyCount: saved.history.length,
      ...detail
    }
  }).catch(() => undefined);
  return saved;
}

function queueResumeRecordFromAnalysis({
  current,
  effectiveNextPrompt,
  previousDisposition,
  analysisEvidence,
  sessionReason = "",
  pauseUntilMs = 0,
  processStatusRequest = ""
}) {
  return {
    objective: String(effectiveNextPrompt || "").trim() ||
      sessionRotationObjective(current.objectiveState?.objective || current.goal),
    previousResponseHash: current.lastResponse?.hash || "",
    previousDisposition: String(previousDisposition || "CONTINUE"),
    analysisEvidence: analysisEvidence && typeof analysisEvidence === "object"
      ? deepClone(analysisEvidence)
      : null,
    sessionReason: String(sessionReason || ""),
    pauseUntilMs: Number(pauseUntilMs || 0),
    processStatusRequest: String(
      processStatusRequest ||
      current.lastResponse?.contract?.value?.greenfieldStatusRequest ||
      ""
    ).toUpperCase() === PROCESS_STATUS_REQUEST
      ? PROCESS_STATUS_REQUEST
      : "",
    recordedAt: nowIso()
  };
}

async function buildQueueActivationProcess({
  queue,
  item,
  settings,
  windowId,
  tab,
  gptRoot,
  auditSessionId = "",
  priorProcess = null
}) {
  const activationAtMs = Date.now();
  const activationTelemetry = activatedQueueSlotTelemetry(item, activationAtMs);
  const activationItem = { ...item, ...activationTelemetry };
  const queueContext = createQueueContext(queue, activationItem, {
    interactionCount: Number(activationItem?.quantumProgress || 0),
    now: activationAtMs
  });
  let process;
  let messageType;
  let objective;
  let previousResponseHash = "";
  let previousDisposition = "";
  let analysisEvidence = null;
  let sessionSeq = 1;
  let generation = 1;
  let turn = 1;
  let sessionHealth = null;
  const parkedSnapshotPresent = Boolean(item.processSnapshot?.processId && item.processSnapshot?.runId);
  const parkedMatchesWorker = Boolean(
    parkedSnapshotPresent &&
    item.processSnapshot?.workerId &&
    String(item.processSnapshot.workerId) === String(queue?.workerId || "")
  );

  if (parkedMatchesWorker) {
    const parked = deepClone(item.processSnapshot);
    generation = Number(parked.generation || 1) + 1;
    sessionSeq = Number(parked.sessionSeq || 1) + 1;
    turn = Number(parked.turn || 0) + 1;
    objective = sessionRotationObjective(
      item.resume?.objective ||
      parked.objectiveState?.objective ||
      parked.goal
    );
    previousResponseHash = item.resume?.previousResponseHash || parked.lastResponse?.hash || "";
    previousDisposition = item.resume?.previousDisposition || parked.lastDecision?.disposition || "CONTINUE";
    analysisEvidence = item.resume?.analysisEvidence || null;
    sessionHealth = resetSessionHealthForRotation(parked.sessionHealth, {
      sessionSeq,
      sessionStartTurn: turn,
      now: Date.now()
    });
    process = {
      ...parked,
      version: APP_VERSION,
      workerId: queue.workerId,
      generation,
      windowId,
      tabId: tab.id,
      gptRoot,
      sessionSeq,
      phase: PHASES.ROTATING,
      schedulerPriority: normalizeGreenfieldPriority(item.priority),
      queueContext,
      turn,
      missionPause: null,
      sessionHealth,
      responseCandidate: null,
      responseInterleave: null,
      waitingRefresh: null,
      recovery: resetRecovery(parked).recovery,
      detached: null,
      lastError: null,
      completedAt: null,
      updatedAt: nowIso()
    };
    messageType = "SESSION_ROTATION";
  } else {
    objective = String(item.resume?.objective || "").trim() || initialMissionObjective();
    previousResponseHash = item.resume?.previousResponseHash || "";
    previousDisposition = item.resume?.previousDisposition || "";
    analysisEvidence = item.resume?.analysisEvidence || null;
    process = createProcess({
      workerId: queue.workerId,
      windowId,
      tabId: tab.id,
      gptRoot,
      goal: item.goal,
      initialPrompt: objective,
      baselineAssistantHash: previousResponseHash,
      auditSessionId,
      schedulerPriority: item.priority,
      queueContext
    });
    process.phase = PHASES.ROTATING;
    sessionHealth = process.sessionHealth;
    messageType = item.resume?.objective || parkedSnapshotPresent ? "MISSION_RESTORE" : "MISSION_START";
  }

  const rotationId = randomId("queue-switch");
  const rotation = createSessionRotationRecord({
    rotationId,
    reasonCode: parkedSnapshotPresent ? "QUEUE_MISSION_RESUME" : "QUEUE_MISSION_START",
    reason: parkedSnapshotPresent
      ? "Work-queue mission resumed in a fresh ChatGPT conversation."
      : "Work-queue mission starts in a fresh ChatGPT conversation.",
    requestedBy: "MISSION_WORK_QUEUE",
    gptRoot,
    sourceUrl: tab.url || priorProcess?.gptRoot || "",
    sessionSeq
  });
  rotation.sourceTabId = Number.isInteger(priorProcess?.tabId) ? priorProcess.tabId : tab.id;
  rotation.targetTabId = tab.id;
  rotation.sourceResponseState = item.resume?.sourceResponseState || (parkedSnapshotPresent
    ? "COMPLETED_RESPONSE_CHECKPOINTED"
    : "NEW_QUEUE_MISSION");
  rotation.queueSwitch = true;
  rotation.queueId = queue.queueId;
  rotation.queueItemId = item.itemId;
  rotation.hardReloadBeforeResume = settings.queueSwitchHardReload === true;
  rotation.hardReloadState = settings.queueSwitchHardReload === true ? "PENDING" : "DISABLED";
  rotation.switchDelayMs = priorProcess?.queueContext?.itemId
    ? Math.max(0, Number(settings.queueSwitchDelaySeconds || 0) * 1000)
    : 0;
  rotation.switchNotBeforeAtMs = Date.now() + rotation.switchDelayMs;
  rotation.settleMs = Math.max(0, Number(settings.queueSwitchSettleSeconds || 0) * 1000);
  process.sessionRotation = rotation;

  const pendingPrompt = await buildPendingA2A(process, {
    objective,
    messageType,
    previousResponseHash,
    previousDisposition,
    analysisEvidence,
    processStatusMode: item.resume?.processStatusRequest || "",
    sessionRotation: parkedSnapshotPresent ? {
      ...rotation,
      sourceResponseState: rotation.sourceResponseState
    } : null,
    baselineAssistantHash: "",
    turn
  });
  process.pendingPrompt = pendingPrompt;
  process.objectiveState = {
    ...(process.objectiveState || {}),
    objectiveId: pendingPrompt.a2a?.objectiveId || randomId("objective"),
    objective,
    status: "PENDING",
    updatedAt: nowIso()
  };
  process.updatedAt = nowIso();
  return process;
}

async function activateQueueItem({
  queue,
  item,
  settings,
  windowId,
  priorProcess = null,
  auditSessionId = ""
}) {
  let tab = null;
  if (Number.isInteger(priorProcess?.tabId)) {
    try {
      const candidate = await chrome.tabs.get(priorProcess.tabId);
      if (candidate?.windowId === windowId && supportedUrl(candidate.url)) tab = candidate;
    } catch {}
  }
  if (!tab) {
    const tabs = await chrome.tabs.query({ windowId, active: true }).catch(() => []);
    tab = tabs.find((candidate) => Number.isInteger(candidate.id) && supportedUrl(candidate.url)) || null;
  }
  if (!tab) {
    const error = new Error("ACTIVE_CHATGPT_TAB_REQUIRED");
    error.code = "ACTIVE_CHATGPT_TAB_REQUIRED";
    throw error;
  }

  const gptRoot = deriveGptRoot(tab.url || "", priorProcess?.gptRoot || "");
  if (!gptRoot) {
    const error = new Error("GPT_ROOT_UNRESOLVED");
    error.code = "GPT_ROOT_UNRESOLVED";
    throw error;
  }

  const process = await buildQueueActivationProcess({
    queue,
    item,
    settings,
    windowId,
    tab,
    gptRoot,
    auditSessionId: auditSessionId || priorProcess?.auditSessionId || BACKGROUND_AUDIT_SESSION_ID,
    priorProcess
  });

  const consumedProcessStatusRequest =
    String(item.resume?.processStatusRequest || "").toUpperCase() === PROCESS_STATUS_REQUEST;
  const activeLogicalSavedMissionId = String(item.savedMissionId || "").trim();
  queue.items = queue.items.map((candidate) => {
    const sameLogicalMission = candidate.itemId === item.itemId ||
      Boolean(activeLogicalSavedMissionId &&
        String(candidate.savedMissionId || "").trim() === activeLogicalSavedMissionId);
    const clearedResume = consumedProcessStatusRequest && sameLogicalMission && candidate.resume
      ? { ...candidate.resume, processStatusRequest: "" }
      : candidate.resume;
    if (candidate.itemId === item.itemId) {
      const telemetry = {
        activationCount: Number(process.queueContext?.activationCount || candidate.activationCount || 0),
        lastLoopRoundTripMs: process.queueContext?.loopRoundTripApproxMs !== null &&
            process.queueContext?.loopRoundTripApproxMs !== undefined &&
            Number.isFinite(Number(process.queueContext.loopRoundTripApproxMs))
          ? Number(process.queueContext.loopRoundTripApproxMs)
          : candidate.lastLoopRoundTripMs
      };
      return {
        ...candidate,
        ...telemetry,
        status: QUEUE_STATUS.ACTIVE,
        pauseUntilMs: 0,
        blockedSinceMs: 0,
        blockedRetryAtMs: 0,
        activatedAt: nowIso(),
        resume: clearedResume || null,
        updatedAt: nowIso()
      };
    }
    if (candidate.status === QUEUE_STATUS.ACTIVE) {
      return {
        ...candidate,
        status: QUEUE_STATUS.READY,
        readySinceMs: Date.now(),
        resume: clearedResume || null,
        updatedAt: nowIso()
      };
    }
    if (clearedResume !== candidate.resume) {
      return {
        ...candidate,
        resume: clearedResume || null,
        updatedAt: nowIso()
      };
    }
    return candidate;
  });
  queue.activeItemId = item.itemId;
  queue.enabled = true;

  await saveProcess(process);
  const readback = await loadProcessForWindow(windowId);
  if (!readback || readback.processId !== process.processId ||
      readback.queueContext?.itemId !== item.itemId ||
      readback.phase !== PHASES.ROTATING) {
    throw new Error("MISSION_QUEUE_PROCESS_ACTIVATION_READBACK_MISMATCH");
  }
  const savedQueue = await persistMissionQueue(
    queue,
    settings,
    process,
    "MISSION_QUEUE_ITEM_ACTIVATED",
    {
      itemId: item.itemId,
      label: item.label,
      priority: item.priority,
      maxInteractions: item.maxInteractions,
      resumed: Boolean(item.processSnapshot),
      freshChatRequired: true,
      hardReloadBeforeResume: settings.queueSwitchHardReload === true,
      switchDelaySeconds: priorProcess?.queueContext?.itemId
        ? settings.queueSwitchDelaySeconds
        : 0,
      settleSeconds: settings.queueSwitchSettleSeconds
    }
  );
  await setWatchdog(process);
  await broadcast(process, "mission-queue-activated");
  scheduleFast(process.processId, 50);
  return { process, queue: savedQueue };
}

async function startMissionQueue({ windowId, auditSessionId = "" }) {
  await runtimeReady;
  if (runtimeFault) throw new Error(runtimeFault);
  if (!Number.isInteger(windowId)) throw new Error("WINDOW_ID_REQUIRED");
  const current = await loadProcessForWindow(windowId);
  if (current && !TERMINAL_PHASES.has(current.phase)) {
    const error = new Error("ACTIVE_PROCESS_EXISTS");
    error.code = "ACTIVE_PROCESS_EXISTS";
    throw error;
  }
  await reconcileTerminalQueueSlot(current);
  const { queue, settings } = await missionQueueForWindow(windowId);
  if (!Array.isArray(queue.items) || queue.items.length === 0) {
    const error = new Error("MISSION_WORK_QUEUE_EMPTY");
    error.code = "MISSION_WORK_QUEUE_EMPTY";
    throw error;
  }
  queue.enabled = true;
  const item = selectNextMissionItem(queue, {
    afterOrder: queue.cursorOrder
  });
  if (!item) {
    const saved = await persistMissionQueue(
      queue,
      settings,
      current,
      "MISSION_QUEUE_STARTED_WAITING",
      { waitingForRunnableItem: true }
    );
    return {
      ok: true,
      waiting: true,
      process: publicSnapshot(current),
      missionQueue: publicMissionWorkQueue(saved)
    };
  }
  const activated = await activateQueueItem({
    queue,
    item,
    settings,
    windowId,
    priorProcess: current,
    auditSessionId
  });
  return {
    ok: true,
    process: publicSnapshot(activated.process),
    missionQueue: publicMissionWorkQueue(activated.queue)
  };
}

async function stopMissionQueue({ windowId, reason = "OPERATOR_QUEUE_STOP" }) {
  const { queue, settings } = await missionQueueForWindow(windowId);
  queue.enabled = false;
  const saved = await persistMissionQueue(queue, settings, null, "MISSION_QUEUE_STOPPED", { reason });
  const process = await loadProcessForWindow(windowId);
  if (process?.phase === PHASES.QUEUE_WAIT) {
    const stopped = await commitTransition(process, PHASES.STOPPED, {
      queueWait: null,
      lastError: { code: "STOPPED", message: String(reason) }
    }, {
      kind: "MISSION_QUEUE_WAIT_STOPPED",
      component: "mission-work-queue",
      detail: { reason }
    });
    return { ok: true, process: publicSnapshot(stopped), missionQueue: publicMissionWorkQueue(saved) };
  }
  if (process && !TERMINAL_PHASES.has(process.phase)) {
    const result = await stopRun({ windowId, reason });
    return {
      ok: true,
      process: result.process,
      missionQueue: publicMissionWorkQueue(saved)
    };
  }
  return { ok: true, process: publicSnapshot(process), missionQueue: publicMissionWorkQueue(saved) };
}

async function wakeMissionQueue(windowId, reason = "QUEUE_WAKE_ALARM") {
  const process = await loadProcessForWindow(windowId);
  if (process && !TERMINAL_PHASES.has(process.phase)) return process;
  await reconcileTerminalQueueSlot(process);
  const { queue, settings } = await missionQueueForWindow(windowId);
  if (!queue.enabled) return process;
  const item = selectNextMissionItem(queue, {
    afterOrder: queue.cursorOrder
  });
  if (!item) {
    await syncMissionQueueWakeAlarm(queue);
    return process;
  }
  const activated = await activateQueueItem({
    queue,
    item,
    settings,
    windowId,
    priorProcess: process,
    auditSessionId: process?.auditSessionId || BACKGROUND_AUDIT_SESSION_ID
  });
  await audit(activated.process, "MISSION_QUEUE_WAKE_ACTIVATED", "mission-work-queue", {
    reason,
    itemId: item.itemId
  }).catch(() => undefined);
  return activated.process;
}

async function updateQueueFromUi({ windowId, operation, itemId = "", ...payload }) {
  const { settings, worker } = await missionQueueForWindow(windowId);
  let queue;
  switch (String(operation || "").toUpperCase()) {
    case "ADD":
      queue = await addMissionWorkItem(windowId, payload.goal, {
        storage: chrome.storage.local,
        workerId: worker.workerId,
        priority: payload.priority || DEFAULT_GREENFIELD_PRIORITY,
        maxInteractions: payload.maxInteractions ?? settings.defaultMissionQuantumInteractions,
        savedMissionId: payload.savedMissionId || "",
        label: payload.label || ""
      });
      break;
    case "REMOVE":
      queue = await removeMissionWorkItem(windowId, itemId, chrome.storage.local, { workerId: worker.workerId });
      break;
    case "MOVE_UP":
      queue = await moveMissionWorkItem(windowId, itemId, "UP", chrome.storage.local, { workerId: worker.workerId });
      break;
    case "MOVE_DOWN":
      queue = await moveMissionWorkItem(windowId, itemId, "DOWN", chrome.storage.local, { workerId: worker.workerId });
      break;
    case "UPDATE": {
      const patch = {
        priority: payload.priority,
        maxInteractions: payload.maxInteractions
      };
      if (Object.prototype.hasOwnProperty.call(payload, "schedule")) {
        // v1.8.1: strict operator schedule edit; absent fields keep their value.
        const current = await loadMissionWorkQueue(windowId, chrome.storage.local, { workerId: worker.workerId });
        const slot = current.items.find((candidate) => candidate.itemId === String(itemId || ""));
        if (!slot) throw new Error("MISSION_WORK_QUEUE_ITEM_NOT_FOUND");
        const parsed = parseScheduleEdit(payload.schedule, { now: Date.now(), current: slot.schedule, editor: "OPERATOR" });
        if (!parsed.ok) {
          const error = new Error(`MISSION_QUEUE_SCHEDULE_INVALID:${parsed.error}`);
          error.code = "MISSION_QUEUE_SCHEDULE_INVALID";
          throw error;
        }
        patch.schedule = parsed.schedule;
      }
      queue = await updateMissionWorkItem(windowId, itemId, patch, chrome.storage.local, { workerId: worker.workerId });
      await syncMissionQueueWakeAlarm(queue).catch(() => undefined);
      break;
    }
    case "CLEAR_HISTORY": {
      queue = await loadMissionWorkQueue(windowId, chrome.storage.local, {
        workerId: worker.workerId,
        defaultMaxInteractions: settings.defaultMissionQuantumInteractions
      });
      queue.history = [];
      queue = await saveMissionWorkQueue(queue, chrome.storage.local, {
        defaultMaxInteractions: settings.defaultMissionQuantumInteractions
      });
      break;
    }
    default: {
      const error = new Error("MISSION_QUEUE_OPERATION_INVALID");
      error.code = "MISSION_QUEUE_OPERATION_INVALID";
      throw error;
    }
  }
  if (String(operation || "").toUpperCase() === "UPDATE") {
    const process = await loadProcessForWindow(windowId).catch(() => null);
    const item = queue.items.find((candidate) => candidate.itemId === String(itemId || ""));
    if (process?.queueContext?.itemId === String(itemId || "") && item) {
      const updatedProcess = {
        ...process,
        schedulerPriority: normalizeGreenfieldPriority(item.priority),
        queueContext: {
          ...process.queueContext,
          priority: normalizeGreenfieldPriority(item.priority),
          operatorPriority: normalizeGreenfieldPriority(item.operatorPriority || item.priority),
          maxInteractions: normalizeMissionQuantumInteractions(item.maxInteractions),
          schedule: item.schedule ? deepClone(item.schedule) : null
        },
        updatedAt: nowIso()
      };
      await saveProcess(updatedProcess);
      await refreshSchedulerPriority(updatedProcess);
      await broadcast(updatedProcess, "mission-queue-active-item-updated");
    }
    // A schedule edit may make an idle worker's slot runnable right now.
    if (Object.prototype.hasOwnProperty.call(payload, "schedule")) {
      void wakeMissionQueue(windowId, "QUEUE_SCHEDULE_EDITED").catch(() => undefined);
    }
  }

  await appendAudit({
    scope: "WINDOW",
    auditSessionId: payload.auditSessionId || BACKGROUND_AUDIT_SESSION_ID,
    windowId,
    kind: "MISSION_QUEUE_UI_MUTATION",
    component: "mission-work-queue",
    payload: { operation, itemId, itemCount: queue.items.length }
  }).catch(() => undefined);
  return { ok: true, missionQueue: publicMissionWorkQueue(queue) };
}

async function mutateMissionQueueSet({
  windowId,
  operation,
  setId = "",
  name = "",
  auditSessionId = ""
} = {}) {
  const op = String(operation || "").trim().toUpperCase();
  const { queue, settings, worker } = await missionQueueForWindow(windowId);
  let missionQueue = queue;
  let store;

  if (op === "SAVE") {
    const saved = await saveMissionQueueSet({ name, queue, setId }, chrome.storage.local);
    store = saved.store;
  } else if (op === "UPDATE") {
    // v1.8.1: re-save the selected set from the active queue, keeping its
    // identity and name, so a changed queue does not require a new set.
    const current = await loadMissionQueueSets(chrome.storage.local);
    const existing = current.sets.find((candidate) => candidate.setId === String(setId || ""));
    if (!existing) {
      const error = new Error("MISSION_QUEUE_SET_NOT_FOUND");
      error.code = "MISSION_QUEUE_SET_NOT_FOUND";
      throw error;
    }
    if (!queue.items.length) {
      const error = new Error("MISSION_QUEUE_SET_UPDATE_EMPTY_QUEUE");
      error.code = "MISSION_QUEUE_SET_UPDATE_EMPTY_QUEUE";
      throw error;
    }
    const saved = await saveMissionQueueSet({ name: existing.name, queue, setId: existing.setId }, chrome.storage.local);
    store = saved.store;
    name = existing.name;
  } else if (op === "DELETE") {
    store = await deleteMissionQueueSet(setId, chrome.storage.local);
  } else if (op === "APPLY") {
    const process = await loadProcessForWindow(windowId).catch(() => null);
    if (process && !TERMINAL_PHASES.has(process.phase)) {
      const error = new Error("MISSION_QUEUE_SET_ACTIVE_PROCESS");
      error.code = "MISSION_QUEUE_SET_ACTIVE_PROCESS";
      throw error;
    }
    if (queue.enabled || queue.activeItemId) {
      const error = new Error("MISSION_QUEUE_SET_REQUIRES_STOPPED_QUEUE");
      error.code = "MISSION_QUEUE_SET_REQUIRES_STOPPED_QUEUE";
      throw error;
    }
    store = await loadMissionQueueSets(chrome.storage.local);
    const set = store.sets.find((candidate) => candidate.setId === String(setId || ""));
    if (!set) {
      const error = new Error("MISSION_QUEUE_SET_NOT_FOUND");
      error.code = "MISSION_QUEUE_SET_NOT_FOUND";
      throw error;
    }
    missionQueue = applyMissionQueueSet(queue, set, {
      workerId: worker.workerId,
      windowId
    });
    missionQueue = await saveMissionWorkQueue(missionQueue, chrome.storage.local, {
      defaultMaxInteractions: settings.defaultMissionQuantumInteractions
    });
    await syncMissionQueueWakeAlarm(missionQueue);
  } else {
    const error = new Error("MISSION_QUEUE_SET_OPERATION_INVALID");
    error.code = "MISSION_QUEUE_SET_OPERATION_INVALID";
    throw error;
  }

  await appendAudit({
    scope: "WINDOW",
    auditSessionId: auditSessionId || BACKGROUND_AUDIT_SESSION_ID,
    windowId,
    kind: "MISSION_QUEUE_SET_MUTATION",
    component: "mission-queue-sets",
    payload: {
      operation: op,
      setId: String(setId || ""),
      name: String(name || ""),
      workerId: worker.workerId,
      queueId: missionQueue.queueId
    }
  }).catch(() => undefined);

  return {
    ok: true,
    missionQueue: publicMissionWorkQueue(missionQueue),
    missionQueueSets: publicMissionQueueSets(store)
  };
}


async function registerResponseMissionDelegations(process, targetResponse) {
  const requests = Array.isArray(targetResponse?.missionDelegations)
    ? targetResponse.missionDelegations
    : [];
  if (requests.length === 0) return { accepted: [], duplicates: [] };

  const sourceQueueId = String(process?.queueContext?.queueId || "");
  const sourceItemId = String(process?.queueContext?.itemId || "");
  if (!sourceQueueId || !sourceItemId) {
    await audit(process, "MISSION_DELEGATION_REJECTED_SOURCE_NOT_QUEUE_MANAGED", "mission-delegation", {
      requestIds: requests.map((item) => String(item?.requestId || "")).filter(Boolean)
    }).catch(() => undefined);
    return { accepted: [], duplicates: [] };
  }

  try {
    const result = await missionDelegationQueues.enqueue("registry", () =>
      registerMissionDelegationRequests(requests, {
        sourceWindowId: process.windowId,
        sourceQueueId,
        sourceItemId,
        sourceProcessId: process.processId,
        sourceRunId: process.runId,
        sourceResponseHash: process.lastResponse?.hash || "",
        sourcePriority: process.queueContext?.priority || DEFAULT_GREENFIELD_PRIORITY
      }, chrome.storage.local)
    );

    await audit(process, "MISSION_DELEGATION_REQUESTS_PERSISTED", "mission-delegation", {
      accepted: result.accepted.map((item) => ({
        requestId: item.requestId,
        relation: item.relation,
        priority: item.priority
      })),
      duplicates: result.duplicates.map((item) => item.requestId),
      supervisorContinues: true,
      selfQueueMutation: false
    }).catch(() => undefined);

    // The supervising worker never inserts into its own queue. It only wakes
    // already-running queue-managed workers so one of them can accept the
    // durable request inside that worker's own queue context.
    const workers = await loadAllProcesses().catch(() => []);
    for (const worker of workers) {
      if (!worker?.processId || worker.processId === process.processId) continue;
      if (Number(worker.windowId) === Number(process.windowId)) continue;
      if (!worker.queueContext?.itemId || TERMINAL_PHASES.has(worker.phase)) continue;
      scheduleFast(worker.processId, 100);
    }
    return result;
  } catch (error) {
    await audit(process, "MISSION_DELEGATION_REQUEST_PERSIST_FAILED", "mission-delegation", {
      error: errorRecord(error),
      supervisorContinues: true,
      selfQueueMutation: false
    }).catch(() => undefined);
    return { accepted: [], duplicates: [], error };
  }
}

async function acceptPendingMissionDelegationForWorker(process) {
  if (!process?.queueContext?.itemId || TERMINAL_PHASES.has(process.phase)) return process;
  const targetWindowId = Number(process.windowId);
  if (!Number.isInteger(targetWindowId)) return process;

  let queueState;
  try {
    queueState = await missionQueueForWindow(targetWindowId);
  } catch {
    return process;
  }
  if (!queueState?.queue?.queueId ||
      String(queueState.queue.queueId) !== String(process.queueContext.queueId || "")) {
    return process;
  }

  let delegation = null;
  try {
    const liveProcesses = await loadAllProcesses().catch(() => []);
    const liveTargetQueueIds = liveProcesses
      .filter((candidate) => candidate?.queueContext?.queueId && !TERMINAL_PHASES.has(candidate.phase))
      .map((candidate) => String(candidate.queueContext.queueId));
    const claim = await missionDelegationQueues.enqueue("registry", () =>
      claimPendingMissionDelegationForWorker({
        targetWindowId,
        targetQueueId: queueState.queue.queueId
      }, chrome.storage.local, { liveTargetQueueIds })
    );
    delegation = claim?.delegation || null;
  } catch (error) {
    await audit(process, "MISSION_DELEGATION_CLAIM_FAILED", "mission-delegation", {
      error: errorRecord(error)
    }).catch(() => undefined);
    return process;
  }
  if (!delegation) return process;

  try {
    const savedQueue = await addMissionWorkItem(targetWindowId, delegation.mission, {
      storage: chrome.storage.local,
      workerId: queueState.worker.workerId,
      priority: delegation.priority,
      maxInteractions: queueState.settings.defaultMissionQuantumInteractions,
      label: delegation.label || "EIC-delegerat uppdrag",
      delegation: {
        requestId: delegation.requestId,
        relation: delegation.relation,
        sourceWindowId: delegation.sourceWindowId,
        sourceQueueId: delegation.sourceQueueId,
        sourceItemId: delegation.sourceItemId,
        sourceProcessId: delegation.sourceProcessId,
        createdBy: "EIC_DELEGATED_FROM_OTHER_GFW",
        createdAt: delegation.createdAt
      }
    });
    const targetItem = [...savedQueue.items, ...savedQueue.history]
      .find((item) => item.delegation?.requestId === delegation.requestId);
    if (!targetItem) throw new Error("MISSION_DELEGATION_TARGET_ITEM_READBACK_MISSING");

    await missionDelegationQueues.enqueue("registry", async () => {
      if (targetItem.status === QUEUE_STATUS.DONE) {
        return markMissionDelegationCompleted(delegation.requestId, chrome.storage.local);
      }
      return markMissionDelegationApplied(
        delegation.requestId,
        targetItem.itemId,
        chrome.storage.local
      );
    });

    await syncMissionQueueWakeAlarm(savedQueue).catch(() => undefined);
    await audit(process, "MISSION_DELEGATION_ACCEPTED_BY_WORKER", "mission-delegation", {
      requestId: delegation.requestId,
      relation: delegation.relation,
      sourceWindowId: delegation.sourceWindowId,
      sourceQueueId: delegation.sourceQueueId,
      sourceItemId: delegation.sourceItemId,
      targetWindowId,
      targetQueueId: savedQueue.queueId,
      targetItemId: targetItem.itemId,
      targetStatus: targetItem.status,
      supervisorSelfCreation: false
    }).catch(() => undefined);
  } catch (error) {
    await missionDelegationQueues.enqueue("registry", () =>
      releaseMissionDelegation(
        delegation.requestId,
        errorRecord(error),
        chrome.storage.local
      )
    ).catch(() => undefined);
    await audit(process, "MISSION_DELEGATION_WORKER_ACCEPT_FAILED", "mission-delegation", {
      requestId: delegation.requestId,
      error: errorRecord(error)
    }).catch(() => undefined);
  }
  return process;
}

async function makeDelegationSourceRetryable(delegation, targetProcess) {
  if (String(delegation?.relation || "") !== MISSION_DELEGATION_RELATION.UNBLOCKS_CURRENT) return;
  const sourceWindowId = Number(delegation?.sourceWindowId);
  if (!Number.isInteger(sourceWindowId)) return;

  let sourceWindow = null;
  try {
    sourceWindow = await chrome.windows.get(sourceWindowId);
  } catch {}
  if (!sourceWindow?.id) return;

  let queueState;
  try {
    queueState = await missionQueueForWindow(sourceWindowId);
  } catch {
    return;
  }
  if (String(queueState.queue?.queueId || "") !== String(delegation.sourceQueueId || "")) return;

  let changed = false;
  const now = Date.now();
  queueState.queue.items = queueState.queue.items.map((candidate) => {
    if (candidate.itemId !== String(delegation.sourceItemId || "") ||
        candidate.status !== QUEUE_STATUS.BLOCKED) {
      return candidate;
    }
    changed = true;
    return {
      ...candidate,
      readySinceMs: now,
      blockedRetryAtMs: now,
      lastOutcome: candidate.lastOutcome || "DELEGATED_UNBLOCKER_COMPLETED",
      updatedAt: nowIso(now)
    };
  });
  if (!changed) return;

  await persistMissionQueue(
    queueState.queue,
    queueState.settings,
    targetProcess,
    "MISSION_QUEUE_DELEGATED_UNBLOCKER_COMPLETED",
    {
      requestId: delegation.requestId,
      sourceQueueId: delegation.sourceQueueId,
      sourceItemId: delegation.sourceItemId
    }
  ).catch(() => undefined);
  void wakeMissionQueue(sourceWindowId, "DELEGATED_UNBLOCKER_COMPLETED");
}

async function completeMissionDelegationForQueueItem(process, item, queueStatus) {
  const requestId = String(item?.delegation?.requestId || "");
  if (!requestId || queueStatus !== QUEUE_STATUS.DONE) return;
  await missionDelegationQueues.enqueue("registry", () =>
    markMissionDelegationCompleted(requestId, chrome.storage.local)
  ).catch(() => undefined);
  await makeDelegationSourceRetryable(item.delegation, process).catch(() => undefined);
  await audit(process, "MISSION_DELEGATION_CHILD_COMPLETED", "mission-delegation", {
    requestId,
    relation: item.delegation?.relation || "",
    sourceQueueId: item.delegation?.sourceQueueId || "",
    sourceItemId: item.delegation?.sourceItemId || ""
  }).catch(() => undefined);
}

async function parkQueueMissionAfterAnalysis({
  current,
  completedInteractions,
  effectiveNextPrompt,
  previousDisposition,
  analysisEvidence,
  greenfieldControl,
  effectiveDecision,
  result,
  latestInstruction = null,
  pauseSeconds = null,
  requestedSessionAction = "KEEP",
  quantumReached = false,
  scheduleBlock = ""
}) {
  const { queue, settings } = await missionQueueForWindow(current.windowId);
  const item = queueItemForProcess(queue, current);
  if (!queue.enabled || !item) return null;

  const pauseUntilMs = Number.isFinite(Number(pauseSeconds)) && Number(pauseSeconds) > 0
    ? Date.now() + Number(pauseSeconds) * 1000
    : 0;
  const maxInteractions = normalizeMissionQuantumInteractions(current.queueContext?.maxInteractions);
  const resumedQuantumProgress = quantumReached
    ? 0
    : Math.min(Math.max(0, maxInteractions - 1), Math.max(0, Number(completedInteractions || 0)));
  const resume = queueResumeRecordFromAnalysis({
    current,
    effectiveNextPrompt,
    previousDisposition,
    analysisEvidence,
    sessionReason: result.targetResponse?.sessionReason || "",
    pauseUntilMs,
    processStatusRequest: result.targetResponse?.greenfieldStatusRequest || ""
  });
  const parkedSnapshot = {
    ...deepClone(current),
    lastNano: result.nano || null,
    lastNanoTask: result.nanoTask || current.lastNanoTask || null,
    lastDecision: effectiveDecision,
    greenfieldControl: {
      ...greenfieldControl,
      effectiveNextPrompt
    },
    queueContext: {
      ...current.queueContext,
      interactionCount: resumedQuantumProgress,
      maxInteractions
    },
    objectiveState: {
      objectiveId: result.currentObjectiveId || current.objectiveState?.objectiveId || "",
      objective: effectiveNextPrompt,
      status: pauseUntilMs > 0 ? "PAUSED_QUEUE" : "PARKED_QUEUE",
      updatedAt: nowIso()
    },
    responseCandidate: null,
    responseInterleave: null,
    waitingRefresh: null,
    lastError: null,
    updatedAt: nowIso()
  };

  const logicalSavedMissionId = String(item.savedMissionId || "").trim();
  const isSameLogicalMission = (candidate) =>
    candidate.itemId === item.itemId ||
    Boolean(logicalSavedMissionId && String(candidate.savedMissionId || "").trim() === logicalSavedMissionId);
  const outcome = scheduleBlock
    ? scheduleParkOutcome(scheduleBlock)
    : requestedSessionAction === "BACKGROUND_SLEEP"
    ? "EIC_BACKGROUND_SLEEP"
    : requestedSessionAction === "YIELD_TO_QUEUE"
      ? "EIC_YIELD_TO_QUEUE"
      : requestedSessionAction === "PAUSE_PROCESS"
        ? "EIC_PAUSE_PARKED"
        : quantumReached
          ? "QUANTUM_EXHAUSTED"
          : "MISSION_QUEUE_PARKED";
  const summary = String(result.targetResponse?.summary || effectiveDecision?.analysis || "").slice(0, 2000);
  return parkSlotAndActivateNext({
    current,
    queue,
    settings,
    item,
    parkedSnapshot,
    resume,
    outcome,
    summary,
    resumedQuantumProgress,
    pauseUntilMs,
    latestInstruction,
    idleWhenNoNext: Boolean(scheduleBlock),
    parkDetail: {
      completedInteractions,
      maxInteractions,
      quantumReached: quantumReached === true,
      requestedSessionAction,
      scheduleBlock
    }
  });
}

// Shared queue-local park: checkpoint the logical GFW on its slot(s), then
// activate the next runnable slot in explicit order. Returns null without
// writing anything when no other slot is runnable, so callers keep their
// fallback (continue current slot, or same-GFW session rotation).
async function parkSlotAndActivateNext({
  current,
  queue,
  settings,
  item,
  parkedSnapshot,
  resume,
  outcome,
  summary,
  resumedQuantumProgress,
  pauseUntilMs = 0,
  latestInstruction = null,
  parkDetail = {},
  idleWhenNoNext = false
}) {
  const now = Date.now();

  // The scheduling slot owns quantum progress, while savedMissionId owns the
  // logical continuation. Duplicate slots therefore share the newest mission
  // checkpoint without sharing independent counters/timing.
  queue.items = applyQueueParkTransition(queue.items, item, {
    pauseUntilMs,
    resumedQuantumProgress,
    parkedSnapshot,
    resume,
    outcome,
    summary,
    now,
    responseRoundTripMs: latestResponseRoundTripMs(current.sessionHealth)
  });
  queue.activeItemId = "";
  queue.cursorOrder = Number(item.order);

  // Decide from the post-checkpoint queue. PAUSE/BACKGROUND_SLEEP pauses every
  // duplicate slot of the same saved GFW, so another copy cannot bypass the
  // logical mission's requested not-before time.
  const selected = selectNextMissionItem(queue, {
    afterOrder: queue.cursorOrder,
    excludeItemId: item.itemId
  });
  // v1.8.1: a schedule park must not fall back to continuing this slot. With
  // no other runnable slot the slot is still parked and the worker idles.
  if (!selected && !idleWhenNoNext) return null;

  await cancelSchedulerProcess(current, "MISSION_QUEUE_YIELD").catch(() => undefined);
  try { await chrome.alarms.clear(alarmName(current.processId)); } catch {}
  try { await chrome.alarms.clear(missionPauseAlarmName(current.processId)); } catch {}
  const saved = await persistMissionQueue(
    queue,
    settings,
    current,
    "MISSION_QUEUE_ITEM_PARKED",
    {
      itemId: item.itemId,
      ...parkDetail,
      resumedQuantumProgress,
      pauseUntilMs,
      outcome,
      nextItemId: selected?.itemId || "",
      queueWait: !selected,
      cursorOrder: queue.cursorOrder,
      checkpointExpected: true
    }
  );

  if (latestInstruction) {
    await clearNextInstruction(current.processId, latestInstruction.instructionId).catch(() => undefined);
  }
  const selectedReadback = selectNextMissionItem(saved, {
    afterOrder: saved.cursorOrder,
    excludeItemId: item.itemId
  });
  if (!selectedReadback) {
    return idleWhenNoNext
      ? enterQueueWait(current, saved, { reason: outcome, parkedItemId: item.itemId })
      : null;
  }
  const activated = await activateQueueItem({
    queue: saved,
    item: selectedReadback,
    settings,
    windowId: current.windowId,
    priorProcess: current,
    auditSessionId: current.auditSessionId
  });
  return activated.process;
}

function scheduleParkOutcome(block) {
  return block === SCHEDULE_BLOCK.PAUSED ? "SCHEDULE_PAUSED" : "SCHEDULE_WINDOW_CLOSED";
}

// v1.8.1: the authoritative schedule is the queue slot's; queueContext is only
// a prompt-facing copy. A queue read failure falls back to that copy.
async function activeSlotScheduleBlock(process, now = Date.now()) {
  if (!process?.queueContext?.itemId) return "";
  try {
    // Read-only and bound to this process's own worker: this runs on every
    // SENDING tick before dispatch, so it must not touch window bindings.
    const queue = await loadMissionWorkQueue(process.windowId, chrome.storage.local, {
      workerId: process.workerId || process.queueContext.workerId
    });
    if (!queue.enabled) return "";
    const item = queueItemForProcess(queue, process);
    return item ? scheduleBlockReason(item.schedule || null, now) : "";
  } catch {
    return scheduleBlockReason(process.queueContext.schedule || null, now);
  }
}

function earliestQueueWakeAtMs(queue, now = Date.now()) {
  const times = (queue?.items || [])
    .map((candidate) => queueItemNextRunnableAtMs(candidate, now))
    .filter((when) => Number.isFinite(when) && when > now)
    .sort((a, b) => a - b);
  return times[0] || null;
}

// v1.8.1: the parked slot is in the queue; the process releases its slot and
// capacity and idles in the terminal QUEUE_WAIT phase. The queue wake alarm
// (or an operator edit, or restart reconciliation) activates the next slot.
async function enterQueueWait(current, queue, { reason, parkedItemId }) {
  const nextWakeAtMs = earliestQueueWakeAtMs(queue);
  const next = await commitTransition(current, PHASES.QUEUE_WAIT, {
    queueContext: null,
    pendingPrompt: null,
    responseCandidate: null,
    responseInterleave: null,
    waitingRefresh: null,
    missionPause: null,
    queueWait: {
      reason: String(reason || ""),
      queueId: String(queue?.queueId || ""),
      parkedItemId: String(parkedItemId || ""),
      since: nowIso(),
      nextWakeAtMs
    },
    lastError: null
  }, {
    kind: "MISSION_QUEUE_WAITING_FOR_SCHEDULE",
    component: "mission-work-queue",
    detail: {
      reason,
      parkedItemId,
      nextWakeAtMs,
      nextWakeAt: nextWakeAtMs ? new Date(nextWakeAtMs).toISOString() : ""
    }
  });
  await syncMissionQueueWakeAlarm(queue).catch(() => undefined);
  await syncOverlay(next, "queue-wait").catch(() => undefined);
  return next;
}

// v1.8.1 dispatch gate: a prompt that was never dispatched is not posted
// outside the slot's schedule (pause resume, rotation, recovery, activation
// race). The slot is parked with its next objective and quantum progress.
async function parkQueueMissionForSchedule(process, block) {
  const { queue, settings } = await missionQueueForWindow(process.windowId);
  const item = queueItemForProcess(queue, process);
  if (!queue.enabled || !item) return null;
  const pending = process.pendingPrompt;
  if (pending?.promptPause?.reservationId) {
    await releaseGlobalPromptLease({ reservationId: pending.promptPause.reservationId }).catch(() => undefined);
  }
  const maxInteractions = normalizeMissionQuantumInteractions(process.queueContext?.maxInteractions);
  const resumedQuantumProgress = Math.min(
    Math.max(0, maxInteractions - 1),
    Math.max(0, Number(process.queueContext?.interactionCount || 0))
  );
  const objective = String(
    process.objectiveState?.objective ||
    process.lastDecision?.nextPrompt ||
    process.goal ||
    ""
  ).trim();
  const resume = queueResumeRecordFromAnalysis({
    current: process,
    effectiveNextPrompt: objective,
    previousDisposition: process.lastDecision?.disposition || "CONTINUE",
    analysisEvidence: null,
    sessionReason: block
  });
  const parkedSnapshot = {
    ...deepClone(process),
    pendingPrompt: null,
    queueContext: {
      ...process.queueContext,
      interactionCount: resumedQuantumProgress,
      maxInteractions
    },
    objectiveState: {
      ...(process.objectiveState || {}),
      objective,
      status: "PARKED_QUEUE",
      updatedAt: nowIso()
    },
    responseCandidate: null,
    responseInterleave: null,
    waitingRefresh: null,
    lastError: null,
    updatedAt: nowIso()
  };
  return parkSlotAndActivateNext({
    current: process,
    queue,
    settings,
    item,
    parkedSnapshot,
    resume,
    outcome: scheduleParkOutcome(block),
    summary: block === SCHEDULE_BLOCK.PAUSED
      ? "The slot's pauseUntil began before the next prompt; the slot was parked."
      : "The slot's run window closed before the next prompt; the slot was parked.",
    resumedQuantumProgress,
    idleWhenNoNext: true,
    parkDetail: { maxInteractions, scheduleBlock: block, dispatchGate: true }
  });
}

// DONE/STOP_PROCESS/COMPLETE_MISSION is a logical GFW terminal signal. If the
// same saved GFW has several queue slots for cadence shaping, retire every
// sibling slot so the queue cannot silently restart a mission the AI has
// explicitly closed. A stale queue revision is re-derived once from fresh
// state (retirement is idempotent); a persistent failure is audited and later
// self-healed by reconcileTerminalQueueSlot before any queue selection.
async function persistTerminalQueueRetirement(process, { queue, settings, item }, {
  queueStatus,
  lastOutcome,
  lastSummary
}) {
  let sourceQueue = queue;
  let sourceSettings = settings;
  let sourceItem = item;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const completedAt = nowIso();
    const retirement = retireLogicalMissionSlots(sourceQueue, sourceItem, {
      queueStatus,
      completedAt,
      lastOutcome,
      lastSummary,
      lastError: process.lastError ? deepClone(process.lastError) : null,
      maxHistory: MAX_QUEUE_HISTORY
    });
    const nextQueue = {
      ...retirement.queue,
      activeItemId: "",
      cursorOrder: Number(sourceItem.order),
      enabled: process.phase === PHASES.AUDIT_FAILURE ? false : retirement.queue.enabled
    };
    const finalized = retirement.finalizedSlots.find((candidate) => candidate.itemId === sourceItem.itemId) || {
      ...sourceItem,
      status: queueStatus,
      completedAt,
      lastOutcome,
      lastSummary
    };
    try {
      const saved = await persistMissionQueue(
        nextQueue,
        sourceSettings,
        process,
        "MISSION_QUEUE_ITEM_TERMINAL",
        {
          itemId: sourceItem.itemId,
          logicalSavedMissionId: String(sourceItem.savedMissionId || "").trim(),
          retiredSlotCount: retirement.finalizedSlots.length,
          retiredItemIds: retirement.finalizedSlots.map((candidate) => candidate.itemId),
          terminalPhase: process.phase,
          queueStatus,
          cursorOrder: nextQueue.cursorOrder,
          willAdvance: nextQueue.enabled === true && process.phase !== PHASES.AUDIT_FAILURE,
          attempt: attempt + 1
        }
      );
      return { saved, finalized, finalizedSlots: retirement.finalizedSlots };
    } catch (error) {
      await audit(process, "MISSION_QUEUE_TERMINAL_RETIREMENT_WRITE_FAILED", "mission-work-queue", {
        itemId: sourceItem.itemId,
        attempt: attempt + 1,
        error: errorRecord(error)
      }).catch(() => undefined);
      if (attempt > 0 || error?.code !== "MISSION_WORK_QUEUE_STALE_WRITE") throw error;
      const fresh = await missionQueueForWindow(process.windowId);
      const freshItem = queueItemForProcess(fresh.queue, process);
      if (!freshItem) return null;
      sourceQueue = fresh.queue;
      sourceSettings = fresh.settings;
      sourceItem = freshItem;
    }
  }
  return null;
}

// Self-heal for a DONE process whose terminal queue retirement did not persist:
// retire its logical GFW slots before any queue selection could reactivate a
// duplicate slot of a mission the AI already closed.
async function reconcileTerminalQueueSlot(process) {
  if (process?.phase !== PHASES.DONE || !process.queueContext?.itemId) return false;
  const { queue, settings } = await missionQueueForWindow(process.windowId);
  const item = queueItemForProcess(queue, process);
  // Only the exact failed-retirement state qualifies: the slot is still ACTIVE
  // for this DONE process. Any other status means something else rescheduled it.
  if (!item || item.status !== QUEUE_STATUS.ACTIVE) return false;
  const retirement = await persistTerminalQueueRetirement(process, { queue, settings, item }, {
    queueStatus: QUEUE_STATUS.DONE,
    lastOutcome: process.greenfieldControl?.reason || process.phase,
    lastSummary: String(process.lastDecision?.analysis || "").slice(0, 2000)
  });
  if (!retirement) return false;
  await completeMissionDelegationForQueueItem(process, retirement.finalized, QUEUE_STATUS.DONE);
  await audit(process, "MISSION_QUEUE_TERMINAL_RETIREMENT_RECONCILED", "mission-work-queue", {
    itemId: item.itemId,
    retiredItemIds: retirement.finalizedSlots.map((candidate) => candidate.itemId)
  }).catch(() => undefined);
  return true;
}

// v1.7.9: in queue-managed mode, exhausting the 120-minute stale-session ladder
// (F5 at 30, Ctrl-F5 at 60 and 90 minutes) is a full queue rotation. The
// unresponsive conversation is abandoned, the slot is parked with its
// unfinished quantum (the unanswered turn is not counted) and the next runnable
// slot in explicit order is activated. The parked GFW later resumes in a fresh
// chat told that its last prompt produced no completed response. Without
// another runnable slot the caller falls back to a same-GFW session rotation.
async function parkQueueMissionAfterStale(process) {
  const { queue, settings } = await missionQueueForWindow(process.windowId);
  const item = queueItemForProcess(queue, process);
  if (!queue.enabled || !item) return null;

  const maxInteractions = normalizeMissionQuantumInteractions(process.queueContext?.maxInteractions);
  const resumedQuantumProgress = Math.min(
    Math.max(0, maxInteractions - 1),
    Math.max(0, Number(process.queueContext?.interactionCount || 0))
  );
  const objective = String(
    process.objectiveState?.objective ||
    process.lastPrompt?.a2a?.objective ||
    process.goal ||
    ""
  ).trim();
  const resume = {
    ...queueResumeRecordFromAnalysis({
      current: process,
      effectiveNextPrompt: objective,
      previousDisposition: "SESSION_UNRESPONSIVE",
      analysisEvidence: null,
      sessionReason: "STALE_SESSION_120M_EXHAUSTED"
    }),
    // The earlier response's one-shot status request was consumed by the
    // unanswered prompt; it must not be replayed from that older response.
    processStatusRequest: "",
    sourceResponseState: "PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE"
  };
  const parkedSnapshot = {
    ...deepClone(process),
    queueContext: {
      ...process.queueContext,
      interactionCount: resumedQuantumProgress,
      maxInteractions
    },
    objectiveState: {
      ...(process.objectiveState || {}),
      objective,
      status: "PARKED_QUEUE",
      updatedAt: nowIso()
    },
    responseCandidate: null,
    responseInterleave: null,
    waitingRefresh: null,
    lastError: null,
    updatedAt: nowIso()
  };
  return parkSlotAndActivateNext({
    current: process,
    queue,
    settings,
    item,
    parkedSnapshot,
    resume,
    outcome: "STALE_SESSION_120M_QUEUE_ROTATION",
    summary: "No completed response within 120 minutes after F5/Ctrl-F5 recovery; the conversation was abandoned and the queue advanced.",
    resumedQuantumProgress,
    parkDetail: {
      maxInteractions,
      staleSession: true,
      unansweredPromptHash: process.lastPrompt?.hash || ""
    }
  });
}

async function finalizeQueueTerminalAndMaybeAdvance(process) {
  if (!process?.queueContext?.itemId) return process;
  const { queue, settings } = await missionQueueForWindow(process.windowId);
  const item = queueItemForProcess(queue, process);
  if (!item) return process;

  const lastSummary = String(
    process.lastDecision?.analysis ||
    process.lastResponse?.contract?.value?.summary ||
    process.lastError?.message ||
    ""
  ).slice(0, 2000);
  const lastOutcome = process.greenfieldControl?.reason || process.phase;
  const logicalSavedMissionId = String(item.savedMissionId || "").trim();
  const isSameLogicalMission = (candidate) =>
    candidate.itemId === item.itemId ||
    Boolean(logicalSavedMissionId && String(candidate.savedMissionId || "").trim() === logicalSavedMissionId);

  // BLOCKED is a retryable logical-mission state. Every duplicate slot of the
  // same saved GFW receives the same cooldown/checkpoint so duplicate placement
  // cannot create a hot-loop around one logical blocker.
  if (process.phase === PHASES.BLOCKED) {
    const resume = queueResumeRecordFromAnalysis({
      current: process,
      effectiveNextPrompt: process.objectiveState?.objective || process.goal,
      previousDisposition: process.lastDecision?.disposition || "BLOCKED",
      analysisEvidence: null,
      sessionReason: lastOutcome
    });
    const blockedQueue = requeueBlockedMissionWorkItem(queue, item.itemId, {
      processSnapshot: deepClone(process),
      resume,
      lastOutcome,
      lastSummary,
      lastError: process.lastError ? deepClone(process.lastError) : null,
      retryAfterSeconds: settings.queuePriorityAgingSeconds
    });
    const saved = await persistMissionQueue(
      blockedQueue,
      settings,
      process,
      "MISSION_QUEUE_ITEM_BLOCKED_REQUEUED",
      {
        itemId: item.itemId,
        logicalSavedMissionId,
        blockedSlotCount: blockedQueue.items.filter(isSameLogicalMission).length,
        blockedRetryAtMs: blockedQueue.items.find((candidate) => candidate.itemId === item.itemId)?.blockedRetryAtMs || 0,
        cursorOrder: blockedQueue.cursorOrder,
        willAdvance: blockedQueue.enabled === true
      }
    );
    await cancelSchedulerProcess(process, "MISSION_QUEUE_BLOCKED_REQUEUED").catch(() => undefined);
    try { await chrome.alarms.clear(alarmName(process.processId)); } catch {}
    try { await chrome.alarms.clear(missionPauseAlarmName(process.processId)); } catch {}

    if (!saved.enabled) return process;
    const nextItem = selectNextMissionItem(saved, {
      afterOrder: saved.cursorOrder
    });
    if (!nextItem) return process;
    const activated = await activateQueueItem({
      queue: saved,
      item: nextItem,
      settings,
      windowId: process.windowId,
      priorProcess: process,
      auditSessionId: process.auditSessionId
    });
    return activated.process;
  }

  let queueStatus = QUEUE_STATUS.STOPPED;
  if (process.phase === PHASES.DONE) queueStatus = QUEUE_STATUS.DONE;
  else if (process.phase === PHASES.STOPPED) queueStatus = QUEUE_STATUS.STOPPED;
  else if (process.phase === PHASES.AUDIT_FAILURE) queueStatus = QUEUE_STATUS.FAILED;

  const retirement = await persistTerminalQueueRetirement(process, { queue, settings, item }, {
    queueStatus,
    lastOutcome,
    lastSummary
  });
  if (!retirement) return process;
  const { saved, finalized } = retirement;
  await completeMissionDelegationForQueueItem(process, finalized, queueStatus);
  await cancelSchedulerProcess(process, `MISSION_QUEUE_${queueStatus}`).catch(() => undefined);
  try { await chrome.alarms.clear(alarmName(process.processId)); } catch {}
  try { await chrome.alarms.clear(missionPauseAlarmName(process.processId)); } catch {}

  if (!saved.enabled || process.phase === PHASES.AUDIT_FAILURE) return process;
  const nextItem = selectNextMissionItem(saved, {
    afterOrder: saved.cursorOrder
  });
  if (!nextItem) return process;
  const activated = await activateQueueItem({
    queue: saved,
    item: nextItem,
    settings,
    windowId: process.windowId,
    priorProcess: process,
    auditSessionId: process.auditSessionId
  });
  return activated.process;
}


function sessionRotationSourceState(process) {
  if (process.phase === PHASES.WAITING && process.lastPrompt?.acknowledged === true) {
    return "PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE";
  }
  if (process.lastResponse?.hash) return "COMPLETED_RESPONSE_CAPTURED";
  if (process.pendingPrompt?.dispatch?.effectPossible === true) return "PROMPT_EFFECT_UNKNOWN";
  return "NO_COMPLETED_RESPONSE";
}

async function resolveRotationRoot(process) {
  let tab = null;
  try {
    tab = await chrome.tabs.get(process.tabId);
  } catch {}
  const gptRoot = deriveGptRoot(tab?.url || "", process.gptRoot || "");
  return { gptRoot, tab };
}

async function armSessionRotation(process, {
  reasonCode = "SESSION_ROTATION_REQUESTED",
  reason = "",
  requestedBy = "RUNTIME",
  objective = "",
  previousResponseHash = "",
  previousDisposition = "CONTINUE",
  analysisEvidence = null,
  sourceResponseState = "",
  operatorInstruction = null,
  processStatusMode = ""
} = {}) {
  if (!process || TERMINAL_PHASES.has(process.phase)) return process;
  if (process.phase === PHASES.ROTATING) return process;

  if (process.phase === PHASES.SENDING &&
      process.pendingPrompt?.dispatch &&
      process.pendingPrompt.dispatch.acknowledged !== true &&
      process.pendingPrompt.dispatch.effectPossible !== false) {
    const error = Object.assign(
      new Error("SESSION_ROTATION_PROMPT_EFFECT_UNKNOWN"),
      { code: "SESSION_ROTATION_PROMPT_EFFECT_UNKNOWN" }
    );
    return commitTransition(process, PHASES.BLOCKED, {
      lastError: errorRecord(error)
    }, {
      kind: "SESSION_ROTATION_BLOCKED_UNKNOWN_PROMPT_EFFECT",
      component: "session-rotation",
      detail: {
        dispatchId: process.pendingPrompt?.dispatch?.operationId || "",
        promptHash: process.pendingPrompt?.hash || "",
        exactOnce: true
      }
    });
  }

  if (process.pendingPrompt?.promptPause?.reservationId) {
    await releaseGlobalPromptLease({
      reservationId: process.pendingPrompt.promptPause.reservationId
    }).catch(() => undefined);
  }

  const resolved = await resolveRotationRoot(process);
  if (!resolved.gptRoot) {
    const error = Object.assign(new Error("SESSION_ROTATION_GPT_ROOT_UNRESOLVED"), {
      code: "SESSION_ROTATION_GPT_ROOT_UNRESOLVED"
    });
    return commitTransition(process, PHASES.BLOCKED, {
      lastError: errorRecord(error)
    }, {
      kind: "SESSION_ROTATION_BLOCKED_GPT_ROOT",
      component: "session-rotation"
    });
  }

  const nextGeneration = Number(process.generation || 0) + 1;
  const nextSessionSeq = Number(process.sessionSeq || 1) + 1;
  const nextTurn = Number(process.turn || 0) + 1;
  const rotationId = randomId("rotation");
  const sourceState = sourceResponseState || sessionRotationSourceState(process);
  const rotation = createSessionRotationRecord({
    rotationId,
    reasonCode,
    reason,
    requestedBy,
    gptRoot: resolved.gptRoot,
    sourceUrl: resolved.tab?.url || "",
    sessionSeq: nextSessionSeq
  });
  rotation.sourceTabId = Number.isInteger(process.tabId) ? process.tabId : null;
  rotation.sourceResponseState = sourceState;

  const rotationObjective = sessionRotationObjective(
    objective ||
    process.objectiveState?.objective ||
    process.lastPrompt?.a2a?.objective ||
    process.goal
  );
  const rotatedSessionHealth = resetSessionHealthForRotation(process.sessionHealth, {
    sessionSeq: nextSessionSeq,
    sessionStartTurn: nextTurn,
    now: Date.now()
  });
  const virtual = {
    ...process,
    generation: nextGeneration,
    sessionSeq: nextSessionSeq,
    gptRoot: resolved.gptRoot,
    sessionRotation: rotation,
    turn: nextTurn,
    sessionHealth: rotatedSessionHealth
  };
  const pendingPrompt = await buildPendingA2A(virtual, {
    objective: rotationObjective,
    messageType: "SESSION_ROTATION",
    previousResponseHash: previousResponseHash || process.lastResponse?.hash || "",
    previousDisposition,
    analysisEvidence,
    operatorInstruction,
    processStatusMode,
    sessionRotation: {
      ...rotation,
      sourceResponseState: sourceState
    },
    baselineAssistantHash: "",
    turn: nextTurn
  });

  const next = await commitTransition(process, PHASES.ROTATING, {
    generation: nextGeneration,
    sessionSeq: nextSessionSeq,
    gptRoot: resolved.gptRoot,
    sessionRotation: rotation,
    turn: nextTurn,
    sessionHealth: rotatedSessionHealth,
    pendingPrompt,
    responseCandidate: null,
    responseInterleave: null,
    waitingRefresh: null,
    recovery: resetRecovery(process).recovery,
    lastError: null,
    objectiveState: {
      ...(process.objectiveState || {}),
      objectiveId: pendingPrompt.a2a?.objectiveId || process.objectiveState?.objectiveId || "",
      objective: rotationObjective,
      status: "PENDING",
      updatedAt: nowIso()
    }
  }, {
    kind: "SESSION_ROTATION_ARMED",
    component: "session-rotation",
    detail: {
      rotationId,
      reasonCode,
      reason,
      requestedBy,
      gptRoot: resolved.gptRoot,
      sourceUrl: resolved.tab?.url || "",
      sourceTabId: process.tabId,
      sourceResponseState: sourceState,
      nextGeneration,
      nextSessionSeq,
      nextTurn,
      promptHash: pendingPrompt.hash,
      messageType: pendingPrompt.a2a?.messageType || ""
    }
  });
  scheduleFast(next.processId, 50);
  return next;
}

async function saveRotationState(process, sessionRotation, kind, payload = {}) {
  const next = {
    ...process,
    sessionRotation,
    updatedAt: nowIso()
  };
  await saveProcess(next);
  await audit(next, kind, "session-rotation", payload);
  await broadcast(next, "session-rotation");
  return next;
}

async function tickRotating(process) {
  const rotation = process.sessionRotation;
  if (!rotation?.rotationId || !process.pendingPrompt?.text || !process.pendingPrompt?.hash) {
    const error = Object.assign(new Error("SESSION_ROTATION_STATE_INVALID"), {
      code: "SESSION_ROTATION_STATE_INVALID"
    });
    return commitTransition(process, PHASES.BLOCKED, {
      lastError: errorRecord(error)
    }, {
      kind: "SESSION_ROTATION_BLOCKED_INVALID_STATE",
      component: "session-rotation"
    });
  }

  const gptRoot = deriveGptRoot(rotation.gptRoot || "", process.gptRoot || "");
  if (!gptRoot) {
    const error = Object.assign(new Error("SESSION_ROTATION_GPT_ROOT_UNRESOLVED"), {
      code: "SESSION_ROTATION_GPT_ROOT_UNRESOLVED"
    });
    return commitTransition(process, PHASES.BLOCKED, {
      lastError: errorRecord(error)
    }, {
      kind: "SESSION_ROTATION_BLOCKED_GPT_ROOT",
      component: "session-rotation"
    });
  }

  if (rotation.state === SESSION_ROTATION_STATES.ARMED &&
      rotation.queueSwitch === true &&
      Number(rotation.switchNotBeforeAtMs || 0) > Date.now()) {
    const remainingMs = Math.max(0, Number(rotation.switchNotBeforeAtMs || 0) - Date.now());
    scheduleFast(process.processId, Math.max(200, remainingMs));
    return process;
  }

  if (rotation.state === SESSION_ROTATION_STATES.ARMED) {
    let tab = null;
    try {
      tab = await chrome.tabs.get(process.tabId);
      if (tab.windowId !== process.windowId) tab = null;
    } catch {}

    if (!tab) {
      const tabs = await chrome.tabs.query({ windowId: process.windowId }).catch(() => []);
      const candidates = tabs.filter((candidate) =>
        Number.isInteger(candidate.id) &&
        supportedUrl(candidate.url) &&
        deriveGptRoot(candidate.url || "", gptRoot) === gptRoot
      );
      if (candidates.length === 1) tab = candidates[0];
    }

    let navigating = {
      ...rotation,
      state: SESSION_ROTATION_STATES.NAVIGATING,
      gptRoot,
      sourceTabId: rotation.sourceTabId ?? process.tabId,
      navigationStartedAt: nowIso(),
      freshnessRetryCount: Number(rotation.freshnessRetryCount || 0)
    };

    if (tab) {
      navigating.targetTabId = tab.id;
      process = await saveRotationState({
        ...process,
        tabId: tab.id,
        gptRoot
      }, navigating, "SESSION_ROTATION_NAVIGATION_ARMED", {
        rotationId: rotation.rotationId,
        targetTabId: tab.id,
        gptRoot,
        method: "NAVIGATE_MANAGED_TAB"
      });
      try {
        await chrome.tabs.update(tab.id, { url: gptRoot });
        await audit(process, "SESSION_ROTATION_NAVIGATION_TRIGGERED", "chrome", {
          rotationId: rotation.rotationId,
          targetTabId: tab.id,
          gptRoot,
          method: "tabs.update"
        });
      } catch (error) {
        await audit(process, "SESSION_ROTATION_NAVIGATION_FAILED", "chrome", {
          rotationId: rotation.rotationId,
          targetTabId: tab.id,
          error: errorRecord(error)
        }).catch(() => undefined);
        return enterRecovery(process, error, PHASES.ROTATING);
      }
      scheduleFast(process.processId, 1200);
      return process;
    }

    process = await saveRotationState(process, navigating, "SESSION_ROTATION_NEW_TAB_ARMED", {
      rotationId: rotation.rotationId,
      gptRoot,
      method: "CREATE_REPLACEMENT_TAB"
    });
    try {
      const created = await chrome.tabs.create({
        windowId: process.windowId,
        url: gptRoot,
        active: false
      });
      if (!created || !Number.isInteger(created.id)) {
        throw Object.assign(new Error("SESSION_ROTATION_TAB_CREATE_NO_ID"), {
          code: "SESSION_ROTATION_TAB_CREATE_NO_ID"
        });
      }
      const adoptedRotation = {
        ...process.sessionRotation,
        targetTabId: created.id
      };
      const adopted = await saveRotationState({
        ...process,
        tabId: created.id,
        gptRoot
      }, adoptedRotation, "SESSION_ROTATION_REPLACEMENT_TAB_CREATED", {
        rotationId: rotation.rotationId,
        targetTabId: created.id,
        gptRoot
      });
      scheduleFast(adopted.processId, 1200);
      return adopted;
    } catch (error) {
      await audit(process, "SESSION_ROTATION_TAB_CREATE_FAILED", "chrome", {
        rotationId: rotation.rotationId,
        error: errorRecord(error)
      }).catch(() => undefined);
      return enterRecovery(process, error, PHASES.ROTATING);
    }
  }

  if (rotation.state !== SESSION_ROTATION_STATES.NAVIGATING) {
    const error = Object.assign(new Error(`SESSION_ROTATION_STAGE_INVALID:${rotation.state || "EMPTY"}`), {
      code: "SESSION_ROTATION_STAGE_INVALID"
    });
    return commitTransition(process, PHASES.BLOCKED, {
      lastError: errorRecord(error)
    }, {
      kind: "SESSION_ROTATION_BLOCKED_STAGE_INVALID",
      component: "session-rotation"
    });
  }

  let tab;
  try {
    tab = await chrome.tabs.get(process.tabId);
  } catch {
    const rearm = {
      ...rotation,
      state: SESSION_ROTATION_STATES.ARMED,
      targetTabId: null
    };
    const next = await saveRotationState(process, rearm, "SESSION_ROTATION_TARGET_LOST_REARMED", {
      rotationId: rotation.rotationId,
      oldTargetTabId: process.tabId
    });
    scheduleFast(next.processId, 500);
    return next;
  }

  if (!supportedUrl(tab.url)) {
    try {
      await chrome.tabs.update(tab.id, { url: gptRoot });
      scheduleFast(process.processId, 1200);
      return process;
    } catch (error) {
      return enterRecovery(process, error, PHASES.ROTATING);
    }
  }

  const navigationAgeMs = Math.max(
    0,
    Date.now() - (Date.parse(rotation.navigationStartedAt || rotation.requestedAt || "") || Date.now())
  );
  if (navigationAgeMs >= 5 * 60 * 1000) {
    const error = Object.assign(new Error("SESSION_ROTATION_CHAT_READY_TIMEOUT"), {
      code: "SESSION_ROTATION_CHAT_READY_TIMEOUT"
    });
    return commitTransition(process, PHASES.BLOCKED, {
      lastError: errorRecord(error)
    }, {
      kind: "SESSION_ROTATION_BLOCKED_CHAT_READY_TIMEOUT",
      component: "session-rotation",
      detail: {
        rotationId: rotation.rotationId,
        targetTabId: tab.id,
        gptRoot,
        navigationAgeMs,
        possibleHumanAuthBoundary: true
      }
    });
  }

  if (tab.status !== "complete") {
    scheduleFast(process.processId, 800);
    return process;
  }

  if (rotation.queueSwitch === true && rotation.hardReloadBeforeResume === true) {
    const hardReloadState = String(rotation.hardReloadState || "PENDING");
    if (hardReloadState === "PENDING") {
      const triggered = {
        ...rotation,
        hardReloadState: "TRIGGERED",
        hardReloadTriggeredAtMs: Date.now(),
        hardReloadTriggeredAt: nowIso()
      };
      process = await saveRotationState(process, triggered, "MISSION_QUEUE_HARD_RELOAD_ARMED", {
        rotationId: rotation.rotationId,
        queueId: rotation.queueId || "",
        queueItemId: rotation.queueItemId || "",
        bypassCache: true,
        settleMs: Number(rotation.settleMs || 0)
      });
      try {
        await chrome.tabs.reload(tab.id, { bypassCache: true });
      } catch (error) {
        return enterRecovery(process, error, PHASES.ROTATING);
      }
      scheduleFast(process.processId, Math.max(800, Number(rotation.settleMs || 0)));
      return process;
    }
    if (hardReloadState === "TRIGGERED") {
      const elapsed = Math.max(0, Date.now() - Number(rotation.hardReloadTriggeredAtMs || 0));
      const settleMs = Math.max(0, Number(rotation.settleMs || 0));
      if (elapsed < settleMs) {
        scheduleFast(process.processId, Math.max(200, settleMs - elapsed));
        return process;
      }
      const completed = {
        ...rotation,
        hardReloadState: "COMPLETED",
        hardReloadCompletedAt: nowIso()
      };
      process = await saveRotationState(process, completed, "MISSION_QUEUE_HARD_RELOAD_COMPLETED", {
        rotationId: rotation.rotationId,
        queueId: rotation.queueId || "",
        queueItemId: rotation.queueItemId || "",
        bypassCache: true,
        settleMs
      });
      scheduleFast(process.processId, 200);
      return process;
    }
  }

  let page;
  try {
    await ensureContentBridgeVersion(tab.id);
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "EIC_GF_GET_PAGE_STATE",
      source: "session-rotation-ready-check",
      expectedUserTurnId: "",
      expectedUserIndex: null
    });
    if (!result?.ok) throw new Error(result?.error || "SESSION_ROTATION_PAGE_STATE_UNAVAILABLE");
    page = result.state || {};
  } catch (error) {
    scheduleFast(process.processId, 1200);
    return process;
  }

  const freshChat = Number(page.userCount || 0) === 0;
  if (!freshChat) {
    const retries = Number(rotation.freshnessRetryCount || 0);
    if (retries < 2 && navigationAgeMs >= (retries + 1) * 10_000) {
      const retriedRotation = {
        ...rotation,
        freshnessRetryCount: retries + 1,
        navigationStartedAt: nowIso()
      };
      const next = await saveRotationState(process, retriedRotation, "SESSION_ROTATION_FRESH_CHAT_RENAVIGATE", {
        rotationId: rotation.rotationId,
        retry: retries + 1,
        observedUserCount: Number(page.userCount || 0),
        observedUrl: page.url || tab.url || ""
      });
      await chrome.tabs.update(tab.id, { url: gptRoot }).catch(() => undefined);
      scheduleFast(next.processId, 1200);
      return next;
    }
    scheduleFast(process.processId, 1000);
    return process;
  }

  if (page.composerReady !== true || page.composerEmpty !== true || page.generating === true) {
    scheduleFast(process.processId, 900);
    return process;
  }

  const readyRotation = {
    ...rotation,
    state: SESSION_ROTATION_STATES.READY_TO_RESUME,
    targetTabId: tab.id,
    readyAt: nowIso()
  };
  const pendingPrompt = {
    ...process.pendingPrompt,
    baselineAssistantHash: page.assistantHash || "",
    sendAttempts: 0,
    dispatch: null,
    promptPause: null
  };
  const next = await commitTransition(process, PHASES.SENDING, {
    tabId: tab.id,
    gptRoot,
    sessionRotation: readyRotation,
    pendingPrompt,
    responseCandidate: null,
    waitingRefresh: null,
    lastError: null,
    lastMaterialAt: nowIso()
  }, {
    kind: "SESSION_ROTATION_READY_TO_RESUME",
    component: "session-rotation",
    detail: {
      rotationId: rotation.rotationId,
      targetTabId: tab.id,
      gptRoot,
      newChatVerified: true,
      observedUserCount: Number(page.userCount || 0),
      composerReady: page.composerReady === true,
      messageType: pendingPrompt.a2a?.messageType || ""
    }
  });
  scheduleFast(next.processId, 50);
  return next;
}

async function enterRecovery(process, error, recoverTo) {
  if (process.phase === PHASES.AUDIT_FAILURE) return process;
  const next = withRecovery(process, {
    reason: error?.code || error?.name || "TRANSIENT_ERROR",
    detail: error?.message || String(error || ""),
    recoverTo
  });
  return commitTransition(process, PHASES.RECOVERING, {
    recovery: next.recovery,
    sessionHealth: markSessionHealthRecovery(process.sessionHealth),
    lastError: errorRecord(error)
  }, {
    kind: "RECOVERY",
    component: "runtime",
    detail: {
      reason: next.recovery.reason,
      recoverTo: next.recovery.recoverTo,
      attempt: next.recovery.attempts
    }
  });
}

async function handleDetached(process, error) {
  if (process.phase === PHASES.DETACHED) return process;
  const next = await commitTransition(process, PHASES.DETACHED, {
    detached: {
      reason: error?.code || "TARGET_DETACHED",
      detail: error?.message || "",
      resumePhase: process.phase,
      detachedAt: nowIso(),
      reconcileAttempts: 0
    },
    lastError: errorRecord(error)
  }, {
    kind: "TARGET_DETACHED",
    component: "chrome"
  });
  scheduleFast(next.processId, 2000);
  return next;
}

async function upgradeCompactPendingPrompt(process, page) {
  const pending = process.pendingPrompt;
  const fallback = pending?.fullFallback;
  if (!fallback?.text || !fallback?.hash || !fallback?.a2a) {
    const error = Object.assign(
      new Error("COMPACT_PROMPT_FULL_FALLBACK_MISSING"),
      { code: "COMPACT_PROMPT_FULL_FALLBACK_MISSING" }
    );
    return enterRecovery(process, error, PHASES.SENDING);
  }
  if (pending.promptPause?.reservationId) {
    await releaseGlobalPromptLease({ reservationId: pending.promptPause.reservationId }).catch(() => undefined);
  }
  await cancelSchedulerProcess(process, "PROMPT_PROFILE_UPGRADED_TO_FULL").catch(() => undefined);
  const upgraded = {
    ...process,
    pendingPrompt: {
      ...pending,
      text: fallback.text,
      hash: fallback.hash,
      a2a: fallback.a2a,
      promptProfile: fallback.promptProfile || upgradedFullProfile(pending.promptProfile),
      fullFallback: null,
      promptPause: null
    },
    updatedAt: nowIso()
  };
  await saveProcess(upgraded);
  await audit(upgraded, "PROMPT_PROFILE_UPGRADED_TO_FULL", "a2a", {
    compactPromptHash: pending.hash,
    fullPromptHash: fallback.hash,
    anchorConversationKey: pending.promptProfile?.anchorConversationKey || "",
    observedConversationKey: conversationKey(page?.url || ""),
    promptEffectIssued: false
  }).catch(() => undefined);
  scheduleFast(upgraded.processId, 50);
  return upgraded;
}

async function tickSending(process) {
  let page;
  try {
    page = await tabState(process, "sending");
  } catch (error) {
    return handleDetached(process, error);
  }

  let pending = process.pendingPrompt;
  if (!pending?.text || !pending?.hash) {
    const error = Object.assign(new Error("PENDING_PROMPT_MISSING"), { code: "PENDING_PROMPT_MISSING" });
    return enterRecovery(process, error, PHASES.SENDING);
  }

  // v1.8.1: never post a new prompt outside the active slot's schedule. A
  // prompt with a dispatch record is in flight and is never interrupted.
  if (!pending.dispatch && process.queueContext?.itemId) {
    const scheduleBlock = await activeSlotScheduleBlock(process);
    if (scheduleBlock) {
      const parked = await parkQueueMissionForSchedule(process, scheduleBlock);
      if (parked) return parked;
    }
  }

  // v1.7.7: a COMPACT prompt may only be posted into the exact conversation it
  // was composed for. A conversation change before the first dispatch upgrades
  // it to its FULL fallback (a reload of the same conversation does not, v1.7.8).
  // Hash-bound prompt-gate/capacity reservations are released and re-armed.
  if (!pending.dispatch &&
      pending.promptProfile?.profile === PROMPT_PROFILE.COMPACT &&
      !compactPromptStillValid(pending.promptProfile, {
        conversationKey: conversationKey(page.url || "")
      })) {
    return upgradeCompactPendingPrompt(process, page);
  }

  if (!pending.dispatch && !pending.promptPause?.reservationId) {
    const reservation = await reserveGlobalPromptSlot({
      processId: process.processId,
      windowId: process.windowId,
      promptHash: pending.hash,
      delaySeconds: pending.postDelaySeconds || 0
    });
    process = {
      ...process,
      pendingPrompt: {
        ...pending,
        promptPause: {
          reservationId: reservation.reservationId,
          reservationSeq: reservation.reservationSeq,
          reservedAtMs: reservation.reservedAtMs,
          notBeforeAtMs: reservation.notBeforeAtMs
        }
      },
      updatedAt: nowIso()
    };
    await saveProcess(process);
    pending = process.pendingPrompt;
    await audit(process, "GLOBAL_PROMPT_PAUSE_ARMED", "prompt-gate", {
      reservationId: reservation.reservationId,
      reservationSeq: reservation.reservationSeq,
      delaySeconds: pending.postDelaySeconds || 0,
      reservedAtMs: reservation.reservedAtMs,
      notBeforeAtMs: reservation.notBeforeAtMs,
      waitMs: reservation.waitMs,
      scope: "CHROME_PROFILE"
    });
    await broadcast(process, "prompt-pause-armed");
  }

  const pauseUntilMs = Number(pending.promptPause?.notBeforeAtMs || 0);
  if (!pending.dispatch && pauseUntilMs > Date.now()) {
    scheduleFast(process.processId, Math.min(30_000, Math.max(100, pauseUntilMs - Date.now())));
    return process;
  }

  const reconciliation = reconcileDispatchObservation(process, page);
  const { fence, turnProof, resolvedUserTurnId, resolvedUserTurnIndex } = reconciliation;

  await audit(process, "PROMPT_DISPATCH_FENCE_EVALUATED", "prompt", {
    promptHash: pending.hash,
    action: fence.action,
    evidence: fence.evidence || "",
    dispatchId: pending.dispatch?.operationId || "",
    dispatchStatus: pending.dispatch?.status || "",
    effectPossible: pending.dispatch?.effectPossible ?? null,
    materializedUserTurnId: pending.dispatch?.materializedUserTurnId || "",
    materializedUserTurnIndex: pending.dispatch?.materializedUserTurnIndex ?? null,
    expectedUserTurnId: turnProof.expected?.id || "",
    expectedUserTurnIndex: turnProof.expected?.index ?? null,
    resolvedUserTurnId,
    resolvedBy: turnProof.resolvedBy || "NONE",
    turnProof: turnProof.code
  });

  if (reconciliation.action === "HOLD_UNRESOLVED") {
    return holdForSafety(process, {
      code:"DISPATCH_EFFECT_UNRESOLVED",
      detail: turnProof.code
    });
  }

  // Exact-once invariant: once a dispatch operation may have crossed the
  // side-effect boundary, every later tick only reconciles. No automatic resend.
  if (reconciliation.action === "ADVANCE_TO_WAITING") {
    const evidence = fence.evidence;
    await adoptSchedulerTurnForObservedEffect(
      process,
      pending.hash,
      fence.action
    ).catch(() => undefined);
    const postedAtMs = Date.now();
    if (pending.promptPause?.reservationId) {
      const gate = await commitGlobalPromptPost({
        reservationId: pending.promptPause.reservationId,
        processId: process.processId,
        windowId: process.windowId,
        promptHash: pending.hash,
        postedAtMs
      });
      await audit(process, "GLOBAL_PROMPT_POST_COMMITTED", "prompt-gate", {
        reservationId: pending.promptPause.reservationId,
        promptHash: pending.hash,
        lastPromptPostedAtMs: gate.lastPromptPostedAtMs,
        source: fence.action
      });
    }
    const next = await commitTransition(process, PHASES.WAITING, {
      lastPrompt: {
        text: pending.text,
        hash: pending.hash,
        usageId: process.safety?.turnProof?.usageId || usageIdentity(process,pending),
        modelProof: process.safety?.turnProof || null,
        sentAt: pending.dispatch?.startedAt || nowIso(),
        postedAtMs,
        acknowledged: fence.acknowledged === true || pending.dispatch?.acknowledged === true,
        acknowledgementEvidence: evidence,
        method: pending.dispatch?.method || (fence.action === "ALREADY_MATERIALIZED" ? "external-or-prior-materialization" : ""),
        dispatchId: pending.dispatch?.operationId || "",
        baselineAssistantHash: pending.baselineAssistantHash || page.assistantHash || "",
        baselineAssistantId: page.lastAssistantId || "",
        baselineAssistantCount: Number(page.assistantCount || 0),
        dispatchedUserTurnId: resolvedUserTurnId,
        dispatchedUserTurnIndex: resolvedUserTurnIndex,
        oneShotInstruction: pending.oneShotInstruction || null,
        a2a: pending.a2a || null,
        promptProfile: pending.promptProfile || null
      },
      sessionHealth: markSessionHealthPromptPosted(process.sessionHealth, {
        sessionSeq: process.sessionSeq,
        turn: process.turn,
        promptHash: pending.hash,
        promptChars: String(pending.text || "").length,
        postedAtMs,
        timingEligible: false
      }),
      safety: {
        ...process.safety,
        hold: null
      },
      pendingPrompt: null,
      responseCandidate: null,
      waitingRefresh: createWaitingRefreshState({
        now: Date.now(),
        page: {
          lastAssistantId: page.lastAssistantId || "",
          assistantHash: pending.baselineAssistantHash || page.assistantHash || "",
          assistantCount: Number(page.assistantCount || 0)
        },
        promptHash: pending.hash,
        turn: process.turn,
        staleSince: pending.dispatch?.startedAt || nowIso()
      }),
      sessionRotation: pending.a2a?.messageType === "SESSION_ROTATION" && process.sessionRotation
        ? {
            ...process.sessionRotation,
            state: SESSION_ROTATION_STATES.RESUMED,
            resumedAt: nowIso()
          }
        : process.sessionRotation || null,
      recovery: resetRecovery(process).recovery,
      lastError: null,
      lastMaterialAt: nowIso()
    }, {
      kind: fence.action === "ALREADY_MATERIALIZED" ? "PROMPT_ACKNOWLEDGED" : "PROMPT_DISPATCH_RECONCILED",
      component: "prompt",
      detail: {
        promptHash: pending.hash,
        evidence,
        exactOnce: true,
        resendForbidden: fence.action === "WAIT_NO_RESEND",
        sessionRotationResumed: pending.a2a?.messageType === "SESSION_ROTATION",
        rotationId: pending.a2a?.messageType === "SESSION_ROTATION"
          ? process.sessionRotation?.rotationId || ""
          : "",
        dispatchedUserTurnId: resolvedUserTurnId,
        dispatchedUserTurnIndex: resolvedUserTurnIndex,
        turnProof: turnProof.code
      }
    });
    scheduleFast(next.processId, 700);
    return next;
  }

  if (page.generating) {
    await audit(process, "PROMPT_DISPATCH_HELD_TARGET_BUSY", "prompt", {
      promptHash: pending.hash,
      page: {
        assistantHash: page.assistantHash || "",
        userCount: page.userCount ?? null,
        assistantCount: page.assistantCount ?? null,
        signals: page.signals || {}
      }
    });
    scheduleFast(process.processId, 1200);
    return process;
  }

  const gateSafety = await sendingSafetyDecision(process, page, pending);
  if (!gateSafety.allowed) return holdForSafety(process, gateSafety);
  if (process.safety?.hold) {
    process.safety = {...process.safety,hold:null};
    await saveProcess(process);
  }

  const pause = pending.promptPause;
  if (!pause?.reservationId) {
    const error = Object.assign(new Error("GLOBAL_PROMPT_RESERVATION_MISSING"), {
      code: "GLOBAL_PROMPT_RESERVATION_MISSING"
    });
    return enterRecovery(process, error, PHASES.SENDING);
  }

  let gateClaim = await claimGlobalPromptSend({
    reservationId: pause.reservationId,
    processId: process.processId,
    windowId: process.windowId,
    promptHash: pending.hash,
    delaySeconds: pending.postDelaySeconds || 0,
    reservationNotBeforeAtMs: pause.notBeforeAtMs || 0
  });
  if (gateClaim.allowed !== true) {
    if (gateClaim.notBeforeAtMs > Number(pause.notBeforeAtMs || 0)) {
      process = {
        ...process,
        pendingPrompt: {
          ...pending,
          promptPause: {
            ...pause,
            notBeforeAtMs: gateClaim.notBeforeAtMs
          }
        },
        updatedAt: nowIso()
      };
      await saveProcess(process);
      pending = process.pendingPrompt;
      await audit(process, "GLOBAL_PROMPT_PAUSE_EXTENDED", "prompt-gate", {
        reservationId: pause.reservationId,
        reason: gateClaim.reason,
        notBeforeAtMs: gateClaim.notBeforeAtMs,
        delaySeconds: pending.postDelaySeconds || 0
      });
      await broadcast(process, "prompt-pause-extended");
    }
    scheduleFast(
      process.processId,
      Math.min(30_000, Math.max(100, Number(gateClaim.retryAfterMs || 250)))
    );
    return process;
  }

  if (gateClaim.recovery?.preflightRequired === true) {
    let preflight;
    try {
      preflight = await executeRateLimitRecoveryPreflight(process, gateClaim);
    } catch (error) {
      await releaseGlobalPromptLease({
        reservationId: pause.reservationId
      }).catch(() => undefined);
      await audit(process, "GLOBAL_RATE_LIMIT_RECOVERY_PREFLIGHT_FAILED", "prompt-gate", {
        epoch: gateClaim.recovery?.epoch ?? null,
        error: errorRecord(error),
        promptEffectIssued: false
      }).catch(() => undefined);
      const wrapped = Object.assign(new Error(error?.message || "RATE_LIMIT_RECOVERY_PREFLIGHT_FAILED"), {
        code: error?.code || "RATE_LIMIT_RECOVERY_PREFLIGHT_FAILED",
        effectPossible: false
      });
      return enterRecovery(process, wrapped, PHASES.SENDING);
    }

    if (preflight?.ok !== true) {
      await releaseGlobalPromptLease({
        reservationId: pause.reservationId
      }).catch(() => undefined);
      await audit(process, "GLOBAL_RATE_LIMIT_RECOVERY_PREFLIGHT_STALE", "prompt-gate", {
        epoch: gateClaim.recovery?.epoch ?? null,
        reason: preflight?.reason || "",
        mode: preflight?.mode || "",
        promptEffectIssued: false
      }).catch(() => undefined);
      scheduleFast(process.processId, 250);
      return process;
    }

    page = preflight.page || page;
    gateClaim = await claimGlobalPromptSend({
      reservationId: pause.reservationId,
      processId: process.processId,
      windowId: process.windowId,
      promptHash: pending.hash,
      delaySeconds: pending.postDelaySeconds || 0,
      reservationNotBeforeAtMs: pause.notBeforeAtMs || 0
    });
    if (gateClaim.allowed !== true || gateClaim.recovery?.preflightRequired === true) {
      await releaseGlobalPromptLease({
        reservationId: pause.reservationId
      }).catch(() => undefined);
      await audit(process, "GLOBAL_RATE_LIMIT_RECOVERY_RECLAIM_BLOCKED", "prompt-gate", {
        epoch: preflight.epoch,
        mode: preflight.mode,
        reason: gateClaim.reason || "",
        preflightRequired: gateClaim.recovery?.preflightRequired === true,
        promptEffectIssued: false
      }).catch(() => undefined);
      scheduleFast(
        process.processId,
        Math.min(30_000, Math.max(100, Number(gateClaim.retryAfterMs || 250)))
      );
      return process;
    }
  }

  const capacityContext = await schedulerCapacityContext();
  const capacityClaim = await requestGlobalTurnSlot({
    processId: process.processId,
    windowId: process.windowId,
    promptHash: pending.hash,
    priority: process.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY,
    capacity: capacityContext.effectiveCapacity,
    configuredCapacity: capacityContext.configuredCapacity
  });
  if (capacityClaim.allowed !== true) {
    const staleSameProcessPrompt = Boolean(
      capacityClaim.reason === "GLOBAL_CAPACITY_ACTIVE_PROMPT_MISMATCH" &&
      capacityClaim.activeTurn?.processId === process.processId &&
      capacityClaim.activeTurn?.promptHash &&
      capacityClaim.activeTurn.promptHash !== pending.hash &&
      !pending.dispatch
    );
    if (staleSameProcessPrompt) {
      await releaseGlobalPromptLease({
        reservationId: pause.reservationId
      }).catch(() => undefined);
      const stalePromptHash = capacityClaim.activeTurn.promptHash;
      await cancelSchedulerProcess(
        process,
        "STALE_ACTIVE_PROMPT_REARM"
      );
      await audit(process, "GLOBAL_CAPACITY_STALE_PROMPT_REARMED", "capacity-scheduler", {
        stalePromptHash,
        nextPromptHash: pending.hash,
        reason: capacityClaim.reason,
        promptEffectIssued: false
      }).catch(() => undefined);
      scheduleFast(process.processId, 50);
      return process;
    }

    await releaseGlobalPromptLease({
      reservationId: pause.reservationId
    }).catch(() => undefined);
    await audit(process, "GLOBAL_CAPACITY_WAITING", "capacity-scheduler", {
      reason: capacityClaim.reason,
      queueRank: capacityClaim.queueRank ?? null,
      priority: normalizeGreenfieldPriority(process.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY),
      effectivePriority: capacityClaim.effectivePriority || "",
      activeCount: capacityClaim.scheduler?.activeCount ?? null,
      waitingCount: capacityClaim.scheduler?.waitingCount ?? null,
      configuredCapacity: capacityContext.configuredCapacity,
      effectiveCapacity: capacityContext.effectiveCapacity,
      antiStarvation: "AGING"
    }).catch(() => undefined);
    wakeSchedulerProcesses(capacityClaim.runnableProcessIds || []);
    await broadcast(process, "capacity-waiting");
    return process;
  }

  await audit(process, "GLOBAL_CAPACITY_SLOT_ACQUIRED", "capacity-scheduler", {
    reason: capacityClaim.reason,
    priority: normalizeGreenfieldPriority(process.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY),
    activeCount: capacityClaim.scheduler?.activeCount ?? null,
    waitingCount: capacityClaim.scheduler?.waitingCount ?? null,
    configuredCapacity: capacityContext.configuredCapacity,
    effectiveCapacity: capacityContext.effectiveCapacity
  }).catch(() => undefined);
  wakeSchedulerProcesses(capacityClaim.runnableProcessIds || []);

  const replaySameDispatch = fence.action === "REPLAY_SAME_DISPATCH_ID";
  const operationId = replaySameDispatch
    ? String(pending.dispatch?.operationId || "")
    : randomId("send");
  const baselineAssistantHash = pending.baselineAssistantHash || page.assistantHash || "";
  const dispatch = replaySameDispatch
    ? {
        ...pending.dispatch,
        status: "IDEMPOTENT_REPLAY",
        effectPossible: null,
        replayCount: Number(pending.dispatch?.replayCount || 0) + 1,
        lastReplayAt: nowIso()
      }
    : {
        operationId,
        status: "PREPARED",
        startedAt: nowIso(),
        effectPossible: null,
        acknowledged: false,
        acknowledgementEvidence: "",
        method: "",
        baselineDocumentId: page.documentId || "",
        baselineUserCount: Number(page.userCount || 0),
        baselineAssistantCount: Number(page.assistantCount || 0),
        baselineAssistantHash,
        replayCount: 0
      };
  const freshSafetyPage = await tabState(process, "pre-dispatch-model-recheck");
  const freshProof = Safety.evaluateModel(freshSafetyPage.modelEvidence, (await readSafety()).policy, {url:freshSafetyPage.url,gptRoot:process.gptRoot});
  if (!freshProof.allowed) return holdForSafety(process, freshProof);
  const usage = await reserveUsage({id:usageIdentity(process,pending),processId:process.processId,workerId:process.workerId,prompt:pending.text,proof:freshProof});
  if (!usage.allowed) return holdForSafety(process, usage);
  process.safety = {...process.safety,turnProof:{...freshProof,promptHash:pending.hash,usageId:usageIdentity(process,pending)},hold:null};
  const working = {
    ...process,
    pendingPrompt: {
      ...pending,
      baselineAssistantHash,
      sendAttempts: replaySameDispatch
        ? Number(pending.sendAttempts || 1)
        : Number(pending.sendAttempts || 0) + 1,
      dispatch
    },
    updatedAt: nowIso()
  };

  // Write-ahead dispatch identity is persisted before the page effect. If the
  // callback is lost, the exact same dispatchId may only be replayed in the same
  // content document, where the content bridge deduplicates it.
  await saveProcess(working);
  await audit(working, replaySameDispatch ? "PROMPT_DISPATCH_IDEMPOTENT_REPLAY" : "PROMPT_DISPATCH_WRITE_AHEAD", "prompt", {
    operationId,
    promptHash: pending.hash,
    baselineDocumentId: working.pendingPrompt.dispatch?.baselineDocumentId || "",
    baselineUserCount: working.pendingPrompt.dispatch?.baselineUserCount ?? null,
    baselineAssistantCount: working.pendingPrompt.dispatch?.baselineAssistantCount ?? null,
    baselineAssistantHash,
    exactOnceFence: true,
    replaySameDispatch
  }, operationId);

  const finalGateClaim = await claimGlobalPromptSend({
    reservationId: pause.reservationId,
    processId: working.processId,
    windowId: working.windowId,
    promptHash: pending.hash,
    delaySeconds: pending.postDelaySeconds || 0,
    reservationNotBeforeAtMs: pause.notBeforeAtMs || 0
  });
  if (finalGateClaim.allowed !== true || finalGateClaim.recovery?.preflightRequired === true) {
    await releaseGlobalPromptLease({
      reservationId: pause.reservationId
    }).catch(() => undefined);
    const aborted = {
      ...working,
      pendingPrompt: {
        ...working.pendingPrompt,
        dispatch: {
          ...working.pendingPrompt.dispatch,
          status: "ABORTED_BEFORE_EFFECT_GLOBAL_RATE_LIMIT",
          effectPossible: false,
          acknowledged: false,
          completedAt: nowIso()
        }
      },
      updatedAt: nowIso()
    };
    await saveProcess(aborted);
    await audit(aborted, "PROMPT_DISPATCH_ABORTED_BEFORE_EFFECT", "prompt-gate", {
      operationId,
      reason: finalGateClaim.reason || "GLOBAL_RATE_LIMIT_REVALIDATION_REQUIRED",
      preflightRequired: finalGateClaim.recovery?.preflightRequired === true,
      epoch: finalGateClaim.recovery?.epoch ?? null,
      promptEffectIssued: false
    }, operationId);
    await releaseSchedulerTurn(aborted, {
      promptHash: pending.hash,
      reason: "ABORTED_BEFORE_EFFECT_GLOBAL_GATE"
    }).catch(() => undefined);
    scheduleFast(
      aborted.processId,
      Math.min(30_000, Math.max(100, Number(finalGateClaim.retryAfterMs || 250)))
    );
    return aborted;
  }

  let result;
  try {
    result = await contentSend(working, working.pendingPrompt, operationId);
  } catch (error) {
    const refreshed = await findProcessById(process.processId);
    if (!refreshed || refreshed.phase !== PHASES.SENDING) return refreshed;

    const receiptDispatch = refreshed.pendingPrompt?.dispatch;
    if (error?.effectPossible == null &&
        receiptDispatch?.effectPossible === true &&
        receiptDispatch?.acknowledged === true &&
        receiptDispatch?.materializedUserTurnId) {
      await audit(refreshed, "PROMPT_DISPATCH_TRANSPORT_RECONCILED_BY_RECEIPT", "prompt", {
        operationId: receiptDispatch.operationId || operationId,
        promptHash: refreshed.pendingPrompt?.hash || pending.hash,
        materializedUserTurnId: receiptDispatch.materializedUserTurnId,
        materializedUserTurnIndex: receiptDispatch.materializedUserTurnIndex ?? null,
        transportError: errorRecord(error),
        automaticResend: false
      }, receiptDispatch.operationId || operationId).catch(() => undefined);
      scheduleFast(refreshed.processId, 50);
      return refreshed;
    }

    if (error?.effectPossible === true) {
      const fenced = {
        ...refreshed,
        pendingPrompt: {
          ...refreshed.pendingPrompt,
          dispatch: {
            ...(refreshed.pendingPrompt?.dispatch || working.pendingPrompt.dispatch),
            status: "EFFECT_UNKNOWN",
            effectPossible: true,
            error: errorRecord(error)
          }
        },
        updatedAt: nowIso()
      };
      await saveProcess(fenced);
      await audit(fenced, "PROMPT_DISPATCH_EFFECT_UNKNOWN", "prompt", {
        operationId,
        promptHash: pending.hash,
        error: errorRecord(error),
        exactOnce: true,
        automaticResend: false
      }, operationId);
      scheduleFast(fenced.processId, 250);
      return fenced;
    }
    if (error?.effectPossible == null) {
      const unknown = {
        ...refreshed,
        pendingPrompt: {
          ...refreshed.pendingPrompt,
          dispatch: {
            ...(refreshed.pendingPrompt?.dispatch || working.pendingPrompt.dispatch),
            status: "TRANSPORT_UNKNOWN",
            effectPossible: null,
            error: errorRecord(error)
          }
        },
        updatedAt: nowIso()
      };
      await saveProcess(unknown);
      await audit(unknown, "PROMPT_DISPATCH_TRANSPORT_UNKNOWN", "prompt", {
        operationId,
        promptHash: pending.hash,
        baselineDocumentId: unknown.pendingPrompt?.dispatch?.baselineDocumentId || "",
        automaticResend: false,
        idempotentReplayOnly: true
      }, operationId);
      scheduleFast(unknown.processId, 350);
      return unknown;
    }
    await releaseGlobalPromptLease({
      reservationId: refreshed.pendingPrompt?.promptPause?.reservationId || pending.promptPause?.reservationId || ""
    }).catch(() => undefined);
    const retryable = {
      ...refreshed,
      pendingPrompt: {
        ...refreshed.pendingPrompt,
        dispatch: {
          ...(refreshed.pendingPrompt?.dispatch || working.pendingPrompt.dispatch),
          status: "NO_EFFECT_CONFIRMED",
          effectPossible: false,
          error: errorRecord(error)
        }
      },
      updatedAt: nowIso()
    };
    await saveProcess(retryable);
    await audit(retryable, "PROMPT_DISPATCH_NO_EFFECT_CONFIRMED", "prompt", {
      operationId,
      promptHash: pending.hash,
      error: errorRecord(error),
      retrySafe: true
    }, operationId);
    await releaseSchedulerTurn(retryable, {
      promptHash: pending.hash,
      reason: "PROMPT_SEND_NO_EFFECT_CONFIRMED"
    }).catch(() => undefined);
    if (/LOCAL_|SYSTEM_CLOCK_|MODEL_|THINKING_|SAFETY_|CHAT_MODE_|EIC_SURFACE_|OPERATOR_DRAFT|PROVIDER_|ADMISSION_|DISPATCH_AUTHORIZATION|DISPATCH_OWNER|BLOCKING_CHATGPT_UI|SEND_CONTROL_UNAVAILABLE/.test(error.code || "")) {
      return holdForSafety(retryable,{code:error.code});
    }
    return enterRecovery(retryable, error, PHASES.SENDING);
  }

  const refreshed = await findProcessById(process.processId);
  const token = ownerToken(working, operationId);
  if (!isCurrentToken(refreshed, token) || refreshed.phase !== PHASES.SENDING) {
    if (refreshed) {
      await audit(refreshed, "STALE_CALLBACK_REJECTED", "runtime", {
        source: "PROMPT_DISPATCH_RESULT",
        token,
        currentGeneration: refreshed?.generation ?? null,
        currentPhase: refreshed?.phase ?? null
      }, operationId).catch(() => undefined);
    }
    return refreshed || working;
  }

  if (result?.rateLimitDetected === true ||
      result?.rateLimitWarning?.active === true ||
      result?.after?.rateLimitWarning?.active === true) {
    await registerGlobalRateLimitWarning(refreshed, result, "prompt-send-result", operationId)
      .catch(async (error) => {
        await audit(refreshed, "GLOBAL_RATE_LIMIT_WARNING_REGISTRATION_FAILED", "prompt-gate", {
          source: "prompt-send-result",
          operationId,
          error: errorRecord(error)
        }, operationId).catch(() => undefined);
      });
  }

  const effectPossible = result?.effectPossible === true || result?.ok === true;
  if (!effectPossible) {
    await releaseGlobalPromptLease({
      reservationId: refreshed.pendingPrompt?.promptPause?.reservationId || pending.promptPause?.reservationId || ""
    }).catch(() => undefined);
    const noEffect = {
      ...refreshed,
      pendingPrompt: {
        ...refreshed.pendingPrompt,
        dispatch: {
          ...(refreshed.pendingPrompt?.dispatch || working.pendingPrompt.dispatch),
          status: result?.rateLimitDetected === true
            ? "RATE_LIMIT_REJECTED_NO_EFFECT"
            : "NO_EFFECT_CONFIRMED",
          effectPossible: false,
          acknowledged: false,
          acknowledgementEvidence: result?.acknowledgementEvidence || "",
          completedAt: nowIso()
        }
      },
      updatedAt: nowIso()
    };
    await saveProcess(noEffect);
    await audit(noEffect, result?.rateLimitDetected === true
      ? "PROMPT_DISPATCH_RATE_LIMIT_NO_EFFECT"
      : "PROMPT_DISPATCH_NO_EFFECT_CONFIRMED", "prompt", {
      operationId,
      promptHash: pending.hash,
      rateLimitDetected: result?.rateLimitDetected === true,
      retrySafe: true
    }, operationId);
    await releaseSchedulerTurn(noEffect, {
      promptHash: pending.hash,
      reason: result?.rateLimitDetected === true
        ? "RATE_LIMIT_REJECTED_NO_EFFECT"
        : "PROMPT_SEND_NO_EFFECT_CONFIRMED"
    }).catch(() => undefined);
    const error = Object.assign(new Error(result?.error || "PROMPT_SEND_NO_EFFECT"), {
      code: result?.code || "PROMPT_SEND_NO_EFFECT",
      effectPossible: false
    });
    return enterRecovery(noEffect, error, PHASES.SENDING);
  }

  const postedAtMs = Date.now();
  const gate = await commitGlobalPromptPost({
    reservationId: refreshed.pendingPrompt?.promptPause?.reservationId || pending.promptPause?.reservationId || "",
    processId: refreshed.processId,
    windowId: refreshed.windowId,
    promptHash: pending.hash,
    postedAtMs
  });
  await audit(refreshed, "GLOBAL_PROMPT_POST_COMMITTED", "prompt-gate", {
    reservationId: refreshed.pendingPrompt?.promptPause?.reservationId || "",
    promptHash: pending.hash,
    lastPromptPostedAtMs: gate.lastPromptPostedAtMs,
    source: "CONTENT_SEND_RESULT"
  });

  const priorDispatch = refreshed.pendingPrompt?.dispatch || working.pendingPrompt.dispatch;
  const resultReceipt = result?.materializedReceipt && typeof result.materializedReceipt === "object"
    ? result.materializedReceipt
    : null;
  const receiptTurnIndex = Number(resultReceipt?.userTurnIndex);
  const materializedUserTurnId = String(
    priorDispatch?.materializedUserTurnId ||
    resultReceipt?.userTurnId ||
    ""
  );
  const materializedUserTurnIndex = priorDispatch?.materializedUserTurnIndex != null &&
      Number.isInteger(Number(priorDispatch.materializedUserTurnIndex))
    ? Number(priorDispatch.materializedUserTurnIndex)
    : Number.isInteger(receiptTurnIndex) && receiptTurnIndex >= 0
      ? receiptTurnIndex
      : null;

  const committedDispatch = {
    ...priorDispatch,
    status: result?.acknowledged ? "ACKNOWLEDGED" : "EFFECT_POSSIBLE",
    effectPossible: true,
    acknowledged: result?.acknowledged === true,
    acknowledgementEvidence: result?.acknowledgementEvidence || "",
    method: result?.method || "",
    materializedUserTurnId,
    materializedUserTurnIndex,
    completedAt: nowIso()
  };

  const fenced = {
    ...refreshed,
    sessionHealth: markSessionHealthPromptPosted(refreshed.sessionHealth, {
      sessionSeq: refreshed.sessionSeq,
      turn: refreshed.turn,
      promptHash: pending.hash,
      promptChars: String(pending.text || "").length,
      postedAtMs
    }),
    pendingPrompt: {
      ...refreshed.pendingPrompt,
      dispatch: committedDispatch
    },
    updatedAt: nowIso()
  };
  await saveProcess(fenced);
  await audit(fenced, "PROMPT_DISPATCH_FENCE_COMMITTED", "prompt", {
    promptHash: pending.hash,
    dispatch: committedDispatch,
    exactOnce: true,
    automaticResend: false
  }, operationId);
  scheduleFast(fenced.processId, 50);
  return fenced;
}

async function tickWaiting(process) {
  let page;
  try {
    page = await tabState(process, "waiting");
  } catch (error) {
    return handleDetached(process, error);
  }

  if (!process.lastPrompt?.modelProof && !process.safety?.turnProof) {
    process.safety = {...process.safety,qualityIncident:{code:"IN_FLIGHT_MODEL_UNVERIFIED",atMs:Date.now(),turn:process.turn}};
  }
  if (process.safety?.qualityIncident) return holdForSafety(process,{code:process.safety.qualityIncident.code});
  if (!process.safety?.proof?.allowed) return holdForSafety(process,process.safety?.proof || {code:"MODEL_EVIDENCE_MISSING"});

  const baselineHash = process.lastPrompt?.baselineAssistantHash || "";
  const lastResponseHash = process.lastResponse?.hash || "";

  const responseActivityObserved = Boolean(
    page.generating === true ||
    (page.assistantHash && page.assistantHash !== baselineHash && page.assistantHash !== lastResponseHash)
  );
  if (responseActivityObserved && process.sessionHealth?.activeTurn?.firstResponseObservedAtMs == null) {
    const observedAtMs = Date.now();
    const nextSessionHealth = markSessionHealthFirstResponse(process.sessionHealth, {
      promptHash: process.lastPrompt?.hash || "",
      observedAtMs
    });
    if (nextSessionHealth.activeTurn?.firstResponseObservedAtMs != null) {
      process = await saveObserved(process, {
        sessionHealth: nextSessionHealth
      }, "SESSION_HEALTH_FIRST_RESPONSE_OBSERVED", {
        promptHash: process.lastPrompt?.hash || "",
        observedAtMs,
        source: page.generating === true ? "GENERATION_OBSERVED" : "ASSISTANT_HASH_CHANGED"
      });
    }
  }

  if (process.lastPrompt && process.lastPrompt.acknowledged !== true) {
    let evidence = "";
    if (page.generating === true) evidence = "GENERATION_OBSERVED";
    else if (page.assistantHash && baselineHash && page.assistantHash !== baselineHash) evidence = "ASSISTANT_HASH_CHANGED";
    else if (Number(page.userCount || 0) > Number(process.lastPrompt?.dispatchedUserTurnIndex ?? -1)) evidence = "USER_TURN_PRESENT";

    if (evidence) {
      process = await saveObserved(process, {
        lastPrompt: {
          ...process.lastPrompt,
          acknowledged: true,
          acknowledgementEvidence: evidence
        }
      }, "PROMPT_ACKNOWLEDGEMENT_OBSERVED", {
        promptHash: process.lastPrompt.hash,
        evidence
      });
    }
  }

  // v1.1.11 stale-session accounting is independent of protocol semantics and
  // autonomous causal admission. Any completed assistant response proves the
  // ChatGPT renderer/model path is alive and restarts the 30-minute stale clock.
  // This does not admit that response as the autonomous response candidate.
  process = await maybeResetStaleSessionCounter(process, page);

  // Two-ended causal turn binding. The autonomous response is never "whatever
  // assistant message is latest"; it is the assistant turn paired with the
  // exact user turn materialized by this process dispatch.
  if (!process.lastPrompt?.dispatchedUserTurnId &&
      page.autonomousTurn?.resolvedUserTurnId) {
    process = await saveObserved(process, {
      lastPrompt: {
        ...process.lastPrompt,
        dispatchedUserTurnId: String(page.autonomousTurn.resolvedUserTurnId),
        dispatchedUserTurnIndex: page.autonomousTurn.expectedUserIndex != null &&
            Number.isInteger(Number(page.autonomousTurn.expectedUserIndex))
          ? Number(page.autonomousTurn.expectedUserIndex)
          : process.lastPrompt?.dispatchedUserTurnIndex ?? null
      }
    }, "AUTONOMOUS_USER_TURN_ID_RECONCILED", {
      dispatchedUserTurnId: String(page.autonomousTurn.resolvedUserTurnId),
      resolvedBy: page.autonomousTurn.resolvedBy || "NONE",
      expectedUserIndex: page.autonomousTurn.expectedUserIndex ?? null
    });
  }

  let causal = autonomousResponseObservation(process, page);

  const interleaveProbeObservation = causal.observation || {
    expectedUserTurnId: causal.expected?.id || "",
    pairedUserTurnId: causal.auto?.resolvedUserTurnId || "",
    lastAssistantId: causal.auto?.assistantId || "",
    assistantHash: causal.auto?.assistantHash || ""
  };
  const externalInterleave = externalAssistantInterleaveEvidence(page, interleaveProbeObservation);
  if (externalInterleave.observed) {
    const priorInterleave = process.responseInterleave || null;
    const sameExternalPair = Boolean(
      priorInterleave?.latestUserTurnId === externalInterleave.latestUserTurnId &&
      priorInterleave?.latestAssistantTurnId === externalInterleave.latestAssistantTurnId &&
      priorInterleave?.autonomousUserTurnId === externalInterleave.autonomousUserTurnId &&
      priorInterleave?.autonomousAssistantTurnId === externalInterleave.autonomousAssistantTurnId
    );
    if (!sameExternalPair) {
      process = await saveObserved(process, {
        responseInterleave: {
          ...externalInterleave,
          observedAt: nowIso()
        }
      }, "EXTERNAL_TURN_INTERLEAVED", {
        ...externalInterleave,
        expectedUserTurnId: causal.expected?.id || "",
        pairedUserTurnId: causal.auto?.resolvedUserTurnId || "",
        persistedForResponseEvidence: true
      });
    }
  }

  if (!causal.ready &&
      causal.reason === "AUTONOMOUS_RESPONSE_PRODUCER_LOST" &&
      process.lastPrompt?.acknowledged === true &&
      page.generating !== true) {
    const nextTurn = Number(process.turn || 0) + 1;
    const seq = Number(process.interruptedContinuationSeq || 0) + 1;
    const nextObjectiveId = randomId("objective");
    const recoveryObjective = [
      `[EIC interrupted-turn recovery ${seq}]`,
      "The previous autonomous response slot was closed by a later user turn before a causally paired assistant response existed.",
      "Do not assume the lost response succeeded or failed and do not blindly replay any prior effect.",
      "Reconcile the latest verified owner state first, then choose exactly one bounded next step that advances the same mission.",
      "Preserve verified completed work, avoid repeating the prior objective, and report a concrete real blocker only if owner evidence actually prevents continuation."
    ].join(" ");
    const pendingPrompt = await buildPendingA2A(process, {
      objective: recoveryObjective,
      objectiveId: nextObjectiveId,
      messageType: "CONTINUATION",
      previousResponseHash: process.lastResponse?.hash || "",
      previousDisposition: process.lastDecision?.disposition || "CONTINUE",
      analysisEvidence: {
        responseHash: process.lastResponse?.hash || "",
        targetDisposition: "UNKNOWN",
        responseObservation: {
          documentId: page.documentId || "",
          messageId: "",
          ownerKind: "NONE",
          ownerTrusted: false,
          expectedUserTurnId: causal.expected?.id || "",
          pairedUserTurnId: causal.auto?.resolvedUserTurnId || "",
          causalMatch: false,
          visibilityState: page.signals?.visibilityState || "unknown",
          textLength: 0,
          assistantCount: Number(page.assistantCount || 0),
          parseMode: "NONE",
          externalInterleave: {
            ...externalInterleave,
            observedAt: nowIso()
          }
        },
        protocol: {
          found: false,
          fullSchemaValid: false,
          controlValid: false,
          disposition: "UNKNOWN",
          parseMode: "NONE",
          errors: ["AUTONOMOUS_RESPONSE_PRODUCER_LOST"]
        },
        nanoTask: null,
        nano: null,
        hjalmar: null
      },
      baselineAssistantHash: page.assistantHash || baselineHash,
      turn: nextTurn
    });

    await audit(process, "AUTONOMOUS_RESPONSE_PRODUCER_LOST", "continuity", {
      expectedUserTurnId: causal.expected?.id || "",
      resolvedUserTurnId: causal.auto?.resolvedUserTurnId || "",
      nextUserTurnId: causal.auto?.nextUserTurnId || "",
      latestUserTurnId: page.lastUserId || "",
      latestAssistantTurnId: page.lastAssistantId || "",
      responseSlotClosed: causal.auto?.responseSlotClosed === true,
      targetGenerating: page.generating === true,
      blindRetryForbidden: true,
      recoveryMode: "OWNER_RECONCILE_THEN_ALTERNATIVE_CONTINUATION"
    });

    await cancelSchedulerProcess(
      process,
      "AUTONOMOUS_RESPONSE_PRODUCER_LOST_REARM"
    );

    const next = await commitTransition(process, PHASES.SENDING, {
      turn: nextTurn,
      interruptedContinuationSeq: seq,
      objectiveState: {
        objectiveId: nextObjectiveId,
        objective: recoveryObjective,
        status: "PENDING",
        previousObjectiveId: process.objectiveState?.objectiveId || "",
        previousObjectiveStatus: process.objectiveState?.status || "PENDING",
        updatedAt: nowIso()
      },
      pendingPrompt,
      responseCandidate: null,
      responseInterleave: null,
      lastMaterialAt: nowIso(),
      lastError: null
    }, {
      kind: "INTERRUPTED_CONTINUATION_REARMED",
      component: "continuity",
      detail: {
        reason: causal.reason,
        interruptedContinuationSeq: seq,
        expectedUserTurnId: causal.expected?.id || "",
        nextUserTurnId: causal.auto?.nextUserTurnId || "",
        nextObjectiveId,
        promptHash: pendingPrompt.hash,
        a2aMessageId: pendingPrompt.a2a?.messageId || "",
        exactOncePolicy: "OWNER_RECONCILE_BEFORE_EFFECT_RETRY"
      }
    });
    scheduleFast(next.processId, 100);
    return next;
  }

  if (!causal.ready) {
    if (process.responseCandidate) {
      process = await saveObserved(process, { responseCandidate: null },
        "RESPONSE_CANDIDATE_RESET", {
          reason: causal.reason,
          expectedUserTurnId: causal.expected.id,
          expectedUserTurnIndex: causal.expected.index,
          resolvedUserTurnId: causal.auto?.resolvedUserTurnId || ""
        });
    }

    await audit(process, "RESPONSE_OBSERVATION_HELD", "response-observation", {
      reason: causal.reason,
      documentId: page.documentId || "",
      expectedUserTurnId: causal.expected.id,
      expectedUserTurnIndex: causal.expected.index,
      resolvedUserTurnId: causal.auto?.resolvedUserTurnId || "",
      latestUserTurnId: page.lastUserId || "",
      latestAssistantTurnId: page.lastAssistantId || "",
      terminalized: false
    });

    const refreshEscalation = await maybeEscalateWaitingRefresh(process, page, {
      reason: causal.reason
    });
    if (refreshEscalation.handled) return refreshEscalation.process;

    const lastMaterialMs = Date.parse(process.lastMaterialAt || process.updatedAt || process.startedAt || "");
    const idleMs = Number.isFinite(lastMaterialMs) ? Date.now() - lastMaterialMs : 0;
    const keepaliveDue = idleMs >= Math.max(IDLE_KEEPALIVE_MIN_MS, IDLE_KEEPALIVE_MS);
    if (keepaliveDue &&
        process.lastPrompt?.acknowledged === true &&
        page.generating !== true &&
        !process.responseCandidate) {
      const nextTurn = Number(process.turn || 0) + 1;
      const seq = Number(process.idleKeepaliveSeq || 0) + 1;
      const nextObjectiveId = randomId("objective");
      const idleObjective = "Continue the current mission from the latest verified state. Do not repeat completed work. Report any real blocker truthfully.";
      const pendingPrompt = await buildPendingA2A(process, {
        objective: idleObjective,
        objectiveId: nextObjectiveId,
        messageType: "IDLE_KEEPALIVE",
        previousResponseHash: process.lastResponse?.hash || "",
        previousDisposition: process.lastDecision?.disposition || "CONTINUE",
        baselineAssistantHash: page.assistantHash || baselineHash,
        turn: nextTurn
      });
      await cancelSchedulerProcess(
        process,
        "IDLE_KEEPALIVE_REARM"
      );

      const next = await commitTransition(process, PHASES.SENDING, {
        turn: nextTurn,
        idleKeepaliveSeq: seq,
        objectiveState: {
          objectiveId: nextObjectiveId,
          objective: idleObjective,
          status: "PENDING",
          updatedAt: nowIso()
        },
        pendingPrompt,
        responseCandidate: null,
        responseInterleave: null,
        lastMaterialAt: nowIso(),
        lastError: null
      }, {
        kind: "IDLE_KEEPALIVE_PREPARED",
        component: "continuity",
        detail: {
          idleMs,
          keepaliveSeq: seq,
          promptHash: pendingPrompt.hash,
          a2aMessageId: pendingPrompt.a2a?.messageId || ""
        }
      });
      scheduleFast(next.processId, 100);
      return next;
    }

    scheduleFast(process.processId, FAST_RECHECK_MS);
    return process;
  }

  const responsePage = causal.observation;
  const noNewAssistant = !responsePage.assistantHash ||
    responsePage.assistantHash === baselineHash ||
    responsePage.assistantHash === lastResponseHash ||
    responsePage.generating === true;

  if (noNewAssistant) {
    if (process.responseCandidate) {
      process = await saveObserved(process, { responseCandidate: null },
        "RESPONSE_CANDIDATE_RESET", {
          assistantHash: responsePage.assistantHash || "",
          generating: responsePage.generating === true,
          expectedUserTurnId: responsePage.expectedUserTurnId || "",
          pairedUserTurnId: responsePage.pairedUserTurnId || ""
        });
    }
    const refreshEscalation = await maybeEscalateWaitingRefresh(process, page, {
      reason: responsePage.generating === true
        ? "AUTONOMOUS_RESPONSE_STILL_GENERATING"
        : "AUTONOMOUS_RESPONSE_NOT_NEW"
    });
    if (refreshEscalation.handled) return refreshEscalation.process;
    scheduleFast(process.processId, FAST_RECHECK_MS);
    return process;
  }

  const advanced = advanceResponseCandidate(process.responseCandidate, responsePage);
  process = await saveObserved(process, { responseCandidate: advanced.candidate },
    "RESPONSE_STABILITY_SAMPLE", {
      documentId: responsePage.documentId || "",
      messageId: responsePage.lastAssistantId || "",
      ownerKind: responsePage.lastAssistantOwnerKind || "NONE",
      ownerTrusted: responsePage.lastAssistantOwnerTrusted === true,
      ownerAdmissionMode: advanced.observationQuality?.ownerAdmissionMode || "",
      assistantReplicaCount: Number(responsePage.lastAssistantReplicaCount || 0),
      expectedUserTurnId: responsePage.expectedUserTurnId || "",
      pairedUserTurnId: responsePage.pairedUserTurnId || "",
      pairedUserResolvedBy: responsePage.pairedUserResolvedBy || "NONE",
      assistantCount: responsePage.assistantCount ?? null,
      assistantHash: responsePage.assistantHash,
      assistantText: text(responsePage.assistantText || "", 12000),
      assistantTextLength: Number(responsePage.assistantTextLength ?? String(responsePage.assistantText || "").length),
      generating: responsePage.generating,
      complete: advanced.complete,
      reason: advanced.reason,
      reads: advanced.reads || 0,
      ageMs: advanced.ageMs || 0,
      requiredStableMs: advanced.requiredStableMs || 0,
      requiredStableReads: advanced.requiredStableReads || 0,
      identityKey: advanced.candidate?.identityKey || "",
      observationQuality: advanced.observationQuality || null,
      signals: responsePage.signals || {}
    });

  if (!advanced.complete) {
    if (String(advanced.reason || "").startsWith("OBSERVATION_")) {
      await audit(process, "RESPONSE_OBSERVATION_HELD", "response-observation", {
        reason: advanced.reason,
        documentId: responsePage.documentId || "",
        messageId: responsePage.lastAssistantId || "",
        ownerKind: responsePage.lastAssistantOwnerKind || "NONE",
        ownerTrusted: responsePage.lastAssistantOwnerTrusted === true,
        ownerAdmissionMode: advanced.observationQuality?.ownerAdmissionMode || "",
        assistantReplicaCount: Number(responsePage.lastAssistantReplicaCount || 0),
        expectedUserTurnId: responsePage.expectedUserTurnId || "",
        pairedUserTurnId: responsePage.pairedUserTurnId || "",
        assistantCount: responsePage.assistantCount ?? null,
        assistantTextLength: Number(responsePage.assistantTextLength ?? String(responsePage.assistantText || "").length),
        visibilityState: responsePage.signals?.visibilityState || "unknown",
        terminalized: false
      });
    }
    const refreshEscalation = await maybeEscalateWaitingRefresh(process, page, {
      reason: `RESPONSE_STABILITY_${String(advanced.reason || "INCOMPLETE")}`
    });
    if (refreshEscalation.handled) return refreshEscalation.process;
    scheduleFast(process.processId, FAST_RECHECK_MS);
    return process;
  }

  if (advanced.observationQuality?.ownerAdmissionMode === "CAUSAL_VISIBLE_FALLBACK") {
    await audit(process, "RESPONSE_CAUSAL_FALLBACK_ADMITTED", "response-observation", {
      documentId: responsePage.documentId || "",
      messageId: responsePage.lastAssistantId || "",
      ownerKind: responsePage.lastAssistantOwnerKind || "NONE",
      ownerTrusted: responsePage.lastAssistantOwnerTrusted === true,
      ownerAdmissionMode: advanced.observationQuality.ownerAdmissionMode,
      expectedUserTurnId: responsePage.expectedUserTurnId || "",
      pairedUserTurnId: responsePage.pairedUserTurnId || "",
      pairedUserResolvedBy: responsePage.pairedUserResolvedBy || "NONE",
      assistantReplicaCount: Number(responsePage.lastAssistantReplicaCount || 0),
      assistantCount: responsePage.assistantCount ?? null,
      assistantHash: responsePage.assistantHash || "",
      assistantTextLength: Number(responsePage.assistantTextLength ?? String(responsePage.assistantText || "").length),
      visibilityState: responsePage.signals?.visibilityState || "unknown",
      reads: advanced.reads || 0,
      ageMs: advanced.ageMs || 0,
      requiredStableMs: advanced.requiredStableMs || 0,
      requiredStableReads: advanced.requiredStableReads || 0,
      protocolIndependent: true
    });
  }

  const parsedTarget = parseTargetResponse(responsePage.assistantText || "");
  const response = {
    text: text(responsePage.assistantText),
    hash: responsePage.assistantHash,
    messageId: responsePage.lastAssistantId || "",
    capturedAt: nowIso(),
    signals: responsePage.signals || {},
    observation: {
      documentId: responsePage.documentId || "",
      // v1.7.8: conversation of the causally paired response; COMPACT prompt
      // continuity is anchored on it (see lib/prompt-profile.mjs).
      conversationKey: conversationKey(page.url || ""),
      messageId: responsePage.lastAssistantId || "",
      ownerKind: responsePage.lastAssistantOwnerKind || "NONE",
      ownerTrusted: responsePage.lastAssistantOwnerTrusted === true,
      ownerAdmissionMode: advanced.observationQuality?.ownerAdmissionMode || "",
      assistantReplicaCount: Number(responsePage.lastAssistantReplicaCount || 0),
      expectedUserTurnId: responsePage.expectedUserTurnId || "",
      pairedUserTurnId: responsePage.pairedUserTurnId || "",
      pairedUserResolvedBy: responsePage.pairedUserResolvedBy || "NONE",
      causalMatch: Boolean(
        responsePage.expectedUserTurnId &&
        responsePage.pairedUserTurnId === responsePage.expectedUserTurnId
      ),
      assistantCount: responsePage.assistantCount ?? null,
      textLength: Number(responsePage.assistantTextLength ?? String(responsePage.assistantText || "").length),
      visibilityState: responsePage.signals?.visibilityState || "unknown",
      identityKey: advanced.candidate?.identityKey || "",
      externalInterleave: process.responseInterleave?.observed === true
        ? {
            observed: true,
            latestUserTurnId: process.responseInterleave.latestUserTurnId || "",
            latestAssistantTurnId: process.responseInterleave.latestAssistantTurnId || "",
            autonomousUserTurnId: process.responseInterleave.autonomousUserTurnId || "",
            autonomousAssistantTurnId: process.responseInterleave.autonomousAssistantTurnId || "",
            admissibleAsAutonomousResponse: false,
            observedAt: process.responseInterleave.observedAt || ""
          }
        : {
            observed: false,
            latestUserTurnId: "",
            latestAssistantTurnId: "",
            autonomousUserTurnId: responsePage.pairedUserTurnId || "",
            autonomousAssistantTurnId: responsePage.lastAssistantId || "",
            admissibleAsAutonomousResponse: false,
            observedAt: ""
          }
    },
    contract: {
      found: parsedTarget.found === true,
      ok: parsedTarget.ok === true,
      controlOk: parsedTarget.controlOk === true,
      status: parsedTarget.status || "UNKNOWN",
      value: parsedTarget.value || null,
      control: parsedTarget.control || null,
      errors: Array.isArray(parsedTarget.errors) ? parsedTarget.errors.slice(0, 20) : [],
      parseMode: parsedTarget.parseMode || "NONE",
      repairApplied: parsedTarget.repairApplied === true,
      repairCount: Number(parsedTarget.repairCount || 0),
      requiredForContinuation: false
    }
  };

  await audit(process, "RESPONSE_STATUS_PARSED", "response-contract", {
    responseHash: response.hash,
    contract: targetResponseEvidence(parsedTarget, response.hash),
    errors: response.contract.errors,
    protocolRequiredForContinuation: false,
    protocolDisposition: protocolDisposition(response.contract)
  });

  if (!hasCanonicalResponseControl(response.contract)) {
    await audit(process, "RESPONSE_PROTOCOL_OPTIONAL_ABSENT_OR_INVALID", "response-contract", {
      responseHash: response.hash,
      parseMode: response.contract.parseMode,
      errors: response.contract.errors || [],
      continuationAllowed: true
    });
  } else if (response.contract.ok !== true && response.contract.controlOk === true) {
    await audit(process, "RESPONSE_SCHEMA_DEGRADED_CONTROL_ACCEPTED", "response-contract", {
      responseHash: response.hash,
      status: response.contract.status,
      parseMode: response.contract.parseMode,
      nextSuggestedAction: response.contract.control?.nextSuggestedAction || "",
      errors: response.contract.errors || [],
      fullSchemaValid: false,
      controlValid: true,
      continuationAllowed: true
    });
  }

  // Response completion is protocol-independent. A2A parsing is enrichment only;
  // every causally paired terminal assistant response proceeds to analysis.
  const completedAtMs = Date.now();
  const completedSessionHealth = completeSessionHealthTurn(process.sessionHealth, {
    promptHash: process.lastPrompt?.hash || "",
    completedAtMs,
    responseChars: Number(responsePage.assistantTextLength ?? String(responsePage.assistantText || "").length)
  });
  const next = await commitTransition(process, PHASES.ANALYZING, {
    lastResponse: response,
    sessionHealth: completedSessionHealth,
    responseCandidate: null,
    waitingRefresh: null,
    recovery: resetRecovery(process).recovery,
    lastError: null,
    lastMaterialAt: nowIso()
  }, {
    kind: "RESPONSE_CAPTURED",
    component: "response",
    detail: {
      responseHash: response.hash,
      responseText: response.text,
      messageId: response.messageId,
      signals: response.signals,
      observation: response.observation,
      protocolDisposition: protocolDisposition(response.contract),
      protocolFound: response.contract.found === true,
      protocolValid: response.contract.ok === true,
      protocolControlValid: response.contract.controlOk === true,
      protocolRequiredForContinuation: false,
      sessionHealthSample: completedSessionHealth.samples?.at?.(-1) || null
    }
  });
  await releaseSchedulerTurn(next, {
    promptHash: next.lastPrompt?.hash || "",
    reason: "RESPONSE_CAPTURED"
  }).catch(() => undefined);
  scheduleFast(next.processId, 100);
  return next;
}

async function ensureOffscreenAnalyzer() {
  if (!chrome.offscreen) {
    throw Object.assign(new Error("OFFSCREEN_API_UNAVAILABLE"), { code: "OFFSCREEN_API_UNAVAILABLE" });
  }

  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  if (typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    if (contexts.length > 0) return;
  } else if (typeof chrome.offscreen.hasDocument === "function" && await chrome.offscreen.hasDocument()) {
    return;
  }

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "Host the local Nano + Hjalmar D2 LanguageModel analysis pipeline independently of the side panel."
  });
  try {
    await offscreenCreating;
  } catch (error) {
    // A second service-worker event may race the first create. Re-read the
    // owner-visible context before deciding the create actually failed.
    if (typeof chrome.runtime.getContexts === "function") {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [offscreenUrl]
      });
      if (contexts.length > 0) return;
    }
    throw error;
  } finally {
    offscreenCreating = null;
  }
}


async function persistNanoTaskCheckpoint(process, token, nanoTask, kind = "NANO_TASK_DURABLE_COMMIT") {
  const current = await findProcessById(process.processId);
  if (!current ||
      current.generation !== process.generation ||
      current.phase !== PHASES.ANALYZING) {
    return current;
  }
  const committed = {
    ...current,
    lastNanoTask: nanoTask,
    updatedAt: nowIso()
  };
  await saveProcess(committed);
  const readback = await findProcessById(committed.processId);
  const matches = Boolean(
    readback &&
    readback.generation === committed.generation &&
    readback.phase === PHASES.ANALYZING &&
    readback.lastNanoTask?.requestId === nanoTask?.requestId &&
    readback.lastNanoTask?.status === nanoTask?.status &&
    String(readback.lastNanoTask?.result || "") === String(nanoTask?.result || "")
  );
  await audit(committed, kind, "nano-task", {
    requestId: nanoTask?.requestId || "",
    status: nanoTask?.status || "",
    semanticStatus: nanoTask?.semanticStatus || "UNVERIFIED",
    result: text(nanoTask?.result || "", 12000),
    error: text(nanoTask?.error || "", 4000),
    promptCalls: nanoTask?.promptCalls ?? null,
    sourceResponseHash: nanoTask?.sourceResponseHash || "",
    promptLanguage: nanoTask?.promptLanguage || "en",
    promptPolicy: nanoTask?.promptPolicy || "PROMPT_CLOSED_EXECUTION_V2",
    knowledgeBoundary: nanoTask?.knowledgeBoundary || "PROMPT_ONLY",
    promptClosure: nanoTask?.promptClosure || null,
    readbackMatches: matches
  }, token.operationId);
  if (!matches) {
    const error = new Error("NANO_TASK_DURABLE_READBACK_MISMATCH");
    error.code = "NANO_TASK_DURABLE_READBACK_MISMATCH";
    throw error;
  }
  return committed;
}

async function runAnalysis(process) {
  await ensureOffscreenAnalyzer();
  const instructionSnapshot = await instructionQueues.enqueue(
    process.processId,
    () => readNextInstruction(process.processId)
  );
  const token = ownerToken(process, randomId("analysis"));

  const parsedTarget = hasCanonicalResponseControl(process.lastResponse?.contract)
    ? process.lastResponse.contract
    : (() => {
        const parsed = parseTargetResponse(process.lastResponse?.text || "");
        return {
          found: parsed.found === true,
          ok: parsed.ok === true,
          controlOk: parsed.controlOk === true,
          status: parsed.status || "UNKNOWN",
          value: parsed.value || null,
          control: parsed.control || null,
          errors: parsed.errors || [],
          parseMode: parsed.parseMode || "NONE"
        };
      })();

  const targetDisposition = hasCanonicalResponseControl(parsedTarget)
    ? parsedTarget.status
    : "UNKNOWN";
  const targetResponse = parsedTarget.ok
    ? parsedTarget.value
    : parsedTarget.controlOk
      ? {
          status: parsedTarget.status,
          sessionAction: parsedTarget.control?.sessionAction || "KEEP",
          sessionReason: "",
          pauseSeconds: parsedTarget.control?.pauseSeconds ?? null,
          nextSuggestedAction: parsedTarget.control?.nextSuggestedAction || "",
          schemaDegraded: true
        }
      : null;
  const currentObjective = process.lastPrompt?.a2a?.objective || process.objectiveState?.objective || "";
  const currentObjectiveId = process.lastPrompt?.a2a?.objectiveId || process.objectiveState?.objectiveId || "";
  const responseExcerpt = compactResponseExcerpt(process.lastResponse?.text || "", 650);

  const nanoDirective = splitNanoTaskDirective(targetResponse?.nextSuggestedAction || "");
  const targetContinuationInstruction = nanoDirective.found
    ? String(nanoDirective.remainder || "").trim()
    : String(targetResponse?.nextSuggestedAction || "").trim();
  const modelTargetResponse = targetResponse
    ? {
        ...targetResponse,
        nextSuggestedAction: targetContinuationInstruction
      }
    : null;
  let nanoTask = null;
  let executeNanoTask = false;
  if (nanoDirective.found) {
    const existing = process.lastNanoTask;
    if (existing?.requested === true &&
        existing.sourceResponseHash === process.lastResponse?.hash &&
        String(existing.task || "") === nanoDirective.task) {
      nanoTask = existing;
      executeNanoTask = false;
    } else {
      const prepared = createNanoTask({
        task: nanoDirective.task,
        sourceResponseHash: process.lastResponse?.hash || ""
      });

      // v1.3.0 prompt-closure gate: a Nano task may be arbitrarily complex,
      // but it may not depend on EIC/project/files/tools/web/history that are
      // absent from its one prompt. Obvious external dependencies are rejected
      // before any LanguageModel session/prompt call.
      if (prepared?.status === NANO_TASK_STATUS.CONTEXT_REQUIRED) {
        nanoTask = prepared;
        const taskCheckpoint = await persistNanoTaskCheckpoint(
          process,
          token,
          nanoTask,
          "NANO_TASK_PROMPT_CLOSURE_REJECTED"
        );
        if (!taskCheckpoint) {
          const error = new Error("STALE_NANO_TASK_CLOSURE_CALLBACK");
          error.code = "STALE_NANO_TASK_CLOSURE_CALLBACK";
          throw error;
        }
        process = taskCheckpoint;
        executeNanoTask = false;
      } else {
        nanoTask = {
          ...prepared,
          status: NANO_TASK_STATUS.RUNNING,
          startedAt: nowIso()
        };
        const taskProcess = {
          ...process,
          lastNanoTask: nanoTask,
          updatedAt: nowIso()
        };
        await saveProcess(taskProcess);
        const taskReadback = await loadProcessForWindow(taskProcess.windowId);
        const taskWriteAheadMatches = Boolean(
          taskReadback &&
          taskReadback.processId === taskProcess.processId &&
          taskReadback.generation === taskProcess.generation &&
          taskReadback.phase === PHASES.ANALYZING &&
          taskReadback.lastNanoTask?.requestId === nanoTask.requestId &&
          taskReadback.lastNanoTask?.status === NANO_TASK_STATUS.RUNNING
        );
        await audit(taskProcess, "NANO_TASK_WRITE_AHEAD", "nano-task", {
          requestId: nanoTask.requestId,
          sourceResponseHash: nanoTask.sourceResponseHash,
          sourceTask: nanoTask.sourceTask || nanoTask.task,
          executionPrompt: nanoTask.executionPrompt || nanoTask.task,
          promptLanguage: nanoTask.promptLanguage || "en",
          promptPolicy: nanoTask.promptPolicy || "PROMPT_CLOSED_EXECUTION_V2",
          knowledgeBoundary: nanoTask.knowledgeBoundary || "PROMPT_ONLY",
          promptClosure: nanoTask.promptClosure || null,
          status: nanoTask.status,
          exactOnce: true,
          replayOnUnknownForbidden: true,
          readbackMatches: taskWriteAheadMatches
        }, token.operationId);
        if (!taskWriteAheadMatches) {
          const error = new Error("NANO_TASK_WRITE_AHEAD_READBACK_MISMATCH");
          error.code = "NANO_TASK_WRITE_AHEAD_READBACK_MISMATCH";
          throw error;
        }
        process = taskProcess;
        executeNanoTask = true;
      }
    }
  }

  // Execute the isolated Nano side effect before advisory Nano/Hjalmar stages and
  // durably checkpoint the result immediately. A later model-format failure must
  // never erase a completed exact-once task.
  if (nanoTask?.requested === true &&
      (executeNanoTask === true || nanoTask.status === NANO_TASK_STATUS.RUNNING)) {
    const taskExecution = await chrome.runtime.sendMessage({
      type: "EIC_GF_RUN_NANO_TASK",
      token,
      input: {
        nanoTask,
        executeNanoTask
      }
    });
    if (!taskExecution?.ok || !taskExecution.nanoTask) {
      const error = new Error(taskExecution?.error || "NANO_TASK_EXECUTION_FAILED");
      error.code = taskExecution?.code || "NANO_TASK_EXECUTION_FAILED";
      error.detail = taskExecution?.detail || "";
      await audit(process, "NANO_TASK_EXECUTION_ERROR", "nano-task", {
        token,
        error: errorRecord(error),
        result: taskExecution || null
      }, token.operationId);
      throw error;
    }
    nanoTask = taskExecution.nanoTask;
    const taskCheckpoint = await persistNanoTaskCheckpoint(process, token, nanoTask);
    if (!taskCheckpoint) {
      const error = new Error("STALE_NANO_TASK_CALLBACK");
      error.code = "STALE_NANO_TASK_CALLBACK";
      throw error;
    }
    process = taskCheckpoint;
    executeNanoTask = false;
  }

  const input = {
    runtimeSafety: process.safety?.turnProof || null,
    goal: process.goal,
    turn: process.turn,
    currentObjective,
    responseHash: process.lastResponse?.hash || "",
    targetDisposition,
    targetResponse: modelTargetResponse,
    responseExcerpt,
    targetContinuationInstruction,
    previousDecision: process.lastDecision,
    operatorInstruction: instructionSnapshot?.text || "",
    nanoTask,
    // Side effect already checkpointed above. The advisory pipeline may only
    // reuse terminal Nano Task evidence.
    executeNanoTask: false
  };

  await audit(process, "ANALYSIS_PIPELINE_REQUEST", "analysis", {
    token,
    input,
    sourceResponseRef: {
      responseHash: process.lastResponse?.hash || "",
      responseMessageId: process.lastResponse?.messageId || "",
      objectiveId: currentObjectiveId
    },
    modelContextPolicy: "NANO_PROMPT_CLOSED_SMALL_CONTEXT_V2",
    operatorInstructionId: instructionSnapshot?.instructionId || null,
    stages: nanoTask ? ["NANO_TASK", "NANO_OBSERVER", "HJALMAR_D2"] : ["NANO_OBSERVER", "HJALMAR_D2"]
  }, token.operationId);

  const result = await chrome.runtime.sendMessage({
    type: "EIC_GF_ANALYZE_PIPELINE",
    token,
    input
  });

  if (!result?.ok) {
    const error = new Error(result?.error || "ANALYSIS_FAILED");
    error.code = result?.code || "ANALYSIS_FAILED";
    error.detail = result?.detail || "";
    await audit(process, "ANALYSIS_PIPELINE_ERROR", "analysis", {
      token,
      error: errorRecord(error),
      result
    }, token.operationId);
    throw error;
  }

  if (result.nanoTask) {
    const durable = await findProcessById(process.processId);
    const sameTask = Boolean(
      durable &&
      durable.lastNanoTask?.requestId === result.nanoTask.requestId &&
      durable.lastNanoTask?.status === result.nanoTask.status &&
      String(durable.lastNanoTask?.result || "") === String(result.nanoTask.result || "")
    );
    await audit(durable || process, "NANO_TASK_PIPELINE_READBACK", "nano-task", {
      requestId: result.nanoTask.requestId || "",
      status: result.nanoTask.status || "",
      semanticStatus: result.nanoTask.semanticStatus || "UNVERIFIED",
      readbackMatches: sameTask
    }, token.operationId);
    if (!sameTask) {
      const error = new Error("NANO_TASK_PIPELINE_READBACK_MISMATCH");
      error.code = "NANO_TASK_PIPELINE_READBACK_MISMATCH";
      throw error;
    }
    process = durable || process;
  }

  const nano = result.nano || null;
  await audit(process, "NANO_ANALYSIS_RESULT", "nano", {
    token,
    rawOutput: result.nanoRawOutput || "",
    nano,
    nanoTask: result.nanoTask || null,
    durationMs: result.nanoDurationMs ?? null,
    modelAvailability: result.modelAvailability || ""
  }, token.operationId);

  const modelDecision = normalizeHjalmarDecision(result.decision);
  const modelValidation = validateHjalmarDecision(modelDecision);
  const effectiveNanoTask = result.nanoTask || nanoTask;
  const modelEvidenceBinding = validateHjalmarEvidenceBinding(modelDecision, {
    targetDisposition,
    nanoTask: effectiveNanoTask,
    operatorInstructionPending: Boolean(instructionSnapshot)
  });
  const runtimeReconciliation = reconcileHjalmarRuntimeFacts(modelDecision, {
    targetDisposition,
    nanoTask: effectiveNanoTask,
    operatorInstructionPending: Boolean(instructionSnapshot)
  });
  const decision = runtimeReconciliation.decision;
  const validation = validateHjalmarDecision(decision);
  const evidenceBinding = validateHjalmarEvidenceBinding(decision, {
    targetDisposition,
    nanoTask: effectiveNanoTask,
    operatorInstructionPending: Boolean(instructionSnapshot)
  });

  if (runtimeReconciliation.corrections.length) {
    await audit(process, "HJALMAR_RUNTIME_FACTS_RECONCILED", "analysis", {
      token,
      modelDecision,
      decision,
      corrections: runtimeReconciliation.corrections,
      targetDisposition,
      nanoTask: effectiveNanoTask
    }, token.operationId);
  }

  await audit(process, "HJALMAR_D2_ANALYSIS_RESULT", "analysis", {
    token,
    rawOutput: result.rawOutput || "",
    modelDecision,
    modelValidation,
    modelEvidenceBinding,
    runtimeReconciliation,
    decision,
    validation,
    evidenceBinding,
    targetDisposition,
    targetResponse: targetResponseEvidence({
      ok: parsedTarget.ok,
      controlOk: parsedTarget.controlOk,
      status: targetDisposition,
      value: parsedTarget.ok ? targetResponse : null,
      control: parsedTarget.control || null,
      parseMode: parsedTarget.parseMode || process.lastResponse?.contract?.parseMode || "NONE"
    }, process.lastResponse?.hash || ""),
    durationMs: result.durationMs ?? null,
    modelAvailability: result.modelAvailability || "",
    nano,
    nanoTask: effectiveNanoTask,
    operatorInstructionId: instructionSnapshot?.instructionId || null
  }, token.operationId);

  if (!modelValidation.ok) {
    const error = new Error(`HJALMAR_D2_INVALID:${modelValidation.errors.join(",")}`);
    error.code = "HJALMAR_D2_INVALID";
    throw error;
  }
  if (!validation.ok || !evidenceBinding.ok) {
    const details = [...(validation.errors || []), ...(evidenceBinding.errors || [])];
    const error = new Error(`HJALMAR_RUNTIME_RECONCILIATION_FAILED:${details.join(",")}`);
    error.code = "HJALMAR_RUNTIME_RECONCILIATION_FAILED";
    throw error;
  }

  return {
    token,
    nano,
    nanoTask: effectiveNanoTask,
    decision,
    modelDecision,
    modelEvidenceBinding,
    runtimeReconciliation,
    evidenceBinding,
    targetDisposition,
    targetResponse,
    currentObjective,
    currentObjectiveId,
    instructionSnapshotId: instructionSnapshot?.instructionId || null
  };
}

async function refreshSchedulerPriority(process) {
  const context = await schedulerCapacityContext().catch(() => null);
  if (!context) return;
  const schedulerUpdate = await updateGlobalTurnPriority({
    processId: process.processId,
    priority: process.schedulerPriority,
    capacity: context.effectiveCapacity,
    configuredCapacity: context.configuredCapacity
  }).catch(() => null);
  wakeSchedulerProcesses(schedulerUpdate?.runnableProcessIds || []);
}

// v1.7.7 AI-requested runtime control. The EIC response only requests; this
// function evaluates the request against fresh queue owner state, writes only
// whitelisted slot fields of the exact target slot, and settles receipts
// against the actual write result. Terminal completion is returned as a
// verdict and executed by the existing DONE commit + logical-GFW retirement.
async function evaluateAndApplyRuntimeControl(current, result) {
  const ctx = current.queueContext?.itemId ? current.queueContext : null;
  const request = result.targetResponse?.runtimeControl || null;
  const status = String(result.targetDisposition || "UNKNOWN").toUpperCase();
  const sessionAction = String(result.targetResponse?.sessionAction || "KEEP").toUpperCase();
  const responseHash = current.lastResponse?.hash || "";
  if (!request && status !== "DONE" && sessionAction !== "STOP_PROCESS") {
    // No-control responses are a no-op for the control engine; only clear
    // receipts that described an earlier response.
    return {
      terminal: null,
      priorityChanged: false,
      processPatch: current.runtimeControl?.lastReceipts?.length
        ? { runtimeControl: nextRuntimeControlState(current.runtimeControl, [], { turn: current.turn, responseHash }) }
        : null
    };
  }

  const promptIssuedAtMs = Date.parse(current.lastPrompt?.a2a?.issuedAt || "") ||
    Number(current.lastPrompt?.postedAtMs || 0);
  let queueLoadErrorRecord = null;
  const evaluate = async () => {
    let queueState = null;
    queueLoadErrorRecord = null;
    if (ctx) {
      try {
        queueState = await missionQueueForWindow(current.windowId);
      } catch (error) {
        queueLoadErrorRecord = errorRecord(error);
      }
    }
    const sameQueue = Boolean(queueState && queueState.queue.queueId === ctx?.queueId);
    const evaluation = evaluateRuntimeControl({
      request,
      status,
      sessionAction,
      owner: {
        runId: current.runId,
        turn: current.turn,
        queueManaged: Boolean(ctx),
        queueId: ctx?.queueId || "",
        itemId: ctx?.itemId || "",
        savedMissionId: ctx?.savedMissionId || "",
        item: sameQueue ? queueState.queue.items.find((candidate) => candidate.itemId === ctx.itemId) || null : null,
        queueLoadError: Boolean(queueLoadErrorRecord),
        promptIssuedAtMs,
        responseHash,
        ledger: current.runtimeControl?.ledger || []
      }
    });
    return { evaluation, queueState: sameQueue ? queueState : null };
  };

  let { evaluation, queueState } = await evaluate();
  const pendingWrites = () => evaluation.effects.filter((effect) => effect.noop !== true);
  let committed = true;
  let errorCode = "";
  for (let attempt = 0; attempt < 2 && pendingWrites().length && queueState; attempt += 1) {
    const fresh = await findProcessById(current.processId);
    if (!fresh || fresh.generation !== current.generation || fresh.phase !== PHASES.ANALYZING) {
      committed = false;
      errorCode = "PROCESS_NO_LONGER_CURRENT";
      break;
    }
    try {
      queueState.queue.items = applyRuntimeControlEffects(queueState.queue.items, pendingWrites());
      await persistMissionQueue(queueState.queue, queueState.settings, current, "MISSION_QUEUE_RUNTIME_CONTROL_APPLIED", {
        itemId: ctx.itemId,
        effects: pendingWrites().map((effect) => ({ op: effect.op, field: effect.field, value: effect.value })),
        responseHash
      });
      committed = true;
      errorCode = "";
      break;
    } catch (error) {
      committed = false;
      errorCode = String(error?.code || error?.message || "QUEUE_WRITE_FAILED");
      if (attempt > 0 || error?.code !== "MISSION_WORK_QUEUE_STALE_WRITE") break;
      // A concurrent writer (normally an operator edit) won the revision race.
      // Re-validate once against fresh owner state; operator precedence applies.
      ({ evaluation, queueState } = await evaluate());
      committed = true;
      errorCode = "";
    }
  }

  const receipts = settleRuntimeControlReceipts(evaluation.receipts, { committed, errorCode });
  const processPatch = {
    runtimeControl: nextRuntimeControlState(current.runtimeControl, receipts, { turn: current.turn, responseHash })
  };
  let priorityChanged = false;
  if (committed && ctx) {
    let queueContext = ctx;
    let schedulerPriority = current.schedulerPriority;
    for (const effect of evaluation.effects) {
      if (effect.field === "priority") {
        priorityChanged = priorityChanged || effect.value !== schedulerPriority;
        queueContext = { ...queueContext, priority: effect.value };
        schedulerPriority = effect.value;
      } else if (effect.field === "maxInteractions") {
        // The active quantum is immutable until its boundary (v1.7.4 rule);
        // the new slot quantum applies from the next quantum/activation.
        queueContext = {
          ...queueContext,
          pendingMaxInteractions: effect.value === Number(ctx.maxInteractions) ? null : effect.value
        };
      } else if (effect.field === "schedule") {
        // v1.8.1: effective immediately; the post-response schedule gate below
        // parks the slot if the new schedule no longer allows running now.
        queueContext = { ...queueContext, schedule: effect.value ? deepClone(effect.value) : null };
      }
    }
    if (queueContext !== ctx) {
      processPatch.queueContext = queueContext;
      processPatch.schedulerPriority = schedulerPriority;
    }
  }

  await audit(current, "RUNTIME_CONTROL_EVALUATED", "runtime-control", {
    responseHash,
    status,
    sessionAction,
    requestPresent: Boolean(request),
    requestErrors: request?.errors || [],
    targetState: request?.targetState || "ABSENT",
    terminal: evaluation.terminal
      ? { requested: true, accepted: evaluation.terminal.accepted, source: evaluation.terminal.source }
      : null,
    effects: evaluation.effects.map((effect) => ({ op: effect.op, field: effect.field, value: effect.value, noop: effect.noop === true })),
    receipts,
    committed,
    errorCode,
    queueLoadError: queueLoadErrorRecord
  }).catch(() => undefined);

  return { terminal: evaluation.terminal, processPatch, priorityChanged };
}

async function tickAnalyzing(process) {
  const page = await tabState(process,"analysis-model-recheck");
  if (process.safety?.qualityIncident) return holdForSafety(process,{code:process.safety.qualityIncident.code});
  if (!process.safety?.proof?.allowed) return holdForSafety(process,process.safety?.proof || {code:"MODEL_EVIDENCE_MISSING"});
  if (!process.safety?.turnProof) return holdForSafety(process,{code:"IN_FLIGHT_MODEL_UNVERIFIED"});
  if (process.lastResponse?.text && process.lastPrompt?.usageId) await recordUsageOutput(process.lastPrompt.usageId,process.lastResponse.text);
  if (!process.lastResponse?.text || !process.lastResponse?.hash) {
    const error = Object.assign(new Error("ANALYSIS_RESPONSE_MISSING"), { code: "ANALYSIS_RESPONSE_MISSING" });
    return enterRecovery(process, error, PHASES.WAITING);
  }

  // Protocol parsing is enrichment only. A persisted ANALYZING state must
  // continue from the causally captured assistant response even when EIC-A2A
  // JSON is absent, malformed, or reports DONE/BLOCKED. Hjalmar/runtime evidence
  // owns the actual objective disposition.
  let result;
  try {
    result = await runAnalysis(process);
  } catch (error) {
    const current = await findProcessById(process.processId);
    if (!current || current.generation !== process.generation || current.phase !== PHASES.ANALYZING) return current;
    // Continuity-first: analyzer/host failures are technical, not owner boundaries.
    return enterRecovery(current, error, PHASES.ANALYZING);
  }

  const current = await findProcessById(process.processId);
  if (!isCurrentToken(current, result.token) || current.phase !== PHASES.ANALYZING) {
    if (current) {
      await audit(current, "STALE_CALLBACK_REJECTED", "runtime", {
        source: "ANALYSIS_RESULT",
        token: result.token,
        currentGeneration: current.generation,
        currentPhase: current.phase
      }, result.token.operationId).catch(() => undefined);
    }
    return current;
  }

  // Final decision and one-shot mailbox claim share the instruction queue.
  // Operator input either lands before this boundary (and invalidates/restarts
  // analysis) or after it (and therefore belongs to the following prompt).
  return instructionQueues.enqueue(current.processId, async () => {
    const latestInstruction = await readNextInstruction(current.processId);
    const latestInstructionId = latestInstruction?.instructionId || null;
    if (latestInstructionId !== (result.instructionSnapshotId || null)) {
      await audit(current, "ANALYSIS_INVALIDATED_BY_OPERATOR_INSTRUCTION", "analysis", {
        analyzedInstructionId: result.instructionSnapshotId || null,
        currentInstructionId: latestInstructionId
      }, result.token.operationId);
      scheduleFast(current.processId, 50);
      return current;
    }

    const runtimeControl = await evaluateAndApplyRuntimeControl(current, result);
    // Receipts and synced slot values belong to this analyzed turn and ride on
    // whichever transition commits next (DONE, BLOCKED, park or continuation).
    if (runtimeControl.processPatch) Object.assign(current, runtimeControl.processPatch);
    if (runtimeControl.priorityChanged) await refreshSchedulerPriority(current);

    const modelControllerDecision = result.decision;
    const greenfieldControl = resolveGreenfieldControl({
      targetDisposition: result.targetDisposition,
      targetNextSuggestedAction: result.targetResponse?.nextSuggestedAction || "",
      decision: modelControllerDecision,
      nanoTask: result.nanoTask,
      sessionAction: result.targetResponse?.sessionAction || "KEEP",
      terminalControl: runtimeControl.terminal
    });
    const d = applyGreenfieldControlToDecision(modelControllerDecision, greenfieldControl);
    const controllerValidation = validateHjalmarDecision(d);
    const queueContextAfterResponse = current.queueContext?.itemId ? {
      ...current.queueContext,
      interactionCount: Math.max(0, Number(current.queueContext.interactionCount || 0)) + 1,
      maxInteractions: normalizeMissionQuantumInteractions(current.queueContext.maxInteractions)
    } : null;
    const queueQuantumReached = Boolean(
      queueContextAfterResponse &&
      queueContextAfterResponse.interactionCount >= queueContextAfterResponse.maxInteractions
    );

    await audit(current, "GREENFIELD_CONTROL_RESOLVED", "continuation", {
      control: greenfieldControl,
      originalDecision: modelControllerDecision,
      effectiveDecision: d,
      targetDisposition: result.targetDisposition,
      sessionAction: result.targetResponse?.sessionAction || "KEEP",
      sessionReason: result.targetResponse?.sessionReason || "",
      targetNextSuggestedAction: result.targetResponse?.nextSuggestedAction || "",
      scopedBlockers: Array.isArray(result.targetResponse?.blockers)
        ? result.targetResponse.blockers.slice(0, 4)
        : []
    }, result.token.operationId);

    if (!controllerValidation.ok) {
      const error = Object.assign(
        new Error(`GREENFIELD_CONTROL_INVALID:${controllerValidation.errors.join(",")}`),
        { code: "GREENFIELD_CONTROL_INVALID" }
      );
      return enterRecovery(current, error, PHASES.ANALYZING);
    }

    if (!result.evidenceBinding?.ok) {
      await audit(current, "HJALMAR_EVIDENCE_BINDING_REJECTED", "decision", {
        decision: d,
        evidenceBinding: result.evidenceBinding,
        targetDisposition: result.targetDisposition,
        nanoTask: result.nanoTask || null
      }, result.token.operationId);
      const error = Object.assign(
        new Error(result.evidenceBinding.errors.join(",")),
        { code: "HJALMAR_EVIDENCE_BINDING_REJECTED" }
      );
      return enterRecovery(current, error, PHASES.ANALYZING);
    }

    // Durable mission spawning is delegation-only. The supervising queue never
    // mutates itself from an EIC response; it persists requests for another
    // already-running queue-managed worker to accept on that worker's own tick.
    await registerResponseMissionDelegations(current, result.targetResponse);

    if (d.disposition === DISPOSITIONS.DONE) {
      if (latestInstruction) {
        // Operator input outranks an AI terminal control; the terminal was not
        // committed, so its receipt must not claim APPLIED.
        current.runtimeControl = withTerminalReceiptsRejected(current.runtimeControl, "OPERATOR_INSTRUCTION_PENDING");
        const error = Object.assign(
          new Error("HJALMAR_D2_DONE_WITH_PENDING_OPERATOR_INSTRUCTION"),
          { code: "HJALMAR_D2_DONE_WITH_PENDING_OPERATOR_INSTRUCTION" }
        );
        return enterRecovery(current, error, PHASES.ANALYZING);
      }
      return commitTransition(current, PHASES.DONE, {
        lastNano: result.nano || null,
        lastNanoTask: result.nanoTask || current.lastNanoTask || null,
        lastDecision: d,
        greenfieldControl,
        queueContext: queueContextAfterResponse,
        objectiveState: {
          objectiveId: result.currentObjectiveId || current.objectiveState?.objectiveId || "",
          objective: result.currentObjective || current.objectiveState?.objective || "",
          status: d.objectiveStatus === "SATISFIED" ? "SATISFIED" : d.objectiveStatus,
          updatedAt: nowIso()
        },
        lastError: null,
        lastMaterialAt: nowIso()
      }, {
        kind: "HJALMAR_D2_DONE",
        component: "decision",
        detail: {
          decision: d,
          targetDisposition: result.targetDisposition,
          nanoTask: result.nanoTask || null
        }
      });
    }

    if (d.disposition === DISPOSITIONS.BLOCKED) {
      return commitTransition(current, PHASES.BLOCKED, {
        lastNano: result.nano || null,
        lastNanoTask: result.nanoTask || current.lastNanoTask || null,
        lastDecision: d,
        greenfieldControl,
        queueContext: queueContextAfterResponse,
        objectiveState: {
          objectiveId: result.currentObjectiveId || current.objectiveState?.objectiveId || "",
          objective: result.currentObjective || current.objectiveState?.objective || "",
          status: "BLOCKED",
          updatedAt: nowIso()
        },
        lastError: {
          code: greenfieldControl.errorCode || (greenfieldControl.action === "OPERATOR"
            ? "GREENFIELD_OPERATOR_REQUIRED"
            : "GREENFIELD_BLOCKED"),
          message: d.analysis
        }
      }, {
        kind: greenfieldControl.errorCode || (greenfieldControl.action === "OPERATOR"
          ? "GREENFIELD_OPERATOR_REQUIRED"
          : "GREENFIELD_BLOCKED"),
        component: "decision",
        detail: {
          decision: d,
          greenfieldControl,
          targetDisposition: result.targetDisposition,
          nanoTask: result.nanoTask || null,
          pendingOperatorInstructionId: latestInstructionId
        }
      });
    }

    let admission = evaluateContinuationAdmission({
      targetDisposition: result.targetDisposition,
      currentObjective: result.currentObjective,
      targetNextSuggestedAction: result.targetResponse?.nextSuggestedAction || "",
      previousDecision: current.lastDecision,
      decision: d,
      nanoTask: result.nanoTask,
      operatorInstructionPending: Boolean(latestInstruction)
    });
    if (isExplicitRotationAction(result.targetResponse?.sessionAction || "KEEP") && !admission.ok) {
      admission = {
        ok: true,
        code: "SESSION_ROTATION_OWNER_RESUME",
        detail: "Explicit EIC session rotation supplies a fresh owner-resume boundary instead of terminal continuation rejection.",
        replanned: true,
        recoveryKind: "SESSION_ROTATION",
        originalNextPrompt: d.nextPrompt || "",
        effectiveNextPrompt: sessionRotationObjective(
          result.targetResponse?.nextSuggestedAction ||
          d.nextPrompt ||
          current.objectiveState?.objective
        )
      };
    }
    await audit(current, "CONTINUATION_ADMISSION_EVALUATED", "continuation", {
      admission,
      currentObjectiveId: result.currentObjectiveId || "",
      currentObjective: result.currentObjective || "",
      targetDisposition: result.targetDisposition,
      targetNextSuggestedAction: result.targetResponse?.nextSuggestedAction || "",
      decision: d,
      greenfieldControl,
      nanoTask: result.nanoTask || null
    }, result.token.operationId);

    if (!admission.ok) {
      return commitTransition(current, PHASES.BLOCKED, {
        lastNano: result.nano || null,
        lastNanoTask: result.nanoTask || current.lastNanoTask || null,
        lastDecision: d,
        greenfieldControl,
        queueContext: queueContextAfterResponse,
        objectiveState: {
          objectiveId: result.currentObjectiveId || current.objectiveState?.objectiveId || "",
          objective: result.currentObjective || current.objectiveState?.objective || "",
          status: "BLOCKED",
          updatedAt: nowIso()
        },
        lastError: {
          code: admission.code,
          message: admission.detail || "Continuation admission rejected."
        }
      }, {
        kind: "CONTINUATION_ADMISSION_BLOCKED",
        component: "continuation",
        detail: {
          admission,
          decision: d,
          targetDisposition: result.targetDisposition,
          nanoTask: result.nanoTask || null
        }
      });
    }

    const effectiveNextPrompt = String(admission.effectiveNextPrompt || d.nextPrompt || "").trim();
    const effectiveDecision = effectiveNextPrompt === String(d.nextPrompt || "").trim()
      ? d
      : {
          ...d,
          nextPrompt: effectiveNextPrompt,
          controllerReplan: {
            code: admission.code,
            recoveryKind: admission.recoveryKind || "",
            originalNextPrompt: admission.originalNextPrompt || ""
          }
        };

    if (admission.replanned === true) {
      await audit(current, "CONTINUATION_REPLANNED", "continuation", {
        code: admission.code,
        recoveryKind: admission.recoveryKind || "",
        originalNextPrompt: admission.originalNextPrompt || d.nextPrompt || "",
        effectiveNextPrompt,
        currentObjective: result.currentObjective || "",
        targetNextSuggestedAction: result.targetResponse?.nextSuggestedAction || ""
      }, result.token.operationId);
    }

    const nextTurn = Number(current.turn || 0) + 1;
    const messageType = d.disposition === DISPOSITIONS.READ_REQUIRED
      ? "READ_REQUIRED"
      : "CONTINUATION";
    const nextObjectiveId = randomId("objective");
    const responseObservation = {
      documentId: current.lastResponse?.observation?.documentId || "",
      messageId: current.lastResponse?.observation?.messageId || current.lastResponse?.messageId || "",
      ownerKind: current.lastResponse?.observation?.ownerKind || "NONE",
      ownerTrusted: current.lastResponse?.observation?.ownerTrusted === true,
      expectedUserTurnId: current.lastResponse?.observation?.expectedUserTurnId || "",
      pairedUserTurnId: current.lastResponse?.observation?.pairedUserTurnId || "",
      causalMatch: current.lastResponse?.observation?.causalMatch === true,
      visibilityState: current.lastResponse?.observation?.visibilityState || "unknown",
      textLength: Number(current.lastResponse?.observation?.textLength || 0),
      assistantCount: Number(current.lastResponse?.observation?.assistantCount || 0),
      parseMode: current.lastResponse?.contract?.parseMode || "NONE",
      externalInterleave: current.lastResponse?.observation?.externalInterleave || {
        observed: false,
        latestUserTurnId: "",
        latestAssistantTurnId: "",
        autonomousUserTurnId: current.lastResponse?.observation?.pairedUserTurnId || "",
        autonomousAssistantTurnId: current.lastResponse?.observation?.messageId || "",
        admissibleAsAutonomousResponse: false,
        observedAt: ""
      }
    };
    const protocol = {
      found: current.lastResponse?.contract?.found === true,
      fullSchemaValid: current.lastResponse?.contract?.ok === true,
      controlValid: current.lastResponse?.contract?.ok === true ||
        current.lastResponse?.contract?.controlOk === true,
      disposition: result.targetDisposition || "UNKNOWN",
      sessionAction: result.targetResponse?.sessionAction || "KEEP",
      sessionReason: result.targetResponse?.sessionReason || "",
      pauseSeconds: result.targetResponse?.pauseSeconds ?? null,
      parseMode: current.lastResponse?.contract?.parseMode || "NONE",
      errors: Array.isArray(current.lastResponse?.contract?.errors)
        ? current.lastResponse.contract.errors.slice(0, 12)
        : []
    };
    const analysisEvidence = {
      responseHash: current.lastResponse.hash,
      targetDisposition: result.targetDisposition,
      responseObservation,
      protocol,
      nanoTask: result.nanoTask ? {
        requestId: result.nanoTask.requestId || "",
        status: result.nanoTask.status || "",
        semanticStatus: result.runtimeReconciliation?.runtimeNanoTaskAssessment || "UNVERIFIED",
        result: result.nanoTask.result || "",
        error: result.nanoTask.error || "",
        promptLanguage: result.nanoTask.promptLanguage || "en",
        promptPolicy: result.nanoTask.promptPolicy || "PROMPT_CLOSED_EXECUTION_V2",
        knowledgeBoundary: result.nanoTask.knowledgeBoundary || "PROMPT_ONLY",
        promptClosure: result.nanoTask.promptClosure || null
      } : null,
      nano: result.nano ? {
        summary: result.nano.summary || "",
        confidence: result.nano.confidence || "",
        continuityRisk: result.nano.continuityRisk || "",
        knowledgeBoundary: result.nano.knowledgeBoundary || "PROMPT_ONLY",
        inputScope: result.nano.inputScope || "BOUNDED_PROMPT_FIELDS_ONLY"
      } : null,
      hjalmar: {
        disposition: d.disposition,
        targetDisposition: d.targetDisposition,
        objectiveStatus: d.objectiveStatus,
        nanoTaskAssessment: d.nanoTaskAssessment,
        progressEvidence: d.progressEvidence,
        runtimeCorrections: (result.runtimeReconciliation?.corrections || []).map((item) => item.code)
      }
    };
    const requestedSessionAction = result.targetResponse?.sessionAction || "KEEP";
    const requestedProcessStatus = result.targetResponse?.greenfieldStatusRequest || "";
    const queueManaged = Boolean(queueContextAfterResponse?.itemId);
    // v1.8.1: the turn that was in flight when the window closed has finished;
    // a blocked schedule now parks the slot instead of sending another prompt.
    const scheduleBlock = queueManaged ? await activeSlotScheduleBlock(current) : "";
    const queueAction = queueAfterResponseAction({
      queueManaged,
      queueQuantumReached,
      sessionAction: requestedSessionAction,
      scheduleBlocked: Boolean(scheduleBlock)
    });
    const queueYieldRequested = queueAction === QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH &&
      isExplicitQueueYieldAction(requestedSessionAction);
    const backgroundSleepRequested = queueAction === QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH &&
      isExplicitBackgroundSleepAction(requestedSessionAction);
    const queuePauseRequested = queueAction === QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH &&
      isExplicitPauseAction(requestedSessionAction);

    if (queueAction === QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH) {
      const switched = await parkQueueMissionAfterAnalysis({
        current,
        completedInteractions: queueContextAfterResponse.interactionCount,
        effectiveNextPrompt,
        previousDisposition: d.disposition,
        analysisEvidence,
        greenfieldControl,
        effectiveDecision,
        result,
        latestInstruction,
        pauseSeconds: (backgroundSleepRequested || queuePauseRequested)
          ? result.targetResponse?.pauseSeconds
          : null,
        requestedSessionAction,
        quantumReached: queueQuantumReached,
        scheduleBlock
      });
      if (switched) {
        await audit(switched, "MISSION_QUEUE_SWITCH_COMPLETED", "mission-work-queue", {
          previousProcessId: current.processId,
          previousQueueItemId: current.queueContext?.itemId || "",
          nextQueueItemId: switched.queueContext?.itemId || "",
          reason: scheduleBlock
            ? scheduleParkOutcome(scheduleBlock)
            : backgroundSleepRequested
              ? "EIC_BACKGROUND_SLEEP"
              : queuePauseRequested
                ? "EIC_PAUSE_PARKED"
                : queueYieldRequested
                  ? "EIC_YIELD_TO_QUEUE"
                  : "QUANTUM_EXHAUSTED",
          completedInteractions: queueContextAfterResponse.interactionCount,
          maxInteractions: queueContextAfterResponse.maxInteractions
        }).catch(() => undefined);
        return switched;
      }
    }

    const pendingQuantum = Number(queueContextAfterResponse?.pendingMaxInteractions || 0);
    const nextQueueContext = queueContextAfterResponse
      ? {
          ...queueContextAfterResponse,
          // An AI SET_QUANTUM takes effect exactly at the slot's quantum boundary.
          ...(queueQuantumReached === true && pendingQuantum > 0
            ? {
                maxInteractions: normalizeMissionQuantumInteractions(pendingQuantum),
                pendingMaxInteractions: null
              }
            : {}),
          interactionCount: queueQuantumReached === true
            ? 0
            : queueContextAfterResponse.interactionCount,
          responseRoundTripApproxMs: latestResponseRoundTripMs(current.sessionHealth) ??
            queueContextAfterResponse.responseRoundTripApproxMs ??
            null
        }
      : null;

    if (isExplicitRotationAction(requestedSessionAction)) {
      const rotationCurrent = nextQueueContext
        ? { ...current, queueContext: nextQueueContext }
        : current;
      if (rotationCurrent !== current) await saveProcess(rotationCurrent);
      const rotated = await armSessionRotation(rotationCurrent, {
        reasonCode: "EIC_ROTATE_SESSION_NOW",
        reason: result.targetResponse?.sessionReason || "EIC requested proactive session rotation.",
        requestedBy: "EIC_AI",
        objective: effectiveNextPrompt,
        previousResponseHash: current.lastResponse.hash,
        previousDisposition: d.disposition,
        analysisEvidence,
        sourceResponseState: "COMPLETED_RESPONSE_CAPTURED",
        operatorInstruction: latestInstruction,
        processStatusMode: requestedProcessStatus
      });
      if (latestInstruction && rotated) {
        const cleared = await clearNextInstruction(current.processId, latestInstruction.instructionId);
        await audit(rotated, "NEXT_INSTRUCTION_CONSUMED_BY_SESSION_ROTATION", "operator-input", {
          instructionId: latestInstruction.instructionId,
          text: latestInstruction.text,
          clearedFromInbox: cleared.cleared === true,
          rotationId: rotated.sessionRotation?.rotationId || ""
        }).catch(() => undefined);
      }
      return rotated;
    }

    let missionPause = null;
    if (isExplicitPauseAction(requestedSessionAction) || backgroundSleepRequested) {
      missionPause = createMissionPauseRecord({
        processId: current.processId,
        generation: current.generation,
        durationSeconds: result.targetResponse?.pauseSeconds,
        reason: result.targetResponse?.sessionReason || (
          backgroundSleepRequested
            ? "EIC requested background sleep; no other queued mission was runnable, so the worker is held until wake."
            : "EIC requested a timed Greenfield process pause."
        ),
        sourceResponseHash: current.lastResponse.hash,
        nextObjectiveId
      });
    }

    const promptCurrent = nextQueueContext
      ? { ...current, queueContext: nextQueueContext }
      : current;
    const pendingPrompt = await buildPendingA2A(promptCurrent, {
      objective: effectiveNextPrompt,
      objectiveId: nextObjectiveId,
      messageType,
      operatorInstruction: latestInstruction,
      previousResponseHash: current.lastResponse.hash,
      previousDisposition: d.disposition,
      analysisEvidence,
      processStatusMode: requestedProcessStatus,
      pauseResume: missionPause ? {
        pauseId: missionPause.pauseId,
        requestedSeconds: missionPause.durationSeconds,
        resumeNotBeforeAt: missionPause.resumeNotBeforeAt,
        reason: missionPause.reason
      } : null,
      baselineAssistantHash: current.lastResponse.hash,
      turn: nextTurn
    });
    const nextPromptHash = pendingPrompt.hash;
    if (missionPause) {
      missionPause = {
        ...missionPause,
        nextPromptHash
      };
    }

    await audit(current, "CONTINUATION_DISPOSITION_BOUND", "continuation", {
      responseHash: current.lastResponse.hash,
      previousDisposition: d.disposition,
      protocolDisposition: result.targetDisposition,
      source: "HJALMAR_CONTROLLER_DISPOSITION",
      objectiveId: nextObjectiveId,
      admission,
      responseObservation
    }, result.token.operationId);

    await audit(current, "A2A_ENVELOPE_COMPOSED", "a2a", {
      messageType,
      envelope: pendingPrompt.a2a,
      promptHash: nextPromptHash,
      operatorInstructionId: latestInstructionId,
      analysisEvidence
    }, result.token.operationId);

    const nextPhase = missionPause ? PHASES.PAUSED : PHASES.SENDING;
    const next = await commitTransition(current, nextPhase, {
      turn: nextTurn,
      lastNano: result.nano || null,
      lastNanoTask: result.nanoTask || current.lastNanoTask || null,
      lastDecision: effectiveDecision,
      greenfieldControl: {
        ...greenfieldControl,
        effectiveNextPrompt
      },
      queueContext: nextQueueContext,
      missionPause,
      objectiveState: {
        objectiveId: nextObjectiveId,
        objective: effectiveNextPrompt,
        status: missionPause ? "PAUSED" : "PENDING",
        previousObjectiveId: result.currentObjectiveId || "",
        previousObjectiveStatus: d.objectiveStatus,
        updatedAt: nowIso()
      },
      lastConsumedInstructionId: latestInstructionId || current.lastConsumedInstructionId || null,
      pendingPrompt,
      responseCandidate: null,
      responseInterleave: null,
      recovery: resetRecovery(current).recovery,
      lastError: null,
      lastMaterialAt: nowIso()
    }, {
      kind: missionPause
        ? "MISSION_PAUSE_ARMED"
        : d.disposition === DISPOSITIONS.READ_REQUIRED
          ? "HJALMAR_D2_READ_REQUIRED"
          : "HJALMAR_D2_CONTINUE",
      component: missionPause ? "mission-pause" : "decision",
      detail: {
        nano: result.nano || null,
        nanoTask: result.nanoTask || null,
        decision: effectiveDecision,
        originalDecision: admission.replanned === true ? d : null,
        admission,
        greenfieldControl: {
          ...greenfieldControl,
          effectiveNextPrompt
        },
        targetDisposition: result.targetDisposition,
        a2aMessageId: pendingPrompt.a2a?.messageId || "",
        a2aSchema: pendingPrompt.a2a?.schema || "",
        nextObjectiveId,
        nextPromptHash,
        missionPause,
        operatorInstructionApplied: Boolean(latestInstruction),
        operatorInstructionId: latestInstructionId,
        operatorInstructionText: latestInstruction?.text || ""
      }
    });

    if (latestInstruction) {
      const cleared = await clearNextInstruction(current.processId, latestInstruction.instructionId);
      await audit(next, "NEXT_INSTRUCTION_CONSUMED", "operator-input", {
        instructionId: latestInstruction.instructionId,
        text: latestInstruction.text,
        promptHash: nextPromptHash,
        clearedFromInbox: cleared.cleared === true
      });
      await broadcast(next, "next-instruction-consumed");
    }

    if (next.phase !== PHASES.PAUSED) scheduleFast(next.processId, 100);
    return next;
  });
}

async function tickPaused(process) {
  const pause = process.missionPause;
  if (!pause ||
      pause.state !== MISSION_PAUSE_STATES.ARMED ||
      !process.pendingPrompt?.text ||
      !process.pendingPrompt?.hash) {
    const error = {
      code: "MISSION_PAUSE_STATE_INVALID",
      message: "Paused process is missing an armed pause record or its already-composed continuation prompt."
    };
    return commitTransition(process, PHASES.BLOCKED, {
      lastError: error
    }, {
      kind: "MISSION_PAUSE_BLOCKED",
      component: "mission-pause",
      detail: { missionPause: pause || null }
    });
  }

  if (!missionPauseDue(pause)) {
    try {
      await syncMissionPauseAlarm(process);
    } catch (error) {
      await audit(process, "MISSION_PAUSE_ALARM_SYNC_FAILED", "mission-pause", {
        error: errorRecord(error),
        fallback: "WATCHDOG"
      }).catch(() => undefined);
      await chrome.alarms.create(alarmName(process.processId), {
        periodInMinutes: WATCHDOG_MINUTES
      }).catch(() => undefined);
    }
    return process;
  }

  const resumedPause = resumeMissionPauseRecord(pause, {
    reason: "SCHEDULED_WAKE"
  });
  const next = await commitTransition(process, PHASES.SENDING, {
    missionPause: resumedPause,
    objectiveState: {
      ...(process.objectiveState || {}),
      status: "PENDING",
      updatedAt: nowIso()
    },
    lastError: null,
    lastMaterialAt: nowIso()
  }, {
    kind: "MISSION_PAUSE_RESUMED",
    component: "mission-pause",
    detail: {
      pauseId: resumedPause.pauseId,
      requestedSeconds: resumedPause.durationSeconds,
      requestedAt: resumedPause.requestedAt,
      resumeNotBeforeAt: resumedPause.resumeNotBeforeAt,
      resumedAt: resumedPause.resumedAt,
      actualWaitMs: Math.max(0, resumedPause.resumedAtMs - resumedPause.requestedAtMs),
      nextPromptHash: process.pendingPrompt.hash
    }
  });
  scheduleFast(next.processId, 100);
  return next;
}

async function tickRecovering(process) {
  const due = Date.parse(process.recovery?.nextAttemptAt || "");
  if (Number.isFinite(due) && Date.now() < due) {
    scheduleFast(process.processId, Math.min(5000, Math.max(250, due - Date.now())));
    return process;
  }
  const recoverTo = process.recovery?.recoverTo;
  if (![PHASES.SENDING, PHASES.WAITING, PHASES.ANALYZING, PHASES.ROTATING].includes(recoverTo)) {
    const error = Object.assign(new Error("RECOVERY_TARGET_INVALID"), { code: "RECOVERY_TARGET_INVALID" });
    return commitTransition(process, PHASES.BLOCKED, {
      lastError: errorRecord(error)
    }, {
      kind: "RECOVERY_BLOCKED",
      component: "runtime"
    });
  }
  const next = await commitTransition(process, recoverTo, {
    recovery: {
      ...process.recovery,
      nextAttemptAt: null
    }
  }, {
    kind: "RECOVERY_RETRY",
    component: "runtime",
    detail: {
      attempt: process.recovery?.attempts || 0,
      recoverTo
    }
  });
  scheduleFast(next.processId, 100);
  return next;
}

async function tickDetached(process) {
  try {
    await tabState(process, "detached-reconcile");
  } catch (error) {
    // First preserve the existing deterministic single-tab rebind. If that
    // cannot restore a usable owner surface after bounded attempts, rotate the
    // ChatGPT session rather than waiting forever on a broken conversation.
    try {
      const tabs = await chrome.tabs.query({ windowId: process.windowId });
      const candidates = tabs.filter((tab) =>
        Number.isInteger(tab.id) &&
        supportedUrl(tab.url) &&
        deriveGptRoot(tab.url || "", process.gptRoot || "") ===
          deriveGptRoot(process.gptRoot || "", process.gptRoot || "")
      );
      if (candidates.length === 1 && candidates[0].id !== process.tabId) {
        const rebound = {
          ...process,
          tabId: candidates[0].id,
          gptRoot: deriveGptRoot(candidates[0].url || "", process.gptRoot || ""),
          detached: {
            ...(process.detached || {}),
            reconcileAttempts: 0
          },
          updatedAt: nowIso()
        };
        await saveProcess(rebound);
        await audit(rebound, "TARGET_TAB_REBOUND", "chrome", {
          oldTabId: process.tabId,
          newTabId: candidates[0].id,
          evidence: "EXACTLY_ONE_MATCHING_GPT_TAB_IN_WINDOW"
        });
        process = rebound;
        await tabState(process, "detached-rebind-check");
      } else {
        const attempts = Number(process.detached?.reconcileAttempts || 0) + 1;
        const updated = {
          ...process,
          detached: {
            ...(process.detached || {}),
            reconcileAttempts: attempts,
            lastReconcileAt: nowIso()
          },
          updatedAt: nowIso()
        };
        await saveProcess(updated);
        await audit(updated, "TARGET_REATTACH_RETRY", "chrome", {
          attempts,
          matchingCandidates: candidates.length,
          rotationAfterAttempts: 6
        }).catch(() => undefined);

        if (attempts >= 6) {
          return armSessionRotation(updated, {
            reasonCode: "DETACHED_SESSION_RECOVERY_EXHAUSTED",
            reason: error?.message || updated.detached?.detail || "Managed ChatGPT session could not be reattached.",
            requestedBy: "RUNTIME_RECOVERY",
            objective: updated.objectiveState?.objective || updated.lastPrompt?.a2a?.objective || updated.goal,
            previousResponseHash: updated.lastResponse?.hash || "",
            previousDisposition: "SESSION_DETACHED",
            sourceResponseState: sessionRotationSourceState(updated)
          });
        }
        scheduleFast(updated.processId, 5000);
        return updated;
      }
    } catch (rebindError) {
      const attempts = Number(process.detached?.reconcileAttempts || 0) + 1;
      const updated = {
        ...process,
        detached: {
          ...(process.detached || {}),
          reconcileAttempts: attempts,
          lastReconcileAt: nowIso()
        },
        updatedAt: nowIso()
      };
      await saveProcess(updated).catch(() => undefined);
      if (attempts >= 6) {
        return armSessionRotation(updated, {
          reasonCode: "DETACHED_SESSION_RECOVERY_EXHAUSTED",
          reason: rebindError?.message || "Managed ChatGPT session could not be reattached.",
          requestedBy: "RUNTIME_RECOVERY",
          objective: updated.objectiveState?.objective || updated.lastPrompt?.a2a?.objective || updated.goal,
          previousResponseHash: updated.lastResponse?.hash || "",
          previousDisposition: "SESSION_DETACHED",
          sourceResponseState: sessionRotationSourceState(updated)
        });
      }
      scheduleFast(updated.processId, 5000);
      return updated;
    }
  }
  const resumePhase = process.detached?.resumePhase;
  const target = [PHASES.SENDING, PHASES.WAITING, PHASES.ANALYZING, PHASES.RECOVERING, PHASES.ROTATING]
    .includes(resumePhase)
    ? resumePhase
    : PHASES.WAITING;
  const next = await commitTransition(process, target, {
    detached: null,
    lastError: null
  }, {
    kind: "TARGET_REATTACHED",
    component: "chrome",
    detail: { resumePhase: target }
  });
  scheduleFast(next.processId, 100);
  return next;
}

async function drainWorkModePrequeue(supervisorProcess, settings) {
  const scheduler = await currentSchedulerSnapshot().catch(() => null);
  const capacity = Number(scheduler?.context?.effectiveCapacity ?? settings.maxActiveSessions ?? 1);
  const activeCount = Number(scheduler?.scheduler?.activeCount || 0);
  if (capacity <= 0 || activeCount >= capacity) return { state: "WAIT_CAPACITY" };

  const claim = await claimNextWorkModePointer(chrome.storage.local, { now: Date.now() });
  if (!claim.item) return { state: "EMPTY" };
  const pointer = claim.item.pointer;
  const surface = await readEicSurfaceState(chrome.storage.local);
  if (!surface.lastKnownGoodEicUrl) {
    await completeWorkModePointer(claim.item.key, "READY", chrome.storage.local);
    return { state: "WAIT_EIC_URL" };
  }

  let created = null;
  try {
    created = await chrome.windows.create({
      url: surface.lastKnownGoodEicUrl,
      focused: false,
      type: "normal"
    });
    if (!created || !Number.isInteger(created.id)) throw new Error("WORK_MODE_WINDOW_CREATE_FAILED");
    const worker = await ensureWorkerBinding(created.id, chrome.storage.session);
    const mission = wmtPointerMission(pointer, settings.workModeEndpoint);
    const started = await startRun({
      windowId: created.id,
      goal: mission,
      auditSessionId: supervisorProcess.auditSessionId || BACKGROUND_AUDIT_SESSION_ID,
      schedulerPriority: normalizeGreenfieldPriority(pointer.priority || "NORMAL")
    });
    if (!started?.ok || !started.process?.processId) throw new Error(started?.code || "WORK_MODE_START_FAILED");
    await completeWorkModePointer(claim.item.key, "MATERIALIZED", chrome.storage.local, {
      workerId: worker.workerId,
      windowId: created.id
    });
    const status = workModeStatusPayload({
      taskRef: pointer.taskRef,
      state: "STARTING",
      workerId: worker.workerId
    });
    await fetch(`${String(settings.workModeEndpoint || "").replace(/\/$/, "")}/status`, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: { "Content-Type": "application/json", "X-EIC-WMT-Key": pointer.taskKey },
      body: JSON.stringify({ ...status, nonce: pointer.nonce })
    }).catch(() => undefined);
    await audit(supervisorProcess, "WORK_MODE_TASK_MATERIALIZED", "work-mode", {
      taskRef: pointer.taskRef,
      childWorkerId: worker.workerId,
      childWindowId: created.id,
      childProcessId: started.process.processId
    }).catch(() => undefined);
    return { state: "MATERIALIZED", taskRef: pointer.taskRef, workerId: worker.workerId };
  } catch (error) {
    await completeWorkModePointer(claim.item.key, "READY", chrome.storage.local);
    if (created?.id) await chrome.windows.remove(created.id).catch(() => undefined);
    await audit(supervisorProcess, "WORK_MODE_MATERIALIZATION_FAILED", "work-mode", {
      taskRef: pointer.taskRef,
      error: errorRecord(error)
    }).catch(() => undefined);
    return { state: "MATERIALIZATION_FAILED" };
  }
}

async function syncWorkModeForWorker(process, { force = false } = {}) {
  if (!process?.workerId || !Number.isInteger(process.windowId)) return { ok: true, state: "NO_WORKER" };
  const settings = await loadOperatorSettings(chrome.storage.local, { restoreSavedMissions: false, bookmarks: null });
  if (settings.workModeEnabled !== true) return { ok: true, state: "DISABLED" };
  if (settings.workModeSupervisorWorkerId && settings.workModeSupervisorWorkerId !== process.workerId) {
    return { ok: true, state: "NOT_SUPERVISOR" };
  }
  const now = Date.now();
  const last = Number(workModeLastPoll.get(process.workerId) || 0);
  if (!force && now - last < WORK_MODE_POLL_MS) return { ok: true, state: "THROTTLED" };
  workModeLastPoll.set(process.workerId, now);
  const endpoint = String(settings.workModeEndpoint || "").replace(/\/$/, "");
  const url = `${endpoint}/tasks/next?workerId=${encodeURIComponent(process.workerId)}&ts=${now}`;
  let response;
  try {
    response = await fetch(url, { method: "GET", cache: "no-store", credentials: "omit", headers: { "Accept": "application/json" } });
  } catch (error) {
    await audit(process, "WORK_MODE_SYNC_UNREACHABLE", "work-mode", { endpoint, error: errorRecord(error) }).catch(() => undefined);
    return { ok: false, state: "UNREACHABLE" };
  }
  if (response.status === 204) {
    const materialized = await drainWorkModePrequeue(process, settings).catch(() => null);
    return { ok: true, state: materialized?.state || "EMPTY" };
  }
  if (!response.ok) {
    await audit(process, "WORK_MODE_SYNC_HTTP_ERROR", "work-mode", { endpoint, status: response.status }).catch(() => undefined);
    return { ok: false, state: "HTTP_ERROR", status: response.status };
  }
  const body = await response.json().catch(() => null);
  const pointer = body?.task || body;
  const validation = validateWmtPointer(pointer, { now });
  if (!validation.ok) {
    await audit(process, "WORK_MODE_POINTER_REJECTED", "work-mode", { errors: validation.errors }).catch(() => undefined);
    return { ok: false, state: "POINTER_REJECTED", errors: validation.errors };
  }
  const v = validation.value;
  await enqueueWorkModePointer(v, chrome.storage.local, { now });
  const status = workModeStatusPayload({ taskRef: v.taskRef, state: "PREQUEUED", workerId: process.workerId, now });
  await fetch(`${endpoint}/status`, {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    headers: { "Content-Type": "application/json", "X-EIC-WMT-Key": v.taskKey },
    body: JSON.stringify({ ...status, nonce: v.nonce })
  }).catch(() => undefined);
  await audit(process, "WORK_MODE_TASK_PREQUEUED", "work-mode", { taskRef: v.taskRef }).catch(() => undefined);
  const materialized = await drainWorkModePrequeue(process, settings).catch(() => null);
  return { ok: true, state: materialized?.state || "PREQUEUED", taskRef: v.taskRef };
}

async function tickProcess(processId, reason = "manual") {
  await runtimeReady;
  if (runtimeFault) return null;
  let process = await findProcessById(processId);
  if (!process || TERMINAL_PHASES.has(process.phase)) return process;

  if (![PHASES.DETACHED, PHASES.RECOVERING].includes(process.phase)) {
    const managedTab = await chrome.tabs.get(process.tabId).catch(() => null);
    if (managedTab) {
      const surface = await enforceManagedEicSurface(process, managedTab).catch(() => null);
      if (surface?.action === "GRACE") {
        const elapsed = Math.max(0, Date.now() - Number(surface.wrongSinceMs || Date.now()));
        scheduleFast(process.processId, Math.max(200, 10000 - elapsed));
        return process;
      }
      if (surface?.action === "RECOVER") return process;
    }
  }

  const localSafety = await readSafety();
  if (process.storageRecoveryRequired || process.safety?.qualityIncident) return holdForSafety(process,{code:process.storageRecoveryRequired ? "STORAGE_RECOVERY_REQUIRES_REVIEW" : process.safety.qualityIncident.code});
  if (Number(process.safety?.hold?.retryAtMs || 0) > Date.now()) return process;
  if (!localSafety.admissionPaused && !localSafety.providerHold) await syncWorkModeForWorker(process).catch(() => undefined);

  // A worker accepts at most one pending delegation per tick. This is the
  // ownership boundary that keeps the supervising Greenfield from creating
  // new queue work in its own Chrome session.
  process = await acceptPendingMissionDelegationForWorker(process);

  try {
    await audit(process, "PROCESS_TICK", "runtime", {
      reason,
      phase: process.phase
    });
  } catch {
    return findProcessById(processId);
  }

  switch (process.phase) {
    case PHASES.SENDING:
      return tickSending(process);
    case PHASES.WAITING:
      return tickWaiting(process);
    case PHASES.ANALYZING:
      return tickAnalyzing(process);
    case PHASES.PAUSED:
      return tickPaused(process);
    case PHASES.RECOVERING:
      return tickRecovering(process);
    case PHASES.DETACHED:
      return tickDetached(process);
    case PHASES.ROTATING:
      return tickRotating(process);
    default:
      return process;
  }
}

async function handleUnhandledTickError(processId, reason, error) {
  if (/CHECKPOINT|STORAGE|QUOTA_BYTES|SAFETY_JOURNAL|READBACK/i.test(String(error?.message || ""))) runtimeFault = String(error.message);
  const process = await findProcessById(processId).catch(() => null);
  const context = process
    ? { process }
    : { scope: "APP", auditSessionId: BACKGROUND_AUDIT_SESSION_ID };

  await appendAuditError({
    ...context,
    error,
    kind: "PROCESS_TICK_UNHANDLED_ERROR",
    component: "runtime",
    payload: {
      processId,
      reason,
      phase: process?.phase || ""
    }
  }).catch(() => undefined);

  if (!process || TERMINAL_PHASES.has(process.phase) || process.phase === PHASES.AUDIT_FAILURE) {
    return process;
  }

  try {
    return await enterRecovery(process, Object.assign(
      new Error(error?.message || String(error || "PROCESS_TICK_UNHANDLED_ERROR")),
      {
        name: error?.name || "Error",
        code: error?.code || "PROCESS_TICK_UNHANDLED_ERROR",
        cause: error
      }
    ), process.phase);
  } catch (recoveryError) {
    await appendAuditError({
      process,
      error: recoveryError,
      kind: "PROCESS_TICK_RECOVERY_ERROR",
      component: "runtime",
      payload: {
        originalError: errorRecord(error),
        reason,
        phase: process.phase
      }
    }).catch(() => undefined);
    return process;
  }
}

function enqueueTick(processId, reason) {
  return queues.enqueue(processId, async () => {
    try {
      return await tickProcess(processId, reason);
    } catch (error) {
      return handleUnhandledTickError(processId, reason, error);
    }
  });
}

async function startRun({ windowId, goal, auditSessionId = "", schedulerPriority = DEFAULT_GREENFIELD_PRIORITY }) {
  await runtimeReady;
  if (runtimeFault) throw new Error(runtimeFault);
  if (!Number.isInteger(windowId)) throw new Error("WINDOW_ID_REQUIRED");
  const mission = String(goal || "").trim();
  const requestedPriority = normalizeGreenfieldPriority(schedulerPriority);
  const worker = await ensureWorkerBinding(windowId, chrome.storage.session);
  if (!mission) throw new Error("GOAL_REQUIRED");
  if (mission.length > MAX_PROMPT_CHARS) throw new Error("GOAL_TOO_LARGE");

  await appendAudit({
    scope: "WINDOW",
    auditSessionId,
    windowId,
    kind: "RUN_START_REQUEST",
    component: "runtime",
    payload: { goal: mission, appVersion: APP_VERSION, schedulerPriority: requestedPriority }
  });

  const existing = await loadProcessForWindow(windowId);
  if (existing && !TERMINAL_PHASES.has(existing.phase)) {
    await syncOverlay(existing, "existing-run");
    return { ok: true, existing: true, process: publicSnapshot(existing) };
  }

  const [tab] = await chrome.tabs.query({ windowId, active: true });
  if (!tab || !Number.isInteger(tab.id) || !supportedUrl(tab.url)) {
    const error = new Error("ACTIVE_CHATGPT_TAB_REQUIRED");
    error.code = "ACTIVE_CHATGPT_TAB_REQUIRED";
    await appendAuditError({
      error,
      scope: "WINDOW",
      auditSessionId,
      windowId,
      kind: "RUN_START_TARGET_ERROR",
      component: "chrome"
    }).catch(() => undefined);
    throw error;
  }

  let page;
  try {
    const bridge = await ensureContentBridgeVersion(tab.id);
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "EIC_GF_GET_PAGE_STATE",
      source: bridge.refreshed ? "start-after-bridge-refresh" : "start"
    });
    if (!result?.ok) {
      const error = new Error(result?.error || "CONTENT_BRIDGE_UNAVAILABLE");
      error.code = result?.code || "CONTENT_BRIDGE_UNAVAILABLE";
      throw error;
    }
    page = result.state || {};
    if (String(page.bridgeVersion || "") !== APP_VERSION) {
      const error = new Error("CONTENT_BRIDGE_VERSION_READBACK_MISMATCH");
      error.code = "CONTENT_BRIDGE_VERSION_READBACK_MISMATCH";
      throw error;
    }
    await appendAudit({
      scope: "WINDOW",
      auditSessionId,
      windowId,
      tabId: tab.id,
      kind: "CONTENT_BRIDGE_START_VERIFIED",
      component: "content",
      payload: {
        refreshed: bridge.refreshed === true,
        observedVersion: bridge.observedVersion || "",
        currentVersion: page.bridgeVersion || "",
        documentId: page.documentId || ""
      }
    }).catch(() => undefined);
  } catch (error) {
    await appendAuditError({
      error,
      scope: "WINDOW",
      auditSessionId,
      windowId,
      tabId: tab.id,
      kind: "CONTENT_BRIDGE_START_ERROR",
      component: "content"
    }).catch(() => undefined);
    throw Object.assign(new Error("CHATGPT_BRIDGE_UNAVAILABLE"), {
      code: "CHATGPT_BRIDGE_UNAVAILABLE",
      cause: error
    });
  }

  const surfaceState = await readEicSurfaceState(chrome.storage.local).catch(() => ({ lastKnownGoodEicUrl: "" }));
  const surfaceClass = classifyManagedEicSurface(tab.url || "", surfaceState.lastKnownGoodEicUrl || "");
  if (!surfaceClass.ok) {
    if (surfaceState.lastKnownGoodEicUrl) {
      await chrome.tabs.update(tab.id, { url: surfaceState.lastKnownGoodEicUrl });
      const error = new Error("ACTIVE_EIC_TAB_RECOVERY_TRIGGERED");
      error.code = "ACTIVE_EIC_TAB_RECOVERY_TRIGGERED";
      throw error;
    }
    const error = new Error("ACTIVE_EIC_CUSTOM_GPT_TAB_REQUIRED");
    error.code = "ACTIVE_EIC_CUSTOM_GPT_TAB_REQUIRED";
    throw error;
  }
  await rememberGoodEicUrl(surfaceClass.observedRoot, chrome.storage.local).catch(() => undefined);
  const gptRoot = surfaceClass.observedRoot || deriveGptRoot(tab.url || "");
  if (!gptRoot) {
    const error = new Error("GPT_ROOT_UNRESOLVED");
    error.code = "GPT_ROOT_UNRESOLVED";
    throw error;
  }

  const startObjective = initialMissionObjective();
  const process = createProcess({
    workerId: worker.workerId,
    windowId,
    tabId: tab.id,
    gptRoot,
    goal: mission,
    initialPrompt: startObjective,
    baselineAssistantHash: page.assistantHash || "",
    auditSessionId,
    schedulerPriority: requestedPriority
  });

  const pendingPrompt = await buildPendingA2A(process, {
    objective: startObjective,
    messageType: "MISSION_START",
    previousResponseHash: "",
    baselineAssistantHash: page.assistantHash || "",
    turn: 1
  });
  process.pendingPrompt = pendingPrompt;
  process.objectiveState = {
    objectiveId: pendingPrompt.a2a?.objectiveId || "",
    objective: startObjective,
    status: "PENDING",
    updatedAt: nowIso()
  };

  try {
    await appendAudit({
      process,
      kind: "A2A_AGENT_PRESENTATION_COMPOSED",
      component: "a2a",
      payload: {
        envelope: pendingPrompt.a2a,
        promptHash: pendingPrompt.hash
      }
    });
    await appendAudit({
      process,
      kind: "RUN_CREATED",
      component: "runtime",
      payload: {
        goal: mission,
        initialPrompt: pendingPrompt.text,
        initialPromptHash: pendingPrompt.hash,
        baselineAssistantHash: process.pendingPrompt.baselineAssistantHash,
        gptRoot: process.gptRoot || "",
        sessionSeq: Number(process.sessionSeq || 1),
        a2aSchema: pendingPrompt.a2a?.schema || "",
        a2aProtocol: pendingPrompt.a2a?.protocol || "",
        appVersion: APP_VERSION,
        schedulerPriority: process.schedulerPriority
      }
    });
  } catch (error) {
    const failed = await markAuditFailure(process, error, "run-create");
    return { ok: false, code: "AUDIT_WRITE_FAILED", process: publicSnapshot(failed) };
  }

  await saveProcess(process);
  const readback = await loadProcessForWindow(windowId);
  if (!readback || readback.processId !== process.processId) {
    const error = new Error("RUN_CREATE_READBACK_FAILED");
    error.code = "RUN_CREATE_READBACK_FAILED";
    await appendAuditError({ error, process, kind: "RUN_CREATE_READBACK_ERROR", component: "storage" }).catch(() => undefined);
    throw error;
  }
  await appendAudit({
    process,
    kind: "RUN_CREATE_READBACK_OK",
    component: "storage",
    payload: { processId: readback.processId, phase: readback.phase }
  });

  await setWatchdog(process);
  await broadcast(process, "run-created");
  scheduleFast(process.processId, 50);
  return { ok: true, existing: false, process: publicSnapshot(process) };
}

async function stopRun({ windowId, reason = "OPERATOR_STOP" }) {
  const process = await loadProcessForWindow(windowId);
  if (!process) return { ok: true, process: null };
  if (TERMINAL_PHASES.has(process.phase)) {
    return { ok: true, process: publicSnapshot(process) };
  }
  if (process.queueContext?.itemId) {
    const { queue, settings } = await missionQueueForWindow(windowId);
    if (queue.enabled) {
      queue.enabled = false;
      await persistMissionQueue(queue, settings, process, "MISSION_QUEUE_STOPPED", { reason });
    }
  }
  if (process.pendingPrompt?.promptPause?.reservationId) {
    await releaseGlobalPromptLease({
      reservationId: process.pendingPrompt.promptPause.reservationId
    }).catch(() => undefined);
  }
  await cancelSchedulerProcess(process, reason).catch(() => undefined);
  const next = await commitTransition(process, PHASES.STOPPED, {
    generation: process.generation + 1,
    lastError: reason ? { code: "STOPPED", message: String(reason) } : null
  }, {
    kind: "RUN_STOPPED",
    component: "ui",
    detail: { reason }
  });
  return { ok: true, process: publicSnapshot(next) };
}

async function resumePausedRun({ windowId, reason = "OPERATOR_RESUME_NOW" }) {
  const process = await loadProcessForWindow(windowId);
  if (!process) return { ok: true, resumed: false, process: null };
  if (process.phase !== PHASES.PAUSED) {
    return { ok: true, resumed: false, process: publicSnapshot(process) };
  }

  return queues.enqueue(process.processId, async () => {
    const current = await findProcessById(process.processId);
    if (!current || current.phase !== PHASES.PAUSED) {
      return { ok: true, resumed: false, process: publicSnapshot(current) };
    }
    if (!current.missionPause || current.missionPause.state !== MISSION_PAUSE_STATES.ARMED) {
      const error = new Error("MISSION_PAUSE_NOT_ARMED");
      error.code = "MISSION_PAUSE_NOT_ARMED";
      throw error;
    }

    const early = !missionPauseDue(current.missionPause);
    const resumedPause = resumeMissionPauseRecord(current.missionPause, {
      reason,
      early
    });
    const next = await commitTransition(current, PHASES.SENDING, {
      missionPause: resumedPause,
      objectiveState: {
        ...(current.objectiveState || {}),
        status: "PENDING",
        updatedAt: nowIso()
      },
      lastError: null,
      lastMaterialAt: nowIso()
    }, {
      kind: early ? "MISSION_PAUSE_RESUMED_EARLY" : "MISSION_PAUSE_RESUMED",
      component: "mission-pause",
      detail: {
        pauseId: resumedPause.pauseId,
        reason,
        requestedSeconds: resumedPause.durationSeconds,
        resumedAt: resumedPause.resumedAt,
        nextPromptHash: current.pendingPrompt?.hash || ""
      }
    });
    scheduleFast(next.processId, 100);
    return { ok: true, resumed: true, process: publicSnapshot(next) };
  });
}

async function fleetStatusSnapshot() {
  const processes = await loadAllProcesses(chrome.storage.local, chrome.storage.session);
  const rows = [];
  for (const process of processes) {
    const queueState = await loadMissionWorkQueue(process.windowId, chrome.storage.local, {
      workerId: process.workerId
    }).catch(() => null);
    const queue = queueState ? publicMissionWorkQueue(queueState) : null;
    const activeItem = queue?.items?.find((item) => item.itemId === queue.activeItemId) || null;
    rows.push({
      process: publicSnapshot(process),
      queue: queue ? {
        enabled: queue.enabled,
        activeItemId: queue.activeItemId,
        activeItem,
        readyCount: queue.items.filter((item) => item.status === QUEUE_STATUS.READY).length,
        pausedCount: queue.items.filter((item) => item.status === QUEUE_STATUS.PAUSED).length,
        blockedCount: queue.items.filter((item) => item.status === QUEUE_STATUS.BLOCKED).length,
        doneCount: queue.history.length,
        totalCount: queue.items.length,
        updatedAt: queue.updatedAt
      } : null
    });
  }
  rows.sort((a, b) => String(b.process?.updatedAt || "").localeCompare(String(a.process?.updatedAt || "")));
  const gate = await readGlobalPromptGate().catch(() => null);
  const schedulerView = await currentSchedulerSnapshot({ gate });
  const settings = await loadOperatorSettings(chrome.storage.local, {
    restoreSavedMissions: false,
    bookmarks: null
  }).catch(() => ({}));
  return {
    generatedAt: nowIso(),
    appVersion: APP_VERSION,
    runtimeFault,
    storageContract:storageContractProof,
    recovery: restartReport,
    safety: await readSafety().then(v=>usageSummary(v)).catch(error=>({error:String(error.message)})),
    storage: await storageHealth().catch(error=>({known:false,error:String(error.message)})),
    storageRetention: storageRetentionStatus || await readStorageRetentionStatus(chrome.storage.local).catch(() => null),
    usedCapacity: Number(schedulerView.scheduler?.activeCount || 0),
    heldCount: rows.filter(row=>row.process?.safety?.hold || row.process?.safety?.qualityIncident || row.process?.storageRecoveryRequired).length,
    schedulerWaiting: schedulerView.scheduler?.waiters || [],
    processCount: rows.length,
    activeCount: rows.filter((row) => row.process && !TERMINAL_PHASES.has(row.process.phase)).length,
    pausedCount: rows.filter((row) => row.process?.phase === PHASES.PAUSED).length,
    waitingCount: Number(schedulerView.scheduler?.waitingCount || 0),
    configuredCapacity: Number(schedulerView.scheduler?.configuredCapacity ?? settings.maxActiveSessions ?? DEFAULT_MAX_ACTIVE_SESSIONS),
    effectiveCapacity: Number(schedulerView.scheduler?.effectiveCapacity ?? settings.maxActiveSessions ?? DEFAULT_MAX_ACTIVE_SESSIONS),
    rateLimitState: String(schedulerView.scheduler?.rateLimitState || gate?.rateLimit?.state || "NORMAL"),
    promptGate: gate ? {
      nextAllowedAtMs: Number(gate.nextPromptNotBeforeAtMs || 0),
      lastPostAtMs: Number(gate.lastPromptPostedAtMs || 0),
      activeLease: Boolean(gate.activeLease)
    } : null,
    workModeEnabled: settings.workModeEnabled === true,
    workers: rows
  };
}

async function snapshotForWindow(windowId) {
  await runtimeReady;
  const worker = await ensureWorkerBinding(windowId, chrome.storage.session);
  const process = await loadProcessForWindow(windowId);
  const nextInstruction = process?.processId
    ? await readNextInstruction(process.processId).catch(() => null)
    : null;
  const globalPromptGate = await readGlobalPromptGate().catch(() => null);
  const missionQueueState = await missionQueueForWindow(windowId).catch(() => null);
  const missionQueueSetStore = await loadMissionQueueSets(chrome.storage.local).catch(() => ({ sets: [] }));
  const schedulerView = await currentSchedulerSnapshot({
    gate: globalPromptGate
  }).catch(() => ({
    context: {
      configuredCapacity: DEFAULT_MAX_ACTIVE_SESSIONS,
      effectiveCapacity: DEFAULT_MAX_ACTIVE_SESSIONS
    },
    scheduler: null
  }));
  return {
    ok: true,
    workerId: worker.workerId,
    process: publicSnapshot(process),
    nextInstruction,
    globalPromptGate,
    globalCapacityScheduler: schedulerView.scheduler,
    missionQueue: missionQueueState ? publicMissionWorkQueue(missionQueueState.queue) : null,
    missionQueueSets: publicMissionQueueSets(missionQueueSetStore),
    fleetStatus: await fleetStatusSnapshot(),
    audit: await auditSnapshotForWindow(windowId, process)
  };
}


async function setSchedulerPriority({ windowId, priority }) {
  const process = await loadProcessForWindow(windowId);
  if (!process || TERMINAL_PHASES.has(process.phase)) {
    const error = new Error("ACTIVE_PROCESS_REQUIRED");
    error.code = "ACTIVE_PROCESS_REQUIRED";
    throw error;
  }
  const normalizedPriority = normalizeGreenfieldPriority(priority);
  return queues.enqueue(process.processId, async () => {
    const current = await findProcessById(process.processId);
    if (!current || TERMINAL_PHASES.has(current.phase)) {
      const error = new Error("ACTIVE_PROCESS_REQUIRED");
      error.code = "ACTIVE_PROCESS_REQUIRED";
      throw error;
    }
    const updated = {
      ...current,
      schedulerPriority: normalizedPriority,
      queueContext: current.queueContext?.itemId
        ? { ...current.queueContext, priority: normalizedPriority }
        : current.queueContext || null,
      updatedAt: nowIso()
    };
    await saveProcess(updated);
    const readback = await findProcessById(updated.processId);
    if (!readback || normalizeGreenfieldPriority(readback.schedulerPriority) !== normalizedPriority) {
      throw new Error("SCHEDULER_PRIORITY_READBACK_MISMATCH");
    }
    if (updated.queueContext?.itemId) {
      const { queue, settings } = await missionQueueForWindow(updated.windowId);
      const item = queueItemForProcess(queue, updated);
      if (item) {
        queue.items = queue.items.map((candidate) => candidate.itemId === item.itemId
          ? { ...candidate, priority: normalizedPriority, updatedAt: nowIso() }
          : candidate);
        await persistMissionQueue(queue, settings, updated, "MISSION_QUEUE_ACTIVE_PRIORITY_UPDATED", {
          itemId: item.itemId,
          priority: normalizedPriority
        });
      }
    }

    const context = await schedulerCapacityContext();
    const schedulerUpdate = await updateGlobalTurnPriority({
      processId: updated.processId,
      priority: normalizedPriority,
      capacity: context.effectiveCapacity,
      configuredCapacity: context.configuredCapacity
    });
    wakeSchedulerProcesses(schedulerUpdate?.runnableProcessIds || []);
    await audit(updated, "SCHEDULER_PRIORITY_UPDATED", "capacity-scheduler", {
      priority: normalizedPriority,
      queueRank: schedulerUpdate?.scheduler?.waiters?.find(
        (item) => item.processId === updated.processId
      )?.queueRank ?? null,
      active: schedulerUpdate?.scheduler?.activeTurns?.some(
        (item) => item.processId === updated.processId
      ) === true
    });
    await broadcast(updated, "scheduler-priority-updated");
    return {
      ok: true,
      process: publicSnapshot(readback),
      globalCapacityScheduler: schedulerUpdate.scheduler
    };
  });
}

async function setMaxActiveSessions({ windowId, maxActiveSessions }) {
  const value = Number(maxActiveSessions);
  const settings = await saveOperatorSettings(
    { maxActiveSessions: value },
    chrome.storage.local,
    { restoreSavedMissions: false, bookmarks: null }
  );
  const gate = await readGlobalPromptGate().catch(() => null);
  const context = await schedulerCapacityContext({ gate, settings });
  const scheduler = await readGlobalCapacityScheduler(chrome.storage.local, {
    capacity: context.effectiveCapacity,
    configuredCapacity: context.configuredCapacity
  });
  wakeSchedulerProcesses(scheduler?.runnableProcessIds || []);

  const process = Number.isInteger(windowId)
    ? await loadProcessForWindow(windowId).catch(() => null)
    : null;
  await appendAudit({
    process,
    scope: process ? "RUN" : (Number.isInteger(windowId) ? "WINDOW" : "APP"),
    auditSessionId: process?.auditSessionId || BACKGROUND_AUDIT_SESSION_ID,
    windowId: process?.windowId ?? windowId ?? null,
    kind: "SCHEDULER_CAPACITY_UPDATED",
    component: "capacity-scheduler",
    payload: {
      configuredCapacity: context.configuredCapacity,
      effectiveCapacity: context.effectiveCapacity,
      activeCount: scheduler.activeCount,
      waitingCount: scheduler.waitingCount,
      nonPreemptive: true
    }
  }).catch(() => undefined);
  if (process) await broadcast(process, "scheduler-capacity-updated");
  return {
    ok: true,
    operatorSettings: settings,
    globalCapacityScheduler: scheduler
  };
}

async function setNextInstruction({ windowId, instruction = "" }) {
  const process = await loadProcessForWindow(windowId);
  if (!process || TERMINAL_PHASES.has(process.phase)) {
    const error = new Error("ACTIVE_PROCESS_REQUIRED");
    error.code = "ACTIVE_PROCESS_REQUIRED";
    throw error;
  }

  const value = String(instruction || "");
  if (value.length > MAX_NEXT_INSTRUCTION_CHARS) {
    const error = new Error(`NEXT_INSTRUCTION_TOO_LARGE:${MAX_NEXT_INSTRUCTION_CHARS}`);
    error.code = "NEXT_INSTRUCTION_TOO_LARGE";
    throw error;
  }

  return instructionQueues.enqueue(process.processId, async () => {
    const current = await findProcessById(process.processId);
    if (!current || TERMINAL_PHASES.has(current.phase)) {
      const error = new Error("ACTIVE_PROCESS_REQUIRED");
      error.code = "ACTIVE_PROCESS_REQUIRED";
      throw error;
    }

    const normalized = value.trim();
    if (!normalized) {
      const prior = await readNextInstruction(current.processId);
      if (prior) {
        await audit(current, "NEXT_INSTRUCTION_CLEAR_INTENT", "operator-input", {
          instructionId: prior.instructionId,
          text: prior.text
        });
        await clearNextInstruction(current.processId, prior.instructionId);
        await audit(current, "NEXT_INSTRUCTION_CLEARED", "operator-input", {
          instructionId: prior.instructionId
        });
      }
      await broadcast(current, "next-instruction-cleared");
      return { ok: true, process: publicSnapshot(current), nextInstruction: null };
    }

    const prior = await readNextInstruction(current.processId);
    await audit(current, "NEXT_INSTRUCTION_QUEUE_INTENT", "operator-input", {
      text: normalized,
      replacesInstructionId: prior?.instructionId || null
    });
    const record = await writeNextInstruction(current, normalized);
    await audit(current, prior ? "NEXT_INSTRUCTION_REPLACED" : "NEXT_INSTRUCTION_QUEUED", "operator-input", {
      instructionId: record.instructionId,
      text: record.text,
      createdAt: record.createdAt,
      replacedInstructionId: prior?.instructionId || null
    });
    await broadcast(current, "next-instruction-queued");
    return { ok: true, process: publicSnapshot(current), nextInstruction: record };
  });
}

async function auditUiEvent(
  windowId,
  kind,
  payload = {},
  auditSessionId = "",
  component = "ui",
  severity = "INFO"
) {
  const process = await loadProcessForWindow(windowId);
  if (process) {
    await appendAudit({ process, kind, component, severity, payload });
  } else {
    await appendAudit({
      scope: "WINDOW",
      auditSessionId,
      windowId: Number.isInteger(windowId) ? windowId : null,
      kind,
      component,
      severity,
      payload
    });
  }
  return { ok: true, audit: await auditSnapshotForWindow(windowId, process) };
}

async function recordForensicMessage(message, sender) {
  const event = message?.event || {};
  const token = message?.token || null;
  let process = token?.processId ? await findProcessById(token.processId) : null;
  if (!process && sender?.tab?.windowId != null) {
    const candidate = await loadProcessForWindow(sender.tab.windowId);
    if (candidate && candidate.tabId === sender.tab.id) process = candidate;
  }
  const payload = {
    ...(event.payload || {}),
    sender: {
      tabId: sender?.tab?.id ?? null,
      windowId: sender?.tab?.windowId ?? null,
      url: sender?.tab?.url || ""
    }
  };
  if (process) {
    await appendAudit({
      process,
      kind: event.kind || "FORENSIC_EVENT",
      component: event.component || "runtime",
      severity: event.severity || "INFO",
      operationId: token?.operationId || "",
      payload
    });
  } else {
    await appendAudit({
      scope: sender?.tab ? "WINDOW" : "APP",
      auditSessionId: message?.auditSessionId || BACKGROUND_AUDIT_SESSION_ID,
      windowId: sender?.tab?.windowId ?? null,
      tabId: sender?.tab?.id ?? null,
      kind: event.kind || "FORENSIC_EVENT",
      component: event.component || "runtime",
      severity: event.severity || "INFO",
      operationId: token?.operationId || "",
      payload
    });
  }
  return { ok: true };
}

async function contentReady(sender) {
  const tab = sender?.tab;
  if (!tab || !Number.isInteger(tab.id) || !Number.isInteger(tab.windowId)) return { ok: true, overlay: null };
  const process = await loadProcessForWindow(tab.windowId);
  if (!process || process.tabId !== tab.id || TERMINAL_PHASES.has(process.phase)) {
    return { ok: true, overlay: { linked: false, reason: "not-managed" } };
  }
  await audit(process, "CONTENT_BRIDGE_READY", "content", {
    tabId: tab.id,
    url: tab.url || ""
  }).catch(() => undefined);
  return {
    ok: true,
    overlay: await managedOverlayPayload(process, { linked: true, reason: "content-ready" })
  };
}

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {}
  void hydrateProcesses("installed");
});

chrome.runtime.onStartup.addListener(() => {
  void hydrateProcesses("startup");
});

async function liveManagedSurfaceIndex() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    return {
      verified: true,
      index: buildLiveManagedSurfaceIndex(windows, { isSupportedUrl: supportedUrl }),
      error: null
    };
  } catch (error) {
    // A failed Chrome owner read must not fabricate "dead" surfaces. Preserve the
    // prior scheduler state for this hydration and retry on a later lifecycle wake.
    return { verified: false, index: null, error };
  }
}

function potentialActiveTurnDescriptor(process, priorActive = null) {
  if (!process?.processId || TERMINAL_PHASES.has(process.phase)) return null;
  const dispatchEffectPossible =
    process.pendingPrompt?.dispatch &&
    process.pendingPrompt.dispatch.effectPossible !== false;
  const waitingLike =
    process.phase === PHASES.WAITING ||
    (process.phase === PHASES.RECOVERING && process.recovery?.recoverTo === PHASES.WAITING) ||
    (process.phase === PHASES.DETACHED && process.detached?.resumePhase === PHASES.WAITING);
  const sendingEffectPossible =
    dispatchEffectPossible &&
    (
      process.phase === PHASES.SENDING ||
      process.phase === PHASES.RECOVERING ||
      process.phase === PHASES.DETACHED
    );

  if (!waitingLike && !sendingEffectPossible) return null;
  const promptHash = waitingLike
    ? String(process.lastPrompt?.hash || process.pendingPrompt?.hash || "")
    : String(process.pendingPrompt?.hash || process.lastPrompt?.hash || "");
  if (!promptHash) return null;

  return {
    processId: process.processId,
    windowId: process.windowId,
    promptHash,
    priority: normalizeGreenfieldPriority(
      process.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY
    ),
    readySinceMs: Number(priorActive?.readySinceMs || 0) || Date.now(),
    ticketSeq: Number(priorActive?.ticketSeq || 0),
    acquiredAtMs: Number(priorActive?.acquiredAtMs || 0) || Date.now()
  };
}

async function reconcileSchedulerAfterHydration(processes) {
  const gate = await readGlobalPromptGate().catch(() => null);
  const settings = await loadOperatorSettings(
    chrome.storage.local,
    { restoreSavedMissions: false, bookmarks: null }
  ).catch(() => ({ maxActiveSessions: DEFAULT_MAX_ACTIVE_SESSIONS }));
  const context = await schedulerCapacityContext({ gate, settings });
  const prior = await readGlobalCapacityScheduler(chrome.storage.local, {
    capacity: context.effectiveCapacity,
    configuredCapacity: context.configuredCapacity
  }).catch(() => ({
    activeTurns: [],
    waiters: []
  }));
  const priorActiveById = new Map(
    (prior?.activeTurns || []).map((item) => [item.processId, item])
  );
  const priorWaiterById = new Map(
    (prior?.waiters || []).map((item) => [item.processId, item])
  );
  const activeTurns = [];
  const eligibleWaiters = [];
  const staleSurfaceProcesses = [];
  const liveSurfaceProbe = await liveManagedSurfaceIndex();

  for (const process of processes) {
    if (!process?.processId || TERMINAL_PHASES.has(process.phase)) continue;
    if (liveSurfaceProbe.verified && !managedSurfaceIsLive(process, liveSurfaceProbe.index)) {
      if (priorActiveById.has(process.processId) || priorWaiterById.has(process.processId)) {
        staleSurfaceProcesses.push(process);
      }
      continue;
    }
    const active = potentialActiveTurnDescriptor(
      process,
      priorActiveById.get(process.processId)
    );
    if (active) {
      activeTurns.push(active);
      continue;
    }

    const priorWaiter = priorWaiterById.get(process.processId);
    const pendingHash = String(process.pendingPrompt?.hash || "");
    if (
      priorWaiter &&
      process.phase === PHASES.SENDING &&
      pendingHash &&
      (!priorWaiter.promptHash || priorWaiter.promptHash === pendingHash)
    ) {
      eligibleWaiters.push({
        processId: process.processId,
        windowId: process.windowId,
        promptHash: pendingHash,
        priority: normalizeGreenfieldPriority(
          process.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY
        ),
        readySinceMs: Number(priorWaiter.readySinceMs || 0) || Date.now(),
        ticketSeq: Number(priorWaiter.ticketSeq || 0)
      });
    }
  }

  const reconciled = await reconcileGlobalCapacityScheduler({
    activeTurns,
    eligibleWaiters,
    capacity: context.effectiveCapacity,
    configuredCapacity: context.configuredCapacity
  });
  wakeSchedulerProcesses(reconciled?.runnableProcessIds || []);
  for (const process of staleSurfaceProcesses) {
    await audit(process, "GLOBAL_CAPACITY_STALE_SURFACE_PRUNED", "capacity-scheduler", {
      reason: "MANAGED_WINDOW_OR_TAB_NOT_LIVE",
      windowId: process.windowId ?? null,
      tabId: process.tabId ?? null,
      activeCount: reconciled?.scheduler?.activeCount ?? null,
      waitingCount: reconciled?.scheduler?.waitingCount ?? null
    }).catch(() => undefined);
  }
  return {
    ...reconciled,
    context,
    liveSurfaceVerified: liveSurfaceProbe.verified,
    staleSurfaceProcessIds: staleSurfaceProcesses.map((process) => process.processId)
  };
}

async function observeSafetyForProcess(process, page) {
  const policyState = await readSafety();
  const proof = Safety.evaluateModel(page.modelEvidence,policyState.policy,{url:page.url,gptRoot:process.gptRoot});
  if (page.modelEvidence?.quota?.active) await observeProviderQuota({...page.modelEvidence.quota,workerId:process.workerId});
  else if (policyState.providerHold && policyState.providerHold.sourceWorkerId===process.workerId && !policyState.providerHold.multipleSources) await probeProviderRecovery(proof);
  const prior = process.safety || {};
  const definiteDowngrade = ["MODEL_DEGRADED","MODEL_VERSION_MISMATCH","THINKING_EFFORT_TOO_LOW","PROVIDER_QUOTA_OR_FALLBACK","CHAT_MODE_REQUIRED"].includes(proof.code);
  const inFlight = [PHASES.WAITING,PHASES.ANALYZING].includes(process.phase) || Boolean(process.pendingPrompt?.dispatch && process.pendingPrompt.dispatch.effectPossible !== false);
  const qualityIncident = prior.qualityIncident || (inFlight && definiteDowngrade
    ? {code:"IN_FLIGHT_QUALITY_QUARANTINE",reason:proof.code,atMs:Date.now(),turn:process.turn} : null);
  const holdReconciliation = reconcileSafetyHoldWithFreshProof(prior, proof, qualityIncident);
  const next = {
    ...prior,
    proof,
    evidence:page.modelEvidence,
    qualityIncident,
    hold:holdReconciliation.hold,
    lastObservationAtMs:Date.now()
  };
  const changed = prior.proof?.code !== proof.code || prior.proof?.model !== proof.model || prior.proof?.effort !== proof.effort ||
    JSON.stringify(prior.qualityIncident) !== JSON.stringify(qualityIncident) ||
    holdReconciliation.cleared ||
    process.lastManagedUrl !== page.url ||
    Date.now()-Number(prior.persistedObservationAtMs || 0)>30000;
  process.safety = next;
  // Only positively bound EIC URLs replace the durable recovery address.
  if (classifyManagedEicSurface(page.url,process.gptRoot).ok) process.lastManagedUrl = page.url;
  if (changed) {
    process.safety.persistedObservationAtMs=Date.now();
    await saveProcess(process);
    if (holdReconciliation.cleared) {
      await audit(process, "SAFETY_HOLD_CLEARED_BY_FRESH_PROOF", "safety", {
        priorHoldCode: holdReconciliation.clearedCode,
        proofCode: proof.code || "",
        proofAllowed: proof.allowed === true
      }).catch(()=>undefined);
    }
  }
  return proof;
}

async function holdForSafety(process, decision) {
  const now=Date.now();
  const code=decision?.code || "SAFETY_UNVERIFIED";
  const prior=process.safety?.hold;
  const retryAtMs=Math.max(now+30000,Number(decision?.retryAtMs || 0));
  process.safety={...process.safety,hold:{code,sinceMs:prior?.code===code?prior.sinceMs:now,retryAtMs,detail:decision?.detail || ""}};
  if (!prior || prior.code!==code || now-Number(prior.savedAtMs||0)>30000) {
    process.safety.hold.savedAtMs=now;
    await saveProcess(process);
    await audit(process,"SAFETY_HOLD","safety",process.safety.hold).catch(()=>undefined);
  }
  // An unresolved side effect keeps its turn ownership. Only unsent work may
  // relinquish a scheduler slot while it waits for a model/budget.
  if (process.phase === PHASES.SENDING && (!process.pendingPrompt?.dispatch || process.pendingPrompt.dispatch.effectPossible===false)) {
    await releaseSchedulerTurn(process,{promptHash:process.pendingPrompt?.hash || "",reason:code}).catch(()=>undefined);
    if (process.pendingPrompt?.promptPause?.reservationId) await releaseGlobalPromptLease({reservationId:process.pendingPrompt.promptPause.reservationId}).catch(()=>undefined);
  }
  await broadcast(process,"safety-hold");
  scheduleFast(process.processId,Math.min(30000,retryAtMs-now));
  return process;
}

async function sendingSafetyDecision(process,page,pending) {
  if (process.storageRecoveryRequired) return {allowed:false,code:"STORAGE_RECOVERY_REQUIRES_REVIEW"};
  if (process.safety?.qualityIncident) return {allowed:false,code:process.safety.qualityIncident.code};
  await maintainLocalStorage("before-send");
  const v=await readSafety();
  const proof=Safety.evaluateModel(page.modelEvidence,v.policy,{url:page.url,gptRoot:process.gptRoot});
  if (!proof.allowed) return proof;
  if (!page.composerEmpty && page.composerTextHash !== await sha256Hex(pending.text)) return {allowed:false,code:"OPERATOR_DRAFT_PRESENT"};
  return budgetDecision(v,usageIdentity(process,pending),pending.text);
}

async function recordDispatchMaterialization(message, sender) {
  const tab = sender?.tab;
  if (!tab || sender.id !== chrome.runtime.id ||
      !Number.isInteger(tab.windowId) || !Number.isInteger(tab.id)) {
    return { ok:false, code:"DISPATCH_MATERIALIZATION_OWNER_UNVERIFIED" };
  }

  const current = await loadProcessForWindow(tab.windowId);
  const dispatch = current?.pendingPrompt?.dispatch;
  const receipt = message?.receipt && typeof message.receipt === "object" ? message.receipt : null;
  const userTurnId = String(receipt?.userTurnId || "");
  const userTurnIndex = Number(receipt?.userTurnIndex);
  const receiptUserCount = Number(receipt?.userCount);
  const baselineUserCount = Number(dispatch?.baselineUserCount);

  if (!current || current.phase !== PHASES.SENDING || current.tabId !== tab.id ||
      !dispatch || String(dispatch.operationId || "") !== String(message.dispatchId || "") ||
      String(current.pendingPrompt?.hash || "") !== String(message.promptHash || "") ||
      !userTurnId || !Number.isInteger(userTurnIndex) || userTurnIndex < 0 ||
      !Number.isInteger(receiptUserCount) || receiptUserCount !== userTurnIndex + 1) {
    return { ok:false, code:"DISPATCH_MATERIALIZATION_TARGET_MISMATCH" };
  }

  if (dispatch.baselineDocumentId &&
      String(message.documentId || "") !== String(dispatch.baselineDocumentId)) {
    return { ok:false, code:"DISPATCH_MATERIALIZATION_DOCUMENT_MISMATCH" };
  }

  if (Number.isInteger(baselineUserCount) && baselineUserCount >= 0 &&
      userTurnIndex !== baselineUserCount) {
    return { ok:false, code:"DISPATCH_MATERIALIZATION_ORDINAL_MISMATCH" };
  }

  if (dispatch.materializedUserTurnId &&
      dispatch.materializedUserTurnId !== userTurnId) {
    return { ok:false, code:"DISPATCH_MATERIALIZATION_ID_CONFLICT" };
  }

  const updated = {
    ...current,
    pendingPrompt: {
      ...current.pendingPrompt,
      dispatch: {
        ...dispatch,
        status: "ACKNOWLEDGED",
        effectPossible: true,
        acknowledged: true,
        acknowledgementEvidence: String(message.evidence || "USER_TURN_MATERIALIZED"),
        materializedUserTurnId: userTurnId,
        materializedUserTurnIndex: userTurnIndex,
        materializationReceiptAt: nowIso()
      }
    },
    updatedAt: nowIso()
  };
  await saveProcess(updated);
  await audit(updated, "PROMPT_DISPATCH_MATERIALIZATION_RECEIPT", "prompt", {
    dispatchId: dispatch.operationId,
    promptHash: current.pendingPrompt.hash,
    documentId: message.documentId || "",
    userTurnId,
    userTurnIndex,
    userCount: receiptUserCount,
    userTextHash: String(receipt?.userTextHash || ""),
    evidence: String(message.evidence || "")
  }, dispatch.operationId).catch(() => undefined);
  scheduleFast(updated.processId, 50);
  return { ok:true, userTurnId, userTurnIndex };
}

async function authorizeDispatch(message,sender) {
  const tab=sender?.tab;
  if (!tab || sender.id!==chrome.runtime.id) return {ok:false,code:"DISPATCH_OWNER_UNVERIFIED"};
  const process=await loadProcessForWindow(tab.windowId);
  const dispatch=process?.pendingPrompt?.dispatch;
  if (runtimeFault || !process || process.phase!==PHASES.SENDING || process.tabId!==tab.id || dispatch?.operationId!==message.dispatchId || process.pendingPrompt.hash!==message.promptHash || process.safety?.qualityIncident || process.storageRecoveryRequired) return {ok:false,code:"DISPATCH_OWNER_UNVERIFIED"};
  await maintainLocalStorage("dispatch-authorization");
  const v=await readSafety();
  if (v.admissionPaused || v.providerHold) return {ok:false,code:v.admissionPaused?"ADMISSION_PAUSED":"PROVIDER_QUOTA_HOLD"};
  const identity=usageIdentity(process,process.pendingPrompt);
  if (!v.entries.some(e=>e.id===identity) || !process.safety?.turnProof?.allowed || process.safety.turnProof.promptHash!==message.promptHash) return {ok:false,code:"DISPATCH_AUTHORIZATION_MISSING"};
  const admission=await authorizeUsageSend(identity,message.dispatchId);
  if (!admission.allowed) return {ok:false,code:admission.code};
  return {ok:true,policy:admission.policy,gptRoot:process.gptRoot};
}

async function hydrateProcesses(reason) {
  if (hydrationInFlight) return hydrationInFlight;
  hydrationInFlight=(async()=>{
    try {
      storageContractProof ||= await probeStorageContract(chrome.storage.local);
      const repaired=await recoverRc1Checkpoints(chrome.storage.local);
      await readSafety();
      const report=await reconcileRestart({local:chrome.storage.local,session:chrome.storage.session,tabs:chrome.tabs,ensureBridge:ensureContentBridgeVersion});
      restartReport={...report,checkpointRepairs:[...(restartReport.checkpointRepairs||[]),...repaired].slice(-30),restored:[...restartReport.restored,...report.restored].slice(-30)};
      if (report.errors.length) throw new Error(`RECOVERY_INVENTORY_ERRORS:${report.errors.map(e=>e.code).join("; ")}`);
      await hydrateBoundProcesses(reason);
      const processes=await loadAllProcesses();
      for (const process of processes) {
        const queue=await loadMissionWorkQueue(process.windowId,chrome.storage.local,{workerId:process.workerId});
        await syncMissionQueueWakeAlarm(queue);
        if (queue.enabled && TERMINAL_PHASES.has(process.phase)) await wakeMissionQueue(process.windowId,"RESTART_QUEUE_RECONCILE");
      }
      await maintainLocalStorage(reason || "recovery-scan");
      runtimeFault="";
    } catch(error) {
      runtimeFault=String(error?.message || error);
      restartReport={...restartReport,atMs:Date.now(),errors:[...restartReport.errors,{code:runtimeFault}].slice(-20)};
    }
    await chrome.alarms.create(RECOVERY_SCAN_ALARM,{periodInMinutes:1});
    return restartReport;
  })();
  try { return await hydrationInFlight; } finally { hydrationInFlight=null; }
}

async function panelSafetyAction(message,sender) {
  if (sender?.id!==chrome.runtime.id || sender?.tab || sender?.url!==chrome.runtime.getURL("sidepanel.html")) throw new Error("SAFETY_PANEL_SENDER_REQUIRED");
  await runtimeReady;
  if (message.type==="EIC_GF_EXPORT_DIAGNOSTICS") {
    let modelInspection=null;
    try {
      const [tab]=await chrome.tabs.query({windowId:message.windowId,active:true});
      if(tab?.id && supportedUrl(tab.url)) {
        await ensureContentBridgeVersion(tab.id);
        const observation=await chrome.tabs.sendMessage(tab.id,{type:"EIC_GF_GET_PAGE_STATE"});
        if(observation?.ok)modelInspection={url:observation.state.url,evidence:observation.state.modelEvidence};
      }
    }catch(error){modelInspection={error:String(error.message)};}
    return {ok:true,diagnostics:await createStartupDiagnostics(chrome.storage.local,{version:APP_VERSION,runtimeFault,recovery:restartReport,storageContract:storageContractProof,modelInspection})};
  }
  if (message.type==="EIC_GF_EXPORT_RECOVERY") {
    await pauseAdmission(true).catch(()=>undefined); // Damaged storage must remain exportable for diagnosis.
    return {ok:true,backup:await createOperatorBackup(chrome.storage.local,{version:APP_VERSION,extensionId:chrome.runtime.id})};
  }
  if (message.type==="EIC_GF_IMPORT_RECOVERY") {
    const restored=await restoreOperatorBackup(typeof message.backupJson==="string" ? JSON.parse(message.backupJson) : message.backup,chrome.storage.local,{bookmarks:chrome.bookmarks || null});
    await hydrateProcesses();
    return {ok:true,restored,fleetStatus:await fleetStatusSnapshot()};
  }
  if (message.type==="EIC_GF_SAFETY_INSPECT") {
    const [tab]=await chrome.tabs.query({windowId:message.windowId,active:true});
    if (!tab?.id || !supportedUrl(tab.url)) throw new Error("EIC_SURFACE_UNVERIFIED");
    await ensureContentBridgeVersion(tab.id);
    const response=await chrome.tabs.sendMessage(tab.id,{type:"EIC_GF_GET_PAGE_STATE"});
    if (!response?.ok) throw new Error("MODEL_EVIDENCE_MISSING");
    const root=(await readEicSurfaceState()).lastKnownGoodEicUrl || deriveGptRoot(tab.url);
    const inspection=Safety.evaluateModel(response.state.modelEvidence,(await readSafety()).policy,{url:response.state.url,gptRoot:root});
    return {ok:true,inspection};
  }
  if (message.type==="EIC_GF_SAFETY_UPDATE") await updateSafetyPolicy(message.policy || {});
  if (message.type==="EIC_GF_SAFETY_PAUSE") await pauseAdmission(message.paused===true);
  if (message.type==="EIC_GF_RECOVERY_SCAN") await hydrateProcesses("operator-recovery-scan");
  if (message.type==="EIC_GF_SAFETY_RECHECK") {
    const processes=(await loadAllProcesses()).filter(p=>!TERMINAL_PHASES.has(p.phase));
    if(!processes.length) {
      const result=await panelSafetyAction({...message,type:"EIC_GF_SAFETY_INSPECT"},sender);
      if(result.inspection?.allowed)await probeProviderRecovery(result.inspection,chrome.storage.local,{operator:true});
      return {...result,fleetStatus:await fleetStatusSnapshot()};
    }
    const proofs=[];
    for (const p of processes) {
      await queues.enqueue(p.processId,async()=>{
        const process=await findProcessById(p.processId);
        const page=await tabState(process,"operator-model-recheck");
        proofs.push(Safety.evaluateModel(page.modelEvidence,(await readSafety()).policy,{url:page.url,gptRoot:process.gptRoot}));
      });
    }
    if (!proofs.length || proofs.some(p=>!p.allowed)) return {ok:false,code:"NO_FRESH_APPROVED_MODEL_UI"};
    await probeProviderRecovery(proofs[0],chrome.storage.local,{operator:true});
    for (const p of processes) await queues.enqueue(p.processId,async()=>{
      const current=await findProcessById(p.processId);
      if (!current.safety?.qualityIncident && !current.storageRecoveryRequired) {
        current.safety={...current.safety,hold:null};
        await saveProcess(current);
        scheduleFast(current.processId,100);
      }
    });
  }

  const processes=await loadAllProcesses();
  if ((message.type==="EIC_GF_SAFETY_PAUSE" && message.paused===false) || message.type==="EIC_GF_SAFETY_UPDATE") {
    for (const process of processes) if (process.safety?.hold && !process.safety?.qualityIncident) {
      await queues.enqueue(process.processId,async()=>{
        const current=await findProcessById(process.processId);
        current.safety={...current.safety,hold:null};
        await saveProcess(current);
      });
    }
  }
  for (const process of processes) if (!TERMINAL_PHASES.has(process.phase)) scheduleFast(process.processId,100);
  return {ok:true,fleetStatus:await fleetStatusSnapshot()};
}

async function hydrateBoundProcesses(reason) {
  const processes = await loadAllProcesses();
  const migrated = await Promise.all(processes.map(async (process) => {
    if (TERMINAL_PHASES.has(process.phase)) return process;
    let current = process;

    // Upgrade fence: a v1.0.1 SENDING record with prior sendAttempts but no
    // exact-once dispatch receipt is effect-ambiguous. Never resend it on upgrade.
    if (current.phase === PHASES.SENDING &&
        Number(current.pendingPrompt?.sendAttempts || 0) > 0 &&
        !current.pendingPrompt?.dispatch) {
      current = {
        ...current,
        version: APP_VERSION,
        schedulerPriority: normalizeGreenfieldPriority(
          current.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY
        ),
        pendingPrompt: {
          ...current.pendingPrompt,
          dispatch: {
            operationId: randomId("migrated-send"),
            status: "MIGRATED_EFFECT_UNKNOWN",
            startedAt: current.pendingPrompt?.createdAt || current.updatedAt || nowIso(),
            effectPossible: true,
            acknowledged: false,
            acknowledgementEvidence: "V1_0_1_AMBIGUOUS_SEND_MIGRATION",
            method: "unknown",
            baselineUserCount: null,
            baselineAssistantCount: null,
            baselineAssistantHash: current.pendingPrompt?.baselineAssistantHash || ""
          }
        },
        updatedAt: nowIso()
      };
      await saveProcess(current);
      await audit(current, "V1_0_1_SEND_STATE_MIGRATED_EXACT_ONCE", "migration", {
        priorSendAttempts: process.pendingPrompt?.sendAttempts || 0,
        automaticResend: false
      }).catch(() => undefined);
    } else if (current.version !== APP_VERSION || !current.schedulerPriority) {
      current = {
        ...current,
        version: APP_VERSION,
        schedulerPriority: normalizeGreenfieldPriority(
          current.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY
        ),
        updatedAt: nowIso()
      };
      await saveProcess(current);
      await audit(current, "PROCESS_VERSION_MIGRATED", "migration", {
        fromVersion: process.version || "",
        toVersion: APP_VERSION,
        schedulerPriority: current.schedulerPriority
      }).catch(() => undefined);
    }
    return current;
  }));

  // Reconstruct global active-turn ownership before any hydrated process is
  // allowed to tick. This preserves capacity across MV3 service-worker restarts.
  const schedulerReconcile = await reconcileSchedulerAfterHydration(migrated);

  await Promise.all(migrated.map(async (current) => {
    if (!current || TERMINAL_PHASES.has(current.phase)) return;
    await setWatchdog(current);
    const queueState = await loadMissionWorkQueue(current.windowId,chrome.storage.local,{workerId:current.workerId});
    await syncMissionQueueWakeAlarm(queueState);
    try {
      await syncMissionPauseAlarm(current);
    } catch (error) {
      await audit(current, "MISSION_PAUSE_ALARM_SYNC_FAILED", "mission-pause", {
        error: errorRecord(error),
        fallback: current.phase === PHASES.PAUSED ? "WATCHDOG" : "NONE",
        reason: "RUNTIME_REHYDRATE"
      }).catch(() => undefined);
      if (current.phase === PHASES.PAUSED) {
        await chrome.alarms.create(alarmName(current.processId), {
          periodInMinutes: WATCHDOG_MINUTES
        }).catch(() => undefined);
      }
    }
    if (current.phase !== PHASES.PAUSED) scheduleFast(current.processId, 100);
    await audit(current, "RUNTIME_REHYDRATED", "runtime", {
      reason,
      phase: current.phase,
      appVersion: APP_VERSION,
      schedulerReconciled: Boolean(schedulerReconcile),
      schedulerPriority: normalizeGreenfieldPriority(
        current.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY
      )
    }).catch(() => undefined);
    await syncOverlay(current, "rehydrated");
  }));
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === RECOVERY_SCAN_ALARM) { void hydrateProcesses("recovery-scan"); return; }
  if (alarm?.name?.startsWith(MISSION_QUEUE_WAKE_PREFIX)) {
    const target = parseMissionQueueWakeAlarmName(alarm.name);
    if (target) {
      void (async () => {
        const matches = await workerBindingMatches(
          target.windowId,
          target.workerId,
          chrome.storage.session
        ).catch(() => false);
        if (!matches) return;
        await wakeMissionQueue(target.windowId, "QUEUE_WAKE_ALARM");
      })();
    }
    return;
  }
  if (alarm?.name?.startsWith(MISSION_PAUSE_PREFIX)) {
    const processId = alarm.name.slice(MISSION_PAUSE_PREFIX.length);
    void enqueueTick(processId, "mission-pause-wake");
    return;
  }
  if (!alarm?.name?.startsWith(WATCH_PREFIX)) return;
  const processId = alarm.name.slice(WATCH_PREFIX.length);
  void enqueueTick(processId, "watchdog");
});

async function enforceManagedEicSurface(process, tab) {
  if (!process || !tab || !Number.isInteger(tab.id)) return { action: "SKIP" };
  const globalState = await readEicSurfaceState(chrome.storage.local).catch(() => ({ lastKnownGoodEicUrl: "" }));
  const key = process.processId;
  const priorSince = Number(eicSurfaceWrongSince.get(key) || 0);
  const decision = recoveryDecision({
    observedUrl: tab.url || "",
    processRoot: process.gptRoot || "",
    globalRoot: globalState.lastKnownGoodEicUrl || "",
    wrongSinceMs: priorSince,
    now: Date.now()
  });
  if (decision.action === "ACCEPT") {
    eicSurfaceWrongSince.delete(key);
    await rememberGoodEicUrl(decision.expectedRoot, chrome.storage.local).catch(() => undefined);
    if (process.gptRoot !== decision.expectedRoot) {
      process = { ...process, gptRoot: decision.expectedRoot, updatedAt: nowIso() };
      await saveProcess(process);
    }
    return decision;
  }
  if (!priorSince) eicSurfaceWrongSince.set(key, decision.wrongSinceMs || Date.now());
  if (decision.action === "RECOVER") {
    await audit(process, "EIC_SURFACE_RECOVERY_TRIGGERED", "surface-guard", {
      observedUrl: tab.url || "",
      classification: decision.classification,
      recoveryUrl: decision.expectedRoot,
      graceMs: 10000
    }).catch(() => undefined);
    await chrome.tabs.update(tab.id, { url: decision.expectedRoot });
    eicSurfaceWrongSince.delete(key);
    scheduleFast(process.processId, 1200);
  } else if (decision.action === "NO_KNOWN_EIC_URL") {
    await audit(process, "EIC_SURFACE_RECOVERY_UNAVAILABLE", "surface-guard", {
      observedUrl: tab.url || "",
      classification: decision.classification,
      reason: "NO_LAST_KNOWN_EIC_URL"
    }).catch(() => undefined);
  }
  return decision;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!["loading", "complete"].includes(changeInfo.status)) return;
  void (async () => {
    const process = await loadProcessForWindow(tab.windowId);
    if (!process || process.tabId !== tabId || TERMINAL_PHASES.has(process.phase)) return;
    if (changeInfo.status === "complete") {
      const surface = await enforceManagedEicSurface(process, tab).catch(() => null);
      if (surface?.action === "RECOVER" || surface?.action === "GRACE") {
        if (surface.action === "GRACE") scheduleFast(process.processId, 10000);
        return;
      }
    }
    await audit(process, "MANAGED_TAB_UPDATED", "chrome", {
      status: changeInfo.status,
      url: tab.url || ""
    }).catch(() => undefined);
    scheduleFast(process.processId, changeInfo.status === "complete" ? 300 : 1500);
  })();
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  void (async () => {
    const process = await loadProcessForWindow(removeInfo.windowId);
    if (!process || process.tabId !== tabId || TERMINAL_PHASES.has(process.phase)) return;
    await queues.enqueue(process.processId, async () => {
      const current = await findProcessById(process.processId);
      if (!current || current.tabId !== tabId || TERMINAL_PHASES.has(current.phase)) return;
      const error = Object.assign(new Error("MANAGED_TAB_CLOSED"), { code: "MANAGED_TAB_CLOSED" });
      await cancelSchedulerProcess(current, "MANAGED_TAB_CLOSED").catch(() => undefined);
      await handleDetached(current, error);
    });
  })();
});

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    const binding = await getWorkerBinding(windowId, chrome.storage.session).catch(() => null);
    try {
      const process = await loadProcessForWindow(windowId);
      if (!process || TERMINAL_PHASES.has(process.phase)) return;
      await queues.enqueue(process.processId, async () => {
        const current = await findProcessById(process.processId);
        if (!current || TERMINAL_PHASES.has(current.phase)) return;
        await cancelSchedulerProcess(current, "MANAGED_WINDOW_CLOSED").catch(() => undefined);
        const error = Object.assign(new Error("MANAGED_WINDOW_CLOSED"), { code: "MANAGED_WINDOW_CLOSED" });
        await handleDetached(current, error);
        await audit(current, "MANAGED_WINDOW_CLOSED", "chrome", {
          windowId,
          continuity: "WORKER_DETACHED_QUEUE_QUARANTINED_NO_IMPLICIT_REBIND"
        }).catch(() => undefined);
      });
    } finally {
      if (binding?.workerId) {
        await chrome.alarms.clear(
          missionQueueWakeAlarmName(windowId, binding.workerId)
        ).catch(() => undefined);
      }
      await releaseWorkerBinding(windowId, chrome.storage.session).catch(() => undefined);
    }
  })();
});

async function withVerifiedWorkerMessage(message, sender, work) {
  const senderWindowId = Number.isInteger(sender?.tab?.windowId) ? sender.tab.windowId : null;
  const messageWindowId = Number.isInteger(message?.windowId) ? message.windowId : null;
  if (senderWindowId != null && messageWindowId != null && senderWindowId !== messageWindowId) {
    const error = new Error("WORKER_WINDOW_BINDING_MISMATCH");
    error.code = "WORKER_WINDOW_BINDING_MISMATCH";
    throw error;
  }
  const windowId = senderWindowId ?? messageWindowId;
  if (!Number.isInteger(windowId)) {
    const error = new Error("WINDOW_ID_REQUIRED");
    error.code = "WINDOW_ID_REQUIRED";
    throw error;
  }
  const binding = await ensureWorkerBinding(windowId, chrome.storage.session);
  const suppliedWorkerId = String(message?.workerId || "").trim();
  if (!suppliedWorkerId || suppliedWorkerId !== binding.workerId) {
    const error = new Error("WORKER_BINDING_MISMATCH");
    error.code = "WORKER_BINDING_MISMATCH";
    throw error;
  }
  return work({ ...message, windowId, workerId: binding.workerId });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "EIC_GF_OBSERVATION_DIRTY") {
    const tab = sender.tab;
    if (!tab || !Number.isInteger(tab.windowId) || !Number.isInteger(tab.id)) return false;
    void (async () => {
      const process = await loadProcessForWindow(tab.windowId);
      if (!process || process.tabId !== tab.id || TERMINAL_PHASES.has(process.phase)) return;
      scheduleFast(process.processId, 120);
    })();
    return false;
  }

  const respond = (work) => {
    Promise.resolve(work)
      .then((value) => sendResponse(value))
      .catch(async (error) => {
        try {
          const windowId = Number.isInteger(message.windowId)
            ? message.windowId
            : (Number.isInteger(sender?.tab?.windowId) ? sender.tab.windowId : null);
          const process = Number.isInteger(windowId) ? await loadProcessForWindow(windowId) : null;
          if (process) {
            await appendAuditError({
              error,
              process,
              kind: "RUNTIME_MESSAGE_HANDLER_ERROR",
              component: "background",
              payload: { messageType: message.type }
            });
          } else {
            await appendAuditError({
              error,
              scope: Number.isInteger(windowId) ? "WINDOW" : "APP",
              auditSessionId: message.auditSessionId || BACKGROUND_AUDIT_SESSION_ID,
              windowId,
              kind: "RUNTIME_MESSAGE_HANDLER_ERROR",
              component: "background",
              payload: { messageType: message.type }
            });
          }
        } catch {}
        sendResponse({
          ok: false,
          error: error?.message || String(error),
          code: error?.code || error?.name || "ERROR"
        });
      });
    return true;
  };

  switch (message.type) {
    case "EIC_GF_AUTHORIZE_DISPATCH":
      return respond(authorizeDispatch(message,sender));
    case "EIC_GF_DISPATCH_MATERIALIZED":
      return respond(recordDispatchMaterialization(message,sender));
    case "EIC_GF_SAFETY_INSPECT":
      return respond(panelSafetyAction(message,sender));
    case "EIC_GF_SAFETY_UPDATE":
      return respond(panelSafetyAction(message,sender));
    case "EIC_GF_SAFETY_PAUSE":
      return respond(panelSafetyAction(message,sender));
    case "EIC_GF_SAFETY_RECHECK":
      return respond(panelSafetyAction(message,sender));
    case "EIC_GF_RECOVERY_SCAN":
      return respond(panelSafetyAction(message,sender));
    case "EIC_GF_EXPORT_RECOVERY":
      return respond(panelSafetyAction(message,sender));
    case "EIC_GF_EXPORT_DIAGNOSTICS":
      return respond(panelSafetyAction(message,sender));
    case "EIC_GF_IMPORT_RECOVERY":
      return respond(panelSafetyAction(message,sender));
    case "EIC_GF_FORENSIC_EVENT":
      return respond(recordForensicMessage(message, sender));
    case "EIC_GF_CONTENT_READY":
      return respond(contentReady(sender));
    case "EIC_GF_START":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => startRun(bound)));
    case "EIC_GF_QUEUE_START":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => startMissionQueue(bound)));
    case "EIC_GF_QUEUE_STOP":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => stopMissionQueue(bound)));
    case "EIC_GF_QUEUE_MUTATE":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => updateQueueFromUi(bound)));
    case "EIC_GF_QUEUE_SET_MUTATE":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => mutateMissionQueueSet(bound)));
    case "EIC_GF_STOP":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => stopRun(bound)));
    case "EIC_GF_GET_SNAPSHOT":
      return respond(snapshotForWindow(message.windowId));
    case "EIC_GF_SET_NEXT_INSTRUCTION":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => setNextInstruction(bound)));
    case "EIC_GF_UI_EVENT":
      return respond(auditUiEvent(
        message.windowId,
        message.kind || "UI_EVENT",
        message.payload || {},
        message.auditSessionId || "",
        message.component || "ui",
        message.severity || "INFO"
      ));
    case "EIC_GF_SET_AUDIT_ENABLED":
      return respond(setAuditEnabled(message.windowId, message.enabled === true, message.auditSessionId || ""));
    case "EIC_GF_RESUME_PAUSE_NOW":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => resumePausedRun({
        windowId: bound.windowId,
        reason: bound.reason || "OPERATOR_RESUME_NOW"
      })));
    case "EIC_GF_SET_SCHEDULER_PRIORITY":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => setSchedulerPriority({
        windowId: bound.windowId,
        priority: bound.priority
      })));
    case "EIC_GF_SET_MAX_ACTIVE_SESSIONS":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => setMaxActiveSessions({
        windowId: bound.windowId,
        maxActiveSessions: bound.maxActiveSessions
      })));
    case "EIC_GF_SET_WORK_MODE":
      return respond(withVerifiedWorkerMessage(message, sender, async (bound) => {
        const settings = await saveOperatorSettings({
          workModeEnabled: bound.enabled === true,
          workModeSupervisorWorkerId: bound.enabled === true ? bound.workerId : "",
          workModeEndpoint: bound.endpoint
        }, chrome.storage.local, { restoreSavedMissions: false, bookmarks: null });
        return { ok: true, operatorSettings: settings };
      }));
    case "EIC_GF_WORK_MODE_SYNC":
      return respond(withVerifiedWorkerMessage(message, sender, async (bound) => {
        const process = await loadProcessForWindow(bound.windowId);
        if (!process) return { ok: false, code: "NO_ACTIVE_PROCESS" };
        return syncWorkModeForWorker(process, { force: true });
      }));
    case "EIC_GF_SET_QUEUE_SETTINGS":
      return respond(withVerifiedWorkerMessage(message, sender, async (bound) => {
        const settings = await saveOperatorSettings({
          defaultMissionQuantumInteractions: bound.defaultMissionQuantumInteractions,
          queuePriorityAgingSeconds: bound.queuePriorityAgingSeconds,
          queueSwitchHardReload: bound.queueSwitchHardReload === true,
          queueSwitchDelaySeconds: bound.queueSwitchDelaySeconds,
          queueSwitchSettleSeconds: bound.queueSwitchSettleSeconds
        }, chrome.storage.local, { restoreSavedMissions: false, bookmarks: null });
        return { ok: true, operatorSettings: settings };
      }));
    case "EIC_GF_FORCE_TICK":
      return respond(withVerifiedWorkerMessage(message, sender, async (bound) => {
        const process = await loadProcessForWindow(bound.windowId);
        if (!process) return { ok: true, process: null };
        const next = await enqueueTick(process.processId, "ui-force-tick");
        return { ok: true, process: publicSnapshot(next) };
      }));
    default:
      return false;
  }
});

globalThis.addEventListener?.("error", (event) => {
  void appendAuditError({
    error: event?.error || new Error(event?.message || "Background error"),
    scope: "APP",
    auditSessionId: BACKGROUND_AUDIT_SESSION_ID,
    kind: "BACKGROUND_UNHANDLED_ERROR",
    component: "background"
  }).catch(() => undefined);
});

globalThis.addEventListener?.("unhandledrejection", (event) => {
  void appendAuditError({
    error: event?.reason || new Error("Background unhandled rejection"),
    scope: "APP",
    auditSessionId: BACKGROUND_AUDIT_SESSION_ID,
    kind: "BACKGROUND_UNHANDLED_REJECTION",
    component: "background"
  }).catch(() => undefined);
});

void appendAudit({
  scope: "APP",
  auditSessionId: BACKGROUND_AUDIT_SESSION_ID,
  kind: "BACKGROUND_EVALUATED",
  component: "background",
  payload: { appVersion: APP_VERSION }
}).catch(() => undefined);

const runtimeReady = hydrateProcesses("service-worker-evaluation");
