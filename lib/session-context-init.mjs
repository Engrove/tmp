import { deepClone, nowIso, sanitizeText } from "./common.mjs";

export const SESSION_CONTEXT_INIT_SCHEMA = "eic.autonom.session-context-init.v1";

export const SESSION_CONTEXT_BASELINE_COMMIT_SCHEMA =
  "eic.autonom.session-context-baseline-commit.v1";

export const SESSION_CONTEXT_BASELINE_COMMIT_STATUS = Object.freeze({
  DECISION_READY: "DECISION_READY",
  COMMITTING: "COMMITTING",
  COMMITTED: "COMMITTED",
  COMMIT_FAILED: "COMMIT_FAILED"
});

export const SESSION_CONTEXT_READY_FINALIZATION_STATUS = Object.freeze({
  PENDING: "PENDING",
  COMMITTING: "COMMITTING",
  READY: "READY",
  FAILED: "FAILED"
});

function boundedCommitDiagnostics(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    expectedContinuityDigest: sanitizeText(source.expectedContinuityDigest, 96),
    storedContinuityDigest: sanitizeText(source.storedContinuityDigest, 96),
    recomputedContinuityDigest: sanitizeText(source.recomputedContinuityDigest, 96),
    verificationReason: sanitizeText(source.verificationReason, 160)
  };
}

export function createSessionContextBaselineCommitReceipt({
  requestId = "",
  claimId = "",
  analysisMode = "",
  baselineResponseIdentity = "",
  semanticVerdict = "",
  normalizedBaselineAccepted = false,
  acceptedBaseline = null,
  candidateDigest = "",
  decisionDigest = "",
  decision = null,
  baselineAnalysis = null,
  nanoOutputDigest = "",
  forensicsDigest = "",
  createdAt = null,
  now = Date.now()
} = {}) {
  const at = sanitizeText(createdAt, 120) || nowIso(now);
  return {
    schema: SESSION_CONTEXT_BASELINE_COMMIT_SCHEMA,
    version: 1,
    requestId: sanitizeText(requestId, 180),
    claimId: sanitizeText(claimId, 180),
    analysisMode: sanitizeText(analysisMode, 120),
    baselineResponseIdentity: sanitizeText(baselineResponseIdentity, 320),
    semanticVerdict: sanitizeText(semanticVerdict, 80),
    normalizedBaselineAccepted: normalizedBaselineAccepted === true,
    acceptedBaseline: acceptedBaseline && typeof acceptedBaseline === "object"
      ? deepClone(acceptedBaseline)
      : null,
    candidateDigest: sanitizeText(candidateDigest, 96),
    decisionDigest: sanitizeText(decisionDigest, 96),
    decision: decision && typeof decision === "object" ? deepClone(decision) : null,
    baselineAnalysis: baselineAnalysis && typeof baselineAnalysis === "object"
      ? deepClone(baselineAnalysis)
      : null,
    nanoOutputDigest: sanitizeText(nanoOutputDigest, 96),
    forensicsDigest: sanitizeText(forensicsDigest, 96),
    createdAt: at,
    updatedAt: at,
    commitAttemptCount: 0,
    commitStatus: SESSION_CONTEXT_BASELINE_COMMIT_STATUS.DECISION_READY,
    lastCommitErrorCode: "",
    lastCommitErrorDetail: "",
    committedAt: null,
    retryEligible: true,
    nanoRerunRequired: false,
    expectedContinuityDigest: "",
    storedContinuityDigest: "",
    recomputedContinuityDigest: "",
    verificationReason: "",
    readyStatus: SESSION_CONTEXT_READY_FINALIZATION_STATUS.PENDING,
    readyAttemptCount: 0,
    readyLastErrorCode: "",
    readyLastErrorDetail: "",
    readyVerifiedAt: null,
    successAuditEmittedAt: null
  };
}

export function beginSessionContextBaselineCommit(value, { now = Date.now() } = {}) {
  const current = value?.schema === SESSION_CONTEXT_BASELINE_COMMIT_SCHEMA
    ? deepClone(value)
    : null;
  if (!current) return null;
  const at = nowIso(now);
  return {
    ...current,
    commitAttemptCount: Math.max(0, Number(current.commitAttemptCount || 0)) + 1,
    commitStatus: SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTING,
    lastCommitErrorCode: "",
    lastCommitErrorDetail: "",
    retryEligible: true,
    nanoRerunRequired: false,
    updatedAt: at
  };
}

export function failSessionContextBaselineCommit(value, {
  code = "SESSION_CONTEXT_BASELINE_COMMIT_FAILED",
  detail = "",
  diagnostics = {},
  now = Date.now()
} = {}) {
  const current = value?.schema === SESSION_CONTEXT_BASELINE_COMMIT_SCHEMA
    ? deepClone(value)
    : null;
  if (!current) return null;
  return {
    ...current,
    ...boundedCommitDiagnostics(diagnostics),
    commitStatus: SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMIT_FAILED,
    lastCommitErrorCode: sanitizeText(code, 160) || "SESSION_CONTEXT_BASELINE_COMMIT_FAILED",
    lastCommitErrorDetail: sanitizeText(detail, 1200),
    retryEligible: true,
    nanoRerunRequired: false,
    updatedAt: nowIso(now)
  };
}

export function completeSessionContextBaselineCommit(value, {
  diagnostics = {},
  now = Date.now()
} = {}) {
  const current = value?.schema === SESSION_CONTEXT_BASELINE_COMMIT_SCHEMA
    ? deepClone(value)
    : null;
  if (!current) return null;
  const at = nowIso(now);
  return {
    ...current,
    ...boundedCommitDiagnostics(diagnostics),
    commitStatus: SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED,
    lastCommitErrorCode: "",
    lastCommitErrorDetail: "",
    committedAt: current.committedAt || at,
    retryEligible: true,
    nanoRerunRequired: false,
    updatedAt: at
  };
}

export function beginSessionContextReadyFinalization(value, { now = Date.now() } = {}) {
  const current = value?.schema === SESSION_CONTEXT_BASELINE_COMMIT_SCHEMA
    ? deepClone(value)
    : null;
  if (!current) return null;
  return {
    ...current,
    readyAttemptCount: Math.max(0, Number(current.readyAttemptCount || 0)) + 1,
    readyStatus: SESSION_CONTEXT_READY_FINALIZATION_STATUS.COMMITTING,
    readyLastErrorCode: "",
    readyLastErrorDetail: "",
    updatedAt: nowIso(now)
  };
}

export function failSessionContextReadyFinalization(value, {
  code = "SESSION_CONTEXT_READY_COMMIT_FAILED",
  detail = "",
  now = Date.now()
} = {}) {
  const current = value?.schema === SESSION_CONTEXT_BASELINE_COMMIT_SCHEMA
    ? deepClone(value)
    : null;
  if (!current) return null;
  return {
    ...current,
    readyStatus: SESSION_CONTEXT_READY_FINALIZATION_STATUS.FAILED,
    readyLastErrorCode: sanitizeText(code, 160) || "SESSION_CONTEXT_READY_COMMIT_FAILED",
    readyLastErrorDetail: sanitizeText(detail, 1200),
    retryEligible: true,
    nanoRerunRequired: false,
    updatedAt: nowIso(now)
  };
}

export function completeSessionContextReadyFinalization(value, {
  successAuditEmittedAt = null,
  now = Date.now()
} = {}) {
  const current = value?.schema === SESSION_CONTEXT_BASELINE_COMMIT_SCHEMA
    ? deepClone(value)
    : null;
  if (!current) return null;
  const at = nowIso(now);
  return {
    ...current,
    readyStatus: SESSION_CONTEXT_READY_FINALIZATION_STATUS.READY,
    readyLastErrorCode: "",
    readyLastErrorDetail: "",
    readyVerifiedAt: current.readyVerifiedAt || at,
    successAuditEmittedAt: sanitizeText(successAuditEmittedAt, 120) ||
      current.successAuditEmittedAt ||
      null,
    retryEligible: false,
    nanoRerunRequired: false,
    updatedAt: at
  };
}

export function sessionContextBaselineCommitNeedsRecovery(value) {
  if (value?.schema !== SESSION_CONTEXT_BASELINE_COMMIT_SCHEMA) return false;
  if (value.commitStatus !== SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED) return true;
  return value.readyStatus !== SESSION_CONTEXT_READY_FINALIZATION_STATUS.READY;
}

export const SESSION_CONTEXT_INIT_STATE = Object.freeze({
  WAITING_CHAT_READY: "WAITING_CHAT_READY",
  CATCH_ARMED: "CATCH_ARMED",
  CATCH_CAPTURED: "CATCH_CAPTURED",
  BASELINE_REQUEST_DISPATCHED: "BASELINE_REQUEST_DISPATCHED",
  WAITING_BASELINE_RESPONSE: "WAITING_BASELINE_RESPONSE",
  NANO_ANALYZING: "NANO_ANALYZING",
  READY: "READY",
  FAILED: "FAILED"
});

const TERMINAL = new Set([
  SESSION_CONTEXT_INIT_STATE.READY,
  SESSION_CONTEXT_INIT_STATE.FAILED
]);

export const SESSION_CONTEXT_INIT_FAILURE_CODE = Object.freeze({
  CATCH_HANDOFF_STALLED: "CATCH_HANDOFF_STALLED",
  BASELINE_DISPATCH_STALLED: "BASELINE_DISPATCH_STALLED",
  BASELINE_DISPATCH_FAILED: "BASELINE_DISPATCH_FAILED",
  NANO_REQUEST_UNCLAIMED_TIMEOUT: "NANO_REQUEST_UNCLAIMED_TIMEOUT",
  NANO_ANALYSIS_FAILED: "NANO_ANALYSIS_FAILED",
  NANO_ANALYSIS_ORPHANED: "NANO_ANALYSIS_ORPHANED",
  SESSION_INIT_PROMPT_MUTATED: "SESSION_INIT_PROMPT_MUTATED",
  BASELINE_RESPONSE_OWNER_CHANGED: "BASELINE_RESPONSE_OWNER_CHANGED",
  RUN_OWNER_TERMINATED: "RUN_OWNER_TERMINATED",
  BASELINE_CORRECTION_EXHAUSTED: "BASELINE_CORRECTION_EXHAUSTED"
});

/**
 * v0.10.11 liveness bound for the *transient* initialization phases only.
 *
 * `CATCH_CAPTURED` and `BASELINE_REQUEST_DISPATCHED` are local handoffs that
 * must complete in seconds: the controller owns every step and no target
 * generation is involved. Before v0.10.11 a lost handoff left the whole gate
 * blocking forever, because `sessionContextInitBlocksWork` returns true for
 * every non-READY state and `FAILED` was never assigned anywhere.
 *
 * The phases that legitimately take arbitrary time are deliberately unbounded
 * here and stay owned by their existing watchdogs:
 *   WAITING_CHAT_READY / CATCH_ARMED  — operator/target pace
 *   WAITING_BASELINE_RESPONSE         — target generation (responseDeadlineAt)
 *   NANO_ANALYZING                    — local inference (NANO_WALL_TIMEOUT_MS)
 */
export const SESSION_CONTEXT_INIT_STALL_LIMIT_MS = Object.freeze({
  [SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED]: 120_000,
  [SESSION_CONTEXT_INIT_STATE.BASELINE_REQUEST_DISPATCHED]: 120_000
});

const STALL_FAILURE_CODE = Object.freeze({
  [SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED]:
    SESSION_CONTEXT_INIT_FAILURE_CODE.CATCH_HANDOFF_STALLED,
  [SESSION_CONTEXT_INIT_STATE.BASELINE_REQUEST_DISPATCHED]:
    SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_DISPATCH_STALLED
});

export function createSessionContextInit({
  state = SESSION_CONTEXT_INIT_STATE.WAITING_CHAT_READY,
  runId = "",
  conversationKey = "",
  deferredMissionStart = null,
  now = Date.now()
} = {}) {
  const at = nowIso(now);
  return {
    schema: SESSION_CONTEXT_INIT_SCHEMA,
    version: 1,
    state: Object.values(SESSION_CONTEXT_INIT_STATE).includes(state)
      ? state
      : SESSION_CONTEXT_INIT_STATE.WAITING_CHAT_READY,
    needKey: `session-init:${sanitizeText(runId, 160) || "pending"}:1`,
    conversationKey: sanitizeText(conversationKey, 1200),
    catchObservationId: "",
    catchResponseIdentity: "",
    baselinePromptDigest: "",
    baselineResponseIdentity: "",
    nanoRequestId: "",
    baselineDecisionCommit: null,
    baselineCorrectionGeneration: 0,
    baselineCorrectionFence: null,
    deferredMissionStart: deferredMissionStart ? deepClone(deferredMissionStart) : null,
    startedAt: at,
    updatedAt: at,
    completedAt: null,
    error: "",
    failureCode: "",
    recoveryAttempts: 0
  };
}

export function advanceSessionContextInit(value, state, patch = {}, {
  now = Date.now(),
  force = false
} = {}) {
  const current = value?.schema === SESSION_CONTEXT_INIT_SCHEMA
    ? deepClone(value)
    : createSessionContextInit({ now });
  if (!Object.values(SESSION_CONTEXT_INIT_STATE).includes(state)) {
    throw new TypeError(`SESSION_CONTEXT_INIT_STATE_UNKNOWN:${state}`);
  }
  if (TERMINAL.has(current.state) && current.state !== state && !force) {
    return current;
  }
  const at = nowIso(now);
  const next = {
    ...current,
    ...deepClone(patch || {}),
    schema: SESSION_CONTEXT_INIT_SCHEMA,
    version: 1,
    state,
    updatedAt: at
  };
  if (state === SESSION_CONTEXT_INIT_STATE.READY ||
      state === SESSION_CONTEXT_INIT_STATE.FAILED) {
    next.completedAt = at;
  }
  if (state !== SESSION_CONTEXT_INIT_STATE.FAILED) {
    next.error = "";
    if (!Object.prototype.hasOwnProperty.call(patch || {}, "failureCode")) next.failureCode = "";
  }
  return next;
}

export function sessionContextInitBlocksWork(value) {
  return !value || value.state !== SESSION_CONTEXT_INIT_STATE.READY;
}

/**
 * Core Surface Review may use Nano automatically only after the baseline
 * decision itself and the READY finalization have both survived durable
 * write/readback. A UI-visible READY state alone is insufficient.
 */
export function sessionContextInitVerifiedReady(value) {
  const commit = value?.baselineDecisionCommit;
  return Boolean(
    value?.state === SESSION_CONTEXT_INIT_STATE.READY &&
    commit?.schema === SESSION_CONTEXT_BASELINE_COMMIT_SCHEMA &&
    commit?.commitStatus === SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED &&
    commit?.readyStatus === SESSION_CONTEXT_READY_FINALIZATION_STATUS.READY &&
    commit?.committedAt &&
    commit?.readyVerifiedAt
  );
}

/**
 * v0.10.11: a transient initialization phase that has outlived its bound.
 * Returns a plain verdict so the caller can persist one audited transition and
 * never spins: `FAILED` is terminal, so this can only fire once per phase.
 */
export function evaluateSessionContextInitStall(value, { now = Date.now() } = {}) {
  const init = value?.schema === SESSION_CONTEXT_INIT_SCHEMA ? value : null;
  const state = String(init?.state || "");
  const limitMs = SESSION_CONTEXT_INIT_STALL_LIMIT_MS[state];
  if (!init || !Number.isFinite(limitMs)) {
    return { stalled: false, state, ageMs: 0, limitMs: 0, code: "" };
  }
  const enteredMs = Date.parse(init.updatedAt || init.startedAt || "");
  if (!Number.isFinite(enteredMs)) {
    return { stalled: false, state, ageMs: 0, limitMs, code: "" };
  }
  const ageMs = Math.max(0, Number(now) - enteredMs);
  return {
    stalled: ageMs >= limitMs,
    state,
    ageMs,
    limitMs,
    code: ageMs >= limitMs ? STALL_FAILURE_CODE[state] || "" : ""
  };
}

export function failSessionContextInit(value, {
  code = SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_DISPATCH_FAILED,
  detail = "",
  now = Date.now()
} = {}) {
  return advanceSessionContextInit(
    value,
    SESSION_CONTEXT_INIT_STATE.FAILED,
    {
      failureCode: sanitizeText(code, 120),
      error: sanitizeText(detail, 1600) ||
        "Initieringskedjan kunde inte slutföras inom sin bundna fas."
    },
    { now, force: true }
  );
}

/**
 * Session-init recovery has two semantically different owner classes.
 *
 * PRE_DELIVERY_RETRY is the original v0.10.11 behavior: no baseline delivery
 * survived, so catch/baseline/Nano may restart from phase one.
 *
 * POST_DELIVERY_RECONCILE preserves the owner-evidenced baseline prompt and
 * resumes from the already delivered turn. It must never erase the prompt
 * digest merely to recover a later observation/Nano freshness boundary.
 */
export const SESSION_CONTEXT_INIT_RECOVERY_CLASS = Object.freeze({
  PRE_DELIVERY_RETRY: "PRE_DELIVERY_RETRY",
  POST_DELIVERY_RECONCILE: "POST_DELIVERY_RECONCILE"
});

export const SESSION_CONTEXT_INIT_MAX_OPERATOR_RETRIES = 3;

export function sessionContextInitRetryable(value) {
  return Boolean(
    value?.schema === SESSION_CONTEXT_INIT_SCHEMA &&
    value.state === SESSION_CONTEXT_INIT_STATE.FAILED &&
    Number(value.recoveryAttempts || 0) < SESSION_CONTEXT_INIT_MAX_OPERATOR_RETRIES
  );
}

function nextSessionContextNeedKey(value, recoveryAttempts) {
  const current = sanitizeText(value?.needKey, 320);
  const base = current.replace(/:\d+$/, "") || "session-init:pending";
  return `${base}:${Math.max(2, Number(recoveryAttempts || 0) + 1)}`;
}


/**
 * v0.12.2: a genuinely new MISSION user event invalidates an outstanding
 * session-context baseline response generation. Re-arm from the chat-ready
 * boundary with a fresh needKey so the next assistant generation becomes a
 * session catch instead of being claimed by the superseded baseline turn.
 */
export function rearmSessionContextInitAfterMaterialEvent(value, {
  now = Date.now(),
  materialGeneration = 0
} = {}) {
  const current = value?.schema === SESSION_CONTEXT_INIT_SCHEMA
    ? deepClone(value)
    : createSessionContextInit({ now });
  const currentNeedKey = sanitizeText(current.needKey, 320);
  const currentGeneration = Number(currentNeedKey.match(/:(\d+)$/)?.[1] || 1);
  const baseNeedKey = currentNeedKey.replace(/:\d+$/, "") || "session-init:pending";
  return advanceSessionContextInit(
    current,
    SESSION_CONTEXT_INIT_STATE.WAITING_CHAT_READY,
    {
      recoveryAttempts: Number(current.recoveryAttempts || 0),
      needKey: `${baseNeedKey}:${Math.max(2, currentGeneration + 1)}`,
      catchObservationId: "",
      catchResponseIdentity: "",
      baselinePromptDigest: "",
      baselineResponseIdentity: "",
      nanoRequestId: "",
      baselineDecisionCommit: null,
      baselineCorrectionGeneration: 0,
      baselineCorrectionFence: null,
      completedAt: null,
      failureCode: "",
      materialGeneration: Math.max(0, Number(materialGeneration || 0)),
      rearmedBy: "NEW_MATERIAL_USER_EVENT"
    },
    { now, force: true }
  );
}

export function retrySessionContextInit(value, {
  now = Date.now(),
  recoveryClass = SESSION_CONTEXT_INIT_RECOVERY_CLASS.PRE_DELIVERY_RETRY
} = {}) {
  if (!sessionContextInitRetryable(value)) return { ok: false, value, reason: "NOT_RETRYABLE" };

  const recoveryAttempts = Number(value.recoveryAttempts || 0) + 1;
  if (recoveryClass === SESSION_CONTEXT_INIT_RECOVERY_CLASS.POST_DELIVERY_RECONCILE) {
    const next = advanceSessionContextInit(
      value,
      SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE,
      {
        recoveryAttempts,
        needKey: nextSessionContextNeedKey(value, recoveryAttempts),
        nanoRequestId: "",
        baselineDecisionCommit: null,
        baselineCorrectionGeneration: 0,
        baselineCorrectionFence: null,
        completedAt: null,
        failureCode: ""
      },
      { now, force: true }
    );
    return {
      ok: true,
      value: next,
      reason: "POST_DELIVERY_RECONCILE_ARMED",
      recoveryClass
    };
  }

  const next = advanceSessionContextInit(
    value,
    SESSION_CONTEXT_INIT_STATE.WAITING_CHAT_READY,
    {
      recoveryAttempts,
      needKey: nextSessionContextNeedKey(value, recoveryAttempts),
      catchObservationId: "",
      catchResponseIdentity: "",
      baselinePromptDigest: "",
      baselineResponseIdentity: "",
      nanoRequestId: "",
      baselineDecisionCommit: null,
      baselineCorrectionGeneration: 0,
      baselineCorrectionFence: null,
      completedAt: null,
      failureCode: ""
    },
    { now, force: true }
  );
  return {
    ok: true,
    value: next,
    reason: "PRE_DELIVERY_RETRY_ARMED",
    recoveryClass: SESSION_CONTEXT_INIT_RECOVERY_CLASS.PRE_DELIVERY_RETRY
  };
}

export function sessionContextInitOverlay(value) {
  const init = value?.schema === SESSION_CONTEXT_INIT_SCHEMA
    ? value
    : createSessionContextInit();
  // v0.10.11: the phase labels are unique and ordered 1..6. v0.10.10 used "3/5"
  // for two different phases and titled CATCH_CAPTURED "Sessionskontext fångad",
  // which claimed the whole session context was captured when only the latest
  // stable assistant response had been observed. Full transcript capture and
  // Session Memory complete later in the chain.
  const map = {
    [SESSION_CONTEXT_INIT_STATE.WAITING_CHAT_READY]: {
      title: "Initierar sessionskontext",
      detail: "Väntar tills ChatGPT-chatten är stabil nog för en sessions-catch.",
      progress: "1/6 · Chatstatus"
    },
    [SESSION_CONTEXT_INIT_STATE.CATCH_ARMED]: {
      title: "Initierar sessionskontext",
      detail: "Sessions-catch är armerad. Väntar på ett komplett stabilt assistantsvar.",
      progress: "2/6 · Catch"
    },
    [SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED]: {
      title: "Sessions-catch mottagen",
      detail: "Ett stabilt assistantsvar har fångats. Fullständig transcript-capture och " +
        "Session Memory är ännu inte klara — sessionskontexten är alltså inte komplett.",
      progress: "3/6 · Catch mottagen"
    },
    [SESSION_CONTEXT_INIT_STATE.BASELINE_REQUEST_DISPATCHED]: {
      title: "Begär huvuduppgiftsbaslinje",
      detail: "Den kanoniska huvuduppgiftsfrågan är journalförd och levereras deterministiskt till EIC.",
      progress: "4/6 · Baselinefråga"
    },
    [SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE]: {
      title: "Väntar på huvuduppgiftsbaslinje",
      detail: "All annan agentbearbetning är spärrad tills EIC har svarat i fastställt format.",
      progress: "5/6 · Baselinesvar"
    },
    [SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING]: {
      title: "Nano analyserar sessionskontext",
      detail: "Nano verifierar huvudspår, 80/20, global skills och eventuella motiverade avstickare.",
      progress: "6/6 · Nano"
    },
    [SESSION_CONTEXT_INIT_STATE.READY]: {
      title: "Sessionskontext klar",
      detail: "Catch, huvuduppgiftsbaslinje och Nano-analys är slutförda. Agentprocessen kan fortsätta.",
      progress: "Klar"
    },
    [SESSION_CONTEXT_INIT_STATE.FAILED]: {
      title: init.failureCode === SESSION_CONTEXT_INIT_FAILURE_CODE.SESSION_INIT_PROMPT_MUTATED
        ? "Sessionsinitiering stoppad av integritetskontroll"
        : init.failureCode === SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_CORRECTION_EXHAUSTED
          ? "Baseline-korrigering stoppad bounded"
          : [
              SESSION_CONTEXT_INIT_FAILURE_CODE.NANO_REQUEST_UNCLAIMED_TIMEOUT,
              SESSION_CONTEXT_INIT_FAILURE_CODE.NANO_ANALYSIS_FAILED,
              SESSION_CONTEXT_INIT_FAILURE_CODE.NANO_ANALYSIS_ORPHANED
            ].includes(init.failureCode)
            ? "Nano-analysen kunde inte slutföras"
            : "Baselinefrågan kunde inte levereras",
      detail: sanitizeText(init.error, 800) ||
        (init.failureCode === SESSION_CONTEXT_INIT_FAILURE_CODE.SESSION_INIT_PROMPT_MUTATED
          ? "Den skyddade session-init-payloaden ändrades efter canonical seal. Ingen muterad prompt levererades."
          : init.failureCode === SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_CORRECTION_EXHAUSTED
            ? "Nano avvisade baslinjen igen i samma init-episode. Ingen ytterligare baselineprompt skickas."
            : [SESSION_CONTEXT_INIT_FAILURE_CODE.NANO_REQUEST_UNCLAIMED_TIMEOUT,
               SESSION_CONTEXT_INIT_FAILURE_CODE.NANO_ANALYSIS_FAILED,
               SESSION_CONTEXT_INIT_FAILURE_CODE.NANO_ANALYSIS_ORPHANED].includes(init.failureCode)
              ? "Nano-sessionen nådde inte ett validerat baselineresultat. Kontrollera felkortet och försök igen."
              : "Initieringskedjan kunde inte slutföras. Inget meddelande skickades till målsessionen."),
      progress: "Fel"
    }
  };
  const commit = init.baselineDecisionCommit?.schema === SESSION_CONTEXT_BASELINE_COMMIT_SCHEMA
    ? init.baselineDecisionCommit
    : null;
  if (init.state === SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING && commit) {
    if (commit.commitStatus === SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMIT_FAILED) {
      map[SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING] = {
        title: "Nano-beslut klart — baseline-commit väntar",
        detail: "Den semantiska Nano-analysen är klar, men durable baseline-commit misslyckades. Retry använder samma beslut utan ny Nano-inferens.",
        progress: "6/6 · Commit retry"
      };
    } else if (commit.commitStatus === SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED &&
        commit.readyStatus !== SESSION_CONTEXT_READY_FINALIZATION_STATUS.READY) {
      map[SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING] = {
        title: "Baseline committed — READY verifieras",
        detail: "Baslinjen och beslutet är durable. READY-finalisering måste fortfarande skrivas och läsas tillbaka innan vanlig agentbearbetning får fortsätta.",
        progress: "6/6 · READY commit"
      };
    } else if ([
      SESSION_CONTEXT_BASELINE_COMMIT_STATUS.DECISION_READY,
      SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTING
    ].includes(commit.commitStatus)) {
      map[SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING] = {
        title: "Nano-beslut klart — commit verifieras",
        detail: "Semantiskt ACCEPT är bundet i en replaybar receipt. Baslinjen verifieras nu mot durable storage innan READY.",
        progress: "6/6 · Baseline commit"
      };
    }
  }
  const failed = init.state === SESSION_CONTEXT_INIT_STATE.FAILED;
  return {
    needKey: `${sanitizeText(init.needKey, 240)}:${init.state}`,
    state: init.state,
    dismissible: true,
    visible: init.state !== SESSION_CONTEXT_INIT_STATE.READY,
    failureCode: failed ? sanitizeText(init.failureCode, 120) : "",
    retryable: failed && sessionContextInitRetryable(init),
    ...(map[init.state] || map[SESSION_CONTEXT_INIT_STATE.WAITING_CHAT_READY])
  };
}
