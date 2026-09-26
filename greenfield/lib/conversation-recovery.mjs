// v1.8.8: keep an unanswered conversation distinct from its GPT landing page.
// Pure decisions only. Dispatch fences, GPT proof and tab effects keep their owners.
import { conversationKey } from "./restart-recovery.mjs";
import { customGptRoot, sameGpt } from "./managed-eic-surface.mjs";

export function conversationInFlight(process) {
  return ["WAITING", "ANALYZING"].includes(process?.phase) ||
    (process?.phase === "SENDING" && Boolean(process.pendingPrompt?.dispatch) &&
      process.pendingPrompt.dispatch.effectPossible !== false);
}

export function knownConversationUrl(process) {
  const url = String(process?.lastManagedUrl || "");
  if (!conversationKey(url)) return "";
  const observedRoot = customGptRoot(url);
  if (observedRoot) return sameGpt(observedRoot, process?.gptRoot) ? url : "";
  // A generic /c/<id> is allowed only as a previously stored, surface-proven
  // address on the bound origin; this does not authorize a new generic page.
  try {
    return new URL(url).origin === new URL(process.gptRoot).origin ? url : "";
  } catch { return ""; }
}

export function shouldRememberManagedUrl(process, url) {
  return !conversationInFlight(process) ||
    !knownConversationUrl(process) ||
    Boolean(conversationKey(url));
}

export function conversationRecoveryUrl(process, observedUrl) {
  const known = knownConversationUrl(process);
  if (conversationInFlight(process) && known && !conversationKey(observedUrl)) return known;
  return String(observedUrl || process?.lastManagedUrl || process?.gptRoot || "");
}

export function expectedThreadMissing(process, page) {
  const h = page?.pageHealth;
  return process?.phase === "WAITING" &&
    process.lastPrompt?.acknowledged === true &&
    Boolean(knownConversationUrl(process)) &&
    h?.readyState === "complete" &&
    Number(h.turnCount || 0) === 0 &&
    page.generating !== true &&
    !conversationKey(page.url);
}
