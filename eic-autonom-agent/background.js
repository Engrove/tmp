import {
  APP_VERSION,
  CONFIG_SCHEMA,
  CONFIG_VERSION,
  CONTENT_SCRIPT_VERSION,
  EXPORT_SCHEMA,
  EXPORT_VERSION,
  NANO_WALL_TIMEOUT_MS,
  RUNTIME_SCHEMA,
  RUNTIME_VERSION,
  createDefaultAudit,
  createDefaultConfig,
  createDefaultRuntime,
  RUN_MODES,
  STORAGE_KEYS,
  TARGET_MODES
} from "./lib/contracts.mjs";
import {
  appendApplicationLog,
  applicationLogForExport,
  applicationLogSummary,
  ensureApplicationLogSession
} from "./lib/application-log.mjs";

import {
  conversationKeyFromUrl,
  deepClone,
  isAllowedChatUrl,
  isOpenAiAuthUrl,
  nowIso,
  randomId,
  sanitizeText,
  sha256Hex,
  stableStringify
} from "./lib/common.mjs";
import {
  createContinuity,
  detectLoopCorrection,
  buildNoProgressRecoveryPivot,
  normalizeContinuity,
  applyNanoDecision,
  projectContinuity,
  sealContinuity,
  verifyContinuity,
  seedContinuityFromStartAnalysis
} from "./lib/continuity.mjs";
import {
  PAUSE_ORIGINS,
  RECOVERY_LADDER,
  STATES,
  createRun,
  classifyBoundaryClaim,
  canDeclareDeadEnd,
  makeRecoveryAttempt,
  nextRecoveryStep,
  transitionRun,
  advanceResponseCandidate
} from "./lib/state-machine.mjs";
import {
  buildTurnObject,
  compileTurnPrompt,
  isNearDuplicateAction,
  parseTargetResult
} from "./lib/prompt-contract.mjs";
import {
  assertDistinctClaimsAndInferences,
  assertTargetActionAllowed,
  buildProtocolRepairDecision,
  createActiveTaskBinding,
  contentAddressedMandateVersion,
  evaluateDecisionClaimReceipts,
  recordDecisionTrace,
  registerMandateVersion,
  validateStopCriteria
} from "./lib/task-integrity.mjs";
import {
  START_RESPONSE_CONTRACTS,
  buildStartPromptRecord
} from "./lib/start-session.mjs";
import {
  autoCaptureDeferDelayMs,
  canReferenceAcknowledgedMandate,
  createAutoCaptureGuard,
  createCaptureFingerprint,
  evaluateAutoCapture,
  evaluateInterruptedNanoRecovery,
  isAutoCaptureTerminalResponse,
  runBlocksAutomaticCapture
} from "./lib/auto-runtime-guards.mjs";
import {
  CORE_SURFACE_REVIEW_DEFERRAL_REASON,
  CORE_SURFACE_REVIEW_STATUS,
  CORE_SURFACE_REVIEW_TRIGGER,
  coreSurfaceAutoApplyDue,
  createCoreSurfaceReviewDeferral,
  createPendingCoreSurfaceReview,
  normalizeCoreSurfaceProposal,
  replayDeferredCoreSurfaceReview,
  reviewHasMaterialChanges,
  scheduleCoreSurfaceAutoApply,
  shouldScheduleAutomaticCoreSurfaceReview
} from "./lib/core-surface-review.mjs";
import {
  currentStateOrFresh,
  assertCurrentExport
} from "./lib/forward-only-policy.mjs";
import {
  DELIVERY_REGULATOR_DISPOSITIONS,
  evaluateDirectProgramDelta,
  resolveCompletionState,
  resolveDeliveryRegulatorDisposition
} from "./lib/delivery-kernel.mjs";
import {
  classifyDestructiveness,
  resolveAutonomousPause,
  runHjalmarMentalControl
} from "./lib/destructiveness.mjs";
import {
  CHATGPT_RESPONSE_STATES,
  advanceStableCompletion,
  classifyChatGptPage
} from "./lib/chatgpt-state-classifier.mjs";
import {
  assistantResponseIdentity,
  isAssistantResponseCandidate,
  latestMessageIsAssistant,
  latestMessageIsUser,
  waitingBaselinePolicy
} from "./lib/response-trigger.mjs";
import {
  enterBackgroundWait,
  refreshBackgroundWait,
  preserveBackgroundForSuspendedTab,
  leaveBackgroundWait,
  shouldApplyResponseTimeout
} from "./lib/background-wait-controller.mjs";
import {
  detachRunFromTab,
  reattachRunToTab,
  runIsDetached
} from "./lib/tab-attachment.mjs";
import {
  ACTION_REGISTRY,
  DELEGATION_CLASSES,
  MJOLNAR_ROLLOUT_MODES,
  MJOLNAR_STATES,
  MJOLNAR_VERDICTS,
  adjudicateMjolnarRequest,
  buildD2DelegationPrompt,
  buildMjolnarRequest,
  canDispatchForRollout,
  createMjolnarLedgerEntry,
  markMjolnarDispatch
} from "./lib/mjolnar.mjs";
import {
  pageContainsTurn,
  pageContainsEffect,
  reconcileEffectRecord
} from "./lib/effect-journal.mjs";
import { buildDeterministicDecision, repairDeterministicDecision } from "./lib/fallback-planner.mjs";
import {
  DETERMINISTIC_CALLBACK_MAX_REARMS,
  DETERMINISTIC_GATE_ACTIONS,
  deterministicSourceExhausted,
  evaluateDeterministicDispatch,
  exhaustDeterministicDispatch,
  prepareDeterministicDispatch,
  rearmDeterministicDispatch
} from "./lib/deterministic-dispatch-gate.mjs";
import {
  PROTOCOL_DECISION_PATHS,
  markDeterministicPending,
  preservedProtocolPageMatch,
  preservedProtocolRecoveryEligible,
  protocolFastPathEligible,
  selectProtocolDecisionPath
} from "./lib/protocol-fast-path.mjs";
import {
  NANO_ANALYSIS_MODES,
  NANO_CLAIM_LEASE_STATE,
  NANO_DECISION_SOURCE,
  classifyNanoAnalysisMode,
  claimNanoRequestState,
  compactContextText,
  completeNanoRequestState,
  createNanoRequest,
  failNanoRequestState,
  groundDecisionFromObservation,
  nanoClaimLeaseState,
  updateNanoProgressState,
  validateNanoDecisionGrounding
} from "./lib/nano-pipeline.mjs";
import {
  MAIN_TASK_BASELINE_SCHEMA,
  parseMainTaskBaseline
} from "./lib/main-task-guard.mjs";
import {
  SESSION_CONTEXT_INIT_FAILURE_CODE,
  SESSION_CONTEXT_INIT_MAX_OPERATOR_RETRIES,
  SESSION_CONTEXT_INIT_STATE,
  advanceSessionContextInit,
  createSessionContextInit,
  evaluateSessionContextInitStall,
  failSessionContextInit,
  retrySessionContextInit,
  sessionContextInitBlocksWork,
  sessionContextInitOverlay,
  sessionContextInitRetryable
} from "./lib/session-context-init.mjs";
import {
  APP_AUDIT_EFFECT_CEILING,
  APP_AUDIT_GATES,
  createAuditRunState
} from "./lib/app-audit-contract.mjs";
import {
  applyAuditEvent,
  auditEventPlacement,
  computeAuditProgress,
  evaluateAuditEvent,
  parseAuditEvent,
  stripAuditEventFromText,
  summarizeAuditEventForNano
} from "./lib/app-audit-parser.mjs";
import {
  buildAppAuditStartAnalysis,
  buildAppAuditStartPrompt
} from "./lib/app-audit-prompt.mjs";
import {
  ARCHAEOLOGY_EFFECT_CEILING,
  ARCHAEOLOGY_GATES,
  createArchaeologyRunState
} from "./lib/archaeology-contract.mjs";
import {
  applyArchaeologyEvent,
  archaeologyEventPlacement,
  evaluateArchaeologyEvent,
  parseArchaeologyEvent,
  stripArchaeologyEventFromText,
  summarizeArchaeologyEventForNano
} from "./lib/archaeology-parser.mjs";
import {
  buildArchaeologyStartAnalysis,
  buildArchaeologyStartPrompt
} from "./lib/archaeology-prompt.mjs";
import {
  COMPLETION_DISPOSITIONS,
  continuityIsGrounded,
  deriveDeterministicProgress,
  resolveCompletionDisposition,
  validateDecisionGrounding
} from "./lib/decision-grounding.mjs";
import {
  hasDeliveredStartPrompt,
  sessionIdentityFromPage
} from "./lib/session-receipts.mjs";
import {
  READINESS_DEFAULTS,
  SESSION_INIT_STATES,
  advanceReadinessStability,
  advanceSessionInitGate,
  createSessionInitGate,
  evaluateNewSessionReadiness,
  sessionInitBlocksDispatch,
  sessionInitHoldsAutonomy
} from "./lib/session-readiness.mjs";
import {
  isMetaOnlyAction
} from "./lib/decision-grounding.mjs";
import {
  bindContinuityScope,
  cloneSpecializedRunState,
  continuityScopeWindowId,
  initializeWindowContinuity,
  promoteContinuityConversation,
  resolveStickyRunMode
} from "./lib/scoped-continuity.mjs";
import { reconcileStartPromptReceipts } from "./lib/start-receipt-reconcile.mjs";
import { responseEligibleForNano } from "./lib/response-completion-policy.mjs";
import {
  NON_PROGRESS_LIMIT,
  computeObservationIdentity,
  consumePostCutoffAction,
  createObservationLoopState,
  recordObservationCycle,
  registerObservationIdentity,
} from "./lib/autonomy-progress.mjs";
import {
  appendRecoveryAttempt,
  classifyConversationLocatorChange,
  compactEffectJournal,
  mergeSeenUserTurnIds,
  mergeSeenUserMessageHashes,
  normalizeBackgroundAction,
  resolveLifecycleDeadlineExtension,
  shouldPauseForLoop
} from "./lib/runtime-safety.mjs";
import {
  activateMissionForRun,
  activateStandaloneMission,
  importMissionView,
  MISSION_STATES,
  missionViewForWindow,
  reconcileRuntimeMissions,
  transitionMission
} from "./lib/mission-state-machine.mjs";
import {
  MISSION_MODE_IDS,
  MISSION_SURFACE_ROLES
} from "./lib/mission-contract.mjs";
import {
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
  setWebTargetCapabilityState,
  updateSurfaceForTab
} from "./lib/surface-pair.mjs";
import { normalizeMissionStartRequest } from "./lib/mission-mode-adapter.mjs";
import {
  BUILD_PROFILES,
  buildProfileSummary,
  detectBuildProfile
} from "./lib/build-profile.mjs";
import {
  WEB_PERMISSION_STATES,
  containsExactOriginPermission,
  requestExactOriginPermission,
  revokeExactOriginPermission
} from "./lib/browser-permission.mjs";
import {
  CDP_SESSION_STATES,
  attachBoundedCdp,
  createCdpSession,
  cdpSessionMatchesSurface,
  detachBoundedCdp,
  markCdpSessionStale,
  normalizeCdpSession
} from "./lib/cdp-session.mjs";
import {
  EVIDENCE_OBSERVATION_STATES,
  EVIDENCE_TYPES,
  createEvidenceObservation
} from "./lib/evidence-contract.mjs";
import {
  captureEvidenceBundle,
  disableEvidenceDomains,
  enableEvidenceDomains,
  normalizeCdpEvidenceEvent
} from "./lib/cdp-evidence.mjs";
import {
  clearWindowEvidence,
  loadWindowEvidenceStore,
  loadWindowEvidenceSummary,
  markWindowEvidenceStale,
  persistEvidenceItem,
  readScreenshotEvidenceBody,
  saveWindowEvidenceStore,
  setEvidenceObservation
} from "./lib/evidence-storage.mjs";
import {
  parseBrowserActionResponse,
  validateBrowserAction
} from "./lib/browser-action-contract.mjs";
import {
  BROWSER_APPROVAL_STATES,
  approvalMatchesAction,
  approveBrowserAction,
  classifyBrowserActionRisk,
  consumeBrowserApproval,
  createPendingBrowserApproval,
  denyBrowserAction,
  normalizeBrowserApproval
} from "./lib/browser-risk-policy.mjs";
import {
  attachmentReceiptDigest,
  beginBrowserLoopStep,
  BROWSER_LOOP_STATES,
  capturePostActionObservation,
  buildBrowserObservationPrompt,
  completeBrowserLoopStep,
  controllerResponseReady,
  createAttachmentReceipt,
  createBrowserLoopState,
  normalizeBrowserLoopState,
  updateBrowserLoopStep,
  verifyAttachmentReceipt
} from "./lib/browser-controller-loop.mjs";
import {
  BROWSER_RECOVERY_STATES,
  completeBrowserRecovery,
  consumeImportRollback,
  createBrowserRecoveryState,
  createImportRollback,
  markBrowserRecoveryRequired,
  normalizeBrowserRecoveryState,
  normalizeImportRollback,
  prepareBrowserRecoveryResume,
  sanitizeImportedWindowContext
} from "./lib/browser-recovery.mjs";
import {
  executeBrowserAction
} from "./lib/browser-action-executor.mjs";
import {
  UI_COMMANDS,
  createUiCommandError,
  createUiSnapshot,
  dispatchUiCommand
} from "./lib/ui-contract.mjs";
import {
  createOperatorAction,
  submitOperatorActionReceipt,
  OPERATOR_ACTION_STATUS
} from "./lib/operator-action.mjs";
import {
  createOperatorDecision,
  acceptOperatorDecisionReceipt
} from "./lib/level10-ack.mjs";
import {
  DEFAULT_QUICK_PROFILE_ID,
  bindQuickProfile,
  getQuickProfile,
  recommendQuickProfile
} from "./lib/quick-profiles.mjs";
import {
  NANO_CORE_PROFILES,
  SCENARIO_PRESETS,
  TARGET_CORE_PROFILES,
  findCoreProfile
} from "./lib/core-profiles.mjs";
import {
  openSessionDatabase,
  SESSION_DB_POINTER_KEYS
} from "./lib/session-db.mjs";
import {
  buildSessionCapture,
  createDeltaCapture,
  captureRefreshRequired,
  inferTargetProjectBinding,
  reconcileMonotonicCapture
} from "./lib/session-capture.mjs";
import {
  buildActiveMemoryCapsule,
  createSectionSummary,
  sectionTurns,
  synthesizeSessionMemory
} from "./lib/session-memory.mjs";
import {
  continuitySemanticallyEqual,
  evaluateNanoDiscrimination,
  normalizeNanoHostTelemetry,
  projectRunIntoContinuity,
  shouldDeferSessionCapture
} from "./lib/runtime-hardening.mjs";
import {
  acknowledgeFullAuditBatch,
  appendFullAuditEntries,
  createFullAuditEntry,
  createFullAuditQueue,
  fullAuditBatch,
  normalizeFullAuditQueue
} from "./lib/full-audit-log.mjs";


const EIC_AUTONOM_AGENT_PROJECT_ID = 63;

async function createRunTaskBinding(run, config, {
  sourceTurnId = ""
} = {}) {
  const mandateSha256 = await sha256Hex(sanitizeText(config?.targetMandate, 24_000));
  return createActiveTaskBinding({
    projectId: Number(
      run?.activeTaskProjectId ||
      config?.activeTaskProjectId ||
      EIC_AUTONOM_AGENT_PROJECT_ID
    ),
    workstreamId: sanitizeText(run?.mode || "CHATGPT_CONTINUATION", 240),
    taskFingerprint: sanitizeText(
      run?.taskFingerprint || run?.conversationKey || run?.runId,
      256
    ),
    auditRunId: sanitizeText(run?.runId, 240),
    mandateVersion: sanitizeText(config?.targetMandateVersion || "target-core-v6", 160),
    mandateSha256,
    sourceTurnId: sanitizeText(sourceTurnId || run?.currentTurn?.turnId || `run:${run?.runId}`, 240)
  });
}

async function bindRunQuickProfile(run, config, {
  selectedBy = "OPERATOR"
} = {}) {
  const profileId = sanitizeText(config?.quickProfileId || config?.scenarioPreset || DEFAULT_QUICK_PROFILE_ID, 80);
  const profile = getQuickProfile(profileId);
  if (!profile) throw new Error("QUICK_PROFILE_UNKNOWN");
  const recommendation = recommendQuickProfile([
    config?.newSessionPrompt,
    run?.mode,
    run?.currentWorkUnit,
    run?.intent
  ].filter(Boolean).join("\n"));
  const mandateSha256 = await sha256Hex(sanitizeText(config?.targetMandate, 24_000));
  run.quickProfileBinding = bindQuickProfile({
    profileId: profile.id,
    missionId: sanitizeText(run?.missionId || run?.activeMissionId || `mission:${run?.runId}`, 240),
    taskFingerprint: sanitizeText(run?.taskFingerprint || run?.conversationKey || run?.runId, 240),
    mandateVersion: sanitizeText(config?.targetMandateVersion || "target-core-v6", 240),
    mandateSha256,
    selectedBy
  });
  run.profileRecommendation = {
    ...recommendation,
    activeProfileId: profile.id,
    silentlyApplied: false
  };
  run.sessionCapturePolicy = profile.dimensions.sessionCapture;
  run.sessionMemoryPolicy = profile.dimensions.sessionMemory;
  run.outputDensity = profile.dimensions.outputDensity;
  return run;
}

const liveCdpSessions = new Map();
const autoCaptureTimers = new Map();
const autoCaptureInFlight = new Map();
// v0.10.11: consecutive deferrals per window, used to back off the automatic
// capture self-retry chain. Cleared as soon as a capture is actually allowed.
const autoCaptureDefers = new Map();
const fullAuditPendingEntries = [];
let fullAuditLoggingEnabledCache = false;
let fullAuditQueueCache = createFullAuditQueue();
let fullAuditQueueLastError = "";
let sessionDatabasePromise = null;

async function sessionDatabase() {
  if (!sessionDatabasePromise) {
    sessionDatabasePromise = openSessionDatabase();
  }
  return sessionDatabasePromise;
}


async function prepareBackgroundAutoCapture(windowId) {
  return enqueue(async () => {
    const bundle = await loadBundle(windowId);
    const { config, runtime, audit } = bundle;
    const context = getWindowContext(runtime, windowId);
    const tabId = context.run?.targetTabId || context.selectedTabId;
    if (!Number.isInteger(tabId)) return { allowed: false, reason: "TARGET_NOT_LINKED" };
    const linked = context.linkedTabs?.[String(tabId)];
    if (!linked) return { allowed: false, reason: "TARGET_NOT_LINKED" };

    let page;
    let tab;
    try {
      [page, tab] = await Promise.all([
        readPage(tabId, "background-auto-capture"),
        chrome.tabs.get(tabId)
      ]);
    } catch (error) {
      return { allowed: false, reason: "PAGE_READ_FAILED", error: sanitizeText(error?.message || error, 800) };
    }

    linked.url = page.url;
    linked.title = page.title;
    linked.conversationKey = page.conversationKey;
    linked.documentEpoch = page.documentEpoch;
    linked.lastSeenAt = nowIso();
    linked.generating = page.generating;
    linked.responseState = page.responseState || "UNKNOWN_RECONCILE";
    linked.backgroundActive = Boolean(page.backgroundSignals?.active);
    linked.backgroundLanguage = page.backgroundSignals?.language || "unknown";
    linked.taskFingerprint = page.taskFingerprint || linked.taskFingerprint || "";
    linked.discarded = Boolean(tab?.discarded);
    linked.frozen = Boolean(tab?.frozen);
    linked.active = Boolean(tab?.active);
    linked.autoDiscardable = typeof tab?.autoDiscardable === "boolean" ? tab.autoDiscardable : null;
    linked.assistantCount = page.assistantCount;
    linked.latestAssistantHash = page.latestAssistantHash;
    linked.latestAssistantCandidate = Boolean(page.latestAssistantCandidate);
    linked.latestMessageRole = page.latestMessageRole || "unknown";
    linked.latestMessageHash = page.latestMessageHash || "";
    linked.userTurnIds = mergeSeenUserTurnIds(linked.userTurnIds, page.userTurnIds);
    linked.userMessageHashes = mergeSeenUserMessageHashes(linked.userMessageHashes, page.userMessageHashes);

    const fingerprint = createCaptureFingerprint({
      conversationKey: linked.conversationKey,
      latestMessageHash: linked.latestMessageHash,
      assistantCount: linked.assistantCount
    });
    const decision = evaluateAutoCapture({
      enabled: config.autoSessionCaptureEnabled !== false,
      linked: true,
      stable: isAutoCaptureTerminalResponse(linked),
      fingerprint,
      lastFingerprint: context.autoCaptureFingerprint || "",
      inFlight: autoCaptureInFlight.has(Number(windowId)),
      paused: runBlocksAutomaticCapture(context.run),
      guard: context.autoCaptureGuard || null
    });
    context.updatedAt = nowIso();
    await writeRuntimeBundle(runtime, bundle.continuity, audit);
    return { ...decision, fingerprint, tabId };
  });
}

function scheduleBackgroundAutoSessionCapture(windowId, reason = "observation") {
  const numericWindowId = Number(windowId);
  if (!Number.isInteger(numericWindowId)) return;
  const existing = autoCaptureTimers.get(numericWindowId);
  if (existing) clearTimeout(existing);
  // v0.10.11: a deferred capture backs off instead of retrying at a fixed 2.5 s.
  // The deferral condition (an ASSESSING run or a pending Nano request) can hold
  // for a long time, and in v0.10.10 that produced 20 cancelled cycles in 50 s,
  // each costing three storage writes and one content-script page read. The
  // 30 s watchdog still re-triggers capture, so backing off can never lose one.
  const delayMs = autoCaptureDeferDelayMs(autoCaptureDefers.get(numericWindowId) || 0);
  const timer = setTimeout(async () => {
    autoCaptureTimers.delete(numericWindowId);
    if (autoCaptureInFlight.has(numericWindowId)) return;
    let decision;
    try {
      decision = await prepareBackgroundAutoCapture(numericWindowId);
    } catch (error) {
      console.warn(`EIC Autonom Agent: auto-capture preflight misslyckades för fönster ${numericWindowId}.`, error);
      return;
    }
    if (!decision?.allowed) return;
    autoCaptureDefers.delete(numericWindowId);

    const requestId = randomId("auto-capture");
    autoCaptureInFlight.set(numericWindowId, {
      requestId,
      tabId: decision.tabId,
      fingerprint: decision.fingerprint
    });
    await enqueue(async () => {
      const bundle = await loadBundle(numericWindowId);
      const context = getWindowContext(bundle.runtime, numericWindowId);
      context.autoCaptureGuard = createAutoCaptureGuard({
        fingerprint: decision.fingerprint,
        requestId,
        status: "STARTED"
      });
      await writeRuntimeBundle(bundle.runtime, bundle.continuity, bundle.audit);
    });

    try {
      await captureSessionContext(numericWindowId, {
        forceFull: false,
        automatic: true,
        trigger: reason,
        requestId,
        fingerprint: decision.fingerprint
      });
    } catch (error) {
      const detail = sanitizeText(error?.message || error, 1000);
      await enqueue(async () => {
        const bundle = await loadBundle(numericWindowId);
        const context = getWindowContext(bundle.runtime, numericWindowId);
        const cancelled = detail.includes("SESSION_CAPTURE_CANCELLED");
        context.autoCaptureGuard = createAutoCaptureGuard({
          fingerprint: decision.fingerprint,
          requestId,
          status: cancelled ? "CANCELLED" : "FAILED",
          error: detail
        });
        addAudit(bundle.audit, {
          kind: cancelled ? "info" : "error",
          title: cancelled ? "Automatisk Session Capture avbruten" : "Automatisk Session Capture misslyckades",
          detail: `${decision.fingerprint} · ${detail}`,
          windowId: numericWindowId,
          tabId: decision.tabId,
          runId: context.run?.runId || null
        });
        await writeRuntimeBundle(bundle.runtime, bundle.continuity, bundle.audit);
        await notifyPanels(numericWindowId);
      });
      if (!detail.includes("SESSION_CAPTURE_CANCELLED")) {
        console.warn(`EIC Autonom Agent: automatisk Session Capture misslyckades för fönster ${numericWindowId}.`, error);
      }
    } finally {
      autoCaptureInFlight.delete(numericWindowId);
    }
  }, delayMs);
  autoCaptureTimers.set(numericWindowId, timer);
}


function runtimeManifest() {
  if (typeof chrome?.runtime?.getManifest === "function") {
    return chrome.runtime.getManifest();
  }
  return {
    permissions: ["sidePanel", "storage", "tabs", "scripting", "alarms"],
    host_permissions: ["https://chatgpt.com/*", "https://chat.openai.com/*"]
  };
}

function runtimeBuildProfile() {
  return detectBuildProfile(runtimeManifest());
}

function runtimeBuildSummary() {
  return buildProfileSummary(runtimeManifest());
}

function chatGptControllerSurface(context) {
  return context?.surfacePair?.surfaces?.[MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER] || null;
}

function webTargetSurface(context) {
  return context?.surfacePair?.surfaces?.[MISSION_SURFACE_ROLES.WEB_TARGET] || null;
}

function cdpLiveKey(windowId) {
  return String(Number(windowId));
}

function applyWebTargetCapabilityState(context, patch = {}) {
  const target = webTargetSurface(context);
  if (!target) return false;
  const changed = [
    ["permissionState", patch.permissionState],
    ["permissionOriginPattern", patch.permissionOriginPattern],
    ["debuggerState", patch.debuggerState],
    ["debuggerSessionId", patch.debuggerSessionId]
  ].some(([key, value]) => value !== undefined && String(target[key] ?? "") !== String(value ?? ""));
  if (!changed) return false;
  context.surfacePair = setWebTargetCapabilityState(context.surfacePair, patch);
  return true;
}

const WATCHDOG_ALARM = "eic-autonom-agent-watchdog-v109";
const WATCHDOG_MINUTES = 0.5;
const AUDIT_LIMIT = 240;
const MAX_PENDING_RESPONSE_CHARS = 32_000;
const MAX_START_PROMPT_CHARS = 120_000;
const SUBMISSION_GRACE_MS = 90_000;
const MAX_SUBMISSION_ATTEMPTS = 2;
const NANO_CLAIM_GRACE_MS = NANO_WALL_TIMEOUT_MS;
const NANO_CLAIM_LEASE_MS = NANO_WALL_TIMEOUT_MS;
const NANO_MAX_ATTEMPTS = 3;
// v0.7.0: bounded number of fresh-Nano-session retries for one preserved takeover
// observation before the run falls back to owner reconciliation. Without this budget
// v0.6.9 had exactly zero retries and went terminal on the first host failure.
const TAKEOVER_MAX_RECOVERY_ATTEMPTS = 3;
const PREPARED_SESSION_READY_TIMEOUT_MS = 30_000;

function buildPendingNanoRequest({
  requestId = randomId("nano-request"),
  observationId,
  analysisMode = NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS,
  operatorResumeDecision = null,
  now = Date.now()
} = {}) {
  const request = createNanoRequest({
    requestId,
    observationId,
    mode: analysisMode,
    graceMs: NANO_CLAIM_GRACE_MS,
    now
  });
  return {
    ...request,
    attempts: 0,
    repairAttempt: 0,
    validationErrors: [],
    requeueCount: 0,
    heartbeatAt: null,
    inputDigest: "",
    inputChars: 0,
    resultSummary: "",
    fallbackScheduledAt: null,
    fallbackDecisionDigest: "",
    operatorResumeDecision
  };
}

function adoptMainTaskBaseline(continuity, baseline, { now = Date.now() } = {}) {
  if (!baseline || baseline.schema !== MAIN_TASK_BASELINE_SCHEMA) return false;
  continuity.mainTaskBaseline = deepClone(baseline);
  if (!sanitizeText(continuity.intent?.text, 6000)) {
    continuity.intent = {
      text: sanitizeText(baseline.mainTask?.programGoal || baseline.mainTask?.objective, 6000),
      setBy: "target-main-task-baseline-routing-context",
      at: nowIso(now)
    };
  }
  if (!sanitizeText(continuity.position?.workUnit, 2400)) {
    continuity.position.workUnit = sanitizeText(baseline.current?.boundedWorkUnit, 2400);
    continuity.position.workUnitId = randomId("wu");
    continuity.position.workUnitSource = "target-main-task-baseline-routing-context";
    continuity.position.updatedAt = nowIso(now);
  }
  continuity.updatedAt = nowIso(now);
  return true;
}

function armMainTaskBaselineRequest(run, continuity, {
  now = Date.now(),
  reason = "MAIN_TASK_BASELINE_REQUIRED",
  observation = null
} = {}) {
  if (continuity?.mainTaskBaseline || run?.pendingNanoRequest) return run;
  const currentObservation = observation || run?.pendingObservation;
  if (!currentObservation) return run;
  currentObservation.mainTaskBaselineRequired = true;
  currentObservation.targetResult ||= {
    valid: false,
    reason,
    status: null,
    next: "",
    completionEvidence: "",
    fullStopReason: null,
    turnId: null
  };
  run.pendingObservation = currentObservation;
  const request = buildPendingNanoRequest({
    observationId: currentObservation.observationId,
    analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
    now
  });
  run.pendingNanoRequest = markDeterministicPending({
    ...request,
    baselinePromptOnly: true,
    deterministicSource: NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
  }, NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL);
  run.nanoTelemetry ||= {};
  run.nanoTelemetry.lastRequestId = run.pendingNanoRequest.requestId;
  run.nanoTelemetry.lastMode = NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP;
  run.nanoTelemetry.lastStatus = "DETERMINISTIC_BASELINE_PENDING";
  run.nanoTelemetry.lastSource = NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL;
  run.takeoverBootstrapRequired = true;
  run.sessionContextInit = advanceSessionContextInit(
    run.sessionContextInit,
    SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED,
    {
      catchObservationId: currentObservation.observationId,
      catchResponseIdentity: currentObservation.responseIdentity || currentObservation.responseHash || ""
    },
    { now, force: true }
  );
  return transitionRun(run, STATES.ASSESSING, {
    origin: PAUSE_ORIGINS.NONE,
    reason: "Sessions-catch är klar. Den kanoniska huvuduppgiftsfrågan levereras deterministiskt före all annan agentbearbetning.",
    force: true
  });
}

/**
 * v0.10.11: the single owner of the FAILED session-context transition.
 *
 * Besides marking the phase failed it clears the bindings that made the
 * v0.10.10 stall unrecoverable — the burned deterministic source and the dead
 * pending request — so an operator retry, or a genuinely new target response,
 * can arm a fresh chain. The run is held in PROGRAM_BLOCKED because
 * `pauseRequiresHuman` now reports a failed initialization as human-required;
 * WAITING_FOR_RESPONSE would repeat the exact mislabelling this release fixes.
 */
function applySessionContextInitFailure(runValue, {
  windowId,
  audit,
  code = SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_DISPATCH_FAILED,
  detail = "",
  now = Date.now()
} = {}) {
  let run = runValue;
  run.sessionContextInit = failSessionContextInit(run.sessionContextInit, { code, detail, now });
  run.pendingNanoRequest = null;
  run.pendingObservation = null;
  run.deterministicGroundingFailure = null;
  run.deterministicDispatchRearms = 0;
  run.timeoutSuspended = true;
  run.resumePlan = {
    requestedAction: "Ingen. Baselinefrågan nådde aldrig målsessionen; ingen tur ska antas vara skickad.",
    requiredEvidence: [
      "Operatörens Försök igen, eller ett stopp av addonet. Ingen automatisk återhämtning är giltig här."
    ],
    workUnit: "",
    alternatives: [],
    reason: sanitizeText(detail, 2000)
  };
  appendRecoveryAttempt(run, makeRecoveryAttempt("SESSION_CONTEXT_INIT_FAILED", {
    outcome: "OPERATOR_REQUIRED",
    detail: `${code} · ${sanitizeText(detail, 900)}`
  }));
  run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
    origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
    reason: sanitizeText(detail, 2000) ||
      "Sessionsinitieringen kunde inte slutföras och ingen prompt levererades.",
    now,
    force: true
  });
  run.nanoTelemetry ||= {};
  run.nanoTelemetry.lastStatus = "SESSION_CONTEXT_INIT_FAILED";
  addAudit(audit, {
    kind: "blocked",
    title: "Sessionsinitiering misslyckades — ingen prompt skickades",
    detail: `${code} · ${sanitizeText(detail, 1400)}`,
    windowId,
    tabId: run.targetTabId,
    runId: run.runId
  });
  return run;
}

const DELIVERED_EFFECT_STATUSES = new Set([
  "SUBMITTING",
  "SUBMITTED_UNCONFIRMED",
  "ACKED"
]);

/**
 * v0.10.11 invariant helper: did this observation actually cause a prompt to
 * reach the target? Only a journalled effect that left PREPARED counts. An
 * observation with no effect record produced no user message, no prompt digest
 * and no submission receipt, and must therefore never be recorded as processed.
 */
function observationProducedDeliveredTurn(run = {}, observation = null) {
  if (!observation) return false;
  const journal = Array.isArray(run?.effectJournal) ? run.effectJournal : [];
  if (!journal.length) return false;
  const responseHash = String(observation.responseHash || "");
  const epoch = String(observation.documentEpoch || "");
  return journal.some((effect) => {
    if (!effect || !DELIVERED_EFFECT_STATUSES.has(String(effect.status || ""))) return false;
    if (responseHash && String(effect.sourceObservationHash || "") === responseHash) return true;
    return Boolean(epoch) && String(effect.sourceObservationEpoch || "") === epoch;
  });
}

function observationOwnerLocators(run = {}) {
  return [
    run.conversationKey ? `conversation:${run.conversationKey}` : "",
    Number.isInteger(Number(run.targetTabId)) ? `tab:${Number(run.targetTabId)}` : "",
    run.currentTurn?.turnId ? `turn:${run.currentTurn.turnId}` : "",
    run.runId ? `run:${run.runId}` : ""
  ].filter(Boolean);
}

function programNextActionFromContinuity(continuity = {}) {
  const directions = Array.isArray(continuity?.nextDirections) ? continuity.nextDirections : [];
  for (let index = directions.length - 1; index >= 0; index -= 1) {
    const value = sanitizeText(
      typeof directions[index] === "string" ? directions[index] : directions[index]?.text,
      5000
    );
    if (value && !isMetaOnlyAction(value)) return value;
  }
  return "";
}

/**
 * v0.10.11: apply a deterministic decision **in-band**, inside the same
 * serialized operation that just persisted DISPATCHED.
 *
 * v0.10.10 handed this to `setTimeout(() => apply(...).catch(console.warn), 0)`.
 * That made `deterministicDispatchState: "DISPATCHED"` a statement of intent
 * rather than a receipt: when the application step threw before its first
 * persistence, the exception reached only the service-worker console, the run
 * stayed ASSESSING behind a live lease, and 52 s later the observation was
 * burned by CALLBACK_ATTEMPTS_EXHAUSTED without a single durable trace.
 *
 * The caller must already hold the operation queue. The returned snapshot is
 * the caller's return value, so the tick still ends in exactly one place.
 */
async function applyDeterministicDecisionInBand(windowId, request, decision, source) {
  const requestId = request.requestId;
  const analysisMode = request.mode;
  try {
    return await applyNanoDecisionCommandUnlocked(windowId, {
      requestId,
      claimId: null,
      analysisMode,
      durationMs: 0,
      repairUsed: false,
      source,
      decision
    });
  } catch (error) {
    return recordDeterministicDispatchFailureUnlocked(windowId, {
      requestId,
      source,
      analysisMode,
      error
    });
  }
}

function deterministicDispatchErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const known = [
    "STORAGE_PERSISTENCE_FAILURE",
    "NANO_COMPLETION_REJECTED",
    "NANO_OUTPUT_EMPTY"
  ].find((code) => message.startsWith(code));
  if (known) return message.split(":")[0];
  if (/ASSESSING/.test(message)) return "RUN_NOT_ASSESSING";
  if (/request_id/i.test(message)) return "STALE_REQUEST_ID";
  if (/fliken kunde inte läsas|Content bridge/i.test(message)) return "TARGET_PAGE_READ_FAILED";
  if (/kunde inte kalibreras/i.test(message)) return "DECISION_CALIBRATION_FAILED";
  return "DETERMINISTIC_DISPATCH_EXCEPTION";
}

/**
 * Own the failure instead of dropping it. Every deterministic dispatch failure
 * now produces: a persisted `run.deterministicDispatchFailure` record, an audit
 * entry, and an application-log entry — the three surfaces that were all empty
 * for this failure class in v0.10.10.
 *
 * Within the re-arm budget the same request is re-armed so the next tick
 * rebuilds the decision and re-reads the page. Beyond it, the request is driven
 * to the established RECOVER verdict so the existing bounded-reconciliation
 * path — unchanged since v0.6.3 — owns the terminal handling.
 */
async function recordDeterministicDispatchFailureUnlocked(windowId, {
  requestId = "",
  source = NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL,
  analysisMode = "",
  error = null
} = {}) {
  const now = Date.now();
  const errorCode = deterministicDispatchErrorCode(error);
  const errorDetail = sanitizeText(error instanceof Error ? error.message : String(error || ""), 1600);
  const stackDigest = sanitizeText(
    error instanceof Error ? String(error.stack || "").split("\n").slice(0, 4).join(" | ") : "",
    900
  );
  console.warn(
    `EIC Autonom Agent: deterministic dispatch misslyckades (${errorCode}) för fönster ${windowId}.`,
    error
  );

  const { continuity, runtime, audit, applicationLog } = await loadBundle(windowId);
  const context = getWindowContext(runtime, windowId);
  const run = context.run;
  if (!run) return snapshotForWindow(windowId);

  const request = run.pendingNanoRequest;
  const rearms = Math.max(0, Number(run.deterministicDispatchRearms || 0));
  const sameRequest = Boolean(request && request.requestId === requestId);
  const rearmAllowed = sameRequest &&
    Boolean(run.pendingObservation) &&
    run.state === STATES.ASSESSING &&
    rearms < DETERMINISTIC_CALLBACK_MAX_REARMS;

  run.deterministicDispatchFailure = {
    schema: "eic.autonom.deterministic-dispatch-failure.v1",
    at: nowIso(now),
    requestId: sanitizeText(requestId, 160),
    source: sanitizeText(source, 60),
    analysisMode: sanitizeText(analysisMode, 60),
    errorCode,
    errorDetail,
    stackDigest,
    rearms: rearmAllowed ? rearms + 1 : rearms,
    disposition: rearmAllowed ? "REARMED" : "RECONCILE_REQUIRED"
  };
  run.nanoTelemetry ||= {};
  run.nanoTelemetry.lastError = `${errorCode}: ${errorDetail}`;
  run.nanoTelemetry.lastResultSummary = `DETERMINISTIC_DISPATCH_${rearmAllowed ? "REARMED" : "FAILED"}`;

  if (sameRequest && rearmAllowed) {
    run.deterministicDispatchRearms = rearms + 1;
    run.pendingNanoRequest = rearmDeterministicDispatch(request);
    run.nanoTelemetry.lastStatus = "DETERMINISTIC_PENDING";
  } else if (sameRequest) {
    run.pendingNanoRequest = exhaustDeterministicDispatch(request);
    run.nanoTelemetry.lastStatus = "DETERMINISTIC_DISPATCH_FAILED";
  }

  context.run = run;
  addAudit(audit, {
    kind: rearmAllowed ? "warning" : "error",
    title: rearmAllowed
      ? "Deterministisk dispatch återarmerad efter fel"
      : "Deterministisk dispatch misslyckades — bounded reconciliation krävs",
    detail: `${source} · ${errorCode} · request ${requestId} · ` +
      `återarmering ${rearmAllowed ? rearms + 1 : rearms}/${DETERMINISTIC_CALLBACK_MAX_REARMS} · ${errorDetail}`,
    windowId,
    tabId: run.targetTabId,
    runId: run.runId
  });
  const nextApplicationLog = appendApplicationEvent(applicationLog, {
    level: rearmAllowed ? "warning" : "error",
    event: "mission.deterministic.dispatch-failed",
    message: "Deterministisk baseline-/protokolldispatch kunde inte tillämpas.",
    windowId,
    tabId: run.targetTabId,
    runId: run.runId,
    missionId: run.missionId || context.activeMissionId || null,
    data: {
      requestId: sanitizeText(requestId, 160),
      source: sanitizeText(source, 60),
      analysisMode: sanitizeText(analysisMode, 60),
      errorCode,
      errorDetail,
      stackDigest,
      rearms: rearmAllowed ? rearms + 1 : rearms,
      disposition: rearmAllowed ? "REARMED" : "RECONCILE_REQUIRED"
    }
  });
  await writeRuntimeBundle(runtime, continuity, audit);
  if (nextApplicationLog !== applicationLog) {
    await chrome.storage.local.set({ [STORAGE_KEYS.APPLICATION_LOG]: nextApplicationLog });
  }
  await notifyPanels(windowId);
  // A bounded, explicit re-tick: the re-armed generation must not wait a whole
  // 30 s watchdog period, and the reconcile verdict must not either.
  setTimeout(() => tickWindow(windowId, "deterministic-dispatch-failure").catch(console.warn), 1_000);
  return snapshotForWindow(windowId);
}


function armDeterministicRecovery(runValue, {
  source = NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY,
  analysisMode = NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS,
  reason = "Recoverable lokal analysavvikelse.",
  now = Date.now()
} = {}) {
  let run = runValue;
  if (!run?.pendingObservation) return { ok: false, run };
  const request = buildPendingNanoRequest({
    observationId: run.pendingObservation.observationId,
    analysisMode,
    now
  });
  run.pendingNanoRequest = markDeterministicPending(request, source);
  run.pendingNanoRequest.recoveryReason = sanitizeText(reason, 1600);
  run.resumePlan = null;
  run.nanoTelemetry ||= {};
  run.nanoTelemetry.lastRequestId = run.pendingNanoRequest.requestId;
  run.nanoTelemetry.lastMode = analysisMode;
  run.nanoTelemetry.lastStatus = "DETERMINISTIC_PENDING";
  run.nanoTelemetry.lastSource = source;
  run.nanoTelemetry.lastError = sanitizeText(reason, 1600);
  run = transitionRun(run, STATES.ASSESSING, {
    origin: PAUSE_ORIGINS.NONE,
    reason: sanitizeText(reason, 1600),
    force: true
  });
  return { ok: true, run };
}

let operationQueue = Promise.resolve();
let initialized = false;
let storageCircuitOpen = false;
const responseProbeTimers = new Map();

function clearResponseStabilityProbe(windowId) {
  const existing = responseProbeTimers.get(windowId);
  if (existing) clearTimeout(existing);
  responseProbeTimers.delete(windowId);
}

function scheduleResponseStabilityProbe(windowId, delayMs) {
  clearResponseStabilityProbe(windowId);
  const boundedDelay = Math.max(100, Math.min(10_000, Number(delayMs) || 100));
  const timer = setTimeout(() => {
    responseProbeTimers.delete(windowId);
    tickWindow(windowId, "response-stability-probe").catch(console.warn);
  }, boundedDelay);
  responseProbeTimers.set(windowId, timer);
}

function enqueue(operation) {
  const next = operationQueue.then(operation, operation);
  operationQueue = next.catch(() => undefined);
  return next;
}

async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("EIC Autonom Agent: sidePanel-konfiguration misslyckades.", error);
  }
}

async function ensureWatchdog() {
  const existing = await chrome.alarms.get(WATCHDOG_ALARM);
  const period = Number(existing?.periodInMinutes);
  if (!existing || !Number.isFinite(period) || Math.abs(period - WATCHDOG_MINUTES) > 0.0001) {
    await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_MINUTES });
  }
}

async function setTrustedStorage() {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch (error) {
    console.warn("EIC Autonom Agent: kunde inte begränsa storage access level.", error);
  }
}

function loadCurrentState(configValue, runtimeValue) {
  const configResult = currentStateOrFresh(configValue, {
    schema: CONFIG_SCHEMA,
    version: CONFIG_VERSION,
    factory: createDefaultConfig,
    label: "CONFIG"
  });
  const runtimeResult = currentStateOrFresh(runtimeValue, {
    schema: RUNTIME_SCHEMA,
    version: RUNTIME_VERSION,
    factory: createDefaultRuntime,
    label: "RUNTIME"
  });
  return {
    config: configResult.value,
    runtime: runtimeResult.value,
    changed: configResult.reset || runtimeResult.reset,
    resetReasons: [configResult.reason, runtimeResult.reason]
  };
}

async function readStores() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.CONFIG,
    STORAGE_KEYS.CONTINUITY,
    STORAGE_KEYS.CONTINUITY_BACKUP,
    STORAGE_KEYS.RUNTIME,
    STORAGE_KEYS.AUDIT,
    STORAGE_KEYS.APPLICATION_LOG,
    STORAGE_KEYS.FULL_AUDIT_QUEUE
  ]);
  return {
    config: data[STORAGE_KEYS.CONFIG] || null,
    continuity: data[STORAGE_KEYS.CONTINUITY] || null,
    continuityBackup: data[STORAGE_KEYS.CONTINUITY_BACKUP] || null,
    runtime: data[STORAGE_KEYS.RUNTIME] || null,
    audit: data[STORAGE_KEYS.AUDIT] || null,
    applicationLog: data[STORAGE_KEYS.APPLICATION_LOG] || null,
    fullAuditQueue: data[STORAGE_KEYS.FULL_AUDIT_QUEUE] || null
  };
}


function ensureApplicationLogValue(logValue, {
  now = Date.now(),
  forceNew = false
} = {}) {
  return ensureApplicationLogSession(logValue, {
    appVersion: APP_VERSION,
    sessionId: randomId("app-session"),
    segmentId: randomId("app-log-segment"),
    now,
    forceNew
  });
}

function appendApplicationEvent(logValue, {
  level = "info",
  event,
  message = "",
  windowId = null,
  tabId = null,
  runId = null,
  missionId = null,
  hostId = null,
  correlationId = null,
  data = {}
} = {}, {
  now = Date.now()
} = {}) {
  const ensured = ensureApplicationLogValue(logValue, { now });
  const appended = appendApplicationLog(ensured.log, {
    level,
    event,
    message,
    windowId,
    tabId,
    runId,
    missionId,
    hostId,
    correlationId,
    data
  }, {
    entryId: randomId("app-log-entry"),
    nextSegmentId: randomId("app-log-segment"),
    now
  });
  if (fullAuditLoggingEnabledCache) {
    fullAuditPendingEntries.push({
      level,
      event: `application.${sanitizeText(event, 160)}`,
      message,
      windowId,
      tabId,
      runId,
      missionId,
      correlationId: correlationId || hostId || null,
      data
    });
  }
  return appended.log;
}

async function persistFullAuditQueueFailSoft(entries = []) {
  if (!fullAuditLoggingEnabledCache) {
    fullAuditPendingEntries.splice(0, fullAuditPendingEntries.length);
    return { persisted: false, reason: "DISABLED" };
  }
  try {
    if (Array.isArray(entries) && entries.length) {
      fullAuditPendingEntries.push(...entries);
    }
    if (fullAuditPendingEntries.length) {
      const pending = fullAuditPendingEntries.splice(0, fullAuditPendingEntries.length);
      fullAuditQueueCache = appendFullAuditEntries(fullAuditQueueCache, pending);
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.FULL_AUDIT_QUEUE]: fullAuditQueueCache
    });
    fullAuditQueueLastError = "";
    return {
      persisted: true,
      entries: fullAuditQueueCache.entries.length,
      droppedEntries: fullAuditQueueCache.droppedEntries
    };
  } catch (error) {
    fullAuditQueueLastError = sanitizeText(error?.message || error, 1000);
    console.warn("FULL_AUDIT_QUEUE_PERSIST_FAILED", fullAuditQueueLastError);
    return {
      persisted: false,
      reason: "FULL_AUDIT_QUEUE_PERSIST_FAILED",
      error: fullAuditQueueLastError
    };
  }
}

async function ensureInitialized() {
  if (initialized) return;
  const stores = await readStores();
  const writes = {};
  const audit = stores.audit?.schema === "eic.autonom.audit.v11"
    ? stores.audit
    : createDefaultAudit();
  const current = loadCurrentState(stores.config, stores.runtime);
  let config = current.config;
  let migratedRuntime = current.runtime;
  fullAuditLoggingEnabledCache = config.fullAuditLoggingEnabled === true;
  fullAuditQueueCache = normalizeFullAuditQueue(stores.fullAuditQueue);
  const logSession = ensureApplicationLogValue(stores.applicationLog, {
    now: Date.now()
  });
  let applicationLog = appendApplicationEvent(logSession.log, {
    level: "info",
    event: "background.initialized",
    message: "Extensionens bakgrundsägare initierades.",
    data: {
      appVersion: APP_VERSION,
      sessionStarted: logSession.sessionStarted
    }
  });
  if (!config.nanoMandateCanary) {
    config = { ...config, nanoMandateCanary: randomId("nano-private"), updatedAt: nowIso() };
  }
  if (!stores.config || current.changed || config !== stores.config) writes[STORAGE_KEYS.CONFIG] = config;
  if (!stores.runtime || current.changed) writes[STORAGE_KEYS.RUNTIME] = migratedRuntime;
  if (!stores.fullAuditQueue) writes[STORAGE_KEYS.FULL_AUDIT_QUEUE] = createFullAuditQueue();
  if (current.changed && (stores.config || stores.runtime)) {
    addAudit(audit, {
      kind: "warning",
      title: "Äldre state avvisades av forward-only-policy",
      detail: `${current.resetReasons.join(", ")} · ingen migration eller legacy-adoption utfördes.`
    });
  }

  let continuity = stores.continuity?.schema === "eic.nano.continuity.v4"
    ? stores.continuity
    : createContinuity();
  const currentCheck = await verifyContinuity(continuity);
  if (currentCheck.valid) {
    continuity = currentCheck.continuity;
    if (!stores.continuityBackup) {
      writes[STORAGE_KEYS.CONTINUITY_BACKUP] = continuity;
    }
  } else if (currentCheck.reason === "UNSEALED") {
    continuity = await sealContinuity(currentCheck.continuity);
    writes[STORAGE_KEYS.CONTINUITY] = continuity;
    writes[STORAGE_KEYS.CONTINUITY_BACKUP] = continuity;
  } else {
    const backupCheck = await verifyContinuity(stores.continuityBackup);
    if (!backupCheck.valid) {
      throw new Error(
        `CONTINUITY_CORRUPT: current=${currentCheck.reason}; backup=${backupCheck.reason}. ` +
        "Ingen prompt skickas innan continuity återställts via en verifierad export eller reset."
      );
    }
    continuity = backupCheck.continuity;
    writes[STORAGE_KEYS.CONTINUITY] = continuity;
    addAudit(audit, {
      kind: "warning",
      title: "Continuity återställd från verifierad backup",
      detail: `Aktuell continuity hade ${currentCheck.reason}. Ingen målprompt skickades under återställningen.`
    });
  }


  if (!stores.runtime && !writes[STORAGE_KEYS.RUNTIME]) writes[STORAGE_KEYS.RUNTIME] = migratedRuntime;
  if (!stores.audit || audit !== stores.audit || writes[STORAGE_KEYS.CONTINUITY]) {
    writes[STORAGE_KEYS.AUDIT] = audit;
  }
  writes[STORAGE_KEYS.APPLICATION_LOG] = applicationLog;
  if (Object.keys(writes).length) await chrome.storage.local.set(writes);

  await setTrustedStorage();
  await configureSidePanel();
  await ensureWatchdog();
  initialized = true;
}

function defaultWindowContext(windowId) {
  return {
    schema: "eic.autonom.window-context.v7",
    windowId,
    alias: `Fönster ${windowId}`,
    targetMode: TARGET_MODES.LOCKED,
    selectedTabId: null,
    linkedTabs: {},
    surfacePair: createEmptySurfacePair(windowId),
    browserSession: null,
    run: null,
    activeMissionId: null,
    missionIds: [],
    continuity: null,
    continuityBackup: null,
    continuityMigration: null,
    startPromptReceipts: [],
    browserActionLedger: [],
    browserApproval: null,
    browserLoop: createBrowserLoopState(windowId),
    browserRecovery: createBrowserRecoveryState(windowId),
    importRollback: null,
    sessionCaptureSummary: null,
    sessionMemorySummary: null,
    autoCaptureFingerprint: "",
    coreSurfaceReview: null,
    nanoHostTelemetry: {
      schema: "eic.autonom.nano-host-telemetry.v4",
      hostId: "",
      modelKind: "",
      status: "unknown",
      availability: "unknown",
      progress: null,
      busy: false,
      stale: false,
      staleReason: "",
      staleDetail: "",
      createStartedAt: null,
      createDeadlineAt: null,
      userActivationActiveAtStart: false,
      preflightAt: null,
      preflightError: "",
      canaryStartedAt: null,
      canaryCompletedAt: null,
      canaryOutputChars: 0,
      canaryVerified: false,
      outputLanguages: [],
      outputLanguageAttested: false,
      lastProgressAt: null,
      lastProgressEventAt: null,
      lastProgressValue: null,
      progressStallDeadlineAt: null,
      progressStallTimeoutMs: null,
      contextUsage: null,
      contextWindow: null,
      updatedAt: null
    },
    lastActiveTabId: null,
    updatedAt: nowIso()
  };
}

function getWindowContext(runtime, windowId) {
  const key = String(windowId);
  if (!runtime.windows[key]) runtime.windows[key] = defaultWindowContext(windowId);
  const context = runtime.windows[key];
  context.schema = "eic.autonom.window-context.v7";
  context.windowId = Number(windowId);
  context.linkedTabs ||= {};
  context.sessionCaptureSummary ||= null;
  context.sessionMemorySummary ||= null;
  context.autoCaptureFingerprint ||= "";
  context.coreSurfaceReview ||= null;
  context.surfacePair = normalizeSurfacePair(context.surfacePair, {
    windowId: context.windowId,
    linkedTabs: context.linkedTabs,
    selectedTabId: context.selectedTabId
  });
  const profile = runtimeBuildProfile();
  const target = webTargetSurface(context);
  if (target) {
    if (profile === BUILD_PROFILES.STANDARD) {
      applyWebTargetCapabilityState(context, {
        permissionState: WEB_PERMISSION_STATES.UNAVAILABLE_STANDARD_PROFILE,
        permissionOriginPattern: "",
        debuggerState: CDP_SESSION_STATES.UNAVAILABLE_STANDARD_PROFILE,
        debuggerSessionId: "",
        reason: "STANDARD_BUILD_PROFILE"
      });
    } else if (target.permissionState === "NOT_REQUESTED" || target.permissionState === "NOT_APPLICABLE") {
      applyWebTargetCapabilityState(context, {
        permissionState: WEB_PERMISSION_STATES.NOT_REQUESTED,
        debuggerState: target.debuggerState === "NOT_AVAILABLE_WP05"
          ? CDP_SESSION_STATES.DETACHED
          : target.debuggerState,
        reason: "BROWSER_BUILD_PROFILE"
      });
    }
  }
  context.browserSession = normalizeCdpSession(context.browserSession, {
    profile,
    surface: webTargetSurface(context)
  });
  const liveSession = liveCdpSessions.get(cdpLiveKey(context.windowId));
  if (
    context.browserSession.state === CDP_SESSION_STATES.ATTACHED &&
    (!liveSession || !cdpSessionMatchesSurface(liveSession, webTargetSurface(context)))
  ) {
    context.browserSession = markCdpSessionStale(context.browserSession, {
      reason: "SERVICE_WORKER_OR_TARGET_IDENTITY_CHANGED"
    });
    applyWebTargetCapabilityState(context, {
      debuggerState: CDP_SESSION_STATES.STALE,
      debuggerSessionId: context.browserSession.sessionId,
      reason: "CDP_SESSION_STALE"
    });
    context.browserRecovery = markBrowserRecoveryRequired(context.browserRecovery, {
      reason: "SERVICE_WORKER_OR_TARGET_IDENTITY_CHANGED",
      surface: webTargetSurface(context),
      missionId: context.activeMissionId || "",
      browserLoop: context.browserLoop
    });
  }
  context.activeMissionId = context.activeMissionId ? String(context.activeMissionId) : null;
  context.missionIds = Array.isArray(context.missionIds) ? [...new Set(context.missionIds.map(String))].slice(-128) : [];
  context.startPromptReceipts ||= [];
  context.browserActionLedger = Array.isArray(context.browserActionLedger)
    ? context.browserActionLedger
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        actionId: String(entry.actionId || ""),
        turnId: String(entry.turnId || ""),
        operation: String(entry.operation || ""),
        riskLevel: String(entry.riskLevel || ""),
        approvalId: String(entry.approvalId || ""),
        status: String(entry.status || "UNKNOWN"),
        receiptDigest: String(entry.receiptDigest || ""),
        startedAt: String(entry.startedAt || ""),
        completedAt: entry.completedAt ? String(entry.completedAt) : null,
        error: sanitizeText(entry.error, 800)
      }))
      .filter((entry) => entry.actionId && entry.turnId)
      .slice(-100)
    : [];
  context.browserApproval = normalizeBrowserApproval(context.browserApproval);
  context.browserLoop = normalizeBrowserLoopState(context.browserLoop, {
    windowId: context.windowId
  });
  context.browserRecovery = normalizeBrowserRecoveryState(context.browserRecovery, {
    windowId: context.windowId
  });
  context.importRollback = normalizeImportRollback(context.importRollback);
  context.nanoHostTelemetry ||= {
    schema: "eic.autonom.nano-host-telemetry.v4",
    hostId: "",
    modelKind: "",
    status: "unknown",
    availability: "unknown",
    progress: null,
    busy: false,
    staleReason: "",
    userActivationActiveAtStart: false,
    preflightAt: null,
    preflightError: "",
    canaryStartedAt: null,
    canaryCompletedAt: null,
    canaryOutputChars: 0,
    canaryVerified: false,
    contextUsage: null,
    contextWindow: null,
    progressStallDeadlineAt: null,
    progressStallTimeoutMs: null,
    updatedAt: null
  };
  return context;
}

function addAudit(audit, {
  kind = "info",
  title,
  detail = "",
  windowId = null,
  tabId = null,
  runId = null,
  now = Date.now()
}) {
  const normalizedTitle = sanitizeText(title, 220);
  const normalizedDetail = sanitizeText(detail, 1800);
  const items = Array.isArray(audit.items) ? audit.items : [];
  const duplicateIndex = items.slice(0, 12).findIndex((existing) => {
    if (!existing) return false;
    const age = now - Date.parse(existing.at || "");
    return Number.isFinite(age) && age >= 0 && age <= 5_000 &&
      existing.kind === kind &&
      existing.title === normalizedTitle &&
      existing.detail === normalizedDetail &&
      existing.windowId === windowId &&
      existing.tabId === tabId &&
      existing.runId === runId;
  });
  if (duplicateIndex >= 0) {
    const existing = {
      ...items[duplicateIndex],
      at: nowIso(now),
      repeatCount: Math.max(1, Number(items[duplicateIndex].repeatCount || 1)) + 1
    };
    audit.items = [existing, ...items.filter((_, index) => index !== duplicateIndex)].slice(0, AUDIT_LIMIT);
    if (fullAuditLoggingEnabledCache) {
      fullAuditPendingEntries.push({
        level: kind,
        event: "audit.repeat",
        message: normalizedTitle,
        windowId,
        tabId,
        runId,
        correlationId: existing.id,
        data: { detail: normalizedDetail, repeatCount: existing.repeatCount }
      });
    }
    return existing;
  }
  const item = {
    id: randomId("event"),
    at: nowIso(now),
    kind,
    title: normalizedTitle,
    detail: normalizedDetail,
    windowId,
    tabId,
    runId,
    repeatCount: 1
  };
  audit.items = [item, ...items].slice(0, AUDIT_LIMIT);
  if (fullAuditLoggingEnabledCache) {
    fullAuditPendingEntries.push({
      level: kind,
      event: "audit.event",
      message: normalizedTitle,
      windowId,
      tabId,
      runId,
      correlationId: item.id,
      data: { detail: normalizedDetail, repeatCount: 1 }
    });
  }
  return item;
}

async function writeRuntimeBundle(runtime, continuity, audit, explicitWindowId = null) {
  const scopedWindowId = Number.isInteger(Number(explicitWindowId))
    ? Number(explicitWindowId)
    : continuityScopeWindowId(continuity);
  let sealed;
  let expectedBackupDigest = "";
  const writes = {};

  if (Number.isInteger(scopedWindowId)) {
    const context = getWindowContext(runtime, scopedWindowId);
    const previous = deepClone(context.continuity);
    const previousCheck = await verifyContinuity(previous);
    const projected = projectRunIntoContinuity(continuity, context.run, {
      targetProjectId: context.run?.targetProjectId || context.run?.activeTaskProjectId
    });
    const bound = bindContinuityScope(projected, {
      windowId: scopedWindowId,
      runId: context.run?.runId,
      conversationKey: context.run?.conversationKey || projected?.position?.conversationKey
    });
    if (previousCheck.valid && continuitySemanticallyEqual(previousCheck.continuity, bound)) {
      sealed = previousCheck.continuity;
    } else {
      sealed = await sealContinuity(bound);
    }
    context.continuity = sealed;
    if (previousCheck.valid && previousCheck.expected !== sealed.integrity?.digest) {
      context.continuityBackup = deepClone(previousCheck.continuity);
    } else if (!context.continuityBackup) {
      context.continuityBackup = deepClone(sealed);
    }
    const backupCheck = await verifyContinuity(context.continuityBackup);
    expectedBackupDigest = backupCheck.valid ? backupCheck.expected : "";
    context.continuityWriteReceipt = {
      schema: "eic.autonom.continuity-write-receipt.v1",
      path: "writeRuntimeBundle.window",
      primaryDigest: sanitizeText(sealed.integrity?.digest, 80),
      backupDigest: expectedBackupDigest,
      previousValid: previousCheck.valid,
      semanticChange: !(previousCheck.valid && continuitySemanticallyEqual(previousCheck.continuity, bound)),
      at: nowIso()
    };
    context.updatedAt = nowIso();
  } else {
    const previousData = await chrome.storage.local.get([
      STORAGE_KEYS.CONTINUITY,
      STORAGE_KEYS.CONTINUITY_BACKUP
    ]);
    const previous = previousData[STORAGE_KEYS.CONTINUITY];
    const previousCheck = await verifyContinuity(previous);
    if (previousCheck.valid && continuitySemanticallyEqual(previousCheck.continuity, continuity)) {
      sealed = previousCheck.continuity;
    } else {
      sealed = await sealContinuity(continuity);
    }
    writes[STORAGE_KEYS.CONTINUITY] = sealed;
    if (previousCheck.valid && previousCheck.expected !== sealed.integrity?.digest) {
      writes[STORAGE_KEYS.CONTINUITY_BACKUP] = deepClone(previousCheck.continuity);
      expectedBackupDigest = previousCheck.expected;
    } else if (!previousData[STORAGE_KEYS.CONTINUITY_BACKUP]) {
      writes[STORAGE_KEYS.CONTINUITY_BACKUP] = deepClone(sealed);
      expectedBackupDigest = sealed.integrity?.digest || "";
    } else {
      const backupCheck = await verifyContinuity(previousData[STORAGE_KEYS.CONTINUITY_BACKUP]);
      expectedBackupDigest = backupCheck.valid ? backupCheck.expected : "";
    }
  }

  reconcileRuntimeMissions(runtime);
  runtime.revision = Number(runtime.revision || 0) + 1;
  runtime.updatedAt = nowIso();
  writes[STORAGE_KEYS.RUNTIME] = runtime;
  writes[STORAGE_KEYS.AUDIT] = audit;

  if (!fullAuditLoggingEnabledCache) {
    fullAuditPendingEntries.splice(0, fullAuditPendingEntries.length);
  }

  try {
    await chrome.storage.local.set(writes);
    const readback = await chrome.storage.local.get([
      STORAGE_KEYS.RUNTIME,
      STORAGE_KEYS.CONTINUITY,
      STORAGE_KEYS.CONTINUITY_BACKUP
    ]);
    if (Number.isInteger(scopedWindowId)) {
      const persisted = readback[STORAGE_KEYS.RUNTIME]?.windows?.[String(scopedWindowId)];
      const primaryCheck = await verifyContinuity(persisted?.continuity);
      const backupCheck = await verifyContinuity(persisted?.continuityBackup);
      if (!primaryCheck.valid || primaryCheck.expected !== sealed.integrity?.digest) {
        throw new Error("CONTINUITY_PRIMARY_READBACK_MISMATCH");
      }
      if (expectedBackupDigest && (!backupCheck.valid || backupCheck.expected !== expectedBackupDigest)) {
        throw new Error("CONTINUITY_BACKUP_READBACK_MISMATCH");
      }
    } else {
      const primaryCheck = await verifyContinuity(readback[STORAGE_KEYS.CONTINUITY]);
      const backupCheck = await verifyContinuity(readback[STORAGE_KEYS.CONTINUITY_BACKUP]);
      if (!primaryCheck.valid || primaryCheck.expected !== sealed.integrity?.digest) {
        throw new Error("CONTINUITY_PRIMARY_READBACK_MISMATCH");
      }
      if (expectedBackupDigest && (!backupCheck.valid || backupCheck.expected !== expectedBackupDigest)) {
        throw new Error("CONTINUITY_BACKUP_READBACK_MISMATCH");
      }
    }
    storageCircuitOpen = false;
    await persistFullAuditQueueFailSoft([{
      level: "info",
      event: "runtime.write.readback",
      message: "Runtime- och continuity-write verifierades genom storage readback.",
      windowId: Number.isInteger(scopedWindowId) ? scopedWindowId : null,
      runId: Number.isInteger(scopedWindowId)
        ? runtime.windows?.[String(scopedWindowId)]?.run?.runId || null
        : null,
      correlationId: sealed.integrity?.digest || null,
      data: {
        runtimeRevision: runtime.revision,
        primaryDigest: sealed.integrity?.digest || "",
        backupDigest: expectedBackupDigest,
        scoped: Number.isInteger(scopedWindowId),
        fullAuditFailSoft: true
      }
    }]);
  } catch (error) {
    storageCircuitOpen = true;
    const detail = error instanceof Error ? error.message : String(error);
    const emergencyRuntime = deepClone(runtime);
    for (const context of Object.values(emergencyRuntime.windows || {})) {
      if (!context?.run) continue;
      context.run.recovery ||= { attempts: [] };
      context.run.recovery.attempts = (context.run.recovery.attempts || []).slice(-10);
      context.run.effectJournal = compactEffectJournal(context.run.effectJournal || [], "", 4);
      context.run = transitionRun(context.run, STATES.PROGRAM_BLOCKED, {
        origin: PAUSE_ORIGINS.STORAGE_PERSISTENCE_FAILURE,
        reason: `Storage-write misslyckades: ${sanitizeText(detail, 800)}. Ingen prompt får skickas.`,
        force: true
      });
    }
    const emergencyAudit = {
      ...audit,
      items: (audit.items || []).slice(0, 20)
    };
    const emergencyWrites = {
      [STORAGE_KEYS.RUNTIME]: emergencyRuntime,
      [STORAGE_KEYS.AUDIT]: emergencyAudit
    };
    if (!Number.isInteger(scopedWindowId)) {
      emergencyWrites[STORAGE_KEYS.CONTINUITY] = sealed;
    }
    try {
      await chrome.storage.local.set(emergencyWrites);
    } catch {
      // Volatile circuit remains open. Every effect path still fails closed.
    }
    await persistFullAuditQueueFailSoft([{
      level: "error",
      event: "runtime.write.failed",
      message: "Runtime-write eller continuity-readback misslyckades.",
      windowId: Number.isInteger(scopedWindowId) ? scopedWindowId : null,
      correlationId: sealed?.integrity?.digest || null,
      data: {
        error: detail,
        runtimeRevision: runtime.revision,
        fullAuditFailSoft: true
      }
    }]);
    throw new Error(`STORAGE_PERSISTENCE_FAILURE: ${detail}`);
  }
  return sealed;
}

async function loadBundle(windowId = null) {
  await ensureInitialized();
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.CONFIG,
    STORAGE_KEYS.CONTINUITY,
    STORAGE_KEYS.CONTINUITY_BACKUP,
    STORAGE_KEYS.RUNTIME,
    STORAGE_KEYS.AUDIT,
    STORAGE_KEYS.APPLICATION_LOG,
    STORAGE_KEYS.FULL_AUDIT_QUEUE
  ]);
  const audit = data[STORAGE_KEYS.AUDIT] || createDefaultAudit();
  const applicationLog = data[STORAGE_KEYS.APPLICATION_LOG] ||
    ensureApplicationLogValue(null, { now: Date.now() }).log;
  const currentCheck = await verifyContinuity(data[STORAGE_KEYS.CONTINUITY]);
  let rootContinuity;

  if (currentCheck.valid) {
    rootContinuity = currentCheck.continuity;
  } else if (currentCheck.reason === "UNSEALED") {
    rootContinuity = await sealContinuity(currentCheck.continuity);
    await chrome.storage.local.set({
      [STORAGE_KEYS.CONTINUITY]: rootContinuity,
      [STORAGE_KEYS.CONTINUITY_BACKUP]: rootContinuity
    });
  } else {
    const backupCheck = await verifyContinuity(data[STORAGE_KEYS.CONTINUITY_BACKUP]);
    if (!backupCheck.valid) {
      throw new Error(
        `CONTINUITY_CORRUPT: current=${currentCheck.reason}; backup=${backupCheck.reason}. ` +
        "Ingen prompt skickas innan continuity återställts via en verifierad export eller reset."
      );
    }
    rootContinuity = backupCheck.continuity;
    addAudit(audit, {
      kind: "warning",
      title: "Legacy continuity återställd från verifierad backup",
      detail: `Aktuell legacy-continuity hade ${currentCheck.reason}. Ingen målprompt skickades under återställningen.`
    });
    await chrome.storage.local.set({
      [STORAGE_KEYS.CONTINUITY]: rootContinuity,
      [STORAGE_KEYS.AUDIT]: audit
    });
  }

  const currentState = loadCurrentState(
    data[STORAGE_KEYS.CONFIG] || createDefaultConfig(),
    data[STORAGE_KEYS.RUNTIME] || createDefaultRuntime()
  );
  fullAuditLoggingEnabledCache = currentState.config.fullAuditLoggingEnabled === true;
  fullAuditQueueCache = normalizeFullAuditQueue(data[STORAGE_KEYS.FULL_AUDIT_QUEUE]);
  let runtimeChanged = currentState.changed;
  let selectedContinuity = rootContinuity;

  if (Number.isInteger(Number(windowId))) {
    const numericWindowId = Number(windowId);
    const context = getWindowContext(currentState.runtime, numericWindowId);
    const hadContinuity = Boolean(context.continuity);
    const initializedScope = initializeWindowContinuity(
      context,
      rootContinuity,
      currentState.runtime,
      { windowId: numericWindowId }
    );
    let scopedCheck = await verifyContinuity(initializedScope.continuity);
    if (!scopedCheck.valid && scopedCheck.reason === "UNSEALED") {
      selectedContinuity = await sealContinuity(initializedScope.continuity);
      runtimeChanged = true;
    } else if (scopedCheck.valid) {
      selectedContinuity = scopedCheck.continuity;
    } else {
      const backupCheck = await verifyContinuity(context.continuityBackup || initializedScope.backup);
      if (!backupCheck.valid) {
        if (hadContinuity) {
          throw new Error(
            `WINDOW_CONTINUITY_CORRUPT: window=${numericWindowId}; current=${scopedCheck.reason}; backup=${backupCheck.reason}.`
          );
        }
        selectedContinuity = await sealContinuity(bindContinuityScope(createContinuity(), {
          windowId: numericWindowId,
          runId: context.run?.runId,
          conversationKey: context.run?.conversationKey
        }));
      } else {
        selectedContinuity = backupCheck.continuity;
        addAudit(audit, {
          kind: "warning",
          title: "Fönsterscoped continuity återställd från backup",
          detail: `Fönster ${numericWindowId}; current=${scopedCheck.reason}.`,
          windowId: numericWindowId,
          runId: context.run?.runId || null
        });
      }
      runtimeChanged = true;
    }

    const projectedContinuity = projectRunIntoContinuity(selectedContinuity, context.run, {
      targetProjectId: context.run?.targetProjectId || context.run?.activeTaskProjectId
    });
    const boundContinuity = bindContinuityScope(projectedContinuity, {
      windowId: numericWindowId,
      runId: context.run?.runId,
      conversationKey: context.run?.conversationKey || projectedContinuity.position?.conversationKey
    });
    const priorScoped = scopedCheck.valid ? scopedCheck.continuity : null;
    if (priorScoped && continuitySemanticallyEqual(priorScoped, boundContinuity)) {
      selectedContinuity = priorScoped;
    } else {
      selectedContinuity = await sealContinuity(boundContinuity);
      if (priorScoped && priorScoped.integrity?.digest !== selectedContinuity.integrity?.digest) {
        context.continuityBackup = deepClone(priorScoped);
      }
      runtimeChanged = true;
    }
    // Keep the mutable work copy detached from the sealed runtime snapshot. Without
    // this clone, a decision path can mutate `selectedContinuity` before its write.
    context.continuity = deepClone(selectedContinuity);
    if (!context.continuityBackup) {
      context.continuityBackup = initializedScope.backup
        ? await sealContinuity(bindContinuityScope(initializedScope.backup, {
            windowId: numericWindowId,
            runId: context.run?.runId,
            conversationKey: context.run?.conversationKey
          }))
        : deepClone(selectedContinuity);
      runtimeChanged = true;
    }
    context.continuityMigration ||= {
      adoptedRoot: initializedScope.adoptedRoot,
      reason: initializedScope.reason,
      at: nowIso()
    };
    runtimeChanged ||= initializedScope.changed;
  }

  if (runtimeChanged) {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.CONFIG]: currentState.config,
        [STORAGE_KEYS.RUNTIME]: currentState.runtime,
        [STORAGE_KEYS.AUDIT]: audit
      });
      storageCircuitOpen = false;
    } catch (error) {
      storageCircuitOpen = true;
      throw new Error(`STORAGE_PERSISTENCE_FAILURE: ${String(error?.message || error)}`);
    }
  }

  return {
    config: currentState.config,
    continuity: selectedContinuity,
    rootContinuity,
    runtime: currentState.runtime,
    audit,
    applicationLog
  };
}

async function readRuntimeBundle(windowId) {
  const bundle = await loadBundle(windowId);
  return {
    ...bundle,
    context: getWindowContext(bundle.runtime, windowId)
  };
}

async function notifyPanels(windowId = null) {
  try {
    await chrome.runtime.sendMessage({
      type: "EIC_STATE_CHANGED",
      windowId,
      at: Date.now()
    });
  } catch {
    // Ingen panel är öppen. Durable state fortsätter att vara ägare.
  }
}

function linkedTabRecord(tab, page = null) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: sanitizeText(tab.title || page?.title || "ChatGPT", 240),
    url: sanitizeText(tab.url || page?.url || "", 2000),
    conversationKey: page?.conversationKey || conversationKeyFromUrl(tab.url || page?.url || ""),
    documentEpoch: page?.documentEpoch || "",
    linkedAt: nowIso(),
    lastSeenAt: nowIso(),
    status: "LINKED",
    generating: Boolean(page?.generating),
    responseState: page?.responseState || "UNKNOWN_RECONCILE",
    backgroundActive: Boolean(page?.backgroundSignals?.active),
    backgroundLanguage: page?.backgroundSignals?.language || "unknown",
    taskFingerprint: page?.taskFingerprint || "",
    discarded: Boolean(tab?.discarded),
    frozen: Boolean(tab?.frozen),
    active: Boolean(tab?.active),
    autoDiscardable: typeof tab?.autoDiscardable === "boolean" ? tab.autoDiscardable : null,
    assistantCount: Number(page?.assistantCount || 0),
    latestAssistantHash: page?.latestAssistantHash || "",
    latestAssistantCandidate: Boolean(page?.latestAssistantCandidate),
    latestMessageRole: page?.latestMessageRole || "unknown",
    latestMessageHash: page?.latestMessageHash || "",
    userTurnIds: mergeSeenUserTurnIds(page?.userTurnIds),
    userMessageHashes: mergeSeenUserMessageHashes(page?.userMessageHashes)
  };
}

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "EIC_PING" });
    return response?.ok ? response : null;
  } catch {
    return null;
  }
}

async function ensureContentScript(tabId) {
  let ping = await pingContentScript(tabId);
  if (ping?.version === CONTENT_SCRIPT_VERSION) return ping;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  ping = await pingContentScript(tabId);
  if (!ping?.ok || ping.version !== CONTENT_SCRIPT_VERSION) {
    const observedVersion = ping?.version || "saknas";
    throw new Error(
      `Content bridge kunde inte verifieras (förväntad ${CONTENT_SCRIPT_VERSION}, observerad ${observedVersion}). ` +
      "Ladda om målfliken om den var öppen när tillägget uppdaterades."
    );
  }
  return ping;
}

async function readPage(tabId, source = "background-read") {
  await ensureContentScript(tabId);
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "EIC_GET_PAGE_STATE",
    source
  });
  if (!response?.ok) {
    throw new Error(response?.error || "ChatGPT-fliken kunde inte läsas.");
  }
  return response;
}


function observationMatchesPage(observation, page) {
  if (!observation || !page) return false;
  if (!isAssistantResponseCandidate(page) || !page.latestAssistantHash) return false;
  return String(observation.responseHash || "") === String(page.latestAssistantHash || "") &&
    (!observation.documentEpoch || String(observation.documentEpoch) === String(page.documentEpoch || ""));
}

function supersedePendingObservation(runValue, page, audit, { windowId, reason = "Target response changed" } = {}) {
  let run = runValue;
  const oldObservation = run.pendingObservation;
  run.lastSupersededObservation = oldObservation ? {
    observationId: oldObservation.observationId,
    responseHash: oldObservation.responseHash,
    replacedByHash: page?.latestAssistantHash || "",
    at: nowIso(),
    reason: sanitizeText(reason, 600)
  } : null;
  run.pendingNanoRequest = null;
  run.pendingObservation = null;
  run.deterministicGroundingFailure = null;
  run.deterministicDispatchFailure = null;
  run.deterministicDispatchRearms = 0;
  run.responseCandidate = null;
  run.nanoTelemetry ||= {};
  run.nanoTelemetry.lastStatus = "SUPERSEDED";
  run.nanoTelemetry.lastError = "";
  run.nanoTelemetry.lastResultSummary = "OBSERVATION_SUPERSEDED";
  run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
    origin: PAUSE_ORIGINS.OBSERVATION_SUPERSEDED,
    reason: "Den analyserade observationen ersattes av ett nyare target-svar. Gammalt Nanoresultat kasserades utan målprompt.",
    force: true
  });
  addAudit(audit, {
    kind: "warning",
    title: "Stale observation supersederad",
    detail: `${oldObservation?.responseHash || "(ingen)"} → ${page?.latestAssistantHash || "(ingen)"} · ${reason}`,
    windowId,
    tabId: run.targetTabId,
    runId: run.runId
  });
  return run;
}

async function setTabIndicator(tabId, status, detail = "", overlay = null) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "EIC_SET_LINK_STATUS",
      status,
      detail,
      overlay
    });
  } catch {
    // Visuell indikator är best effort och aldrig tillståndsägare.
  }
}

async function snapshotForWindow(windowId) {
  const { config, continuity, runtime, audit, applicationLog } = await loadBundle(windowId);
  const context = getWindowContext(runtime, windowId);
  const windowView = deepClone(context);
  if (windowView.importRollback) {
    windowView.importRollback = {
      schema: windowView.importRollback.schema,
      version: windowView.importRollback.version,
      rollbackId: windowView.importRollback.rollbackId,
      digest: windowView.importRollback.digest,
      snapshotBytes: windowView.importRollback.snapshotBytes,
      consumed: windowView.importRollback.consumed,
      createdAt: windowView.importRollback.createdAt,
      consumedAt: windowView.importRollback.consumedAt,
      updatedAt: windowView.importRollback.updatedAt
    };
  }
  // v0.7.1: the panel must echo back the exact boundary identity it displayed, so it is
  // handed that identity rather than deriving one of its own.
  if (windowView.run) {
    windowView.run.boundaryKey = boundaryKey(context.run);
    windowView.run.boundaryRequiresOperator = Boolean(
      context.run &&
      [STATES.PROGRAM_BLOCKED, STATES.AWAITING_OPERATOR_DECISION].includes(context.run.state) &&
      pauseRequiresHuman(context.run)
    );
  }
  const evidence = await loadWindowEvidenceSummary(chrome, windowId);
  return createUiSnapshot({
    appVersion: APP_VERSION,
    windowId,
    snapshotId: randomId("ui-snapshot"),
    capturedAt: nowIso(),
    config,
    continuity,
    window: windowView,
    missions: missionViewForWindow(runtime, windowId),
    buildProfile: runtimeBuildSummary(),
    evidence,
    applicationLogSummary: applicationLogSummary(applicationLog, { windowId }),
    audit: (audit.items || [])
      .filter((item) => item.windowId === windowId || item.windowId === null)
      .slice(0, 100)
  });
}


async function claimNanoRequest(windowId, payload) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    let run = context.run;
    const request = run?.pendingNanoRequest;
    if (!run || run.state !== STATES.ASSESSING || !request) {
      throw new Error("Ingen Nano-request väntar i ASSESSING.");
    }
    if (request.requestId !== payload?.requestId) {
      throw new Error("Stale Nano request_id.");
    }
    if (request.status !== "PENDING") {
      throw new Error(`Nano-requesten kan inte claimas från status ${request.status}.`);
    }
    if (request.mode !== NANO_ANALYSIS_MODES.OPERATOR_RESUME) {
      const currentPage = await readPage(run.targetTabId, "nano-claim-freshness");
      if (!observationMatchesPage(run.pendingObservation, currentPage)) {
        run = supersedePendingObservation(run, currentPage, audit, {
          windowId,
          reason: "Target hash/epoch changed before Nano claim"
        });
        context.run = run;
        await writeRuntimeBundle(runtime, continuity, audit);
        await notifyPanels(windowId);
        setTimeout(() => tickWindow(windowId, "observation-superseded-before-claim").catch(console.warn), 0);
        return snapshotForWindow(windowId);
      }
    }
    const now = Date.now();
    const deadline = Date.parse(request.deadlineAt || "");
    if (request.mode !== NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP &&
        Number.isFinite(deadline) && now >= deadline) {
      throw new Error("NANO_REQUEST_DEADLINE_EXPIRED");
    }
    const attempts = Number(request.attempts || 0) + 1;
    if (attempts > NANO_MAX_ATTEMPTS) {
      throw new Error("NANO_ATTEMPTS_EXHAUSTED");
    }

    const claimId = randomId("nano-claim");
    const at = nowIso(now);
    request.mode = Object.values(NANO_ANALYSIS_MODES).includes(payload?.analysisMode)
      ? payload.analysisMode
      : request.mode || NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS;
    const claimResult = claimNanoRequestState(request, {
      claimId,
      modelKind: payload?.modelKind || "LanguageModel",
      inputDigest: payload?.inputDigest,
      inputChars: payload?.inputChars,
      leaseMs: NANO_CLAIM_LEASE_MS,
      now
    });
    if (!claimResult.ok) {
      throw new Error(`NANO_CLAIM_REJECTED:${claimResult.reason}`);
    }
    Object.assign(request, claimResult.request, {
      attempts,
      lastError: ""
    });

    run.nanoTelemetry ||= {};
    run.nanoTelemetry.lastRequestId = request.requestId;
    run.nanoTelemetry.lastMode = request.mode;
    run.nanoTelemetry.lastStatus = "RUNNING";
    run.nanoTelemetry.lastStartedAt = at;
    run.nanoTelemetry.lastInputDigest = request.inputDigest;
    run.nanoTelemetry.lastInputChars = request.inputChars;
    run.nanoTelemetry.lastError = "";
    run.runtimeDecisionStatus = "NANO_RUNNING";
    // v0.6.4: the input budget is durable evidence that the prompt was bounded to
    // the host context window before dispatch, not merely rejected afterwards.
    if (payload?.inputBudget && typeof payload.inputBudget === "object") {
      run.nanoTelemetry.lastInputBudget = {
        maxPromptChars: Number(payload.inputBudget.maxPromptChars || 0),
        promptChars: Number(payload.inputBudget.promptChars || 0),
        availableTokens: Number(payload.inputBudget.availableTokens || 0),
        measuredInputTokens: Number.isFinite(Number(payload.inputBudget.measuredInputTokens))
          ? Number(payload.inputBudget.measuredInputTokens)
          : null,
        degradeAttempt: Number(payload.inputBudget.degradeAttempt || 0),
        withinBudget: payload.inputBudget.withinBudget !== false,
        strategy: sanitizeText(payload.inputBudget.strategy, 60),
        trimmedLists: Array.isArray(payload.inputBudget.trimmedLists)
          ? payload.inputBudget.trimmedLists.slice(0, 8).map((item) => sanitizeText(item, 40))
          : []
      };
      request.inputBudget = run.nanoTelemetry.lastInputBudget;
    }
    if (payload?.hostState && typeof payload.hostState === "object") {
      const hostUsage = Number(payload.hostState.contextUsage);
      const hostWindow = Number(payload.hostState.contextWindow);
      run.nanoTelemetry.lastStaleReason = sanitizeText(payload.hostState.staleReason, 160);
      run.nanoTelemetry.lastContextUsage = Number.isFinite(hostUsage) ? hostUsage : null;
      run.nanoTelemetry.lastContextWindow = Number.isFinite(hostWindow) ? hostWindow : null;
    }
    run.updatedAt = at;

    addAudit(audit, {
      kind: "info",
      title: "Nano-analys startad",
      detail: `${request.mode} · request ${request.requestId} · input ${request.inputChars} tecken` +
        `${request.inputBudget ? ` · budget ${request.inputBudget.maxPromptChars} tecken (${request.inputBudget.strategy})` : ""}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });

    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function heartbeatNanoRequest(windowId, payload) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const run = context.run;
    const request = run?.pendingNanoRequest;
    if (!run || run.state !== STATES.ASSESSING || !request) {
      throw new Error("Nano heartbeat saknar aktiv request.");
    }
    if (
      request.requestId !== payload?.requestId ||
      !request.claimId ||
      !payload?.claimId ||
      request.claimId !== payload.claimId ||
      request.status !== "RUNNING"
    ) {
      throw new Error("Nano heartbeat är stale eller felclaimad.");
    }
    const now = Date.now();
    const progressResult = updateNanoProgressState(request, {
      claimId: payload.claimId,
      outputChars: payload?.outputChars,
      chunkCount: payload?.chunkCount,
      leaseMs: NANO_CLAIM_LEASE_MS,
      now
    });
    if (!progressResult.ok) {
      throw new Error(`NANO_HEARTBEAT_REJECTED:${progressResult.reason}`);
    }
    Object.assign(request, progressResult.request);
    run.nanoTelemetry ||= {};
    run.nanoTelemetry.lastStatus = "RUNNING";
    run.nanoTelemetry.lastHeartbeatAt = request.heartbeatAt;
    run.nanoTelemetry.lastOutputChars = request.outputChars;
    run.nanoTelemetry.lastChunkCount = request.chunkCount;
    run.nanoTelemetry.lastFirstTokenAt = request.firstTokenAt || null;
    run.nanoTelemetry.lastLeaseUntil = request.claimLeaseUntil || null;
    run.runtimeDecisionStatus = "NANO_RUNNING";
    run.updatedAt = request.heartbeatAt;
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    return { ok: true, requestId: request.requestId, heartbeatAt: request.heartbeatAt };
  });
}

async function failNanoRequest(windowId, payload) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    let run = context.run;
    const request = run?.pendingNanoRequest;
    if (!run || run.state !== STATES.ASSESSING || !request) {
      throw new Error("Nano failure saknar aktiv request.");
    }
    if (request.requestId !== payload?.requestId) {
      throw new Error("Stale Nano failure request_id.");
    }
    const now = Date.now();
    const computedDurationMs = Math.max(
      0,
      Number(payload?.durationMs || 0) ||
      (now - Date.parse(request.startedAt || request.claimedAt || nowIso(now)))
    );
    const failed = failNanoRequestState(request, {
      claimId: payload?.claimId,
      errorCode: payload?.errorCode,
      errorDetail: payload?.errorDetail,
      durationMs: computedDurationMs,
      repairUsed: payload?.repairUsed,
      now
    });
    if (!failed.ok) {
      throw new Error(`NANO_FAILURE_REJECTED:${failed.reason}`);
    }
    Object.assign(request, failed.request);
    const at = request.completedAt;
    const durationMs = request.durationMs;

    run.nanoTelemetry ||= {};
    run.nanoTelemetry.lastRequestId = request.requestId;
    run.nanoTelemetry.lastMode = request.mode;
    run.nanoTelemetry.lastStatus = "FAILED";
    run.nanoTelemetry.lastCompletedAt = at;
    run.nanoTelemetry.lastDurationMs = durationMs;
    run.nanoTelemetry.lastError = request.resultSummary;
    run.nanoTelemetry.lastResultSummary = request.resultSummary;
    run.runtimeDecisionStatus = "NANO_FAILED";
    context.nanoHostTelemetry = normalizeNanoHostTelemetry(context.nanoHostTelemetry, {
      busy: false,
      event: "request-failed"
    });

    if (run.maxAutonomousMode && run.pendingObservation) {
      const recoverySource = protocolFastPathEligible(run.pendingObservation.targetResult)
        ? NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
        : NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY;
      const armed = armDeterministicRecovery(run, {
        source: recoverySource,
        analysisMode: request.mode,
        reason: `Nano fail-closed är recoverable; autonom ${recoverySource} tar över utan verklig PAUS. ${request.resultSummary}`,
        now
      });
      run = armed.run;
      addAudit(audit, {
        kind: "warning",
        title: "Nano-fel omvandlat till autonom recovery",
        detail: `${request.mode} · ${request.resultSummary} · ${durationMs} ms · source=${recoverySource}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(run.targetTabId, "ASSESSING", "Nano-fel återhämtas autonomt");
      await notifyPanels(windowId);
      setTimeout(() => tickWindow(windowId, "nano-failure-autonomous-recovery").catch(console.warn), 0);
      return snapshotForWindow(windowId);
    }

    run.resumePlan = {
      requestedAction: "Bevara aktuell uppgift och invänta en lokalt producerad, grounding-validerad fortsättningsprompt; utför ingen ny sakåtgärd.",
      requiredEvidence: ["Ett lokalt validerat Nano-beslut med substantiell åtgärd och grounding."],
      workUnit: "Återställ Nano-pipeline utan att skicka en ogrundad målprompt.",
      alternatives: [],
      reason: `Nano fail-closed: ${request.resultSummary}`
    };
    run = transitionRun(run, STATES.SOFT_PAUSED, {
      origin: PAUSE_ORIGINS.NANO_HOST_REQUIRED,
      reason: run.resumePlan.reason,
      force: true
    });

    addAudit(audit, {
      kind: "blocked",
      title: "Nano-analys avvisad fail-closed (Max Mode av)",
      detail: `${request.mode} · ${request.resultSummary} · ${durationMs} ms`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });

    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(run.targetTabId, "PAUSED", "Nano-analys avvisades; Max Mode är av");
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function updateNanoHostState(windowId, payload = {}) {
  return enqueue(async () => {
    const { continuity, runtime, audit, applicationLog } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const previousTelemetry = context.nanoHostTelemetry || {};
    context.nanoHostTelemetry = normalizeNanoHostTelemetry(previousTelemetry, payload);
    const assignIfPresent = (key, value) => {
      if (Object.prototype.hasOwnProperty.call(payload || {}, key)) {
        context.nanoHostTelemetry[key] = value;
      }
    };
    assignIfPresent("outputLanguages", Array.isArray(payload?.outputLanguages)
      ? payload.outputLanguages.slice(0, 5).map((item) => sanitizeText(item, 20)).filter(Boolean)
      : []);
    assignIfPresent("outputLanguageAttested", Boolean(payload?.outputLanguageAttested));
    assignIfPresent("providerInventory", Array.isArray(payload?.providerInventory)
      ? payload.providerInventory.slice(0, 4).map((item) => ({
          kind: sanitizeText(item?.kind, 120),
          contract: sanitizeText(item?.contract, 160),
          priority: Math.max(0, Number(item?.priority || 0))
        }))
      : []);
    for (const key of [
      "createStartedAt", "createDeadlineAt", "preflightAt", "canaryStartedAt",
      "canaryCompletedAt", "lastProgressAt", "lastProgressEventAt",
      "progressStallDeadlineAt"
    ]) {
      assignIfPresent(key, sanitizeText(payload?.[key], 80) || null);
    }
    assignIfPresent("preflightError", sanitizeText(payload?.preflightError, 300));
    assignIfPresent("userActivationActiveAtStart", Boolean(payload?.userActivationActiveAtStart));
    assignIfPresent("canaryOutputChars", Math.max(0, Number(payload?.canaryOutputChars || 0)));
    assignIfPresent("canaryVerified", Boolean(payload?.canaryVerified));
    assignIfPresent("lastProgressValue", Number.isFinite(Number(payload?.lastProgressValue))
      ? Math.min(1, Math.max(0, Number(payload.lastProgressValue)))
      : null);
    assignIfPresent("progressStallTimeoutMs", Number.isFinite(Number(payload?.progressStallTimeoutMs))
      ? Math.max(0, Number(payload.progressStallTimeoutMs))
      : null);
    if (context.run) {
      context.run.nanoTelemetry ||= {};
      context.run.nanoTelemetry.lastStaleReason = context.nanoHostTelemetry.staleReason;
      context.run.nanoTelemetry.lastContextUsage = context.nanoHostTelemetry.contextUsage;
      context.run.nanoTelemetry.lastContextWindow = context.nanoHostTelemetry.contextWindow;
      context.run.nanoTelemetry.lastCloneUsed = context.nanoHostTelemetry.cloneUsed;
    }
    context.updatedAt = nowIso();
    const event = sanitizeText(payload?.event, 120) || "state";
    const materialProgress = payload?.materialProgress === true;
    const stateChanged =
      previousTelemetry.status !== context.nanoHostTelemetry.status ||
      previousTelemetry.availability !== context.nanoHostTelemetry.availability ||
      previousTelemetry.reasonCode !== context.nanoHostTelemetry.reasonCode;
    const shouldLog = materialProgress || stateChanged || [
      "panel-opened", "preflight", "preflight-error", "admission-started",
      "native-create-started", "session-created", "canary-started", "canary-passed",
      "canary-failed", "clean-session-created", "availability", "assets-preparing",
      "download-progress", "loading", "available", "external-model-asset-blocker",
      "download-stalled", "timeout", "aborted", "abort-requested", "error", "settled"
    ].includes(event);
    let nextApplicationLog = applicationLog;
    if (shouldLog) {
      nextApplicationLog = appendApplicationEvent(applicationLog, {
        level: ["error", "timeout", "download-stalled", "external-model-asset-blocker"].includes(event)
          ? "error"
          : ["aborted", "abort-requested"].includes(event)
            ? "warning"
            : "info",
        event: `nano.host.${event}`,
        message: context.nanoHostTelemetry.staleDetail ||
          `Chrome on-device LanguageModel ${context.nanoHostTelemetry.status}.`,
        windowId,
        tabId: context.run?.targetTabId ?? context.selectedTabId ?? null,
        runId: context.run?.runId || null,
        missionId: context.activeMissionId || null,
        hostId: context.nanoHostTelemetry.hostId || null,
        correlationId: context.nanoHostTelemetry.createStartedAt || null,
        data: {
          status: context.nanoHostTelemetry.status,
          availability: context.nanoHostTelemetry.availability,
          providerContract: context.nanoHostTelemetry.providerContract,
          providerPolicy: context.nanoHostTelemetry.providerPolicy,
          providerInventory: context.nanoHostTelemetry.providerInventory,
          progress: context.nanoHostTelemetry.progress,
          lastProgressValue: context.nanoHostTelemetry.lastProgressValue,
          createStartedAt: context.nanoHostTelemetry.createStartedAt,
          createDeadlineAt: context.nanoHostTelemetry.createDeadlineAt,
          userActivationActiveAtStart:
            context.nanoHostTelemetry.userActivationActiveAtStart,
          preflightAt: context.nanoHostTelemetry.preflightAt,
          preflightError: context.nanoHostTelemetry.preflightError,
          canaryStartedAt: context.nanoHostTelemetry.canaryStartedAt,
          canaryCompletedAt: context.nanoHostTelemetry.canaryCompletedAt,
          canaryOutputChars: context.nanoHostTelemetry.canaryOutputChars,
          canaryVerified: context.nanoHostTelemetry.canaryVerified,
          progressStallDeadlineAt: context.nanoHostTelemetry.progressStallDeadlineAt,
          progressStallTimeoutMs: context.nanoHostTelemetry.progressStallTimeoutMs,
          reasonCode: context.nanoHostTelemetry.reasonCode,
          materialProgress
        }
      });
    }
    const reviewReplay = maybeReplayDeferredCoreSurfaceReview({
      context,
      run: context.run,
      applicationLog: nextApplicationLog,
      audit,
      windowId,
      reason: `nano-host-${event}`,
      now: Date.now()
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    if (nextApplicationLog !== applicationLog) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.APPLICATION_LOG]: nextApplicationLog
      });
    }
    if (["SCHEDULE", "CONSUME_NOOP"].includes(reviewReplay.action)) {
      await notifyPanels(windowId);
    }
    return snapshotForWindow(windowId);
  });
}

async function findActiveSupportedTab(windowId) {
  const tabs = await chrome.tabs.query({ active: true, windowId });
  const tab = tabs[0];
  if (!tab?.id || !isAllowedChatUrl(tab.url || "")) {
    throw new Error("Den aktiva fliken i detta Chrome-fönster är inte en stödd ChatGPT-flik.");
  }
  return tab;
}

async function linkActiveTab(windowId) {
  return enqueue(async () => {
    const tab = await findActiveSupportedTab(windowId);
    const page = await readPage(tab.id, "link-active-tab");
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const record = linkedTabRecord(tab, page);
    context.linkedTabs[String(tab.id)] = record;
    context.selectedTabId = tab.id;
    context.lastActiveTabId = tab.id;
    context.surfacePair = bindSurfaceRole(
      context.surfacePair,
      MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER,
      { tab, page }
    );
    const reattachment = reattachRunToTab(context.run, {
      tabId: tab.id,
      conversationKey: page.conversationKey
    });
    if (reattachment.reattached) context.run = reattachment.run;
    context.updatedAt = nowIso();
    addAudit(audit, {
      kind: "done",
      title: reattachment.reattached ? "Bevarad körning återansluten" : "ChatGPT-flik kopplad",
      detail: reattachment.reattached
        ? `${tab.title || "ChatGPT"} · körningen återgår via RECOVERING utan att kontinuitet eller journal rensas`
        : `${tab.title || "ChatGPT"} · ${page.conversationKey || "ny/okänd konversation"}`,
      windowId,
      tabId: tab.id
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(tab.id, "ACTIVE_TARGET", "Valt mål i EIC Autonom Agent");
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function detachSelectedTab(windowId) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const tabId = Number(context.selectedTabId);
    if (!Number.isInteger(tabId)) {
      throw new Error("Ingen kopplad målflik är vald.");
    }
    const record = context.linkedTabs[String(tabId)];
    if (!record) {
      throw new Error("Den valda fliken är inte kopplad.");
    }

    const detachment = detachRunFromTab(context.run, record);
    if (detachment.detached) context.run = detachment.run;
    context.surfacePair = detachSurfaceRole(
      context.surfacePair,
      MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER,
      { reason: "EXPLICIT_CONTROLLER_DETACH" }
    );
    delete context.linkedTabs[String(tabId)];
    context.selectedTabId = null;
    context.updatedAt = nowIso();

    addAudit(audit, {
      kind: "info",
      title: "Aktiv flik bortkopplad",
      detail: detachment.detached
        ? "Flikkopplingen togs bort. Aktiv run, currentTurn, effektjournal, pending observation och durable continuity bevarades i mjuk paus."
        : "Flikkopplingen togs bort. Ingen aktiv run använde fliken.",
      windowId,
      tabId,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(tabId, "DISCONNECTED", "Bortkopplad från EIC Autonom Agent");
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function selectLinkedTab(windowId, tabId) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const record = context.linkedTabs[String(tabId)];
    if (!record) throw new Error("Fliken är inte uttryckligen kopplad i detta fönster.");
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId !== windowId) throw new Error("Fliken tillhör inte panelens Chrome-fönster.");
    if (!isAllowedChatUrl(tab.url || "")) throw new Error("Fliken har navigerat bort från stödd ChatGPT-origin.");
    context.surfacePair = bindSurfaceRole(
      context.surfacePair,
      MISSION_SURFACE_ROLES.CHATGPT_CONTROLLER,
      { tab, page: record }
    );
    context.selectedTabId = tabId;
    context.updatedAt = nowIso();
    addAudit(audit, {
      kind: "info",
      title: "Målflik vald",
      detail: record.title,
      windowId,
      tabId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    for (const linked of Object.values(context.linkedTabs)) {
      await setTabIndicator(
        linked.tabId,
        linked.tabId === tabId ? "ACTIVE_TARGET" : "LINKED",
        linked.tabId === tabId ? "Valt EIC-mål" : "Kopplad"
      );
    }
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function findActiveWebTargetTab(windowId) {
  const tabs = await chrome.tabs.query({ active: true, windowId });
  const tab = tabs[0];
  if (!tab?.id || !isSafeWebTargetUrl(tab.url || "")) {
    throw new Error("Den aktiva fliken är inte en tillåten WEB_TARGET-yta.");
  }
  return tab;
}

async function bindActiveWebTarget(windowId) {
  return enqueue(async () => {
    const tab = await findActiveWebTargetTab(windowId);
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    context.surfacePair = bindSurfaceRole(
      context.surfacePair,
      MISSION_SURFACE_ROLES.WEB_TARGET,
      { tab }
    );
    const profile = runtimeBuildProfile();
    const target = webTargetSurface(context);
    if (profile === BUILD_PROFILES.BROWSER) {
      const permission = await containsExactOriginPermission(chrome, target.url);
      applyWebTargetCapabilityState(context, {
        permissionState: permission.granted
          ? WEB_PERMISSION_STATES.GRANTED
          : WEB_PERMISSION_STATES.NOT_REQUESTED,
        permissionOriginPattern: permission.pattern,
        debuggerState: CDP_SESSION_STATES.DETACHED,
        debuggerSessionId: "",
        reason: "EXPLICIT_TARGET_BIND"
      });
    } else {
      applyWebTargetCapabilityState(context, {
        permissionState: WEB_PERMISSION_STATES.UNAVAILABLE_STANDARD_PROFILE,
        permissionOriginPattern: "",
        debuggerState: CDP_SESSION_STATES.UNAVAILABLE_STANDARD_PROFILE,
        debuggerSessionId: "",
        reason: "EXPLICIT_TARGET_BIND_STANDARD_PROFILE"
      });
    }
    context.browserSession = createCdpSession({
      profile,
      surface: webTargetSurface(context)
    });
    context.lastActiveTabId = tab.id;
    context.updatedAt = nowIso();
    addAudit(audit, {
      kind: "done",
      title: "WEB_TARGET kopplad",
      detail: `${tab.title || tab.url} · identitet och livscykel endast; inga origin-grants eller debugger-sessioner`,
      windowId,
      tabId: tab.id,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function detachWebTarget(windowId) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const target = context.surfacePair?.surfaces?.[MISSION_SURFACE_ROLES.WEB_TARGET];
    if (!target) throw new Error("Ingen WEB_TARGET-yta finns att koppla bort.");
    await detachBrowserSessionForContext(context, {
      reason: "TARGET_EXPLICITLY_DETACHED"
    });
    context.surfacePair = detachSurfaceRole(
      context.surfacePair,
      MISSION_SURFACE_ROLES.WEB_TARGET,
      { reason: "EXPLICIT_TARGET_DETACH" }
    );
    context.updatedAt = nowIso();
    addAudit(audit, {
      kind: "info",
      title: "WEB_TARGET bortkopplad",
      detail: "Målytan kräver ny explicit koppling före framtida browserläge.",
      windowId,
      tabId: target.tabId,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function detachBrowserSessionForContext(context, {
  reason = "EXPLICIT_DETACH",
  tolerateMissing = true
} = {}) {
  const targetBeforeDetach = webTargetSurface(context);
  await markWindowEvidenceStale(chrome, context.windowId, {
    reason,
    surface: targetBeforeDetach
  }).catch((error) => console.warn("EIC evidence stale-mark failed.", error));
  if (targetBeforeDetach) {
    context.browserRecovery = markBrowserRecoveryRequired(context.browserRecovery, {
      reason,
      surface: targetBeforeDetach,
      missionId: context.activeMissionId || "",
      browserLoop: context.browserLoop
    });
    context.browserApproval = null;
    context.browserLoop = normalizeBrowserLoopState({
      ...context.browserLoop,
      state: BROWSER_LOOP_STATES.PAUSED,
      lastReason: reason,
      controllerResponseHash: "",
      updatedAt: nowIso()
    }, { windowId: context.windowId });
  }
  const profile = runtimeBuildProfile();
  if (profile !== BUILD_PROFILES.BROWSER) {
    liveCdpSessions.delete(cdpLiveKey(context.windowId));
    context.browserSession = createCdpSession({
      profile,
      surface: webTargetSurface(context)
    });
    applyWebTargetCapabilityState(context, {
      debuggerState: CDP_SESSION_STATES.UNAVAILABLE_STANDARD_PROFILE,
      debuggerSessionId: "",
      reason
    });
    return context.browserSession;
  }
  const current = liveCdpSessions.get(cdpLiveKey(context.windowId)) || context.browserSession;
  const detached = await detachBoundedCdp(chrome, current, {
    reason,
    tolerateMissing
  });
  liveCdpSessions.delete(cdpLiveKey(context.windowId));
  context.browserSession = detached;
  applyWebTargetCapabilityState(context, {
    debuggerState: CDP_SESSION_STATES.DETACHED,
    debuggerSessionId: detached.sessionId,
    reason
  });
  return detached;
}

async function requestWebTargetPermission(windowId) {
  return enqueue(async () => {
    const profile = runtimeBuildProfile();
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const target = webTargetSurface(context);
    if (!Number.isInteger(Number(target?.tabId))) throw new Error("WEB_TARGET_REQUIRED");
    applyWebTargetCapabilityState(context, {
      permissionState: WEB_PERMISSION_STATES.REQUESTING,
      reason: "ORIGIN_PERMISSION_REQUESTED"
    });
    const result = await requestExactOriginPermission(chrome, profile, target.url);
    applyWebTargetCapabilityState(context, {
      permissionState: result.granted
        ? WEB_PERMISSION_STATES.GRANTED
        : WEB_PERMISSION_STATES.DENIED,
      permissionOriginPattern: result.pattern,
      reason: result.granted ? "ORIGIN_PERMISSION_GRANTED" : "ORIGIN_PERMISSION_DENIED"
    });
    addAudit(audit, {
      kind: result.granted ? "done" : "warning",
      title: result.granted ? "Originbehörighet beviljad" : "Originbehörighet nekad",
      detail: `${result.pattern} · exakt origin; ingen generell required host-behörighet`,
      windowId,
      tabId: target.tabId,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function revokeWebTargetPermission(windowId) {
  return enqueue(async () => {
    const profile = runtimeBuildProfile();
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const target = webTargetSurface(context);
    if (!Number.isInteger(Number(target?.tabId))) throw new Error("WEB_TARGET_REQUIRED");
    await detachBrowserSessionForContext(context, {
      reason: "ORIGIN_PERMISSION_REVOKED"
    });
    const result = await revokeExactOriginPermission(chrome, profile, target.url);
    if (result.granted) throw new Error("WEB_PERMISSION_REVOKE_READBACK_FAILED");
    applyWebTargetCapabilityState(context, {
      permissionState: WEB_PERMISSION_STATES.REVOKED,
      permissionOriginPattern: result.pattern,
      reason: "ORIGIN_PERMISSION_REVOKED"
    });
    addAudit(audit, {
      kind: "info",
      title: "Originbehörighet återkallad",
      detail: `${result.pattern} · readback bekräftar att behörigheten inte längre finns`,
      windowId,
      tabId: target.tabId,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function attachWebTargetDebugger(windowId) {
  return enqueue(async () => {
    const profile = runtimeBuildProfile();
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const target = webTargetSurface(context);
    if (!Number.isInteger(Number(target?.tabId))) throw new Error("WEB_TARGET_REQUIRED");
    const permission = await containsExactOriginPermission(chrome, target.url);
    if (!permission.granted) {
      applyWebTargetCapabilityState(context, {
        permissionState: WEB_PERMISSION_STATES.NOT_REQUESTED,
        permissionOriginPattern: permission.pattern,
        reason: "CDP_ATTACH_PERMISSION_MISSING"
      });
      throw new Error("CDP_EXACT_ORIGIN_PERMISSION_REQUIRED");
    }
    const existing = liveCdpSessions.get(cdpLiveKey(windowId));
    if (existing?.state === CDP_SESSION_STATES.ATTACHED) {
      if (cdpSessionMatchesSurface(existing, target)) return snapshotForWindow(windowId);
      await detachBrowserSessionForContext(context, {
        reason: "TARGET_IDENTITY_CHANGED_BEFORE_ATTACH"
      });
    }
    const session = await attachBoundedCdp(chrome, {
      profile,
      surface: target,
      permissionGranted: true
    });
    liveCdpSessions.set(cdpLiveKey(windowId), session);
    context.browserSession = session;
    applyWebTargetCapabilityState(context, {
      permissionState: WEB_PERMISSION_STATES.GRANTED,
      permissionOriginPattern: permission.pattern,
      debuggerState: CDP_SESSION_STATES.ATTACHED,
      debuggerSessionId: session.sessionId,
      reason: "EXPLICIT_CDP_ATTACH"
    });
    addAudit(audit, {
      kind: "done",
      title: "Bounded CDP-session ansluten",
      detail: `tab ${target.tabId} · ${target.origin} · epoch ${target.documentEpoch} · inga WP07-kommandon skickade`,
      windowId,
      tabId: target.tabId,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function detachWebTargetDebugger(windowId) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const target = webTargetSurface(context);
    await detachBrowserSessionForContext(context, {
      reason: "EXPLICIT_CDP_DETACH"
    });
    addAudit(audit, {
      kind: "info",
      title: "CDP-session frånkopplad",
      detail: "Sessionen är stängd; originbehörigheten ändrades inte.",
      windowId,
      tabId: target?.tabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}


function requireEvidenceSession(context) {
  const profile = runtimeBuildProfile();
  if (profile !== BUILD_PROFILES.BROWSER) {
    throw new Error("EVIDENCE_BROWSER_PROFILE_REQUIRED");
  }
  const target = webTargetSurface(context);
  if (!Number.isInteger(Number(target?.tabId))) throw new Error("EVIDENCE_WEB_TARGET_REQUIRED");
  if (target.lifecycleState !== "READY") {
    throw new Error(`EVIDENCE_TARGET_NOT_READY:${target.lifecycleState || "UNKNOWN"}`);
  }
  const session = liveCdpSessions.get(cdpLiveKey(context.windowId));
  if (!session || session.state !== CDP_SESSION_STATES.ATTACHED) {
    throw new Error("EVIDENCE_CDP_SESSION_NOT_ATTACHED");
  }
  if (!cdpSessionMatchesSurface(session, target)) {
    throw new Error("EVIDENCE_TARGET_IDENTITY_MISMATCH");
  }
  return { profile, target, session };
}

async function verifyEvidencePermission(target) {
  const permission = await containsExactOriginPermission(chrome, target.url);
  if (!permission.granted) throw new Error("EVIDENCE_EXACT_ORIGIN_PERMISSION_REQUIRED");
  return permission;
}

async function recordEvidenceReceipt(windowId, target, payload) {
  return persistEvidenceItem(chrome, {
    windowId,
    type: EVIDENCE_TYPES.RECEIPT,
    source: "WP07",
    surface: target,
    payload
  });
}

async function startEvidenceObservation(windowId) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const { target, session } = requireEvidenceSession(context);
    await verifyEvidencePermission(target);

    const existing = await loadWindowEvidenceStore(chrome, windowId);
    if (
      existing.observation.state === EVIDENCE_OBSERVATION_STATES.ACTIVE &&
      existing.observation.sessionId === session.sessionId &&
      existing.observation.surfaceId === target.surfaceId &&
      existing.observation.documentEpoch === target.documentEpoch
    ) {
      return snapshotForWindow(windowId);
    }

    await setEvidenceObservation(chrome, windowId, createEvidenceObservation({
      state: EVIDENCE_OBSERVATION_STATES.STARTING,
      sessionId: session.sessionId,
      surface: target,
      reason: "EXPLICIT_EVIDENCE_START"
    }));

    try {
      const receipts = await enableEvidenceDomains(chrome, { session, surface: target });
      await setEvidenceObservation(chrome, windowId, {
        ...createEvidenceObservation({
          state: EVIDENCE_OBSERVATION_STATES.ACTIVE,
          sessionId: session.sessionId,
          surface: target,
          reason: "EVIDENCE_DOMAINS_ENABLED"
        }),
        startedAt: nowIso()
      });
      await recordEvidenceReceipt(windowId, target, {
        action: "START_EVIDENCE_OBSERVATION",
        methods: receipts,
        rawResponseBodies: false,
        promptDelivery: false,
        exactOrigin: target.origin
      });
      addAudit(audit, {
        kind: "done",
        title: "WP07 evidensobservation aktiverad",
        detail: `${target.origin} · Runtime/Log/Network/Page metadata; inga response bodies`,
        windowId,
        tabId: target.tabId,
        runId: context.run?.runId || null
      });
    } catch (error) {
      await setEvidenceObservation(chrome, windowId, {
        ...createEvidenceObservation({
          state: EVIDENCE_OBSERVATION_STATES.ERROR,
          sessionId: session.sessionId,
          surface: target,
          reason: `EVIDENCE_START_FAILED:${error?.message || error}`
        }),
        stoppedAt: nowIso()
      });
      throw error;
    }

    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function captureBrowserEvidenceSnapshot(windowId) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const { target, session } = requireEvidenceSession(context);
    await verifyEvidencePermission(target);
    const store = await loadWindowEvidenceStore(chrome, windowId);
    if (
      store.observation.state !== EVIDENCE_OBSERVATION_STATES.ACTIVE ||
      store.observation.sessionId !== session.sessionId ||
      store.observation.surfaceId !== target.surfaceId ||
      store.observation.documentEpoch !== target.documentEpoch
    ) {
      throw new Error("EVIDENCE_OBSERVATION_NOT_ACTIVE_FOR_TARGET");
    }

    const bundle = await captureEvidenceBundle(chrome, { session, surface: target });
    const ax = await persistEvidenceItem(chrome, {
      windowId,
      type: bundle.ax.type,
      source: "CDP.Accessibility.getFullAXTree",
      surface: target,
      payload: bundle.ax.payload
    });
    const dom = await persistEvidenceItem(chrome, {
      windowId,
      type: bundle.dom.type,
      source: "CDP.DOMSnapshot.captureSnapshot",
      surface: target,
      payload: bundle.dom.payload
    });
    const screenshot = await persistEvidenceItem(chrome, {
      windowId,
      type: bundle.screenshot.type,
      source: "CDP.Page.captureScreenshot",
      surface: target,
      payload: bundle.screenshot.payload,
      screenshotBase64: bundle.screenshot.base64
    });
    await recordEvidenceReceipt(windowId, target, {
      action: "CAPTURE_EVIDENCE_SNAPSHOT",
      methods: bundle.receipts,
      evidenceIds: [ax.item.id, dom.item.id, screenshot.item.id],
      digests: [ax.item.digest, dom.item.digest, screenshot.item.bodyDigest],
      screenshotStorage: "SESSION_RAW_PNG",
      screenshotReadbackVerified: screenshot.item.readbackVerified,
      responseBodies: false
    });

    addAudit(audit, {
      kind: "done",
      title: "WP07 evidenssnapshot lagrad",
      detail: `AX ${ax.item.id} · DOM ${dom.item.id} · screenshot ${screenshot.item.id} med sessionsreadback`,
      windowId,
      tabId: target.tabId,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function stopEvidenceObservation(windowId) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const target = webTargetSurface(context);
    const session = liveCdpSessions.get(cdpLiveKey(windowId)) || context.browserSession;
    const store = await loadWindowEvidenceStore(chrome, windowId);
    if (store.observation.state === EVIDENCE_OBSERVATION_STATES.INACTIVE) {
      return snapshotForWindow(windowId);
    }

    const receipts = await disableEvidenceDomains(chrome, {
      session,
      surface: target,
      tolerateMissing: true
    });
    await setEvidenceObservation(chrome, windowId, {
      ...store.observation,
      state: EVIDENCE_OBSERVATION_STATES.INACTIVE,
      stoppedAt: nowIso(),
      lastReason: "EXPLICIT_EVIDENCE_STOP",
      updatedAt: nowIso()
    });
    if (target) {
      await recordEvidenceReceipt(windowId, target, {
        action: "STOP_EVIDENCE_OBSERVATION",
        methods: receipts,
        responseBodies: false
      });
    }
    addAudit(audit, {
      kind: "info",
      title: "WP07 evidensobservation stoppad",
      detail: "CDP-observationsdomäner har stängts; CDP-session och originbehörighet är oförändrade.",
      windowId,
      tabId: target?.tabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function clearBrowserEvidenceCommand(windowId) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    await clearWindowEvidence(chrome, windowId);
    addAudit(audit, {
      kind: "info",
      title: "Browser-evidens rensad",
      detail: "Durable redigerad metadata och sessionslagrade screenshotkroppar för fönstret togs bort med readback.",
      windowId,
      tabId: webTargetSurface(context)?.tabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}


function browserActionObservationFromStore(store, action) {
  if (action.operation === "observe") return null;
  const item = (store?.items || []).find((entry) =>
    entry?.type === EVIDENCE_TYPES.BROWSER_OBSERVATION &&
    entry?.payload?.observationId === action.observationId &&
    entry?.payload?.observationDigest === action.observationDigest
  );
  return item?.payload || null;
}

function appendBrowserActionLedger(context, entry) {
  const existing = Array.isArray(context.browserActionLedger)
    ? context.browserActionLedger.filter((item) =>
        item?.actionId !== entry.actionId && item?.turnId !== entry.turnId)
    : [];
  context.browserActionLedger = [...existing, entry].slice(-100);
  return entry;
}

function updateBrowserActionLedger(context, actionId, patch) {
  const ledger = Array.isArray(context.browserActionLedger) ? context.browserActionLedger : [];
  const index = ledger.findIndex((entry) => entry?.actionId === actionId);
  if (index < 0) throw new Error("BROWSER_ACTION_LEDGER_ENTRY_MISSING");
  ledger[index] = { ...ledger[index], ...patch };
  context.browserActionLedger = ledger.slice(-100);
  return ledger[index];
}

async function persistBrowserActionCapture(windowId, target, capture) {
  const ax = await persistEvidenceItem(chrome, {
    windowId,
    type: capture.ax.type,
    source: "WP08.Accessibility.getFullAXTree",
    surface: target,
    payload: capture.ax.payload
  });
  const dom = await persistEvidenceItem(chrome, {
    windowId,
    type: capture.dom.type,
    source: "WP08.DOMSnapshot.captureSnapshot",
    surface: target,
    payload: capture.dom.payload
  });
  const screenshot = await persistEvidenceItem(chrome, {
    windowId,
    type: capture.screenshot.type,
    source: "WP08.Page.captureScreenshot",
    surface: target,
    payload: capture.screenshot.payload,
    screenshotBase64: capture.screenshot.base64
  });
  return {
    evidenceIds: [ax.item.id, dom.item.id, screenshot.item.id],
    evidenceDigests: [ax.item.digest, dom.item.digest, screenshot.item.bodyDigest],
    screenshotReadbackVerified: screenshot.item.readbackVerified === true
  };
}

async function executeBrowserResponseAction(windowId, responseText, {
  policyApprovalId = "",
  expectedActionId = ""
} = {}) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const { target, session } = requireEvidenceSession(context);
    await verifyEvidencePermission(target);
    const store = await loadWindowEvidenceStore(chrome, windowId);
    if (
      store.observation.state !== EVIDENCE_OBSERVATION_STATES.ACTIVE ||
      store.observation.sessionId !== session.sessionId ||
      store.observation.surfaceId !== target.surfaceId ||
      store.observation.documentEpoch !== target.documentEpoch ||
      store.observation.origin !== target.origin
    ) {
      throw new Error("BROWSER_ACTION_EVIDENCE_OBSERVATION_NOT_ACTIVE");
    }

    const parsed = parseBrowserActionResponse(responseText);
    if (parsed.kind === "NO_ACTION") {
      addAudit(audit, {
        kind: "info",
        title: "WP08 svar utan browseråtgärd",
        detail: "Ingen fristående EIC_BROWSER_ACTION/1-markör hittades; ingen browseråtgärd exekverades.",
        windowId,
        tabId: target.tabId,
        runId: context.run?.runId || null
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    const consumedActionIds = context.browserActionLedger.map((entry) => entry.actionId);
    const consumedTurnIds = context.browserActionLedger.map((entry) => entry.turnId);
    const observation = browserActionObservationFromStore(store, parsed.action);
    const { action } = await validateBrowserAction(parsed.action, {
      surface: target,
      observation,
      consumedActionIds,
      consumedTurnIds
    });
    if (expectedActionId && action.actionId !== String(expectedActionId)) {
      throw new Error("BROWSER_ACTION_POLICY_ACTION_ID_MISMATCH");
    }
    const riskDecision = await classifyBrowserActionRisk({ action, observation });
    if (riskDecision.approvalRequired && !policyApprovalId) {
      throw new Error(`BROWSER_ACTION_APPROVAL_REQUIRED:${riskDecision.level}`);
    }

    const startedAt = nowIso();
    appendBrowserActionLedger(context, {
      actionId: action.actionId,
      turnId: action.turnId,
      operation: action.operation,
      riskLevel: riskDecision.level,
      approvalId: String(policyApprovalId || ""),
      status: "PENDING_DISPATCH",
      receiptDigest: "",
      startedAt,
      completedAt: null,
      error: ""
    });
    // Durable PENDING readback is the exactly-once barrier. A service-worker restart
    // after this point blocks replay instead of dispatching the same action again.
    await writeRuntimeBundle(runtime, continuity, audit);

    let result;
    let captureRefs = null;
    let evidenceItem = null;
    try {
      result = await executeBrowserAction(chrome, {
        action,
        surface: target,
        session,
        observation
      });
      if (result.ok && result.output?.observation) {
        const persisted = await persistEvidenceItem(chrome, {
          windowId,
          type: EVIDENCE_TYPES.BROWSER_OBSERVATION,
          source: "WP08.EIC_BROWSER_OBSERVATION/1",
          surface: target,
          payload: result.output.observation
        });
        evidenceItem = persisted.item;
        result.receipt.effectReadback = "OBSERVATION_DIGEST_AND_STORAGE_READBACK_VERIFIED";
      }
      if (result.ok && result.output?.capture) {
        captureRefs = await persistBrowserActionCapture(windowId, target, result.output.capture);
        result.receipt.effectReadback = captureRefs.screenshotReadbackVerified
          ? "CAPTURE_METADATA_AND_SCREENSHOT_READBACK_VERIFIED"
          : "CAPTURE_READBACK_INCOMPLETE";
      }
      const receiptPayload = {
        ...result.receipt,
        observationEvidenceId: evidenceItem?.id || null,
        observationEvidenceDigest: evidenceItem?.digest || null,
        captureRefs
      };
      const receiptPersisted = await persistEvidenceItem(chrome, {
        windowId,
        type: EVIDENCE_TYPES.BROWSER_ACTION_RECEIPT,
        source: "WP08",
        surface: target,
        payload: receiptPayload
      });
      updateBrowserActionLedger(context, action.actionId, {
        status: result.ok ? "DISPATCHED" : "FAILED",
        receiptDigest: receiptPersisted.item.digest,
        completedAt: nowIso(),
        error: result.ok ? "" : sanitizeText(result.error?.message || result.receipt?.error, 800)
      });
      addAudit(audit, {
        kind: result.ok ? "done" : "error",
        title: result.ok
          ? `WP08 browseråtgärd exekverad: ${action.operation}`
          : `WP08 browseråtgärd misslyckades: ${action.operation}`,
        detail: result.ok
          ? `${action.actionId} · exakt en action · ${result.receipt.effectReadback}`
          : `${action.actionId} · ${sanitizeText(result.error?.message || result.receipt?.error, 900)}`,
        windowId,
        tabId: target.tabId,
        runId: context.run?.runId || null
      });
    } catch (error) {
      updateBrowserActionLedger(context, action.actionId, {
        status: "FAILED_AFTER_BARRIER",
        completedAt: nowIso(),
        error: sanitizeText(error?.message || error, 800)
      });
      addAudit(audit, {
        kind: "error",
        title: `WP08 browseråtgärd avbruten: ${action.operation}`,
        detail: `${action.actionId} · ${sanitizeText(error?.message || error, 900)}`,
        windowId,
        tabId: target.tabId,
        runId: context.run?.runId || null
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      throw error;
    }

    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    if (!result.ok) throw result.error || new Error(result.receipt?.error || "BROWSER_ACTION_EXECUTION_FAILED");
    return snapshotForWindow(windowId);
  });
}


const BROWSER_LOOP_NAVIGATION_OPERATIONS = new Set(["navigate", "back", "forward", "reload"]);

function browserActionReceiptItem(store, actionId) {
  return store.items.find((item) =>
    item.type === EVIDENCE_TYPES.BROWSER_ACTION_RECEIPT &&
    item.payload?.actionId === String(actionId || "")
  ) || null;
}

function browserObservationItem(store, evidenceId) {
  if (!evidenceId) return null;
  return store.items.find((item) =>
    item.id === String(evidenceId) &&
    item.type === EVIDENCE_TYPES.BROWSER_OBSERVATION
  ) || null;
}

function screenshotItemFromReceipt(store, receiptPayload) {
  const ids = Array.isArray(receiptPayload?.captureRefs?.evidenceIds)
    ? receiptPayload.captureRefs.evidenceIds.map(String)
    : [];
  return store.items.find((item) =>
    ids.includes(item.id) && item.type === EVIDENCE_TYPES.SCREENSHOT
  ) || null;
}

async function prepareBrowserControllerStep(windowId) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const controller = chatGptControllerSurface(context);
    const { target } = requireEvidenceSession(context);
    await verifyEvidencePermission(target);
    if (!Number.isInteger(Number(controller?.tabId)) ||
        controller.lifecycleState !== "READY" ||
        !controller.surfaceId ||
        !controller.documentEpoch ||
        !isAllowedChatUrl(controller.url)) {
      throw new Error("BROWSER_LOOP_CHATGPT_CONTROLLER_NOT_READY");
    }
    if (Number(controller.tabId) === Number(target.tabId)) {
      throw new Error("BROWSER_LOOP_SURFACE_ROLE_COLLISION");
    }

    const page = await readPage(Number(controller.tabId), "wp10-controller-step");
    const readiness = controllerResponseReady(page, context.browserLoop, controller);
    if (!readiness.ready) throw new Error(`BROWSER_LOOP_RESPONSE_NOT_READY:${readiness.reason}`);

    const parsed = parseBrowserActionResponse(readiness.responseText);
    if (parsed.kind !== "ACTION") {
      throw new Error("BROWSER_LOOP_EXACTLY_ONE_ACTION_REQUIRED");
    }
    const store = await loadWindowEvidenceStore(chrome, windowId);
    const observation = browserActionObservationFromStore(store, parsed.action);
    const consumedActionIds = context.browserActionLedger.map((entry) => entry.actionId);
    const consumedTurnIds = context.browserActionLedger.map((entry) => entry.turnId);
    const { action } = await validateBrowserAction(parsed.action, {
      surface: target,
      observation,
      consumedActionIds,
      consumedTurnIds
    });
    const riskDecision = await classifyBrowserActionRisk({ action, observation });
    let approvalId = "";

    if (riskDecision.approvalRequired) {
      const currentApproval = normalizeBrowserApproval(context.browserApproval);
      if (await approvalMatchesAction(currentApproval, {
        action,
        responseHash: readiness.responseHash
      })) {
        const consumed = await consumeBrowserApproval(currentApproval, {
          action,
          responseHash: readiness.responseHash
        });
        approvalId = consumed.approvalId;
        context.browserApproval = consumed;
      } else {
        const samePending = currentApproval?.status === BROWSER_APPROVAL_STATES.PENDING &&
          currentApproval.actionId === action.actionId &&
          currentApproval.responseHash === readiness.responseHash &&
          currentApproval.actionDigest === riskDecision.actionDigest;
        if (!samePending) {
          context.browserApproval = await createPendingBrowserApproval({
            action,
            responseHash: readiness.responseHash,
            decision: riskDecision
          });
        }
        context.browserLoop = {
          ...normalizeBrowserLoopState(context.browserLoop, { windowId }),
          state: BROWSER_LOOP_STATES.PAUSED,
          lastReason: `APPROVAL_REQUIRED:${riskDecision.level}`,
          updatedAt: nowIso()
        };
        context.updatedAt = nowIso();
        addAudit(audit, {
          kind: "warning",
          title: `WP10 approval krävs: ${riskDecision.level}`,
          detail: `${action.operation} · ${riskDecision.reasonCodes.join(", ") || "POLICY_FLOOR"}`,
          windowId,
          tabId: target.tabId,
          runId: context.run?.runId || null
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await notifyPanels(windowId);
        return {
          blocked: true,
          reason: "BROWSER_ACTION_APPROVAL_REQUIRED",
          responseHash: readiness.responseHash,
          action,
          riskDecision,
          approval: deepClone(context.browserApproval)
        };
      }
    }

    const { loop, step } = beginBrowserLoopStep(context.browserLoop, {
      controllerSurface: controller,
      controllerResponseHash: readiness.responseHash,
      action,
      riskDecision,
      approvalId
    });
    context.browserLoop = loop;
    context.updatedAt = nowIso();

    addAudit(audit, {
      kind: "info",
      title: `WP10 controllersteg accepterat: ${step.operation}`,
      detail: `${step.stepId} · risk ${riskDecision.level}` +
        `${approvalId ? ` · approval ${approvalId}` : ""}`,
      windowId,
      tabId: controller.tabId,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    return {
      blocked: false,
      stepId: step.stepId,
      responseText: readiness.responseText,
      responseHash: readiness.responseHash,
      action,
      riskDecision,
      approvalId,
      controller: deepClone(controller),
      target: deepClone(target)
    };
  });
}

async function markBrowserControllerStepFailed(windowId, stepId, error) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    if (context.browserLoop?.steps?.[stepId]) {
      context.browserLoop = completeBrowserLoopStep(context.browserLoop, stepId, {
        status: "FAILED",
        promptAcknowledged: false,
        error: sanitizeText(error?.message || error, 800)
      });
      context.updatedAt = nowIso();
      addAudit(audit, {
        kind: "error",
        title: "WP09 browserloop stoppad fail-closed",
        detail: `${stepId} · ${sanitizeText(error?.message || error, 900)}`,
        windowId,
        tabId: chatGptControllerSurface(context)?.tabId || null,
        runId: context.run?.runId || null
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
    }
    return snapshotForWindow(windowId);
  });
}

async function persistBrowserLoopObservation(windowId, context, target, session, actionReceiptItem) {
  const observation = await capturePostActionObservation(chrome, {
    session,
    surface: target,
    evidenceRefs: [actionReceiptItem.id]
  });
  const persisted = await persistEvidenceItem(chrome, {
    windowId,
    type: EVIDENCE_TYPES.BROWSER_OBSERVATION,
    source: "WP09.POST_ACTION_OBSERVATION",
    surface: target,
    payload: observation
  });
  return { observation, item: persisted.item };
}

async function attachBrowserLoopScreenshot({
  windowId,
  context,
  controller,
  target,
  store,
  actionReceiptItem,
  stepId
}) {
  const screenshotItem = screenshotItemFromReceipt(store, actionReceiptItem.payload);
  if (!screenshotItem) throw new Error("BROWSER_LOOP_SCREENSHOT_EVIDENCE_NOT_FOUND");
  const body = await readScreenshotEvidenceBody(chrome, screenshotItem);
  const fileName = `eic-browser-${String(stepId).replace(/[^A-Za-z0-9._-]/g, "_")}.png`;
  const response = await chrome.tabs.sendMessage(Number(controller.tabId), {
    type: "EIC_ATTACH_IMAGE",
    fileName,
    mimeType: "image/png",
    base64: body.base64,
    bodyBytes: body.bodyBytes,
    bodyDigest: body.bodyDigest,
    expectedDocumentEpoch: controller.documentEpoch
  });
  if (!response?.ok || response.attached !== true || !response.readbackMethod) {
    throw new Error(response?.error || "BROWSER_LOOP_ATTACHMENT_READBACK_FAILED");
  }
  const receipt = createAttachmentReceipt({
    screenshotEvidenceId: screenshotItem.id,
    fileName: response.fileName,
    mimeType: response.mimeType,
    bodyBytes: response.bodyBytes,
    bodyDigest: response.bodyDigest,
    controllerTabId: controller.tabId,
    controllerDocumentEpoch: response.documentEpoch,
    attached: response.attached,
    readbackMethod: response.readbackMethod
  });
  if (!verifyAttachmentReceipt(receipt, {
    screenshotEvidenceId: screenshotItem.id,
    bodyBytes: body.bodyBytes,
    bodyDigest: body.bodyDigest,
    controllerTabId: controller.tabId,
    controllerDocumentEpoch: controller.documentEpoch
  })) {
    throw new Error("BROWSER_LOOP_ATTACHMENT_RECEIPT_INVALID");
  }
  const receiptDigest = await attachmentReceiptDigest(receipt);
  const persisted = await persistEvidenceItem(chrome, {
    windowId,
    type: EVIDENCE_TYPES.BROWSER_ATTACHMENT_RECEIPT,
    source: "WP09.ChatGPTComposer",
    surface: controller,
    payload: {
      ...receipt,
      receiptDigest,
      targetSurfaceId: target.surfaceId,
      actionReceiptEvidenceId: actionReceiptItem.id
    }
  });
  return {
    receipt,
    receiptDigest,
    evidenceItem: persisted.item
  };
}

async function finalizeBrowserControllerStep(windowId, prepared) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const controller = chatGptControllerSurface(context);
    const target = webTargetSurface(context);
    if (!controller || !target) throw new Error("BROWSER_LOOP_SURFACES_REQUIRED");
    if (String(controller.surfaceId) !== String(prepared.controller.surfaceId) ||
        String(controller.documentEpoch) !== String(prepared.controller.documentEpoch) ||
        Number(controller.tabId) !== Number(prepared.controller.tabId)) {
      throw new Error("BROWSER_LOOP_CONTROLLER_IDENTITY_CHANGED");
    }
    const loopStep = context.browserLoop?.steps?.[prepared.stepId];
    if (!loopStep || loopStep.status !== "ACTION_PENDING") {
      throw new Error("BROWSER_LOOP_STEP_NOT_ACTION_PENDING");
    }

    let store = await loadWindowEvidenceStore(chrome, windowId);
    const actionReceiptItem = browserActionReceiptItem(store, prepared.action.actionId);
    if (!actionReceiptItem || actionReceiptItem.payload?.status !== "DISPATCHED") {
      throw new Error("BROWSER_LOOP_ACTION_RECEIPT_NOT_VERIFIED");
    }

    let observation = null;
    let observationItem = browserObservationItem(
      store,
      actionReceiptItem.payload?.observationEvidenceId
    );
    if (observationItem) {
      observation = observationItem.payload;
    } else if (!BROWSER_LOOP_NAVIGATION_OPERATIONS.has(prepared.action.operation)) {
      const { session } = requireEvidenceSession(context);
      await verifyEvidencePermission(target);
      const captured = await persistBrowserLoopObservation(
        windowId,
        context,
        target,
        session,
        actionReceiptItem
      );
      observation = captured.observation;
      observationItem = captured.item;
      store = await loadWindowEvidenceStore(chrome, windowId);
    }

    let attachment = null;
    if (prepared.action.operation === "capture") {
      attachment = await attachBrowserLoopScreenshot({
        windowId,
        context,
        controller,
        target,
        store,
        actionReceiptItem,
        stepId: prepared.stepId
      });
    }

    const built = await buildBrowserObservationPrompt({
      step: loopStep,
      actionReceipt: actionReceiptItem.payload,
      observation,
      attachmentReceipt: attachment?.receipt || null
    });
    context.browserLoop = updateBrowserLoopStep(context.browserLoop, prepared.stepId, {
      actionReceiptDigest: actionReceiptItem.digest,
      observationId: observation?.observationId || "",
      observationDigest: observation?.observationDigest || "",
      attachmentReceiptDigest: attachment?.receiptDigest || "",
      promptDigest: built.promptDigest,
      status: "PROMPT_PENDING_DISPATCH",
      loopState: BROWSER_LOOP_STATES.OBSERVATION_PENDING_DELIVERY,
      reason: "OBSERVATION_PROMPT_DURABLY_PREPARED"
    });
    context.updatedAt = nowIso();
    // This write is the prompt-dispatch barrier. A restart after submission leaves the
    // step pending and cannot reconsume the same controller response.
    await writeRuntimeBundle(runtime, continuity, audit);

    const promptResult = await chrome.tabs.sendMessage(Number(controller.tabId), {
      type: "EIC_SUBMIT_PROMPT",
      prompt: built.prompt,
      turnId: `browser-loop-${prepared.stepId}`,
      promptDigest: built.promptDigest,
      promptAckDigest: built.promptDigest,
      requireTurnMarker: true,
      expectedDocumentEpoch: controller.documentEpoch
    });
    if (!promptResult?.ok) {
      throw new Error(promptResult?.error || "BROWSER_LOOP_CONTROLLER_PROMPT_REJECTED");
    }

    context.browserLoop = completeBrowserLoopStep(context.browserLoop, prepared.stepId, {
      status: promptResult.acknowledged ? "DELIVERED_ACKNOWLEDGED" : "SUBMITTED_UNCONFIRMED",
      promptDigest: built.promptDigest,
      promptAcknowledged: promptResult.acknowledged === true
    });
    context.updatedAt = nowIso();
    addAudit(audit, {
      kind: promptResult.acknowledged ? "done" : "warning",
      title: promptResult.acknowledged
        ? "WP09 observation levererad med controller-readback"
        : "WP09 observation inskickad utan controller-ack",
      detail: `${prepared.stepId} · action ${prepared.action.actionId}` +
        `${attachment ? ` · bild ${attachment.receipt.readbackMethod}` : ""}`,
      windowId,
      tabId: controller.tabId,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function processBrowserControllerStep(windowId) {
  const prepared = await prepareBrowserControllerStep(windowId);
  if (prepared.blocked) return snapshotForWindow(windowId);
  try {
    await executeBrowserResponseAction(windowId, prepared.responseText, {
      policyApprovalId: prepared.approvalId,
      expectedActionId: prepared.action.actionId
    });
    return await finalizeBrowserControllerStep(windowId, prepared);
  } catch (error) {
    await markBrowserControllerStepFailed(windowId, prepared.stepId, error);
    throw error;
  }
}

async function saveConfig(patch) {
  await ensureInitialized();
  const current = (await chrome.storage.local.get(STORAGE_KEYS.CONFIG))[STORAGE_KEYS.CONFIG] || createDefaultConfig();
  let mandateRegistry = current.mandateRegistry;
  mandateRegistry = (await registerMandateVersion(mandateRegistry, {
    surface: "NANO",
    version: current.nanoMandateVersion || "nano-core-v7",
    text: current.nanoMandate || ""
  })).registry;
  mandateRegistry = (await registerMandateVersion(mandateRegistry, {
    surface: "TARGET",
    version: current.targetMandateVersion || "target-core-v6",
    text: current.targetMandate || ""
  })).registry;
  const allowed = [
    "nanoMandate", "nanoMandateProfile", "nanoMandateVersion",
    "targetMandate", "targetMandateProfile", "targetMandateVersion",
    "targetAuthorityScope", "activeTaskProjectId", "continuityViewProfile", "scenarioPreset",
    "quickProfileId", "quickProfileBinding", "profileRecommendation", "quickProfileCustomized", "sessionCapturePolicy", "sessionMemoryPolicy", "autoSessionCaptureEnabled", "fullAuditLoggingEnabled", "autoApplyCoreSurfaceReviewEnabled", "autoRestartNanoOnChange", "autostartPresetId", "autonomyBand", "evidenceBand", "outputDensity",
    "newSessionPrompt", "maxAutonomousMode", "backgroundWaitEnabled",
    "mjolnarEnabled", "mjolnarRolloutMode", "targetMode",
    "maxTurns", "responseTimeoutMs", "nanoWallTimeoutMs", "settleMs", "recoveryBudget", "uiDensity",
    "appAuditTestNeed", "appAuditContext", "appAuditTargetReadOnly",
    "appAuditAllowWorkbenchFiles", "appAuditAllowForgejoSink",
    "archaeologyScenario", "archaeologyQuestion", "archaeologyContext",
    "archaeologyAllowWorkspaceEvidence", "archaeologyAllowExport"
  ];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, key)) current[key] = patch[key];
  }
  const selectedProfile = getQuickProfile(
    current.quickProfileId || current.scenarioPreset || DEFAULT_QUICK_PROFILE_ID
  );
  if (!selectedProfile) throw new Error("QUICK_PROFILE_UNKNOWN");
  current.quickProfileId = selectedProfile.id;
  current.scenarioPreset = selectedProfile.id;
  current.sessionCapturePolicy = selectedProfile.dimensions.sessionCapture;
  current.sessionMemoryPolicy = selectedProfile.dimensions.sessionMemory;
  current.autonomyBand = selectedProfile.dimensions.autonomy;
  current.evidenceBand = selectedProfile.dimensions.evidence;
  current.outputDensity = selectedProfile.dimensions.outputDensity;
  current.profileRecommendation = {
    ...recommendQuickProfile(current.newSessionPrompt || ""),
    activeProfileId: selectedProfile.id,
    silentlyApplied: false
  };
  const activeTaskProjectId = Number(current.activeTaskProjectId);
  if (!Number.isInteger(activeTaskProjectId) || activeTaskProjectId <= 0) {
    throw new Error("ACTIVE_TASK_PROJECT_ID_INVALID: ange ett positivt Core project_id före ny körning.");
  }
  current.activeTaskProjectId = activeTaskProjectId;
  if (Number(current.nanoWallTimeoutMs || NANO_WALL_TIMEOUT_MS) !== NANO_WALL_TIMEOUT_MS) {
    throw new Error(`NANO_WALL_TIMEOUT_INVALID: aktuell runtime kräver exakt ${NANO_WALL_TIMEOUT_MS} ms.`);
  }
  mandateRegistry = (await registerMandateVersion(mandateRegistry, {
    surface: "NANO",
    version: current.nanoMandateVersion || "nano-core-v7",
    text: current.nanoMandate || ""
  })).registry;
  mandateRegistry = (await registerMandateVersion(mandateRegistry, {
    surface: "TARGET",
    version: current.targetMandateVersion || "target-core-v6",
    text: current.targetMandate || ""
  })).registry;
  current.mandateRegistry = mandateRegistry;
  current.nanoWallTimeoutMs = NANO_WALL_TIMEOUT_MS;
  current.schema = CONFIG_SCHEMA;
  current.version = CONFIG_VERSION;
  current.updatedAt = nowIso();
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: current });
    fullAuditLoggingEnabledCache = current.fullAuditLoggingEnabled === true;
  } catch (error) {
    storageCircuitOpen = true;
    throw new Error(`STORAGE_PERSISTENCE_FAILURE: ${String(error?.message || error)}`);
  }
  return current;
}

async function startWaiting(windowId, missionRequest, {
  deferredMissionStart = null
} = {}) {
  return enqueue(async () => {
    const { config, continuity: continuityValue, runtime, audit, applicationLog } = await loadBundle(windowId);
    let continuity = continuityValue;
    const context = getWindowContext(runtime, windowId);
    const tabId = context.selectedTabId;
    if (!Number.isInteger(tabId) || !context.linkedTabs[String(tabId)]) {
      throw new Error("Koppla och välj en ChatGPT-flik först.");
    }
    if (context.run && ![STATES.PROGRAM_DONE, STATES.STOPPED, STATES.ERROR_TERMINAL].includes(context.run.state)) {
      throw new Error("Det finns redan en aktiv körning i detta Chrome-fönster.");
    }
    const priorRun = context.run ? deepClone(context.run) : null;

    const page = await readPage(tabId, "start-waiting-baseline");
    const suppliedBaseline = parseMainTaskBaseline(page.latestAssistant || "", {
      source: "TARGET_RESPONSE_ROUTING_CONTEXT",
      observedAt: nowIso()
    });
    if (suppliedBaseline.valid) adoptMainTaskBaseline(continuity, suppliedBaseline.baseline);
    const triggerPolicy = waitingBaselinePolicy(page);
    const baselineResponseIdentity = [
      page.conversationKey || "",
      page.taskFingerprint || "",
      page.latestAssistantHash || ""
    ].join("|");
    const stickyMode = missionRequest
      ? {
          blocked: false,
          mode: missionRequest.mode.runMode,
          preserve: false
        }
      : resolveStickyRunMode(priorRun, {
          tabId,
          conversationKey: page.conversationKey
        });
    if (stickyMode.blocked) {
      throw new Error(
        `${stickyMode.reason}: Ett tidigare specialläge får inte flyttas till en annan flik eller konversation via generisk Start/Continue.`
      );
    }
    let run = createRun({
      windowId,
      targetTabId: tabId,
      conversationKey: page.conversationKey,
      baselineAssistantHash: page.latestAssistantHash || "",
      baselineAssistantComplete: Boolean(page.latestAssistantComplete),
      baselineAssistantCount: Number(page.assistantCount || 0),
      baselineResponseIdentity,
      mode: stickyMode.mode,
      maxAutonomousMode: config.maxAutonomousMode
    });
    if (stickyMode.preserve) {
      run = cloneSpecializedRunState(run, priorRun);
    }
    run.waitingTriggerPolicy = {
      mode: "LATEST_COMPLETED_ASSISTANT",
      latestMessageRoleAtStart: triggerPolicy.latestMessageRole,
      armCurrentAssistant: triggerPolicy.armCurrentAssistant,
      protocolVariablesRequired: false
    };
    if (triggerPolicy.armCurrentAssistant) {
      // WAITING consumes the current assistant turn exactly once, even if it was
      // already complete when the operator activated the mode. Trailer variables
      // are optional; repeated hash stability is the completion owner.
      run.lastProcessedAssistantHash = "";
      run.lastProcessedAssistantComplete = false;
      run.lastProcessedAssistantCount = 0;
      run.lastProcessedResponseIdentity = "";
    }
    const initialClassification = classifyChatGptPage(page);
    if (config.backgroundWaitEnabled && initialClassification.state === CHATGPT_RESPONSE_STATES.WAITING_BACKGROUND) {
      const tab = await chrome.tabs.get(tabId);
      run = enterBackgroundWait(run, page, tab, {
        reason: "Start/Continue observerade verifierat ChatGPT-bakgrundsarbete. Ingen prompt skickades och ingen TTL gäller."
      });
    } else if (initialClassification.state === CHATGPT_RESPONSE_STATES.GENERATING_FOREGROUND) {
      run = transitionRun(run, STATES.WAITING_FOREGROUND, {
        reason: "Start/Continue observerade pågående foreground-generation. Sessionsflödet lämnas orört."
      });
      run.responseDeadlineAt = Date.now() + Number(config.responseTimeoutMs || 7_200_000);
    } else {
      run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
        reason: "Start/Continue aktiverades i vänteläge. Befintlig generation och sessionsflöde lämnas orörda."
      });
      run.responseDeadlineAt = Date.now() + Number(config.responseTimeoutMs || 7_200_000);
    }
    const initState = initialClassification.state === CHATGPT_RESPONSE_STATES.GENERATING_FOREGROUND ||
      initialClassification.state === CHATGPT_RESPONSE_STATES.WAITING_BACKGROUND ||
      latestMessageIsUser(page)
      ? SESSION_CONTEXT_INIT_STATE.WAITING_CHAT_READY
      : SESSION_CONTEXT_INIT_STATE.CATCH_ARMED;
    run.sessionContextInit = createSessionContextInit({
      state: initState,
      runId: run.runId,
      conversationKey: page.conversationKey || "",
      deferredMissionStart,
      now: Date.now()
    });
    run.taskFingerprint = page.taskFingerprint || "";
    run.activeTaskBinding = await createRunTaskBinding(run, config, {
      sourceTurnId: `run-start:${run.runId}`
    });
    run.lastVerifiedSnapshotHash = page.snapshotHash || page.latestAssistantHash || "";
    const locatorPromotion = promoteContinuityConversation(continuity, {
      from: continuity.position?.conversationKey || priorRun?.conversationKey || "",
      to: page.conversationKey || "",
      taskFingerprint: page.taskFingerprint || ""
    });
    continuity = bindContinuityScope(locatorPromotion.continuity, {
      windowId,
      runId: run.runId,
      conversationKey: page.conversationKey || ""
    });
    continuity.activeTaskBinding = run.activeTaskBinding;
    const continuityProjection = projectContinuity(continuity);
    run.takeoverBootstrapRequired = !continuityIsGrounded(continuityProjection) ||
      sanitizeText(continuityProjection.position?.conversationKey, 1200) !== sanitizeText(page.conversationKey, 1200);
    if (!missionRequest) {
      missionRequest = normalizeMissionStartRequest({
        modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
        input: {},
        sourceCommand: "START_WAITING"
      });
    }
    const activation = activateMissionForRun(runtime, context, run, {
      modeId: missionRequest.modeId,
      input: missionRequest.missionInput,
      selectedTabId: tabId
    });
    run = activation.run;
    run = await bindRunQuickProfile(run, config);
    context.run = run;
    context.updatedAt = nowIso();
    addAudit(audit, {
      kind: "done",
      title: stickyMode.preserve
        ? `${stickyMode.mode} återupptagen via Start/Continue`
        : "Start/Continue i vänteläge",
      detail: initialClassification.state === CHATGPT_RESPONSE_STATES.WAITING_BACKGROUND
        ? "Ingen prompt skickades. Verifierat bakgrundsarbete väntas utan applikations-TTL."
        : triggerPolicy.armCurrentAssistant
          ? "Senaste turen är ett assistantsvar och är armerad för dynamisk stabilitetskontroll. EIC-trailer krävs inte."
          : latestMessageIsUser(page)
            ? "Senaste turen är en användarprompt. WAITING fortsätter tills ett stabilt assistantsvar observeras."
            : "Ingen prompt skickades. WAITING fortsätter tills ett stabilt assistantsvar observeras.",
      windowId,
      tabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(
      tabId,
      "INITIALIZING",
      run.sessionContextInit.state === SESSION_CONTEXT_INIT_STATE.WAITING_CHAT_READY
        ? "Väntar på initiering av sessionskontext (catch)"
        : "Sessions-catch är armerad",
      sessionContextInitOverlay(run.sessionContextInit)
    );
    await notifyPanels(windowId);
    setTimeout(() => tickWindow(windowId, "waiting-start-dynamic-evaluation").catch(console.warn), 0);
    return snapshotForWindow(windowId);
  });
}

function startReceiptIdentity(page, tabId) {
  return sessionIdentityFromPage(page, tabId).value;
}

/**
 * v0.7.5 reuses the multi-probe readiness gate for an operator-prepared ChatGPT
 * session. A SPA may report a composer while it is still hydrating, so the one-shot start prompt
 * must not be delivered before the selected session has finished initialising. The gate
 * requires several consecutive good probes with an unchanged document epoch, URL
 * and conversation locator, plus a verified content-bridge version.
 */
async function waitForPreparedChatTabReady(tabId, {
  timeoutMs = PREPARED_SESSION_READY_TIMEOUT_MS,
  requiredStableProbes = READINESS_DEFAULTS.requiredStableProbes,
  probeIntervalMs = READINESS_DEFAULTS.probeIntervalMs,
  requireEmptyConversation = true,
  allowBusy = false
} = {}) {
  const started = Date.now();
  let lastError = null;
  let stability = null;
  let probes = 0;
  while (Date.now() - started < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete" && isAllowedChatUrl(tab.url || "")) {
        const page = await readPage(tabId, "prepared-session-tab-ready");
        probes += 1;
        stability = advanceReadinessStability(stability, page, {
          requiredStableProbes,
          requireEmptyConversation,
          expectedContentVersion: CONTENT_SCRIPT_VERSION,
          allowBusy
        });
        if (stability.settled) {
          return {
            tab,
            page,
            readiness: {
              probes,
              stableProbes: stability.stableProbes,
              requiredStableProbes: stability.required,
              identity: stability.identity,
              settledAfterMs: Date.now() - started,
              targetBusy: Boolean(page.generating || page.backgroundSignals?.active)
            }
          };
        }
      }
    } catch (error) {
      lastError = error;
      stability = null;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(120, probeIntervalMs)));
  }
  const reasons = (stability?.lastReasons || []).join(", ");
  throw new Error(
    `Den förberedda ChatGPT-sessionen blev inte verifierat redo inom ${Math.round(timeoutMs / 1000)} sekunder` +
    `${reasons ? ` (${reasons})` : ""}.${lastError ? ` ${lastError.message || lastError}` : ""}`
  );
}

async function preparePreparedSessionRunUnlocked(windowId, {
  startPrompt,
  startPromptFactory = null,
  analysis,
  runMode = RUN_MODES.NEW_SESSION,
  initializeRun = null,
  missionRequest = null
}) {
  const { config, runtime, audit } = await loadBundle(windowId);
  const context = getWindowContext(runtime, windowId);
  if (context.run && ![STATES.PROGRAM_DONE, STATES.STOPPED, STATES.ERROR_TERMINAL].includes(context.run.state)) {
    throw new Error("Det finns redan en aktiv körning i detta Chrome-fönster.");
  }

  const tabId = context.selectedTabId;
  if (!Number.isInteger(tabId) || !context.linkedTabs[String(tabId)]) {
    throw new Error("Koppla och välj den förberedda ChatGPT-sessionens flik först.");
  }
  // v0.7.5: Nano never creates or navigates to a new ChatGPT tab. The operator prepares
  // the target session in Chrome, links it, and explicitly selects it before either start
  // action may deliver a prompt.
  const settled = await waitForPreparedChatTabReady(tabId, {
    timeoutMs: 20_000,
    requireEmptyConversation: false,
    // The selected session may already be producing the operator's last answer.
    // Prove only the stable composer/bridge identity here, then queue the one-shot
    // effect and let executePreparedEffectUnlocked wait without interrupting it.
    allowBusy: true
  });
  const page = settled.page;
  const readiness = settled.readiness;
  await setTabIndicator(
    tabId,
    readiness?.targetBusy ? "WAITING" : "ACTIVE_TARGET",
    readiness?.targetBusy
      ? "Förberedd sessionsflik verifierad; pågående arbete lämnas orört"
      : "Förberedd sessionsflik för engångsstart"
  );
  const identity = startReceiptIdentity(page, tabId);
  if (hasDeliveredStartPrompt(context.startPromptReceipts, page, tabId)) {
    throw new Error("Engångsstartprompten har redan förberetts eller levererats i denna session.");
  }

  let run = createRun({
    windowId,
    targetTabId: tabId,
    conversationKey: page.conversationKey,
    baselineAssistantHash: page.latestAssistantHash || "",
    baselineAssistantComplete: Boolean(page.latestAssistantComplete),
    baselineAssistantCount: Number(page.assistantCount || 0),
    baselineResponseIdentity: [
      page.conversationKey || "",
      page.taskFingerprint || "",
      page.latestAssistantHash || ""
    ].join("|"),
    mode: runMode,
    maxAutonomousMode: config.maxAutonomousMode
  });
  if (typeof initializeRun === "function") {
    run = initializeRun(run, { audit, config, context }) || run;
  }
  run.taskFingerprint = page.taskFingerprint || "";
  const turnId = randomId("turn-start");
  run.activeTaskBinding = await createRunTaskBinding(run, config, {
    sourceTurnId: turnId
  });
  const resolvedStartPrompt = typeof startPromptFactory === "function"
    ? startPromptFactory({ runId: run.runId, turnId })
    : startPrompt;
  const startRecord = await buildStartPromptRecord(resolvedStartPrompt, analysis);
  const promptText = startRecord.text;
  let continuity = seedContinuityFromStartAnalysis(createContinuity({
    scopeWindowId: windowId,
    scopeRunId: run.runId
  }), startRecord.analysis, {
    conversationKey: page.conversationKey || "",
    taskFingerprint: page.taskFingerprint || ""
  });
  continuity = bindContinuityScope(continuity, {
    windowId,
    runId: run.runId,
    conversationKey: page.conversationKey || ""
  });
  continuity.activeTaskBinding = run.activeTaskBinding;
  run.takeoverBootstrapRequired = false;
  // Durable session-initialisation gate. Autonomous dispatch stays suspended until
  // the start prompt is acknowledged AND the session has produced its first complete
  // response, so nothing can act on a half-initialised ChatGPT/EIC session.
  run.sessionInitGate = createSessionInitGate({
    mode: run.mode,
    detail: "Väntar på verifierad beredskap i den av operatören förberedda sessionen före engångsleverans."
  });
  run.sessionInitGate = advanceSessionInitGate(run.sessionInitGate, {
    tabReady: true,
    composerSettled: Boolean(readiness?.stableProbes >= (readiness?.requiredStableProbes || 1)),
    detail: readiness
      ? `Förberedd sessionsyta stabil efter ${readiness.stableProbes}/${readiness.requiredStableProbes} probes på ${readiness.settledAfterMs} ms.`
      : "Förberedd sessionsyta verifierad utan stabilitetsdata."
  });
  run.sessionInitReadiness = readiness || null;
  run = transitionRun(run, STATES.CONTINUING, {
    reason: readiness?.targetBusy
      ? "Nano analyserade startprompten och köade exakt engångsleverans efter pågående målaktivitet."
      : "Nano analyserade startprompten, den förberedda sessionen verifierades och durable continuity seedades före exakt engångsleverans."
  });

  const promptAckDigest = await sha256Hex(promptText.trim());
  const actionKey = await sha256Hex(stableStringify({
    taskIntent: startRecord.analysis.taskIntent,
    firstWorkUnit: startRecord.analysis.firstWorkUnit,
    promptDigest: startRecord.digest
  }));
  const effect = {
    effectId: randomId("effect"),
    turnId,
    promptDigest: startRecord.digest,
    promptAckDigest,
    prompt: promptText,
    actionKey,
    ackMode: "PROMPT_DIGEST",
    requireTurnMarker: false,
    sourceObservationHash: "",
    status: "PREPARED",
    attempts: 0,
    preparedAt: nowIso(),
    submittedAt: null,
    confirmedAt: null,
    lastError: ""
  };
  run.currentTurn = {
    turnId,
    priorTurnId: null,
    effectState: "PREPARED",
    promptDigest: startRecord.digest,
    actionKey,
    kind: "RAW_PREPARED_SESSION_START",
    responseContract: startRecord.contract.responseContract,
    responseExpectedTurnId: startRecord.contract.expectedTurnId || ""
  };
  run.effectJournal = [effect];
  run.startPromptReceipt = {
    receiptId: randomId("start-receipt"),
    turnId,
    sessionIdentity: identity,
    initialConversationKey: page.conversationKey || "",
    postConversationKey: "",
    startPromptDigest: startRecord.digest,
    startPromptLength: startRecord.length,
    promptAckDigest,
    protocolDetected: startRecord.contract.protocolDetected,
    responseContract: startRecord.contract.responseContract,
    analysisDigest: startRecord.analysis.promptDigest,
    analysisChunksRead: startRecord.analysis.chunksRead,
    analysisSummary: startRecord.analysis.summary,
    baselineAssistantHash: page.latestAssistantHash || "",
    baselineResponseIdentity: assistantResponseIdentity(page),
    status: "PREPARED",
    preparedAt: nowIso(),
    submittedAt: null,
    confirmedAt: null
  };
  context.startPromptReceipts = [...context.startPromptReceipts, deepClone(run.startPromptReceipt)].slice(-40);
  if (!missionRequest) {
    const fallbackModeId = runMode === RUN_MODES.APP_AUDIT_LONG
      ? MISSION_MODE_IDS.APP_AUDIT_LONG
      : runMode === RUN_MODES.ARCHAEOLOGY_LONG
        ? MISSION_MODE_IDS.ARCHAEOLOGY_LONG
        : MISSION_MODE_IDS.CHATGPT_NEW_SESSION;
    missionRequest = normalizeMissionStartRequest({
      modeId: fallbackModeId,
      input: fallbackModeId === MISSION_MODE_IDS.CHATGPT_NEW_SESSION
        ? { startPrompt: promptText, analysis: startRecord.analysis }
        : fallbackModeId === MISSION_MODE_IDS.APP_AUDIT_LONG
          ? {
              testNeed: run.auditTestNeed,
              context: run.auditContext,
              ...(run.auditOptions || {})
            }
          : {
              scenario: run.archaeologyScenario,
              question: run.archaeologyQuestion,
              context: run.archaeologyContext,
              ...(run.archaeologyOptions || {})
            },
      sourceCommand: "PREPARED_START"
    });
  }
  const activation = activateMissionForRun(runtime, context, run, {
    modeId: missionRequest.modeId,
    input: missionRequest.missionInput,
    selectedTabId: tabId
  });
  run = activation.run;
  run = await bindRunQuickProfile(run, config);
  context.run = run;
  addAudit(audit, {
    kind: "info",
    title: "Start i förberedd session förberedd",
    detail: `Exakt operatorprompt · ${startRecord.length} tecken · kontrakt ${startRecord.contract.responseContract} · continuity seedad.`,
    windowId,
    tabId,
    runId: run.runId
  });
  await writeRuntimeBundle(runtime, continuity, audit);
  await notifyPanels(windowId);
  return executePreparedEffectUnlocked(windowId);
}

async function updateEffectState(windowId, updater) {
  const { continuity, runtime, audit } = await loadBundle(windowId);
  const context = getWindowContext(runtime, windowId);
  const run = context.run;
  if (!run?.currentTurn) return null;
  const effect = run.effectJournal.find((entry) => entry.turnId === run.currentTurn.turnId);
  if (!effect) return null;
  await updater({ context, run, effect, continuity, runtime, audit });
  await writeRuntimeBundle(runtime, continuity, audit);
  await notifyPanels(windowId);
  return { context, run, effect };
}

async function executePreparedEffectUnlocked(windowId) {
    if (storageCircuitOpen) throw new Error("STORAGE_PERSISTENCE_FAILURE: promptleverans är spärrad tills storage kan skrivas.");
    const { config, continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    let run = context.run;
    if (!run?.currentTurn) return snapshotForWindow(windowId);
    const effect = run.effectJournal.find((entry) => entry.turnId === run.currentTurn.turnId);
    if (!effect || !["PREPARED", "RETRY_PREPARED"].includes(effect.status)) {
      return snapshotForWindow(windowId);
    }

    // Universal session-context gate: no ordinary mission prompt may reach ChatGPT
    // until catch, baseline and Nano analysis have completed. The one deterministic
    // baseline request is the only permitted prompt while this gate holds.
    if (sessionContextInitBlocksWork(run.sessionContextInit) &&
        run.currentTurn?.kind !== "SESSION_CONTEXT_BASELINE_REQUEST") {
      addAudit(audit, {
        kind: "info",
        title: "Promptleverans pausad — sessionskontext initieras",
        detail: `Init ${run.sessionContextInit?.state || "MISSING"} · all annan agentbearbetning väntar.`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(
        run.targetTabId,
        "INITIALIZING",
        "Väntar på slutförd sessionskontext",
        sessionContextInitOverlay(run.sessionContextInit)
      );
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    // Prepared-session gate remains independent. While it holds, only the one-shot
    // start delivery may pass.
    if (sessionInitBlocksDispatch(run.sessionInitGate) &&
        run.currentTurn?.kind !== "RAW_PREPARED_SESSION_START") {
      addAudit(audit, {
        kind: "info",
        title: "Promptleverans pausad — den förberedda sessionen verifieras",
        detail: `Gate ${run.sessionInitGate.state}${run.sessionInitGate.detail ? ` · ${run.sessionInitGate.detail}` : ""}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(run.targetTabId, "WAITING", "Väntar på verifierad förberedd session");
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    const tabId = run.targetTabId;
    let page;
    try {
      page = await readPage(tabId, "effect-precondition");
    } catch (error) {
      run = transitionRun(run, STATES.ERROR_RETRYABLE, {
        origin: PAUSE_ORIGINS.TRANSIENT_TRANSPORT,
        reason: error instanceof Error ? error.message : String(error)
      });
      run = transitionRun(run, STATES.RECOVERING, {
        origin: PAUSE_ORIGINS.TRANSIENT_TRANSPORT,
        reason: "Content bridge återställs vid nästa watchdog."
      });
      context.run = run;
      effect.lastError = sanitizeText(error instanceof Error ? error.message : String(error), 1000);
      addAudit(audit, {
        kind: "warning",
        title: "Promptleverans väntar på transportåterhämtning",
        detail: effect.lastError,
        windowId,
        tabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    const linkedRecord = context.linkedTabs[String(tabId)];
    page.userTurnIds = mergeSeenUserTurnIds(
      linkedRecord?.userTurnIds,
      page.userTurnIds
    );
    page.userMessageHashes = mergeSeenUserMessageHashes(
      linkedRecord?.userMessageHashes,
      page.userMessageHashes
    );
    if (linkedRecord) {
      linkedRecord.userTurnIds = page.userTurnIds;
      linkedRecord.userMessageHashes = page.userMessageHashes;
    }

    if (effect.sourceObservationHash && (
      page.generating ||
      String(page.latestAssistantHash || "") !== String(effect.sourceObservationHash) ||
      (effect.sourceObservationEpoch && String(page.documentEpoch || "") !== String(effect.sourceObservationEpoch))
    )) {
      effect.status = "CANCELLED_SUPERSEDED";
      delete effect.prompt;
      const priorTurnId = run.currentTurn?.priorTurnId || null;
      const priorResponseContract = run.currentTurn?.priorResponseContract || START_RESPONSE_CONTRACTS.TURN_BOUND_5;
      run.currentTurn = priorTurnId ? {
        turnId: priorTurnId,
        priorTurnId: null,
        effectState: "ACKED",
        kind: "RESTORED_AFTER_SUPERSEDE",
        responseContract: priorResponseContract,
        responseExpectedTurnId: run.currentTurn?.priorResponseExpectedTurnId || priorTurnId
      } : null;
      run.responseCandidate = null;
      run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
        origin: PAUSE_ORIGINS.OBSERVATION_SUPERSEDED,
        reason: "Target-svaret ändrades efter Nano-beslut men före promptsubmit. Den förberedda prompten kasserades.",
        force: true
      });
      context.run = run;
      addAudit(audit, {
        kind: "warning",
        title: "Förberedd prompt kasserad efter stale observation",
        detail: `${effect.sourceObservationHash} → ${page.latestAssistantHash || "(generating)"}`,
        windowId, tabId, runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      setTimeout(() => tickWindow(windowId, "observation-superseded-before-submit").catch(console.warn), 0);
      return snapshotForWindow(windowId);
    }

    const alreadyVisible = pageContainsEffect(page, effect);
    if (alreadyVisible) {
      effect.status = "ACKED";
      effect.confirmedAt = nowIso();
      run.currentTurn.effectState = "ACKED";
      recordAcknowledgedMandate(run, effect, page);
      run.responseDeadlineAt = Date.now() + Number(config.responseTimeoutMs || 7_200_000);
      run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
        reason: "Turn-ID finns redan i målkonversationen. Ingen dublett skickades."
      });
      if (effect.sessionContextBaseline === true ||
          run.currentTurn?.kind === "SESSION_CONTEXT_BASELINE_REQUEST") {
        run.sessionContextInit = advanceSessionContextInit(
          run.sessionContextInit,
          SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE,
          {},
          { now: Date.now(), force: true }
        );
      }
      if (run.startPromptReceipt) {
        run.startPromptReceipt.status = "ACKED";
        run.startPromptReceipt.confirmedAt = effect.confirmedAt;
        const receipt = context.startPromptReceipts.find((item) => item.receiptId === run.startPromptReceipt.receiptId);
        if (receipt) Object.assign(receipt, deepClone(run.startPromptReceipt));
      }
      context.run = run;
      addAudit(audit, {
        kind: "done",
        title: "Befintlig promptkvittens återanvänd",
        detail: `Turn ${effect.turnId}; submission hoppades över.`,
        windowId,
        tabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    if (page.generating || page.backgroundSignals?.active) {
      const backgroundActive = Boolean(page.backgroundSignals?.active);
      run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
        reason: backgroundActive
          ? "Målfliken arbetar i bakgrunden. Addonet köar prompten och lämnar arbetet orört."
          : "Målfliken genererar. Addonet köar prompten och stoppar eller avbryter inte pågående arbete."
      });
      run.recovery.nextRecoveryAt = new Date(Date.now() + 30_000).toISOString();
      context.run = run;
      addAudit(audit, {
        kind: "info",
        title: "Promptleverans köad",
        detail: backgroundActive
          ? "Pågående bakgrundsarbete lämnas orört."
          : "Pågående AI-svar lämnas orört.",
        windowId,
        tabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(
        tabId,
        backgroundActive ? "BACKGROUND" : "WAITING",
        backgroundActive ? "Bakgrundsarbete lämnas orört" : "Pågående svar lämnas orört"
      );
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    effect.status = "SUBMITTING";
    effect.attempts = Number(effect.attempts || 0) + 1;
    effect.lastAttemptAt = nowIso();
    run.currentTurn.effectState = "SUBMITTING";
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);

    let result;
    try {
      result = await chrome.tabs.sendMessage(tabId, {
        type: "EIC_SUBMIT_PROMPT",
        prompt: effect.prompt,
        turnId: effect.turnId,
        promptDigest: effect.promptDigest,
        promptAckDigest: effect.promptAckDigest || "",
        requireTurnMarker: effect.requireTurnMarker !== false,
        expectedDocumentEpoch: page.documentEpoch
      });
      if (!result?.ok) throw new Error(result?.error || "Content bridge avvisade prompten.");
    } catch (error) {
      effect.status = "RETRY_PREPARED";
      effect.lastError = sanitizeText(error instanceof Error ? error.message : String(error), 1000);
      run = transitionRun(run, STATES.ERROR_RETRYABLE, {
        origin: PAUSE_ORIGINS.TRANSIENT_TRANSPORT,
        reason: effect.lastError
      });
      run = transitionRun(run, STATES.RECOVERING, {
        origin: PAUSE_ORIGINS.TRANSIENT_TRANSPORT,
        reason: "Owner-observation sker före eventuell retry."
      });
      context.run = run;
      addAudit(audit, {
        kind: "warning",
        title: "Promptens effekt är okänd",
        detail: "Ingen blind retry görs. Mål-DOM läses först.",
        windowId,
        tabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    effect.status = result.acknowledged ? "ACKED" : "SUBMITTED_UNCONFIRMED";
    effect.submittedAt = nowIso();
    effect.confirmedAt = result.acknowledged ? nowIso() : null;
    run.currentTurn.effectState = effect.status;
    run.currentTurn.submittedAt = effect.submittedAt;
    if (result.acknowledged) recordAcknowledgedMandate(run, effect, page);
    run.responseDeadlineAt = Date.now() + Number(config.responseTimeoutMs || 7_200_000);
    run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
      reason: result.acknowledged
        ? "Prompten syns som nytt användarmeddelande i målkonversationen."
        : "Promptklick utfört; konversationskvittens inväntas."
    });
    if (effect.sessionContextBaseline === true ||
        run.currentTurn?.kind === "SESSION_CONTEXT_BASELINE_REQUEST") {
      run.sessionContextInit = advanceSessionContextInit(
        run.sessionContextInit,
        SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE,
        {},
        { now: Date.now(), force: true }
      );
    }
    if (run.startPromptReceipt) {
      run.startPromptReceipt.status = effect.status;
      run.startPromptReceipt.submittedAt = effect.submittedAt;
      if (result.acknowledged) run.startPromptReceipt.confirmedAt = effect.confirmedAt;
      const receipt = context.startPromptReceipts.find((item) => item.receiptId === run.startPromptReceipt.receiptId);
      if (receipt) Object.assign(receipt, deepClone(run.startPromptReceipt));
    }
    run.promptHistory = [...(run.promptHistory || []), {
      turnId: effect.turnId,
      promptDigest: effect.promptDigest,
      actionKey: effect.actionKey,
      at: effect.submittedAt
    }].slice(-8);
    context.run = run;
    addAudit(audit, {
      kind: result.acknowledged ? "done" : "warning",
      title: result.acknowledged ? "Prompt levererad och kvitterad" : "Prompt levererad — kvittens väntar",
      detail: `Turn ${effect.turnId} · försök ${effect.attempts}`,
      windowId,
      tabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(
      tabId,
      sessionContextInitBlocksWork(run.sessionContextInit) ? "INITIALIZING" : "WAITING",
      run.sessionContextInit?.state === SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE
        ? "Väntar på huvuduppgiftsbaslinje"
        : "Väntar på AI-svar",
      sessionContextInitBlocksWork(run.sessionContextInit)
        ? sessionContextInitOverlay(run.sessionContextInit)
        : null
    );
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
}

function recordAcknowledgedMandate(run, effect, page = null) {
  if (!run || !effect || effect.status !== "ACKED" || !effect.mandateVersion || !effect.mandateSha256) return;
  run.lastAcknowledgedMandateReceipt = {
    schema: "eic.autonom.mandate-delivery-receipt.v1",
    effectId: effect.effectId,
    turnId: effect.turnId,
    mandateVersion: effect.mandateVersion,
    mandateSha256: effect.mandateSha256,
    conversationKey: sanitizeText(page?.conversationKey || run.conversationKey, 1000),
    taskFingerprint: sanitizeText(run.taskFingerprint, 500),
    confirmedAt: effect.confirmedAt || nowIso()
  };
}

function executePreparedEffect(windowId) {
  return enqueue(() => executePreparedEffectUnlocked(windowId));
}

function latestEffect(run) {
  if (!run?.currentTurn) return null;
  return run.effectJournal?.find((entry) => entry.turnId === run.currentTurn.turnId) || null;
}

async function reconcileEffect(run, page, audit, context) {
  const effect = latestEffect(run);
  if (!effect) return { run, shouldExecute: false };

  const result = reconcileEffectRecord(effect, page, {
    now: Date.now(),
    graceMs: SUBMISSION_GRACE_MS,
    maxAttempts: MAX_SUBMISSION_ATTEMPTS,
    baselineAssistantCount: run.baselineAssistantCount,
    lastProcessedAssistantCount: run.lastProcessedAssistantCount,
    baselineResponseIdentity: run.baselineResponseIdentity,
    lastProcessedResponseIdentity: run.lastProcessedResponseIdentity
  });
  if (result.effect) Object.assign(effect, result.effect);

  if (["TURN_VISIBLE", "PROMPT_VISIBLE", "ASSISTANT_RESPONSE_VISIBLE"].includes(result.reason)) {
    run.currentTurn.effectState = "ACKED";
    recordAcknowledgedMandate(run, effect, page);
    if (run.startPromptReceipt) {
      run.startPromptReceipt.status = "ACKED";
      run.startPromptReceipt.confirmedAt = effect.confirmedAt;
      const receipt = context.startPromptReceipts.find((item) => item.receiptId === run.startPromptReceipt.receiptId);
      if (receipt) Object.assign(receipt, deepClone(run.startPromptReceipt));
    }
    if (result.changed) {
      addAudit(audit, {
        kind: "done",
        title: result.reason === "ASSISTANT_RESPONSE_VISIBLE"
          ? "Promptkvittens härledd från nytt assistantsvar"
          : "Promptkvittens återfunnen",
        detail: result.reason === "ASSISTANT_RESPONSE_VISIBLE"
          ? `Turn ${effect.turnId} kvitterades implicit eftersom ett nytt, stabilt assistantsvar observerades.`
          : `Turn ${effect.turnId} hittades i mål-DOM efter reconciliation.`,
        windowId: run.windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }
  } else if (result.reason === "BOUNDED_RETRY") {
    run.currentTurn.effectState = "RETRY_PREPARED";
    addAudit(audit, {
      kind: "warning",
      title: "Bounded promptretry förberedd",
      detail: "Mål-DOM saknar turn-ID, ingen generation pågår och effektens graceperiod har löpt ut.",
      windowId: run.windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
  } else if (result.shouldPause) {
    run.currentTurn.effectState = effect.status;
    run = transitionRun(run, STATES.SOFT_PAUSED, {
      origin: PAUSE_ORIGINS.TRANSIENT_TRANSPORT,
      reason: "Promptleverans kunde inte kvitteras efter bounded retry. Ingen ytterligare dublettrisk tas."
    });
  }

  return { run, shouldExecute: result.shouldExecute };
}

async function tickWindowUnlocked(windowId, reason = "watchdog") {
  const { config, continuity: continuityValue, runtime, audit } = await loadBundle(windowId);
  let continuity = continuityValue;
  const context = getWindowContext(runtime, windowId);
  let run = context.run;
  if (!run || [STATES.PROGRAM_DONE, STATES.STOPPED, STATES.ERROR_TERMINAL].includes(run.state)) {
    return snapshotForWindow(windowId);
  }
  if (runIsDetached(run)) {
    return snapshotForWindow(windowId);
  }
  if (run.state === STATES.AWAITING_OPERATOR_ACTION) {
    run.pendingNanoRequest = null;
    run.timeoutSuspended = true;
    run.responseDeadlineAt = null;
    context.run = run;
    return snapshotForWindow(windowId);
  }
  if ([STATES.PROGRAM_BLOCKED, STATES.AWAITING_OPERATOR_DECISION].includes(run.state)) {
    if (pauseRequiresHuman(run)) return snapshotForWindow(windowId);
    run = transitionRun(run, STATES.RECOVERING, {
      origin: run.pause?.origin || PAUSE_ORIGINS.NONE,
      reason: "v0.6.3 omklassificerade en icke-nivå-10-paus till autonom återhämtning.",
      force: true
    });
  }
  if (run.state === STATES.SOFT_PAUSED) {
    if ([PAUSE_ORIGINS.OPERATOR_PAUSE, PAUSE_ORIGINS.NO_PROGRESS_BUDGET_EXHAUSTED].includes(run.pause?.origin)) return snapshotForWindow(windowId);
    run = transitionRun(run, STATES.RECOVERING, {
      origin: run.pause?.origin || PAUSE_ORIGINS.NONE,
      reason: "v0.6.3 omklassificerade en automatisk mjuk paus till autonom återhämtning.",
      force: true
    });
  }

  const now = Date.now();
  const lastTick = run.lastTickAt ? Date.parse(run.lastTickAt) : now;
  const gap = now - lastTick;
  run.lastTickAt = nowIso(now);
  if (gap > 180_000) {
    const lifecycleExtension = resolveLifecycleDeadlineExtension({
      gapMs: gap,
      responseTimeoutMs: Number(config.responseTimeoutMs || 7_200_000),
      alreadyExtendedMs: Number(run.lifecycleExtensionMs || 0)
    });
    if (run.responseDeadlineAt && !run.timeoutSuspended && lifecycleExtension.appliedMs > 0) {
      run.responseDeadlineAt += lifecycleExtension.appliedMs;
      run.lifecycleExtensionMs = lifecycleExtension.totalExtensionMs;
    }
    appendRecoveryAttempt(run, makeRecoveryAttempt("LIFECYCLE_GAP", {
      outcome: run.timeoutSuspended
        ? "RECONCILE_AFTER_SUSPEND"
        : lifecycleExtension.appliedMs > 0
          ? "DEADLINE_EXTENDED_BOUNDED"
          : "DEADLINE_EXTENSION_CAP_REACHED",
      detail: run.timeoutSuspended
        ? `Observerat avbrott ${Math.round(gap / 1000)} s i TTL-fritt vänteläge. En enda reconciliation körs; ingen catch-up-turn skapas.`
        : `Observerat avbrott ${Math.round(gap / 1000)} s. Deadline förlängdes ${Math.round(lifecycleExtension.appliedMs / 1000)} s; totalt ${Math.round(lifecycleExtension.totalExtensionMs / 1000)}/${Math.round(lifecycleExtension.capMs / 1000)} s.`
    }));
  }

  let tab = null;
  try {
    tab = await chrome.tabs.get(run.targetTabId);
  } catch {
    // Handled below as a tab-owner absence. Errors after this read are not
    // misclassified as a closed tab.
  }

  if (!tab) {
    run = transitionRun(run, STATES.RECOVERING, {
      origin: PAUSE_ORIGINS.TAB_CLOSED,
      reason: "Målfliken saknas. Exakt samtalslocator söks bland kopplade flikar."
    });
    const replacement = Object.values(context.linkedTabs).filter((record) =>
      record.tabId !== run.targetTabId && record.conversationKey && record.conversationKey === run.conversationKey
    );
    if (replacement.length === 1) {
      run.targetTabId = replacement[0].tabId;
      run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
        origin: PAUSE_ORIGINS.TAB_CLOSED,
        reason: "Exakt kopplad ersättningsflik återfanns."
      });
    } else {
      run = transitionRun(run, STATES.SOFT_PAUSED, {
        origin: PAUSE_ORIGINS.TAB_CLOSED,
        reason: "Ingen entydig kopplad ersättningsflik finns."
      });
    }
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  if (!isAllowedChatUrl(tab.url || "")) {
    const authBoundary = isOpenAiAuthUrl(tab.url || "");
    run.destructiveness = classifyDestructiveness({
      proposedAction: authBoundary ? "AUTHENTICATE_USER" : "CONTINUE_ON_UNKNOWN_TARGET",
      exactTarget: tab.url || "UNKNOWN",
      pauseOrigin: authBoundary ? PAUSE_ORIGINS.AUTHENTICATION_OR_CAPTCHA : PAUSE_ORIGINS.TAB_NAVIGATED_AWAY,
      destructivenessLevel: 10,
      destructivenessRationale: authBoundary
        ? "Autentisering eller användarnärvaro kan inte delegeras."
        : "Målets identitet är okänd efter navigation."
    });
    run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
      origin: authBoundary ? PAUSE_ORIGINS.AUTHENTICATION_OR_CAPTCHA : PAUSE_ORIGINS.TAB_NAVIGATED_AWAY,
      reason: authBoundary
        ? "Målfliken omdirigerades till OpenAI-autentisering. Addonet väntar på operatören och injicerar inget där."
        : "Vald målflik navigerade bort från stödd ChatGPT-origin.",
      force: true
    });
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  if ((tab.discarded || tab.frozen) && run.state === STATES.WAITING_BACKGROUND) {
    run = preserveBackgroundForSuspendedTab(run, tab, {
      reason: tab.discarded ? "RECONCILE_ON_RESUME_DISCARDED" : "RECONCILE_ON_RESUME_FROZEN"
    });
    context.run = run;
    const suspendedRecord = context.linkedTabs[String(run.targetTabId)];
    if (suspendedRecord) {
      suspendedRecord.discarded = Boolean(tab.discarded);
      suspendedRecord.frozen = Boolean(tab.frozen);
      suspendedRecord.active = Boolean(tab.active);
      suspendedRecord.status = tab.discarded ? "DISCARDED_WAITING" : "FROZEN_WAITING";
    }
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  let page;
  try {
    page = await readPage(run.targetTabId, `tick:${reason}`);
  } catch (error) {
    run = transitionRun(run, STATES.ERROR_RETRYABLE, {
      origin: PAUSE_ORIGINS.TRANSIENT_TRANSPORT,
      reason: error instanceof Error ? error.message : String(error)
    });
    appendRecoveryAttempt(run, makeRecoveryAttempt("RECONNECT_CONTENT", {
      outcome: "PENDING",
      detail: error instanceof Error ? error.message : String(error)
    }));
    run = transitionRun(run, STATES.RECOVERING, {
      origin: PAUSE_ORIGINS.TRANSIENT_TRANSPORT,
      reason: "Content bridge återförs vid nästa event/watchdog."
    });
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  const interruptedNano = evaluateInterruptedNanoRecovery(run, { now });
  if (interruptedNano.allowed) {
    const analysisMode = classifyNanoAnalysisMode({
      run,
      continuityProjection: projectContinuity(continuity),
      observation: run.pendingObservation
    });
    run.nanoLifecycleRepairCount = Number(run.nanoLifecycleRepairCount || 0) + 1;
    run.nanoTelemetry ||= {};
    run.nanoTelemetry.lastStatus = "INTERRUPTED";
    run.nanoTelemetry.lastCompletedAt = nowIso(now);
    run.nanoTelemetry.lastDurationMs = interruptedNano.elapsedMs;
    run.nanoTelemetry.lastError =
      "Sidepanel-/service-workerlivscykeln lämnade en RUNNING-telemetripost utan ägd pending request.";
    run.nanoTelemetry.lastResultSummary = "INTERRUPTED_REQUEUED_ONCE";
    const recoveredRequest = buildPendingNanoRequest({
      observationId: run.pendingObservation.observationId,
      analysisMode,
      now
    });
    recoveredRequest.lifecycleRecovery = true;
    recoveredRequest.requeueCount = 1;
    if (run.pendingObservation.protocolReminderRequired ||
        run.pendingObservation.targetResult?.valid === false) {
      recoveredRequest.protocolRepairOnly = true;
      recoveredRequest.protocolReason =
        run.pendingObservation.targetResult?.reason || "PROTOCOL_INVALID";
      recoveredRequest.expectedTurnId = run.currentTurn?.turnId || "";
      run.pendingNanoRequest = markDeterministicPending(
        recoveredRequest,
        NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
      );
      run.nanoTelemetry.lastStatus = "DETERMINISTIC_PENDING";
      run.nanoTelemetry.lastSource = NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL;
    } else {
      run.pendingNanoRequest = recoveredRequest;
      run.nanoTelemetry.lastStatus = "PENDING";
      run.nanoTelemetry.lastSource = NANO_DECISION_SOURCE.NANO;
    }
    run = transitionRun(run, STATES.ASSESSING, {
      origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
      reason: "Förlorad lokal Nano-inferens återköades exakt en gång från bevarad observation.",
      force: true
    });
    context.run = run;
    addAudit(audit, {
      kind: "warning",
      title: "Avbruten Nano-inferens återköad",
      detail: `Observation ${run.pendingObservation.observationId} · elapsed ${interruptedNano.elapsedMs} ms · högst ett lifecycle-repairförsök.`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  const locatorChange = classifyConversationLocatorChange(run.conversationKey, page.conversationKey);
  if (["BIND", "PROMOTION"].includes(locatorChange.kind)) {
    const previousConversationKey = run.conversationKey;
    run.conversationKey = locatorChange.next;
    run.conversationPromotion = {
      from: previousConversationKey,
      to: locatorChange.next,
      at: nowIso(now)
    };
    const promotedContinuity = promoteContinuityConversation(continuity, {
      from: previousConversationKey || continuity.position?.conversationKey || "",
      to: locatorChange.next,
      taskFingerprint: page.taskFingerprint || ""
    });
    continuity = bindContinuityScope(promotedContinuity.continuity, {
      windowId,
      runId: run.runId,
      conversationKey: locatorChange.next
    });
    if (run.mode === RUN_MODES.WAITING_CONTINUE && !run.currentTurn) {
      const promotedProjection = projectContinuity(continuity);
      run.takeoverBootstrapRequired = !continuityIsGrounded(promotedProjection) ||
        sanitizeText(promotedProjection.position?.conversationKey, 1200) !== sanitizeText(locatorChange.next, 1200);
    }
    addAudit(audit, {
      kind: "done",
      title: "Konversationslocator promoverad",
      detail: `${previousConversationKey || "(tom)"} → ${locatorChange.next}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
  } else if (locatorChange.kind === "MISMATCH" && run.conversationKey) {
    run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
      origin: PAUSE_ORIGINS.TAB_NAVIGATED_AWAY,
      reason: `Målsessionens locator ändrades oväntat: ${run.conversationKey} → ${locatorChange.next}`,
      force: true
    });
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  const record = context.linkedTabs[String(run.targetTabId)];
  if (record) {
    record.url = page.url;
    record.title = page.title;
    record.conversationKey = page.conversationKey;
    record.documentEpoch = page.documentEpoch;
    record.lastSeenAt = nowIso();
    record.generating = page.generating;
    record.responseState = page.responseState || "UNKNOWN_RECONCILE";
    record.backgroundActive = Boolean(page.backgroundSignals?.active);
    record.backgroundLanguage = page.backgroundSignals?.language || "unknown";
    record.taskFingerprint = page.taskFingerprint || "";
    record.discarded = Boolean(tab.discarded);
    record.frozen = Boolean(tab.frozen);
    record.active = Boolean(tab.active);
    record.autoDiscardable = typeof tab.autoDiscardable === "boolean" ? tab.autoDiscardable : null;
    record.assistantCount = page.assistantCount;
    record.latestAssistantHash = page.latestAssistantHash;
    record.latestAssistantCandidate = Boolean(page.latestAssistantCandidate);
    record.latestMessageRole = page.latestMessageRole || "unknown";
    record.latestMessageHash = page.latestMessageHash || "";
    record.userTurnIds = mergeSeenUserTurnIds(record.userTurnIds, page.userTurnIds);
    page.userTurnIds = record.userTurnIds;
    record.userMessageHashes = mergeSeenUserMessageHashes(record.userMessageHashes, page.userMessageHashes);
    page.userMessageHashes = record.userMessageHashes;
  }
  if (run.startPromptReceipt && page.conversationKey && !run.startPromptReceipt.postConversationKey) {
    run.startPromptReceipt.postConversationKey = page.conversationKey;
    const receipt = context.startPromptReceipts.find((item) => item.receiptId === run.startPromptReceipt.receiptId);
    if (receipt) receipt.postConversationKey = page.conversationKey;
  }

  const reconciledReceipts = reconcileStartPromptReceipts(
    context.startPromptReceipts,
    page,
    run.targetTabId,
    { now }
  );
  if (reconciledReceipts.changed) {
    context.startPromptReceipts = reconciledReceipts.receipts;
    if (run.startPromptReceipt) {
      const currentReceipt = context.startPromptReceipts.find(
        (item) => item.receiptId === run.startPromptReceipt.receiptId
      );
      if (currentReceipt) run.startPromptReceipt = deepClone(currentReceipt);
    }
    addAudit(audit, {
      kind: "done",
      title: "Startpromptkvittens reconcilerad från assistantsvar",
      detail: `Fönster ${windowId} · ${page.conversationKey || "okänd konversation"}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
  }

  if (sessionInitHoldsAutonomy(run.sessionInitGate)) {
    const startEffect = latestEffect(run);
    const promptAcked = startEffect?.status === "ACKED" ||
      run.startPromptReceipt?.status === "ACKED";
    const firstResponseComplete = isAssistantResponseCandidate(page) &&
      Boolean(page.latestAssistantHash) &&
      (
        page.latestAssistantHash !== run.baselineAssistantHash ||
        assistantResponseIdentity(page) !== run.baselineResponseIdentity
      );
    const readiness = evaluateNewSessionReadiness(page, {
      requireEmptyConversation: false,
      expectedContentVersion: CONTENT_SCRIPT_VERSION
    });
    const previousState = run.sessionInitGate.state;
    run.sessionInitGate = advanceSessionInitGate(run.sessionInitGate, {
      tabReady: readiness.ready || Boolean(page.supported && page.composerFound),
      composerSettled: readiness.ready,
      promptAcked,
      firstResponseComplete,
      reasons: readiness.reasons
    });
    if (run.sessionInitGate.state !== previousState) {
      addAudit(audit, {
        kind: run.sessionInitGate.state === SESSION_INIT_STATES.FAILED_TIMEOUT ? "warning" : "info",
        title: run.sessionInitGate.state === SESSION_INIT_STATES.INITIALIZED
          ? "Sessionsinitiering verifierad"
          : "Sessionsinitiering avancerade",
        detail: `${previousState} → ${run.sessionInitGate.state}${run.sessionInitGate.detail ? ` · ${run.sessionInitGate.detail}` : ""}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }
  }

  const pageClassification = classifyChatGptPage(page);
  run.foregroundEvidence = page.foregroundSignals || null;
  run.lastReconcileAt = nowIso(now);
  run.nextReconcileReason = reason;
  run.lastVerifiedSnapshotHash = page.snapshotHash || page.latestAssistantHash || run.lastVerifiedSnapshotHash || "";
  if (page.taskFingerprint) {
    if (run.taskFingerprint && run.taskFingerprint !== page.taskFingerprint &&
        run.state === STATES.WAITING_BACKGROUND) {
      run.destructiveness = classifyDestructiveness({
        proposedAction: "CONTINUE_WITH_CHANGED_TASK_IDENTITY",
        exactTarget: `tab:${run.targetTabId}|conversation:${run.conversationKey || "UNKNOWN"}`,
        pauseOrigin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
        destructivenessLevel: 10,
        destructivenessRationale: "Task identity changed while the prior run was active."
      });
      run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
        origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
        reason: "Task fingerprint ändrades under bakgrundsväntan. Ingen ny prompt skickas före operatörskontroll.",
        force: true
      });
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(run.targetTabId, "BLOCKED", "Task fingerprint mismatch");
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }
    run.taskFingerprint = page.taskFingerprint;
  }

  if (page.boundarySignals?.captcha || page.boundarySignals?.authenticationRequired) {
    run.destructiveness = classifyDestructiveness({
      proposedAction: page.boundarySignals.captcha ? "SOLVE_CAPTCHA" : "AUTHENTICATE_USER",
      exactTarget: `tab:${run.targetTabId}|conversation:${run.conversationKey || "UNKNOWN"}`,
      pauseOrigin: PAUSE_ORIGINS.AUTHENTICATION_OR_CAPTCHA,
      destructivenessLevel: 10,
      destructivenessRationale: "Autentisering, CAPTCHA eller uttrycklig användarnärvaro är mänsklig auktoritet."
    });
    run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
      origin: PAUSE_ORIGINS.AUTHENTICATION_OR_CAPTCHA,
      reason: page.boundarySignals.captcha
        ? "Målfliken visar en CAPTCHA/anti-bot-gräns. Addonet försöker aldrig kringgå den."
        : "Målfliken kräver användarautentisering eller närvaro. Addonet väntar på operatören."
    });
    context.run = run;
    addAudit(audit, {
      kind: "blocked",
      title: "Autentisering/CAPTCHA kräver operatör",
      detail: run.pause.reason,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(run.targetTabId, "BLOCKED", run.pause.reason);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  const pendingMjolnar = await reconcileMjolnarReadbackUnlocked(run, page, tab);
  run = pendingMjolnar.run;
  if (pendingMjolnar.handled) {
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  if (config.backgroundWaitEnabled &&
      pageClassification.state === CHATGPT_RESPONSE_STATES.WAITING_BACKGROUND) {
    const firstBackgroundEntry = run.state !== STATES.WAITING_BACKGROUND;
    run = firstBackgroundEntry
      ? enterBackgroundWait(run, page, tab)
      : refreshBackgroundWait(run, page, tab);
    context.run = run;
    if (firstBackgroundEntry) {
      addAudit(audit, {
        kind: "info",
        title: "ChatGPT arbetar i bakgrunden",
        detail: `Språk ${run.backgroundLanguage || "okänt"}; timeout suspenderad utan deadline. Evidens: ${(run.backgroundEvidenceCodes || []).join(", ") || "strukturerad status"}.`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(run.targetTabId, "BACKGROUND", "Arbetar i bakgrunden · timeout suspenderad");
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  if (pageClassification.state === CHATGPT_RESPONSE_STATES.GENERATING_FOREGROUND) {
    if (run.state !== STATES.WAITING_FOREGROUND) {
      run = transitionRun(run, STATES.WAITING_FOREGROUND, {
        reason: "ChatGPT genererar i foreground. Ingen ny prompt skickas.",
        force: true
      });
    }
    run.timeoutSuspended = false;
    run.responseDeadlineAt ||= now + Number(config.responseTimeoutMs || 7_200_000);
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(run.targetTabId, "WAITING", "Foreground-generation pågår");
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  if (pageClassification.state === CHATGPT_RESPONSE_STATES.CANCELLED ||
      pageClassification.state === CHATGPT_RESPONSE_STATES.ERROR) {
    run = transitionRun(run, STATES.SOFT_PAUSED, {
      origin: pageClassification.state === CHATGPT_RESPONSE_STATES.CANCELLED
        ? PAUSE_ORIGINS.BACKGROUND_CANCELLED
        : PAUSE_ORIGINS.BACKGROUND_ERROR,
      reason: pageClassification.state === CHATGPT_RESPONSE_STATES.CANCELLED
        ? "ChatGPTs bakgrundskörning avbröts explicit."
        : "ChatGPTs betrodda statusyta rapporterar ett explicit fel.",
      force: true
    });
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  if (run.state === STATES.WAITING_BACKGROUND) {
    if (pageClassification.state === CHATGPT_RESPONSE_STATES.UNKNOWN_RECONCILE) {
      run = refreshBackgroundWait(run, page, tab, {
        reason: "BACKGROUND_SIGNAL_MISSING_UNKNOWN_RECONCILE"
      });
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }
    run.backgroundCompletionCandidate = advanceStableCompletion(
      run.backgroundCompletionCandidate,
      page,
      { now, settleMs: Number(config.settleMs || 2500), minimumReads: 2 }
    );
    if (!run.backgroundCompletionCandidate?.stable) {
      run = refreshBackgroundWait(run, page, tab, {
        reason: "VERIFYING_TWO_SNAPSHOT_COMPLETION"
      });
      run.backgroundCompletionCandidate = advanceStableCompletion(
        run.backgroundCompletionCandidate,
        page,
        { now, settleMs: Number(config.settleMs || 2500), minimumReads: 2 }
      );
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }
    run = leaveBackgroundWait(run);
  }

  const reconciliation = await reconcileEffect(run, page, audit, context);
  run = reconciliation.run;
  context.run = run;
  await writeRuntimeBundle(runtime, continuity, audit);
  if (reconciliation.shouldExecute) {
    return executePreparedEffectUnlocked(windowId);
  }

  if ([STATES.RECOVERING, STATES.ERROR_RETRYABLE].includes(run.state)) {
    if (page.supported && page.sessionExists) {
      run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
        origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
        reason: "Målflik och content bridge är åter läsbara.",
        force: true
      });
    }
  }

  if (run.state === STATES.SOFT_PAUSED &&
      ![PAUSE_ORIGINS.OPERATOR_PAUSE, PAUSE_ORIGINS.NO_PROGRESS_BUDGET_EXHAUSTED].includes(run.pause?.origin)) {
    run = transitionRun(run, STATES.RECOVERING, {
      origin: run.pause?.origin || PAUSE_ORIGINS.NONE,
      reason: "Automatisk paus ligger under nivå 10; autonom recovery fortsätter.",
      force: true
    });
  }
  if (run.state === STATES.PROGRAM_BLOCKED && !pauseRequiresHuman(run)) {
    run = transitionRun(run, STATES.RECOVERING, {
      origin: run.pause?.origin || PAUSE_ORIGINS.NONE,
      reason: "Blockeringen saknar nivå-10-gräns; autonom recovery fortsätter.",
      force: true
    });
  }
  if (run.state === STATES.RECOVERING && page.supported && page.sessionExists) {
    run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
      origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
      reason: "Autonom recovery har en läsbar target; fortsätter med färsk observation.",
      force: true
    });
  }
  // v0.10.11 session-context liveness. The transient initialization phases are
  // local controller handoffs; if one outlives its bound the whole gate is stuck
  // and `sessionContextInitBlocksWork` would otherwise block every prompt
  // forever, since v0.10.10 never assigned FAILED anywhere. FAILED is terminal,
  // so this fires exactly once and cannot spin. Placed before the ASSESSING
  // lease gate so a stalled DISPATCHED lease cannot outrun it.
  const initStall = evaluateSessionContextInitStall(run.sessionContextInit, { now });
  if (initStall.stalled) {
    run = applySessionContextInitFailure(run, {
      windowId,
      audit,
      code: initStall.code,
      detail: `Fasen ${initStall.state} slutfördes inte inom ${Math.round(initStall.limitMs / 1000)} s ` +
        `(${Math.round(initStall.ageMs / 1000)} s förflutna). Ingen prompt levererades till målsessionen.`,
      now
    });
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(
      run.targetTabId,
      "PAUSED",
      "Sessionsinitieringen misslyckades",
      sessionContextInitOverlay(run.sessionContextInit)
    );
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  if ((run.state === STATES.SOFT_PAUSED &&
        [PAUSE_ORIGINS.OPERATOR_PAUSE, PAUSE_ORIGINS.NO_PROGRESS_BUDGET_EXHAUSTED].includes(run.pause?.origin)) ||
      (run.state === STATES.PROGRAM_BLOCKED && pauseRequiresHuman(run))) {
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    return snapshotForWindow(windowId);
  }

  const preservedProtocolResult = run.pendingObservation?.targetResult;
  const preservedProtocolObservationId = run.pendingObservation?.observationId || "";
  if (run.pendingObservation && deterministicSourceExhausted(run, {
    source: NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL,
    observationId: preservedProtocolObservationId
  })) {
    const exhaustedObservation = run.pendingObservation;
    // v0.10.11: only an observation that actually produced a delivered turn may
    // be recorded as processed. v0.10.10 marked it processed unconditionally, so
    // an observation whose prompt was never built or sent still advanced
    // `lastProcessed*`. Combined with a resume plan that demands a *changed*
    // response identity, that closed a circular wait: the only actor that could
    // produce a new assistant response was the agent, and the agent was blocked
    // on exactly this observation. Leaving the markers untouched keeps a fresh
    // reconciliation of the same response possible once the failure clears.
    if (observationProducedDeliveredTurn(run, exhaustedObservation)) {
      run.lastProcessedResponseIdentity = exhaustedObservation.responseIdentity || run.lastProcessedResponseIdentity || "";
      run.lastProcessedAssistantHash = exhaustedObservation.responseHash || run.lastProcessedAssistantHash || "";
      run.lastProcessedAssistantCount = Number(exhaustedObservation.assistantCount || run.lastProcessedAssistantCount || 0);
      run.lastProcessedAssistantComplete = true;
    }
    run.pendingObservation = null;
    run.pendingNanoRequest = null;
    run.resumePlan ||= {
      requestedAction: sanitizeText(exhaustedObservation.targetResult?.next, 5000),
      requiredEvidence: [
        "En ny målresponse eller owner-read med ändrad response identity innan samma deterministic source får köras igen."
      ],
      workUnit: sanitizeText(projectContinuity(continuity).position?.workUnit, 2400),
      alternatives: [],
      reason: "Deterministic protocol-source är exhausted för den aktuella observationen. Samma svar återarmas inte."
    };
    run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
      origin: PAUSE_ORIGINS.NANO_GROUNDING_REJECTED,
      reason: run.resumePlan.reason,
      force: true
    });
    context.run = run;
    addAudit(audit, {
      kind: "warning",
      title: "Deterministic source exhausted — väntar på ny evidens",
      detail: `${run.deterministicGroundingFailure?.source || "UNKNOWN"} · observation ${preservedProtocolObservationId}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  if (preservedProtocolRecoveryEligible({
      pendingNanoRequest: run.pendingNanoRequest,
      targetResult: preservedProtocolResult,
      pageMatches: preservedProtocolPageMatch({ run, observation: run.pendingObservation, page }),
      humanPause: pauseRequiresHuman(run)
    })) {
    const analysisMode = classifyNanoAnalysisMode({
      run,
      continuityProjection: projectContinuity(continuity),
      observation: run.pendingObservation
    });
    const request = buildPendingNanoRequest({
      observationId: run.pendingObservation.observationId,
      analysisMode
    });
    run.pendingNanoRequest = markDeterministicPending(
      request,
      NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
    );
    run.resumePlan = null;
    run = transitionRun(run, STATES.ASSESSING, {
      origin: PAUSE_ORIGINS.NONE,
      reason: "Bevarad giltig EIC-trailer återtas genom deterministic protocol fast path.",
      force: true
    });
    run.nanoTelemetry ||= {};
    run.nanoTelemetry.lastRequestId = run.pendingNanoRequest.requestId;
    run.nanoTelemetry.lastMode = analysisMode;
    run.nanoTelemetry.lastStatus = "DETERMINISTIC_PENDING";
    run.nanoTelemetry.lastSource = NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL;
    context.run = run;
    addAudit(audit, {
      kind: "done",
      title: "Stuck v0.6.1-state självreparerad",
      detail: `${preservedProtocolResult.status} · bevarad observation ${run.pendingObservation.observationId} återköades utan Nano.`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    setTimeout(() => tickWindow(windowId, "protocol-fast-path-recovery").catch(console.warn), 0);
    return snapshotForWindow(windowId);
  }

  if (run.state === STATES.ASSESSING && run.pendingNanoRequest) {
    const request = run.pendingNanoRequest;

    if (request.status === "DETERMINISTIC_PENDING") {
      const source = request.deterministicSource === NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY
        ? NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY
        : NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL;
      const dispatchGate = evaluateDeterministicDispatch(request, { now });

      if (dispatchGate.action === DETERMINISTIC_GATE_ACTIONS.WAIT) {
        // The callback lease already owns this request. No durable write and no
        // stateRevision increment may occur on watchdog/content/panel ticks.
        return snapshotForWindow(windowId);
      }

      if (dispatchGate.action === DETERMINISTIC_GATE_ACTIONS.RECOVER) {
        const targetNext = sanitizeText(run.pendingObservation?.targetResult?.next, 5000);
        const exhaustedObservationId = run.pendingObservation?.observationId || request.observationId || "";
        run.pendingNanoRequest = null;
        run.deterministicGroundingFailure = {
          digest: sanitizeText(request.deterministicDecisionDigest || request.requestId, 128),
          count: dispatchGate.attempts,
          source,
          observationId: exhaustedObservationId,
          errors: ["CALLBACK_ATTEMPTS_EXHAUSTED"],
          at: nowIso(now)
        };
        run.resumePlan = {
          requestedAction: targetNext ||
            "Läs färsk owner-state för den aktiva arbetsenheten och returnera exakt locator, resultat och nästa bounded steg.",
          requiredEvidence: [
            "En ny owner-read eller målresponse som ändrar observationens identitet innan deterministic retry."
          ],
          workUnit: sanitizeText(projectContinuity(continuity).position?.workUnit, 2400),
          alternatives: [],
          reason: "Deterministic callback kvitterades inte efter två dispatchförsök. Spin stoppades och runnen fortsätter genom färsk reconciliation."
        };
        appendRecoveryAttempt(run, makeRecoveryAttempt("DETERMINISTIC_CALLBACK_RECONCILE", {
          outcome: "READ_REQUIRED",
          detail: run.resumePlan.reason
        }));
        run = transitionRun(run, STATES.RECOVERING, {
          origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
          reason: run.resumePlan.reason,
          nextRecoveryAt: nowIso(now + 30_000),
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "warning",
          title: "Deterministic callback-spin avbruten",
          detail: `${source} · request ${request.requestId} · ${dispatchGate.attempts} dispatchförsök; färsk reconciliation krävs.`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }

      const decision = request.protocolRepairOnly
        ? buildProtocolRepairDecision({
            reason: request.protocolReason || run.pendingObservation?.targetResult?.reason,
            expectedTurnId: request.expectedTurnId || run.currentTurn?.turnId || ""
          })
        : buildDeterministicDecision({
            run,
            observation: run.pendingObservation,
            continuityProjection: projectContinuity(continuity),
            maxAutonomousMode: run.maxAutonomousMode,
            requestMode: request.mode
          });
      const decisionDigest = await sha256Hex(stableStringify(decision));
      run.pendingNanoRequest = prepareDeterministicDispatch(request, {
        decisionDigest,
        now
      });
      const scheduledRequest = run.pendingNanoRequest;
      context.run = run;
      addAudit(audit, {
        kind: source === NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL ? "done" : "warning",
        title: request.protocolRepairOnly
          ? "EIC-AA repair-only körs utan Nano"
          : source === NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
            ? "Turn-bundet protokoll körs utan Nano-mellanstopp"
            : "Nano-fel omvandlat till deterministisk autonom recovery",
        detail: `${decision.action} · ${sanitizeText(decision.requestedAction || decision.reason, 1200)} · source=${source}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      // v0.10.11: applied in-band. DISPATCHED is persisted first so a service
      // worker death mid-apply still leaves a lease the gate can retry, but the
      // application itself no longer depends on a detached callback surviving.
      return applyDeterministicDecisionInBand(windowId, scheduledRequest, decision, source);
    }


    if (request.status === "RUNNING") {
      const leaseState = nanoClaimLeaseState(request, { now });
      if (leaseState === NANO_CLAIM_LEASE_STATE.INVALID) {
        const trace = {
          ...deepClone(request),
          status: "FAILED",
          completedAt: nowIso(now),
          lastError: "Nano-requestens claim-state saknar giltig claim-id eller lease."
        };
        run = recordDecisionTrace(run, trace, {
          source: request.deterministicSource || NANO_DECISION_SOURCE.NANO,
          now
        }).run;
        run.pendingNanoRequest = null;
        run.nanoTelemetry ||= {};
        run.nanoTelemetry.lastStatus = "FAILED";
        run.nanoTelemetry.lastCompletedAt = trace.completedAt;
        run.nanoTelemetry.lastError = trace.lastError;
        run.nanoTelemetry.lastResultSummary = trace.lastError;
        if (run.maxAutonomousMode && run.pendingObservation) {
          const recoverySource = protocolFastPathEligible(run.pendingObservation.targetResult)
            ? NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
            : NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY;
          run = armDeterministicRecovery(run, {
            source: recoverySource,
            analysisMode: request.mode,
            reason: `${trace.lastError} Autonom recovery fortsätter utan verklig PAUS.`,
            now
          }).run;
        } else {
          run = transitionRun(run, STATES.SOFT_PAUSED, {
            origin: PAUSE_ORIGINS.NANO_HOST_REQUIRED,
            reason: `${trace.lastError} Ingen målprompt skickades.`,
            force: true
          });
        }
        addAudit(audit, {
          kind: run.maxAutonomousMode ? "warning" : "blocked",
          title: run.maxAutonomousMode
            ? "Ogiltig Nano-claim omvandlad till autonom recovery"
            : "Nano-pipeline pausad på ogiltig claim-state",
          detail: `${request.mode || "UNKNOWN"} · ${request.requestId} · ${trace.lastError}`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
      } else if (leaseState === NANO_CLAIM_LEASE_STATE.EXPIRED) {
        if (Number(request.attempts || 0) >= NANO_MAX_ATTEMPTS) {
          const trace = {
            ...deepClone(request),
            status: "FAILED",
            completedAt: nowIso(now),
            lastError: "Nano claim-lease gick ut efter maximalt antal försök."
          };
          run = recordDecisionTrace(run, trace, {
            source: NANO_DECISION_SOURCE.NANO,
            now
          }).run;
          run.pendingNanoRequest = null;
          run.nanoTelemetry ||= {};
          run.nanoTelemetry.lastStatus = "FAILED";
          run.nanoTelemetry.lastCompletedAt = trace.completedAt;
          run.nanoTelemetry.lastError = trace.lastError;
          run.nanoTelemetry.lastResultSummary = trace.lastError;
          if (run.maxAutonomousMode && run.pendingObservation) {
            const recoverySource = continuity?.mainTaskBaseline &&
                protocolFastPathEligible(run.pendingObservation.targetResult)
              ? NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
              : NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY;
            run = armDeterministicRecovery(run, {
              source: recoverySource,
              analysisMode: request.mode,
              reason: `${trace.lastError} Autonom recovery fortsätter utan verklig PAUS.`,
              now
            }).run;
          } else {
            run = transitionRun(run, STATES.SOFT_PAUSED, {
              origin: PAUSE_ORIGINS.NANO_HOST_REQUIRED,
              reason: `${trace.lastError} Ingen målprompt skickades.`,
              force: true
            });
          }
          addAudit(audit, {
            kind: run.maxAutonomousMode ? "warning" : "blocked",
            title: run.maxAutonomousMode
              ? "Utgången Nano-lease omvandlad till autonom recovery"
              : "Nano-pipeline pausad efter utgången claim-lease",
            detail: `${request.mode || "UNKNOWN"} · ${request.requestId} · ${trace.lastError}`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
        } else {
          request.status = "PENDING";
          request.claimId = null;
          request.claimedAt = null;
          request.startedAt = null;
          request.heartbeatAt = null;
          request.claimLeaseUntil = null;
          request.firstTokenAt = null;
          request.outputChars = 0;
          request.chunkCount = 0;
          request.deadlineAt = request.mode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP
            ? null
            : nowIso(now + NANO_CLAIM_GRACE_MS);
          request.requeuedAt = nowIso(now);
          request.requeueCount = Number(request.requeueCount || 0) + 1;
          request.lastError = "Nano claim-lease gick ut; requesten återköades utan målprompt.";
          run.nanoTelemetry ||= {};
          run.nanoTelemetry.lastStatus = "REQUEUED";
          run.nanoTelemetry.lastError = request.lastError;
          addAudit(audit, {
            kind: "warning",
            title: request.mode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP
              ? "Nano-host försvann — takeover bevarad utan fallback"
              : "Nano-request återköad efter utgången claim-lease",
            detail: `${request.mode || "UNKNOWN"} · ${request.requestId} · ${request.lastError}`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
          await notifyPanels(windowId);
        }
      } else {
        run.nanoTelemetry ||= {};
        run.nanoTelemetry.lastStatus = "RUNNING";
        run.nanoTelemetry.lastHeartbeatAt = request.heartbeatAt || null;
        run.nanoTelemetry.lastLeaseUntil = request.claimLeaseUntil || null;
      }
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      return snapshotForWindow(windowId);
    }

    if (request.status === "PENDING") {
      const deadline = Date.parse(request.deadlineAt || "");
      const createdAt = Date.parse(request.createdAt || "");
      const takeoverHostDue =
        request.mode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP &&
        Number.isFinite(createdAt) &&
        now - createdAt >= NANO_CLAIM_LEASE_MS;
      if (takeoverHostDue) {
        if (run.maxAutonomousMode) {
          request.createdAt = nowIso(now);
          request.requeuedAt = nowIso(now);
          request.requeueCount = Number(request.requeueCount || 0) + 1;
          request.lastError = "Takeover väntar på lokal Nano-host; observationen bevaras och pollas utan verklig PAUS.";
          run.nanoTelemetry ||= {};
          run.nanoTelemetry.lastStatus = "WAITING_HOST";
          run.nanoTelemetry.lastError = request.lastError;
          context.run = run;
          addAudit(audit, {
            kind: "warning",
            title: "Takeover fortsätter vänta på Nano-host",
            detail: "Ingen målprompt skickades. Samma bevarade observation kan claimas när Nano-host åter blir tillgänglig.",
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
          await writeRuntimeBundle(runtime, continuity, audit);
          await setTabIndicator(run.targetTabId, "ASSESSING", "Väntar på lokal Nano-host utan verklig PAUS");
          await notifyPanels(windowId);
          return snapshotForWindow(windowId);
        }
        run.pendingNanoRequest = null;
        run = transitionRun(run, STATES.SOFT_PAUSED, {
          origin: PAUSE_ORIGINS.NANO_HOST_REQUIRED,
          reason: "Takeover kräver lokal Nano-host. Ingen claim skapades inom värdfristen och Max Mode är av.",
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "blocked",
          title: "Takeover väntar på Nano-host (Max Mode av)",
          detail: "Sidepanelen/Nano måste vara aktiv för att grunda en övertagen session. Target-authored fallback är förbjuden.",
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
      const fallbackDue = config.allowTargetAuthoredFallback === true &&
        request.mode !== NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP &&
        Number.isFinite(deadline) && now >= deadline;
      if (!fallbackDue && config.allowTargetAuthoredFallback !== true &&
          Number.isFinite(deadline) && now >= deadline) {
        if (run.maxAutonomousMode) {
          request.deadlineAt = nowIso(now + NANO_CLAIM_GRACE_MS);
          request.requeuedAt = nowIso(now);
          request.requeueCount = Number(request.requeueCount || 0) + 1;
          request.lastError = "Target-authored fallback är avstängd; Nano-requesten bevaras och återköas utan verklig PAUS.";
          run.nanoTelemetry ||= {};
          run.nanoTelemetry.lastStatus = "REQUEUED";
          run.nanoTelemetry.lastError = request.lastError;
          context.run = run;
          addAudit(audit, {
            kind: "warning",
            title: "Nano-host saknas — request återköad",
            detail: "Ingen målprompt skickades. Max Mode fortsätter att vänta på claimad Nano-output.",
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
          await writeRuntimeBundle(runtime, continuity, audit);
          await notifyPanels(windowId);
          return snapshotForWindow(windowId);
        }
        run.pendingNanoRequest = null;
        run = transitionRun(run, STATES.SOFT_PAUSED, {
          origin: PAUSE_ORIGINS.NANO_HOST_REQUIRED,
          reason: "Nano-host saknas eller sidepanelen är stängd. Målsessionens text får inte författa nästa instruktion.",
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "blocked",
          title: "Nano-host krävs (Max Mode av)",
          detail: "Deterministic target-authored fallback är avstängd. Ingen målprompt skickades.",
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
      if (fallbackDue) {
        const scheduledAt = Date.parse(request.fallbackScheduledAt || "");
        if (!Number.isFinite(scheduledAt) || now - scheduledAt >= 30_000) {
          const decision = buildDeterministicDecision({
            run,
            observation: run.pendingObservation,
            continuityProjection: projectContinuity(continuity),
            maxAutonomousMode: run.maxAutonomousMode,
            requestMode: request.mode
          });
          request.fallbackScheduledAt = nowIso(now);
          request.fallbackKind = "DETERMINISTIC";
          request.fallbackDecisionDigest = await sha256Hex(stableStringify(decision));
          context.run = run;
          addAudit(audit, {
            kind: decision.action === "CONTINUE" ? "warning" : "blocked",
            title: "Deterministic fallback schemalagd — explicit beslutskälla",
            detail: `${decision.reason} · source=DETERMINISTIC_FALLBACK`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
          await writeRuntimeBundle(runtime, continuity, audit);
          await notifyPanels(windowId);
          const requestId = request.requestId;
          setTimeout(() => {
            applyNanoDecisionCommand(windowId, {
              requestId,
              claimId: null,
              analysisMode: request.mode,
              durationMs: 0,
              repairUsed: false,
              source: "DETERMINISTIC_FALLBACK",
              decision
            }).catch(console.warn);
          }, 0);
          return snapshotForWindow(windowId);
        }
      }
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      return snapshotForWindow(windowId);
    }

    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    return snapshotForWindow(windowId);
  }

  const effect = latestEffect(run);
  const effectReady = !effect || effect.status === "ACKED";
  const pageResponseIdentity = assistantResponseIdentity(page);

  if (!effectReady || !isAssistantResponseCandidate(page) || !pageResponseIdentity) {
    // A latest user prompt deliberately clears any candidate and leaves WAITING armed.
    // The previous assistant body is never reprocessed merely because taskFingerprint
    // changed when the user submitted a new prompt.
    clearResponseStabilityProbe(windowId);
    run.responseCandidate = null;
  } else {
    const completionPolicy = responseEligibleForNano(run, page);
    const dynamicSoftCandidate = page.latestAssistantComplete !== true;
    const responseSettleMs = dynamicSoftCandidate
      ? Math.max(4_000, Number(config.settleMs || 2500))
      : Number(config.settleMs || 2500);
    const responseMinimumReads = dynamicSoftCandidate ? 3 : 2;
    const advanced = advanceResponseCandidate(run.responseCandidate, page, {
      now,
      settleMs: responseSettleMs,
      minimumReads: responseMinimumReads
    });
    run.responseCandidate = advanced.candidate;
    if (advanced.settled && !completionPolicy.eligible) {
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      scheduleResponseStabilityProbe(windowId, 1_500);
      return snapshotForWindow(windowId);
    }
    const newCompleteResponse = Boolean(
      advanced.settled &&
      completionPolicy.eligible &&
      latestMessageIsAssistant(page) &&
      (
        pageResponseIdentity !== run.lastProcessedResponseIdentity ||
        run.lastProcessedAssistantComplete === false
      )
    );

    if (!advanced.settled && advanced.candidate) {
      const firstSeenAt = Date.parse(advanced.candidate.firstSeenAt || "");
      const elapsedMs = Number.isFinite(firstSeenAt) ? Math.max(0, now - firstSeenAt) : 0;
      const remainingMs = Math.max(100, responseSettleMs - elapsedMs + 50);
      advanced.candidate.nextProbeAt = nowIso(now + remainingMs);
      run.responseCandidate = advanced.candidate;
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      scheduleResponseStabilityProbe(windowId, remainingMs);
      return snapshotForWindow(windowId);
    }

    clearResponseStabilityProbe(windowId);
    if (newCompleteResponse) {
      run = observePendingD2OwnerResponse(run, page);
      const responseContract = run.currentTurn?.responseContract || START_RESPONSE_CONTRACTS.TURN_BOUND_5;
      const allowTurnless = responseContract === START_RESPONSE_CONTRACTS.TURNLESS_4;
      const expectedTurnId = responseContract === START_RESPONSE_CONTRACTS.TURN_BOUND_5
        ? (run.currentTurn?.responseExpectedTurnId || run.currentTurn?.turnId || null)
        : null;
      const targetResult = parseTargetResult(page.latestAssistant, expectedTurnId, { allowTurnless });
      let modeProjection = { text: page.latestAssistant, removedChars: 0, malformed: false };
      let responseProjection;
      if (run.mode === RUN_MODES.APP_AUDIT_LONG) {
        const auditProjection = stripAuditEventFromText(page.latestAssistant);
        modeProjection = auditProjection;
        responseProjection = compactContextText(auditProjection.text, MAX_PENDING_RESPONSE_CHARS, {
          headRatio: 0.28,
          label: "LATEST TARGET RESPONSE"
        });
      } else if (run.mode === RUN_MODES.ARCHAEOLOGY_LONG) {
        const archaeologyProjection = stripArchaeologyEventFromText(page.latestAssistant);
        modeProjection = archaeologyProjection;
        responseProjection = compactContextText(archaeologyProjection.text, MAX_PENDING_RESPONSE_CHARS, {
          headRatio: 0.28,
          label: "LATEST TARGET RESPONSE"
        });
      } else {
        responseProjection = compactContextText(modeProjection.text, MAX_PENDING_RESPONSE_CHARS, {
          headRatio: 0.28,
          label: "LATEST TARGET RESPONSE"
        });
      }
      const conversationProjection = compactContextText(page.conversationExcerpt, 16_000, {
        headRatio: 0.2,
        label: "RECENT CONVERSATION"
      });
      const baselineCandidate = parseMainTaskBaseline(page.latestAssistant, {
        source: "TARGET_RESPONSE_ROUTING_CONTEXT",
        observedAt: nowIso(now)
      });
      if (baselineCandidate.valid && adoptMainTaskBaseline(continuity, baselineCandidate.baseline, { now })) {
        addAudit(audit, {
          kind: "done",
          title: "Huvuduppgiftsbaslinje mottagen",
          detail: `${baselineCandidate.baseline.mainTask.title || baselineCandidate.baseline.mainTask.programGoal} · routing context, inte owner-bevis.`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
      }
      const continuityProjection = projectContinuity(continuity);
      const observationIdentity = await computeObservationIdentity({
        stableGoal: continuityProjection.intent || config.targetMandate || `mode:${run.mode}`,
        activeWorkUnit: continuityProjection.position?.workUnit ||
          targetResult.next ||
          "Ground the current target response without expanding authority.",
        ownerLocators: observationOwnerLocators(run),
        claimBoundary: {
          targetTextAuthority: "NONE",
          completionScope: "STABLE_GOAL_ONLY",
          ownerRoute: "TARGET_RESPONSE_PROTOCOL_AND_LOCAL_STATE_MACHINE"
        },
        observation: {
          responseText: page.latestAssistant,
          targetResult: {
            valid: targetResult.valid,
            status: targetResult.status,
            next: targetResult.next,
            completionEvidence: targetResult.completionEvidence,
            fullStopReason: targetResult.fullStopReason
          }
        }
      });
      const observationRegistration = registerObservationIdentity(
        run.observationLoop || createObservationLoopState(),
        { identity: observationIdentity, now }
      );
      run.observationLoop = observationRegistration.state;
      run.observationGeneration = Number(run.observationGeneration || 0) +
        (observationRegistration.duplicate ? 0 : 1);
      run.pendingObservation = {
        observationId: observationRegistration.references.observationRef,
        observationIdentity,
        contextRef: observationRegistration.references.contextRef,
        twinRef: observationRegistration.references.twinRef,
        receiptRef: observationRegistration.references.receiptRef,
        duplicateObservation: observationRegistration.duplicate,
        generation: run.observationGeneration,
        responseHash: page.latestAssistantHash,
        responseIdentity: pageResponseIdentity,
        responseText: responseProjection.text,
        responseOriginalLength: responseProjection.originalLength,
        responseCompactionStrategy: responseProjection.strategy,
        auditEventRemovedChars: run.mode === RUN_MODES.APP_AUDIT_LONG ? Number(modeProjection.removedChars || 0) : 0,
        auditEventMalformed: run.mode === RUN_MODES.APP_AUDIT_LONG ? Boolean(modeProjection.malformed) : false,
        archaeologyEventRemovedChars: run.mode === RUN_MODES.ARCHAEOLOGY_LONG ? Number(modeProjection.removedChars || 0) : 0,
        archaeologyEventMalformed: run.mode === RUN_MODES.ARCHAEOLOGY_LONG ? Boolean(modeProjection.malformed) : false,
        conversationExcerpt: conversationProjection.text,
        conversationOriginalLength: conversationProjection.originalLength,
        conversationCompactionStrategy: conversationProjection.strategy,
        assistantCount: page.assistantCount,
        latestMessageRole: page.latestMessageRole || "assistant",
        latestMessageHash: page.latestMessageHash || page.latestAssistantHash,
        completionDetection: completionPolicy.reason,
        documentEpoch: page.documentEpoch,
        observedAt: nowIso(),
        targetResult,
        protocolReminderRequired: !targetResult.valid
      };
      if (!observationRegistration.canStartGrounding) {
        run.pendingNanoRequest = null;
        run.waitingForUnlockEvent =
          "Ny owner-evidens, konkret artifact, verifierad state transition eller materiellt förbättrad leverans.";
        run = transitionRun(run, STATES.RECOVERING, {
          origin: PAUSE_ORIGINS.NO_PROGRESS,
          reason: "NON_PROGRESSING_LOOP: samma observation identity har redan nått tvåcykelsgränsen och sin enda bounded pivot/stop.",
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "warning",
          title: "NON_PROGRESSING_LOOP blockerade ny grounding",
          detail: `${observationIdentity} · refs återanvändes; inga nya context-, twin- eller receiptobjekt skapades.`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(run.targetTabId, "RECOVERING", run.waitingForUnlockEvent);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
      // v0.7.4: in APP_AUDIT_LONG the response also carries a machine-readable audit
      // event. It is parsed and gated here, then removed from the text that goes to Nano:
      // the block is structured by construction, so shipping it as prose only crowds out
      // the continuity projection inside the input budget.
      if (run.mode === RUN_MODES.APP_AUDIT_LONG) {
        run = ingestAuditEvent(run, page.latestAssistant, {
          turnId: expectedTurnId || run.currentTurn?.turnId || "",
          at: nowIso(),
          audit,
          windowId
        });
      } else if (run.mode === RUN_MODES.ARCHAEOLOGY_LONG) {
        run = ingestArchaeologyEvent(run, page.latestAssistant, {
          turnId: expectedTurnId || run.currentTurn?.turnId || "",
          at: nowIso(),
          audit,
          windowId
        });
      }

      const mainTaskBaselinePresent = Boolean(continuityProjection.mainTaskBaseline);
      if (!mainTaskBaselinePresent && sessionContextInitBlocksWork(run.sessionContextInit)) {
        run = armMainTaskBaselineRequest(run, continuity, {
          now,
          observation: run.pendingObservation
        });
        context.run = run;
        addAudit(audit, {
          kind: "done",
          title: "Sessions-catch klar — kanonisk baselineprompt schemalagd",
          detail: `${run.pendingObservation?.observationId || "observation"} · ingen LanguageModel-författning av första prompten`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(
          run.targetTabId,
          "INITIALIZING",
          "Sessions-catch klar · begär huvuduppgiftsbaslinje",
          sessionContextInitOverlay(run.sessionContextInit)
        );
        await notifyPanels(windowId);
        setTimeout(() => tickWindow(windowId, "session-context-baseline-dispatch").catch(console.warn), 0);
        return snapshotForWindow(windowId);
      }
      if (mainTaskBaselinePresent && sessionContextInitBlocksWork(run.sessionContextInit)) {
        run.sessionContextInit = advanceSessionContextInit(
          run.sessionContextInit,
          SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING,
          {
            baselineResponseIdentity: pageResponseIdentity
          },
          { now, force: true }
        );
      }
      const analysisMode = classifyNanoAnalysisMode({
        run,
        continuityProjection,
        observation: run.pendingObservation
      });
      const protocolDecisionPath = selectProtocolDecisionPath({
        targetResult,
        analysisMode,
        continuityGrounded: continuityIsGrounded(continuityProjection),
        currentTurnKind: run.currentTurn?.kind || ""
      });
      const sessionInitNeedsNano =
        run.sessionContextInit?.state === SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING;
      const useProtocolRepairPath =
        protocolDecisionPath === PROTOCOL_DECISION_PATHS.REPAIR &&
        mainTaskBaselinePresent &&
        !sessionInitNeedsNano;
      const useProtocolFastPath =
        protocolDecisionPath === PROTOCOL_DECISION_PATHS.FAST_PATH &&
        mainTaskBaselinePresent &&
        !sessionInitNeedsNano;
      const initialRequest = buildPendingNanoRequest({
        observationId: run.pendingObservation.observationId,
        analysisMode
      });
      run.pendingNanoRequest = useProtocolRepairPath
        ? markDeterministicPending({
            ...initialRequest,
            protocolRepairOnly: true,
            protocolReason: sanitizeText(targetResult.reason, 600),
            expectedTurnId: expectedTurnId || ""
          }, NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL)
        : useProtocolFastPath
          ? markDeterministicPending(initialRequest, NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL)
          : initialRequest;
      run.nanoTelemetry ||= {};
      run.nanoTelemetry.lastRequestId = run.pendingNanoRequest.requestId;
      run.nanoTelemetry.lastMode = analysisMode;
      run.nanoTelemetry.lastStatus = useProtocolRepairPath
        ? "PROTOCOL_REPAIR_PENDING"
        : useProtocolFastPath ? "DETERMINISTIC_PENDING" : "PENDING";
      run.nanoTelemetry.lastSource = (useProtocolRepairPath || useProtocolFastPath)
        ? NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
        : "";
      run.nanoTelemetry.lastInputChars = 0;
      run.nanoTelemetry.lastInputDigest = "";
      run.nanoTelemetry.lastResultSummary = "";
      run = transitionRun(run, STATES.ASSESSING, {
        reason: useProtocolRepairPath
          ? `Ogiltigt EIC-AA-svar går till kompakt repair-only-flöde: ${targetResult.reason}.`
          : useProtocolFastPath
            ? `Komplett turn-bundet ${targetResult.status} körs genom deterministic protocol fast path.`
            : analysisMode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP
            ? "Ett stabilt komplett assistantsvar har observerats. Nano ska grunda övertagandet."
            : "Ett stabilt komplett assistantsvar har observerats. Nano ska klassificera nästa substantiella åtgärd."
      });
      run.lastProcessedAssistantHash = page.latestAssistantHash;
      run.lastProcessedResponseIdentity = pageResponseIdentity;
      run.lastProcessedAssistantCount = Number(page.assistantCount || 0);
      run.lastProcessedAssistantComplete = true;
      run.lastProgressAt = nowIso();
      run.responseCandidate = null;
      context.run = run;
      addAudit(audit, {
        kind: (useProtocolRepairPath || useProtocolFastPath) ? "done" : "info",
        title: useProtocolRepairPath
          ? "Ogiltigt EIC-protokoll — repair-only utan Nano"
          : useProtocolFastPath
            ? "Giltigt EIC-protokoll — Nano-mellanstopp förbikopplat"
            : "Stabilt komplett AI-svar väntar på Nano",
        detail: useProtocolRepairPath
          ? `${targetResult.reason} · observation ${run.pendingObservation.observationId} · ingen normal progress registreras`
          : useProtocolFastPath
            ? `${targetResult.status} · observation ${run.pendingObservation.observationId} · turn ${targetResult.turnId || "turnless"}`
            : `Observation ${run.pendingObservation.observationId} · generation ${run.pendingObservation.generation} · ${run.pendingObservation.completionDetection}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(
        run.targetTabId,
        sessionInitNeedsNano ? "INITIALIZING" : "ASSESSING",
        sessionInitNeedsNano
          ? "Nano analyserar initierad sessionskontext"
          : useProtocolRepairPath
            ? "Repair-only återställer EIC-AA-footern"
            : useProtocolFastPath ? "Giltigt EIC-protokoll fortsätter deterministiskt" : "Nano analyserar stabil observation",
        sessionInitNeedsNano ? sessionContextInitOverlay(run.sessionContextInit) : null
      );
      await notifyPanels(windowId);
      if (useProtocolRepairPath || useProtocolFastPath) {
        setTimeout(() => tickWindow(
          windowId,
          useProtocolRepairPath ? "protocol-repair-only" : "protocol-fast-path"
        ).catch(console.warn), 0);
      }
      return snapshotForWindow(windowId);
    }
  }

  if (shouldApplyResponseTimeout(run) && now > run.responseDeadlineAt && !page.generating) {
    if (run.maxAutonomousMode) {
      appendRecoveryAttempt(run, makeRecoveryAttempt("RECHECK_LONG_WAIT", {
        outcome: "DEADLINE_RENEWED",
        detail: "Ingen generation pågick. Ny bounded observationsperiod startades."
      }));
      run.responseDeadlineAt = now + Number(config.responseTimeoutMs || 7_200_000);
      addAudit(audit, {
        kind: "warning",
        title: "Lång väntan omplanerad",
        detail: "Max Autonomous Mode förnyade väntan efter färsk DOM-kontroll; ingen prompt skickades.",
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    } else {
      run = transitionRun(run, STATES.SOFT_PAUSED, {
        origin: PAUSE_ORIGINS.NO_PROGRESS,
        reason: "Svarstimeout nåddes utan pågående generation."
      });
    }
  }

  context.run = run;
  await writeRuntimeBundle(runtime, continuity, audit);
  await notifyPanels(windowId);
  return snapshotForWindow(windowId);
}

async function tickWindow(windowId, reason) {
  const snapshot = await enqueue(() => tickWindowUnlocked(windowId, reason));
  scheduleBackgroundAutoSessionCapture(windowId, reason);
  return snapshot;
}

async function processExpiredCoreSurfaceReviews() {
  const { config, runtime } = await loadBundle();
  for (const context of Object.values(runtime.windows || {})) {
    const review = context?.coreSurfaceReview;
    const due = coreSurfaceAutoApplyDue(review, {
      enabled: config.autoApplyCoreSurfaceReviewEnabled !== false
    });
    if (!due.due) continue;
    try {
      await applyCoreSurfaceReview(context.windowId, {
        reviewId: review.proposal?.reviewId || "",
        automatic: true
      });
    } catch (error) {
      console.warn(`EIC Autonom Agent: TTL-applicering misslyckades för fönster ${context.windowId}.`, error);
    }
  }
}

async function tickAll(reason = "alarm") {
  await ensureInitialized();
  const { runtime } = await loadBundle();
  const windowIds = Object.values(runtime.windows || {})
    .filter((context) => {
      const activeRun = context.run &&
        ![STATES.PROGRAM_DONE, STATES.STOPPED, STATES.ERROR_TERMINAL].includes(context.run.state);
      const linkedTarget = Object.keys(context.linkedTabs || {}).length > 0;
      return activeRun || linkedTarget;
    })
    .map((context) => context.windowId);
  for (const windowId of windowIds) {
    try {
      await tickWindow(windowId, reason);
    } catch (error) {
      console.warn(`EIC Autonom Agent: tick misslyckades för fönster ${windowId}.`, error);
    }
  }
  await processExpiredCoreSurfaceReviews();
}

function decisionToActionKey(decision) {
  return sanitizeText(`${decision?.workUnit || ""}|${decision?.requestedAction || ""}`, 500);
}

/**
 * Identity of the exact boundary an operator is asked to authorize.
 *
 * `pause.at` is part of the key on purpose: every new transition into a blocking state
 * mints a new timestamp, so an authorization can never be replayed against a later,
 * different boundary. The key is derived only from local run state — never from target
 * text — because an authorization that could be produced by the target session would let
 * the target authorize its own escalation.
 */
function boundaryKey(run) {
  if (!run) return "";
  return [
    String(run.runId || ""),
    String(run.pause?.origin || PAUSE_ORIGINS.NONE),
    String(Number(run.destructiveness?.level || 0)),
    String(run.pause?.at || ""),
    sanitizeText(run.destructiveness?.rationale, 200)
  ].join("|");
}

function boundaryAuthorized(run) {
  const key = boundaryKey(run);
  return Boolean(key && run?.boundaryAuthorization?.boundaryKey === key);
}

function pauseRequiresHuman(run) {
  if (!run) return false;
  // v0.10.11: a FAILED session-context initialization is an owner-side invariant
  // break, not a target problem. Nothing autonomous can clear it — the baseline
  // question was never delivered — so the run must hold until the operator
  // retries or stops. Without this the SOFT_PAUSED/PROGRAM_BLOCKED reclassifiers
  // would bounce the run straight back into RECOVERING and spin.
  if (String(run.sessionContextInit?.state || "") === "FAILED") return true;
  // v0.7.1: a level-10 boundary the operator has explicitly authorized on the local panel
  // is no longer a human-required pause. Nothing in the target session can reach this.
  if (boundaryAuthorized(run)) return false;
  if (Number(run.destructiveness?.level || 0) === 10) return true;
  return [
    PAUSE_ORIGINS.USER_PAUSE,
    PAUSE_ORIGINS.OPERATOR_PAUSE,
    PAUSE_ORIGINS.DIRECT_OPERATOR_STOP,
    PAUSE_ORIGINS.AUTHENTICATION_OR_CAPTCHA,
    PAUSE_ORIGINS.PRIVACY_OR_SECRET_BOUNDARY,
    PAUSE_ORIGINS.POLICY_OR_SAFETY_BOUNDARY,
    PAUSE_ORIGINS.TAB_NAVIGATED_AWAY
  ].includes(run.pause?.origin);
}


function enforceArchaeologyDecisionCeiling(decision, run, autonomy, audit, windowId, config) {
  if (run?.mode !== RUN_MODES.ARCHAEOLOGY_LONG) return { decision, autonomy, changed: false };
  if (decision?.pauseOrigin === PAUSE_ORIGINS.USER_PAUSE) {
    return { decision, autonomy, changed: false };
  }

  const maxLevel = Number(run.destructivenessCeiling?.level || ARCHAEOLOGY_EFFECT_CEILING.level || 4);
  const gateErrors = Array.isArray(run.archaeologyLastGate?.errors) ? run.archaeologyLastGate.errors : [];
  const forbiddenEvent = gateErrors.includes(ARCHAEOLOGY_GATES.FORBIDDEN_EFFECT);
  const aboveCeiling = Number(autonomy?.assessment?.level || 10) > maxLevel;
  if (!forbiddenEvent && !aboveCeiling) return { decision, autonomy, changed: false };

  const priorAction = sanitizeText(decision?.requestedAction || decision?.action, 1200);
  decision.action = "CONTINUE";
  decision.requestedAction = [
    "Stanna i ARCHAEOLOGY_LONG.",
    "Välj ett read-only forskningssteg: owner-read, source inspection, jämförelse, code graph, read-only query eller evidenscheckpoint.",
    "Proba relevanta Workspace-capabilities med workspace.help, workspace.capabilities.resolve eller workspace.op.describe före exakt opcode."
  ].join(" ");
  decision.workUnit = "Omplanera nästa forskningsenhet inom ARCHAEOLOGY_LONG:s read-only effektgräns.";
  decision.requiredEvidence = [
    "Exakt owner-/source-/receipt-locator från en read-only ägarrutt.",
    "Ett giltigt EIC_ARCHAEOLOGY_EVENT utan förbjuden effekt."
  ];
  decision.reason = `ARCHAEOLOGY_EFFECT_CEILING: föreslaget steg låg utanför analys-/forskningsmandatet. Kandidat: ${priorAction}`;
  decision.pauseOrigin = PAUSE_ORIGINS.NONE;
  decision.boundaryEvidence = "";
  decision.destructivenessLevel = 1;
  decision.destructivenessRationale = "Automatisk read-only omplanering inom ARCHAEOLOGY_LONG.";
  decision.rollbackPath = "Ingen mutation tillåts; endast read-only forskningssteg.";
  decision.readbackPlan = "Läs route-native resultat/receipt och bind det till nästa research event.";
  decision.materialAmbiguity = "PRESENT";
  decision.completionConfirmed = false;

  const nextAutonomy = assessAutonomousDecision(decision, run, null, {
    ...config,
    maxAutonomousMode: true
  });
  addAudit(audit, {
    kind: "warning",
    title: "ARCHAEOLOGY_LONG blockerade icke-forskningseffekt",
    detail: `ceiling=${maxLevel}/10 · proposed=${Number(autonomy?.assessment?.level || 0)}/10 · eventForbidden=${forbiddenEvent}`,
    windowId,
    tabId: run.targetTabId,
    runId: run.runId
  });
  return { decision, autonomy: nextAutonomy, changed: true };
}

function assessAutonomousDecision(decision, run, observation, config) {
  const targetResult = observation?.targetResult || null;
  const exactTarget = sanitizeText(
    decision?.exactTarget ||
    `tab:${run.targetTabId}|conversation:${run.conversationKey || "UNKNOWN"}`,
    1600
  );
  const ownerRoute = sanitizeText(
    decision?.ownerRoute ||
    (targetResult?.valid ? "TARGET_RESPONSE_PROTOCOL_AND_EIC_STATE_MACHINE" : "EIC_STATE_MACHINE"),
    1200
  );
  const assessment = classifyDestructiveness({
    actionCode: decision?.operatorCandidate?.actionCode,
    proposedAction: decision?.operatorCandidate?.proposedAction,
    requestedAction: decision?.requestedAction,
    reason: decision?.reason,
    boundaryEvidence: decision?.boundaryEvidence,
    exactTarget,
    expectedEffect: decision?.operatorCandidate?.expectedEffect,
    ownerSurface: ownerRoute,
    pauseOrigin: decision?.pauseOrigin,
    targetNext: targetResult?.next,
    destructivenessLevel: decision?.destructivenessLevel,
    destructivenessRationale: decision?.destructivenessRationale
  });
  const control = runHjalmarMentalControl({
    assessment,
    exactTarget,
    ownerRoute,
    mandate: config?.targetMandateVersion || "target-core-v6",
    rollbackPath: decision?.rollbackPath ||
      (assessment.level <= 5 ? "NOT_REQUIRED_OR_TRANSIENT" : ""),
    readbackPlan: decision?.readbackPlan ||
      (targetResult?.valid ? "RE_READ_EXACT_OWNER_STATE_AFTER_EFFECT" : ""),
    materialAmbiguity: decision?.materialAmbiguity || "UNKNOWN"
  });
  return { assessment, control, exactTarget, ownerRoute };
}

function localMjolnarCandidate(decision, run, observation) {
  const proposed = decision?.operatorCandidate;
  if (decision?.pauseOrigin !== PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE ||
      !proposed || typeof proposed !== "object") {
    return null;
  }
  const actionCode = sanitizeText(proposed.actionCode, 120);
  const action = ACTION_REGISTRY[actionCode];
  if (!action) return null;
  const privileged = action.delegationClass === DELEGATION_CLASSES.D2_PRIVILEGED;
  const exactTarget = privileged
    ? sanitizeText(proposed.exactTarget || decision.exactTarget, 1600)
    : `tab:${run.targetTabId}|conversation:${run.conversationKey || "UNKNOWN"}`;
  const ownerSurface = privileged
    ? sanitizeText(proposed.ownerSurface || decision.ownerRoute, 400)
    : actionCode === "RESUME_VERIFIED_MARKER"
      ? "EIC_STATE_MACHINE"
      : "CHROME_TABS";
  const ownerEvidenceLocator = privileged
    ? sanitizeText(proposed.ownerEvidenceLocator, 1200)
    : `run:${run.runId}|snapshot:${observation?.responseHash || "UNKNOWN"}`;
  const proposedAction = sanitizeText(proposed.proposedAction || decision.requestedAction, 1600);
  const expectedEffect = sanitizeText(proposed.expectedEffect, 1600) ||
    (privileged ? "" : "Verifierad registrerad lokal effekt.");
  const rollbackPath = sanitizeText(proposed.rollbackPath || decision.rollbackPath, 1200);
  const readbackPlan = sanitizeText(proposed.readbackPlan || decision.readbackPlan, 1200) ||
    (privileged ? "" : action.readback || "RE_READ_EXACT_OWNER_STATE_AFTER_EFFECT");
  const materialAmbiguity = proposed.materialAmbiguity || decision.materialAmbiguity || "UNKNOWN";
  const destructiveness = classifyDestructiveness({
    actionCode,
    proposedAction,
    expectedEffect,
    exactTarget,
    ownerSurface,
    destructivenessLevel: proposed.destructivenessLevel || decision.destructivenessLevel || action.destructivenessLevel,
    destructivenessRationale: proposed.destructivenessRationale || decision.destructivenessRationale
  });
  return {
    // Nano supplies candidate data; the trusted local registry, target resolver and
    // deterministic policy create the executable trigger.
    sourceClass: "LOCAL_STATE_MACHINE",
    triggerType: ["HUMAN_ACTION_CANDIDATE", "OPERATOR_PROXY_REQUIRED"].includes(proposed.triggerType)
      ? proposed.triggerType
      : "OPERATOR_PROXY_REQUIRED",
    actionCode,
    exactTarget,
    proposedAction,
    expectedEffect,
    ownerSurface,
    ownerEvidenceLocator,
    reversibility: proposed.reversibility || "UNKNOWN",
    rollbackPath,
    humanAuthorityClass: proposed.humanAuthorityClass || "UNKNOWN",
    materialAmbiguity,
    destructivenessLevel: destructiveness.level,
    destructivenessRationale: destructiveness.rationale,
    readbackPlan,
    executor: action.executor
  };
}

async function dispatchMjolnarActionUnlocked(run, request, entry, observation = null) {
  const action = ACTION_REGISTRY[request.action_code];
  if (!action) throw new Error("UNKNOWN_MJOLNAR_ACTION");
  let current = markMjolnarDispatch(entry, "DISPATCHING");
  const tabId = run.targetTabId;
  const before = await chrome.tabs.get(tabId);
  if (!isAllowedChatUrl(before.url || "")) throw new Error("MJOLNAR_TARGET_MISMATCH");

  let effectEvidence = "";
  let d2Handoff = null;
  switch (request.action_code) {
    case "REFRESH_TAB_STATUS": {
      const page = await readPage(tabId, "mjolnar-refresh-tab-status");
      effectEvidence = `tab=${tabId};documentEpoch=${page.documentEpoch};snapshot=${page.snapshotHash || page.latestAssistantHash || ""}`;
      break;
    }
    case "RECONNECT_CONTENT": {
      await ensureContentScript(tabId);
      const ping = await pingContentScript(tabId);
      if (!ping?.ok || ping.version !== CONTENT_SCRIPT_VERSION) throw new Error("MJOLNAR_RECONNECT_READBACK_FAILED");
      effectEvidence = `content=${ping.version};documentEpoch=${ping.documentEpoch || ""}`;
      break;
    }
    case "RELOAD_SELECTED_TAB": {
      const page = await readPage(tabId, "mjolnar-reload-preflight");
      if (page.generating || page.backgroundSignals?.active) throw new Error("MJOLNAR_ACTIVE_TASK_RELOAD_DENIED");
      await chrome.tabs.reload(tabId);
      effectEvidence = `reload-dispatched:tab=${tabId};owner-read-required-on-next-tick`;
      break;
    }
    case "RESUME_VERIFIED_MARKER": {
      const result = parseTargetResult(
        observation?.responseText || "",
        run.currentTurn?.turnId || null
      );
      if (!result.valid || result.status !== "CONTINUE") throw new Error("MJOLNAR_MARKER_READBACK_FAILED");
      effectEvidence = `turn=${result.turnId};status=${result.status}`;
      break;
    }
    case "SET_AUTO_DISCARDABLE_FALSE": {
      run.previousAutoDiscardable = typeof before.autoDiscardable === "boolean"
        ? before.autoDiscardable
        : true;
      await chrome.tabs.update(tabId, { autoDiscardable: false });
      const after = await chrome.tabs.get(tabId);
      if (after.autoDiscardable !== false) throw new Error("MJOLNAR_AUTO_DISCARDABLE_READBACK_FAILED");
      effectEvidence = `autoDiscardable=false;previous=${run.previousAutoDiscardable}`;
      break;
    }
    case "RESTORE_AUTO_DISCARDABLE": {
      const restore = typeof run.previousAutoDiscardable === "boolean"
        ? run.previousAutoDiscardable
        : true;
      await chrome.tabs.update(tabId, { autoDiscardable: restore });
      const after = await chrome.tabs.get(tabId);
      if (after.autoDiscardable !== restore) throw new Error("MJOLNAR_AUTO_DISCARDABLE_RESTORE_FAILED");
      effectEvidence = `autoDiscardable=${restore}`;
      run.previousAutoDiscardable = null;
      break;
    }
    case "AUTH_OWNER_ROUTE":
    case "CHANGE_PERMISSION":
    case "MERGE_BRANCH":
    case "CREATE_RELEASE":
    case "DEPLOY_PRODUCTION": {
      if (action.delegationClass !== DELEGATION_CLASSES.D2_PRIVILEGED) {
        throw new Error("MJOLNAR_D2_REGISTRY_CLASS_MISMATCH");
      }
      const page = await readPage(tabId, "mjolnar-d2-preflight");
      if (page.generating || page.backgroundSignals?.active) {
        throw new Error("MJOLNAR_D2_TARGET_BUSY");
      }
      const prompt = buildD2DelegationPrompt(request);
      const promptDigest = await sha256Hex(prompt.trim());
      let submission = null;
      let submissionError = "";
      try {
        submission = await chrome.tabs.sendMessage(tabId, {
          type: "EIC_SUBMIT_PROMPT",
          prompt,
          turnId: `mjolnar-d2-${request.request_id}`,
          promptDigest,
          promptAckDigest: promptDigest,
          requireTurnMarker: false,
          expectedDocumentEpoch: page.documentEpoch
        });
        if (!submission?.ok) {
          submissionError = sanitizeText(submission?.error || "D2 target bridge rejected prompt", 600);
        }
      } catch (error) {
        submissionError = sanitizeText(error instanceof Error ? error.message : String(error), 600);
      }
      d2Handoff = {
        promptDigest,
        acknowledged: Boolean(submission?.ok && submission?.acknowledged),
        documentEpoch: page.documentEpoch,
        error: submissionError
      };
      effectEvidence = [
        `d2Handoff=${request.action_code}`,
        `promptDigest=${promptDigest}`,
        `acknowledged=${String(d2Handoff.acknowledged)}`,
        submissionError ? `transport=${submissionError}` : "transport=OK"
      ].join(";");
      current.promptDigest = promptDigest;
      current.promptAcknowledged = d2Handoff.acknowledged;
      current.delegatedPromptAt = nowIso();
      break;
    }
    default:
      throw new Error("UNKNOWN_MJOLNAR_ACTION");
  }
  current = markMjolnarDispatch(current, "DISPATCHED", effectEvidence);
  current = markMjolnarDispatch(current, "READBACK_PENDING", effectEvidence);
  if (d2Handoff) {
    current.promptDigest = d2Handoff.promptDigest;
    current.promptAcknowledged = d2Handoff.acknowledged;
    current.readbackStatus = d2Handoff.acknowledged
      ? "PENDING_OWNER_RESPONSE"
      : "PROMPT_ACK_UNKNOWN";
    return {
      entry: current,
      verified: false,
      privilegedHandoff: true,
      awaitAssistantResponse: d2Handoff.acknowledged,
      effectEvidence
    };
  }
  if (request.action_code === "RELOAD_SELECTED_TAB") {
    current.readbackStatus = "PENDING_NEXT_TICK";
    return { entry: current, verified: false, effectEvidence };
  }
  current = markMjolnarDispatch(current, "VERIFIED_EFFECT", effectEvidence);
  return { entry: current, verified: true, effectEvidence };
}


async function reconcileMjolnarReadbackUnlocked(run, page, tab) {
  const ledger = run?.mjolnar?.ledger || [];
  if (![STATES.MJOLNAR_DISPATCH, STATES.MJOLNAR_READBACK].includes(run?.state) || !ledger.length) {
    return { run, handled: false, verified: false };
  }
  const last = ledger.at(-1);
  if (!["DISPATCHING", "DISPATCHED", "READBACK_PENDING"].includes(last.status)) {
    return { run, handled: false, verified: last.status === "VERIFIED_EFFECT" };
  }

  const pendingAction = ACTION_REGISTRY[last.actionCode];
  if (pendingAction?.delegationClass === DELEGATION_CLASSES.D2_PRIVILEGED) {
    const promptVisible = Boolean(
      last.promptDigest &&
      Array.isArray(page?.userMessageHashes) &&
      page.userMessageHashes.includes(last.promptDigest)
    );
    const responseObserved = Boolean(
      latestMessageIsAssistant(page) &&
      page?.latestAssistantHash &&
      page.latestAssistantHash !== last.snapshotHash
    );
    if (responseObserved) {
      const observed = markMjolnarDispatch(
        last,
        "OWNER_RESPONSE_OBSERVED",
        `assistantResponseHash=${page.latestAssistantHash};effectVerification=NOT_ESTABLISHED`
      );
      observed.ownerResponseHash = page.latestAssistantHash;
      observed.promptAcknowledged = promptVisible || Boolean(last.promptAcknowledged);
      run.mjolnar.ledger[ledger.length - 1] = observed;
      run.mjolnar.state = MJOLNAR_STATES.READ_REQUIRED;
      run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
        origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
        reason: "D2 owner-response observerad. Svaret går vidare till normal Nano-bedömning; effekten är inte verifierad av assistenttext.",
        force: true
      });
      return { run, handled: false, verified: false };
    }
    if (promptVisible || last.promptAcknowledged) {
      const pending = markMjolnarDispatch(
        last,
        "READBACK_PENDING",
        `${last.effectEvidence || ""};promptVisible=${String(promptVisible)}`
      );
      pending.promptAcknowledged = true;
      pending.readbackStatus = "PENDING_OWNER_RESPONSE";
      run.mjolnar.ledger[ledger.length - 1] = pending;
      run.mjolnar.state = MJOLNAR_STATES.READBACK_PENDING;
      run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
        origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
        reason: "D2-handoff finns i målkonversationen. Väntar på avslutat assistantsvar och efterföljande owner-read.",
        force: true
      });
      return { run, handled: true, verified: false };
    }
    run.mjolnar.state = MJOLNAR_STATES.READ_REQUIRED;
    run = transitionRun(run, STATES.RECOVERING, {
      origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
      reason: "D2 promptkvittens är okänd. Ingen blind retry görs; färsk mål- och owner-read krävs.",
      force: true
    });
    return { run, handled: false, verified: false };
  }

  let match = false;
  let evidence = "";
  switch (last.actionCode) {
    case "REFRESH_TAB_STATUS":
      match = Boolean(page?.supported && page?.snapshotHash);
      evidence = `snapshot=${page?.snapshotHash || ""}`;
      break;
    case "RECONNECT_CONTENT":
      match = page?.version === CONTENT_SCRIPT_VERSION;
      evidence = `content=${page?.version || "UNKNOWN"};document=${page?.documentEpoch || ""}`;
      break;
    case "RELOAD_SELECTED_TAB":
      match = tab?.status === "complete" &&
        page?.supported &&
        (!run.conversationKey || page.conversationKey === run.conversationKey);
      evidence = `tabStatus=${tab?.status};conversation=${page?.conversationKey || "UNKNOWN"}`;
      break;
    case "SET_AUTO_DISCARDABLE_FALSE":
      match = tab?.autoDiscardable === false;
      evidence = `autoDiscardable=${String(tab?.autoDiscardable)}`;
      break;
    case "RESTORE_AUTO_DISCARDABLE": {
      const expected = typeof run.previousAutoDiscardable === "boolean"
        ? run.previousAutoDiscardable
        : true;
      match = tab?.autoDiscardable === expected;
      evidence = `autoDiscardable=${String(tab?.autoDiscardable)};expected=${expected}`;
      break;
    }
    case "RESUME_VERIFIED_MARKER":
      match = last.readbackStatus === "MATCH";
      evidence = last.effectEvidence || "prior marker readback";
      break;
    default:
      match = false;
      evidence = "unknown action";
  }

  if (match) {
    const verified = markMjolnarDispatch(last, "VERIFIED_EFFECT", evidence);
    run.mjolnar.ledger[ledger.length - 1] = verified;
    run.mjolnar.state = MJOLNAR_STATES.VERIFIED_EFFECT;
    run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
      origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
      reason: `Mjölnar owner-readback matchade efter återstart: ${evidence}`,
      force: true
    });
    return { run, handled: false, verified: true };
  }

  const destructiveLevel = Number(last.destructivenessLevel || last.destructiveness?.level || 0);
  if (destructiveLevel === 10) {
    run.mjolnar.state = MJOLNAR_STATES.AWAITING_OPERATOR_DECISION;
    run.mjolnar.lastHumanRequiredReason = `Okänd tidigare nivå-10-effekt för ${last.actionCode}; owner-read matchade inte.`;
    run.destructiveness = classifyDestructiveness({
      actionCode: last.actionCode,
      proposedAction: last.proposedAction,
      exactTarget: last.exactTarget,
      destructivenessLevel: 10,
      destructivenessRationale: "Unknown previous effect for a non-delegable action."
    });
    run = transitionRun(run, STATES.AWAITING_OPERATOR_DECISION, {
      origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
      reason: "Mjölnar återstartade med okänd nivå-10-effekt. Verkligt mänskligt beslut krävs.",
      force: true
    });
    return { run, handled: true, verified: false };
  }

  run.mjolnar.state = MJOLNAR_STATES.READ_REQUIRED;
  run.mjolnar.lastHumanRequiredReason = "";
  appendRecoveryAttempt(run, makeRecoveryAttempt("MJOLNAR_OWNER_READ_RETRY", {
    outcome: "READ_REQUIRED",
    detail: `Owner-read matchade inte för ${last.actionCode}; säker återläsning och ombedömning krävs före eventuell retry.`
  }));
  run = transitionRun(run, STATES.RECOVERING, {
    origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
    reason: "Mjölnar-effekten är ännu okänd men ligger under nivå 10. Fortsätt med owner-read, inte verklig PAUS.",
    force: true
  });
  return { run, handled: false, verified: false };
}

function observePendingD2OwnerResponse(run, page) {
  const ledger = run?.mjolnar?.ledger || [];
  if (!ledger.length || !latestMessageIsAssistant(page) || !page?.latestAssistantHash) return run;
  const last = ledger.at(-1);
  const action = ACTION_REGISTRY[last.actionCode];
  if (action?.delegationClass !== DELEGATION_CLASSES.D2_PRIVILEGED) return run;
  if (!["DISPATCHING", "DISPATCHED", "READBACK_PENDING"].includes(last.status)) return run;
  if (page.latestAssistantHash === last.snapshotHash) return run;

  const observed = markMjolnarDispatch(
    last,
    "OWNER_RESPONSE_OBSERVED",
    `assistantResponseHash=${page.latestAssistantHash};effectVerification=NOT_ESTABLISHED`
  );
  observed.ownerResponseHash = page.latestAssistantHash;
  run.mjolnar.ledger[ledger.length - 1] = observed;
  run.mjolnar.state = MJOLNAR_STATES.READ_REQUIRED;
  run.mjolnar.activeResponse = {
    ...(run.mjolnar.activeResponse || {}),
    ownerResponseHash: page.latestAssistantHash,
    evidence_limit: "D2 target response observed; exact owner-route readback is still required before any effect claim."
  };
  return run;
}

async function handleMjolnarCandidateUnlocked({
  config,
  decision,
  run,
  observation,
  continuity,
  audit,
  context,
  windowId
}) {
  const candidate = localMjolnarCandidate(decision, run, observation);
  if (!candidate || !config.mjolnarEnabled) return { run, handled: false, verified: false };
  if (candidate.sourceClass !== "LOCAL_STATE_MACHINE") {
    run.mjolnar ||= { state: MJOLNAR_STATES.IDLE, activeRequest: null, activeResponse: null, ledger: [], lastHumanRequiredReason: "" };
    run.mjolnar.state = MJOLNAR_STATES.AWAITING_OPERATOR_DECISION;
    run.mjolnar.lastHumanRequiredReason = "Nano-förslag är opålitlig kandidatdata och kan inte bli en trusted Mjölnar-trigger.";
    run = transitionRun(run, STATES.AWAITING_OPERATOR_DECISION, {
      origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
      reason: run.mjolnar.lastHumanRequiredReason,
      force: true
    });
    addAudit(audit, {
      kind: "blocked",
      title: "Mjölnar avvisade modellproveniens",
      detail: `${candidate.sourceClass} · ${candidate.actionCode || "UNKNOWN"} · ingen dispatch`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    return { run, handled: true, verified: false };
  }

  const projection = projectContinuity(continuity);
  const request = await buildMjolnarRequest(candidate, {
    sessionId: run.runId,
    conversationLocator: run.conversationKey,
    stableGoal: projection.intent,
    activeWorkUnit: projection.position?.workUnit,
    verifiedState: projection.verifiedFacts?.map((item) => item.claim) || [],
    governingAuthority: "USER_CONFIG_AND_EIC_STATE_MACHINE",
    hjalmarVerdict: "UNKNOWN",
    hjalmarEvidenceLimit: "Ingen separat trusted Hjalmar-kanal är kopplad.",
    hjalmarProvenance: "UNTRUSTED_OR_ABSENT",
    snapshotHash: observation?.responseHash || run.lastVerifiedSnapshotHash
  });
  const priorLedger = run.mjolnar?.ledger || [];
  let response = adjudicateMjolnarRequest(request, { priorLedger });
  if (response.verdict === MJOLNAR_VERDICTS.READ_REQUIRED) {
    const ownerTab = await chrome.tabs.get(run.targetTabId);
    if (isAllowedChatUrl(ownerTab.url || "")) {
      const ownerPage = await readPage(run.targetTabId, "mjolnar-read-required");
      request.owner_evidence_locator = `tab:${ownerTab.id}|document:${ownerPage.documentEpoch}|snapshot:${ownerPage.snapshotHash || ownerPage.latestAssistantHash || "UNKNOWN"}`;
      response = adjudicateMjolnarRequest(request, { priorLedger, readSatisfied: true });
    }
  }
  if (response?.m2_mandate) {
    request.m2_mandate = deepClone(response.m2_mandate);
  }
  let entry = createMjolnarLedgerEntry(request, response);
  run.mjolnar ||= { state: MJOLNAR_STATES.IDLE, activeRequest: null, activeResponse: null, ledger: [], lastHumanRequiredReason: "" };
  run.mjolnar.activeRequest = request;
  run.mjolnar.activeResponse = response;
  run.mjolnar.ledger = [...priorLedger, entry].slice(-50);
  run.mjolnar.state = MJOLNAR_STATES.ADJUDICATING;
  run = transitionRun(run, STATES.MJOLNAR_ADJUDICATING, {
    origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
    reason: `Mjölnar bedömer ${request.action_code} som ${response.verdict}.`,
    force: true
  });

  const canDispatch = canDispatchForRollout(response, config.mjolnarRolloutMode || MJOLNAR_ROLLOUT_MODES.SHADOW);
  if (!canDispatch) {
    const level = Number(response.destructiveness_level || request.destructiveness_level || 0);
    const human = response.verdict === MJOLNAR_VERDICTS.HUMAN_REQUIRED && level === 10;
    run.mjolnar.state = human ? MJOLNAR_STATES.AWAITING_OPERATOR_DECISION :
      response.verdict === MJOLNAR_VERDICTS.REJECT ? MJOLNAR_STATES.REJECTED :
      response.verdict === MJOLNAR_VERDICTS.READ_REQUIRED ? MJOLNAR_STATES.READ_REQUIRED :
      MJOLNAR_STATES.INCONCLUSIVE;
    run.mjolnar.lastHumanRequiredReason = human ? response.reason : "";
    run.destructiveness = classifyDestructiveness({
      actionCode: request.action_code,
      proposedAction: request.proposed_action,
      exactTarget: request.exact_target,
      destructivenessLevel: level || undefined,
      destructivenessRationale: response.reason
    });
    run = transitionRun(run, human ? STATES.AWAITING_OPERATOR_DECISION : STATES.RECOVERING, {
      origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
      reason: human
        ? `Mjölnar nivå 10: ${response.reason}`
        : config.mjolnarRolloutMode === MJOLNAR_ROLLOUT_MODES.SHADOW && response.verdict === MJOLNAR_VERDICTS.DELEGABLE
          ? `Mjölnar shadow verdict ${response.delegation_class}/${response.verdict}; fortsätter med säker owner-read utan verklig PAUS.`
          : `Mjölnar ${response.verdict}: ${response.reason}. Fortsätt med återläsning/ombedömning.`,
      force: true
    });
    addAudit(audit, {
      kind: human ? "blocked" : "warning",
      title: human ? "Mjölnar kräver verklig PAUS (nivå 10)" : "Mjölnar fortsätter autonom återhämtning",
      detail: `${response.delegation_class} · nivå ${level || "okänd"} · ${response.reason} · rollout ${config.mjolnarRolloutMode}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    return { run, handled: human, verified: false };
  }

  run.mjolnar.state = MJOLNAR_STATES.DELEGATED_PENDING_DISPATCH;
  run = transitionRun(run, STATES.MJOLNAR_DISPATCH, {
    origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
    reason: `Exakt registrerad action ${request.action_code} dispatchas högst en gång.`,
    force: true
  });
  try {
    const result = await dispatchMjolnarActionUnlocked(run, request, entry, observation);
    run.mjolnar.ledger[run.mjolnar.ledger.length - 1] = result.entry;
    run.mjolnar.state = result.verified ? MJOLNAR_STATES.VERIFIED_EFFECT : MJOLNAR_STATES.READBACK_PENDING;
    run.mjolnar.activeResponse = {
      ...response,
      effectEvidence: result.effectEvidence
    };
    if (result.privilegedHandoff) {
      run.mjolnar.state = MJOLNAR_STATES.READBACK_PENDING;
      run.responseCandidate = null;
      run.responseDeadlineAt = Date.now() + Number(config.responseTimeoutMs || 7_200_000);
      run = transitionRun(run, result.awaitAssistantResponse ? STATES.WAITING_FOR_RESPONSE : STATES.MJOLNAR_READBACK, {
        origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
        reason: result.awaitAssistantResponse
          ? "Mjölnar D2-handoff är kvitterad. Väntar på målrespons och därefter exakt owner-readback."
          : "Mjölnar D2-handoff har okänd promptkvittens. Owner-read körs utan blind retry.",
        force: true
      });
      addAudit(audit, {
        kind: "warning",
        title: result.awaitAssistantResponse
          ? "Mjölnar D2-handoff dispatchad"
          : "Mjölnar D2-handoff kräver kvittens-readback",
        detail: `${request.action_code} · ${request.exact_target} · ${result.effectEvidence} · ingen effekt verifierad`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      return { run, handled: true, verified: false };
    }
    if (result.verified) {
      run = transitionRun(run, STATES.ASSESSING, {
        origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
        reason: `Mjölnar-effekten verifierades genom lokal owner-readback: ${result.effectEvidence}`,
        force: true
      });
      addAudit(audit, {
        kind: "done",
        title: "Mjölnar-effekt verifierad",
        detail: `${request.action_code} · ${result.effectEvidence}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      return { run, handled: false, verified: true };
    }
    run = transitionRun(run, STATES.MJOLNAR_READBACK, {
      origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
      reason: "Dispatch genomförd; owner-readback krävs före fortsatt autonomi.",
      force: true
    });
    return { run, handled: true, verified: false };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const level = Number(request.destructiveness_level || response.destructiveness_level || 0);
    if (level === 10) {
      entry = markMjolnarDispatch(entry, "ERROR_PAUSED", detail);
      run.mjolnar.ledger[run.mjolnar.ledger.length - 1] = entry;
      run.mjolnar.state = MJOLNAR_STATES.AWAITING_OPERATOR_DECISION;
      run.mjolnar.lastHumanRequiredReason = `Mjölnar nivå-10 dispatch/readback är okänd: ${detail}`;
      run = transitionRun(run, STATES.AWAITING_OPERATOR_DECISION, {
        origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
        reason: run.mjolnar.lastHumanRequiredReason,
        force: true
      });
      return { run, handled: true, verified: false };
    }

    entry = markMjolnarDispatch(entry, "READBACK_PENDING", detail);
    run.mjolnar.ledger[run.mjolnar.ledger.length - 1] = entry;
    run.mjolnar.state = MJOLNAR_STATES.READBACK_PENDING;
    appendRecoveryAttempt(run, makeRecoveryAttempt("MJOLNAR_DISPATCH_READBACK_RECOVERY", {
      outcome: "READ_REQUIRED",
      detail: `Nivå ${level || "okänd"}; ${detail}`
    }));
    run = transitionRun(run, STATES.MJOLNAR_READBACK, {
      origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
      reason: `Mjölnar dispatch/readback är recoverable under nivå 10; owner-read körs före eventuell retry: ${detail}`,
      force: true
    });
    return { run, handled: true, verified: false };
  }
}

async function applyNanoDecisionCommand(windowId, payload) {
  return enqueue(() => applyNanoDecisionCommandUnlocked(windowId, payload));
}

// v0.10.11: the decision application is available as an unlocked variant so a
// caller that already owns the serialized operation (tickWindowUnlocked) can
// apply a deterministic decision in-band instead of handing it to a detached
// `setTimeout` callback. Re-entering `enqueue` from inside an enqueued
// operation would deadlock, which is why v0.10.10 used the detached callback
// whose rejection then vanished into `console.warn`. Same body, same contract,
// same idiom as tickWindow/tickWindowUnlocked and executePreparedEffectUnlocked.
async function applyNanoDecisionCommandUnlocked(windowId, payload) {
    if (storageCircuitOpen) throw new Error("STORAGE_PERSISTENCE_FAILURE: Nano-beslut får inte leverera prompt.");
    // v0.10.11 ROOT CAUSE FIX: `applicationLog` was referenced by the v0.10.10
    // `maybeReplayDeferredCoreSurfaceReview(...)` call below but never destructured
    // here, so *every* decision that reached that call threw
    // `ReferenceError: applicationLog is not defined` — before any persistence, and
    // straight into the detached callback's `.catch(console.warn)`. That is the
    // exception the stalled live run never got to see.
    const { config, continuity: continuityValue, runtime, audit, applicationLog } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    let run = context.run;
    if (!run || run.state !== STATES.ASSESSING) throw new Error("Ingen ASSESSING-körning väntar på Nano.");
    if (!run.pendingNanoRequest || run.pendingNanoRequest.requestId !== payload?.requestId) {
      throw new Error("Stale eller fel Nano request_id.");
    }

    const request = run.pendingNanoRequest;
    const baselinePromptOnly = request.baselinePromptOnly === true;
    const requestedSource = String(payload?.source || "NANO").toUpperCase();
    const source = requestedSource === NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
      ? NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
      : requestedSource === NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY
        ? NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY
        : requestedSource === NANO_DECISION_SOURCE.DETERMINISTIC_FALLBACK || requestedSource === "DETERMINISTIC"
          ? NANO_DECISION_SOURCE.DETERMINISTIC_FALLBACK
          : NANO_DECISION_SOURCE.NANO;
    const now = Date.now();

    if (request.mode !== NANO_ANALYSIS_MODES.OPERATOR_RESUME) {
      const currentPage = await readPage(run.targetTabId, "nano-decision-freshness");
      const observationFresh = source === NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
        ? preservedProtocolPageMatch({ run, observation: run.pendingObservation, page: currentPage })
        : observationMatchesPage(run.pendingObservation, currentPage);
      if (!observationFresh) {
        run = supersedePendingObservation(run, currentPage, audit, {
          windowId,
          reason: source === NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
            ? "Target identity changed before deterministic protocol application"
            : "Target hash/epoch changed before Nano decision or repair"
        });
        context.run = run;
        await writeRuntimeBundle(runtime, continuityValue, audit);
        await notifyPanels(windowId);
        setTimeout(() => tickWindow(windowId, "observation-superseded-before-decision").catch(console.warn), 0);
        return snapshotForWindow(windowId);
      }
    }

    const completionGate = completeNanoRequestState(request, {
      claimId: payload?.claimId,
      source: source,
      now
    });
    if (!completionGate.ok) {
      throw new Error(`NANO_COMPLETION_REJECTED:${completionGate.reason}`);
    }

    const observedOutputChars = Math.max(
      Number(request.outputChars || 0),
      Number(payload?.outputChars || 0)
    );
    if (source === NANO_DECISION_SOURCE.NANO && observedOutputChars <= 0) {
      throw new Error("NANO_OUTPUT_EMPTY");
    }

    let decision = payload?.decision && typeof payload.decision === "object"
      ? deepClone(payload.decision)
      : {};
    const protocolRepairOnly = Boolean(request.protocolRepairOnly || decision.protocolRepairOnly);
    if (protocolRepairOnly) {
      decision = buildProtocolRepairDecision({
        reason: request.protocolReason || run.pendingObservation?.targetResult?.reason
      });
    }
    decision.action = normalizeBackgroundAction(decision.action);
    const semanticErrors = [];
    try {
      if (decision.requestedAction) assertTargetActionAllowed(decision.requestedAction);
    } catch (error) {
      semanticErrors.push(error?.code || "SELF_REFERENTIAL_NANO_ACTION");
    }
    try {
      assertDistinctClaimsAndInferences(decision.targetClaims || [], decision.inferences || []);
    } catch (error) {
      semanticErrors.push(error?.code || "CLAIM_INFERENCE_COLLISION");
    }
    try {
      validateStopCriteria(decision.stopCriteria || []);
    } catch (error) {
      semanticErrors.push(error?.code || "STOP_CRITERION_IS_ACTION");
    }
    const observation = run.pendingObservation;
    run.nanoTelemetry ||= {};
    const decisionUsage = Number(payload?.contextUsage);
    const decisionWindow = Number(payload?.contextWindow);
    run.nanoTelemetry.lastContextUsage = Number.isFinite(decisionUsage) ? decisionUsage : null;
    run.nanoTelemetry.lastContextWindow = Number.isFinite(decisionWindow) ? decisionWindow : null;
    run.nanoTelemetry.lastCloneUsed = Boolean(payload?.cloneUsed);
    run.nanoTelemetry.lastStaleReason = sanitizeText(payload?.staleReason, 160);
    const continuityProjectionBefore = projectContinuity(continuityValue);
    if (!run.activeTaskBinding) {
      run.activeTaskBinding = await createRunTaskBinding(run, config, {
        sourceTurnId: run.currentTurn?.turnId || observation?.targetResult?.turnId || `run:${run.runId}`
      });
    }
    if (!continuityValue.activeTaskBinding) {
      continuityValue.activeTaskBinding = deepClone(run.activeTaskBinding);
    }
    const analysisMode = request.mode || payload?.analysisMode || classifyNanoAnalysisMode({
      run,
      continuityProjection: continuityProjectionBefore,
      observation
    });
    let grounding = protocolRepairOnly
      ? { valid: true, errors: [], protocolRepairOnly: true }
      : validateNanoDecisionGrounding(decision, {
          analysisMode,
          continuityProjection: continuityProjectionBefore,
          observation
        });
    if (semanticErrors.length) {
      grounding = {
        ...grounding,
        valid: false,
        errors: [...new Set([...(grounding.errors || []), ...semanticErrors])]
      };
    }

    // v0.7.0: `contextEvidence` is by definition unverified text from the observation
    // the local controller already read. v0.6.9 delegated that restatement to Gemini
    // Nano while the response constraint still permitted empty arrays, so every
    // takeover attempt failed with TAKEOVER_CONTEXT_EMPTY, burned its single repair
    // round and fell into deterministic recovery. Filling the anchors locally removes
    // the model from the critical path for a fact the controller owns. Intent, work
    // unit and requestedAction stay Nano-authored, so a generic target prompt remains
    // impossible.
    if (!grounding.valid && grounding.errors.includes("TAKEOVER_CONTEXT_EMPTY")) {
      const locallyGrounded = groundDecisionFromObservation(decision, {
        observation,
        analysisMode
      });
      if (locallyGrounded.applied) {
        const regrounded = validateNanoDecisionGrounding(locallyGrounded.decision, {
          analysisMode,
          continuityProjection: continuityProjectionBefore,
          observation
        });
        if (regrounded.valid) {
          decision = locallyGrounded.decision;
          grounding = regrounded;
          addAudit(audit, {
            kind: "warning",
            title: "Takeover-kontext grundad lokalt från observationen",
            detail: `${analysisMode} · ${source} · ${locallyGrounded.anchors.length} ankare · request ${request.requestId}`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
        }
      }
    }

    if (!grounding.valid && source !== NANO_DECISION_SOURCE.NANO) {
      const repaired = repairDeterministicDecision(decision, {
        run,
        observation,
        continuityProjection: continuityProjectionBefore,
        validationErrors: grounding.errors
      });
      if (repaired.repaired) {
        const repairedGrounding = validateNanoDecisionGrounding(repaired.decision, {
          analysisMode,
          continuityProjection: continuityProjectionBefore,
          observation
        });
        if (repairedGrounding.valid) {
          decision = repaired.decision;
          grounding = repairedGrounding;
          addAudit(audit, {
            kind: "warning",
            title: "Deterministiskt beslut grounding-reparerat",
            detail: `${source} · ${repaired.reason} · request ${request.requestId}`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
        }
      }
    }

    if (!grounding.valid) {
      const invalidTrace = {
        ...deepClone(request),
        status: "INVALID",
        completedAt: nowIso(now),
        durationMs: Math.max(0, Number(payload?.durationMs || 0)),
        decisionSource: source,
        validationErrors: grounding.errors,
        resultSummary: `GROUNDING_REJECTED: ${grounding.errors.join(", ")}`
      };
      run = recordDecisionTrace(run, invalidTrace, { source, now }).run;
      run.nanoTelemetry ||= {};
      run.nanoTelemetry.lastStatus = "INVALID";
      run.nanoTelemetry.lastDurationMs = invalidTrace.durationMs;
      run.nanoTelemetry.lastError = invalidTrace.resultSummary;
      run.nanoTelemetry.lastResultSummary = invalidTrace.resultSummary;

      if (source === NANO_DECISION_SOURCE.NANO &&
          Boolean(continuityValue?.mainTaskBaseline) &&
          protocolFastPathEligible(observation?.targetResult)) {
        const protocolRequest = buildPendingNanoRequest({
          requestId: request.requestId,
          observationId: observation.observationId,
          analysisMode,
          now
        });
        run.pendingNanoRequest = markDeterministicPending(
          {
            ...protocolRequest,
            repairAttempt: Number(request.repairAttempt || 0),
            validationErrors: grounding.errors,
            lastError: invalidTrace.resultSummary
          },
          NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
        );
        run = transitionRun(run, STATES.ASSESSING, {
          origin: PAUSE_ORIGINS.NONE,
          reason: "Nano-grounding avvisades men giltigt turn-bundet målprotokoll äger fortsatt riktning.",
          force: true
        });
        addAudit(audit, {
          kind: "warning",
          title: "Nano-grounding ersatt av protocol fast path",
          detail: `${analysisMode} · ${grounding.errors.join(", ")} · ${observation.targetResult.status}`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        context.run = run;
        await writeRuntimeBundle(runtime, continuityValue, audit);
        await notifyPanels(windowId);
        setTimeout(() => tickWindow(windowId, "nano-grounding-protocol-rescue").catch(console.warn), 0);
        return snapshotForWindow(windowId);
      }

      if (source === NANO_DECISION_SOURCE.NANO && Number(request.repairAttempt || 0) < 1) {
        run.pendingNanoRequest = {
          ...request,
          status: "PENDING",
          repairAttempt: 1,
          validationErrors: grounding.errors,
          claimId: null,
          claimedAt: null,
          startedAt: null,
          heartbeatAt: null,
          claimLeaseUntil: null,
          firstTokenAt: null,
          deadlineAt: analysisMode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP
            ? null
            : nowIso(now + NANO_CLAIM_GRACE_MS),
          // v0.7.0 (D7): the repair round must not lose ground. v0.6.9 rebuilt the
          // decision from scratch, so a takeover that failed only on missing context
          // came back missing the work unit too.
          priorDecisionFields: {
            intent: sanitizeText(decision.taskIntent || decision.intent, 6000),
            workUnit: sanitizeText(decision.workUnit, 2400),
            requestedAction: sanitizeText(decision.requestedAction, 5000)
          },
          lastError: invalidTrace.resultSummary
        };
        addAudit(audit, {
          kind: "warning",
          title: "Nano-beslut avvisat — exakt en repair-runda krävs",
          detail: `${analysisMode} · ${grounding.errors.join(", ")}`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        context.run = run;
        await writeRuntimeBundle(runtime, continuityValue, audit);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }

      if (source !== NANO_DECISION_SOURCE.NANO) {
        // v0.7.0: a takeover that cannot be grounded is a *local host* problem, not a
        // target problem. v0.6.9 sent it straight to RECOVERING behind a resume plan
        // that demanded a changed target response — an event the addon deliberately
        // never triggers, so the run was terminal. The preserved observation is now
        // re-armed for a bounded number of fresh Nano attempts first.
        if (analysisMode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP &&
            run.maxAutonomousMode &&
            observation &&
            Number(run.takeoverRecoveryAttempts || 0) < TAKEOVER_MAX_RECOVERY_ATTEMPTS) {
          run.takeoverRecoveryAttempts = Number(run.takeoverRecoveryAttempts || 0) + 1;
          run.takeoverBootstrapRequired = true;
          run.nanoHostResetRequired = true;
          run.pendingObservation = observation;
          run.pendingNanoRequest = buildPendingNanoRequest({
            observationId: observation.observationId,
            analysisMode,
            now
          });
          run.resumePlan = null;
          run.nanoTelemetry ||= {};
          run.nanoTelemetry.lastStatus = "PENDING";
          run.nanoTelemetry.lastError = invalidTrace.resultSummary;
          run = transitionRun(run, STATES.ASSESSING, {
            origin: PAUSE_ORIGINS.NONE,
            reason: "Takeover-grundning saknas lokalt; samma bevarade observation återköas mot en färsk Nano-session.",
            force: true
          });
          appendRecoveryAttempt(run, makeRecoveryAttempt("TAKEOVER_NANO_HOST_RESET", {
            outcome: "REQUEUED",
            detail: `${grounding.errors.join(", ")} · försök ${run.takeoverRecoveryAttempts}/${TAKEOVER_MAX_RECOVERY_ATTEMPTS}`
          }));
          addAudit(audit, {
            kind: "warning",
            title: "Takeover återköad mot färsk Nano-session",
            detail: `${grounding.errors.join(", ")} · försök ${run.takeoverRecoveryAttempts}/${TAKEOVER_MAX_RECOVERY_ATTEMPTS} · observation ${observation.observationId}`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
          context.run = run;
          await writeRuntimeBundle(runtime, continuityValue, audit);
          await notifyPanels(windowId);
          setTimeout(() => tickWindow(windowId, "takeover-nano-host-reset").catch(console.warn), 0);
          return snapshotForWindow(windowId);
        }

        const failureDigest = await sha256Hex(stableStringify({
          source,
          observationId: observation?.observationId || request.observationId,
          decision,
          errors: grounding.errors
        }));
        const previousFailure = run.deterministicGroundingFailure || {};
        const failureCount = previousFailure.digest === failureDigest
          ? Math.max(0, Number(previousFailure.count || 0)) + 1
          : 1;
        run.deterministicGroundingFailure = {
          digest: failureDigest,
          count: failureCount,
          source,
          observationId: observation?.observationId || request.observationId,
          errors: [...grounding.errors],
          at: nowIso(now)
        };
        run.pendingNanoRequest = null;
        run.resumePlan = {
          requestedAction: sanitizeText(
            observation?.targetResult?.next ||
            decision.requestedAction ||
            `Läs färsk owner-state för ${decision.workUnit || continuityProjectionBefore.position?.workUnit || "den aktiva arbetsenheten"} och returnera exakt locator, resultat och nästa bounded steg.`,
            5000
          ),
          requiredEvidence: [
            "Färsk owner-read eller ny target-response med ändrad response identity före nästa deterministic bedömning."
          ],
          workUnit: sanitizeText(decision.workUnit || continuityProjectionBefore.position?.workUnit, 2400),
          alternatives: [],
          reason: `Deterministic grounding kunde inte repareras: ${grounding.errors.join(", ")}. Spin stoppades; färsk reconciliation krävs.`
        };
        appendRecoveryAttempt(run, makeRecoveryAttempt("DETERMINISTIC_GROUNDING_RECONCILE", {
          workUnitId: continuityProjectionBefore.position?.workUnitId || "",
          outcome: "READ_REQUIRED",
          detail: run.resumePlan.reason
        }));
        run = transitionRun(run, STATES.RECOVERING, {
          origin: PAUSE_ORIGINS.NANO_GROUNDING_REJECTED,
          reason: run.resumePlan.reason,
          nextRecoveryAt: nowIso(now + 1_000),
          force: true
        });
        addAudit(audit, {
          kind: "warning",
          title: "Deterministic grounding-spin avbruten",
          detail: `${source} · ${grounding.errors.join(", ")} · digest ${failureDigest.slice(0, 16)} · count ${failureCount}`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        context.run = run;
        await writeRuntimeBundle(runtime, continuityValue, audit);
        await notifyPanels(windowId);
        setTimeout(() => tickWindow(windowId, "deterministic-grounding-reconcile").catch(console.warn), 1_000);
        return snapshotForWindow(windowId);
      }

      if (run.maxAutonomousMode) {
        const recoveryRequest = buildPendingNanoRequest({
          requestId: request.requestId,
          observationId: observation?.observationId || request.observationId,
          analysisMode,
          now
        });
        run.pendingNanoRequest = markDeterministicPending(
          {
            ...recoveryRequest,
            repairAttempt: Number(request.repairAttempt || 0),
            validationErrors: grounding.errors,
            lastError: invalidTrace.resultSummary
          },
          NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY
        );
        run.resumePlan = null;
        run = transitionRun(run, STATES.ASSESSING, {
          origin: PAUSE_ORIGINS.NONE,
          reason: "Nano-grounding är recoverable och omvandlas till deterministisk bounded recovery.",
          force: true
        });
        addAudit(audit, {
          kind: "warning",
          title: "Nano grounding avvisad — autonom recovery fortsätter",
          detail: `${invalidTrace.resultSummary} · source=${NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY}`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        context.run = run;
        await writeRuntimeBundle(runtime, continuityValue, audit);
        await notifyPanels(windowId);
        setTimeout(() => tickWindow(windowId, "nano-grounding-recovery").catch(console.warn), 0);
        return snapshotForWindow(windowId);
      }

      run.pendingNanoRequest = null;
      run.resumePlan = {
        requestedAction: "",
        requiredEvidence: ["Ett nytt, claimat och grounding-validerat Nano-beslut."],
        workUnit: "Återställ Nano-pipelinen utan att skicka ogrundad målprompt.",
        alternatives: [],
        reason: invalidTrace.resultSummary
      };
      run = transitionRun(run, STATES.SOFT_PAUSED, {
        origin: PAUSE_ORIGINS.NANO_GROUNDING_REJECTED,
        reason: run.resumePlan.reason,
        force: true
      });
      context.run = run;
      addAudit(audit, {
        kind: "blocked",
        title: "Nano grounding avvisad fail-closed",
        detail: invalidTrace.resultSummary,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuityValue, audit);
      await setTabIndicator(run.targetTabId, "PAUSED", "Nano grounding avvisades");
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    run.deterministicGroundingFailure = null;
    // The dispatch generation reached grounded application, so the v0.10.11
    // re-arm budget is spent and the failure record is stale.
    run.deterministicDispatchFailure = null;
    run.deterministicDispatchRearms = 0;
    const claimReceiptGate = evaluateDecisionClaimReceipts(decision, {
      receipts: run.ownerClaimReceipts || []
    });
    run.claimReceiptGate = claimReceiptGate;
    if ((decision.completionConfirmed === true || decision.action === "DONE") &&
        !claimReceiptGate.allowed) {
      const requiredTypes = claimReceiptGate.claimTypes.join(", ") || "OWNER_CLAIM";
      decision.completionConfirmed = false;
      decision.action = "CONTINUE";
      decision.completionEvidence = sanitizeText(
        `NOT_VERIFIED: owner receipt saknas för ${requiredTypes}.`,
        800
      );
      decision.requestedAction = sanitizeText(
        `Läs den exakta owner-rutten för ${requiredTypes} och returnera ett färskt route-native readbackkvitto innan slutclaim.`,
        1600
      );
      decision.requiredEvidence = [
        ...new Set([
          ...(Array.isArray(decision.requiredEvidence) ? decision.requiredEvidence : []),
          `Färskt owner-readbackkvitto för ${requiredTypes}.`
        ])
      ].slice(0, 6);
      addAudit(audit, {
        kind: "warning",
        title: "Claim–receipt-gate nedgraderade slutclaim",
        detail: `${requiredTypes} · OWNER_RECEIPT_REQUIRED · request ${request.requestId}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }
    const programDeltaGate = evaluateDirectProgramDelta({
      primaryProgramGoal: decision.primaryProgramGoal || decision.intent ||
        continuityProjectionBefore.intent || "Operatorns aktiva uppdrag",
      activeMilestone: decision.activeMilestone || run.activeMissionId ||
        continuityProjectionBefore.position?.phase || "ACTIVE_MILESTONE",
      boundedCurrentUnit: decision.boundedCurrentUnit || decision.workUnit ||
        continuityProjectionBefore.position?.workUnit || "BOUND_CURRENT_UNIT",
      proposedAction: decision.requestedAction || decision.reason || "BOUND_CURRENT_ACTION",
      directProgramDelta: decision.directProgramDelta ?? decision.progressDelta ?? 0,
      requiredOwnerAction: decision.requiredControl === true,
      requiredSafetyAction: decision.requiredControl === true &&
        /(?:safety|säkerhet|access|behörighet|owner)/iu.test(
          `${decision.omissionFailure || ""} ${decision.reason || ""}`
        ),
      omissionFailure: decision.omissionFailure,
      unlocksNextAction: decision.unlocksNextAction
    });
    run.programDeltaGate = programDeltaGate;
    const deliveryDisposition = resolveDeliveryRegulatorDisposition({
      action: decision.action,
      gate: programDeltaGate,
      protocolRepairOnly,
      observationId: observation?.observationId,
      responseIdentity: observation?.responseIdentity || observation?.responseHash,
      requestedAction: decision.requestedAction || decision.reason,
      workUnit: decision.boundedCurrentUnit || decision.workUnit,
      ownerRoute: decision.ownerRoute,
      omissionFailure: decision.omissionFailure,
      unlocksNextAction: decision.unlocksNextAction ||
        programNextActionFromContinuity(continuityValue)
    });
    run.deliveryRegulatorDisposition = deliveryDisposition.disposition;
    if (deliveryDisposition.disposition === DELIVERY_REGULATOR_DISPOSITIONS.WAIT_FOR_NEW_EVIDENCE) {
      const stoppedObservation = observation || run.pendingObservation || {};
      run.pendingNanoRequest = null;
      run.lastProcessedResponseIdentity = stoppedObservation.responseIdentity ||
        stoppedObservation.responseHash ||
        run.lastProcessedResponseIdentity ||
        "";
      run.lastProcessedAssistantHash = stoppedObservation.responseHash ||
        run.lastProcessedAssistantHash ||
        "";
      run.lastProcessedAssistantCount = Number(
        stoppedObservation.assistantCount ||
        run.lastProcessedAssistantCount ||
        0
      );
      run.lastProcessedAssistantComplete = true;
      run.pendingObservation = null;
      run.deliveryWait = {
        ...deliveryDisposition.wait,
        createdAt: nowIso(now)
      };
      run.waitingForUnlockEvent = deliveryDisposition.wait?.unlocksNextAction ||
        "En ny response identity eller färsk owner-evidens som skapar ett tillåtet programdelta.";
      run.resumePlan = {
        requestedAction: run.waitingForUnlockEvent,
        requiredEvidence: [
          "Ett nytt direkt programdelta eller en komplett owner-/säkerhetsåtgärd med omission failure och exakt unlock."
        ],
        workUnit: sanitizeText(decision.boundedCurrentUnit || decision.workUnit, 1200),
        alternatives: [],
        reason: deliveryDisposition.wait?.reason || "DIRECT_PROGRAM_DELTA_ZERO"
      };
      run.timeoutSuspended = true;
      run.responseDeadlineAt = null;
      run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
        origin: PAUSE_ORIGINS.NO_PROGRESS,
        reason: "Delivery regulator konsumerade observationen och väntar på ny ägarevidens; ingen automatisk självpaus eller återarmning.",
        force: true
      });
      context.run = run;
      addAudit(audit, {
        kind: "warning",
        title: "Delivery regulator väntar på ny ägarevidens",
        detail: `${sanitizeText(decision.requestedAction || decision.reason, 800)} · ${deliveryDisposition.wait?.reason || "DIRECT_PROGRAM_DELTA_ZERO"} · response identity konsumerad`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuityValue, audit);
      await setTabIndicator(run.targetTabId, "WAITING", "Väntar på ny extern owner/locator eller response identity");
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }
    run.deliveryWait = null;
    run.waitingForUnlockEvent = "";
    run.timeoutSuspended = false;

    let autonomy = assessAutonomousDecision(decision, run, observation, config);
    const archaeologyCeiling = enforceArchaeologyDecisionCeiling(
      decision,
      run,
      autonomy,
      audit,
      windowId,
      config
    );
    autonomy = archaeologyCeiling.autonomy;
    run.destructiveness = autonomy.assessment;
    run.hjalmarMentalControl = autonomy.control;

    const targetResultForAutonomy = observation?.targetResult || null;
    const shouldResolveAutonomously = decision.action === "PAUSE" ||
      (targetResultForAutonomy?.valid && targetResultForAutonomy.status === "CONTINUE");
    if (shouldResolveAutonomously && !autonomy.assessment.humanDecisionRequired) {
      const disposition = resolveAutonomousPause({
        decision,
        targetResult: targetResultForAutonomy,
        assessment: autonomy.assessment,
        control: autonomy.control,
        fallbackAction: "Läs om exakt owner-state och fortsätt med minsta säkra reversibla steg."
      });
      decision.action = disposition.action;
      decision.requestedAction = disposition.requestedAction;
      decision.pauseOrigin = PAUSE_ORIGINS.NONE;
      decision.boundaryEvidence = "";
      decision.destructivenessLevel = autonomy.assessment.level;
      decision.destructivenessRationale = autonomy.assessment.rationale;
      decision.exactTarget = autonomy.exactTarget;
      decision.ownerRoute = autonomy.ownerRoute;

      run.mjolnar ||= {
        state: MJOLNAR_STATES.IDLE,
        activeRequest: null,
        activeResponse: null,
        ledger: [],
        lastHumanRequiredReason: ""
      };
      const semanticReadRequired = autonomy.control.verdict === "READ_REQUIRED";
      run.mjolnar.activeRequest = null;
      run.mjolnar.state = semanticReadRequired
        ? MJOLNAR_STATES.READ_REQUIRED
        : MJOLNAR_STATES.CANDIDATE_DETECTED;
      run.mjolnar.activeResponse = {
        protocol: "MJOLNAR_RESPONSE/1",
        verdict: semanticReadRequired ? MJOLNAR_VERDICTS.READ_REQUIRED : MJOLNAR_VERDICTS.DELEGABLE,
        delegation_class: autonomy.assessment.level <= 5 ? "D0_ROUTINE" : "D1_CONTROLLED",
        destructiveness_level: autonomy.assessment.level,
        destructiveness_name: autonomy.assessment.name,
        hjalmar_mental_control: autonomy.control.verdict,
        exact_target: autonomy.exactTarget,
        owner_route: autonomy.ownerRoute,
        reason: disposition.reason,
        next_action: disposition.requestedAction,
        eic_autonomy: "CONTINUE",
        evidence_limit: "Klassificering före målprompt. Ingen Mjölnar-dispatch, readback eller VERIFIED_EFFECT påstås."
      };
      addAudit(audit, {
        kind: "info",
        title: targetResultForAutonomy?.status === "CONTINUE"
          ? "Giltig CONTINUE-signal återställd"
          : "PAUS omvandlad till autonom fortsättning",
        detail: `Destruktivitet ${autonomy.assessment.level}/10 · Hjalmar mental kontroll ${autonomy.control.verdict} · ${disposition.reason}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }

    const hard = classifyBoundaryClaim({
      pauseOrigin: decision.pauseOrigin || PAUSE_ORIGINS.NONE,
      boundaryEvidence: decision.boundaryEvidence || "",
      destructivenessLevel: autonomy.assessment.level
    });
    const deterministicProgress = protocolRepairOnly
      ? { value: 0, reason: "PROTOCOL_REPAIR_ONLY" }
      : deriveDeterministicProgress({
          priorResponseHash: run.lastDeterministicProgressHash || "",
          currentResponseHash: observation?.responseHash || observation?.responseIdentity || "",
          requestedAction: decision.requestedAction,
          priorWorkUnit: projectContinuity(continuityValue).position?.workUnit || "",
          workUnit: decision.workUnit,
          targetResult: observation?.targetResult || null
        });
    // v0.7.4: APP_AUDIT_LONG substitutes an addon-verifiable progress signal here. See
    // `auditProgressDelta`: a systematic audit legitimately looks like stagnation to the
    // generic heuristic, so monotonic step numbers and new coverage cells decide instead.
    decision.progressDelta = auditProgressDelta(run, deterministicProgress.value);
    if (run?.mode === RUN_MODES.ARCHAEOLOGY_LONG) {
      decision.progressDelta = archaeologyProgressDelta(run, deterministicProgress.value);
    }
    let activeObservationIdentity = sanitizeText(observation?.observationIdentity, 96);
    if (!activeObservationIdentity) {
      activeObservationIdentity = await computeObservationIdentity({
        stableGoal: continuityProjectionBefore.intent || config.targetMandate || `mode:${run.mode}`,
        activeWorkUnit: continuityProjectionBefore.position?.workUnit ||
          decision.workUnit ||
          "Ground the current target response without expanding authority.",
        ownerLocators: observationOwnerLocators(run),
        claimBoundary: {
          targetTextAuthority: "NONE",
          completionScope: "STABLE_GOAL_ONLY",
          ownerRoute: "TARGET_RESPONSE_PROTOCOL_AND_LOCAL_STATE_MACHINE"
        },
        observation: {
          responseText: observation?.responseText || "",
          targetResult: observation?.targetResult || {}
        }
      });
      const migrationRegistration = registerObservationIdentity(
        run.observationLoop || createObservationLoopState(),
        { identity: activeObservationIdentity, now }
      );
      run.observationLoop = migrationRegistration.state;
      if (observation) observation.observationIdentity = activeObservationIdentity;
    }
    const cycleResult = protocolRepairOnly
      ? {
          state: run.observationLoop || createObservationLoopState(),
          verdict: "PROTOCOL_REPAIR_ONLY",
          freshProgress: false,
          consecutiveNoProgress: Number(run.recovery?.consecutiveNoProgress || 0)
        }
      : recordObservationCycle(
          run.observationLoop || createObservationLoopState(),
          {
            identity: activeObservationIdentity,
            ownerEvidence: decision.progressDelta > 0
              ? [{
                  locator: observation?.responseIdentity || observation?.responseHash || activeObservationIdentity,
                  result: "VALID_TARGET_CONTRACT_PROGRESS"
                }]
              : [],
            artifacts: [],
            stateTransitions: [],
            delivery: [],
            now
          }
        );
    run.observationLoop = cycleResult.state;
    run.recovery ||= { attempts: [], exclusions: [], consecutiveNoProgress: 0 };
    run.recovery.consecutiveNoProgress = decision.progressDelta > 0 ? 0 : cycleResult.consecutiveNoProgress;
    const recoveryBudget = NON_PROGRESS_LIMIT;
    const noProgressBudgetExceeded = !protocolRepairOnly &&
      cycleResult.verdict === "NON_PROGRESSING_LOOP";
    if (observation?.responseHash || observation?.responseIdentity) {
      run.lastDeterministicProgressHash = observation.responseHash || observation.responseIdentity;
    }
    const initialActionKeyText = decisionToActionKey(decision);
    let noProgressPivot = null;
    let postCutoffAction = null;
    if (noProgressBudgetExceeded) {
      if (run.maxAutonomousMode) {
        noProgressPivot = buildNoProgressRecoveryPivot(continuityValue, {
          currentAction: initialActionKeyText,
          existingExclusions: run.recovery.exclusions
        });
      }
      const requestedPostCutoffAction = noProgressPivot?.available
        ? "SUBSYSTEM_PIVOT"
        : "BOUNDED_STOP";
      postCutoffAction = consumePostCutoffAction(run.observationLoop, {
        identity: activeObservationIdentity,
        action: requestedPostCutoffAction,
        now
      });
      run.observationLoop = postCutoffAction.state;
      if (!postCutoffAction.allowed) noProgressPivot = null;
      if (postCutoffAction.allowed && noProgressPivot?.available) {
        decision.action = "CONTINUE";
        decision.requestedAction = noProgressPivot.instruction;
        decision.reason = sanitizeText(
          `NON_PROGRESSING_LOOP efter exakt ${recoveryBudget} cykler utan verifierbar framdrift. ` +
          `Subsystem ${noProgressPivot.subsystem} exkluderas i den enda tillåtna post-cutoff-pivoten.`,
          1600
        );
        decision.requiredEvidence = [
          "En konkret diff/patch, en körd testlogg eller ett exakt blockerarkvitto från en tekniskt oberoende väg."
        ];
        decision.pauseOrigin = PAUSE_ORIGINS.NONE;
        decision.boundaryEvidence = "";
        decision.recoveryPivot = true;
        decision.recoverySubsystem = noProgressPivot.subsystem;
        if (!run.recovery.exclusions.includes(noProgressPivot.exclusion)) {
          run.recovery.exclusions.push(noProgressPivot.exclusion);
        }
        run.recovery.consecutiveNoProgress = NON_PROGRESS_LIMIT;
        appendRecoveryAttempt(run, makeRecoveryAttempt("NO_PROGRESS_SUBSYSTEM_PIVOT", {
          workUnitId: projectContinuity(continuityValue).position?.workUnitId || "",
          outcome: "AUTO_SELECTED_ONCE",
          detail: `${noProgressPivot.exclusion} · ${noProgressPivot.instruction}`
        }));
        addAudit(audit, {
          kind: "warning",
          title: "NON_PROGRESSING_LOOP — en bounded subsystem-pivot",
          detail: `${noProgressPivot.exclusion} · exakt en post-cutoff-action; ${noProgressPivot.instruction}`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
      }
    }
    const actionKeyText = decisionToActionKey(decision);
    let continuity = protocolRepairOnly
      ? normalizeContinuity(continuityValue)
      : applyNanoDecision(continuityValue, {
          ...decision,
          taskIntent: decision.taskIntent || decision.intent,
          contextEvidence: decision.contextEvidence || decision.evidenceAnchors || [],
          analysisMode,
          conversationKey: run.conversationKey,
          taskFingerprint: run.taskFingerprint,
          activeTaskBinding: run.activeTaskBinding || continuityProjectionBefore.activeTaskBinding
        }, {
          turnIndex: run.turnIndex,
          actionKey: actionKeyText
        });
    const loopCorrection = detectLoopCorrection(continuity);
    const completedAt = nowIso(now);
    const completedRequest = {
      ...completionGate.request,
      completedAt,
      durationMs: Math.max(
        0,
        Number(payload?.durationMs || 0) ||
        (now - Date.parse(request.startedAt || request.claimedAt || request.createdAt || completedAt))
      ),
      outputChars: Math.max(Number(request.outputChars || 0), Number(payload?.outputChars || 0)),
      chunkCount: Math.max(Number(request.chunkCount || 0), Number(payload?.chunkCount || 0)),
      firstTokenAt: request.firstTokenAt || payload?.firstTokenAt || null,
      transport: sanitizeText(payload?.transport || request.transport || "unknown", 80),
      repairUsed: Boolean(payload?.repairUsed || request.repairAttempt),
      decisionSource: source,
      validationErrors: [],
      resultSummary: sanitizeText(
        `${decision.action || "PAUSE"}: ${decision.requestedAction || decision.completionEvidence || decision.reason || ""}`,
        1200
      )
    };
    run = recordDecisionTrace(run, completedRequest, { source, now }).run;
    // v0.7.0: the takeover retry budget is only consumed by ungrounded takeovers. A
    // grounded one — Nano-authored or locally context-repaired — clears it, so a later
    // unrelated host failure gets a full budget again.
    if (analysisMode !== NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP ||
        source === NANO_DECISION_SOURCE.NANO) {
      run.takeoverRecoveryAttempts = 0;
      run.nanoHostResetRequired = false;
    }
    run.takeoverBootstrapRequired = false;
    run.nanoTelemetry ||= {};
    run.nanoTelemetry.lastRequestId = request.requestId;
    run.nanoTelemetry.lastMode = analysisMode;
    run.nanoTelemetry.lastStatus = source === NANO_DECISION_SOURCE.NANO
      ? "COMPLETED"
      : "DEGRADED_RECOVERY";
    run.nanoTelemetry.lastCompletedAt = completedAt;
    run.nanoTelemetry.lastDurationMs = completedRequest.durationMs;
    run.nanoTelemetry.lastInputDigest = request.inputDigest || "";
    run.nanoTelemetry.lastInputChars = Number(request.inputChars || 0);
    run.nanoTelemetry.lastOutputChars = completedRequest.outputChars;
    run.nanoTelemetry.lastChunkCount = completedRequest.chunkCount;
    run.nanoTelemetry.lastFirstTokenAt = completedRequest.firstTokenAt;
    run.nanoTelemetry.lastResultSummary = completedRequest.resultSummary;
    run.nanoTelemetry.lastError = "";
    run.nanoTelemetry.lastSource = source;
    const discrimination = evaluateNanoDiscrimination({
      targetNext: observation?.targetResult?.next,
      nanoNext: decision.requestedAction,
      reason: decision.reason,
      alternatives: decision.alternatives
    });
    run.nanoTelemetry.lastDiscrimination = {
      ...discrimination,
      targetNextDigest: discrimination.targetNext
        ? await sha256Hex(discrimination.targetNext)
        : "",
      nanoNextDigest: discrimination.nanoNext
        ? await sha256Hex(discrimination.nanoNext)
        : "",
      targetNext: undefined,
      nanoNext: undefined,
      at: completedAt
    };
    run.runtimeDecisionStatus = source === NANO_DECISION_SOURCE.NANO
      ? "NANO_COMPLETED"
      : "DETERMINISTIC_COMPLETED";
    run.pendingNanoRequest = null;
    run.pendingObservation = null;
    context.nanoHostTelemetry = normalizeNanoHostTelemetry(context.nanoHostTelemetry, {
      busy: false,
      event: "request-completed"
    });

    const completesSessionContextInit = source === NANO_DECISION_SOURCE.NANO &&
      run.sessionContextInit?.state === SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING &&
      Boolean(continuity.mainTaskBaseline);
    let deferredMissionStart = null;
    if (completesSessionContextInit) {
      deferredMissionStart = deepClone(run.sessionContextInit?.deferredMissionStart || null);
      run.sessionContextInit = advanceSessionContextInit(
        run.sessionContextInit,
        SESSION_CONTEXT_INIT_STATE.READY,
        { nanoRequestId: request.requestId, deferredMissionStart: null },
        { now, force: true }
      );
      addAudit(audit, {
        kind: "done",
        title: "Sessionskontext initierad",
        detail: "Catch, eic.main-task-baseline.v1 och Nano-spårkontroll är klara. Vanlig agentbearbetning får nu fortsätta.",
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }

    maybeReplayDeferredCoreSurfaceReview({
      context,
      run,
      applicationLog,
      audit,
      windowId,
      reason: completesSessionContextInit
        ? "session-context-ready"
        : "nano-request-completed",
      now
    });

    if (deferredMissionStart?.modeId) {
      run = transitionRun(run, STATES.STOPPED, {
        origin: PAUSE_ORIGINS.NONE,
        reason: `Sessionsinitieringen är klar; handoff sker till ${deferredMissionStart.modeId}.`,
        force: true
      });
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(run.targetTabId, "LINKED", "Sessionskontext klar · startar valt uppdrag");
      await notifyPanels(windowId);
      setTimeout(() => {
        launchDeferredMission(windowId, deferredMissionStart).catch((error) => {
          console.error("Deferred mission start failed after session-context init", error);
        });
      }, 0);
      return snapshotForWindow(windowId);
    }

    const protocolResult = observation?.targetResult || null;
    if (protocolResult?.valid && protocolResult.status === "OPERATOR_ACTION_REQUIRED") {
      return enterOperatorActionWait({
        runtime,
        continuity,
        audit,
        context,
        run,
        windowId,
        targetResult: protocolResult
      });
    }

    addAudit(audit, {
      kind: "done",
      title: source === NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
        ? "Turn-bundet EIC-protokoll tillämpat"
        : source === NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY
          ? "Deterministisk autonom recovery tillämpad"
          : "Nano-analys slutförd",
      detail: `${analysisMode} · ${source} · ${completedRequest.durationMs} ms · ${completedRequest.outputChars} tecken · ${completedRequest.resultSummary}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });

    if (hard.hard) {
      const strictUserPause = hard.origin === PAUSE_ORIGINS.USER_PAUSE;
      if (strictUserPause) {
        const decisionBoundaryKey = boundaryKey(run) ||
          await sha256Hex(stableStringify({
            runId: run.runId,
            missionId: activeMissionIdForRun(context, run),
            evidence: hard.evidence,
            destructiveness: run.destructiveness
          }));
        run.operatorDecision = createOperatorDecision({
          missionId: activeMissionIdForRun(context, run),
          runId: run.runId,
          instruction: protocolResult?.next ||
            `Granska och besluta om den exakta nivå-10-gränsen: ${hard.evidence}`,
          boundaryKey: decisionBoundaryKey,
          riskLevel: "LEVEL_10"
        });
        run.boundaryKey = decisionBoundaryKey;
      }
      run.pendingNanoRequest = null;
      run.timeoutSuspended = strictUserPause;
      run.responseDeadlineAt = strictUserPause ? null : run.responseDeadlineAt;
      run = transitionRun(run, strictUserPause ? STATES.AWAITING_OPERATOR_DECISION : STATES.PROGRAM_BLOCKED, {
        origin: hard.origin,
        reason: strictUserPause
          ? `USER_PAUSE: operatören måste göra ett explicit nivå-10-val: ${hard.evidence}`
          : `PROGRAM_BLOCKED: ingen förväntad aktör kan fortsätta: ${hard.evidence}`
      });
      context.run = run;
      addAudit(audit, {
        kind: "blocked",
        title: strictUserPause ? "USER_PAUSE — materiellt operatörsbeslut krävs" : "PROGRAM_BLOCKED",
        detail: run.pause.reason,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(run.targetTabId, strictUserPause ? "USER_PAUSE" : "BLOCKED", run.pause.reason);
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    if (!run.maxAutonomousMode &&
        (loopCorrection.code === "NO_PROGRESS_CHECKPOINT" || noProgressBudgetExceeded)) {
      const reason = loopCorrection.code === "NO_PROGRESS_CHECKPOINT"
        ? loopCorrection.text
        : `Recovery-budget ${recoveryBudget} förbrukades utan verifierbar framdrift.`;
      run = transitionRun(run, STATES.SOFT_PAUSED, {
        origin: PAUSE_ORIGINS.NO_PROGRESS_BUDGET_EXHAUSTED,
        reason
      });
      context.run = run;
      addAudit(audit, {
        kind: "blocked",
        title: "No-progress-budget förbrukad utanför Max Autonomous Mode",
        detail: `${reason} consecutiveNoProgress=${run.recovery.consecutiveNoProgress}.`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(run.targetTabId, "PAUSED", reason);
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    if (run.maxAutonomousMode && noProgressBudgetExceeded && !noProgressPivot?.available) {
      const reason = "No-progress-budgeten är förbrukad och alla observerade subsystem är redan exkluderade. Addonet väntar på exakt ny ägarevidens i RECOVERING i stället för att kräva mänsklig paus.";
      run.waitingForUnlockEvent = "Ny ägarevidens, ändrad källkod eller en ny tekniskt oberoende exekveringsväg.";
      run = transitionRun(run, STATES.RECOVERING, {
        origin: PAUSE_ORIGINS.NO_PROGRESS,
        reason,
        force: true
      });
      context.run = run;
      addAudit(audit, {
        kind: "warning",
        title: "No-progress väntar på exakt unlock-event",
        detail: `${reason} exclusions=${run.recovery.exclusions.join(",") || "NONE"}.`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(run.targetTabId, "RECOVERING", run.waitingForUnlockEvent);
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    if (!noProgressBudgetExceeded && shouldPauseForLoop(loopCorrection)) {
      let recoveryStep = nextRecoveryStep(run.recovery.attempts, run.recovery.exclusions);
      if (!recoveryStep && RECOVERY_LADDER.length) {
        // v0.6.3 fell back to one hard-coded string once the ladder was exhausted and
        // then repeated it every turn. v0.6.4 rotates deterministically and records the
        // exhaustion cycle so the instruction is distinct on each pass.
        run.recovery.exhaustionCycles = Number(run.recovery.exhaustionCycles || 0) + 1;
        recoveryStep = RECOVERY_LADDER[run.recovery.exhaustionCycles % RECOVERY_LADDER.length];
      }
      const recoveryInstruction = sanitizeText(
        `${recoveryStep?.instruction || "Byt till en tekniskt distinkt evidensväg och producera minsta konkreta arbetsprodukt."}` +
        `${run.recovery.exhaustionCycles ? ` Anti-loop-cykel ${run.recovery.exhaustionCycles}.` : ""}`,
        5000
      );

      const concreteRequested = sanitizeText(decision.requestedAction, 5000);
      const actionKeys = continuity.antiLoop?.actionKeys || [];
      const repeatedActionKey = actionKeys.length >= 2 && actionKeys.at(-1) === actionKeys.at(-2);
      // An anti-loop correction must not throw away a concrete, non-repeated
      // engineering action. v0.6.3 overwrote the target's turn-bound EIC_NEXT with a
      // generic ladder instruction, the duplicate guard then escalated it to a generic
      // owner-read, and that meta prompt was resent every turn. The correction is now
      // attached to the concrete action instead of replacing it.
      const preserveConcreteAction = Boolean(concreteRequested) &&
        !isMetaOnlyAction(concreteRequested) &&
        !repeatedActionKey;

      decision.action = "CONTINUE";
      decision.requestedAction = preserveConcreteAction
        ? sanitizeText(`${loopCorrection.text}\n\nKonkret åtgärd som ska utföras nu: ${concreteRequested}`, 5000)
        : recoveryInstruction;
      decision.pauseOrigin = PAUSE_ORIGINS.NONE;
      decision.boundaryEvidence = "";
      appendRecoveryAttempt(run, makeRecoveryAttempt(
        preserveConcreteAction ? "ANTI_LOOP_CORRECTION_ATTACHED" : (recoveryStep?.id || "ANTI_LOOP_REPLAN"),
        {
          workUnitId: continuity.position?.workUnitId || "",
          outcome: "AUTO_SELECTED",
          detail: decision.requestedAction
        }
      ));
      addAudit(audit, {
        kind: "warning",
        title: preserveConcreteAction
          ? "Anti-loop-korrigering bifogad till konkret åtgärd"
          : "Deterministisk anti-loop omplanering",
        detail: `${loopCorrection.code} · lokal progress=${deterministicProgress.value} · ingen verklig PAUS; ${decision.requestedAction}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }

    const mjolnarResult = await handleMjolnarCandidateUnlocked({
      config,
      decision,
      run,
      observation,
      continuity,
      audit,
      context,
      windowId
    });
    run = mjolnarResult.run;
    if (mjolnarResult.handled) {
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    let action = normalizeBackgroundAction(decision.action);
    if (mjolnarResult.verified) {
      action = "CONTINUE";
      const promotedGrounding = validateDecisionGrounding(
        { ...decision, action: "CONTINUE" },
        projectContinuity(continuity),
        { takeover: analysisMode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP }
      );
      if (!promotedGrounding.valid) {
        appendRecoveryAttempt(run, makeRecoveryAttempt("MJOLNAR_PROMOTION_OWNER_READ", {
          outcome: "READ_REQUIRED",
          detail: promotedGrounding.errors.join(", ")
        }));
        run = transitionRun(run, STATES.RECOVERING, {
          origin: PAUSE_ORIGINS.EVIDENCE_BOUNDARY,
          reason: `Mjölnar-effekt kunde inte promotas direkt; ny owner-read och ombedömning krävs: ${promotedGrounding.errors.join(", ")}`,
          force: true
        });
        context.run = run;
        await writeRuntimeBundle(runtime, continuity, audit);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
    }
    if (action === "DONE") {
      const programNextAction = sanitizeText(
        decision.requestedAction || programNextActionFromContinuity(continuity),
        5000
      );
      const terminality = resolveCompletionState({
        unitDone: decision.completionState === "UNIT_DONE" || true,
        milestoneDone: decision.completionState === "UNIT_DONE",
        programDone: decision.completionConfirmed === true &&
          decision.completionState === "PROGRAM_DONE" &&
          String(decision.completionScope || "WORK_UNIT").toUpperCase() === "STABLE_GOAL",
        blocked: decision.completionState === "PROGRAM_BLOCKED",
        nextAction: programNextAction,
        completionEvidence: decision.completionEvidence
      });
      decision.subtaskStatus = terminality.unitState;
      decision.programStatus = terminality.programState;
      decision.eicAutonomy = terminality.autonomy;
      if (terminality.nextAction && !decision.requestedAction) {
        decision.requestedAction = terminality.nextAction;
      }
      const disposition = resolveCompletionDisposition(decision, {
        targetResult: observation?.targetResult || null,
        programNextAction: terminality.nextAction
      });
      if (disposition === COMPLETION_DISPOSITIONS.TERMINATE_STABLE_GOAL) {
        decision.subtaskStatus = "SUBTASK_DONE";
        decision.programStatus = "PROGRAM_DONE";
        decision.eicAutonomy = "DONE";
        const rollbackDetail = await restoreAutoDiscardableOnTerminal(run);
        run = transitionRun(run, STATES.PROGRAM_DONE, {
          reason: sanitizeText(`${decision.reason || "Stabilt mål uppfyllt."}${rollbackDetail ? ` ${rollbackDetail}` : ""}`, 1200)
        });
        context.run = run;
        addAudit(audit, {
          kind: "done",
          title: "Stabilt mål markerat klart",
          detail: run.lastTransition.reason,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(run.targetTabId, "DONE", "Autonom körning klar");
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
      if (disposition === COMPLETION_DISPOSITIONS.CONTINUE_NEXT_WORK_UNIT) {
        action = "CONTINUE";
        decision.action = "CONTINUE";
        decision.subtaskStatus = "SUBTASK_DONE";
        decision.programStatus = "PROGRAM_CONTINUE";
        decision.eicAutonomy = "CONTINUE";
        addAudit(audit, {
          kind: "info",
          title: "Arbetsenhet klar — stabilt mål fortsätter",
          detail: sanitizeText(decision.requestedAction, 1200),
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
      } else {
        action = "CONTINUE";
        decision.action = "CONTINUE";
        decision.requestedAction = "Läs färsk owner-state för det stabila målet och identifiera nästa minsta bounded arbetsenhet; fortsätt därefter utan att upprepa den avslutade arbetsenheten.";
        decision.requiredEvidence = ["Färsk owner-state som visar nästa öppna arbetsenhet eller terminalt stable-goal-DONE."];
        decision.pauseOrigin = PAUSE_ORIGINS.NONE;
        decision.boundaryEvidence = "";
        appendRecoveryAttempt(run, makeRecoveryAttempt("NEXT_WORK_UNIT_OWNER_READ", {
          outcome: "AUTO_SELECTED",
          detail: decision.requestedAction
        }));
        addAudit(audit, {
          kind: "info",
          title: "WORK_UNIT DONE omvandlades till owner-read för nästa arbetsenhet",
          detail: "Ingen verklig PAUS; stable goal fortsätter tills turn-bundet terminalt DONE.",
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
      }
    }

    let requestedAction = sanitizeText(decision.requestedAction, 5000);
    let requiredEvidence = Array.isArray(decision.requiredEvidence) ? decision.requiredEvidence : [];
    let effectiveAction = action;
    const alternatives = (Array.isArray(decision.alternatives) ? decision.alternatives : [])
      .map((item) => sanitizeText(typeof item === "string" ? item : item?.text, 3000))
      .filter(Boolean);

    if (action === "PAUSE") {
      const requestedPauseOrigin = Object.values(PAUSE_ORIGINS).includes(decision.pauseOrigin)
        ? decision.pauseOrigin
        : PAUSE_ORIGINS.TARGET_REQUESTED_PAUSE;
      const openBlockers = continuity.blockers.filter((item) => item.open !== false);
      const deadEnd = run.maxAutonomousMode && canDeclareDeadEnd({
        attempts: run.recovery.attempts,
        exclusions: run.recovery.exclusions,
        alternatives,
        stagnationCycles: continuity.antiLoop.stagnationCycles,
        unlockEvent: decision.unlockEvent,
        blockerCount: openBlockers.length
      });

      if (deadEnd) {
        run.deadEndRecord = {
          declaredAt: nowIso(),
          workUnit: continuity.position,
          attemptedPaths: run.recovery.attempts.slice(-20),
          excludedPaths: run.recovery.exclusions.slice(-20),
          unresolvedBlockers: openBlockers.slice(-8),
          evidence: continuity.verifiedFacts.slice(-12),
          unlockEvent: sanitizeText(decision.unlockEvent, 1200)
        };
        run.waitingForUnlockEvent = run.deadEndRecord.unlockEvent ||
          "Färsk owner-state som förändrar den exakta blockeraren.";
        run = transitionRun(run, STATES.RECOVERING, {
          origin: PAUSE_ORIGINS.GENUINE_DEAD_END,
          reason: sanitizeText(
            `${decision.reason || "Bounded recoveryvägar är uttömda."} Addonet väntar/pollar efter exakt unlock-event utan verklig mänsklig PAUS.`,
            1600
          ),
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "warning",
          title: "Dead end väntar på unlock utan verklig PAUS",
          detail: run.waitingForUnlockEvent,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(run.targetTabId, "RECOVERING", "Väntar på verifierbart unlock-event");
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }

      const nanoGroundingRequired = requestedPauseOrigin === PAUSE_ORIGINS.NANO_HOST_REQUIRED ||
        (analysisMode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP &&
          !continuity.intent.text &&
          continuity.targetClaims.length === 0 &&
          continuity.inferences.length === 0);

      if (run.maxAutonomousMode && !nanoGroundingRequired) {
        const nextStep = nextRecoveryStep(run.recovery.attempts, run.recovery.exclusions);
        const selected = alternatives[0] || nextStep?.instruction || requestedAction ||
          "Identifiera och genomför den minsta ännu oprövade säkra åtgärden som kan skapa ny evidens eller en konkret leverans.";
        const replanGrounding = validateNanoDecisionGrounding({
          ...decision,
          action: "CONTINUE",
          taskIntent: decision.taskIntent || decision.intent,
          requestedAction: selected,
          contextEvidence: decision.contextEvidence || decision.evidenceAnchors || []
        }, {
          analysisMode,
          continuityProjection: projectContinuity(continuity),
          observation
        });
        if (!replanGrounding.valid) {
          const exactWorkUnit = sanitizeText(decision.workUnit || continuity.position.workUnit, 1600) ||
            "den aktiva arbetsenheten";
          effectiveAction = "CONTINUE";
          requestedAction = `Läs färsk owner-state för ${exactWorkUnit} och välj därefter den minsta exakta åtgärd som ger ny evidens eller konkret leverans.`;
          requiredEvidence = ["Färsk owner-read med exakt locator och ett observerbart nästa resultat."];
          appendRecoveryAttempt(run, makeRecoveryAttempt("GROUNDING_RECOVERY_OWNER_READ", {
            workUnitId: continuity.position.workUnitId,
            outcome: "AUTO_SELECTED",
            detail: `${replanGrounding.errors.join(", ")} · ${requestedAction}`
          }));
          addAudit(audit, {
            kind: "warning",
            title: "Max Mode replan omvandlad till owner-read",
            detail: `Groundingfel: ${replanGrounding.errors.join(", ")}. Ingen verklig PAUS.`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
        } else {
          effectiveAction = "CONTINUE";
          requestedAction = selected;
          requiredEvidence = requiredEvidence.length
            ? requiredEvidence
            : ["En ny konkret arbetsprodukt, ny evidens eller exakt blockerare med unlock-händelse."];
        }
        run.recovery.alternativeSet = alternatives;
        appendRecoveryAttempt(run, makeRecoveryAttempt(nextStep?.id || "BOUNDED_REPLAN", {
          workUnitId: continuity.position.workUnitId,
          outcome: "SELECTED",
          detail: selected
        }));
      } else {
        // v0.7.0: an ungrounded takeover PAUSE means the *local host* could not ground
        // the takeover. v0.6.9 dropped the preserved observation here (it was cleared
        // together with the pending request above) and then waited in RECOVERING for a
        // new target response that could never arrive, because `lastProcessedAssistantHash`
        // already matched the current one. The observation is re-armed for a bounded
        // number of fresh Nano attempts before any owner reconciliation is required.
        const takeoverHostRecovery = analysisMode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP &&
          run.maxAutonomousMode &&
          observation &&
          Number(run.takeoverRecoveryAttempts || 0) < TAKEOVER_MAX_RECOVERY_ATTEMPTS;
        if (takeoverHostRecovery) {
          run.takeoverRecoveryAttempts = Number(run.takeoverRecoveryAttempts || 0) + 1;
          run.takeoverBootstrapRequired = true;
          run.nanoHostResetRequired = true;
          run.pendingObservation = observation;
          run.pendingNanoRequest = buildPendingNanoRequest({
            observationId: observation.observationId,
            analysisMode,
            now
          });
          run.resumePlan = null;
          run.nanoTelemetry ||= {};
          run.nanoTelemetry.lastStatus = "PENDING";
          run = transitionRun(run, STATES.ASSESSING, {
            origin: PAUSE_ORIGINS.NONE,
            reason: "Takeover kräver en fungerande lokal Nano-host; samma bevarade observation återköas mot en färsk session.",
            force: true
          });
          appendRecoveryAttempt(run, makeRecoveryAttempt("TAKEOVER_NANO_HOST_RESET", {
            workUnitId: continuity.position.workUnitId,
            outcome: "REQUEUED",
            detail: `${sanitizeText(decision.reason, 600)} · försök ${run.takeoverRecoveryAttempts}/${TAKEOVER_MAX_RECOVERY_ATTEMPTS}`
          }));
          context.run = run;
          addAudit(audit, {
            kind: "warning",
            title: "Takeover återköad mot färsk Nano-session",
            detail: `försök ${run.takeoverRecoveryAttempts}/${TAKEOVER_MAX_RECOVERY_ATTEMPTS} · observation ${observation.observationId} · ingen målprompt skickades.`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
          await writeRuntimeBundle(runtime, continuity, audit);
          await setTabIndicator(run.targetTabId, "ASSESSING", "Takeover återköad mot färsk Nano-session");
          await notifyPanels(windowId);
          setTimeout(() => tickWindow(windowId, "takeover-nano-host-reset").catch(console.warn), 0);
          return snapshotForWindow(windowId);
        }

        run.resumePlan = {
          requestedAction: alternatives[0] || requestedAction ||
            "Återaktivera lokal Nano-host och återköa exakt samma bevarade observation.",
          requiredEvidence: requiredEvidence.length
            ? requiredEvidence
            : ["En claimad Nano-response eller en turn-bunden target CONTINUE/DONE-signal."],
          workUnit: decision.workUnit || continuity.position.workUnit,
          alternatives,
          reason: sanitizeText(decision.reason || "Nano-host/grounding saknas; autonom recovery väntar utan mänsklig PAUS.", 1600)
        };
        run = transitionRun(run, STATES.RECOVERING, {
          origin: requestedPauseOrigin,
          reason: run.resumePlan.reason,
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "warning",
          title: "Nano recovery väntar utan verklig PAUS",
          detail: run.resumePlan.reason,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(run.targetTabId, "RECOVERING", "Nano-host/grounding återhämtas autonomt");
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
    }

    if (effectiveAction !== "CONTINUE") {
      throw new Error(`Nano action ${action} kunde inte kalibreras.`);
    }

    if (!requestedAction) {
      requestedAction = sanitizeText(observation?.targetResult?.next, 5000) ||
        `Läs färsk owner-state för ${sanitizeText(decision.workUnit || continuity.position.workUnit, 1600) || "den aktiva arbetsenheten"} och fortsätt med minsta konkreta åtgärd.`;
      requiredEvidence = requiredEvidence.length
        ? requiredEvidence
        : ["Färsk owner-state och ett observerbart resultat för nästa bounded steg."];
      appendRecoveryAttempt(run, makeRecoveryAttempt("MISSING_ACTION_OWNER_READ", {
        workUnitId: continuity.position.workUnitId,
        outcome: "AUTO_SELECTED",
        detail: requestedAction
      }));
      addAudit(audit, {
        kind: "warning",
        title: "Saknad requestedAction ersattes med bounded owner-read",
        detail: `${requestedAction} · ingen verklig PAUS.`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }

    run.turnIndex += 1;
    if (run.turnIndex >= Number(config.maxTurns || 30)) {
      run.checkpointIndex += 1;
      run.lifetimeTurnCount = Number(run.lifetimeTurnCount || 0) + run.turnIndex;
      run.resumePlan = {
        requestedAction,
        requiredEvidence,
        workUnit: decision.workUnit || continuity.position.workUnit,
        alternatives,
        reason: "Checkpointgränsen nåddes. v0.6.3 rullar autonomt vidare med bevarad continuity och ny bounded turn-epoch."
      };
      appendRecoveryAttempt(run, makeRecoveryAttempt("MAX_TURN_CHECKPOINT", {
        outcome: "AUTO_CHECKPOINT_ROLLOVER",
        detail: `Checkpoint ${run.checkpointIndex}; föregående turnIndex ${run.turnIndex}.`
      }));
      run.turnIndex = 0;
      addAudit(audit, {
        kind: "info",
        title: "Autonom checkpoint rollover",
        detail: `Checkpoint ${run.checkpointIndex}; ingen verklig PAUS eftersom destruktivitet < 10.`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }

    const projection = projectContinuity(continuity);
    const turnId = randomId("turn");
    const priorTurnId = run.currentTurn?.turnId || null;
    const targetMandateSha256 = await sha256Hex(sanitizeText(config.targetMandate, 24_000));
    const acknowledgedMandate = run.lastAcknowledgedMandateReceipt || null;
    const mandateDelivery = canReferenceAcknowledgedMandate({
      receipt: acknowledgedMandate,
      priorTurnId,
      mandateVersion: config.targetMandateVersion,
      mandateSha256: targetMandateSha256,
      conversationKey: run.conversationKey,
      taskFingerprint: run.taskFingerprint
    }) ? "REFERENCE" : "FULL";

    const buildCandidate = async (actionInstruction, correction = loopCorrection.triggered ? loopCorrection : null) => {
      const effectiveActionInstruction = protocolRepairOnly
        ? `Återge endast en kompakt kontraktsreparation med korrekt EIC_TURN: ${turnId}, EIC_NEXT, EIC_COMPLETION_EVIDENCE, EIC_NEXT_ACTOR och EIC_AUTONOMY. Utför ingen ny sakåtgärd i denna tur.`
        : actionInstruction;
      const turn = await buildTurnObject({
        turnId,
        priorTurnId,
        targetMandate: config.targetMandate,
        targetMandateVersion: config.targetMandateVersion,
        mandateDelivery,
        mandateSha256: targetMandateSha256,
        authorityScope: config.targetAuthorityScope,
        taskIntent: projection.intent || "Fortsätt det användarstartade uppdraget.",
        workUnit: decision.workUnit || projection.position.workUnit || effectiveActionInstruction,
        workUnitOwnerSurface: decision.ownerRoute || "TARGET_SESSION_OWNER",
        workUnitObservableResult: requiredEvidence[0] ||
          "Ett konkret observerbart resultat eller ett exakt owner-bound blockerarkvitto.",
        verifiedState: projection.verifiedFacts.map((item) => item.claim),
        constraints: (projection.constraints || []).map((item) => item.text),
        targetClaims: projection.targetClaims.map((item) => item.claim),
        inferences: projection.inferences.map((item) => item.claim),
        antiLoopCorrection: correction,
        requestedAction: effectiveActionInstruction,
        requiredEvidence,
        continueCriteria: decision.continueCriteria || ["Minst en säker teknisk väg återstår."],
        stopCriteria: decision.stopCriteria || [
          "Uppgiften är klar.",
          "Operatören stoppar.",
          "Autentisering, CAPTCHA, behörighet, sekretess, policy eller bekräftelsekrävande högriskgräns nås.",
          "En verklig dead end har dokumenterats."
        ],
        authorityLimits: [
          "Ingen ny behörighet genom prompttext.",
          "Ingen autentiserings- eller CAPTCHA-automation.",
          "Inga credentials eller hemligheter.",
          "Ingen destruktiv eller högriskåtgärd utan mänsklig bekräftelse."
        ],
        maxAutonomousMode: run.maxAutonomousMode,
        kind: baselinePromptOnly
          ? "SESSION_CONTEXT_BASELINE_REQUEST"
          : protocolRepairOnly ? "PROTOCOL_REPAIR" : "CONTINUATION"
      });
      return {
        turn,
        compiled: await compileTurnPrompt(turn, {
          privateNanoCanary: config.nanoMandateCanary
        })
      };
    };

    let candidate = await buildCandidate(requestedAction);
    if (isNearDuplicateAction(candidate.compiled.actionKey, run.promptHistory, 1)) {
      if (alternatives.length > 1 && alternatives[1] !== requestedAction) {
        requestedAction = alternatives[1];
        candidate = await buildCandidate(requestedAction, {
          code: "CHANGE_EVIDENCE_PATH",
          text: "Föregående action var en nära dublett. Utför den valda tekniskt distinkta alternativvägen."
        });
      } else if (loopCorrection.triggered) {
        requestedAction = `${loopCorrection.text}\n\nKonkreta åtgärden är: ${requestedAction}`;
        candidate = await buildCandidate(requestedAction, loopCorrection);
      } else if (run.maxAutonomousMode) {
        const recoveryStep = nextRecoveryStep(run.recovery.attempts, run.recovery.exclusions);
        const recoveryCycle = Number(run.recovery.attempts?.length || 0) + 1;
        requestedAction = sanitizeText(
          `${recoveryStep?.instruction || "Byt till en färsk owner-read för den aktiva arbetsenheten."} ` +
          `Använd en tekniskt distinkt evidensväg och rapportera exakt locator, observerat resultat och nästa effekt. ` +
          `Recovery checkpoint ${run.checkpointIndex || 0}.${recoveryCycle}.`,
          5000
        );
        appendRecoveryAttempt(run, makeRecoveryAttempt(recoveryStep?.id || "PROMPT_REPETITION_REPLAN", {
          workUnitId: continuity.position.workUnitId,
          outcome: "AUTO_SELECTED",
          detail: requestedAction
        }));
        candidate = await buildCandidate(requestedAction, {
          code: "PROMPT_REPETITION_REPLAN",
          text: "En nära dublett ersattes autonomt med en tekniskt distinkt owner-read/evidensväg."
        });
        addAudit(audit, {
          kind: "warning",
          title: "Promptrepetition omplanerad autonomt",
          detail: `${requestedAction} · ingen verklig PAUS.`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
      } else {
        run = transitionRun(run, STATES.SOFT_PAUSED, {
          origin: PAUSE_ORIGINS.PROMPT_REPETITION_GUARD,
          reason: "Nästa åtgärd är semantiskt identisk med en nyligen skickad tur och Max Mode är av.",
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "blocked",
          title: "Promptrepetition blockerad (Max Mode av)",
          detail: run.pause.reason,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
      if (isNearDuplicateAction(candidate.compiled.actionKey, run.promptHistory, 1)) {
        if (run.maxAutonomousMode) {
          const recoveryCycle = Number(run.recovery.attempts?.length || 0) + 1;
          requestedAction = sanitizeText(
            `Utför en färsk owner-read för ${decision.workUnit || continuity.position.workUnit || "den aktiva arbetsenheten"} ` +
            `via en ännu oprövad exakt locator. Returnera readback, förändringsdelta och ett nytt bounded nästa steg. ` +
            `Recovery checkpoint ${run.checkpointIndex || 0}.${recoveryCycle}.`,
            5000
          );
          appendRecoveryAttempt(run, makeRecoveryAttempt("PROMPT_REPETITION_OWNER_READ", {
            workUnitId: continuity.position.workUnitId,
            outcome: "AUTO_SELECTED",
            detail: requestedAction
          }));
          candidate = await buildCandidate(requestedAction, {
            code: "PROMPT_REPETITION_OWNER_READ",
            text: "Även alternativet var en dublett; en explicit ny owner-read-locator krävs."
          });
        }
        if (isNearDuplicateAction(candidate.compiled.actionKey, run.promptHistory, 1)) {
          run.waitingForUnlockEvent = "En ny owner-state, locator eller target-response som ändrar action identity.";
          run = transitionRun(run, STATES.RECOVERING, {
            origin: PAUSE_ORIGINS.PROMPT_REPETITION_GUARD,
            reason: "Alla bounded anti-duplicate-varianter matchade tidigare turer. Addonet väntar/reconcilerar ett exakt unlock-event utan verklig PAUS.",
            force: true
          });
          context.run = run;
          await writeRuntimeBundle(runtime, continuity, audit);
          await setTabIndicator(run.targetTabId, "RECOVERING", "Väntar på ny owner-state utan verklig PAUS");
          await notifyPanels(windowId);
          return snapshotForWindow(windowId);
        }
      }
    }
    const { turn, compiled } = candidate;

    const effect = {
      effectId: randomId("effect"),
      turnId,
      promptDigest: compiled.promptDigest,
      prompt: compiled.prompt,
      actionKey: compiled.actionKey,
      ackMode: "TURN_ID",
      requireTurnMarker: true,
      sourceObservationHash: observation?.responseHash || "",
      sourceObservationEpoch: observation?.documentEpoch || "",
      mandateVersion: turn.mandate.version,
      mandateSha256: turn.mandate.sha256,
      mandateDelivery: turn.mandate.delivery,
      conversationKey: run.conversationKey,
      taskFingerprint: run.taskFingerprint,
      status: "PREPARED",
      attempts: 0,
      preparedAt: nowIso(),
      submittedAt: null,
      confirmedAt: null,
      lastError: "",
      sessionContextBaseline: baselinePromptOnly
    };
    run.currentTurn = {
      turnId,
      priorTurnId,
      priorResponseContract: run.currentTurn?.responseContract || START_RESPONSE_CONTRACTS.TURN_BOUND_5,
      priorResponseExpectedTurnId: run.currentTurn?.responseExpectedTurnId || run.currentTurn?.turnId || "",
      effectState: "PREPARED",
      promptDigest: compiled.promptDigest,
      actionKey: compiled.actionKey,
      kind: turn.kind,
      responseContract: START_RESPONSE_CONTRACTS.TURN_BOUND_5
    };
    run.effectJournal = compactEffectJournal([...run.effectJournal, effect], turnId);
    if (baselinePromptOnly) {
      run.sessionContextInit = advanceSessionContextInit(
        run.sessionContextInit,
        SESSION_CONTEXT_INIT_STATE.BASELINE_REQUEST_DISPATCHED,
        { baselinePromptDigest: compiled.promptDigest },
        { now, force: true }
      );
    }
    run = transitionRun(run, STATES.CONTINUING, {
      reason: "Canonical Markdown/JSON-turn validerad och journalförd före leverans."
    });
    context.run = run;
    addAudit(audit, {
      kind: "info",
      title: "Nästa substantiella tur förberedd",
      detail: requestedAction,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return executePreparedEffectUnlocked(windowId);
}


async function restoreAutoDiscardableOnTerminal(run) {
  if (typeof run?.previousAutoDiscardable !== "boolean") return "";
  try {
    await chrome.tabs.update(run.targetTabId, { autoDiscardable: run.previousAutoDiscardable });
    const tab = await chrome.tabs.get(run.targetTabId);
    if (tab.autoDiscardable !== run.previousAutoDiscardable) {
      return "autoDiscardable rollback readback misslyckades.";
    }
    const detail = `autoDiscardable återställdes till ${run.previousAutoDiscardable}.`;
    run.previousAutoDiscardable = null;
    return detail;
  } catch (error) {
    return `autoDiscardable rollback kunde inte verifieras: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function signalAutomaticCaptureCancellation(windowId, reason = "OPERATOR_PAUSE") {
  const numericWindowId = Number(windowId);
  const timer = autoCaptureTimers.get(numericWindowId);
  if (timer) {
    clearTimeout(timer);
    autoCaptureTimers.delete(numericWindowId);
  }
  const active = autoCaptureInFlight.get(numericWindowId);
  if (active?.requestId && Number.isInteger(active.tabId)) {
    try {
      await chrome.tabs.sendMessage(active.tabId, {
        type: "EIC_CANCEL_CAPTURE",
        requestId: active.requestId,
        reason
      });
    } catch {
      // The page may have closed; the queued owner update will still persist cancellation.
    }
  }
  return active || null;
}

async function cancelAutomaticCaptureForWindow(windowId, context, reason = "OPERATOR_PAUSE") {
  const active = await signalAutomaticCaptureCancellation(windowId, reason);
  if (active?.requestId && Number.isInteger(active.tabId)) {
    context.autoCaptureGuard = createAutoCaptureGuard({
      fingerprint: active.fingerprint,
      requestId: active.requestId,
      status: "CANCELLED",
      error: reason
    });
  }
}

async function controlRun(windowId, action) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    let run = context.run;
    if (!run) throw new Error("Ingen körning finns.");

    if (action === "PAUSE") {
      await cancelAutomaticCaptureForWindow(windowId, context, "OPERATOR_PAUSE");
      run = transitionRun(run, STATES.SOFT_PAUSED, {
        origin: PAUSE_ORIGINS.OPERATOR_PAUSE,
        reason: "Operatören pausade addonet. Mål-sessionens pågående generation lämnas orörd."
      });
    } else if (action === "RESUME") {
      if (![STATES.SOFT_PAUSED, STATES.PROGRAM_BLOCKED].includes(run.state)) {
        throw new Error("Körningen är inte pausad.");
      }
      if (run.state === STATES.PROGRAM_BLOCKED &&
          !boundaryAuthorized(run) &&
          ![PAUSE_ORIGINS.NANO_HOST_REQUIRED, PAUSE_ORIGINS.TAB_CLOSED, PAUSE_ORIGINS.TAB_MOVED].includes(run.pause?.origin)) {
        throw new Error("Hård blockerare måste först låsas upp externt eller auktoriseras av operatören.");
      }
      const resumeOrigin = run.pause?.origin || PAUSE_ORIGINS.NONE;
      if (context.autoCaptureGuard?.status === "CANCELLED") {
        context.autoCaptureGuard = null;
      }
      run.recovery ||= { attempts: [], exclusions: [], consecutiveNoProgress: 0 };
      run.recovery.consecutiveNoProgress = 0;
      continuity.antiLoop ||= {};
      continuity.antiLoop.stagnationCycles = 0;
      continuity.antiLoop.lastCorrection = {
        code: "OPERATOR_RESUME_AFTER_NO_PROGRESS",
        at: nowIso(),
        origin: resumeOrigin
      };
      continuity.updatedAt = nowIso();
      if (run.state === STATES.PROGRAM_BLOCKED) {
        run = transitionRun(run, STATES.RECOVERING, {
          origin: resumeOrigin,
          reason: "Operatören bekräftade att den tillåtna externa unlock-händelsen har inträffat; målstate verifieras före fortsatt effekt."
        });
      }
      if (run.resumePlan) {
        const requestId = randomId("nano-resume");
        run.pendingObservation = {
          observationId: randomId("resume-observation"),
          responseHash: run.lastProcessedAssistantHash || "",
          responseText: "",
          conversationExcerpt: "",
          assistantCount: run.lastProcessedAssistantCount || 0,
          documentEpoch: "",
          observedAt: nowIso(),
          targetResult: { valid: false, reason: "OPERATOR_RESUME", status: null, next: "" }
        };
        run.pendingNanoRequest = buildPendingNanoRequest({
          requestId,
          observationId: run.pendingObservation.observationId,
          analysisMode: NANO_ANALYSIS_MODES.OPERATOR_RESUME,
          operatorResumeDecision: {
            action: "CONTINUE",
            progressDelta: 0,
            reason: `Operatören återupptog en recoverable paus: ${run.resumePlan.reason || resumeOrigin}.`,
            workUnit: run.resumePlan.workUnit || "",
            requestedAction: run.resumePlan.requestedAction,
            requiredEvidence: run.resumePlan.requiredEvidence || [],
            verifiedFacts: [],
            targetClaims: [],
            inferences: ["Återupptagningen är ett explicit operatörsbeslut; tidigare måltext gav ingen ny behörighet."],
            attempts: [],
            blockers: [],
            alternatives: run.resumePlan.alternatives || [],
            continueCriteria: ["Minst en säker teknisk väg återstår."],
            stopCriteria: ["Operatörsstopp.", "Hård gräns.", "Verklig dead end."],
            completionEvidence: "",
            completionScope: "WORK_UNIT",
            completionConfirmed: false,
            pauseOrigin: PAUSE_ORIGINS.NONE,
            boundaryEvidence: "",
            unlockEvent: ""
          }
        });
        run.resumePlan = null;
        run = transitionRun(run, STATES.ASSESSING, {
          origin: resumeOrigin,
          reason: "Operatören återupptog den bevarade recoverable planen."
        });
      } else {
        run = transitionRun(run, run.pendingObservation ? STATES.ASSESSING : STATES.WAITING_FOR_RESPONSE, {
          origin: resumeOrigin,
          reason: "Operatören återupptog den bevarade körningen."
        });
      }
    } else if (action === "STOP") {
      await cancelAutomaticCaptureForWindow(windowId, context, "OPERATOR_STOP");
      const rollbackDetail = await restoreAutoDiscardableOnTerminal(run);
      run = transitionRun(run, STATES.STOPPED, {
        origin: PAUSE_ORIGINS.DIRECT_OPERATOR_STOP,
        reason: `Operatören stoppade addonet. Mål-sessionens pågående generation avbryts inte.${rollbackDetail ? ` ${rollbackDetail}` : ""}`
      });
    } else {
      throw new Error("Okänd run control.");
    }

    context.run = run;
    addAudit(audit, {
      kind: action === "STOP" ? "blocked" : "info",
      title: action === "PAUSE" ? "Addon pausat" : action === "RESUME" ? "Addon återupptaget" : "Addon stoppat",
      detail: run.lastTransition.reason,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(run.targetTabId, action === "STOP" ? "LINKED" : action === "PAUSE" ? "PAUSED" : "WAITING");
    await notifyPanels(windowId);
    if (action === "RESUME") {
      // En bevarad resumePlan går genom en ny exakt Nano-claim.
      setTimeout(() => tickWindow(windowId, "operator-resume"), 0);
      setTimeout(() => scheduleBackgroundAutoSessionCapture(windowId, "operator-resume"), 0);
    }
    return snapshotForWindow(windowId);
  });
}

async function importState(windowId, payload) {
  return enqueue(async () => {
    assertCurrentExport(payload, {
      schema: EXPORT_SCHEMA,
      version: EXPORT_VERSION
    });
    const bundle = await loadBundle(windowId);
    const currentContext = getWindowContext(bundle.runtime, windowId);
    const rollbackWindowContext = deepClone(currentContext);
    rollbackWindowContext.importRollback = null;
    const rollbackSnapshot = {
      config: deepClone(bundle.config),
      continuity: deepClone(bundle.continuity),
      windowContext: rollbackWindowContext,
      missionStore: deepClone(bundle.runtime.missionStore)
    };
    const rollbackDigest = await sha256Hex(stableStringify(rollbackSnapshot));
    const rollback = createImportRollback({
      rollbackId: randomId("import-rollback"),
      digest: rollbackDigest,
      ...rollbackSnapshot
    });

    const currentState = loadCurrentState(payload.config || createDefaultConfig(), createDefaultRuntime());
    const config = currentState.config;
    config.nanoMandateCanary ||= randomId("nano-private");
    config.updatedAt = nowIso();

    let importedContext = currentContext;
    if (payload.window) {
      importedContext = sanitizeImportedWindowContext(payload.window, {
        windowId,
        profile: runtimeBuildProfile(),
        reason: "IMPORTED_STATE_REQUIRES_LIVE_REBIND"
      });
      bundle.runtime.windows[String(windowId)] = importedContext;
    }

    const imported = bindContinuityScope(normalizeContinuity(payload.continuity), {
      windowId,
      runId: importedContext.run?.runId,
      conversationKey: payload.continuity?.position?.conversationKey ||
        importedContext.run?.conversationKey
    });
    const continuity = await sealContinuity(imported);
    importedContext.continuityBackup = importedContext.continuity || continuity;
    importedContext.continuity = continuity;
    importedContext.importRollback = rollback;

    if (payload.missions) {
      importMissionView(bundle.runtime, importedContext, payload.missions);
    }
    importedContext.browserRecovery = markBrowserRecoveryRequired(importedContext.browserRecovery, {
      reason: "IMPORTED_STATE_REQUIRES_LIVE_REBIND",
      surface: webTargetSurface(importedContext),
      missionId: importedContext.activeMissionId || "",
      browserLoop: importedContext.browserLoop
    });
    importedContext.browserApproval = null;
    importedContext.updatedAt = nowIso();

    addAudit(bundle.audit, {
      kind: "warning",
      title: "Versionerad import tillämpad fail-closed",
      detail: `${payload.schema} · liveflikar, origin-grants, CDP, approvals och pending actions återställdes inte`,
      windowId
    });
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: config });
      await writeRuntimeBundle(bundle.runtime, continuity, bundle.audit, windowId);
    } catch (error) {
      storageCircuitOpen = true;
      throw new Error(`STORAGE_PERSISTENCE_FAILURE: ${String(error?.message || error)}`);
    }
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function rollbackImportedState(windowId) {
  return enqueue(async () => {
    const bundle = await loadBundle(windowId);
    const context = getWindowContext(bundle.runtime, windowId);
    const rollback = normalizeImportRollback(context.importRollback);
    if (!rollback?.rollbackId) throw new Error("IMPORT_ROLLBACK_MISSING");
    if (rollback.consumed) throw new Error("IMPORT_ROLLBACK_ALREADY_CONSUMED");
    const actualDigest = await sha256Hex(stableStringify(rollback.snapshot));
    if (actualDigest !== rollback.digest) throw new Error("IMPORT_ROLLBACK_DIGEST_MISMATCH");

    const restoredConfig = loadCurrentState(
      rollback.snapshot.config || createDefaultConfig(),
      createDefaultRuntime()
    ).config;
    restoredConfig.updatedAt = nowIso();
    bundle.runtime.missionStore = deepClone(rollback.snapshot.missionStore || createDefaultRuntime().missionStore);
    const restoredContext = sanitizeImportedWindowContext(rollback.snapshot.windowContext, {
      windowId,
      profile: runtimeBuildProfile(),
      reason: "ROLLBACK_REQUIRES_LIVE_REBIND"
    });
    restoredContext.importRollback = consumeImportRollback(rollback);
    bundle.runtime.windows[String(windowId)] = restoredContext;

    const restoredContinuity = await sealContinuity(bindContinuityScope(
      normalizeContinuity(rollback.snapshot.continuity),
      {
        windowId,
        runId: restoredContext.run?.runId,
        conversationKey: rollback.snapshot.continuity?.position?.conversationKey ||
          restoredContext.run?.conversationKey
      }
    ));
    restoredContext.continuity = restoredContinuity;
    restoredContext.continuityBackup = restoredContinuity;
    addAudit(bundle.audit, {
      kind: "warning",
      title: "Importerad state återställd",
      detail: "Rollback verifierades med digest; liveflikar, origin-grants, CDP och approvals kräver ny bindning.",
      windowId
    });
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: restoredConfig });
      await writeRuntimeBundle(bundle.runtime, restoredContinuity, bundle.audit, windowId);
    } catch (error) {
      storageCircuitOpen = true;
      throw new Error(`STORAGE_PERSISTENCE_FAILURE: ${String(error?.message || error)}`);
    }
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function resumeBrowserRecovery(windowId) {
  return enqueue(async () => {
    const bundle = await loadBundle(windowId);
    const context = getWindowContext(bundle.runtime, windowId);
    const target = webTargetSurface(context);
    if (runtimeBuildProfile() !== BUILD_PROFILES.BROWSER) {
      throw new Error("BROWSER_RECOVERY_BROWSER_PROFILE_REQUIRED");
    }
    if (!target?.surfaceId || !Number.isInteger(Number(target.tabId))) {
      throw new Error("BROWSER_RECOVERY_TARGET_REBIND_REQUIRED");
    }
    const permission = await containsExactOriginPermission(chrome, target.url);
    const evidenceStore = await loadWindowEvidenceStore(chrome, windowId);
    const observation = evidenceStore.observation || {};
    const prepared = prepareBrowserRecoveryResume(context.browserRecovery, {
      surface: target,
      permissionGranted: permission.granted,
      cdpSession: liveCdpSessions.get(cdpLiveKey(windowId)) || context.browserSession,
      evidenceObservation: {
        state: observation.state,
        target: {
          tabId: observation.tabId,
          surfaceId: observation.surfaceId,
          documentEpoch: observation.documentEpoch,
          origin: observation.origin
        }
      }
    });

    context.browserApproval = null;
    context.browserLoop = normalizeBrowserLoopState({
      ...context.browserLoop,
      state: BROWSER_LOOP_STATES.WAITING_CONTROLLER,
      controllerResponseHash: "",
      lastReason: "RECOVERY_RESUMED_WITHOUT_ACTION_REPLAY",
      updatedAt: nowIso()
    }, { windowId });
    context.browserRecovery = completeBrowserRecovery(prepared, {
      reason: "RECOVERY_RESUMED_WITHOUT_ACTION_REPLAY"
    });

    const missionId = context.activeMissionId;
    const mission = missionId ? bundle.runtime.missionStore?.missions?.[missionId] : null;
    if (mission) {
      const transitioned = transitionMission(mission, MISSION_STATES.RUNNING, {
        force: true,
        reason: "BROWSER_RECOVERY_RESUMED_WITHOUT_ACTION_REPLAY",
        currentStep: "Väntar på ett nytt komplett controllersvar.",
        nextAction: "Bearbeta endast ett nytt, ej förbrukat controllersvar."
      });
      transitioned.recovery = {
        schema: "eic.autonom.mission-recovery.v1",
        state: "READY",
        reason: "RECOVERY_PRECONDITIONS_VERIFIED",
        attempts: [
          ...(Array.isArray(mission.recovery?.attempts) ? mission.recovery.attempts : []),
          {
            at: nowIso(),
            reason: "RECOVERY_RESUMED_WITHOUT_ACTION_REPLAY",
            target: {
              tabId: target.tabId,
              surfaceId: target.surfaceId,
              documentEpoch: target.documentEpoch,
              origin: target.origin
            }
          }
        ].slice(-32)
      };
      bundle.runtime.missionStore.missions[missionId] = transitioned;
    }

    addAudit(bundle.audit, {
      kind: "done",
      title: "Browser recovery återupptagen",
      detail: "Targetidentitet, exakt originbehörighet, CDP och evidenssession verifierades. Ingen pending action återspelades.",
      windowId,
      tabId: target.tabId,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(bundle.runtime, bundle.continuity, bundle.audit, windowId);
    await notifyPanels(windowId);
    setTimeout(() => tickWindow(windowId, "browser-recovery-resumed").catch(console.warn), 0);
    return snapshotForWindow(windowId);
  });
}

async function resetWindow(windowId) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    if (context.run && ![STATES.PROGRAM_DONE, STATES.STOPPED, STATES.ERROR_TERMINAL].includes(context.run.state)) {
      throw new Error("Stoppa den aktiva körningen före reset.");
    }
    runtime.windows[String(windowId)] = defaultWindowContext(windowId);
    let resetContinuity = bindContinuityScope(createContinuity({
      scopeWindowId: windowId
    }), { windowId });
    addAudit(audit, {
      kind: "warning",
      title: "Fönsterkontext återställd",
      detail: "Kopplade flikar och lokala run-kvitton i detta Chrome-fönster återställdes.",
      windowId
    });
    await writeRuntimeBundle(runtime, resetContinuity, audit, windowId);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function clearAudit(windowId) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    audit.items = (audit.items || []).filter((item) => item.windowId !== windowId);
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

/**
 * v0.10.11 operator recovery for a FAILED session-context initialization.
 *
 * The retry is bounded (SESSION_CONTEXT_INIT_MAX_OPERATOR_RETRIES) and re-arms
 * the chain from its first phase: a fresh stable assistant response is caught,
 * a fresh baseline prompt is built, journalled and delivered. Nothing from the
 * failed generation is reused, and no prompt is sent by this command itself.
 */
async function retrySessionContextInitialization(windowId) {
  return enqueue(async () => {
    const { continuity, runtime, audit, applicationLog } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    let run = context.run;
    if (!run) throw new Error("Ingen körning är bunden till fönstret.");
    if (!sessionContextInitRetryable(run.sessionContextInit)) {
      throw new Error(
        "Sessionsinitieringen är inte i ett återförsöksbart fel-läge, eller har nått taket för operatörsåterförsök."
      );
    }
    const now = Date.now();
    const retry = retrySessionContextInit(run.sessionContextInit, { now });
    run.sessionContextInit = retry.value;
    run.pendingNanoRequest = null;
    run.pendingObservation = null;
    run.deterministicGroundingFailure = null;
    run.deterministicDispatchFailure = null;
    run.deterministicDispatchRearms = 0;
    run.resumePlan = null;
    run.timeoutSuspended = false;
    run.takeoverBootstrapRequired = true;
    run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
      origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
      reason: "Operatören begärde ett nytt försök med sessionsinitieringen. Catch armeras om från början.",
      now,
      force: true
    });
    context.run = run;
    addAudit(audit, {
      kind: "info",
      title: "Sessionsinitiering återarmerad av operatören",
      detail: `Försök ${run.sessionContextInit.recoveryAttempts}/${SESSION_CONTEXT_INIT_MAX_OPERATOR_RETRIES} · ` +
        "catch, baseline och Nano körs om från fas 1.",
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    const nextApplicationLog = appendApplicationEvent(applicationLog, {
      level: "info",
      event: "mission.session-context.retry",
      message: "Operatören återarmerade sessionsinitieringen.",
      windowId,
      tabId: run.targetTabId,
      runId: run.runId,
      missionId: run.missionId || context.activeMissionId || null,
      data: { recoveryAttempts: run.sessionContextInit.recoveryAttempts }
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    if (nextApplicationLog !== applicationLog) {
      await chrome.storage.local.set({ [STORAGE_KEYS.APPLICATION_LOG]: nextApplicationLog });
    }
    await setTabIndicator(
      run.targetTabId,
      "INITIALIZING",
      "Sessionskontext initieras om",
      sessionContextInitOverlay(run.sessionContextInit)
    );
    await notifyPanels(windowId);
    setTimeout(() => tickWindow(windowId, "session-context-init-retry").catch(console.warn), 0);
    return snapshotForWindow(windowId);
  });
}

async function recordUiAudit(windowId, payload = {}) {
  return enqueue(async () => {
    const { continuity, runtime, audit, applicationLog } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const entry = payload && typeof payload === "object" ? payload : {};
    addAudit(audit, {
      kind: sanitizeText(entry.kind || "error", 40),
      title: sanitizeText(entry.title || "Sidepanel-fel", 240),
      detail: sanitizeText(entry.detail || "Okänt sidepanel-fel.", 2000),
      windowId,
      tabId: context.run?.targetTabId ?? context.selectedTabId ?? null,
      runId: context.run?.runId || null
    });
    const nextApplicationLog = appendApplicationEvent(applicationLog, {
      level: sanitizeText(entry.kind || "error", 40),
      event: "sidepanel.error",
      message: sanitizeText(entry.title || "Sidepanel-fel", 240),
      windowId,
      tabId: context.run?.targetTabId ?? context.selectedTabId ?? null,
      runId: context.run?.runId || null,
      missionId: context.activeMissionId || null,
      hostId: context.nanoHostTelemetry?.hostId || null,
      data: {
        detail: sanitizeText(entry.detail || "Okänt sidepanel-fel.", 1200)
      }
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await chrome.storage.local.set({
      [STORAGE_KEYS.APPLICATION_LOG]: nextApplicationLog
    });
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function approvePendingBrowserAction(windowId, payload = {}) {
  const snapshot = await enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    context.browserApproval = approveBrowserAction(context.browserApproval, {
      actionId: payload.actionId,
      justification: payload.justification,
      approvedBy: "OPERATOR_UI"
    });
    context.browserLoop = {
      ...normalizeBrowserLoopState(context.browserLoop, { windowId }),
      state: BROWSER_LOOP_STATES.WAITING_CONTROLLER,
      lastReason: "EXACT_BROWSER_ACTION_APPROVED",
      updatedAt: nowIso()
    };
    context.updatedAt = nowIso();
    addAudit(audit, {
      kind: "done",
      title: "WP10 browseråtgärd godkänd",
      detail: `${context.browserApproval.actionId} · ${context.browserApproval.riskDecision?.level || "UNKNOWN"}`,
      windowId,
      tabId: webTargetSurface(context)?.tabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
  setTimeout(() => {
    processBrowserControllerStep(windowId).catch((error) => {
      console.error("Approved browser action failed", error);
    });
  }, 0);
  return snapshot;
}

async function denyPendingBrowserAction(windowId, payload = {}) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const denied = denyBrowserAction(context.browserApproval, {
      actionId: payload.actionId,
      justification: payload.justification || "Operator denied the browser action."
    });
    context.browserApproval = denied;
    const loop = normalizeBrowserLoopState(context.browserLoop, { windowId });
    loop.processedResponseHashes = [
      ...loop.processedResponseHashes,
      denied.responseHash
    ].filter(Boolean).slice(-100);
    loop.state = BROWSER_LOOP_STATES.PAUSED;
    loop.lastReason = "BROWSER_ACTION_DENIED_BY_OPERATOR";
    loop.updatedAt = nowIso();
    context.browserLoop = loop;
    context.updatedAt = nowIso();
    addAudit(audit, {
      kind: "warning",
      title: "WP10 browseråtgärd nekad",
      detail: `${denied.actionId} · controllersvaret är förbrukat utan browserdispatch`,
      windowId,
      tabId: webTargetSurface(context)?.tabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function startWebResearchMission(windowId, request) {
  const snapshot = await enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    if (runtimeBuildProfile() !== BUILD_PROFILES.BROWSER) {
      throw new Error("MISSION_WEB_RESEARCH_BROWSER_PROFILE_REQUIRED");
    }
    const controller = chatGptControllerSurface(context);
    const { target, session } = requireEvidenceSession(context);
    await verifyEvidencePermission(target);
    if (!controller || controller.lifecycleState !== "READY" || !isAllowedChatUrl(controller.url)) {
      throw new Error("MISSION_WEB_RESEARCH_CONTROLLER_NOT_READY");
    }
    if (request.runtimeInput.startUrl) {
      const startOrigin = new URL(request.runtimeInput.startUrl).origin;
      if (startOrigin !== target.origin) {
        throw new Error("MISSION_WEB_RESEARCH_START_URL_TARGET_ORIGIN_MISMATCH");
      }
    }
    const store = await loadWindowEvidenceStore(chrome, windowId);
    if (store.observation.state !== EVIDENCE_OBSERVATION_STATES.ACTIVE ||
        store.observation.sessionId !== session.sessionId ||
        store.observation.surfaceId !== target.surfaceId ||
        store.observation.documentEpoch !== target.documentEpoch ||
        store.observation.origin !== target.origin) {
      throw new Error("MISSION_WEB_RESEARCH_EVIDENCE_OBSERVATION_REQUIRED");
    }

    const activated = activateStandaloneMission(runtime, context, {
      modeId: request.modeId,
      input: request.missionInput,
      state: MISSION_STATES.RUNNING,
      currentStep: "WAITING_CONTROLLER_ACTION",
      nextAction: "PROCESS_BROWSER_CONTROLLER_STEP",
      originGrants: [target.origin]
    });
    context.browserApproval = null;
    context.browserLoop = {
      ...createBrowserLoopState(windowId),
      state: BROWSER_LOOP_STATES.WAITING_CONTROLLER,
      controllerSurfaceId: String(controller.surfaceId),
      controllerDocumentEpoch: String(controller.documentEpoch),
      lastReason: "AI_WEB_RESEARCH_STARTED",
      updatedAt: nowIso()
    };
    context.updatedAt = nowIso();
    addAudit(audit, {
      kind: "done",
      title: "WP10 AI_WEB_RESEARCH startad",
      detail: `${activated.mission.missionId} · ${target.origin} · guarded policy`,
      windowId,
      tabId: target.tabId,
      runId: null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
  setTimeout(() => {
    processBrowserControllerStep(windowId).catch((error) => {
      if (!String(error?.message || error).includes("BROWSER_LOOP_RESPONSE_NOT_READY")) {
        console.error("AI_WEB_RESEARCH initial step failed", error);
      }
    });
  }, 0);
  return snapshot;
}

async function startMissionAfterSessionInit(windowId, request) {
  if (request.modeId === MISSION_MODE_IDS.CHATGPT_NEW_SESSION) {
    return enqueue(() => preparePreparedSessionRunUnlocked(windowId, {
      startPrompt: request.runtimeInput.startPrompt,
      analysis: request.runtimeInput.analysis,
      runMode: RUN_MODES.NEW_SESSION,
      missionRequest: request
    }));
  }
  if (request.modeId === MISSION_MODE_IDS.APP_AUDIT_LONG) {
    return startAppAuditMission(windowId, request.runtimeInput, request.sourceCommand, request);
  }
  if (request.modeId === MISSION_MODE_IDS.ARCHAEOLOGY_LONG) {
    return startArchaeologyMission(windowId, request.runtimeInput, request.sourceCommand, request);
  }
  if (request.modeId === MISSION_MODE_IDS.AI_WEB_RESEARCH) {
    return startWebResearchMission(windowId, request);
  }
  throw new Error(`MISSION_MODE_START_UNSUPPORTED:${request.modeId}`);
}

async function launchDeferredMission(windowId, deferred = {}) {
  const request = normalizeMissionStartRequest({
    modeId: deferred.modeId,
    input: deferred.input || {},
    sourceCommand: deferred.sourceCommand || UI_COMMANDS.START_MISSION,
    buildProfile: runtimeBuildProfile()
  });
  return startMissionAfterSessionInit(windowId, request);
}

async function startMission(windowId, payload = {}, sourceCommand = UI_COMMANDS.START_MISSION) {
  const modeId = String(payload.modeId || "");
  const input = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
    ? payload.input
    : {};
  const request = normalizeMissionStartRequest({
    modeId,
    input,
    sourceCommand,
    buildProfile: runtimeBuildProfile()
  });

  if (request.modeId === MISSION_MODE_IDS.CHATGPT_CONTINUATION) {
    return startWaiting(windowId, request);
  }

  // Every manual and automatic start shares the same session-context gate. The
  // requested mission is retained but cannot execute until chat readiness, catch,
  // baseline intake and Nano classification have all completed.
  const continuationRequest = normalizeMissionStartRequest({
    modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
    input: {},
    sourceCommand,
    buildProfile: runtimeBuildProfile()
  });
  return startWaiting(windowId, continuationRequest, {
    deferredMissionStart: {
      modeId: request.modeId,
      input: deepClone(input),
      sourceCommand
    }
  });
}

async function getApplicationLog(windowId) {
  const { applicationLog } = await loadBundle(windowId);
  return {
    applicationLog: applicationLogForExport(applicationLog, { windowId })
  };
}

async function getFullAuditBatchCommand(windowId, payload = {}) {
  await loadBundle(windowId);
  const persistence = await persistFullAuditQueueFailSoft();
  return {
    batch: fullAuditBatch(fullAuditQueueCache, {
      limit: Math.max(1, Math.min(200, Number(payload.limit || 200)))
    }),
    queueStatus: {
      enabled: fullAuditLoggingEnabledCache,
      entries: fullAuditQueueCache.entries.length,
      droppedEntries: fullAuditQueueCache.droppedEntries,
      lastError: fullAuditQueueLastError,
      persistence
    }
  };
}

async function acknowledgeFullAuditBatchCommand(windowId, payload = {}) {
  await loadBundle(windowId);
  fullAuditQueueCache = acknowledgeFullAuditBatch(
    fullAuditQueueCache,
    Number(payload.lastSequence)
  );
  await chrome.storage.local.set({
    [STORAGE_KEYS.FULL_AUDIT_QUEUE]: fullAuditQueueCache
  });
  return {
    acknowledged: true,
    lastSequence: Number(payload.lastSequence),
    remaining: fullAuditQueueCache.entries.length
  };
}

const UI_COMMAND_HANDLERS = Object.freeze({
  [UI_COMMANDS.APPROVE_BROWSER_ACTION]: ({ windowId, payload }) =>
    approvePendingBrowserAction(windowId, payload),
  [UI_COMMANDS.DENY_BROWSER_ACTION]: ({ windowId, payload }) =>
    denyPendingBrowserAction(windowId, payload),
  [UI_COMMANDS.GET_SNAPSHOT]: ({ windowId }) => snapshotForWindow(windowId),
  [UI_COMMANDS.GET_APPLICATION_LOG]: ({ windowId }) => getApplicationLog(windowId),
  [UI_COMMANDS.GET_FULL_AUDIT_BATCH]: ({ windowId, payload }) =>
    getFullAuditBatchCommand(windowId, payload),
  [UI_COMMANDS.ACK_FULL_AUDIT_BATCH]: ({ windowId, payload }) =>
    acknowledgeFullAuditBatchCommand(windowId, payload),
  [UI_COMMANDS.ATTACH_WEB_TARGET_DEBUGGER]: ({ windowId }) => attachWebTargetDebugger(windowId),
  [UI_COMMANDS.CAPTURE_EVIDENCE_SNAPSHOT]: ({ windowId }) => captureBrowserEvidenceSnapshot(windowId),
  [UI_COMMANDS.CLEAR_BROWSER_EVIDENCE]: ({ windowId }) => clearBrowserEvidenceCommand(windowId),
  [UI_COMMANDS.REFRESH]: async ({ windowId }) => {
    await tickWindow(windowId, "ui-refresh");
    return snapshotForWindow(windowId);
  },
  [UI_COMMANDS.REQUEST_WEB_TARGET_PERMISSION]: ({ windowId }) => requestWebTargetPermission(windowId),
  [UI_COMMANDS.REVOKE_WEB_TARGET_PERMISSION]: ({ windowId }) => revokeWebTargetPermission(windowId),
  [UI_COMMANDS.LINK_ACTIVE_TAB]: ({ windowId }) => linkActiveTab(windowId),
  [UI_COMMANDS.DETACH_SELECTED_TAB]: ({ windowId }) => detachSelectedTab(windowId),
  [UI_COMMANDS.BIND_ACTIVE_WEB_TARGET]: ({ windowId }) => bindActiveWebTarget(windowId),
  [UI_COMMANDS.DETACH_WEB_TARGET]: ({ windowId }) => detachWebTarget(windowId),
  [UI_COMMANDS.DETACH_WEB_TARGET_DEBUGGER]: ({ windowId }) => detachWebTargetDebugger(windowId),
  [UI_COMMANDS.EXECUTE_BROWSER_RESPONSE_ACTION]: ({ windowId, payload }) =>
    executeBrowserResponseAction(windowId, payload.responseText),
  [UI_COMMANDS.SELECT_TAB]: ({ windowId, payload }) =>
    selectLinkedTab(windowId, Number(payload.tabId)),
  [UI_COMMANDS.SET_TARGET_MODE]: ({ windowId, payload }) => enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    context.targetMode = payload.mode === TARGET_MODES.FOLLOW
      ? TARGET_MODES.FOLLOW
      : TARGET_MODES.LOCKED;
    context.updatedAt = nowIso();
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }),
  [UI_COMMANDS.SAVE_CONFIG]: async ({ windowId, payload }) => {
    await saveConfig(payload.config || {});
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  },
  [UI_COMMANDS.START_MISSION]: ({ windowId, payload }) =>
    startMission(windowId, payload, UI_COMMANDS.START_MISSION),
  [UI_COMMANDS.START_WAITING]: ({ windowId }) =>
    startMission(windowId, {
      modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
      input: {}
    }, UI_COMMANDS.START_WAITING),
  [UI_COMMANDS.START_NEW_SESSION]: ({ windowId, payload }) =>
    startMission(windowId, {
      modeId: MISSION_MODE_IDS.CHATGPT_NEW_SESSION,
      input: {
        startPrompt: payload.startPrompt,
        analysis: payload.analysis
      }
    }, UI_COMMANDS.START_NEW_SESSION),
  [UI_COMMANDS.NANO_HOST_STATE]: ({ windowId, payload }) =>
    updateNanoHostState(windowId, payload.hostState || {}),
  [UI_COMMANDS.NANO_CLAIM]: ({ windowId, payload }) =>
    claimNanoRequest(windowId, payload),
  [UI_COMMANDS.NANO_HEARTBEAT]: ({ windowId, payload }) =>
    heartbeatNanoRequest(windowId, payload),
  [UI_COMMANDS.NANO_FAILURE]: ({ windowId, payload }) =>
    failNanoRequest(windowId, payload),
  [UI_COMMANDS.NANO_DECISION]: ({ windowId, payload }) =>
    applyNanoDecisionCommand(windowId, payload),
  [UI_COMMANDS.PAUSE]: async ({ windowId }) => {
    await signalAutomaticCaptureCancellation(windowId, "OPERATOR_PAUSE");
    return controlRun(windowId, "PAUSE");
  },
  [UI_COMMANDS.PROCESS_BROWSER_CONTROLLER_STEP]: ({ windowId }) => processBrowserControllerStep(windowId),
  [UI_COMMANDS.RESUME]: ({ windowId }) => controlRun(windowId, "RESUME"),
  [UI_COMMANDS.STOP]: async ({ windowId }) => {
    await signalAutomaticCaptureCancellation(windowId, "OPERATOR_STOP");
    return controlRun(windowId, "STOP");
  },
  [UI_COMMANDS.START_EVIDENCE_OBSERVATION]: ({ windowId }) => startEvidenceObservation(windowId),
  [UI_COMMANDS.STOP_EVIDENCE_OBSERVATION]: ({ windowId }) => stopEvidenceObservation(windowId),
  [UI_COMMANDS.START_APP_AUDIT]: ({ windowId, payload }) =>
    startMission(windowId, {
      modeId: MISSION_MODE_IDS.APP_AUDIT_LONG,
      input: payload
    }, UI_COMMANDS.START_APP_AUDIT),
  [UI_COMMANDS.START_ARCHAEOLOGY]: ({ windowId, payload }) =>
    startMission(windowId, {
      modeId: MISSION_MODE_IDS.ARCHAEOLOGY_LONG,
      input: payload
    }, UI_COMMANDS.START_ARCHAEOLOGY),
  [UI_COMMANDS.AUTHORIZE_BOUNDARY]: ({ windowId, payload }) =>
    authorizeBoundary(windowId, payload),
  [UI_COMMANDS.SUBMIT_OPERATOR_ACTION_RECEIPT]: ({ windowId, payload }) =>
    submitOperatorActionEvidence(windowId, payload),
  [UI_COMMANDS.CAPTURE_SESSION]: ({ windowId, payload }) =>
    captureSessionContext(windowId, payload),
  [UI_COMMANDS.REQUEST_CORE_SURFACE_REVIEW]: ({ windowId, payload }) =>
    requestCoreSurfaceReview(windowId, payload),
  [UI_COMMANDS.MARK_CORE_SURFACE_REVIEW_ANALYZING]: ({ windowId, payload }) =>
    markCoreSurfaceReviewAnalyzing(windowId, payload),
  [UI_COMMANDS.STORE_CORE_SURFACE_REVIEW_PROPOSAL]: ({ windowId, payload }) =>
    storeCoreSurfaceReviewProposal(windowId, payload),
  [UI_COMMANDS.FAIL_CORE_SURFACE_REVIEW]: ({ windowId, payload }) =>
    failCoreSurfaceReview(windowId, payload),
  [UI_COMMANDS.APPLY_CORE_SURFACE_REVIEW]: ({ windowId, payload }) =>
    applyCoreSurfaceReview(windowId, payload),
  [UI_COMMANDS.DECLINE_CORE_SURFACE_REVIEW]: ({ windowId, payload }) =>
    declineCoreSurfaceReview(windowId, payload),
  [UI_COMMANDS.PURGE_SESSION_CONTEXT]: ({ windowId, payload }) =>
    purgeSessionContext(windowId, payload),
  [UI_COMMANDS.RETRY_SESSION_CONTEXT_INIT]: ({ windowId }) =>
    retrySessionContextInitialization(windowId),
  [UI_COMMANDS.IMPORT]: ({ windowId, payload }) =>
    importState(windowId, payload.payload),
  [UI_COMMANDS.RESET_WINDOW]: ({ windowId }) => resetWindow(windowId),
  [UI_COMMANDS.RESUME_BROWSER_RECOVERY]: ({ windowId }) => resumeBrowserRecovery(windowId),
  [UI_COMMANDS.ROLLBACK_IMPORTED_STATE]: ({ windowId }) => rollbackImportedState(windowId),
  [UI_COMMANDS.CLEAR_AUDIT]: ({ windowId }) => clearAudit(windowId),
  [UI_COMMANDS.ADD_AUDIT]: ({ windowId, payload }) =>
    recordUiAudit(windowId, payload.auditEntry || {})
});

async function handleUiCommand(message) {
  await ensureInitialized();
  const commandName = sanitizeText(message?.command, 120);
  const auditCommand = [
    UI_COMMANDS.GET_FULL_AUDIT_BATCH,
    UI_COMMANDS.ACK_FULL_AUDIT_BATCH
  ].includes(commandName);
  if (fullAuditLoggingEnabledCache && !auditCommand) {
    fullAuditPendingEntries.push({
      level: "info",
      event: "ui.command.started",
      message: commandName,
      windowId: Number.isInteger(Number(message?.windowId)) ? Number(message.windowId) : null,
      correlationId: sanitizeText(message?.requestId, 240) || null,
      data: {
        payloadKeys: Object.keys(message?.payload || {}).slice(0, 40)
      }
    });
  }
  try {
    const result = await dispatchUiCommand(message, UI_COMMAND_HANDLERS);
    if (fullAuditLoggingEnabledCache && !auditCommand) {
      await persistFullAuditQueueFailSoft([{
        level: "info",
        event: "ui.command.completed",
        message: commandName,
        windowId: Number.isInteger(Number(message?.windowId)) ? Number(message.windowId) : null,
        correlationId: sanitizeText(message?.requestId, 240) || null,
        data: { ok: true }
      }]);
    }
    return result;
  } catch (error) {
    if (fullAuditLoggingEnabledCache && !auditCommand) {
      await persistFullAuditQueueFailSoft([{
        level: "error",
        event: "ui.command.failed",
        message: commandName,
        windowId: Number.isInteger(Number(message?.windowId)) ? Number(message.windowId) : null,
        correlationId: sanitizeText(message?.requestId, 240) || null,
        data: { error: sanitizeText(error?.message || error, 1000) }
      }]);
    }
    throw error;
  }
}

/**
 * Folds one APP_AUDIT_LONG turn into durable state.
 *
 * Every value here originates in the target session. The addon has no channel to the
 * Workbench, to `scripts/eic_app_audit.py` or to Forgejo, so a passing gate means the
 * claim is internally consistent and well-ordered — never that a row was written. The
 * stored records carry `provenance: "target-session-claim"` for exactly that reason.
 */
function ingestAuditEvent(runValue, responseText, { turnId = "", at = "", audit = null, windowId = null } = {}) {
  const run = runValue;
  run.audit ||= createAuditRunState(run.runId, {
    testNeed: run.auditTestNeed || "",
    context: run.auditContext || ""
  });

  const placement = auditEventPlacement(responseText);
  const parsed = parseAuditEvent(responseText);
  if (!parsed.valid) {
    run.audit.gateFailures = [
      ...(run.audit.gateFailures || []),
      { code: parsed.reason, turnId, at, placement }
    ].slice(-40);
    run.auditLastGate = { valid: false, errors: [parsed.reason], advisories: [], placement };
    if (run.pendingObservation) {
      run.pendingObservation.auditEvent = null;
      run.pendingObservation.auditGate = run.auditLastGate;
      run.pendingObservation.responseText =
        `${run.pendingObservation.responseText}\n\n[AUDIT gate=${parsed.reason}]`;
    }
    if (audit) {
      addAudit(audit, {
        kind: "warning",
        title: "Audit-event saknas eller är trasigt",
        detail: `${parsed.reason} · placement=${placement}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }
    return run;
  }

  const gate = evaluateAuditEvent(parsed.event, {
    auditState: run.audit,
    expectedRunId: run.audit.auditRunId || parsed.event.runId,
    expectedTurnId: turnId,
    placement,
    markerCount: parsed.block.markerCount
  });
  run.auditLastEvent = parsed.event;
  run.auditLastGate = gate;

  if (!run.audit.auditRunId && parsed.event.runId) run.audit.auditRunId = parsed.event.runId;

  if (gate.valid) {
    run.audit = applyAuditEvent(run.audit, parsed.event, { turnId, at });
    if (audit) {
      addAudit(audit, {
        kind: "info",
        title: "Auditsteg registrerat som målpåstående",
        detail: summarizeAuditEventForNano(parsed.event, gate),
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }
  } else {
    run.audit.gateFailures = [
      ...(run.audit.gateFailures || []),
      { code: gate.errors.join(","), turnId, at, placement }
    ].slice(-40);
    if (audit) {
      addAudit(audit, {
        kind: "warning",
        title: "Auditgrind avvisade turen",
        detail: `${gate.errors.join(", ")}${gate.advisories.length ? ` · advisory ${gate.advisories.join(", ")}` : ""} · placement=${placement}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }
  }

  // The full target response was stripped before compaction. Add only the compact
  // structured summary here; never try to rediscover a potentially truncated event block
  // inside the already projected observation.
  if (run.pendingObservation) {
    run.pendingObservation.responseText =
      `${run.pendingObservation.responseText}\n\n[${summarizeAuditEventForNano(parsed.event, gate)}]`;
    run.pendingObservation.auditEvent = parsed.event;
    run.pendingObservation.auditGate = gate;
  }
  return run;
}


/**
 * Folds one ARCHAEOLOGY_LONG event into durable target-claim state.
 * A valid gate proves only structure, sequencing and effect-bound compliance.
 */
function ingestArchaeologyEvent(runValue, responseText, { turnId = "", at = "", audit = null, windowId = null } = {}) {
  const run = runValue;
  run.archaeology ||= createArchaeologyRunState(run.runId, {
    scenario: run.archaeologyScenario || "GENERAL_RESEARCH",
    question: run.archaeologyQuestion || "",
    context: run.archaeologyContext || ""
  });

  const placement = archaeologyEventPlacement(responseText);
  const parsed = parseArchaeologyEvent(responseText);
  if (!parsed.valid) {
    run.archaeology.gateFailures = [
      ...(run.archaeology.gateFailures || []),
      { code: parsed.reason, turnId, at, placement }
    ].slice(-40);
    run.archaeologyLastGate = { valid: false, errors: [parsed.reason], advisories: [], placement };
    if (run.pendingObservation) {
      run.pendingObservation.archaeologyEvent = null;
      run.pendingObservation.archaeologyGate = run.archaeologyLastGate;
      run.pendingObservation.responseText =
        `${run.pendingObservation.responseText}\n\n[ARCHAEOLOGY gate=${parsed.reason}]`;
    }
    if (audit) {
      addAudit(audit, {
        kind: "warning",
        title: "Forsknings-event saknas eller är trasigt",
        detail: `${parsed.reason} · placement=${placement}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }
    return run;
  }

  const gate = evaluateArchaeologyEvent(parsed.event, {
    researchState: run.archaeology,
    expectedRunId: run.archaeology.archaeologyRunId || run.runId,
    expectedTurnId: turnId,
    expectedScenario: run.archaeology.scenario,
    placement,
    markerCount: parsed.block.markerCount
  });
  run.archaeologyLastEvent = parsed.event;
  run.archaeologyLastGate = gate;

  if (gate.valid) {
    run.archaeology = applyArchaeologyEvent(run.archaeology, parsed.event, { turnId, at });
    if (audit) {
      addAudit(audit, {
        kind: "info",
        title: "Forskningssteg registrerat som målpåstående",
        detail: summarizeArchaeologyEventForNano(parsed.event, gate),
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }
  } else {
    run.archaeology.gateFailures = [
      ...(run.archaeology.gateFailures || []),
      { code: gate.errors.join(","), turnId, at, placement }
    ].slice(-40);
    if (audit) {
      addAudit(audit, {
        kind: "warning",
        title: "Forskningsgrind avvisade turen",
        detail: `${gate.errors.join(", ")} · placement=${placement}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }
  }

  if (run.pendingObservation) {
    run.pendingObservation.responseText =
      `${run.pendingObservation.responseText}\n\n[${summarizeArchaeologyEventForNano(parsed.event, gate)}]`;
    run.pendingObservation.archaeologyEvent = parsed.event;
    run.pendingObservation.archaeologyGate = gate;
  }
  return run;
}

/**
 * v0.7.4: audit progress is not the model's `progressDelta`.
 *
 * A systematic audit deliberately produces near-identical action keys, and a model that
 * reports zero delta for a passing test is being accurate. Under the generic anti-loop
 * rules that reads as stagnation — five cycles to REDUCE_SCOPE, eight to
 * NO_PROGRESS_BUDGET_EXHAUSTED — which is the exact failure observed in the field on
 * 2026-08-02. Progress here comes from the two things the addon can check itself: a new
 * step number and a new coverage cell.
 */
function auditProgressDelta(run, fallbackDelta) {
  if (run?.mode !== RUN_MODES.APP_AUDIT_LONG) return fallbackDelta;
  // ingestAuditEvent computes progress against the pre-fold state and stores it on the
  // gate. Recomputing after applyAuditEvent would compare the event with itself and erase
  // step/coverage progress. Invalid events never count as progress.
  if (!run.auditLastGate?.valid) return 0;
  const delta = Number(run.auditLastGate?.progress?.delta);
  return Number.isFinite(delta) ? Math.max(0, Math.min(3, delta)) : 0;
}

function archaeologyProgressDelta(run, fallbackDelta) {
  if (run?.mode !== RUN_MODES.ARCHAEOLOGY_LONG) return fallbackDelta;
  if (!run.archaeologyLastGate?.valid) return 0;
  const delta = Number(run.archaeologyLastGate?.progress?.delta);
  return Number.isFinite(delta) ? Math.max(0, Math.min(3, delta)) : 0;
}

async function startAppAudit(windowId, message = {}) {
  return startAppAuditMission(windowId, message, UI_COMMANDS.START_APP_AUDIT);
}

async function startAppAuditMission(windowId, message = {}, sourceCommand = UI_COMMANDS.START_APP_AUDIT, normalizedRequest = null) {
  const { config } = await loadBundle(windowId);
  const testNeed = sanitizeText(message.testNeed ?? config.appAuditTestNeed, 4000);
  const context = sanitizeText(message.context ?? config.appAuditContext, 8000);
  if (!testNeed) throw new Error("Testbehov krävs för systematisk appgranskning.");

  const options = {
    testNeed,
    context,
    targetReadOnly: message.targetReadOnly ?? config.appAuditTargetReadOnly !== false,
    allowWorkbenchAuditFiles: message.allowWorkbenchAuditFiles ?? config.appAuditAllowWorkbenchFiles !== false,
    allowForgejoFindingSink: message.allowForgejoFindingSink ?? config.appAuditAllowForgejoSink !== false
  };
  if (!options.allowWorkbenchAuditFiles) {
    throw new Error("APP_AUDIT_LONG kräver Workbench-auditfiler och SQLite-ledgern.");
  }
  const missionRequest = normalizedRequest || normalizeMissionStartRequest({
    modeId: MISSION_MODE_IDS.APP_AUDIT_LONG,
    input: options,
    sourceCommand
  });
  const analysis = buildAppAuditStartAnalysis(options);

  return enqueue(() => preparePreparedSessionRunUnlocked(windowId, {
    startPromptFactory: ({ runId, turnId }) => buildAppAuditStartPrompt({
      ...options,
      auditRunId: runId,
      auditTurnId: turnId
    }),
    analysis,
    runMode: RUN_MODES.APP_AUDIT_LONG,
    missionRequest,
    initializeRun(run, { audit }) {
      run.auditTestNeed = testNeed;
      run.auditContext = context;
      run.auditOptions = options;
      run.audit = createAuditRunState(run.runId, { testNeed, context });
      run.destructivenessCeiling = APP_AUDIT_EFFECT_CEILING;
      addAudit(audit, {
        kind: "info",
        title: "Systematisk appgranskning startad",
        detail: `APP_AUDIT_LONG · ledger scripts/eic_app_audit.py · read-only mål=${options.targetReadOnly} · Forgejo-sink=${options.allowForgejoFindingSink}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      return run;
    }
  }));
}


async function startArchaeology(windowId, message = {}) {
  return startArchaeologyMission(windowId, message, UI_COMMANDS.START_ARCHAEOLOGY);
}

async function startArchaeologyMission(windowId, message = {}, sourceCommand = UI_COMMANDS.START_ARCHAEOLOGY, normalizedRequest = null) {
  const { config } = await loadBundle(windowId);
  const scenario = sanitizeText(message.scenario ?? config.archaeologyScenario, 80).toUpperCase() || "GENERAL_RESEARCH";
  const question = sanitizeText(message.question ?? config.archaeologyQuestion, 5000);
  const context = sanitizeText(message.context ?? config.archaeologyContext, 12000);
  if (!question) throw new Error("Forskningsfråga krävs för ARCHAEOLOGY_LONG.");

  const options = {
    scenario,
    question,
    context,
    allowWorkspaceEvidence: message.allowWorkspaceEvidence ?? config.archaeologyAllowWorkspaceEvidence !== false,
    allowExport: message.allowExport ?? config.archaeologyAllowExport !== false
  };
  const missionRequest = normalizedRequest || normalizeMissionStartRequest({
    modeId: MISSION_MODE_IDS.ARCHAEOLOGY_LONG,
    input: options,
    sourceCommand
  });
  const analysis = buildArchaeologyStartAnalysis(options);

  return enqueue(() => preparePreparedSessionRunUnlocked(windowId, {
    startPromptFactory: ({ runId, turnId }) => buildArchaeologyStartPrompt({
      ...options,
      archaeologyRunId: runId,
      archaeologyTurnId: turnId
    }),
    analysis,
    runMode: RUN_MODES.ARCHAEOLOGY_LONG,
    missionRequest,
    initializeRun(run, { audit }) {
      run.archaeologyScenario = scenario;
      run.archaeologyQuestion = question;
      run.archaeologyContext = context;
      run.archaeologyOptions = options;
      run.archaeology = createArchaeologyRunState(run.runId, { scenario, question, context });
      run.destructivenessCeiling = ARCHAEOLOGY_EFFECT_CEILING;
      addAudit(audit, {
        kind: "info",
        title: "ARCHAEOLOGY_LONG startad",
        detail: `${scenario} · analysis-only · Workspace-evidens=${options.allowWorkspaceEvidence} · export=${options.allowExport}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      return run;
    }
  }));
}


function activeMissionIdForRun(context, run) {
  return sanitizeText(
    context?.activeMissionId || run?.missionId || `mission:${run?.runId || "unknown"}`,
    240
  );
}

function operatorActionTypeFromInstruction(instruction = "") {
  const value = String(instruction).toLocaleLowerCase("sv-SE");
  if (/export|ladda ned|download/.test(value)) return "EXPORT_FILE";
  if (/bifoga|upload|ladda upp/.test(value)) return "UPLOAD_FILE";
  if (/starta om|restart|reboot/.test(value)) return "RESTART";
  if (/logga in|login|sign in/.test(value)) return "LOGIN";
  if (/klick|click/.test(value)) return "MANUAL_CLICK";
  return "MECHANICAL_OPERATOR_STEP";
}

async function enterOperatorActionWait({
  runtime,
  continuity,
  audit,
  context,
  run,
  windowId,
  targetResult
}) {
  const missionId = activeMissionIdForRun(context, run);
  const action = createOperatorAction({
    actionType: operatorActionTypeFromInstruction(targetResult.next),
    instruction: targetResult.next,
    targetSurface: "CHATGPT_CONTROLLER",
    targetLocator: `window:${windowId}:tab:${run.targetTabId}:conversation:${run.conversationKey || "unknown"}`,
    riskLevel: sanitizeText(run.destructiveness?.label || "LEVEL_1_READ_ONLY", 120),
    decisionRequired: false,
    operatorPresenceRequired: true,
    expectedEvidence: {
      description: targetResult.completionDetail || "Observerbart kvitto från den exakta mekaniska åtgärden.",
      completionState: targetResult.completionState
    },
    resumeCondition: {
      type: "EXACT_FIELDS",
      fields: { completed: true }
    },
    missionId,
    runId: run.runId
  });
  action.conversationKey = run.conversationKey || "";
  action.projectId = Number(run.activeTaskProjectId || EIC_AUTONOM_AGENT_PROJECT_ID);
  action.taskFingerprint = run.taskFingerprint || "";
  run.operatorAction = action;
  run.operatorDecision = null;
  run.pendingNanoRequest = null;
  run.pendingObservation = null;
  run.timeoutSuspended = true;
  run.responseDeadlineAt = null;
  run = transitionRun(run, STATES.AWAITING_OPERATOR_ACTION, {
    origin: PAUSE_ORIGINS.NONE,
    reason: `OPERATOR_ACTION_REQUIRED: ${action.instruction}`,
    force: true
  });
  context.run = run;
  const db = await sessionDatabase();
  await db.put("operatorActions", action);
  await chrome.storage.local.set({
    [SESSION_DB_POINTER_KEYS.READINESS]: {
      state: "AWAITING_OPERATOR_ACTION",
      actionId: action.actionId,
      missionId,
      runId: run.runId,
      updatedAt: nowIso()
    }
  });
  addAudit(audit, {
    kind: "warning",
    title: "Mekanisk operatörsåtgärd krävs",
    detail: `${action.actionId} · ${action.actionType} · ${action.instruction}`,
    windowId,
    tabId: run.targetTabId,
    runId: run.runId
  });
  await writeRuntimeBundle(runtime, continuity, audit);
  await setTabIndicator(run.targetTabId, "PAUSED", "Exakt operatörsåtgärd väntar på kvitto");
  await notifyPanels(windowId);
  return snapshotForWindow(windowId);
}

async function submitOperatorActionEvidence(windowId, message = {}) {
  return enqueue(async () => {
    const runtime = await readRuntimeBundle(windowId);
    const { context, continuity, audit } = runtime;
    let run = context.run;
    if (!run || run.state !== STATES.AWAITING_OPERATOR_ACTION || !run.operatorAction) {
      throw new Error("OPERATOR_ACTION_NOT_ACTIVE");
    }
    const result = submitOperatorActionReceipt(run.operatorAction, {
      actionId: message.actionId,
      missionId: message.missionId,
      runId: message.runId,
      evidence: message.evidence
    });
    run.operatorAction = result.action;
    const db = await sessionDatabase();
    await db.put("operatorActions", result.action);
    if (result.resumeAllowed) {
      run.timeoutSuspended = false;
      run.responseDeadlineAt = Date.now() + 7_200_000;
      run = transitionRun(run, STATES.RECOVERING, {
        origin: PAUSE_ORIGINS.NONE,
        reason: `Operator-action-kvitto ${result.action.receipt?.receiptId || "readback"} accepterat; färsk målstate läses före fortsatt Nano.`,
        force: true
      });
    }
    context.run = run;
    addAudit(audit, {
      kind: result.resumeAllowed ? "done" : "blocked",
      title: result.resumeAllowed ? "Operatörsåtgärd kvitterad" : "Operatörsåtgärd väntar",
      detail: `${message.actionId} · idempotent=${result.idempotent}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await chrome.storage.local.set({
      [SESSION_DB_POINTER_KEYS.READINESS]: {
        state: result.resumeAllowed ? "RESUME_PENDING_OWNER_READ" : "AWAITING_OPERATOR_ACTION",
        actionId: result.action.actionId,
        missionId: result.action.missionId,
        runId: result.action.runId,
        updatedAt: nowIso()
      }
    });
    await notifyPanels(windowId);
    if (result.resumeAllowed) {
      setTimeout(() => tickWindow(windowId, "operator-action-receipt").catch(console.warn), 0);
    }
    return snapshotForWindow(windowId);
  });
}

function summarizeSectionLocally(section, turns) {
  const sectionTurnsValue = turns.filter((turn) => section.turnIds.includes(turn.id));
  const latestUser = [...sectionTurnsValue].reverse().find((turn) => turn.role === "user");
  const latestAssistant = [...sectionTurnsValue].reverse().find((turn) => turn.role === "assistant");
  const item = (turn, text, id) => turn ? [{
    id,
    text: sanitizeText(text || turn.text, 4000),
    sourceTurnIds: [turn.id],
    sourceHashes: [turn.sourceHash],
    evidenceClass: "UNTRUSTED_TRANSCRIPT_DATA",
    confidence: 0.5,
    captureCompleteness: "PARTIAL",
    state: "active"
  }] : [];
  return {
    narrative: sanitizeText(
      sectionTurnsValue.map((turn) => `${turn.role}: ${turn.text}`).join("\n"),
      12000
    ),
    registers: {
      userGoals: item(latestUser, latestUser?.text, `${section.id}:user-goal`),
      verifiedFacts: [],
      assistantClaims: item(latestAssistant, latestAssistant?.text, `${section.id}:assistant-claim`),
      inferences: [],
      decisions: [],
      constraints: [],
      preferences: [],
      openLoops: [],
      blockers: [],
      operatorActions: [],
      artifactsAndOwnerLocators: [],
      supersededItems: []
    }
  };
}

function coreSurfaceReviewSessionReady(run) {
  return !run?.sessionContextInit || !sessionContextInitBlocksWork(run.sessionContextInit);
}

function coreSurfaceReviewNanoOwned(context, run) {
  return Boolean(
    run?.pendingNanoRequest ||
    context?.nanoHostTelemetry?.busy
  );
}

function maybeReplayDeferredCoreSurfaceReview({
  context,
  run,
  applicationLog,
  audit,
  windowId,
  reason = "runtime-reconcile",
  now = Date.now()
} = {}) {
  const deferral = context?.coreSurfaceReviewDeferral || null;
  if (!context || !deferral) {
    return { action: "NONE", reason: "NO_DEFERRAL" };
  }
  const decision = replayDeferredCoreSurfaceReview({
    deferral,
    review: context.coreSurfaceReview,
    appSessionId: sanitizeText(applicationLog?.currentSessionId, 240),
    captureId: context.sessionCaptureSummary?.captureId || "",
    memoryId: context.sessionMemorySummary?.memoryId || "",
    sessionContextReady: coreSurfaceReviewSessionReady(run),
    pendingNanoRequest: run?.pendingNanoRequest || null,
    nanoHostBusy: context.nanoHostTelemetry?.busy === true,
    now
  });
  context.coreSurfaceReview = decision.review;
  context.coreSurfaceReviewDeferral = decision.deferral;
  if (decision.action === "SCHEDULE") {
    addAudit(audit, {
      kind: "info",
      title: "Uppskjuten Nano-granskning återupptagen",
      detail: `${reason} · ${decision.review.captureId} · ${decision.review.memoryId}`,
      windowId,
      tabId: run?.targetTabId || context.selectedTabId || null,
      runId: run?.runId || null
    });
  } else if (decision.action === "CONSUME_NOOP") {
    addAudit(audit, {
      kind: "info",
      title: "Uppskjuten Nano-granskning redan konsumerad",
      detail: `${reason} · appsessionen har redan en kärnytegranskning.`,
      windowId,
      tabId: run?.targetTabId || context.selectedTabId || null,
      runId: run?.runId || null
    });
  }
  return decision;
}


async function captureSessionContext(windowId, {
  forceFull = false,
  automatic = false,
  trigger = "",
  requestId = "",
  fingerprint = ""
} = {}) {
  return enqueue(async () => {
    const bundle = await loadBundle(windowId);
    const { config, runtime, audit, applicationLog } = bundle;
    const context = getWindowContext(runtime, windowId);
    const run = context.run;
    const captureGate = shouldDeferSessionCapture({
      automatic,
      run,
      nanoHostTelemetry: context.nanoHostTelemetry
    });
    if (captureGate.defer) {
      if (automatic && captureGate.retryable) {
        // v0.10.11: count the deferral before re-scheduling so the retry chain
        // backs off instead of hammering the target at a fixed 2.5 s.
        const numericWindowId = Number(windowId);
        autoCaptureDefers.set(numericWindowId, (autoCaptureDefers.get(numericWindowId) || 0) + 1);
        scheduleBackgroundAutoSessionCapture(windowId, "nano-complete-retry");
        throw new Error(`SESSION_CAPTURE_CANCELLED:${captureGate.reason}`);
      }
      throw new Error(captureGate.reason);
    }
    const tabId = run?.targetTabId || context.selectedTabId;
    if (!Number.isInteger(tabId)) throw new Error("SESSION_CAPTURE_TARGET_TAB_REQUIRED");
    const sweep = await chrome.tabs.sendMessage(tabId, {
      type: "EIC_CAPTURE_TRANSCRIPT",
      requestId: requestId || randomId("manual-capture")
    });
    if (!sweep?.ok) throw new Error(`SESSION_CAPTURE_SWEEP_FAILED:${sweep?.error || "UNKNOWN"}`);

    const pointers = await chrome.storage.local.get([
      SESSION_DB_POINTER_KEYS.ACTIVE_CAPTURE_ID,
      SESSION_DB_POINTER_KEYS.ACTIVE_MEMORY_ID
    ]);
    const db = await sessionDatabase();
    const priorCapture = pointers[SESSION_DB_POINTER_KEYS.ACTIVE_CAPTURE_ID]
      ? await db.get("captures", pointers[SESSION_DB_POINTER_KEYS.ACTIVE_CAPTURE_ID])
      : null;
    const priorMemory = pointers[SESSION_DB_POINTER_KEYS.ACTIVE_MEMORY_ID]
      ? await db.get("sessionMemories", pointers[SESSION_DB_POINTER_KEYS.ACTIVE_MEMORY_ID])
      : null;
    const taskFingerprint = sanitizeText(run?.taskFingerprint || run?.runId || "no-active-run", 500);
    const freshness = captureRefreshRequired({
      memory: priorMemory,
      conversationKey: sweep.conversationKey,
      branchKey: sweep.branchKey,
      taskFingerprint,
      gaps: sweep.gaps || [],
      requested: Boolean(forceFull),
      priorCapture
    });
    const controlProjectId = Number(
      run?.activeTaskBinding?.projectId ||
      run?.activeTaskProjectId ||
      config.activeTaskProjectId ||
      EIC_AUTONOM_AGENT_PROJECT_ID
    );
    const targetProjectBinding = inferTargetProjectBinding(sweep.messages || [], controlProjectId);
    const targetProjectId = targetProjectBinding.projectId || Number(run?.targetProjectId || controlProjectId);
    if (run) {
      run.targetProjectId = targetProjectId;
      run.targetProjectBinding = targetProjectBinding;
      run.targetProjectBindingSource = targetProjectBinding.source;
    }
    context.targetProjectBinding = targetProjectBinding;
    const baseInput = {
      conversationKey: sweep.conversationKey,
      projectId: targetProjectId,
      taskFingerprint,
      mandateVersion: config.targetMandateVersion,
      mandateSha256: await sha256Hex(sanitizeText(config.targetMandate, 24_000)),
      messages: sweep.messages || [],
      gaps: sweep.gaps || []
    };
    const priorTurns = priorCapture
      ? (await db.list("turns", { limit: 5000 }))
          .filter((turn) => turn.captureId === priorCapture.id || priorCapture.turnIds?.includes(turn.id))
      : [];
    let result;
    if (freshness.required || !priorCapture) {
      result = await buildSessionCapture({ ...baseInput, mode: "FULL" });
      if (priorCapture) {
        result = await reconcileMonotonicCapture(
          { capture: priorCapture, turns: priorTurns },
          result
        );
      }
    } else {
      result = await createDeltaCapture({ capture: priorCapture, turns: priorTurns }, baseInput);
    }
    result.capture.branchKey = sweep.branchKey;
    result.capture.scrollRestored = sweep.scrollRestored === true;
    result.capture.refreshReason = freshness.reason;
    await db.put("captures", result.capture);
    for (const turn of result.turns) await db.put("turns", turn);

    const sections = await sectionTurns(result.turns, {
      captureId: result.capture.id,
      conversationKey: result.capture.conversationKey
    });
    const summaries = [];
    for (const section of sections) {
      section.projectId = result.capture.projectId;
      section.taskFingerprint = result.capture.taskFingerprint;
      await db.put("sections", section);
      const summary = await createSectionSummary(
        section,
        summarizeSectionLocally(section, result.turns),
        result.turns
      );
      summary.projectId = result.capture.projectId;
      summary.taskFingerprint = result.capture.taskFingerprint;
      await db.put("sectionSummaries", summary);
      summaries.push(summary);
    }
    const memory = await synthesizeSessionMemory({
      conversationKey: result.capture.conversationKey,
      branchKey: sweep.branchKey,
      projectId: result.capture.projectId,
      taskFingerprint: result.capture.taskFingerprint,
      mandateVersion: result.capture.mandateVersion,
      mandateSha256: result.capture.mandateSha256,
      capture: result.capture,
      sectionSummaries: summaries,
      priorMemory,
      narrative: summaries.map((summary) => summary.narrative).filter(Boolean).join("\n\n")
    });
    await db.put("sessionMemories", memory);
    await chrome.storage.local.set({
      [SESSION_DB_POINTER_KEYS.ACTIVE_CAPTURE_ID]: result.capture.id,
      [SESSION_DB_POINTER_KEYS.ACTIVE_MEMORY_ID]: memory.id,
      [SESSION_DB_POINTER_KEYS.READINESS]: {
        state: memory.state,
        captureId: result.capture.id,
        memoryId: memory.id,
        completeness: result.capture.completeness,
        updatedAt: nowIso()
      }
    });
    const captureSummary = {
      schema: result.capture.schema,
      captureId: result.capture.id,
      mode: result.capture.mode,
      completeness: result.capture.completeness,
      gapCount: result.capture.gaps.length,
      turnCount: result.capture.turnIds.length,
      scrollRestored: result.capture.scrollRestored,
      conversationKey: result.capture.conversationKey,
      updatedAt: nowIso()
    };
    const memorySummary = {
      schema: memory.schema,
      memoryId: memory.id,
      state: memory.state,
      sourceHash: memory.sourceChainHash,
      itemCount: Object.values(memory.registers || {}).flat().length,
      activeCapsule: buildActiveMemoryCapsule(memory, { maxChars: 12000 }),
      updatedAt: nowIso()
    };
    context.sessionCaptureSummary = captureSummary;
    context.sessionMemorySummary = memorySummary;
    const linkedCaptureTab = context.linkedTabs?.[String(tabId)] || null;
    const completedFingerprint = fingerprint || createCaptureFingerprint({
      conversationKey: result.capture.conversationKey,
      latestMessageHash: sweep.latestMessageHash || linkedCaptureTab?.latestMessageHash || ""
    });
    context.autoCaptureFingerprint = completedFingerprint;
    if (automatic) {
      context.autoCaptureGuard = createAutoCaptureGuard({
        fingerprint: completedFingerprint,
        requestId: requestId || sweep.requestId || "",
        status: "COMPLETED"
      });
    }
    if (run) {
      run.sessionCaptureSummary = captureSummary;
      run.sessionMemorySummary = memorySummary;
      context.run = run;
    }
    const appSessionId = sanitizeText(applicationLog?.currentSessionId, 240);
    const automaticReviewDue = shouldScheduleAutomaticCoreSurfaceReview({
      review: context.coreSurfaceReview,
      appSessionId,
      captureId: result.capture.id,
      memoryId: memory.id
    });
    const sessionContextInitializing = Boolean(
      run?.sessionContextInit &&
      sessionContextInitBlocksWork(run.sessionContextInit)
    );
    const missionNanoActive = coreSurfaceReviewNanoOwned(context, run);
    if (automaticReviewDue && (sessionContextInitializing || missionNanoActive)) {
      context.coreSurfaceReviewDeferral = createCoreSurfaceReviewDeferral({
        reason: sessionContextInitializing
          ? CORE_SURFACE_REVIEW_DEFERRAL_REASON.SESSION_CONTEXT_INITIALIZING
          : CORE_SURFACE_REVIEW_DEFERRAL_REASON.MISSION_NANO_HAS_PRIORITY,
        appSessionId,
        captureId: result.capture.id,
        memoryId: memory.id,
        missionId: context.activeMissionId || run?.missionId || "",
        runId: run?.runId || ""
      });
      addAudit(audit, {
        kind: "info",
        title: "Initial Nano-granskning uppskjuten",
        detail: `${context.coreSurfaceReviewDeferral.reason} · ${result.capture.id} · återupptas exakt en gång när sessionsinitiering och mission-Nano är klara.`,
        windowId,
        tabId,
        runId: run?.runId || null
      });
    } else if (automaticReviewDue) {
      context.coreSurfaceReviewDeferral = null;
      context.coreSurfaceReview = createPendingCoreSurfaceReview({
        trigger: CORE_SURFACE_REVIEW_TRIGGER.AUTO_INITIAL_CAPTURE,
        appSessionId,
        captureId: result.capture.id,
        memoryId: memory.id
      });
      addAudit(audit, {
        kind: "info",
        title: "Initial Nano-granskning av inställningar väntar",
        detail: `${automatic ? "Automatisk" : "Manuell"} capture ${result.capture.id} skapade en enda spontan kärnytegranskning för appsessionen.`,
        windowId,
        tabId,
        runId: run?.runId || null
      });
    } else if (context.coreSurfaceReviewDeferral?.appSessionId === appSessionId) {
      context.coreSurfaceReviewDeferral = null;
    }
    addAudit(audit, {
      kind: "done",
      title: "Session Capture och Session Memory uppdaterade",
      detail: `${result.capture.mode} · ${result.capture.completeness} · turns=${result.capture.turnIds.length} · memory=${memory.id} · source=${automatic ? `AUTO:${sanitizeText(trigger, 80) || "BACKGROUND"}` : "MANUAL"}`,
      windowId,
      tabId,
      runId: run?.runId || null
    });
    await writeRuntimeBundle(runtime, bundle.continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}


async function requestCoreSurfaceReview(windowId, { trigger = CORE_SURFACE_REVIEW_TRIGGER.MANUAL } = {}) {
  return enqueue(async () => {
    const resolvedTrigger = trigger === CORE_SURFACE_REVIEW_TRIGGER.AUTO_INITIAL_CAPTURE
      ? CORE_SURFACE_REVIEW_TRIGGER.AUTO_INITIAL_CAPTURE
      : CORE_SURFACE_REVIEW_TRIGGER.MANUAL;
    const bundle = await loadBundle(windowId);
    const { runtime, audit, applicationLog } = bundle;
    const context = getWindowContext(runtime, windowId);
    const captureId = context.sessionCaptureSummary?.captureId || "";
    const memoryId = context.sessionMemorySummary?.memoryId || "";
    if (!captureId || !memoryId) throw new Error("CORE_SURFACE_REVIEW_CAPTURE_REQUIRED");
    context.coreSurfaceReview = createPendingCoreSurfaceReview({
      trigger: resolvedTrigger,
      appSessionId: sanitizeText(applicationLog?.currentSessionId, 240),
      captureId,
      memoryId
    });
    addAudit(audit, {
      kind: "info",
      title: resolvedTrigger === CORE_SURFACE_REVIEW_TRIGGER.MANUAL
        ? "Manuell Nano-omvärdering begärd"
        : "Initial Nano-granskning begärd",
      detail: `${captureId} · ${memoryId}`,
      windowId,
      tabId: context.run?.targetTabId || context.selectedTabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, bundle.continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function markCoreSurfaceReviewAnalyzing(windowId, { captureId = "", memoryId = "" } = {}) {
  return enqueue(async () => {
    const bundle = await loadBundle(windowId);
    const context = getWindowContext(bundle.runtime, windowId);
    const review = context.coreSurfaceReview;
    if (!review || review.status !== CORE_SURFACE_REVIEW_STATUS.PENDING_ANALYSIS) {
      throw new Error("CORE_SURFACE_REVIEW_NOT_PENDING");
    }
    if (captureId && review.captureId !== captureId) throw new Error("CORE_SURFACE_REVIEW_STALE_CAPTURE");
    if (memoryId && review.memoryId !== memoryId) throw new Error("CORE_SURFACE_REVIEW_STALE_MEMORY");
    review.status = CORE_SURFACE_REVIEW_STATUS.ANALYZING;
    review.startedAt = nowIso();
    review.error = "";
    context.coreSurfaceReview = review;
    await writeRuntimeBundle(bundle.runtime, bundle.continuity, bundle.audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}


async function configFromCoreSurfaceProposal(proposal, currentConfig = {}) {
  const next = { ...currentConfig, ...(proposal?.configPatch || {}) };
  if (proposal?.configPatch?.quickProfileId) {
    const preset = SCENARIO_PRESETS.find((item) => item.id === proposal.configPatch.quickProfileId);
    if (!preset) throw new Error("CORE_SURFACE_REVIEW_QUICK_PROFILE_UNKNOWN");
    const nanoProfile = findCoreProfile(NANO_CORE_PROFILES, preset.nano);
    const targetProfile = findCoreProfile(TARGET_CORE_PROFILES, preset.target);
    if (!nanoProfile || !targetProfile) throw new Error("CORE_SURFACE_REVIEW_PROFILE_COMBINATION_INVALID");
    Object.assign(next, {
      quickProfileId: preset.id,
      scenarioPreset: preset.id,
      quickProfileCustomized: false,
      nanoMandateProfile: nanoProfile.id,
      nanoMandateVersion: nanoProfile.version,
      nanoMandate: nanoProfile.mandate,
      targetMandateProfile: targetProfile.id,
      targetMandateVersion: targetProfile.version,
      targetMandate: targetProfile.mandate,
      targetAuthorityScope: targetProfile.authorityScope,
      continuityViewProfile: preset.continuity,
      sessionCapturePolicy: preset.sessionCapture,
      sessionMemoryPolicy: preset.sessionMemory,
      autonomyBand: preset.autonomy,
      evidenceBand: preset.evidence,
      outputDensity: preset.outputDensity
    });
  }
  if (proposal?.surfaces?.nanoMandate?.change) {
    next.nanoMandate = proposal.surfaces.nanoMandate.replacement;
    next.nanoMandateProfile = "CUSTOM";
    next.nanoMandateVersion = await contentAddressedMandateVersion("nano", next.nanoMandate);
    next.quickProfileCustomized = true;
  }
  if (proposal?.surfaces?.targetMandate?.change) {
    next.targetMandate = proposal.surfaces.targetMandate.replacement;
    next.targetMandateProfile = "CUSTOM";
    next.targetMandateVersion = await contentAddressedMandateVersion("target", next.targetMandate);
    next.quickProfileCustomized = true;
  }
  return next;
}

async function storeCoreSurfaceReviewProposal(windowId, { proposal = null } = {}) {
  return enqueue(async () => {
    const bundle = await loadBundle(windowId);
    const { runtime, audit } = bundle;
    const context = getWindowContext(runtime, windowId);
    const review = context.coreSurfaceReview;
    if (!review || ![
      CORE_SURFACE_REVIEW_STATUS.PENDING_ANALYSIS,
      CORE_SURFACE_REVIEW_STATUS.ANALYZING
    ].includes(review.status)) {
      throw new Error("CORE_SURFACE_REVIEW_NOT_ACTIVE");
    }
    const normalized = await normalizeCoreSurfaceProposal(proposal, {
      trigger: review.trigger,
      captureId: review.captureId,
      memoryId: review.memoryId,
      appSessionId: review.appSessionId,
      currentConfig: bundle.config,
      currentContinuity: bundle.continuity
    });
    review.proposal = normalized;
    review.completedAt = nowIso();
    review.error = "";
    if (reviewHasMaterialChanges(normalized)) {
      review.status = CORE_SURFACE_REVIEW_STATUS.PROPOSAL_READY;
      Object.assign(review, scheduleCoreSurfaceAutoApply(review, {
        enabled: bundle.config.autoApplyCoreSurfaceReviewEnabled !== false
      }));
    } else {
      review.status = CORE_SURFACE_REVIEW_STATUS.APPLIED;
      review.decision = "NO_CHANGE";
      review.decidedAt = nowIso();
      review.autoApplyAt = null;
      review.autoApplyEnabled = false;
      review.autoApplied = false;
    }
    context.coreSurfaceReview = review;
    addAudit(audit, {
      kind: normalized.verdict === "PROPOSE_CHANGES" ? "warning" : "done",
      title: normalized.verdict === "PROPOSE_CHANGES"
        ? "Nano föreslår ändringar i inställningar eller kärnytor"
        : "Nano rekommenderar inga kärnyteändringar",
      detail: `${normalized.reviewId} · ${normalized.summary}`,
      windowId,
      tabId: context.run?.targetTabId || context.selectedTabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, bundle.continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function failCoreSurfaceReview(windowId, { error = "" } = {}) {
  return enqueue(async () => {
    const bundle = await loadBundle(windowId);
    const context = getWindowContext(bundle.runtime, windowId);
    const review = context.coreSurfaceReview;
    if (!review) throw new Error("CORE_SURFACE_REVIEW_MISSING");
    review.status = CORE_SURFACE_REVIEW_STATUS.FAILED;
    review.error = sanitizeText(error, 1200) || "CORE_SURFACE_REVIEW_FAILED";
    review.completedAt = nowIso();
    context.coreSurfaceReview = review;
    addAudit(bundle.audit, {
      kind: "error",
      title: "Nano-granskning av kärnytor misslyckades",
      detail: review.error,
      windowId,
      tabId: context.run?.targetTabId || context.selectedTabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(bundle.runtime, bundle.continuity, bundle.audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

function configMatchesCoreSurfaceProposal(config, proposal) {
  const patch = proposal?.configPatch || {};
  for (const [key, value] of Object.entries(patch)) {
    if (config?.[key] !== value) return false;
  }
  if (proposal?.surfaces?.nanoMandate?.change) {
    if (config?.nanoMandate !== proposal.surfaces.nanoMandate.replacement ||
        config?.nanoMandateProfile !== "CUSTOM") return false;
  }
  if (proposal?.surfaces?.targetMandate?.change) {
    if (config?.targetMandate !== proposal.surfaces.targetMandate.replacement ||
        config?.targetMandateProfile !== "CUSTOM") return false;
  }
  return true;
}

async function applyCoreSurfaceReview(windowId, {
  reviewId = "",
  automatic = false
} = {}) {
  return enqueue(async () => {
    const bundle = await loadBundle(windowId);
    const { config, runtime, audit } = bundle;
    const context = getWindowContext(runtime, windowId);
    const review = context.coreSurfaceReview;
    const proposal = review?.proposal;
    if (!review || review.status !== CORE_SURFACE_REVIEW_STATUS.PROPOSAL_READY || !proposal) {
      throw new Error("CORE_SURFACE_REVIEW_PROPOSAL_NOT_READY");
    }
    if (reviewId && proposal.reviewId !== reviewId) throw new Error("CORE_SURFACE_REVIEW_STALE_ID");
    if (!reviewHasMaterialChanges(proposal)) throw new Error("CORE_SURFACE_REVIEW_NO_MATERIAL_CHANGE");
    if (automatic) {
      const due = coreSurfaceAutoApplyDue(review, {
        enabled: config.autoApplyCoreSurfaceReviewEnabled !== false
      });
      if (!due.due) throw new Error(`CORE_SURFACE_REVIEW_AUTO_APPLY_NOT_DUE:${due.reason}`);
    }

    const nextConfig = await configFromCoreSurfaceProposal(proposal, config);
    const mandateChanged = (
      nextConfig.nanoMandate !== config.nanoMandate ||
      nextConfig.nanoMandateVersion !== config.nanoMandateVersion ||
      nextConfig.targetMandate !== config.targetMandate ||
      nextConfig.targetMandateVersion !== config.targetMandateVersion ||
      nextConfig.quickProfileId !== config.quickProfileId
    );
    const savedConfig = await saveConfig(nextConfig);

    let continuity = bundle.continuity;
    if (proposal.surfaces?.continuity?.change) {
      continuity.nanoReviewedContext = {
        schema: "eic.nano.reviewed-session-context.v1",
        reviewId: proposal.reviewId,
        text: proposal.surfaces.continuity.replacement,
        reason: proposal.surfaces.continuity.reason,
        sourceCaptureId: review.captureId,
        sourceMemoryId: review.memoryId,
        sourceProposalSha256: proposal.proposalSha256,
        evidenceClass: "UNTRUSTED_TRANSCRIPT_DERIVED",
        authority: "NONE",
        acceptedAt: nowIso(),
        appliedBy: automatic ? "TTL_AUTO_APPLY" : "LOCAL_OPERATOR_PANEL"
      };
      continuity.updatedAt = nowIso();
    }
    if (mandateChanged) {
      context.nanoHostTelemetry ||= {};
      Object.assign(context.nanoHostTelemetry, {
        stale: true,
        staleReason: "CORE_SURFACE_REVIEW_APPLIED",
        staleDetail: automatic
          ? "Nano-förslaget autoapplicerades efter TTL. LanguageModel återskapas före nästa Nano-analys."
          : "Nano-förslaget tillämpades efter explicit acceptans. LanguageModel återskapas före nästa Nano-analys.",
        updatedAt: nowIso()
      });
    }
    review.status = CORE_SURFACE_REVIEW_STATUS.APPLIED;
    review.decision = automatic ? "AUTO_APPLIED" : "APPLIED";
    review.decidedAt = nowIso();
    review.autoApplied = automatic;
    review.autoApplyAt = null;
    review.autoApplyEnabled = false;
    context.coreSurfaceReview = review;
    addAudit(audit, {
      kind: "done",
      title: automatic
        ? "Nano-förslag autoapplicerades efter fem minuter"
        : "Nano-förslag för kärnytor tillämpat",
      detail: `${proposal.reviewId} · ${automatic ? "TTL_AUTO_APPLY" : "explicit operatörsacceptans"} · source=${review.captureId}/${review.memoryId} · config=${savedConfig.updatedAt}`,
      windowId,
      tabId: context.run?.targetTabId || context.selectedTabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function declineCoreSurfaceReview(windowId, { reviewId = "" } = {}) {
  return enqueue(async () => {
    const bundle = await loadBundle(windowId);
    const context = getWindowContext(bundle.runtime, windowId);
    const review = context.coreSurfaceReview;
    const proposal = review?.proposal;
    if (!review || review.status !== CORE_SURFACE_REVIEW_STATUS.PROPOSAL_READY || !proposal) {
      throw new Error("CORE_SURFACE_REVIEW_PROPOSAL_NOT_READY");
    }
    if (reviewId && proposal.reviewId !== reviewId) throw new Error("CORE_SURFACE_REVIEW_STALE_ID");
    review.status = CORE_SURFACE_REVIEW_STATUS.DECLINED;
    review.decision = "DECLINED";
    review.decidedAt = nowIso();
    review.autoApplyAt = null;
    review.autoApplyEnabled = false;
    review.autoApplied = false;
    context.coreSurfaceReview = review;
    addAudit(bundle.audit, {
      kind: "warning",
      title: "Nano-förslag för kärnytor nekades",
      detail: `${proposal.reviewId} · inga inställningar eller kärnytor ändrades.`,
      windowId,
      tabId: context.run?.targetTabId || context.selectedTabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(bundle.runtime, bundle.continuity, bundle.audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function purgeSessionContext(windowId, { conversationKey = null } = {}) {
  return enqueue(async () => {
    const db = await sessionDatabase();
    const result = await db.purge({ conversationKey: sanitizeText(conversationKey, 1000) || null });
    await chrome.storage.local.remove([
      SESSION_DB_POINTER_KEYS.ACTIVE_CAPTURE_ID,
      SESSION_DB_POINTER_KEYS.ACTIVE_MEMORY_ID,
      SESSION_DB_POINTER_KEYS.READINESS
    ]);
    const runtime = await readRuntimeBundle(windowId);
    runtime.context.sessionCaptureSummary = null;
    runtime.context.sessionMemorySummary = null;
    runtime.context.autoCaptureFingerprint = "";
    runtime.context.coreSurfaceReview = null;
    if (runtime.context.run) {
      runtime.context.run.sessionCaptureSummary = null;
      runtime.context.run.sessionMemorySummary = null;
    }
    addAudit(runtime.audit, {
      kind: "warning",
      title: "Lokalt sessionskontext rensat",
      detail: `IndexedDB-poster raderade=${result.deleted}`,
      windowId,
      runId: runtime.context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, runtime.continuity, runtime.audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

/**
 * v0.7.1: the local trusted authorization surface that v0.7.0 lacked entirely.
 *
 * A level-10 boundary could previously only be left by stopping the run: `RESUME` threw
 * for any origin outside a three-item allowlist, and the tick returned early before the
 * target tab was ever read. That was correct in refusing target-authored authorization,
 * but it left the operator with no way to authorize anything at all.
 *
 * The operator must echo back the exact boundary key they were shown. A stale key — from
 * a boundary that has since been superseded — is rejected rather than silently applied.
 */
async function authorizeBoundary(windowId, message = {}) {
  return enqueue(async () => {
    const runtime = await readRuntimeBundle(windowId);
    const { context, continuity, audit } = runtime;
    let run = context.run;
    if (!run || !run.operatorDecision) {
      throw new Error("OPERATOR_DECISION_NOT_ACTIVE");
    }
    const accepted = acceptOperatorDecisionReceipt(run.operatorDecision, {
      decisionId: message.decisionId,
      missionId: message.missionId,
      runId: message.runId,
      boundaryKey: message.boundaryKey,
      acknowledgement: message.acknowledgement
    });
    run.operatorDecision = accepted.decision;
    if (accepted.idempotent && run.state !== STATES.AWAITING_OPERATOR_DECISION) {
      context.run = run;
      return snapshotForWindow(windowId);
    }
    if (run.state !== STATES.AWAITING_OPERATOR_DECISION) {
      throw new Error("OPERATOR_DECISION_STATE_MISMATCH");
    }

    const at = nowIso();
    run.boundaryAuthorization = {
      schema: "eic.autonom.boundary-authorization.v2",
      boundaryKey: accepted.decision.boundaryKey,
      decisionId: accepted.decision.decisionId,
      missionId: accepted.decision.missionId,
      runId: accepted.decision.runId,
      origin: run.pause?.origin || PAUSE_ORIGINS.NONE,
      level: Number(run.destructiveness?.level || 10),
      acknowledgement: accepted.decision.receipt.acknowledgement,
      receipt: deepClone(accepted.decision.receipt),
      authorizedBy: "LOCAL_OPERATOR_PANEL",
      at
    };
    run.boundaryAuthorizations = [
      ...(Array.isArray(run.boundaryAuthorizations) ? run.boundaryAuthorizations : []),
      run.boundaryAuthorization
    ].slice(-20);
    if (run.destructiveness) run.destructiveness.humanDecisionRequired = false;
    run.recovery ||= { attempts: [], exclusions: [], consecutiveNoProgress: 0 };
    run.recovery.consecutiveNoProgress = 0;
    run.timeoutSuspended = false;
    run.responseDeadlineAt = Date.now() + 7_200_000;
    appendRecoveryAttempt(run, makeRecoveryAttempt("OPERATOR_DECISION_RECEIPT_ACCEPTED", {
      outcome: accepted.idempotent ? "IDEMPOTENT_READBACK" : "AUTHORIZED",
      detail: `${accepted.decision.decisionId} · ${accepted.decision.boundaryKey}`
    }));

    continuity.decisions = [
      ...(Array.isArray(continuity.decisions) ? continuity.decisions : []),
      {
        id: accepted.decision.receipt.receiptId,
        at,
        turn: Number(continuity.position?.turnIndex || 0),
        choice: `OPERATOR_DECISION_ACCEPTED: ${accepted.decision.decisionId}`,
        because: accepted.decision.receipt.acknowledgement
      }
    ].slice(-40);
    continuity.updatedAt = at;

    run = transitionRun(run, STATES.RECOVERING, {
      origin: run.pause?.origin || PAUSE_ORIGINS.NONE,
      reason: "Nivå-10-kvittot accepterades och lästes tillbaka; målstate verifieras före Nano-resume.",
      force: true
    });
    context.run = run;
    addAudit(audit, {
      kind: "warning",
      title: "Materiellt operatörsbeslut kvitterat",
      detail: `${accepted.decision.decisionId} · graphembundet kvitto · idempotent=${accepted.idempotent}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    const readback = (await readRuntimeBundle(windowId)).context.run?.operatorDecision;
    if (readback?.receipt?.receiptId !== accepted.decision.receipt.receiptId) {
      throw new Error("OPERATOR_DECISION_RECEIPT_READBACK_FAILED");
    }
    await notifyPanels(windowId);
    setTimeout(() => tickWindow(windowId, "operator-decision-receipt").catch(console.warn), 0);
    return snapshotForWindow(windowId);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "EIC_UI_COMMAND") {
    handleUiCommand(message)
      .then(sendResponse)
      .catch((error) => sendResponse(createUiCommandError(message, error)));
    return true;
  }

  if (message?.type === "EIC_OBSERVATION_DIRTY" && sender.tab?.windowId != null) {
    tickWindow(sender.tab.windowId, "content-observation").catch(console.warn);
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) tickAll("watchdog").catch(console.warn);
});

chrome.runtime.onInstalled.addListener(() => {
  initialized = false;
  ensureInitialized().then(() => tickAll("installed")).catch(console.warn);
});

chrome.runtime.onStartup.addListener(() => {
  initialized = false;
  ensureInitialized().then(() => tickAll("startup")).catch(console.warn);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(activeInfo.windowId);
    const context = getWindowContext(runtime, activeInfo.windowId);
    context.lastActiveTabId = activeInfo.tabId;
    context.surfacePair = setSurfaceActiveTab(context.surfacePair, activeInfo.tabId);
    const activeRun = context.run &&
      ![STATES.PROGRAM_DONE, STATES.STOPPED, STATES.ERROR_TERMINAL].includes(context.run.state);
    if (context.targetMode === TARGET_MODES.FOLLOW &&
        context.linkedTabs[String(activeInfo.tabId)] &&
        !activeRun) {
      context.selectedTabId = activeInfo.tabId;
    }
    context.updatedAt = nowIso();
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(activeInfo.windowId);
  }).catch(console.warn);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.status && !changeInfo.title) return;
  enqueue(async () => {
    const discovery = await loadBundle(tab.windowId);
    const context = Object.values(discovery.runtime.windows || {}).find(
      (item) =>
        item?.linkedTabs?.[String(tabId)] ||
        findSurfaceRoleByTab(item?.surfacePair, tabId)
    );
    if (!context) return;
    const { continuity, runtime, audit } = await loadBundle(context.windowId);
    const ownedContext = getWindowContext(runtime, context.windowId);
    const roleBeforeUpdate = findSurfaceRoleByTab(ownedContext.surfacePair, tabId);
    if (
      roleBeforeUpdate === MISSION_SURFACE_ROLES.WEB_TARGET &&
      (changeInfo.url || changeInfo.status === "loading")
    ) {
      await detachBrowserSessionForContext(ownedContext, {
        reason: changeInfo.url ? "TARGET_NAVIGATED" : "TARGET_RELOADED"
      });
    }
    ownedContext.surfacePair = updateSurfaceForTab(ownedContext.surfacePair, tabId, {
      tab,
      changeInfo,
      reason: changeInfo.url
        ? "TAB_NAVIGATED"
        : changeInfo.status === "loading"
          ? "TAB_LOADING"
          : changeInfo.status === "complete"
            ? "TAB_READY"
            : "TAB_METADATA_UPDATED"
    });

    if (roleBeforeUpdate === MISSION_SURFACE_ROLES.WEB_TARGET) {
      const targetAfterUpdate = webTargetSurface(ownedContext);
      if (runtimeBuildProfile() === BUILD_PROFILES.BROWSER && targetAfterUpdate?.url) {
        const permission = await containsExactOriginPermission(chrome, targetAfterUpdate.url);
        applyWebTargetCapabilityState(ownedContext, {
          permissionState: permission.granted
            ? WEB_PERMISSION_STATES.GRANTED
            : WEB_PERMISSION_STATES.NOT_REQUESTED,
          permissionOriginPattern: permission.pattern,
          debuggerState: CDP_SESSION_STATES.DETACHED,
          debuggerSessionId: "",
          reason: changeInfo.url ? "TARGET_ORIGIN_RECHECKED" : "TARGET_DOCUMENT_RELOADED"
        });
      }
    }

    const record = ownedContext.linkedTabs[String(tabId)];
    if (record) {
      record.url = tab.url || record.url;
      record.title = tab.title || record.title;
      record.windowId = tab.windowId;
      record.lastSeenAt = nowIso();
      if (!isAllowedChatUrl(record.url)) {
        record.status = "UNSUPPORTED";
        if (ownedContext.run?.targetTabId === tabId) {
          ownedContext.run = transitionRun(ownedContext.run, STATES.SOFT_PAUSED, {
            origin: PAUSE_ORIGINS.TAB_NAVIGATED_AWAY,
            reason: "Målfliken navigerade bort från stödd ChatGPT-origin."
          });
        }
      } else if (changeInfo.status === "complete") {
        record.status = "LINKED";
      }
    }

    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(ownedContext.windowId);
    if (record && changeInfo.status === "complete" && isAllowedChatUrl(record.url)) {
      setTimeout(() => tickWindow(ownedContext.windowId, "tab-updated"), 0);
    }
  }).catch(console.warn);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  enqueue(async () => {
    const discovery = await loadBundle();
    const discoveredContext = Object.values(discovery.runtime.windows || {}).find(
      (candidate) =>
        candidate?.linkedTabs?.[String(removedTabId)] ||
        findSurfaceRoleByTab(candidate?.surfacePair, removedTabId)
    );
    if (!discoveredContext) return;
    const { continuity, runtime, audit } = await loadBundle(discoveredContext.windowId);
    const context = getWindowContext(runtime, discoveredContext.windowId);
    const role = findSurfaceRoleByTab(context.surfacePair, removedTabId);
    const oldRecord = context.linkedTabs[String(removedTabId)] || null;
    const tab = await chrome.tabs.get(addedTabId);

    if (role === MISSION_SURFACE_ROLES.WEB_TARGET) {
      await detachBrowserSessionForContext(context, {
        reason: "TARGET_TAB_REPLACED"
      });
    }
    if (role) {
      context.surfacePair = replaceSurfaceTab(
        context.surfacePair,
        removedTabId,
        tab
      );
      if (role === MISSION_SURFACE_ROLES.WEB_TARGET && runtimeBuildProfile() === BUILD_PROFILES.BROWSER) {
        const targetAfterReplacement = webTargetSurface(context);
        const permission = await containsExactOriginPermission(chrome, targetAfterReplacement.url);
        applyWebTargetCapabilityState(context, {
          permissionState: permission.granted
            ? WEB_PERMISSION_STATES.GRANTED
            : WEB_PERMISSION_STATES.NOT_REQUESTED,
          permissionOriginPattern: permission.pattern,
          debuggerState: CDP_SESSION_STATES.DETACHED,
          debuggerSessionId: "",
          reason: "TARGET_TAB_REPLACED"
        });
      }
    }

    if (oldRecord) {
      delete context.linkedTabs[String(removedTabId)];
      if (!isAllowedChatUrl(tab.url || "")) {
        if (context.run?.targetTabId === removedTabId) {
          context.run = transitionRun(context.run, STATES.SOFT_PAUSED, {
            origin: PAUSE_ORIGINS.TAB_NAVIGATED_AWAY,
            reason: "Chrome ersatte målfliken med en icke-stödd sida."
          });
        }
      } else {
        context.linkedTabs[String(addedTabId)] = {
          ...oldRecord,
          tabId: addedTabId,
          windowId: tab.windowId,
          url: tab.url || oldRecord.url,
          title: tab.title || oldRecord.title,
          status: "REPLACED_RECONNECTING",
          lastSeenAt: nowIso()
        };
        if (context.selectedTabId === removedTabId) context.selectedTabId = addedTabId;
        if (context.run?.targetTabId === removedTabId &&
            ![STATES.PROGRAM_DONE, STATES.STOPPED, STATES.ERROR_TERMINAL].includes(context.run.state)) {
          context.run.targetTabId = addedTabId;
          context.run = transitionRun(context.run, STATES.RECOVERING, {
            origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
            reason: "Chrome ersatte den kopplade fliken. Exakt konversation verifieras före fortsatt effekt."
          });
        }
      }
    }

    addAudit(audit, {
      kind: "warning",
      title: role === MISSION_SURFACE_ROLES.WEB_TARGET
        ? "WEB_TARGET ersatt av Chrome"
        : "Kopplad controllerflik ersatt av Chrome",
      detail: `Tab ${removedTabId} → ${addedTabId}; ytidentiteten bevarades men dokumentepoch roterades.`,
      windowId: context.windowId,
      tabId: addedTabId,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(context.windowId);
    if (oldRecord && isAllowedChatUrl(tab.url || "")) {
      setTimeout(() => tickWindow(context.windowId, "tab-replaced"), 0);
    }
  }).catch(console.warn);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(removeInfo.windowId);
    const context = getWindowContext(runtime, removeInfo.windowId);
    const role = findSurfaceRoleByTab(context.surfacePair, tabId);
    const linked = context.linkedTabs[String(tabId)] || null;
    if (!role && !linked) return;

    if (role === MISSION_SURFACE_ROLES.WEB_TARGET) {
      await detachBrowserSessionForContext(context, {
        reason: "TARGET_TAB_CLOSED"
      });
    }
    if (role) {
      context.surfacePair = markSurfaceClosed(context.surfacePair, tabId);
    }
    if (linked) {
      delete context.linkedTabs[String(tabId)];
      if (context.selectedTabId === tabId) context.selectedTabId = null;
      if (context.run?.targetTabId === tabId &&
          ![STATES.PROGRAM_DONE, STATES.STOPPED, STATES.ERROR_TERMINAL].includes(context.run.state)) {
        context.run = transitionRun(context.run, STATES.SOFT_PAUSED, {
          origin: PAUSE_ORIGINS.TAB_CLOSED,
          reason: "Den valda målfliken stängdes. Körningen och kontinuiteten är bevarade."
        });
      }
    }

    addAudit(audit, {
      kind: "warning",
      title: role === MISSION_SURFACE_ROLES.WEB_TARGET
        ? "WEB_TARGET stängd"
        : "Kopplad controllerflik stängd",
      detail: "Ingen annan flik tog automatiskt över rollen.",
      windowId: removeInfo.windowId,
      tabId,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(removeInfo.windowId);
  }).catch(console.warn);
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(detachInfo.oldWindowId);
    const oldContext = getWindowContext(runtime, detachInfo.oldWindowId);
    const role = findSurfaceRoleByTab(oldContext.surfacePair, tabId);
    const record = oldContext.linkedTabs[String(tabId)];
    if (!role && !record) return;
    if (role === MISSION_SURFACE_ROLES.WEB_TARGET) {
      await detachBrowserSessionForContext(oldContext, {
        reason: "TARGET_TAB_MOVING"
      });
    }
    if (role) {
      oldContext.surfacePair = markSurfaceMoving(oldContext.surfacePair, tabId);
    }
    if (record) {
      record.status = "MOVING";
      if (oldContext.run?.targetTabId === tabId) {
        oldContext.run = transitionRun(oldContext.run, STATES.SOFT_PAUSED, {
          origin: PAUSE_ORIGINS.TAB_MOVED,
          reason: "Målfliken flyttades till ett annat Chrome-fönster. Ny panel måste välja den explicit."
        });
      }
    }
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(detachInfo.oldWindowId);
  }).catch(console.warn);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  enqueue(async () => {
    const discovery = await loadBundle();
    const discoveredContext = Object.values(discovery.runtime.windows || {}).find(
      (context) =>
        context?.linkedTabs?.[String(tabId)] ||
        findSurfaceRoleByTab(context?.surfacePair, tabId)
    );
    if (!discoveredContext) return;
    const { continuity, runtime, audit } = await loadBundle(discoveredContext.windowId);
    const oldContext = getWindowContext(runtime, discoveredContext.windowId);
    const role = findSurfaceRoleByTab(oldContext.surfacePair, tabId);
    if (role === MISSION_SURFACE_ROLES.WEB_TARGET) {
      await detachBrowserSessionForContext(oldContext, {
        reason: "TARGET_ATTACHED_TO_OTHER_WINDOW"
      });
    }
    if (role) {
      oldContext.surfacePair = detachSurfaceRole(oldContext.surfacePair, role, {
        reason: "TAB_ATTACHED_REQUIRES_EXPLICIT_REBIND"
      });
    }

    const record = oldContext.linkedTabs[String(tabId)];
    if (record) {
      delete oldContext.linkedTabs[String(tabId)];
      if (oldContext.selectedTabId === tabId) oldContext.selectedTabId = null;
      const newContext = getWindowContext(runtime, attachInfo.newWindowId);
      record.windowId = attachInfo.newWindowId;
      record.status = "LINKED";
      record.lastSeenAt = nowIso();
      newContext.linkedTabs[String(tabId)] = record;
      await setTabIndicator(tabId, "LINKED", "Flyttad flik — välj explicit i ny panel");
    }

    addAudit(audit, {
      kind: "warning",
      title: "Yta flyttad till annat Chrome-fönster",
      detail: "Ytrollen återtas inte automatiskt. Explicit koppling krävs i den nya panelen.",
      windowId: oldContext.windowId,
      tabId,
      runId: oldContext.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(oldContext.windowId);
    await notifyPanels(attachInfo.newWindowId);
  }).catch(console.warn);
});

chrome.windows.onRemoved.addListener((windowId) => {
  enqueue(async () => {
    const { continuity, rootContinuity, runtime, audit } = await loadBundle(windowId);
    const context = runtime.windows[String(windowId)];
    if (!context) return;
    if (webTargetSurface(context)) {
      await detachBrowserSessionForContext(context, {
        reason: "WINDOW_CLOSED"
      });
    }
    if (context.run && ![STATES.PROGRAM_DONE, STATES.STOPPED, STATES.ERROR_TERMINAL].includes(context.run.state)) {
      context.run = transitionRun(context.run, STATES.SOFT_PAUSED, {
        origin: PAUSE_ORIGINS.WINDOW_CLOSED,
        reason: "Chrome-fönstret stängdes. Run state och kontinuitet finns kvar för export/återställning."
      });
      runtime.orphanedRuns = [...(runtime.orphanedRuns || []), deepClone(context.run)].slice(-12);
    }
    if (context.surfacePair) {
      runtime.orphanedSurfacePairs = [
        ...(runtime.orphanedSurfacePairs || []),
        {
          ...deepClone(context.surfacePair),
          archivedAt: nowIso(),
          archiveReason: "WINDOW_CLOSED"
        }
      ].slice(-32);
    }
    delete runtime.windows[String(windowId)];
    addAudit(audit, {
      kind: "warning",
      title: "Chrome-fönster stängt",
      detail: `Fönster ${windowId}; eventuell körning arkiverades utan att stoppa mål-sessionens generation.`,
      windowId,
      runId: context.run?.runId || null
    });
    runtime.orphanedContinuities = [
      ...(runtime.orphanedContinuities || []),
      {
        windowId,
        runId: context.run?.runId || "",
        continuity,
        archivedAt: nowIso()
      }
    ].slice(-12);
    await writeRuntimeBundle(runtime, rootContinuity, audit);
  }).catch(console.warn);
});


if (chrome.debugger?.onEvent?.addListener) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = Number(source?.tabId);
    const normalized = normalizeCdpEvidenceEvent(method, params || {});
    if (!Number.isInteger(tabId) || !normalized) return;
    enqueue(async () => {
      const discovery = await loadBundle();
      const discoveredContext = Object.values(discovery.runtime.windows || {}).find(
        (candidate) => Number(webTargetSurface(candidate)?.tabId) === tabId
      );
      if (!discoveredContext) return;
      const { runtime } = await loadBundle(discoveredContext.windowId);
      const context = getWindowContext(runtime, discoveredContext.windowId);
      const target = webTargetSurface(context);
      const session = liveCdpSessions.get(cdpLiveKey(context.windowId));
      if (!session || !target || !cdpSessionMatchesSurface(session, target)) return;
      const store = await loadWindowEvidenceStore(chrome, context.windowId);
      if (
        store.observation.state !== EVIDENCE_OBSERVATION_STATES.ACTIVE ||
        store.observation.sessionId !== session.sessionId ||
        store.observation.surfaceId !== target.surfaceId ||
        store.observation.documentEpoch !== target.documentEpoch
      ) return;
      await persistEvidenceItem(chrome, {
        windowId: context.windowId,
        type: normalized.type,
        source: `CDP.${method}`,
        surface: target,
        payload: normalized.payload
      });
      await notifyPanels(context.windowId);
    }).catch((error) => console.warn("EIC WP07 event capture failed.", error));
  });
}

if (chrome.debugger?.onDetach?.addListener) {
  chrome.debugger.onDetach.addListener((source, reason) => {
    const tabId = Number(source?.tabId);
    if (!Number.isInteger(tabId)) return;
    enqueue(async () => {
      const discovery = await loadBundle();
      const discoveredContext = Object.values(discovery.runtime.windows || {}).find(
        (candidate) => Number(webTargetSurface(candidate)?.tabId) === tabId
      );
      if (!discoveredContext) return;
      const { continuity, runtime, audit } = await loadBundle(discoveredContext.windowId);
      const context = getWindowContext(runtime, discoveredContext.windowId);
      liveCdpSessions.delete(cdpLiveKey(context.windowId));
      await markWindowEvidenceStale(chrome, context.windowId, {
        reason: `CHROME_DEBUGGER_DETACHED:${reason || "UNKNOWN"}`,
        surface: webTargetSurface(context)
      });
      context.browserSession = markCdpSessionStale(context.browserSession, {
        reason: `CHROME_DEBUGGER_DETACHED:${reason || "UNKNOWN"}`
      });
      applyWebTargetCapabilityState(context, {
        debuggerState: CDP_SESSION_STATES.DETACHED,
        debuggerSessionId: context.browserSession.sessionId,
        reason: "CHROME_DEBUGGER_DETACHED"
      });
      context.browserRecovery = markBrowserRecoveryRequired(context.browserRecovery, {
        reason: `CHROME_DEBUGGER_DETACHED:${reason || "UNKNOWN"}`,
        surface: webTargetSurface(context),
        missionId: context.activeMissionId || "",
        browserLoop: context.browserLoop
      });
      context.browserApproval = null;
      context.browserLoop = normalizeBrowserLoopState({
        ...context.browserLoop,
        state: BROWSER_LOOP_STATES.PAUSED,
        lastReason: "CHROME_DEBUGGER_DETACHED",
        controllerResponseHash: "",
        updatedAt: nowIso()
      }, { windowId: context.windowId });
      addAudit(audit, {
        kind: "warning",
        title: "Chrome avslutade CDP-sessionen",
        detail: String(reason || "UNKNOWN"),
        windowId: context.windowId,
        tabId,
        runId: context.run?.runId || null
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(context.windowId);
    }).catch(console.warn);
  });
}

ensureInitialized().then(() => tickAll("worker-load")).catch(console.warn);
