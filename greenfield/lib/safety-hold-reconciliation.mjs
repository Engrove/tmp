import { conversationKey } from './restart-recovery.mjs';
import { autonomousUserTurnProof } from './turn-causality.mjs';
import { expectedInitializationAck, waitingForInitialization, DELIVERY_CONTINUATION } from './session-transport.mjs';

// A root page can acquire its conversation URL only after the first dispatch.
// Resolve that particular hold with the original transport identity, never
// with a model proof alone or an unrelated READY response. This grants no send.
function initializationConversationResolved(process, page) {
  const init = process?.sessionInitialization;
  const prompt = process?.lastPrompt;
  const key = conversationKey(page?.url || '');
  if (!init || init.sessionSeq !== process.sessionSeq || !key ||
      process.storageRecoveryRequired || process.safety?.qualityIncident || process.greenfieldControl?.hardStop ||
      !prompt?.acknowledged || !prompt.dispatchedUserTurnId ||
      page?.lastUserId !== prompt.dispatchedUserTurnId ||
      init.conversationKey && init.conversationKey !== key ||
      prompt.conversationKey && prompt.conversationKey !== key) return false;

  let source = process;
  if (process.phase === 'SENDING') {
    const work = process.pendingPrompt;
    if (init.status !== 'READY' || !init.response?.messageId || !init.response?.hash ||
        !work?.hash || work.dispatch || Number(work.sendAttempts || 0) !== 0 ||
        !init.conversationKey || work.requiredConversationKey !== key) return false;
    const receipt = prompt.transportKind === DELIVERY_CONTINUATION ? init.completionReceipt : init.receipt;
    if (!receipt || receipt.hash !== prompt.hash || receipt.dispatchId !== prompt.dispatchId ||
        receipt.dispatchedUserTurnId !== prompt.dispatchedUserTurnId) return false;
    // Migrate an already released v1.9.22 work prompt without rewriting it.
    source = { ...process, phase: 'WAITING', pendingPrompt: null,
      sessionInitialization: { ...init, workPrompt: work },
      deliveryRetry: prompt.transportKind === DELIVERY_CONTINUATION ? { rootPrompt: init.receipt } : null };
  } else if (process.phase !== 'WAITING') return false;

  return Boolean(waitingForInitialization(source) && expectedInitializationAck(source) &&
    autonomousUserTurnProof(source, page, { allowLegacyHash: false }).ok);
}

export function reconcileSafetyHoldWithFreshProof(priorSafety = {}, proof = {}, qualityIncident = null, context = {}) {
  const hold = priorSafety?.hold || null;
  const priorProof = priorSafety?.proof || null;
  const holdCode = String(hold?.code || "");
  const priorProofCode = String(priorProof?.code || "");

  const initializationResolved = holdCode === 'SESSION_INITIALIZATION_CONVERSATION_UNPROVEN' &&
    initializationConversationResolved(context.process, context.page);
  const clear = Boolean(
    hold &&
    proof?.allowed === true &&
    !qualityIncident &&
    holdCode &&
    (priorProofCode && holdCode === priorProofCode || initializationResolved ||
      ["MODEL_EVIDENCE_STALE","MODEL_EVIDENCE_MISSING","MODEL_EVIDENCE_REFRESH_UNAVAILABLE","MODEL_EVIDENCE_CONTEXT_CHANGED"].includes(holdCode))
  );

  return {
    hold: clear ? null : hold,
    cleared: clear,
    clearedCode: clear ? holdCode : "",
    clearedBy: clear ? initializationResolved ? 'INITIALIZATION_CONVERSATION_BOUND' : 'FRESH_MODEL_PROOF' : ''
  };
}
