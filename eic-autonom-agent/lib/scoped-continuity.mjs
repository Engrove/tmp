import { deepClone, sanitizeText } from "./common.mjs";
import { createContinuity, normalizeContinuity } from "./continuity.mjs";

export const CONTINUITY_SCOPE_KIND = "WINDOW_RUN";

function contextConversationKeys(context = {}) {
  const keys = new Set();
  const runKey = sanitizeText(context?.run?.conversationKey, 1200);
  if (runKey) keys.add(runKey);
  for (const record of Object.values(context?.linkedTabs || {})) {
    const key = sanitizeText(record?.conversationKey, 1200);
    if (key) keys.add(key);
  }
  return keys;
}

export function bindContinuityScope(value, {
  windowId,
  runId = "",
  conversationKey = ""
} = {}) {
  const continuity = normalizeContinuity(value);
  const numericWindowId = Number(windowId);
  const validWindowId = windowId !== null && windowId !== undefined && windowId !== "" &&
    Number.isInteger(numericWindowId) && numericWindowId >= 0;
  continuity.scope = {
    kind: CONTINUITY_SCOPE_KIND,
    windowId: validWindowId ? numericWindowId : null,
    runId: sanitizeText(runId, 180),
    conversationKey: sanitizeText(
      conversationKey || continuity.position?.conversationKey,
      1200
    )
  };
  return continuity;
}

export function continuityScopeWindowId(value) {
  const raw = value?.scope?.windowId;
  if (raw === null || raw === undefined || raw === "") return null;
  const id = Number(raw);
  return Number.isInteger(id) && id >= 0 ? id : null;
}

export function rootContinuityAdoptionDecision(legacyValue, context = {}, runtime = {}) {
  const legacy = normalizeContinuity(legacyValue);
  const rootConversation = sanitizeText(legacy.position?.conversationKey, 1200);
  const keys = contextConversationKeys(context);
  if (rootConversation && keys.has(rootConversation)) {
    return { adopt: true, reason: "EXACT_CONVERSATION_MATCH" };
  }

  const contexts = Object.values(runtime?.windows || {});
  const scopedCount = contexts.filter((candidate) => candidate?.continuity?.scope?.kind === CONTINUITY_SCOPE_KIND).length;
  if (contexts.length === 1 && scopedCount === 0 && (!rootConversation || keys.size === 0)) {
    return { adopt: true, reason: "SOLE_ROOT_WINDOW" };
  }
  return { adopt: false, reason: rootConversation ? "NO_EXACT_WINDOW_MATCH" : "AMBIGUOUS_EMPTY_ROOT_LOCATOR" };
}

export function initializeWindowContinuity(context = {}, legacyValue, runtime = {}, {
  windowId = context?.windowId
} = {}) {
  if (context?.continuity && typeof context.continuity === "object") {
    return {
      continuity: deepClone(context.continuity),
      backup: context?.continuityBackup ? deepClone(context.continuityBackup) : null,
      changed: context.continuity?.scope?.kind !== CONTINUITY_SCOPE_KIND ||
        Number(context.continuity?.scope?.windowId) !== Number(windowId),
      adoptedRoot: false,
      reason: "EXISTING_SCOPED_CONTINUITY"
    };
  }

  const adoption = rootContinuityAdoptionDecision(legacyValue, context, runtime);
  const base = adoption.adopt ? deepClone(legacyValue) : createContinuity();
  const continuity = bindContinuityScope(base, {
    windowId,
    runId: context?.run?.runId,
    conversationKey: context?.run?.conversationKey
  });
  continuity.integrity = null;
  return {
    continuity,
    backup: deepClone(continuity),
    changed: true,
    adoptedRoot: adoption.adopt,
    reason: adoption.reason
  };
}

export function promoteContinuityConversation(value, {
  from = "",
  to = "",
  taskFingerprint = ""
} = {}) {
  const continuity = normalizeContinuity(value);
  const current = sanitizeText(continuity.position?.conversationKey, 1200);
  const prior = sanitizeText(from, 1200);
  const next = sanitizeText(to, 1200);
  if (!next) return { continuity, changed: false, reason: "TARGET_EMPTY" };
  if (current && prior && current !== prior) {
    return { continuity, changed: false, reason: "CURRENT_LOCATOR_MISMATCH" };
  }
  if (current === next) {
    if (taskFingerprint) continuity.position.taskFingerprint = sanitizeText(taskFingerprint, 256);
    if (continuity.scope) continuity.scope.conversationKey = next;
    return { continuity, changed: false, reason: "ALREADY_CURRENT" };
  }
  continuity.position.conversationKey = next;
  if (taskFingerprint) continuity.position.taskFingerprint = sanitizeText(taskFingerprint, 256);
  continuity.position.updatedAt = new Date().toISOString();
  if (continuity.scope) continuity.scope.conversationKey = next;
  return { continuity, changed: true, reason: "PROMOTED" };
}

export function cloneSpecializedRunState(targetRun = {}, priorRun = {}) {
  const mode = String(priorRun?.mode || "");
  if (!["ARCHAEOLOGY_LONG", "APP_AUDIT_LONG"].includes(mode)) return targetRun;
  const keys = mode === "ARCHAEOLOGY_LONG"
    ? [
        "archaeologyScenario", "archaeologyQuestion", "archaeologyContext",
        "archaeologyOptions", "archaeology", "archaeologyLastGate",
        "destructivenessCeiling"
      ]
    : [
        "auditTestNeed", "auditContext", "auditOptions", "audit", "auditLastGate",
        "destructivenessCeiling"
      ];
  targetRun.mode = mode;
  for (const key of keys) {
    if (priorRun[key] !== undefined) targetRun[key] = deepClone(priorRun[key]);
  }
  targetRun.resumedFromRunId = sanitizeText(priorRun?.runId, 180);
  return targetRun;
}

export function resolveStickyRunMode(priorRun = {}, {
  tabId,
  conversationKey = ""
} = {}) {
  const mode = String(priorRun?.mode || "");
  if (!["ARCHAEOLOGY_LONG", "APP_AUDIT_LONG"].includes(mode)) {
    return { mode: "WAITING_CONTINUE", preserve: false, reason: "NO_SPECIALIZED_PREDECESSOR" };
  }
  if (Number(priorRun?.targetTabId) !== Number(tabId)) {
    return { mode: "WAITING_CONTINUE", preserve: false, blocked: true, reason: "SPECIALIZED_TARGET_TAB_CHANGED" };
  }
  const priorConversation = sanitizeText(priorRun?.conversationKey, 1200);
  const nextConversation = sanitizeText(conversationKey, 1200);
  if (priorConversation && nextConversation && priorConversation !== nextConversation) {
    return { mode: "WAITING_CONTINUE", preserve: false, blocked: true, reason: "SPECIALIZED_CONVERSATION_CHANGED" };
  }
  return { mode, preserve: true, blocked: false, reason: "SPECIALIZED_MODE_STICKY" };
}
