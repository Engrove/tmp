import {
  APP_VERSION,
  AUDIT_SCHEMA,
  CONFIG_SCHEMA,
  CONFIG_VERSION,
  CONTENT_SCRIPT_VERSION,
  CONTINUITY_SCHEMA,
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
  nullableInteger,
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
  CAUSAL_EFFECT_STATUS,
  CAUSAL_EVENT,
  CAUSAL_PLANES,
  activeCausalEffect,
  classifyCausalOwnership,
  causalOwnershipDesynced,
  CAUSAL_OWNERSHIP_VERDICT,
  causalPolicyFenceActive,
  causalRecoveryBlocked,
  causalWaitIsQuiescent,
  commitCausalControl,
  ensureCausalControl,
  latestUserOwnsControlPrompt,
  mapLegacyEffectStatus,
  responseContractForBoundControl
} from "./lib/causal-transition-authority.mjs";
import {
  CAUSAL_OWNERSHIP_PRODUCER,
  CAUSAL_OWNERSHIP_RECOVERY_ACTION,
  CAUSAL_OWNERSHIP_STRAND_CODE,
  CAUSAL_OWNERSHIP_STRAND_MAX_REARM,
  causalOwnershipRearmAdmits,
  causalOwnershipStrandFailure,
  classifyCausalOwnershipProducer,
  clearCausalOwnershipStrand,
  evaluateCausalOwnershipStrand,
  grantCausalOwnershipRearm,
  markCausalOwnershipRearm,
  openCausalOwnershipStrand,
  planCausalOwnershipRecovery
} from "./lib/causal-ownership-liveness.mjs";
import {
  NANO_TASK_STATUS,
  claimNanoTaskHarness,
  completeNanoTaskHarness,
  createNanoTaskHarness,
  failNanoTaskHarness,
  splitNanoTaskDirective
} from "./lib/nano-task.mjs";
import {
  activeOperatorCandidateForDecision,
  effectiveDecisionProgressDelta,
  evaluateLocalUnlockDirective,
  normalizeSatisfiedLocalUnlockDecision,
  readablePageMayResolveRecovery
} from "./lib/recovery-control.mjs";
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
  AUTONOM_AGENT_LOCAL_SESSION_STATE,
  TARGET_SESSION_OWNER,
  applyAutonomyRoutingMetadata,
  createSessionInitIntegritySeal,
  genericControlRewriteAllowed,
  validateSessionInitEffectIntegrity,
  validateSessionInitIntegritySeal,
  SESSION_INIT_PROMPT_MUTATED
} from "./lib/session-init-control.mjs";
import {
  EXECUTION_DISPOSITIONS,
  MICRO_ACTION_IDS,
  agentLocalCapabilityBoundaryReason,
  buildLocalStateBridgeDiagnostic,
  buildNanoFailureDiagnostic,
  chatControlWakeKeyInput,
  deriveControllerProjection,
  evaluateLocalNanoRearm,
  executionFamilyKey,
  evaluateModelUserPauseControl,
  LOCAL_NANO_REARM_ACTION_IDS,
  localRearmMaterialKey,
  localRearmObservationKey,
  localStateDiagnosticKeyInput,
  materialDecisionInputKey,
  nanoFailureDiagnosticKeyInput,
  normalizedControllerFacts,
  observationMaterialKey,
  projectPostReadyBaselineHandoffTarget,
  resolveExecutionPlan,
  shouldEmitLocalStateDiagnostic,
  shouldEmitNanoFailureDiagnostic,
  shouldSuppressRepeatedLocalStateRead
} from "./lib/execution-routing.mjs";
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
  RESPONSE_SETTLE_FAILURE_CODE,
  RESPONSE_SETTLE_MAX_AGE_MS,
  authoritativeTerminalResponse,
  bindResponseSettleCandidate,
  evaluateResponseSettleLiveness,
  responseSettleAlarmName,
  responseSettleAlarmWindowId,
  responseSettleFailureRecord,
  responseSettlePriorityPlan,
  responseSettleWakePlan
} from "./lib/response-settle-liveness.mjs";
import {
  RESPONSE_CANDIDATE_DISPOSITION,
  RESPONSE_OBSERVATION_CYCLE_STATUS,
  classifyResponseCandidateOwnership,
  retireResponseCandidate,
  transferResponseCandidateToObservation,
  updateResponseObservationCycle
} from "./lib/response-observation-cycle.mjs";
import {
  CONTROL_PLANE_PHASE,
  selectControlPlanePhase
} from "./lib/control-plane-phase.mjs";
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
  findActiveBrowserMutation,
  markMjolnarDispatch
} from "./lib/mjolnar.mjs";
import {
  createHardReloadReadbackExpectation,
  createReloadReadbackExpectation,
  evaluateHardReloadSelectedTabReadback,
  evaluateReloadSelectedTabReadback
} from "./lib/reload-lifecycle.mjs";
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
  operatorActionBoundaryEligible,
  protocolFastPathEligible,
  selectProtocolDecisionPath
} from "./lib/protocol-fast-path.mjs";
import {
  NANO_ANALYSIS_MODES,
  NANO_CLAIM_LEASE_STATE,
  NANO_DECISION_SOURCE,
  NANO_REQUEST_STATUS,
  classifyNanoAnalysisMode,
  claimNanoRequestState,
  compactContextText,
  completeNanoRequestState,
  createNanoRequest,
  failNanoRequestState,
  finalizeNanoTerminalOwnershipState,
  groundDecisionFromObservation,
  nanoClaimLeaseState,
  nanoTerminalDeliveryAlreadyFinalized,
  updateNanoProgressState,
  validateNanoDecisionGrounding
} from "./lib/nano-pipeline.mjs";
import {
  NANO_CONTINUATION_ANALYSIS_DEADLINE_MS
} from "./lib/nano-owner-liveness.mjs";
import {
  MAIN_TASK_BASELINE_REQUEST_PROMPT,
  MAIN_TASK_BASELINE_SCHEMA,
  createEmptyMainTaskTrack,
  parseMainTaskBaseline
} from "./lib/main-task-guard.mjs";
import {
  buildAgentStartupCorrectionPrompt
} from "./lib/agent-ai-session-guide.mjs";
import {
  BASELINE_ANALYSIS_SCHEMA_ID,
  normalizeBaselineAnalysis,
  normalizeBaselineProjectionCoverage,
  validateBaselineAnalysis
} from "./lib/nano-baseline-analysis.mjs";
import {
  applySessionBaselineCorrectionFence,
  evaluateSessionBaselineCorrectionFence
} from "./lib/session-baseline-correction-fence.mjs";
import {
  SESSION_CONTEXT_BASELINE_COMMIT_STATUS,
  SESSION_CONTEXT_INIT_FAILURE_CODE,
  SESSION_CONTEXT_INIT_MAX_OPERATOR_RETRIES,
  SESSION_CONTEXT_INIT_RECOVERY_CLASS,
  SESSION_CONTEXT_INIT_STATE,
  SESSION_CONTEXT_READY_FINALIZATION_STATUS,
  advanceSessionContextInit,
  beginSessionContextBaselineCommit,
  beginSessionContextReadyFinalization,
  completeSessionContextBaselineCommit,
  completeSessionContextReadyFinalization,
  createSessionContextBaselineCommitReceipt,
  createSessionContextInit,
  evaluateSessionContextInitStall,
  failSessionContextBaselineCommit,
  failSessionContextInit,
  failSessionContextReadyFinalization,
  retrySessionContextInit,
  sessionContextBaselineCommitNeedsRecovery,
  sessionContextInitBlocksWork,
  sessionContextInitOverlay,
  sessionContextInitRetryable,
  sessionContextInitVerifiedReady
} from "./lib/session-context-init.mjs";
import {
  retireMaterialSupersededSessionContextBaseline
} from "./lib/session-context-baseline-supersession.mjs";
import { recoverFalseSelfSupersededControlTurn } from "./lib/control-self-supersession-recovery.mjs";
import { migrateLegacyNanoDiscriminationFence } from "./lib/v0126-migration.mjs";
import {
  exactSessionContextBaselineNanoOwnership,
  materialDeliveryRegulatorEligible,
  PREPARED_EFFECT_OBSERVATION_DISPOSITION,
  classifyPreparedEffectObservation,
  sessionContextAllowsOrdinaryNano,
  shouldReobserveAckedBaselineResponse,
  waitWakeInvariant
} from "./lib/session-init-causal-model.mjs";
import {
  NANO_UNCLAIMED_REQUEST_MAX_REARMS,
  NANO_UNCLAIMED_REQUEST_TIMEOUT_MS,
  NANO_UNCLAIMED_RECOVERY_ACTION,
  nanoAnalysisStateNeedsRepair,
  nanoAnalysisWaitInvariant,
  nanoRequestClaimEligible,
  pendingSessionInitNanoRequest,
  planUnclaimedNanoRequestRecovery,
  storageRecoverySemanticState
} from "./lib/nano-analysis-recovery.mjs";
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
  validateEffectPayloadIntegrity,
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
  updateSurfaceForTab,
  reconcileControllerSurfacePage
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
  findCoreProfile,
  refreshBuiltInCoreProfileBindings
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
  deferSessionCaptureOnce,
  evaluateNanoRuntimeBinding,
  nanoOwnsSessionCapture,
  normalizeNanoHostTelemetry,
  projectRunIntoContinuity,
  releaseDeferredSessionCapture,
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
    mandateVersion: sanitizeText(config?.targetMandateVersion || "target-core-v9", 160),
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
    mandateVersion: sanitizeText(config?.targetMandateVersion || "target-core-v9", 240),
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
const sessionCaptureInFlight = new Map();
// Nano ownership is quiescent for automatic Session Capture. The persisted
// deferral survives worker restart; this in-memory set avoids even scheduling
// repeated timers while the same worker observes that ownership.
const autoCaptureNanoDeferred = new Set();
// v0.10.11: consecutive non-Nano deferrals per window, used to back off the
// automatic capture self-retry chain. Cleared as soon as a capture is allowed.
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


async function markNanoAutoCaptureDeferred({
  bundle,
  context,
  windowId,
  trigger = "",
  requestId = ""
} = {}) {
  const numericWindowId = nullableInteger(windowId);
  if (numericWindowId === null) throw new Error("WINDOW_ID_REQUIRED");
  const deferred = deferSessionCaptureOnce(context.autoCaptureDeferral, {
    reason: "MISSION_NANO_HAS_PRIORITY",
    trigger,
    requestId
  });
  context.autoCaptureDeferral = deferred.deferral;
  autoCaptureNanoDeferred.add(numericWindowId);
  if (deferred.changed) {
    context.updatedAt = nowIso();
    addAudit(bundle.audit, {
      kind: "info",
      title: "Automatisk Session Capture uppskjuten",
      detail: `MISSION_NANO_HAS_PRIORITY · ${sanitizeText(trigger, 120) || "BACKGROUND"} · återarmas en gång när Nano ownership frigörs.`,
      windowId: numericWindowId,
      tabId: context.run?.targetTabId || context.selectedTabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(bundle.runtime, bundle.continuity, bundle.audit);
  }
  return deferred;
}

async function prepareBackgroundAutoCapture(windowId) {
  return enqueue(async () => {
    const bundle = await loadBundle(windowId);
    const { config, runtime, audit } = bundle;
    const context = getWindowContext(runtime, windowId);
    const nanoOwned = nanoOwnsSessionCapture({
      run: context.run,
      nanoHostTelemetry: context.nanoHostTelemetry
    });
    if (nanoOwned) {
      await markNanoAutoCaptureDeferred({
        bundle,
        context,
        windowId,
        trigger: "background-auto-capture"
      });
      return { allowed: false, reason: "MISSION_NANO_HAS_PRIORITY", deferred: true };
    }
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
      inFlight: autoCaptureInFlight.has(nullableInteger(windowId)),
      paused: runBlocksAutomaticCapture(context.run),
      guard: context.autoCaptureGuard || null
    });
    context.updatedAt = nowIso();
    await writeRuntimeBundle(runtime, bundle.continuity, audit);
    return { ...decision, fingerprint, tabId };
  });
}

function scheduleBackgroundAutoSessionCapture(windowId, reason = "observation") {
  const numericWindowId = nullableInteger(windowId);
  if (numericWindowId === null) return;
  if (autoCaptureNanoDeferred.has(numericWindowId)) return;
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
    try {
      await enqueue(async () => {
        const bundle = await loadBundle(numericWindowId);
        const context = getWindowContext(bundle.runtime, numericWindowId);
        context.autoCaptureGuard = createAutoCaptureGuard({
          fingerprint: decision.fingerprint,
          requestId,
          status: "STARTED"
        });
        await writeRuntimeBundle(bundle.runtime, bundle.continuity, bundle.audit, numericWindowId);
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
        if (!detail.includes("SESSION_CAPTURE_DEFERRED:")) {
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
            await writeRuntimeBundle(bundle.runtime, bundle.continuity, bundle.audit, numericWindowId);
            await notifyPanels(numericWindowId);
          });
        }
        if (!detail.includes("SESSION_CAPTURE_CANCELLED") &&
            !detail.includes("SESSION_CAPTURE_DEFERRED:")) {
          console.warn(`EIC Autonom Agent: automatisk Session Capture misslyckades för fönster ${numericWindowId}.`, error);
        }
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
  const numericWindowId = nullableInteger(windowId);
  if (numericWindowId === null) throw new Error("CDP_WINDOW_ID_REQUIRED");
  return String(numericWindowId);
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
const PREPARED_EFFECT_FAST_RECHECK_MS = 1_000;
const PREPARED_EFFECT_FAST_RECHECK_WINDOW_MS = 10_000;
const AUDIT_LIMIT = 240;
const MAX_PENDING_RESPONSE_CHARS = 32_000;
const MAX_START_PROMPT_CHARS = 120_000;
const SUBMISSION_GRACE_MS = 90_000;
const MAX_SUBMISSION_ATTEMPTS = 2;
const NANO_CLAIM_GRACE_MS = NANO_WALL_TIMEOUT_MS;
const NANO_CLAIM_LEASE_MS = NANO_WALL_TIMEOUT_MS;
const NANO_MAX_ATTEMPTS = 3;

function nanoRequestGraceMs(mode) {
  return mode === NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS
    ? NANO_CONTINUATION_ANALYSIS_DEADLINE_MS
    : NANO_CLAIM_GRACE_MS;
}

function renewNanoRequestDeadline(request, now = Date.now()) {
  request.deadlineAt = request?.mode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP
    ? null
    : nowIso(now + nanoRequestGraceMs(request?.mode));
  return request.deadlineAt;
}
// v0.10.15: the long lease protects legitimately slow local inference, while a
// much shorter heartbeat stale window detects a dead sidepanel/transport after
// claim. Active analysis heartbeats every 10 s, so 90 s is a transport-liveness
// guard rather than an inference wall timeout.
const NANO_RUNNING_HEARTBEAT_STALE_MS = 90_000;
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
  sessionContextBaselineAnalysis = false,
  baselineCandidate = null,
  baselineParseErrors = [],
  baselineResponseIdentity = "",
  baselineResponseExtractionComplete = true,
  baselineResponseExtraction = null,
  now = Date.now()
} = {}) {
  const request = createNanoRequest({
    requestId,
    observationId,
    mode: analysisMode,
    graceMs: nanoRequestGraceMs(analysisMode),
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
    operatorResumeDecision,
    sessionContextBaselineAnalysis: sessionContextBaselineAnalysis === true,
    baselineCandidate: baselineCandidate ? deepClone(baselineCandidate) : null,
    baselineParseErrors: Array.isArray(baselineParseErrors)
      ? baselineParseErrors.slice(0, 12).map((item) => sanitizeText(item, 200))
      : [],
    baselineResponseIdentity: sanitizeText(baselineResponseIdentity, 320),
    baselineResponseExtractionComplete: baselineResponseExtractionComplete === true,
    baselineResponseExtraction: baselineResponseExtraction && typeof baselineResponseExtraction === "object"
      ? deepClone(baselineResponseExtraction)
      : null
  };
}

const LOCAL_MICROSTEP_MAX_PER_RESPONSE = 6;

function localMicrostepSnapshot(run = {}) {
  const facts = normalizedControllerFacts(run);
  return {
    schema: "eic.autonom.local-microstep-snapshot.v2",
    facts,
    projection: deriveControllerProjection(facts),
    // Transitional compatibility only. These legacy state strings are views for
    // old UI/tests and are not used to resolve the execution surface.
    legacyProjection: {
      runState: sanitizeText(run?.state, 80),
      sessionContextInitState: sanitizeText(run?.sessionContextInit?.state, 80),
      sessionContextNanoRequestId: sanitizeText(run?.sessionContextInit?.nanoRequestId, 180),
      currentTurnId: sanitizeText(run?.currentTurn?.turnId, 180),
      currentEffectState: sanitizeText(run?.currentTurn?.effectState, 80)
    }
  };
}

function advanceLocalMicrostepBudget(run, observation) {
  const responseKey = sanitizeText(
    observation?.responseIdentity || observation?.responseHash || observation?.observationId,
    500
  );
  const prior = run?.localMicrostepControl || {};
  const sameResponse = Boolean(responseKey && prior.responseKey === responseKey);
  const count = (sameResponse ? Number(prior.count || 0) : 0) + 1;
  run.localMicrostepControl = {
    schema: "eic.autonom.local-microstep-control.v1",
    responseKey,
    count,
    max: LOCAL_MICROSTEP_MAX_PER_RESPONSE,
    updatedAt: nowIso()
  };
  return {
    count,
    exhausted: count > LOCAL_MICROSTEP_MAX_PER_RESPONSE
  };
}

function recentExecutionFamilyCount(run, key) {
  if (!key) return 0;
  return (Array.isArray(run?.promptHistory) ? run.promptHistory : [])
    .filter((item) => item?.executionFamilyKey === key)
    .length;
}


function shallowTurnLineageSnapshot(turn = null) {
  if (!turn?.turnId) return null;
  return {
    turnId: sanitizeText(turn.turnId, 180),
    priorTurnId: sanitizeText(turn.priorTurnId, 180) || null,
    effectState: sanitizeText(turn.effectState, 80),
    promptDigest: sanitizeText(turn.promptDigest, 128),
    actionKey: sanitizeText(turn.actionKey, 240),
    kind: sanitizeText(turn.kind, 80),
    responseContract: sanitizeText(turn.responseContract, 120),
    responseExpectedTurnId: sanitizeText(turn.responseExpectedTurnId, 180),
    priorResponseContract: sanitizeText(turn.priorResponseContract, 120),
    priorResponseExpectedTurnId: sanitizeText(turn.priorResponseExpectedTurnId, 180),
    submittedAt: sanitizeText(turn.submittedAt, 80)
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
  // v0.11.17: this boundary is a transfer, never a copy.  The response
  // observation becomes the causal source for the baseline request and any
  // matching settle candidate is retired before an early return can occur.
  run = transferResponseCandidateToObservation(run, currentObservation, {
    reason: `SESSION_CATCH_CONSUMED_FOR_BASELINE:${sanitizeText(currentObservation.responseHash, 128)}`,
    now
  });
  if (run.responseOwnershipViolation) {
    return transitionRun(run, STATES.PROGRAM_BLOCKED, {
      origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
      reason: `${run.responseOwnershipViolation.code}: baseline-catch försökte överta en annan aktiv response-generation.`,
      now,
      force: true
    });
  }

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
function restorePendingSessionInitNano(runValue, {
  now = Date.now(),
  reason = "Pending Nano-analysis återställdes efter lokal recovery."
} = {}) {
  let run = runValue;
  if (!nanoAnalysisStateNeedsRepair(run)) return { run, repaired: false };
  run = transitionRun(run, STATES.ASSESSING, {
    origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
    reason,
    now,
    force: true
  });
  const request = run.pendingNanoRequest;
  if (request) {
    request.claimAvailableAt = nowIso(now);
    request.requeuedAt = nowIso(now);
    request.requeueCount = Number(request.requeueCount || 0) + 1;
    request.lastError = "";
  }
  run.nanoTelemetry ||= {};
  run.nanoTelemetry.lastStatus = "PENDING";
  run.nanoTelemetry.lastError = "";
  if (run.storagePersistenceFailure) {
    run.storagePersistenceFailure = {
      ...run.storagePersistenceFailure,
      recoveredAt: nowIso(now),
      disposition: "RESTORED_ASSESSING"
    };
  }
  return { run, repaired: true };
}

function applySessionContextInitFailure(runValue, {
  windowId,
  audit,
  code = SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_DISPATCH_FAILED,
  detail = "",
  now = Date.now()
} = {}) {
  let run = runValue;
  const latestJournalEffect = latestEffect(run);
  const baselineDelivered = [
    "SESSION_CONTEXT_BASELINE_REQUEST",
    "SESSION_CONTEXT_BASELINE_CORRECTION"
  ].includes(String(run.currentTurn?.kind || "")) &&
    latestJournalEffect?.sessionContextBaseline === true &&
    ["SUBMITTED_UNCONFIRMED", "ACKED"].includes(String(latestJournalEffect?.status || ""));
  run.sessionContextInit = failSessionContextInit(run.sessionContextInit, { code, detail, now });
  run.pendingNanoRequest = null;
  run.pendingObservation = null;
  run.deterministicGroundingFailure = null;
  run.deterministicDispatchRearms = 0;
  run.timeoutSuspended = true;
  run.resumePlan = {
    requestedAction: baselineDelivered
      ? "Försök igen sessionsinitieringen från det redan levererade baselinesvaret; skicka inte en dubbel baselineprompt."
      : "Ingen. Baselinefrågan nådde aldrig målsessionen; ingen tur ska antas vara skickad.",
    requiredEvidence: [
      baselineDelivered
        ? "En ny claimad Nano-request eller ett explicit operatörsstopp."
        : "Operatörens Försök igen, eller ett stopp av addonet. Ingen automatisk återhämtning är giltig här."
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
    title: baselineDelivered
      ? "Sessionsinitiering misslyckades efter levererad baselineprompt"
      : "Sessionsinitiering misslyckades — ingen prompt skickades",
    detail: `${code} · ${sanitizeText(detail, 1400)}`,
    windowId,
    tabId: run.targetTabId,
    runId: run.runId
  });
  return run;
}

function applySessionInitPromptIntegrityFailure(runValue, {
  windowId,
  audit,
  failure,
  detail = "",
  now = Date.now()
} = {}) {
  const run = runValue;
  run.sessionInitPromptIntegrityFailure = failure && typeof failure === "object"
    ? deepClone(failure)
    : {
        schema: "eic.autonom.session-init-prompt-integrity-failure.v1",
        failureCode: SESSION_INIT_PROMPT_MUTATED,
        detectedAt: nowIso(now)
      };
  return applySessionContextInitFailure(run, {
    windowId,
    audit,
    code: SESSION_INIT_PROMPT_MUTATED,
    detail: sanitizeText(detail, 2000) || SESSION_INIT_PROMPT_MUTATED,
    now
  });
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


function markObservationProcessed(runValue, observation, { now = Date.now() } = {}) {
  let run = runValue;
  if (!run || !observation) return run;
  run.lastProcessedAssistantHash = sanitizeText(observation.responseHash, 512);
  run.lastProcessedResponseIdentity = sanitizeText(
    observation.responseIdentity || observation.responseHash,
    512
  );
  run.lastProcessedAssistantCount = Math.max(0, Number(observation.assistantCount || 0));
  run.lastProcessedAssistantComplete = true;
  run.lastProcessedObservationAt = nowIso(now);

  // v0.11.17 causal ownership invariant: processing is an ownership transfer.
  // Retire the matching candidate through the central lifecycle helper so no
  // branch can leave the same response active in settle state afterwards.
  run = retireResponseCandidate(run, {
    status: RESPONSE_OBSERVATION_CYCLE_STATUS.CONSUMED,
    observation,
    reason: `OBSERVATION_PROCESSED:${sanitizeText(observation.responseHash, 128)}`,
    now
  });
  return run;
}

function observationOwnerLocators(run = {}) {
  return [
    run.conversationKey ? `conversation:${run.conversationKey}` : "",
    nullableInteger(run.targetTabId) !== null ? `tab:${Number(run.targetTabId)}` : "",
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


const CHAT_CONTROL_EFFECT_CLASS = "CHAT_CONTROL_CONTINUATION";
const CHAT_CONTROL_TURN_KIND = "CHAT_CONTROL_CONTINUATION";
const CHAT_CONTROL_ACTIVE_STATUSES = new Set([
  "PREPARED",
  "SUBMITTING",
  "SUBMITTED_UNCONFIRMED",
  "ACKED"
]);

async function prepareChatControlContinuation(runValue, {
  config,
  continuity,
  observation = null,
  reasonCode = "WAIT_OWNER_EVENT",
  reasonDetail = "",
  sourceActionId = MICRO_ACTION_IDS.WAIT_OWNER_EVENT,
  diagnostics = null,
  now = Date.now()
} = {}) {
  let run = runValue;
  if (!run || !config || !continuity) {
    return {
      run,
      created: false,
      duplicate: false,
      reason: "CHAT_CONTROL_CONTEXT_MISSING"
    };
  }

  const normalizedReasonCode = sanitizeText(reasonCode, 160).toUpperCase();
  if ([
    "EXTERNAL_OWNER_ACTION_REQUIRED",
    "EXTERNAL_SYSTEM_WAIT",
    "EXTERNAL_SYSTEM_UNAVAILABLE_TO_AGENT"
  ].includes(normalizedReasonCode)) {
    return {
      run,
      created: false,
      duplicate: false,
      reason: "TRUE_EXTERNAL_DEPENDENCY_NOT_CHAT_CONTROLLABLE"
    };
  }

  const boundObservation = observation && typeof observation === "object"
    ? deepClone(observation)
    : run.waitingObservation && typeof run.waitingObservation === "object"
      ? deepClone(run.waitingObservation)
      : run.pendingObservation && typeof run.pendingObservation === "object"
        ? deepClone(run.pendingObservation)
        : {};

  const wakeKey = await sha256Hex(chatControlWakeKeyInput({
    run,
    observation: boundObservation,
    reasonCode,
    sourceActionId
  }));
  const existingReceipt = run.chatControlContinuationReceipt || null;
  if (existingReceipt?.wakeKey === wakeKey &&
      CHAT_CONTROL_ACTIVE_STATUSES.has(String(existingReceipt.status || "").toUpperCase())) {
    return {
      run,
      created: false,
      duplicate: true,
      wakeKey,
      receipt: existingReceipt,
      reason: "CHAT_CONTROL_ALREADY_EMITTED"
    };
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

  const actionId = sanitizeText(sourceActionId, 120) || MICRO_ACTION_IDS.WAIT_OWNER_EVENT;
  const reason = sanitizeText(reasonDetail || run.waitingForUnlockEvent || reasonCode, 1200);
  const controlDirective =
    "Fortsätt den validerade huvuduppgiften med exakt en avgränsad åtgärd som den anslutna EIC_AI_SESSION faktiskt kan utföra genom sina exponerade verktyg/owner-rutter. " +
    "AGENT är den lokala Chrome-extensionruntime och kan läsa sin egen controller/session-state, men AGENT skapar, väljer eller attesterar inte själv en separat färsk ChatGPT evaluator-session. " +
    "Om nästa steg kräver en ny/färsk evaluator-target: använd en faktisk exponerad browser/session-owner-route om EIC_AI_SESSION verkligen har en sådan. Om ingen sådan route finns, returnera OPERATOR_ACTION_REQUIRED med EIC_NEXT_ACTOR: OPERATOR_ACTION och exakt mekanisk instruktion att öppna/välja/länka den färska ChatGPT-targetfliken. Returnera aldrig EIC_NEXT_ACTOR: AGENT för targetskapandet. " +
    "Om nästa effekt i stället faktiskt ägs lokalt av Chrome-tillägget, returnera EIC_NEXT_ACTOR: AGENT. " +
    "Om endast en verklig producent utanför EIC_AI_SESSION, AGENT och NANO kan skapa nästa materialdelta, returnera EIC_NEXT_ACTOR: EXTERNAL_SYSTEM; försök inte owner-routa den genom samma EIC-chat.";
  const nanoFailureDiagnostic = diagnostics?.nanoFailure &&
    typeof diagnostics.nanoFailure === "object"
      ? diagnostics.nanoFailure
      : null;
  const localStateDiagnostic = diagnostics?.localState &&
    typeof diagnostics.localState === "object"
      ? diagnostics.localState
      : null;
  const requestedAction = sanitizeText(
    nanoFailureDiagnostic
      ? `CONTROL_DIAGNOSTIC: AGENT har terminaliserat en Nano-failure generation och kan inte återarma samma input. ` +
        `Använd diagnostics.nanoFailure som lokal Agent-evidens för source/runtime-diagnos. ` +
        `Kör inte samma Nano-input igen och behandla inte NANO som EIC-owner. ` +
        `${controlDirective} ` +
        `Aktuell kontrollorsak: ${reason}.`
      : localStateDiagnostic
        ? `CONTROL_DIAGNOSTIC: AGENT har materialiserat en bounded one-shot local-state/bridge-diagnos för den aktuella no-delta-generationen. ` +
          `Använd diagnostics.localState som lokal Agent-evidens; kör inte om samma READ_LOCAL_SESSION_STATE enbart för att återskapa diagnostiken. ` +
          `Diagnostiken är observability och inte nytt target-material. ` +
          `${controlDirective} ` +
          `Aktuell kontrollorsak: ${reason}.`
        : `CONTROL_CONTINUATION: EIC Autonom Agent har nått ${reasonCode}. ` +
          `Sidopanelens status är inte en kommunikationskanal till AI-sessionen. ` +
          `${controlDirective} ` +
          `Upprepa inte ${actionId} utan ett uttryckligt nytt materiellt delta. ` +
          `Aktuell kontrollorsak: ${reason}.`,
    5000
  );
  const workUnit = sanitizeText(
    projection.position?.workUnit ||
    projection.mainTaskBaseline?.current?.boundedWorkUnit ||
    requestedAction,
    5000
  );

  const turn = await buildTurnObject({
    turnId,
    priorTurnId,
    targetMandate: config.targetMandate,
    targetMandateVersion: config.targetMandateVersion,
    mandateDelivery,
    mandateSha256: targetMandateSha256,
    authorityScope: config.targetAuthorityScope,
    taskIntent: projection.intent || "Fortsätt den användarstartade huvuduppgiften.",
    workUnit,
    workUnitOwnerSurface: TARGET_SESSION_OWNER,
    workUnitObservableResult:
      "Ett nytt turn-bundet EIC-AA/5-svar som väljer nästa avgränsade åtgärd eller rapporterar en verklig blockerare.",
    verifiedState: projection.verifiedFacts.map((item) => item.claim),
    constraints: (projection.constraints || []).map((item) => item.text),
    targetClaims: projection.targetClaims.map((item) => item.claim),
    inferences: projection.inferences.map((item) => item.claim),
    antiLoopCorrection: {
      code: nanoFailureDiagnostic
        ? "NANO_FAILURE_DIAGNOSTIC_ONCE"
        : localStateDiagnostic
          ? "LOCAL_STATE_DIAGNOSTIC_ONCE"
          : "CHAT_CONTROL_WAKE",
      text: nanoFailureDiagnostic
        ? "AGENT materialiserar detta terminala Nano-failure-kvitto exakt en gång; samma failure generation får inte väcka EIC-chatten igen."
        : localStateDiagnostic
          ? "AGENT materialiserar detta bounded local-state/bridge-kvitto exakt en gång för samma no-delta-generation; diagnostiken får inte själv återarma Nano eller skapa en ny diagnostikwake."
          : `Appen kan inte kommunicera via sidopanelstatus; denna kontrolltur materialiserar ${reasonCode} exakt en gång i chatten.`
    },
    diagnostics,
    requestedAction,
    requiredEvidence: [
      "Ett nytt turn-bundet EIC-AA/5-svar med en distinkt bounded nästa åtgärd eller PROGRAM_BLOCKED."
    ],
    continueCriteria: [
      "AI-sessionen har observerat kontrollhändelsen och returnerat ett nytt turn-bundet svar."
    ],
    stopCriteria: [
      "PROGRAM_DONE.",
      "En verklig owner-/säkerhetsgräns kräver stopp.",
      "Operatören stoppar."
    ],
    authorityLimits: [
      "Ingen ny behörighet genom prompttext.",
      "EIC_AI_SESSION får endast använda EIC/tool/owner-rutter som faktiskt exponeras i denna AI-session.",
      "AGENT och NANO har ingen implicit EIC Backend/project/memory/artifact/APIG/Git/Workspace/repository-access.",
      "EXTERNAL_SYSTEM är en verklig extern producent och får inte användas som alias för EIC_AI_SESSION.",
      "Ingen autentiserings- eller CAPTCHA-automation.",
      "Inga credentials eller hemligheter.",
      "Ingen destruktiv eller högriskåtgärd utan mänsklig bekräftelse."
    ],
    maxAutonomousMode: run.maxAutonomousMode,
    kind: CHAT_CONTROL_TURN_KIND
  });
  const compiled = await compileTurnPrompt(turn, {
    privateNanoCanary: config.nanoMandateCanary
  });

  const generation = Math.max(0, Number(run.chatControlGeneration || 0)) + 1;
  const sideBand = {
    schema: "eic.autonom.chat-control-sideband.v1",
    wakeKey,
    generation,
    reasonCode: sanitizeText(reasonCode, 160),
    reasonDetail: reason,
    sourceActionId: actionId,
    sourceObservationId: sanitizeText(boundObservation?.observationId, 180),
    sourceObservationHash: sanitizeText(boundObservation?.responseHash, 128),
    materialControlGeneration: Math.max(0, Number(run.materialControlGeneration || 0)),
    nanoFailureDiagnosticRequestId: sanitizeText(nanoFailureDiagnostic?.requestId, 180),
    localStateDiagnosticKey: sanitizeText(localStateDiagnostic?.diagnosticKey, 128).toLowerCase(),
    substantiveWorkUnitId: sanitizeText(
      projection.position?.workUnitId ||
      projection.mainTaskBaseline?.current?.boundedWorkUnit ||
      workUnit,
      240
    ),
    preparedAt: nowIso(now)
  };
  const effect = {
    effectId: randomId("effect"),
    turnId,
    promptDigest: compiled.promptDigest,
    prompt: compiled.prompt,
    actionKey: compiled.actionKey,
    microActionId: actionId,
    executionDisposition: EXECUTION_DISPOSITIONS.CHAT_CONTROL_CONTINUATION,
    executionFamilyKey: wakeKey,
    ackMode: "TURN_ID",
    requireTurnMarker: true,
    sourceObservationHash: boundObservation?.responseHash || "",
    sourceObservationIdentity: boundObservation?.responseIdentity || "",
    sourceObservationTurnSeq: Number(boundObservation?.latestAssistantTurnSeq || 0),
    // A document epoch is a rendering/lifecycle detail, not a semantic owner
    // change.  Chat-control wakes are cancelled only by a changed assistant
    // response hash or an actively generating target.
    sourceObservationEpoch: "",
    mandateVersion: turn.mandate.version,
    mandateSha256: turn.mandate.sha256,
    mandateDelivery: turn.mandate.delivery,
    conversationKey: run.conversationKey,
    taskFingerprint: run.taskFingerprint,
    status: "PREPARED",
    attempts: 0,
    preparedAt: nowIso(now),
    submittedAt: null,
    confirmedAt: null,
    lastError: "",
    sessionContextBaseline: false,
    parentTurnSnapshot: shallowTurnLineageSnapshot(run.currentTurn),
    turnKind: turn.kind,
    effectClass: CHAT_CONTROL_EFFECT_CLASS,
    protocolRepairSideBand: null,
    chatControlSideBand: sideBand,
    sessionInitIntegrity: null
  };

  run.chatControlGeneration = generation;
  run.chatControlContinuationReceipt = {
    ...sideBand,
    schema: "eic.autonom.chat-control-receipt.v1",
    effectId: effect.effectId,
    turnId,
    status: "PREPARED",
    submittedAt: null,
    confirmedAt: null
  };
  run.currentTurn = {
    turnId,
    priorTurnId,
    priorResponseContract: run.currentTurn?.responseContract || START_RESPONSE_CONTRACTS.TURN_BOUND_5,
    priorResponseExpectedTurnId: run.currentTurn?.responseExpectedTurnId || run.currentTurn?.turnId || "",
    effectState: "PREPARED",
    promptDigest: compiled.promptDigest,
    actionKey: compiled.actionKey,
    kind: CHAT_CONTROL_TURN_KIND,
    responseContract: START_RESPONSE_CONTRACTS.TURN_BOUND_5
  };
  run.effectJournal = compactEffectJournal([...(run.effectJournal || []), effect], turnId);
  run.runtimeDecisionStatus = "CHAT_CONTROL_PENDING";
  run.waitingForUnlockEvent = "";
  run.waitingObservation = null;
  run.timeoutSuspended = false;
  run.responseDeadlineAt = null;
  run = transitionRun(run, STATES.CONTINUING, {
    origin: PAUSE_ORIGINS.NONE,
    reason: `${reasonCode} materialiseras som exakt en AI-synlig chat-control-continuation.`,
    force: true
  });

  return {
    run,
    created: true,
    duplicate: false,
    wakeKey,
    receipt: run.chatControlContinuationReceipt,
    effect,
    reason: "CHAT_CONTROL_PREPARED"
  };
}

let operationQueue = Promise.resolve();
let applicationLogPersistenceQueue = Promise.resolve();
let fullAuditPersistenceQueue = Promise.resolve();
let initialized = false;
let initializationPromise = null;
let storageCircuitOpen = false;
const responseProbeTimers = new Map();

async function clearResponseStabilityProbe(windowId) {
  const numericWindowId = nullableInteger(windowId);
  if (numericWindowId === null) return;
  const existing = responseProbeTimers.get(numericWindowId);
  if (existing) clearTimeout(existing);
  responseProbeTimers.delete(numericWindowId);
  if (typeof chrome?.alarms?.clear !== "function") return;
  try {
    await chrome.alarms.clear(responseSettleAlarmName(numericWindowId));
  } catch (error) {
    console.warn("EIC Autonom Agent: response-settle-alarm kunde inte rensas.", error);
  }
}

async function scheduleResponseStabilityProbe(windowId, delayMs) {
  const numericWindowId = nullableInteger(windowId);
  if (numericWindowId === null) return;
  const boundedDelay = Math.max(100, Math.min(10_000, Number(delayMs) || 100));
  const existing = responseProbeTimers.get(numericWindowId);
  if (existing) clearTimeout(existing);
  responseProbeTimers.delete(numericWindowId);

  // Fast path while the MV3 worker stays alive.
  const timer = setTimeout(() => {
    responseProbeTimers.delete(numericWindowId);
    tickWindow(numericWindowId, "response-stability-probe").catch(console.warn);
  }, boundedDelay);
  responseProbeTimers.set(numericWindowId, timer);

  // Durable owner wake: a named one-shot chrome.alarm survives service-worker
  // suspension, so response-settle liveness never depends on setTimeout alone.
  if (typeof chrome?.alarms?.create === "function") {
    try {
      if (typeof chrome?.alarms?.clear === "function") {
        await chrome.alarms.clear(responseSettleAlarmName(numericWindowId));
      }
      const maybePromise = chrome.alarms.create(responseSettleAlarmName(numericWindowId), {
        when: Date.now() + boundedDelay
      });
      if (maybePromise && typeof maybePromise.then === "function") await maybePromise;
    } catch (error) {
      console.warn("EIC Autonom Agent: durable response-settle-alarm kunde inte schemaläggas.", error);
    }
  }
}

async function restoreResponseStabilityProbes(runtime) {
  const windows = Object.values(runtime?.windows || {});
  for (const context of windows) {
    const windowId = nullableInteger(context?.windowId);
    const run = context?.run;
    if (windowId === null || !run?.responseCandidate) continue;
    if ([STATES.PROGRAM_DONE, STATES.STOPPED, STATES.ERROR_TERMINAL].includes(run.state)) continue;
    const plan = responseSettleWakePlan(run.responseCandidate, { now: Date.now() });
    await scheduleResponseStabilityProbe(windowId, plan.delayMs || 100);
  }
}

function enqueue(operation) {
  const next = operationQueue.then(operation, operation);
  operationQueue = next.catch(() => undefined);
  return next;
}

function serializeApplicationLogPersistence(operation) {
  const next = applicationLogPersistenceQueue.then(operation, operation);
  applicationLogPersistenceQueue = next.catch(() => undefined);
  return next;
}

function serializeFullAuditPersistence(operation) {
  const next = fullAuditPersistenceQueue.then(operation, operation);
  fullAuditPersistenceQueue = next.catch(() => undefined);
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
  const profileRefresh = refreshBuiltInCoreProfileBindings(configResult.value);
  return {
    config: profileRefresh.config,
    runtime: runtimeResult.value,
    changed: configResult.reset || runtimeResult.reset,
    resetReasons: [configResult.reason, runtimeResult.reason],
    refreshedProfiles: profileRefresh.refreshed
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

function applicationLogHasEvent(logValue, { event = "", correlationId = "" } = {}) {
  const expectedEvent = sanitizeText(event, 160);
  const expectedCorrelationId = sanitizeText(correlationId, 240);
  return (logValue?.segments || []).some((segment) =>
    (segment?.entries || []).some((entry) =>
      String(entry?.event || "") === expectedEvent &&
      String(entry?.correlationId || "") === expectedCorrelationId
    )
  );
}

async function persistApplicationEventOnce({
  event,
  correlationId,
  level = "info",
  message = "",
  windowId = null,
  tabId = null,
  runId = null,
  data = {},
  now = Date.now()
} = {}) {
  return serializeApplicationLogPersistence(async () => {
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEYS.APPLICATION_LOG]);
    const current = stored[STORAGE_KEYS.APPLICATION_LOG] || null;
    if (applicationLogHasEvent(current, { event, correlationId })) {
      return { persisted: true, duplicate: true };
    }
    const next = appendApplicationEvent(current, {
      level,
      event,
      message,
      windowId,
      tabId,
      runId,
      correlationId,
      data
    }, { now });
    await chrome.storage.local.set({ [STORAGE_KEYS.APPLICATION_LOG]: next });
    return { persisted: true, duplicate: false };
  } catch (error) {
    await persistFullAuditQueueFailSoft([{
      level: "warning",
      event: "application.event.persist-failed",
      message: "Application-logg kunde inte persisteras.",
      windowId,
      tabId,
      runId,
      correlationId,
      data: {
        event: sanitizeText(event, 160),
        error: sanitizeText(error instanceof Error ? error.message : String(error), 800),
        fullAuditFailSoft: true
      }
    }]);
      return { persisted: false, duplicate: false };
    }
  });
}

export async function persistSessionContextReadyApplicationEventOnce({
  correlationId,
  windowId = null,
  tabId = null,
  runId = null,
  data = {},
  now = Date.now()
} = {}) {
  const event = "session-context-init.ready";
  const persisted = await persistApplicationEventOnce({
    level: "info",
    event,
    correlationId,
    message: "READY verifierades genom durable owner readback efter committed Nano-baseline.",
    windowId,
    tabId,
    runId,
    data,
    now
  });
  if (!persisted.persisted) {
    return {
      ...persisted,
      reason: "READY_SUCCESS_EVENT_PERSIST_FAILED"
    };
  }

  try {
    const readback = await chrome.storage.local.get([STORAGE_KEYS.APPLICATION_LOG]);
    if (!applicationLogHasEvent(
      readback[STORAGE_KEYS.APPLICATION_LOG] || null,
      { event, correlationId }
    )) {
      return {
        persisted: false,
        duplicate: persisted.duplicate === true,
        reason: "READY_SUCCESS_EVENT_READBACK_MISSING"
      };
    }
    return {
      persisted: true,
      duplicate: persisted.duplicate === true,
      reason: "OK"
    };
  } catch (error) {
    return {
      persisted: false,
      duplicate: persisted.duplicate === true,
      reason: `READY_SUCCESS_EVENT_READBACK_FAILED:${
        sanitizeText(error instanceof Error ? error.message : String(error), 600) ||
        "UNKNOWN"
      }`
    };
  }
}


function nanoEvidenceSnapshot(run, request, payload, continuity) {
  const observation = run?.pendingObservation || {};
  const baseline = request?.baselineCandidate || null;
  return {
    request: {
      requestId: sanitizeText(request?.requestId, 160),
      claimId: sanitizeText(request?.claimId || payload?.claimId, 160),
      mode: sanitizeText(request?.mode, 80),
      status: sanitizeText(request?.status, 40),
      attempts: Math.max(0, Number(request?.attempts || 0)),
      repairAttempt: Math.max(0, Number(request?.repairAttempt || 0)),
      unclaimedRearmCount: Math.max(0, Number(request?.unclaimedRearmCount || 0)),
      claimAvailableAt: sanitizeText(request?.claimAvailableAt, 120),
      observationId: sanitizeText(request?.observationId, 180),
      sessionContextBaselineAnalysis: request?.sessionContextBaselineAnalysis === true,
      baselineResponseIdentity: sanitizeText(request?.baselineResponseIdentity, 180)
    },
    sessionContextInit: {
      state: sanitizeText(run?.sessionContextInit?.state, 80),
      failureCode: sanitizeText(run?.sessionContextInit?.failureCode, 120),
      baselineResponseIdentity: sanitizeText(run?.sessionContextInit?.baselineResponseIdentity, 180),
      nanoRequestId: sanitizeText(run?.sessionContextInit?.nanoRequestId, 180)
    },
    observation: {
      observationId: sanitizeText(observation?.observationId, 180),
      responseIdentity: sanitizeText(observation?.responseIdentity, 180),
      responseHash: sanitizeText(observation?.responseHash, 128),
      documentEpoch: sanitizeText(observation?.documentEpoch, 180),
      targetProtocolStatus: sanitizeText(observation?.targetResult?.status, 80),
      targetProtocolReason: sanitizeText(observation?.targetResult?.reason, 180)
    },
    continuity: {
      digest: sanitizeText(continuity?.integrity?.digest, 128),
      baselinePresent: Boolean(continuity?.mainTaskBaseline),
      trackStatus: sanitizeText(continuity?.trackControl?.status, 80),
      workUnitId: sanitizeText(continuity?.position?.workUnitId, 180)
    },
    baselineCandidate: baseline ? {
      schema: sanitizeText(baseline.schema, 80),
      objective: sanitizeText(baseline.mainTask?.objective, 320),
      boundedWorkUnit: sanitizeText(baseline.current?.boundedWorkUnit, 400),
      nextHighLeverageAction: sanitizeText(baseline.current?.nextHighLeverageAction, 500),
      constraintCount: Array.isArray(baseline.constraints) ? baseline.constraints.length : 0,
      blockerCount: Array.isArray(baseline.blockers) ? baseline.blockers.length : 0,
      contextRefCount: Array.isArray(baseline.contextRefs) ? baseline.contextRefs.length : 0,
      evidenceNeedCount: Array.isArray(baseline.evidenceNeeds) ? baseline.evidenceNeeds.length : 0
    } : null,
    forensics: payload?.forensics && typeof payload.forensics === "object"
      ? deepClone(payload.forensics)
      : null
  };
}

async function persistFullAuditQueueFailSoft(entries = []) {
  return serializeFullAuditPersistence(async () => {
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
  });
}

async function initializeOnce() {
  const stores = await readStores();
  const writes = {};
  const audit = stores.audit?.schema === AUDIT_SCHEMA
    ? stores.audit
    : createDefaultAudit();
  const current = loadCurrentState(stores.config, stores.runtime);
  let config = current.config;
  if (Array.isArray(current.refreshedProfiles) && current.refreshedProfiles.length) {
    let mandateRegistry = config.mandateRegistry;
    mandateRegistry = (await registerMandateVersion(mandateRegistry, {
      surface: "NANO",
      version: config.nanoMandateVersion || "nano-core-v11",
      text: config.nanoMandate || ""
    })).registry;
    mandateRegistry = (await registerMandateVersion(mandateRegistry, {
      surface: "TARGET",
      version: config.targetMandateVersion || "target-core-v9",
      text: config.targetMandate || ""
    })).registry;
    config = {
      ...config,
      mandateRegistry,
      updatedAt: nowIso()
    };
  }
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

  let continuity = stores.continuity?.schema === CONTINUITY_SCHEMA
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
  await restoreResponseStabilityProbes(migratedRuntime);
  initialized = true;
}

async function ensureInitialized() {
  if (initialized) return;
  if (initializationPromise) return initializationPromise;
  initializationPromise = initializeOnce();
  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
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
    autoCaptureDeferral: null,
    coreSurfaceReview: null,
    // ACCEPTANCE_HARNESS plane. This is intentionally outside run/mission,
    // causal CONTROL state, continuity and ordinary Nano ownership.
    nanoTaskHarness: null,
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
  const numericWindowId = nullableInteger(windowId);
  if (numericWindowId === null) throw new Error("WINDOW_ID_REQUIRED");
  const key = String(numericWindowId);
  if (!runtime.windows[key]) runtime.windows[key] = defaultWindowContext(numericWindowId);
  const context = runtime.windows[key];
  context.schema = "eic.autonom.window-context.v7";
  context.windowId = numericWindowId;
  context.linkedTabs ||= {};
  context.sessionCaptureSummary ||= null;
  context.sessionMemorySummary ||= null;
  context.autoCaptureFingerprint ||= "";
  context.autoCaptureDeferral ||= null;
  context.coreSurfaceReview ||= null;
  context.nanoTaskHarness ||= null;
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
    appVersion: APP_VERSION,
    agentVersion: APP_VERSION,
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

async function writeRuntimeBundle(
  runtime,
  continuity,
  audit,
  explicitWindowId = undefined,
  additionalWrites = {}
) {
  // v0.11.20: readRuntimeBundle() returns a wrapper { runtime, continuity, audit, context }.
  // Persist only the root runtime object. Fail with a typed diagnostic instead of an
  // opaque getWindowContext(...).windows TypeError if a wrapper is ever passed again.
  if (!runtime || typeof runtime !== "object" || !runtime.windows || typeof runtime.windows !== "object") {
    throw new Error("RUNTIME_ROOT_REQUIRED");
  }
  const explicitScopeProvided = explicitWindowId !== undefined;
  const explicitScopedWindowId = explicitScopeProvided
    ? nullableInteger(explicitWindowId)
    : null;
  const scopedWindowId = explicitScopeProvided
    ? explicitScopedWindowId
    : continuityScopeWindowId(continuity);
  let sealed;
  let expectedBackupDigest = "";
  const readbackDiagnostics = {
    operation: "writeRuntimeBundle",
    scopedWindowId: Number.isInteger(scopedWindowId) ? scopedWindowId : null,
    expectedPrimaryDigest: "",
    storedPrimaryDigest: "",
    recomputedPrimaryDigest: "",
    observedPrimaryDigest: "",
    primaryVerificationReason: "",
    primaryValid: null,
    expectedBackupDigest: "",
    storedBackupDigest: "",
    recomputedBackupDigest: "",
    observedBackupDigest: "",
    backupVerificationReason: "",
    backupValid: null,
    runtimeRevision: 0
  };
  const writes = additionalWrites && typeof additionalWrites === "object"
    ? { ...additionalWrites }
    : {};

  if (Number.isInteger(scopedWindowId)) {
    const context = getWindowContext(runtime, scopedWindowId);
    if (context?.run) {
      context.run = bindSessionContextBaselineNanoRequest(context.run);
      context.run = enforceSessionContextBaselinePersistenceInvariant(
        context.run,
        continuity,
        { now: Date.now() }
      ).run;
    }
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
  readbackDiagnostics.runtimeRevision = runtime.revision;
  readbackDiagnostics.expectedPrimaryDigest = sealed?.integrity?.digest || "";
  readbackDiagnostics.expectedBackupDigest = expectedBackupDigest;
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
      readbackDiagnostics.primaryValid = primaryCheck.valid;
      readbackDiagnostics.storedPrimaryDigest = primaryCheck.expected || "";
      readbackDiagnostics.recomputedPrimaryDigest = primaryCheck.actual || "";
      readbackDiagnostics.observedPrimaryDigest = primaryCheck.actual || "";
      readbackDiagnostics.primaryVerificationReason = primaryCheck.reason || "";
      readbackDiagnostics.backupValid = backupCheck.valid;
      readbackDiagnostics.storedBackupDigest = backupCheck.expected || "";
      readbackDiagnostics.recomputedBackupDigest = backupCheck.actual || "";
      readbackDiagnostics.observedBackupDigest = backupCheck.actual || "";
      readbackDiagnostics.backupVerificationReason = backupCheck.reason || "";
      if (!primaryCheck.valid || primaryCheck.expected !== sealed.integrity?.digest) {
        throw new Error("CONTINUITY_PRIMARY_READBACK_MISMATCH");
      }
      if (expectedBackupDigest && (!backupCheck.valid || backupCheck.expected !== expectedBackupDigest)) {
        throw new Error("CONTINUITY_BACKUP_READBACK_MISMATCH");
      }
    } else {
      const primaryCheck = await verifyContinuity(readback[STORAGE_KEYS.CONTINUITY]);
      const backupCheck = await verifyContinuity(readback[STORAGE_KEYS.CONTINUITY_BACKUP]);
      readbackDiagnostics.primaryValid = primaryCheck.valid;
      readbackDiagnostics.storedPrimaryDigest = primaryCheck.expected || "";
      readbackDiagnostics.recomputedPrimaryDigest = primaryCheck.actual || "";
      readbackDiagnostics.observedPrimaryDigest = primaryCheck.actual || "";
      readbackDiagnostics.primaryVerificationReason = primaryCheck.reason || "";
      readbackDiagnostics.backupValid = backupCheck.valid;
      readbackDiagnostics.storedBackupDigest = backupCheck.expected || "";
      readbackDiagnostics.recomputedBackupDigest = backupCheck.actual || "";
      readbackDiagnostics.observedBackupDigest = backupCheck.actual || "";
      readbackDiagnostics.backupVerificationReason = backupCheck.reason || "";
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
    let detail = error instanceof Error ? error.message : String(error);
    const readbackMismatch = /^CONTINUITY_(?:PRIMARY|BACKUP)_READBACK_MISMATCH$/u.test(detail);
    if (readbackMismatch) {
      try {
        // v0.10.13: one bounded rewrite/readback handles a transient owner-store
        // race without destroying the semantic substate (for example an
        // unclaimed NANO_ANALYZING request). A second mismatch still fails closed
        // through the emergency path below.
        await chrome.storage.local.set(writes);
        const retryReadback = await chrome.storage.local.get([
          STORAGE_KEYS.RUNTIME,
          STORAGE_KEYS.CONTINUITY,
          STORAGE_KEYS.CONTINUITY_BACKUP
        ]);
        let retryPrimary;
        let retryBackup;
        if (Number.isInteger(scopedWindowId)) {
          const persisted = retryReadback[STORAGE_KEYS.RUNTIME]?.windows?.[String(scopedWindowId)];
          retryPrimary = await verifyContinuity(persisted?.continuity);
          retryBackup = await verifyContinuity(persisted?.continuityBackup);
        } else {
          retryPrimary = await verifyContinuity(retryReadback[STORAGE_KEYS.CONTINUITY]);
          retryBackup = await verifyContinuity(retryReadback[STORAGE_KEYS.CONTINUITY_BACKUP]);
        }
        readbackDiagnostics.primaryValid = retryPrimary.valid;
        readbackDiagnostics.storedPrimaryDigest = retryPrimary.expected || "";
        readbackDiagnostics.recomputedPrimaryDigest = retryPrimary.actual || "";
        readbackDiagnostics.observedPrimaryDigest = retryPrimary.actual || "";
        readbackDiagnostics.primaryVerificationReason = retryPrimary.reason || "";
        readbackDiagnostics.backupValid = retryBackup.valid;
        readbackDiagnostics.storedBackupDigest = retryBackup.expected || "";
        readbackDiagnostics.recomputedBackupDigest = retryBackup.actual || "";
        readbackDiagnostics.observedBackupDigest = retryBackup.actual || "";
        readbackDiagnostics.backupVerificationReason = retryBackup.reason || "";
        const primaryMatches = retryPrimary.valid &&
          retryPrimary.expected === readbackDiagnostics.expectedPrimaryDigest;
        const backupMatches = !expectedBackupDigest ||
          (retryBackup.valid && retryBackup.expected === expectedBackupDigest);
        if (!primaryMatches || !backupMatches) {
          throw new Error(
            !primaryMatches
              ? "CONTINUITY_PRIMARY_READBACK_MISMATCH"
              : "CONTINUITY_BACKUP_READBACK_MISMATCH"
          );
        }
        storageCircuitOpen = false;
        await persistFullAuditQueueFailSoft([{
          level: "warning",
          event: "runtime.write.readback-recovered",
          message: "Continuity-readback matchade efter exakt en bounded rewrite.",
          windowId: Number.isInteger(scopedWindowId) ? scopedWindowId : null,
          runId: Number.isInteger(scopedWindowId)
            ? runtime.windows?.[String(scopedWindowId)]?.run?.runId || null
            : null,
          correlationId: readbackDiagnostics.expectedPrimaryDigest || null,
          data: {
            firstError: detail,
            runtimeRevision: runtime.revision,
            expectedPrimaryDigest: readbackDiagnostics.expectedPrimaryDigest,
            storedPrimaryDigest: retryPrimary.expected || "",
            recomputedPrimaryDigest: retryPrimary.actual || "",
            observedPrimaryDigest: retryPrimary.actual || "",
            primaryVerificationReason: retryPrimary.reason || "",
            primaryValid: retryPrimary.valid,
            expectedBackupDigest,
            storedBackupDigest: retryBackup.expected || "",
            recomputedBackupDigest: retryBackup.actual || "",
            observedBackupDigest: retryBackup.actual || "",
            backupVerificationReason: retryBackup.reason || "",
            backupValid: retryBackup.valid,
            retryCount: 1,
            fullAuditFailSoft: true
          }
        }]);
        return sealed;
      } catch (retryError) {
        detail = `${detail}; READBACK_RETRY_FAILED: ${
          retryError instanceof Error ? retryError.message : String(retryError)
        }`;
      }
    }
    storageCircuitOpen = true;
    const emergencyRuntime = deepClone(runtime);
    for (const context of Object.values(emergencyRuntime.windows || {})) {
      if (!context?.run) continue;
      const init = context.run.sessionContextInit;
      const commit = init?.baselineDecisionCommit;
      const commitDiagnostics = {
        expectedContinuityDigest: readbackDiagnostics.expectedPrimaryDigest,
        storedContinuityDigest: readbackDiagnostics.storedPrimaryDigest,
        recomputedContinuityDigest: readbackDiagnostics.recomputedPrimaryDigest,
        verificationReason: readbackDiagnostics.primaryVerificationReason
      };
      if (commit?.schema) {
        if (init.state === SESSION_CONTEXT_INIT_STATE.READY &&
            commit.commitStatus === SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED &&
            commit.readyStatus === SESSION_CONTEXT_READY_FINALIZATION_STATUS.COMMITTING &&
            !commit.readyVerifiedAt) {
          const blockedInit = advanceSessionContextInit(
            init,
            SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING,
            { completedAt: null },
            { force: true }
          );
          blockedInit.baselineDecisionCommit = failSessionContextReadyFinalization(commit, {
            code: "SESSION_CONTEXT_READY_COMMIT_FAILED",
            detail,
            now: Date.now()
          });
          context.run.sessionContextInit = blockedInit;
        } else if ([
          SESSION_CONTEXT_BASELINE_COMMIT_STATUS.DECISION_READY,
          SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTING
        ].includes(commit.commitStatus)) {
          context.run.sessionContextInit.baselineDecisionCommit =
            failSessionContextBaselineCommit(commit, {
              code: "SESSION_CONTEXT_BASELINE_COMMIT_FAILED",
              detail,
              diagnostics: commitDiagnostics,
              now: Date.now()
            });
        }
      }
      const semanticRecovery = storageRecoverySemanticState(context.run);
      context.run.recovery ||= { attempts: [] };
      context.run.recovery.attempts = (context.run.recovery.attempts || []).slice(-10);
      context.run.effectJournal = compactEffectJournal(
        context.run.effectJournal || [],
        context.run.currentTurn?.turnId || "",
        4
      );
      context.run.storagePersistenceFailure = {
        schema: "eic.autonom.storage-recovery.v1",
        code: sanitizeText(detail, 160),
        detail: `Storage-write misslyckades: ${sanitizeText(detail, 800)}.`,
        expectedPrimaryDigest: readbackDiagnostics.expectedPrimaryDigest,
        storedPrimaryDigest: readbackDiagnostics.storedPrimaryDigest,
        recomputedPrimaryDigest: readbackDiagnostics.recomputedPrimaryDigest,
        observedPrimaryDigest: readbackDiagnostics.observedPrimaryDigest,
        primaryVerificationReason: readbackDiagnostics.primaryVerificationReason,
        expectedBackupDigest: readbackDiagnostics.expectedBackupDigest,
        storedBackupDigest: readbackDiagnostics.storedBackupDigest,
        recomputedBackupDigest: readbackDiagnostics.recomputedBackupDigest,
        observedBackupDigest: readbackDiagnostics.observedBackupDigest,
        backupVerificationReason: readbackDiagnostics.backupVerificationReason,
        primaryValid: readbackDiagnostics.primaryValid,
        backupValid: readbackDiagnostics.backupValid,
        runtimeRevision: readbackDiagnostics.runtimeRevision,
        writer: readbackDiagnostics.operation,
        requestId: semanticRecovery.requestId,
        sessionContextInitState: semanticRecovery.sessionContextInitState,
        resumeState: semanticRecovery.resumeState,
        failedAt: nowIso()
      };
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
        expectedPrimaryDigest: readbackDiagnostics.expectedPrimaryDigest,
        storedPrimaryDigest: readbackDiagnostics.storedPrimaryDigest,
        recomputedPrimaryDigest: readbackDiagnostics.recomputedPrimaryDigest,
        observedPrimaryDigest: readbackDiagnostics.observedPrimaryDigest,
        primaryVerificationReason: readbackDiagnostics.primaryVerificationReason,
        primaryValid: readbackDiagnostics.primaryValid,
        expectedBackupDigest: readbackDiagnostics.expectedBackupDigest,
        storedBackupDigest: readbackDiagnostics.storedBackupDigest,
        recomputedBackupDigest: readbackDiagnostics.recomputedBackupDigest,
        observedBackupDigest: readbackDiagnostics.observedBackupDigest,
        backupVerificationReason: readbackDiagnostics.backupVerificationReason,
        backupValid: readbackDiagnostics.backupValid,
        writer: readbackDiagnostics.operation,
        scopedWindowId: readbackDiagnostics.scopedWindowId,
        fullAuditFailSoft: true
      }
    }]);
    const persistenceError = new Error(`STORAGE_PERSISTENCE_FAILURE: ${detail}`);
    persistenceError.code = "STORAGE_PERSISTENCE_FAILURE";
    persistenceError.readbackDiagnostics = deepClone(readbackDiagnostics);
    throw persistenceError;
  }
  return sealed;
}

function baselineCommitDiagnosticsFromError(error) {
  const diagnostics = error?.readbackDiagnostics && typeof error.readbackDiagnostics === "object"
    ? error.readbackDiagnostics
    : {};
  return {
    expectedContinuityDigest: sanitizeText(diagnostics.expectedPrimaryDigest, 96),
    storedContinuityDigest: sanitizeText(diagnostics.storedPrimaryDigest, 96),
    recomputedContinuityDigest: sanitizeText(diagnostics.recomputedPrimaryDigest, 96),
    verificationReason: sanitizeText(diagnostics.primaryVerificationReason, 160)
  };
}

async function verifySessionContextBaselineCommitReadback(windowId, expectedReceipt, {
  expectedContinuityDigest = "",
  requireCommittedReceipt = false,
  requireReady = false,
  requireReadyReceipt = false,
  requireBaseline = true
} = {}) {
  const data = await chrome.storage.local.get([STORAGE_KEYS.RUNTIME]);
  const persistedContext = data[STORAGE_KEYS.RUNTIME]?.windows?.[String(windowId)] || null;
  const persistedRun = persistedContext?.run || null;
  const persistedInit = persistedRun?.sessionContextInit || null;
  const persistedReceipt = persistedInit?.baselineDecisionCommit || null;
  const continuityCheck = await verifyContinuity(persistedContext?.continuity);
  const persistedBaselineDigest = persistedContext?.continuity?.mainTaskBaseline
    ? await sha256Hex(stableStringify(persistedContext.continuity.mainTaskBaseline))
    : "";
  const persistedReceiptBaselineDigest = persistedReceipt?.acceptedBaseline
    ? await sha256Hex(stableStringify(persistedReceipt.acceptedBaseline))
    : "";
  const reasons = [];

  if (!continuityCheck.valid) reasons.push(continuityCheck.reason || "CONTINUITY_INVALID");
  if (expectedContinuityDigest &&
      continuityCheck.expected !== expectedContinuityDigest) {
    reasons.push("CONTINUITY_DIGEST_MISMATCH");
  }
  if (!persistedReceipt || persistedReceipt.schema !== expectedReceipt?.schema) {
    reasons.push("COMMIT_RECEIPT_MISSING");
  } else {
    if (persistedReceipt.requestId !== expectedReceipt.requestId) reasons.push("REQUEST_ID_MISMATCH");
    if (persistedReceipt.claimId !== expectedReceipt.claimId) reasons.push("CLAIM_ID_MISMATCH");
    if (persistedReceipt.analysisMode !== expectedReceipt.analysisMode) reasons.push("ANALYSIS_MODE_MISMATCH");
    if (persistedReceipt.baselineResponseIdentity !== expectedReceipt.baselineResponseIdentity) {
      reasons.push("BASELINE_RESPONSE_IDENTITY_MISMATCH");
    }
    if (persistedReceipt.decisionDigest !== expectedReceipt.decisionDigest) {
      reasons.push("DECISION_DIGEST_MISMATCH");
    }
    if (persistedReceipt.candidateDigest !== expectedReceipt.candidateDigest) {
      reasons.push("CANDIDATE_DIGEST_MISMATCH");
    }
    if (persistedReceipt.semanticVerdict !== "ACCEPT" ||
        persistedReceipt.normalizedBaselineAccepted !== true) {
      reasons.push("SEMANTIC_ACCEPT_MISMATCH");
    }
    if (requireCommittedReceipt &&
        persistedReceipt.commitStatus !== SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED) {
      reasons.push("COMMIT_STATUS_MISMATCH");
    }
  }
  if (requireBaseline && expectedReceipt?.candidateDigest &&
      persistedBaselineDigest !== expectedReceipt.candidateDigest) {
    reasons.push("CONTINUITY_BASELINE_IDENTITY_MISMATCH");
  }
  if (expectedReceipt?.candidateDigest &&
      persistedReceiptBaselineDigest !== expectedReceipt.candidateDigest) {
    reasons.push("RECEIPT_BASELINE_IDENTITY_MISMATCH");
  }
  if (requireReady && persistedInit?.state !== SESSION_CONTEXT_INIT_STATE.READY) {
    reasons.push("READY_STATE_NOT_DURABLE");
  }
  if (requireReadyReceipt &&
      persistedReceipt?.readyStatus !== SESSION_CONTEXT_READY_FINALIZATION_STATUS.READY) {
    reasons.push("READY_RECEIPT_NOT_DURABLE");
  }

  return {
    valid: reasons.length === 0,
    reason: reasons[0] || "OK",
    reasons,
    persistedRun,
    persistedInit,
    persistedReceipt,
    diagnostics: {
      expectedContinuityDigest: sanitizeText(expectedContinuityDigest, 96),
      storedContinuityDigest: sanitizeText(continuityCheck.expected, 96),
      recomputedContinuityDigest: sanitizeText(continuityCheck.actual, 96),
      verificationReason: sanitizeText(continuityCheck.reason, 160)
    }
  };
}

function completedNanoDecisionRequest(request, completionRequest, payload, decision, source, now) {
  const completedAt = sanitizeText(completionRequest?.completedAt, 120) || nowIso(now);
  return {
    ...deepClone(completionRequest || request || {}),
    status: NANO_REQUEST_STATUS.COMPLETED,
    completedAt,
    durationMs: Math.max(
      0,
      Number(payload?.durationMs || 0) ||
      (now - Date.parse(request?.startedAt || request?.claimedAt || request?.createdAt || completedAt))
    ),
    outputChars: Math.max(Number(request?.outputChars || 0), Number(payload?.outputChars || 0)),
    chunkCount: Math.max(Number(request?.chunkCount || 0), Number(payload?.chunkCount || 0)),
    firstTokenAt: request?.firstTokenAt || payload?.firstTokenAt || null,
    transport: sanitizeText(payload?.transport || request?.transport || "unknown", 80),
    repairUsed: Boolean(payload?.repairUsed || request?.repairAttempt),
    decisionSource: source,
    validationErrors: [],
    resultSummary: sanitizeText(
      `${decision?.action || "PAUSE"}: ${decision?.requestedAction || decision?.completionEvidence || decision?.reason || ""}`,
      1200
    )
  };
}

async function validateBaselineCommitReplayAuthorization(receipt, request) {
  const reasons = [];
  if (!receipt || !sessionContextBaselineCommitNeedsRecovery(receipt)) {
    reasons.push("RECEIPT_NOT_RECOVERABLE");
  }
  if (!request) reasons.push("PENDING_REQUEST_MISSING");
  if (request?.status !== NANO_REQUEST_STATUS.COMPLETED) {
    reasons.push("SEMANTIC_COMPLETION_NOT_DURABLE");
  }
  if (request?.decisionSource !== NANO_DECISION_SOURCE.NANO) {
    reasons.push("SEMANTIC_COMPLETION_SOURCE_MISMATCH");
  }
  if (request?.requestId !== receipt?.requestId) reasons.push("REQUEST_ID_MISMATCH");
  if (request?.claimId !== receipt?.claimId) reasons.push("CLAIM_ID_MISMATCH");
  if (request?.mode !== receipt?.analysisMode) reasons.push("ANALYSIS_MODE_MISMATCH");
  if (request?.baselineResponseIdentity !== receipt?.baselineResponseIdentity) {
    reasons.push("BASELINE_RESPONSE_IDENTITY_MISMATCH");
  }
  if (receipt?.semanticVerdict !== "ACCEPT" ||
      receipt?.normalizedBaselineAccepted !== true ||
      !receipt?.acceptedBaseline) {
    reasons.push("SEMANTIC_ACCEPT_MISMATCH");
  }

  const receiptCandidateDigest = receipt?.acceptedBaseline
    ? await sha256Hex(stableStringify(receipt.acceptedBaseline))
    : "";
  if (!receipt?.candidateDigest || receiptCandidateDigest !== receipt.candidateDigest) {
    reasons.push("CANDIDATE_DIGEST_MISMATCH");
  }

  const requestCandidateDigest = request?.baselineCandidate
    ? await sha256Hex(stableStringify(request.baselineCandidate))
    : "";
  if (!requestCandidateDigest || requestCandidateDigest !== receipt?.candidateDigest) {
    reasons.push("REQUEST_CANDIDATE_IDENTITY_MISMATCH");
  }

  const recomputedDecisionDigest = receipt?.decision && receipt?.baselineAnalysis
    ? await sha256Hex(stableStringify({
        requestId: receipt.requestId,
        claimId: receipt.claimId,
        analysisMode: receipt.analysisMode,
        baselineResponseIdentity: receipt.baselineResponseIdentity,
        baselineAnalysis: receipt.baselineAnalysis,
        decision: receipt.decision,
        candidateDigest: receipt.candidateDigest
      }))
    : "";
  if (!receipt?.decisionDigest || recomputedDecisionDigest !== receipt.decisionDigest) {
    reasons.push("DECISION_DIGEST_MISMATCH");
  }

  return {
    ok: reasons.length === 0,
    reason: reasons[0] || "OK",
    reasons,
    request: request ? deepClone(request) : null
  };
}

function baselineCommitReplayPayload(run) {
  const receipt = run?.sessionContextInit?.baselineDecisionCommit;
  const request = run?.pendingNanoRequest;
  if (!receipt?.requestId || !request) return null;
  return {
    requestId: receipt.requestId,
    claimId: receipt.claimId,
    analysisMode: receipt.analysisMode,
    source: NANO_DECISION_SOURCE.NANO,
    durationMs: Number(request.durationMs || 0),
    outputChars: Math.max(1, Number(request.outputChars || 0)),
    chunkCount: Number(request.chunkCount || 0),
    firstTokenAt: request.firstTokenAt || null,
    transport: sanitizeText(request.transport || "prompt-api", 80),
    repairUsed: Boolean(request.repairAttempt),
    baselineAnalysis: deepClone(receipt.baselineAnalysis || {}),
    decision: deepClone(receipt.decision || {})
  };
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

  let rootRepairPending = false;
  if (currentCheck.valid) {
    rootContinuity = currentCheck.continuity;
  } else if (currentCheck.reason === "UNSEALED") {
    rootContinuity = await sealContinuity(currentCheck.continuity);
    rootRepairPending = true;
  } else {
    const backupCheck = await verifyContinuity(data[STORAGE_KEYS.CONTINUITY_BACKUP]);
    if (!backupCheck.valid) {
      throw new Error(
        `CONTINUITY_CORRUPT: current=${currentCheck.reason}; backup=${backupCheck.reason}. ` +
        "Ingen prompt skickas innan continuity återställts via en verifierad export eller reset."
      );
    }
    rootContinuity = backupCheck.continuity;
    rootRepairPending = true;
    addAudit(audit, {
      kind: "warning",
      title: "Legacy continuity återställd från verifierad backup",
      detail: `Aktuell legacy-continuity hade ${currentCheck.reason}. Ingen målprompt skickades under återställningen.`
    });
  }

  const currentState = loadCurrentState(
    data[STORAGE_KEYS.CONFIG] || createDefaultConfig(),
    data[STORAGE_KEYS.RUNTIME] || createDefaultRuntime()
  );
  fullAuditLoggingEnabledCache = currentState.config.fullAuditLoggingEnabled === true;
  let runtimeChanged = currentState.changed;
  let selectedContinuity = rootContinuity;

  const numericWindowId = nullableInteger(windowId);
  if (numericWindowId !== null) {
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

  // v0.12.9: loadBundle is deliberately read/normalize-only after initialization.
  // Repairing a stale copy here used to allow GET_SNAPSHOT and other observers to
  // overwrite a newer queued owner mutation. The next explicit owner commit writes
  // the normalized runtime; root continuity recovery remains fail-closed/in-memory
  // until such a commit or a fresh initialization.
  const repairPending = Boolean(runtimeChanged || rootRepairPending);

  return {
    config: currentState.config,
    continuity: selectedContinuity,
    rootContinuity,
    runtime: currentState.runtime,
    audit,
    repairPending,
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

function responseIdentityOwnerPrefix(identityValue, responseHash = "") {
  const identity = String(identityValue || "");
  const hash = String(responseHash || "");
  if (!identity || !hash) return "";
  const suffix = `|${hash}`;
  return identity.endsWith(suffix)
    ? identity.slice(0, -suffix.length)
    : "";
}

function pageResponseOwnerPrefix(page = {}) {
  const conversationKey = String(page?.conversationKey || "");
  const taskFingerprint = String(page?.taskFingerprint || "");
  return conversationKey && taskFingerprint
    ? `${conversationKey}|${taskFingerprint}`
    : "";
}

function sessionContextBaselineDelivery(run) {
  const init = run?.sessionContextInit;
  const effect = latestEffect(run);
  const currentTurnKind = String(run?.currentTurn?.kind || "");
  const baselineTurn = [
    "SESSION_CONTEXT_BASELINE_REQUEST",
    "SESSION_CONTEXT_BASELINE_CORRECTION"
  ].includes(currentTurnKind);
  const effectDelivered = Boolean(
    effect?.sessionContextBaseline === true &&
    effect?.status === "ACKED" &&
    run?.currentTurn?.effectState === "ACKED" &&
    effect?.turnId &&
    String(effect.turnId) === String(run?.currentTurn?.turnId || "")
  );
  return {
    delivered: Boolean(
      baselineTurn &&
      effectDelivered &&
      init?.baselinePromptDigest &&
      String(init.baselinePromptDigest) === String(effect?.promptDigest || "")
    ),
    effect,
    init
  };
}


function bindSessionContextBaselineNanoRequest(runValue, { now = Date.now() } = {}) {
  const run = runValue;
  const request = run?.pendingNanoRequest;
  const init = run?.sessionContextInit;
  if (init?.state !== SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING ||
      request?.sessionContextBaselineAnalysis !== true ||
      !sanitizeText(request?.requestId, 160)) {
    return run;
  }
  if (String(init.nanoRequestId || "") === String(request.requestId || "")) {
    return run;
  }
  run.sessionContextInit = {
    ...init,
    nanoRequestId: String(request.requestId),
    updatedAt: nowIso(now)
  };
  return run;
}


function enforceSessionContextBaselinePersistenceInvariant(runValue, continuityValue, {
  now = Date.now()
} = {}) {
  let run = runValue;
  const init = run?.sessionContextInit;
  const exactBaselineOwner = exactSessionContextBaselineNanoOwnership(run);
  if (init?.state !== SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING ||
      exactBaselineOwner ||
      continuityValue?.mainTaskBaseline) {
    return { run, reconciled: false };
  }

  // v0.11.3: existence is not ownership. An ordinary continuation request may
  // never mask a missing baseline-analysis owner while session init is blocked.
  if (run?.pendingNanoRequest) {
    run.lastRejectedPreReadyNanoRequest = {
      requestId: sanitizeText(run.pendingNanoRequest.requestId, 180),
      mode: sanitizeText(run.pendingNanoRequest.mode, 120),
      sessionContextBaselineAnalysis:
        run.pendingNanoRequest.sessionContextBaselineAnalysis === true,
      reason: "SESSION_CONTEXT_BASELINE_EXACT_OWNER_REQUIRED",
      at: nowIso(now)
    };
    run.pendingNanoRequest = null;
  }

  const delivery = sessionContextBaselineDelivery(run);
  if (!delivery.delivered) {
    return { run, reconciled: false };
  }

  // A delivered/ACKED baseline turn is durable delivery truth. It is illegal to
  // persist NANO_ANALYZING without either the exact baseline Nano request or an
  // accepted baseline. Recover to post-delivery reconciliation *before* storage
  // can expose that ownerless state to a later tick/service-worker instance.
  run.sessionContextInit = advanceSessionContextInit(
    init,
    SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE,
    {
      nanoRequestId: "",
      baselineDecisionCommit: null,
      completedAt: null,
      failureCode: ""
    },
    { now, force: true }
  );
  run.takeoverBootstrapRequired = false;
  run.nanoTelemetry ||= {};
  run.nanoTelemetry.lastStatus = "BASELINE_OWNERLESS_PERSISTENCE_RECONCILED";
  run.nanoTelemetry.lastResultSummary = "POST_DELIVERY_RECONCILE_NO_TARGET_PROMPT";
  run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
    origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
    reason: "ACKED baselineleverans saknade aktiv Nano-request vid persistensgränsen; lokal post-delivery reconcile återställdes utan målprompt.",
    now,
    force: true
  });
  return { run, reconciled: true };
}

function classifyDeliveredBaselineFreshnessChange(run, page, {
  requirePendingRequest = true
} = {}) {
  const delivery = sessionContextBaselineDelivery(run);
  const hasBoundRequest = run?.pendingNanoRequest?.sessionContextBaselineAnalysis === true;
  if (![SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE,
        SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING]
        .includes(run?.sessionContextInit?.state) ||
      (requirePendingRequest && !hasBoundRequest) ||
      !delivery.delivered) {
    return { kind: "NOT_BASELINE_RECONCILIATION", delivery };
  }

  const expectedConversation = String(
    delivery.effect?.conversationKey ||
    delivery.init?.conversationKey ||
    run?.conversationKey ||
    ""
  );
  if (!page || !expectedConversation ||
      String(page.conversationKey || "") !== expectedConversation) {
    return { kind: "OWNER_CHANGED", delivery };
  }

  const effectVisible = pageContainsEffect(page, delivery.effect);
  const priorObservation = run.pendingObservation;
  const priorResponseIdentity = String(
    priorObservation?.responseIdentity ||
    delivery.init?.baselineResponseIdentity ||
    ""
  );
  const priorResponseHash = String(
    priorObservation?.responseHash ||
    priorResponseIdentity.split("|").at(-1) ||
    ""
  );
  const priorOwner = responseIdentityOwnerPrefix(
    priorResponseIdentity,
    priorResponseHash
  );
  const currentOwner = pageResponseOwnerPrefix(page);
  const currentLatestUserHash = String(page?.latestUserHash || "");
  if (!priorOwner) {
    return { kind: "OWNER_CHANGED", delivery, effectVisible };
  }
  // Once the baseline turn is durable ACKED, visibility of that older user node
  // is diagnostic only. ChatGPT may virtualize it out of the DOM. If the latest
  // user anchor is temporarily unavailable we do not invent a new owner; wait
  // for a stable current response and preserve the ACKED delivery lineage.
  if (!currentOwner || !currentLatestUserHash) {
    return { kind: "WAIT_FOR_CURRENT_BASELINE_RESPONSE", delivery, effectVisible };
  }
  if (priorOwner !== currentOwner) {
    return { kind: "OWNER_CHANGED", delivery, effectVisible };
  }

  if (!isAssistantResponseCandidate(page) || !latestMessageIsAssistant(page)) {
    return { kind: "WAIT_FOR_CURRENT_BASELINE_RESPONSE", delivery, effectVisible };
  }

  // Visible assistant-node counts and raw body hashes are freshness evidence, not
  // owner identity. ChatGPT may update the current assistant DOM after Nano was
  // already claimed. The old Nano result must then be discarded, but the already
  // ACKED baseline turn stays authoritative for *delivery*. Rebind the current
  // assistant body locally and run a fresh Nano analysis; never resend the target
  // baseline prompt merely because its response body changed.
  return { kind: "REBIND_CURRENT_BASELINE_RESPONSE", delivery, effectVisible };
}

function classifyBaselineClaimFreshnessChange(run, page) {
  return classifyDeliveredBaselineFreshnessChange(run, page, {
    requirePendingRequest: true
  });
}

function supersedePendingObservation(runValue, page, audit, {
  windowId,
  reason = "Target response changed",
  reconcileSessionContextBaseline = false
} = {}) {
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
  if (reconcileSessionContextBaseline &&
      run.sessionContextInit?.state === SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING) {
    run.sessionContextInit = advanceSessionContextInit(
      run.sessionContextInit,
      SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE,
      {
        nanoRequestId: "",
        baselineDecisionCommit: null,
        completedAt: null,
        failureCode: ""
      },
      { now: Date.now(), force: true }
    );
    run.takeoverBootstrapRequired = false;
  }
  run.deterministicGroundingFailure = null;
  run.deterministicDispatchFailure = null;
  run.deterministicDispatchRearms = 0;
  run = retireResponseCandidate(run, {
    status: RESPONSE_OBSERVATION_CYCLE_STATUS.SUPERSEDED,
    reason: "PENDING_OBSERVATION_SUPERSEDED",
    now: Date.now()
  });
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

function reconcileInvalidatedBaselineNanoRequest(runValue, page, audit, {
  windowId,
  reason = "Baseline Nano request invalidated",
  now = Date.now()
} = {}) {
  let run = runValue;
  if (run?.pendingNanoRequest?.sessionContextBaselineAnalysis !== true ||
      run?.sessionContextInit?.state !== SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING) {
    return { handled: false, action: "NOT_BASELINE_ANALYSIS", run };
  }

  const freshness = classifyDeliveredBaselineFreshnessChange(run, page, {
    requirePendingRequest: true
  });
  if ([
    "REBIND_CURRENT_BASELINE_RESPONSE",
    "WAIT_FOR_CURRENT_BASELINE_RESPONSE"
  ].includes(freshness.kind)) {
    run = supersedePendingObservation(run, page, audit, {
      windowId,
      reason: `${reason}; ACKED baseline delivery remains owner-compatible and will be re-analysed locally.`,
      reconcileSessionContextBaseline: true
    });
    run.sessionContextBaselineRebindCount =
      Number(run.sessionContextBaselineRebindCount || 0) + 1;
    run.nanoTelemetry ||= {};
    run.nanoTelemetry.lastStatus = "BASELINE_NANO_INVALIDATED_REBIND_PENDING";
    run.nanoTelemetry.lastError = sanitizeText(reason, 1200);
    run.nanoTelemetry.lastResultSummary = "POST_DELIVERY_RECONCILE_NO_TARGET_PROMPT";
    return { handled: true, action: "RECONCILED", run, freshness };
  }

  if (freshness.kind === "OWNER_CHANGED") {
    run = supersedePendingObservation(run, page, audit, {
      windowId,
      reason: `${reason}; baseline response owner changed`
    });
    run = applySessionContextInitFailure(run, {
      windowId,
      audit,
      code: SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_RESPONSE_OWNER_CHANGED,
      detail: `${reason}. Den aktuella sidan kan inte owner-bindas till den ACKED baselineleveransen.`,
      now
    });
    return { handled: true, action: "OWNER_CHANGED", run, freshness };
  }

  run = applySessionContextInitFailure(run, {
    windowId,
    audit,
    code: SESSION_CONTEXT_INIT_FAILURE_CODE.NANO_ANALYSIS_FAILED,
    detail: `${reason}. Ingen säker deterministisk fallback får ersätta baseline-Nano-analysen.`,
    now
  });
  return { handled: true, action: "FAILED_NO_DELIVERY_OWNER", run, freshness };
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

function linkStatusProjectionForTab(context = {}, tabId) {
  const linked = context?.linkedTabs?.[String(tabId)] || null;
  if (!linked) {
    return { status: "DISCONNECTED", detail: "Fliken är inte länkad i durable runtime-state.", overlay: null };
  }
  const run = context?.run || null;
  const runTargetTabId = nullableInteger(run?.targetTabId);
  const requestedTabId = nullableInteger(tabId);
  if (!run || runTargetTabId === null || requestedTabId === null || runTargetTabId !== requestedTabId) {
    return { status: "LINKED", detail: "Länkstatus återställd från durable runtime-state.", overlay: null };
  }

  let status = "ACTIVE_TARGET";
  if ([STATES.RECOVERING, STATES.ERROR_RETRYABLE].includes(run.state)) status = "RECOVERING";
  else if (run.state === STATES.ASSESSING) status = "ASSESSING";
  else if (run.state === STATES.WAITING_BACKGROUND) status = "BACKGROUND";
  else if ([STATES.WAITING_FOR_RESPONSE, STATES.WAITING_FOREGROUND].includes(run.state)) status = "WAITING";
  else if ([STATES.RUNNING, STATES.PREPARING, STATES.CONTINUING].includes(run.state)) status = "WORKING";
  else if ([STATES.SOFT_PAUSED, STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION, STATES.STOPPED].includes(run.state)) status = "PAUSED";
  else if ([STATES.PROGRAM_BLOCKED, STATES.ERROR_TERMINAL].includes(run.state)) status = "BLOCKED";
  else if (run.state === STATES.PROGRAM_DONE) status = "DONE";

  return {
    status,
    detail: `Länkstatus återställd från durable runtime-state (${run.state || "UNKNOWN"}).`,
    overlay: runTargetTabId === requestedTabId
      ? sessionContextInitOverlay(run.sessionContextInit)
      : null
  };
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
      (
        context.run.state === STATES.AWAITING_OPERATOR_ACTION ||
        ([STATES.PROGRAM_BLOCKED, STATES.AWAITING_OPERATOR_DECISION].includes(context.run.state) &&
          pauseRequiresHuman(context.run))
      )
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


function requireNanoPromptDigest(value, code = "NANO_INPUT_DIGEST_INVALID") {
  const digest = sanitizeText(value, 128).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return digest;
}


function queueNanoTaskHarness(context, {
  task,
  sourceUserHash = "",
  sourceConversationKey = "",
  now = Date.now()
} = {}) {
  const prompt = String(task || "").trim();
  if (!prompt) return { queued: false, reason: "NANO_TASK_EMPTY" };
  const existing = context.nanoTaskHarness;
  if (existing &&
      existing.sourceUserHash === String(sourceUserHash || "") &&
      existing.task === prompt) {
    return { queued: false, duplicate: true, harness: existing };
  }
  const harness = createNanoTaskHarness({
    requestId: randomId("nano-task"),
    sourceUserHash,
    sourceConversationKey,
    task: prompt,
    now: nowIso(now)
  });
  context.nanoTaskHarness = harness;
  context.updatedAt = nowIso(now);
  return { queued: true, harness };
}

function maybeQueueNanoTaskFromPage(context, page, audit, {
  legacyEffect = null,
  now = Date.now()
} = {}) {
  if (!page?.latestUser || !page?.latestUserHash) return false;
  if (latestUserOwnsControlPrompt(page, legacyEffect)) return false;
  const directive = splitNanoTaskDirective(page.latestUser);
  if (!directive.found) return false;
  const queued = queueNanoTaskHarness(context, {
    task: directive.task,
    sourceUserHash: page.latestUserHash,
    sourceConversationKey: page.conversationKey || context.run?.conversationKey || "",
    now
  });
  if (!queued.queued) return false;
  addAudit(audit, {
    kind: "info",
    title: "NANO_TASK köad i separat harness-plane",
    detail: `${queued.harness.requestId} · FRESH_ONE_PROMPT_SESSION · påverkar inte mission/control/Nano-state.`,
    windowId: context.windowId,
    tabId: context.run?.targetTabId || null,
    runId: context.run?.runId || null
  });
  return true;
}

async function claimNanoTask(windowId, payload = {}) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const current = context.nanoTaskHarness;
    if (!current || current.requestId !== String(payload.requestId || "")) {
      throw new Error("NANO_TASK_STALE_REQUEST");
    }
    const claimed = claimNanoTaskHarness(current, {
      claimId: randomId("nano-task-claim"),
      modelKind: payload.modelKind || "LanguageModel",
      now: nowIso()
    });
    if (!claimed.accepted) throw new Error(claimed.reason);
    context.nanoTaskHarness = claimed.value;
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function completeNanoTask(windowId, payload = {}) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const completed = completeNanoTaskHarness(context.nanoTaskHarness, {
      requestId: payload.requestId,
      claimId: payload.claimId,
      result: payload.result,
      isolation: payload.isolation,
      promptCalls: payload.promptCalls,
      durationMs: payload.durationMs,
      now: nowIso()
    });
    if (!completed.accepted) throw new Error(completed.reason);
    context.nanoTaskHarness = completed.value;
    addAudit(audit, {
      kind: "info",
      title: "NANO_TASK slutförd",
      detail: `${completed.value.requestId} · ${completed.value.result.length} tecken · ${completed.value.isolation}.`,
      windowId,
      tabId: context.run?.targetTabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function failNanoTask(windowId, payload = {}) {
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    const failed = failNanoTaskHarness(context.nanoTaskHarness, {
      requestId: payload.requestId,
      claimId: payload.claimId,
      error: payload.error,
      now: nowIso()
    });
    if (!failed.accepted) throw new Error(failed.reason);
    context.nanoTaskHarness = failed.value;
    addAudit(audit, {
      kind: "warning",
      title: "NANO_TASK misslyckades isolerat",
      detail: `${failed.value.requestId} · ${failed.value.error}`,
      windowId,
      tabId: context.run?.targetTabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  });
}

async function claimNanoRequest(windowId, payload) {
  return enqueue(async () => {
    const { continuity, runtime, audit, applicationLog } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    let run = context.run;
    let request = run?.pendingNanoRequest;
    if (!run || !request || !nanoRequestClaimEligible(run)) {
      throw new Error("Ingen claimbar Nano-request väntar.");
    }
    if (run.state !== STATES.ASSESSING) {
      run = transitionRun(run, STATES.ASSESSING, {
        origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
        reason: "Pending sessionsinitierings-Nano återställdes till ASSESSING vid claim.",
        force: true
      });
      context.run = run;
      request = run.pendingNanoRequest;
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
        if (request.sessionContextBaselineAnalysis === true) {
          const reconciled = reconcileInvalidatedBaselineNanoRequest(run, currentPage, audit, {
            windowId,
            reason: "Target hash/epoch changed before Nano claim",
            now: Date.now()
          });
          run = reconciled.run;
          context.run = run;
          await writeRuntimeBundle(runtime, continuity, audit);
          await notifyPanels(windowId);
          if (reconciled.action === "RECONCILED") {
            setTimeout(() => tickWindow(windowId, "baseline-observation-reconcile-before-claim").catch(console.warn), 0);
          }
          return snapshotForWindow(windowId);
        }

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
    run = bindSessionContextBaselineNanoRequest(run, { now });
    run.storagePersistenceFailure = run.storagePersistenceFailure
      ? {
          ...run.storagePersistenceFailure,
          recoveredAt: nowIso(now),
          disposition: "NANO_CLAIMED"
        }
      : null;

    run.nanoTelemetry ||= {};
    run.nanoTelemetry.lastRequestId = request.requestId;
    run.nanoTelemetry.lastMode = request.mode;
    run.nanoTelemetry.lastStatus = "RUNNING";
    run.nanoTelemetry.lastStartedAt = at;
    run.nanoTelemetry.initialInputDigest = request.initialInputDigest || request.inputDigest;
    run.nanoTelemetry.initialInputChars = Number(request.initialInputChars || request.inputChars || 0);
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
          : [],
        semanticCoverage: normalizeBaselineProjectionCoverage(
          payload.inputBudget.semanticCoverage
        ),
        responseRecoveryComplete: payload.inputBudget.responseRecoveryComplete === true
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
    const nextApplicationLog = appendApplicationEvent(applicationLog, {
      level: "info",
      event: "mission.nano.claim",
      message: "Nano-request claimad; request/init/observation snapshot är auditbundet.",
      windowId,
      tabId: run.targetTabId,
      runId: run.runId,
      correlationId: request.requestId,
      data: nanoEvidenceSnapshot(run, request, payload, continuity)
    }, { now });

    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    if (nextApplicationLog !== applicationLog) {
      await chrome.storage.local.set({ [STORAGE_KEYS.APPLICATION_LOG]: nextApplicationLog });
    }
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
      throw new Error("NANO_OWNER_INVALIDATED:NO_ACTIVE_ASSESSING_REQUEST");
    }
    if (
      request.requestId !== payload?.requestId ||
      !request.claimId ||
      !payload?.claimId ||
      request.claimId !== payload.claimId ||
      request.status !== "RUNNING"
    ) {
      throw new Error("NANO_OWNER_INVALIDATED:STALE_OR_MISCLAIMED_REQUEST");
    }
    const now = Date.now();
    const progressResult = updateNanoProgressState(request, {
      claimId: payload.claimId,
      outputChars: payload?.outputChars,
      chunkCount: payload?.chunkCount,
      inputDigest: requireNanoPromptDigest(
        payload?.inputDigest,
        "NANO_HEARTBEAT_INPUT_DIGEST_INVALID"
      ),
      inputChars: payload?.inputChars,
      leaseMs: NANO_CLAIM_LEASE_MS,
      now
    });
    if (!progressResult.ok) {
      throw new Error(`NANO_OWNER_INVALIDATED:${progressResult.reason}`);
    }
    Object.assign(request, progressResult.request);
    run.nanoTelemetry ||= {};
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
          : [],
        semanticCoverage: normalizeBaselineProjectionCoverage(
          payload.inputBudget.semanticCoverage
        ),
        responseRecoveryComplete: payload.inputBudget.responseRecoveryComplete === true
      };
      request.inputBudget = run.nanoTelemetry.lastInputBudget;
    }
    run.nanoTelemetry.lastInputDigest = request.inputDigest || "";
    run.nanoTelemetry.lastInputChars = Number(request.inputChars || 0);
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
    const { continuity, runtime, audit, applicationLog } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    let run = context.run;
    if ([STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION].includes(run?.state)) {
      // v0.11.13: stale Nano callbacks cannot cross an owner-bound human wait.
      return snapshotForWindow(windowId);
    }
    if (nanoTerminalDeliveryAlreadyFinalized(run, payload)) {
      return snapshotForWindow(windowId);
    }
    const request = run?.pendingNanoRequest;
    if (!run || run.state !== STATES.ASSESSING || !request) {
      throw new Error("Nano failure saknar aktiv request.");
    }
    if (request.requestId !== payload?.requestId) {
      throw new Error("Stale Nano failure request_id.");
    }
    const terminalInputDigest = requireNanoPromptDigest(
      payload?.inputDigest,
      "NANO_FAILURE_INPUT_DIGEST_INVALID"
    );
    if (terminalInputDigest !== request.inputDigest) {
      const error = new Error("NANO_FAILURE_INPUT_DIGEST_MISMATCH");
      error.code = "NANO_FAILURE_INPUT_DIGEST_MISMATCH";
      throw error;
    }
    if (payload?.forensics?.inputDigest &&
        sanitizeText(payload.forensics.inputDigest, 128).toLowerCase() !== terminalInputDigest) {
      const error = new Error("NANO_FAILURE_FORENSIC_INPUT_DIGEST_MISMATCH");
      error.code = "NANO_FAILURE_FORENSIC_INPUT_DIGEST_MISMATCH";
      throw error;
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
    run.nanoTelemetry.lastErrorCode = sanitizeText(request.errorCode, 160);
    run.nanoTelemetry.lastError = request.resultSummary;
    run.nanoTelemetry.lastResultSummary = request.resultSummary;
    run.runtimeDecisionStatus = "NANO_FAILED";
    run = finalizeNanoTerminalOwnership(run, context, {
      terminalRequest: request,
      source: NANO_DECISION_SOURCE.NANO,
      runtimeDecisionStatus: "NANO_FAILED",
      nanoTelemetryStatus: "FAILED",
      preserveObservation: true,
      event: "request-failed",
      windowId,
      now
    });

    // v0.11.0: promptNano has already exhausted its bounded fresh-session
    // attempts before NANO_FAILURE reaches Core. Fence the exact semantic
    // input so deterministic recovery cannot manufacture a new receipt and
    // immediately feed unchanged owner facts back into Nano.
    if (run.pendingObservation) {
      const materialStateDigest = await sha256Hex(materialDecisionInputKey({
        run,
        observation: run.pendingObservation
      }));
      run.nanoFailureFence = {
        schema: "eic.autonom.nano-failure-fence.v2",
        requestId: sanitizeText(request.requestId, 180),
        observationKey: observationMaterialKey(run.pendingObservation, run),
        materialStateDigest,
        inputDigest: terminalInputDigest,
        errorCode: sanitizeText(payload?.errorCode || request?.errorCode, 160),
        errorDetail: sanitizeText(payload?.errorDetail || request?.lastError, 800),
        resultSummary: sanitizeText(request?.resultSummary, 1200),
        taskAttempt: Math.max(0, Number(payload?.forensics?.taskAttempt || 0)),
        at: nowIso(now)
      };
      run.nanoFailureDiagnosticReceipt = null;
    }

    const forensicApplicationLog = appendApplicationEvent(applicationLog, {
      level: "error",
      event: "mission.nano.failure",
      message: "Nano-request misslyckades; bounded output, request, init, observation och continuity-evidens sparades.",
      windowId,
      tabId: run.targetTabId,
      runId: run.runId,
      correlationId: request.requestId,
      data: nanoEvidenceSnapshot(run, request, payload, continuity)
    }, { now });
    if (forensicApplicationLog !== applicationLog) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.APPLICATION_LOG]: forensicApplicationLog
      });
    }

    if (request.sessionContextBaselineAnalysis === true &&
        run.sessionContextInit?.state === SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING) {
      run = applySessionContextInitFailure(run, {
        windowId,
        audit,
        code: SESSION_CONTEXT_INIT_FAILURE_CODE.NANO_ANALYSIS_FAILED,
        detail: `Nano kunde inte validera huvuduppgiftsbaslinjen efter bounded fresh-session retry: ${request.resultSummary}`,
        now
      });
      run.nanoTelemetry.lastStatus = "FAILED";
      run.nanoTelemetry.lastError = request.resultSummary;
      run.nanoTelemetry.lastResultSummary = request.resultSummary;
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      if (forensicApplicationLog !== applicationLog) {
        await chrome.storage.local.set({
          [STORAGE_KEYS.APPLICATION_LOG]: forensicApplicationLog
        });
      }
      await setTabIndicator(
        run.targetTabId,
        "BLOCKED",
        "Nano kunde inte validera huvuduppgiftsbaslinjen",
        sessionContextInitOverlay(run.sessionContextInit)
      );
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

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
    const tabId = nullableInteger(context.selectedTabId);
    if (tabId === null) {
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
    if (nullableInteger(target?.tabId) === null) throw new Error("WEB_TARGET_REQUIRED");
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
    if (nullableInteger(target?.tabId) === null) throw new Error("WEB_TARGET_REQUIRED");
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
    if (nullableInteger(target?.tabId) === null) throw new Error("WEB_TARGET_REQUIRED");
    const permission = await containsExactOriginPermission(chrome, target.url);
    if (!permission.granted) {
      applyWebTargetCapabilityState(context, {
        permissionState: WEB_PERMISSION_STATES.NOT_REQUESTED,
        permissionOriginPattern: permission.pattern,
        reason: "CDP_ATTACH_PERMISSION_MISSING"
      });
      throw new Error("CDP_EXACT_ORIGIN_PERMISSION_REQUIRED");
    }
    const liveKey = cdpLiveKey(windowId);
    const existing = liveCdpSessions.get(liveKey);
    if (existing?.state === CDP_SESSION_STATES.ATTACHED) {
      if (cdpSessionMatchesSurface(existing, target)) {
        // A prior attach may have succeeded while its durable commit failed.
        // Reconcile the existing live CDP owner back into persisted state before
        // returning success; never treat the live Map alone as durable truth.
        context.browserSession = existing;
        applyWebTargetCapabilityState(context, {
          permissionState: WEB_PERMISSION_STATES.GRANTED,
          permissionOriginPattern: permission.pattern,
          debuggerState: CDP_SESSION_STATES.ATTACHED,
          debuggerSessionId: existing.sessionId,
          reason: "CDP_ATTACH_LIVE_RECONCILED"
        });
        await writeRuntimeBundle(runtime, continuity, audit, windowId);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
      await detachBrowserSessionForContext(context, {
        reason: "TARGET_IDENTITY_CHANGED_BEFORE_ATTACH"
      });
    }
    const session = await attachBoundedCdp(chrome, {
      profile,
      surface: target,
      permissionGranted: true
    });
    liveCdpSessions.set(liveKey, session);
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
    try {
      await writeRuntimeBundle(runtime, continuity, audit, windowId);
    } catch (persistError) {
      let compensationError = null;
      try {
        await detachBoundedCdp(chrome, session, {
          reason: "ATTACH_DURABLE_COMMIT_FAILED",
          tolerateMissing: true
        });
        liveCdpSessions.delete(liveKey);
      } catch (error) {
        compensationError = error;
      }
      if (compensationError) {
        throw new Error(
          `CDP_ATTACH_PERSIST_FAILED_COMPENSATION_FAILED: ${String(persistError?.message || persistError)} · ` +
          `${String(compensationError?.message || compensationError)}`
        );
      }
      throw new Error(`CDP_ATTACH_PERSIST_FAILED_DETACHED: ${String(persistError?.message || persistError)}`);
    }
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
  if (nullableInteger(target?.tabId) === null) throw new Error("EVIDENCE_WEB_TARGET_REQUIRED");
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
    if (nullableInteger(controller?.tabId) === null ||
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

async function saveConfigUnlocked(patch) {
  await ensureInitialized();
  const current = (await chrome.storage.local.get(STORAGE_KEYS.CONFIG))[STORAGE_KEYS.CONFIG] || createDefaultConfig();
  let mandateRegistry = current.mandateRegistry;
  mandateRegistry = (await registerMandateVersion(mandateRegistry, {
    surface: "NANO",
    version: current.nanoMandateVersion || "nano-core-v11",
    text: current.nanoMandate || ""
  })).registry;
  mandateRegistry = (await registerMandateVersion(mandateRegistry, {
    surface: "TARGET",
    version: current.targetMandateVersion || "target-core-v9",
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
    version: current.nanoMandateVersion || "nano-core-v11",
    text: current.nanoMandate || ""
  })).registry;
  mandateRegistry = (await registerMandateVersion(mandateRegistry, {
    surface: "TARGET",
    version: current.targetMandateVersion || "target-core-v9",
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

// v0.11.0 single-writer contract: runtime-relevant configuration commits
// share the same serialized owner lane as run/effect mutations.  Callers
// already inside enqueue() use saveConfigUnlocked() to avoid self-deadlock.
async function saveConfig(patch) {
  return enqueue(() => saveConfigUnlocked(patch));
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
    // v0.11.19: every mission start owns a fresh session-init baseline. Same-chat
    // investigative work may preserve intent/work-unit continuity, but a prior
    // baseline may never satisfy the new needKey implicitly.
    continuity.mainTaskBaseline = null;
    continuity.trackControl = {
      ...createEmptyMainTaskTrack(),
      status: "BASELINE_REQUESTED",
      baselinePresent: false,
      updatedAt: nowIso()
    };
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
    sourceObservationIdentity: "",
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
    if ([STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION].includes(run?.state)) {
      // v0.11.13 owner-bound invariant: delayed callbacks prepared before a
      // human boundary must never submit after the boundary is active.
      return snapshotForWindow(windowId);
    }
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

    const preparedObservation = effect.sourceObservationHash
      ? classifyPreparedEffectObservation(effect, page)
      : null;

    if (preparedObservation?.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.SUPERSEDED) {
      effect.status = "CANCELLED_SUPERSEDED";
      effect.supersededReason = preparedObservation.reason;
      delete effect.prompt;
      const exactParentSnapshot = effect.parentTurnSnapshot?.turnId
        ? deepClone(effect.parentTurnSnapshot)
        : null;
      const priorTurnId = run.currentTurn?.priorTurnId || null;
      const priorResponseContract = run.currentTurn?.priorResponseContract || START_RESPONSE_CONTRACTS.TURN_BOUND_5;
      run.currentTurn = exactParentSnapshot
        ? {
            ...exactParentSnapshot,
            effectState: "ACKED",
            kind: exactParentSnapshot.kind || "RESTORED_AFTER_SUPERSEDE"
          }
        : priorTurnId
          ? {
              turnId: priorTurnId,
              priorTurnId: null,
              effectState: "ACKED",
              kind: "RESTORED_AFTER_SUPERSEDE",
              responseContract: priorResponseContract,
              responseExpectedTurnId: run.currentTurn?.priorResponseExpectedTurnId || priorTurnId
            }
          : null;
      if (effect.protocolRepairSideBand && run.protocolRepairReceipt?.effectId === effect.effectId) {
        run.protocolRepairReceipt.status = "CANCELLED_SUPERSEDED";
        run.protocolRepairReceipt.cancelledAt = nowIso();
        run.protocolRepairReceipt.cancelReason = preparedObservation.reason;
      }
      if (effect.chatControlSideBand && run.chatControlContinuationReceipt?.effectId === effect.effectId) {
        run.chatControlContinuationReceipt.status = "CANCELLED_SUPERSEDED";
        run.chatControlContinuationReceipt.cancelledAt = nowIso();
        run.chatControlContinuationReceipt.cancelReason = preparedObservation.reason;
        run.runtimeDecisionStatus = "CHAT_CONTROL_SUPERSEDED";
      }
      run = retireResponseCandidate(run, {
        status: RESPONSE_OBSERVATION_CYCLE_STATUS.SUPERSEDED,
        reason: "PREPARED_EFFECT_SUPERSEDED_BY_NEW_TARGET_RESPONSE",
        now: Date.now()
      });
      run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
        origin: PAUSE_ORIGINS.OBSERVATION_SUPERSEDED,
        reason: "Target-svarets owner-identitet ändrades efter beslut men före promptsubmit. Den förberedda prompten kasserades.",
        force: true
      });
      context.run = run;
      addAudit(audit, {
        kind: "warning",
        title: "Förberedd prompt kasserad efter verklig owner-supersession",
        detail: `${preparedObservation.reason} · hash ${preparedObservation.sourceHash || "(none)"} → ${preparedObservation.currentHash || "(unreadable)"} · epoch ${preparedObservation.sourceEpoch || "(none)"} → ${preparedObservation.currentEpoch || "(unreadable)"}`,
        windowId, tabId, runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      setTimeout(() => tickWindow(windowId, "observation-superseded-before-submit").catch(console.warn), 0);
      return snapshotForWindow(windowId);
    }

    // v0.12.13: a regressed turn readback keeps the prepared effect for the same
    // reason an unreadable owner does. The page is showing an older turn than the
    // one this effect was prepared from, so it carries no information about a new
    // owner; discarding here is what killed the protocol repair mid-incident.
    if (preparedObservation?.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.OWNER_IDENTITY_UNREADABLE ||
        preparedObservation?.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.OWNER_READBACK_REGRESSED) {
      const readbackRegressed =
        preparedObservation.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.OWNER_READBACK_REGRESSED;
      effect.ownerReadbackStatus = readbackRegressed ? "REGRESSED" : "UNREADABLE";
      effect.ownerReadbackReason = preparedObservation.reason;
      effect.ownerReadbackAt = nowIso();
      effect.preSubmitWaitStartedAt ||= effect.ownerReadbackAt;
      effect.preSubmitWaitLastObservedAt = effect.ownerReadbackAt;
      run.responseDeadlineAt = null;
      run.timeoutSuspended = true;
      run.recovery.nextRecoveryAt = new Date(Date.now() + 30_000).toISOString();
      run = transitionRun(run, STATES.RECOVERING, {
        origin: PAUSE_ORIGINS.TRANSIENT_TRANSPORT,
        reason: "Förberedd prompt behålls tills samma response-owner kan verifieras före submit.",
        force: true
      });
      context.run = run;
      addAudit(audit, {
        kind: "warning",
        title: readbackRegressed
          ? "Promptsubmit väntar på att target-DOM slutar visa ett äldre turn"
          : "Promptsubmit väntar på verifierbar response-owner",
        detail: readbackRegressed
          ? `${preparedObservation.reason} · turnSeq ${preparedObservation.sourceTurnSeq} → ${preparedObservation.currentTurnSeq} · prepared effect ${effect.effectId}`
          : `${preparedObservation.reason} · prepared effect ${effect.effectId}`,
        windowId, tabId, runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(
        tabId,
        "WAITING",
        readbackRegressed
          ? "Target-DOM visar ett äldre turn; väntar på aktuell response-owner"
          : "Verifierar samma response-owner före promptsubmit"
      );
      await notifyPanels(windowId);
      const ownerWaitStartedAt = Date.parse(effect.preSubmitWaitStartedAt || "");
      const ownerWaitAgeMs = Number.isFinite(ownerWaitStartedAt)
        ? Math.max(0, Date.now() - ownerWaitStartedAt)
        : 0;
      if (ownerWaitAgeMs < PREPARED_EFFECT_FAST_RECHECK_WINDOW_MS) {
        setTimeout(
          () => tickWindow(windowId, "prepared-effect-owner-readback").catch(console.warn),
          PREPARED_EFFECT_FAST_RECHECK_MS
        );
      }
      return snapshotForWindow(windowId);
    }

    const alreadyVisible = pageContainsEffect(page, effect);
    if (alreadyVisible) {
      effect.status = "ACKED";
      effect.confirmedAt = nowIso();
      run.currentTurn.effectState = "ACKED";
      if (effect.protocolRepairSideBand && run.protocolRepairReceipt?.effectId === effect.effectId) {
        run.protocolRepairReceipt.status = "ACKED";
        run.protocolRepairReceipt.confirmedAt = effect.confirmedAt;
      }
      if (effect.chatControlSideBand && run.chatControlContinuationReceipt?.effectId === effect.effectId) {
        run.chatControlContinuationReceipt.status = "ACKED";
        run.chatControlContinuationReceipt.confirmedAt = effect.confirmedAt;
        run.runtimeDecisionStatus = "CHAT_CONTROL_WAITING_RESPONSE";
        run.timeoutSuspended = false;
        run.waitingObservation = null;
      }
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
      effect.ownerReadbackStatus = "SAME_OWNER_BUSY";
      effect.ownerReadbackReason = preparedObservation?.reason ||
        (backgroundActive ? "TARGET_BACKGROUND_ACTIVE" : "TARGET_FOREGROUND_GENERATING");
      effect.ownerReadbackAt = nowIso();
      effect.preSubmitWaitStartedAt ||= effect.ownerReadbackAt;
      effect.preSubmitWaitLastObservedAt = effect.ownerReadbackAt;
      run.responseDeadlineAt = null;
      run.timeoutSuspended = true;
      run = transitionRun(
        run,
        backgroundActive ? STATES.WAITING_BACKGROUND : STATES.WAITING_FOREGROUND,
        {
          origin: PAUSE_ORIGINS.NONE,
          reason: backgroundActive
            ? "Samma response-owner arbetar i bakgrunden. Den förberedda prompten behålls och skickas först när målfliken är stabil."
            : "Samma response-owner genererar tillfälligt. Den förberedda prompten behålls och skickas först när målfliken är stabil.",
          force: true
        }
      );
      run.recovery.nextRecoveryAt = new Date(Date.now() + 30_000).toISOString();
      context.run = run;
      addAudit(audit, {
        kind: "info",
        title: "Förberedd prompt väntar på stabilt target",
        detail: `${effect.ownerReadbackReason} · sameHash=${preparedObservation ? String(!preparedObservation.hashChanged) : "n/a"} · sameEpoch=${preparedObservation ? String(!preparedObservation.epochChanged) : "n/a"} · effect=${effect.effectId}`,
        windowId,
        tabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(
        tabId,
        backgroundActive ? "BACKGROUND" : "WAITING",
        backgroundActive
          ? "Förberedd prompt väntar på bakgrundsarbetets slut"
          : "Förberedd prompt väntar på stabil foreground"
      );
      await notifyPanels(windowId);
      // Fast one-shot recheck catches the transient-generating edge observed in
      // v0.12.11; the 30 s watchdog remains the durable fallback if Chrome
      // suspends the service worker before this timer fires.
      setTimeout(() => tickWindow(windowId, "prepared-effect-target-busy-recheck").catch(console.warn), PREPARED_EFFECT_FAST_RECHECK_MS);
      return snapshotForWindow(windowId);
    }

    if (effect.ownerReadbackStatus) {
      effect.ownerReadbackStatus = "STABLE_SAME_OWNER";
      effect.ownerReadbackReason = preparedObservation?.reason || "TARGET_STABLE";
      effect.ownerReadbackAt = nowIso();
      effect.preSubmitWaitLastObservedAt = effect.ownerReadbackAt;
    }

    const sessionInitPromptIntegrity = await validateSessionInitEffectIntegrity(effect);
    if (!sessionInitPromptIntegrity.valid) {
      const failure = {
        schema: "eic.autonom.session-init-prompt-integrity-failure.v1",
        effectId: sanitizeText(effect.effectId, 180),
        turnId: sanitizeText(effect.turnId, 180),
        failureCode: SESSION_INIT_PROMPT_MUTATED,
        expectedDigest: sanitizeText(sessionInitPromptIntegrity.expectedDigest, 128),
        recomputedDigest: sanitizeText(sessionInitPromptIntegrity.recomputedDigest, 128),
        expectedPromptDigest: sanitizeText(sessionInitPromptIntegrity.expectedPromptDigest, 128),
        recomputedPromptDigest: sanitizeText(sessionInitPromptIntegrity.recomputedPromptDigest, 128),
        detectedAt: nowIso(),
        stage: "FINAL_SEND"
      };
      effect.status = "SESSION_INIT_PROMPT_INTEGRITY_FAILED";
      effect.lastError = failure.failureCode;
      run.currentTurn.effectState = "SESSION_INIT_PROMPT_INTEGRITY_FAILED";
      run.responseDeadlineAt = null;
      run.timeoutSuspended = true;
      run = applySessionInitPromptIntegrityFailure(run, {
        windowId,
        audit,
        failure,
        detail: `Protected session-init prompt failed final outbound integrity check; effect ${failure.effectId}.`
      });
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(tabId, "BLOCKED", SESSION_INIT_PROMPT_MUTATED);
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

    const payloadIntegrity = await validateEffectPayloadIntegrity(effect);
    if (!payloadIntegrity.valid) {
      const detectedStatus = sanitizeText(effect.status, 80);
      const failure = {
        schema: "eic.autonom.effect-payload-integrity.v1",
        effectId: sanitizeText(effect.effectId, 180),
        turnId: sanitizeText(effect.turnId, 180),
        actionKey: sanitizeText(effect.actionKey, 512),
        expectedPromptDigest: sanitizeText(payloadIntegrity.expectedDigest, 128),
        recomputedPromptDigest: sanitizeText(payloadIntegrity.recomputedDigest, 128),
        failureCode: sanitizeText(payloadIntegrity.code, 120),
        effectStatusAtDetection: detectedStatus,
        attemptsConsumed: Math.max(0, Number(effect.attempts || 0)),
        detectedAt: nowIso(),
        automaticRetryEligible: false,
        automaticRetryLimit: 0,
        nextOwner: "OPERATOR_OR_NEW_OWNER_OBSERVATION",
        exitCondition: "RESTORE_EXACT_HASH_MATCHING_PAYLOAD_OR_SUPERSEDE_EFFECT"
      };
      effect.status = "PAYLOAD_INTEGRITY_FAILED";
      effect.lastError = failure.failureCode;
      run.currentTurn.effectState = "PAYLOAD_INTEGRITY_FAILED";
      run.effectPayloadIntegrityFailure = failure;
      run.effectPayloadIntegrityContradiction = null;
      run.responseDeadlineAt = null;
      run.timeoutSuspended = true;
      run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
        origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
        reason: `${failure.failureCode}: aktiv effektpayload kan inte verifieras. Ingen prompt skickas och ingen automatisk retry förbrukas.`,
        force: true
      });
      context.run = run;
      addAudit(audit, {
        kind: "error",
        title: "Promptpayload stoppad av integritetsgrind",
        detail: [
          failure.failureCode,
          `effectId=${failure.effectId}`,
          `turnId=${failure.turnId}`,
          `expected=${failure.expectedPromptDigest || "(missing)"}`,
          `recomputed=${failure.recomputedPromptDigest || "(unavailable)"}`,
          `attempts=${failure.attemptsConsumed}`
        ].join(" · "),
        windowId,
        tabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await persistApplicationEventOnce({
        level: "error",
        event: "mission.effect.payload-integrity-failed",
        correlationId: failure.effectId,
        message: "Aktiv effektpayload avvisades före submission.",
        windowId,
        tabId,
        runId: run.runId,
        data: failure
      });
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
    if (effect.protocolRepairSideBand && run.protocolRepairReceipt?.effectId === effect.effectId) {
      run.protocolRepairReceipt.status = effect.status;
      run.protocolRepairReceipt.submittedAt = effect.submittedAt;
      run.protocolRepairReceipt.confirmedAt = effect.confirmedAt;
    }
    if (effect.chatControlSideBand && run.chatControlContinuationReceipt?.effectId === effect.effectId) {
      run.chatControlContinuationReceipt.status = effect.status;
      run.chatControlContinuationReceipt.submittedAt = effect.submittedAt;
      run.chatControlContinuationReceipt.confirmedAt = effect.confirmedAt;
      run.runtimeDecisionStatus = result.acknowledged
        ? "CHAT_CONTROL_WAITING_RESPONSE"
        : "CHAT_CONTROL_SUBMITTED_UNCONFIRMED";
      run.timeoutSuspended = false;
      run.waitingObservation = null;
    }
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
      microActionId: effect.microActionId || "",
      executionDisposition: effect.executionDisposition || "",
      executionFamilyKey: effect.executionFamilyKey || "",
      turnKind: effect.turnKind || run.currentTurn?.kind || "",
      protocolRepairSideBand: effect.protocolRepairSideBand
        ? deepClone(effect.protocolRepairSideBand)
        : null,
      chatControlSideBand: effect.chatControlSideBand
        ? deepClone(effect.chatControlSideBand)
        : null,
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

function activeEffectPayloadIntegrityBlock(run) {
  const failure = run?.effectPayloadIntegrityFailure || null;
  const currentTurn = run?.currentTurn || null;
  const effect = latestEffect(run);
  const effectFailed = String(effect?.status || "") === "PAYLOAD_INTEGRITY_FAILED";
  const turnFailed = String(currentTurn?.effectState || "") === "PAYLOAD_INTEGRITY_FAILED";

  // A receipt from an older generation is historical evidence, not an active gate.
  if (!effectFailed && !turnFailed) {
    return { active: false, contradictory: false, staleFailure: Boolean(failure), effect, failure };
  }

  if (!failure || !effect || !currentTurn) {
    return {
      active: false,
      contradictory: true,
      code: "EFFECT_PAYLOAD_INTEGRITY_STATE_CONTRADICTORY",
      reason: "Aktiv PAYLOAD_INTEGRITY_FAILED saknar komplett effect/currentTurn/failure-identitet.",
      effect,
      failure
    };
  }

  const sameEffect = String(failure.effectId || "") === String(effect.effectId || "");
  const sameTurn =
    String(failure.turnId || "") === String(currentTurn.turnId || "") &&
    String(effect.turnId || "") === String(currentTurn.turnId || "");
  const sameAction =
    String(effect.actionKey || "") === String(currentTurn.actionKey || "") &&
    (!failure.actionKey || String(failure.actionKey) === String(effect.actionKey || ""));
  const sameDigest =
    String(failure.expectedPromptDigest || "") === String(effect.promptDigest || "") &&
    String(effect.promptDigest || "") === String(currentTurn.promptDigest || "");
  const bothFailed = effectFailed && turnFailed;

  if (!sameEffect || !sameTurn || !sameAction || !sameDigest || !bothFailed) {
    return {
      active: false,
      contradictory: true,
      code: "EFFECT_PAYLOAD_INTEGRITY_STATE_CONTRADICTORY",
      reason: [
        `effectId=${sameEffect ? "MATCH" : "MISMATCH"}`,
        `turnId=${sameTurn ? "MATCH" : "MISMATCH"}`,
        `actionKey=${sameAction ? "MATCH" : "MISMATCH"}`,
        `promptDigest=${sameDigest ? "MATCH" : "MISMATCH"}`,
        `status=${bothFailed ? "MATCH" : "MISMATCH"}`
      ].join(" · "),
      effect,
      failure
    };
  }

  return { active: true, contradictory: false, staleFailure: false, effect, failure };
}

function effectObservationSuperseded(effect, page) {
  return Boolean(effect?.sourceObservationHash && (
    page?.generating ||
    String(page?.latestAssistantHash || "") !== String(effect.sourceObservationHash || "") ||
    (effect.sourceObservationEpoch &&
      String(page?.documentEpoch || "") !== String(effect.sourceObservationEpoch || ""))
  ));
}

function classifyPayloadIntegrityOwnerObservation(effect, page) {
  const sourceHash = sanitizeText(effect?.sourceObservationHash, 128);
  const sourceEpoch = sanitizeText(effect?.sourceObservationEpoch, 180);
  const latestHash = sanitizeText(page?.latestAssistantHash, 128);
  const documentEpoch = sanitizeText(page?.documentEpoch, 180);
  const streaming = page?.generating === true ||
    page?.streamingAssistant === true ||
    page?.foregroundSignals?.streamingAssistant === true;

  if (streaming) {
    return {
      classification: "INDETERMINATE",
      code: "PAYLOAD_OWNER_OBSERVATION_STREAMING",
      reason: "Owner-observationen genereras fortfarande och kan inte användas som supersession-evidens."
    };
  }
  if (!sourceHash) {
    return {
      classification: "INDETERMINATE",
      code: "PAYLOAD_SOURCE_OBSERVATION_IDENTITY_MISSING",
      reason: "Den blockerade effekten saknar sourceObservationHash; SAME eller NEW kan inte etableras."
    };
  }
  if (!isAssistantResponseCandidate(page) || !latestHash) {
    return {
      classification: "INDETERMINATE",
      code: "PAYLOAD_OWNER_OBSERVATION_NOT_STABLE",
      reason: "Ingen komplett stabil assistant-owner-identitet finns ännu."
    };
  }
  if (sourceEpoch && !documentEpoch) {
    return {
      classification: "INDETERMINATE",
      code: "PAYLOAD_OWNER_OBSERVATION_EPOCH_UNAVAILABLE",
      reason: "Source-observationen är epoch-bunden men owner-read saknar documentEpoch."
    };
  }
  if (latestHash === sourceHash) {
    if (sourceEpoch && documentEpoch !== sourceEpoch) {
      return {
        classification: "CONTRADICTORY",
        code: "EFFECT_PAYLOAD_OWNER_OBSERVATION_CONTRADICTORY",
        reason: "Assistant-hashen är oförändrad men documentEpoch motsäger den payload-blockerade source-observationen."
      };
    }
    return {
      classification: "SAME_OBSERVATION",
      code: "PAYLOAD_OWNER_OBSERVATION_SAME",
      reason: "Stabil owner-observation matchar den payload-blockerade source-observationen."
    };
  }
  return {
    classification: "NEW_OWNER_OBSERVATION",
    code: "PAYLOAD_OWNER_OBSERVATION_NEW",
    reason: "En komplett stabil assistant-owner-observation har en ny hashidentitet."
  };
}

function payloadIntegrityOwnerObservationContradictionRecord(classification, effect, page, now = Date.now()) {
  return {
    schema: "eic.autonom.effect-payload-owner-observation-contradiction.v1",
    code: sanitizeText(classification?.code || "EFFECT_PAYLOAD_OWNER_OBSERVATION_CONTRADICTORY", 120),
    classification: "CONTRADICTORY",
    effectId: sanitizeText(effect?.effectId, 180),
    turnId: sanitizeText(effect?.turnId, 180),
    sourceObservationHash: sanitizeText(effect?.sourceObservationHash, 128),
    observedAssistantHash: sanitizeText(page?.latestAssistantHash, 128),
    sourceObservationEpoch: sanitizeText(effect?.sourceObservationEpoch, 180),
    observedDocumentEpoch: sanitizeText(page?.documentEpoch, 180),
    generating: page?.generating === true,
    streamingAssistant: page?.streamingAssistant === true ||
      page?.foregroundSignals?.streamingAssistant === true,
    reason: sanitizeText(classification?.reason, 800),
    detectedAt: nowIso(now)
  };
}

function payloadIntegrityContradictionRecord(block, now = Date.now()) {
  return {
    schema: "eic.autonom.effect-payload-integrity-contradiction.v1",
    code: sanitizeText(block?.code || "EFFECT_PAYLOAD_INTEGRITY_STATE_CONTRADICTORY", 120),
    effectId: sanitizeText(block?.effect?.effectId || block?.failure?.effectId, 180),
    activeTurnId: sanitizeText(block?.effect?.turnId, 180),
    failureTurnId: sanitizeText(block?.failure?.turnId, 180),
    expectedPromptDigest: sanitizeText(block?.failure?.expectedPromptDigest, 128),
    effectPromptDigest: sanitizeText(block?.effect?.promptDigest, 128),
    reason: sanitizeText(block?.reason, 800),
    detectedAt: nowIso(now)
  };
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
    if (effect.protocolRepairSideBand && run.protocolRepairReceipt?.effectId === effect.effectId) {
      run.protocolRepairReceipt.status = "ACKED";
      run.protocolRepairReceipt.confirmedAt = effect.confirmedAt;
    }
    if (effect.chatControlSideBand && run.chatControlContinuationReceipt?.effectId === effect.effectId) {
      run.chatControlContinuationReceipt.status = "ACKED";
      run.chatControlContinuationReceipt.confirmedAt = effect.confirmedAt;
      run.runtimeDecisionStatus = "CHAT_CONTROL_WAITING_RESPONSE";
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


function sessionContextCommitRecoveryLimit(config = {}) {
  const configured = Math.floor(Number(config?.recoveryBudget) || 9);
  return Math.max(1, Math.min(20, configured));
}

function sessionContextCommitRecoveryPhase(receipt) {
  return receipt?.commitStatus === SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED
    ? "READY"
    : "COMMIT";
}

function sessionContextCommitRecoveryAttemptCount(receipt) {
  return sessionContextCommitRecoveryPhase(receipt) === "READY"
    ? Math.max(0, Number(receipt?.readyAttemptCount || 0))
    : Math.max(0, Number(receipt?.commitAttemptCount || 0));
}

async function exhaustSessionContextCommitRecovery({
  windowId,
  config,
  runtime,
  continuity,
  audit,
  context,
  run,
  receipt,
  now = Date.now()
} = {}) {
  const phase = sessionContextCommitRecoveryPhase(receipt);
  const attempts = sessionContextCommitRecoveryAttemptCount(receipt);
  const limit = sessionContextCommitRecoveryLimit(config);
  const exhaustedCode = phase === "READY"
    ? "SESSION_CONTEXT_READY_COMMIT_RETRY_EXHAUSTED"
    : "SESSION_CONTEXT_BASELINE_COMMIT_RETRY_EXHAUSTED";
  const exhaustedDetail =
    `${exhaustedCode}: ${attempts}/${limit} owner-readback attempts consumed; ` +
    "semantic Nano work is preserved and automatic retry is paused pending operator resume.";

  const nextReceipt = {
    ...deepClone(receipt),
    retryEligible: false,
    nanoRerunRequired: false,
    updatedAt: nowIso(now)
  };
  if (phase === "READY") {
    nextReceipt.readyStatus = SESSION_CONTEXT_READY_FINALIZATION_STATUS.FAILED;
    nextReceipt.readyLastErrorCode = exhaustedCode;
    nextReceipt.readyLastErrorDetail = exhaustedDetail;
  } else {
    nextReceipt.commitStatus = SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMIT_FAILED;
    nextReceipt.lastCommitErrorCode = exhaustedCode;
    nextReceipt.lastCommitErrorDetail = exhaustedDetail;
  }

  run.sessionContextInit = {
    ...run.sessionContextInit,
    state: SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING,
    completedAt: null,
    baselineDecisionCommit: nextReceipt,
    updatedAt: nowIso(now)
  };
  run.runtimeDecisionStatus = "NANO_DECISION_COMMIT_RETRY_EXHAUSTED";
  run = transitionRun(run, STATES.SOFT_PAUSED, {
    origin: PAUSE_ORIGINS.TRANSIENT_TRANSPORT,
    reason: exhaustedDetail,
    force: true
  });
  context.run = run;

  addAudit(audit, {
    kind: "blocked",
    title: phase === "READY"
      ? "READY-finalisering pausad efter bounded retry exhaustion"
      : "Nano-baselinecommit pausad efter bounded retry exhaustion",
    detail: exhaustedDetail,
    windowId,
    tabId: run.targetTabId,
    runId: run.runId
  });
  await writeRuntimeBundle(runtime, continuity, audit, windowId);
  await persistApplicationEventOnce({
    level: "error",
    event: phase === "READY"
      ? "session-context-init.ready-retry-exhausted"
      : "session-context-baseline.commit-retry-exhausted",
    correlationId: `${sanitizeText(nextReceipt.requestId, 180)}:${phase.toLowerCase()}:retry-exhausted`,
    message: exhaustedDetail,
    windowId,
    tabId: run.targetTabId,
    runId: run.runId,
    data: {
      requestId: nextReceipt.requestId,
      claimId: nextReceipt.claimId,
      phase,
      attempts,
      limit,
      retryEligible: false,
      nanoRerunRequired: false,
      semanticDecisionSucceeded: true
    },
    now
  });
  await notifyPanels(windowId);
  return snapshotForWindow(windowId);
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

  if ([STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION].includes(run.state)) {
    // v0.11.13: human owner boundaries dominate every watchdog/reload/recovery
    // branch. Owner-specific receipt handlers are the only normal resume path.
    return snapshotForWindow(windowId);
  }

  // Step 2 commit-specific recovery runs before generic PROGRAM_BLOCKED recovery.
  // The persisted semantic receipt owns the retry payload, so no Nano claim,
  // promptNano invocation or inference is repeated after a valid ACCEPT.
  const baselineCommitReceipt = run.sessionContextInit?.baselineDecisionCommit || null;

  // READY success evidence is a post-commit delivery concern. Retry it from the
  // durable READY receipt without reopening the Nano claim or READY transaction.
  if (sessionContextReadySuccessEvidencePending(run)) {
    await persistSessionContextReadySuccessEvidence({
      windowId,
      runtime,
      audit,
      continuity,
      context,
      run,
      receipt: baselineCommitReceipt,
      now: Date.now()
    });
    return snapshotForWindow(windowId);
  }

  if (sessionContextBaselineCommitNeedsRecovery(baselineCommitReceipt)) {
    if (baselineCommitReceipt?.retryEligible === false) {
      return snapshotForWindow(windowId);
    }
    const recoveryAttemptCount = sessionContextCommitRecoveryAttemptCount(baselineCommitReceipt);
    const recoveryLimit = sessionContextCommitRecoveryLimit(config);
    if (recoveryAttemptCount >= recoveryLimit) {
      return exhaustSessionContextCommitRecovery({
        windowId,
        config,
        runtime,
        continuity,
        audit,
        context,
        run,
        receipt: baselineCommitReceipt,
        now: Date.now()
      });
    }
    const replayPayload = baselineCommitReplayPayload(run);
    if (replayPayload) {
      return applyNanoDecisionCommandUnlocked(windowId, replayPayload);
    }
  }

  let payloadIntegrityBlock = activeEffectPayloadIntegrityBlock(run);
  if (payloadIntegrityBlock.contradictory) {
    run.effectPayloadIntegrityContradiction = payloadIntegrityContradictionRecord(payloadIntegrityBlock);
    run.responseDeadlineAt = null;
    run.timeoutSuspended = true;
    run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
      origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
      reason: `${payloadIntegrityBlock.code}: ${payloadIntegrityBlock.reason}`,
      force: true
    });
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    return snapshotForWindow(windowId);
  }
  if (payloadIntegrityBlock.active && run.state !== STATES.PROGRAM_BLOCKED) {
    run.responseDeadlineAt = null;
    run.timeoutSuspended = true;
    run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
      origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
      reason: "UNRESOLVED_EFFECT_PAYLOAD_INTEGRITY_BLOCK: aktiv effekt saknar verifierad payloadidentitet.",
      force: true
    });
  }
  if ([STATES.PROGRAM_BLOCKED, STATES.AWAITING_OPERATOR_DECISION].includes(run.state)) {
    if (payloadIntegrityBlock.active) {
      // The target must still be read below so exact restoration or a genuine
      // owner supersession can unlock the block. Readability alone is not enough.
    } else {
      if (pauseRequiresHuman(run)) return snapshotForWindow(windowId);
      if (!causalRecoveryBlocked(run)) {
        run = transitionRun(run, STATES.RECOVERING, {
          origin: run.pause?.origin || PAUSE_ORIGINS.NONE,
          reason: "v0.12.0 omklassificerade en icke-ownerbunden paus till autonom återhämtning.",
          force: true
        });
      }
    }
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
    payloadIntegrityBlock = activeEffectPayloadIntegrityBlock(run);
    if (payloadIntegrityBlock.active) {
      context.run = run;
      return snapshotForWindow(windowId);
    }
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
    payloadIntegrityBlock = activeEffectPayloadIntegrityBlock(run);
    if (payloadIntegrityBlock.active) {
      context.run = run;
      return snapshotForWindow(windowId);
    }
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

  run = ensureCausalControl(run, { now });

  // v0.12.0 causal preflight: keep transport/effect truth separate from
  // response ownership. A later human/material user event invalidates any stale
  // ACKED control response claim before assistant parsing can occur.
  //
  // v0.12.14 restructure. v0.12.13 nested every strand decision inside
  // `if (causalLegacyEffect?.effectId)`, so the only path that cleared
  // `run.causalOwnershipStrand` was its healthy branch. When a turn finished
  // and `latestEffect(run)` went null, the whole block was skipped, the strand
  // survived untouched, and the escalation below — which ran unconditionally —
  // kept ageing it toward a deadline nothing could still repair. Classification
  // is therefore computed first and clearing is unconditional.
  const causalLegacyEffect = latestEffect(run);
  const preflightOwnership = causalLegacyEffect?.effectId
    ? classifyCausalOwnership(run, causalLegacyEffect)
    : null;
  const preflightPageState = classifyChatGptPage(page)?.state || "";
  const causalProducer = classifyCausalOwnershipProducer(run, {
    legacyEffect: causalLegacyEffect,
    pageGenerating: [
      CHATGPT_RESPONSE_STATES.GENERATING_FOREGROUND,
      CHATGPT_RESPONSE_STATES.WAITING_BACKGROUND
    ].includes(preflightPageState)
  });
  // The failure this strand reports is literally NO_PRODUCER, so a producer
  // being active is dispositive. At 15:08:16.844 v0.12.13 opened a strand in
  // the same millisecond NANO_CLAIM took ownership of this exact turn; Nano
  // then ran for 49 s and returned ACCEPT into a run the strand had killed.
  const causalOwnerStranded = Boolean(preflightOwnership?.desynced) && !causalProducer.active;

  if (causalOwnerStranded) {
    const priorStrand = run.causalOwnershipStrand || null;
    run.causalOwnershipStrand = openCausalOwnershipStrand(priorStrand, preflightOwnership, {
      now,
      turnId: causalLegacyEffect.turnId || run.currentTurn?.turnId || "",
      responseHash: page?.latestAssistantHash || ""
    });
    if (!priorStrand || priorStrand.effectId !== preflightOwnership.effectId) {
      addAudit(audit, {
        kind: "warning",
        title: "Kausalt ägarskap strandat utan efterföljare",
        detail:
          `${preflightOwnership.verdict} · effect=${sanitizeText(preflightOwnership.effectId, 24)} · ` +
          `legacy=${preflightOwnership.legacyStatus} · causal=${preflightOwnership.causalStatus}` +
          `${preflightOwnership.closeReason ? ` (${preflightOwnership.closeReason})` : ""} · ` +
          `ingen producent äger nästa steg; bunden liveness startad.`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }
  } else if (run.causalOwnershipStrand) {
    const clearedStrand = run.causalOwnershipStrand;
    run.causalOwnershipStrand = clearCausalOwnershipStrand();
    run.causalOwnershipRearm = null;
    addAudit(audit, {
      kind: "info",
      title: "Kausalt ägarskap-strand rensat",
      detail:
        `effect=${sanitizeText(clearedStrand.effectId, 24)} · ` +
        `orsak=${causalProducer.active
          ? `producent ${causalProducer.producer}${causalProducer.detail ? ` (${causalProducer.detail})` : ""}`
          : preflightOwnership
            ? `ägarskap återsynkat (${preflightOwnership.verdict})`
            : "ingen legacy-effect kvar"} · ` +
        `observationer=${Number(clearedStrand.observations || 0)} · ` +
        `rearms=${Number(clearedStrand.rearmCount || 0)}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
  }

  if (preflightOwnership && !preflightOwnership.desynced) {
    // v0.12.13: classify before mutating. v0.12.12 re-registered unconditionally,
    // but EFFECT_REGISTER refuses a terminal effect, so a consumed owner produced
    // EFFECT_ALREADY_TERMINAL on every tick. The follow-up guard then read
    // `.status` off a null activeCausalEffect(), tested includes("") === false and
    // passed in exactly the case it was written to block, whereupon EFFECT_STATUS
    // was rejected as terminal too. Both rejections were silent, so the plane
    // divergence was never repaired and never reported.
    const register = commitCausalControl(run, {
      type: CAUSAL_EVENT.EFFECT_REGISTER,
      effectId: causalLegacyEffect.effectId,
      turnId: causalLegacyEffect.turnId,
      effectClass: causalLegacyEffect.effectClass || causalLegacyEffect.turnKind || "CONTROL_EFFECT",
      correlationId: causalLegacyEffect.effectId,
      responseContract: run.currentTurn?.responseContract || START_RESPONSE_CONTRACTS.TURN_BOUND_5,
      sourceObservationIdentity: causalLegacyEffect.sourceObservationIdentity || ""
    }, { now });
    run = register.run;
    const mapped = mapLegacyEffectStatus(causalLegacyEffect.status);
    // Compare against this effect's own causal status, never against a
    // possibly-absent active effect.
    const postRegisterOwnership = classifyCausalOwnership(run, causalLegacyEffect);
    const currentCausalStatus = postRegisterOwnership.causalStatus;
    const terminalCausalStatus = ["CLOSED", "CANCELLED", "FAILED", "RESPONSE_CONSUMED"]
      .includes(currentCausalStatus);
    if (mapped && currentCausalStatus !== mapped && !terminalCausalStatus) {
      const statusCommit = commitCausalControl(run, {
        type: CAUSAL_EVENT.EFFECT_STATUS,
        effectId: causalLegacyEffect.effectId,
        status: mapped,
        reason: `LEGACY_EFFECT_STATUS:${causalLegacyEffect.status}`
      }, { now });
      run = statusCommit.run;
    }
  }

  // v0.12.14 autonomous remedy ladder for a stranded causal owner.
  //
  // v0.12.13 escalated an overdue strand straight to ERROR_TERMINAL. That
  // traded a silent deadlock for a loud stop, which for an agent whose entire
  // purpose is autonomy is only half the job — and in the field it fired
  // 95 ms after session-init had logged READY and cleared the run to continue.
  // The remedy is now: hold inside the bound, then grant a bounded one-shot
  // admission re-arm, then hand the turn to the recovery ladder that already
  // owns escalation. Nothing on this path ends the run or waits for a human.
  // Re-arms only accumulate while the run is making no progress. A processed
  // observation advances lastProgressAt and zeroes the ladder, so a healthy run
  // that hits this divergence once a day never drifts toward recovery.
  const causalRearmLedger = run.causalOwnershipRearmLedger || null;
  const causalPriorRearms = causalRearmLedger?.sinceProgressAt === run.lastProgressAt
    ? Math.max(0, Number(causalRearmLedger.total || 0))
    : 0;
  const causalStrandPlan = planCausalOwnershipRecovery({
    strand: run.causalOwnershipStrand,
    producer: causalProducer,
    ownership: preflightOwnership,
    now,
    priorRearms: causalPriorRearms,
    maxRearm: CAUSAL_OWNERSHIP_STRAND_MAX_REARM
  });

  if (causalStrandPlan.action === CAUSAL_OWNERSHIP_RECOVERY_ACTION.REARM) {
    run.causalOwnershipRearm = grantCausalOwnershipRearm(run.causalOwnershipStrand, page, { now });
    run.causalOwnershipStrand = markCausalOwnershipRearm(run.causalOwnershipStrand, { now });
    run.causalOwnershipRearmLedger = {
      total: causalPriorRearms + 1,
      sinceProgressAt: run.lastProgressAt || null
    };
    run.causalOwnershipFailure = null;
    // The consumed owner is what makes both gates refuse. Retiring the legacy
    // claim lets the next tick classify NO_EFFECT and admit a genuinely new
    // response on its own merits; the grant covers the tick in between.
    run.effectJournal = [];
    run.responseDeadlineAt = null;
    run.timeoutSuspended = false;
    addAudit(audit, {
      kind: "warning",
      title: "Kausalt ägarskap återarmat autonomt",
      detail:
        `${CAUSAL_OWNERSHIP_STRAND_CODE} · försök ${Number(run.causalOwnershipRearm?.attempt || 1)}/${CAUSAL_OWNERSHIP_STRAND_MAX_REARM} · ` +
        `effect=${sanitizeText(run.causalOwnershipRearm?.effectId, 24)} · ` +
        `konsumerad=${sanitizeText(run.causalOwnershipRearm?.consumedResponseHash, 12) || "ingen"} · ` +
        `observerad=${sanitizeText(run.causalOwnershipRearm?.observedResponseHash, 12) || "ingen"} · ` +
        `ageMs=${Number(causalStrandPlan.ageMs || 0)} · ingen människa krävs.`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    // Durable before the tick continues: the grant and the ledger increment are
    // what keep this bounded, so losing them to an early return further down
    // would let the same divergence re-arm without limit.
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
  } else if (causalStrandPlan.action === CAUSAL_OWNERSHIP_RECOVERY_ACTION.RECOVER) {
    // Re-arming did not produce a successor. The turn goes to the recovery
    // ladder with a typed reason; its attempt budget and exclusions decide what
    // happens next. The strand is closed here so recovery starts unencumbered.
    run.causalOwnershipFailure = causalOwnershipStrandFailure(run.causalOwnershipStrand, page, { now });
    run.causalOwnershipStrand = clearCausalOwnershipStrand();
    run.causalOwnershipRearm = null;
    run.causalOwnershipRearmLedger = null;
    run.effectJournal = [];
    run.recovery ||= { attempts: [], exclusions: [], consecutiveNoProgress: 0 };
    run = transitionRun(run, STATES.RECOVERING, {
      reason:
        `${CAUSAL_OWNERSHIP_STRAND_CODE}: legacy-journalen rapporterade en levande ägare medan causal control saknade aktiv effect. ` +
        `Bunden återarmning (${causalPriorRearms}) gav ingen efterföljare; turen lämnas till autonom recovery.`,
      // Recovery must be schedulable on the very next tick; transitionRun's
      // default would null this out again.
      nextRecoveryAt: nowIso(now),
      now,
      force: true
    });
    run.timeoutSuspended = false;
    context.run = run;
    addAudit(audit, {
      kind: "warning",
      title: "Kausalt ägarskap lämnat till autonom recovery",
      detail:
        `${CAUSAL_OWNERSHIP_STRAND_CODE} · ${sanitizeText(run.causalOwnershipFailure?.verdict, 48)} · ` +
        `effect=${sanitizeText(run.causalOwnershipFailure?.effectId, 24)} · ` +
        `legacy=${sanitizeText(run.causalOwnershipFailure?.legacyStatus, 32)} · ` +
        `causal=${sanitizeText(run.causalOwnershipFailure?.causalStatus, 32)} · ` +
        `hash=${sanitizeText(run.causalOwnershipFailure?.responseHash, 24)} · ` +
        `rearms=${causalPriorRearms} · ` +
        `ageMs=${Number(run.causalOwnershipFailure?.ageMs || 0)}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(run.targetTabId, "RECOVERING", CAUSAL_OWNERSHIP_STRAND_CODE);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  } else if (!run.causalOwnershipStrand && run.causalOwnershipRearm) {
    // The strand resolved; an unconsumed grant must not outlive it.
    run.causalOwnershipRearm = null;
  }

  // v0.12.4 migration/recovery: v0.12.3 could immediately classify its own
  // freshly submitted EIC-AA/5 prompt as a new material user event because the
  // turn id existed only inside the JSON envelope and promptAckDigest was null.
  // Re-arm that exact orphan once before material-event classification.
  const selfSupersessionRecovery = recoverFalseSelfSupersededControlTurn(run, page, { now });
  run = selfSupersessionRecovery.run;
  if (selfSupersessionRecovery.recovered) {
    addAudit(audit, {
      kind: "warning",
      title: "Felaktigt själv-supersederad CONTROL-turn återarmad",
      detail:
        `turn=${selfSupersessionRecovery.receipt?.turnId || "none"} · ` +
        `oldEffect=${selfSupersessionRecovery.receipt?.priorEffectId || "none"} · ` +
        `newEffect=${selfSupersessionRecovery.receipt?.replacementEffectId || "none"}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
  }

  // v0.12.6 exact upgrade migration: release only the obsolete typed
  // v0.12.5 model-expression fence. The pure helper is replay-tested against
  // the supplied incident export and cannot advance material generation.
  const legacyNanoMigration = migrateLegacyNanoDiscriminationFence(run, {
    now,
    responseTimeoutMs: Number(config.responseTimeoutMs || 7_200_000)
  });
  run = legacyNanoMigration.run;
  if (legacyNanoMigration.migrated) {
    addAudit(audit, {
      kind: "warning",
      title: "v0.12.5 Nano-policy-fence pensionerad vid v0.12.6-migrering",
      detail:
        `legacy=${legacyNanoMigration.receipt?.code || "none"} · ` +
        `generation=${legacyNanoMigration.receipt?.generation ?? "none"} · ` +
        `materialGeneration=${legacyNanoMigration.receipt?.materialGeneration ?? "none"} · ` +
        "nästa ännu ej processade assistantsvar får återgå till runtime-owned transition binding.",
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
  }

  // NANO_TASK is ACCEPTANCE_HARNESS input: observe and queue it before normal
  // mission/control processing, but never mutate run/continuity from the task itself.
  maybeQueueNanoTaskFromPage(context, page, audit, { legacyEffect: latestEffect(run), now });

  const causalMaterialEffect = latestEffect(run);
  if (page.latestUserHash && !latestUserOwnsControlPrompt(page, causalMaterialEffect)) {
    const materialKey = [
      sanitizeText(page.conversationKey || run.conversationKey, 500),
      "user",
      sanitizeText(page.latestUserHash, 240)
    ].join("|");
    const material = commitCausalControl(run, {
      type: CAUSAL_EVENT.MATERIAL_EVENT,
      eventKey: materialKey,
      plane: CAUSAL_PLANES.MISSION
    }, { now });
    run = material.run;
    if (material.accepted && !material.duplicate) {
      const baselineRetirement = retireMaterialSupersededSessionContextBaseline(run, {
        now
      });
      run = baselineRetirement.run;
      if (baselineRetirement.retired) {
        addAudit(audit, {
          kind: "info",
          title: "Stale sessions-baseline pensionerad och återarmerad",
          detail:
            `turn=${baselineRetirement.receipt?.turnId || "none"} · ` +
            `effect=${baselineRetirement.receipt?.effectId || "none"} · ` +
            `generation=${baselineRetirement.receipt?.materialGeneration || 0} · ` +
            "nästa assistantsvar blir ny session-catch.",
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
      }
    }
    if (material.accepted && !material.duplicate &&
        run.state === STATES.PROGRAM_BLOCKED &&
        run.runtimeDecisionStatus === "NANO_DISCRIMINATION_FAILED" &&
        !causalRecoveryBlocked(run)) {
      run = transitionRun(run, STATES.RECOVERING, {
        origin: PAUSE_ORIGINS.NONE,
        reason: "NEW_MATERIAL_EVENT_RELEASED_NANO_POLICY_FENCE",
        force: true
      });
    }
  }

  // v0.12.5 policy-fence quiescence. We intentionally read the target and admit
  // a genuinely new material user event above, because that is the only normal
  // event allowed to advance the causal generation and release the fence.
  // If the fence is still current after that observation, stop this watchdog
  // tick before response drain, Nano, scheduler or generic recovery can mutate
  // the same causal unit.
  if (run.state === STATES.PROGRAM_BLOCKED && causalPolicyFenceActive(run)) {
    context.run = run;
    return snapshotForWindow(windowId);
  }

  // A registered external wait is truly quiescent: only its wake predicate is
  // evaluated. Unchanged observations return before reconcile/Nano/recovery.
  if (causalWaitIsQuiescent(run)) {
    const wait = run.causalControl?.wait || null;
    const currentDigest = latestMessageIsAssistant(page)
      ? assistantResponseIdentity(page)
      : sanitizeText(page.latestUserHash || page.taskFingerprint, 512);
    const wake = commitCausalControl(run, {
      type: CAUSAL_EVENT.WAIT_WAKE,
      predicateKey: wait?.predicateKey || "",
      currentDigest,
      source: "TARGET_PAGE"
    }, { now });
    run = wake.run;
    if (!wake.accepted) {
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      return snapshotForWindow(windowId);
    }
    run.externalWait = null;
    run.timeoutSuspended = false;
    run.runtimeDecisionStatus = "WAIT_WOKEN_BY_MATERIAL_EVENT";
  }

  context.surfacePair = reconcileControllerSurfacePage(context.surfacePair, {
    tab,
    page,
    now
  });

  // v0.12.0 response-owner preflight.
  // Before any Nano/session-init recovery can run, classify the persisted
  // response candidate against the current outbound-effect generation. This is
  // the central causal boundary missing in v0.11.14-v0.11.17: a response that
  // has already been processed, or that is the source of a newly dispatched
  // effect, is never allowed to remain the owner of a later settle deadline.
  const preReconcilePageResponseIdentity = assistantResponseIdentity(page);
  const preReconcileEffect = latestEffect(run);
  const preflightBaselineReobserve = shouldReobserveAckedBaselineResponse(run, {
    responseIdentity: preReconcilePageResponseIdentity,
    baselinePresent: Boolean(projectContinuity(continuity).mainTaskBaseline),
    baselineDeliveryAcked: sessionContextBaselineDelivery(run).delivered
  });
  let responseOwnerPreflight = classifyResponseCandidateOwnership(
    run,
    preReconcileEffect,
    page,
    {
      pageResponseIdentity: preReconcilePageResponseIdentity,
      allowProcessedReobserve: preflightBaselineReobserve
    }
  );
  if (responseOwnerPreflight.clearCandidate) {
    run = retireResponseCandidate(run, {
      status: [
        RESPONSE_CANDIDATE_DISPOSITION.ALREADY_PROCESSED,
        RESPONSE_CANDIDATE_DISPOSITION.SOURCE_OBSERVATION
      ].includes(responseOwnerPreflight.disposition)
        ? RESPONSE_OBSERVATION_CYCLE_STATUS.CONSUMED
        : RESPONSE_OBSERVATION_CYCLE_STATUS.SUPERSEDED,
      owner: responseOwnerPreflight.owner,
      reason: `CAUSAL_PREFLIGHT:${responseOwnerPreflight.disposition}`,
      now
    });
    await clearResponseStabilityProbe(windowId);
    responseOwnerPreflight = classifyResponseCandidateOwnership(
      run,
      preReconcileEffect,
      page,
      {
        pageResponseIdentity: preReconcilePageResponseIdentity,
        allowProcessedReobserve: preflightBaselineReobserve
      }
    );
  }
  const responseOwnerPriorityBeforeRecovery = Boolean(
    run.responseCandidate &&
    responseOwnerPreflight.disposition === RESPONSE_CANDIDATE_DISPOSITION.ACTIVE
  );
  const preRecoveryControlPhase = selectControlPlanePhase({
    run,
    effect: preReconcileEffect,
    responseOwnership: responseOwnerPreflight,
    page
  });
  const genericNanoRecoveryOwnsThisTick = ![
    CONTROL_PLANE_PHASE.SAFETY_OWNER,
    CONTROL_PLANE_PHASE.EFFECT_OWNER,
    CONTROL_PLANE_PHASE.RESPONSE_OWNER,
    CONTROL_PLANE_PHASE.SESSION_INIT_OWNER
  ].includes(preRecoveryControlPhase.phase);

  if (!responseOwnerPriorityBeforeRecovery &&
      run.sessionContextInit?.state === SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING &&
      !run.pendingNanoRequest &&
      !continuity?.mainTaskBaseline &&
      sessionContextBaselineDelivery(run).delivered) {
    const interruptedBaselineFreshness = classifyDeliveredBaselineFreshnessChange(run, page, {
      requirePendingRequest: false
    });
    if ([
      "REBIND_CURRENT_BASELINE_RESPONSE",
      "WAIT_FOR_CURRENT_BASELINE_RESPONSE"
    ].includes(interruptedBaselineFreshness.kind)) {
      run = supersedePendingObservation(run, page, audit, {
        windowId,
        reason: "Interrupted baseline analysis lost request ownership; ACKED baseline delivery will be re-observed before any generic Nano lifecycle recovery.",
        reconcileSessionContextBaseline: true
      });
      run.sessionContextBaselineOrphanRecoveryCount =
        Number(run.sessionContextBaselineOrphanRecoveryCount || 0) + 1;
      run.nanoTelemetry ||= {};
      run.nanoTelemetry.lastStatus = "BASELINE_INTERRUPTED_POST_DELIVERY_RECONCILE";
      run.nanoTelemetry.lastResultSummary = "NO_GENERIC_DETERMINISTIC_RECOVERY";
      context.run = run;
      addAudit(audit, {
        kind: "warning",
        title: "Avbruten baseline-Nano återbinds från ACKED leverans",
        detail: `${run.currentTurn?.turnId || "baseline-turn"} · ingen ny målprompt · generic lifecycle recovery förbikopplad`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      setTimeout(() => tickWindow(windowId, "baseline-interrupted-post-delivery-reconcile").catch(console.warn), 0);
      return snapshotForWindow(windowId);
    }
    if (interruptedBaselineFreshness.kind === "OWNER_CHANGED") {
      run = applySessionContextInitFailure(run, {
        windowId,
        audit,
        code: SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_RESPONSE_OWNER_CHANGED,
        detail: "Avbruten baseline-Nano saknar request och aktuell sida tillhör inte längre samma ACKED baseline-owner.",
        now
      });
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }
  }

  const interruptedNano = genericNanoRecoveryOwnsThisTick
    ? evaluateInterruptedNanoRecovery(run, { now })
    : { allowed: false, reason: `CONTROL_PHASE_${preRecoveryControlPhase.phase}` };
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

  payloadIntegrityBlock = activeEffectPayloadIntegrityBlock(run);
  if (payloadIntegrityBlock.contradictory) {
    run.effectPayloadIntegrityContradiction = payloadIntegrityContradictionRecord(payloadIntegrityBlock, now);
    run.responseDeadlineAt = null;
    run.timeoutSuspended = true;
    run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
      origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
      reason: `${payloadIntegrityBlock.code}: ${payloadIntegrityBlock.reason}`,
      force: true
    });
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    return snapshotForWindow(windowId);
  }
  if (payloadIntegrityBlock.active) {
    const blockedEffect = payloadIntegrityBlock.effect;
    const blockedFailure = payloadIntegrityBlock.failure;
    const ownerObservation = classifyPayloadIntegrityOwnerObservation(blockedEffect, page);

    if (ownerObservation.classification === "CONTRADICTORY") {
      run.effectPayloadIntegrityContradiction =
        payloadIntegrityOwnerObservationContradictionRecord(ownerObservation, blockedEffect, page, now);
      run.responseDeadlineAt = null;
      run.timeoutSuspended = true;
      run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
        origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
        reason: `${ownerObservation.code}: ${ownerObservation.reason}`,
        force: true
      });
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      return snapshotForWindow(windowId);
    }

    if (ownerObservation.classification === "NEW_OWNER_OBSERVATION") {
      blockedEffect.status = "CANCELLED_SUPERSEDED";
      blockedEffect.lastError = "OWNER_OBSERVATION_SUPERSEDED_PAYLOAD_BLOCK";
      delete blockedEffect.prompt;
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
      run = retireResponseCandidate(run, {
        status: RESPONSE_OBSERVATION_CYCLE_STATUS.SUPERSEDED,
        reason: "PAYLOAD_BLOCKED_EFFECT_SUPERSEDED_BY_NEW_OWNER_OBSERVATION",
        now
      });
      run.effectPayloadIntegrityFailure = null;
      run.effectPayloadIntegrityContradiction = null;
      run.timeoutSuspended = false;
      run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
        origin: PAUSE_ORIGINS.OBSERVATION_SUPERSEDED,
        reason: "Ny owner-observation gjorde den payload-blockerade effekten stale. Den gamla effekten skickas aldrig.",
        force: true
      });
      context.run = run;
      addAudit(audit, {
        kind: "warning",
        title: "Payload-blockerad effekt superseded av ny owner-observation",
        detail: `${sanitizeText(blockedFailure.effectId, 180)} · ${sanitizeText(blockedEffect.sourceObservationHash, 512)} → ${sanitizeText(page.latestAssistantHash || "(missing)", 512)}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await notifyPanels(windowId);
      setTimeout(() => tickWindow(windowId, "payload-integrity-owner-supersession").catch(console.warn), 0);
      return snapshotForWindow(windowId);
    }

    const restoredPayload = await validateEffectPayloadIntegrity(blockedEffect);
    if (!restoredPayload.valid) {
      const nextExpected = sanitizeText(restoredPayload.expectedDigest, 128);
      const nextRecomputed = sanitizeText(restoredPayload.recomputedDigest, 128);
      const nextCode = sanitizeText(restoredPayload.code, 120);
      const diagnosticsChanged =
        String(blockedFailure.restorationCheckCode || "") !== nextCode ||
        String(blockedFailure.recomputedPromptDigest || "") !== nextRecomputed ||
        String(blockedFailure.expectedPromptDigest || "") !== nextExpected;
      if (diagnosticsChanged) {
        blockedFailure.restorationCheckCode = nextCode;
        blockedFailure.expectedPromptDigest = nextExpected;
        blockedFailure.recomputedPromptDigest = nextRecomputed;
        context.run = run;
        await writeRuntimeBundle(runtime, continuity, audit);
      }
      return snapshotForWindow(windowId);
    }

    const restorationIdentityMatches =
      String(blockedFailure.effectId || "") === String(blockedEffect.effectId || "") &&
      String(blockedFailure.turnId || "") === String(run.currentTurn?.turnId || "") &&
      String(blockedEffect.turnId || "") === String(run.currentTurn?.turnId || "") &&
      String(blockedFailure.expectedPromptDigest || "") === String(blockedEffect.promptDigest || "") &&
      String(blockedEffect.promptDigest || "") === String(run.currentTurn?.promptDigest || "") &&
      String(blockedEffect.actionKey || "") === String(run.currentTurn?.actionKey || "") &&
      (!blockedFailure.actionKey ||
        String(blockedFailure.actionKey || "") === String(blockedEffect.actionKey || ""));
    if (!restorationIdentityMatches) {
      const contradiction = activeEffectPayloadIntegrityBlock(run);
      contradiction.contradictory = true;
      contradiction.active = false;
      contradiction.code = "EFFECT_PAYLOAD_INTEGRITY_STATE_CONTRADICTORY";
      contradiction.reason = "Hashmatchande payload återfanns men effect/turn/action/digest-identiteten motsäger failure-kvittot.";
      run.effectPayloadIntegrityContradiction = payloadIntegrityContradictionRecord(contradiction, now);
      run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
        origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
        reason: `${contradiction.code}: ${contradiction.reason}`,
        force: true
      });
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      return snapshotForWindow(windowId);
    }

    blockedEffect.status = "RETRY_PREPARED";
    blockedEffect.lastError = "";
    run.currentTurn.effectState = "RETRY_PREPARED";
    run.effectPayloadIntegrityFailure = null;
    run.effectPayloadIntegrityContradiction = null;
    run.timeoutSuspended = false;
    run = transitionRun(run, STATES.RECOVERING, {
      origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
      reason: "Exakt hashmatchande payload återställd för samma effektidentitet; target reconcileras före eventuell send.",
      force: true
    });
    context.run = run;
    addAudit(audit, {
      kind: "info",
      title: "Effektpayload återställd och verifierad",
      detail: `effectId=${sanitizeText(blockedEffect.effectId, 180)} · turnId=${sanitizeText(blockedEffect.turnId, 180)} · digest=${sanitizeText(blockedEffect.promptDigest, 128)}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
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

  // v0.11.18: liveness applies only after causal response ownership has been
  // established. A stale/consumed/source candidate was already removed by the
  // response-owner preflight above and can never timeout a newer effect.
  const settleLiveness = evaluateResponseSettleLiveness(run.responseCandidate, page, {
    now,
    maxAgeMs: RESPONSE_SETTLE_MAX_AGE_MS
  });
  if (settleLiveness.candidate) run.responseCandidate = settleLiveness.candidate;
  const terminalResponseAuthoritative = authoritativeTerminalResponse(page);
  const responseOwnerReadable = Boolean(
    isAssistantResponseCandidate(page) &&
    page.latestAssistantExtractionComplete !== false &&
    ![
      CHATGPT_RESPONSE_STATES.GENERATING_FOREGROUND,
      CHATGPT_RESPONSE_STATES.WAITING_BACKGROUND,
      CHATGPT_RESPONSE_STATES.CANCELLED,
      CHATGPT_RESPONSE_STATES.ERROR,
      CHATGPT_RESPONSE_STATES.AUTH_REQUIRED
    ].includes(pageClassification.state)
  );
  if (run.state === STATES.WAITING_FOREGROUND &&
      (terminalResponseAuthoritative || responseOwnerReadable)) {
    run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
      origin: PAUSE_ORIGINS.NONE,
      reason: terminalResponseAuthoritative
        ? "Trusted terminal EIC completion avslutade stale foreground-wait; response-settle återtas."
        : "Stabil assistant-response avslutade stale foreground-wait; response-settle återtas.",
      force: true
    });
  }

  if (run.responseCandidate &&
      responseOwnerPreflight.disposition === RESPONSE_CANDIDATE_DISPOSITION.ACTIVE &&
      settleLiveness.overdue &&
      !responseOwnerReadable &&
      !terminalResponseAuthoritative) {
    run.responseSettleFailure = responseSettleFailureRecord(run.responseCandidate, page, {
      now,
      reason: "Aktuell causally-owned response candidate passerade bounded settle-deadline utan owner-readable stabil response."
    });
    run.responseObservationCycle = updateResponseObservationCycle(
      run.responseObservationCycle,
      {
        status: RESPONSE_OBSERVATION_CYCLE_STATUS.FAILED,
        owner: responseOwnerPreflight.owner,
        candidate: run.responseCandidate,
        reason: RESPONSE_SETTLE_FAILURE_CODE,
        now
      }
    );
    await clearResponseStabilityProbe(windowId);
    run = transitionRun(run, STATES.ERROR_TERMINAL, {
      origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
      reason: `${RESPONSE_SETTLE_FAILURE_CODE}: aktuell response generation kunde inte owner-settlas inom bounded deadline.`,
      force: true
    });
    context.run = run;
    addAudit(audit, {
      kind: "error",
      title: "Response-settle liveness terminaliserad",
      detail: `${RESPONSE_SETTLE_FAILURE_CODE} · owner=${sanitizeText(responseOwnerPreflight.owner?.key, 80)} · hash=${sanitizeText(run.responseSettleFailure?.responseHash, 24)} · ageMs=${Number(run.responseSettleFailure?.ageMs || 0)}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(run.targetTabId, "ERROR", RESPONSE_SETTLE_FAILURE_CODE);
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

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

  const pendingMjolnar = await reconcileMjolnarReadbackUnlocked(run, page, tab, context);
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
    const preparedEffect = latestEffect(run);
    const preparedEffectPending = Boolean(
      preparedEffect &&
      ["PREPARED", "RETRY_PREPARED"].includes(String(preparedEffect.status || "").toUpperCase())
    );
    if (preparedEffectPending) {
      // v0.12.12: a prompt that has not been submitted yet is not waiting for
      // an AI response. Keep the effect journalled, preserve its owner evidence,
      // and wait on the actual foreground producer instead of arming the 2 h
      // response timeout. This closes the v0.12.11 WAITING_FOR_RESPONSE dead wait.
      preparedEffect.preSubmitWaitStartedAt ||= nowIso(now);
      preparedEffect.preSubmitWaitLastObservedAt = nowIso(now);
      preparedEffect.ownerReadbackStatus = "TARGET_BUSY";
      preparedEffect.ownerReadbackReason = "TARGET_FOREGROUND_GENERATING";
      run.responseDeadlineAt = null;
      run.timeoutSuspended = true;
      run.recovery.nextRecoveryAt = nowIso(now + 30_000);
      if (run.state !== STATES.WAITING_FOREGROUND) {
        run = transitionRun(run, STATES.WAITING_FOREGROUND, {
          origin: PAUSE_ORIGINS.NONE,
          reason: "Förberedd men ännu ej skickad prompt väntar på stabil foreground.",
          force: true
        });
      }
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(run.targetTabId, "WAITING", "Förberedd prompt väntar på stabil foreground");
      await notifyPanels(windowId);
      const waitStartedAt = Date.parse(preparedEffect.preSubmitWaitStartedAt || "");
      const waitAgeMs = Number.isFinite(waitStartedAt) ? Math.max(0, now - waitStartedAt) : 0;
      if (waitAgeMs < PREPARED_EFFECT_FAST_RECHECK_WINDOW_MS) {
        setTimeout(
          () => tickWindow(windowId, "prepared-effect-foreground-stability").catch(console.warn),
          PREPARED_EFFECT_FAST_RECHECK_MS
        );
      }
      return snapshotForWindow(windowId);
    }

    // v0.12.11: a target-side foreground generation is a new causal owner event.
    // An ordinary Nano decision over the prior observation is no longer admissible.
    // Retire that exact request before leaving ASSESSING so sidepanel heartbeats get
    // an authoritative owner-invalidated response and can abort the local model task.
    if (run.state === STATES.ASSESSING &&
        run.pendingNanoRequest?.status === "RUNNING" &&
        run.pendingNanoRequest?.sessionContextBaselineAnalysis !== true) {
      const supersededNanoRequest = {
        ...deepClone(run.pendingNanoRequest),
        status: "SUPERSEDED",
        completedAt: nowIso(now),
        errorCode: "NANO_OWNER_INVALIDATED",
        lastError: "NANO_OWNER_INVALIDATED:TARGET_GENERATING_FOREGROUND",
        resultSummary: "TARGET_GENERATING_FOREGROUND superseded the prior Nano observation owner."
      };
      run = recordDecisionTrace(run, supersededNanoRequest, {
        source: NANO_DECISION_SOURCE.NANO,
        now
      }).run;
      run.pendingNanoRequest = null;
      run.nanoTelemetry ||= {};
      run.nanoTelemetry.lastStatus = "SUPERSEDED";
      run.nanoTelemetry.lastCompletedAt = supersededNanoRequest.completedAt;
      run.nanoTelemetry.lastError = supersededNanoRequest.lastError;
      run.nanoTelemetry.lastResultSummary = supersededNanoRequest.resultSummary;
      addAudit(audit, {
        kind: "info",
        title: "Pågående Nano avbruten av ny foreground-generation",
        detail: `${supersededNanoRequest.requestId || "unknown-request"} · owner invalidated · stale decision/failure receipt förbjuden.`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }
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

  // v0.11.18: transient session-init liveness is independent of response/Nano/
  // recovery priority. CATCH_CAPTURED and BASELINE_REQUEST_DISPATCHED are
  // controller-owned handoffs and must typed-fail at the existing 120 s bound
  // even if a stale response candidate would otherwise try to win precedence.
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

  const reconciledEffect = latestEffect(run);
  const postReconcilePageResponseIdentity = assistantResponseIdentity(page);
  const postReconcileBaselineReobserve = shouldReobserveAckedBaselineResponse(run, {
    responseIdentity: postReconcilePageResponseIdentity,
    baselinePresent: Boolean(projectContinuity(continuity).mainTaskBaseline),
    baselineDeliveryAcked: sessionContextBaselineDelivery(run).delivered
  });
  const postReconcileOwnership = classifyResponseCandidateOwnership(
    run,
    reconciledEffect,
    page,
    {
      pageResponseIdentity: postReconcilePageResponseIdentity,
      allowProcessedReobserve: postReconcileBaselineReobserve
    }
  );
  const responseSettlePriority = responseSettlePriorityPlan(run.responseCandidate, page, {
    now,
    maxAgeMs: RESPONSE_SETTLE_MAX_AGE_MS
  });
  // v0.12.13: both admission gates now ask exactly one question. Asking the
  // legacy journal here and causal control at the candidate gate is what let
  // this log line report admission=1 for two and a half minutes while the
  // candidate gate silently refused the same response.
  const postReconcileCausalOwnership = classifyCausalOwnership(run, reconciledEffect);
  // v0.12.14: an outstanding one-shot re-arm grant admits this generation even
  // though the consumed owner still refuses it — but only for the effect the
  // grant names, and only for a response hash that is not the consumed one.
  const postReconcileRearmAdmits = causalOwnershipRearmAdmits(
    run.causalOwnershipRearm, reconciledEffect, page
  );
  const newResponseAdmissionReady = Boolean(
    (postReconcileCausalOwnership.admissible || postReconcileRearmAdmits) &&
    isAssistantResponseCandidate(page) &&
    postReconcilePageResponseIdentity &&
    postReconcileOwnership.allowCandidateAdmission
  );
  const responseSettlePriorityReady = Boolean(
    newResponseAdmissionReady ||
    (
      responseSettlePriority.priority &&
      (postReconcileCausalOwnership.admissible || postReconcileRearmAdmits)
    )
  );
  if (responseSettlePriorityReady) {
    addAudit(audit, {
      kind: "info",
      title: "Response-owner drain prioriterad",
      detail: `${sanitizeText(run.responseCandidate?.hash || page.latestAssistantHash, 24)} · admission=${newResponseAdmissionReady ? "1" : "0"} · due=${responseSettlePriority.due ? "1" : "0"} · overdue=${responseSettlePriority.overdue ? "1" : "0"} · owner=${postReconcileCausalOwnership.verdict}${postReconcileRearmAdmits ? " · rearm=1" : ""} · autonomous recovery/Nano skjuts upp tills den kausala response-generationen processats eller typed-failat.`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
  }

  if (!responseSettlePriorityReady) {
  const nanoInvariantBeforeRecovery = nanoAnalysisWaitInvariant(run);
  const nanoRecovery = restorePendingSessionInitNano(run, {
    now,
    reason: "Sessionsinitieringens pending Nano-request återställdes efter lokal storage/lifecycle-recovery."
  });
  if (nanoRecovery.repaired) {
    run = nanoRecovery.run;
    context.run = run;
    addAudit(audit, {
      kind: "warning",
      title: "Pending Nano-analys återställd till ASSESSING",
      detail: `${nanoInvariantBeforeRecovery.code || "NANO_ANALYSIS_RECOVERY"} · request ${run.pendingNanoRequest?.requestId || "okänd"} · ingen ny målresponse krävs.`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(
      run.targetTabId,
      "ASSESSING",
      "Nano-request återställd efter lokal recovery",
      sessionContextInitOverlay(run.sessionContextInit)
    );
    await notifyPanels(windowId);
    return snapshotForWindow(windowId);
  }

  if (run.state === STATES.SOFT_PAUSED &&
      ![PAUSE_ORIGINS.OPERATOR_PAUSE, PAUSE_ORIGINS.NO_PROGRESS_BUDGET_EXHAUSTED].includes(run.pause?.origin)) {
    run = transitionRun(run, STATES.RECOVERING, {
      origin: run.pause?.origin || PAUSE_ORIGINS.NONE,
      reason: "Automatisk paus ligger under nivå 10; autonom recovery fortsätter.",
      force: true
    });
  }
  if (run.state === STATES.PROGRAM_BLOCKED &&
      !pauseRequiresHuman(run) &&
      !causalRecoveryBlocked(run) &&
      run.sessionContextInit?.state !== SESSION_CONTEXT_INIT_STATE.FAILED) {
    run = transitionRun(run, STATES.RECOVERING, {
      origin: run.pause?.origin || PAUSE_ORIGINS.NONE,
      reason: "Blockeringen saknar nivå-10-gräns; autonom recovery fortsätter.",
      force: true
    });
  }
  if (readablePageMayResolveRecovery(run, page)) {
    const recoveryOriginBeforeResume = run.lastTransition?.to === STATES.RECOVERING
      ? run.lastTransition.origin
      : run.pause?.origin;
    run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
      origin: recoveryOriginBeforeResume || PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
      reason: "Connectivity/lifecycle-recovery verifierades: målflik och content bridge är åter läsbara.",
      force: true
    });
  }
  // v0.10.11 session-context liveness. The transient initialization phases are
  // local controller handoffs; if one outlives its bound the whole gate is stuck
  // and `sessionContextInitBlocksWork` would otherwise block every prompt
  // forever, since v0.10.10 never assigned FAILED anywhere. FAILED is terminal,
  // so this fires exactly once and cannot spin. Placed before the ASSESSING
  // lease gate so a stalled DISPATCHED lease cannot outrun it.
  if (run.sessionContextInit?.state === SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING &&
      !run.pendingNanoRequest &&
      !continuity?.mainTaskBaseline) {
    const orphanFreshness = classifyDeliveredBaselineFreshnessChange(run, page, {
      requirePendingRequest: false
    });

    if ([
      "REBIND_CURRENT_BASELINE_RESPONSE",
      "WAIT_FOR_CURRENT_BASELINE_RESPONSE"
    ].includes(orphanFreshness.kind)) {
      run = supersedePendingObservation(run, page, audit, {
        windowId,
        reason: "Ownerless NANO_ANALYZING recovered from the already ACKED baseline delivery; current response will be re-observed locally.",
        reconcileSessionContextBaseline: true
      });
      run.sessionContextBaselineOrphanRecoveryCount =
        Number(run.sessionContextBaselineOrphanRecoveryCount || 0) + 1;
      run.nanoTelemetry ||= {};
      run.nanoTelemetry.lastStatus = "BASELINE_ORPHAN_AUTO_RECONCILED";
      run.nanoTelemetry.lastResultSummary = "POST_DELIVERY_RECONCILE_NO_TARGET_PROMPT";
      context.run = run;
      addAudit(audit, {
        kind: "warning",
        title: "Ownerless Nano-baseline state självreparerad",
        detail: `POST_DELIVERY_RECONCILE · ${run.currentTurn?.turnId || "baseline-turn"} · ingen ny målprompt`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(
        run.targetTabId,
        "INITIALIZING",
        "Baseline-response återbinds lokalt",
        sessionContextInitOverlay(run.sessionContextInit)
      );
      await notifyPanels(windowId);
      setTimeout(() => tickWindow(windowId, "baseline-orphan-post-delivery-reconcile").catch(console.warn), 0);
      return snapshotForWindow(windowId);
    }

    if (orphanFreshness.kind === "OWNER_CHANGED") {
      run = applySessionContextInitFailure(run, {
        windowId,
        audit,
        code: SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_RESPONSE_OWNER_CHANGED,
        detail: "NANO_ANALYZING saknar aktiv request och den aktuella sidan kan inte längre owner-bindas till den ACKED baselineleveransen.",
        now
      });
    } else {
      run = applySessionContextInitFailure(run, {
        windowId,
        audit,
        code: SESSION_CONTEXT_INIT_FAILURE_CODE.NANO_ANALYSIS_ORPHANED,
        detail: "NANO_ANALYZING saknar både aktiv Nano-request och Nano-validerad huvuduppgiftsbaslinje, och ingen owner-verifierad levererad baseline finns att återbinda. Ingen deterministisk continuation får ersätta baseline-analysen.",
        now
      });
    }
    context.run = run;
    await writeRuntimeBundle(runtime, continuity, audit);
    await setTabIndicator(
      run.targetTabId,
      "BLOCKED",
      orphanFreshness.kind === "OWNER_CHANGED"
        ? "Baseline-response owner ändrades"
        : "Nano-analysen saknar ägd request",
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
    const unclaimedNanoRecovery = planUnclaimedNanoRequestRecovery(run, {
      now,
      limitMs: NANO_UNCLAIMED_REQUEST_TIMEOUT_MS,
      maxRearms: NANO_UNCLAIMED_REQUEST_MAX_REARMS
    });
    if (unclaimedNanoRecovery.action === NANO_UNCLAIMED_RECOVERY_ACTION.REARM) {
      const rearmAt = nowIso(now);
      request.claimAvailableAt = rearmAt;
      request.requeuedAt = rearmAt;
      request.unclaimedRearmCount = unclaimedNanoRecovery.nextRearmCount;
      renewNanoRequestDeadline(request, now);
      request.lastError =
        `Nano-requesten förblev oclaimad under ett lokalt ${Math.round(unclaimedNanoRecovery.limitMs / 1000)} s-fönster; ` +
        `samma request återköades lokalt (${request.unclaimedRearmCount}/${NANO_UNCLAIMED_REQUEST_MAX_REARMS}) utan målprompt.`;
      run.nanoTelemetry ||= {};
      run.nanoTelemetry.lastStatus = "REQUEUED";
      run.nanoTelemetry.lastError = request.lastError;
      run.nanoTelemetry.lastUnclaimedRearmAt = rearmAt;
      run.nanoTelemetry.unclaimedRearmCount = request.unclaimedRearmCount;
      run = transitionRun(run, STATES.ASSESSING, {
        origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
        reason: "Nano claim-fönstret gick ut lokalt; samma request återköades utan target-effekt.",
        force: true
      });
      context.run = run;
      addAudit(audit, {
        kind: "warning",
        title: "Nano-request oclaimad — lokalt återköad",
        detail: `${request.requestId} · ${request.lastError}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(
        run.targetTabId,
        "ASSESSING",
        "Nano-request återköad lokalt",
        sessionContextInitOverlay(run.sessionContextInit)
      );
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }
    if (unclaimedNanoRecovery.action === NANO_UNCLAIMED_RECOVERY_ACTION.FAIL) {
      run = applySessionContextInitFailure(run, {
        windowId,
        audit,
        code: SESSION_CONTEXT_INIT_FAILURE_CODE.NANO_REQUEST_UNCLAIMED_TIMEOUT,
        detail: `Nano-request ${unclaimedNanoRecovery.requestId || "okänd"} kunde inte claimas efter ` +
          `${NANO_UNCLAIMED_REQUEST_MAX_REARMS + 1} separata lokala claim-fönster om ` +
          `${Math.round(unclaimedNanoRecovery.limitMs / 1000)} sekunder. Baselineprompten är redan levererad; ingen dubbel prompt skickas.`,
        now
      });
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(
        run.targetTabId,
        "PAUSED",
        "Nano-analysen kunde inte starta",
        sessionContextInitOverlay(run.sessionContextInit)
      );
      await notifyPanels(windowId);
      return snapshotForWindow(windowId);
    }

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
      const lastHeartbeatMs = Date.parse(
        request.heartbeatAt || request.startedAt || request.claimedAt || ""
      );
      const heartbeatStale =
        request.sessionContextBaselineAnalysis === true &&
        Number.isFinite(lastHeartbeatMs) &&
        now - lastHeartbeatMs >= NANO_RUNNING_HEARTBEAT_STALE_MS;
      if (heartbeatStale) {
        const staleDetail =
          `Baseline-Nano saknar terminal receipt/heartbeat i ${Math.round((now - lastHeartbeatMs) / 1000)} s ` +
          `efter claim ${request.claimId || "okänd"}.`;
        if (Number(request.attempts || 0) < NANO_MAX_ATTEMPTS) {
          request.status = "PENDING";
          request.claimId = null;
          request.claimedAt = null;
          request.claimAvailableAt = nowIso(now);
          request.unclaimedRearmCount = 0;
          request.startedAt = null;
          request.heartbeatAt = null;
          request.claimLeaseUntil = null;
          request.firstTokenAt = null;
          request.outputChars = 0;
          request.chunkCount = 0;
          renewNanoRequestDeadline(request, now);
          request.requeuedAt = nowIso(now);
          request.requeueCount = Number(request.requeueCount || 0) + 1;
          request.lastError = `${staleDetail} Requesten återköades utan målprompt.`;
          run.nanoTelemetry ||= {};
          run.nanoTelemetry.lastStatus = "REQUEUED";
          run.nanoTelemetry.lastError = request.lastError;
          run.nanoTelemetry.lastLeaseUntil = null;
          run = transitionRun(run, STATES.ASSESSING, {
            origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
            reason: "Baseline-Nano terminal transport förlorades; samma request återköades.",
            force: true
          });
          context.run = run;
          addAudit(audit, {
            kind: "warning",
            title: "Baseline-Nano terminal transport saknas — request återköad",
            detail: `${request.mode || "UNKNOWN"} · ${request.requestId} · ${request.lastError}`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
          await writeRuntimeBundle(runtime, continuity, audit);
          await notifyPanels(windowId);
          return snapshotForWindow(windowId);
        }
        run.pendingNanoRequest = null;
        run = applySessionContextInitFailure(run, {
          windowId,
          audit,
          code: SESSION_CONTEXT_INIT_FAILURE_CODE.NANO_ANALYSIS_FAILED,
          detail: `${staleDetail} Maximal claimbudget är uttömd; ingen ordinary continuation tillåts.`,
          now
        });
        run.nanoTelemetry ||= {};
        run.nanoTelemetry.lastStatus = "FAILED";
        run.nanoTelemetry.lastError = staleDetail;
        context.run = run;
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(
          run.targetTabId,
          "BLOCKED",
          "Nano terminal transport förlorades",
          sessionContextInitOverlay(run.sessionContextInit)
        );
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }

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
        if (request.sessionContextBaselineAnalysis === true) {
          const reconciled = reconcileInvalidatedBaselineNanoRequest(run, page, audit, {
            windowId,
            reason: trace.lastError,
            now
          });
          run = reconciled.run;
          context.run = run;
          await writeRuntimeBundle(runtime, continuity, audit);
          await notifyPanels(windowId);
          if (reconciled.action === "RECONCILED") {
            setTimeout(() => tickWindow(windowId, "baseline-invalid-claim-post-delivery-reconcile").catch(console.warn), 0);
          }
          return snapshotForWindow(windowId);
        }
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
        const absoluteDeadline = request.mode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP
          ? Number.NaN
          : Date.parse(request.deadlineAt || "");
        const absoluteDeadlineExpired = Number.isFinite(absoluteDeadline) && now >= absoluteDeadline;
        if (absoluteDeadlineExpired || Number(request.attempts || 0) >= NANO_MAX_ATTEMPTS) {
          const trace = {
            ...deepClone(request),
            status: "FAILED",
            completedAt: nowIso(now),
            lastError: absoluteDeadlineExpired
              ? "Nano-requestens absoluta modedeadline gick ut; samma request får inte återköas."
              : "Nano claim-lease gick ut efter maximalt antal försök."
          };
          run = recordDecisionTrace(run, trace, {
            source: NANO_DECISION_SOURCE.NANO,
            now
          }).run;
          if (request.sessionContextBaselineAnalysis === true) {
            const reconciled = reconcileInvalidatedBaselineNanoRequest(run, page, audit, {
              windowId,
              reason: trace.lastError,
              now
            });
            run = reconciled.run;
            context.run = run;
            await writeRuntimeBundle(runtime, continuity, audit);
            await notifyPanels(windowId);
            if (reconciled.action === "RECONCILED") {
              setTimeout(() => tickWindow(windowId, "baseline-expired-lease-post-delivery-reconcile").catch(console.warn), 0);
            }
            return snapshotForWindow(windowId);
          }
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
            title: absoluteDeadlineExpired
              ? (run.maxAutonomousMode
                ? "Nano modedeadline nådd — autonom recovery"
                : "Nano-pipeline pausad vid modedeadline")
              : (run.maxAutonomousMode
                ? "Utgången Nano-lease omvandlad till autonom recovery"
                : "Nano-pipeline pausad efter utgången claim-lease"),
            detail: `${request.mode || "UNKNOWN"} · ${request.requestId} · ${trace.lastError}`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
        } else {
          request.status = "PENDING";
          request.claimId = null;
          request.claimedAt = null;
          request.claimAvailableAt = nowIso(now);
          request.unclaimedRearmCount = 0;
          request.startedAt = null;
          request.heartbeatAt = null;
          request.claimLeaseUntil = null;
          request.firstTokenAt = null;
          request.outputChars = 0;
          request.chunkCount = 0;
          renewNanoRequestDeadline(request, now);
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
        request.sessionContextBaselineAnalysis !== true &&
        request.mode !== NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP &&
        Number.isFinite(deadline) && now >= deadline;
      if (request.sessionContextBaselineAnalysis === true &&
          Number.isFinite(deadline) && now >= deadline) {
        renewNanoRequestDeadline(request, now);
        request.claimAvailableAt = nowIso(now);
        request.requeuedAt = nowIso(now);
        request.requeueCount = Number(request.requeueCount || 0) + 1;
        request.lastError = "Baseline-Nano deadline förnyades lokalt; deterministic target-authored fallback är förbjuden under session-init.";
        run.nanoTelemetry ||= {};
        run.nanoTelemetry.lastStatus = "BASELINE_NANO_REQUEUED";
        run.nanoTelemetry.lastError = request.lastError;
        context.run = bindSessionContextBaselineNanoRequest(run, { now });
        addAudit(audit, {
          kind: "warning",
          title: "Baseline-Nano återköad utan deterministic fallback",
          detail: `${request.requestId} · ingen målprompt · sessionContextBaselineAnalysis=true`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
      if (!fallbackDue && config.allowTargetAuthoredFallback !== true &&
          Number.isFinite(deadline) && now >= deadline) {
        if (run.maxAutonomousMode) {
          renewNanoRequestDeadline(request, now);
          request.claimAvailableAt = nowIso(now);
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
  }

  const effect = latestEffect(run);
  // v0.12.13: identical verdict to the admission gate above. See
  // classifyCausalOwnership() for why these must never diverge.
  const causalOwnership = classifyCausalOwnership(run, effect);
  // Same one-shot grant, same question. These two gates diverging is what
  // v0.12.13 was written to stop; the re-arm must therefore reach both.
  const causalRearmAdmits = causalOwnershipRearmAdmits(run.causalOwnershipRearm, effect, page);
  const effectReady = causalOwnership.admissible || causalRearmAdmits;
  const pageResponseIdentity = assistantResponseIdentity(page);
  const baselineReobserveEligible = shouldReobserveAckedBaselineResponse(run, {
    responseIdentity: pageResponseIdentity,
    baselinePresent: Boolean(projectContinuity(continuity).mainTaskBaseline),
    baselineDeliveryAcked: sessionContextBaselineDelivery(run).delivered
  });
  const responseOwnership = classifyResponseCandidateOwnership(
    run,
    effect,
    page,
    {
      pageResponseIdentity,
      allowProcessedReobserve: baselineReobserveEligible
    }
  );

  if (!effectReady ||
      !isAssistantResponseCandidate(page) ||
      !pageResponseIdentity ||
      !responseOwnership.allowCandidateAdmission) {
    // A user prompt, a not-yet-ACKED outbound effect, the source observation of
    // that effect, or an already-consumed response cannot own this generation.
    if (run.responseCandidate) {
      run = retireResponseCandidate(run, {
        status: [
          RESPONSE_CANDIDATE_DISPOSITION.ALREADY_PROCESSED,
          RESPONSE_CANDIDATE_DISPOSITION.SOURCE_OBSERVATION
        ].includes(responseOwnership.disposition)
          ? RESPONSE_OBSERVATION_CYCLE_STATUS.CONSUMED
          : RESPONSE_OBSERVATION_CYCLE_STATUS.SUPERSEDED,
        owner: responseOwnership.owner,
        reason: `CANDIDATE_NOT_ADMITTED:${responseOwnership.disposition}`,
        now
      });
    } else {
      run.responseSettleFailure = null;
    }
    await clearResponseStabilityProbe(windowId);
  } else {
    const completionPolicy = responseEligibleForNano(run, page);
    const dynamicSoftCandidate = page.latestAssistantComplete !== true && !terminalResponseAuthoritative;
    const responseSettleMs = dynamicSoftCandidate
      ? Math.max(4_000, Number(config.settleMs || 2500))
      : Number(config.settleMs || 2500);
    const responseMinimumReads = dynamicSoftCandidate ? 3 : 2;
    const advanced = advanceResponseCandidate(run.responseCandidate, page, {
      now,
      settleMs: responseSettleMs,
      minimumReads: responseMinimumReads,
      owner: responseOwnership.owner,
      responseIdentity: pageResponseIdentity
    });
    advanced.candidate = bindResponseSettleCandidate(advanced.candidate, {
      now,
      maxAgeMs: RESPONSE_SETTLE_MAX_AGE_MS
    });
    run.responseCandidate = advanced.candidate;
    run.responseObservationCycle = updateResponseObservationCycle(
      run.responseObservationCycle,
      {
        status: advanced.settled
          ? RESPONSE_OBSERVATION_CYCLE_STATUS.SETTLED
          : RESPONSE_OBSERVATION_CYCLE_STATUS.OBSERVING,
        owner: responseOwnership.owner,
        candidate: advanced.candidate,
        reason: advanced.settled ? "CANDIDATE_SETTLED" : "CANDIDATE_OBSERVING",
        now
      }
    );
    const candidateLiveness = evaluateResponseSettleLiveness(run.responseCandidate, page, {
      now,
      maxAgeMs: RESPONSE_SETTLE_MAX_AGE_MS
    });
    if (advanced.settled && !completionPolicy.eligible) {
      if (candidateLiveness.overdue && terminalResponseAuthoritative) {
        run.responseSettleFailure = responseSettleFailureRecord(run.responseCandidate, page, {
          now,
          reason: `Trusted terminal response settled but remained ineligible after bounded deadline: ${sanitizeText(completionPolicy.reason, 300)}`
        });
        await clearResponseStabilityProbe(windowId);
        run = transitionRun(run, STATES.ERROR_TERMINAL, {
          origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
          reason: `${RESPONSE_SETTLE_FAILURE_CODE}: terminal response kunde inte tas in av completion-policy inom bounded deadline.`,
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "error",
          title: "Response-settle completion-policy terminaliserad",
          detail: `${RESPONSE_SETTLE_FAILURE_CODE} · ${sanitizeText(completionPolicy.reason, 300)}`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(run.targetTabId, "ERROR", RESPONSE_SETTLE_FAILURE_CODE);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      await scheduleResponseStabilityProbe(windowId, 1_500);
      return snapshotForWindow(windowId);
    }
    const newCompleteResponse = Boolean(
      advanced.settled &&
      completionPolicy.eligible &&
      latestMessageIsAssistant(page) &&
      (
        pageResponseIdentity !== run.lastProcessedResponseIdentity ||
        run.lastProcessedAssistantComplete === false ||
        baselineReobserveEligible
      )
    );

    if (!advanced.settled && advanced.candidate) {
      if (candidateLiveness.overdue && terminalResponseAuthoritative) {
        run.responseCandidate = advanced.candidate;
        run.responseSettleFailure = responseSettleFailureRecord(run.responseCandidate, page, {
          now,
          reason: "Trusted terminal response remained unsettled after the bounded candidate deadline despite an owner reconcile tick."
        });
        await clearResponseStabilityProbe(windowId);
        run = transitionRun(run, STATES.ERROR_TERMINAL, {
          origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
          reason: `${RESPONSE_SETTLE_FAILURE_CODE}: terminal candidate förblev unsettled efter bounded deadline.`,
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "error",
          title: "Response-settle candidate terminaliserad",
          detail: `${RESPONSE_SETTLE_FAILURE_CODE} · stableReads=${Number(advanced.candidate.stableReads || 0)}`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(run.targetTabId, "ERROR", RESPONSE_SETTLE_FAILURE_CODE);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
      const firstSeenAt = Date.parse(advanced.candidate.firstSeenAt || "");
      const elapsedMs = Number.isFinite(firstSeenAt) ? Math.max(0, now - firstSeenAt) : 0;
      const remainingMs = Math.max(100, responseSettleMs - elapsedMs + 50);
      advanced.candidate.nextProbeAt = nowIso(now + remainingMs);
      run.responseCandidate = advanced.candidate;
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
      await scheduleResponseStabilityProbe(windowId, remainingMs);
      return snapshotForWindow(windowId);
    }

    await clearResponseStabilityProbe(windowId);
    run.responseSettleFailure = null;
    if (newCompleteResponse) {
      run = observePendingD2OwnerResponse(run, page);

      // Protocol applicability is resolved before parsing. Only a response that
      // is explicitly bound to the active CONTROL effect may enter EIC-AA/5.
      let responseContract = "";
      if (effect?.effectId) {
        const bind = commitCausalControl(run, {
          type: CAUSAL_EVENT.RESPONSE_BIND,
          effectId: effect.effectId,
          responseIdentity: pageResponseIdentity,
          responseHash: page.latestAssistantHash
        }, { now });
        run = bind.run;
        if (bind.accepted) {
          responseContract = responseContractForBoundControl(run, pageResponseIdentity);
        }
      } else if (responseOwnership.owner?.kind === "SESSION_CATCH") {
        // Session-catch is a bounded CONTROL bootstrap owner.
        responseContract = run.currentTurn?.responseContract || START_RESPONSE_CONTRACTS.TURN_BOUND_5;
      }

      if (!responseContract) {
        run = markObservationProcessed(run, {
          responseHash: page.latestAssistantHash,
          responseIdentity: pageResponseIdentity,
          assistantCount: page.assistantCount
        }, { now });
        run = retireResponseCandidate(run, {
          status: RESPONSE_OBSERVATION_CYCLE_STATUS.CONSUMED,
          owner: responseOwnership.owner,
          reason: "MISSION_OR_OBSERVATION_RESPONSE_WITHOUT_BOUND_CONTROL_EFFECT",
          now
        });
        context.run = run;
        addAudit(audit, {
          kind: "info",
          title: "Mission/observation response lämnades utanför CONTROL-protokollet",
          detail: "Ingen causally bound CONTROL effect fanns; EIC-AA/5-parsern anropades inte.",
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        return snapshotForWindow(windowId);
      }

      const allowTurnless = responseContract === START_RESPONSE_CONTRACTS.TURNLESS_4;
      const expectedTurnId = responseContract === START_RESPONSE_CONTRACTS.TURN_BOUND_5
        ? (run.currentTurn?.responseExpectedTurnId || run.currentTurn?.turnId || null)
        : null;
      const targetResult = parseTargetResult(page.latestAssistant, expectedTurnId, { allowTurnless });

      // v0.12.13: do not consume a CONTROL owner on soft stability alone.
      // responseEligibleForNano() returns GENERAL_DYNAMIC_STABILITY_ALLOWED for
      // every non-specialized mode, so three stable reads over four seconds were
      // enough to treat a still-streaming answer as settled. v0.12.12 then ran
      // RESPONSE_CONSUME regardless of the parse outcome, closing the causal
      // effect while ChatGPT was still writing the trailer. When the real answer
      // finally landed, its owner had already been consumed and no producer
      // remained. An incomplete trailer that the page cannot confirm as terminal
      // means "still growing", so keep observing; the candidate keeps its bounded
      // settle deadline, so this cannot wait forever.
      const controlTrailerIncomplete = Boolean(
        responseContract === START_RESPONSE_CONTRACTS.TURN_BOUND_5 &&
        !targetResult.valid &&
        targetResult.reason === "PROTOCOL_TRAILER_NOT_EXACT" &&
        page.latestAssistantComplete !== true &&
        !terminalResponseAuthoritative
      );
      if (controlTrailerIncomplete) {
        addAudit(audit, {
          kind: "info",
          title: "CONTROL-response fortsätter observeras",
          detail:
            `${targetResult.reason} · hash=${sanitizeText(page.latestAssistantHash, 24)} · ` +
            `complete=${page.latestAssistantComplete === true ? "1" : "0"} · ` +
            `owner behålls; soft stability räcker inte för att konsumera en TURN_BOUND_5-response.`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        context.run = run;
        await writeRuntimeBundle(runtime, continuity, audit);
        return snapshotForWindow(windowId);
      }

      if (effect?.effectId) {
        const consume = commitCausalControl(run, {
          type: CAUSAL_EVENT.RESPONSE_CONSUME,
          responseIdentity: pageResponseIdentity
        }, { now });
        if (!consume.accepted) {
          throw new Error(`CAUSAL_RESPONSE_CONSUME_FAILED:${consume.reason || "UNKNOWN"}`);
        }
        run = consume.run;
      }

      // v0.11.12 dominant human-boundary invariant:
      // a valid OPERATOR_ACTION_REQUIRED tuple is latched before observation
      // identity, baseline/session-init routing, Nano, recovery, protocol repair
      // or deferred mission logic can run. The response identity is committed as
      // processed so an accepted operator receipt cannot immediately re-latch the
      // same assistant response on resume.
      if (operatorActionBoundaryEligible(targetResult)) {
        run = markObservationProcessed(run, {
          responseHash: page.latestAssistantHash,
          responseIdentity: pageResponseIdentity,
          assistantCount: page.assistantCount
        }, { now });
        context.run = run;
        return enterOperatorActionWait({
          runtime,
          continuity,
          audit,
          context,
          run,
          windowId,
          targetResult
        });
      }

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
      // v0.10.14: structural parsing is not semantic acceptance. The candidate stays
      // request-local until Nano's compact baseline analysis returns ACCEPT.
      if (baselineCandidate.valid) {
        addAudit(audit, {
          kind: "info",
          title: "Huvuduppgiftsbaslinje kandidat mottagen",
          detail: `${baselineCandidate.baseline.mainTask.title || baselineCandidate.baseline.mainTask.programGoal} · väntar på Nano-validering; continuity är ännu inte muterad.`,
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
      const nextPendingObservation = {
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
        latestAssistantTurnSeq: Number(page.latestAssistantTurnSeq || 0),
        observedAt: nowIso(),
        targetResult,
        protocolReminderRequired: !targetResult.valid
      };
      run = transferResponseCandidateToObservation(run, nextPendingObservation, {
        owner: responseOwnership.owner,
        reason: "CANDIDATE_TO_PENDING_OBSERVATION",
        now
      });
      if (run.responseOwnershipViolation) {
        run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
          origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
          reason: `${run.responseOwnershipViolation.code}: response-candidate och pending observation har olika identitet.`,
          now,
          force: true
        });
        context.run = run;
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(run.targetTabId, "BLOCKED", run.responseOwnershipViolation.code);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
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
      const initState = run.sessionContextInit?.state || "";
      const currentResponseIsBaselineCandidate = sessionContextInitBlocksWork(run.sessionContextInit) &&
        !mainTaskBaselinePresent &&
        baselineCandidate.valid === true;
      const baselineResponseForInit = currentResponseIsBaselineCandidate ||
        (sessionContextInitBlocksWork(run.sessionContextInit) &&
          !mainTaskBaselinePresent &&
          [SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE,
            SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING].includes(initState) &&
          ["SESSION_CONTEXT_BASELINE_REQUEST", "SESSION_CONTEXT_BASELINE_CORRECTION"]
            .includes(run.currentTurn?.kind || ""));

      if (baselineResponseForInit &&
          !mainTaskBaselinePresent &&
          sessionContextBaselineDelivery(run).delivered) {
        const deliveredFreshness = classifyDeliveredBaselineFreshnessChange(run, page, {
          requirePendingRequest: false
        });
        if (deliveredFreshness.kind === "OWNER_CHANGED") {
          run = supersedePendingObservation(run, page, audit, {
            windowId,
            reason: "Baseline response owner changed during post-delivery reconcile"
          });
          run = applySessionContextInitFailure(run, {
            windowId,
            audit,
            code: SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_RESPONSE_OWNER_CHANGED,
            detail: "Den aktuella sidan kan inte owner-bindas till den redan ACKED baselineleveransen. Ingen ny baselineprompt skickades.",
            now
          });
          context.run = run;
          await writeRuntimeBundle(runtime, continuity, audit);
          await notifyPanels(windowId);
          return snapshotForWindow(windowId);
        }
        if (deliveredFreshness.kind === "WAIT_FOR_CURRENT_BASELINE_RESPONSE") {
          run.pendingObservation = null;
          run = retireResponseCandidate(run, {
            status: RESPONSE_OBSERVATION_CYCLE_STATUS.SUPERSEDED,
            reason: "WAIT_FOR_CURRENT_BASELINE_RESPONSE_OWNER_ANCHOR",
            now
          });
          run.nanoTelemetry ||= {};
          run.nanoTelemetry.lastStatus = "BASELINE_OWNER_ANCHOR_WAIT";
          run.nanoTelemetry.lastResultSummary = "WAIT_FOR_CURRENT_BASELINE_RESPONSE_OWNER_ANCHOR";
          run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
            origin: PAUSE_ORIGINS.OBSERVATION_SUPERSEDED,
            reason: "ACKED baselineleverans finns men aktuell DOM saknar tillräcklig user-turn/assistant-owner-ankring. Väntar lokalt utan ny målprompt.",
            force: true
          });
          context.run = run;
          await writeRuntimeBundle(runtime, continuity, audit);
          await notifyPanels(windowId);
          return snapshotForWindow(windowId);
        }
      }

      if (!mainTaskBaselinePresent &&
          sessionContextInitBlocksWork(run.sessionContextInit) &&
          !baselineResponseForInit) {
        run = armMainTaskBaselineRequest(run, continuity, {
          now,
          observation: run.pendingObservation
        });
        context.run = run;
        if (run.responseOwnershipViolation) {
          addAudit(audit, {
            kind: "error",
            title: "Response-ownership invariant blockerade baseline-handoff",
            detail: `${sanitizeText(run.responseOwnershipViolation.code, 160)} · candidate=${sanitizeText(run.responseOwnershipViolation.candidateResponseIdentity || run.responseOwnershipViolation.candidateHash, 240)} · observation=${sanitizeText(run.responseOwnershipViolation.observationResponseIdentity || run.responseOwnershipViolation.observationHash, 240)}`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
          await writeRuntimeBundle(runtime, continuity, audit);
          await setTabIndicator(run.targetTabId, "BLOCKED", run.responseOwnershipViolation.code);
          await notifyPanels(windowId);
          return snapshotForWindow(windowId);
        }
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

      if (baselineResponseForInit) {
        if (currentResponseIsBaselineCandidate &&
            !["SESSION_CONTEXT_BASELINE_REQUEST", "SESSION_CONTEXT_BASELINE_CORRECTION"]
              .includes(run.currentTurn?.kind || "")) {
          addAudit(audit, {
            kind: "info",
            title: "Befintlig huvuduppgiftsbaslinje återanvänds utan dubbel prompt",
            detail: `${pageResponseIdentity} · direkt Nano-routingvalidering`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
        }
        run.sessionContextInit = advanceSessionContextInit(
          run.sessionContextInit,
          SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING,
          { baselineResponseIdentity: pageResponseIdentity },
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
      if (protocolDecisionPath === PROTOCOL_DECISION_PATHS.REPAIR_EXHAUSTED) {
        const repairFailureReason = sanitizeText(
          targetResult?.reason || "PROTOCOL_REPAIR_INVALID",
          600
        );
        run.pendingNanoRequest = null;
        run.waitingObservation = run.pendingObservation ? deepClone(run.pendingObservation) : null;
        run.pendingObservation = null;
        run.timeoutSuspended = true;
        run.responseDeadlineAt = null;
        run.waitingForUnlockEvent = "";
        run.runtimeDecisionStatus = `PROTOCOL_REPAIR_EXHAUSTED:${repairFailureReason}`;
        run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
          origin: PAUSE_ORIGINS.PROTOCOL_MISSING,
          reason:
            `Den enda bounded EIC-AA/5-protokollreparationen returnerade fortfarande ogiltigt kontrakt: ${repairFailureReason}. ` +
            "Ingen Nano-analys, lokal-state wake eller ny repair-turn skapas för samma repair-episod.",
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "blocked",
          title: "PROTOCOL_REPAIR_EXHAUSTED — repair-loop stoppad",
          detail: `${repairFailureReason} · currentTurn=${run.currentTurn?.turnId || "UNKNOWN"} · ingen ytterligare control-generation`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(run.targetTabId, "BLOCKED", "PROTOCOL_REPAIR_EXHAUSTED");
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
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
        analysisMode,
        sessionContextBaselineAnalysis: baselineResponseForInit,
        baselineCandidate: baselineCandidate.valid ? baselineCandidate.baseline : null,
        baselineParseErrors: baselineCandidate.errors || [],
        baselineResponseIdentity: pageResponseIdentity,
        baselineResponseExtractionComplete: page.latestAssistantExtractionComplete !== false,
        baselineResponseExtraction: page.latestAssistantExtraction || null
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
      run = bindSessionContextBaselineNanoRequest(run, { now });
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
      if (useProtocolRepairPath || useProtocolFastPath) {
        run = markObservationProcessed(run, run.pendingObservation, { now });
      } else {
        run.pendingNanoRequest.observedResponseIdentity = pageResponseIdentity;
        run.pendingNanoRequest.observedResponseHash = page.latestAssistantHash;
        run.pendingNanoRequest.observedAssistantCount = Number(page.assistantCount || 0);
      }
      run.lastProgressAt = nowIso();
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
  // v0.11.13: explicit mechanical-action and decision waits are owner-bound
  // human boundaries regardless of destructiveness metadata.
  if ([STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION].includes(run.state)) {
    return true;
  }
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
  const activeOperatorCandidate = activeOperatorCandidateForDecision(decision);
  const assessment = classifyDestructiveness({
    actionCode: activeOperatorCandidate?.actionCode,
    proposedAction: activeOperatorCandidate?.proposedAction,
    requestedAction: decision?.requestedAction,
    reason: decision?.reason,
    boundaryEvidence: decision?.boundaryEvidence,
    exactTarget,
    expectedEffect: activeOperatorCandidate?.expectedEffect,
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
    mandate: config?.targetMandateVersion || "target-core-v9",
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

async function dispatchMjolnarActionUnlocked(
  run,
  request,
  entry,
  observation = null,
  context = null,
  { persistDispatchFence = null } = {}
) {
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
      current.reloadReadback = createReloadReadbackExpectation({
        tabId,
        selectedTabId: context?.selectedTabId,
        linkedTab: context?.linkedTabs?.[String(tabId)] || null,
        tab: before,
        page,
        expectedContentVersion: CONTENT_SCRIPT_VERSION
      });
      if (typeof persistDispatchFence === "function") {
        await persistDispatchFence(current);
      }
      await chrome.tabs.reload(tabId);
      effectEvidence = [
        `reload-dispatched:tab=${tabId}`,
        `origin=${current.reloadReadback.origin}`,
        `conversation=${current.reloadReadback.conversationKey}`,
        `documentEpochBefore=${current.reloadReadback.documentEpoch}`,
        `content=${current.reloadReadback.contentVersion}`,
        "owner-read-required-on-next-tick"
      ].join(";");
      break;
    }
    case "HARD_RELOAD_SELECTED_TAB": {
      const page = await readPage(tabId, "mjolnar-hard-reload-preflight");
      if (page.generating || page.backgroundSignals?.active) throw new Error("MJOLNAR_ACTIVE_TASK_HARD_RELOAD_DENIED");
      current.reloadReadback = createHardReloadReadbackExpectation({
        tabId,
        selectedTabId: context?.selectedTabId,
        linkedTab: context?.linkedTabs?.[String(tabId)] || null,
        tab: before,
        page,
        expectedContentVersion: CONTENT_SCRIPT_VERSION
      });
      if (typeof persistDispatchFence === "function") {
        await persistDispatchFence(current);
      }
      await chrome.tabs.reload(tabId, { bypassCache: true });
      effectEvidence = [
        `hard-reload-dispatched:tab=${tabId}`,
        "reloadMode=HARD_BYPASS_CACHE",
        "bypassCache=true",
        `origin=${current.reloadReadback.origin}`,
        `conversation=${current.reloadReadback.conversationKey}`,
        `documentEpochBefore=${current.reloadReadback.documentEpoch}`,
        `content=${current.reloadReadback.contentVersion}`,
        "owner-read-required-on-next-tick"
      ].join(";");
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
  if (["RELOAD_SELECTED_TAB", "HARD_RELOAD_SELECTED_TAB"].includes(request.action_code)) {
    current.readbackStatus = "PENDING_NEXT_TICK";
    return { entry: current, verified: false, effectEvidence };
  }
  current = markMjolnarDispatch(current, "VERIFIED_EFFECT", effectEvidence);
  return { entry: current, verified: true, effectEvidence };
}


async function reconcileMjolnarReadbackUnlocked(run, page, tab, context = null) {
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
  let hardReadbackReasons = [];
  switch (last.actionCode) {
    case "REFRESH_TAB_STATUS":
      match = Boolean(page?.supported && page?.snapshotHash);
      evidence = `snapshot=${page?.snapshotHash || ""}`;
      break;
    case "RECONNECT_CONTENT":
      match = page?.version === CONTENT_SCRIPT_VERSION;
      evidence = `content=${page?.version || "UNKNOWN"};document=${page?.documentEpoch || ""}`;
      break;
    case "RELOAD_SELECTED_TAB": {
      const reloadReadback = evaluateReloadSelectedTabReadback(last.reloadReadback, {
        selectedTabId: context?.selectedTabId,
        linkedTab: context?.linkedTabs?.[String(last.reloadReadback?.tabId ?? run.targetTabId)] || null,
        controllerSurface: chatGptControllerSurface(context),
        tab,
        page,
        expectedContentVersion: CONTENT_SCRIPT_VERSION
      });
      match = reloadReadback.match;
      evidence = reloadReadback.evidence;
      break;
    }
    case "HARD_RELOAD_SELECTED_TAB": {
      const reloadReadback = evaluateHardReloadSelectedTabReadback(last.reloadReadback, {
        selectedTabId: context?.selectedTabId,
        linkedTab: context?.linkedTabs?.[String(last.reloadReadback?.tabId ?? run.targetTabId)] || null,
        controllerSurface: chatGptControllerSurface(context),
        tab,
        page,
        expectedContentVersion: CONTENT_SCRIPT_VERSION
      });
      match = reloadReadback.match;
      evidence = reloadReadback.evidence;
      hardReadbackReasons = reloadReadback.reasons;
      break;
    }
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

  if (last.actionCode === "HARD_RELOAD_SELECTED_TAB" && !match) {
    const expired = hardReadbackReasons.includes("HARD_RELOAD_READBACK_TTL_EXPIRED") ||
      hardReadbackReasons.includes("HARD_RELOAD_READBACK_DEADLINE_MISSING");
    if (!expired) {
      const pending = markMjolnarDispatch(last, "READBACK_PENDING", evidence);
      pending.readbackStatus = "PENDING_WITHIN_TTL";
      pending.readbackAttempts = Math.max(0, Number(last.readbackAttempts || 0)) + 1;
      run.mjolnar.ledger[ledger.length - 1] = pending;
      run.mjolnar.state = MJOLNAR_STATES.READBACK_PENDING;
      run = transitionRun(run, STATES.MJOLNAR_READBACK, {
        origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
        reason: "Hard reload väntar inom bounded readback-TTL på ny document epoch, frisk bridge och samma target identity; ingen reload redispatchas.",
        force: true
      });
      return { run, handled: true, verified: false };
    }

    const failed = markMjolnarDispatch(last, "READBACK_FAILED", evidence);
    failed.readbackAt = nowIso();
    failed.readbackStatus = "TIMEOUT_EXPLICIT_FAILURE";
    run.mjolnar.ledger[ledger.length - 1] = failed;
    run.mjolnar.state = MJOLNAR_STATES.READ_REQUIRED;
    appendRecoveryAttempt(run, makeRecoveryAttempt("HARD_RELOAD_READBACK_TIMEOUT", {
      outcome: "EXPLICIT_FAILURE",
      detail: "Hard reload återanknöt inte inom bounded TTL; ingen automatisk reload-retry utfördes."
    }));
    run = transitionRun(run, STATES.RECOVERING, {
      origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
      reason: "HARD_RELOAD_SELECTED_TAB readback timeout: explicit failure efter bounded TTL; färsk owner-read krävs före eventuell ny separat åtgärd.",
      force: true
    });
    return { run, handled: false, verified: false };
  }

  if (match) {
    const verified = markMjolnarDispatch(last, "VERIFIED_EFFECT", evidence);
    run.mjolnar.ledger[ledger.length - 1] = verified;
    run.mjolnar.state = MJOLNAR_STATES.VERIFIED_EFFECT;
    const reloadVerified = ["RELOAD_SELECTED_TAB", "HARD_RELOAD_SELECTED_TAB"].includes(last.actionCode);
    run = transitionRun(run, reloadVerified ? STATES.ASSESSING : STATES.WAITING_FOR_RESPONSE, {
      origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
      reason: reloadVerified
        ? `${last.actionCode === "HARD_RELOAD_SELECTED_TAB" ? "Hard" : "Normal"} reload owner-readback verifierad utan promptrespons: ${evidence}`
        : `Mjölnar owner-readback matchade efter återstart: ${evidence}`,
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
  runtime,
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

  const priorLedger = run.mjolnar?.ledger || [];
  if (candidate.actionCode === "HARD_RELOAD_SELECTED_TAB") {
    const activeMutation = findActiveBrowserMutation(priorLedger);
    if (activeMutation) {
      run.mjolnar.state = MJOLNAR_STATES.READBACK_PENDING;
      run = transitionRun(run, STATES.MJOLNAR_READBACK, {
        origin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
        reason: `Hard reload avvisas medan browsermutation ${activeMutation.actionCode} fortfarande äger readback.`,
        force: true
      });
      return { run, handled: true, verified: false };
    }
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
    const persistReloadDispatchFence = async (fencedEntry) => {
      run.mjolnar.ledger[run.mjolnar.ledger.length - 1] = fencedEntry;
      context.run = run;
      await writeRuntimeBundle(runtime, continuity, audit);
    };
    const result = await dispatchMjolnarActionUnlocked(
      run,
      request,
      entry,
      observation,
      context,
      { persistDispatchFence: persistReloadDispatchFence }
    );
    run.mjolnar.ledger[run.mjolnar.ledger.length - 1] = result.entry;
    run.mjolnar.state = result.verified ? MJOLNAR_STATES.VERIFIED_EFFECT : MJOLNAR_STATES.READBACK_PENDING;
    run.mjolnar.activeResponse = {
      ...response,
      effectEvidence: result.effectEvidence
    };
    if (result.privilegedHandoff) {
      run.mjolnar.state = MJOLNAR_STATES.READBACK_PENDING;
      run = retireResponseCandidate(run, {
        status: RESPONSE_OBSERVATION_CYCLE_STATUS.SUPERSEDED,
        reason: "MJOLNAR_PRIVILEGED_HANDOFF",
        now: Date.now()
      });
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


function sessionContextCommitFailureData(receipt, diagnostics, {
  errorCode = "SESSION_CONTEXT_BASELINE_COMMIT_FAILED",
  errorDetail = ""
} = {}) {
  return {
    requestId: sanitizeText(receipt?.requestId, 180),
    claimId: sanitizeText(receipt?.claimId, 180),
    decisionDigest: sanitizeText(receipt?.decisionDigest, 96),
    receiptDigest: sanitizeText(receipt?.decisionDigest, 96),
    expectedContinuityDigest: sanitizeText(diagnostics?.expectedContinuityDigest, 96),
    storedContinuityDigest: sanitizeText(diagnostics?.storedContinuityDigest, 96),
    recomputedContinuityDigest: sanitizeText(diagnostics?.recomputedContinuityDigest, 96),
    verificationReason: sanitizeText(diagnostics?.verificationReason, 160),
    attempt: Math.max(0, Number(receipt?.commitAttemptCount || 0)),
    errorCode: sanitizeText(errorCode, 160),
    errorDetail: sanitizeText(errorDetail, 1200),
    retryEligible: true,
    nanoRerunRequired: false
  };
}

async function recordSessionContextBaselineCommitFailure({
  windowId,
  run,
  receipt,
  diagnostics,
  errorCode,
  errorDetail,
  readyFinalization = false,
  now = Date.now()
} = {}) {
  const attempt = readyFinalization
    ? Math.max(0, Number(receipt?.readyAttemptCount || 0))
    : Math.max(0, Number(receipt?.commitAttemptCount || 0));
  const event = readyFinalization
    ? "session-context-init.ready-commit-failed"
    : "session-context-baseline.commit-failed";
  await persistApplicationEventOnce({
    level: "error",
    event,
    correlationId: `${sanitizeText(receipt?.requestId, 180)}:${readyFinalization ? "ready" : "commit"}:${attempt}`,
    message: readyFinalization
      ? "Nano-beslutet är semantiskt giltigt och baslinjen committed, men READY-finalisering misslyckades."
      : "Nano-beslutet är semantiskt giltigt, men baseline/decision-commit misslyckades.",
    windowId,
    tabId: run?.targetTabId || null,
    runId: run?.runId || null,
    data: {
      ...sessionContextCommitFailureData(receipt, diagnostics, { errorCode, errorDetail }),
      attempt,
      semanticDecisionSucceeded: true,
      commitAttempted: true,
      commitFailed: true
    },
    now
  });
}

async function persistBaselineCommitFailureState({
  windowId,
  runtime,
  audit,
  continuity,
  context,
  run,
  receipt,
  error,
  readyFinalization = false,
  now = Date.now()
} = {}) {
  const errorCode = sanitizeText(
    error?.code ||
      (readyFinalization
        ? "SESSION_CONTEXT_READY_COMMIT_FAILED"
        : "SESSION_CONTEXT_BASELINE_COMMIT_FAILED"),
    160
  );
  const errorDetail = sanitizeText(
    error instanceof Error ? error.message : String(error || errorCode),
    1200
  );
  const diagnostics = error?.commitDiagnostics ||
    baselineCommitDiagnosticsFromError(error);

  if (readyFinalization) {
    receipt = failSessionContextReadyFinalization(receipt, {
      code: errorCode,
      detail: errorDetail,
      now
    });
  } else {
    receipt = failSessionContextBaselineCommit(receipt, {
      code: errorCode,
      detail: errorDetail,
      diagnostics,
      now
    });
  }

  const blockedInit = advanceSessionContextInit(
    run.sessionContextInit,
    SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING,
    {
      completedAt: null,
      baselineDecisionCommit: receipt
    },
    { now, force: true }
  );
  run.sessionContextInit = blockedInit;
  run.runtimeDecisionStatus = "NANO_DECISION_COMMIT_FAILED";
  run.nanoTelemetry ||= {};
  run.nanoTelemetry.lastStatus = "DECISION_COMMIT_FAILED";
  run.nanoTelemetry.lastError = errorDetail;
  context.run = run;

  addAudit(audit, {
    kind: "blocked",
    title: readyFinalization
      ? "READY-finalisering misslyckades efter committed Nano-baseline"
      : "Nano-baselinebeslut kunde inte committed till durable storage",
    detail: `${errorCode} · request ${receipt?.requestId || "okänd"} · ` +
      `attempt ${readyFinalization ? receipt?.readyAttemptCount : receipt?.commitAttemptCount} · ` +
      "Nano-rerun krävs inte.",
    windowId,
    tabId: run.targetTabId,
    runId: run.runId
  });

  try {
    await writeRuntimeBundle(runtime, continuity, audit, windowId);
  } catch {
    // writeRuntimeBundle has already attempted its bounded emergency persistence.
    // The semantic receipt is also emitted below through the independent application log.
  }

  await recordSessionContextBaselineCommitFailure({
    windowId,
    run,
    receipt,
    diagnostics,
    errorCode,
    errorDetail,
    readyFinalization,
    now
  });

  return { run, receipt, diagnostics, errorCode, errorDetail };
}

function sessionContextReadySuccessEvidencePending(run) {
  const init = run?.sessionContextInit || null;
  const receipt = init?.baselineDecisionCommit || null;
  return init?.state === SESSION_CONTEXT_INIT_STATE.READY &&
    receipt?.commitStatus === SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED &&
    receipt?.readyStatus === SESSION_CONTEXT_READY_FINALIZATION_STATUS.READY &&
    !receipt?.successAuditEmittedAt;
}

function sessionContextReadyAuditPresent(audit, {
  windowId,
  runId
} = {}) {
  return (audit?.items || []).some((item) =>
    item?.title === "Sessionskontext initierad" &&
    item?.windowId === windowId &&
    item?.runId === runId
  );
}

async function persistSessionContextReadyAuditOnce({
  audit,
  windowId,
  run,
  now = Date.now()
} = {}) {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.AUDIT]);
    const nextAudit = stored[STORAGE_KEYS.AUDIT] || createDefaultAudit();
    const duplicate = sessionContextReadyAuditPresent(nextAudit, {
      windowId,
      runId: run?.runId || null
    });
    if (!duplicate) {
      addAudit(nextAudit, {
        kind: "done",
        title: "Sessionskontext initierad",
        detail: "Catch, eic.main-task-baseline.v3 och Nano-spårkontroll är durable verifierade. Vanlig agentbearbetning får nu fortsätta.",
        windowId,
        tabId: run?.targetTabId || null,
        runId: run?.runId || null,
        now
      });
      await chrome.storage.local.set({ [STORAGE_KEYS.AUDIT]: nextAudit });
    }
    const readback = await chrome.storage.local.get([STORAGE_KEYS.AUDIT]);
    const persistedAudit = readback[STORAGE_KEYS.AUDIT] || null;
    if (!sessionContextReadyAuditPresent(persistedAudit, {
      windowId,
      runId: run?.runId || null
    })) {
      return { persisted: false, duplicate, reason: "READY_SUCCESS_AUDIT_READBACK_MISSING" };
    }
    if (audit && typeof audit === "object") {
      Object.assign(audit, deepClone(persistedAudit));
    }
    return { persisted: true, duplicate, reason: "OK" };
  } catch (error) {
    return {
      persisted: false,
      duplicate: false,
      reason: sanitizeText(
        error instanceof Error ? error.message : String(error || "READY_SUCCESS_AUDIT_PERSIST_FAILED"),
        800
      ) || "READY_SUCCESS_AUDIT_PERSIST_FAILED"
    };
  }
}

async function persistSessionContextReadySuccessEvidence({
  windowId,
  runtime,
  audit,
  continuity,
  context,
  run,
  receipt,
  now = Date.now()
} = {}) {
  if (run?.sessionContextInit?.state !== SESSION_CONTEXT_INIT_STATE.READY ||
      receipt?.commitStatus !== SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED ||
      receipt?.readyStatus !== SESSION_CONTEXT_READY_FINALIZATION_STATUS.READY) {
    return {
      persisted: false,
      receipt,
      reason: "READY_NOT_OWNER_VERIFIED"
    };
  }
  if (receipt.successAuditEmittedAt) {
    return { persisted: true, receipt, reason: "ALREADY_DELIVERED" };
  }

  const readyEvent = await persistSessionContextReadyApplicationEventOnce({
    correlationId: receipt.decisionDigest,
    windowId,
    tabId: run.targetTabId,
    runId: run.runId,
    data: {
      requestId: receipt.requestId,
      claimId: receipt.claimId,
      decisionDigest: receipt.decisionDigest,
      commitStatus: receipt.commitStatus,
      readyStatus: receipt.readyStatus,
      commitAttemptCount: receipt.commitAttemptCount,
      readyAttemptCount: receipt.readyAttemptCount,
      nanoRerunRequired: false
    },
    now
  });
  if (!readyEvent.persisted) {
    return {
      persisted: false,
      receipt,
      reason: sanitizeText(readyEvent.reason, 800) || "READY_SUCCESS_EVENT_PERSIST_FAILED"
    };
  }

  const auditResult = await persistSessionContextReadyAuditOnce({
    audit,
    windowId,
    run,
    now
  });
  if (!auditResult.persisted) {
    return {
      persisted: false,
      receipt,
      reason: sanitizeText(auditResult.reason, 800) || "READY_SUCCESS_AUDIT_PERSIST_FAILED"
    };
  }

  const priorReceipt = receipt;
  const emittedAt = nowIso(now);
  const candidateReceipt = completeSessionContextReadyFinalization(receipt, {
    successAuditEmittedAt: emittedAt,
    now
  });
  run.sessionContextInit = {
    ...run.sessionContextInit,
    baselineDecisionCommit: candidateReceipt
  };
  context.run = run;

  try {
    const sealed = await writeRuntimeBundle(runtime, continuity, audit, windowId);
    const readback = await verifySessionContextBaselineCommitReadback(
      windowId,
      candidateReceipt,
      {
        expectedContinuityDigest: sealed?.integrity?.digest || "",
        requireCommittedReceipt: true,
        requireReady: true,
        requireReadyReceipt: true
      }
    );
    if (!readback.valid ||
        readback.persistedReceipt?.successAuditEmittedAt !==
          candidateReceipt.successAuditEmittedAt) {
      run.sessionContextInit = {
        ...run.sessionContextInit,
        baselineDecisionCommit: priorReceipt
      };
      context.run = run;
      return {
        persisted: false,
        receipt: priorReceipt,
        reason: !readback.valid
          ? `READY_SUCCESS_RECEIPT_READBACK_MISMATCH:${readback.reason}`
          : "READY_SUCCESS_RECEIPT_TIMESTAMP_MISMATCH"
      };
    }
    return {
      persisted: true,
      receipt: deepClone(readback.persistedReceipt),
      reason: "OK"
    };
  } catch (error) {
    run.sessionContextInit = {
      ...run.sessionContextInit,
      baselineDecisionCommit: priorReceipt
    };
    context.run = run;
    return {
      persisted: false,
      receipt: priorReceipt,
      reason: sanitizeText(
        error instanceof Error ? error.message : String(error || "READY_SUCCESS_RECEIPT_PERSIST_FAILED"),
        800
      ) || "READY_SUCCESS_RECEIPT_PERSIST_FAILED"
    };
  }
}

async function commitSessionContextBaselineDecision({
  windowId,
  runtime,
  audit,
  continuity,
  context,
  run,
  request,
  payload,
  baselineAnalysis,
  decision,
  now = Date.now()
} = {}) {
  let receipt = run.sessionContextInit?.baselineDecisionCommit || null;
  const existingReceipt = Boolean(
    receipt?.requestId &&
    receipt.requestId === request.requestId
  );

  if (!existingReceipt) {
    const acceptedBaseline = deepClone(
      request.baselineCandidate || baselineAnalysis?.normalizedBaseline || null
    );
    const candidateDigest = await sha256Hex(stableStringify(acceptedBaseline));
    const decisionDigest = await sha256Hex(stableStringify({
      requestId: request.requestId,
      claimId: payload?.claimId || request.claimId || "",
      analysisMode: request.mode || payload?.analysisMode || "",
      baselineResponseIdentity: request.baselineResponseIdentity || "",
      baselineAnalysis,
      decision,
      candidateDigest
    }));
    const forensicsDigest = payload?.forensics
      ? await sha256Hex(stableStringify(payload.forensics))
      : "";
    receipt = createSessionContextBaselineCommitReceipt({
      requestId: request.requestId,
      claimId: payload?.claimId || request.claimId || "",
      analysisMode: request.mode || payload?.analysisMode || "",
      baselineResponseIdentity: request.baselineResponseIdentity || "",
      semanticVerdict: baselineAnalysis?.verdict || "",
      normalizedBaselineAccepted: baselineAnalysis?.normalizedBaselineAccepted === true,
      acceptedBaseline,
      candidateDigest,
      decisionDigest,
      decision,
      baselineAnalysis,
      nanoOutputDigest: payload?.forensics?.outputSha256 || "",
      forensicsDigest,
      now
    });
    run.sessionContextInit = {
      ...run.sessionContextInit,
      baselineDecisionCommit: receipt
    };
    run.runtimeDecisionStatus = "NANO_DECISION_READY";
    run.nanoTelemetry ||= {};
    run.nanoTelemetry.lastStatus = "DECISION_READY";
    context.run = run;
    addAudit(audit, {
      kind: "info",
      title: "Nano-baselinebeslut DECISION_READY",
      detail: `${request.requestId} · ${receipt.decisionDigest} · durable commit krävs före READY.`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });

    try {
      const decisionReadySealed = await writeRuntimeBundle(runtime, continuity, audit, windowId);
      const decisionReadyReadback = await verifySessionContextBaselineCommitReadback(
        windowId,
        receipt,
        {
          expectedContinuityDigest: decisionReadySealed?.integrity?.digest || "",
          requireBaseline: false
        }
      );
      if (!decisionReadyReadback.valid ||
          decisionReadyReadback.persistedReceipt?.commitStatus !==
            SESSION_CONTEXT_BASELINE_COMMIT_STATUS.DECISION_READY) {
        const error = new Error(
          `SESSION_CONTEXT_DECISION_READY_READBACK_MISMATCH:${
            decisionReadyReadback.reason ||
            decisionReadyReadback.persistedReceipt?.commitStatus ||
            "UNKNOWN"
          }`
        );
        error.code = "SESSION_CONTEXT_DECISION_READY_READBACK_MISMATCH";
        error.commitDiagnostics = decisionReadyReadback.diagnostics;
        throw error;
      }
    } catch (error) {
      const failure = await persistBaselineCommitFailureState({
        windowId,
        runtime,
        audit,
        continuity,
        context,
        run,
        receipt,
        error,
        now
      });
      return { ok: false, ...failure };
    }
  } else {
    baselineAnalysis = deepClone(receipt.baselineAnalysis || baselineAnalysis || {});
    decision = deepClone(receipt.decision || decision || {});
  }

  if (receipt.semanticVerdict !== "ACCEPT" ||
      receipt.normalizedBaselineAccepted !== true ||
      !receipt.acceptedBaseline) {
    const error = new Error("SESSION_CONTEXT_BASELINE_COMMIT_RECEIPT_NOT_ACCEPTED");
    error.code = "SESSION_CONTEXT_BASELINE_COMMIT_RECEIPT_NOT_ACCEPTED";
    const failure = await persistBaselineCommitFailureState({
      windowId,
      runtime,
      audit,
      continuity,
      context,
      run,
      receipt,
      error,
      now
    });
    return { ok: false, ...failure };
  }

  if (receipt.commitStatus !== SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED) {
    const existingBaselineDigest = continuity?.mainTaskBaseline
      ? await sha256Hex(stableStringify(continuity.mainTaskBaseline))
      : "";
    if (existingBaselineDigest !== receipt.candidateDigest &&
        !adoptMainTaskBaseline(continuity, receipt.acceptedBaseline, { now })) {
      const error = new Error("BASELINE_ANALYSIS_ACCEPT_WITHOUT_ADOPTABLE_CANDIDATE");
      error.code = "SESSION_CONTEXT_BASELINE_COMMIT_CANDIDATE_ADOPTION_FAILED";
      const failure = await persistBaselineCommitFailureState({
        windowId,
        runtime,
        audit,
        continuity,
        context,
        run,
        receipt,
        error,
        now
      });
      return { ok: false, ...failure };
    }

    receipt = beginSessionContextBaselineCommit(receipt, { now });
    run.sessionContextInit = {
      ...run.sessionContextInit,
      baselineDecisionCommit: receipt
    };
    run.runtimeDecisionStatus = "NANO_DECISION_COMMITTING";
    run.nanoTelemetry ||= {};
    run.nanoTelemetry.lastStatus = "COMMITTING";
    context.run = run;

    try {
      const sealed = await writeRuntimeBundle(runtime, continuity, audit, windowId);
      const firstReadback = await verifySessionContextBaselineCommitReadback(
        windowId,
        receipt,
        { expectedContinuityDigest: sealed?.integrity?.digest || "" }
      );
      if (!firstReadback.valid) {
        const error = new Error(
          `SESSION_CONTEXT_BASELINE_COMMIT_READBACK_MISMATCH:${firstReadback.reason}`
        );
        error.code = "SESSION_CONTEXT_BASELINE_COMMIT_READBACK_MISMATCH";
        error.commitDiagnostics = firstReadback.diagnostics;
        throw error;
      }

      receipt = completeSessionContextBaselineCommit(receipt, {
        diagnostics: firstReadback.diagnostics,
        now
      });
      run.sessionContextInit = {
        ...run.sessionContextInit,
        baselineDecisionCommit: receipt
      };
      run.runtimeDecisionStatus = "NANO_BASELINE_COMMITTED";
      run.nanoTelemetry.lastStatus = "COMMITTED";
      context.run = run;

      const committedSealed = await writeRuntimeBundle(runtime, continuity, audit, windowId);
      const committedReadback = await verifySessionContextBaselineCommitReadback(
        windowId,
        receipt,
        {
          expectedContinuityDigest: committedSealed?.integrity?.digest || "",
          requireCommittedReceipt: true
        }
      );
      if (!committedReadback.valid) {
        const error = new Error(
          `SESSION_CONTEXT_BASELINE_COMMITTED_RECEIPT_MISMATCH:${committedReadback.reason}`
        );
        error.code = "SESSION_CONTEXT_BASELINE_COMMITTED_RECEIPT_MISMATCH";
        error.commitDiagnostics = committedReadback.diagnostics;
        throw error;
      }

      await persistApplicationEventOnce({
        level: "info",
        event: "session-context-baseline.commit-verified",
        correlationId: receipt.decisionDigest,
        message: "Nano-baselinebeslutet persisted och verifierades genom owner readback.",
        windowId,
        tabId: run.targetTabId,
        runId: run.runId,
        data: {
          requestId: receipt.requestId,
          claimId: receipt.claimId,
          decisionDigest: receipt.decisionDigest,
          candidateDigest: receipt.candidateDigest,
          expectedContinuityDigest: committedReadback.diagnostics.expectedContinuityDigest,
          storedContinuityDigest: committedReadback.diagnostics.storedContinuityDigest,
          recomputedContinuityDigest: committedReadback.diagnostics.recomputedContinuityDigest,
          verificationReason: committedReadback.diagnostics.verificationReason,
          attempt: receipt.commitAttemptCount,
          commitStatus: receipt.commitStatus,
          nanoRerunRequired: false
        },
        now
      });
    } catch (error) {
      const failure = await persistBaselineCommitFailureState({
        windowId,
        runtime,
        audit,
        continuity,
        context,
        run,
        receipt,
        error,
        now
      });
      return { ok: false, ...failure };
    }
  } else if (!continuity?.mainTaskBaseline) {
    adoptMainTaskBaseline(continuity, receipt.acceptedBaseline, { now });
  }

  if (receipt.readyStatus !== SESSION_CONTEXT_READY_FINALIZATION_STATUS.READY ||
      run.sessionContextInit?.state !== SESSION_CONTEXT_INIT_STATE.READY) {
    receipt = beginSessionContextReadyFinalization(receipt, { now });
    run.sessionContextInit = advanceSessionContextInit(
      run.sessionContextInit,
      SESSION_CONTEXT_INIT_STATE.READY,
      {
        nanoRequestId: request.requestId,
        baselineDecisionCommit: receipt
      },
      { now, force: true }
    );
    run.runtimeDecisionStatus = "NANO_BASELINE_READY_COMMITTING";
    run.nanoTelemetry ||= {};
    run.nanoTelemetry.lastStatus = "READY_COMMITTING";
    context.run = run;

    try {
      const readySealed = await writeRuntimeBundle(runtime, continuity, audit, windowId);
      const readyReadback = await verifySessionContextBaselineCommitReadback(
        windowId,
        receipt,
        {
          expectedContinuityDigest: readySealed?.integrity?.digest || "",
          requireCommittedReceipt: true,
          requireReady: true
        }
      );
      if (!readyReadback.valid) {
        const error = new Error(
          `SESSION_CONTEXT_READY_READBACK_MISMATCH:${readyReadback.reason}`
        );
        error.code = "SESSION_CONTEXT_READY_READBACK_MISMATCH";
        error.commitDiagnostics = readyReadback.diagnostics;
        throw error;
      }

      // Final READY is persisted/read back without any durable success claim.
      // Only after this receipt itself is owner-verified may success evidence be emitted.
      receipt = completeSessionContextReadyFinalization(receipt, { now });
      run.sessionContextInit = {
        ...run.sessionContextInit,
        baselineDecisionCommit: receipt
      };
      run.runtimeDecisionStatus = "NANO_BASELINE_READY_COMMITTED";
      run.nanoTelemetry.lastStatus = "READY";
      context.run = run;

      const finalReadySealed = await writeRuntimeBundle(runtime, continuity, audit, windowId);
      const finalReadyReadback = await verifySessionContextBaselineCommitReadback(
        windowId,
        receipt,
        {
          expectedContinuityDigest: finalReadySealed?.integrity?.digest || "",
          requireCommittedReceipt: true,
          requireReady: true,
          requireReadyReceipt: true
        }
      );
      if (!finalReadyReadback.valid) {
        const error = new Error(
          `SESSION_CONTEXT_READY_RECEIPT_READBACK_MISMATCH:${finalReadyReadback.reason}`
        );
        error.code = "SESSION_CONTEXT_READY_RECEIPT_READBACK_MISMATCH";
        error.commitDiagnostics = finalReadyReadback.diagnostics;
        throw error;
      }
    } catch (error) {
      const failure = await persistBaselineCommitFailureState({
        windowId,
        runtime,
        audit,
        continuity,
        context,
        run,
        receipt,
        error,
        readyFinalization: true,
        now
      });
      return { ok: false, ...failure };
    }
  }

  let successEvidencePersisted = Boolean(receipt.successAuditEmittedAt);
  if (sessionContextReadySuccessEvidencePending(run)) {
    const evidenceResult = await persistSessionContextReadySuccessEvidence({
      windowId,
      runtime,
      audit,
      continuity,
      context,
      run,
      receipt,
      now
    });
    receipt = evidenceResult.receipt || receipt;
    run = context.run || run;
    successEvidencePersisted = evidenceResult.persisted === true;
  }

  return {
    ok: true,
    run,
    receipt,
    baselineAnalysis: deepClone(receipt.baselineAnalysis || baselineAnalysis || {}),
    decision: deepClone(receipt.decision || decision || {}),
    successEvidencePersisted,
    readyVerified: run.sessionContextInit?.state === SESSION_CONTEXT_INIT_STATE.READY &&
      receipt.readyStatus === SESSION_CONTEXT_READY_FINALIZATION_STATUS.READY
  };
}

function finalizeNanoTerminalOwnership(runValue, context, {
  terminalRequest = null,
  source = NANO_DECISION_SOURCE.NANO,
  runtimeDecisionStatus = "",
  nanoTelemetryStatus = "",
  preserveObservation = false,
  retireWaitingObservation = false,
  event = "request-completed",
  windowId = null,
  now = Date.now()
} = {}) {
  let run = runValue;
  if (!run) return run;
  if (terminalRequest?.requestId) {
    run = recordDecisionTrace(run, terminalRequest, { source, now }).run;
  }
  run = finalizeNanoTerminalOwnershipState(run, {
    runtimeDecisionStatus,
    nanoTelemetryStatus,
    preserveObservation,
    retireWaitingObservation
  });
  context.nanoHostTelemetry = normalizeNanoHostTelemetry(context.nanoHostTelemetry, {
    busy: false,
    event
  });
  const numericWindowId = nullableInteger(windowId);
  const captureRelease = releaseDeferredSessionCapture(context.autoCaptureDeferral, {
    nanoOwned: nanoOwnsSessionCapture({
      run,
      nanoHostTelemetry: context.nanoHostTelemetry
    }),
    now
  });
  context.autoCaptureDeferral = captureRelease.deferral;
  if (captureRelease.rearm && numericWindowId !== null) {
    autoCaptureNanoDeferred.delete(numericWindowId);
    if (context.autoCaptureGuard?.status === "STARTED") {
      context.autoCaptureGuard = null;
    }
    scheduleBackgroundAutoSessionCapture(numericWindowId, "nano-terminal-deferred");
  }
  return run;
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
    // v0.10.11 ROOT CAUSE FIX: `applicationLog` was referenced by the v0.10.10
    // `maybeReplayDeferredCoreSurfaceReview(...)` call below but never destructured
    // here, so *every* decision that reached that call threw
    // `ReferenceError: applicationLog is not defined` — before any persistence, and
    // straight into the detached callback's `.catch(console.warn)`. That is the
    // exception the stalled live run never got to see.
    const { config, continuity: continuityValue, runtime, audit, applicationLog } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    let run = context.run;
    if ([STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION].includes(run?.state)) {
      // v0.11.13: stale Nano callbacks cannot cross an owner-bound human wait.
      return snapshotForWindow(windowId);
    }
    if (nanoTerminalDeliveryAlreadyFinalized(run, payload)) {
      return snapshotForWindow(windowId);
    }
    const entryReceipt = run?.sessionContextInit?.baselineDecisionCommit || null;
    const sameReceiptRequest = Boolean(
      entryReceipt?.requestId &&
      entryReceipt.requestId === payload?.requestId
    );
    const commitReplay = sameReceiptRequest &&
      sessionContextBaselineCommitNeedsRecovery(entryReceipt);

    // A duplicate transport for an already committed baseline receipt is
    // idempotent even when READY has already armed a *different* continuation
    // Nano request. The old baseline request id must never steal, cancel or
    // invalidate that newer microstep request.
    if (sameReceiptRequest &&
        !commitReplay &&
        run?.sessionContextInit?.state === SESSION_CONTEXT_INIT_STATE.READY &&
        entryReceipt.commitStatus === SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED &&
        entryReceipt.readyStatus === SESSION_CONTEXT_READY_FINALIZATION_STATUS.READY &&
        (!run?.pendingNanoRequest ||
         run.pendingNanoRequest.requestId !== payload?.requestId)) {
      return snapshotForWindow(windowId);
    }

    if (storageCircuitOpen && !commitReplay) {
      throw new Error("STORAGE_PERSISTENCE_FAILURE: Nano-beslut får inte leverera prompt.");
    }
    if (!run) throw new Error("Ingen körning väntar på Nano.");
    if (commitReplay && run.state !== STATES.ASSESSING) {
      run = transitionRun(run, STATES.ASSESSING, {
        origin: PAUSE_ORIGINS.NONE,
        reason: "Durable Nano-baselinecommit återupptas från semantisk decision receipt utan ny inference.",
        force: true
      });
      context.run = run;
    }
    if (run.state !== STATES.ASSESSING) throw new Error("Ingen ASSESSING-körning väntar på Nano.");
    if (!run.pendingNanoRequest ||
        (!commitReplay && run.pendingNanoRequest.requestId !== payload?.requestId)) {
      throw new Error("Stale eller fel Nano request_id.");
    }

    const request = run.pendingNanoRequest;

    // v0.11.12 defensive latch: preserved/recovered observations from older
    // callbacks must also honor OPERATOR_ACTION_REQUIRED before any Nano or
    // session-init commit branch. The normal live path is latched earlier in
    // tickWindowUnlocked immediately after parseTargetResult().
    const pendingProtocolResult = run.pendingObservation?.targetResult || null;
    if (operatorActionBoundaryEligible(pendingProtocolResult)) {
      return enterOperatorActionWait({
        runtime,
        continuity: continuityValue,
        audit,
        context,
        run,
        windowId,
        targetResult: pendingProtocolResult
      });
    }

    let baselinePromptOnly = request.baselinePromptOnly === true;
    const requestedSource = String(payload?.source || "NANO").toUpperCase();
    const source = requestedSource === NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
      ? NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
      : requestedSource === NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY
        ? NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY
        : requestedSource === NANO_DECISION_SOURCE.DETERMINISTIC_FALLBACK || requestedSource === "DETERMINISTIC"
          ? NANO_DECISION_SOURCE.DETERMINISTIC_FALLBACK
          : NANO_DECISION_SOURCE.NANO;
    const now = Date.now();

    // v0.11.3 causal init gate: before durable READY the only legal Nano
    // decision is the exact typed baseline-analysis request (or a durable commit
    // replay). Ordinary continuation/recovery requests are rejected locally and
    // the ACKED baseline lineage is reconciled instead of mutating mission state.
    const preReadySessionControlRequest = Boolean(
      request.baselinePromptOnly === true &&
      source === NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
    );
    if (!sessionContextAllowsOrdinaryNano(run, { commitReplay }) &&
        request.sessionContextBaselineAnalysis !== true &&
        !preReadySessionControlRequest) {
      const rejectedRequestId = sanitizeText(request.requestId, 180);
      run.lastRejectedPreReadyNanoRequest = {
        requestId: rejectedRequestId,
        mode: sanitizeText(request.mode, 120),
        sessionContextBaselineAnalysis: false,
        reason: "SESSION_CONTEXT_PRE_READY_ORDINARY_NANO_FORBIDDEN",
        at: nowIso(now)
      };
      run.pendingNanoRequest = null;
      run.runtimeDecisionStatus = "SESSION_CONTEXT_PRE_READY_ORDINARY_NANO_REJECTED";
      run.nanoTelemetry ||= {};
      run.nanoTelemetry.lastStatus = "PRE_READY_ORDINARY_NANO_REJECTED";
      run.nanoTelemetry.lastError = "SESSION_CONTEXT_PRE_READY_ORDINARY_NANO_FORBIDDEN";
      context.nanoHostTelemetry = normalizeNanoHostTelemetry(context.nanoHostTelemetry, {
        busy: false,
        event: "request-rejected-pre-ready"
      });

      const reconciled = enforceSessionContextBaselinePersistenceInvariant(
        run,
        continuityValue,
        { now }
      );
      run = reconciled.run;
      context.run = run;
      addAudit(audit, {
        kind: "warning",
        title: "Ordinary Nano blockerad före READY",
        detail: `${rejectedRequestId || "unknown-request"} · exact typed baseline owner krävs; ordinary mission mutation=0.`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuityValue, audit);
      await notifyPanels(windowId);
      if (reconciled.reconciled) {
        setTimeout(() => tickWindow(
          windowId,
          "pre-ready-ordinary-nano-rejected-baseline-reconcile"
        ).catch(console.warn), 0);
      }
      return snapshotForWindow(windowId);
    }

    if (!commitReplay && source === NANO_DECISION_SOURCE.NANO) {
      const terminalInputDigest = requireNanoPromptDigest(
        payload?.inputDigest,
        "NANO_DECISION_INPUT_DIGEST_INVALID"
      );
      if (terminalInputDigest !== request.inputDigest) {
        const error = new Error("NANO_DECISION_INPUT_DIGEST_MISMATCH");
        error.code = "NANO_DECISION_INPUT_DIGEST_MISMATCH";
        throw error;
      }
      if (!payload?.forensics || typeof payload.forensics !== "object") {
        const error = new Error("NANO_DECISION_FORENSICS_REQUIRED");
        error.code = "NANO_DECISION_FORENSICS_REQUIRED";
        throw error;
      }
      const forensicDigest = sanitizeText(payload.forensics.inputDigest, 128).toLowerCase();
      if (forensicDigest !== terminalInputDigest) {
        const error = new Error("NANO_DECISION_FORENSIC_INPUT_DIGEST_MISMATCH");
        error.code = "NANO_DECISION_FORENSIC_INPUT_DIGEST_MISMATCH";
        throw error;
      }
    }

    if (!commitReplay && request.mode !== NANO_ANALYSIS_MODES.OPERATOR_RESUME) {
      const currentPage = await readPage(run.targetTabId, "nano-decision-freshness");
      const observationFresh = source === NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
        ? preservedProtocolPageMatch({ run, observation: run.pendingObservation, page: currentPage })
        : observationMatchesPage(run.pendingObservation, currentPage);
      if (!observationFresh) {
        if (source === NANO_DECISION_SOURCE.NANO &&
            request.sessionContextBaselineAnalysis === true) {
          const reconciled = reconcileInvalidatedBaselineNanoRequest(run, currentPage, audit, {
            windowId,
            reason: "Target hash/epoch changed before Nano decision; stale Nano output discarded",
            now
          });
          run = reconciled.run;
          context.run = run;
          await writeRuntimeBundle(runtime, continuityValue, audit);
          await notifyPanels(windowId);
          if (reconciled.action === "RECONCILED") {
            setTimeout(() => tickWindow(windowId, "baseline-observation-reconcile-before-decision").catch(console.warn), 0);
          }
          return snapshotForWindow(windowId);
        }

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

    const baselineAnalysisRequest = request.sessionContextBaselineAnalysis === true;
    let baselineAnalysis = null;
    let baselineAnalysisAccepted = false;
    if (baselineAnalysisRequest) {
      baselineAnalysis = normalizeBaselineAnalysis(
        commitReplay
          ? entryReceipt?.baselineAnalysis || {}
          : payload?.baselineAnalysis || {}
      );
      const validation = validateBaselineAnalysis(baselineAnalysis, {
        candidatePresent: Boolean(request.baselineCandidate),
        baselineCandidate: request.baselineCandidate || null,
        projectionCoverage: request.inputBudget?.semanticCoverage || null,
        responseRecoveryComplete: request.inputBudget?.responseRecoveryComplete === true
      });
      if (!validation.valid) {
        const error = new Error(
          `BASELINE_ANALYSIS_INVALID:${validation.errors.join(",")}`
        );
        error.code = "BASELINE_ANALYSIS_INVALID";
        throw error;
      }
      baselineAnalysisAccepted = baselineAnalysis.verdict === "ACCEPT" &&
        baselineAnalysis.normalizedBaselineAccepted === true &&
        Boolean(request.baselineCandidate || baselineAnalysis.normalizedBaseline);
    }

    let completionGate;
    if (commitReplay) {
      const replayAuthorization = await validateBaselineCommitReplayAuthorization(
        entryReceipt,
        request
      );
      if (!replayAuthorization.ok) {
        const error = new Error(
          `SESSION_CONTEXT_BASELINE_COMMIT_REPLAY_REJECTED:${replayAuthorization.reason}`
        );
        error.code = "SESSION_CONTEXT_BASELINE_COMMIT_REPLAY_REJECTED";
        error.replayReasons = replayAuthorization.reasons;
        throw error;
      }
      completionGate = {
        ok: true,
        request: replayAuthorization.request
      };
    } else {
      completionGate = completeNanoRequestState(request, {
        claimId: payload?.claimId,
        source: source,
        now
      });
      if (!completionGate.ok) {
        throw new Error(`NANO_COMPLETION_REJECTED:${completionGate.reason}`);
      }
    }

    const observedOutputChars = Math.max(
      Number(request.outputChars || 0),
      Number(payload?.outputChars || 0)
    );
    if (source === NANO_DECISION_SOURCE.NANO && observedOutputChars <= 0) {
      throw new Error("NANO_OUTPUT_EMPTY");
    }

    if (baselineAnalysisRequest) {
      if (baselineAnalysisAccepted) {
        if (!commitReplay) {
          addAudit(audit, {
            kind: "info",
            title: "Huvuduppgiftsbaslinje Nano-validerad — DECISION_READY",
            detail: `${sanitizeText(
              request.baselineCandidate?.mainTask?.title ||
              request.baselineCandidate?.mainTask?.programGoal ||
              baselineAnalysis.normalizedBaseline?.mainTask?.title ||
              baselineAnalysis.normalizedBaseline?.mainTask?.programGoal,
              900
            )} · ${BASELINE_ANALYSIS_SCHEMA_ID} · durable commit återstår.`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
        }
      } else {
        // v0.11.8: session-init baseline correction is generation-bounded across
        // fresh target response identities. A changed response identity is not by
        // itself a new initialization episode; the episode is keyed to needKey +
        // the pre-baseline catch identity. Exactly one rejected baseline may create
        // a corrective target prompt. A second Nano non-ACCEPT in the same episode
        // terminalizes locally instead of creating an unbounded correction loop.
        const correctionFence = evaluateSessionBaselineCorrectionFence(
          run.sessionContextInit,
          {
            requestId: request.requestId,
            responseIdentity:
              request.baselineResponseIdentity ||
              observation?.responseIdentity ||
              observation?.responseHash ||
              "",
            verdict: baselineAnalysis.verdict,
            reason: baselineAnalysis.reason,
            violations: baselineAnalysis.violations || [],
            now
          }
        );
        run.sessionContextInit = applySessionBaselineCorrectionFence(
          run.sessionContextInit,
          correctionFence
        );
        if (!correctionFence.allowCorrection) {
          const detail = sanitizeText(
            `BASELINE_CORRECTION_EXHAUSTED · generation=${correctionFence.generation}/${correctionFence.fence.maxChatCorrections} · ` +
            `${baselineAnalysis.verdict} · ${baselineAnalysis.reason} · ${(baselineAnalysis.violations || []).join("; ")}`,
            2000
          );
          run = applySessionContextInitFailure(run, {
            windowId,
            audit,
            code: SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_CORRECTION_EXHAUSTED,
            detail,
            now
          });
          // applySessionContextInitFailure preserves the fence through failSessionContextInit;
          // keep an explicit runtime status so exports/UI can distinguish bounded
          // semantic-correction exhaustion from transport/provider failure.
          run.runtimeDecisionStatus = "SESSION_BASELINE_CORRECTION_EXHAUSTED";
          run.nanoTelemetry ||= {};
          run.nanoTelemetry.lastStatus = "SESSION_BASELINE_CORRECTION_EXHAUSTED";
          run.nanoTelemetry.lastError = detail;
          run.nanoTelemetry.lastResultSummary = detail;
          // v0.11.19: this branch returns before the normal Nano terminal finalizer.
          // Without explicitly releasing Nano ownership, automatic Session Capture
          // remains deferred forever and the failure export loses its forensic context.
          run = finalizeNanoTerminalOwnership(run, context, {
            terminalRequest: completionGate.request || request,
            source,
            runtimeDecisionStatus: "SESSION_BASELINE_CORRECTION_EXHAUSTED",
            nanoTelemetryStatus: "SESSION_BASELINE_CORRECTION_EXHAUSTED",
            preserveObservation: false,
            event: "baseline-correction-exhausted",
            windowId,
            now
          });
          context.run = run;
          addAudit(audit, {
            kind: "blocked",
            title: "Baseline-korrigering uttömd — ingen tredje baseline-wake",
            detail: `${correctionFence.episodeKey} · ${detail}`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
          await writeRuntimeBundle(runtime, continuityValue, audit);
          await setTabIndicator(
            run.targetTabId,
            "BLOCKED",
            "BASELINE_CORRECTION_EXHAUSTED"
          );
          await notifyPanels(windowId);
          return snapshotForWindow(windowId);
        }

        // The first rejected baseline remains outside continuity. Its one allowed
        // correction is the only prompt admitted by the session-init gate.
        baselinePromptOnly = true;
        addAudit(audit, {
          kind: "warning",
          title: "Huvuduppgiftsbaslinje avvisad av Nano — bounded korrigering 1/1",
          detail: `${baselineAnalysis.verdict} · ${baselineAnalysis.reason} · ${(baselineAnalysis.violations || []).join("; ")}`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
      }
    }

    let decision = commitReplay && entryReceipt?.decision
      ? deepClone(entryReceipt.decision)
      : payload?.decision && typeof payload.decision === "object"
        ? deepClone(payload.decision)
        : {};
    const protocolRepairOnly = Boolean(request.protocolRepairOnly || decision.protocolRepairOnly);
    if (protocolRepairOnly) {
      decision = buildProtocolRepairDecision({
        reason: request.protocolReason || run.pendingObservation?.targetResult?.reason
      });
    }
    decision.action = normalizeBackgroundAction(decision.action);
    if (baselinePromptOnly &&
        Number(run.sessionContextInit?.baselineCorrectionGeneration || 0) >= 1) {
      const correctionFence = run.sessionContextInit?.baselineCorrectionFence || {};
      decision.action = "CONTINUE";
      decision.requestedAction = buildAgentStartupCorrectionPrompt({
        baselineRequestPrompt: MAIN_TASK_BASELINE_REQUEST_PROMPT,
        reason: correctionFence.reason || baselineAnalysis?.reason || "STARTUP_RESPONSE_NOT_ACCEPTED",
        violations: correctionFence.violations || baselineAnalysis?.violations || []
      });
      decision.requiredEvidence = [
        "Ett komplett JSON-objekt enligt eic.main-task-baseline.v3 följt av exakt EIC-AA/5-trailer, levererat direkt som svar i den anslutna ChatGPT-sessionen."
      ];
      decision.workUnit = "Svara korrekt på Agentens session-startbegäran i denna ChatGPT-session.";
      decision.ownerRoute = TARGET_SESSION_OWNER;
      decision.exactTarget = `tab:${run.targetTabId || "UNKNOWN"}|conversation:${run.conversationKey || "UNKNOWN"}`;
      decision.reason = "V0_12_3_AGENT_AI_SESSION_ORIENTATION_AFTER_BASELINE_REJECTION";
    }
    const nanoDecisionApplicationLog = commitReplay
      ? applicationLog
      : appendApplicationEvent(applicationLog, {
      level: "info",
      event: "mission.nano.decision",
      message: baselineAnalysisRequest
        ? "Nano-baselineanalys mottagen; bounded output och semantiska objekt sparades."
        : "Nano-beslut mottaget; bounded output och semantiska objekt sparades.",
      windowId,
      tabId: run.targetTabId,
      runId: run.runId,
      correlationId: request.requestId,
      data: {
        ...nanoEvidenceSnapshot(run, request, payload, continuityValue),
        semanticStatus: baselineAnalysisRequest && baselineAnalysisAccepted
          ? "DECISION_READY"
          : baselineAnalysisRequest
            ? "REJECTED"
            : "COMPLETED",
        commitStatus: baselineAnalysisRequest && baselineAnalysisAccepted
          ? "PENDING"
          : "NOT_APPLICABLE",
        nanoRerunRequired: false,
        baselineAnalysis: baselineAnalysis ? {
          schema: baselineAnalysis.schema,
          verdict: baselineAnalysis.verdict,
          reason: baselineAnalysis.reason,
          violations: baselineAnalysis.violations,
          normalizedBaselineAccepted: baselineAnalysis.normalizedBaselineAccepted
        } : null,
        decision: {
          action: sanitizeText(decision.action, 40),
          requestedAction: sanitizeText(decision.requestedAction, 800),
          microActionId: sanitizeText(decision.microActionId, 120),
          completionState: sanitizeText(decision.completionState, 80),
          trackStatus: sanitizeText(decision.trackControl?.status, 80),
          directProgramDelta: Number(decision.directProgramDelta || 0),
          requiredControl: decision.requiredControl === true
        }
      }
    }, { now });
    if (nanoDecisionApplicationLog !== applicationLog) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.APPLICATION_LOG]: nanoDecisionApplicationLog
      });
    }

    const semanticErrors = [];
    // v0.11.3: baseline analysis is a typed semantic-commit protocol, not an
    // ordinary continuation decision. Generic action/claim/stop grounding is
    // therefore deliberately scoped away from this request type. The baseline
    // response schema and validateBaselineAnalysis() are its governing contract.
    if (!baselineAnalysisRequest) {
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
    // Preserve the pre-Step-2 baseline grounding semantics without mutating
    // continuity before the owner commit. v0.10.15 validated an ACCEPT after
    // eager in-memory adoption; Step 2 supplies the same candidate as a local
    // validation preview only, while durable continuity remains unchanged.
    const effectiveBaselineCandidate = baselineAnalysisRequest && baselineAnalysisAccepted
      ? (request.baselineCandidate || baselineAnalysis?.normalizedBaseline || null)
      : null;
    const continuityProjectionForGrounding =
      effectiveBaselineCandidate
        ? {
            ...continuityProjectionBefore,
            mainTaskBaseline: deepClone(effectiveBaselineCandidate)
          }
        : continuityProjectionBefore;
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
      continuityProjection: continuityProjectionForGrounding,
      observation
    });
    let grounding = baselineAnalysisRequest
      ? { valid: true, errors: [], baselineAnalysisOnly: true }
      : protocolRepairOnly
        ? { valid: true, errors: [], protocolRepairOnly: true }
        : validateNanoDecisionGrounding(decision, {
            analysisMode,
            continuityProjection: continuityProjectionForGrounding,
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
          continuityProjection: continuityProjectionForGrounding,
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
        continuityProjection: continuityProjectionForGrounding,
        validationErrors: grounding.errors
      });
      if (repaired.repaired) {
        const repairedGrounding = validateNanoDecisionGrounding(repaired.decision, {
          analysisMode,
          continuityProjection: continuityProjectionForGrounding,
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
          claimAvailableAt: nowIso(now),
          requeuedAt: nowIso(now),
          unclaimedRearmCount: 0,
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

    // v0.12.6: ordinary post-READY Nano is a semantic adviser. Baseline
    // analysis remains a separate validator contract. Runtime resolves one
    // concrete transition from its own admissible action catalog; model
    // expression quality is telemetry and cannot own mission liveness.
    const runtimeBindingRequired = Boolean(
      source === NANO_DECISION_SOURCE.NANO &&
      !baselineAnalysisRequest &&
      !protocolRepairOnly &&
      sessionContextInitVerifiedReady(run.sessionContextInit) &&
      [NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS, NANO_ANALYSIS_MODES.OPERATOR_RESUME]
        .includes(analysisMode)
    );
    let runtimeBinding = null;
    if (runtimeBindingRequired) {
      const runtimeBindingExecutionPlan = resolveExecutionPlan({
        decision: {
          ...decision,
          action: observation?.targetResult?.valid && observation?.targetResult?.status === "CONTINUE"
            ? "CONTINUE"
            : decision.action
        },
        targetResult: observation?.targetResult || {},
        sessionInitState: run.sessionContextInit?.state || "",
        hasBoundObservation: Boolean(observation),
        suppressLocalStateRead: shouldSuppressRepeatedLocalStateRead(run)
      });
      runtimeBinding = evaluateNanoRuntimeBinding({
        targetNext: observation?.targetResult?.next,
        baselineNext: continuityValue?.mainTaskBaseline?.current?.nextHighLeverageAction,
        nanoNext: decision.requestedAction,
        reason: decision.reason,
        alternatives: decision.alternatives,
        rejectedAlternatives: decision.rejectedAlternatives,
        candidateActions: decision.candidateActions,
        candidateSource: decision.candidateSource,
        selectionRelation: decision.selectionRelation,
        decisionBasis: decision.decisionBasis,
        noMaterialAlternative: decision.noMaterialAlternative,
        executorActor: decision.executorActor,
        expectedExecutorActor: runtimeBindingExecutionPlan.executorActor,
        stopCondition: decision.stopCondition,
        admissibleActionIds: runtimeBindingExecutionPlan.availableActionIds,
        selectedActionId: runtimeBindingExecutionPlan.actionId,
        requestedMicroActionId: decision.microActionId,
        requestedActionCompatible: runtimeBindingExecutionPlan.requestedActionCompatible,
        runtimeActionSetRequired: true
      });
      run.nanoTelemetry ||= {};
      run.nanoTelemetry.lastRuntimeBinding = {
        ...runtimeBinding,
        targetNextDigest: runtimeBinding.targetNext
          ? await sha256Hex(runtimeBinding.targetNext)
          : "",
        nanoNextDigest: runtimeBinding.nanoNext
          ? await sha256Hex(runtimeBinding.nanoNext)
          : "",
        targetNext: undefined,
        baselineNext: undefined,
        nanoNext: undefined,
        at: nowIso(now)
      };

      if (!runtimeBinding.gateValid) {
        // v0.12.6: only a controller-owned runtime binding invariant may stop
        // this causal unit here. Model prose quality / "independent judgment"
        // is telemetry and never owns mission liveness.
        const bindingErrors = [...new Set(runtimeBinding.errors || [])];
        const failedGate = failNanoRequestState(request, {
          claimId: payload?.claimId,
          errorCode: "RUNTIME_ACTION_BINDING_INVALID",
          errorDetail: `${runtimeBinding.verdict}: ${bindingErrors.join(", ") || "UNKNOWN_RUNTIME_BINDING_ERROR"}`,
          durationMs: Math.max(0, Number(payload?.durationMs || 0)),
          repairUsed: false,
          now
        });
        const terminalRequest = failedGate.ok
          ? failedGate.request
          : {
              ...deepClone(completionGate.request || request),
              status: NANO_REQUEST_STATUS.FAILED,
              completedAt: nowIso(now),
              errorCode: "RUNTIME_ACTION_BINDING_INVALID",
              lastError: bindingErrors.join(", "),
              resultSummary: `RUNTIME_ACTION_BINDING_INVALID:${bindingErrors.join(",")}`
            };
        run.pendingNanoRequest = null;
        run.waitingObservation = null;
        run.timeoutSuspended = true;
        run.responseDeadlineAt = null;
        run.runtimeDecisionStatus = "RUNTIME_ACTION_BINDING_INVALID";
        run.nanoTelemetry.lastStatus = "RUNTIME_ACTION_BINDING_INVALID";
        run.nanoTelemetry.lastError = terminalRequest.resultSummary;
        run.nanoTelemetry.lastResultSummary = terminalRequest.resultSummary;
        run = finalizeNanoTerminalOwnership(run, context, {
          terminalRequest,
          source,
          runtimeDecisionStatus: "RUNTIME_ACTION_BINDING_INVALID",
          nanoTelemetryStatus: "RUNTIME_ACTION_BINDING_INVALID",
          preserveObservation: false,
          retireWaitingObservation: true,
          event: "runtime-action-binding-invalid",
          windowId,
          now
        });
        run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
          origin: PAUSE_ORIGINS.NO_PROGRESS,
          reason:
            "Controllerns runtime action catalog kunde inte binda en säker transition. " +
            "Detta är ett internt runtime-invariantfel, inte ett Nano-kvalitetsfel.",
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "blocked",
          title: "RUNTIME_ACTION_BINDING_INVALID",
          detail:
            `${runtimeBinding.verdict} · ${bindingErrors.join(", ") || "UNKNOWN"} · ` +
            `request ${request.requestId} · Nano-advisory får inte skapa en alternativ transition`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuityValue, audit);
        await setTabIndicator(run.targetTabId, "BLOCKED", "RUNTIME_ACTION_BINDING_INVALID");
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }

      if (Array.isArray(runtimeBinding.qualityWarnings) &&
          runtimeBinding.qualityWarnings.length) {
        run.nanoTelemetry.lastAdvisoryWarnings = [...runtimeBinding.qualityWarnings];
        addAudit(audit, {
          kind: "info",
          title: "Nano-advisory rebound till runtime authority",
          detail:
            `${runtimeBinding.verdict} · ${runtimeBinding.qualityWarnings.join(", ")} · ` +
            `selected=${runtimeBinding.selectedActionId || "none"} · request=${request.requestId}`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
      }
      // Actor/progress semantics come from the runtime-selected action, never
      // from model-authored controller metadata.
      decision.executorActor = runtimeBindingExecutionPlan.executorActor || "";
      decision.requiredControl = [
        EXECUTION_DISPOSITIONS.LOCAL_EXECUTE,
        EXECUTION_DISPOSITIONS.WAIT_OWNER_EVENT,
        EXECUTION_DISPOSITIONS.WAIT_EXTERNAL_EVENT,
        EXECUTION_DISPOSITIONS.CHAT_CONTROL_CONTINUATION
      ].includes(runtimeBindingExecutionPlan.executionDisposition);
      decision.directProgramDelta =
        runtimeBindingExecutionPlan.executionDisposition === EXECUTION_DISPOSITIONS.TARGET_DISPATCH &&
        observation?.targetResult?.valid === true &&
        sanitizeText(observation?.targetResult?.status, 80).toUpperCase() === "CONTINUE"
          ? 1
          : 0;
      // v0.12.6 — once the runtime catalog has admitted/bound the Nano advisory,
      // normalize semantic requestedAction but preserve the model's original
      // microActionId until resolveExecutionPlan runs. That preserves provenance:
      // an inadmissible Nano id resolved by the unique runtime route remains
      // CORE_FALLBACK rather than being falsely relabelled NANO_SELECTED.
      if (runtimeBinding.gateValid &&
          runtimeBinding.runtimeBound &&
          runtimeBinding.selectionRelation === "ACCEPT" &&
          runtimeBinding.semanticSelectedAction) {
        decision.requestedAction = runtimeBinding.semanticSelectedAction;
      }
    }

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
    const localUnlockDirective = evaluateLocalUnlockDirective(
      `${decision.requestedAction || ""} ${decision.unlocksNextAction || ""} ${decision.unlockEvent || ""}`,
      run
    );
    if (localUnlockDirective.requested) {
      if (!localUnlockDirective.supported) {
        decision.action = "CONTINUE";
        decision.requestedAction = sanitizeText(
          `Det begärda lokala unlock-token ${localUnlockDirective.token} saknar registrerad controllerproducent. ` +
          "Vänta inte på tokenet; fortsätt med nästa bounded action från den validerade huvuduppgiften eller ange ett semantiskt evidenceNeed som Core kan owner-resolvera.",
          1600
        );
        decision.unlocksNextAction = "";
        decision.unlockEvent = "";
        decision.progressDelta = Math.max(Number(decision.progressDelta || 0), 1);
        decision.directProgramDelta = Math.max(Number(decision.directProgramDelta || 0), 1);
        addAudit(audit, {
          kind: "warning",
          title: "Okänt lokalt unlock-token avvisat",
          detail: `${localUnlockDirective.token} · ingen registrerad controllerproducent · indefinite wait förbjuden`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
      } else if (localUnlockDirective.satisfied) {
        run.localUnlockReceipt = {
          token: localUnlockDirective.token,
          producer: localUnlockDirective.producer,
          observedValue: localUnlockDirective.observedValue,
          satisfiedAt: nowIso(now)
        };
        run.waitingForUnlockEvent = "";
        run.deliveryWait = null;
        run.timeoutSuspended = false;
        decision.action = "CONTINUE";
        decision.requestedAction = sanitizeText(
          `${localUnlockDirective.token}=READY är verifierat lokalt för aktuell run. ` +
          "Fortsätt direkt med nästa bounded action från den validerade huvuduppgiften; begär inte samma lokala event igen.",
          1600
        );
        decision.unlocksNextAction = "";
        decision.unlockEvent = "";
        decision.progressDelta = Math.max(Number(decision.progressDelta || 0), 1);
        decision.directProgramDelta = Math.max(Number(decision.directProgramDelta || 0), 1);
        const localUnlockNormalization = normalizeSatisfiedLocalUnlockDecision(
          decision,
          localUnlockDirective
        );
        decision = localUnlockNormalization.decision;
        addAudit(audit, {
          kind: "done",
          title: "Lokalt unlock-event verifierat",
          detail: `${localUnlockDirective.token} · ${localUnlockDirective.producer}=${localUnlockDirective.observedValue}`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        if (localUnlockNormalization.changed) {
          addAudit(audit, {
            kind: "info",
            title: "Stale terminal metadata rensad efter lokalt unlock",
            detail: `${localUnlockNormalization.reason} · ${localUnlockNormalization.changedFields.join(", ")}`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
        }
      } else {
        decision.unlocksNextAction = localUnlockDirective.token;
        decision.unlockEvent = localUnlockDirective.token;
      }
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
    // v0.11.3 I4/I5: the delivery regulator is a material TARGET_DISPATCH
    // gate. Execution disposition must be resolved first; local/wait/external
    // side-band decisions may never be intercepted by this regulator.
    let deliveryDisposition = null;
    run.deliveryRegulatorDisposition = "DEFERRED_UNTIL_EXECUTION_DISPOSITION";

    // Step 2: a baseline Nano ACCEPT is a two-phase owner commit. The semantic
    // result is preserved in a durable DECISION_READY receipt first; baseline
    // adoption and READY are each storage-readback verified before any branch
    // below may consume the observation or admit ordinary continuation.
    let sessionContextCommitReadyThisDecision = false;
    let semanticCompletedRequest = null;
    if (baselineAnalysisRequest && baselineAnalysisAccepted) {
      semanticCompletedRequest = commitReplay
        ? deepClone(request)
        : completedNanoDecisionRequest(
            request,
            completionGate.request,
            payload,
            decision,
            source,
            now
          );
      if (!commitReplay) {
        // The inference lease has served its only authorization purpose. Persist the
        // semantically COMPLETED request together with DECISION_READY so later commit
        // recovery is owned by the durable receipt rather than transient model liveness.
        run.pendingNanoRequest = deepClone(semanticCompletedRequest);
        context.run = run;
      }
      const commitResult = await commitSessionContextBaselineDecision({
        windowId,
        runtime,
        audit,
        continuity: continuityValue,
        context,
        run,
        request,
        payload,
        baselineAnalysis,
        decision,
        now
      });
      run = commitResult.run || run;
      context.run = run;
      if (!commitResult.ok) {
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
      baselineAnalysis = commitResult.baselineAnalysis || baselineAnalysis;
      decision = commitResult.decision || decision;
      sessionContextCommitReadyThisDecision = commitResult.readyVerified === true;
    }

    // v0.11.3 I1/I6: a baseline ACCEPT is a typed commit terminal for this
    // Nano request. Once the baseline owner transaction has run, do not admit
    // the semantic result to ordinary delivery/autonomy/execution processing.
    if (baselineAnalysisRequest && baselineAnalysisAccepted) {
      const baselineCompletedRequest = semanticCompletedRequest ||
        completedNanoDecisionRequest(
          request,
          completionGate.request,
          payload,
          decision,
          source,
          now
        );
      run.nanoTelemetry ||= {};
      run.nanoTelemetry.lastCompletedAt = baselineCompletedRequest.completedAt || nowIso(now);
      run.nanoTelemetry.lastDurationMs = baselineCompletedRequest.durationMs;
      run.nanoTelemetry.lastInputDigest = request.inputDigest || "";
      run.nanoTelemetry.lastInputChars = Number(request.inputChars || 0);
      run.nanoTelemetry.lastOutputChars = baselineCompletedRequest.outputChars;
      run.nanoTelemetry.lastChunkCount = baselineCompletedRequest.chunkCount;
      run.nanoTelemetry.lastFirstTokenAt = baselineCompletedRequest.firstTokenAt;
      run.nanoTelemetry.lastResultSummary = sessionContextCommitReadyThisDecision
        ? "BASELINE_ACCEPT_COMMITTED_READY"
        : "BASELINE_ACCEPT_COMMIT_RECOVERY_REQUIRED";
      run.nanoTelemetry.lastError = "";
      run.nanoTelemetry.lastSource = source;
      // v0.11.3 I1/I7: a durable baseline ACCEPT closes only the typed
      // baseline-Nano request. The owner-bound assistant observation is *not*
      // consumed here; READY hands that same observation to exactly one ordinary
      // continuation Nano locally. Marking it globally processed before this
      // handoff is the v0.11.2 lifecycle collision that made baseline reconcile
      // unable to re-observe its own ACKED response.
      run = finalizeNanoTerminalOwnership(run, context, {
        terminalRequest: baselineCompletedRequest,
        source,
        runtimeDecisionStatus: sessionContextCommitReadyThisDecision
          ? "NANO_BASELINE_READY_COMMITTED"
          : (run.runtimeDecisionStatus || "NANO_BASELINE_COMMIT_RECOVERY"),
        nanoTelemetryStatus: sessionContextCommitReadyThisDecision
          ? "READY"
          : (run.nanoTelemetry.lastStatus || "COMMIT_RECOVERY_REQUIRED"),
        preserveObservation: true,
        event: sessionContextCommitReadyThisDecision
          ? "baseline-request-completed"
          : "baseline-request-commit-recovery",
        windowId,
        now
      });

      // Preserve the established deferred Core Surface Review ordering: once
      // READY is durable and baseline Nano ownership has been released, a
      // source-bound automatic review may become schedulable. This replay runs
      // before the ordinary Nano handoff so the review is not falsely blocked
      // by the continuation request that READY itself is about to create.
      if (sessionContextCommitReadyThisDecision) {
        maybeReplayDeferredCoreSurfaceReview({
          context,
          run,
          applicationLog,
          audit,
          windowId,
          reason: "session-context-ready-typed-commit",
          now
        });
      }

      if (sessionContextCommitReadyThisDecision && observation?.observationId) {
        // v0.11.20: the baseline response trailer owns session-init transport only.
        // After the baseline is durably committed, its EIC_NEXT/EIC_NEXT_ACTOR
        // ("validate this baseline", typically AGENT) is stale metadata for the
        // now-completed init episode. The accepted baseline current.nextHighLeverageAction
        // becomes the post-READY work direction, while actor selection is intentionally
        // reset so Core can issue one conservative WAIT_OWNER_EVENT handoff to the
        // connected EIC session instead of re-requesting the baseline.
        const postReadyNext = sanitizeText(
          continuityValue?.mainTaskBaseline?.current?.nextHighLeverageAction ||
            decision?.nextHighLeverageAction ||
            "",
          5000
        );
        const sourceTargetResult = deepClone(observation?.targetResult || {});
        run.pendingObservation = {
          ...deepClone(observation),
          targetResult: projectPostReadyBaselineHandoffTarget({
            targetResult: sourceTargetResult,
            nextHighLeverageAction: postReadyNext
          }),
          sessionContextReadyHandoff: true,
          sessionContextReadyHandoffAt: nowIso(now),
          sessionContextReadySourceTargetResult: sourceTargetResult
        };
        run.pendingNanoRequest = buildPendingNanoRequest({
          observationId: observation.observationId,
          analysisMode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS,
          now
        });
        run.nanoTelemetry ||= {};
        run.nanoTelemetry.previousResultSummary = sanitizeText(run.nanoTelemetry.lastResultSummary, 2400);
        run.nanoTelemetry.previousCompletedAt = run.nanoTelemetry.lastCompletedAt || null;
        run.nanoTelemetry.lastRequestId = run.pendingNanoRequest.requestId;
        run.nanoTelemetry.lastMode = NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS;
        run.nanoTelemetry.lastStatus = "PENDING";
        run.nanoTelemetry.lastSource = NANO_DECISION_SOURCE.NANO;
        run.nanoTelemetry.lastStartedAt = null;
        run.nanoTelemetry.lastCompletedAt = null;
        run.nanoTelemetry.lastDurationMs = null;
        run.nanoTelemetry.lastInputDigest = "";
        run.nanoTelemetry.lastInputChars = 0;
        run.nanoTelemetry.lastOutputChars = 0;
        run.nanoTelemetry.lastChunkCount = 0;
        run.nanoTelemetry.lastFirstTokenAt = null;
        run.nanoTelemetry.lastResultSummary = "";
        run.nanoTelemetry.lastError = "";
        run.runtimeDecisionStatus = "NANO_PENDING_AFTER_BASELINE_READY";
        run = transitionRun(run, STATES.ASSESSING, {
          origin: PAUSE_ORIGINS.NONE,
          reason: "Durable READY lämnar över samma owner-bundna observation till exakt en vanlig Nano-analys utan ny target-prompt.",
          force: true
        });
      }
      context.run = run;
      addAudit(audit, {
        kind: sessionContextCommitReadyThisDecision ? "done" : "warning",
        title: sessionContextCommitReadyThisDecision
          ? "Baseline ACCEPT slutförd som typed commit"
          : "Baseline ACCEPT väntar på owner-commit recovery",
        detail: `${request.requestId} · ordinary-grounding=0 · ordinary-delivery=0 · ordinary-recovery=0.`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuityValue, audit);
      await notifyPanels(windowId);
      if (sessionContextCommitReadyThisDecision) {
        setTimeout(() => tickWindow(windowId, "baseline-ready-typed-commit-next-cycle").catch(console.warn), 0);
      }
      return snapshotForWindow(windowId);
    }

    // Material delivery regulation is evaluated only after execution routing.
    run.deliveryWait = null;
    run.waitingForUnlockEvent = "";
    run.timeoutSuspended = false;

    const sessionInitOutboundWorkUnitOwnerSurface = baselinePromptOnly
      ? TARGET_SESSION_OWNER
      : null;
    const sessionInitIntegritySeal = baselinePromptOnly
      ? await createSessionInitIntegritySeal({
          baselinePromptOnly: true,
          kind: "SESSION_CONTEXT_BASELINE_REQUEST",
          decision,
          outboundWorkUnitOwnerSurface: sessionInitOutboundWorkUnitOwnerSurface
        })
      : null;
    const genericRewriteAllowed = genericControlRewriteAllowed({
      baselinePromptOnly,
      kind: baselinePromptOnly ? "SESSION_CONTEXT_BASELINE_REQUEST" : ""
    });

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

    const targetResultForAutonomy = observation?.targetResult || null;
    const preBoundaryExecutionPlan = (!baselinePromptOnly && !protocolRepairOnly)
      ? resolveExecutionPlan({
          decision: {
            ...decision,
            action: targetResultForAutonomy?.valid && targetResultForAutonomy.status === "CONTINUE"
              ? "CONTINUE"
              : decision.action
          },
          targetResult: targetResultForAutonomy || {},
          sessionInitState: run.sessionContextInit?.state || "",
          hasBoundObservation: Boolean(observation),
          suppressLocalStateRead: shouldSuppressRepeatedLocalStateRead(run)
        })
      : null;
    const controlMinimization = evaluateModelUserPauseControl({
      decision,
      targetResult: targetResultForAutonomy || {},
      executionPlan: preBoundaryExecutionPlan,
      advisoryOnly: decision?.nanoAdvisory?.schema === "eic.nano.advisory.v4"
    });
    if (controlMinimization.internalize) {
      const priorAssessment = deepClone(autonomy.assessment);
      decision.action = "CONTINUE";
      decision.pauseOrigin = PAUSE_ORIGINS.NONE;
      decision.boundaryEvidence = "";
      decision.destructivenessLevel = 1;
      decision.destructivenessRationale =
        `Core execution routing selected ${controlMinimization.executionDisposition}; no material or human-owned effect is executed by this micro-action.`;

      const minimizedAssessment = classifyDestructiveness({
        requestedAction: "none",
        exactTarget: autonomy.exactTarget,
        ownerSurface: preBoundaryExecutionPlan?.ownerSurface || autonomy.ownerRoute,
        pauseOrigin: PAUSE_ORIGINS.NONE,
        destructivenessLevel: 1,
        destructivenessRationale: decision.destructivenessRationale
      });
      const minimizedControl = runHjalmarMentalControl({
        assessment: minimizedAssessment,
        exactTarget: autonomy.exactTarget,
        ownerRoute: preBoundaryExecutionPlan?.ownerSurface || autonomy.ownerRoute,
        mandate: config?.targetMandateVersion || "target-core-v9",
        rollbackPath: "NO_EFFECT_ROUTE",
        readbackPlan: "WAIT_FOR_OWNER_EVENT_OR_READ_LOCAL_STATE",
        materialAmbiguity: "NONE"
      });
      autonomy = {
        ...autonomy,
        assessment: minimizedAssessment,
        control: minimizedControl,
        ownerRoute: preBoundaryExecutionPlan?.ownerSurface || autonomy.ownerRoute
      };
      addAudit(audit, {
        kind: "info",
        title: controlMinimization.reasonCode === "NANO_ADVISORY_NO_EFFECT_ROUTE"
          ? "Nano-advisory prose separerad från effect-säkerhet"
          : "Model-authored USER_PAUSE internaliserad",
        detail: `${controlMinimization.reasonCode} · ${controlMinimization.executionDisposition} · ${controlMinimization.executorActor} · prior=${Number(priorAssessment?.level || 0)}/10 -> effective=1/10.`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
    }

    run.destructiveness = autonomy.assessment;
    run.hjalmarMentalControl = autonomy.control;

    const shouldResolveAutonomously = decision.action === "PAUSE" ||
      (targetResultForAutonomy?.valid && targetResultForAutonomy.status === "CONTINUE");
    if (shouldResolveAutonomously && !autonomy.assessment.humanDecisionRequired) {
      const disposition = resolveAutonomousPause({
        decision,
        targetResult: targetResultForAutonomy,
        assessment: autonomy.assessment,
        control: autonomy.control,
        fallbackAction: "Läs om exakt owner-state och fortsätt med minsta säkra reversibla steg.",
        protectedSessionInit: baselinePromptOnly
      });
      decision.action = disposition.action;
      decision.requestedAction = disposition.requestedAction;
      decision.pauseOrigin = PAUSE_ORIGINS.NONE;
      decision.boundaryEvidence = "";
      decision.destructivenessLevel = autonomy.assessment.level;
      decision.destructivenessRationale = autonomy.assessment.rationale;
      applyAutonomyRoutingMetadata(decision, autonomy, {
        protectedSessionInit: baselinePromptOnly
      });

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
    const effectiveProgressDelta = effectiveDecisionProgressDelta(decision);
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
            ownerEvidence: effectiveProgressDelta > 0
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
    run.recovery.consecutiveNoProgress = effectiveProgressDelta > 0 ? 0 : cycleResult.consecutiveNoProgress;
    const recoveryBudget = NON_PROGRESS_LIMIT;
    const noProgressBudgetExceeded = genericRewriteAllowed &&
      !protocolRepairOnly &&
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
    const completedRequest = semanticCompletedRequest || completedNanoDecisionRequest(
      request,
      completionGate.request,
      payload,
      decision,
      source,
      now
    );
    const completedAt = completedRequest.completedAt || nowIso(now);
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
    if (source === NANO_DECISION_SOURCE.NANO) {
      run.nanoFailureFence = null;
    }
    const finalRuntimeBinding = runtimeBinding || (
      source === NANO_DECISION_SOURCE.NANO &&
      !baselineAnalysisRequest &&
      !protocolRepairOnly
        ? (() => {
            const traceExecutionPlan = resolveExecutionPlan({
              decision: {
                ...decision,
                action: observation?.targetResult?.valid && observation?.targetResult?.status === "CONTINUE"
                  ? "CONTINUE"
                  : decision.action
              },
              targetResult: observation?.targetResult || {},
              sessionInitState: run.sessionContextInit?.state || "",
              hasBoundObservation: Boolean(observation),
              suppressLocalStateRead: shouldSuppressRepeatedLocalStateRead(run)
            });
            return evaluateNanoRuntimeBinding({
              targetNext: observation?.targetResult?.next,
              baselineNext: continuityValue?.mainTaskBaseline?.current?.nextHighLeverageAction,
              nanoNext: decision.requestedAction,
              reason: decision.reason,
              alternatives: decision.alternatives,
              rejectedAlternatives: decision.rejectedAlternatives,
              candidateActions: decision.candidateActions,
              candidateSource: decision.candidateSource,
              selectionRelation: decision.selectionRelation,
              decisionBasis: decision.decisionBasis,
              noMaterialAlternative: decision.noMaterialAlternative,
              executorActor: decision.executorActor,
              expectedExecutorActor: traceExecutionPlan.executorActor,
              stopCondition: decision.stopCondition,
              admissibleActionIds: traceExecutionPlan.availableActionIds,
              selectedActionId: traceExecutionPlan.actionId,
              requestedMicroActionId: decision.microActionId,
              requestedActionCompatible: traceExecutionPlan.requestedActionCompatible,
              runtimeActionSetRequired: true
            });
          })()
        : {
            schema: "eic.autonom.nano-runtime-binding.v4",
            applicable: false,
            verdict: baselineAnalysisRequest
              ? "BASELINE_VALIDATOR_ONLY"
              : protocolRepairOnly
                ? "PROTOCOL_REPAIR_ONLY"
                : "NON_NANO_SOURCE",
            challengeDemonstrated: false,
            validatorAccept: false,
            independentJudgmentDemonstrated: false,
            gateValid: true,
            errors: [],
            targetNext: "",
            baselineNext: "",
            nanoNext: "",
            reason: "",
            decisionBasis: "",
            candidateActions: [],
            alternatives: []
          }
    );
    run.nanoTelemetry.lastRuntimeBinding = {
      ...finalRuntimeBinding,
      targetNextDigest: finalRuntimeBinding.targetNext
        ? await sha256Hex(finalRuntimeBinding.targetNext)
        : "",
      nanoNextDigest: finalRuntimeBinding.nanoNext
        ? await sha256Hex(finalRuntimeBinding.nanoNext)
        : "",
      targetNext: undefined,
      baselineNext: undefined,
      nanoNext: undefined,
      at: completedAt
    };
    run = markObservationProcessed(run, observation, { now });
    run = finalizeNanoTerminalOwnership(run, context, {
      terminalRequest: completedRequest,
      source,
      runtimeDecisionStatus: source === NANO_DECISION_SOURCE.NANO
        ? "NANO_COMPLETED"
        : "DETERMINISTIC_COMPLETED",
      nanoTelemetryStatus: source === NANO_DECISION_SOURCE.NANO
        ? "COMPLETED"
        : "DEGRADED_RECOVERY",
      preserveObservation: false,
      event: "request-completed",
      windowId,
      now
    });

    const completesSessionContextInit = sessionContextCommitReadyThisDecision ||
      (source === NANO_DECISION_SOURCE.NANO &&
        run.sessionContextInit?.state === SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING &&
        Boolean(continuity.mainTaskBaseline) &&
        !baselineAnalysisRequest);
    let deferredMissionStart = null;
    if (completesSessionContextInit) {
      deferredMissionStart = deepClone(run.sessionContextInit?.deferredMissionStart || null);
      if (sessionContextCommitReadyThisDecision) {
        // READY and its receipt were already persisted/read back in the owner
        // transaction. Only consume the deferred handoff now; do not emit another
        // READY success receipt or transition.
        run.sessionContextInit = {
          ...run.sessionContextInit,
          nanoRequestId: request.requestId,
          deferredMissionStart: null
        };
      } else {
        run.sessionContextInit = advanceSessionContextInit(
          run.sessionContextInit,
          SESSION_CONTEXT_INIT_STATE.READY,
          { nanoRequestId: request.requestId, deferredMissionStart: null },
          { now, force: true }
        );
        if (!sessionContextReadyAuditPresent(audit, {
          windowId,
          runId: run.runId
        })) {
          addAudit(audit, {
            kind: "done",
            title: "Sessionskontext initierad",
            detail: "Catch, eic.main-task-baseline.v3 och Nano-spårkontroll är klara. Vanlig agentbearbetning får nu fortsätta.",
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
        }
      }
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
      run.pendingNanoRequest = null;
      run.timeoutSuspended = strictUserPause;
      run.responseDeadlineAt = strictUserPause ? null : run.responseDeadlineAt;
      // v0.11.20: materialize the human boundary state first. boundaryKey(run)
      // includes pause.origin + pause.at and must therefore be derived from the
      // final AWAITING_OPERATOR_DECISION state, never the pre-transition ASSESSING state.
      run = transitionRun(run, strictUserPause ? STATES.AWAITING_OPERATOR_DECISION : STATES.PROGRAM_BLOCKED, {
        origin: hard.origin,
        reason: strictUserPause
          ? `USER_PAUSE: operatören måste göra ett explicit nivå-10-val: ${hard.evidence}`
          : `PROGRAM_BLOCKED: ingen förväntad aktör kan fortsätta: ${hard.evidence}`,
        now
      });
      if (strictUserPause) {
        const decisionBoundaryKey = boundaryKey(run) ||
          await sha256Hex(stableStringify({
            runId: run.runId,
            missionId: activeMissionIdForRun(context, run),
            evidence: hard.evidence,
            destructiveness: run.destructiveness,
            pause: run.pause
          }));
        run.operatorDecision = createOperatorDecision({
          missionId: activeMissionIdForRun(context, run),
          runId: run.runId,
          instruction: protocolResult?.next ||
            `Granska och besluta om den exakta nivå-10-gränsen: ${hard.evidence}`,
          boundaryKey: decisionBoundaryKey,
          riskLevel: "LEVEL_10"
        }, { now });
        run.boundaryKey = decisionBoundaryKey;
      }
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

    if (genericRewriteAllowed &&
        !noProgressBudgetExceeded &&
        shouldPauseForLoop(loopCorrection)) {
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
      runtime,
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

    if (baselinePromptOnly) {
      const sessionInitIntegrity = await validateSessionInitIntegritySeal(
        sessionInitIntegritySeal,
        {
          baselinePromptOnly: true,
          kind: "SESSION_CONTEXT_BASELINE_REQUEST",
          decision: {
            ...decision,
            requestedAction
          },
          outboundWorkUnitOwnerSurface: sessionInitOutboundWorkUnitOwnerSurface
        }
      );
      if (!sessionInitIntegrity.valid) {
        const failure = {
          schema: "eic.autonom.session-init-prompt-integrity-failure.v1",
          failureCode: SESSION_INIT_PROMPT_MUTATED,
          expectedDigest: sessionInitIntegrity.expectedDigest,
          recomputedDigest: sessionInitIntegrity.recomputedDigest,
          detectedAt: nowIso(),
          stage: "PRE_COMPILE"
        };
        run = applySessionInitPromptIntegrityFailure(run, {
          windowId,
          audit,
          failure,
          detail: `Protected session-init payload changed before compile; expected=${failure.expectedDigest} recomputed=${failure.recomputedDigest}.`,
          now
        });
        context.run = run;
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(run.targetTabId, "BLOCKED", SESSION_INIT_PROMPT_MUTATED);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
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

    // v0.11.0 execution routing: semantic intent, controller state and transport
    // are separate concerns. Baseline delivery and protocol repair are the only
    // application-owned target transports here; ordinary continuation is resolved
    // through the registered micro-action catalog.
    let executionPlan = (baselinePromptOnly || protocolRepairOnly)
      ? {
          actionId: MICRO_ACTION_IDS.REQUEST_TARGET,
          executionDisposition: EXECUTION_DISPOSITIONS.TARGET_DISPATCH,
          ownerSurface: baselinePromptOnly ? TARGET_SESSION_OWNER : "TARGET_PROTOCOL_REPAIR",
          effectClass: baselinePromptOnly ? "SESSION_CONTEXT_BASELINE_REQUEST" : "PROTOCOL_REPAIR",
          source: "CORE_REQUIRED_TRANSPORT",
          availableActionIds: [MICRO_ACTION_IDS.REQUEST_TARGET]
        }
      : resolveExecutionPlan({
          decision: {
            ...decision,
            requestedAction
          },
          targetResult: observation?.targetResult || {},
          sessionInitState: run.sessionContextInit?.state || "",
          hasBoundObservation: Boolean(observation),
          suppressLocalStateRead: shouldSuppressRepeatedLocalStateRead(run)
        });

    decision.microActionId = executionPlan.actionId;
    let resolvedExecutionFamilyKey = executionFamilyKey({
      workUnitId: decision.boundedCurrentUnit || decision.workUnit ||
        continuity.mainTaskBaseline?.current?.boundedWorkUnit ||
        continuity.position.workUnitId,
      ownerSurface: executionPlan.ownerSurface,
      effectClass: executionPlan.effectClass,
      executionDisposition: executionPlan.executionDisposition,
      evidenceNeed: requiredEvidence[0] || decision.unlocksNextAction || ""
    });

    // If no-progress is already established, repeating the same target transport
    // family is not a recovery. Re-analyse locally instead of rewriting text and
    // sending it through the same failed subsystem again.
    if (!baselinePromptOnly &&
        !protocolRepairOnly &&
        executionPlan.executionDisposition === EXECUTION_DISPOSITIONS.TARGET_DISPATCH &&
        loopCorrection.triggered &&
        recentExecutionFamilyCount(run, resolvedExecutionFamilyKey) > 0 &&
        observation) {
      executionPlan = resolveExecutionPlan({
        decision: {
          ...decision,
          microActionId: MICRO_ACTION_IDS.REANALYZE_CURRENT_RESPONSE
        },
        targetResult: observation?.targetResult || {},
        sessionInitState: run.sessionContextInit?.state || "",
        hasBoundObservation: true,
        allowCoreRecoveryActions: true,
        suppressLocalStateRead: shouldSuppressRepeatedLocalStateRead(run)
      });
      decision.microActionId = executionPlan.actionId;
      resolvedExecutionFamilyKey = executionFamilyKey({
        workUnitId: decision.boundedCurrentUnit || decision.workUnit ||
          continuity.mainTaskBaseline?.current?.boundedWorkUnit ||
          continuity.position.workUnitId,
        ownerSurface: executionPlan.ownerSurface,
        effectClass: executionPlan.effectClass,
        executionDisposition: executionPlan.executionDisposition,
        evidenceNeed: requiredEvidence[0] || decision.unlocksNextAction || ""
      });
    }

    run.lastExecutionPlan = {
      schema: "eic.autonom.execution-plan.v1",
      actionId: executionPlan.actionId,
      executionDisposition: executionPlan.executionDisposition,
      ownerSurface: executionPlan.ownerSurface,
      effectClass: executionPlan.effectClass,
      source: executionPlan.source,
      executionFamilyKey: resolvedExecutionFamilyKey,
      selectedAt: nowIso(now)
    };

    if (!baselinePromptOnly &&
        !protocolRepairOnly &&
        executionPlan.executionDisposition !== EXECUTION_DISPOSITIONS.TARGET_DISPATCH) {
      // The execution disposition is already known and is non-material. Record
      // the material-delivery gate as not applicable *before* any non-target
      // branch can return, otherwise UI/runtime projection misleadingly remains
      // DEFERRED even though no delivery-regulator decision is pending.
      run.deliveryRegulatorDisposition = "NOT_APPLICABLE_NON_MATERIAL";
      if (executionPlan.executionDisposition === EXECUTION_DISPOSITIONS.LOCAL_EXECUTE) {
        const budget = advanceLocalMicrostepBudget(run, observation);
        if (budget.exhausted) {
          run.waitingForUnlockEvent = sanitizeText(
            decision.unlockEvent ||
            "En ny response identity eller annan owner-state som ändrar de tillåtna mikrostegen.",
            1200
          );
          run.runtimeDecisionStatus = "WAIT_OWNER_EVENT";
          run.timeoutSuspended = true;
          run.responseDeadlineAt = null;
          run.waitingObservation = observation ? deepClone(observation) : null;
          run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
            origin: PAUSE_ORIGINS.NO_PROGRESS,
            reason: `Lokal mikrostegsbudget ${LOCAL_MICROSTEP_MAX_PER_RESPONSE} uttömd för samma response identity; materiell target-dispatch är förbjuden.`,
            force: true
          });
          const control = await prepareChatControlContinuation(run, {
            config,
            continuity,
            observation,
            reasonCode: "LOCAL_MICROSTEP_BUDGET_EXHAUSTED",
            reasonDetail: run.waitingForUnlockEvent,
            sourceActionId: executionPlan.actionId,
            now
          });
          run = control.run;
          context.run = run;
          addAudit(audit, {
            kind: "warning",
            title: "Lokal mikrostegsbudget uttömd",
            detail: `${executionPlan.actionId} · ${budget.count}/${LOCAL_MICROSTEP_MAX_PER_RESPONSE} · material-target-dispatch=0 · chat-control=${control.created ? "1" : "deduped"}.`,
            windowId,
            tabId: run.targetTabId,
            runId: run.runId
          });
          await writeRuntimeBundle(runtime, continuity, audit);
          await setTabIndicator(
            run.targetTabId,
            "WAITING",
            control.created ? "Kontrollprompt skickas till AI-sessionen" : "Kontrollprompt redan materialiserad"
          );
          await notifyPanels(windowId);
          const controlStatus = String(control.receipt?.status || "").toUpperCase();
          if (control.created || ["PREPARED", "SUBMITTING", "SUBMITTED_UNCONFIRMED"].includes(controlStatus)) {
            return executePreparedEffectUnlocked(windowId);
          }
          return snapshotForWindow(windowId);
        }

        const priorLocalReceipt = run.localExecutionReceipt || null;
        const observationKey = observationMaterialKey(observation || {}, run);
        const materialStateDigest = await sha256Hex(materialDecisionInputKey({
          run,
          observation: observation || {}
        }));
        const rearmObservationKey = localRearmObservationKey(observation || {}, run);
        const localRearmMaterialDigest = await sha256Hex(localRearmMaterialKey({
          run,
          observation: observation || {}
        }));
        const rearmDecision = evaluateLocalNanoRearm({
          actionId: executionPlan.actionId,
          observationKey,
          materialStateDigest,
          localRearmObservationKey: rearmObservationKey,
          localRearmMaterialDigest,
          currentTurnKind: run.currentTurn?.kind || "",
          priorReceipt: priorLocalReceipt,
          failureFence: run.nanoFailureFence || null
        });
        const rearmEligible = LOCAL_NANO_REARM_ACTION_IDS.includes(executionPlan.actionId) &&
          Boolean(observation);

        const localReceipt = {
          schema: "eic.autonom.local-microstep-receipt.v3",
          receiptId: randomId("local-step"),
          actionId: executionPlan.actionId,
          executionDisposition: executionPlan.executionDisposition,
          ownerSurface: executionPlan.ownerSurface,
          effectClass: executionPlan.effectClass,
          executionFamilyKey: resolvedExecutionFamilyKey,
          sourceObservationId: sanitizeText(observation?.observationId, 180),
          sourceObservationHash: sanitizeText(observation?.responseHash, 128),
          sourceObservationKey: observationKey,
          sourceTurnKind: sanitizeText(run.currentTurn?.kind, 120),
          sourceLocalRearmObservationKey: rearmObservationKey,
          materialStateDigest,
          localRearmMaterialDigest,
          rearmFamily: rearmDecision.rearmFamily,
          rearmAllowed: rearmEligible && rearmDecision.rearm,
          rearmReason: rearmDecision.reason,
          at: nowIso(now),
          snapshot: localMicrostepSnapshot(run)
        };
        run.localExecutionReceipt = localReceipt;

        const reanalyse = rearmEligible && rearmDecision.rearm;
        const terminalNanoFailureInputUnchanged =
          rearmEligible && !reanalyse && rearmDecision.reason === "NANO_FAILURE_INPUT_UNCHANGED";
        let control = null;
        if (reanalyse) {
          if (run.nanoFailureFence &&
              run.nanoFailureFence.materialStateDigest !== materialStateDigest) {
            run.nanoFailureFence = null;
            run.nanoFailureDiagnosticReceipt = null;
          }
          run.waitingObservation = null;
          run.pendingObservation = {
            ...deepClone(observation),
            localExecutionReceiptId: localReceipt.receiptId
          };
          run.pendingNanoRequest = buildPendingNanoRequest({
            observationId: observation.observationId,
            analysisMode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS,
            now
          });
          run.nanoTelemetry ||= {};
          run.nanoTelemetry.previousResultSummary = sanitizeText(run.nanoTelemetry.lastResultSummary, 2400);
          run.nanoTelemetry.previousCompletedAt = run.nanoTelemetry.lastCompletedAt || null;
          run.nanoTelemetry.lastRequestId = run.pendingNanoRequest.requestId;
          run.nanoTelemetry.lastMode = NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS;
          run.nanoTelemetry.lastStatus = "PENDING";
          run.nanoTelemetry.lastSource = NANO_DECISION_SOURCE.NANO;
          run.nanoTelemetry.lastStartedAt = null;
          run.nanoTelemetry.lastCompletedAt = null;
          run.nanoTelemetry.lastDurationMs = null;
          run.nanoTelemetry.lastInputDigest = "";
          run.nanoTelemetry.lastInputChars = 0;
          run.nanoTelemetry.lastOutputChars = 0;
          run.nanoTelemetry.lastChunkCount = 0;
          run.nanoTelemetry.lastFirstTokenAt = null;
          run.nanoTelemetry.lastResultSummary = "";
          run.nanoTelemetry.lastError = "";
          run = transitionRun(run, STATES.ASSESSING, {
            origin: PAUSE_ORIGINS.NONE,
            reason: `${executionPlan.actionId} gav materiellt nytt beslutsunderlag; Nano får exakt en ny seriell mikrostegschans.`,
            force: true
          });
        } else if (terminalNanoFailureInputUnchanged) {
          const diagnostic = buildNanoFailureDiagnostic({
            failureFence: run.nanoFailureFence,
            nanoTelemetry: run.nanoTelemetry,
            nanoHostTelemetry: context.nanoHostTelemetry
          });
          const diagnosticKey = await sha256Hex(nanoFailureDiagnosticKeyInput(diagnostic));
          const diagnosticGate = shouldEmitNanoFailureDiagnostic({
            diagnosticKey,
            priorReceipt: run.nanoFailureDiagnosticReceipt
          });

          run.timeoutSuspended = true;
          run.responseDeadlineAt = null;
          run.waitingObservation = observation ? deepClone(observation) : null;
          run.nanoTelemetry ||= {};

          if (!diagnosticGate.emit) {
            run.runtimeDecisionStatus = "NANO_FAILURE_TERMINAL_BLOCKED";
            run.nanoTelemetry.lastStatus = "FAILED_TERMINAL";
            run.nanoTelemetry.lastError = sanitizeText(
              diagnostic.resultSummary || diagnostic.errorDetail || diagnostic.errorCode,
              1600
            );
            run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
              origin: PAUSE_ORIGINS.NANO_HOST_REQUIRED,
              reason:
                "Samma terminala Nano-failure generation har redan materialiserat ett diagnostikkvitto; " +
                "ytterligare CHAT_CONTROL_WAKE är förbjuden tills materiell input eller ny failure generation finns.",
              force: true
            });
            context.run = run;
            addAudit(audit, {
              kind: "blocked",
              title: "Terminal Nano-failure blockerad utan ny chat-control",
              detail:
                `${executionPlan.actionId} · ${diagnostic.errorCode || "NANO_ERROR"} · ` +
                `request=${diagnostic.requestId || "unknown"} · chat-control=0 · ${diagnosticGate.reason}.`,
              windowId,
              tabId: run.targetTabId,
              runId: run.runId
            });
            await writeRuntimeBundle(runtime, continuity, audit);
            await setTabIndicator(
              run.targetTabId,
              "BLOCKED",
              "Nano-failure diagnostik redan levererad — ny materiell input krävs"
            );
            await notifyPanels(windowId);
            return snapshotForWindow(windowId);
          }

          run.runtimeDecisionStatus = "NANO_FAILURE_DIAGNOSTIC";
          run.nanoTelemetry.lastStatus = "FAILED_DIAGNOSTIC";
          run.waitingForUnlockEvent =
            "Terminal Nano-failure kräver source/runtime-diagnos; samma input får inte återarmas.";
          run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
            origin: PAUSE_ORIGINS.NANO_HOST_REQUIRED,
            reason:
              "Terminal Nano-failure diagnostic materialiseras exakt en gång till EIC_AI_SESSION; " +
              "därefter blockeras samma failure generation utan ny chat-control.",
            force: true
          });
          control = await prepareChatControlContinuation(run, {
            config,
            continuity,
            observation,
            reasonCode: "NANO_FAILURE_DIAGNOSTIC",
            reasonDetail: run.waitingForUnlockEvent,
            sourceActionId: executionPlan.actionId,
            diagnostics: { nanoFailure: diagnostic },
            now
          });
          run = control.run;
          if (control.created || control.receipt) {
            run.nanoFailureDiagnosticReceipt = {
              schema: "eic.autonom.nano-failure-diagnostic-receipt.v1",
              diagnosticKey,
              requestId: diagnostic.requestId,
              errorCode: diagnostic.errorCode,
              effectId: sanitizeText(control.receipt?.effectId, 180),
              turnId: sanitizeText(control.receipt?.turnId, 180),
              status: sanitizeText(control.receipt?.status, 80) || "PREPARED",
              createdAt: nowIso(now)
            };
          }
        } else {
          run.waitingForUnlockEvent = sanitizeText(
            decision.unlockEvent ||
            "Ny response identity eller verifierad owner/material-state som ändrar beslutsunderlaget.",
            1200
          );
          run.runtimeDecisionStatus = "WAIT_OWNER_EVENT";
          run.timeoutSuspended = true;
          run.responseDeadlineAt = null;
          run.nanoTelemetry ||= {};
          run.nanoTelemetry.lastStatus = "WAIT_OWNER_EVENT";
          run.nanoTelemetry.lastError = rearmDecision.reason;
          run.waitingObservation = observation ? deepClone(observation) : null;
          run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
            origin: rearmEligible ? PAUSE_ORIGINS.NO_PROGRESS : PAUSE_ORIGINS.NONE,
            reason: rearmEligible
              ? `${executionPlan.actionId} gav inget materiellt delta (${rearmDecision.reason}); samma beslutsunderlag får inte återköas till Nano.`
              : `${executionPlan.actionId} utfördes lokalt utan en ny materiell target-effekt.`,
            force: true
          });

          const noDeltaLocalStateDiagnostic =
            rearmEligible && rearmDecision.reason === "LOCAL_STATE_UNCHANGED";
          if (noDeltaLocalStateDiagnostic) {
            const candidateWakeKey = await sha256Hex(chatControlWakeKeyInput({
              run,
              observation,
              reasonCode: rearmDecision.reason,
              sourceActionId: executionPlan.actionId
            }));
            const candidateWakeGeneration = Math.max(
              0,
              Number(run.chatControlGeneration || 0)
            ) + 1;
            const diagnostic = buildLocalStateBridgeDiagnostic({
              run,
              observation,
              priorReceipt: priorLocalReceipt,
              currentReceipt: localReceipt,
              candidateWakeKey,
              candidateWakeGeneration,
              createdAt: nowIso(now)
            });
            const diagnosticKey = await sha256Hex(localStateDiagnosticKeyInput(diagnostic));
            diagnostic.diagnosticKey = diagnosticKey;
            const diagnosticGate = shouldEmitLocalStateDiagnostic({
              diagnosticKey,
              priorReceipt: run.localStateDiagnosticReceipt
            });

            if (!diagnosticGate.emit) {
              control = {
                run,
                created: false,
                duplicate: true,
                wakeKey: candidateWakeKey,
                receipt: run.chatControlContinuationReceipt || null,
                reason: diagnosticGate.reason
              };
              addAudit(audit, {
                kind: "info",
                title: "Local-state-diagnostik redan levererad",
                detail:
                  `${executionPlan.actionId} · generation=${diagnosticKey.slice(0, 16)} · ` +
                  "ingen ny chat-control för oförändrad no-delta-generation.",
                windowId,
                tabId: run.targetTabId,
                runId: run.runId
              });
            } else {
              control = await prepareChatControlContinuation(run, {
                config,
                continuity,
                observation,
                reasonCode: rearmDecision.reason,
                reasonDetail: run.waitingForUnlockEvent,
                sourceActionId: executionPlan.actionId,
                diagnostics: { localState: diagnostic },
                now
              });
              run = control.run;
              const deliveredDiagnostic =
                control.created ||
                sanitizeText(control.receipt?.localStateDiagnosticKey, 128).toLowerCase() ===
                  diagnosticKey;
              if (deliveredDiagnostic) {
                run.localStateDiagnosticReceipt = {
                  schema: "eic.autonom.local-state-diagnostic-receipt.v1",
                  diagnosticKey,
                  effectId: sanitizeText(control.receipt?.effectId, 180),
                  turnId: sanitizeText(control.receipt?.turnId, 180),
                  wakeKey: sanitizeText(control.receipt?.wakeKey || candidateWakeKey, 128).toLowerCase(),
                  generation: Math.max(
                    0,
                    Number(control.receipt?.generation || candidateWakeGeneration)
                  ),
                  status: sanitizeText(control.receipt?.status, 80) || "PREPARED",
                  createdAt: nowIso(now)
                };
              }
            }
          } else {
            control = await prepareChatControlContinuation(run, {
              config,
              continuity,
              observation,
              reasonCode: rearmEligible ? rearmDecision.reason : "LOCAL_ACTION_COMPLETE",
              reasonDetail: run.waitingForUnlockEvent,
              sourceActionId: executionPlan.actionId,
              now
            });
            run = control.run;
          }
        }

        context.run = run;
        addAudit(audit, {
          kind: rearmEligible && !reanalyse ? "warning" : "done",
          title: terminalNanoFailureInputUnchanged
            ? "Terminal Nano-failure diagnostik materialiserad"
            : rearmEligible && !reanalyse
              ? "Lokal no-delta-loop stoppad och AI-sessionen väcks"
              : "Lokalt Nano-mikrosteg utfört",
          detail: `${executionPlan.actionId} · ${executionPlan.effectClass} · material-target-dispatch=0 · chat-control=${control ? (control.created ? "1" : "deduped") : "0"} · rearm=${reanalyse ? "1" : "0"} · ${rearmDecision.reason} · receipt ${localReceipt.receiptId}.`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(
          run.targetTabId,
          reanalyse ? "ASSESSING" : "WAITING",
          reanalyse
            ? "Nano väljer nästa mikrosteg"
            : control?.created ? "Kontrollprompt skickas till AI-sessionen" : "Kontrollprompt redan materialiserad"
        );
        await notifyPanels(windowId);
        if (reanalyse) {
          setTimeout(() => tickWindow(windowId, "local-microstep-reanalysis").catch(console.warn), 0);
          return snapshotForWindow(windowId);
        }
        const controlStatus = String(control?.receipt?.status || "").toUpperCase();
        if (control?.created || ["PREPARED", "SUBMITTING", "SUBMITTED_UNCONFIRMED"].includes(controlStatus)) {
          return executePreparedEffectUnlocked(windowId);
        }
        return snapshotForWindow(windowId);
      }

      if (executionPlan.executionDisposition === EXECUTION_DISPOSITIONS.TERMINAL) {
        const rollbackDetail = await restoreAutoDiscardableOnTerminal(run);
        run = transitionRun(run, STATES.STOPPED, {
          origin: PAUSE_ORIGINS.NONE,
          reason: sanitizeText(
            `Nano valde terminalt mikrosteg ${executionPlan.actionId}; ingen target-dispatch skapades.${rollbackDetail ? ` ${rollbackDetail}` : ""}`,
            1200
          ),
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "done",
          title: "Nano-gren stoppad lokalt",
          detail: `${executionPlan.actionId} · target-dispatch=0.`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(run.targetTabId, "STOPPED", "Nano stoppade lokal gren");
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }

      const trueExternalBoundary = [
        EXECUTION_DISPOSITIONS.WAIT_EXTERNAL_EVENT,
        EXECUTION_DISPOSITIONS.EXTERNAL_OWNER_EXECUTE
      ].includes(executionPlan.executionDisposition);

      if (trueExternalBoundary) {
        run.waitingForUnlockEvent = sanitizeText(
          decision.unlockEvent ||
          `En verklig extern producent utanför EIC_AI_SESSION, AGENT och NANO måste skapa verifierat nytt materiellt underlag för ${executionPlan.ownerSurface || "EXTERNAL_SYSTEM"}.`,
          1200
        );
        // v0.11.19: a genuine external dependency is a valid investigative wait,
        // not a program failure. The Agent must become quiescent without bouncing
        // the dependency back into the same EIC chat or emitting repeated control
        // turns. A new target response/manual resume may re-enter the controller.
        run.runtimeDecisionStatus = "WAIT_EXTERNAL_EVENT";
        run.timeoutSuspended = true;
        run.responseDeadlineAt = null;
        run.waitingObservation = observation ? deepClone(observation) : null;
        run.externalWait = {
          schema: "eic.autonom.external-wait.v2",
          actionId: executionPlan.actionId,
          disposition: executionPlan.executionDisposition,
          executorActor: executionPlan.executorActor || "EXTERNAL_SYSTEM",
          ownerSurface: executionPlan.ownerSurface || "EXTERNAL_SYSTEM",
          observationIdentity: sanitizeText(
            observation?.responseIdentity || observation?.responseHash,
            512
          ),
          createdAt: nowIso(now)
        };
        const waitPredicateKey = [
          "external",
          sanitizeText(executionPlan.ownerSurface || "EXTERNAL_SYSTEM", 160),
          sanitizeText(executionPlan.actionId, 160)
        ].join(":");
        const waitBaselineDigest = sanitizeText(
          observation?.responseIdentity ||
          observation?.responseHash ||
          run.lastProcessedResponseIdentity ||
          run.lastProcessedAssistantHash,
          512
        );
        const waitCommit = commitCausalControl(run, {
          type: CAUSAL_EVENT.WAIT_ENTER,
          waitKind: "WAIT_EXTERNAL_EVENT",
          causalUnitId: run.runId,
          predicateKey: waitPredicateKey,
          baselineDigest: waitBaselineDigest,
          allowedWakeSources: ["TARGET_PAGE"]
        }, { now });
        if (!waitCommit.accepted) {
          throw new Error(`CAUSAL_WAIT_ENTER_FAILED:${waitCommit.reason || "UNKNOWN"}`);
        }
        run = waitCommit.run;
        run.externalWait.predicateKey = waitPredicateKey;
        run.externalWait.baselineDigest = waitBaselineDigest;
        run.resumePlan = {
          requestedAction: run.waitingForUnlockEvent,
          requiredEvidence: [
            "Verifierat nytt materiellt underlag från den verkliga externa producenten, ett nytt mål-svar med materiellt delta eller explicit manuell återupptagning."
          ],
          workUnit: sanitizeText(
            decision.boundedCurrentUnit ||
            decision.workUnit ||
            continuity?.position?.workUnit,
            1200
          ),
          alternatives: [],
          reason: "TRUE_EXTERNAL_SYSTEM_DEPENDENCY"
        };
        run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
          origin: PAUSE_ORIGINS.NONE,
          reason:
            `${executionPlan.actionId} kräver ${executionPlan.executionDisposition}. ` +
            "Missionen väntar passivt på verkligt externt material; samma EIC-chat används inte som external-system-proxy.",
          force: true
        });
        context.run = run;
        addAudit(audit, {
          kind: "info",
          title: "Väntar på extern producent — ingen chat-control",
          detail:
            `${executionPlan.actionId} · ${executionPlan.executionDisposition} · ` +
            `executor=${executionPlan.executorActor || "EXTERNAL_SYSTEM"} · ` +
            "material-target-dispatch=0 · chat-control=0 · timeout=suspended.",
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(
          run.targetTabId,
          "WAITING",
          "Väntar på nytt material från extern producent"
        );
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }

      const localCapabilityBoundary =
        executionPlan.localStateReadSuppressed === true &&
        sanitizeText(observation?.targetResult?.nextActor, 80).toUpperCase() === "AGENT";
      run.waitingForUnlockEvent = sanitizeText(
        localCapabilityBoundary
          ? agentLocalCapabilityBoundaryReason()
          : (decision.unlockEvent || "Ny owner-state eller response identity."),
        1800
      );
      run.runtimeDecisionStatus = "WAIT_OWNER_EVENT";
      run.timeoutSuspended = true;
      run.responseDeadlineAt = null;
      run.waitingObservation = observation ? deepClone(observation) : null;
      run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
        origin: PAUSE_ORIGINS.NONE,
        reason: `${executionPlan.actionId} kräver ${executionPlan.executionDisposition}; materiell target-dispatch är förbjuden och den anslutna EIC_AI_SESSION väcks exakt en gång via chat-control.`,
        force: true
      });
      const control = await prepareChatControlContinuation(run, {
        config,
        continuity,
        observation,
        reasonCode: localCapabilityBoundary ? "AGENT_CAPABILITY_HANDOFF_REQUIRED" : run.runtimeDecisionStatus,
        reasonDetail: run.waitingForUnlockEvent,
        sourceActionId: executionPlan.actionId,
        now
      });
      run = control.run;
      context.run = run;
      addAudit(audit, {
        kind: "info",
        title: "EIC AI-steg materialiserat i AI-chatten",
        detail: `${executionPlan.actionId} · ${executionPlan.executionDisposition} · material-target-dispatch=0 · chat-control=${control.created ? "1" : "deduped"} · ${run.waitingForUnlockEvent || control.reason}`,
        windowId,
        tabId: run.targetTabId,
        runId: run.runId
      });
      await writeRuntimeBundle(runtime, continuity, audit);
      await setTabIndicator(
        run.targetTabId,
        "WAITING",
        control.created ? "Kontrollprompt skickas till EIC AI-sessionen" : "Kontrollprompt redan materialiserad"
      );
      await notifyPanels(windowId);
      const controlStatus = String(control.receipt?.status || "").toUpperCase();
      if (control.created || ["PREPARED", "SUBMITTING", "SUBMITTED_UNCONFIRMED"].includes(controlStatus)) {
        return executePreparedEffectUnlocked(windowId);
      }
      return snapshotForWindow(windowId);
    }

    // v0.11.3 I4/I5/I9: material delivery regulation is evaluated only after
    // the execution disposition is known. A blocked material target effect wakes
    // the AI through exactly one chat-control turn instead of entering a silent
    // WAITING state with no causal producer.
    if (materialDeliveryRegulatorEligible(executionPlan, {
      baselinePromptOnly,
      protocolRepairOnly
    })) {
      deliveryDisposition = resolveDeliveryRegulatorDisposition({
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

      if (deliveryDisposition.disposition ===
          DELIVERY_REGULATOR_DISPOSITIONS.WAIT_FOR_NEW_EVIDENCE) {
        run.deliveryWait = {
          ...deliveryDisposition.wait,
          createdAt: nowIso(now)
        };
        run.waitingForUnlockEvent = deliveryDisposition.wait?.unlocksNextAction ||
          "Skapa nytt materiellt owner-underlag innan samma target-effekt kan övervägas igen.";
        run.resumePlan = {
          requestedAction: run.waitingForUnlockEvent,
          requiredEvidence: [
            "Ett nytt direkt programdelta eller ett verifierat owner-/säkerhetsresultat med exakt unlock."
          ],
          workUnit: sanitizeText(decision.boundedCurrentUnit || decision.workUnit, 1200),
          alternatives: [],
          reason: deliveryDisposition.wait?.reason || "DIRECT_PROGRAM_DELTA_ZERO"
        };
        run.waitingObservation = observation ? deepClone(observation) : null;
        run.runtimeDecisionStatus = "WAIT_OWNER_EVENT";
        run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
          origin: PAUSE_ORIGINS.NO_PROGRESS,
          reason: "Material target-dispatch blockerades av delivery regulator; AI-sessionen väcks via side-band chat-control.",
          force: true
        });
        const control = await prepareChatControlContinuation(run, {
          config,
          continuity,
          observation,
          reasonCode: "DELIVERY_REGULATOR_WAIT_FOR_NEW_EVIDENCE",
          reasonDetail: run.waitingForUnlockEvent,
          sourceActionId: executionPlan.actionId,
          now
        });
        run = control.run;
        context.run = run;
        const wake = waitWakeInvariant(run);
        if (!wake.valid) {
          run = transitionRun(run, STATES.PROGRAM_BLOCKED, {
            origin: PAUSE_ORIGINS.INTERNAL_INVARIANT,
            reason: `WAIT_WITHOUT_CAUSAL_WAKE_SOURCE:${wake.reason}`,
            force: true
          });
          context.run = run;
        }
        addAudit(audit, {
          kind: wake.valid ? "warning" : "blocked",
          title: wake.valid
            ? "Delivery regulator stoppade material effekt och väckte AI-sessionen"
            : "Causal wait-invariant bruten",
          detail: `${executionPlan.actionId} · material-target-dispatch=0 · chat-control=${control.created ? "1" : "deduped"} · wake=${wake.reason}.`,
          windowId,
          tabId: run.targetTabId,
          runId: run.runId
        });
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(
          run.targetTabId,
          wake.valid ? "WAITING" : "BLOCKED",
          wake.valid
            ? (control.created ? "Kontrollprompt skickas till AI-sessionen" : "Kontrollprompt redan materialiserad")
            : "WAIT_WITHOUT_CAUSAL_WAKE_SOURCE"
        );
        await notifyPanels(windowId);
        if (!wake.valid) return snapshotForWindow(windowId);
        const controlStatus = String(control.receipt?.status || "").toUpperCase();
        if (control.created ||
            ["PREPARED", "SUBMITTING", "SUBMITTED_UNCONFIRMED"].includes(controlStatus)) {
          return executePreparedEffectUnlocked(windowId);
        }
        return snapshotForWindow(windowId);
      }
    } else {
      run.deliveryRegulatorDisposition = "NOT_APPLICABLE_NON_MATERIAL";
    }

    // Protocol repair is side-band control traffic. It must not consume a
    // substantive program turn or trigger checkpoint rollover.
    if (!protocolRepairOnly) {
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
        workUnitOwnerSurface: baselinePromptOnly
          ? sessionInitOutboundWorkUnitOwnerSurface
          : (executionPlan.ownerSurface || decision.ownerRoute || TARGET_SESSION_OWNER),
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
    if (genericRewriteAllowed &&
        isNearDuplicateAction(candidate.compiled.actionKey, run.promptHistory, 1)) {
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

    if (baselinePromptOnly) {
      const outboundSessionInitIntegrity = await validateSessionInitIntegritySeal(
        sessionInitIntegritySeal,
        {
          baselinePromptOnly: true,
          kind: "SESSION_CONTEXT_BASELINE_REQUEST",
          decision: {
            ...decision,
            requestedAction
          },
          outboundWorkUnitOwnerSurface: turn?.workUnit?.ownerSurface
        }
      );
      if (!outboundSessionInitIntegrity.valid) {
        const failure = {
          schema: "eic.autonom.session-init-prompt-integrity-failure.v1",
          failureCode: SESSION_INIT_PROMPT_MUTATED,
          expectedDigest: outboundSessionInitIntegrity.expectedDigest,
          recomputedDigest: outboundSessionInitIntegrity.recomputedDigest,
          detectedAt: nowIso(),
          stage: "POST_COMPILE_OWNER_SEPARATION"
        };
        run = applySessionInitPromptIntegrityFailure(run, {
          windowId,
          audit,
          failure,
          detail: `Protected session-init outbound owner separation failed; expected=${failure.expectedDigest} recomputed=${failure.recomputedDigest}.`,
          now
        });
        context.run = run;
        await writeRuntimeBundle(runtime, continuity, audit);
        await setTabIndicator(run.targetTabId, "BLOCKED", SESSION_INIT_PROMPT_MUTATED);
        await notifyPanels(windowId);
        return snapshotForWindow(windowId);
      }
    }

    const parentTurnSnapshot = shallowTurnLineageSnapshot(run.currentTurn);
    const protocolRepairSideBand = protocolRepairOnly
      ? {
          schema: "eic.autonom.protocol-repair-sideband.v1",
          repairTargetTurnId: sanitizeText(
            request?.expectedTurnId || observation?.targetResult?.turnId || priorTurnId,
            180
          ),
          parentTurnId: sanitizeText(priorTurnId, 180) || null,
          substantiveWorkUnitId: sanitizeText(
            continuity.position?.workUnitId || decision.boundedCurrentUnit || decision.workUnit,
            240
          ),
          parserReason: sanitizeText(
            request?.protocolReason || observation?.targetResult?.reason || "PROTOCOL_INVALID",
            240
          ),
          preparedAt: nowIso()
        }
      : null;
    const effect = {
      effectId: randomId("effect"),
      turnId,
      agentVersion: APP_VERSION,
      promptDigest: compiled.promptDigest,
      prompt: compiled.prompt,
      actionKey: compiled.actionKey,
      microActionId: executionPlan.actionId,
      executionDisposition: executionPlan.executionDisposition,
      executionFamilyKey: resolvedExecutionFamilyKey,
      ackMode: "TURN_ID",
      requireTurnMarker: true,
      sourceObservationHash: observation?.responseHash || "",
      sourceObservationIdentity: observation?.responseIdentity || "",
      sourceObservationEpoch: observation?.documentEpoch || "",
      // v0.12.13: direction of travel for the owner readback. See
      // classifyPreparedEffectObservation().
      sourceObservationTurnSeq: Number(observation?.latestAssistantTurnSeq || 0),
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
      sessionContextBaseline: baselinePromptOnly,
      parentTurnSnapshot,
      turnKind: turn.kind,
      effectClass: executionPlan.effectClass,
      protocolRepairSideBand,
      sessionInitIntegrity: baselinePromptOnly
        ? {
            ...sessionInitIntegritySeal,
            expectedCompiledPromptDigest: compiled.promptDigest,
            observedOutboundWorkUnitOwnerSurface: turn?.workUnit?.ownerSurface || ""
          }
        : null
    };
    run.currentTurn = {
      turnId,
      agentVersion: APP_VERSION,
      priorTurnId,
      priorResponseContract: run.currentTurn?.responseContract || START_RESPONSE_CONTRACTS.TURN_BOUND_5,
      priorResponseExpectedTurnId: run.currentTurn?.responseExpectedTurnId || run.currentTurn?.turnId || "",
      effectState: "PREPARED",
      promptDigest: compiled.promptDigest,
      actionKey: compiled.actionKey,
      kind: turn.kind,
      responseContract: START_RESPONSE_CONTRACTS.TURN_BOUND_5
    };
    if (protocolRepairSideBand) {
      run.protocolRepairReceipt = {
        ...protocolRepairSideBand,
        schema: "eic.autonom.protocol-repair-receipt.v1",
        agentVersion: APP_VERSION,
        effectId: effect.effectId,
        repairTurnId: turnId,
        status: "PREPARED"
      };
    }
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
      title: protocolRepairOnly
        ? "Protokollreparation förberedd (side-band)"
        : "Nästa substantiella tur förberedd",
      detail: protocolRepairOnly
        ? `${protocolRepairSideBand?.repairTargetTurnId || "(unknown target)"} · ${protocolRepairSideBand?.parserReason || "PROTOCOL_INVALID"}`
        : requestedAction,
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
  const numericWindowId = nullableInteger(windowId);
  if (numericWindowId === null) return null;
  const timer = autoCaptureTimers.get(numericWindowId);
  if (timer) {
    clearTimeout(timer);
    autoCaptureTimers.delete(numericWindowId);
  }
  const active = sessionCaptureInFlight.get(numericWindowId) ||
    autoCaptureInFlight.get(numericWindowId);
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
  const numericWindowId = nullableInteger(windowId);
  if (numericWindowId === null) return null;
  const active = await signalAutomaticCaptureCancellation(windowId, reason);
  autoCaptureNanoDeferred.delete(numericWindowId);
  context.autoCaptureDeferral = null;
  if (active?.automatic && active?.requestId && Number.isInteger(active.tabId)) {
    context.autoCaptureGuard = createAutoCaptureGuard({
      fingerprint: active.fingerprint,
      requestId: active.requestId,
      status: "CANCELLED",
      error: reason
    });
  }
}

async function controlRun(windowId, action) {
  // Preempt transcript capture before entering the single-owner queue. v0.12.8
  // attempted cancellation only after the capture released that same queue.
  if (action === "PAUSE" || action === "STOP") {
    await signalAutomaticCaptureCancellation(
      windowId,
      action === "STOP" ? "OPERATOR_STOP" : "OPERATOR_PAUSE"
    );
  }
  return enqueue(async () => {
    const { continuity, runtime, audit } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    let run = context.run;
    if (!run) throw new Error("Ingen körning finns.");

    if (action === "PAUSE") {
      if ([STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION].includes(run.state)) {
        throw new Error("OWNER_BOUND_HUMAN_WAIT_CANNOT_PAUSE");
      }
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
      const exhaustedCommitReceipt = run.sessionContextInit?.baselineDecisionCommit || null;
      const exhaustedCommitCode = sanitizeText(
        exhaustedCommitReceipt?.commitStatus === SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED
          ? exhaustedCommitReceipt?.readyLastErrorCode
          : exhaustedCommitReceipt?.lastCommitErrorCode,
        160
      );
      if (exhaustedCommitReceipt?.retryEligible === false &&
          sessionContextBaselineCommitNeedsRecovery(exhaustedCommitReceipt) &&
          /SESSION_CONTEXT_(?:BASELINE|READY)_COMMIT_RETRY_EXHAUSTED/u.test(exhaustedCommitCode)) {
        const resumedReceipt = {
          ...deepClone(exhaustedCommitReceipt),
          retryEligible: true,
          nanoRerunRequired: false,
          updatedAt: nowIso()
        };
        if (resumedReceipt.commitStatus === SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED) {
          resumedReceipt.readyAttemptCount = 0;
          resumedReceipt.readyLastErrorCode = "";
          resumedReceipt.readyLastErrorDetail = "";
        } else {
          resumedReceipt.commitAttemptCount = 0;
          resumedReceipt.lastCommitErrorCode = "";
          resumedReceipt.lastCommitErrorDetail = "";
        }
        run.sessionContextInit = {
          ...run.sessionContextInit,
          state: SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING,
          completedAt: null,
          baselineDecisionCommit: resumedReceipt,
          updatedAt: nowIso()
        };
        run.runtimeDecisionStatus = "NANO_DECISION_COMMIT_RETRY_RESUMED";
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
      if (run.sessionContextInit &&
          ![SESSION_CONTEXT_INIT_STATE.READY, SESSION_CONTEXT_INIT_STATE.FAILED]
            .includes(run.sessionContextInit.state)) {
        run.sessionContextInit = failSessionContextInit(run.sessionContextInit, {
          code: SESSION_CONTEXT_INIT_FAILURE_CODE.RUN_OWNER_TERMINATED,
          detail: "Sessionsinitieringen avbröts eftersom operatören stoppade dess ägande körning.",
          now: Date.now()
        });
        run.pendingNanoRequest = null;
        run.pendingObservation = null;
      }
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
      await writeRuntimeBundle(
        bundle.runtime,
        continuity,
        bundle.audit,
        windowId,
        { [STORAGE_KEYS.CONFIG]: config }
      );
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
      await writeRuntimeBundle(
        bundle.runtime,
        restoredContinuity,
        bundle.audit,
        windowId,
        { [STORAGE_KEYS.CONFIG]: restoredConfig }
      );
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
    if (!target?.surfaceId || nullableInteger(target.tabId) === null) {
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
 * Operator recovery for a FAILED session-context initialization.
 *
 * Recovery is explicitly split at the baseline-delivery boundary:
 * - PRE_DELIVERY_RETRY may restart catch/baseline/Nano from phase one.
 * - POST_DELIVERY_RECONCILE preserves the ACKed baseline effect and resumes from
 *   the already delivered turn, after re-validating its current page owner.
 *
 * A terminal run never receives a nonterminal init mutation. STOPPED remains an
 * operator-owned terminal state; starting a new run is a separate owner action.
 */
async function retrySessionContextInitialization(windowId) {
  return enqueue(async () => {
    const { continuity, runtime, audit, applicationLog } = await loadBundle(windowId);
    const context = getWindowContext(runtime, windowId);
    let run = context.run;
    if (!run) throw new Error("Ingen körning är bunden till fönstret.");
    if ([STATES.PROGRAM_DONE, STATES.STOPPED, STATES.ERROR_TERMINAL].includes(run.state)) {
      throw new Error(
        `SESSION_CONTEXT_INIT_RETRY_TERMINAL_RUN:${run.state}: ` +
        "sessionsinitieringen ändrades inte. Starta en ny körning med den ordinarie startåtgärden."
      );
    }
    if (!sessionContextInitRetryable(run.sessionContextInit)) {
      throw new Error(
        "Sessionsinitieringen är inte i ett återförsöksbart fel-läge, eller har nått taket för operatörsåterförsök."
      );
    }

    const delivery = sessionContextBaselineDelivery(run);
    const recoveryClass = delivery.delivered
      ? SESSION_CONTEXT_INIT_RECOVERY_CLASS.POST_DELIVERY_RECONCILE
      : SESSION_CONTEXT_INIT_RECOVERY_CLASS.PRE_DELIVERY_RETRY;

    if (recoveryClass === SESSION_CONTEXT_INIT_RECOVERY_CLASS.POST_DELIVERY_RECONCILE) {
      const currentPage = await readPage(run.targetTabId, "session-context-post-delivery-retry");
      const expectedConversation = String(
        delivery.effect?.conversationKey ||
        delivery.init?.conversationKey ||
        run.conversationKey ||
        ""
      );
      const currentOwner = pageResponseOwnerPrefix(currentPage);
      const responseIdentity = String(delivery.init?.baselineResponseIdentity || "");
      const responseHash = responseIdentity.split("|").at(-1) || "";
      const expectedOwner = responseIdentityOwnerPrefix(responseIdentity, responseHash);
      const sameConversation = Boolean(
        expectedConversation &&
        String(currentPage.conversationKey || "") === expectedConversation
      );
      const effectStillOwned = pageContainsEffect(currentPage, delivery.effect);
      const responseOwnerCompatible = expectedOwner
        ? currentOwner === expectedOwner
        : Boolean(
            currentPage?.latestUser &&
            String(currentPage.latestUser).includes(String(delivery.effect?.turnId || ""))
          );

      if (!sameConversation || !effectStillOwned || !responseOwnerCompatible) {
        throw new Error(
          "SESSION_CONTEXT_INIT_POST_DELIVERY_OWNER_CHANGED: den aktuella sidan kan inte bindas " +
          "till det redan levererade baseline-svaret. Sessionsinitieringen lämnades oförändrad; " +
          "starta en ny körning för den aktuella user-turnen."
        );
      }
    }

    const now = Date.now();
    const retry = retrySessionContextInit(run.sessionContextInit, {
      now,
      recoveryClass
    });
    if (!retry.ok) throw new Error(`SESSION_CONTEXT_INIT_RETRY_REJECTED:${retry.reason}`);

    run.sessionContextInit = retry.value;
    run.pendingNanoRequest = null;
    run.pendingObservation = null;
    run.deterministicGroundingFailure = null;
    run.deterministicDispatchFailure = null;
    run.deterministicDispatchRearms = 0;
    run.resumePlan = null;
    run.timeoutSuspended = false;
    run.takeoverBootstrapRequired =
      recoveryClass === SESSION_CONTEXT_INIT_RECOVERY_CLASS.PRE_DELIVERY_RETRY;
    run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
      origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
      reason: recoveryClass === SESSION_CONTEXT_INIT_RECOVERY_CLASS.POST_DELIVERY_RECONCILE
        ? "Operatören begärde återhämtning från den redan levererade baseline-turen; ingen ny baselineprompt skickas."
        : "Operatören begärde ett nytt försök före baselineleverans. Catch armeras om från början.",
      now,
      force: true
    });
    context.run = run;
    addAudit(audit, {
      kind: "info",
      title: "Sessionsinitiering återarmerad av operatören",
      detail: `Försök ${run.sessionContextInit.recoveryAttempts}/${SESSION_CONTEXT_INIT_MAX_OPERATOR_RETRIES} · ` +
        (recoveryClass === SESSION_CONTEXT_INIT_RECOVERY_CLASS.POST_DELIVERY_RECONCILE
          ? "redan levererad baseline bevaras; aktuellt baselinesvar reconcileras utan ny prompt."
          : "pre-delivery catch, baseline och Nano körs om från fas 1."),
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
      data: {
        recoveryAttempts: run.sessionContextInit.recoveryAttempts,
        recoveryClass
      }
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    if (nextApplicationLog !== applicationLog) {
      await chrome.storage.local.set({ [STORAGE_KEYS.APPLICATION_LOG]: nextApplicationLog });
    }
    await setTabIndicator(
      run.targetTabId,
      "INITIALIZING",
      recoveryClass === SESSION_CONTEXT_INIT_RECOVERY_CLASS.POST_DELIVERY_RECONCILE
        ? "Redan levererat baselinesvar reconcileras"
        : "Sessionskontext initieras om",
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
  const rawInput = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
    ? payload.input
    : {};
  let input = rawInput;
  let nanoTaskOnly = false;
  if (typeof rawInput.startPrompt === "string") {
    const nanoTaskDirective = splitNanoTaskDirective(rawInput.startPrompt);
    if (nanoTaskDirective.found) {
      input = { ...rawInput, startPrompt: nanoTaskDirective.missionText };
      nanoTaskOnly = !nanoTaskDirective.missionText.trim();
      await enqueue(async () => {
        const { continuity, runtime, audit } = await loadBundle(windowId);
        const context = getWindowContext(runtime, windowId);
        const queued = queueNanoTaskHarness(context, {
          task: nanoTaskDirective.task,
          sourceUserHash: `start:${sanitizeText(rawInput.startPrompt, 240)}`,
          sourceConversationKey: context.run?.conversationKey || "",
          now: Date.now()
        });
        if (queued.queued) {
          addAudit(audit, {
            kind: "info",
            title: "NANO_TASK separerad före mission-start",
            detail: `${queued.harness.requestId} · direktivet togs bort från mission-prompten.`,
            windowId,
            tabId: context.run?.targetTabId || null,
            runId: context.run?.runId || null
          });
          await writeRuntimeBundle(runtime, continuity, audit);
          await notifyPanels(windowId);
        }
      });
    }
  }
  if (nanoTaskOnly) {
    return snapshotForWindow(windowId);
  }

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
  return serializeFullAuditPersistence(async () => {
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
  });
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
  [UI_COMMANDS.NANO_TASK_CLAIM]: ({ windowId, payload }) =>
    claimNanoTask(windowId, payload),
  [UI_COMMANDS.NANO_TASK_COMPLETE]: ({ windowId, payload }) =>
    completeNanoTask(windowId, payload),
  [UI_COMMANDS.NANO_TASK_FAILURE]: ({ windowId, payload }) =>
    failNanoTask(windowId, payload),
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
      windowId: nullableInteger(message?.windowId) !== null ? Number(message.windowId) : null,
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
        windowId: nullableInteger(message?.windowId) !== null ? Number(message.windowId) : null,
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
        windowId: nullableInteger(message?.windowId) !== null ? Number(message.windowId) : null,
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
  run = retireResponseCandidate(run, {
    status: RESPONSE_OBSERVATION_CYCLE_STATUS.CONSUMED,
    reason: "HUMAN_OWNER_LATCHED_OPERATOR_ACTION",
    now: Date.now()
  });
  run.waitingObservation = null;
  run.waitingForUnlockEvent = "";
  run.runtimeDecisionStatus = "AWAITING_OPERATOR_ACTION";
  run.timeoutSuspended = true;
  run.responseDeadlineAt = null;

  // v0.11.12: cancel any not-yet-dispatched effect that might have been
  // prepared by an earlier branch/callback. ACKED/submitted history remains
  // immutable evidence; only PREPARED/RETRY_PREPARED work is suppressed.
  const pendingEffect = latestEffect(run);
  if (pendingEffect && ["PREPARED", "RETRY_PREPARED"].includes(String(pendingEffect.status || ""))) {
    pendingEffect.status = "CANCELLED_OPERATOR_ACTION";
    pendingEffect.lastError = "OPERATOR_ACTION_REQUIRED_DOMINANT_BOUNDARY";
    delete pendingEffect.prompt;
    if (run.currentTurn?.turnId === pendingEffect.turnId) {
      run.currentTurn.effectState = "CANCELLED_OPERATOR_ACTION";
    }
  }

  run = transitionRun(run, STATES.AWAITING_OPERATOR_ACTION, {
    origin: PAUSE_ORIGINS.NONE,
    reason: `OPERATOR_ACTION_REQUIRED: ${action.instruction}`,
    force: true
  });
  context.run = run;
  const db = await sessionDatabase();
  await db.put("operatorActions", action);
  addAudit(audit, {
    kind: "warning",
    title: "Mekanisk operatörsåtgärd krävs",
    detail: `${action.actionId} · ${action.actionType} · ${action.instruction}`,
    windowId,
    tabId: run.targetTabId,
    runId: run.runId
  });
  await writeRuntimeBundle(runtime, continuity, audit, windowId);
  await chrome.storage.local.set({
    [SESSION_DB_POINTER_KEYS.READINESS]: {
      state: "AWAITING_OPERATOR_ACTION",
      windowId: nullableInteger(windowId),
      actionId: action.actionId,
      missionId,
      runId: run.runId,
      updatedAt: nowIso()
    }
  });
  await setTabIndicator(run.targetTabId, "PAUSED", "Exakt operatörsåtgärd väntar på kvitto");
  await notifyPanels(windowId);
  return snapshotForWindow(windowId);
}

async function submitOperatorActionEvidence(windowId, message = {}) {
  return enqueue(async () => {
    const bundle = await readRuntimeBundle(windowId);
    const { runtime, context, continuity, audit } = bundle;
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
        force: true,
        ownerBoundaryReceipt: {
          kind: "OPERATOR_ACTION_RECEIPT",
          receiptId: result.action.receipt?.receiptId || "",
          actionId: result.action.receipt?.actionId || "",
          missionId: result.action.receipt?.missionId || "",
          runId: result.action.receipt?.runId || ""
        }
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
        windowId: nullableInteger(windowId),
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
  return sessionContextInitVerifiedReady(run?.sessionContextInit);
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
  const numericWindowId = nullableInteger(windowId);
  if (numericWindowId === null) throw new Error("SESSION_CAPTURE_WINDOW_ID_REQUIRED");
  return enqueue(async () => {
    const bundle = await loadBundle(numericWindowId);
    const { config, runtime, audit, applicationLog } = bundle;
    const context = getWindowContext(runtime, numericWindowId);
    const run = context.run;
    const captureGate = shouldDeferSessionCapture({
      automatic,
      run,
      nanoHostTelemetry: context.nanoHostTelemetry
    });
    if (captureGate.defer) {
      if (automatic && captureGate.retryable) {
        const nanoOwned = nanoOwnsSessionCapture({
          run,
          nanoHostTelemetry: context.nanoHostTelemetry
        });
        if (nanoOwned) {
          await markNanoAutoCaptureDeferred({
            bundle,
            context,
            windowId,
            trigger: trigger || "capture-race",
            requestId
          });
          throw new Error("SESSION_CAPTURE_DEFERRED:NANO_OWNERSHIP");
        }
        // Non-Nano transient deferrals retain the bounded v0.10.11 backoff.
        autoCaptureDefers.set(numericWindowId, (autoCaptureDefers.get(numericWindowId) || 0) + 1);
        scheduleBackgroundAutoSessionCapture(numericWindowId, "capture-deferred-retry");
        throw new Error(`SESSION_CAPTURE_CANCELLED:${captureGate.reason}`);
      }
      throw new Error(captureGate.reason);
    }
    const tabId = nullableInteger(run?.targetTabId ?? context.selectedTabId);
    if (tabId === null) throw new Error("SESSION_CAPTURE_TARGET_TAB_REQUIRED");
    const captureRequestId = sanitizeText(requestId, 240) || randomId("manual-capture");
    sessionCaptureInFlight.set(numericWindowId, {
      requestId: captureRequestId,
      tabId,
      fingerprint,
      automatic
    });
    try {
      const sweep = await chrome.tabs.sendMessage(tabId, {
        type: "EIC_CAPTURE_TRANSCRIPT",
        requestId: captureRequestId
      });
      if (!sweep?.ok) throw new Error(`SESSION_CAPTURE_SWEEP_FAILED:${sweep?.error || "UNKNOWN"}`);

      const pointers = await chrome.storage.local.get([
        SESSION_DB_POINTER_KEYS.ACTIVE_CAPTURE_ID,
        SESSION_DB_POINTER_KEYS.ACTIVE_MEMORY_ID
      ]);
      const db = await sessionDatabase();
      // Per-window runtime summaries are the authoritative continuation pointers.
      // The legacy global storage pointers remain only a compatibility mirror.
      const priorCaptureId = sanitizeText(
        context.sessionCaptureSummary?.captureId ||
        pointers[SESSION_DB_POINTER_KEYS.ACTIVE_CAPTURE_ID],
        300
      );
      const priorMemoryId = sanitizeText(
        context.sessionMemorySummary?.memoryId ||
        pointers[SESSION_DB_POINTER_KEYS.ACTIVE_MEMORY_ID],
        300
      );
      const priorCapture = priorCaptureId
        ? await db.get("captures", priorCaptureId)
        : null;
      const priorMemory = priorMemoryId
        ? await db.get("sessionMemories", priorMemoryId)
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
      automaticReviewDue &&
      !coreSurfaceReviewSessionReady(run)
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
      // Durable runtime is the commit marker for the IndexedDB capture/memory
      // records. Only after that owner commit succeeds do we refresh the legacy
      // global pointer mirror. A mirror failure must not invalidate committed
      // per-window state.
      await writeRuntimeBundle(runtime, bundle.continuity, audit, numericWindowId);
      try {
        await chrome.storage.local.set({
          [SESSION_DB_POINTER_KEYS.ACTIVE_CAPTURE_ID]: result.capture.id,
          [SESSION_DB_POINTER_KEYS.ACTIVE_MEMORY_ID]: memory.id,
          [SESSION_DB_POINTER_KEYS.READINESS]: {
            state: memory.state,
            windowId: numericWindowId,
            conversationKey: result.capture.conversationKey,
            captureId: result.capture.id,
            memoryId: memory.id,
            completeness: result.capture.completeness,
            updatedAt: nowIso()
          }
        });
      } catch (pointerError) {
        console.warn("SESSION_CAPTURE_POINTER_MIRROR_FAILED", pointerError);
      }
      await notifyPanels(numericWindowId);
      return snapshotForWindow(numericWindowId);
    } finally {
      const activeCapture = sessionCaptureInFlight.get(numericWindowId);
      if (activeCapture?.requestId === captureRequestId) {
        sessionCaptureInFlight.delete(numericWindowId);
      }
    }
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
    const decisionMaterialConfigChanged = [
      "quickProfileId",
      "scenarioPreset",
      "nanoMandate",
      "nanoMandateVersion",
      "nanoMandateProfile",
      "targetMandate",
      "targetMandateVersion",
      "targetMandateProfile",
      "missionPolicyProfile",
      "evidenceBand",
      "autonomyBand",
      "outputDensity"
    ].some((key) => nextConfig?.[key] !== config?.[key]);
    const savedConfig = await saveConfigUnlocked(nextConfig);

    let ownerEventRearmed = false;
    if (decisionMaterialConfigChanged && context.run) {
      let run = context.run;
      run.materialControlGeneration = Math.max(
        0,
        Number(run.materialControlGeneration || 0)
      ) + 1;
      const waitingObservation = run.waitingObservation && typeof run.waitingObservation === "object"
        ? deepClone(run.waitingObservation)
        : null;
      if (run.runtimeDecisionStatus === "WAIT_OWNER_EVENT" && waitingObservation?.observationId) {
        run.nanoFailureFence = null;
        run.pendingObservation = {
          ...waitingObservation,
          materialControlGeneration: run.materialControlGeneration
        };
        run.pendingNanoRequest = buildPendingNanoRequest({
          observationId: waitingObservation.observationId,
          analysisMode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS,
          now: Date.now()
        });
        run.waitingObservation = null;
        run.waitingForUnlockEvent = "";
        run.runtimeDecisionStatus = "OWNER_EVENT_REANALYSIS_PENDING";
        run.timeoutSuspended = false;
        run.responseDeadlineAt = Date.now() + Number(savedConfig.responseTimeoutMs || 7_200_000);
        run.nanoTelemetry ||= {};
        run.nanoTelemetry.previousResultSummary = sanitizeText(run.nanoTelemetry.lastResultSummary, 2400);
        run.nanoTelemetry.previousCompletedAt = run.nanoTelemetry.lastCompletedAt || null;
        run.nanoTelemetry.lastRequestId = run.pendingNanoRequest.requestId;
        run.nanoTelemetry.lastMode = NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS;
        run.nanoTelemetry.lastStatus = "PENDING";
        run.nanoTelemetry.lastSource = NANO_DECISION_SOURCE.NANO;
        run.nanoTelemetry.lastStartedAt = null;
        run.nanoTelemetry.lastCompletedAt = null;
        run.nanoTelemetry.lastDurationMs = null;
        run.nanoTelemetry.lastInputDigest = "";
        run.nanoTelemetry.lastInputChars = 0;
        run.nanoTelemetry.lastOutputChars = 0;
        run.nanoTelemetry.lastChunkCount = 0;
        run.nanoTelemetry.lastFirstTokenAt = null;
        run.nanoTelemetry.lastResultSummary = "";
        run.nanoTelemetry.lastError = "";
        run = transitionRun(run, STATES.ASSESSING, {
          origin: PAUSE_ORIGINS.NONE,
          reason: "Verifierad Core Surface Review ändrade materiell lokal kontrollstate; samma bundna observation får exakt en ny seriell Nano-bedömning.",
          force: true
        });
        ownerEventRearmed = true;
      } else if (run.runtimeDecisionStatus === "WAIT_OWNER_EVENT") {
        // The owner event is material, but no replayable bound observation survived.
        // Do not synthesize target context. Stay in an explicit wait projection.
        run.nanoFailureFence = null;
        run = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
          origin: PAUSE_ORIGINS.NONE,
          reason: "Materiell lokal kontrollstate ändrades, men ingen replaybar observation finns; väntar på nästa stabila owner-response.",
          force: true
        });
      }
      context.run = run;
    }

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
      detail: `${proposal.reviewId} · ${automatic ? "TTL_AUTO_APPLY" : "explicit operatörsacceptans"} · source=${review.captureId}/${review.memoryId} · config=${savedConfig.updatedAt} · owner-event=${decisionMaterialConfigChanged ? "MATERIAL" : "NON_MATERIAL"} · rearm=${ownerEventRearmed ? "1" : "0"}`,
      windowId,
      tabId: context.run?.targetTabId || context.selectedTabId || null,
      runId: context.run?.runId || null
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    await notifyPanels(windowId);
    if (ownerEventRearmed) {
      setTimeout(() => tickWindow(windowId, "core-surface-review-material-owner-event").catch(console.warn), 0);
    }
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
    const bundle = await readRuntimeBundle(windowId);
    bundle.context.sessionCaptureSummary = null;
    bundle.context.sessionMemorySummary = null;
    bundle.context.autoCaptureFingerprint = "";
    bundle.context.coreSurfaceReview = null;
    if (bundle.context.run) {
      bundle.context.run.sessionCaptureSummary = null;
      bundle.context.run.sessionMemorySummary = null;
    }
    addAudit(bundle.audit, {
      kind: "warning",
      title: "Lokalt sessionskontext rensat",
      detail: `IndexedDB-poster raderade=${result.deleted}`,
      windowId,
      runId: bundle.context.run?.runId || null
    });
    await writeRuntimeBundle(bundle.runtime, bundle.continuity, bundle.audit);
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
    const bundle = await readRuntimeBundle(windowId);
    const { runtime, context, continuity, audit } = bundle;
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
      force: true,
      ownerBoundaryReceipt: {
        kind: "OPERATOR_DECISION_RECEIPT",
        receiptId: accepted.decision.receipt?.receiptId || "",
        decisionId: accepted.decision.receipt?.decisionId || "",
        missionId: accepted.decision.receipt?.missionId || "",
        runId: accepted.decision.receipt?.runId || "",
        boundaryKey: accepted.decision.receipt?.boundaryKey || ""
      }
    });
    context.run = run;
    addAudit(audit, {
      kind: "info",
      title: "Materiellt operatörsbeslut mottaget — verifierar readback",
      detail: `${accepted.decision.decisionId} · graphembundet kvitto · idempotent=${accepted.idempotent}`,
      windowId,
      tabId: run.targetTabId,
      runId: run.runId
    });
    await writeRuntimeBundle(runtime, continuity, audit);
    const readbackBundle = await readRuntimeBundle(windowId);
    const readbackRun = readbackBundle.context.run;
    const readbackDecision = readbackRun?.operatorDecision;
    const receiptMatches =
      readbackDecision?.receipt?.receiptId === accepted.decision.receipt.receiptId &&
      readbackRun?.boundaryAuthorization?.receipt?.receiptId === accepted.decision.receipt.receiptId &&
      readbackRun?.boundaryAuthorization?.boundaryKey === accepted.decision.boundaryKey &&
      readbackRun?.state === STATES.RECOVERING;
    if (!receiptMatches) {
      throw new Error("OPERATOR_DECISION_RECEIPT_READBACK_FAILED");
    }
    addAudit(readbackBundle.audit, {
      kind: "done",
      title: "Materiellt operatörsbeslut kvitterat och readback-verifierat",
      detail: `${accepted.decision.decisionId} · receipt=${accepted.decision.receipt.receiptId} · state=${readbackRun.state}.`,
      windowId,
      tabId: readbackRun.targetTabId,
      runId: readbackRun.runId
    });
    try {
      await writeRuntimeBundle(
        readbackBundle.runtime,
        readbackBundle.continuity,
        readbackBundle.audit
      );
    } catch (auditPersistError) {
      // Functional receipt/readback already succeeded. Do not turn an audit-only
      // follow-up write into a second caller-visible human gate.
      console.warn("Operator decision success-audit persistence failed after verified receipt", auditPersistError);
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

  if (message?.type === "EIC_CONTENT_BRIDGE_READY" && sender.tab?.windowId != null && sender.tab?.id != null) {
    enqueue(async () => {
      const { continuity, runtime, audit } = await loadBundle(sender.tab.windowId);
      const context = getWindowContext(runtime, sender.tab.windowId);
      const linked = context.linkedTabs?.[String(sender.tab.id)] || null;
      const observedConversationKey = sanitizeText(message.conversationKey, 800);
      if (linked?.conversationKey && observedConversationKey &&
          linked.conversationKey !== observedConversationKey) {
        return {
          ok: true,
          status: "DISCONNECTED",
          detail: "Content bridge laddades på en annan konversation än den durable länkningen.",
          overlay: null
        };
      }
      if (linked) {
        linked.documentEpoch = sanitizeText(message.documentEpoch, 240) || linked.documentEpoch || "";
        linked.lastSeenAt = nowIso();
        linked.status = "LINKED";
        await writeRuntimeBundle(runtime, continuity, audit);
      }
      return { ok: true, ...linkStatusProjectionForTab(context, sender.tab.id) };
    })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
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
  const responseSettleWindowId = responseSettleAlarmWindowId(alarm?.name);
  if (Number.isInteger(responseSettleWindowId)) {
    tickWindow(responseSettleWindowId, "response-stability-alarm").catch(console.warn);
    return;
  }
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
    const { rootContinuity, runtime, audit } = await loadBundle();
    const context = runtime.windows[String(windowId)];
    if (!context) return;
    const continuity = context.continuity || rootContinuity;
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
    // Explicit null means root-only persistence. Do not fall back to the removed
    // window's continuity scope and recreate the context we just deleted.
    await writeRuntimeBundle(runtime, rootContinuity, audit, null);
  }).catch(console.warn);
});


if (chrome.debugger?.onEvent?.addListener) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = nullableInteger(source?.tabId);
    const normalized = normalizeCdpEvidenceEvent(method, params || {});
    if (tabId === null || !normalized) return;
    enqueue(async () => {
      const discovery = await loadBundle();
      const discoveredContext = Object.values(discovery.runtime.windows || {}).find(
        (candidate) => nullableInteger(webTargetSurface(candidate)?.tabId) === tabId
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
    const tabId = nullableInteger(source?.tabId);
    if (tabId === null) return;
    enqueue(async () => {
      const discovery = await loadBundle();
      const discoveredContext = Object.values(discovery.runtime.windows || {}).find(
        (candidate) => nullableInteger(webTargetSurface(candidate)?.tabId) === tabId
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
