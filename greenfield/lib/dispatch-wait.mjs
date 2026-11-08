import { budgetDecision, usageIdentity } from './usage-governor.mjs';

// Read-only projection of existing admission gates. This is never dispatch
// permission and does not change the operator's independent safety policy.
export function dispatchWaitView(process, safety, gate, now = Date.now()) {
  const pending = process?.pendingPrompt;
  if (process?.phase !== 'SENDING' || !pending || !safety?.policy ||
      pending.dispatch && pending.dispatch.effectPossible !== false ||
      process.storageRecoveryRequired || process.safety?.qualityIncident ||
      process.safety?.hold && process.safety.hold.code !== 'LOCAL_PACING_WAIT' ||
      safety.admissionPaused || safety.providerHold ||
      gate?.rateLimit?.state && gate.rateLimit.state !== 'NORMAL') return null;
  const constraints = [];
  const add = (code, atMs) => { if (Number.isFinite(atMs) && atMs > now) constraints.push({code, atMs}); };
  const budget = budgetDecision(safety, usageIdentity(process, pending), pending.text, now);
  if (!budget.allowed && budget.code !== 'LOCAL_PACING_WAIT') return null;
  if (!budget.allowed) add(budget.code, budget.retryAtMs);
  const gapMs = Number(safety.policy.minGapSeconds || 0) * 1000;
  if (safety.lastAuthorizedDispatchId !== pending.dispatch?.operationId && safety.lastAuthorizedAtMs)
    add('LOCAL_PACING_WAIT', safety.lastAuthorizedAtMs + gapMs);
  add('GLOBAL_PROMPT_POST_PAUSE', Number(pending.promptPause?.notBeforeAtMs || 0));
  if (gate?.lastPromptPostedAtMs)
    add('GLOBAL_PROMPT_POST_PAUSE', gate.lastPromptPostedAtMs + Number(pending.postDelaySeconds || 0) * 1000);
  if (gate?.activeLease?.reservationId !== pending.promptPause?.reservationId)
    add('GLOBAL_PROMPT_SEND_LEASE_BUSY', Number(gate?.activeLease?.expiresAtMs || 0));
  add('LOCAL_PACING_WAIT', Number(process.safety?.hold?.retryAtMs || 0));
  if (!constraints.length) return null;
  const limiting = constraints.reduce((a,b) => a.atMs >= b.atMs ? a : b);
  return { code: limiting.code, retryAtMs: limiting.atMs, constraints,
    minGapSeconds: Number(safety.policy.minGapSeconds || 0),
    postDelaySeconds: Number(pending.postDelaySeconds || 0), grantsDispatch: false };
}
