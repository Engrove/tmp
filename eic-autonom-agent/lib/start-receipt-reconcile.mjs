import { sanitizeText } from "./common.mjs";
import { receiptMatchesPage } from "./session-receipts.mjs";
import { isAssistantResponseCandidate } from "./response-trigger.mjs";

const RECONCILABLE = new Set(["SUBMITTED", "SUBMITTED_UNCONFIRMED", "SENT_UNCONFIRMED"]);

export function reconcileStartPromptReceipts(receipts = [], page = {}, tabId, {
  now = Date.now()
} = {}) {
  let changed = false;
  const updated = (Array.isArray(receipts) ? receipts : []).map((source) => {
    const receipt = { ...source };
    if (!RECONCILABLE.has(String(receipt.status || ""))) return receipt;
    if (!receiptMatchesPage(receipt, page, tabId)) return receipt;
    if (!isAssistantResponseCandidate(page)) return receipt;
    const baselineHash = sanitizeText(receipt.baselineAssistantHash, 256);
    const currentHash = sanitizeText(page.latestAssistantHash, 256);
    if (baselineHash && currentHash === baselineHash) return receipt;

    const submittedAt = Date.parse(receipt.submittedAt || receipt.preparedAt || "");
    if (Number.isFinite(submittedAt) && submittedAt > now) return receipt;

    receipt.status = "ACKED";
    receipt.confirmedAt = receipt.confirmedAt || new Date(now).toISOString();
    if (page.conversationKey) receipt.postConversationKey = sanitizeText(page.conversationKey, 1200);
    receipt.reconciledFromAssistantHash = sanitizeText(page.latestAssistantHash, 256);
    changed = true;
    return receipt;
  });
  return { receipts: updated, changed };
}
