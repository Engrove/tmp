import { sha256Hex } from "./common.mjs";
import { jsonEqual } from "./canonical-json.mjs";
import { validateA2AEnvelope } from "./a2a.mjs";
import { expectedInitializationAck, legacyToolForbiddenInitialization, isInitializationPrompt } from "./session-transport.mjs";

// Narrow migration of the known pre-1.9.28 no-tools bootstrap defect. Missing
// ACK alone is never retry authority. No model prose is used as effect proof.
export async function legacyInitializationRecoveryCandidate(queue, item) {
  const p = item?.processSnapshot, init = p?.sessionInitialization, work = init?.workPrompt;
  if (!queue?.enabled || queue.activeItemId || item?.status !== "BLOCKED" ||
      item.lastOutcome !== "SESSION_INITIALIZATION_ACK_EXHAUSTED" || item.resume?.initializationRepair ||
      p?.phase !== "BLOCKED" || p.lastError?.code !== "SESSION_INITIALIZATION_ACK_EXHAUSTED" ||
      p.workerId !== queue.workerId || p.windowId !== queue.windowId ||
      p.queueContext?.workerId !== queue.workerId || p.queueContext.queueId !== queue.queueId ||
      p.queueContext.itemId !== item.itemId || !item.savedMissionId || p.queueContext.savedMissionId !== item.savedMissionId ||
      p.goal !== item.goal || p.pendingPrompt || p.storageRecoveryRequired || p.safety?.hold || p.safety?.qualityIncident ||
      p.greenfieldControl?.hardStop || p.missionPause || p.ownerWait?.state === "WAIT" ||
      p.lastDecision?.humanAuthorityRequired || init?.status !== "AWAITING_ACK" || init.sessionSeq !== p.sessionSeq ||
      init.bootstrapContract === "FULL_READ_ONLY_V1" || init.bootstrapRepair === true ||
      !legacyToolForbiddenInitialization(p) || !expectedInitializationAck(p) ||
      !isInitializationPrompt(p.lastPrompt) || p.lastPrompt.acknowledged !== true ||
      !p.lastPrompt.dispatchedUserTurnId || !init.ackWait?.responseHash ||
      !work?.text || !work.hash || work.dispatch || work.sendAttempts !== 0) return false;
  let envelope, prompt;
  try { envelope = JSON.parse(work.text); prompt = JSON.parse(p.lastPrompt.text); } catch { return false; }
  if (await sha256Hex(work.text) !== work.hash || await sha256Hex(p.lastPrompt.text) !== p.lastPrompt.hash ||
      !jsonEqual(envelope, work.a2a) || !jsonEqual(prompt, p.lastPrompt.a2a) || !validateA2AEnvelope(envelope).ok ||
      envelope.promptProfile?.profile !== "FULL" || envelope.mission !== p.goal ||
      envelope.process.processId !== p.processId || envelope.process.runId !== p.runId ||
      envelope.process.turn !== p.turn || envelope.process.sessionSeq !== p.sessionSeq) return false;
  const target = envelope.control?.runtimeControl?.target;
  if (!target || target.queueId !== queue.queueId || target.itemId !== item.itemId ||
      target.savedMissionId !== item.savedMissionId || target.runId !== p.runId || target.turn !== p.turn) return false;
  if (init.ackRepair?.sourcePrompt) {
    const source = init.ackRepair.sourcePrompt;
    if (!source.text || await sha256Hex(source.text) !== source.hash ||
        source.acknowledged !== true || !source.dispatchedUserTurnId) return false;
    try { if (!jsonEqual(JSON.parse(source.text), source.a2a)) return false; } catch { return false; }
  }
  // The completed, stable missing-ACK observation must belong to this exact
  // handshake. A disappeared tab, elapsed TTL or old work response is not it.
  return (p.responseObservationTrace || []).some(row => {
    const d = row.detail || {};
    return row.reason === "SESSION_INITIALIZATION_ACK_HASH_MISSING" && row.turn === p.turn &&
      row.promptHash === p.lastPrompt.hash.slice(0, 16) &&
      d.ownerTrusted === true && d.resolvedBy === "USER_TURN_ID" &&
      d.expectedUserTurnId === p.lastPrompt.dispatchedUserTurnId && d.resolvedUserTurnId === d.expectedUserTurnId &&
      d.assistantId === init.ackWait.messageId && d.documentId === init.ackWait.documentId &&
      d.assistantHash === init.ackWait.responseHash.slice(0, 12);
  });
}
