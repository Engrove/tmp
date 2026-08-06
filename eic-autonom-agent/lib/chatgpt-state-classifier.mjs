import { sanitizeText } from "./common.mjs";
import {
  isAssistantResponseCandidate,
  latestMessageIsUser,
  normalizeMessageRole
} from "./response-trigger.mjs";

export const CHATGPT_RESPONSE_STATES = Object.freeze({
  GENERATING_FOREGROUND: "GENERATING_FOREGROUND",
  WAITING_BACKGROUND: "WAITING_BACKGROUND",
  COMPLETE_STABLE: "COMPLETE_STABLE",
  COMPLETE_DYNAMIC_CANDIDATE: "COMPLETE_DYNAMIC_CANDIDATE",
  COMPLETE_PROTOCOL_OVERRIDE: "COMPLETE_PROTOCOL_OVERRIDE",
  EXPLICIT_PAUSE: "EXPLICIT_PAUSE",
  ERROR: "ERROR",
  CANCELLED: "CANCELLED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  UNKNOWN_RECONCILE: "UNKNOWN_RECONCILE"
});

export function normalizeStatusText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("sv")
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}\s'/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SV_BACKGROUND = [
  "jag jobbar pa din forfragan",
  "under tiden kan du fortsatta chatta",
  "arbetar i bakgrunden",
  "behover mer tid"
];
const EN_BACKGROUND = [
  "i'm working on your request",
  "im working on your request",
  "you can continue chatting",
  "working in the background",
  "needs more time"
];

function fold(value) {
  return normalizeStatusText(value)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}

function hasAny(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

export function detectBackgroundLanguage(signals = {}) {
  const text = fold(signals.statusText || "");
  const sv = hasAny(text, SV_BACKGROUND);
  const en = hasAny(text, EN_BACKGROUND);
  if (sv && en) return "MIXED";
  if (sv) return "sv";
  if (en) return "en";
  return "unknown";
}

/**
 * Classifies only trusted structured page-state emitted by the content bridge.
 * Assistant message text is deliberately excluded from background detection.
 */
export function classifyChatGptPage(snapshot = {}) {
  const boundary = snapshot.boundarySignals || {};
  if (boundary.captcha || boundary.authenticationRequired) {
    return { state: CHATGPT_RESPONSE_STATES.AUTH_REQUIRED, confidence: "HIGH", reason: "AUTH_OR_CAPTCHA" };
  }

  const signals = snapshot.backgroundSignals || {};
  const trusted = signals.trusted === true && signals.sourceClass === "TRUSTED_PAGE_CHROME";
  const language = signals.language || detectBackgroundLanguage(signals);
  const evidenceCodes = Array.isArray(signals.evidenceCodes) ? signals.evidenceCodes : [];

  if (trusted && signals.cancelled) {
    return { state: CHATGPT_RESPONSE_STATES.CANCELLED, confidence: "HIGH", reason: "TRUSTED_CANCELLED", language, evidenceCodes };
  }
  if (trusted && signals.error) {
    return { state: CHATGPT_RESPONSE_STATES.ERROR, confidence: "HIGH", reason: "TRUSTED_ERROR", language, evidenceCodes };
  }
  if (trusted && signals.active) {
    return {
      state: CHATGPT_RESPONSE_STATES.WAITING_BACKGROUND,
      confidence: evidenceCodes.length >= 3 ? "HIGH" : "MEDIUM",
      reason: "TRUSTED_BACKGROUND_TASK",
      language,
      evidenceCodes,
      taskFingerprint: sanitizeText(snapshot.taskFingerprint || signals.taskFingerprint, 240)
    };
  }
  const foreground = snapshot.foregroundSignals || {};
  const latestRole = normalizeMessageRole(snapshot.latestMessageRole);
  if (foreground.protocolCompletionOverride === true &&
      isAssistantResponseCandidate(snapshot)) {
    return {
      state: CHATGPT_RESPONSE_STATES.COMPLETE_PROTOCOL_OVERRIDE,
      confidence: "HIGH",
      reason: "STABLE_EIC_TRAILER_OVERRIDES_STALE_STOP_CONTROL",
      evidenceCodes: Array.isArray(foreground.evidenceCodes) ? foreground.evidenceCodes : []
    };
  }

  // Dynamic completion does not depend on ChatGPT reproducing addon variables.
  // A latest assistant message with a stable body and no streaming marker is allowed
  // through the repeated-hash settle gate even when soft Stop/composer signals linger.
  if (isAssistantResponseCandidate(snapshot)) {
    return snapshot.latestAssistantComplete === true
      ? {
          state: CHATGPT_RESPONSE_STATES.COMPLETE_STABLE,
          confidence: "MEDIUM",
          reason: "LATEST_ASSISTANT_COMPLETE"
        }
      : {
          state: CHATGPT_RESPONSE_STATES.COMPLETE_DYNAMIC_CANDIDATE,
          confidence: "MEDIUM",
          reason: "LATEST_ASSISTANT_HASH_AWAITS_STABILITY",
          evidenceCodes: Array.isArray(foreground.evidenceCodes) ? foreground.evidenceCodes : []
        };
  }

  // A user prompt is never a response trigger. WAITING remains armed until a later
  // assistant turn appears, regardless of the previous assistant hash.
  if (latestMessageIsUser(snapshot)) {
    return {
      state: snapshot.generating === true || foreground.active === true
        ? CHATGPT_RESPONSE_STATES.GENERATING_FOREGROUND
        : CHATGPT_RESPONSE_STATES.UNKNOWN_RECONCILE,
      confidence: foreground.streamingAssistant ? "HIGH" : "MEDIUM",
      reason: "LATEST_MESSAGE_IS_USER_WAIT_FOR_ASSISTANT",
      latestMessageRole: latestRole,
      evidenceCodes: Array.isArray(foreground.evidenceCodes) ? foreground.evidenceCodes : []
    };
  }

  if (snapshot.generating === true || foreground.active === true) {
    return {
      state: CHATGPT_RESPONSE_STATES.GENERATING_FOREGROUND,
      confidence: foreground.streamingAssistant || foreground.composerBusy ? "HIGH" : "MEDIUM",
      reason: foreground.streamingAssistant
        ? "FOREGROUND_STREAMING_ASSISTANT"
        : foreground.composerBusy
          ? "FOREGROUND_COMPOSER_BUSY"
          : "FOREGROUND_SCOPED_STOP_CONTROL",
      evidenceCodes: Array.isArray(foreground.evidenceCodes) ? foreground.evidenceCodes : []
    };
  }
  if (snapshot.explicitPause === true) {
    return { state: CHATGPT_RESPONSE_STATES.EXPLICIT_PAUSE, confidence: "HIGH", reason: "EXPLICIT_PAUSE" };
  }
  return {
    state: CHATGPT_RESPONSE_STATES.UNKNOWN_RECONCILE,
    confidence: "LOW",
    reason: trusted ? "TRUSTED_STATUS_INCONCLUSIVE" : "NO_TRUSTED_STATUS"
  };
}

export function isBackgroundWaitState(value) {
  return value === CHATGPT_RESPONSE_STATES.WAITING_BACKGROUND;
}

export function advanceStableCompletion(candidate, snapshot, {
  now = Date.now(),
  settleMs = 2500,
  minimumReads = 2
} = {}) {
  const hash = sanitizeText(snapshot?.latestAssistantHash, 128);
  const count = Number(snapshot?.assistantCount || 0);
  if (!hash || !isAssistantResponseCandidate(snapshot)) return null;

  if (!candidate || candidate.hash !== hash || Number(candidate.count) !== count) {
    return {
      hash,
      count,
      firstSeenAt: now,
      lastSeenAt: now,
      reads: 1,
      stable: false
    };
  }
  const next = {
    ...candidate,
    lastSeenAt: now,
    reads: Number(candidate.reads || 0) + 1
  };
  next.stable = next.reads >= minimumReads && now - Number(next.firstSeenAt || now) >= settleMs;
  return next;
}
