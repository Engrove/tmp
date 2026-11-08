// v1.9.32: bounded purge of ALL durable historical mission snapshots.
// Never delete the operator's saved-mission catalog or live worker queues.
// Unsettled archived turns are retained as compact evidence for strictly
// fresh, no-replay EIC owner recovery (v1.9.33), not permanent admission blocks.
import { readStorage } from './storage-read.mjs';
import { CHECKPOINT_PREFIX, checkpointKeys, readCheckpoint, writeCheckpoint, storageLock } from './durable-checkpoint.mjs';
import { MISSION_HISTORY_PREFIX } from './mission-history.mjs';
import { MISSION_OWNERSHIP_KEY, readMissionOwnership, missionEffectsSettled } from './mission-ownership.mjs';

export const ARCHIVED_MISSION_PURGE_ALARM = 'eic.gf.archived-mission-purge.v1';
export const ARCHIVED_MISSION_PURGE_BATCH = 128;
function archivalKey(value) {
  const key = String(value || '');
  return key.startsWith(MISSION_HISTORY_PREFIX) ? key : '';
}
function archiveKeys(all) {
  return [...new Set(Object.keys(all || {}).map(raw =>
    raw.startsWith(CHECKPOINT_PREFIX) ? raw.slice(CHECKPOINT_PREFIX.length).replace(/\.[01]$/, '') : raw)
    .filter(archivalKey))].sort();
}
export async function purgeArchivedMissionSnapshots(storage, { now = Date.now(), batchSize = ARCHIVED_MISSION_PURGE_BATCH } = {}) {
  return storageLock(storage, `${MISSION_OWNERSHIP_KEY}:registry`, async () => {
    const all = await readStorage(storage, null);
    const keys = archiveKeys(all);
    const batch = keys.slice(0, Math.max(1, Math.min(ARCHIVED_MISSION_PURGE_BATCH, Math.floor(Number(batchSize) || 1))));
    const sources = [], errors = [];
    // First acquire each archive lock to avoid deleting a concurrent save.
    // No destructive removal happens before all uncertain effects are fenced.
    for (const key of batch) {
      try {
        const record = await readCheckpoint(key, storage);
        if (record.health === 'RECOVERY_REQUIRED') throw new Error('ARCHIVE_RECOVERY_REQUIRED');
        const value = record.value;
        const missionKey = String(value?.missionKey || '').trim();
        if (!missionKey || !value?.process || !value.process.processId)
          throw new Error('ARCHIVE_IDENTITY_UNPROVEN');
        const process = value.process;
        sources.push({ key, missionKey, workerId:String(process.workerId || value.workerId || ''),
          processId:String(process.processId), pending:!missionEffectsSettled(process),
          promptHash:String(process.pendingPrompt?.hash || process.lastPrompt?.hash || '').slice(0,64) });
      } catch(error) { errors.push({key, code:String(error?.message || error)}); }
    }
    const prior = await readMissionOwnership(storage);
    if (prior.archivedUnresolved == null || sources.some(row => row.pending)) {
      const archivedUnresolved = {...prior.archivedUnresolved};
      for (const row of sources.filter(row=>row.pending)) {
        archivedUnresolved[row.missionKey] ||= {sourceWorkerId:row.workerId,
          sourceProcessId:row.processId,promptHash:row.promptHash,recordedAtMs:now,
          reason:'ARCHIVED_EFFECT_UNRESOLVED_REQUIRES_OPERATOR_RECEIPT'};
      }
      if (JSON.stringify(archivedUnresolved) !== JSON.stringify(prior.archivedUnresolved || {}))
        await writeCheckpoint(MISSION_OWNERSHIP_KEY,{...prior,archivedUnresolved},storage);
    }
    const deleted = [];
    for (const row of sources) {
      try {
        await storageLock(storage, `${row.key}:archive`, async () => {
          // The owner fence has already been committed before removing source
          // bytes. Archive deletion does not clear current missions or queues.
          const keysToDelete=[row.key, ...checkpointKeys(row.key)];
          await storage.remove(keysToDelete);
          const after=await readStorage(storage,keysToDelete);
          if (Object.keys(after).length) throw new Error('ARCHIVE_DELETE_READBACK_FAILED');
        });
        deleted.push(row.key);
      } catch (error) { errors.push({ key:row.key,code:String(error?.message||error) }); }
    }
    return { schema:'eic.greenfield.mission-archive-purge.v1',deleted:deleted.length,
      protectedUnresolved:sources.filter(s=>s.pending).length, errors,
      remaining:Math.max(0,keys.length-deleted.length), completed:keys.length===deleted.length };
  });
}
