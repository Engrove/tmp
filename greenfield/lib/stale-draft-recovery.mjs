import { sha256Hex } from './common.mjs';
import { readCheckpoint, writeCheckpoint } from './durable-checkpoint.mjs';
import { conversationKey } from './restart-recovery.mjs';

export const DRAFT_ARCHIVE_PREFIX = 'eic.gf.unsent-draft-archive.v1.';

// Keep the archive namespace for upgrade compatibility. The kind distinguishes
// an unsent draft from an already acknowledged, completed initialization.
const hashValid = value => /^[a-f0-9]{64}$/.test(value || '');

async function settledInitializationSource(source, target, hash) {
  const init = source?.sessionInitialization, receipt = init?.receipt;
  const ack = init?.acknowledgement, binding = ack?.binding;
  // The challenge was created in this field order. Storage key ordering is
  // not identity; verify the original binding rather than its readback order.
  const originalBinding = { initializationId: init?.initializationId, processId: source?.processId,
    workerId: source?.workerId, runId: source?.runId, sessionSeq: init?.sessionSeq,
    queueId: binding?.queueId, itemId: binding?.itemId, savedMissionId: binding?.savedMissionId,
    workPromptHash: binding?.workPromptHash };
  if (!hashValid(hash) || !source?.workerId || !source.processId || !source.runId ||
      !Number.isInteger(source.tabId) || source.storageRecoveryRequired || source.priorStateUnknown ||
      !source.gptRoot || source.gptRoot !== target?.gptRoot || init?.status !== 'READY' ||
      !Number.isSafeInteger(init.sessionSeq) || !Number.isSafeInteger(source.sessionSeq) || init.sessionSeq < 1 || init.sessionSeq > source.sessionSeq ||
      source.processId === target?.processId && init.sessionSeq >= target.sessionSeq ||
      !Date.parse(init.completedAt || '') || !init.response?.messageId || !hashValid(init.response.hash) ||
      receipt?.hash !== hash || typeof receipt.text !== 'string' || !receipt.text ||
      receipt.transportKind !== 'SESSION_INITIALIZATION' || receipt.transportId !== init.initializationId ||
      receipt.a2a?.messageType !== 'SESSION_INITIALIZATION' || receipt.a2a.messageId !== init.initializationId ||
      receipt.acknowledged !== true || !receipt.dispatchId || !receipt.dispatchedUserTurnId ||
      !(receipt.postedAtMs > 0) || receipt.postedAtMs > Date.parse(init.completedAt) ||
      !conversationKey(init.conversationKey) ||
      // Root-page sends precede thread allocation. Older READY checkpoints
      // retain an empty send-time route; completion binds the conversation.
      // An explicitly conflicting receipt is still rejected.
      (receipt.conversationKey && conversationKey(receipt.conversationKey) !== conversationKey(init.conversationKey)) ||
      ack?.schema !== 'eic.greenfield.initialization-ack.v1' || !hashValid(ack.hash) ||
      binding?.initializationId !== init.initializationId || binding.processId !== source.processId ||
      binding.workerId !== source.workerId || binding.runId !== source.runId || binding.sessionSeq !== init.sessionSeq ||
      !hashValid(binding.workPromptHash) || !receipt.text.includes(ack.hash) ||
      await sha256Hex(JSON.stringify(originalBinding)) !== ack.hash || await sha256Hex(receipt.text) !== hash) return null;
  let parsed;
  try { parsed = JSON.parse(receipt.text); } catch { return null; }
  if (parsed.messageId !== init.initializationId || parsed.messageType !== 'SESSION_INITIALIZATION' ||
      parsed.instruction !== receipt.a2a.instruction) return null;
  return { kind: 'SETTLED_INITIALIZATION', sourceWorkerId: source.workerId, sourceProcessId: source.processId,
    sourceTabId: source.tabId, dispatchId: receipt.dispatchId, initializationId: init.initializationId,
    userTurnId: receipt.dispatchedUserTurnId, responseId: init.response.messageId, hash, text: receipt.text };
}

// Exact bytes alone are insufficient: the durable receipt must establish
// either no send effect, or an acknowledged initialization that already ended.
export async function staleDraftSource(source, target, hash) {
  for (const prompt of [target?.pendingPrompt, target?.lastPrompt, target?.lastResponse].filter(Boolean)) {
    if (!prompt.text || !hashValid(prompt.hash) || await sha256Hex(prompt.text) !== prompt.hash) return null;
  }
  const settled = await settledInitializationSource(source, target, hash);
  if (settled) return settled;
  const pending = source?.pendingPrompt, dispatch = pending?.dispatch;
  if (!/^[a-f0-9]{64}$/.test(hash || '') || !source?.workerId || !source.processId ||
      source.processId === target?.processId || !Number.isInteger(source.tabId) || !['DETACHED', 'STOPPED'].includes(source.phase) ||
      source.storageRecoveryRequired || source.priorStateUnknown || source.lastPrompt || source.lastResponse ||
      !source.gptRoot || source.gptRoot !== target?.gptRoot ||
      pending?.hash !== hash || typeof pending.text !== 'string' || !pending.text ||
      !(pending.sendAttempts > 0) || pending.transportKind !== 'SESSION_INITIALIZATION' ||
      pending.a2a?.messageType !== 'SESSION_INITIALIZATION' ||
      !pending.transportId || pending.transportId !== pending.a2a.messageId ||
      source.sessionInitialization?.status !== 'PENDING' ||
      source.sessionInitialization.initializationId !== pending.transportId ||
      !dispatch?.operationId || dispatch.status !== 'NO_EFFECT_CONFIRMED' ||
      dispatch.effectPossible !== false || dispatch.acknowledged !== false ||
      dispatch.postedAtMs || dispatch.method ||
      await sha256Hex(pending.text) !== hash) return null;
  return { sourceWorkerId: source.workerId, sourceProcessId: source.processId,
    sourceTabId: source.tabId, dispatchId: dispatch.operationId, hash, text: pending.text };
}

function completedRotationHistory(process) {
  const prompt = process.lastPrompt, response = process.lastResponse, observation = response?.observation;
  if (!prompt && !response && !process.sessionInitialization) return true;
  return ['COMPLETED_RESPONSE_CAPTURED', 'COMPLETED_RESPONSE_CHECKPOINTED'].includes(process.sessionRotation?.sourceResponseState) &&
    prompt?.acknowledged === true && Boolean(prompt.dispatchedUserTurnId) && Boolean(prompt.text) && hashValid(prompt.hash) &&
    response?.contract?.ok === true && Boolean(response.text) && hashValid(response.hash) && Boolean(response.messageId) &&
    observation?.ownerTrusted === true && observation.causalMatch === true && !observation.externalInterleave?.observed &&
    observation.messageId === response.messageId && observation.pairedUserTurnId === prompt.dispatchedUserTurnId &&
    observation.expectedUserTurnId === prompt.dispatchedUserTurnId && Boolean(conversationKey(prompt.conversationKey)) &&
    observation.conversationKey === conversationKey(prompt.conversationKey) &&
    (!process.sessionInitialization || process.sessionInitialization.status === 'READY' &&
      process.sessionInitialization.sessionSeq < process.sessionSeq);
}

export function draftRecoveryTarget(process, page) {
  const rotation = process?.sessionRotation;
  return process?.phase === 'ROTATING' && rotation?.state === 'NAVIGATING' &&
    rotation.queueSwitch === true && rotation.targetTabId === process.tabId &&
    !rotation.warmResume?.warm &&
    (!rotation.hardReloadBeforeResume || ['COMPLETED', 'DISABLED'].includes(rotation.hardReloadState)) &&
    !process.storageRecoveryRequired && !process.priorStateUnknown && !process.safety?.qualityIncident && !process.safety?.hold &&
    !process.greenfieldControl?.hardStop && !process.missionPause &&
    !process.ownerWait && !process.lastDecision?.humanAuthorityRequired && completedRotationHistory(process) &&
    process.pendingPrompt?.sendAttempts === 0 && !process.pendingPrompt.dispatch &&
    page?.userCount === 0 && page.generating === false && page.composerReady === true &&
    page.composerEmpty === false && Boolean(page.documentId) && page.url === process.gptRoot &&
    !page.rateLimitWarning?.active && !page.providerNotices?.processingNotice &&
    !page.providerNotices?.connectionInterrupted && !page.providerNotices?.conversationUnavailable;
}

export async function archiveUnsentDraft(candidate, storage) {
  const key = DRAFT_ARCHIVE_PREFIX + candidate.hash;
  const existing = await readCheckpoint(key, storage);
  if (existing.health === 'RECOVERY_REQUIRED') throw new Error('DRAFT_ARCHIVE_RECOVERY_REQUIRED');
  if (!existing.value) await writeCheckpoint(key, {
    schema: candidate.kind === 'SETTLED_INITIALIZATION' ? 'eic.greenfield.settled-draft-archive.v1' : 'eic.greenfield.unsent-draft-archive.v1', archivedAt: new Date().toISOString(),
    ...candidate, automaticReplay: false
  }, storage);
  const saved = await readCheckpoint(key, storage);
  if (saved.health === 'RECOVERY_REQUIRED' || saved.value?.text !== candidate.text ||
      saved.value?.hash !== candidate.hash || await sha256Hex(saved.value.text) !== candidate.hash)
    throw new Error('DRAFT_ARCHIVE_READBACK_FAILED');
  return key;
}
