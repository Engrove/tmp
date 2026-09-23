export const SESSION_ACTIONS = Object.freeze({
  KEEP: "KEEP",
  ROTATE_SESSION_NOW: "ROTATE_SESSION_NOW",
  PAUSE_PROCESS: "PAUSE_PROCESS",
  BACKGROUND_SLEEP: "BACKGROUND_SLEEP",
  YIELD_TO_QUEUE: "YIELD_TO_QUEUE",
  STOP_PROCESS: "STOP_PROCESS"
});

export const SESSION_ROTATION_STATES = Object.freeze({
  ARMED: "ARMED",
  NAVIGATING: "NAVIGATING",
  READY_TO_RESUME: "READY_TO_RESUME",
  RESUMED: "RESUMED"
});

const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

function validChatGptUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && CHATGPT_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function customGptRoot(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || !CHATGPT_HOSTS.has(parsed.hostname)) return "";
    const parts = parsed.pathname.split("/").filter(Boolean);
    const gIndex = parts.indexOf("g");
    if (gIndex >= 0 && parts[gIndex + 1]) {
      return `${parsed.origin}/g/${parts[gIndex + 1]}`;
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Resolve the canonical GPT landing surface used to start a fresh chat.
 *
 * Prefer a live custom-GPT path from the currently managed tab. If a conversation
 * URL no longer carries the /g/<id-slug> segment, use the previously persisted
 * root from the same process. Generic ChatGPT sessions fall back to the origin.
 */
export function deriveGptRoot(url, fallback = "") {
  const liveCustom = customGptRoot(url);
  if (liveCustom) return liveCustom;

  const fallbackCustom = customGptRoot(fallback);
  if (fallbackCustom) return fallbackCustom;

  if (validChatGptUrl(fallback)) {
    const parsed = new URL(String(fallback));
    return `${parsed.origin}/`;
  }
  if (validChatGptUrl(url)) {
    const parsed = new URL(String(url));
    return `${parsed.origin}/`;
  }
  return "";
}

export function normalizeSessionAction(value) {
  const action = String(value || "").trim().toUpperCase();
  return Object.values(SESSION_ACTIONS).includes(action)
    ? action
    : SESSION_ACTIONS.KEEP;
}

export function isExplicitRotationAction(value) {
  return normalizeSessionAction(value) === SESSION_ACTIONS.ROTATE_SESSION_NOW;
}

export function isExplicitPauseAction(value) {
  return normalizeSessionAction(value) === SESSION_ACTIONS.PAUSE_PROCESS;
}

export function isExplicitBackgroundSleepAction(value) {
  return normalizeSessionAction(value) === SESSION_ACTIONS.BACKGROUND_SLEEP;
}

export function isExplicitQueueYieldAction(value) {
  return normalizeSessionAction(value) === SESSION_ACTIONS.YIELD_TO_QUEUE;
}

export function isExplicitStopAction(value) {
  return normalizeSessionAction(value) === SESSION_ACTIONS.STOP_PROCESS;
}

export function sessionRotationObjective(value) {
  const candidate = String(value || "").trim();
  if (candidate) return candidate;
  return "Resume the active mission from Greenfield Works and current owner state. Select the next bounded work package without replaying completed work.";
}

export function createSessionRotationRecord({
  rotationId,
  reasonCode = "SESSION_ROTATION_REQUESTED",
  reason = "",
  requestedBy = "RUNTIME",
  gptRoot = "",
  sourceUrl = "",
  sessionSeq = 1,
  now = Date.now()
} = {}) {
  return {
    rotationId: String(rotationId || ""),
    state: SESSION_ROTATION_STATES.ARMED,
    reasonCode: String(reasonCode || "SESSION_ROTATION_REQUESTED"),
    reason: String(reason || ""),
    requestedBy: String(requestedBy || "RUNTIME"),
    gptRoot: String(gptRoot || ""),
    sourceUrl: String(sourceUrl || ""),
    sourceTabId: null,
    targetTabId: null,
    sessionSeq: Number(sessionSeq || 1),
    requestedAt: new Date(now).toISOString(),
    navigationStartedAt: "",
    readyAt: "",
    resumedAt: ""
  };
}
