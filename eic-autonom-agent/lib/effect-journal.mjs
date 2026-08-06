import { deepClone, nowIso, sanitizeText } from "./common.mjs";
import {
  assistantResponseIdentity,
  isAssistantResponseCandidate,
  latestMessageIsAssistant
} from "./response-trigger.mjs";

export function userMessageContainsTurn(latestUser, turnId) {
  const text = String(latestUser ?? "");
  const id = sanitizeText(turnId, 180);
  return Boolean(id && (
    text.includes(`EIC_TURN_ID: ${id}`) ||
    text.includes(`EIC_TURN: ${id}`)
  ));
}

export function pageContainsTurn(page, turnId) {
  const id = sanitizeText(turnId, 180);
  if (!id) return false;
  const ids = Array.isArray(page?.userTurnIds)
    ? page.userTurnIds.map((value) => sanitizeText(value, 180))
    : [];
  return ids.includes(id) || userMessageContainsTurn(page?.latestUser, id);
}



export function pageContainsNewAssistantReply(page = {}, {
  baselineAssistantCount = 0,
  lastProcessedAssistantCount = 0,
  baselineResponseIdentity = "",
  lastProcessedResponseIdentity = ""
} = {}) {
  if (!isAssistantResponseCandidate(page) || !latestMessageIsAssistant(page)) return false;
  const identity = assistantResponseIdentity(page);
  if (!identity) return false;

  const observedCount = Math.max(0, Number(page?.assistantCount || 0));
  const priorCount = Math.max(
    0,
    Number(baselineAssistantCount || 0),
    Number(lastProcessedAssistantCount || 0)
  );
  if (observedCount > priorCount) return true;

  const priorIdentities = [
    sanitizeText(baselineResponseIdentity, 512),
    sanitizeText(lastProcessedResponseIdentity, 512)
  ].filter(Boolean);
  return priorIdentities.length > 0 && !priorIdentities.includes(identity);
}

export function pageContainsEffect(page, effect = {}) {
  if (effect.ackMode === "PROMPT_DIGEST" && effect.promptAckDigest) {
    const hashes = Array.isArray(page?.userMessageHashes) ? page.userMessageHashes : [];
    return hashes.includes(String(effect.promptAckDigest)) ||
      String(page?.latestUserHash || "") === String(effect.promptAckDigest);
  }
  return pageContainsTurn(page, effect.turnId);
}

export function reconcileEffectRecord(effectValue, page = {}, {
  now = Date.now(),
  graceMs = 90_000,
  maxAttempts = 2,
  baselineAssistantCount = 0,
  lastProcessedAssistantCount = 0,
  baselineResponseIdentity = "",
  lastProcessedResponseIdentity = ""
} = {}) {
  if (!effectValue || typeof effectValue !== "object") {
    return { effect: null, shouldExecute: false, shouldPause: false, changed: false, reason: "NO_EFFECT" };
  }
  const effect = deepClone(effectValue);
  const visible = pageContainsEffect(page, effect);
  if (visible) {
    const changed = effect.status !== "ACKED";
    effect.status = "ACKED";
    effect.confirmedAt ||= nowIso(now);
    return {
      effect,
      shouldExecute: false,
      shouldPause: false,
      changed,
      reason: effect.ackMode === "PROMPT_DIGEST" ? "PROMPT_VISIBLE" : "TURN_VISIBLE"
    };
  }

  const assistantReplyVisible = pageContainsNewAssistantReply(page, {
    baselineAssistantCount,
    lastProcessedAssistantCount,
    baselineResponseIdentity,
    lastProcessedResponseIdentity
  });
  if (assistantReplyVisible && [
    "SUBMITTING",
    "SUBMITTED_UNCONFIRMED",
    "RETRY_PREPARED",
    "UNCERTAIN_EXHAUSTED"
  ].includes(effect.status)) {
    const changed = effect.status !== "ACKED";
    effect.status = "ACKED";
    effect.confirmedAt ||= nowIso(now);
    effect.ackEvidence = "ASSISTANT_RESPONSE_IMPLICIT_ACK";
    return {
      effect,
      shouldExecute: false,
      shouldPause: false,
      changed,
      reason: "ASSISTANT_RESPONSE_VISIBLE"
    };
  }

  if (["PREPARED", "RETRY_PREPARED"].includes(effect.status)) {
    const targetBusy = Boolean(page.generating || page.backgroundSignals?.active);
    return {
      effect,
      shouldExecute: !targetBusy,
      shouldPause: false,
      changed: false,
      reason: targetBusy ? "TARGET_BUSY" : "READY_TO_SUBMIT"
    };
  }

  if (["SUBMITTED_UNCONFIRMED", "SUBMITTING"].includes(effect.status)) {
    if (page.generating) {
      return { effect, shouldExecute: false, shouldPause: false, changed: false, reason: "GENERATION_ACTIVE" };
    }
    const anchor = Date.parse(effect.submittedAt || effect.lastAttemptAt || effect.preparedAt || 0);
    const age = Number.isFinite(anchor) ? now - anchor : Number.POSITIVE_INFINITY;
    if (age < graceMs) {
      return { effect, shouldExecute: false, shouldPause: false, changed: false, reason: "GRACE_ACTIVE" };
    }
    if (Number(effect.attempts || 0) < maxAttempts) {
      effect.status = "RETRY_PREPARED";
      return { effect, shouldExecute: true, shouldPause: false, changed: true, reason: "BOUNDED_RETRY" };
    }
    effect.status = "UNCERTAIN_EXHAUSTED";
    return { effect, shouldExecute: false, shouldPause: true, changed: true, reason: "RETRY_EXHAUSTED" };
  }

  return { effect, shouldExecute: false, shouldPause: false, changed: false, reason: "NO_ACTION" };
}
