import { clampInteger, deepClone, nowIso, randomId, sanitizeText } from "./common.mjs";
import { RUN_MODES } from "./contracts.mjs";
import { isAssistantResponseCandidate, normalizeMessageRole } from "./response-trigger.mjs";
import { createObservationLoopState } from "./autonomy-progress.mjs";
import {
  createSessionContextInit,
  failSessionContextInit,
  sessionContextInitBlocksWork,
  SESSION_CONTEXT_INIT_FAILURE_CODE
} from "./session-context-init.mjs";
import {
  RESPONSE_OBSERVATION_CYCLE_STATUS,
  bindResponseCandidateOwner,
  createResponseObservationCycle,
  updateResponseObservationCycle
} from "./response-observation-cycle.mjs";
import {
  CAUSAL_EVENT,
  causalPolicyFenceActive,
  commitCausalControl,
  createCausalControlState
} from "./causal-transition-authority.mjs";

export const STATES = Object.freeze({
  IDLE: "IDLE",
  RUNNING: "RUNNING",
  PREPARING: "PREPARING",
  WAITING_FOR_RESPONSE: "WAITING_FOR_RESPONSE",
  WAITING_FOREGROUND: "WAITING_FOREGROUND",
  WAITING_BACKGROUND: "WAITING_BACKGROUND",
  ASSESSING: "ASSESSING",
  CONTINUING: "CONTINUING",
  RECOVERING: "RECOVERING",
  SOFT_PAUSED: "SOFT_PAUSED",
  PROGRAM_BLOCKED: "PROGRAM_BLOCKED",
  PROGRAM_DONE: "PROGRAM_DONE",
  STOPPED: "STOPPED",
  ERROR_RETRYABLE: "ERROR_RETRYABLE",
  ERROR_TERMINAL: "ERROR_TERMINAL",
  MJOLNAR_ADJUDICATING: "MJOLNAR_ADJUDICATING",
  MJOLNAR_DISPATCH: "MJOLNAR_DISPATCH",
  MJOLNAR_READBACK: "MJOLNAR_READBACK",
  AWAITING_OPERATOR_ACTION: "AWAITING_OPERATOR_ACTION",
  AWAITING_OPERATOR_DECISION: "AWAITING_OPERATOR_DECISION"
});

export const PAUSE_ORIGINS = Object.freeze({
  NONE: "NONE",
  OPERATOR_PAUSE: "OPERATOR_PAUSE",
  DIRECT_OPERATOR_STOP: "DIRECT_OPERATOR_STOP",
  TARGET_REQUESTED_PAUSE: "TARGET_REQUESTED_PAUSE",
  USER_PAUSE: "USER_PAUSE",
  MODEL_UNCERTAINTY: "MODEL_UNCERTAINTY",
  TRANSIENT_TRANSPORT: "TRANSIENT_TRANSPORT",
  LIFECYCLE_INTERRUPTION: "LIFECYCLE_INTERRUPTION",
  MAXIMUM_TURN_POLICY: "MAXIMUM_TURN_POLICY",
  EVIDENCE_BOUNDARY: "EVIDENCE_BOUNDARY",
  AUTHORIZATION_BOUNDARY: "AUTHORIZATION_BOUNDARY",
  AUTHENTICATION_OR_CAPTCHA: "AUTHENTICATION_OR_CAPTCHA",
  DESTRUCTIVE_CONFIRMATION_REQUIRED: "DESTRUCTIVE_CONFIRMATION_REQUIRED",
  PRIVACY_OR_SECRET_BOUNDARY: "PRIVACY_OR_SECRET_BOUNDARY",
  POLICY_OR_SAFETY_BOUNDARY: "POLICY_OR_SAFETY_BOUNDARY",
  TAB_CLOSED: "TAB_CLOSED",
  TAB_MOVED: "TAB_MOVED",
  TAB_NAVIGATED_AWAY: "TAB_NAVIGATED_AWAY",
  WINDOW_CLOSED: "WINDOW_CLOSED",
  NANO_HOST_REQUIRED: "NANO_HOST_REQUIRED",
  NANO_GROUNDING_REJECTED: "NANO_GROUNDING_REJECTED",
  OBSERVATION_SUPERSEDED: "OBSERVATION_SUPERSEDED",
  PROTOCOL_MISSING: "PROTOCOL_MISSING",
  PROTOCOL_AMBIGUOUS: "PROTOCOL_AMBIGUOUS",
  NO_PROGRESS: "NO_PROGRESS",
  NO_PROGRESS_BUDGET_EXHAUSTED: "NO_PROGRESS_BUDGET_EXHAUSTED",
  GENUINE_DEAD_END: "GENUINE_DEAD_END",
  INTERNAL_INVARIANT: "INTERNAL_INVARIANT",
  OPERATOR_PROXY_CANDIDATE: "OPERATOR_PROXY_CANDIDATE",
  BACKGROUND_CANCELLED: "BACKGROUND_CANCELLED",
  BACKGROUND_ERROR: "BACKGROUND_ERROR",
  TARGET_FROZEN_OR_DISCARDED: "TARGET_FROZEN_OR_DISCARDED",
  PROMPT_REPETITION_GUARD: "PROMPT_REPETITION_GUARD",
  STORAGE_PERSISTENCE_FAILURE: "STORAGE_PERSISTENCE_FAILURE"
});

export const NANO_PAUSE_ORIGINS = Object.freeze([
  PAUSE_ORIGINS.TARGET_REQUESTED_PAUSE,
  PAUSE_ORIGINS.USER_PAUSE,
  PAUSE_ORIGINS.MODEL_UNCERTAINTY,
  PAUSE_ORIGINS.EVIDENCE_BOUNDARY,
  PAUSE_ORIGINS.AUTHORIZATION_BOUNDARY,
  PAUSE_ORIGINS.AUTHENTICATION_OR_CAPTCHA,
  PAUSE_ORIGINS.DESTRUCTIVE_CONFIRMATION_REQUIRED,
  PAUSE_ORIGINS.PRIVACY_OR_SECRET_BOUNDARY,
  PAUSE_ORIGINS.POLICY_OR_SAFETY_BOUNDARY,
  PAUSE_ORIGINS.NO_PROGRESS,
  PAUSE_ORIGINS.GENUINE_DEAD_END
]);

export const HARD_BOUNDARY_ORIGINS = Object.freeze([
  PAUSE_ORIGINS.USER_PAUSE,
  PAUSE_ORIGINS.AUTHORIZATION_BOUNDARY,
  PAUSE_ORIGINS.AUTHENTICATION_OR_CAPTCHA,
  PAUSE_ORIGINS.DESTRUCTIVE_CONFIRMATION_REQUIRED,
  PAUSE_ORIGINS.PRIVACY_OR_SECRET_BOUNDARY,
  PAUSE_ORIGINS.POLICY_OR_SAFETY_BOUNDARY
]);

export const RECOVERY_LADDER = Object.freeze([
  Object.freeze({
    id: "REFRESH_OBSERVATION",
    instruction: "Läs om den faktiska målstatusen en gång och identifiera exakt vad som ändrats sedan senaste observationen.",
    maxAttempts: 1
  }),
  Object.freeze({
    id: "REDUCE_SCOPE",
    instruction: "Minska arbetsenheten till den minsta självständiga del som kan ge en verifierbar leverans.",
    maxAttempts: 1
  }),
  Object.freeze({
    id: "CHANGE_EVIDENCE_PATH",
    instruction: "Välj en tekniskt distinkt evidensväg inom befintlig behörighet; läs inte om samma källa utan freshnessbehov.",
    maxAttempts: 1
  }),
  Object.freeze({
    id: "PRODUCE_SMALLEST_DELIVERABLE",
    instruction: "Sluta omgranska och producera den minsta konkreta arbetsprodukten som för uppgiften framåt.",
    maxAttempts: 1
  }),
  Object.freeze({
    id: "REQUEST_DECOMPOSITION",
    instruction: "Dekomponera blockerad arbetsenhet och utför den första säkra del som inte kräver ny behörighet.",
    maxAttempts: 1
  }),
  Object.freeze({
    id: "DECLARE_EXACT_BOUNDARY",
    instruction: "Verifiera den exakta kvarvarande gränsen och ange en konkret unlock-händelse utan att kringgå den.",
    maxAttempts: 1
  })
]);

export const TERMINAL_STATES = new Set([
  STATES.PROGRAM_DONE,
  STATES.STOPPED,
  STATES.ERROR_TERMINAL
]);

const POLICY_FENCE_FAILSAFE_EXITS = new Set([
  STATES.STOPPED,
  STATES.ERROR_TERMINAL
]);

const ALLOWED = Object.freeze({
  [STATES.IDLE]: new Set([STATES.PREPARING, STATES.RUNNING, STATES.STOPPED]),
  [STATES.RUNNING]: new Set([
    STATES.PREPARING, STATES.WAITING_FOR_RESPONSE, STATES.WAITING_FOREGROUND,
    STATES.WAITING_BACKGROUND, STATES.ASSESSING, STATES.CONTINUING, STATES.RECOVERING,
    STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION,
    STATES.PROGRAM_BLOCKED, STATES.PROGRAM_DONE, STATES.STOPPED
  ]),
  [STATES.PREPARING]: new Set([
    STATES.WAITING_FOR_RESPONSE, STATES.WAITING_FOREGROUND, STATES.WAITING_BACKGROUND,
    STATES.CONTINUING, STATES.RECOVERING, STATES.SOFT_PAUSED, STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION, STATES.PROGRAM_BLOCKED,
    STATES.ERROR_TERMINAL, STATES.STOPPED
  ]),
  [STATES.WAITING_FOR_RESPONSE]: new Set([
    STATES.WAITING_FOREGROUND, STATES.WAITING_BACKGROUND, STATES.ASSESSING,
    STATES.RECOVERING, STATES.SOFT_PAUSED, STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION, STATES.PROGRAM_BLOCKED,
    STATES.STOPPED, STATES.ERROR_RETRYABLE
  ]),
  [STATES.WAITING_FOREGROUND]: new Set([
    STATES.WAITING_FOR_RESPONSE, STATES.WAITING_BACKGROUND, STATES.ASSESSING,
    STATES.RECOVERING, STATES.SOFT_PAUSED, STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION, STATES.PROGRAM_BLOCKED,
    STATES.STOPPED, STATES.ERROR_RETRYABLE
  ]),
  [STATES.WAITING_BACKGROUND]: new Set([
    STATES.WAITING_BACKGROUND, STATES.WAITING_FOR_RESPONSE, STATES.WAITING_FOREGROUND,
    STATES.ASSESSING, STATES.RECOVERING, STATES.SOFT_PAUSED, STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION, STATES.PROGRAM_BLOCKED,
    STATES.AWAITING_OPERATOR_DECISION, STATES.STOPPED, STATES.ERROR_RETRYABLE
  ]),
  [STATES.ASSESSING]: new Set([
    STATES.CONTINUING, STATES.PROGRAM_DONE, STATES.RECOVERING, STATES.SOFT_PAUSED,
    STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION, STATES.PROGRAM_BLOCKED, STATES.ERROR_RETRYABLE, STATES.ERROR_TERMINAL,
    STATES.MJOLNAR_ADJUDICATING, STATES.AWAITING_OPERATOR_DECISION, STATES.STOPPED
  ]),
  [STATES.CONTINUING]: new Set([
    STATES.WAITING_FOR_RESPONSE, STATES.WAITING_FOREGROUND, STATES.WAITING_BACKGROUND,
    STATES.RECOVERING, STATES.SOFT_PAUSED, STATES.ERROR_RETRYABLE,
    STATES.ERROR_TERMINAL, STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION, STATES.PROGRAM_BLOCKED, STATES.STOPPED
  ]),
  [STATES.RECOVERING]: new Set([
    STATES.WAITING_FOR_RESPONSE, STATES.WAITING_FOREGROUND, STATES.WAITING_BACKGROUND,
    STATES.ASSESSING, STATES.CONTINUING, STATES.SOFT_PAUSED, STATES.PROGRAM_BLOCKED,
    STATES.ERROR_RETRYABLE, STATES.ERROR_TERMINAL, STATES.STOPPED
  ]),
  [STATES.MJOLNAR_ADJUDICATING]: new Set([
    STATES.MJOLNAR_DISPATCH, STATES.AWAITING_OPERATOR_DECISION, STATES.RECOVERING, STATES.SOFT_PAUSED,
    STATES.PROGRAM_BLOCKED, STATES.ERROR_RETRYABLE, STATES.STOPPED
  ]),
  [STATES.MJOLNAR_DISPATCH]: new Set([
    STATES.MJOLNAR_READBACK, STATES.RECOVERING, STATES.ERROR_RETRYABLE, STATES.AWAITING_OPERATOR_DECISION, STATES.STOPPED
  ]),
  [STATES.MJOLNAR_READBACK]: new Set([
    STATES.WAITING_FOR_RESPONSE, STATES.CONTINUING, STATES.RECOVERING, STATES.AWAITING_OPERATOR_DECISION,
    STATES.ERROR_RETRYABLE, STATES.STOPPED
  ]),
  [STATES.AWAITING_OPERATOR_ACTION]: new Set([
    STATES.STOPPED, STATES.ERROR_TERMINAL
  ]),
  [STATES.AWAITING_OPERATOR_DECISION]: new Set([
    STATES.STOPPED, STATES.ERROR_TERMINAL
  ]),
  [STATES.SOFT_PAUSED]: new Set([
    STATES.RECOVERING, STATES.WAITING_FOR_RESPONSE, STATES.WAITING_FOREGROUND,
    STATES.WAITING_BACKGROUND, STATES.ASSESSING, STATES.CONTINUING, STATES.STOPPED
  ]),
  [STATES.PROGRAM_BLOCKED]: new Set([STATES.RECOVERING, STATES.STOPPED]),
  [STATES.ERROR_RETRYABLE]: new Set([STATES.RECOVERING, STATES.SOFT_PAUSED, STATES.STOPPED]),
  [STATES.ERROR_TERMINAL]: new Set([]),
  [STATES.PROGRAM_DONE]: new Set([]),
  [STATES.STOPPED]: new Set([])
});

export function canTransition(from, to) {
  return Boolean(ALLOWED[from]?.has(to));
}

export const OWNER_BOUND_HUMAN_STATES = new Set([
  STATES.AWAITING_OPERATOR_ACTION,
  STATES.AWAITING_OPERATOR_DECISION
]);

const OWNER_BOUND_TERMINAL_EXITS = new Set([
  STATES.STOPPED,
  STATES.ERROR_TERMINAL
]);

function sameReceiptIdentity(actual, supplied, fields) {
  if (!actual || !supplied || typeof supplied !== "object") return false;
  return fields.every((field) =>
    sanitizeText(actual?.[field], 1200) &&
    sanitizeText(actual?.[field], 1200) === sanitizeText(supplied?.[field], 1200)
  );
}

/**
 * v0.11.13: owner-bound human waits are state-machine invariants.
 *
 * `force` is intentionally powerless against these source states. The only
 * non-terminal exit is RECOVERING and it requires the exact accepted local
 * receipt already persisted on the run plus a matching receipt identity
 * supplied by the owner-specific submit path.
 */
export function ownerBoundHumanExitAuthorized(run, to, ownerBoundaryReceipt = null) {
  if (!run || !OWNER_BOUND_HUMAN_STATES.has(run.state) || run.state === to) return true;
  if (OWNER_BOUND_TERMINAL_EXITS.has(to)) return true;
  if (to !== STATES.RECOVERING) return false;

  if (run.state === STATES.AWAITING_OPERATOR_ACTION) {
    const action = run.operatorAction;
    const receipt = action?.receipt;
    return action?.status === "COMPLETED" &&
      receipt?.schema === "eic.autonom.operator-action-receipt.v1" &&
      ownerBoundaryReceipt?.kind === "OPERATOR_ACTION_RECEIPT" &&
      sameReceiptIdentity(receipt, ownerBoundaryReceipt, [
        "receiptId", "actionId", "missionId", "runId"
      ]);
  }

  const decision = run.operatorDecision;
  const receipt = decision?.receipt;
  return decision?.status === "ACCEPTED" &&
    receipt?.schema === "eic.autonom.operator-decision-receipt.v1" &&
    ownerBoundaryReceipt?.kind === "OPERATOR_DECISION_RECEIPT" &&
    sameReceiptIdentity(receipt, ownerBoundaryReceipt, [
      "receiptId", "decisionId", "missionId", "runId", "boundaryKey"
    ]);
}

export function transitionRun(run, to, {
  origin = PAUSE_ORIGINS.NONE,
  reason = "",
  nextRecoveryAt = null,
  now = Date.now(),
  force = false,
  ownerBoundaryReceipt = null
} = {}) {
  if (!run || typeof run !== "object") throw new TypeError("Run saknas.");
  if (!Object.values(STATES).includes(to)) throw new TypeError(`Okänt state: ${to}`);
  if (TERMINAL_STATES.has(run.state) && run.state !== to) {
    return deepClone(run);
  }

  // v0.12.5 — a current-generation causal policy fence is a state-machine
  // invariant, not call-site advice. While PROGRAM_BLOCKED is fenced, no
  // scheduler/recovery path (including force:true) may re-enter active work in
  // the same causal generation. Only explicit fail-safe terminal exits remain
  // legal. A genuine material event advances materialGeneration and thereby
  // makes the old fence stale before recovery can resume.
  if (run.state === STATES.PROGRAM_BLOCKED &&
      run.state !== to &&
      causalPolicyFenceActive(run) &&
      !POLICY_FENCE_FAILSAFE_EXITS.has(to)) {
    const denied = deepClone(run);
    denied.lastDeniedTransition = {
      schema: "eic.autonom.transition-denial.v1",
      from: run.state,
      to,
      origin,
      reason: "CAUSAL_POLICY_FENCE",
      fenceCode: sanitizeText(run?.causalControl?.policyFence?.code, 160),
      fenceGeneration: Number(run?.causalControl?.policyFence?.generation ?? -1),
      materialGeneration: Number(run?.causalControl?.materialGeneration ?? 0),
      at: nowIso(now)
    };
    return denied;
  }

  const ownerBoundExit = OWNER_BOUND_HUMAN_STATES.has(run.state) && run.state !== to;
  const ownerBoundAuthorized = ownerBoundExit &&
    ownerBoundHumanExitAuthorized(run, to, ownerBoundaryReceipt);
  if (ownerBoundExit && !ownerBoundAuthorized) {
    throw new Error(`OWNER_BOUND_HUMAN_TRANSITION_REQUIRES_RECEIPT:${run.state}->${to}`);
  }

  const safetyEscape = [
    STATES.SOFT_PAUSED,
    STATES.PROGRAM_BLOCKED,
    STATES.AWAITING_OPERATOR_ACTION,
    STATES.AWAITING_OPERATOR_DECISION,
    STATES.ERROR_RETRYABLE,
    STATES.ERROR_TERMINAL,
    STATES.STOPPED
  ].includes(to) && !TERMINAL_STATES.has(run.state);
  if (!force && run.state !== to && !canTransition(run.state, to) && !safetyEscape && !ownerBoundAuthorized) {
    throw new Error(`Ogiltig transition ${run.state} -> ${to}`);
  }

  const next = deepClone(run);
  next.state = to;
  next.stateRevision = clampInteger(next.stateRevision, 0, Number.MAX_SAFE_INTEGER, 0) + 1;
  next.updatedAt = nowIso(now);
  next.lastTransition = {
    from: run.state,
    to,
    origin,
    reason: sanitizeText(reason, 1200),
    at: next.updatedAt
  };

  if ([STATES.SOFT_PAUSED, STATES.PROGRAM_BLOCKED, STATES.AWAITING_OPERATOR_ACTION, STATES.AWAITING_OPERATOR_DECISION, STATES.ERROR_RETRYABLE, STATES.ERROR_TERMINAL].includes(to)) {
    next.pause = {
      origin,
      reason: sanitizeText(reason, 2000),
      at: next.updatedAt,
      recoverable: [STATES.SOFT_PAUSED, STATES.ERROR_RETRYABLE].includes(to),
      nextRecoveryAt
    };
  } else if (to !== STATES.RECOVERING) {
    next.pause = null;
  }

  if (nextRecoveryAt !== undefined) {
    next.recovery ||= {};
    next.recovery.nextRecoveryAt = nextRecoveryAt;
  }

  // v0.11.17: terminal run ownership is atomic across nested lifecycle machines.
  // A terminal run cannot leave session-init or response observation active.
  if (TERMINAL_STATES.has(to)) {
    if (next.sessionContextInit && sessionContextInitBlocksWork(next.sessionContextInit)) {
      next.sessionContextInit = failSessionContextInit(next.sessionContextInit, {
        code: SESSION_CONTEXT_INIT_FAILURE_CODE.RUN_OWNER_TERMINATED,
        detail: `Run owner terminaliserades i ${to}; aktiv sessionsinitiering stängdes atomiskt.`,
        now
      });
    }
    if (next.pendingNanoRequest &&
        ["PENDING", "DETERMINISTIC_PENDING", "RUNNING"].includes(String(next.pendingNanoRequest.status || ""))) {
      next.pendingNanoRequest = {
        ...next.pendingNanoRequest,
        status: "FAILED",
        lastError: "RUN_OWNER_TERMINATED",
        completedAt: next.updatedAt
      };
    }
    next.responseObservationCycle = updateResponseObservationCycle(
      next.responseObservationCycle,
      {
        status: to === STATES.ERROR_TERMINAL
          ? RESPONSE_OBSERVATION_CYCLE_STATUS.FAILED
          : RESPONSE_OBSERVATION_CYCLE_STATUS.CONSUMED,
        candidate: next.responseCandidate,
        reason: `RUN_OWNER_TERMINATED:${to}`,
        now
      }
    );
    next.responseCandidate = null;
    next.pendingObservation = null;
    next.currentTurn = null;
    next.effectJournal = [];
    next.waitingObservation = null;
    next.waitingForUnlockEvent = "";
    next.externalWait = null;
    next.responseDeadlineAt = null;
    next.timeoutSuspended = true;
    const causalTerminal = commitCausalControl(next, {
      type: CAUSAL_EVENT.TERMINALIZE,
      terminalState: to,
      reason: sanitizeText(reason, 500) || `RUN_OWNER_TERMINATED:${to}`
    }, { now });
    if (causalTerminal.accepted) Object.assign(next, causalTerminal.run);
  }
  return next;
}

export function createRun({
  windowId,
  targetTabId,
  conversationKey = "",
  baselineAssistantHash = "",
  baselineAssistantComplete = false,
  baselineAssistantCount = 0,
  baselineResponseIdentity = "",
  mode = RUN_MODES.WAITING_CONTINUE,
  maxAutonomousMode = true,
  now = Date.now()
}) {
  if (!Number.isInteger(windowId)) throw new TypeError("windowId måste vara ett heltal.");
  if (!Number.isInteger(targetTabId)) throw new TypeError("targetTabId måste vara ett heltal.");
  if (!Object.values(RUN_MODES).includes(mode)) throw new TypeError("Ogiltigt run mode.");

  const at = nowIso(now);
  const runId = randomId("run");
  return {
    schema: "eic.autonom.run.v13",
    runId,
    causalControl: createCausalControlState({ runId, now }),
    windowId,
    targetTabId,
    conversationKey,
    mode,
    state: STATES.PREPARING,
    stateRevision: 0,
    maxAutonomousMode: maxAutonomousMode !== false,
    startedAt: at,
    updatedAt: at,
    lastTickAt: null,
    lastProgressAt: at,
    turnIndex: 0,
    checkpointIndex: 0,
    baselineAssistantHash,
    baselineAssistantComplete: Boolean(baselineAssistantComplete),
    baselineAssistantCount: clampInteger(baselineAssistantCount, 0, Number.MAX_SAFE_INTEGER, 0),
    lastProcessedAssistantHash: baselineAssistantHash,
    lastProcessedAssistantComplete: Boolean(baselineAssistantComplete),
    lastProcessedAssistantCount: clampInteger(baselineAssistantCount, 0, Number.MAX_SAFE_INTEGER, 0),
    lastProcessedResponseIdentity: sanitizeText(baselineResponseIdentity, 512),
    responseCandidate: null,
    responseObservationCycle: createResponseObservationCycle({ runId, now }),
    responseSettleFailure: null,
    causalOwnershipStrand: null,
    causalOwnershipFailure: null,
    pendingObservation: null,
    pendingNanoRequest: null,
    sessionContextInit: createSessionContextInit({
      runId,
      conversationKey,
      now
    }),
    operatorAction: null,
    operatorDecision: null,
    quickProfileBinding: null,
    lastNanoTrace: null,
    lastNanoAttemptTrace: null,
    lastDeterministicRecoveryTrace: null,
    decisionOwner: "",
    runtimeDecisionStatus: "IDLE",
    materialControlGeneration: 0,
    waitingObservation: null,
    chatControlContinuationReceipt: null,
    chatControlGeneration: 0,
    deterministicGroundingFailure: null,
    observationGeneration: 0,
    lastSupersededObservation: null,
    observationLoop: createObservationLoopState(),
    nanoTelemetry: {
      lastRequestId: "",
      lastMode: "",
      lastStatus: "IDLE",
      lastStartedAt: null,
      lastCompletedAt: null,
      lastDurationMs: null,
      lastInputDigest: "",
      lastInputChars: 0,
      lastOutputChars: 0,
      lastChunkCount: 0,
      lastFirstTokenAt: null,
      lastHeartbeatAt: null,
      lastResultSummary: "",
      lastError: "",
      lastSource: ""
    },
    takeoverBootstrapRequired: mode === RUN_MODES.WAITING_CONTINUE,
    currentTurn: null,
    effectJournal: [],
    promptHistory: [],
    responseDeadlineAt: null,
    timeoutSuspended: false,
    waitStartedAt: null,
    lastBackgroundEvidenceAt: null,
    lastReconcileAt: null,
    nextReconcileReason: null,
    previousAutoDiscardable: null,
    taskFingerprint: "",
    lastVerifiedSnapshotHash: "",
    tabState: null,
    backgroundCompletionCandidate: null,
    backgroundEntryCount: 0,
    destructiveness: {
      level: 1,
      name: "READ_ONLY",
      reasonCode: "INITIAL",
      humanDecisionRequired: false,
      hjalmarMentalControlRequired: false
    },
    hjalmarMentalControl: {
      required: false,
      verdict: "NOT_REQUIRED",
      reason: "INITIAL",
      checks: {}
    },
    foregroundEvidence: null,
    autonomyPolicyVersion: "EIC_DESTRUCTIVENESS/1",
    mjolnar: {
      state: "IDLE",
      activeRequest: null,
      activeResponse: null,
      ledger: [],
      lastHumanRequiredReason: ""
    },
    pause: null,
    recovery: {
      attempts: [],
      exclusions: [],
      alternativeSet: [],
      nextRecoveryAt: null,
      consecutiveNoProgress: 0,
      lastErrorFingerprint: ""
    },
    startPromptReceipt: null,
    deadEndRecord: null,
    resumePlan: null,
    lastTransition: null
  };
}

/**
 * Boundary classification accepts only an explicit normalized Nano field.
 * Raw target text is never scanned for control-state transitions.
 */
export function classifyBoundaryClaim({
  pauseOrigin = PAUSE_ORIGINS.TARGET_REQUESTED_PAUSE,
  boundaryEvidence = "",
  destructivenessLevel = null
} = {}) {
  const origin = NANO_PAUSE_ORIGINS.includes(pauseOrigin)
    ? pauseOrigin
    : PAUSE_ORIGINS.TARGET_REQUESTED_PAUSE;
  const suppliedLevel = Number(destructivenessLevel);
  const level = Number.isFinite(suppliedLevel)
    ? Math.max(1, Math.min(10, Math.trunc(suppliedLevel)))
    : (HARD_BOUNDARY_ORIGINS.includes(origin) ? 10 : 1);
  return {
    hard: level === 10,
    level,
    origin,
    evidence: sanitizeText(boundaryEvidence, 800)
  };
}

/** @deprecated Raw-text boundary detection is intentionally disabled. */
export function detectHardBoundary() {
  return { hard: false, origin: PAUSE_ORIGINS.NONE, evidence: "" };
}

export function classifyPause({
  requestedOrigin = PAUSE_ORIGINS.TARGET_REQUESTED_PAUSE,
  hardBoundary = null,
  operatorStop = false,
  operatorPause = false,
  alternativesRemaining = 0,
  maxAutonomousMode = false
} = {}) {
  if (operatorStop) {
    return { state: STATES.STOPPED, origin: PAUSE_ORIGINS.DIRECT_OPERATOR_STOP, recover: false };
  }
  if (operatorPause) {
    return { state: STATES.SOFT_PAUSED, origin: PAUSE_ORIGINS.OPERATOR_PAUSE, recover: false };
  }
  if (hardBoundary?.hard) {
    return { state: STATES.PROGRAM_BLOCKED, origin: hardBoundary.origin, recover: false };
  }
  if (maxAutonomousMode && alternativesRemaining > 0) {
    return { state: STATES.RECOVERING, origin: requestedOrigin, recover: true };
  }
  if (requestedOrigin === PAUSE_ORIGINS.GENUINE_DEAD_END) {
    return { state: STATES.PROGRAM_BLOCKED, origin: requestedOrigin, recover: false };
  }
  return { state: STATES.SOFT_PAUSED, origin: requestedOrigin, recover: false };
}

export function isTerminal(run) {
  return Boolean(run && TERMINAL_STATES.has(run.state));
}

export function makeRecoveryAttempt(step, {
  workUnitId = "",
  outcome = "PENDING",
  detail = "",
  now = Date.now()
} = {}) {
  return {
    attemptId: randomId("recovery"),
    step: sanitizeText(step, 120),
    workUnitId: sanitizeText(workUnitId, 160),
    outcome,
    detail: sanitizeText(detail, 800),
    at: nowIso(now)
  };
}

function attemptCount(attempts, stepId) {
  return (Array.isArray(attempts) ? attempts : [])
    .filter((attempt) => attempt?.step === stepId && attempt?.outcome !== "EXCLUDED")
    .length;
}

export function nextRecoveryStep(attempts = [], exclusions = []) {
  const excluded = new Set((Array.isArray(exclusions) ? exclusions : [])
    .map((item) => typeof item === "string" ? item : item?.step)
    .filter(Boolean));
  return RECOVERY_LADDER.find((step) =>
    !excluded.has(step.id) && attemptCount(attempts, step.id) < step.maxAttempts
  ) || null;
}

export function isRecoveryLadderExhausted(attempts = [], exclusions = []) {
  return nextRecoveryStep(attempts, exclusions) === null;
}

export function canDeclareDeadEnd({
  attempts = [],
  exclusions = [],
  alternatives = [],
  stagnationCycles = 0,
  unlockEvent = "",
  blockerCount = 0
} = {}) {
  return (Array.isArray(alternatives) ? alternatives.filter(Boolean).length : 0) === 0 &&
    clampInteger(stagnationCycles, 0, Number.MAX_SAFE_INTEGER, 0) >= 3 &&
    isRecoveryLadderExhausted(attempts, exclusions) &&
    Boolean(sanitizeText(unlockEvent, 1200)) &&
    clampInteger(blockerCount, 0, Number.MAX_SAFE_INTEGER, 0) > 0;
}

export function advanceResponseCandidate(candidate, observation, {
  now = Date.now(),
  settleMs = 2500,
  minimumReads = 2,
  owner = null,
  responseIdentity = ""
} = {}) {
  const hash = sanitizeText(observation?.latestAssistantHash, 128);
  if (!hash || !isAssistantResponseCandidate(observation)) {
    return { candidate: null, settled: false };
  }
  const epoch = sanitizeText(observation.documentEpoch, 180);
  const assistantCount = clampInteger(observation.assistantCount, 0, Number.MAX_SAFE_INTEGER, 0);
  const latestMessageRole = normalizeMessageRole(observation.latestMessageRole);
  const ownerKey = sanitizeText(owner?.key, 320);
  const same = candidate &&
    candidate.hash === hash &&
    candidate.documentEpoch === epoch &&
    (!ownerKey || sanitizeText(candidate.ownerKey, 320) === ownerKey);
  const nextBase = same
    ? {
        ...candidate,
        stableReads: clampInteger(candidate.stableReads, 1, Number.MAX_SAFE_INTEGER, 1) + 1,
        lastSeenAt: nowIso(now)
      }
    : {
        hash,
        documentEpoch: epoch,
        assistantCount,
        latestMessageRole,
        firstSeenAt: nowIso(now),
        lastSeenAt: nowIso(now),
        stableReads: 1
      };
  const next = bindResponseCandidateOwner(nextBase, owner || {}, {
    responseIdentity
  });
  const elapsed = now - Date.parse(next.firstSeenAt);
  return {
    candidate: next,
    settled: next.stableReads >= minimumReads && elapsed >= Math.max(0, Number(settleMs) || 0)
  };
}
