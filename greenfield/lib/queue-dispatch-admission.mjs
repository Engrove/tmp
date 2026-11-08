import { scheduleBlockReason, scheduleClosesAtMs, nextScheduleOpenAtMs } from './queue-schedule.mjs';
import { normalizeReasoningLevel } from './reasoning-level.mjs';

// A fleet capacity grant is not permission to execute a different worker's
// queue item, or to send after this item's window closes. This check is also
// used by the content bridge's final authorization (after write-ahead).
export function queueDispatchAdmission(process, queue, now = Date.now()) {
  const ctx = process?.queueContext;
  if (!ctx) return { ok: !process?.queueWait?.queueId, code: process?.queueWait?.queueId ? 'QUEUE_DISPATCH_OWNER_MISMATCH' : '', closesAtMs: 0 };
  const item = queue?.items?.find(row => row.itemId === ctx.itemId);
  if (!process.workerId || !ctx.queueId || !ctx.itemId || !queue ||
      queue.workerId !== process.workerId || ctx.workerId !== process.workerId ||
      Number(queue.windowId) !== Number(process.windowId) || queue.queueId !== ctx.queueId ||
      queue.activeItemId !== ctx.itemId || !item || item.status !== 'ACTIVE' ||
      String(item.savedMissionId || '') !== String(ctx.savedMissionId || '') ||
      Number(item.activationCount || 0) !== Number(ctx.activationCount || 0)) {
    return { ok: false, code: 'QUEUE_DISPATCH_OWNER_MISMATCH', closesAtMs: 0 };
  }
  if (queue.enabled !== true) return { ok: false, code: 'QUEUE_DISPATCH_STOPPED', closesAtMs: 0 };
  let reasoningLevel;
  try { reasoningLevel = normalizeReasoningLevel(item.reasoningLevel); }
  catch { return {ok:false, code:'REASONING_LEVEL_INVALID', closesAtMs:0}; }
  // An active quantum is not delayed again by its inter-quantum interval.
  const code = scheduleBlockReason(item.schedule || null, now);
  return { ok: !code, code, closesAtMs: scheduleClosesAtMs(item.schedule || null, now) || 0,
    retryAtMs: code ? nextScheduleOpenAtMs(item.schedule || null, now) || null : null,
    queueId: queue.queueId, itemId: item.itemId, workerId: queue.workerId, reasoningLevel,
    savedMissionId: String(item.savedMissionId || ''), activationCount: Number(item.activationCount || 0),
    queueRevision: Number(queue.revision || 0), scheduleUpdatedAtMs: Number(item.schedule?.updatedAtMs || 0), checkedAtMs: now };
}
