import {readStorage} from './storage-read.mjs';
import {readCheckpoint, CHECKPOINT_PREFIX} from './durable-checkpoint.mjs';
import {MISSION_HISTORY_PREFIX, missionOwnershipKey} from './mission-history.mjs';
import {staleDraftSource} from './stale-draft-recovery.mjs';

const PROCESS = 'eic.gf.process.worker.';
const QUEUE = 'eic.gf.mission-work-queue.worker.';

function sourceRows(key, value) {
  if (key.startsWith(PROCESS) && key === PROCESS + value?.workerId && value?.processId)
    return [{source:value, locator:{kind:'PROCESS',key,processId:value.processId}}];
  if (key.startsWith(QUEUE) && key === QUEUE + value?.workerId && value?.queueId) {
    return [...(Array.isArray(value.items) ? value.items : []), ...(Array.isArray(value.history) ? value.history : [])].flatMap(item => {
      const source = item?.processSnapshot;
      if (!source?.processId || source.workerId !== value.workerId || !item.itemId) return [];
      return [{source,locator:{kind:'QUEUE_ITEM',key,queueId:value.queueId,itemId:item.itemId,processId:source.processId}}];
    });
  }
  const source = value?.process;
  if (key.startsWith(MISSION_HISTORY_PREFIX) && value?.schema === 'eic.greenfield.mission-history.v1' &&
      source?.processId && value.workerId === source.workerId && value.missionKey === missionOwnershipKey(source) &&
      key === MISSION_HISTORY_PREFIX + encodeURIComponent(value.missionKey) + '.' + source.workerId)
    return [{source,locator:{kind:'MISSION_HISTORY',key,processId:source.processId}}];
  return [];
}

// Re-read the exact durable source at authorization time. The current worker
// record is a moving pointer and cannot stand in for a parked mission.
export async function readDraftRecoverySource(locator, storage) {
  if (!locator || !['PROCESS','QUEUE_ITEM','MISSION_HISTORY'].includes(locator.kind) ||
      typeof locator.key !== 'string' || !locator.processId ||
      !(locator.key.startsWith(PROCESS) || locator.key.startsWith(QUEUE) || locator.key.startsWith(MISSION_HISTORY_PREFIX))) return null;
  const record = await readCheckpoint(locator.key, storage);
  if (record.health === 'RECOVERY_REQUIRED') return null;
  const matches = sourceRows(locator.key, record.value).filter(row => row.locator.kind === locator.kind &&
    row.locator.processId === locator.processId && row.locator.queueId === locator.queueId && row.locator.itemId === locator.itemId);
  return matches.length === 1 ? matches[0].source : null;
}

export async function findDraftRecoverySource(target, hash, storage, openTabs) {
  if (!/^[a-f0-9]{64}$/.test(hash || '') || !Array.isArray(openTabs)) return null;
  // Enumerate physical keys without eagerly expanding every checkpoint.
  // WAL-only records go through the normal authoritative checkpoint reader.
  const raw = await readStorage(storage, null, {decode:false});
  const keys = [...new Set(Object.keys(raw || {}).map(key => key.startsWith(CHECKPOINT_PREFIX)
    ? key.slice(CHECKPOINT_PREFIX.length).replace(/\.[01]$/,'') : key))]
    .filter(key => key.startsWith(PROCESS) || key.startsWith(QUEUE) || key.startsWith(MISSION_HISTORY_PREFIX));
  const rank = key => key === QUEUE + target.workerId ? 0 : key === PROCESS + target.workerId ? 1 :
    key.startsWith(MISSION_HISTORY_PREFIX) && key.endsWith('.'+target.workerId) ? 2 : 3;
  keys.sort((a,b) => rank(a)-rank(b) || a.localeCompare(b));
  let unreadable = false;
  for (const key of keys) {
    let record;
    try { record = await readCheckpoint(key, storage); }
    catch { unreadable = true; continue; }
    if (record.health === 'RECOVERY_REQUIRED') { unreadable = true; continue; }
    for (const {source,locator} of sourceRows(key,record.value)) {
      if (source?.sessionInitialization?.receipt?.hash !== hash && source?.pendingPrompt?.hash !== hash) continue;
      const candidate = await staleDraftSource(source,target,hash);
      if (candidate && (candidate.kind === 'SETTLED_INITIALIZATION' || !openTabs.some(tab => tab.id === candidate.sourceTabId)))
        return {...candidate,sourceLocator:locator};
    }
  }
  if (unreadable) throw Object.assign(new Error('DRAFT_SOURCE_STORAGE_UNVERIFIED'),{code:'DRAFT_SOURCE_STORAGE_UNVERIFIED'});
  return null;
}
