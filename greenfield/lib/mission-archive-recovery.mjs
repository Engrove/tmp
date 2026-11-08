// v1.9.33: An archived response gap is a quarantined prior turn, not a
// permanent block on independent, fresh owner-state work. NEVER replay the
// archived turn, an old session's continuation or its pending prompt.
import { missionOwnershipKey } from './mission-history.mjs';

const MAX_QUARANTINE_RECORDS = 64;
export { MAX_QUARANTINE_RECORDS };

function sourceId(source) {
  return {
    sourceWorkerId: String(source?.sourceWorkerId || ''),
    sourceProcessId: String(source?.sourceProcessId || ''),
    promptHash: String(source?.promptHash || ''),
    recordedAtMs: Number(source?.recordedAtMs || 0),
    unresolvedSourceCount: Math.max(0, Number(source?.unresolvedSourceCount || 0)),
    sourceSetHash: String(source?.sourceSetHash || ''),
    priorPromptHashes: [...new Set((Array.isArray(source?.priorPromptHashes) ? source.priorPromptHashes : []).map(String).filter(Boolean))]
  };
}

export function prepareArchivedEffectRestart(item, source) {
  const src = sourceId(source);
  const objective = [
    'ARCHIVED_EFFECT_QUARANTINE: Recover this GFW from FRESH EIC owner state.',
    'A previous session generation may still be running or may have an unverified response/effect.',
    'The new session owns this logical GFW from this point forward. Do not wait for, request, or require',
    'operator acknowledgement of the previous worker. Do not resend its prompt, repeat its actions,',
    'infer that it succeeded, or report it as completed. Read current project, repository, and effect-owner',
    'state first. Reconcile external side effects from current owner evidence before any potentially duplicate',
    'write. Continue all independent authorized work immediately; only the exact action whose effect cannot',
    'be safely determined may be deferred. The old worker is fenced and its history remains preserved.',
    `Prior source count: ${src.unresolvedSourceCount}; prior process reference: ${src.sourceProcessId || 'unknown'}; source-set hash: ${src.sourceSetHash || src.promptHash || 'unknown'}.`
  ].join(' ');
  return {
    ...item,
    processSnapshot: null,
    quantumProgress: 0,
    resume: {
      ...(item.resume || {}),
      objective,
      previousResponseHash: '',
      previousDisposition: 'ARCHIVED_EFFECT_UNVERIFIED',
      analysisEvidence: null,
      ownerWait: null,
      sourceResponseState: 'ARCHIVED_EFFECT_QUARANTINED_NO_REPLAY'
    }
  };
}

export function archivedEffectRecoveryReceipt(source, process) {
  const src = sourceId(source);
  return {
    schema: 'eic.greenfield.archived-effect-recovery.v1',
    ...src,
    newProcessId: String(process?.processId || ''),
    newWorkerId: String(process?.workerId || ''),
    outcome: 'UNVERIFIED_OLD_EFFECT_NOT_REPLAYED',
    ownerRereadRequired: true
  };
}

export function archivedEffectRecoveryEligible(process, source) {
  const marker = process?.archivedEffectRecovery;
  if (!source || !marker || marker.schema !== 'eic.greenfield.archived-effect-recovery.v1') return false;
  const src = sourceId(source);
  if (marker.newProcessId !== process.processId || marker.newWorkerId !== process.workerId ||
      marker.sourceWorkerId !== src.sourceWorkerId || marker.sourceProcessId !== src.sourceProcessId ||
      marker.promptHash !== src.promptHash || marker.recordedAtMs !== src.recordedAtMs ||
      marker.outcome !== 'UNVERIFIED_OLD_EFFECT_NOT_REPLAYED' || !marker.ownerRereadRequired) return false;
  const pending = process.pendingPrompt;
  if (!process.queueContext?.itemId || !pending?.text || !pending.hash ||
      pending.dispatch != null || Number(pending.sendAttempts || 0) !== 0 ||
      process.lastPrompt || process.lastResponse || process.sessionRotation?.warmResume?.warm ||
      Number(process.turn) !== 1 || Number(process.queueContext.interactionCount || 0) !== 0 ||
      !String(process.objectiveState?.objective || '').startsWith('ARCHIVED_EFFECT_QUARANTINE:') ||
      !String(pending.text).includes('ARCHIVED_EFFECT_QUARANTINE:') ||
      pending.hash === src.promptHash || src.priorPromptHashes.includes(String(pending.hash))) return false;
  return true;
}

export function recordQuarantinedEffect(prior, key, source, next, now = Date.now()) {
  const latest = { ...(prior || {}) };
  // Only the most recent quarantine per mission is needed to prevent growth.
  delete latest[key];
  latest[key] = {
    ...sourceId(source),
    newWorkerId: String(next.workerId || ''),
    newProcessId: String(next.processId || ''),
    quarantinedAtMs: now,
    outcome: 'UNVERIFIED_OLD_EFFECT_NOT_REPLAYED',
    requiresOwnerReread: true
  };
  const entries = Object.entries(latest).sort((a,b) => Number(b[1].quarantinedAtMs || 0) - Number(a[1].quarantinedAtMs || 0));
  return Object.fromEntries(entries.slice(0, MAX_QUARANTINE_RECORDS));
}

// Clear obsolete v1.9.32 retry timers immediately after upgrading. This
// modifies only queue entries whose reason is an archive-only takeover. Any
// locally unsettled dispatched prompt remains protected by the caller.
export function reviveArchivedEffectBlocks(queue, archives, {
  now = Date.now(), hasPendingEffect = () => false
} = {}) {
  const revivedItemIds = [];
  const items = (queue?.items || []).map(item => {
    const code = String(item?.lastError?.code || '');
    const missionKey = missionOwnershipKey(item);
    if (item?.status !== 'BLOCKED' || !archives?.[missionKey] ||
        !['MISSION_PRIOR_EFFECT_UNRESOLVED','MISSION_ARCHIVED_RECOVERY_REQUIRED'].includes(code) ||
        hasPendingEffect(item)) return item;
    revivedItemIds.push(item.itemId);
    return {...item,status:'READY',readySinceMs:now,blockedRetryAtMs:0,
      blockedSinceMs:0,blockedCount:0,lastError:null,
      lastOutcome:'ARCHIVED_EFFECT_RETRY_MIGRATED'};
  });
  return { queue:revivedItemIds.length ? {...queue,items} : queue,revivedItemIds };
}
