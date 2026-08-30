import { deepClone, nowIso, randomId, sanitizeText, stableStringify } from "./common.mjs";

export const OPERATOR_ACTION_SCHEMA = "eic.autonom.operator-action.v1";
export const OPERATOR_ACTION_RECEIPT_SCHEMA = "eic.autonom.operator-action-receipt.v1";

export const EIC_NEXT_ACTORS = Object.freeze({
  EIC_AI_SESSION: "EIC_AI_SESSION",
  AGENT: "AGENT",
  OPERATOR_ACTION: "OPERATOR_ACTION",
  OPERATOR_DECISION: "OPERATOR_DECISION",
  EXTERNAL_SYSTEM: "EXTERNAL_SYSTEM",
  NONE: "NONE"
});

export const EIC_AUTONOMY_STATES = Object.freeze({
  CONTINUE: "CONTINUE",
  OPERATOR_ACTION_REQUIRED: "OPERATOR_ACTION_REQUIRED",
  USER_PAUSE: "USER_PAUSE",
  DONE: "DONE"
});

export const PROGRAM_STATES = Object.freeze({
  RUNNING: "RUNNING",
  AWAITING_OPERATOR_ACTION: "AWAITING_OPERATOR_ACTION",
  AWAITING_OPERATOR_DECISION: "AWAITING_OPERATOR_DECISION",
  PROGRAM_BLOCKED: "PROGRAM_BLOCKED",
  PROGRAM_DONE: "PROGRAM_DONE"
});

export const OPERATOR_ACTION_STATUS = Object.freeze({
  PENDING: "PENDING",
  RECEIPT_ACCEPTED: "RECEIPT_ACCEPTED",
  COMPLETED: "COMPLETED",
  EXPIRED: "EXPIRED",
  REJECTED: "REJECTED"
});

function normalizeLocator(value) {
  return sanitizeText(value, 1200);
}

export function createOperatorAction(input = {}, { now = Date.now(), id = randomId("operator-action") } = {}) {
  const actionType = sanitizeText(input.actionType, 120);
  const instruction = sanitizeText(input.instruction, 2400);
  const targetSurface = sanitizeText(input.targetSurface, 160);
  const targetLocator = normalizeLocator(input.targetLocator);
  const missionId = sanitizeText(input.missionId, 240);
  const runId = sanitizeText(input.runId, 240);
  const expectedEvidence = deepClone(input.expectedEvidence || {});
  const resumeCondition = deepClone(input.resumeCondition || {});
  if (!actionType || !instruction || !targetSurface || !targetLocator || !missionId || !runId) {
    throw new TypeError("OPERATOR_ACTION_REQUIRED_FIELDS_MISSING");
  }
  return {
    schema: OPERATOR_ACTION_SCHEMA,
    version: 1,
    actionId: sanitizeText(id, 240),
    actionType,
    instruction,
    targetSurface,
    targetLocator,
    riskLevel: sanitizeText(input.riskLevel || "LEVEL_1_READ_ONLY", 120),
    decisionRequired: Boolean(input.decisionRequired),
    operatorPresenceRequired: input.operatorPresenceRequired !== false,
    expectedEvidence,
    resumeCondition,
    missionId,
    runId,
    createdAt: nowIso(now),
    expiresAt: input.expiresAt ? nowIso(Date.parse(input.expiresAt)) : null,
    status: OPERATOR_ACTION_STATUS.PENDING,
    receipt: null,
    updatedAt: nowIso(now)
  };
}

function normalizedEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return deepClone(value);
}

export function evaluateResumeCondition(action, evidence = {}) {
  if (!action || action.schema !== OPERATOR_ACTION_SCHEMA) {
    return { valid: false, reason: "OPERATOR_ACTION_SCHEMA_MISMATCH" };
  }
  const condition = action.resumeCondition || {};
  const observed = normalizedEvidence(evidence);
  if (condition.type === "EXACT_FIELDS") {
    const required = condition.fields && typeof condition.fields === "object" ? condition.fields : {};
    for (const [key, expected] of Object.entries(required)) {
      if (stableStringify(observed[key]) !== stableStringify(expected)) {
        return { valid: false, reason: `RESUME_CONDITION_FIELD_MISMATCH:${key}` };
      }
    }
    return { valid: true, reason: "EXACT_FIELDS_MATCH" };
  }
  if (condition.type === "OWNER_RECEIPT") {
    const ownerRef = sanitizeText(observed.ownerRef, 1200);
    const evidenceClass = sanitizeText(observed.evidenceClass, 80);
    if (!ownerRef || !["OWNER_LIVE", "OWNER_RECEIPT"].includes(evidenceClass)) {
      return { valid: false, reason: "OWNER_RECEIPT_REQUIRED" };
    }
    return { valid: true, reason: "OWNER_RECEIPT_PRESENT" };
  }
  if (condition.type === "HASH_MATCH") {
    const expected = sanitizeText(condition.sha256, 128).toLowerCase();
    const actual = sanitizeText(observed.sha256, 128).toLowerCase();
    return actual && expected === actual
      ? { valid: true, reason: "HASH_MATCH" }
      : { valid: false, reason: "HASH_MISMATCH" };
  }
  return { valid: false, reason: "RESUME_CONDITION_UNSUPPORTED" };
}

export function submitOperatorActionReceipt(actionInput, receiptInput = {}, { now = Date.now() } = {}) {
  const action = deepClone(actionInput);
  if (!action || action.schema !== OPERATOR_ACTION_SCHEMA) {
    throw new Error("OPERATOR_ACTION_NOT_CURRENT");
  }
  const actionId = sanitizeText(receiptInput.actionId, 240);
  const missionId = sanitizeText(receiptInput.missionId, 240);
  const runId = sanitizeText(receiptInput.runId, 240);
  if (actionId !== action.actionId) throw new Error("OPERATOR_ACTION_ID_STALE_OR_WRONG");
  if (missionId !== action.missionId) throw new Error("OPERATOR_ACTION_MISSION_MISMATCH");
  if (runId !== action.runId) throw new Error("OPERATOR_ACTION_RUN_MISMATCH");
  if (action.receipt) {
    const same = action.receipt.actionId === actionId &&
      action.receipt.missionId === missionId &&
      action.receipt.runId === runId &&
      stableStringify(action.receipt.evidence) === stableStringify(normalizedEvidence(receiptInput.evidence));
    if (!same) throw new Error("OPERATOR_ACTION_DUPLICATE_CONFLICT");
    return { action, idempotent: true, resumeAllowed: action.status === OPERATOR_ACTION_STATUS.COMPLETED };
  }
  if (action.status !== OPERATOR_ACTION_STATUS.PENDING) throw new Error("OPERATOR_ACTION_NOT_PENDING");
  if (action.expiresAt && Date.parse(action.expiresAt) <= now) {
    action.status = OPERATOR_ACTION_STATUS.EXPIRED;
    action.updatedAt = nowIso(now);
    return { action, idempotent: false, resumeAllowed: false, reason: "OPERATOR_ACTION_EXPIRED" };
  }
  const evidence = normalizedEvidence(receiptInput.evidence);
  const condition = evaluateResumeCondition(action, evidence);
  if (!condition.valid) throw new Error(condition.reason);
  action.receipt = {
    schema: OPERATOR_ACTION_RECEIPT_SCHEMA,
    version: 1,
    receiptId: sanitizeText(receiptInput.receiptId || randomId("operator-action-receipt"), 240),
    actionId,
    missionId,
    runId,
    evidence,
    acceptedAt: nowIso(now),
    conditionResult: condition.reason
  };
  action.status = OPERATOR_ACTION_STATUS.COMPLETED;
  action.updatedAt = nowIso(now);
  return { action, idempotent: false, resumeAllowed: true };
}

export function validateAutonomyTuple({
  autonomy,
  nextActor,
  next,
  completionState
} = {}) {
  const a = sanitizeText(autonomy, 80).toUpperCase();
  const actor = sanitizeText(nextActor, 80).toUpperCase();
  const hasNext = Boolean(sanitizeText(next, 2400)) && !/^NONE$/i.test(sanitizeText(next, 2400));
  if (!Object.values(EIC_AUTONOMY_STATES).includes(a)) return { valid: false, reason: "AUTONOMY_UNSUPPORTED" };
  if (!Object.values(EIC_NEXT_ACTORS).includes(actor)) return { valid: false, reason: "NEXT_ACTOR_UNSUPPORTED" };
  if (a === EIC_AUTONOMY_STATES.OPERATOR_ACTION_REQUIRED) {
    if (actor !== EIC_NEXT_ACTORS.OPERATOR_ACTION) return { valid: false, reason: "OPERATOR_ACTION_REQUIRES_OPERATOR_ACTION_ACTOR" };
    if (!hasNext) return { valid: false, reason: "OPERATOR_ACTION_REQUIRES_INSTRUCTION" };
    if (completionState === "PROGRAM_DONE") return { valid: false, reason: "OPERATOR_ACTION_CANNOT_BE_PROGRAM_DONE" };
  }
  if (a === EIC_AUTONOMY_STATES.USER_PAUSE) {
    if (actor !== EIC_NEXT_ACTORS.OPERATOR_DECISION) return { valid: false, reason: "USER_PAUSE_REQUIRES_OPERATOR_DECISION_ACTOR" };
    if (!hasNext) return { valid: false, reason: "USER_PAUSE_REQUIRES_DECISION" };
  }
  if (a === EIC_AUTONOMY_STATES.DONE) {
    if (actor !== EIC_NEXT_ACTORS.NONE || hasNext || completionState !== "PROGRAM_DONE") {
      return { valid: false, reason: "DONE_REQUIRES_NONE_AND_PROGRAM_DONE" };
    }
  }
  if (a === EIC_AUTONOMY_STATES.CONTINUE && actor === EIC_NEXT_ACTORS.NONE) {
    return { valid: false, reason: "CONTINUE_REQUIRES_NEXT_ACTOR" };
  }
  return { valid: true, reason: "OK" };
}
