import { deepClone, nowIso, nullableInteger, sanitizeText } from "./common.mjs";
import { PAUSE_ORIGINS, STATES, TERMINAL_STATES, transitionRun } from "./state-machine.mjs";

export const TAB_ATTACHMENT_STATES = Object.freeze({
  ATTACHED: "ATTACHED",
  DETACHED: "DETACHED"
});

export function runIsDetached(run = {}) {
  return run?.tabAttachment?.status === TAB_ATTACHMENT_STATES.DETACHED;
}

export function detachRunFromTab(runValue, linkedRecord = {}, { now = Date.now() } = {}) {
  const run = deepClone(runValue);
  const tabId = nullableInteger(linkedRecord?.tabId);
  if (!run || tabId === null || nullableInteger(run.targetTabId) !== tabId ||
      TERMINAL_STATES.has(run.state)) {
    return { run, detached: false, reason: "RUN_NOT_TARGETING_TAB" };
  }

  const resumeState = run.state;
  let next = transitionRun(run, STATES.SOFT_PAUSED, {
    origin: PAUSE_ORIGINS.OPERATOR_PAUSE,
    reason: "Den aktiva fliken kopplades bort. Körningen och all kontinuitet är bevarad tills exakt session kopplas igen.",
    now
  });
  next.tabAttachment = {
    status: TAB_ATTACHMENT_STATES.DETACHED,
    detachedTabId: tabId,
    conversationKey: sanitizeText(linkedRecord?.conversationKey || run.conversationKey, 500),
    detachedAt: nowIso(now),
    resumeState
  };
  return { run: next, detached: true, reason: "RUN_PRESERVED_DETACHED" };
}

export function reattachRunToTab(runValue, {
  tabId,
  conversationKey = "",
  now = Date.now()
} = {}) {
  const run = deepClone(runValue);
  const numericTabId = nullableInteger(tabId);
  if (!runIsDetached(run) || numericTabId === null) {
    return { run, reattached: false, reason: "NO_DETACHED_RUN" };
  }

  const expectedConversation = sanitizeText(
    run.tabAttachment?.conversationKey || run.conversationKey,
    500
  );
  const observedConversation = sanitizeText(conversationKey, 500);
  if (expectedConversation && observedConversation && expectedConversation !== observedConversation) {
    return { run, reattached: false, reason: "CONVERSATION_MISMATCH" };
  }

  run.targetTabId = numericTabId;
  if (observedConversation) run.conversationKey = observedConversation;
  run.tabAttachment = {
    ...run.tabAttachment,
    status: TAB_ATTACHMENT_STATES.ATTACHED,
    attachedTabId: numericTabId,
    reattachedAt: nowIso(now)
  };
  const next = transitionRun(run, STATES.RECOVERING, {
    origin: PAUSE_ORIGINS.OPERATOR_PAUSE,
    reason: "Den bevarade körningen återanslöts till exakt ChatGPT-session och ska reconcileras innan nästa effekt.",
    now,
    force: true
  });
  return { run: next, reattached: true, reason: "RUN_REATTACHED_RECOVERING" };
}
