import "./lib/safety-policy.js";
import { readSafety, usageSummary, budgetDecision, reserveUsage, authorizeUsageSend, recordUsageOutput, usageIdentity, observeProviderQuota, probeProviderRecovery, updateSafetyPolicy, pauseAdmission, adoptSafetyPolicyFromVault, equalSafetyPolicy } from "./lib/usage-governor.mjs";
import { loadSafetyPolicyVault, writeSafetyPolicyVault, safetyPolicyVaultPlan, SAFETY_POLICY_VAULT_FOLDER, loadDriftSettingsVault, writeDriftSettingsVault } from "./lib/safety-policy-vault.mjs";
import { conversationKey, legacyAdvisoryBlockedCandidate, legacyRotationBlockedCandidate, reconcileRestart } from "./lib/restart-recovery.mjs";
import { nextInteractionAfterResponse } from "./lib/interaction-slicing.mjs";
import { createAnalysisBudget } from "./lib/analysis-deadline.mjs";
import { windowQueueOverview } from "./lib/window-queue-overview.mjs";
import { conversationRecoveryUrl, shouldRememberManagedUrl, expectedThreadMissing } from "./lib/conversation-recovery.mjs";
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
// v1.9.1: run requirements (Körkrav) also live in the Chrome profile bookmark
// store, so a new extension id (a release loaded from a new folder) restores
// them instead of starting from the defaults. Synced once per service worker
// lifetime; a vault failure never blocks startup or the local save.
let safetyVaultStatus = {state:"NOT_CHECKED",atMs:0,folder:SAFETY_POLICY_VAULT_FOLDER};
let safetyVaultSynced = false;
const SAFETY_VAULT_TIMEOUT_MS = 8000;
// The recovery alarm wakes the worker every minute; a settled result is kept
// for the browser session (chrome.storage.session is cleared on browser
// restart and on "Läs in igen"), so the bookmark tree is read once per session.
const SAFETY_VAULT_SESSION_KEY = "eic.gf.safety-vault-status.v1";
const SAFETY_VAULT_SETTLED = new Set(["RESTORED","SAVED","IN_SYNC","EMPTY"]);
// v1.9.2: the Drift settings (operator-settings.mjs DRIFT_SETTINGS_KEYS) are a
// second, independent section of the same vault, with its own status.
let driftVaultStatus = {state:"NOT_CHECKED",atMs:0,folder:SAFETY_POLICY_VAULT_FOLDER};
const DRIFT_VAULT_SESSION_KEY = "eic.gf.drift-vault-status.v1";
let driftVaultQueue = Promise.resolve();
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
import { composeA2APrompt, initialMissionObjective, validateA2AEnvelope } from "./lib/a2a.mjs";
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
import { appendIncident } from "./lib/incident-log.mjs";
import { queueBoundaryAnalysisDecision, queueBoundaryControl, runtimeControlRequestsCompletion } from "./lib/queue-boundary.mjs";
import { warmResumeDecision, warmResumeObjective, warmResumePageVerdict } from "./lib/warm-resume.mjs";
import { workModeStartupPatch, workModeSupervisorDecision } from "./lib/work-mode-supervisor.mjs";
import { applyGreenfieldControlToDecision, eicHandoffWithoutNanoTask, resolveGreenfieldControl } from "./lib/greenfield-control.mjs";
import { advanceNoDeltaState } from "./lib/no-delta.mjs";
import {
  autonomousResponseObservation,
  autonomousUserTurnProof,
  expectedAutonomousUserTurn,
  expectedPromptMarker,
  externalAssistantInterleaveEvidence,
  promptCausalMarker
} from "./lib/turn-causality.mjs";
import {
  SESSION_INITIALIZATION, DELIVERY_CONTINUATION, DELIVERY_CONTINUATION_MAX_ATTEMPTS,
  DELIVERY_NOTICE_SETTLE_MS, isInitializationPrompt, isTransportPrompt,
  waitingForInitialization, workPromptHash, prepareSessionInitialization,
  deliveryContinuationEligibility, deliveryRetryForPrompt, prepareDeliveryContinuation,
  deliveryFencePage
} from "./lib/session-transport.mjs";
import {
  hasCurrentGenerationEvidence,
  providerTransportPending,
  WAITING_GENERATION_LIMIT_MS,
  createWaitingRefreshState,
  evaluateWaitingRefresh,
  resetWaitingRefreshOnAssistantResponse,
  staleTurnCapacityDecision,
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
  saveOperatorSettings,
  reconcileLocalDriftSettings,
  normalizeDriftVaultSettings
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
  canonicalGptRoot,
  classifyManagedEicSurface,
  customGptRoot,
  gptSlug,
  preferNamedRoot,
  readEicSurfaceState,
  rememberGoodEicUrl,
  recoveryDecision,
  resolveManagedGptRoot,
  sameGpt
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
  MAX_QUEUE_ITEMS,
  MAX_QUEUE_HISTORY,
  DEFAULT_QUEUE_PRIORITY_AGING_SECONDS,
  DEFAULT_QUEUE_SWITCH_HARD_RELOAD,
  DEFAULT_QUEUE_SWITCH_DELAY_SECONDS,
  DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS,
  DEFAULT_WARM_QUEUE_RESUME,
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
  selectNextMissionItem as selectNextMissionItemUnchecked,
  updateMissionWorkItem
} from "./lib/mission-work-queue.mjs";
import {
  activatedQueueSlotTelemetry,
  applyQueueParkTransition,
  latestResponseRoundTripMs,
  retireLogicalMissionSlots
} from "./lib/queue-planning.mjs";
import {
  TAB_CONDITION,
  TAB_HEALTH,
  TAB_RECOVERY_STEP,
  advanceTabHealth,
  conditionFromBridgeError,
  pageConditionFromHealth,
  tabHealthStatusSv
} from "./lib/tab-health.mjs";
import {
  PROVIDER_BLOCK,
  providerBlockObjective,
  providerNoticeBlocks,
  recordProviderBlock
} from "./lib/provider-notice.mjs";
import {
  appendResponseTrace,
  responseStructuralCompleteness,
  responseTraceDetail
} from "./lib/response-observation.mjs";
import {
  SCHEDULE_BLOCK,
  nextScheduleOpenAtMs,
  normalizeQueueSchedule,
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
  reconcileMissionQueueSetsWithSavedMissions,
  saveMissionQueueSet
} from "./lib/mission-queue-sets.mjs";
import {
  reconcileItemsWithSavedMissions,
  resolveSavedMissionReference,
  savedMissionKey
} from "./lib/saved-mission-catalog.mjs";
import {
  completeSessionHealthTurn,
  markSessionHealthFirstResponse,
  markSessionHealthPromptPosted,
  markSessionHealthProviderNotice,
  markSessionHealthRecovery,
  PROVIDER_NOTICE_KINDS,
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
  MAX_MISSION_DELEGATIONS,
  loadMissionDelegationRegistry,
  missionDelegationPromptState,
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

// v1.8.3: every call into the page has a deadline. A hung renderer must not
// hold the per-process tick chain (or a transition's overlay sync) forever.
function withDeadline(promise, timeoutMs, code) {
  let timer = null;
  const deadline = new Promise((_, reject) => {
    const expire = () => reject(Object.assign(new Error(code), { code }));
    expire.deadlineCode = code; // lets the test harness tell deadlines from other timers
    timer = setTimeout(expire, timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function bridgeMessage(tabId, message, timeoutMs = TAB_HEALTH.BRIDGE_TIMEOUT_MS) {
  try {
    return await withDeadline(chrome.tabs.sendMessage(tabId, message), timeoutMs, "CONTENT_BRIDGE_TIMEOUT");
  } catch (error) {
    if (error?.code) throw error;
    if (/Receiving end does not exist|Could not establish connection/i.test(String(error?.message || ""))) {
      throw Object.assign(new Error(String(error.message)), { code: "CONTENT_BRIDGE_MISSING" });
    }
    throw error;
  }
}

async function pingContentBridge(tabId) {
  const result = await bridgeMessage(tabId, { type: "EIC_GF_PING" });
  if (!result?.ok) {
    const error = new Error(result?.error || "CONTENT_BRIDGE_PING_FAILED");
    error.code = result?.code || "CONTENT_BRIDGE_PING_FAILED";
    throw error;
  }
  return result;
}

async function injectContentBridge(tabId) {
  await withDeadline(chrome.scripting.executeScript({
    target: { tabId },
    files: ["lib/safety-policy.js", "lib/model-observation.js", "content.js"]
  }), TAB_HEALTH.INJECT_TIMEOUT_MS, "CONTENT_BRIDGE_INJECT_TIMEOUT");
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
  // v1.8.12: a reserved slot applies only when more than one Greenfield may
  // run; with Max parallella = 1 the setting is kept but has no effect.
  const reservedWorkerSetting = String(operatorSettings?.reservedWorkerId || "");
  const reservedWorkerId = configuredCapacity >= 2 ? reservedWorkerSetting : "";
  return {
    configuredCapacity,
    effectiveCapacity,
    reservedWorkerSetting,
    reservedWorkerId,
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
    configuredCapacity: context.configuredCapacity,
    reservedWorkerId: context.reservedWorkerId
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
    configuredCapacity: context.configuredCapacity,
    reservedWorkerId: context.reservedWorkerId
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
    configuredCapacity: context.configuredCapacity,
    reservedWorkerId: context.reservedWorkerId
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
    workerId: process.workerId || "",
    promptHash,
    priority: process.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY,
    capacity: context.effectiveCapacity,
    configuredCapacity: context.configuredCapacity,
    reservedWorkerId: context.reservedWorkerId,
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
    const overlayResult = await bridgeMessage(process.tabId, {
      type: "EIC_GF_OVERLAY_UPDATE",
      overlay: await managedOverlayPayload(process, { linked, reason })
    }, TAB_HEALTH.OVERLAY_TIMEOUT_MS);
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
    sessionInitialization: process.sessionInitialization ? {
      initializationId: process.sessionInitialization.initializationId,
      status: process.sessionInitialization.status, sessionSeq: process.sessionInitialization.sessionSeq,
      conversationKey: process.sessionInitialization.conversationKey,
      receipt: process.sessionInitialization.receipt, response: process.sessionInitialization.response
    } : null,
    deliveryRetry: process.deliveryRetry ? {
      attempts: process.deliveryRetry.attempts, status: process.deliveryRetry.status,
      conversationKey: process.deliveryRetry.conversationKey,
      sourcePromptHash: process.deliveryRetry.rootPrompt?.hash || ""
    } : null,
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
    // v1.8.11: the panel offers "Läs svar" only for a prompt that was sent.
    pendingDispatch: process.pendingPrompt?.dispatch
      ? {
          status: String(process.pendingPrompt.dispatch.status || ""),
          effectPossible: process.pendingPrompt.dispatch.effectPossible === true,
          acknowledged: process.pendingPrompt.dispatch.acknowledged === true,
          materializedBy: String(process.pendingPrompt.dispatch.materializedBy || "")
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
  const result = await bridgeMessage(process.tabId, {
    type: "EIC_GF_GET_PAGE_STATE",
    source,
    expectedUserTurnId: expectedTurn.id,
    expectedUserIndex: expectedTurn.index,
    expectedPromptMarker: expectedPromptMarker(process)
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
    contentResult = await bridgeMessage(process.tabId, {
      type: "EIC_GF_RATE_LIMIT_RECOVERY_PREFLIGHT"
    }, TAB_HEALTH.PREFLIGHT_TIMEOUT_MS);
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
  beforeSave = null,
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

  if (beforeSave) {
    const admission = await beforeSave();
    if (admission.blocked) return admission.process;
  }
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

// v1.8.13 durable incident log (lib/incident-log.mjs): never blocks or fails
// the caller; ids, codes, numbers and flags only.
async function recordIncident(process, kind, code = "", detail = {}) {
  try {
    await appendIncident({
      atMs: Date.now(),
      kind,
      code,
      workerId: process?.workerId || "",
      processId: process?.processId || "",
      windowId: process?.windowId ?? null,
      generation: process?.generation ?? null,
      sessionSeq: process?.sessionSeq ?? null,
      turn: process?.turn ?? null,
      promptHash: process?.lastPrompt?.hash || process?.pendingPrompt?.hash || "",
      detail
    }, chrome.storage.local);
  } catch {}
}

// What the page showed when an automatic decision was taken.
function incidentPageEvidence(page) {
  const health = page?.pageHealth || {};
  const auto = page?.autonomousTurn || {};
  return {
    generating: page?.generating === true,
    stopVisible: page?.signals?.stopVisible === true,
    streaming: page?.signals?.streaming === true,
    composerBusy: page?.signals?.composerBusy === true,
    readyState: String(health.readyState || ""),
    visibilityState: String(health.visibilityState || page?.signals?.visibilityState || ""),
    composerPresent: health.composerPresent === true,
    turnCount: Number(health.turnCount ?? 0),
    userCount: Number(page?.userCount ?? 0),
    assistantCount: Number(page?.assistantCount ?? 0),
    userTurnResolved: Boolean(auto.resolvedUserTurnId),
    resolvedBy: String(auto.resolvedBy || ""),
    assistantFound: auto.assistantFound === true,
    assistantGenerating: auto.assistantGenerating === true,
    responseSlotClosed: auto.responseSlotClosed === true,
    providerNotice: String(health.providerNotice?.kind || ""),
    // v1.9.3: ChatGPT background processing / connection-lost banner.
    processingNotice: page?.providerNotices?.processingNotice === true,
    connectionInterrupted: page?.providerNotices?.connectionInterrupted === true,
    rateLimitWarning: page?.rateLimitWarning?.active === true,
    quotaNotice: page?.modelEvidence?.quota?.active === true
  };
}

// v1.9.3: record ChatGPT's background-processing notice and its
// connection-lost banner for the waiting turn: session-health pressure for
// the next slice (contract adaptiveRule) and one incident per kind and turn.
// Observation only; the ladder, capture and send gates read the page flags.
const PROVIDER_NOTICE_REFRESH_MS = 30 * 1000;
async function observeProviderTransportNotices(process, page) {
  const notices = page?.providerNotices || {};
  const kinds = [];
  if (notices.processingNotice === true) kinds.push([PROVIDER_NOTICE_KINDS.PROCESSING, "processingNotice"]);
  if (notices.connectionInterrupted === true) kinds.push([PROVIDER_NOTICE_KINDS.CONNECTION_INTERRUPTED, "connectionInterrupted"]);
  const active = process.sessionHealth?.activeTurn || null;
  if (!kinds.length || !active) return process;
  const now = Date.now();
  let health = process.sessionHealth;
  const first = [];
  let refresh = false;
  for (const [kind, key] of kinds) {
    const prior = health.activeTurn?.[key] || null;
    if (!prior) first.push(kind);
    if (!prior || now - Number(prior.lastSeenAtMs || 0) >= PROVIDER_NOTICE_REFRESH_MS) refresh = true;
    health = markSessionHealthProviderNotice(health, { kind, observedAtMs: now });
  }
  if (!refresh) return process;
  const saved = await saveObserved(process, { sessionHealth: health },
    first.length ? "PROVIDER_TRANSPORT_NOTICE_OBSERVED" : "PROVIDER_TRANSPORT_NOTICE_STILL_SHOWN", {
      kinds: kinds.map(([kind]) => kind),
      firstSighting: first,
      promptHash: process.lastPrompt?.hash || ""
    });
  for (const kind of first) {
    const postedAtMs = Number(process.lastPrompt?.postedAtMs || 0);
    await recordIncident(saved, "PROVIDER_TRANSPORT_NOTICE", kind, {
      ...incidentPageEvidence(page),
      waitMin: postedAtMs ? Math.round((now - postedAtMs) / 60000) : null,
      promptChars: Number(process.lastPrompt?.metrics?.promptChars || String(process.lastPrompt?.text || "").length),
      interactionInQuantum: Number(process.lastPrompt?.a2a?.control?.workQueue?.interactionInQuantum || 0) || null
    });
  }
  return saved;
}

// v1.8.2 durable response-observation trace (lib/response-observation.mjs).
// Pure: returns the trace to carry in the next write that happens anyway.
function tracedResponseObservation(process, reason, page, extra = {}) {
  return appendResponseTrace(process?.responseObservationTrace, {
    reason,
    turn: process?.turn,
    promptHash: process?.lastPrompt?.hash || "",
    detail: responseTraceDetail(page, extra)
  });
}

// v1.8.3 tab health: one bounded recovery step per call (lib/tab-health.mjs).
// Steps act on the tab only; a replaced tab is re-bound by the existing
// DETACHED single-tab rebind, so this never rewrites process.tabId itself.
async function executeTabRecoveryStep(process, step) {
  const tabId = process.tabId;
  let tab = null;
  try { tab = await chrome.tabs.get(tabId); } catch {}
  const observedUrl = tab?.url && supportedUrl(tab.url) ? tab.url : "";
  const url = conversationRecoveryUrl(process, observedUrl);
  if (url !== observedUrl && supportedUrl(url) &&
      [TAB_RECOVERY_STEP.RELOAD, TAB_RECOVERY_STEP.HARD_RELOAD].includes(step)) {
    // An empty GPT landing page cannot recover the outstanding thread by
    // reloading itself. Revisit the previously proven conversation instead.
    await chrome.tabs.update(tabId, { url });
    return { url, restoredConversation: true };
  }
  if (step === TAB_RECOVERY_STEP.REINJECT_BRIDGE) {
    await injectContentBridge(tabId);
  } else if (step === TAB_RECOVERY_STEP.RELOAD) {
    await chrome.tabs.reload(tabId, { bypassCache: false });
  } else if (step === TAB_RECOVERY_STEP.HARD_RELOAD) {
    await chrome.tabs.reload(tabId, { bypassCache: true });
  } else if (step === TAB_RECOVERY_STEP.NAVIGATE_SAME_URL) {
    // Programmatic equivalent of pasting the URL into the address bar.
    if (!supportedUrl(url)) throw Object.assign(new Error("TAB_RECOVERY_URL_UNKNOWN"), { code: "TAB_RECOVERY_URL_UNKNOWN" });
    await chrome.tabs.update(tabId, { url });
  } else if (step === TAB_RECOVERY_STEP.REPLACE_TAB) {
    if (!supportedUrl(url)) throw Object.assign(new Error("TAB_RECOVERY_URL_UNKNOWN"), { code: "TAB_RECOVERY_URL_UNKNOWN" });
    const created = await chrome.tabs.create({ windowId: process.windowId, url, active: true });
    await chrome.tabs.remove(tabId).catch(() => undefined);
    return { url, newTabId: created?.id ?? null };
  }
  return { url };
}

async function applyTabHealthCondition(process, condition, { source = "", detail = {} } = {}) {
  const prior = process.tabHealth || null;
  const advanced = advanceTabHealth(prior, condition, { now: Date.now() });
  const incidentChanged = JSON.stringify(advanced.state.incident || null) !== JSON.stringify(prior?.incident || null);

  if (!advanced.action || advanced.action === "BUDGET_EXHAUSTED") {
    const reason = !condition
      ? "TAB_HEALTH_RECOVERED"
      : advanced.action === "BUDGET_EXHAUSTED" ? `TAB_HEALTH_BUDGET_EXHAUSTED:${condition}` : `TAB_HEALTH_${condition}`;
    const traced = tracedResponseObservation(process, reason, {}, { source, ...detail });
    if (!incidentChanged && !traced.changed) return { handled: false, process };
    const saved = await saveObserved(process, {
      tabHealth: advanced.state,
      responseObservationTrace: traced.trace
    }, condition ? "TAB_HEALTH_CONDITION" : "TAB_HEALTH_RECOVERED", {
      condition,
      source,
      budgetExhausted: advanced.action === "BUDGET_EXHAUSTED",
      incident: advanced.state.incident || null,
      ...detail
    });
    return { handled: false, process: saved };
  }

  await recordIncident(process, "TAB_RECOVERY_STEP", advanced.action, {
    condition,
    source,
    stepIndex: Number(advanced.state.incident?.stepIndex ?? 0),
    budgetUsed: Array.isArray(advanced.state.budget) ? advanced.state.budget.length : 0
  });
  if (advanced.action === TAB_RECOVERY_STEP.GIVE_UP) {
    await audit(process, "TAB_RECOVERY_EXHAUSTED", "tab-health", { condition, source, incident: advanced.state.incident, ...detail }).catch(() => undefined);
    const rotated = await armSessionRotation({
      ...process,
      tabHealth: { ...advanced.state, incident: null },
      responseObservationTrace: tracedResponseObservation(process, `TAB_RECOVERY_GIVE_UP:${condition}`, {}, { source }).trace
    }, {
      reasonCode: "TAB_HEALTH_RECOVERY_EXHAUSTED",
      reason: `The managed ChatGPT tab could not be recovered (${condition}).`,
      requestedBy: "TAB_HEALTH",
      objective: process.objectiveState?.objective || process.lastPrompt?.a2a?.objective || process.goal,
      previousResponseHash: process.lastResponse?.hash || "",
      previousDisposition: "SESSION_DETACHED",
      sourceResponseState: sessionRotationSourceState(process)
    });
    return { handled: true, process: rotated };
  }

  let result = {};
  let stepError = null;
  try {
    result = await executeTabRecoveryStep(process, advanced.action);
  } catch (error) {
    stepError = errorRecord(error);
  }
  const saved = await saveObserved(process, {
    tabHealth: advanced.state,
    responseObservationTrace: tracedResponseObservation(process, `TAB_RECOVERY_${advanced.action}:${condition}`, {}, {
      source,
      ok: !stepError
    }).trace
  }, "TAB_RECOVERY_STEP", {
    condition,
    step: advanced.action,
    source,
    result,
    error: stepError,
    incident: advanced.state.incident,
    ...detail
  });
  scheduleFast(saved.processId, 10_000);
  return { handled: true, process: saved };
}

// Page conditions seen through a working bridge (white page with live JS,
// missing composer, missing thread). Never while a dispatched prompt's effect
// is being reconciled: the dispatch fence owns that window.
async function maybeRecoverPageHealth(process, page) {
  const pending = process.pendingPrompt;
  const dispatchInFlight = process.phase === PHASES.SENDING &&
    Boolean(pending?.dispatch) &&
    pending.dispatch.acknowledged !== true &&
    pending.dispatch.effectPossible !== false;
  if (dispatchInFlight) return { handled: false, process };
  const condition = pageConditionFromHealth(page?.pageHealth, { phase: process.phase }) ||
    (expectedThreadMissing(process, page) ? "THREAD_MISSING" : "");
  if (!condition && !process.tabHealth?.incident) return { handled: false, process };
  const health = page?.pageHealth || {};
  return applyTabHealthCondition(process, condition, {
    source: `page-${String(process.phase || "").toLowerCase()}`,
    detail: {
      frameGapMs: Number(health.frameGapMs || 0),
      visibleForMs: Number(health.visibleForMs || 0),
      composerPresent: health.composerPresent === true,
      turnCount: Number(health.turnCount || 0)
    }
  });
}

// R5A transport transitions recheck their durable owner after asynchronous
// page/audit work. STOP, queue changes and quality holds always win.
async function transportTransitionBoundary(process) {
  const current = await loadProcessForWindow(process.windowId);
  const matches = isCurrentToken(current, ownerToken(process)) && current.phase === process.phase &&
    current.goal === process.goal && current.pendingPrompt?.hash === process.pendingPrompt?.hash &&
    current.lastPrompt?.dispatchId === process.lastPrompt?.dispatchId &&
    JSON.stringify(current.queueContext || null) === JSON.stringify(process.queueContext || null) &&
    JSON.stringify(current.sessionInitialization || null) === JSON.stringify(process.sessionInitialization || null) &&
    JSON.stringify(current.deliveryRetry || null) === JSON.stringify(process.deliveryRetry || null);
  if (!matches) return { blocked: true, process: current || process };
  if (current.storageRecoveryRequired || current.safety?.qualityIncident || current.greenfieldControl?.hardStop) {
    return { blocked: true, process: current };
  }
  return { blocked: false, process: current };
}

async function maybeHandleLostConversation(process, page) {
  if (page?.providerNotices?.conversationUnavailable !== true) return { handled: false, process };
  if (page.generating === true || hasCurrentGenerationEvidence(page)) {
    scheduleFast(process.processId, 1200);
    return { handled: true, process };
  }
  const boundary = await transportTransitionBoundary(process);
  if (boundary.blocked) return { handled: true, process: boundary.process };
  const pending = process.pendingPrompt;
  if (pending && (pending.dispatch?.effectPossible !== false && pending.dispatch ||
      Number(pending.sendAttempts || 0) > 0 && !pending.dispatch)) {
    return { handled: true, process: await holdForSafety(process, { code: "DISPATCH_EFFECT_UNRESOLVED",
      detail: "Lost conversation with an unacknowledged dispatch; automatic replay is forbidden." }) };
  }
  if (process.phase === PHASES.WAITING &&
      (process.lastPrompt?.acknowledged !== true || !process.lastPrompt?.dispatchedUserTurnId)) {
    return { handled: true, process: await holdForSafety(process, { code: "DISPATCH_EFFECT_UNRESOLVED" }) };
  }
  const work = isInitializationPrompt(pending) || waitingForInitialization(process)
    ? process.sessionInitialization?.workPrompt
    : pending?.transportKind === DELIVERY_CONTINUATION ? process.deliveryRetry?.rootPrompt : pending;
  const prior = { at: nowIso(), conversationKey: conversationKey(process.lastManagedUrl || page.url || ""),
    lastPrompt: process.lastPrompt || null, sessionInitialization: process.sessionInitialization || null,
    deliveryRetry: process.deliveryRetry || null };
  const rotated = await armSessionRotation({ ...process, lostConversation: prior,
    sessionInitialization: null, deliveryRetry: null }, {
    reasonCode: "CHATGPT_CONVERSATION_UNAVAILABLE", requestedBy: "PROVIDER_TRANSPORT",
    reason: "ChatGPT explicitly reports that this conversation cannot be loaded.",
    objective: work?.a2a?.objective || process.objectiveState?.objective || process.goal,
    operatorInstruction: work?.oneShotInstruction || null,
    sourceResponseState: sessionRotationSourceState(process),
    beforeSave: () => transportTransitionBoundary(process)
  });
  return { handled: true, process: rotated };
}

function sourceResponseAlreadyDelivered(process, page) {
  const causal = autonomousResponseObservation(process, page);
  return causal.ready && page.generating !== true && causal.observation.generating !== true &&
    Boolean(causal.observation.assistantHash && causal.observation.assistantText) &&
    (parseTargetResponse(causal.observation.assistantText).ok ||
      waitingForInitialization(process) && /^\s*READY\b/i.test(causal.observation.assistantText));
}

async function maybeHandleDeliveryTimeout(process, page) {
  if (page?.providerNotices?.deliveryTimeout !== true || sourceResponseAlreadyDelivered(process, page)) {
    if (process.deliveryNotice?.promptHash === process.lastPrompt?.hash) {
      process = await saveObserved(process, { deliveryNotice: null }, "DELIVERY_NOTICE_CLEARED");
    }
    return { handled: false, process };
  }
  if (page.generating === true || hasCurrentGenerationEvidence(page) || providerTransportPending(page)) {
    scheduleFast(process.processId, 1200);
    return { handled: true, process };
  }
  const reason = deliveryContinuationEligibility(process, page);
  if (reason) return { handled: true, process: await holdForSafety(process, { code: reason }) };
  const prior = deliveryRetryForPrompt(process);
  if (Number(prior?.attempts || 0) >= DELIVERY_CONTINUATION_MAX_ATTEMPTS) {
    // Exhausting short retries must not freeze an entire queue forever. The
    // existing bounded reload/rotation ladder still owns later recovery.
    const refresh = await maybeEscalateWaitingRefresh(process, page, { reason: "DELIVERY_CONTINUATION_LIMIT" });
    if (refresh.handled) return { handled: true, process: refresh.process };
    process = refresh.process;
    return { handled: true, process: await holdForSafety(process, { code: "DELIVERY_CONTINUATION_LIMIT",
      detail: "Two short continuations already prepared for this work turn; no full prompt replay." }) };
  }
  if (process.deliveryNotice?.promptHash !== process.lastPrompt.hash) {
    const boundary = await transportTransitionBoundary(process);
    if (boundary.blocked) return { handled: true, process: boundary.process };
    const saved = await saveObserved(process, { deliveryNotice: {
      promptHash: process.lastPrompt.hash, userTurnId: process.lastPrompt.dispatchedUserTurnId,
      firstSeenAtMs: Date.now() } }, "DELIVERY_TIMEOUT_SEEN");
    scheduleFast(saved.processId, DELIVERY_NOTICE_SETTLE_MS);
    return { handled: true, process: saved };
  }
  if (Date.now() - Number(process.deliveryNotice.firstSeenAtMs || 0) < DELIVERY_NOTICE_SETTLE_MS) {
    scheduleFast(process.processId, DELIVERY_NOTICE_SETTLE_MS);
    return { handled: true, process };
  }
  const patch = await prepareDeliveryContinuation(process, page);
  const next = await commitTransition(process, PHASES.SENDING, { ...patch, deliveryNotice: null,
    responseCandidate: null, waitingRefresh: null, lastError: null }, {
    kind: "DELIVERY_SHORT_CONTINUATION_PREPARED", component: "transport",
    beforeSave: () => transportTransitionBoundary(process),
    detail: { sourcePromptHash: patch.deliveryRetry.rootPrompt.hash,
      sourceUserTurnId: patch.pendingPrompt.sourceUserTurnId,
      attempts: patch.deliveryRetry.attempts, conversationKey: patch.deliveryRetry.conversationKey } });
  if (next.phase === PHASES.SENDING) {
    await cancelSchedulerProcess(next, "DELIVERY_SHORT_CONTINUATION_REARM").catch(() => undefined);
    scheduleFast(next.processId, 50);
  }
  return { handled: true, process: next };
}

async function guardShortContinuation(process, page) {
  const pending = process.pendingPrompt;
  if (pending?.transportKind !== DELIVERY_CONTINUATION) return { handled: false, process };
  const retry = process.deliveryRetry;
  if (!retry?.sourcePrompt || !pending.requiredConversationKey ||
      conversationKey(page.url) !== pending.requiredConversationKey) {
    return { handled: true, process: await holdForSafety(process, { code: "DELIVERY_CONVERSATION_UNPROVEN" }) };
  }
  // A possibly issued short dispatch is owned by the existing exact-once
  // fence. It cannot be cancelled by a disappearing banner or late response.
  if (pending.dispatch && pending.dispatch.effectPossible !== false) return { handled: false, process };
  const source = { ...process, phase: PHASES.WAITING, pendingPrompt: null, lastPrompt: retry.sourcePrompt };
  const causal = autonomousResponseObservation(source, page);
  const lateResponse = causal.ready && !causal.observation.generating &&
    Boolean(causal.observation.assistantHash && causal.observation.assistantText) &&
    causal.observation.assistantHash !== retry.sourcePrompt.baselineAssistantHash &&
    (parseTargetResponse(causal.observation.assistantText).ok ||
      waitingForInitialization(source) && /^\s*READY\b/i.test(causal.observation.assistantText));
  if (page.generating || lateResponse || page.providerNotices?.deliveryTimeout !== true) {
    const next = await commitTransition(process, PHASES.WAITING, {
      pendingPrompt: null, lastPrompt: retry.sourcePrompt,
      deliveryRetry: { ...retry, status: lateResponse ? "CANCELLED_LATE_RESPONSE" : "CANCELLED_PROVIDER_RECOVERED" },
      waitingRefresh: createWaitingRefreshState({ now: Date.now(), page,
        promptHash: retry.sourcePrompt.hash, turn: process.turn }), responseCandidate: null }, {
      kind: "DELIVERY_SHORT_CONTINUATION_CANCELLED", component: "transport",
      beforeSave: () => transportTransitionBoundary(process) });
    await cancelSchedulerProcess(next, "DELIVERY_PROVIDER_RECOVERED").catch(() => undefined);
    scheduleFast(next.processId, 100);
    return { handled: true, process: next };
  }
  if (page.lastUserId !== pending.sourceUserTurnId ||
      page.lastUserHash !== retry.sourcePrompt.hash) {
    return { handled: true, process: await holdForSafety(process, { code: "DELIVERY_SOURCE_TURN_UNPROVEN" }) };
  }
  return { handled: false, process };
}

async function tickSessionInitialization(process, page) {
  const init = process.sessionInitialization;
  const key = conversationKey(page.url || "");
  if (!init?.workPrompt || init.sessionSeq !== process.sessionSeq || !key ||
      init.conversationKey && init.conversationKey !== key ||
      process.lastPrompt?.conversationKey && process.lastPrompt.conversationKey !== key) {
    return holdForSafety(process, { code: "SESSION_INITIALIZATION_CONVERSATION_UNPROVEN" });
  }
  const causal = autonomousResponseObservation(process, page);
  if (!causal.ready || page.generating || causal.observation.generating || providerTransportPending(page)) {
    const refresh = await maybeEscalateWaitingRefresh(process, page, { reason: "SESSION_INITIALIZATION_AWAITING_RESPONSE" });
    if (refresh.handled) return refresh.process;
    process = refresh.process;
    scheduleFast(process.processId, FAST_RECHECK_MS);
    return process;
  }
  const advanced = advanceResponseCandidate(process.responseCandidate, causal.observation);
  process = await saveObserved(process, { responseCandidate: advanced.candidate }, "SESSION_INITIALIZATION_RESPONSE_SAMPLE");
  const sampledOwner = await transportTransitionBoundary(process);
  if (sampledOwner.blocked) return sampledOwner.process;
  if (!advanced.complete || !responseStructuralCompleteness(causal.observation.assistantText).complete) {
    scheduleFast(process.processId, FAST_RECHECK_MS);
    return process;
  }
  const pendingPrompt = { ...init.workPrompt, baselineAssistantHash: causal.observation.assistantHash,
    requiredConversationKey: key, sendAttempts: 0, dispatch: null, promptPause: null };
  if (process.lastPrompt?.usageId) {
    await recordUsageOutput(process.lastPrompt.usageId, causal.observation.assistantText);
  }
  const next = await commitTransition(process, PHASES.SENDING, {
    pendingPrompt, sessionInitialization: { ...init, status: "READY", conversationKey: key,
      completedAt: nowIso(), workPrompt: null,
      receipt: { ...(process.deliveryRetry?.rootPrompt || process.lastPrompt) },
      completionReceipt: process.lastPrompt.transportKind === DELIVERY_CONTINUATION ? { ...process.lastPrompt } : null,
      response: { messageId: causal.observation.lastAssistantId, hash: causal.observation.assistantHash } },
    responseCandidate: null, waitingRefresh: null, deliveryRetry: null, deliveryNotice: null,
    lastError: null, lastMaterialAt: nowIso() }, {
    kind: "SESSION_INITIALIZED_WORK_PROMPT_RELEASED", component: "transport",
    beforeSave: () => transportTransitionBoundary(process),
    detail: { conversationKey: key, initializationDoesNotConsumeWorkInteraction: true,
      providerPersistenceGuaranteed: false } });
  await releaseSchedulerTurn(next, { promptHash: process.lastPrompt.hash, reason: "SESSION_INITIALIZED" }).catch(() => undefined);
  scheduleFast(next.processId, 50);
  return next;
}

// v1.8.3 ChatGPT content block (Daybreak notice). Two observations >= 3 s apart
// before acting; the first block rotates the same GFW into a fresh chat, a
// repeat within 24 h pauses it (2 h / 6 h / 24 h); it is never BLOCKED.
async function maybeHandleProviderNotice(process, page) {
  const notice = page?.pageHealth?.providerNotice || null;
  const blocking = providerNoticeBlocks(notice) && page?.generating !== true &&
    (process.phase !== PHASES.WAITING || process.lastPrompt?.acknowledged === true);
  if (!blocking) {
    if (!process.providerNoticePending) return { handled: false, process };
    const cleared = await saveObserved(process, { providerNoticePending: null }, "PROVIDER_NOTICE_CLEARED", {});
    return { handled: false, process: cleared };
  }
  const seen = process.providerNoticePending;
  const now = Date.now();
  if (!seen || seen.noticeKey !== notice.noticeKey) {
    const saved = await saveObserved(process, {
      providerNoticePending: { noticeKey: String(notice.noticeKey || ""), firstSeenAtMs: now },
      responseObservationTrace: tracedResponseObservation(process, "PROVIDER_CONTENT_BLOCK_NOTICE_SEEN", page, {
        noticeSample: String(notice.sample || "").slice(0, 200),
        headlineMatched: notice.headlineMatched === true,
        cyberWordMatched: notice.cyberWordMatched === true
      }).trace
    }, "PROVIDER_CONTENT_BLOCK_NOTICE_SEEN", {
      noticeKey: notice.noticeKey || "",
      sample: String(notice.sample || "").slice(0, 240),
      headlineMatched: notice.headlineMatched === true,
      cyberWordMatched: notice.cyberWordMatched === true,
      afterExpectedUserTurn: notice.afterExpectedUserTurn
    });
    scheduleFast(saved.processId, 3000);
    return { handled: true, process: saved };
  }
  if (now - Number(seen.firstSeenAtMs || 0) < 3000) {
    scheduleFast(process.processId, 3000);
    return { handled: true, process };
  }
  return { handled: true, process: await handleProviderContentBlock(process, notice) };
}

async function handleProviderContentBlock(process, notice) {
  const now = Date.now();
  const decision = recordProviderBlock(process.providerContentBlocks, { noticeKey: notice.noticeKey, now });
  const baseObjective = process.objectiveState?.objective || process.lastPrompt?.a2a?.objective || process.goal;
  const objective = providerBlockObjective(baseObjective, notice, { chainLength: decision.chainLength });
  const current = {
    ...process,
    providerNoticePending: null,
    providerContentBlocks: { ...decision.history, pauseUntilMs: 0 },
    responseObservationTrace: tracedResponseObservation(process, `PROVIDER_CONTENT_BLOCKED:${decision.action}`, {}, {
      chainLength: decision.chainLength,
      pauseMs: decision.pauseMs
    }).trace
  };
  await recordIncident(current, "PROVIDER_CONTENT_BLOCK", decision.action, {
    chainLength: decision.chainLength,
    pauseMs: Number(decision.pauseMs || 0),
    headlineMatched: notice.headlineMatched === true,
    cyberWordMatched: notice.cyberWordMatched === true,
    afterExpectedUserTurn: notice.afterExpectedUserTurn === true
  });
  await audit(current, "PROVIDER_CONTENT_BLOCK_HANDLED", "provider-notice", {
    noticeKey: notice.noticeKey || "",
    sample: String(notice.sample || "").slice(0, 240),
    counted: decision.counted,
    chainLength: decision.chainLength,
    action: decision.action,
    pauseMs: decision.pauseMs,
    queueManaged: Boolean(current.queueContext?.itemId),
    neverBlocked: true
  }).catch(() => undefined);
  if (decision.action === "PAUSE" && current.queueContext?.itemId) {
    const parked = await pauseQueueSlotForProviderBlock(current, decision.pauseMs, objective);
    if (parked) return parked;
  }
  if (decision.action === "PAUSE") current.providerContentBlocks.pauseUntilMs = now + decision.pauseMs;
  return armSessionRotation(current, {
    reasonCode: "PROVIDER_CONTENT_BLOCKED",
    reason: "ChatGPT withheld the response with a content-block notice (Daybreak).",
    requestedBy: "PROVIDER_NOTICE",
    objective,
    previousResponseHash: current.lastResponse?.hash || "",
    previousDisposition: PROVIDER_BLOCK.DISPOSITION,
    sourceResponseState: PROVIDER_BLOCK.SOURCE_STATE
  });
}

// Queue-managed repeat: pause the slot with the v1.8.1 scheduler (the operator
// sees and can clear it under Schema), park it and advance the queue. The slot
// status stays READY; it resumes in a fresh chat when the pause ends.
async function pauseQueueSlotForProviderBlock(process, pauseMs, objective) {
  const { queue, settings } = await missionQueueForWindow(process.windowId);
  const item = queueItemForProcess(queue, process);
  if (!queue.enabled || !item) return null;
  const now = Date.now();
  const existing = normalizeQueueSchedule(item.schedule, { now });
  const pauseUntilMs = Math.max(Number(existing?.pauseUntilMs || 0), now + Number(pauseMs || 0));
  queue.items = queue.items.map((candidate) => candidate.itemId === item.itemId
    ? {
        ...candidate,
        schedule: { windows: existing?.windows || [], pauseUntilMs, updatedBy: "GREENFIELD", updatedAtMs: now },
        updatedAt: nowIso(now)
      }
    : candidate);
  await persistMissionQueue(queue, settings, process, "MISSION_QUEUE_PROVIDER_BLOCK_PAUSE", {
    itemId: item.itemId,
    pauseMs,
    pauseUntilMs
  });
  return parkQueueMissionForSchedule(process, SCHEDULE_BLOCK.PAUSED, {
    outcome: "PROVIDER_CONTENT_BLOCKED_PAUSED",
    summary: `ChatGPT withheld a response again (content-block notice); the GFW is paused until ${new Date(pauseUntilMs).toISOString()} and is not blocked.`,
    previousDisposition: PROVIDER_BLOCK.DISPOSITION,
    sourceResponseState: PROVIDER_BLOCK.SOURCE_STATE,
    objective
  });
}

// Persists only when the trace changed: a new reason/identity, or at most once
// per minute for an unchanged one, so a long wait is not a write per tick.
async function recordResponseObservation(process, reason, page, extra = {}) {
  const traced = tracedResponseObservation(process, reason, page, extra);
  if (!traced.changed) return process;
  return saveObserved(process, { responseObservationTrace: traced.trace }, "RESPONSE_OBSERVATION_TRACED", {
    reason,
    turn: process.turn,
    promptHash: process.lastPrompt?.hash || ""
  });
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
  // F5/Ctrl-F5 milestone. Nominal edges stay 30/60/90/120m, with a real
  // settle interval between late recovery effects after a suspended worker.
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
    lastMaterialAt: nowIso(),
    responseObservationTrace: tracedResponseObservation(process, "COMPLETED_ASSISTANT_SEEN_STALE_CLOCK_RESET", page, {
      priorStage: current.stage || "",
      resetCount: Number(reset.state.resetCount || 0)
    }).trace
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
  const refreshState = refreshStateMatches ? process.waitingRefresh : createWaitingRefreshState({
    now: Date.now(),
    page: {},
    promptHash: process.lastPrompt?.hash || "",
    turn: Number(process.turn || 0),
    staleSince: process.lastPrompt?.sentAt || process.lastMaterialAt || process.startedAt || ""
  });
  const refreshDecision = evaluateWaitingRefresh({
    now: Date.now(),
    staleSince: refreshState?.staleSince || "",
    waitingSince: process.lastPrompt?.sentAt || process.lastMaterialAt || process.startedAt || "",
    acknowledged: process.lastPrompt?.acknowledged === true,
    responseComplete: false,
    stage: refreshState?.stage || "",
    generating: hasCurrentGenerationEvidence(page),
    requestedAt: refreshState?.requestedAt || ""
  });
  const generationHoldUntilMs = Number(refreshDecision.generationHoldUntilMs || 0);
  if (generationHoldUntilMs !== Number(refreshState.generationHoldUntilMs || 0)) {
    process = await saveObserved(process, {
      waitingRefresh: { ...refreshState, generationHoldUntilMs }
    }, generationHoldUntilMs ? "WAITING_GENERATION_DEFERRED" : "WAITING_GENERATION_DEFERRAL_ENDED", {
      generationHoldUntilMs,
      generating: page.generating === true,
      promptHash: process.lastPrompt?.hash || "",
      noPromptSent: true
    });
  }

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
    const traced = tracedResponseObservation(process, `WAITING_REFRESH_${refreshDecision.action}`, page, {
      unresolvedReason: reason,
      stage: refreshDecision.stage || ""
    });
    await recordIncident(process, "STALE_LADDER_STEP", refreshDecision.code, {
      action: refreshDecision.action,
      stage: refreshDecision.stage || "",
      waitMin: Math.round(Number(refreshDecision.waitMs || 0) / 60000),
      unresolvedReason: reason,
      slotReleased: Boolean(refreshState?.capacityReleased),
      ...incidentPageEvidence(page)
    });
    return {
      handled: true,
      process: await executeWaitingRefresh({ ...process, responseObservationTrace: traced.trace }, refreshDecision)
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
    await recordIncident(process, "STALE_LADDER_STEP", "STALE_SESSION_120M_ROTATE", {
      action: "ROTATE",
      waitMin: Math.round(Number(refreshDecision.waitMs || 0) / 60000),
      unresolvedReason: reason,
      queueManaged: Boolean(process.queueContext?.itemId),
      slotReleased: Boolean(refreshState?.capacityReleased),
      ...incidentPageEvidence(page)
    });
    // The last entry before the conversation is abandoned; it travels in the
    // parked snapshot (queue rotation) or the rotated process.
    process = {
      ...process,
      responseObservationTrace: tracedResponseObservation(process, "STALE_SESSION_120M_ROTATE", page, {
        unresolvedReason: reason
      }).trace
    };
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

  // The persisted state may have been updated above (generation deferral).
  process = await maybeReleaseStaleTurnCapacity(process, page, process.waitingRefresh || refreshState);
  return { handled: false, process };
}

// v1.8.13: a turn that, after the stale ladder's first reload has settled,
// shows neither a generation nor an answer gives its capacity slot back.
// Diagnostics 2026-10-05: 30 such turns each held a slot for the whole
// 120-minute ladder (a third of the shared pool's time). The turn keeps
// waiting, the ladder is unchanged and a late answer is still captured. The
// flag is written before the release, so a restart in between converges to
// "released" (the reconcile skips flagged turns).
async function maybeReleaseStaleTurnCapacity(process, page, refreshState) {
  const decision = staleTurnCapacityDecision({
    now: Date.now(),
    refreshState,
    promptHash: process.lastPrompt?.hash || "",
    turn: Number(process.turn || 0),
    acknowledged: process.lastPrompt?.acknowledged === true,
    page
  });
  if (decision.action !== "RELEASE") return process;
  const promptHash = process.lastPrompt?.hash || "";
  const capacityReleased = {
    promptHash,
    turn: Number(process.turn || 0),
    stage: decision.stage,
    atMs: Date.now(),
    reason: decision.code
  };
  const flagged = await saveObserved(process, {
    waitingRefresh: { ...refreshState, capacityReleased, capacityReadopted: null }
  }, "STALE_TURN_CAPACITY_RELEASED", {
    promptHash,
    turn: capacityReleased.turn,
    stage: decision.stage,
    reason: decision.code,
    noPromptSent: true,
    ladderUnchanged: true
  });
  await releaseSchedulerTurn(flagged, { promptHash, reason: decision.code }).catch(() => undefined);
  await recordIncident(flagged, "STALE_TURN_SLOT_RELEASED", decision.code, {
    stage: decision.stage,
    ...incidentPageEvidence(page)
  });
  return flagged;
}

// v1.8.13: the released turn shows a generation again (stop button or
// streaming, as for the ladder's deferral; a busy composer alone, e.g. while
// the page loads, is not enough): it runs, so it is counted again, even above
// the configured capacity. It is not released again before the next reload.
async function maybeReadoptStaleTurnCapacity(process, page) {
  const released = process.waitingRefresh?.capacityReleased || null;
  const promptHash = process.lastPrompt?.hash || "";
  if (process.phase !== PHASES.WAITING || !released || released.promptHash !== promptHash ||
      Number(released.turn) !== Number(process.turn || 0) || !hasCurrentGenerationEvidence(page)) {
    return process;
  }
  const capacityReadopted = { promptHash, turn: Number(process.turn || 0), stage: process.waitingRefresh?.stage || "", atMs: Date.now() };
  const saved = await saveObserved(process, {
    waitingRefresh: { ...process.waitingRefresh, capacityReleased: null, capacityReadopted }
  }, "STALE_TURN_CAPACITY_READOPTED", {
    promptHash,
    turn: capacityReadopted.turn,
    stage: capacityReadopted.stage,
    generating: true
  });
  await adoptSchedulerTurnForObservedEffect(saved, promptHash, "STALE_TURN_GENERATION_SEEN_AGAIN").catch(() => undefined);
  await recordIncident(saved, "STALE_TURN_SLOT_READOPTED", "GENERATION_SEEN_AGAIN", incidentPageEvidence(page));
  return saved;
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
  // v1.8.3: a discarded tab is revived by the tab-health ladder; a tab Chrome
  // froze to save resources is waited for (Greenfield does not fight Chrome's
  // resource policy); managed tabs are exempt from automatic discarding.
  if (tab.discarded === true) {
    throw Object.assign(new Error("MANAGED_TAB_DISCARDED"), { code: "MANAGED_TAB_DISCARDED" });
  }
  if (tab.frozen === true) {
    throw Object.assign(new Error("MANAGED_TAB_FROZEN"), { code: "MANAGED_TAB_FROZEN" });
  }
  if (tab.autoDiscardable !== false) {
    await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
  }
  try {
    const expectedTurn = expectedAutonomousUserTurn(process);
    const promptMarker = expectedPromptMarker(process);
    const result = await bridgeMessage(process.tabId, {
      type: "EIC_GF_GET_PAGE_STATE",
      source,
      expectedUserTurnId: expectedTurn.id,
      expectedUserIndex: expectedTurn.index,
      expectedPromptMarker: promptMarker
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
      const refreshed = await bridgeMessage(process.tabId, {
        type: "EIC_GF_GET_PAGE_STATE",
        source: `${source}-after-bridge-refresh`,
        expectedUserTurnId: expectedTurn.id,
        expectedUserIndex: expectedTurn.index,
        expectedPromptMarker: promptMarker
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
    // A timeout here is an unknown dispatch effect (catch below); the
    // existing reconciliation observes whether the user turn materialized.
    result = await bridgeMessage(process.tabId, {
      type: "EIC_GF_SUBMIT_PROMPT",
      prompt: pending.text,
      promptHash: pending.hash,
      promptMarker: pending.dispatch?.promptMarker || promptCausalMarker(pending.text),
      dispatchId: pending.dispatch?.operationId || operationId,
      safetyContext: { policy:(await readSafety()).policy, gptRoot:process.gptRoot }
    }, TAB_HEALTH.SUBMIT_TIMEOUT_MS);
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

// v1.9.3: the window queue overview carried in every prompt. A read failure
// leaves it out of this one prompt; it never blocks the prompt.
async function windowQueueForPrompt(process, source = null) {
  if (!process.queueContext?.queueId || !process.queueContext?.itemId) return null;
  try {
    const queue = source && Array.isArray(source.items)
      ? source
      : (await missionQueueForWindow(Number(process.windowId))).queue;
    if (String(queue.queueId || "") !== String(process.queueContext.queueId)) return null;
    return windowQueueOverview(queue, {
      now: Date.now(),
      currentItemId: String(process.queueContext?.itemId || ""),
      currentQueueContext: process.queueContext || null
    });
  } catch {
    return null;
  }
}

async function delegationStatusForPrompt(process) {
  if (!process.queueContext?.queueId || !process.queueContext?.itemId) return null;
  try {
    return missionDelegationPromptState(await loadMissionDelegationRegistry(chrome.storage.local), {
      sourceQueueId: process.queueContext.queueId, sourceItemId: process.queueContext.itemId
    });
  } catch {
    return { schema: "eic.greenfield.mission-delegation-status.v1",
      sourceQueueId: process.queueContext.queueId, unavailable: true };
  }
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
  turn = process.turn,
  // v1.9.3: the in-memory queue when the caller is mid-activation.
  windowQueueSource = null
}) {
  const virtual = { ...process, turn };
  const windowQueue = await windowQueueForPrompt(process, windowQueueSource);
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
    pauseResume,
    windowQueue,
    delegationStatus: await delegationStatusForPrompt(process)
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
      promptProfile: fallbackProfile,
      metrics: fallback.metrics
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
    // v1.9.3: per-prompt sizing telemetry (role, pressure, overpack guard).
    metrics: composed.metrics,
    fullFallback,
    oneShotInstruction: operatorInstruction ? {
      // Retain the inbox owner when a parked mission is restored on a new
      // worker/process. The prompt recipient and inbox owner can differ.
      processId: operatorInstruction.processId || process.processId,
      runId: operatorInstruction.runId || process.runId,
      instructionId: operatorInstruction.instructionId,
      text: operatorInstruction.text,
      createdAt: operatorInstruction.createdAt || nowIso()
    } : null
  };
}

// A worker can stop after committing a prompt but before consuming its inbox.
// Reconcile that local transfer before another turn can claim the instruction.
// This never changes the prompt, dispatch receipt or process phase.
async function consumeCheckpointedInstructions(process, { instructionLockProcessId = "" } = {}) {
  for (const slot of ["pendingPrompt", "lastPrompt"]) {
    const prompt = process?.[slot];
    const instruction = prompt?.oneShotInstruction;
    if (!instruction?.instructionId || !prompt.text || !prompt.hash) continue;
    let ownerId = instruction.processId || process.processId;
    let ownerRunId = instruction.runId || process.runId;
    let legacyOwner = null;
    // Older queue prompts did not retain the inbox owner. Resolve it only
    // from this durable activation's parked process and an exact inbox match.
    if (!instruction.processId && process.queueContext?.itemId) {
      const queue = await loadMissionWorkQueue(process.windowId, chrome.storage.local, { workerId: process.workerId });
      const item = queue.items.find(candidate => candidate.itemId === process.queueContext.itemId);
      const source = item?.processSnapshot;
      if (queue.queueId === process.queueContext.queueId && queue.activeItemId === item?.itemId &&
          item?.status === QUEUE_STATUS.ACTIVE &&
          Number(item.activationCount || 0) === Number(process.queueContext.activationCount || 0) &&
          source?.processId && source.runId && source.processId !== process.processId) {
        const priorInbox = await readNextInstruction(source.processId);
        if (priorInbox?.instructionId === instruction.instructionId &&
            priorInbox.runId === source.runId && priorInbox.text === instruction.text) {
          legacyOwner = source;
          ownerId = source.processId;
          ownerRunId = source.runId;
        }
      }
    }
    const consume = async () => {
      const inbox = await readNextInstruction(ownerId);
      if (!inbox || inbox.instructionId !== instruction.instructionId ||
          inbox.runId !== ownerRunId || inbox.text !== instruction.text) return;

      const current = await loadProcessForWindow(process.windowId);
      if (!current || current.processId !== process.processId || current.runId !== process.runId ||
          current.workerId !== process.workerId || current.generation !== process.generation ||
          current.phase !== process.phase ||
          current.storageRecoveryRequired || current.safety?.qualityIncident) return;
      const committed = current[slot];
      const claimed = committed?.oneShotInstruction;
      if (!committed || committed.hash !== prompt.hash || committed.text !== prompt.text ||
          claimed?.instructionId !== instruction.instructionId || claimed.text !== instruction.text ||
          (claimed.processId || legacyOwner?.processId || current.processId) !== ownerId ||
          (claimed.runId || legacyOwner?.runId || current.runId) !== ownerRunId) return;

      let envelope;
      try { envelope = JSON.parse(committed.text); } catch { return; }
      if (await sha256Hex(committed.text) !== committed.hash ||
          envelope.process?.processId !== current.processId || envelope.process?.runId !== current.runId ||
          (slot === "pendingPrompt" && envelope.process?.generation !== current.generation) ||
          envelope.operatorInstruction?.instructionId !== inbox.instructionId ||
          envelope.operatorInstruction?.text !== inbox.text ||
          committed.a2a?.operatorInstruction?.instructionId !== inbox.instructionId ||
          committed.a2a?.operatorInstruction?.text !== inbox.text) return;

      // Queue activation publishes the process before publishing the queue.
      // An interrupted activation must retain its inbox until both are durable.
      if (current.queueContext?.itemId) {
        const queue = await loadMissionWorkQueue(current.windowId, chrome.storage.local, { workerId: current.workerId });
        const item = queue.items.find(candidate => candidate.itemId === current.queueContext.itemId);
        if (queue.queueId !== current.queueContext.queueId ||
            queue.activeItemId !== current.queueContext.itemId || item?.status !== QUEUE_STATUS.ACTIVE ||
            Number(item.activationCount || 0) !== Number(current.queueContext.activationCount || 0)) return;
      }

      const cleared = await clearNextInstruction(ownerId, inbox.instructionId);
      if (cleared.cleared) {
        await audit(current, "NEXT_INSTRUCTION_CHECKPOINT_ACK_RECOVERED", "operator-input", {
          instructionId: inbox.instructionId, sourceProcessId: ownerId,
          sourceRunId: ownerRunId, promptHash: committed.hash, promptSlot: slot,
          clearedFromInbox: true, dispatchUnchanged: true
        }).catch(() => undefined);
      }
    };
    if (ownerId === instructionLockProcessId) await consume();
    else await instructionQueues.enqueue(ownerId, consume);
  }
}


// v1.8.5: saved missions as the background sees them (the panel writes this
// local mirror after every durable vault write, with readback).
async function currentSavedMissions() {
  const settings = await loadOperatorSettings(
    chrome.storage.local,
    { restoreSavedMissions: false, bookmarks: null }
  ).catch(() => null);
  return Array.isArray(settings?.savedMissions) ? settings.savedMissions : [];
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
    ),
    warmQueueResume: settings.warmQueueResume == null
      ? DEFAULT_WARM_QUEUE_RESUME
      : settings.warmQueueResume === true
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

// R1H: a queue switch is not dispatch reconciliation. Keep every pending
// receipt (including acknowledged/no-effect) until the normal fence settles
// it, and do not erase legacy attempts or an explicit unresolved-effect hold.
function queuePendingEffectNeedsReconciliation(process) {
  if (process?.safety?.hold?.code === "DISPATCH_EFFECT_UNRESOLVED" ||
      process?.lastError?.code === "SESSION_ROTATION_PROMPT_EFFECT_UNKNOWN") return true;
  const pending = process?.pendingPrompt;
  return Boolean(pending && (pending.dispatch != null ||
    (pending.sendAttempts != null && pending.sendAttempts !== 0)));
}

function queueItemNeedsEffectReconciliation(queue, item) {
  const logical = String(item?.savedMissionId || "").trim();
  return queuePendingEffectNeedsReconciliation(item?.processSnapshot) || (queue?.items || []).some(candidate =>
    (candidate.itemId === item?.itemId || logical && String(candidate.savedMissionId || "").trim() === logical) &&
    queuePendingEffectNeedsReconciliation(candidate.processSnapshot));
}

function selectNextMissionItem(queue, options = {}) {
  // Older requeues can already contain an ambiguous receipt. Skip the whole
  // logical mission without starving independent runnable missions.
  return selectNextMissionItemUnchecked({ ...queue,
    items:(queue?.items || []).filter(item=>!queueItemNeedsEffectReconciliation(queue,item)) },options);
}

function queueActivationSourceMatches(current, prior) {
  if (!current || !prior) return current === prior;
  if (!isCurrentToken(current,ownerToken(prior)) || current.phase !== prior.phase) return false;
  // Analysis adds local runtime receipts and no-delta observations before its
  // transition commits. Compare the dispatch/continuation source at entry;
  // compare the entire durable process again after asynchronous composition.
  return ["tabId","windowId","gptRoot","turn","sessionSeq","goal","objectiveState",
    "pendingPrompt","lastPrompt","lastResponse","sessionRotation","storageRecoveryRequired","qualityIncident"]
    .every(key=>JSON.stringify(current[key]) === JSON.stringify(prior[key])) &&
    JSON.stringify(current.safety?.hold) === JSON.stringify(prior.safety?.hold) &&
    JSON.stringify(current.safety?.qualityIncident) === JSON.stringify(prior.safety?.qualityIncident);
}

async function queueActivationEffectBoundary({ queue, item, windowId, priorProcess = null,
  expectedProcess, expectedQueue = queue, allowQueueEnable = false, operatorHandoff = false } = {}) {
  const liveQueue = await loadMissionWorkQueue(windowId,chrome.storage.local,{workerId:queue.workerId});
  const current = await loadProcessForWindow(windowId);
  const queueToCompare = allowQueueEnable && expectedQueue.enabled === true && liveQueue.enabled === false
    ? { ...liveQueue,enabled:true } : liveQueue;
  const changed = (expectedProcess !== undefined
    ? JSON.stringify(current) !== JSON.stringify(expectedProcess) : !queueActivationSourceMatches(current,priorProcess)) ||
    JSON.stringify(queueToCompare) !== JSON.stringify(expectedQueue);
  const unresolved = (!operatorHandoff && (queuePendingEffectNeedsReconciliation(current) ||
    queuePendingEffectNeedsReconciliation(priorProcess))) || queueItemNeedsEffectReconciliation(queue,item) ||
    queueItemNeedsEffectReconciliation(liveQueue,item);
  if (!changed && !unresolved) return { current, liveQueue };
  const code = unresolved ? "MISSION_QUEUE_PENDING_EFFECT_RECONCILIATION_REQUIRED" : "MISSION_QUEUE_ACTIVATION_SOURCE_CHANGED";
  await audit(current || priorProcess,"MISSION_QUEUE_ACTIVATION_HELD","mission-work-queue",{
    code,itemId:item?.itemId || "",automaticResend:false,processUnchanged:true,operatorHandoff
  }).catch(()=>undefined);
  return { blocked:true,code,process:current || priorProcess,queue:liveQueue };
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
  const wakeTimes = (queue.items || []).filter(item=>!queueItemNeedsEffectReconciliation(queue,item))
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

// v1.9.0: conversations last used by other GFWs of this window (other slots'
// snapshots and the process that just parked); a warm resume never enters them.
function conversationsOfOtherGfws(queue, priorProcess, processId) {
  const keys = [];
  const add = (snapshot) => {
    if (!snapshot || snapshot.processId === processId) return;
    keys.push(snapshot.lastResponse?.observation?.conversationKey || "", snapshot.lastManagedUrl || "");
  };
  for (const candidate of queue?.items || []) add(candidate.processSnapshot);
  add(priorProcess);
  return keys.filter(Boolean);
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

  let warmPlan = null;
  let coldPlan = null;
  if (parkedMatchesWorker) {
    const parked = deepClone(item.processSnapshot);
    // v1.9.0: resume in the GFW's own conversation when eligible.
    warmPlan = warmResumeDecision({
      enabled: settings?.warmQueueResume == null ? DEFAULT_WARM_QUEUE_RESUME : settings.warmQueueResume === true,
      item,
      parked,
      // v1.9.3: a new quantum (interaction 1) always starts in a fresh chat.
      interactionInQuantum: Number(queueContext?.interactionCount || 0) + 1,
      lastSessionAction: capturedTargetResponse(parked).targetResponse?.sessionAction || "KEEP",
      otherConversationKeys: conversationsOfOtherGfws(queue, priorProcess, parked.processId),
      now: activationAtMs
    });
    generation = Number(parked.generation || 1) + 1;
    // A warm resume stays in the same ChatGPT session (conversation).
    sessionSeq = Number(parked.sessionSeq || 1) + (warmPlan.warm ? 0 : 1);
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
      // v1.8.5: the slot's (saved mission's) current text is the bootstrap.
      goal: String(item.goal || parked.goal || ""),
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
    // Inputs of the cold (fresh chat) prompt, kept small so a warm resume
    // that cannot be verified on the page falls back to exactly today's path.
    coldPlan = {
      objective,
      previousResponseHash,
      previousDisposition,
      analysisEvidence,
      processStatusMode: item.resume?.processStatusRequest || ""
    };
    if (warmPlan.warm) {
      messageType = "CONTINUATION";
      objective = warmResumeObjective({
        objective: String(item.resume?.objective || parked.objectiveState?.objective || "").trim(),
        outcome: warmPlan.outcome,
        idleMinutes: (activationAtMs - warmPlan.leftAtMs) / 60000
      });
    }
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
    process.noDeltaState = item.processSnapshot?.noDeltaState ? deepClone(item.processSnapshot.noDeltaState) : null;
    sessionHealth = process.sessionHealth;
    messageType = item.resume?.objective || parkedSnapshotPresent ? "MISSION_RESTORE" : "MISSION_START";
  }

  // A parked instruction stays owned by its logical GFW. Prefer a newer inbox
  // entry, then the durable slot copy (including recovery on a different worker).
  const instructionSourceProcessId = item.processSnapshot?.processId ||
    item.resume?.operatorInstruction?.processId || process.processId;
  const operatorInstruction = await readNextInstruction(instructionSourceProcessId) ||
    item.resume?.operatorInstruction ||
    item.processSnapshot?.sessionInitialization?.workPrompt?.oneShotInstruction || null;
  if (coldPlan) coldPlan.operatorInstruction = operatorInstruction ? deepClone(operatorInstruction) : null;

  const rotationId = randomId("queue-switch");
  const warm = warmPlan?.warm === true;
  const rotation = createSessionRotationRecord({
    rotationId,
    reasonCode: warm ? "QUEUE_MISSION_WARM_RESUME" : parkedSnapshotPresent ? "QUEUE_MISSION_RESUME" : "QUEUE_MISSION_START",
    reason: warm
      ? "Work-queue mission resumed in its own ChatGPT conversation."
      : parkedSnapshotPresent
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
  if (warmPlan) {
    rotation.warmResume = warm
      ? { ...warmPlan, state: "PLANNED", coldSessionSeq: sessionSeq + 1 }
      : { schema: warmPlan.schema, warm: false, code: warmPlan.code, state: "COLD" };
  }
  if (warm) rotation.coldPlan = coldPlan;
  process.sessionRotation = rotation;

  const pendingPrompt = await buildPendingA2A(process, {
    objective,
    messageType,
    operatorInstruction,
    previousResponseHash,
    previousDisposition,
    analysisEvidence,
    processStatusMode: item.resume?.processStatusRequest || "",
    // A warm resume continues the conversation: no fresh-chat rotation capsule.
    sessionRotation: parkedSnapshotPresent && !warm ? {
      ...rotation,
      sourceResponseState: rotation.sourceResponseState
    } : null,
    baselineAssistantHash: "",
    turn,
    windowQueueSource: queue
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
  auditSessionId = "",
  instructionLockProcessId = "",
  allowQueueEnable = false,
  operatorHandoff = false
}) {
  const boundary = await queueActivationEffectBoundary({ queue,item,windowId,priorProcess,allowQueueEnable,operatorHandoff });
  if (boundary.blocked) return boundary;
  // Serialize the inbox -> durable prompt transfer with operator edits. Analysis
  // already owns its process's instruction lock, including duplicate-GFW slots.
  const instructionOwnerProcessId = String(item.processSnapshot?.processId ||
    item.resume?.operatorInstruction?.processId || "");
  if (instructionOwnerProcessId && instructionOwnerProcessId !== instructionLockProcessId) {
    return instructionQueues.enqueue(instructionOwnerProcessId, () => activateQueueItem({
      queue, item, settings, windowId, priorProcess, auditSessionId,
      instructionLockProcessId: instructionOwnerProcessId, allowQueueEnable, operatorHandoff
    }));
  }
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

  // v1.8.7: a queue slot always starts in the EIC GPT. ChatGPT's newer shell
  // shows a pinned GPT at "/", so a tab at "/" no longer implies standard
  // chat and a generic root would open standard chat instead of EIC.
  const surfaceState = await readEicSurfaceState(chrome.storage.local).catch(() => ({ lastKnownGoodEicUrl: "" }));
  const gptRoot = resolveManagedGptRoot(tab.url || "", priorProcess?.gptRoot || "", surfaceState.lastKnownGoodEicUrl || "");
  // v1.8.9: with nothing remembered (e.g. a fresh install) the operator's GPT
  // selected at "/" has no id on the page; the rotation first finds its id.
  const eicDiscovery = gptRoot ? null : await planEicRootDiscovery(tab);
  if (!gptRoot && !eicDiscovery) {
    const error = new Error("EIC_GPT_ROOT_UNKNOWN");
    error.code = "EIC_GPT_ROOT_UNKNOWN";
    throw error;
  }

  // v1.8.5: the slot starts or resumes with its saved mission's current text
  // (bootstrap only; objective, continuation and receipts are untouched).
  const bootstrap = resolveSavedMissionReference(item, await currentSavedMissions());
  const parkedGoal = String(item.processSnapshot?.goal || "");
  const previousGoal = parkedGoal || String(item.goal || "");
  if (bootstrap.record && (bootstrap.record.goal !== item.goal || bootstrap.record.id !== item.savedMissionId)) {
    item = {
      ...item,
      goal: bootstrap.record.goal,
      label: bootstrap.record.label || item.label,
      savedMissionId: bootstrap.record.id
    };
  }
  const bootstrapRefresh = previousGoal !== item.goal;

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
  if (eicDiscovery) process.sessionRotation = { ...process.sessionRotation, eicDiscovery };

  const consumedProcessStatusRequest =
    String(item.resume?.processStatusRequest || "").toUpperCase() === PROCESS_STATUS_REQUEST;
  const consumedInstruction = process.pendingPrompt?.oneShotInstruction || null;
  const activeLogicalSavedMissionId = String(item.savedMissionId || "").trim();
  queue.items = queue.items.map((candidate) => {
    const sameLogicalMission = candidate.itemId === item.itemId ||
      Boolean(activeLogicalSavedMissionId &&
        String(candidate.savedMissionId || "").trim() === activeLogicalSavedMissionId);
    let clearedResume = consumedProcessStatusRequest && sameLogicalMission && candidate.resume
      ? { ...candidate.resume, processStatusRequest: "" }
      : candidate.resume;
    if (sameLogicalMission && consumedInstruction && clearedResume?.operatorInstruction) {
      // The inbox may supersede the parked copy; neither that copy nor any
      // duplicate slot may replay an older, explicitly replaced instruction.
      clearedResume = { ...clearedResume, operatorInstruction: null };
    }
    if (candidate.itemId === item.itemId) {
      const bootstrapText = {
        goal: item.goal,
        label: item.label,
        savedMissionId: item.savedMissionId
      };
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
        ...bootstrapText,
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

  // Composition and browser discovery are asynchronous. Check live ownership,
  // receipts and queue revision again before publishing a replacement process.
  const finalBoundary = await queueActivationEffectBoundary({ queue,item,windowId,priorProcess,
    expectedProcess:boundary.current,expectedQueue:boundary.liveQueue,operatorHandoff });
  if (finalBoundary.blocked) return finalBoundary;
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
      // v1.9.3: true only when this activation opens a fresh chat.
      freshChatRequired: process.sessionRotation?.warmResume?.warm !== true,
      interactionInQuantum: Number(process.queueContext?.interactionCount || 0) + 1,
      hardReloadBeforeResume: settings.queueSwitchHardReload === true,
      switchDelaySeconds: priorProcess?.queueContext?.itemId
        ? settings.queueSwitchDelaySeconds
        : 0,
      settleSeconds: settings.queueSwitchSettleSeconds
    }
  );
  // Consume only after the prompt and queue activation are both durable. If
  // either write fails, the slot/inbox retains the instruction for recovery.
  if (consumedInstruction && instructionOwnerProcessId && process.sessionRotation?.warmResume?.warm === true) {
    const cleared = await clearNextInstruction(instructionOwnerProcessId, consumedInstruction.instructionId);
    await audit(process, "NEXT_INSTRUCTION_CONSUMED_BY_QUEUE_ACTIVATION", "operator-input", {
      instructionId: consumedInstruction.instructionId,
      sourceProcessId: instructionOwnerProcessId,
      clearedFromInbox: cleared.cleared === true
    }).catch(() => undefined);
  }
  if (bootstrapRefresh) {
    await audit(process, "SAVED_MISSION_BOOTSTRAP_REFRESHED", "saved-missions", {
      itemId: item.itemId,
      savedMissionId: item.savedMissionId,
      key: savedMissionKey(item.goal),
      via: bootstrap.via,
      parked: Boolean(parkedGoal),
      previousGoalHash: await sha256Hex(previousGoal),
      goalHash: await sha256Hex(item.goal)
    }).catch(() => undefined);
  }
  await recordIncident(process, "QUEUE_ITEM_ACTIVATED", process.sessionRotation?.reasonCode || (item.processSnapshot ? "QUEUE_MISSION_RESUME" : "QUEUE_MISSION_START"), {
    warmResume: process.sessionRotation?.warmResume?.state === "PLANNED",
    resumeMode: String(process.sessionRotation?.warmResume?.code || ""),
    promptProfile: String(process.pendingPrompt?.promptProfile?.profile || ""),
    itemId: item.itemId,
    priorProcessId: priorProcess?.processId || "",
    resumed: Boolean(item.processSnapshot),
    activationCount: Number(process.queueContext?.activationCount || 0),
    maxInteractions: Number(item.maxInteractions || 0),
    interactionInQuantum: Number(process.queueContext?.interactionCount || 0) + 1,
    freshChat: process.sessionRotation?.warmResume?.warm !== true
  });
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
  if (queuePendingEffectNeedsReconciliation(current)) return { ok:false,
    code:"MISSION_QUEUE_PENDING_EFFECT_RECONCILIATION_REQUIRED",process:publicSnapshot(current) };
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
    auditSessionId,
    allowQueueEnable: true
  });
  if (activated.blocked) return { ok:false,code:activated.code,
    process:publicSnapshot(activated.process),missionQueue:publicMissionWorkQueue(activated.queue) };
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

function terminalQueueDispatchCandidate(process) {
  const pending=process?.pendingPrompt,dispatch=pending?.dispatch;
  if (process?.phase !== PHASES.BLOCKED || !process.queueContext?.itemId ||
      !["SESSION_ROTATION_PROMPT_EFFECT_UNKNOWN","SESSION_ROTATION_CHAT_READY_TIMEOUT",
        "SESSION_ROTATION_EIC_NOT_SELECTED"].includes(process.lastError?.code) ||
      process.storageRecoveryRequired || process.detached || process.safety?.qualityIncident ||
      process.greenfieldControl?.hardStop || process.lastDecision?.humanAuthorityRequired === true ||
      process.safety?.hold && process.safety.hold.code !== "DISPATCH_EFFECT_UNRESOLVED" ||
      !Number.isSafeInteger(process.generation) || process.generation < 1 ||
      process.generation >= Number.MAX_SAFE_INTEGER ||
      !pending?.text || !pending.hash || !dispatch?.operationId || !dispatch.materializedUserTurnId ||
      !Number.isSafeInteger(pending.sendAttempts) || pending.sendAttempts < 1 ||
      dispatch.effectPossible !== true || !process.safety?.turnProof?.allowed ||
      process.safety.turnProof.promptHash !== pending.hash) return false;
  let envelope;
  try {envelope=JSON.parse(pending.text);} catch {return false;}
  const identity=envelope.process,instruction=pending.oneShotInstruction;
  return validateA2AEnvelope(envelope).ok && JSON.stringify(envelope) === JSON.stringify(pending.a2a) &&
    envelope.mission === process.goal && envelope.correlationId === process.runId &&
    envelope.objective === process.objectiveState?.objective && identity.processId === process.processId &&
    identity.runId === process.runId && identity.generation === process.generation &&
    identity.turn === process.turn && identity.sessionSeq === process.sessionSeq &&
    (instruction ? instruction.instructionId === envelope.operatorInstruction?.instructionId &&
      instruction.text === envelope.operatorInstruction?.text : envelope.operatorInstruction === null);
}

function terminalQueueDispatchOwner(queue,process) {
  const item=queueItemForProcess(queue,process);
  return queue.enabled && queue.queueId === process.queueContext.queueId &&
    queue.workerId === process.workerId && queue.activeItemId === item?.itemId &&
    item?.status === QUEUE_STATUS.ACTIVE && item.savedMissionId === process.queueContext.savedMissionId;
}

async function recoverTerminalQueueDispatch(process,reason) {
  if (!terminalQueueDispatchCandidate(process) ||
      await sha256Hex(process.pendingPrompt.text) !== process.pendingPrompt.hash) return process;
  const queue=await loadMissionWorkQueue(process.windowId,chrome.storage.local,{workerId:process.workerId});
  const safety=await readSafety();
  const binding=await getWorkerBinding(process.windowId,chrome.storage.session);
  if (!terminalQueueDispatchOwner(queue,process) || binding?.workerId !== process.workerId ||
      safety.admissionPaused || safety.providerHold) return process;

  // Pending owns browser identity only in SENDING. This virtual view performs
  // observation; it never enters the dispatch branch or rewrites sent bytes.
  const sending={...process,phase:PHASES.SENDING};
  const expected=expectedAutonomousUserTurn(sending);
  let page,tab;
  try {
    await ensureContentBridgeVersion(process.tabId);
    const observed=await bridgeMessage(process.tabId,{type:"EIC_GF_GET_PAGE_STATE",
      source:"terminal-queue-dispatch-recheck",expectedUserTurnId:expected.id,
      expectedUserIndex:expected.index,expectedPromptMarker:expectedPromptMarker(sending)});
    if (observed?.ok) page=observed.state;
    tab=await chrome.tabs.get(process.tabId);
  } catch {}
  const current=await loadProcessForWindow(process.windowId);
  if (!isCurrentToken(current,ownerToken(process)) || JSON.stringify(current) !== JSON.stringify(process)) return current || process;
  const durableConversation=conversationKey(process.lastManagedUrl || "");
  const admissiblePage=(liveTab,policy)=>Boolean(page && liveTab &&
    liveTab.id === process.tabId && liveTab.windowId === process.windowId &&
    liveTab.status === "complete" && !liveTab.discarded && !liveTab.frozen &&
    page.url === liveTab.url && conversationKey(page.url) &&
    (!durableConversation || conversationKey(page.url) === durableConversation) &&
    page.bridgeVersion === APP_VERSION && !page.rateLimitWarning?.active &&
    Safety.eicSurfaceProof(page.modelEvidence,page.url,process.gptRoot).ok &&
    Safety.evaluateModel(page.modelEvidence,policy,{url:page.url,gptRoot:process.gptRoot}).allowed &&
    autonomousUserTurnProof(sending,page,{allowLegacyHash:false}).ok);
  if (!admissiblePage(tab,safety.policy)) return current;
  const reconciliation=reconcileDispatchObservation(sending,page);
  if (reconciliation.action !== "ADVANCE_TO_WAITING" ||
      reconciliation.resolvedUserTurnId !== process.pendingPrompt.dispatch.materializedUserTurnId) return current;

  const beforeSave=async()=>{
    const liveTab=await chrome.tabs.get(process.tabId).catch(()=>null);
    const [liveQueue,liveSafety,liveBinding,live]=await Promise.all([
      loadMissionWorkQueue(process.windowId,chrome.storage.local,{workerId:process.workerId}),readSafety(),
      getWorkerBinding(process.windowId,chrome.storage.session),loadProcessForWindow(process.windowId)]);
    if (!isCurrentToken(live,ownerToken(process)) || JSON.stringify(live) !== JSON.stringify(process) ||
        JSON.stringify(liveQueue) !== JSON.stringify(queue) || JSON.stringify(liveSafety.policy) !== JSON.stringify(safety.policy) ||
        !terminalQueueDispatchCandidate(live) || !terminalQueueDispatchOwner(liveQueue,live) ||
        liveBinding?.workerId !== process.workerId || liveSafety.admissionPaused || liveSafety.providerHold ||
        !admissiblePage(liveTab,liveSafety.policy)) return {blocked:true,process:live || process};
    return {blocked:false};
  };
  const proof=Safety.evaluateModel(page.modelEvidence,safety.policy,{url:page.url,gptRoot:process.gptRoot});
  const resumed={...sending,generation:process.generation+1,completedAt:null,lastManagedUrl:page.url,
    safety:{...process.safety,proof,evidence:page.modelEvidence,lastObservationAtMs:Date.now()},
    terminalDispatchRecovery:{version:1,atMs:Date.now(),reason,priorError:deepClone(process.lastError),
      priorCompletedAt:process.completedAt,priorGeneration:process.generation,
      promptHash:process.pendingPrompt.hash,receipt:deepClone(process.pendingPrompt.dispatch),
      conversationUrl:page.url,turnProof:reconciliation.turnProof.code,automaticResend:false}};
  // Reuse the ordinary proven-effect handoff. Generic BLOCKED transition
  // rules remain closed. The guard runs after ledger calls and audit awaits.
  const next=await commitObservedDispatchToWaiting(resumed,page,reconciliation,{beforeSave});
  if (next?.phase === PHASES.WAITING && next.generation === resumed.generation) {
    await consumeCheckpointedInstructions(next);
    await audit(next,"TERMINAL_QUEUE_DISPATCH_RECONCILED","migration",{
      reason,promptHash:next.lastPrompt.hash,dispatchId:next.lastPrompt.dispatchId,
      priorGeneration:process.generation,generation:next.generation,automaticResend:false
    }).catch(()=>undefined);
  }
  return next;
}

// Complete an interrupted terminal publication, rather than reopen BLOCKED
// generally. Reuse the two existing narrowly classified legacy candidates;
// queue parking alone never authorizes or dispatches their continuation.
async function reconcileRetryableTerminalQueueSlot(process, reason) {
  if (!process?.queueContext?.itemId || process.phase !== PHASES.BLOCKED) return null;
  const classified = (value) => {
    const standaloneView = { ...value, queueContext: null };
    return legacyAdvisoryBlockedCandidate(standaloneView) || legacyRotationBlockedCandidate(standaloneView);
  };
  if (!classified(process) || queuePendingEffectNeedsReconciliation(process)) return null;
  return queues.enqueue(process.processId, async () => {
    const current = await loadProcessForWindow(process.windowId);
    if (JSON.stringify(current) !== JSON.stringify(process)) return { process: current || process };
    const queue = await loadMissionWorkQueue(process.windowId, chrome.storage.local, { workerId:process.workerId });
    const binding = await getWorkerBinding(process.windowId, chrome.storage.session);
    const safety = await readSafety();
    if (!terminalQueueDispatchOwner(queue,current) || binding?.workerId !== current.workerId ||
        safety.admissionPaused || safety.providerHold) return null;
    for (const prompt of [current.pendingPrompt,current.lastPrompt,current.lastResponse].filter(Boolean)) {
      if (!prompt.text || !prompt.hash || await sha256Hex(prompt.text) !== prompt.hash) return null;
    }
    const finalized = await finalizeQueueTerminalAndMaybeAdvance(current);
    await audit(current,"MISSION_QUEUE_INTERRUPTED_BLOCKER_PUBLICATION_RECONCILED","migration",{
      reason,itemId:current.queueContext.itemId,priorError:current.lastError?.code || "",automaticResend:false
    }).catch(() => undefined);
    return { process: finalized };
  });
}

async function wakeMissionQueue(windowId, reason = "QUEUE_WAKE_ALARM") {
  let process = await loadProcessForWindow(windowId);
  await acceptPendingMissionDelegationsForQueue(windowId, await missionQueueForWindow(windowId), process);
  process = await loadProcessForWindow(windowId);
  if (terminalQueueDispatchCandidate(process)) {
    return queues.enqueue(process.processId,async()=>{
      const current=await loadProcessForWindow(windowId);
      return recoverTerminalQueueDispatch(current,reason);
    });
  }
  if (queuePendingEffectNeedsReconciliation(process)) return process;
  const reconciled = await reconcileRetryableTerminalQueueSlot(process,reason);
  if (reconciled) return reconciled.process;
  if (process && !TERMINAL_PHASES.has(process.phase)) {
    if (process.phase === PHASES.PAUSED && process.queueContext?.itemId) {
      // Serialize with the active tick, then the instruction mailbox. A
      // newly runnable slot must not wait behind another GFW's process pause.
      return queues.enqueue(process.processId, async () =>
        await advancePausedQueueMission(process.processId) || loadProcessForWindow(windowId));
    }
    return process;
  }
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
  if (activated.blocked) return activated.process;
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
    case "ADD": {
      // v1.8.5: a saved mission is added with its current text.
      const saved = resolveSavedMissionReference(
        { savedMissionId: payload.savedMissionId, goal: payload.goal },
        await currentSavedMissions()
      ).record;
      queue = await addMissionWorkItem(windowId, saved?.goal || payload.goal, {
        storage: chrome.storage.local,
        workerId: worker.workerId,
        priority: payload.priority || DEFAULT_GREENFIELD_PRIORITY,
        maxInteractions: payload.maxInteractions ?? settings.defaultMissionQuantumInteractions,
        savedMissionId: saved?.id || payload.savedMissionId || "",
        label: saved?.label || payload.label || ""
      });
      break;
    }
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

// v1.8.5: the panel saved, imported or deleted saved missions. Stored queue
// sets and this window's queue slots take the current text; merged duplicate
// ids follow their target. A running process keeps its text until the slot's
// next activation (activateQueueItem).
async function savedMissionsChanged({ windowId, merged = {}, reason = "", auditSessionId = "" } = {}) {
  const savedMissions = await currentSavedMissions();
  const mergedMap = Object.fromEntries(Object.entries(merged && typeof merged === "object" ? merged : {})
    .map(([from, to]) => [String(from).slice(0, 200), String(to).slice(0, 200)])
    .filter(([from, to]) => from && to));
  const { store, summary } = await reconcileMissionQueueSetsWithSavedMissions(
    savedMissions,
    { merged: mergedMap },
    chrome.storage.local
  );

  const { queue, settings, worker } = await missionQueueForWindow(windowId);
  const slots = reconcileItemsWithSavedMissions(queue.items, savedMissions, { merged: mergedMap });
  let missionQueue = queue;
  if (slots.changes.length) {
    missionQueue = await saveMissionWorkQueue({ ...queue, items: slots.items }, chrome.storage.local, {
      defaultMaxInteractions: settings.defaultMissionQuantumInteractions
    });
  }

  await appendAudit({
    scope: "WINDOW",
    auditSessionId: auditSessionId || BACKGROUND_AUDIT_SESSION_ID,
    windowId,
    kind: "SAVED_MISSIONS_RECONCILED",
    component: "saved-missions",
    payload: {
      reason: String(reason || "").slice(0, 80),
      savedMissionCount: savedMissions.length,
      mergedIds: Object.keys(mergedMap).length,
      queueSets: summary,
      queueSlotsChanged: slots.changes.length,
      queueSlotsUnresolved: slots.unresolved.length,
      workerId: worker.workerId
    }
  }).catch(() => undefined);

  return {
    ok: true,
    summary: {
      setsChanged: summary.setsChanged,
      setItemsChanged: summary.itemsChanged,
      setItemsUnresolved: summary.unresolved,
      queueSlotsChanged: slots.changes.length,
      queueSlotsUnresolved: slots.unresolved.length
    },
    missionQueue: publicMissionWorkQueue(missionQueue),
    missionQueueSets: publicMissionQueueSets(store)
  };
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

  // v1.8.5: sets store and load the saved missions' current text.
  const savedMissions = await currentSavedMissions();
  const resolvedQueue = { ...queue, items: reconcileItemsWithSavedMissions(queue.items, savedMissions).items };
  let resolvedItems = 0;

  if (op === "SAVE") {
    const saved = await saveMissionQueueSet({ name, queue: resolvedQueue, setId }, chrome.storage.local);
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
    const saved = await saveMissionQueueSet({ name: existing.name, queue: resolvedQueue, setId: existing.setId }, chrome.storage.local);
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
    const resolvedSet = reconcileItemsWithSavedMissions(set.items, savedMissions);
    resolvedItems = resolvedSet.changes.length;
    missionQueue = applyMissionQueueSet(queue, { ...set, items: resolvedSet.items }, {
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
      queueId: missionQueue.queueId,
      savedMissionTextResolvedItems: resolvedItems
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
      // v1.9.3: the request is appended to this same window's queue on a
      // later tick of this worker, never inside the delegating answer.
      targetQueue: "SAME_WINDOW_QUEUE",
      selfQueueMutation: false
    }).catch(() => undefined);
    scheduleFast(process.processId, 100);
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

async function acceptPendingMissionDelegationsForQueue(targetWindowId, queueState, process = null) {
  const queueId = String(queueState?.queue?.queueId || "");
  if (!Number.isInteger(Number(targetWindowId)) || !queueId || !queueState.queue.enabled) return queueState?.queue || null;
  const context = process || { windowId: targetWindowId, workerId: queueState.worker.workerId,
    auditSessionId: BACKGROUND_AUDIT_SESSION_ID };
  // Queue ownership, not a live process phase, controls admission. Serialize
  // the whole bounded pass so wake/recovery/tick cannot double-claim a row.
  return missionDelegationQueues.enqueue(`queue:${queueId}`, async () => {
    let latest = queueState.queue;
    const registry = await loadMissionDelegationRegistry(chrome.storage.local);
    if (!registry.items.some(row => ["PENDING", "ASSIGNED"].includes(row.state) &&
        (row.sourceQueueId === queueId || row.targetQueueId === queueId))) return latest;
    const liveTargetQueueIds = [];
    for (const window of await chrome.windows.getAll({})) {
      const bound = window.id === Number(targetWindowId) ? queueState : await missionQueueForWindow(window.id);
      if (bound.queue.enabled) liveTargetQueueIds.push(bound.queue.queueId);
    }
    for (let index = 0; index < MAX_MISSION_DELEGATIONS; index++) {
      const bound = await missionQueueForWindow(targetWindowId);
      if (!bound.queue.enabled || bound.queue.queueId !== queueId ||
          bound.worker.workerId !== queueState.worker.workerId) break;
      latest = bound.queue;
      let delegation;
      try {
        const claim = await missionDelegationQueues.enqueue("registry", () =>
          claimPendingMissionDelegationForWorker({ targetWindowId, targetQueueId: queueId }, chrome.storage.local, {
            liveTargetQueueIds, queueFull: latest.items.length >= MAX_QUEUE_ITEMS,
            targetQueueRequestIds: [...latest.items, ...latest.history].map(item => item.delegation?.requestId).filter(Boolean)
          }));
        delegation = claim.delegation;
      } catch (error) {
        await audit(context, "MISSION_DELEGATION_CLAIM_FAILED", "mission-delegation", { error: errorRecord(error) }).catch(() => undefined);
        break;
      }
      if (!delegation) break;
      try {
        // Operator stop/rebind during the claim wins before queue insertion.
        const fresh = await missionQueueForWindow(targetWindowId);
        if (!fresh.queue.enabled || fresh.queue.queueId !== queueId ||
            fresh.worker.workerId !== queueState.worker.workerId) {
          throw Object.assign(new Error("MISSION_DELEGATION_QUEUE_CHANGED"), { code: "MISSION_DELEGATION_QUEUE_CHANGED" });
        }
        latest = await addMissionWorkItem(targetWindowId, delegation.mission, {
          storage: chrome.storage.local, workerId: fresh.worker.workerId,
          priority: delegation.priority, maxInteractions: fresh.settings.defaultMissionQuantumInteractions,
          label: delegation.label || "EIC-delegerat uppdrag",
          delegation: { requestId: delegation.requestId, relation: delegation.relation,
            sourceWindowId: delegation.sourceWindowId, sourceQueueId: delegation.sourceQueueId,
            sourceItemId: delegation.sourceItemId, sourceProcessId: delegation.sourceProcessId,
            createdBy: "EIC_DELEGATED_FROM_OTHER_GFW", createdAt: delegation.createdAt }
        });
        const targetItem = [...latest.items, ...latest.history].find(item => item.delegation?.requestId === delegation.requestId);
        if (!targetItem) throw new Error("MISSION_DELEGATION_TARGET_ITEM_READBACK_MISSING");
        await missionDelegationQueues.enqueue("registry", () => targetItem.status === QUEUE_STATUS.DONE
          ? markMissionDelegationCompleted(delegation.requestId, chrome.storage.local)
          : markMissionDelegationApplied(delegation.requestId, targetItem.itemId, chrome.storage.local));
        await syncMissionQueueWakeAlarm(latest).catch(() => undefined);
        await audit(context, "MISSION_DELEGATION_ACCEPTED_BY_WORKER", "mission-delegation", {
          requestId: delegation.requestId, relation: delegation.relation,
          sourceWindowId: delegation.sourceWindowId, sourceQueueId: delegation.sourceQueueId,
          sourceItemId: delegation.sourceItemId, targetWindowId, targetQueueId: latest.queueId,
          targetItemId: targetItem.itemId, targetStatus: targetItem.status,
          sameWindowAsSource: delegation.sourceQueueId === latest.queueId
        }).catch(() => undefined);
      } catch (error) {
        await missionDelegationQueues.enqueue("registry", () => releaseMissionDelegation(
          delegation.requestId, errorRecord(error), chrome.storage.local)).catch(() => undefined);
        await audit(context, "MISSION_DELEGATION_WORKER_ACCEPT_FAILED", "mission-delegation", {
          requestId: delegation.requestId, error: errorRecord(error)
        }).catch(() => undefined);
      }
    }
    return latest;
  });
}

async function acceptPendingMissionDelegationForWorker(process) {
  if (!process?.queueContext?.itemId || !process.queueContext.queueId) return process;
  try {
    const state = await missionQueueForWindow(process.windowId);
    if (state.queue.queueId !== process.queueContext.queueId || !state.queue.enabled) return process;
    await acceptPendingMissionDelegationsForQueue(process.windowId, state, process);
    const current = await loadProcessForWindow(process.windowId);
    if (current?.processId !== process.processId) return current || process;
    // Existing pause recovery owns its instruction/effect/deadline guards.
    if (current.phase === PHASES.PAUSED) return await advancePausedQueueMission(current.processId) || current;
    return current;
  } catch (error) {
    await audit(process, "MISSION_DELEGATION_CLAIM_FAILED", "mission-delegation", { error: errorRecord(error) }).catch(() => undefined);
    return await loadProcessForWindow(process.windowId) || process;
  }
}

async function makeDelegationSourceRetryable(delegation, targetProcess) {
  if (String(delegation?.relation || "") !== MISSION_DELEGATION_RELATION.UNBLOCKS_CURRENT) return;
  const sameQueue = Boolean(delegation?.sourceQueueId) &&
    String(delegation.sourceQueueId) === String(targetProcess?.queueContext?.queueId || "");
  // Numeric window ids change across Chrome restarts; the stable queue id
  // proves same-queue ownership, so use the finishing child's live window.
  const sourceWindowId = Number(sameQueue ? targetProcess?.windowId : delegation?.sourceWindowId);
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
  // Same-queue terminal finalization owns the next selection and activation.
  // A detached wake here races that owner and writes the worker process twice.
  if (!sameQueue) {
    void wakeMissionQueue(sourceWindowId, "DELEGATED_UNBLOCKER_COMPLETED").catch(() => undefined);
  }
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
  scheduleBlock = "",
  outcomeOverride = ""
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
  const outcome = outcomeOverride || (scheduleBlock
    ? scheduleParkOutcome(scheduleBlock)
    : requestedSessionAction === "BACKGROUND_SLEEP"
    ? "EIC_BACKGROUND_SLEEP"
    : requestedSessionAction === "YIELD_TO_QUEUE"
      ? "EIC_YIELD_TO_QUEUE"
      : requestedSessionAction === "PAUSE_PROCESS"
        ? "EIC_PAUSE_PARKED"
        : quantumReached
          ? "QUANTUM_EXHAUSTED"
          : "MISSION_QUEUE_PARKED");
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
    instructionLockProcessId: current.processId,
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
  instructionLockProcessId = "",
  parkDetail = {},
  idleWhenNoNext = false,
  operatorHandoff = false
}) {
  const now = Date.now();
  // Park is not instruction delivery. Keep a restart-safe copy on every slot
  // of this logical GFW; an unsent pending prompt may own an earlier instruction.
  const pendingInstruction = current.pendingPrompt?.dispatch?.acknowledged === true
    ? null : current.pendingPrompt?.oneShotInstruction;
  const parkedInstruction = latestInstruction || await readNextInstruction(current.processId) ||
    pendingInstruction || resume?.operatorInstruction || item.resume?.operatorInstruction || null;
  const parkedResume = parkedInstruction ? {
    ...(resume || {}),
    operatorInstruction: { ...deepClone(parkedInstruction), processId: current.processId }
  } : resume;

  // The scheduling slot owns quantum progress, while savedMissionId owns the
  // logical continuation. Duplicate slots therefore share the newest mission
  // checkpoint without sharing independent counters/timing.
  queue.items = applyQueueParkTransition(queue.items, item, {
    pauseUntilMs,
    resumedQuantumProgress,
    parkedSnapshot,
    resume: parkedResume,
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
  await recordIncident(current, "QUEUE_SLOT_PARKED", outcome, {
    itemId: item.itemId,
    nextItemId: selected?.itemId || "",
    queueWait: !selected,
    pauseUntilMs: Number(pauseUntilMs || 0),
    interactionCount: Number(current.queueContext?.interactionCount ?? 0),
    maxInteractions: Number(current.queueContext?.maxInteractions ?? 0)
  });
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
    auditSessionId: current.auditSessionId,
    instructionLockProcessId,
    operatorHandoff
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
  const times = (queue?.items || []).filter(item=>!queueItemNeedsEffectReconciliation(queue,item))
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
async function parkQueueMissionForSchedule(process, block, overrides = {}) {
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
    overrides.objective ||
    process.objectiveState?.objective ||
    process.lastDecision?.nextPrompt ||
    process.goal ||
    ""
  ).trim();
  const resume = {
    ...queueResumeRecordFromAnalysis({
      current: process,
      effectiveNextPrompt: objective,
      previousDisposition: overrides.previousDisposition || process.lastDecision?.disposition || "CONTINUE",
      analysisEvidence: null,
      sessionReason: overrides.previousDisposition || block
    }),
    ...(overrides.sourceResponseState ? { sourceResponseState: overrides.sourceResponseState, processStatusRequest: "" } : {})
  };
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
    outcome: overrides.outcome || scheduleParkOutcome(block),
    summary: overrides.summary || (block === SCHEDULE_BLOCK.PAUSED
      ? "The slot's pauseUntil began before the next prompt; the slot was parked."
      : "The slot's run window closed before the next prompt; the slot was parked."),
    resumedQuantumProgress,
    idleWhenNoNext: true,
    parkDetail: { maxInteractions, scheduleBlock: block, dispatchGate: !overrides.outcome, overrideOutcome: overrides.outcome || "" }
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
  const current = await loadProcessForWindow(process.windowId);
  if (!isCurrentToken(current,ownerToken(process)) || JSON.stringify(current) !== JSON.stringify(process)) return current || process;
  if (queuePendingEffectNeedsReconciliation(current)) {
    await audit(current,"MISSION_QUEUE_TERMINAL_EFFECT_HELD","mission-work-queue",{
      code:"MISSION_QUEUE_PENDING_EFFECT_RECONCILIATION_REQUIRED",automaticResend:false,
      dispatchId:current.pendingPrompt?.dispatch?.operationId || "",promptHash:current.pendingPrompt?.hash || ""
    }).catch(()=>undefined);
    return current;
  }
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
    const baseResume = queueResumeRecordFromAnalysis({
      current: process,
      effectiveNextPrompt: process.objectiveState?.objective || process.goal,
      previousDisposition: process.lastDecision?.disposition || "BLOCKED",
      analysisEvidence: null,
      sessionReason: lastOutcome
    });
    // Local inbox acknowledgement means that the prompt claimed an instruction,
    // not that ChatGPT received it. Preserve it on every logical duplicate.
    const instruction = await readNextInstruction(process.processId) || process.pendingPrompt?.oneShotInstruction ||
      item.resume?.operatorInstruction || null;
    const resume = instruction ? { ...baseResume,operatorInstruction:deepClone(instruction) } : baseResume;
    const blockedQueue = requeueBlockedMissionWorkItem(queue, item.itemId, {
      processSnapshot: deepClone(process),
      resume,
      lastOutcome,
      lastSummary,
      lastError: process.lastError ? deepClone(process.lastError) : null,
      retryAfterSeconds: settings.queuePriorityAgingSeconds
    });
    const beforePark = await queueActivationEffectBoundary({ queue,item,
      windowId:process.windowId,priorProcess:process });
    if (beforePark.blocked) return beforePark.process;
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
  // Completing an unblocker can update the same queue. Never select or persist
  // an activation from the pre-completion snapshot/revision.
  const selectionQueue = finalized.delegation?.relation === MISSION_DELEGATION_RELATION.UNBLOCKS_CURRENT &&
      String(finalized.delegation?.sourceQueueId || "") === String(saved.queueId || "")
    ? (await missionQueueForWindow(process.windowId)).queue
    : saved;
  await cancelSchedulerProcess(process, `MISSION_QUEUE_${queueStatus}`).catch(() => undefined);
  try { await chrome.alarms.clear(alarmName(process.processId)); } catch {}
  try { await chrome.alarms.clear(missionPauseAlarmName(process.processId)); } catch {}

  if (!selectionQueue.enabled || process.phase === PHASES.AUDIT_FAILURE) return process;
  const nextItem = selectNextMissionItem(selectionQueue, {
    afterOrder: selectionQueue.cursorOrder
  });
  if (!nextItem) return process;
  const activated = await activateQueueItem({
    queue: selectionQueue,
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
  const surfaceState = await readEicSurfaceState(chrome.storage.local).catch(() => ({ lastKnownGoodEicUrl: "" }));
  const gptRoot = resolveManagedGptRoot(tab?.url || "", process.gptRoot || "", surfaceState.lastKnownGoodEicUrl || "");
  return { gptRoot, tab };
}

// v1.8.7: a tab belongs to a process's GPT when it shows the same GPT id, or
// no GPT id at all (a session rotation navigates such a tab to the GPT).
function tabMatchesGptRoot(url, gptRoot) {
  if (!customGptRoot(url)) return true;
  return Boolean(customGptRoot(gptRoot)) && sameGpt(url, gptRoot);
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
  processStatusMode = "",
  beforeSave = null
} = {}) {
  if (!process || TERMINAL_PHASES.has(process.phase)) return process;
  if (process.phase === PHASES.ROTATING) return process;
  if (isInitializationPrompt(process.pendingPrompt) || waitingForInitialization(process)) {
    const work = process.sessionInitialization?.workPrompt;
    operatorInstruction ||= work?.oneShotInstruction || null;
    objective ||= work?.a2a?.objective || process.objectiveState?.objective || process.goal;
  }
  await recordIncident(process, "SESSION_ROTATION_ARMED", reasonCode, {
    requestedBy,
    fromPhase: String(process.phase || ""),
    sourceResponseState: String(sourceResponseState || ""),
    queueItemId: process.queueContext?.itemId || ""
  });

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
    missionPause: process.missionPause?.resumeSessionAction
      ? { ...process.missionPause, resumeSessionAction: "" }
      : process.missionPause,
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
    missionPause: virtual.missionPause,
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
    beforeSave,
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

// v1.9.0: the conversation a planned warm resume returns to ("" = cold).
function warmResumeTarget(rotation) {
  const warm = rotation?.warmResume;
  return warm?.warm === true && ["PLANNED", "NAVIGATING"].includes(String(warm.state || ""))
    ? String(warm.conversationUrl || "")
    : "";
}

// v1.9.0: the GFW's conversation could not be proven or used; nothing was
// sent. Rebuild exactly the cold prompt (fresh chat, FULL, rotation capsule)
// from the inputs kept at activation and restart the rotation as before.
async function abandonWarmResume(process, rotation, code, detail = {}) {
  const plan = rotation.coldPlan || {};
  const coldSessionSeq = Number(rotation.warmResume?.coldSessionSeq || Number(process.sessionSeq || 1) + 1);
  const coldRotation = {
    ...rotation,
    reasonCode: "QUEUE_MISSION_RESUME",
    reason: `Work-queue mission resumed in a fresh ChatGPT conversation (warm resume not possible: ${code}).`,
    state: SESSION_ROTATION_STATES.ARMED,
    sessionSeq: coldSessionSeq,
    navigationStartedAt: "",
    freshnessRetryCount: 0,
    eicLanding: null,
    hardReloadState: rotation.hardReloadBeforeResume === true ? "PENDING" : "DISABLED",
    warmResume: {
      ...(rotation.warmResume || {}),
      state: "ABANDONED",
      abandonCode: String(code || ""),
      abandonedAt: nowIso()
    },
    coldPlan: null
  };
  const coldProcess = {
    ...process,
    sessionSeq: coldSessionSeq,
    sessionHealth: resetSessionHealthForRotation(process.sessionHealth, {
      sessionSeq: coldSessionSeq,
      sessionStartTurn: Number(process.turn || 0),
      now: Date.now()
    })
  };
  const objective = String(plan.objective || "").trim() ||
    sessionRotationObjective(process.objectiveState?.objective || process.goal);
  const pendingPrompt = await buildPendingA2A(coldProcess, {
    objective,
    messageType: "SESSION_ROTATION",
    operatorInstruction: plan.operatorInstruction || process.pendingPrompt?.oneShotInstruction || null,
    previousResponseHash: plan.previousResponseHash || process.lastResponse?.hash || "",
    previousDisposition: plan.previousDisposition || "CONTINUE",
    analysisEvidence: plan.analysisEvidence || null,
    processStatusMode: plan.processStatusMode || "",
    sessionRotation: { ...coldRotation, sourceResponseState: coldRotation.sourceResponseState },
    baselineAssistantHash: "",
    turn: Number(process.turn || 0)
  });
  const next = await saveRotationState({
    ...coldProcess,
    pendingPrompt,
    objectiveState: {
      ...(process.objectiveState || {}),
      objectiveId: pendingPrompt.a2a?.objectiveId || process.objectiveState?.objectiveId || "",
      objective,
      status: "PENDING",
      updatedAt: nowIso()
    }
  }, coldRotation, "WARM_RESUME_ABANDONED", {
    rotationId: rotation.rotationId,
    code,
    conversationKey: rotation.warmResume?.conversationKey || "",
    noPromptSent: true,
    ...detail
  });
  await recordIncident(next, "WARM_RESUME_ABANDONED", code, {
    navigationAgeMs: Number(detail.navigationAgeMs || 0),
    observedConversation: Boolean(detail.observedConversationKey),
    sameConversation: detail.observedConversationKey === rotation.warmResume?.conversationKey
  });
  scheduleFast(next.processId, 300);
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

// v1.8.9: EIC root discovery. ChatGPT's newer shell shows a GPT selected at
// "/" by name only (composer pill + page header); its id appears in the URL of
// its conversations (/g/g-<id>/c/<conv>). When no root is remembered, the
// queue start opens up to 3 GPT conversations from the sidebar's "Senaste"
// and binds the id whose page (id in the URL) shows the selected GPT's name.
// Nothing is sent before the id is bound; without a match the queue stops.
const EIC_DISCOVERY_CANDIDATE_MS = 20_000;

async function planEicRootDiscovery(tab) {
  let page = null;
  try {
    await ensureContentBridgeVersion(tab.id);
    const result = await bridgeMessage(tab.id, { type: "EIC_GF_GET_PAGE_STATE", source: "eic-root-discovery-plan" });
    page = result?.ok ? result.state || {} : null;
  } catch {}
  const surface = page?.modelEvidence?.gptSurface || {};
  const name = String(surface.composerName || "").trim();
  if (!page || surface.ambiguous === true || !name || name !== String(surface.headerName || "").trim()) return null;
  const slug = Safety.gptNameSlug(name);
  const origin = supportedUrl(page.url || tab.url) ? new URL(page.url || tab.url).origin : "";
  if (!slug || !origin) return null;
  let links = null;
  try { links = await bridgeMessage(tab.id, { type: "EIC_GF_GPT_CONVERSATION_LINKS" }); } catch {}
  const candidates = (Array.isArray(links?.candidates) ? links.candidates : [])
    .map((candidate) => ({ gptId: String(candidate?.gptId || ""), href: String(candidate?.href || "") }))
    .filter((candidate) => /^g-[A-Za-z0-9]+$/.test(candidate.gptId) &&
      candidate.href.startsWith(`/g/${candidate.gptId}`) && /\/c\/[A-Za-z0-9-]+$/.test(candidate.href))
    .slice(0, 3);
  if (!candidates.length) return null;
  return { state: "PENDING", name, slug, origin, candidates, index: 0, tried: [], startedAtMs: Date.now() };
}

async function failEicRootDiscovery(process, reason) {
  // Every slot would need the same unknown address: stop the queue instead of
  // blocking one slot after the other.
  try {
    const { queue, settings } = await missionQueueForWindow(process.windowId);
    if (queue.enabled) {
      queue.enabled = false;
      await persistMissionQueue(queue, settings, process, "MISSION_QUEUE_STOPPED_EIC_ROOT_UNKNOWN", { reason });
    }
  } catch {}
  const discovery = process.sessionRotation?.eicDiscovery || {};
  const error = Object.assign(new Error("EIC_GPT_ROOT_UNKNOWN"), { code: "EIC_GPT_ROOT_UNKNOWN" });
  return commitTransition(process, PHASES.BLOCKED, { lastError: errorRecord(error) }, {
    kind: "EIC_ROOT_DISCOVERY_FAILED",
    component: "session-rotation",
    detail: { reason, name: discovery.name || "", tried: discovery.tried || [] }
  });
}

async function tickEicRootDiscovery(process, rotation) {
  const d = rotation.eicDiscovery;
  const candidate = d.candidates?.[d.index];
  if (!candidate) return failEicRootDiscovery(process, "NO_CANDIDATE_SHOWS_GPT");
  let tab = null;
  try {
    tab = await chrome.tabs.get(process.tabId);
    if (tab.windowId !== process.windowId) tab = null;
  } catch {}
  if (!tab) return failEicRootDiscovery(process, "MANAGED_TAB_LOST");
  const now = Date.now();
  if (d.state === "PENDING") {
    const next = await saveRotationState(process, {
      ...rotation,
      eicDiscovery: { ...d, state: "NAVIGATING", navigatedAtMs: now }
    }, "EIC_ROOT_DISCOVERY_CANDIDATE_OPENED", { gptId: candidate.gptId, candidate: d.index + 1, of: d.candidates.length, name: d.name });
    try {
      await chrome.tabs.update(tab.id, { url: `${d.origin}${candidate.href}` });
    } catch (error) {
      return enterRecovery(next, error, PHASES.ROTATING);
    }
    scheduleFast(next.processId, 1500);
    return next;
  }

  let page = null;
  if (tab.status === "complete") {
    try {
      await ensureContentBridgeVersion(tab.id);
      const result = await bridgeMessage(tab.id, { type: "EIC_GF_GET_PAGE_STATE", source: "eic-root-discovery" });
      page = result?.ok ? result.state || {} : null;
    } catch {}
  }
  const observed = Safety.gptRef(page?.url || "");
  const surface = page?.modelEvidence?.gptSurface || {};
  const names = [surface.headerName, surface.composerName].map((value) => String(value || "").trim()).filter(Boolean);
  const slugs = [...new Set(names.map((value) => Safety.gptNameSlug(value)))];
  const shownSlug = surface.ambiguous === true || slugs.length !== 1 ? "" : slugs[0];
  const onCandidate = Boolean(observed && observed.id === candidate.gptId);
  if (onCandidate && shownSlug === d.slug) {
    const root = observed.slug === d.slug ? observed.root : `${observed.origin}/g/${observed.id}-${d.slug}`;
    await rememberGoodEicUrl(root, chrome.storage.local).catch(() => undefined);
    const next = await saveRotationState({ ...process, gptRoot: root }, {
      ...rotation,
      gptRoot: root,
      eicDiscovery: { ...d, state: "BOUND", root, boundAtMs: now }
    }, "EIC_ROOT_DISCOVERED", { gptId: observed.id, name: d.name, root, candidate: d.index + 1 });
    scheduleFast(next.processId, 200);
    return next;
  }
  const otherName = onCandidate && shownSlug && shownSlug !== d.slug;
  if (otherName || now - Number(d.navigatedAtMs || now) >= EIC_DISCOVERY_CANDIDATE_MS) {
    const result = otherName ? "OTHER_GPT_NAME" : "NO_PROOF_IN_TIME";
    const tried = [...(d.tried || []), { gptId: candidate.gptId, result }];
    const next = await saveRotationState(process, {
      ...rotation,
      eicDiscovery: { ...d, state: "PENDING", index: d.index + 1, tried }
    }, "EIC_ROOT_DISCOVERY_CANDIDATE_REJECTED", { gptId: candidate.gptId, result });
    if (!d.candidates[d.index + 1]) return failEicRootDiscovery(next, "NO_CANDIDATE_SHOWS_GPT");
    scheduleFast(next.processId, 200);
    return next;
  }
  scheduleFast(process.processId, 1000);
  return process;
}

// v1.8.7: a fresh chat that is not the EIC GPT is steered to it, in order:
// the GPT address without its name slug (the form the newer ChatGPT shell
// uses), then a click on the pinned GPT in the sidebar (content script), at
// most EIC_LANDING_MAX_SELECTS times, EIC_LANDING_SELECT_GAP_MS apart. The
// operator may also select EIC by hand. Never sends in standard chat; after
// EIC_LANDING_TIMEOUT_MS the rotation blocks with a specific code.
const EIC_LANDING_TIMEOUT_MS = 120_000;
const EIC_LANDING_SELECT_GAP_MS = 4_000;
const EIC_LANDING_MAX_SELECTS = 3;

async function steerRotationToEic(process, rotation, tab, gptRoot, landing, page) {
  const now = Date.now();
  const prior = rotation.eicLanding || {};
  const eicLanding = {
    firstUnverifiedAtMs: Number(prior.firstUnverifiedAtMs || now),
    lastKind: landing.kind,
    observedUrl: String(page?.url || tab.url || "").slice(0, 300),
    canonicalNavigated: prior.canonicalNavigated === true,
    selectAttempts: Number(prior.selectAttempts || 0),
    lastSelectAtMs: Number(prior.lastSelectAtMs || 0),
    lastSelect: prior.lastSelect || null
  };
  const canonical = canonicalGptRoot(gptRoot);
  if (!eicLanding.canonicalNavigated && canonical && canonical !== gptRoot) {
    eicLanding.canonicalNavigated = true;
    const next = await saveRotationState(process, { ...rotation, eicLanding }, "SESSION_ROTATION_EIC_LANDING_CANONICAL_NAVIGATE", {
      rotationId: rotation.rotationId,
      kind: landing.kind,
      observedUrl: eicLanding.observedUrl,
      url: canonical
    });
    await chrome.tabs.update(tab.id, { url: canonical }).catch(() => undefined);
    scheduleFast(next.processId, 1500);
    return next;
  }
  if (eicLanding.selectAttempts < EIC_LANDING_MAX_SELECTS && now - eicLanding.lastSelectAtMs >= EIC_LANDING_SELECT_GAP_MS) {
    let result;
    try {
      result = await bridgeMessage(tab.id, { type: "EIC_GF_SELECT_GPT", slug: gptSlug(gptRoot) });
    } catch (error) {
      result = { ok: false, code: String(error?.code || error?.message || "BRIDGE_ERROR").slice(0, 120) };
    }
    eicLanding.selectAttempts += 1;
    eicLanding.lastSelectAtMs = now;
    eicLanding.lastSelect = {
      ok: result?.ok === true,
      clicked: result?.clicked === true,
      code: String(result?.code || ""),
      candidates: Number(result?.candidates || 0)
    };
    const next = await saveRotationState(process, { ...rotation, eicLanding }, "SESSION_ROTATION_EIC_SELECT_ATTEMPT", {
      rotationId: rotation.rotationId,
      kind: landing.kind,
      attempt: eicLanding.selectAttempts,
      ...eicLanding.lastSelect
    });
    scheduleFast(next.processId, 1500);
    return next;
  }
  if (!prior.firstUnverifiedAtMs) {
    const next = await saveRotationState(process, { ...rotation, eicLanding }, "SESSION_ROTATION_EIC_LANDING_UNVERIFIED", {
      rotationId: rotation.rotationId,
      kind: landing.kind
    });
    scheduleFast(next.processId, 2000);
    return next;
  }
  scheduleFast(process.processId, 2000);
  return process;
}

async function commitFreshRotationReady(process, rotation, tab, page, gptRoot, landing, detail = {}) {
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
  const initialization = await prepareSessionInitialization(process, pendingPrompt, page);
  const next = await commitTransition(process, PHASES.SENDING, {
    tabId: tab.id,
    gptRoot,
    sessionRotation: readyRotation,
    ...initialization,
    deliveryRetry: null,
    deliveryNotice: null,
    responseCandidate: null,
    waitingRefresh: null,
    lastError: null,
    lastMaterialAt: nowIso()
  }, {
    kind: "SESSION_ROTATION_READY_TO_RESUME",
    component: "session-rotation",
    beforeSave: () => transportTransitionBoundary(process),
    detail: {
      rotationId: rotation.rotationId,
      targetTabId: tab.id,
      gptRoot,
      newChatVerified: true,
      eicSurface: landing.kind,
      observedUserCount: Number(page.userCount || 0),
      composerReady: page.composerReady === true,
      messageType: pendingPrompt.a2a?.messageType || "",
      ...detail
    }
  });
  scheduleFast(next.processId, 50);
  return next;
}

function expiredRotationCheckpointSafe(process, rotation, tab) {
  return process?.phase === PHASES.ROTATING && rotation?.state === SESSION_ROTATION_STATES.NAVIGATING &&
    tab?.windowId === process.windowId && tab.id === process.tabId &&
    rotation.targetTabId === tab.id && tab.status === "complete" && !tab.discarded && !tab.frozen &&
    !warmResumeTarget(rotation) &&
    (!rotation.hardReloadBeforeResume || ["COMPLETED", "DISABLED"].includes(rotation.hardReloadState)) &&
    !process.storageRecoveryRequired && !process.safety?.qualityIncident && !process.safety?.hold &&
    !process.pendingPrompt?.dispatch && process.pendingPrompt?.sendAttempts === 0;
}

async function recheckExpiredRotationReady(process, rotation, tab, gptRoot, navigationAgeMs) {
  // A suspended worker's wall-clock deadline is not evidence of an auth wall.
  // Recheck only an unsent cold rotation; unresolved effects stay closed.
  if (!expiredRotationCheckpointSafe(process, rotation, tab) ||
      await sha256Hex(process.pendingPrompt.text) !== process.pendingPrompt.hash) return { handled: false };
  let page, liveTab;
  try {
    await ensureContentBridgeVersion(tab.id);
    const observed = await bridgeMessage(tab.id, {
      type: "EIC_GF_GET_PAGE_STATE", source: "expired-session-rotation-ready-check",
      expectedUserTurnId: "", expectedUserIndex: null
    });
    if (observed?.ok) {
      page = observed.state;
      liveTab = await chrome.tabs.get(tab.id);
    }
  } catch {}

  const queue = await loadMissionWorkQueue(process.windowId, chrome.storage.local, { workerId: process.workerId });
  const safety = await readSafety();
  const current = await loadProcessForWindow(process.windowId);
  // Read back after browser calls so a late result cannot replace STOP, a new
  // run, changed prompt bytes, or a different rotation checkpoint.
  if (!isCurrentToken(current, ownerToken(process)) || current.phase !== PHASES.ROTATING ||
      current.turn !== process.turn || current.sessionSeq !== process.sessionSeq ||
      current.gptRoot !== process.gptRoot || current.goal !== process.goal ||
      JSON.stringify(current.queueContext) !== JSON.stringify(process.queueContext) ||
      JSON.stringify(current.sessionRotation) !== JSON.stringify(rotation) ||
      JSON.stringify(current.pendingPrompt) !== JSON.stringify(process.pendingPrompt)) {
    return { handled: true, process: current || process };
  }
  if (!page || !liveTab) return { handled: false };
  if (!expiredRotationCheckpointSafe(current, current.sessionRotation, liveTab) ||
      safety.admissionPaused || safety.providerHold) return { handled: true, process: current };
  if (current.queueContext?.itemId
      ? !queue.enabled || queue.activeItemId !== current.queueContext.itemId
      : queue.enabled) return { handled: true, process: current };
  const proof = Safety.evaluateModel(page?.modelEvidence, safety.policy, { url: page?.url, gptRoot });
  const landing = Safety.eicSurfaceProof(page?.modelEvidence, page?.url, gptRoot);
  if (!proof.allowed || !landing.ok || page?.bridgeVersion !== APP_VERSION ||
      page?.url !== liveTab.url || page.userCount !== 0 ||
      page.composerReady !== true || page.composerEmpty !== true || page.generating !== false ||
      page.rateLimitWarning?.active || providerTransportPending(page)) return { handled: false };

  return { handled: true, process: await commitFreshRotationReady(current, current.sessionRotation,
    liveTab, page, gptRoot, landing, { expiredDeadlineRechecked: true, navigationAgeMs,
      automaticResend: false, modelProof: proof.code }) };
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

  // A cold session still owes its ping. Its held work/inbox instruction is
  // acknowledged only after initialization releases the real work prompt.
  if (rotation.warmResume?.warm === true) await consumeCheckpointedInstructions(process);

  if (rotation.eicDiscovery && rotation.eicDiscovery.state !== "BOUND") return tickEicRootDiscovery(process, rotation);

  const rotationSurface = await readEicSurfaceState(chrome.storage.local).catch(() => ({ lastKnownGoodEicUrl: "" }));
  const gptRoot = resolveManagedGptRoot(rotation.gptRoot || "", process.gptRoot || "", rotationSurface.lastKnownGoodEicUrl || "");
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
        tabMatchesGptRoot(candidate.url || "", gptRoot)
      );
      if (candidates.length === 1) tab = candidates[0];
    }

    const warmUrl = warmResumeTarget(rotation);
    const targetUrl = warmUrl || gptRoot;
    let navigating = {
      ...rotation,
      state: SESSION_ROTATION_STATES.NAVIGATING,
      gptRoot,
      sourceTabId: rotation.sourceTabId ?? process.tabId,
      navigationStartedAt: nowIso(),
      freshnessRetryCount: Number(rotation.freshnessRetryCount || 0),
      ...(warmUrl ? { warmResume: { ...rotation.warmResume, state: "NAVIGATING" } } : {})
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
        warmResume: Boolean(warmUrl),
        method: "NAVIGATE_MANAGED_TAB"
      });
      try {
        await chrome.tabs.update(tab.id, { url: targetUrl });
        await audit(process, "SESSION_ROTATION_NAVIGATION_TRIGGERED", "chrome", {
          rotationId: rotation.rotationId,
          targetTabId: tab.id,
          gptRoot,
          warmResume: Boolean(warmUrl),
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
        url: targetUrl,
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
      await chrome.tabs.update(tab.id, { url: warmResumeTarget(rotation) || gptRoot });
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
  const eicLandingFirstMs = Number(rotation.eicLanding?.firstUnverifiedAtMs || 0);
  if ((eicLandingFirstMs && Date.now() - eicLandingFirstMs >= EIC_LANDING_TIMEOUT_MS) ||
      navigationAgeMs >= 5 * 60 * 1000) {
    const rechecked = await recheckExpiredRotationReady(process, rotation, tab, gptRoot, navigationAgeMs);
    if (rechecked.handled) return rechecked.process;
  }
  if (eicLandingFirstMs && Date.now() - eicLandingFirstMs >= EIC_LANDING_TIMEOUT_MS) {
    const error = Object.assign(new Error("SESSION_ROTATION_EIC_NOT_SELECTED"), {
      code: "SESSION_ROTATION_EIC_NOT_SELECTED"
    });
    return commitTransition(process, PHASES.BLOCKED, {
      lastError: errorRecord(error)
    }, {
      kind: "SESSION_ROTATION_BLOCKED_EIC_NOT_SELECTED",
      component: "session-rotation",
      detail: {
        rotationId: rotation.rotationId,
        targetTabId: tab.id,
        gptRoot,
        eicLanding: rotation.eicLanding
      }
    });
  }
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
    const result = await bridgeMessage(tab.id, {
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

  // v1.9.0: a warm resume needs the GFW's own idle conversation, not a new chat.
  if (warmResumeTarget(rotation)) {
    const verdict = warmResumePageVerdict({ warm: rotation.warmResume, page, tabUrl: tab.url || "", navigationAgeMs });
    if (verdict.action === "WAIT") {
      scheduleFast(process.processId, 900);
      return process;
    }
    if (verdict.action === "ABANDON") {
      return abandonWarmResume(process, rotation, verdict.code, {
        navigationAgeMs,
        observedConversationKey: conversationKey(page.url || tab.url || "")
      });
    }
    const warmLanding = Safety.eicSurfaceProof(page.modelEvidence, page.url || tab.url || "", gptRoot);
    if (!warmLanding.ok) {
      return abandonWarmResume(process, rotation, "EIC_SURFACE_UNPROVEN", {
        navigationAgeMs,
        observedConversationKey: verdict.conversationKey
      });
    }
    const warmRotation = {
      ...rotation,
      state: SESSION_ROTATION_STATES.READY_TO_RESUME,
      targetTabId: tab.id,
      readyAt: nowIso(),
      warmResume: { ...rotation.warmResume, state: "VERIFIED", verifiedAt: nowIso() },
      coldPlan: null
    };
    const warmPending = {
      ...process.pendingPrompt,
      baselineAssistantHash: page.assistantHash || "",
      sendAttempts: 0,
      dispatch: null,
      promptPause: null
    };
    const resumed = await commitTransition(process, PHASES.SENDING, {
      tabId: tab.id,
      gptRoot,
      lastManagedUrl: page.url || tab.url || process.lastManagedUrl || "",
      sessionRotation: warmRotation,
      pendingPrompt: warmPending,
      responseCandidate: null,
      waitingRefresh: null,
      lastError: null,
      lastMaterialAt: nowIso()
    }, {
      kind: "WARM_RESUME_READY",
      component: "session-rotation",
      detail: {
        rotationId: rotation.rotationId,
        targetTabId: tab.id,
        conversationKey: verdict.conversationKey,
        eicSurface: warmLanding.kind,
        promptProfile: warmPending.promptProfile?.profile || "",
        observedUserCount: Number(page.userCount || 0),
        messageType: warmPending.a2a?.messageType || ""
      }
    });
    await recordIncident(resumed, "WARM_RESUME_READY", verdict.code, {
      navigationAgeMs,
      promptProfile: String(warmPending.promptProfile?.profile || ""),
      prompts: Number(rotation.warmResume?.prompts || 0)
    });
    scheduleFast(resumed.processId, 50);
    return resumed;
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

  if (page.composerReady !== true || page.composerEmpty !== true || page.generating === true || providerTransportPending(page)) {
    scheduleFast(process.processId, 900);
    return process;
  }

  // v1.8.7: the fresh chat must be the EIC GPT. ChatGPT's newer shell can
  // show standard chat for a GPT address, and shows a selected GPT at "/".
  const landing = Safety.eicSurfaceProof(page.modelEvidence, page.url || tab.url || "", gptRoot);
  if (!landing.ok) return steerRotationToEic(process, rotation, tab, gptRoot, landing, page);

  return commitFreshRotationReady(process, rotation, tab, page, gptRoot, landing);
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
      metrics: fallback.metrics || pending.metrics || null,
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

async function commitObservedDispatchToWaiting(process,page,reconciliation,{beforeSave=null}={}) {
  const pending=process.pendingPrompt;
  const {fence,turnProof,resolvedUserTurnId,resolvedUserTurnIndex}=reconciliation;
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
      // v1.8.11: how the user turn was bound (PROMPT_MARKER, USER_COUNT or
      // OPERATOR via "Läs svar"); kept after the pending prompt is cleared.
      dispatchedUserTurnBoundBy: String(pending.dispatch?.materializedBy || turnProof.resolvedBy || ""),
      operatorOverride: pending.dispatch?.operatorOverride || null,
      oneShotInstruction: pending.oneShotInstruction || null,
      a2a: pending.a2a || null,
      // v1.9.3: sizing telemetry of the prompt actually posted.
      metrics: { ...(pending.metrics || {}), promptChars: String(pending.text || "").length },
      promptProfile: pending.promptProfile || null,
      transportKind: pending.transportKind || "",
      transportId: pending.transportId || "",
      conversationKey: conversationKey(page.url || ""),
      sourceUserTurnId: pending.sourceUserTurnId || ""
    },
    sessionHealth: isTransportPrompt(pending) ? process.sessionHealth : markSessionHealthPromptPosted(process.sessionHealth, {
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
    sessionRotation: (pending.a2a?.messageType === "SESSION_ROTATION" ||
        process.sessionRotation?.warmResume?.state === "VERIFIED") && process.sessionRotation
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
    beforeSave,
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

  const lostConversation = await maybeHandleLostConversation(process, page);
  if (lostConversation.handled) return lostConversation.process;
  const shortGuard = await guardShortContinuation(process, page);
  if (shortGuard.handled) return shortGuard.process;
  if (pending.requiredConversationKey && conversationKey(page.url) !== pending.requiredConversationKey) {
    return holdForSafety(process, { code: "SESSION_INITIALIZATION_CONVERSATION_UNPROVEN" });
  }

  await consumeCheckpointedInstructions(process);

  // A no-delta wait delays an EIC rotation, it does not discard it. The
  // durable resumed-pause marker also covers restart between wake and rotation.
  if (!pending.dispatch && process.missionPause?.resumeSessionAction === "ROTATE_SESSION_NOW" &&
      process.missionPause.state !== MISSION_PAUSE_STATES.ARMED) {
    return armSessionRotation(process, {
      reasonCode: "EIC_ROTATE_SESSION_NOW_AFTER_NO_DELTA_PAUSE",
      reason: process.missionPause.resumeSessionReason || "EIC requested rotation after the pacing wait.",
      requestedBy: "EIC_AI", objective: pending.a2a?.objective || "",
      previousResponseHash: process.lastResponse?.hash || "",
      previousDisposition: process.lastDecision?.disposition || "CONTINUE",
      analysisEvidence: pending.a2a?.analysisEvidence || null,
      sourceResponseState: "COMPLETED_RESPONSE_CAPTURED",
      operatorInstruction: pending.oneShotInstruction || null,
      processStatusMode: capturedTargetResponse(process).targetResponse?.greenfieldStatusRequest || ""
    });
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

  // v1.8.3: never post into a conversation ChatGPT has content-blocked, honour
  // a provider-block pause, and recover a page that cannot take a prompt.
  if (!pending.dispatch) {
    const notice = await maybeHandleProviderNotice(process, page);
    if (notice.handled) return notice.process;
    process = notice.process;
    const providerPauseUntilMs = Number(process.providerContentBlocks?.pauseUntilMs || 0);
    if (providerPauseUntilMs > Date.now()) {
      return holdForSafety(process, { code: "PROVIDER_CONTENT_BLOCK_PAUSE", retryAtMs: providerPauseUntilMs });
    }
  }
  const pageHealth = await maybeRecoverPageHealth(process, page);
  if (pageHealth.handled) return pageHealth.process;
  process = pageHealth.process;
  pending = process.pendingPrompt;

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

  const reconciliation = reconcileDispatchObservation(process, deliveryFencePage(pending, page));
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
    return commitObservedDispatchToWaiting(process,page,reconciliation);
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

  // v1.9.3: never post while ChatGPT still shows its background-processing
  // notice or its connection-lost banner (operator screenshot 2026-10-07:
  // SENDING while "Anslutningen bröts. Väntar på hela svaret" was shown).
  // Bounded like generation evidence: after WAITING_GENERATION_LIMIT_MS of
  // continuous hold the prompt is posted.
  if (providerTransportPending(page)) {
    const heldSinceMs = Number(pending.providerNoticeHoldSinceMs || 0) || Date.now();
    if (Date.now() - heldSinceMs < WAITING_GENERATION_LIMIT_MS) {
      if (pending.providerNoticeHoldSinceMs) {
        scheduleFast(process.processId, 5000);
        return process;
      }
      const held = { ...process, pendingPrompt: { ...pending, providerNoticeHoldSinceMs: heldSinceMs }, updatedAt: nowIso() };
      await saveProcess(held);
      await audit(held, "PROMPT_DISPATCH_HELD_PROVIDER_NOTICE", "prompt", {
        promptHash: pending.hash,
        providerNotices: page.providerNotices || {}
      });
      await recordIncident(held, "PROMPT_DISPATCH_HELD_PROVIDER_NOTICE", "", incidentPageEvidence(page));
      scheduleFast(held.processId, 5000);
      return held;
    }
    await audit(process, "PROMPT_DISPATCH_PROVIDER_NOTICE_HOLD_EXPIRED", "prompt", {
      promptHash: pending.hash,
      heldMs: Date.now() - heldSinceMs
    });
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
    workerId: process.workerId || "",
    promptHash: pending.hash,
    priority: process.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY,
    capacity: capacityContext.effectiveCapacity,
    configuredCapacity: capacityContext.configuredCapacity,
    reservedWorkerId: capacityContext.reservedWorkerId
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
        baselineLastUserId: page.lastUserId || "",
        promptMarker: promptCausalMarker(pending.text),
        replayCount: 0
      };
  const freshSafetyPage = await tabState(process, "pre-dispatch-model-recheck");
  const freshShortGuard = await guardShortContinuation(process, freshSafetyPage);
  if (freshShortGuard.handled) return freshShortGuard.process;
  if (pending.requiredConversationKey && conversationKey(freshSafetyPage.url) !== pending.requiredConversationKey) {
    return holdForSafety(process, { code: "SESSION_INITIALIZATION_CONVERSATION_UNPROVEN" });
  }
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
    sessionHealth: isTransportPrompt(pending) ? refreshed.sessionHealth : markSessionHealthPromptPosted(refreshed.sessionHealth, {
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

  const lostConversation = await maybeHandleLostConversation(process, page);
  if (lostConversation.handled) return lostConversation.process;

  // v1.8.3: a page that is not drawn or lost its thread is recovered in place;
  // a ChatGPT content block ends this turn with a fresh-chat rotation.
  const pageHealth = await maybeRecoverPageHealth(process, page);
  if (pageHealth.handled) return pageHealth.process;
  process = pageHealth.process;
  const providerNotice = await maybeHandleProviderNotice(process, page);
  if (providerNotice.handled) return providerNotice.process;
  process = providerNotice.process;
  process = await maybeReadoptStaleTurnCapacity(process, page);
  process = await observeProviderTransportNotices(process, page);

  if (!process.lastPrompt?.modelProof && !process.safety?.turnProof) {
    process.safety = {...process.safety,qualityIncident:{code:"IN_FLIGHT_MODEL_UNVERIFIED",atMs:Date.now(),turn:process.turn}};
  }
  if (process.safety?.qualityIncident) {
    process = await recordResponseObservation(process, `SAFETY_HOLD:${process.safety.qualityIncident.code}`, page);
    return holdForSafety(process,{code:process.safety.qualityIncident.code});
  }
  if (!process.safety?.proof?.allowed) {
    const holdCode = process.safety?.proof?.code || "MODEL_EVIDENCE_MISSING";
    process = await recordResponseObservation(process, `SAFETY_HOLD:${holdCode}`, page);
    // v1.8.6: a model-evidence hold blocks capture, not the stale-session
    // ladder. F5 30, Ctrl-F5 60/90 and the 120 min queue switch/rotation post
    // nothing, and every later send is gated again (diagnostics 2026-09-26:
    // two held processes kept TTL at 0:00 for 11-16 h and both capacity slots).
    const refreshEscalation = await maybeEscalateWaitingRefresh(process, page, { reason: `SAFETY_HOLD:${holdCode}` });
    if (refreshEscalation.handled) return refreshEscalation.process;
    process = refreshEscalation.process;
    return holdForSafety(process,process.safety?.proof || {code:"MODEL_EVIDENCE_MISSING"});
  }

  const deliveryTimeout = await maybeHandleDeliveryTimeout(process, page);
  if (deliveryTimeout.handled) return deliveryTimeout.process;
  process = deliveryTimeout.process;
  if (waitingForInitialization(process)) return tickSessionInitialization(process, page);

  const baselineHash = process.lastPrompt?.baselineAssistantHash || "";
  const lastResponseHash = process.lastResponse?.hash || "";

  const responseActivityObserved = Boolean(
    page.generating === true ||
    (page.assistantHash && page.assistantHash !== baselineHash && page.assistantHash !== lastResponseHash)
  );
  if (responseActivityObserved && process.sessionHealth?.activeTurn?.firstResponseObservedAtMs == null) {
    const observedAtMs = Date.now();
    const nextSessionHealth = markSessionHealthFirstResponse(process.sessionHealth, {
      promptHash: workPromptHash(process),
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
        },
        responseObservationTrace: tracedResponseObservation(process, "EXTERNAL_TURN_INTERLEAVED", page).trace
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
      page.generating !== true &&
      !providerTransportPending(page)) {
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
      responseObservationTrace: tracedResponseObservation(process, "AUTONOMOUS_RESPONSE_PRODUCER_LOST_REARM", page).trace,
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

    process = await recordResponseObservation(process, causal.reason, page, {
      expectedUserTurnIdFromPrompt: causal.expected?.id || ""
    });
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
    process = refreshEscalation.process;

    const lastMaterialMs = Date.parse(process.lastMaterialAt || process.updatedAt || process.startedAt || "");
    const idleMs = Number.isFinite(lastMaterialMs) ? Date.now() - lastMaterialMs : 0;
    const keepaliveDue = idleMs >= Math.max(IDLE_KEEPALIVE_MIN_MS, IDLE_KEEPALIVE_MS);
    if (keepaliveDue &&
        process.lastPrompt?.acknowledged === true &&
        page.generating !== true &&
        !providerTransportPending(page) &&
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
  // v1.9.3: while ChatGPT shows its background-processing notice or the
  // connection-lost banner the visible text may be partial; nothing is
  // admitted until the provider has finished.
  // A complete, schema-valid EIC answer already on the page wins over a
  // lingering connection banner (the processing notice is only flagged while
  // no substantive answer is visible).
  const providerPending = providerTransportPending(page) &&
    !(page.providerNotices?.processingNotice !== true &&
      parseTargetResponse(responsePage.assistantText || "").ok === true);
  const noNewAssistant = !responsePage.assistantHash ||
    responsePage.assistantHash === baselineHash ||
    responsePage.assistantHash === lastResponseHash ||
    responsePage.generating === true ||
    providerPending;

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
    const notNewReason = responsePage.generating === true
      ? "AUTONOMOUS_RESPONSE_STILL_GENERATING"
      : providerPending
        ? "AUTONOMOUS_RESPONSE_PROVIDER_NOTICE"
        : "AUTONOMOUS_RESPONSE_NOT_NEW";
    process = await recordResponseObservation(process, notNewReason, page);
    const refreshEscalation = await maybeEscalateWaitingRefresh(process, page, {
      reason: notNewReason
    });
    if (refreshEscalation.handled) return refreshEscalation.process;
    process = refreshEscalation.process;
    scheduleFast(process.processId, FAST_RECHECK_MS);
    return process;
  }

  const advanced = advanceResponseCandidate(process.responseCandidate, responsePage);
  // v1.8.2: a JSON object that has been opened but not closed is still being
  // written, whatever the page's generation signal says.
  const structural = responseStructuralCompleteness(responsePage.assistantText || "");
  const stabilityTrace = tracedResponseObservation(process,
    !advanced.complete
      ? `RESPONSE_STABILITY_${String(advanced.reason || "INCOMPLETE")}`
      : structural.complete
        ? "RESPONSE_STABLE_ADMISSIBLE"
        : `RESPONSE_STRUCTURALLY_INCOMPLETE:${structural.reason}`,
    page,
    {
      stabilityReads: advanced.reads || 0,
      stabilityAgeMs: advanced.ageMs || 0,
      requiredStableMs: advanced.requiredStableMs || 0,
      jsonStart: structural.jsonStart
    });
  process = await saveObserved(process, {
    responseCandidate: advanced.candidate,
    responseObservationTrace: stabilityTrace.trace
  },
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
      signals: responsePage.signals || {},
      structuralComplete: structural.complete,
      structuralReason: structural.reason
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
    process = refreshEscalation.process;
    scheduleFast(process.processId, FAST_RECHECK_MS);
    return process;
  }

  if (!structural.complete) {
    await audit(process, "RESPONSE_STRUCTURALLY_INCOMPLETE", "response-observation", {
      reason: structural.reason,
      messageId: responsePage.lastAssistantId || "",
      assistantTextLength: Number(responsePage.assistantTextLength ?? String(responsePage.assistantText || "").length),
      jsonStart: structural.jsonStart,
      generating: responsePage.generating === true,
      reads: advanced.reads || 0,
      ageMs: advanced.ageMs || 0,
      admitted: false
    });
    const refreshEscalation = await maybeEscalateWaitingRefresh(process, page, {
      reason: `RESPONSE_STRUCTURALLY_INCOMPLETE_${structural.reason}`
    });
    if (refreshEscalation.handled) return refreshEscalation.process;
    process = refreshEscalation.process;
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
    promptHash: workPromptHash(process),
    completedAtMs,
    responseChars: Number(responsePage.assistantTextLength ?? String(responsePage.assistantText || "").length)
  });
  const next = await commitTransition(process, PHASES.ANALYZING, {
    lastResponse: response,
    deliveryRetry: process.lastPrompt?.transportKind === DELIVERY_CONTINUATION && process.deliveryRetry
      ? { ...process.deliveryRetry, status: "COMPLETED", completedAt: nowIso() } : process.deliveryRetry || null,
    sessionHealth: completedSessionHealth,
    responseCandidate: null,
    responseObservationTrace: tracedResponseObservation(process, "RESPONSE_CAPTURED", page, {
      capturedTextLength: response.text.length,
      parseMode: parsedTarget.parseMode || "NONE"
    }).trace,
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
  await recordTurnMetrics(next, response);
  await releaseSchedulerTurn(next, {
    promptHash: next.lastPrompt?.hash || "",
    reason: "RESPONSE_CAPTURED"
  }).catch(() => undefined);
  scheduleFast(next.processId, 100);
  return next;
}

// v1.9.3 (contract observabilityRecommendations): one privacy-safe row per
// completed turn, enough to compare background-processing frequency against
// prompt size, interaction position and observed pressure. No text is stored.
async function recordTurnMetrics(process, response) {
  const sample = process.sessionHealth?.samples?.at?.(-1) || null;
  const metrics = process.lastPrompt?.metrics || {};
  const workQueue = process.lastPrompt?.a2a?.control?.workQueue || null;
  const capsule = sessionHealthCapsule(process.sessionHealth, {
    turn: process.turn,
    sessionSeq: process.sessionSeq,
    sessionStartTurn: process.turn
  });
  await recordIncident(process, "TURN_METRICS", String(process.lastPrompt?.promptProfile?.profile || ""), {
    itemId: String(process.queueContext?.itemId || ""),
    interactionInQuantum: workQueue ? Number(workQueue.interactionInQuantum || 0) : null,
    maxInteractions: workQueue ? Number(workQueue.maxInteractions || 0) : null,
    interactionRole: String(metrics.interactionRole || ""),
    promptChars: Number(metrics.promptChars || String(process.lastPrompt?.text || "").length),
    objectiveChars: Number(metrics.objectiveChars || 0),
    overpackGuardFired: metrics.overpackGuardFired === true,
    slicePressure: String(metrics.slicePressure || ""),
    responseChars: sample ? Number(sample.responseChars || 0) : null,
    ttfrMs: sample?.ttfrMs ?? null,
    completionMs: sample?.completionMs ?? null,
    roundTripMs: sample?.totalMs ?? null,
    clean: sample ? sample.clean === true : null,
    processingNotice: sample ? sample.processingNotice === true : null,
    processingNoticeMs: sample?.processingNoticeMs ?? null,
    connectionInterrupted: sample ? sample.connectionInterrupted === true : null,
    sessionAction: String(response?.contract?.control?.sessionAction || response?.contract?.value?.sessionAction || ""),
    pressureBand: String(capsule.pressureBand || ""),
    signals: (capsule.signals || []).join(",")
  });
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
  if (!isCurrentToken(current, token) ||
      current.phase !== PHASES.ANALYZING) {
    return null;
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

// The captured answer's A2A control, read deterministically (no model call).
// Shared by the analysis and by the v1.8.14 queue boundary.
function capturedTargetResponse(process) {
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
  const nanoDirective = splitNanoTaskDirective(targetResponse?.nextSuggestedAction || "");
  const targetContinuationInstruction = nanoDirective.found
    ? String(nanoDirective.remainder || "").trim()
    : String(targetResponse?.nextSuggestedAction || "").trim();
  return {
    parsedTarget,
    targetDisposition,
    targetResponse,
    currentObjective,
    currentObjectiveId,
    nanoDirective,
    targetContinuationInstruction
  };
}

async function currentAnalysisOwner(process, token) {
  const current = await findProcessById(process.processId);
  if (!isCurrentToken(current, token) || current.phase !== PHASES.ANALYZING ||
      current.lastResponse?.hash !== process.lastResponse?.hash) {
    throw Object.assign(new Error("STALE_ANALYSIS_CALLBACK"), { code: "STALE_ANALYSIS_CALLBACK" });
  }
  return current;
}

async function runAnalysis(process) {
  const token = ownerToken(process, randomId("analysis"));
  const budget = createAnalysisBudget();
  // Reserve one second inside the existing 180-second wall for offscreen
  // cleanup and deterministic fallback delivery. Both messages use this same
  // model cutoff, including an isolated Nano task before advisory analysis.
  const deadlineAtMs = budget.deadlineAtMs - 1000;
  await budget.wait(() => ensureOffscreenAnalyzer(), "analysis host");
  const instructionSnapshot = await budget.wait(() => instructionQueues.enqueue(
    process.processId, () => readNextInstruction(process.processId)
  ), "analysis instruction snapshot");
  process = await currentAnalysisOwner(process, token);

  const {
    parsedTarget,
    targetDisposition,
    targetResponse,
    currentObjective,
    currentObjectiveId,
    nanoDirective,
    targetContinuationInstruction
  } = capturedTargetResponse(process);
  const responseExcerpt = compactResponseExcerpt(process.lastResponse?.text || "", 650);
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
          ...await currentAnalysisOwner(process, token),
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
    await currentAnalysisOwner(process, token);
    let taskExecution, submitted = false;
    try {
      taskExecution = await budget.wait(() => {
        submitted = true;
        return chrome.runtime.sendMessage({
          type: "EIC_GF_RUN_NANO_TASK", token, deadlineAtMs,
          input: { nanoTask, executeNanoTask }
        });
      }, "Nano task reply");
    } catch (error) {
      if (error?.code === "ANALYSIS_TIMEOUT") {
        // A lost transport reply cannot prove that its task prompt never ran.
        // Keep that uncertainty durable, and never replay the RUNNING task.
        const unknown = submitted || executeNanoTask !== true;
        await persistNanoTaskCheckpoint(process, token, {
          ...nanoTask,
          status: unknown ? NANO_TASK_STATUS.UNKNOWN_EFFECT : NANO_TASK_STATUS.FAILED,
          semanticStatus: "UNVERIFIED",
          executionStatus: unknown ? "UNKNOWN_EFFECT" : "NOT_EXECUTED",
          error: unknown ? "ANALYSIS_TIMEOUT: Nano task reply lost; no replay." : "ANALYSIS_TIMEOUT: Nano task was not executed.",
          completedAt: unknown ? null : nowIso()
        });
      }
      throw error;
    }
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
    // v1.9.3: the advisory controller sizes its nextPrompt for this position.
    nextInteraction: nextInteractionAfterResponse(process.queueContext?.itemId ? {
      ...process.queueContext,
      maxInteractions: normalizeMissionQuantumInteractions(process.queueContext.maxInteractions)
    } : null),
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

  await currentAnalysisOwner(process, token);
  const result = await budget.wait(() => chrome.runtime.sendMessage({
    type: "EIC_GF_ANALYZE_PIPELINE", token, deadlineAtMs, input
  }), "analysis pipeline reply");

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
    configuredCapacity: context.configuredCapacity,
    reservedWorkerId: context.reservedWorkerId
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

// Analysis evidence that needs no model: how the answer was observed and
// what its A2A control said.
function capturedResponseObservationEvidence(current) {
  return {
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
}

function capturedProtocolEvidence(current, result) {
  return {
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
}

// v1.8.14: a queue boundary needs no analysis (lib/queue-boundary.mjs).
// Operator request 2026-10-05: when the slot's quantum is complete, or the
// answer itself hands the slot back to the queue, the next prompt goes to
// another GFW; Nano and Hjalmar would only plan a prompt that is never sent.
// Everything that does not need a model still happens exactly as after an
// analysis: runtime control (quantum, priority, schedule) with receipts,
// mission delegations, the schedule gate, the checkpoint and the park.
// Returns handled:false (and changes nothing) whenever analysis can change
// the outcome; tickAnalyzing then analyses as before.
async function observeNoDelta(current, result, { delegationResult = null, operatorInstructionPending = false } = {}) {
  const handoff = eicHandoffWithoutNanoTask(result.targetResponse?.nextSuggestedAction || "");
  const objective = String(result.currentObjective || current.objectiveState?.objective || "").trim();
  const facts = result.targetResponse ? JSON.stringify({
    workPerformed: result.targetResponse.workPerformed || [],
    evidence: result.targetResponse.evidence || []
  }) : "";
  const previous = current.noDeltaState || (
    ["ADVISORY_DONE_WITHOUT_EIC_TERMINAL", "ADVISORY_DONE_NO_DELTA_PAUSE"].includes(current.greenfieldControl?.reason)
      ? { noDeltaTurns: 1 + Number(current.greenfieldControl?.noDeltaPause?.streak || 0), pauseStreak: Number(current.greenfieldControl?.noDeltaPause?.streak || 0) }
      : null
  );
  const observed = advanceNoDeltaState({
    previous,
    responseId: `${current.processId}:${current.generation}:${current.turn}:${current.lastResponse?.hash || ""}`,
    handoffKey: handoff ? await sha256Hex(handoff) : "",
    objectiveKey: objective ? await sha256Hex(objective) : "",
    factsKey: facts ? await sha256Hex(facts) : "",
    materialEffect: Boolean(delegationResult?.accepted?.length) ||
      (current.runtimeControl?.lastReceipts || []).some((receipt) => receipt.status === "APPLIED"),
    blocked: result.targetDisposition === "BLOCKED",
    operatorInstructionPending
  });
  current.noDeltaState = observed.state;
  return observed.pause;
}

async function maybeParkAtQueueBoundaryWithoutAnalysis(process) {
  if (!process?.queueContext?.itemId) return { handled: false, process };
  const target = capturedTargetResponse(process);
  const decision = queueBoundaryAnalysisDecision({
    queueManaged: true,
    controlValid: hasCanonicalResponseControl(target.parsedTarget),
    targetDisposition: target.targetDisposition,
    sessionAction: target.targetResponse?.sessionAction || "KEEP",
    nanoTaskRequested: target.nanoDirective.found === true,
    completionRequested: runtimeControlRequestsCompletion(target.targetResponse?.runtimeControl),
    interactionCount: process.queueContext.interactionCount,
    maxInteractions: process.queueContext.maxInteractions,
    pauseSeconds: target.targetResponse?.pauseSeconds
  });
  if (decision.action !== "SKIP") return { handled: false, process };

  // Another slot must take over after the park (same transition as the park
  // itself, applied to a copy). Otherwise this slot continues and its next
  // prompt needs the analysis.
  let queueState;
  try {
    queueState = await missionQueueForWindow(process.windowId);
  } catch {
    return { handled: false, process };
  }
  const item = queueItemForProcess(queueState.queue, process);
  if (!queueState.queue.enabled || !item) return { handled: false, process };
  const pauseUntilMs = decision.pauseSeconds ? Date.now() + decision.pauseSeconds * 1000 : 0;
  const simulatedNext = selectNextMissionItem({
    ...queueState.queue,
    items: applyQueueParkTransition(queueState.queue.items, item, { pauseUntilMs, outcome: decision.outcome })
  }, { afterOrder: Number(item.order), excludeItemId: item.itemId });
  if (!simulatedNext) return { handled: false, process };

  return instructionQueues.enqueue(process.processId, async () => {
    // An operator instruction for this GFW is weighed by the analysis.
    if (await readNextInstruction(process.processId)) return { handled: false, process };
    const current = await findProcessById(process.processId);
    if (!current || current.generation !== process.generation || current.phase !== PHASES.ANALYZING) {
      return { handled: true, process: current };
    }
    const result = {
      targetDisposition: target.targetDisposition,
      targetResponse: target.targetResponse,
      currentObjectiveId: target.currentObjectiveId,
      nano: null,
      nanoTask: null
    };
    const runtimeControl = await evaluateAndApplyRuntimeControl(current, result);
    if (runtimeControl.terminal) return { handled: false, process };
    if (runtimeControl.processPatch) Object.assign(current, runtimeControl.processPatch);
    if (runtimeControl.priorityChanged) await refreshSchedulerPriority(current);
    const delegationResult = await registerResponseMissionDelegations(current, target.targetResponse);
    const noDeltaPause = await observeNoDelta(current, result, { delegationResult });
    const scheduleBlock = await activeSlotScheduleBlock(current);

    const boundary = queueBoundaryControl({
      nextStep: target.targetContinuationInstruction,
      fallbackObjective: target.currentObjective || current.objectiveState?.objective || "",
      targetDisposition: target.targetDisposition,
      outcome: decision.outcome
    });
    if (noDeltaPause) {
      boundary.greenfieldControl = resolveGreenfieldControl({
        targetDisposition: target.targetDisposition,
        targetNextSuggestedAction: target.targetResponse?.nextSuggestedAction || "",
        decision: boundary.decision, noDeltaPause
      });
      boundary.decision = applyGreenfieldControlToDecision(boundary.decision, boundary.greenfieldControl);
      boundary.effectiveNextPrompt = boundary.greenfieldControl.effectiveNextPrompt;
    }
    const analysisEvidence = {
      responseHash: current.lastResponse.hash,
      targetDisposition: target.targetDisposition,
      responseObservation: capturedResponseObservationEvidence(current),
      protocol: capturedProtocolEvidence(current, result),
      nanoTask: null,
      nano: null,
      hjalmar: null
    };
    const switched = await parkQueueMissionAfterAnalysis({
      current,
      completedInteractions: decision.completedInteractions,
      effectiveNextPrompt: boundary.effectiveNextPrompt,
      previousDisposition: "CONTINUE",
      analysisEvidence,
      greenfieldControl: boundary.greenfieldControl,
      effectiveDecision: boundary.decision,
      result,
      latestInstruction: null,
      pauseSeconds: noDeltaPause ? Math.max(noDeltaPause.pauseSeconds, decision.pauseSeconds || 0) : decision.pauseSeconds,
      requestedSessionAction: noDeltaPause ? "PAUSE_PROCESS" : decision.sessionAction,
      quantumReached: decision.quantumReached,
      scheduleBlock,
      outcomeOverride: noDeltaPause && !scheduleBlock ? "ADVISORY_NO_DELTA_PAUSED" : ""
    });
    // The queue changed between the check and the park: analyse as before.
    if (!switched) return { handled: false, process };
    await audit(switched, "QUEUE_BOUNDARY_ANALYSIS_SKIPPED", "mission-work-queue", {
      previousProcessId: current.processId,
      previousQueueItemId: current.queueContext?.itemId || "",
      nextQueueItemId: switched.queueContext?.itemId || "",
      outcome: scheduleBlock ? scheduleParkOutcome(scheduleBlock) : decision.outcome,
      completedInteractions: decision.completedInteractions,
      maxInteractions: decision.maxInteractions,
      sessionAction: decision.sessionAction,
      responseHash: current.lastResponse.hash
    }).catch(() => undefined);
    await recordIncident(current, "ANALYSIS_SKIPPED_AT_QUEUE_BOUNDARY", scheduleBlock ? scheduleParkOutcome(scheduleBlock) : decision.outcome, {
      completedInteractions: decision.completedInteractions,
      maxInteractions: decision.maxInteractions,
      sessionAction: decision.sessionAction,
      nextProcessId: switched.processId,
      nextItemId: switched.queueContext?.itemId || ""
    });
    return { handled: true, process: switched };
  });
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
  await consumeCheckpointedInstructions(process);
  const queueBoundary = await maybeParkAtQueueBoundaryWithoutAnalysis(process);
  if (queueBoundary.handled) return queueBoundary.process;

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

    if (!result.evidenceBinding?.ok) {
      await audit(current, "HJALMAR_EVIDENCE_BINDING_REJECTED", "decision", {
        decision: result.decision,
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

    const modelControllerDecision = result.decision;
    const delegationResult = await registerResponseMissionDelegations(current, result.targetResponse);
    const persistedNoDeltaPause = await observeNoDelta(current, result, {
      delegationResult, operatorInstructionPending: Boolean(latestInstruction)
    });
    const greenfieldControl = resolveGreenfieldControl({
      targetDisposition: result.targetDisposition,
      targetNextSuggestedAction: result.targetResponse?.nextSuggestedAction || "",
      decision: modelControllerDecision,
      nanoTask: result.nanoTask,
      sessionAction: result.targetResponse?.sessionAction || "KEEP",
      terminalControl: runtimeControl.terminal,
      previousReason: current.greenfieldControl?.reason || "",
      previousNoDeltaStreak: current.greenfieldControl?.noDeltaPause?.streak || 0,
      noDeltaPause: persistedNoDeltaPause,
      noDeltaObserved: true,
      standaloneAdvisoryRetry: current.queueContext?.itemId ? null : {
        allowed: !current.storageRecoveryRequired && !current.safety?.qualityIncident &&
          !current.safety?.hold && current.safety?.proof?.allowed === true &&
          current.safety?.turnProof?.allowed === true && current.lastPrompt?.acknowledged === true &&
          !current.pendingPrompt?.dispatch && Number(current.pendingPrompt?.sendAttempts || 0) <= 0,
        previous: current.greenfieldControl?.advisoryBlockedRetry || null,
        // Turn and source hash survive worker/browser generation changes. An
        // analysis retry of this same captured turn is not a second blocker.
        responseId: `${current.processId}:${current.runId}:${current.turn}:${current.lastResponse?.hash || ""}`
      },
      operatorInstructionPending: Boolean(latestInstruction)
    });
    if (greenfieldControl.reason === "EIC_TERMINAL_DEFERRED_FOR_OPERATOR_INSTRUCTION") {
      // The terminal was not committed, so its receipt must not claim APPLIED.
      current.runtimeControl = withTerminalReceiptsRejected(current.runtimeControl, "OPERATOR_INSTRUCTION_PENDING");
    }
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

    // v1.9.3: a terminal with a pending operator instruction is deferred by
    // resolveGreenfieldControl (EIC_TERMINAL_DEFERRED_FOR_OPERATOR_INSTRUCTION),
    // so DONE here always commits instead of looping in recovery.
    if (d.disposition === DISPOSITIONS.DONE) {
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

    // v1.9.3: admission recovers only from the EIC handoff without its
    // consumed NANO_TASK line, so a Nano directive is never sent back.
    const targetHandoff = eicHandoffWithoutNanoTask(result.targetResponse?.nextSuggestedAction || "");
    let admission = evaluateContinuationAdmission({
      targetDisposition: result.targetDisposition,
      currentObjective: result.currentObjective,
      targetNextSuggestedAction: targetHandoff,
      previousDecision: current.lastDecision,
      decision: d,
      nanoTask: result.nanoTask,
      operatorInstructionPending: Boolean(latestInstruction),
      greenfieldControlReason: greenfieldControl.reason,
      queueManaged: Boolean(current.queueContext?.itemId)
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
          targetHandoff ||
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
    const responseObservation = capturedResponseObservationEvidence(current);
    const protocol = capturedProtocolEvidence(current, result);
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
    const eicSessionAction = result.targetResponse?.sessionAction || "KEEP";
    // Persisted pacing survives queue/rotation controls and model fallbacks.
    const noDeltaPause = greenfieldControl.noDeltaPause || null;
    const requestedSessionAction = noDeltaPause ? "PAUSE_PROCESS" : eicSessionAction;
    const requestedPauseSeconds = noDeltaPause
      ? Math.max(noDeltaPause.pauseSeconds, Number(result.targetResponse?.pauseSeconds || 0))
      : result.targetResponse?.pauseSeconds;
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
          ? requestedPauseSeconds
          : null,
        requestedSessionAction,
        quantumReached: queueQuantumReached,
        scheduleBlock,
        outcomeOverride: noDeltaPause && !scheduleBlock ? "ADVISORY_NO_DELTA_PAUSED" : ""
      });
      if (switched) {
        await audit(switched, "MISSION_QUEUE_SWITCH_COMPLETED", "mission-work-queue", {
          previousProcessId: current.processId,
          previousQueueItemId: current.queueContext?.itemId || "",
          nextQueueItemId: switched.queueContext?.itemId || "",
          reason: scheduleBlock
            ? scheduleParkOutcome(scheduleBlock)
            : noDeltaPause
              ? "ADVISORY_NO_DELTA_PAUSED"
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
      if (latestInstruction && rotated?.phase === PHASES.ROTATING &&
          rotated.processId === current.processId && rotated.runId === current.runId &&
          rotated.pendingPrompt?.oneShotInstruction?.instructionId === latestInstruction.instructionId) {
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
        durationSeconds: requestedPauseSeconds,
        requestedBy: noDeltaPause ? "GREENFIELD_NO_DELTA" : "EIC_AI",
        reason: noDeltaPause
          ? `Greenfield no-delta pause ${noDeltaPause.streak}: ${noDeltaPause.cause || "NO_NEW_HANDOFF_OR_FACTS"}. The EIC is asked again after ${requestedPauseSeconds} s.`
          : result.targetResponse?.sessionReason || (
          backgroundSleepRequested
            ? "EIC requested background sleep; no other queued mission was runnable, so the worker is held until wake."
            : "EIC requested a timed Greenfield process pause."
        ),
        sourceResponseHash: current.lastResponse.hash,
        nextObjectiveId
      });
      if (noDeltaPause && isExplicitRotationAction(eicSessionAction)) {
        missionPause.resumeSessionAction = "ROTATE_SESSION_NOW";
        missionPause.resumeSessionReason = result.targetResponse?.sessionReason || "";
      }
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

// Caller owns the instruction lock. Transfer a queued instruction to the
// durable unsent prompt before consuming the inbox. Advisory waits can end
// early; an EIC-requested pause delivers new input at its scheduled wake.
async function resumeAdvisoryPauseForInstructionLocked(current) {
  await consumeCheckpointedInstructions(current, { instructionLockProcessId: current?.processId || "" });
  if (!current || current.phase !== PHASES.PAUSED ||
      current.missionPause?.state !== MISSION_PAUSE_STATES.ARMED ||
      (current.missionPause.requestedBy !== "GREENFIELD_NO_DELTA" && !missionPauseDue(current.missionPause)) ||
      current.storageRecoveryRequired || current.safety?.qualityIncident ||
      current.pendingPrompt?.dispatch || hasUnreceiptedPauseAttempt(current) || !current.pendingPrompt?.a2a ||
      !current.pendingPrompt.text || !current.pendingPrompt.hash) return null;
  const instruction = await readNextInstruction(current.processId);
  if (!instruction) return null;

  const prior = current.pendingPrompt;
  const pendingPrompt = await buildPendingA2A(current, {
    objective: prior.a2a.objective,
    objectiveId: prior.a2a.objectiveId,
    messageType: prior.a2a.messageType,
    operatorInstruction: instruction,
    previousResponseHash: prior.a2a.continuity?.previousResponseHash || current.lastResponse?.hash || "",
    previousDisposition: prior.a2a.continuity?.previousDisposition || current.lastDecision?.disposition || "CONTINUE",
    analysisEvidence: prior.a2a.analysisEvidence || null,
    sessionRotation: prior.a2a.continuity?.sessionRotation || null,
    processStatusMode: prior.a2a.processStatus ? PROCESS_STATUS_REQUEST : "",
    baselineAssistantHash: prior.baselineAssistantHash || "",
    turn: current.turn
  });
  const resumedPause = {
    ...resumeMissionPauseRecord(current.missionPause, {
      reason: "OPERATOR_INSTRUCTION", early: !missionPauseDue(current.missionPause)
    }),
    nextPromptHash: pendingPrompt.hash,
    nextObjectiveId: pendingPrompt.a2a.objectiveId
  };
  const next = await commitTransition(current, PHASES.SENDING, {
    missionPause: resumedPause, pendingPrompt,
    lastConsumedInstructionId: instruction.instructionId,
    objectiveState: { ...current.objectiveState, status: "PENDING", updatedAt: nowIso() },
    lastError: null, lastMaterialAt: nowIso()
  }, {
    kind: "OPERATOR_INSTRUCTION_ENDED_ADVISORY_PAUSE", component: "operator-input",
    detail: { instructionId: instruction.instructionId, pauseId: resumedPause.pauseId, promptHash: pendingPrompt.hash }
  });
  const cleared = await clearNextInstruction(current.processId, instruction.instructionId);
  await audit(next, "NEXT_INSTRUCTION_CONSUMED_AFTER_ADVISORY_PAUSE", "operator-input", {
    instructionId: instruction.instructionId, promptHash: pendingPrompt.hash, clearedFromInbox: cleared.cleared === true
  });
  await broadcast(next, "next-instruction-consumed");
  scheduleFast(next.processId, 100);
  return next;
}

async function resumeAdvisoryPauseForInstruction(processId) {
  return instructionQueues.enqueue(processId, async () =>
    resumeAdvisoryPauseForInstructionLocked(await findProcessById(processId)));
}

// Caller owns the process tick lock; hold the mailbox lock through parking
// and activation so an instruction either wins or sees the changed owner.
async function advancePausedQueueMission(processId) {
  return instructionQueues.enqueue(processId, async () => {
    const current = await findProcessById(processId);
    const resumed = await resumeAdvisoryPauseForInstructionLocked(current);
    if (resumed) return resumed;
    if (!current || current.phase !== PHASES.PAUSED) return current;
    const result = await operatorNextQueueItemLocked(processId, {
      automaticPausedWake: true, instructionLockProcessId: processId
    });
    return result.ok
      ? loadProcessForWindow(current.windowId)
      : findProcessById(processId);
  });
}

async function tickPaused(process) {
  // The due-time mailbox check and resumed prompt publication are one
  // boundary, just like analysis. Input accepted before it is attached;
  // input accepted afterwards belongs to the following prompt.
  return instructionQueues.enqueue(process.processId, async () => {
    const current = await findProcessById(process.processId);
    if (!current || current.phase !== PHASES.PAUSED) return current;
    return tickPausedLocked(current);
  });
}

function hasUnreceiptedPauseAttempt(process) {
  // Older/corrupt paused checkpoints may carry an attempted continuation
  // without a dispatch receipt. Replacing or waking it cannot prove no effect.
  return !process?.pendingPrompt?.dispatch && (
    Number(process?.pendingPrompt?.sendAttempts || 0) !== 0 ||
    process?.safety?.hold?.code === "DISPATCH_EFFECT_UNRESOLVED"
  );
}

async function tickPausedLocked(process) {
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

  if (hasUnreceiptedPauseAttempt(process)) {
    return holdForSafety(process, {
      code: "DISPATCH_EFFECT_UNRESOLVED",
      detail: "Paused continuation has unproven send state and no dispatch receipt; preserve it until its effect is reconciled."
    });
  }

  const instructed = await resumeAdvisoryPauseForInstructionLocked(process);
  if (instructed) return instructed;

  if (!missionPauseDue(pause)) {
    const advanced = process.queueContext?.itemId
      ? await operatorNextQueueItemLocked(process.processId, {
          automaticPausedWake: true, instructionLockProcessId: process.processId
        })
      : null;
    if (advanced?.ok) return loadProcessForWindow(process.windowId);
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
    // v1.8.3: a tab Chrome froze is waited for; a tab that exists but whose
    // page does not answer (hung renderer, missing bridge, discarded) is
    // recovered in place - reload ... new tab - before any session rotation.
    if (error?.code === "MANAGED_TAB_FROZEN") {
      const traced = tracedResponseObservation(process, "TAB_FROZEN_BY_CHROME", {});
      const waiting = traced.changed
        ? await saveObserved(process, { responseObservationTrace: traced.trace }, "TAB_FROZEN_BY_CHROME", {})
        : process;
      scheduleFast(waiting.processId, 30_000);
      return waiting;
    }
    const tabCondition = conditionFromBridgeError(error?.code);
    if (tabCondition) {
      const recovered = await applyTabHealthCondition(process, tabCondition, {
        source: "detached",
        detail: { errorCode: String(error?.code || "") }
      });
      if (!recovered.handled) scheduleFast(recovered.process.processId, 5000);
      return recovered.process;
    }
    // First preserve the existing deterministic single-tab rebind. If that
    // cannot restore a usable owner surface after bounded attempts, rotate the
    // ChatGPT session rather than waiting forever on a broken conversation.
    try {
      const tabs = await chrome.tabs.query({ windowId: process.windowId });
      const candidates = tabs.filter((tab) =>
        Number.isInteger(tab.id) &&
        supportedUrl(tab.url) &&
        tabMatchesGptRoot(tab.url || "", process.gptRoot || "")
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
    lastError: null,
    ...(process.tabHealth?.incident
      ? { tabHealth: advanceTabHealth(process.tabHealth, "", { now: Date.now() }).state }
      : {})
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

// v1.9.0: Arbetsläge is turned on when Chrome starts the profile and when
// the extension is installed, updated or reloaded (lib/work-mode-supervisor.mjs).
async function enableWorkModeAtStartup(reason) {
  try {
    const current = await loadOperatorSettings(chrome.storage.local, { restoreSavedMissions: false, bookmarks: null });
    const patch = workModeStartupPatch(current);
    if (!patch) return { ok: true, state: "ALREADY_ENABLED" };
    const saved = await saveOperatorSettings(patch, chrome.storage.local, { restoreSavedMissions: false, bookmarks: null });
    if (saved.workModeEnabled !== true) throw new Error("WORK_MODE_STARTUP_READBACK_MISMATCH");
    await recordIncident(null, "WORK_MODE_ENABLED_AT_STARTUP", String(reason || ""), {
      supervisorKept: Boolean(saved.workModeSupervisorWorkerId)
    });
    return { ok: true, state: "ENABLED" };
  } catch (error) {
    await recordIncident(null, "WORK_MODE_STARTUP_ENABLE_FAILED", String(reason || ""), {
      error: String(error?.message || error).slice(0, 120)
    });
    return { ok: false, state: "FAILED", error: String(error?.message || error) };
  }
}

// A worker is live for Arbetsläge when it has a running process bound to an
// open window in this browser session.
async function workModeWorkerLive(workerId) {
  if (!workerId) return false;
  const all = await loadAllProcesses().catch(() => []);
  const process = all.find((item) => item.workerId === workerId &&
    !TERMINAL_PHASES.has(item.phase) && item.phase !== PHASES.DETACHED);
  if (!process || !Number.isInteger(process.windowId)) return false;
  const binding = await getWorkerBinding(process.windowId, chrome.storage.session).catch(() => null);
  return binding?.workerId === workerId;
}

async function syncWorkModeForWorker(process, { force = false } = {}) {
  if (!process?.workerId || !Number.isInteger(process.windowId)) return { ok: true, state: "NO_WORKER" };
  let settings = await loadOperatorSettings(chrome.storage.local, { restoreSavedMissions: false, bookmarks: null });
  if (settings.workModeEnabled !== true) return { ok: true, state: "DISABLED" };
  const now = Date.now();
  const last = Number(workModeLastPoll.get(process.workerId) || 0);
  if (!force && now - last < WORK_MODE_POLL_MS) return { ok: true, state: "THROTTLED" };
  workModeLastPoll.set(process.workerId, now);
  // v1.9.0: one live worker polls; it takes over from a supervisor that is gone.
  if (String(settings.workModeSupervisorWorkerId || "") !== process.workerId) {
    const liveWorkerIds = [];
    for (const id of new Set([String(settings.workModeSupervisorWorkerId || ""), String(settings.reservedWorkerId || "")])) {
      if (id && id !== process.workerId && await workModeWorkerLive(id)) liveWorkerIds.push(id);
    }
    const decision = workModeSupervisorDecision({ settings, workerId: process.workerId, liveWorkerIds });
    if (decision.action === "SKIP") return { ok: true, state: decision.code };
    if (decision.action === "CLAIM") {
      try {
        settings = await saveOperatorSettings({ workModeSupervisorWorkerId: process.workerId }, chrome.storage.local, {
          restoreSavedMissions: false,
          bookmarks: null
        });
      } catch {
        return { ok: false, state: "SUPERVISOR_CLAIM_FAILED" };
      }
      if (settings.workModeEnabled !== true) return { ok: true, state: "DISABLED" };
      if (settings.workModeSupervisorWorkerId !== process.workerId) return { ok: true, state: "NOT_SUPERVISOR" };
      await audit(process, "WORK_MODE_SUPERVISOR_CLAIMED", "work-mode", {
        code: decision.code,
        previousWorkerId: decision.previousWorkerId || ""
      }).catch(() => undefined);
      await recordIncident(process, "WORK_MODE_SUPERVISOR_CLAIMED", decision.code, {
        previousWorkerId: decision.previousWorkerId || ""
      });
    }
  }
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
  if (!process) return process;
  if (TERMINAL_PHASES.has(process.phase)) {
    // Registration schedules a later tick even when its supervisor has just
    // ended or parked. Uncertain terminal effects remain on their old fence.
    if (queuePendingEffectNeedsReconciliation(process) ||
        (!process.queueContext?.queueId && !process.queueWait?.queueId)) return process;
    return wakeMissionQueue(process.windowId, "TERMINAL_DELEGATION_TICK");
  }

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

  // Accept the bounded pending batch on a separate pass. A pause may yield
  // after admission; its new worker receives its own scheduled dispatch tick.
  const beforeDelegation = process;
  process = await acceptPendingMissionDelegationForWorker(process);
  if (!process || !isCurrentToken(process, ownerToken(beforeDelegation)) ||
      process.phase !== beforeDelegation.phase) return process;

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

// v1.8.3 safety net: every call into the page has a deadline, but an unknown
// hang must still not freeze a worker. The watchdog sees a tick that has run
// longer than TICK_STALL_MS and reloads the managed tab, which rejects the
// pending page calls and releases the tick chain.
const tickStartedAtMs = new Map();
const tickRescuedAtMs = new Map();

function enqueueTick(processId, reason) {
  return queues.enqueue(processId, async () => {
    tickStartedAtMs.set(processId, Date.now());
    try {
      return await tickProcess(processId, reason);
    } catch (error) {
      return handleUnhandledTickError(processId, reason, error);
    } finally {
      tickStartedAtMs.delete(processId);
    }
  });
}

async function rescueStalledTick(processId) {
  const startedAt = Number(tickStartedAtMs.get(processId) || 0);
  const now = Date.now();
  if (!startedAt || now - startedAt < TAB_HEALTH.TICK_STALL_MS) return false;
  if (now - Number(tickRescuedAtMs.get(processId) || 0) < TAB_HEALTH.TICK_RESCUE_SPACING_MS) return false;
  tickRescuedAtMs.set(processId, now);
  const process = await findProcessById(processId).catch(() => null);
  if (!process?.tabId) return false;
  // Only where the page is what a tick waits on. ANALYZING waits on the local
  // analyzer, and a dispatch in flight belongs to the dispatch reconciliation.
  if (![PHASES.WAITING, PHASES.SENDING, PHASES.DETACHED, PHASES.RECOVERING, PHASES.ROTATING].includes(process.phase)) return false;
  const dispatch = process.pendingPrompt?.dispatch;
  if (process.phase === PHASES.SENDING && dispatch && dispatch.acknowledged !== true && dispatch.effectPossible !== false) return false;
  const reloaded = await chrome.tabs.reload(process.tabId).then(() => true, () => false);
  await audit(process, "TICK_STALL_RESCUE", "tab-health", {
    stalledMs: now - startedAt,
    tabId: process.tabId,
    reloaded
  }).catch(() => undefined);
  return reloaded;
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
    const result = await bridgeMessage(tab.id, {
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
  // v1.8.7: ChatGPT's newer shell shows a selected GPT at "/"; the page's own
  // GPT name (composer pill / header) proves the last verified EIC there.
  const eicByName = !surfaceClass.ok && surfaceClass.kind === "GENERIC_CHATGPT" && surfaceState.lastKnownGoodEicUrl &&
    Safety.eicSurfaceProof(page.modelEvidence, page.url || tab.url || "", surfaceState.lastKnownGoodEicUrl).ok;
  if (eicByName) surfaceClass.observedRoot = surfaceState.lastKnownGoodEicUrl;
  if (!surfaceClass.ok && !eicByName) {
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
  Object.assign(process, await prepareSessionInitialization(process, pendingPrompt, page));

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

// v1.8.11 operator "Läs svar": read the answer in the worker's own tab now
// ("operator control wins"). Never resends. SENDING with a possibly effective
// dispatch is reconciled at once (the 30 s DISPATCH_EFFECT_UNRESOLVED wait is
// skipped); if the prompt's user turn still cannot be proven, the operator
// binds ChatGPT's newest user turn after the previous Greenfield turn, with
// provenance. WAITING is read at once. Other holds and phases are untouched.
const OPERATOR_READ_RESPONSE_PHASES = new Set([PHASES.SENDING, PHASES.WAITING]);

async function operatorReadResponse({ windowId, processId = "" }) {
  await runtimeReady;
  if (runtimeFault) return { ok: false, code: "RUNTIME_FAULT", error: runtimeFault };
  const process = await loadProcessForWindow(windowId);
  if (!process) return { ok: false, code: "READ_RESPONSE_NO_PROCESS" };
  if (processId && process.processId !== processId) {
    return { ok: false, code: "READ_RESPONSE_PROCESS_CHANGED", process: publicSnapshot(process) };
  }
  return queues.enqueue(process.processId, () => operatorReadResponseLocked(process.processId));
}

async function operatorReadResponseLocked(processId) {
  let process = await findProcessById(processId);
  if (!process) return { ok: false, code: "READ_RESPONSE_NO_PROCESS" };
  if (!OPERATOR_READ_RESPONSE_PHASES.has(process.phase)) {
    return { ok: false, code: "READ_RESPONSE_NOT_APPLICABLE", phase: process.phase, process: publicSnapshot(process) };
  }
  const hold = process.safety?.hold || null;
  if (hold && hold.code !== "DISPATCH_EFFECT_UNRESOLVED") {
    return { ok: false, code: "READ_RESPONSE_SAFETY_HOLD", holdCode: hold.code, phase: process.phase, process: publicSnapshot(process) };
  }
  if (process.phase === PHASES.SENDING && process.pendingPrompt?.dispatch?.effectPossible !== true) {
    return { ok: false, code: "READ_RESPONSE_PROMPT_NOT_SENT", phase: process.phase, process: publicSnapshot(process) };
  }
  const before = {
    phase: process.phase,
    turn: Number(process.turn || 0),
    responseHash: String(process.lastResponse?.hash || "")
  };
  await audit(process, "OPERATOR_READ_RESPONSE_REQUESTED", "operator", {
    phase: process.phase,
    holdCode: hold?.code || "",
    dispatchId: process.pendingPrompt?.dispatch?.operationId || process.lastPrompt?.dispatchId || ""
  }).catch(() => undefined);

  let bound = null;
  process = await operatorReadTick(process, "operator-read-response");
  if (process?.phase === PHASES.SENDING && process.pendingPrompt?.dispatch?.effectPossible === true &&
      !process.pendingPrompt.dispatch.materializedUserTurnId) {
    bound = await bindNewestUserTurnForOperator(process);
    if (!bound.ok) {
      return { ok: false, code: bound.code, phase: process.phase, process: publicSnapshot(process) };
    }
    process = await operatorReadTick(bound.process, "operator-read-response-bound");
  }
  if (process?.phase === PHASES.WAITING && before.phase === PHASES.SENDING) {
    process = await operatorReadTick(process, "operator-read-response-waiting");
  }
  const outcome = operatorReadOutcome(before, process);
  await audit(process || { processId }, "OPERATOR_READ_RESPONSE_RESULT", "operator", {
    outcome,
    phase: process?.phase || "",
    boundUserTurnId: bound?.userTurnId || ""
  }).catch(() => undefined);
  return {
    ok: true,
    outcome,
    boundByOperator: Boolean(bound?.ok),
    phase: process?.phase || "",
    process: publicSnapshot(process)
  };
}

// One immediate tick, skipping only the dispatch hold's 30 s re-check wait.
async function operatorReadTick(process, reason) {
  if (!process) return process;
  if (process.safety?.hold?.code === "DISPATCH_EFFECT_UNRESOLVED" &&
      Number(process.safety.hold.retryAtMs || 0) > Date.now()) {
    process = { ...process, safety: { ...process.safety, hold: { ...process.safety.hold, retryAtMs: 0 } } };
    await saveProcess(process);
  }
  return (await tickProcess(process.processId, reason)) || findProcessById(process.processId);
}

async function bindNewestUserTurnForOperator(process) {
  let page;
  try {
    page = await tabState(process, "operator-read-response");
  } catch (error) {
    return { ok: false, code: error?.code || "READ_RESPONSE_PAGE_UNAVAILABLE" };
  }
  const dispatch = process.pendingPrompt.dispatch;
  const newest = String(page.lastUserId || "");
  const previous = String(process.lastPrompt?.dispatchedUserTurnId || "");
  const baselineLast = String(dispatch.baselineLastUserId || "");
  if (!newest) return { ok: false, code: "READ_RESPONSE_NO_USER_TURN" };
  if (newest === previous || (baselineLast && newest === baselineLast)) {
    return { ok: false, code: "READ_RESPONSE_NO_NEW_USER_TURN" };
  }
  const expectedConversation = conversationKey(process.lastManagedUrl || "");
  if (expectedConversation && conversationKey(page.url || "") !== expectedConversation) {
    return { ok: false, code: "READ_RESPONSE_CONVERSATION_MISMATCH" };
  }
  const baselineIndex = Number(dispatch.baselineUserCount);
  const updated = {
    ...process,
    pendingPrompt: {
      ...process.pendingPrompt,
      dispatch: {
        ...dispatch,
        status: "ACKNOWLEDGED",
        acknowledged: true,
        acknowledgementEvidence: "OPERATOR_READ_RESPONSE",
        materializedUserTurnId: newest,
        materializedUserTurnIndex: Number.isInteger(baselineIndex) && baselineIndex >= 0 ? baselineIndex : null,
        materializedBy: "OPERATOR",
        operatorOverride: {
          action: "READ_RESPONSE",
          at: nowIso(),
          userTurnId: newest,
          previousUserTurnId: previous,
          pageUserCount: Number(page.userCount || 0),
          documentId: page.documentId || ""
        }
      }
    },
    safety: process.safety?.hold?.code === "DISPATCH_EFFECT_UNRESOLVED"
      ? { ...process.safety, hold: { ...process.safety.hold, retryAtMs: 0 } }
      : process.safety,
    updatedAt: nowIso()
  };
  await saveProcess(updated);
  await audit(updated, "OPERATOR_READ_RESPONSE_BOUND_USER_TURN", "operator", {
    dispatchId: dispatch.operationId || "",
    promptHash: process.pendingPrompt.hash || "",
    userTurnId: newest,
    previousUserTurnId: previous,
    pageUserCount: Number(page.userCount || 0),
    automaticResend: false
  }, dispatch.operationId || undefined).catch(() => undefined);
  return { ok: true, process: updated, userTurnId: newest };
}

function operatorReadOutcome(before, process) {
  if (!process) return "PROCESS_GONE";
  if (String(process.lastResponse?.hash || "") !== before.responseHash ||
      Number(process.turn || 0) !== before.turn) return "RESPONSE_CAPTURED";
  if (process.phase === PHASES.WAITING) {
    const reason = String(process.responseObservationTrace?.at?.(-1)?.reason || "");
    if (/STILL_GENERATING/.test(reason)) return "STILL_GENERATING";
    if (/ASSISTANT_NOT_OBSERVED/.test(reason)) return "NO_ANSWER_YET";
    return before.phase === PHASES.SENDING ? "PROMPT_FOUND_READING" : "READING";
  }
  if (process.phase === PHASES.SENDING) return "PROMPT_NOT_FOUND";
  return "PHASE_CHANGED";
}

// v1.8.11 operator "Gå till nästa uppgift i kön": park the current slot with
// a checkpoint (as the 120-minute stale rotation does; the unanswered turn is
// not counted) and activate the next runnable slot in explicit order. The
// parked mission later resumes in a fresh chat told what happened to its last
// prompt (sourceResponseState). Nothing is resent or discarded; with no other
// runnable slot nothing changes.
const OPERATOR_NEXT_QUEUE_PHASES = new Set([PHASES.SENDING, PHASES.WAITING, PHASES.PAUSED]);

async function operatorNextQueueItem({ windowId, processId = "" }) {
  await runtimeReady;
  if (runtimeFault) return { ok: false, code: "RUNTIME_FAULT", error: runtimeFault };
  const process = await loadProcessForWindow(windowId);
  if (!process) return { ok: false, code: "QUEUE_NEXT_NO_PROCESS" };
  if (processId && process.processId !== processId) {
    return { ok: false, code: "QUEUE_NEXT_PROCESS_CHANGED", process: publicSnapshot(process) };
  }
  if (process.phase === PHASES.QUEUE_WAIT) {
    const woken = await wakeMissionQueue(windowId, "OPERATOR_NEXT_QUEUE_ITEM");
    const activated = Boolean(woken && woken.processId !== process.processId);
    return activated
      ? { ok: true, outcome: "QUEUE_WOKEN", toItemId: woken.queueContext?.itemId || "", process: publicSnapshot(woken) }
      : { ok: false, code: "QUEUE_NEXT_NONE_RUNNABLE", process: publicSnapshot(woken || process) };
  }
  return queues.enqueue(process.processId, () => operatorNextQueueItemLocked(process.processId));
}

async function operatorNextQueueItemLocked(processId, {
  automaticPausedWake = false, instructionLockProcessId = ""
} = {}) {
  const process = await findProcessById(processId);
  if (!process || TERMINAL_PHASES.has(process.phase)) {
    return { ok: false, code: "QUEUE_NEXT_NOT_ACTIVE", phase: process?.phase || "", process: publicSnapshot(process) };
  }
  if (!process.queueContext?.itemId) {
    return { ok: false, code: "QUEUE_NEXT_NOT_QUEUE_MANAGED", phase: process.phase, process: publicSnapshot(process) };
  }
  if (!OPERATOR_NEXT_QUEUE_PHASES.has(process.phase)) {
    return { ok: false, code: "QUEUE_NEXT_BUSY", phase: process.phase, process: publicSnapshot(process) };
  }
  if (automaticPausedWake && (
    process.phase !== PHASES.PAUSED || process.missionPause?.state !== MISSION_PAUSE_STATES.ARMED ||
    missionPauseDue(process.missionPause) || process.pendingPrompt?.dispatch || hasUnreceiptedPauseAttempt(process) ||
    !process.pendingPrompt?.text || !process.pendingPrompt?.hash ||
    process.storageRecoveryRequired || process.safety?.qualityIncident
  )) return { ok: false, code: "QUEUE_PAUSED_WAKE_NOT_ADMISSIBLE" };
  const { queue, settings } = await missionQueueForWindow(process.windowId);
  const item = queueItemForProcess(queue, process);
  if (!queue.enabled || !item) {
    return { ok: false, code: "QUEUE_NEXT_ITEM_MISSING", phase: process.phase, process: publicSnapshot(process) };
  }
  const next = selectNextMissionItem(queue, { afterOrder: Number(item.order), excludeItemId: item.itemId });
  if (!next) {
    return { ok: false, code: "QUEUE_NEXT_NONE_RUNNABLE", phase: process.phase, process: publicSnapshot(process) };
  }

  const pending = process.pendingPrompt || null;
  const dispatchEffectPossible = pending?.dispatch?.effectPossible === true;
  if (pending?.promptPause?.reservationId && !dispatchEffectPossible) {
    await releaseGlobalPromptLease({ reservationId: pending.promptPause.reservationId }).catch(() => undefined);
  }
  const sourceResponseState = sessionRotationSourceState(process);
  // A pause the mission itself asked for still holds on its parked slot.
  const pauseUntilMs = process.phase === PHASES.PAUSED && Number(process.missionPause?.resumeAtMs || 0) > Date.now()
    ? Number(process.missionPause.resumeAtMs)
    : 0;
  const maxInteractions = normalizeMissionQuantumInteractions(process.queueContext?.maxInteractions);
  const resumedQuantumProgress = Math.min(
    Math.max(0, maxInteractions - 1),
    Math.max(0, Number(process.queueContext?.interactionCount || 0))
  );
  const objective = String(
    process.objectiveState?.objective ||
    pending?.a2a?.objective ||
    process.lastPrompt?.a2a?.objective ||
    process.goal ||
    ""
  ).trim();
  const resume = {
    ...queueResumeRecordFromAnalysis({
      current: process,
      effectiveNextPrompt: objective,
      previousDisposition: automaticPausedWake ? "CONTINUE" : "OPERATOR_QUEUE_ADVANCE",
      analysisEvidence: automaticPausedWake ? pending?.a2a?.analysisEvidence || null : null,
      sessionReason: automaticPausedWake ? "PAUSED_QUEUE_WAKE" : "OPERATOR_NEXT_QUEUE_ITEM",
      pauseUntilMs
    }),
    // A one-shot status request was consumed by the prompt now left behind.
    processStatusRequest: "",
    sourceResponseState
  };
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
    // The dispatch hold belongs to the conversation left behind.
    safety: process.safety?.hold?.code === "DISPATCH_EFFECT_UNRESOLVED"
      ? { ...process.safety, hold: null }
      : process.safety,
    missionPause: null,
    responseCandidate: null,
    responseInterleave: null,
    waitingRefresh: null,
    lastError: null,
    updatedAt: nowIso()
  };
  await audit(process, automaticPausedWake ? "MISSION_QUEUE_PAUSED_SLOT_YIELD_REQUESTED" : "OPERATOR_NEXT_QUEUE_ITEM_REQUESTED",
    automaticPausedWake ? "mission-work-queue" : "operator", {
    phase: process.phase,
    itemId: item.itemId,
    nextItemId: next.itemId,
    sourceResponseState,
    dispatchEffectPossible,
    unansweredPromptHash: dispatchEffectPossible ? pending?.hash || "" : process.phase === PHASES.WAITING ? process.lastPrompt?.hash || "" : "",
    automaticResend: false
  }).catch(() => undefined);
  const activated = await parkSlotAndActivateNext({
    current: process,
    queue,
    settings,
    item,
    parkedSnapshot,
    resume,
    outcome: automaticPausedWake ? "PAUSED_SLOT_YIELD" : "OPERATOR_QUEUE_ADVANCE",
    summary: automaticPausedWake
      ? "Another slot became runnable while this mission was paused; its checkpoint and not-before time were retained."
      : "The operator moved the queue on to the next task; this mission was parked with its checkpoint.",
    resumedQuantumProgress,
    pauseUntilMs,
    instructionLockProcessId,
    // An explicit operator Next already accepts leaving the old conversation.
    // Automatic pause/terminal wakes do not carry this authority.
    operatorHandoff: !automaticPausedWake,
    parkDetail: {
      operator: !automaticPausedWake,
      phase: process.phase,
      maxInteractions,
      sourceResponseState,
      dispatchEffectPossible
    }
  });
  if (!activated) {
    return { ok: false, code: "QUEUE_NEXT_NONE_RUNNABLE", phase: process.phase, process: publicSnapshot(process) };
  }
  return {
    ok: true,
    outcome: "QUEUE_ADVANCED",
    fromItemId: item.itemId,
    toItemId: activated.queueContext?.itemId || "",
    sourceResponseState,
    process: publicSnapshot(activated)
  };
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

    if (hasUnreceiptedPauseAttempt(current)) {
      const held = await holdForSafety(current, {
        code: "DISPATCH_EFFECT_UNRESOLVED",
        detail: "Early pause resume requires reconciliation of the prior unreceipted send state."
      });
      return {
        ok: false, resumed: false, code: "MISSION_PAUSE_SEND_STATE_UNVERIFIED",
        error: "Utskicksstatusen behöver verifieras innan pausen kan återupptas.",
        process: publicSnapshot(held)
      };
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
    safetyVault: {...safetyVaultStatus},
    driftSettingsVault: {...driftVaultStatus},
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
    // v1.8.12 reserved slot (see lib/global-capacity-scheduler.mjs).
    reservation: {
      workerId: String(settings.reservedWorkerId || ""),
      appliesNow: Boolean(schedulerView.context?.reservedWorkerId),
      mode: String(schedulerView.scheduler?.reservation?.mode || "NONE"),
      reservedActive: schedulerView.scheduler?.reservation?.reservedActive === true,
      sharedCapacity: Number(schedulerView.scheduler?.reservation?.sharedCapacity ?? schedulerView.scheduler?.effectiveCapacity ?? 0),
      workerHasProcess: Boolean(settings.reservedWorkerId) &&
        rows.some((row) => row.process?.workerId === settings.reservedWorkerId && !TERMINAL_PHASES.has(row.process.phase))
    },
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
      configuredCapacity: context.configuredCapacity,
      reservedWorkerId: context.reservedWorkerId
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

// v1.8.12: reserve (or release) one capacity slot for this window's worker.
// One reservation at a time; reserving here moves it from any other worker.
// Running turns are never interrupted; waiters are woken under the new lanes.
async function setReservedSlot({ windowId, workerId, enabled }) {
  await runtimeReady;
  if (runtimeFault) return { ok: false, code: "RUNTIME_FAULT", error: runtimeFault };
  const worker = String(workerId || "").trim();
  if (!worker) return { ok: false, code: "WORKER_ID_REQUIRED" };
  const current = await loadOperatorSettings(chrome.storage.local, { restoreSavedMissions: false, bookmarks: null });
  const previous = String(current.reservedWorkerId || "");
  const next = enabled === true ? worker : (previous === worker ? "" : previous);
  const settings = previous === next
    ? current
    : await saveOperatorSettings({ reservedWorkerId: next }, chrome.storage.local, { restoreSavedMissions: false, bookmarks: null });
  if (String(settings.reservedWorkerId || "") !== next) {
    return { ok: false, code: "RESERVED_SLOT_READBACK_MISMATCH" };
  }
  const gate = await readGlobalPromptGate().catch(() => null);
  const context = await schedulerCapacityContext({ gate, settings });
  const scheduler = await readGlobalCapacityScheduler(chrome.storage.local, {
    capacity: context.effectiveCapacity,
    configuredCapacity: context.configuredCapacity,
    reservedWorkerId: context.reservedWorkerId
  });
  wakeSchedulerProcesses(scheduler?.runnableProcessIds || []);
  const process = Number.isInteger(windowId) ? await loadProcessForWindow(windowId).catch(() => null) : null;
  await appendAudit({
    process,
    scope: process ? "RUN" : (Number.isInteger(windowId) ? "WINDOW" : "APP"),
    auditSessionId: process?.auditSessionId || BACKGROUND_AUDIT_SESSION_ID,
    windowId: process?.windowId ?? windowId ?? null,
    kind: "SCHEDULER_RESERVED_SLOT_UPDATED",
    component: "capacity-scheduler",
    payload: {
      previousWorkerId: previous,
      reservedWorkerId: next,
      changed: previous !== next,
      configuredCapacity: context.configuredCapacity,
      effectiveCapacity: context.effectiveCapacity,
      mode: scheduler?.reservation?.mode || "NONE",
      nonPreemptive: true
    }
  }).catch(() => undefined);
  if (process) await broadcast(process, "scheduler-reserved-slot-updated");
  return {
    ok: true,
    changed: previous !== next,
    previousWorkerId: previous,
    reservedWorkerId: next,
    appliesNow: Boolean(context.reservedWorkerId),
    operatorSettings: settings,
    globalCapacityScheduler: scheduler
  };
}

async function setMaxActiveSessions({ windowId, maxActiveSessions }) {
  const value = Number(maxActiveSessions);
  const { settings, driftSettingsVault } = await saveDriftSettings({ maxActiveSessions: value });
  const gate = await readGlobalPromptGate().catch(() => null);
  const context = await schedulerCapacityContext({ gate, settings });
  const scheduler = await readGlobalCapacityScheduler(chrome.storage.local, {
    capacity: context.effectiveCapacity,
    configuredCapacity: context.configuredCapacity,
    reservedWorkerId: context.reservedWorkerId
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
    globalCapacityScheduler: scheduler,
    driftSettingsVault
  };
}

// Spara grundparametrar (sidepanel.js saveQueueSettings).
// v1.9.2: only the fields the panel sends are saved (it sends the ones the
// operator changed), so a value the form still shows from before cannot
// overwrite a newer one saved by another installation.
async function saveQueueSettingsFromPanel(bound) {
  const patch = {};
  for (const key of ["defaultMissionQuantumInteractions", "queuePriorityAgingSeconds", "queueSwitchDelaySeconds", "queueSwitchSettleSeconds"]) {
    if (bound[key] !== undefined && bound[key] !== null) patch[key] = bound[key];
  }
  for (const key of ["queueSwitchHardReload", "warmQueueResume"]) {
    if (typeof bound[key] === "boolean") patch[key] = bound[key];
  }
  const { settings, driftSettingsVault } = await saveDriftSettings(patch);
  return { ok: true, operatorSettings: settings, driftSettingsVault };
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

  const result = await instructionQueues.enqueue(process.processId, async () => {
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
  // The inbox write precedes this process-lock acquisition, so an in-flight
  // analysis still sees the new instruction and can invalidate its callback.
  if (result.nextInstruction && result.process?.phase === PHASES.PAUSED) {
    const resumed = await queues.enqueue(process.processId, () => resumeAdvisoryPauseForInstruction(process.processId));
    if (resumed) return { ...result, process: publicSnapshot(resumed), nextInstruction: null };
  }
  return result;
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
  void enableWorkModeAtStartup("installed");
  void hydrateProcesses("installed");
});

chrome.runtime.onStartup.addListener(() => {
  void enableWorkModeAtStartup("startup");
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
  // v1.8.13: a stale turn that gave its slot back is not re-adopted by the
  // one-minute recovery scan; only a renewed generation takes it again.
  const released = process.waitingRefresh?.capacityReleased || null;
  if (waitingLike && released && released.promptHash === promptHash &&
      Number(released.turn) === Number(process.turn || 0)) {
    return null;
  }

  return {
    processId: process.processId,
    workerId: process.workerId || "",
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
    configuredCapacity: context.configuredCapacity,
    reservedWorkerId: context.reservedWorkerId
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
        workerId: process.workerId || "",
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
    configuredCapacity: context.configuredCapacity,
    reservedWorkerId: context.reservedWorkerId
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
  // Surface proof also supports the new shell's generic /c/<id> URL, but a
  // root redirect during an in-flight turn must not erase its recovery address.
  if (Safety.eicSurfaceProof(page.modelEvidence, page.url, process.gptRoot).ok &&
      shouldRememberManagedUrl(process, page.url)) process.lastManagedUrl = page.url;
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

const INCIDENT_QUIET_HOLD_CODES = new Set(["LOCAL_PACING_WAIT"]);

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
  // v1.8.13: a hold that starts or changes code (budget, model, quota, ...).
  // Pacing waits happen before every dispatch and are not incidents.
  if ((!prior || prior.code!==code) && !INCIDENT_QUIET_HOLD_CODES.has(code)) {
    await recordIncident(process,"SAFETY_HOLD_STARTED",code,{
      phase:String(process.phase||""),
      retryAtMs:Number(decision?.retryAtMs||0) || null,
      detail:String(decision?.detail||"").slice(0,80),
      priorCode:String(prior?.code||"")
    });
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
  // v1.8.11: in ChatGPT's virtualized thread the user count stops growing, so
  // a receipt bound by the prompt's own A2A messageId carries no count proof.
  const markerReceipt = String(receipt?.resolvedBy || "") === "PROMPT_MARKER";
  const expectedMarker = String(dispatch?.promptMarker || "") || promptCausalMarker(current?.pendingPrompt?.text);

  if (!current || current.phase !== PHASES.SENDING || current.tabId !== tab.id ||
      !dispatch || String(dispatch.operationId || "") !== String(message.dispatchId || "") ||
      String(current.pendingPrompt?.hash || "") !== String(message.promptHash || "") ||
      !userTurnId || !Number.isInteger(userTurnIndex) || userTurnIndex < 0 ||
      (markerReceipt
        ? !expectedMarker || String(receipt?.promptMarker || "") !== expectedMarker
        : !Number.isInteger(receiptUserCount) || receiptUserCount !== userTurnIndex + 1)) {
    return { ok:false, code:"DISPATCH_MATERIALIZATION_TARGET_MISMATCH" };
  }

  if (dispatch.baselineDocumentId &&
      String(message.documentId || "") !== String(dispatch.baselineDocumentId)) {
    return { ok:false, code:"DISPATCH_MATERIALIZATION_DOCUMENT_MISMATCH" };
  }

  if (markerReceipt &&
      (userTurnId === String(dispatch.baselineLastUserId || "") ||
       userTurnId === String(current.lastPrompt?.dispatchedUserTurnId || ""))) {
    return { ok:false, code:"DISPATCH_MATERIALIZATION_PRIOR_TURN" };
  }

  if (!markerReceipt && Number.isInteger(baselineUserCount) && baselineUserCount >= 0 &&
      userTurnIndex !== baselineUserCount) {
    return { ok:false, code:"DISPATCH_MATERIALIZATION_ORDINAL_MISMATCH" };
  }
  const materializedIndex = markerReceipt && Number.isInteger(baselineUserCount) && baselineUserCount >= 0
    ? baselineUserCount
    : userTurnIndex;

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
        acknowledgementEvidence: markerReceipt ? "PROMPT_MARKER" : String(message.evidence || "USER_TURN_MATERIALIZED"),
        materializedUserTurnId: userTurnId,
        materializedUserTurnIndex: materializedIndex,
        materializedBy: markerReceipt ? "PROMPT_MARKER" : "USER_COUNT",
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
    userTurnIndex: materializedIndex,
    userCount: receiptUserCount,
    userTextHash: String(receipt?.userTextHash || ""),
    resolvedBy: markerReceipt ? "PROMPT_MARKER" : "USER_COUNT",
    promptMarker: markerReceipt ? expectedMarker : "",
    evidence: String(message.evidence || "")
  }, dispatch.operationId).catch(() => undefined);
  scheduleFast(updated.processId, 50);
  return { ok:true, userTurnId, userTurnIndex: materializedIndex };
}

async function authorizeDispatch(message,sender) {
  const tab=sender?.tab;
  if (!tab || sender.id!==chrome.runtime.id) return {ok:false,code:"DISPATCH_OWNER_UNVERIFIED"};
  let process=await loadProcessForWindow(tab.windowId);
  const dispatch=process?.pendingPrompt?.dispatch;
  if (runtimeFault || !process || process.phase!==PHASES.SENDING || process.tabId!==tab.id || dispatch?.operationId!==message.dispatchId || process.pendingPrompt.hash!==message.promptHash || process.safety?.qualityIncident || process.storageRecoveryRequired) return {ok:false,code:"DISPATCH_OWNER_UNVERIFIED"};
  await maintainLocalStorage("dispatch-authorization");
  const v=await readSafety();
  if (v.admissionPaused || v.providerHold) return {ok:false,code:v.admissionPaused?"ADMISSION_PAUSED":"PROVIDER_QUOTA_HOLD"};
  const current = await loadProcessForWindow(tab.windowId);
  if (!isCurrentToken(current, ownerToken(process)) || current?.phase !== PHASES.SENDING ||
      current.pendingPrompt?.dispatch?.operationId !== message.dispatchId ||
      current.pendingPrompt?.hash !== message.promptHash || current.safety?.qualityIncident ||
      current.storageRecoveryRequired) return {ok:false,code:"DISPATCH_OWNER_UNVERIFIED"};
  process = current;
  const identity=usageIdentity(process,process.pendingPrompt);
  if (!v.entries.some(e=>e.id===identity) || !process.safety?.turnProof?.allowed || process.safety.turnProof.promptHash!==message.promptHash) return {ok:false,code:"DISPATCH_AUTHORIZATION_MISSING"};
  const admission=await authorizeUsageSend(identity,message.dispatchId);
  if (!admission.allowed) return {ok:false,code:admission.code};
  const pending = process.pendingPrompt;
  return {ok:true,policy:admission.policy,gptRoot:process.gptRoot, transportContext: {
    kind: pending.transportKind || "", requiredConversationKey: pending.requiredConversationKey || "",
    sourceUserTurnId: pending.sourceUserTurnId || "",
    sourcePromptHash: process.deliveryRetry?.sourcePrompt?.hash || "",
    baselineAssistantHash: pending.baselineAssistantHash || ""
  }};
}

function withSafetyVaultTimeout(work,code="SAFETY_POLICY_VAULT_TIMEOUT") {
  let timer;
  return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(code)),SAFETY_VAULT_TIMEOUT_MS);})]).finally(()=>clearTimeout(timer));
}
async function setSafetyVaultStatus(state,extra={}) {
  safetyVaultStatus={state,atMs:Date.now(),folder:SAFETY_POLICY_VAULT_FOLDER,...extra};
  try {
    if (SAFETY_VAULT_SETTLED.has(state)) await chrome.storage.session.set({[SAFETY_VAULT_SESSION_KEY]:safetyVaultStatus});
    else await chrome.storage.session.remove(SAFETY_VAULT_SESSION_KEY); // retried at the next worker start
  } catch {}
  return safetyVaultStatus;
}
async function writeSafetyPolicyToVault(v) {
  // Never stamp the vault ahead of the clock: a save made while the clock ran
  // fast would otherwise be rejected as far-future after the clock is corrected.
  const savedAtMs=Math.min(Number(v.policyUpdatedAtMs || 0) || Date.now(),Date.now());
  return withSafetyVaultTimeout(writeSafetyPolicyVault({policy:v.policy,savedAtMs,appVersion:APP_VERSION},{bookmarks:chrome.bookmarks,normalizePolicy:Safety.normalizePolicy}));
}
async function syncSafetyPolicyVault(reason,{force=false}={}) {
  if (!chrome.bookmarks?.getTree) return setSafetyVaultStatus("UNAVAILABLE",{error:"chrome.bookmarks saknas"});
  if (!force) {
    const settled=await chrome.storage.session.get(SAFETY_VAULT_SESSION_KEY).then(r=>r?.[SAFETY_VAULT_SESSION_KEY]).catch(()=>null);
    if (SAFETY_VAULT_SETTLED.has(settled?.state)) return (safetyVaultStatus={...settled,folder:SAFETY_POLICY_VAULT_FOLDER});
  }
  try {
    return await withSafetyVaultTimeout((async()=>{
      const local=await readSafety();
      const vault=await loadSafetyPolicyVault(chrome.bookmarks,{normalizePolicy:Safety.normalizePolicy});
      const plan=safetyPolicyVaultPlan({local,vault,defaults:Safety.defaults,equalPolicy:equalSafetyPolicy});
      if (plan.action==="ADOPT_VAULT") {
        const after=await adoptSafetyPolicyFromVault(vault);
        if (after.policyOrigin==="VAULT" && after.policyUpdatedAtMs===vault.savedAtMs) {
          await recordIncident(null,"SAFETY_POLICY_RESTORED",plan.reason,{reason,vaultSavedAtMs:vault.savedAtMs,vaultAppVersion:vault.appVersion});
          return setSafetyVaultStatus("RESTORED",{savedAtMs:vault.savedAtMs,reason:plan.reason});
        }
        return setSafetyVaultStatus("IN_SYNC",{savedAtMs:Number(after.policyUpdatedAtMs || 0) || null,reason:"LOCAL_SAVED_DURING_SYNC"});
      }
      if (plan.action==="SEED_VAULT") {
        const record=await writeSafetyPolicyToVault(local);
        return setSafetyVaultStatus("SAVED",{savedAtMs:record.savedAtMs,reason:plan.reason});
      }
      return setSafetyVaultStatus(vault ? "IN_SYNC" : "EMPTY",{savedAtMs:vault?.savedAtMs || null,reason:plan.reason});
    })());
  } catch(error) {
    return setSafetyVaultStatus("ERROR",{error:String(error?.message || error),reason});
  }
}

async function setDriftVaultStatus(state,extra={}) {
  driftVaultStatus={state,atMs:Date.now(),folder:SAFETY_POLICY_VAULT_FOLDER,...extra};
  try {
    if (SAFETY_VAULT_SETTLED.has(state)) await chrome.storage.session.set({[DRIFT_VAULT_SESSION_KEY]:driftVaultStatus});
    else await chrome.storage.session.remove(DRIFT_VAULT_SESSION_KEY); // retried at the next worker start
  } catch {}
  return driftVaultStatus;
}
const readDriftVault=()=>loadDriftSettingsVault(chrome.bookmarks,{normalizeSettings:normalizeDriftVaultSettings});
// One step for every occasion (start, after an operator save, after a backup
// import): a per-setting merge of this installation and the vault, newest save
// of each setting wins (operator-settings.mjs mergeDriftSettings). The merge is
// computed inside the settings write lock; the vault is written afterwards.
// Values that a running turn has already taken (its prompt pause, its queue
// switch) are not changed; the next turn and the scheduler read the new ones.
async function reconcileDriftSettingsWork(reason) {
  if (!chrome.bookmarks?.getTree) return setDriftVaultStatus("UNAVAILABLE",{error:"chrome.bookmarks saknas",reason});
  const vault=await readDriftVault();
  const {settings,merge}=await reconcileLocalDriftSettings(vault,chrome.storage.local);
  if (merge.adoptedKeys.length) {
    await recordIncident(null,"DRIFT_SETTINGS_RESTORED",reason,{vaultSavedAtMs:vault?.savedAtMs ?? null,vaultAppVersion:vault?.appVersion || "",changed:Object.fromEntries(merge.adoptedKeys.map(k=>[k,settings[k]]))});
  }
  let record=vault;
  if (merge.vaultWrite) {
    record=await writeDriftSettingsVault({settings:{values:merge.values,keySavedAtMs:merge.stamps},appVersion:APP_VERSION},{bookmarks:chrome.bookmarks,normalizeSettings:normalizeDriftVaultSettings});
  }
  const state=merge.adoptedKeys.length ? "RESTORED" : merge.vaultWrite ? "SAVED" : vault ? "IN_SYNC" : "EMPTY";
  return setDriftVaultStatus(state,{savedAtMs:record?.savedAtMs ?? null,reason,adoptedKeys:merge.adoptedKeys});
}
// Serialized: one reconciliation at a time in this worker. The queue waits for
// the real end of each run (a bookmark call that outlives the 8 s limit is
// still awaited), so an older run can never commit after a newer one; only the
// caller's answer is bounded by the limit. At startup a result already settled
// in this browser session is reused (no bookmark read).
function reconcileDriftSettings(reason,{force=false}={}) {
  const run=driftVaultQueue.catch(()=>undefined).then(async()=>{
    if (!force && chrome.bookmarks?.getTree) {
      const settled=await chrome.storage.session.get(DRIFT_VAULT_SESSION_KEY).then(r=>r?.[DRIFT_VAULT_SESSION_KEY]).catch(()=>null);
      if (SAFETY_VAULT_SETTLED.has(settled?.state)) return (driftVaultStatus={...settled,folder:SAFETY_POLICY_VAULT_FOLDER});
    }
    return reconcileDriftSettingsWork(reason);
  });
  driftVaultQueue=run;
  return withSafetyVaultTimeout(run,"DRIFT_SETTINGS_VAULT_TIMEOUT").catch(async(error)=>{
    const operatorSave=reason==="OPERATOR_SAVE";
    await setDriftVaultStatus(operatorSave ? "WRITE_FAILED" : "ERROR",{error:String(error?.message || error),reason});
    if (operatorSave) await recordIncident(null,"DRIFT_SETTINGS_VAULT_WRITE_FAILED","OPERATOR",{error:driftVaultStatus.error});
    return driftVaultStatus;
  }).then(status=>({...status}));
}
// Every operator save of a Drift setting goes through here (all in this
// worker, under the settings write lock). First this installation is brought
// in line with the vault (newer values and save times from other
// installations), then the change is saved, then the vault is updated. The
// local save never waits on the vault; a vault failure is reported and retried
// at the next start or save without losing the vault's other settings.
async function saveDriftSettings(patch) {
  await reconcileDriftSettings("BEFORE_OPERATOR_SAVE",{force:true});
  await saveOperatorSettings(patch,chrome.storage.local,{restoreSavedMissions:false,bookmarks:null});
  const driftSettingsVault=await reconcileDriftSettings("OPERATOR_SAVE",{force:true});
  const settings=await loadOperatorSettings(chrome.storage.local,{restoreSavedMissions:false,bookmarks:null});
  return {settings,driftSettingsVault};
}
// Paus mellan analys och post (sidepanel.js updatePostDelay). Panel pages only.
async function savePostDelayFromPanel(message,sender) {
  if (sender?.id!==chrome.runtime.id || !String(sender?.url || "").startsWith(chrome.runtime.getURL("sidepanel.html"))) throw new Error("POST_DELAY_PANEL_SENDER_REQUIRED");
  const {settings,driftSettingsVault}=await saveDriftSettings({postDelaySeconds:Number(message?.postDelaySeconds)});
  return {ok:true,operatorSettings:settings,driftSettingsVault};
}

async function hydrateProcesses(reason) {
  if (hydrationInFlight) return hydrationInFlight;
  hydrationInFlight=(async()=>{
    try {
      storageContractProof ||= await probeStorageContract(chrome.storage.local);
      const repaired=await recoverRc1Checkpoints(chrome.storage.local);
      await readSafety();
      if (!safetyVaultSynced) {
        safetyVaultSynced=true;
        await syncSafetyPolicyVault(reason || "startup");
        await reconcileDriftSettings(reason || "startup");
      }
      const report=await reconcileRestart({local:chrome.storage.local,session:chrome.storage.session,tabs:chrome.tabs,ensureBridge:ensureContentBridgeVersion});
      // v1.8.13: restored rows accumulate for the service worker's lifetime;
      // each row carries its own time (diagnostics 2026-10-05 showed a days-old
      // restore under the latest scan time).
      const stamp=(rows)=>(rows||[]).map(row=>({atMs:report.atMs,...row}));
      report.restored=stamp(report.restored);
      report.unresolved=stamp(report.unresolved);
      for (const row of report.restored) await recordIncident({workerId:row.workerId,processId:row.processId,windowId:row.windowId},"RESTART_RESTORED",row.code,{phase:row.phase,tabId:row.tabId??null,queueItems:row.queueItems??null});
      restartReport={...report,checkpointRepairs:[...(restartReport.checkpointRepairs||[]),...repaired].slice(-30),restored:[...restartReport.restored,...report.restored].slice(-30)};
      if (report.errors.length) throw new Error(`RECOVERY_INVENTORY_ERRORS:${report.errors.map(e=>e.code).join("; ")}`);
      await hydrateBoundProcesses(reason);
      const processes=await loadAllProcesses();
      for (const process of processes) {
        const queue=await loadMissionWorkQueue(process.windowId,chrome.storage.local,{workerId:process.workerId});
        await syncMissionQueueWakeAlarm(queue);
      }
      // An enabled queue can outlive its process. Inspect every live window's
      // bound queue; never guess a replacement window for an unbound owner.
      for (const window of await chrome.windows.getAll({})) {
        const state = await missionQueueForWindow(window.id);
        if (state.queue.enabled) await wakeMissionQueue(window.id, "RESTART_QUEUE_RECONCILE");
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
        const observation=await bridgeMessage(tab.id,{type:"EIC_GF_GET_PAGE_STATE"});
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
    // v1.9.1: settle imported run requirements against the vault now (newest save wins), not at an arbitrary later restart.
    await syncSafetyPolicyVault("backup-import",{force:true});
    await reconcileDriftSettings("backup-import",{force:true});
    await hydrateProcesses();
    return {ok:true,restored,fleetStatus:await fleetStatusSnapshot()};
  }
  if (message.type==="EIC_GF_SAFETY_INSPECT") {
    const [tab]=await chrome.tabs.query({windowId:message.windowId,active:true});
    if (!tab?.id || !supportedUrl(tab.url)) throw new Error("EIC_SURFACE_UNVERIFIED");
    await ensureContentBridgeVersion(tab.id);
    const response=await bridgeMessage(tab.id,{type:"EIC_GF_GET_PAGE_STATE"});
    if (!response?.ok) throw new Error("MODEL_EVIDENCE_MISSING");
    const root=(await readEicSurfaceState()).lastKnownGoodEicUrl || deriveGptRoot(tab.url);
    const inspection=Safety.evaluateModel(response.state.modelEvidence,(await readSafety()).policy,{url:response.state.url,gptRoot:root});
    return {ok:true,inspection};
  }
  if (message.type==="EIC_GF_SAFETY_UPDATE") {
    const before=(await readSafety()).policy;
    const saved=await updateSafetyPolicy(message.policy || {});
    const after=saved.policy;
    await recordIncident(null,"SAFETY_POLICY_UPDATED","OPERATOR",Object.fromEntries(Object.keys(after||{}).filter(k=>before?.[k]!==after[k]).map(k=>[k,after[k]])));
    // The local journal is already committed. A failed vault write is reported
    // to the panel and retried at the next start (local is then the newer save).
    if (!chrome.bookmarks?.getTree) await setSafetyVaultStatus("UNAVAILABLE",{error:"chrome.bookmarks saknas"});
    else {
      try {
        const record=await writeSafetyPolicyToVault(saved);
        await setSafetyVaultStatus("SAVED",{savedAtMs:record.savedAtMs,reason:"OPERATOR_SAVE"});
      } catch(error) {
        await setSafetyVaultStatus("WRITE_FAILED",{error:String(error?.message || error),reason:"OPERATOR_SAVE"});
        await recordIncident(null,"SAFETY_POLICY_VAULT_WRITE_FAILED","OPERATOR",{error:safetyVaultStatus.error});
      }
    }
  }
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

async function recoverLegacyAdvisoryBlocked(process, reason) {
  if (!legacyAdvisoryBlockedCandidate(process)) return process;
  const safety = await readSafety();
  if (safety.admissionPaused || safety.providerHold) return process;
  const queue = await loadMissionWorkQueue(process.windowId,chrome.storage.local,{workerId:process.workerId});
  if (queue.enabled || await sha256Hex(process.lastPrompt.text) !== process.lastPrompt.hash ||
      await sha256Hex(process.lastResponse.text) !== process.lastResponse.hash) return process;

  let tab, page;
  try {
    tab = await chrome.tabs.get(process.tabId);
    const key = conversationKey(process.lastManagedUrl);
    if (tab.windowId !== process.windowId || tab.discarded || tab.frozen ||
        !key || conversationKey(tab.url) !== key) return process;
    await ensureContentBridgeVersion(tab.id);
    const expected = expectedAutonomousUserTurn(process);
    const result = await bridgeMessage(tab.id, {
      type: "EIC_GF_GET_PAGE_STATE", source: "legacy-advisory-blocked-recheck",
      expectedUserTurnId: expected.id, expectedUserIndex: expected.index,
      expectedPromptMarker: expectedPromptMarker(process)
    });
    if (!result?.ok) return process;
    page = result.state;
  } catch { return process; }
  const proof = Safety.evaluateModel(page?.modelEvidence,safety.policy,{url:page?.url,gptRoot:process.gptRoot});
  const causal = autonomousResponseObservation(process,page);
  if (!proof.allowed || conversationKey(page?.url) !== conversationKey(process.lastManagedUrl) ||
      page?.bridgeVersion !== APP_VERSION || page.generating || providerTransportPending(page) ||
      !causal.ready || causal.observation.generating || causal.observation.lastAssistantOwnerTrusted !== true ||
      causal.observation.lastAssistantId !== process.lastResponse.messageId ||
      causal.observation.assistantHash !== process.lastResponse.hash ||
      page.lastUserId !== process.lastPrompt.dispatchedUserTurnId ||
      page.lastAssistantId !== process.lastResponse.messageId) return process;

  const operationId = randomId("legacy-advisory-recovery");
  await audit(process,"LEGACY_ADVISORY_BLOCKED_REANALYSIS_INTENT","migration",{
    reason, from: PHASES.BLOCKED, to: PHASES.ANALYZING,
    sourceResponseHash: process.lastResponse.hash, automaticResend: false
  },operationId);
  // Browser calls may finish after STOP, replacement, or a different capture.
  // The process queue serializes normal controls; read back ownership as well.
  const current = await loadProcessForWindow(process.windowId);
  const currentSafety = await readSafety();
  const currentQueue = await loadMissionWorkQueue(process.windowId,chrome.storage.local,{workerId:process.workerId});
  const currentProof = Safety.evaluateModel(page.modelEvidence,currentSafety.policy,{url:page.url,gptRoot:process.gptRoot});
  if (!isCurrentToken(current,ownerToken(process)) || !legacyAdvisoryBlockedCandidate(current) ||
      current.lastResponse.hash !== process.lastResponse.hash || current.lastPrompt.hash !== process.lastPrompt.hash ||
      current.lastResponse.text !== process.lastResponse.text || current.lastPrompt.text !== process.lastPrompt.text ||
      current.turn !== process.turn || current.lastPrompt.dispatchedUserTurnId !== process.lastPrompt.dispatchedUserTurnId ||
      !currentProof.allowed || currentSafety.admissionPaused || currentSafety.providerHold || currentQueue.enabled) return current || process;

  const next = {
    ...current, version: APP_VERSION, phase: PHASES.ANALYZING, generation: current.generation + 1,
    completedAt: null, updatedAt: nowIso(),
    safety: { ...current.safety, proof: currentProof, evidence: page.modelEvidence,
      lastObservationAtMs: Date.now(), persistedObservationAtMs: Date.now() },
    legacyAdvisoryRecovery: {
      version: 1, atMs: Date.now(), responseId: `${current.processId}:${current.runId}:${current.turn}:${current.lastResponse.hash}`,
      sourceResponseHash: current.lastResponse.hash, priorCompletedAt: current.completedAt || null,
      priorError: deepClone(current.lastError), priorGeneration: current.generation,
      reason: "LEGACY_LOCAL_ADVISORY_BLOCKED_REANALYSIS"
    }
  };
  // This classified migration publishes only ANALYZING. Generic terminal
  // transition rules stay closed; the normal pipeline authorizes the next step.
  await saveProcess(next);
  const readback = await loadProcessForWindow(next.windowId);
  if (!isCurrentToken(readback,ownerToken(next)) || readback.phase !== PHASES.ANALYZING ||
      readback.legacyAdvisoryRecovery?.responseId !== next.legacyAdvisoryRecovery.responseId) {
    throw new Error("LEGACY_ADVISORY_RECOVERY_READBACK_MISMATCH");
  }
  await audit(next,"LEGACY_ADVISORY_BLOCKED_REANALYSIS_COMMIT","migration",{
    reason, sourceResponseHash: next.lastResponse.hash, automaticResend: false,
    priorGeneration: current.generation, generation: next.generation
  },operationId);
  return next;
}

async function recoverLegacyRotationBlocked(process, reason) {
  if (!legacyRotationBlockedCandidate(process) ||
      await sha256Hex(process.pendingPrompt.text) !== process.pendingPrompt.hash) return process;
  if (process.lastPrompt && (await sha256Hex(process.lastPrompt.text) !== process.lastPrompt.hash ||
      await sha256Hex(process.lastResponse.text) !== process.lastResponse.hash)) return process;
  const safety = await readSafety();
  const queue = await loadMissionWorkQueue(process.windowId,chrome.storage.local,{workerId:process.workerId});
  if (safety.admissionPaused || safety.providerHold || queue.enabled) return process;

  // Invalidate older callbacks while changing only the envelope's generation.
  // Keep mission/objective, message id, rotation and instruction bytes intact.
  const envelope = JSON.parse(process.pendingPrompt.text);
  envelope.process.generation = process.generation + 1;
  const promptText = JSON.stringify(envelope);
  const pendingPrompt = { ...process.pendingPrompt, text: promptText,
    hash: await sha256Hex(promptText), a2a: envelope,
    metrics:{ ...process.pendingPrompt.metrics,promptChars:promptText.length } };
  let page, tab;
  try {
    const before = await chrome.tabs.get(process.tabId);
    if (before.windowId === process.windowId && before.status === "complete" && !before.discarded && !before.frozen) {
      await ensureContentBridgeVersion(before.id);
      const observed = await bridgeMessage(before.id, { type:"EIC_GF_GET_PAGE_STATE",
        source:"legacy-rotation-blocked-recheck",expectedUserTurnId:"",expectedUserIndex:null });
      if (observed?.ok) {
        page = observed.state;
        tab = await chrome.tabs.get(before.id);
      }
    }
  } catch {}
  const operationId = randomId("legacy-rotation-recovery");
  if (page && tab) await audit(process,"LEGACY_ROTATION_BLOCKED_RECHECK_INTENT","migration",{
    reason,from:PHASES.BLOCKED,to:PHASES.ROTATING,rotationId:process.sessionRotation.rotationId,
    sourcePromptHash:process.pendingPrompt.hash,automaticResend:false
  },operationId);
  // Also read back after failed browser calls. Normal controls share this
  // process queue; no late observation may replace STOP or a revised record.
  const currentQueue = await loadMissionWorkQueue(process.windowId,chrome.storage.local,{workerId:process.workerId});
  const currentSafety = await readSafety();
  const current = await loadProcessForWindow(process.windowId);
  if (!isCurrentToken(current,ownerToken(process)) || JSON.stringify(current) !== JSON.stringify(process)) return current || process;
  if (!page || !tab || !legacyRotationBlockedCandidate(current) ||
      currentSafety.admissionPaused || currentSafety.providerHold || currentQueue.enabled ||
      tab.windowId !== current.windowId || tab.id !== current.tabId ||
      tab.status !== "complete" || tab.discarded || tab.frozen || page.url !== tab.url ||
      page.bridgeVersion !== APP_VERSION || page.userCount !== 0 || page.assistantCount !== 0 ||
      page.lastUserId || page.lastUserText || page.lastUserHash ||
      page.composerReady !== true || page.composerEmpty !== true || page.generating !== false ||
      page.rateLimitWarning?.active || providerTransportPending(page)) return current;
  const proof = Safety.evaluateModel(page.modelEvidence,currentSafety.policy,{url:page.url,gptRoot:current.gptRoot});
  const landing = Safety.eicSurfaceProof(page.modelEvidence,page.url,current.gptRoot);
  if (!proof.allowed || !landing.ok) return current;

  const next = { ...current,version:APP_VERSION,phase:PHASES.ROTATING,generation:current.generation+1,
    completedAt:null,updatedAt:nowIso(),lastError:null,pendingPrompt,
    safety:{ ...current.safety,proof,evidence:page.modelEvidence,
      lastObservationAtMs:Date.now(),persistedObservationAtMs:Date.now() },
    legacyRotationRecovery:{ version:1,atMs:Date.now(),rotationId:current.sessionRotation.rotationId,
      priorError:deepClone(current.lastError),priorCompletedAt:current.completedAt,
      priorGeneration:current.generation,sourcePromptHash:current.pendingPrompt.hash,
      reboundPromptHash:pendingPrompt.hash,reason:"LEGACY_UNSENT_COLD_ROTATION_READY" }
  };
  // A classified migration can only reopen rotation checks. Generic terminal
  // transitions stay closed; tickRotating and the send gate verify again.
  await saveProcess(next);
  const readback = await loadProcessForWindow(next.windowId);
  if (!isCurrentToken(readback,ownerToken(next)) || readback.phase !== PHASES.ROTATING ||
      readback.legacyRotationRecovery?.rotationId !== next.legacyRotationRecovery.rotationId ||
      readback.pendingPrompt?.hash !== pendingPrompt.hash) throw Error("LEGACY_ROTATION_RECOVERY_READBACK_MISMATCH");
  await audit(next,"LEGACY_ROTATION_BLOCKED_RECHECK_COMMIT","migration",{
    reason,rotationId:next.sessionRotation.rotationId,priorGeneration:current.generation,
    generation:next.generation,promptIdentityRebound:true,automaticResend:false,modelProof:proof.code
  },operationId);
  return next;
}

async function hydrateBoundProcesses(reason) {
  const processes = await loadAllProcesses();
  const migrated = await Promise.all(processes.map(async (process) => {
    if (legacyRotationBlockedCandidate(process)) {
      return queues.enqueue(process.processId,async () => {
        const current = await loadProcessForWindow(process.windowId);
        if (!isCurrentToken(current,ownerToken(process))) return current || process;
        return recoverLegacyRotationBlocked(current,reason);
      });
    }
    if (legacyAdvisoryBlockedCandidate(process)) {
      return queues.enqueue(process.processId,async () => {
        const current = await loadProcessForWindow(process.windowId);
        if (!isCurrentToken(current,ownerToken(process))) return current || process;
        return recoverLegacyAdvisoryBlocked(current,reason);
      });
    }
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
  if (tickStartedAtMs.has(processId)) {
    // A tick is still running: do not pile up more ticks behind it.
    void rescueStalledTick(processId);
    return;
  }
  void enqueueTick(processId, "watchdog");
});

async function pageShowsExpectedGpt(tab, gptRoot) {
  await ensureContentBridgeVersion(tab.id);
  const result = await bridgeMessage(tab.id, { type: "EIC_GF_GET_PAGE_STATE", source: "eic-surface-guard" });
  if (!result?.ok) return null;
  return Safety.eicSurfaceProof(result.state?.modelEvidence, result.state?.url || tab.url || "", gptRoot);
}

async function enforceManagedEicSurface(process, tab) {
  if (!process || !tab || !Number.isInteger(tab.id)) return { action: "SKIP" };
  // v1.8.9: while the EIC root is being discovered the tab visits other GPTs'
  // conversations; only the discovery may bind (and remember) a GPT.
  if (process.sessionRotation?.eicDiscovery && process.sessionRotation.eicDiscovery.state !== "BOUND") {
    return { action: "EIC_DISCOVERY_OWNS_NAVIGATION" };
  }
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
  if (decision.action !== "ACCEPT" && decision.expectedRoot) {
    // v1.8.7: a session rotation owns navigation until its fresh chat is
    // verified as EIC (tickRotating); the guard does not navigate under it.
    if (process.phase === PHASES.ROTATING) return { ...decision, action: "ROTATION_OWNS_NAVIGATION" };
    // ChatGPT's newer shell shows a selected GPT at "/": a generic address is
    // accepted when the page itself shows the expected GPT by name.
    if (decision.classification === "GENERIC_CHATGPT") {
      const shown = await pageShowsExpectedGpt(tab, decision.expectedRoot).catch(() => null);
      if (shown?.ok) {
        eicSurfaceWrongSince.delete(key);
        return { ...decision, action: "ACCEPT", classification: "EIC_BY_NAME", wrongSinceMs: 0 };
      }
    }
  }
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
    case "EIC_GF_SAVED_MISSIONS_CHANGED":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => savedMissionsChanged(bound)));
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
    case "EIC_GF_SET_RESERVED_SLOT":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => setReservedSlot({
        windowId: bound.windowId,
        workerId: bound.workerId,
        enabled: bound.enabled === true
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
      return respond(withVerifiedWorkerMessage(message, sender, saveQueueSettingsFromPanel));
    case "EIC_GF_SET_POST_DELAY":
      return respond(savePostDelayFromPanel(message, sender));
    case "EIC_GF_OPERATOR_READ_RESPONSE":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => operatorReadResponse({
        windowId: bound.windowId,
        processId: String(bound.processId || "")
      })));
    case "EIC_GF_OPERATOR_NEXT_QUEUE_ITEM":
      return respond(withVerifiedWorkerMessage(message, sender, (bound) => operatorNextQueueItem({
        windowId: bound.windowId,
        processId: String(bound.processId || "")
      })));
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
