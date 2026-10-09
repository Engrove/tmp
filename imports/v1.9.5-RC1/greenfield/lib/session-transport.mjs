import { randomId, normalizeText, sha256Hex, nowIso } from "./common.mjs";
import { conversationKey } from "./restart-recovery.mjs";

export const SESSION_INITIALIZATION = "SESSION_INITIALIZATION";
export const DELIVERY_CONTINUATION = "DELIVERY_CONTINUATION";
export const DELIVERY_CONTINUATION_MAX_ATTEMPTS = 2;
export const DELIVERY_NOTICE_SETTLE_MS = 5000;

export function isInitializationPrompt(prompt) {
  return prompt?.transportKind === SESSION_INITIALIZATION;
}
export function isTransportPrompt(prompt) {
  return isInitializationPrompt(prompt) || prompt?.transportKind === DELIVERY_CONTINUATION;
}
export function waitingForInitialization(process) {
  return isInitializationPrompt(process?.lastPrompt) ||
    process?.lastPrompt?.transportKind === DELIVERY_CONTINUATION &&
    isInitializationPrompt(process?.deliveryRetry?.rootPrompt);
}
export function workPromptHash(process) {
  return process?.lastPrompt?.transportKind === DELIVERY_CONTINUATION
    ? process.deliveryRetry?.rootPrompt?.hash || process.lastPrompt.hash
    : process?.lastPrompt?.hash || "";
}

export async function prepareSessionInitialization(process, workPrompt, page = {}) {
  if (!workPrompt?.text || !workPrompt.hash || workPrompt.dispatch || Number(workPrompt.sendAttempts || 0)) {
    throw new Error("SESSION_INITIALIZATION_WORK_EFFECT_UNRESOLVED");
  }
  const messageId = randomId("a2a");
  // A unique marker survives collapsed/virtualized user messages. This is
  // intentionally a tiny transport message, without a mission or work action.
  const a2a = { messageId, messageType: SESSION_INITIALIZATION,
    instruction: "Session initialization only. Reply briefly READY. Do not start mission work, call tools or change any state. Await the next work prompt." };
  const text = JSON.stringify(a2a);
  const pendingPrompt = { text, hash: await sha256Hex(normalizeText(text)), a2a,
    transportKind: SESSION_INITIALIZATION, transportId: messageId, baselineAssistantHash: page.assistantHash || "",
    createdAt: nowIso(), sendAttempts: 0, dispatch: null, promptPause: null, postDelaySeconds: 0,
    requiredConversationKey: conversationKey(page.url || "") };
  return { pendingPrompt, sessionInitialization: { initializationId: messageId,
    sessionSeq: process.sessionSeq, status: "PENDING", createdAt: nowIso(),
    conversationKey: conversationKey(page.url || ""), workPrompt,
    receipt: null, response: null } };
}

// Requires an acknowledged exact user turn and a proven conversation. The
// error banner is evidence about transport, not evidence about work effects.
export function deliveryContinuationEligibility(process, page) {
  const prompt = process?.lastPrompt;
  const key = conversationKey(page?.url || "");
  if (!key || key !== conversationKey(process?.lastManagedUrl || "") ||
      prompt?.conversationKey && prompt.conversationKey !== key) return "DELIVERY_CONVERSATION_UNPROVEN";
  if (prompt?.acknowledged !== true || !prompt.hash || !prompt.dispatchedUserTurnId ||
      page?.lastUserId !== prompt.dispatchedUserTurnId ||
      page?.lastUserHash !== prompt.hash) return "DELIVERY_SOURCE_TURN_UNPROVEN";
  if (process.pendingPrompt || process.storageRecoveryRequired || process.safety?.qualityIncident ||
      process.greenfieldControl?.hardStop) return "DELIVERY_EFFECT_UNRESOLVED";
  return "";
}

export function deliveryRetryForPrompt(process) {
  const retry = process?.deliveryRetry;
  const hash = workPromptHash(process);
  return retry?.rootPrompt?.hash === hash && retry.sessionSeq === process.sessionSeq ? retry : null;
}

export async function prepareDeliveryContinuation(process, page) {
  const source = structuredClone(process.lastPrompt);
  const prior = deliveryRetryForPrompt(process);
  const key = conversationKey(page.url);
  const attempts = Number(prior?.attempts || 0) + 1;
  const text = "Fortsätt";
  const pendingPrompt = { text, hash: await sha256Hex(normalizeText(text)),
    transportKind: DELIVERY_CONTINUATION, transportId: randomId("short-continue"), a2a: source.a2a || null,
    baselineAssistantHash: page.assistantHash || "", createdAt: nowIso(),
    sendAttempts: 0, dispatch: null, promptPause: null, postDelaySeconds: 0,
    requiredConversationKey: key, sourceUserTurnId: source.dispatchedUserTurnId };
  return { pendingPrompt, deliveryRetry: { rootPrompt: prior?.rootPrompt || source,
    sourcePrompt: source, sessionSeq: process.sessionSeq, conversationKey: key,
    attempts, status: "PENDING", preparedAtMs: Date.now(), noticeFirstSeenAtMs: 0 } };
}

// The second short retry has identical text. The preceding "Fortsätt" turn
// can never be used as proof that this new dispatch materialized.
export function deliveryFencePage(pending, page) {
  if (pending?.transportKind !== DELIVERY_CONTINUATION ||
      page?.lastUserId !== pending.sourceUserTurnId) return page;
  return { ...page, lastUserHash: "", autonomousTurn: {
    ...(page.autonomousTurn || {}), userTextHash: "" } };
}
