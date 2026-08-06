import { sanitizeText } from "./common.mjs";

export const MESSAGE_ROLES = Object.freeze({
  ASSISTANT: "assistant",
  USER: "user",
  UNKNOWN: "unknown"
});

export function normalizeMessageRole(value) {
  const role = sanitizeText(value, 32).toLowerCase();
  if (role === MESSAGE_ROLES.ASSISTANT || role === MESSAGE_ROLES.USER) return role;
  return MESSAGE_ROLES.UNKNOWN;
}

/**
 * A response candidate is intentionally independent of EIC trailer variables.
 *
 * The latest conversation item must be an assistant message, the assistant body must
 * exist, no structured background task may still own the page, and no explicit
 * streaming marker may still be attached to the latest assistant node. Soft controls
 * such as a lingering Stop button or a stale composer busy flag are not sufficient to
 * suppress the candidate; the repeated-hash stability gate decides completion.
 *
 * Legacy snapshots without latestMessageRole remain readable only when they already
 * carry latestAssistantComplete=true.
 */
export function isAssistantResponseCandidate(snapshot = {}) {
  const hash = sanitizeText(snapshot.latestAssistantHash, 128);
  if (!hash) return false;

  const background = snapshot.backgroundSignals || {};
  if (background.active === true || background.cancelled === true || background.error === true) {
    return false;
  }

  const role = normalizeMessageRole(snapshot.latestMessageRole);
  if (role === MESSAGE_ROLES.USER) return false;
  if (role === MESSAGE_ROLES.UNKNOWN && snapshot.latestAssistantComplete !== true) return false;

  const foreground = snapshot.foregroundSignals || {};
  if (foreground.streamingAssistant === true) return false;

  if (snapshot.latestAssistantCandidate === false) return false;
  return role === MESSAGE_ROLES.ASSISTANT ||
    snapshot.latestAssistantCandidate === true ||
    snapshot.latestAssistantComplete === true;
}

export function latestMessageIsUser(snapshot = {}) {
  return normalizeMessageRole(snapshot.latestMessageRole) === MESSAGE_ROLES.USER;
}

export function latestMessageIsAssistant(snapshot = {}) {
  return normalizeMessageRole(snapshot.latestMessageRole) === MESSAGE_ROLES.ASSISTANT;
}

/**
 * Response identity is only meaningful for a current assistant turn. The latest user
 * task fingerprint is included so identical assistant text in two different turns is
 * still distinguishable, but a new user prompt cannot trigger by itself because user
 * turns are rejected before an identity is emitted.
 */
export function assistantResponseIdentity(snapshot = {}) {
  if (!isAssistantResponseCandidate(snapshot)) return "";
  return [
    sanitizeText(snapshot.conversationKey, 500),
    sanitizeText(snapshot.taskFingerprint, 240),
    sanitizeText(snapshot.latestAssistantHash, 128)
  ].join("|");
}

/**
 * WAITING mode consumes the current assistant turn if one already exists. When the
 * latest conversation item is a user prompt, the previous assistant answer is treated
 * as baseline and WAITING remains armed for the next assistant turn.
 */
export function waitingBaselinePolicy(snapshot = {}) {
  const role = normalizeMessageRole(snapshot.latestMessageRole);
  const hasAssistantBody = Boolean(sanitizeText(snapshot.latestAssistantHash, 128));
  return {
    latestMessageRole: role,
    armCurrentAssistant: role === MESSAGE_ROLES.ASSISTANT && hasAssistantBody,
    waitForAssistant: role !== MESSAGE_ROLES.ASSISTANT || !hasAssistantBody
  };
}
