export function sendFenceDecision(pending, page = {}) {
  if (!pending?.text || !pending?.hash) return { action: "INVALID", evidence: "PENDING_PROMPT_MISSING" };

  const dispatch = pending.dispatch || null;
  const materializedUserTurnId = String(dispatch?.materializedUserTurnId || "");
  const resolvedUserTurnId = String(page?.autonomousTurn?.resolvedUserTurnId || "");
  if (materializedUserTurnId &&
      (resolvedUserTurnId === materializedUserTurnId || String(page?.lastUserId || "") === materializedUserTurnId)) {
    return {
      action: "WAIT_NO_RESEND",
      evidence: "MATERIALIZED_USER_TURN_ID",
      acknowledged: true
    };
  }
  // A prior bot attempt with no effect does not rule out later manual
  // materialization of that exact prompt. Reconcile before considering retry.
  if (page.lastUserHash === pending.hash) return {
    action: dispatch ? "WAIT_NO_RESEND" : "ALREADY_MATERIALIZED",
    evidence: "PAGE_LAST_USER_HASH", acknowledged: true
  };
  const pageEvidence = () => {
    if (page.lastUserHash && page.lastUserHash === pending.hash) return "PAGE_LAST_USER_HASH";
    if (Number.isInteger(dispatch?.baselineUserCount) &&
        Number(page.userCount || 0) > Number(dispatch.baselineUserCount || 0)) return "USER_COUNT_INCREMENTED";
    if (page.generating === true && dispatch?.startedAt) return "GENERATION_OBSERVED";
    if (dispatch?.baselineAssistantHash &&
        page.assistantHash &&
        page.assistantHash !== dispatch.baselineAssistantHash) return "ASSISTANT_HASH_CHANGED";
    return "";
  };

  if (dispatch?.effectPossible === true) {
    const evidence = pageEvidence() || dispatch.acknowledgementEvidence || "DISPATCH_EFFECT_POSSIBLE";
    return {
      action: "WAIT_NO_RESEND",
      evidence,
      acknowledged: Boolean(pageEvidence() || dispatch.acknowledged)
    };
  }

  if (dispatch?.effectPossible === false) {
    return { action: "RETRY_SAFE", evidence: dispatch.status || "NO_EFFECT_CONFIRMED" };
  }

  if (dispatch) {
    const evidence = pageEvidence();
    if (evidence) return { action: "WAIT_NO_RESEND", evidence, acknowledged: true };
    if (dispatch.baselineDocumentId &&
        page.documentId &&
        dispatch.baselineDocumentId === page.documentId) {
      return {
        action: "REPLAY_SAME_DISPATCH_ID",
        evidence: "SAME_DOCUMENT_IDEMPOTENT_REPLAY",
        dispatchId: dispatch.operationId
      };
    }
    return {
      action: "WAIT_NO_RESEND",
      evidence: "DISPATCH_EFFECT_UNKNOWN_DOCUMENT_CHANGED",
      acknowledged: false
    };
  }

  if (page.lastUserHash && page.lastUserHash === pending.hash) {
    return { action: "ALREADY_MATERIALIZED", evidence: "PAGE_LAST_USER_HASH_PRE_DISPATCH", acknowledged: true };
  }

  return { action: "READY_TO_DISPATCH", evidence: "" };
}
