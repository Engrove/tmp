import { conversationKeyFromUrl, nullableInteger, sanitizeText } from "./common.mjs";

export function sessionIdentityFromPage(page = {}, tabId) {
  const conversationKey = sanitizeText(page.conversationKey || conversationKeyFromUrl(page.url || ""), 1000);
  if (conversationKey && !/:\/$/.test(conversationKey)) {
    return { kind: "conversation", value: conversationKey };
  }
  return {
    kind: "blank-tab",
    value: `${sanitizeText(page.url || "https://chatgpt.com/", 2000)}#tab:${nullableInteger(tabId) ?? "unknown"}#epoch:${sanitizeText(page.documentEpoch || "unknown", 180)}`
  };
}

export function receiptMatchesPage(receipt, page = {}, tabId) {
  if (!receipt || receipt.status === "ABORTED") return false;
  const latestUser = String(page.latestUser ?? "");
  const receiptTurnId = sanitizeText(receipt.turnId, 180);
  if (receiptTurnId && (
    latestUser.includes(`EIC_TURN_ID: ${receiptTurnId}`) ||
    latestUser.includes(`EIC_TURN: ${receiptTurnId}`)
  )) {
    return true;
  }
  const current = sessionIdentityFromPage(page, tabId);
  const keys = new Set([
    sanitizeText(receipt.sessionIdentity, 2000),
    sanitizeText(receipt.initialConversationKey, 1000),
    sanitizeText(receipt.postConversationKey, 1000)
  ].filter(Boolean));
  return keys.has(current.value) ||
    (current.kind === "conversation" && keys.has(sanitizeText(page.conversationKey, 1000)));
}

export function hasDeliveredStartPrompt(receipts, page, tabId) {
  return (Array.isArray(receipts) ? receipts : []).some((receipt) =>
    receiptMatchesPage(receipt, page, tabId)
  );
}
