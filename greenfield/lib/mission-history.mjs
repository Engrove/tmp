import { readCheckpoint, writeCheckpoint, storageLock } from './durable-checkpoint.mjs';

export const MISSION_HISTORY_PREFIX = 'eic.gf.mission-history.v1.';
export function missionOwnershipKey(value) {
  const header = String(value?.goal || '').split(/\r?\n/, 1)[0];
  const gfw = header.match(/\bGF-\d+\.\d+\.\d+\b/i)?.[0];
  const saved = String(value?.queueContext?.savedMissionId || value?.savedMissionId || '');
  return gfw ? `gfw:${gfw.toUpperCase()}` : saved ? `saved:${saved}` : '';
}
// One latest full checkpoint per logical mission/worker, before destructive
// replacement. Contains frozen objectives/receipts; it is never a PASS claim.
export async function preserveMissionHistory(process, storage, item = null) {
  const key = missionOwnershipKey(process);
  if (!key || !process?.workerId || !process.processId) return;
  const recordKey = MISSION_HISTORY_PREFIX + encodeURIComponent(key) + '.' + process.workerId;
  return storageLock(storage, recordKey + ':archive', async () => {
    const prior = await readCheckpoint(recordKey, storage);
    if (prior.health === 'RECOVERY_REQUIRED') throw new Error('MISSION_HISTORY_RECOVERY_REQUIRED');
    const old = prior.value?.process;
    // Within one run, generation/turn are causal counters, not timestamps or
    // UUID order. A wall-clock rollback cannot discard a later completed turn.
    const comparable = old?.processId === process.processId && old?.runId === process.runId &&
      [old.generation,process.generation,old.turn,process.turn].every(Number.isSafeInteger);
    const order = comparable ? (process.generation-old.generation || process.turn-old.turn) : 0;
    if (order < 0 || order === 0 && old && Date.parse(old.updatedAt || 0) > Date.parse(process.updatedAt || 0)) return;
    await writeCheckpoint(recordKey, { schema: 'eic.greenfield.mission-history.v1', missionKey: key,
      workerId: process.workerId, process, item, archivedAt: new Date().toISOString() }, storage);
  });
}
