import { readStorage } from "./storage-read.mjs";
import { queueItemStateUnproven, queueItemStateKey } from "./queue-item-state.mjs";
import { readCheckpoint, writeCheckpoint, storageLock, CHECKPOINT_PREFIX } from './durable-checkpoint.mjs';
import { responseContentAdmission } from './response-stability.mjs';
import { sha256Hex } from './common.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { MISSION_HISTORY_PREFIX, missionOwnershipKey } from './mission-history.mjs';
import { archivedEffectRecoveryEligible, recordQuarantinedEffect } from './mission-archive-recovery.mjs';
import { conversationKey } from './restart-recovery.mjs';
import { expectedInitializationAck, isInitializationPrompt, DELIVERY_CONTINUATION } from './session-transport.mjs';
import { promptCausalMarker } from './turn-causality.mjs';
export { missionOwnershipKey } from './mission-history.mjs';

export const MISSION_OWNERSHIP_KEY = 'eic.gf.mission-work-queue.ownership.v1';
export async function readMissionOwnership(storage) {
  const record = await readCheckpoint(MISSION_OWNERSHIP_KEY, storage);
  if (record.health === 'RECOVERY_REQUIRED') throw new Error('MISSION_OWNERSHIP_RECOVERY_REQUIRED');
  return record.value || { schema: 'eic.greenfield.mission-ownership.v1', owners: {} };
}
export function missionOwnerAllowed(process, state) {
  const owner = state?.owners?.[missionOwnershipKey(process)];
  return !owner || owner.workerId === process.workerId &&
    (!owner.processFence || owner.processId === process.processId);
}
const lockKey = process => `${MISSION_OWNERSHIP_KEY}:${missionOwnershipKey(process)}`;
export async function withMissionOwner(process, storage, work) {
  if (!missionOwnershipKey(process)) return work();
  return storageLock(storage, lockKey(process), async () => {
    if (!missionOwnerAllowed(process, await readMissionOwnership(storage)))
      throw Object.assign(new Error('MISSION_OWNERSHIP_SUPERSEDED'), { code: 'MISSION_OWNERSHIP_SUPERSEDED', effectPossible: false });
    return work();
  });
}

// A first work attempt can stop before a user turn exists. Accept only the
// runtime's explicit no-effect receipts, bound to this draft and its baseline;
// an attempt count or a no-effect label alone is not proof of settlement.
function initializationWorkHasNoEffect(work) {
  const attempts = Number(work.sendAttempts || 0), dispatch = work.dispatch;
  if (!dispatch) return attempts === 0;
  const marker = promptCausalMarker(work.text);
  return Number.isSafeInteger(attempts) && attempts > 0 &&
    ['NO_EFFECT_CONFIRMED', 'RATE_LIMIT_REJECTED_NO_EFFECT', 'ABORTED_BEFORE_EFFECT_GLOBAL_RATE_LIMIT'].includes(dispatch.status) &&
    dispatch.effectPossible === false && dispatch.acknowledged === false &&
    typeof dispatch.operationId === 'string' && Boolean(dispatch.operationId) &&
    Boolean(marker) && dispatch.promptMarker === marker &&
    dispatch.baselineAssistantHash === work.baselineAssistantHash &&
    dispatch.postedAtMs == null && !dispatch.method && !dispatch.materializedUserTurnId &&
    dispatch.materializedUserTurnIndex == null && !dispatch.materializationReceiptAt && !dispatch.materializedBy;
}

// Initialization completion is deliberately stored separately from lastResponse:
// it must never count as an operative work result. Recognize the durable READY
// receipt for that exact transport turn while its bound work has no effect.
// READY alone, an old initialization before a later send, or a live owner cannot
// authorize takeover. The caller still enforces checkpoint health and liveness.
function completedInitializationSettled(process) {
  const init = process?.sessionInitialization, prompt = process?.lastPrompt;
  const root = init?.receipt, work = process?.pendingPrompt;
  const continuation = prompt?.transportKind === DELIVERY_CONTINUATION;
  const receipt = continuation ? init?.completionReceipt : root;
  const key = conversationKey(init?.conversationKey || '');
  const hashValid = value => /^[a-f0-9]{64}$/.test(String(value || ''));
  const workBinding = work ?? { hash: init?.acknowledgement?.binding?.workPromptHash };
  if (init?.status !== 'READY' || init.sessionSeq !== process.sessionSeq || init.workPrompt || init.ackWait ||
      !Number.isFinite(Date.parse(init.completedAt || '')) || !key ||
      typeof init.response?.messageId !== 'string' || !init.response.messageId || !hashValid(init.response.hash) ||
      !hashValid(workBinding.hash) || (work != null && (!work.text || !initializationWorkHasNoEffect(work) ||
        work.baselineAssistantHash !== init.response.hash || conversationKey(work.requiredConversationKey || '') !== key)) ||
      !isInitializationPrompt(root) || root.transportId !== init.initializationId ||
      root.a2a?.messageType !== 'SESSION_INITIALIZATION' || root.a2a.messageId !== init.initializationId ||
      root.acknowledged !== true || !root.dispatchId || !root.dispatchedUserTurnId || !hashValid(root.hash) ||
      (!isInitializationPrompt(prompt) && !continuation) || prompt.acknowledged !== true ||
      !prompt.dispatchId || !prompt.dispatchedUserTurnId || !hashValid(prompt.hash) || !prompt.text ||
      !receipt || receipt.acknowledged !== true ||
      !['hash','text','transportKind','transportId','dispatchId','dispatchedUserTurnId']
        .every(field => receipt[field] === prompt[field])) return false;
  // Root-page sends can precede allocation of /c/<id>. The READY checkpoint
  // binds the completed conversation; only an explicit conflict is rejected.
  if ([root, prompt, receipt].some(row => row.conversationKey && conversationKey(row.conversationKey) !== key)) return false;

  // Schedule parking intentionally discards the future draft. Entering queue
  // wait also clears queueContext; its durable queue/slot identity must still
  // match the completed initialization's original binding.
  let queueContext = process.queueContext;
  if (!queueContext && work == null && process.queueWait) {
    const wait = process.queueWait, binding = init.acknowledgement?.binding;
    if (!wait.queueId || !wait.parkedItemId || wait.queueId !== binding?.queueId || wait.parkedItemId !== binding?.itemId) return false;
    const admission = root.queueAdmission;
    if (admission && (admission.queueId !== binding.queueId || admission.itemId !== binding.itemId ||
        admission.savedMissionId !== binding.savedMissionId || admission.workerId !== process.workerId)) return false;
    queueContext = { queueId: wait.queueId, itemId: wait.parkedItemId, savedMissionId: binding.savedMissionId };
  }

  // Reuse the transport owner's process/run/session/queue/work challenge
  // binding. If parking discarded the draft, use only its recorded hash for
  // this read view, without manufacturing a dispatch or completion response.
  return Boolean(expectedInitializationAck({ ...process, phase: 'WAITING', pendingPrompt: null, queueContext,
    sessionInitialization: { ...init, workPrompt: workBinding },
    deliveryRetry: continuation ? { rootPrompt: root } : null }));
}

export function missionEffectsSettled(process) {
  if (process?.priorStateUnknown || process?.storageRecoveryRequired) return false;
  if (process?.pendingPrompt?.dispatch && process.pendingPrompt.dispatch.effectPossible !== false) return false;
  if (process?.pendingPrompt && Number(process.pendingPrompt.sendAttempts || 0) > 0 && !process.pendingPrompt.dispatch) return false;
  if (!process?.lastPrompt) return true;
  if (completedInitializationSettled(process)) return true;
  return responseContentAdmission(process.lastResponse?.text).admissible &&
    process.lastResponse?.observation?.pairedUserTurnId === process.lastPrompt?.dispatchedUserTurnId &&
    Boolean(process.lastPrompt?.dispatchedUserTurnId);
}
// Every prior generation is reconciled by takeover, not by an operator
// acknowledgement. Unknown effects are carried into a fresh-session quarantine
// instruction. The old prompt is NEVER replayed. This applies whether the old
// tab is closed, detached, still generating, or merely has an unproven response.
// A live old process is fenced atomically when the new owner is committed.
async function priorEffectQuarantineSource(others, owner) {
  const unresolved = others.filter(p => !missionEffectsSettled(p));
  const ownerUnproven = Boolean(owner && !others.some(p =>
    p.workerId === owner.workerId && p.processId === owner.processId));
  if (!unresolved.length && !ownerUnproven) return null;
  const ordered = [...unresolved].sort((a,b) =>
    (Date.parse(b.updatedAt || '') || 0)-(Date.parse(a.updatedAt || '') || 0));
  const newest = ordered[0] || null;
  const sourceSet = {
    owner: owner ? { workerId:owner.workerId, processId:owner.processId, epoch:owner.epoch || 0 } : null,
    unresolved: ordered.map(p => ({ workerId:p.workerId || '', processId:p.processId || '',
      phase:p.phase || '', promptHash:p.lastPrompt?.hash || p.pendingPrompt?.hash || '',
      queueStateKey:p.queueStateKey || '', updatedAt:p.updatedAt || '' }))
  };
  const sourceSetHash = await sha256Hex(canonicalJson(sourceSet));
  const recordedAtMs = Math.max(0, ...ordered.map(p => Date.parse(p.updatedAt || '') || 0),
    Number(owner?.claimedAtMs || 0));
  return {
    sourceWorkerId: ordered.length === 1 ? String(newest?.workerId || owner?.workerId || 'unknown') : 'multiple',
    sourceProcessId: ordered.length === 1 ? String(newest?.processId || owner?.processId || 'unknown') : `multiple:${sourceSetHash.slice(0,16)}`,
    promptHash: sourceSetHash,
    sourceSetHash,
    priorPromptHashes: [...new Set(ordered.flatMap(p => [p.lastPrompt?.hash,p.pendingPrompt?.hash]).filter(Boolean).map(String))],
    recordedAtMs,
    reason: 'PRIOR_EFFECT_QUARANTINED_NO_REPLAY',
    unresolvedSourceCount: unresolved.length + (ownerUnproven && !unresolved.length ? 1 : 0)
  };
}
const targetIdentity = p => ({ workerId:p.workerId, queueId:p.queueContext?.queueId || '',
  itemId:p.queueContext?.itemId || '', savedMissionId:p.queueContext?.savedMissionId || p.savedMissionId || '' });

async function inspect(process, { storage, liveWorkerIds = [], allowTakeover = true } = {}, state) {
  const key = missionOwnershipKey(process), owner = state.owners[key];
  const all = await readStorage(storage,null), byProcess = new Map(), unprovenQueueStates = [];
  const keys = [...new Set(Object.keys(all).map(k => k.startsWith(CHECKPOINT_PREFIX)
    ? k.slice(CHECKPOINT_PREFIX.length).replace(/\.[01]$/, '') : k))].sort();
  let damaged = false;
  // History first, then parked snapshots, then the actual current process.
  for (const prefix of [MISSION_HISTORY_PREFIX,'eic.gf.mission-work-queue.worker.','eic.gf.process.worker.']) {
    for (const k of keys.filter(k => k.startsWith(prefix))) {
      let record;
      try { record = await readCheckpoint(k, storage); }
      catch (error) {
        const raw = all[k];
        if (k.endsWith(owner?.workerId || '\0') || missionOwnershipKey(raw) === key ||
            raw?.items?.some(i=>missionOwnershipKey(i)===key)) damaged = true;
        continue;
      }
      const value = record.value;
      const active = (value?.items || []).filter(i=>i.status==='ACTIVE');
      const kept = active.find(i=>i.itemId===value.activeItemId)?.itemId || active[0]?.itemId;
      const queueItems = (value?.items || []).map(i=>active.length>1 && i.status==='ACTIVE' && i.itemId!==kept
        ? {...i,lastError:{code:'QUEUE_MULTIPLE_ACTIVE_ITEMS',priorStatus:'ACTIVE'}} : i);
      const candidates = prefix === MISSION_HISTORY_PREFIX ? [value?.process] : prefix.includes('process.worker.') ? [value] :
        queueItems.filter(i => (missionOwnershipKey(i) === key || queueItemStateUnproven(i) || i.processSnapshot ||
          i.status === 'ACTIVE' || Boolean(value.activeItemId && i.itemId === value.activeItemId)) &&
          !(i.status === 'STOPPED' && i.lastOutcome === 'MISSION_OWNERSHIP_TRANSFERRED'))
          .map(i => {
            const queueContext = {queueId:value.queueId || '',workerId:value.workerId || '',itemId:i.itemId || '',
              savedMissionId:i.savedMissionId || ''};
            return queueItemStateUnproven(i) ? { ...i, workerId:value.workerId, queueContext,
                priorStateUnknown:true, queueStateUnproven:true,
                queueStateKey:queueItemStateKey(i,value.workerId,value.queueId) }
              : i.processSnapshot || { ...i, workerId:value.workerId, queueContext, queueSlotOnly:true };
          });
      for (const p of candidates) {
        if (!p || missionOwnershipKey(p) !== key) continue;
        if (p.queueSlotOnly && p.workerId === process.workerId &&
            p.queueContext?.queueId === process.queueContext?.queueId &&
            p.queueContext?.itemId === process.queueContext?.itemId) continue;
        if (owner?.supersededProcesses?.some(g => g.workerId === p.workerId && g.processId === p.processId)) continue;
        if (record.health === 'RECOVERY_REQUIRED') damaged = true;
        if (p.workerId === process.workerId && p.processId === process.processId) continue;
        // A later healthy process row cannot erase a separately quarantined
        // slot whose prior effect is still unknown.
        if (p.queueStateUnproven) unprovenQueueStates.push(p);
        else {
          // One worker may retain several queue-slot snapshots for the same
          // logical GFW. Deduplicate the same process across queue/process
          // records, but never collapse distinct process generations by
          // workerId: an older unresolved send must survive a newer healthy row.
          const identity = `${p.workerId || ''}:${p.processId || p.queueStateKey || 'unknown'}`;
          byProcess.set(identity,p);
        }
      }
    }
  }
  const others = [...byProcess.values(), ...unprovenQueueStates];
  // Crash window: ownership was claimed, but the new process/queue may not
  // have been durably published. Preserve a no-replay recovery source.
  const ownerDurable = others.some(p => p.workerId === owner?.workerId && p.processId === owner?.processId);
  const ownerClaimAgeMs = Math.max(0, Date.now() - Number(owner?.claimedAtMs || 0));
  const ownerPublicationPending = Boolean(owner && !ownerDurable && owner.claimedAtMs && ownerClaimAgeMs < 15000 &&
    !(owner.workerId === process.workerId && owner.processId === process.processId));
  const archivedSource = state.archivedUnresolved?.[key] ||
    (!ownerDurable ? state.archivedEffectQuarantine?.[key] : null);
  // Re-evaluate exact process liveness inside the mission fence. Modern callers
  // provide {workerId,processId}; legacy adapters may still provide worker-id
  // strings, which retain their conservative prior semantics.
  const liveRows = typeof liveWorkerIds === 'function' ? await liveWorkerIds() : liveWorkerIds;
  const isLiveOtherProcess = candidate => {
    if (!candidate?.workerId || (candidate.workerId === process.workerId &&
        candidate.processId === process.processId)) return false;
    return (liveRows || []).some(row => {
      if (typeof row === 'string') return row === candidate.workerId && candidate.workerId !== process.workerId;
      return row?.workerId === candidate.workerId && row?.processId === candidate.processId;
    });
  };
  const priorOwners = [...(owner ? [{workerId:owner.workerId,processId:owner.processId}] : []), ...others];
  const liveConflicts = [...new Set(priorOwners.filter(isLiveOtherProcess).map(p=>p.workerId))];
  const quarantineSource = await priorEffectQuarantineSource(others, owner);
  let code = 'MISSION_OWNER_AVAILABLE';
  if (damaged) code = 'MISSION_PRIOR_CHECKPOINT_UNRECONCILED';
  else if (ownerPublicationPending) code = 'MISSION_OWNER_CLAIM_IN_PROGRESS';
  else if (unprovenQueueStates.length) code = 'MISSION_QUEUE_STATE_UNPROVEN';
  else if (owner?.supersededProcesses?.some(g => g.workerId === process.workerId && g.processId === process.processId))
    code = 'MISSION_OWNERSHIP_SUPERSEDED';
  else if (owner && owner.workerId !== process.workerId && !allowTakeover) code = 'MISSION_OWNED_BY_OTHER_WORKER';
  else if (archivedSource && archivedEffectRecoveryEligible(process, archivedSource)) code = 'MISSION_ARCHIVED_EFFECT_QUARANTINED';
  else if (quarantineSource && archivedEffectRecoveryEligible(process, quarantineSource)) code = 'MISSION_PRIOR_EFFECT_QUARANTINED';
  else if (quarantineSource) code = 'MISSION_PRIOR_EFFECT_QUARANTINE_REQUIRED';
  else if (archivedSource) code = 'MISSION_ARCHIVED_RECOVERY_REQUIRED';
  const fingerprint = await sha256Hex(canonicalJson({key,owner:owner || null,others,archivedUnresolved:archivedSource || null,target:targetIdentity(process)}));
  return { key, owner, others, liveConflicts, code, fingerprint, archivedSource,
    quarantineSource, ownerPublicationPending, resolution:null,
    // Worker collisions and unknown prior effects are never admission gates.
    // They are handled by a fresh no-replay quarantine prompt and fenced takeover.
    allowed:code === 'MISSION_OWNER_AVAILABLE' || code === 'MISSION_PRIOR_EFFECT_QUARANTINED' ||
      code === 'MISSION_ARCHIVED_EFFECT_QUARANTINED',
    operatorCanReconcile:false };
}
// Read-only preflight: unresolved prior generations are converted into a
// compact quarantine source before the fresh prompt is composed. The final
// claim rechecks the same source under the durable mission fence.
export async function findDormantMissionRecoverySource(process, {storage,liveWorkerIds=[]}={}) {
  return storageLock(storage, lockKey(process), async()=> {
    const row = await inspect(process,{storage,liveWorkerIds},await readMissionOwnership(storage));
    if (row.code === 'MISSION_ARCHIVED_EFFECT_QUARANTINED') return row.archivedSource;
    return ['MISSION_PRIOR_EFFECT_QUARANTINED','MISSION_PRIOR_EFFECT_QUARANTINE_REQUIRED'].includes(row.code)
      ? row.quarantineSource : null;
  });
}
export async function inspectMissionOwnership(process, options) {
  return storageLock(options.storage, lockKey(process), async()=> {
    const row = await inspect(process, options, await readMissionOwnership(options.storage));
    return { missionKey:row.key, itemId:process.queueContext?.itemId || '', fingerprint:row.fingerprint,
      code:row.code, allowed:row.allowed, operatorCanReconcile:false,
      ownerWorkerId:row.owner?.workerId || '', liveWorkerIds:row.liveConflicts,
      resolutionRecorded:false, quarantineSourceCount:Number(row.quarantineSource?.unresolvedSourceCount || 0),
      sources:row.others.map(p=>({workerId:p.workerId,processId:p.processId || '',phase:p.phase || '',
        conversationUrl:p.lastManagedUrl || '',effectsSettled:missionEffectsSettled(p)})) };
  });
}
export async function recordMissionReconciliation() {
  throw new Error('MANUAL_WORKER_RECONCILIATION_REMOVED_AUTOMATIC_TAKEOVER');
}

// Claims are durable generation fences, not worker-wide locks. A fresh
// process may take over automatically; uncertain prior effects are quarantined
// and never replayed. Queue-state corruption remains isolated to that slot.
export async function claimMissionOwnership(process, { storage, liveWorkerIds = [], allowTakeover = false, now = Date.now() } = {}) {
  const key = missionOwnershipKey(process);
  if (!key) return { allowed:true,code:'MISSION_ID_NOT_APPLICABLE' };
  return storageLock(storage,lockKey(process),()=>storageLock(storage,`${MISSION_OWNERSHIP_KEY}:registry`,async()=>{
    const state = await readMissionOwnership(storage), owner = state.owners[key];
    if (owner?.workerId === process.workerId && owner.processId === process.processId)
      return {allowed:true,code:'MISSION_OWNER_CURRENT',owner};
    const row = await inspect(process,{storage,liveWorkerIds,allowTakeover},state);
    if (!row.allowed) return {allowed:false,code:row.code,owner:owner || null};
    const supersededGenerationMap = new Map();
    for (const generation of [...(owner?.supersededProcesses || []),
      ...(owner?.workerId && owner?.processId ? [{workerId:owner.workerId,processId:owner.processId}] : []),
      ...row.others.filter(p=>p.workerId && p.processId).map(p=>({workerId:p.workerId,processId:p.processId}))]) {
      if (generation?.workerId && generation?.processId)
        supersededGenerationMap.set(`${generation.workerId}\0${generation.processId}`,{
          workerId:generation.workerId,processId:generation.processId});
    }
    const supersededQueueSlotMap = new Map();
    for (const slot of owner?.supersededQueueSlots || []) {
      if (slot?.workerId && slot?.queueId && slot?.itemId)
        supersededQueueSlotMap.set(`${slot.workerId}\0${slot.queueId}\0${slot.itemId}`,slot);
    }
    for (const prior of row.others) {
      const slot = prior.queueContext;
      if (!slot?.workerId || !slot?.queueId || !slot?.itemId) continue;
      const isCurrentSlot = slot.workerId === process.workerId && slot.queueId === process.queueContext?.queueId &&
        slot.itemId === process.queueContext?.itemId;
      if (!isCurrentSlot) supersededQueueSlotMap.set(`${slot.workerId}\0${slot.queueId}\0${slot.itemId}`,{
        workerId:slot.workerId,queueId:slot.queueId,itemId:slot.itemId,savedMissionId:slot.savedMissionId || ''});
    }
    const next = { workerId:process.workerId,processId:process.processId,processFence:true,
      epoch:Number(owner?.epoch || 0)+1,claimedAtMs:now,priorWorkerId:owner?.workerId || '',
      reconciledQueueStates:[...new Set([...(owner?.reconciledQueueStates || []),
        ...(row.resolution ? row.others.filter(p=>p.queueStateUnproven).map(p=>p.queueStateKey) : [])])].slice(-128),
      supersededProcesses:[...supersededGenerationMap.values()].slice(-128),
      supersededQueueSlots:[...supersededQueueSlotMap.values()].slice(-128),
      queueId:String(process.queueContext?.queueId || ''),itemId:String(process.queueContext?.itemId || ''),
      savedMissionId:String(process.queueContext?.savedMissionId || ''),
      // Legacy worker IDs remain audit metadata only; they are no longer a fencing key.
      supersededWorkerIds:[...new Set([...(owner?.supersededWorkerIds || []),...(owner?[owner.workerId]:[]),...row.others.map(p=>p.workerId)])].filter(Boolean).slice(-128) };
    const resolutions = {...state.resolutions}; delete resolutions[key];
    const archivedSource = row.code === 'MISSION_ARCHIVED_EFFECT_QUARANTINED' ? row.archivedSource :
      row.code === 'MISSION_PRIOR_EFFECT_QUARANTINED' ? row.quarantineSource : null;
    const archivedEffectQuarantine = archivedSource
      ? recordQuarantinedEffect(state.archivedEffectQuarantine,key,archivedSource,process,now)
      : state.archivedEffectQuarantine || {};
    const archivedUnresolved = {...state.archivedUnresolved}; delete archivedUnresolved[key];
    const history = [...(state.history || []),{missionKey:key,fromWorkerId:owner?.workerId || '',
      toWorkerId:process.workerId,epoch:next.epoch,atMs:now,sourceFingerprint:row.fingerprint,
      reconciliation:row.resolution || null,archivedEffectQuarantined:Boolean(archivedSource)}].slice(-80);
    await writeCheckpoint(MISSION_OWNERSHIP_KEY,{...state,owners:{...state.owners,[key]:next},resolutions,archivedUnresolved,archivedEffectQuarantine,history},storage);
    return {allowed:true,code:archivedSource ? row.code :
      owner || row.others.length ? 'MISSION_OWNER_TRANSFERRED' : 'MISSION_OWNER_CLAIMED',owner:next,
      archivedRecovery:Boolean(archivedSource), priorLiveWorkerIds:row.liveConflicts || []};
  }));
}
export function fenceSupersededQueue(queue, ownership) {
  const items = queue.items.map(item => {
    const owner = ownership?.owners?.[missionOwnershipKey(item)];
    const snapshot = item.processSnapshot || {};
    const processId = String(snapshot.processId || item.processId || '');
    const processWorkerId = String(snapshot.workerId || queue.workerId || '');
    const sameAsCurrentOwnerSlot = owner?.workerId === queue.workerId && owner?.queueId === queue.queueId &&
      owner?.itemId === item.itemId && owner?.savedMissionId === (item.savedMissionId || '');
    const supersededProcess = Boolean(processId && owner?.supersededProcesses?.some(g =>
      g.workerId === processWorkerId && g.processId === processId));
    const supersededSlot = Boolean(owner?.supersededQueueSlots?.some(g =>
      g.workerId === queue.workerId && g.queueId === queue.queueId && g.itemId === item.itemId &&
      (!g.savedMissionId || g.savedMissionId === (item.savedMissionId || ''))));
    if (sameAsCurrentOwnerSlot || (!supersededProcess && !supersededSlot)) return item;
    return {...item,status:'STOPPED',lastOutcome:'MISSION_OWNERSHIP_TRANSFERRED',
      resume:{...item.resume,supersededByWorkerId:owner.workerId,ownershipEpoch:owner.epoch}};
  });
  return {...queue,items,activeItemId:items.some(i=>i.itemId===queue.activeItemId && i.status==='ACTIVE')?queue.activeItemId:''};
}
