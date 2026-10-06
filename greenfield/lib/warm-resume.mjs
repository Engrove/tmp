// v1.9.0 warm queue resume.
//
// Until 1.8.14 every queue activation of a parked GFW opened a fresh ChatGPT
// chat and sent a FULL prompt (~18 000 tokens). Diagnostics 2026-10-05: FULL
// prompts were 94 % of all input tokens and 58-88 new chats were opened per
// day. A warm resume returns the window's tab to the GFW's own conversation
// and continues there; the prompt profile then follows the existing v1.7.7
// rules (COMPACT for a follow-up in the same conversation, FULL on the
// periodic refresh, on a mission-text change or on any identity doubt).
//
// A warm resume is planned only when the parked GFW's last turn was answered
// and captured in a known conversation and nothing asks for a fresh chat.
// Every other case is the unchanged cold path (fresh chat + FULL), and the
// rotation tick falls back to it whenever the conversation cannot be proven
// on the page. Pure.

import { conversationKey } from "./restart-recovery.mjs";
import { DEFAULT_WARM_QUEUE_RESUME } from "./mission-work-queue.mjs";

export const WARM_RESUME_SCHEMA = "eic.greenfield.warm-resume.v1";
export { DEFAULT_WARM_QUEUE_RESUME };
// Greenfield prompts already in the conversation (prompt-profile ordinal);
// at the cap the GFW starts a fresh chat as before.
export const WARM_RESUME_MAX_CHAT_PROMPTS = 10;
export const WARM_RESUME_MAX_IDLE_MS = 24 * 60 * 60 * 1000;
// From the navigation to a verified, idle conversation page.
export const WARM_RESUME_READY_TIMEOUT_MS = 90 * 1000;
// A conversation address that redirected elsewhere (e.g. a deleted chat).
export const WARM_RESUME_REDIRECT_GRACE_MS = 15 * 1000;

// Parks that follow a captured, analysed (or v1.8.14 queue-boundary) answer.
export const WARM_RESUME_PARK_OUTCOMES = Object.freeze([
  "QUANTUM_EXHAUSTED",
  "EIC_YIELD_TO_QUEUE",
  "EIC_PAUSE_PARKED",
  "EIC_BACKGROUND_SLEEP",
  "SCHEDULE_WINDOW_CLOSED",
  "SCHEDULE_PAUSED",
  "MISSION_QUEUE_PARKED"
]);

const COMPLETED_SOURCE_STATES = new Set(["", "COMPLETED_RESPONSE_CAPTURED", "COMPLETED_RESPONSE_CHECKPOINTED"]);

function cold(code, detail = {}) {
  return { schema: WARM_RESUME_SCHEMA, warm: false, code, ...detail };
}

/**
 * Decide warm or cold for a queue activation of a parked GFW.
 *   enabled             operator setting warmQueueResume
 *   item                the queue slot being activated (lastOutcome, lastLeftAtMs, resume)
 *   parked              item.processSnapshot (already matched to this worker)
 *   lastSessionAction   sessionAction of the parked GFW's last answer
 */
export function warmResumeDecision({
  enabled = DEFAULT_WARM_QUEUE_RESUME,
  item = null,
  parked = null,
  lastSessionAction = "KEEP",
  // Conversations last used by other GFWs (other queue slots' snapshots and
  // the process that just parked). A conversation belongs to one GFW.
  otherConversationKeys = [],
  now = Date.now(),
  maxChatPrompts = WARM_RESUME_MAX_CHAT_PROMPTS,
  maxIdleMs = WARM_RESUME_MAX_IDLE_MS
} = {}) {
  if (enabled !== true) return cold("WARM_RESUME_DISABLED");
  if (!parked?.processId) return cold("NO_PARKED_SNAPSHOT");
  if (String(parked.phase || "") !== "ANALYZING" || !parked.lastResponse?.hash || !parked.lastPrompt?.hash) {
    return cold("LAST_TURN_NOT_ANSWERED");
  }
  const outcome = String(item?.lastOutcome || "");
  if (!WARM_RESUME_PARK_OUTCOMES.includes(outcome)) return cold("PARK_OUTCOME_NEEDS_FRESH_CHAT", { outcome });
  if (!COMPLETED_SOURCE_STATES.has(String(item?.resume?.sourceResponseState || ""))) {
    return cold("RESUME_SOURCE_NOT_COMPLETED");
  }
  if (String(lastSessionAction || "").toUpperCase() === "ROTATE_SESSION_NOW") return cold("AI_REQUESTED_NEW_CHAT");
  const answered = conversationKey(parked.lastResponse?.observation?.conversationKey || "");
  const managed = conversationKey(parked.lastManagedUrl || "");
  if (!answered && !managed) return cold("CONVERSATION_UNKNOWN");
  if (answered && managed && answered !== managed) return cold("CONVERSATION_IDENTITY_CONFLICT");
  const key = answered || managed;
  const others = new Set((Array.isArray(otherConversationKeys) ? otherConversationKeys : [...(otherConversationKeys || [])])
    .map((value) => conversationKey(value)).filter(Boolean));
  if (others.has(key)) return cold("CONVERSATION_USED_BY_OTHER_GFW");
  const profile = parked.lastPrompt?.promptProfile;
  if (!profile || typeof profile !== "object" || !profile.schema) return cold("PROMPT_PROFILE_UNKNOWN");
  const prompts = Math.max(1, Math.floor(Number(profile.ordinal) || 1));
  if (prompts >= maxChatPrompts) return cold("CHAT_PROMPT_CAP_REACHED", { prompts });
  const leftAtMs = Number(item?.lastLeftAtMs || 0) || Date.parse(parked.updatedAt || "") || 0;
  if (!leftAtMs || Number(now) - leftAtMs > maxIdleMs) return cold("CHAT_IDLE_TOO_LONG", { leftAtMs });
  return {
    schema: WARM_RESUME_SCHEMA,
    warm: true,
    code: "WARM_RESUME_PLANNED",
    conversationKey: key,
    conversationUrl: managed === key && parked.lastManagedUrl ? String(parked.lastManagedUrl) : key,
    prompts,
    leftAtMs,
    outcome,
    expectedLastUserTurnId: String(parked.lastPrompt?.dispatchedUserTurnId || "")
  };
}

/** Objective of the warm continuation prompt (English control prose). */
export function warmResumeObjective({ objective = "", outcome = "", idleMinutes = 0 } = {}) {
  const next = String(objective || "").trim() ||
    "Continue the mission from the latest verified state.";
  return [
    `Queue resume in this same conversation: this GFW was parked (${outcome || "QUEUE_PARK"}) about ${Math.max(0, Math.round(Number(idleMinutes) || 0))} min ago while other queued GFWs ran.`,
    "Your earlier turns in this conversation are your own context; owner state may have changed since, so re-read fresh owner state before any effect and do not repeat completed work.",
    `Next step: ${next}`
  ].join(" ");
}

/** Page check after navigating to the GFW's conversation. */
export function warmResumePageVerdict({ warm = null, page = {}, tabUrl = "", navigationAgeMs = 0 } = {}) {
  const wait = (code) => ({ action: "WAIT", code });
  const abandon = (code) => ({ action: "ABANDON", code });
  if (!warm?.conversationKey) return abandon("WARM_PLAN_MISSING");
  if (navigationAgeMs >= WARM_RESUME_READY_TIMEOUT_MS) return abandon("WARM_RESUME_READY_TIMEOUT");
  const shown = conversationKey(page.url || tabUrl || "");
  if (shown !== warm.conversationKey) {
    return navigationAgeMs >= WARM_RESUME_REDIRECT_GRACE_MS
      ? abandon("CONVERSATION_NOT_SHOWN")
      : wait("CONVERSATION_LOADING");
  }
  if (Number(page.userCount || 0) === 0 && Number(page.assistantCount || 0) === 0) return wait("THREAD_LOADING");
  if (page.generating === true) return wait("CONVERSATION_GENERATING");
  if (page.composerReady !== true) return wait("COMPOSER_NOT_READY");
  if (page.composerEmpty !== true) return wait("COMPOSER_HAS_DRAFT");
  // Someone wrote in this conversation after the GFW's last prompt.
  const expected = String(warm.expectedLastUserTurnId || "");
  const latest = String(page.lastUserId || "");
  if (expected && latest && latest !== expected) return abandon("CONVERSATION_CONTINUED_ELSEWHERE");
  return { action: "READY", code: "WARM_CONVERSATION_VERIFIED", conversationKey: shown };
}
