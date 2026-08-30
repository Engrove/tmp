export const NANO_TASK_SCHEMA = "eic.autonom.nano-task.v1";
export const NANO_TASK_STATUS = Object.freeze({
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED"
});

export const NANO_TASK_MAX_PROMPT_CHARS = 16_000;
export const NANO_TASK_MAX_RESULT_CHARS = 16_000;

function text(value) {
  return String(value ?? "").trim();
}

/**
 * Extract the last line-start NANO_TASK directive from a prompt.
 *
 * Preferred syntax:
 *   normal mission text
 *   NANO_TASK: {one isolated prompt}
 *
 * The directive owns the remainder of the prompt. One outer {...} pair is removed
 * when present. This deliberately keeps parsing deterministic and prevents target
 * text from becoming a second control grammar.
 */
export function splitNanoTaskDirective(value) {
  const source = String(value ?? "");
  const pattern = /(^|\n)[\t ]*NANO_TASK[\t ]*:[\t ]*/gi;
  let match = null;
  let current;
  while ((current = pattern.exec(source)) !== null) match = current;
  if (!match) return { found: false, task: "", missionText: source };

  const markerStart = match.index + (match[1] ? match[1].length : 0);
  const taskStart = match.index + match[0].length;
  let task = source.slice(taskStart).trim();
  if (task.startsWith("{") && task.endsWith("}") && task.length >= 2) {
    task = task.slice(1, -1).trim();
  }
  if (!task) return { found: false, task: "", missionText: source };

  const missionText = source.slice(0, markerStart).replace(/\s+$/, "");
  return {
    found: true,
    task: task.slice(0, NANO_TASK_MAX_PROMPT_CHARS),
    missionText,
    truncated: task.length > NANO_TASK_MAX_PROMPT_CHARS
  };
}

export function createNanoTaskHarness({
  requestId,
  sourceUserHash = "",
  sourceConversationKey = "",
  task,
  now = new Date().toISOString()
} = {}) {
  const prompt = text(task);
  if (!requestId || !prompt) throw new TypeError("NANO_TASK_REQUEST_INVALID");
  return {
    schema: NANO_TASK_SCHEMA,
    requestId: text(requestId),
    sourceUserHash: text(sourceUserHash),
    sourceConversationKey: text(sourceConversationKey),
    status: NANO_TASK_STATUS.PENDING,
    task: prompt.slice(0, NANO_TASK_MAX_PROMPT_CHARS),
    result: "",
    error: "",
    claimId: "",
    modelKind: "",
    isolation: "FRESH_ONE_PROMPT_SESSION",
    promptCalls: 0,
    durationMs: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now
  };
}

export function claimNanoTaskHarness(value, {
  claimId,
  modelKind = "LanguageModel",
  now = new Date().toISOString()
} = {}) {
  if (!value || value.status !== NANO_TASK_STATUS.PENDING) {
    return { accepted: false, reason: "NANO_TASK_NOT_PENDING", value };
  }
  if (!claimId) return { accepted: false, reason: "NANO_TASK_CLAIM_ID_REQUIRED", value };
  return {
    accepted: true,
    value: {
      ...value,
      status: NANO_TASK_STATUS.RUNNING,
      claimId: text(claimId),
      modelKind: text(modelKind),
      startedAt: now,
      updatedAt: now
    }
  };
}

export function completeNanoTaskHarness(value, {
  requestId,
  claimId,
  result,
  isolation = "FRESH_ONE_PROMPT_SESSION",
  promptCalls = 1,
  durationMs = 0,
  now = new Date().toISOString()
} = {}) {
  if (!value || value.status !== NANO_TASK_STATUS.RUNNING) {
    return { accepted: false, reason: "NANO_TASK_NOT_RUNNING", value };
  }
  if (text(requestId) !== text(value.requestId) || text(claimId) !== text(value.claimId)) {
    return { accepted: false, reason: "NANO_TASK_OWNER_MISMATCH", value };
  }
  if (Number(promptCalls) !== 1) {
    return { accepted: false, reason: "NANO_TASK_ONE_PROMPT_INVARIANT", value };
  }
  return {
    accepted: true,
    value: {
      ...value,
      status: NANO_TASK_STATUS.COMPLETED,
      result: String(result ?? "").slice(0, NANO_TASK_MAX_RESULT_CHARS),
      error: "",
      isolation: text(isolation) || "FRESH_ONE_PROMPT_SESSION",
      promptCalls: 1,
      durationMs: Math.max(0, Number(durationMs || 0)),
      completedAt: now,
      updatedAt: now
    }
  };
}

export function failNanoTaskHarness(value, {
  requestId,
  claimId,
  error,
  now = new Date().toISOString()
} = {}) {
  if (!value || ![NANO_TASK_STATUS.PENDING, NANO_TASK_STATUS.RUNNING].includes(value.status)) {
    return { accepted: false, reason: "NANO_TASK_NOT_ACTIVE", value };
  }
  if (text(requestId) !== text(value.requestId)) {
    return { accepted: false, reason: "NANO_TASK_REQUEST_MISMATCH", value };
  }
  if (value.status === NANO_TASK_STATUS.RUNNING && text(claimId) !== text(value.claimId)) {
    return { accepted: false, reason: "NANO_TASK_CLAIM_MISMATCH", value };
  }
  return {
    accepted: true,
    value: {
      ...value,
      status: NANO_TASK_STATUS.FAILED,
      error: text(error).slice(0, 2000) || "NANO_TASK_FAILED",
      completedAt: now,
      updatedAt: now
    }
  };
}
