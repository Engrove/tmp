// Shared by queue normalization and the cross-worker mission ownership fence.
// A quarantined slot must not disappear from the latter's effect inventory.
export const QUEUE_STATUS = Object.freeze({
  READY:'READY', ACTIVE:'ACTIVE', PAUSED:'PAUSED', DONE:'DONE',
  BLOCKED:'BLOCKED', FAILED:'FAILED', STOPPED:'STOPPED'
});
export function queueItemStateUnproven(item) {
  return item?.status !== undefined && !Object.values(QUEUE_STATUS).includes(String(item.status).trim().toUpperCase()) ||
    ['QUEUE_ITEM_STATE_INVALID','QUEUE_MULTIPLE_ACTIVE_ITEMS'].includes(item?.lastError?.code);
}
// A compact causal signature, not a timestamp or a retry permission. The full
// source fingerprint is rechecked when consuming the operator receipt.
export function queueItemStateKey(item, workerId, queueId) {
  const p=item?.processSnapshot || {},d=p.pendingPrompt?.dispatch;
  return JSON.stringify([workerId,queueId || '',item?.itemId || '',item?.savedMissionId || '',
    item?.lastError?.code || 'QUEUE_ITEM_STATE_INVALID',
    item?.lastError?.priorStatus || item?.status || '',Number(item?.activationCount || 0),
    p.processId || '',p.runId || '',Number(p.turn || 0),Number(p.generation || 0),
    p.pendingPrompt?.hash || '',d?.operationId || '',d?.effectPossible ?? null,
    p.lastPrompt?.hash || '',p.lastResponse?.hash || '']);
}
