import './safety-policy.js';
import { usageIdentity } from './usage-governor.mjs';
import { conversationKey } from './restart-recovery.mjs';
import { autonomousUserTurnProof } from './turn-causality.mjs';

const S = globalThis.GreenfieldSafetyPolicy;
const STRATEGIES = new Set(['SLIDER_TARGET', 'ORDINAL_TARGET', 'NAMED_TARGET',
  'SLIDER_MAXIMUM', 'ORDINAL_MAXIMUM', 'HIGHEST_AVAILABLE_OPTION']);
const COMPOSER_DOWNGRADES = new Set(['MODEL_DEGRADED', 'MODEL_VERSION_MISMATCH',
  'THINKING_EFFORT_TOO_LOW', 'CHAT_MODE_REQUIRED']);
const COMPOSER_HOLDS = new Set([...COMPOSER_DOWNGRADES, 'MODEL_EVIDENCE_MISSING',
  'MODEL_EVIDENCE_STALE', 'MODEL_IDENTITY_UNKNOWN', 'THINKING_EFFORT_UNKNOWN',
  'THINKING_MODE_UNVERIFIED', 'THINKING_TARGET_MISMATCH', 'THINKING_MAXIMUM_UNVERIFIED']);

// This is a historical receipt, NOT permission to send. Its TTL applied when
// the dispatch was authorized. Time spent generating or reloading does not
// invalidate it. A current correct composer cannot replace a missing receipt.
export function dispatchedTurnQuality(process) {
  const deny = reason => ({ allowed: false, code: 'IN_FLIGHT_MODEL_UNVERIFIED', reason });
  const prompt = process?.lastPrompt;
  if (!prompt?.hash || !process?.runId || !Number.isInteger(process.sessionSeq) ||
      !Number.isInteger(process.turn)) return deny('DISPATCH_IDENTITY_MISSING');
  const expected = usageIdentity(process, prompt);
  if (prompt.usageId !== expected) return deny('DISPATCH_USAGE_MISMATCH');
  // An invalid primary receipt must never be overridden by a different one.
  const proof = prompt.modelProof ?? process.safety?.turnProof;
  if (!proof) return deny('DISPATCH_RECEIPT_MISSING');
  if (proof.promptHash !== prompt.hash || proof.usageId !== expected ||
      proof.dispatchId && proof.dispatchId !== prompt.dispatchId) return deny('DISPATCH_RECEIPT_IDENTITY_MISMATCH');
  const highest = proof.highestEffort;
  if (proof.allowed !== true || !['UI_MODEL_VERIFIED', 'UI_MODEL_COMPATIBLE'].includes(proof.code) ||
      proof.highestEffortVerified !== true || proof.currentReceiptValid !== true ||
      proof.receiptInvalidReason || highest?.status !== 'VERIFIED' ||
      (highest.reasoningLevel ?? 'xhigh') !== (proof.reasoningLevel ?? 'xhigh') ||
      !S.matchesReasoningLevel(proof.effort, proof.reasoningLevel ?? 'xhigh') ||
      !S.matchesReasoningLevel(highest.label, proof.reasoningLevel ?? 'xhigh') ||
      !STRATEGIES.has(highest.strategy)) return deny('DISPATCH_RECEIPT_NOT_VERIFIED');
  const observed = proof.observedAtMs, verified = highest.verifiedAtMs;
  if (!Number.isFinite(observed) || observed <= 0 || !Number.isFinite(verified) || verified <= 0 ||
      observed < verified - 1000 || observed - verified > 60000 ||
      proof.receiptExpiresAtMs != null && (!Number.isFinite(proof.receiptExpiresAtMs) ||
        observed > proof.receiptExpiresAtMs)) return deny('DISPATCH_RECEIPT_WAS_STALE');
  const receiptConversation = conversationKey(highest.url || '');
  if (!highest.url || receiptConversation && receiptConversation !== conversationKey(prompt.conversationKey || ''))
    return deny('DISPATCH_RECEIPT_CONVERSATION_MISMATCH');
  return { allowed: true, code: 'DISPATCH_QUALITY_RECEIPT_VERIFIED',
    promptHash: prompt.hash, usageId: expected, dispatchId: prompt.dispatchId || '' };
}

function originalTurnObserved(process, page) {
  const prompt = process?.lastPrompt;
  const key = conversationKey(page?.url || '');
  if (!['WAITING', 'ANALYZING'].includes(process?.phase) || process.storageRecoveryRequired ||
      process.greenfieldControl?.hardStop || !prompt?.acknowledged || !prompt.dispatchId ||
      !prompt.dispatchedUserTurnId || !key || key !== conversationKey(prompt.conversationKey || '') ||
      !dispatchedTurnQuality(process).allowed) return false;
  const causal = autonomousUserTurnProof(process, page, { allowLegacyHash: false });
  return causal.ok && causal.resolvedUserTurnId === prompt.dispatchedUserTurnId;
}

// v1.9.36 latched composer-derived downgrades during partial hydration. Repair
// only that known false-positive class with the ORIGINAL dispatch and exact
// current turn. Provider fallback/unknown/direct-response incidents stay held.
export function reconcileTurnQuality(process, page, { now = Date.now() } = {}) {
  const prior = process.safety || {};
  let qualityIncident = prior.qualityIncident || null;
  let hold = prior.hold || null;
  let resolution = null;
  if (originalTurnObserved(process, page)) {
    const legacyComposerIncident = qualityIncident?.code === 'IN_FLIGHT_QUALITY_QUARANTINE' &&
      COMPOSER_DOWNGRADES.has(qualityIncident.reason) && qualityIncident.turn === process.turn &&
      (!qualityIncident.source || qualityIncident.source === 'COMPOSER');
    if (legacyComposerIncident) {
      resolution = { code: 'ORIGINAL_DISPATCH_QUALITY_RECONCILED', atMs: now,
        incidentCode: qualityIncident.code, reason: qualityIncident.reason,
        incidentAtMs: qualityIncident.atMs, turn: process.turn, sessionSeq: process.sessionSeq,
        promptHash: process.lastPrompt.hash, dispatchId: process.lastPrompt.dispatchId,
        userTurnId: process.lastPrompt.dispatchedUserTurnId,
        conversationKey: conversationKey(page.url), documentId: String(page.documentId || '').slice(0,120) };
      if (hold?.code === qualityIncident.code) hold = null;
      qualityIncident = null;
    }
    if (!qualityIncident && COMPOSER_HOLDS.has(hold?.code)) hold = null;
  }
  return { qualityIncident, hold, resolution,
    qualityResolutions: resolution ? [...(Array.isArray(prior.qualityResolutions) ? prior.qualityResolutions : []), resolution].slice(-8)
      : prior.qualityResolutions || [] };
}
