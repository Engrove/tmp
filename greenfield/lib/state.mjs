import {
  APP_VERSION,
  PHASES,
  PROCESS_SCHEMA,
  TERMINAL_PHASES
} from "./contracts.mjs";
import { deepClone, nowIso, randomId, text } from "./common.mjs";
import { createSessionHealthState } from "./session-health.mjs";
import { normalizeGreenfieldPriority } from "./global-capacity-scheduler.mjs";

const ALLOWED = Object.freeze({
  [PHASES.SENDING]: new Set([PHASES.WAITING, PHASES.RECOVERING, PHASES.ROTATING, PHASES.BLOCKED, PHASES.STOPPED, PHASES.AUDIT_FAILURE, PHASES.DETACHED]),
  [PHASES.WAITING]: new Set([PHASES.SENDING, PHASES.ANALYZING, PHASES.RECOVERING, PHASES.ROTATING, PHASES.BLOCKED, PHASES.STOPPED, PHASES.AUDIT_FAILURE, PHASES.DETACHED]),
  [PHASES.ANALYZING]: new Set([PHASES.SENDING, PHASES.PAUSED, PHASES.RECOVERING, PHASES.ROTATING, PHASES.BLOCKED, PHASES.DONE, PHASES.STOPPED, PHASES.AUDIT_FAILURE, PHASES.DETACHED]),
  [PHASES.PAUSED]: new Set([PHASES.SENDING, PHASES.BLOCKED, PHASES.STOPPED, PHASES.AUDIT_FAILURE]),
  [PHASES.RECOVERING]: new Set([PHASES.SENDING, PHASES.WAITING, PHASES.ANALYZING, PHASES.ROTATING, PHASES.DETACHED, PHASES.BLOCKED, PHASES.STOPPED, PHASES.AUDIT_FAILURE]),
  [PHASES.DETACHED]: new Set([PHASES.SENDING, PHASES.WAITING, PHASES.ANALYZING, PHASES.RECOVERING, PHASES.ROTATING, PHASES.BLOCKED, PHASES.STOPPED, PHASES.AUDIT_FAILURE]),
  [PHASES.ROTATING]: new Set([PHASES.SENDING, PHASES.RECOVERING, PHASES.DETACHED, PHASES.BLOCKED, PHASES.STOPPED, PHASES.AUDIT_FAILURE]),
  [PHASES.BLOCKED]: new Set([PHASES.STOPPED]),
  [PHASES.DONE]: new Set([PHASES.STOPPED]),
  [PHASES.STOPPED]: new Set(),
  [PHASES.AUDIT_FAILURE]: new Set([PHASES.STOPPED])
});

export function createProcess({
  workerId = "",
  windowId,
  tabId,
  goal,
  initialPrompt,
  baselineAssistantHash = "",
  auditSessionId = "",
  gptRoot = "",
  schedulerPriority = "NORMAL",
  queueContext = null,
  now = Date.now()
}) {
  const processId = randomId("process");
  const runId = randomId("run");
  const resolvedWorkerId = String(workerId || randomId("worker-unbound"));
  return {
    schema: PROCESS_SCHEMA,
    version: APP_VERSION,
    processId,
    runId,
    workerId: resolvedWorkerId,
    auditSessionId: text(auditSessionId, 200),
    generation: 1,
    windowId,
    tabId,
    gptRoot: text(gptRoot, 2000),
    sessionSeq: 1,
    sessionRotation: null,
    phase: PHASES.SENDING,
    schedulerPriority: normalizeGreenfieldPriority(schedulerPriority),
    queueContext: queueContext && typeof queueContext === "object" ? deepClone(queueContext) : null,
    goal: text(goal),
    turn: 1,
    pendingPrompt: {
      text: text(initialPrompt),
      hash: "",
      baselineAssistantHash: text(baselineAssistantHash, 128),
      createdAt: nowIso(now),
      sendAttempts: 0,
      dispatch: null,
      a2a: null
    },
    lastPrompt: null,
    lastResponse: null,
    responseCandidate: null,
    responseInterleave: null,
    waitingRefresh: null,
    lastNano: null,
    lastNanoTask: null,
    lastDecision: null,
    greenfieldControl: null,
    missionPause: null,
    sessionHealth: createSessionHealthState({ sessionSeq: 1, sessionStartTurn: 1, now }),
    objectiveState: {
      objectiveId: "",
      objective: text(initialPrompt),
      status: "PENDING",
      updatedAt: nowIso(now)
    },
    lastConsumedInstructionId: null,
    recovery: {
      attempts: 0,
      recoverTo: null,
      reason: "",
      detail: "",
      nextAttemptAt: null
    },
    detached: null,
    lastError: null,
    lastMaterialAt: nowIso(now),
    idleKeepaliveSeq: 0,
    startedAt: nowIso(now),
    updatedAt: nowIso(now),
    completedAt: null
  };
}

export function validateProcess(process) {
  if (!process || process.schema !== PROCESS_SCHEMA) throw new Error("PROCESS_SCHEMA_INVALID");
  if (!process.processId || !process.runId || !String(process.workerId || "").trim()) throw new Error("PROCESS_IDENTITY_MISSING");
  if (!Number.isInteger(process.generation) || process.generation < 1) throw new Error("PROCESS_GENERATION_INVALID");
  if (!Object.values(PHASES).includes(process.phase)) throw new Error("PROCESS_PHASE_INVALID");
  if (!Number.isInteger(process.windowId)) throw new Error("PROCESS_WINDOW_INVALID");
  return process;
}

export function isCurrentToken(process, token) {
  return Boolean(
    process &&
    token &&
    process.workerId === token.workerId &&
    process.processId === token.processId &&
    process.runId === token.runId &&
    process.generation === token.generation
  );
}

export function ownerToken(process, operationId = randomId("op")) {
  return {
    workerId: process.workerId,
    processId: process.processId,
    runId: process.runId,
    generation: process.generation,
    operationId
  };
}

export function transitionProcess(processValue, nextPhase, patch = {}, now = Date.now()) {
  const process = deepClone(validateProcess(processValue));
  if (process.phase !== nextPhase) {
    const allowed = ALLOWED[process.phase];
    if (!allowed?.has(nextPhase)) {
      throw new Error(`ILLEGAL_TRANSITION:${process.phase}->${nextPhase}`);
    }
  }
  Object.assign(process, deepClone(patch));
  process.phase = nextPhase;
  process.updatedAt = nowIso(now);
  if (TERMINAL_PHASES.has(nextPhase) && !process.completedAt) process.completedAt = nowIso(now);
  return validateProcess(process);
}

export function withRecovery(processValue, {
  reason,
  detail = "",
  recoverTo,
  now = Date.now()
}) {
  const process = deepClone(validateProcess(processValue));
  const attempts = Number(process.recovery?.attempts || 0) + 1;
  // Continuity-first: transient technical recovery never spends a fatal retry budget.
  // Repeated failures open a 15-minute to 6-hour cooldown; no tight retry storm.
  // Backoff is bounded, but the process remains resumable until a real owner/D2
  // boundary or explicit operator stop occurs.
  const delayMs = attempts >= 5
    ? Math.min(6 * 3600000, 15 * 60000 * (2 ** Math.min(5, attempts - 5)))
    : Math.min(30000, Math.max(1000, 1000 * (2 ** Math.min(5, attempts - 1))));
  return transitionProcess(process, PHASES.RECOVERING, {
    recovery: {
      attempts,
      recoverTo: recoverTo || process.phase,
      reason: String(reason || ""),
      detail: String(detail || ""),
      nextAttemptAt: nowIso(now + delayMs)
    }
  }, now);
}

export function resetRecovery(processValue) {
  const process = deepClone(validateProcess(processValue));
  process.recovery = {
    attempts: 0,
    recoverTo: null,
    reason: "",
    detail: "",
    nextAttemptAt: null
  };
  return process;
}
