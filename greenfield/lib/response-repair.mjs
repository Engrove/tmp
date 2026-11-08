import { responseContentAdmission } from "./response-stability.mjs";
import { retainedObjectiveContext } from "./continuation-integrity.mjs";
import { normalizeSessionHealthState } from "./session-health.mjs";

export function invalidCapturedResponse(process) {
  const r = process?.lastResponse;
  return Boolean(r?.hash && typeof r.text === "string" && !responseContentAdmission(r.text).admissible);
}
function recoveryConversation(url) {
  try { const u = new URL(url);
    return u.protocol === "https:" && ["chatgpt.com", "chat.openai.com"].includes(u.hostname) &&
      /\/c\/[a-z0-9-]+(?:\/|$)/i.test(u.pathname) ? u.href : "";
  } catch { return ""; }
}

// Reopen the acknowledged turn for observation. Never replay its work prompt.
export function responseRepairCandidate(process, { queueContext = process?.queueContext, now = Date.now() } = {}) {
  if (!invalidCapturedResponse(process)) return { needed: false };
  const prompt = process.lastPrompt, response = process.lastResponse;
  const sourceTurn = Number(prompt?.a2a?.process?.turn || process.turn);
  const url = recoveryConversation(process.lastManagedUrl || response.observation?.conversationKey);
  const uncertainDispatch = process.pendingPrompt?.dispatch
    ? process.pendingPrompt.dispatch.effectPossible !== false
    : Number(process.pendingPrompt?.sendAttempts || 0) > 0;
  const paired = prompt?.dispatchedUserTurnId && response.observation?.pairedUserTurnId === prompt.dispatchedUserTurnId;
  const completed = Number(prompt?.a2a?.control?.workQueue?.completedInteractions);
  const quantumKnown = !queueContext?.itemId || Number.isSafeInteger(completed) && completed >= 0 && completed < Number(queueContext.maxInteractions);
  if (!url || !paired || prompt.acknowledged !== true || !prompt.hash || !prompt.text ||
      !Number.isSafeInteger(sourceTurn) || sourceTurn < 1 || uncertainDispatch || !quantumKnown ||
      process.pendingPrompt?.oneShotInstruction || process.pendingPrompt?.a2a?.operatorInstruction) {
    return { needed: true, recoverable: false, code: "RESPONSE_REPAIR_SOURCE_UNPROVEN" };
  }
  const health = normalizeSessionHealthState(process.sessionHealth);
  health.capturedResponseChars = Math.max(0, health.capturedResponseChars - response.text.length);
  const sample = health.samples.find(row => row.turn === sourceTurn);
  health.samples = health.samples.map(row => row.turn === sourceTurn
    ? { ...row, clean: false, responseAdmissible: false, eligibleForBaseline: false, exclusionReason: "UI_ONLY_CAPTURE" } : row);
  health.activeTurn = { promptHash: prompt.workPromptHash || prompt.hash, turn: sourceTurn, postedAtMs: Date.parse(prompt.sentAt || "") || now,
    firstResponseObservedAtMs: null, firstContentObservedAtMs: null, recoveryChurnAtPost: health.recoveryChurn,
    timingEligible: false, promptChars: sample?.promptChars || prompt.text.length, processingNotice: null, connectionInterrupted: null };
  return { needed: true, recoverable: true, patch: {
    phase: "ROTATING", turn: sourceTurn, sessionSeq: Number(prompt.a2a?.process?.sessionSeq || process.sessionSeq),
    lastResponse: null, lastDecision: null, lastNano: null, pendingPrompt: null,
    greenfieldControl: null, noDeltaState: null, sessionHealth: health, responseCandidate: null,
    responseInterleave: null, waitingRefresh: null, missionPause: null, completedAt: null,
    continuationContext: retainedObjectiveContext(process),
    objectiveState: { ...process.objectiveState, objective: prompt.a2a?.objective || process.objectiveState?.objective || process.goal,
      status: "AWAITING_REPAIRED_RESPONSE", updatedAt: new Date(now).toISOString() },
    queueContext: queueContext?.itemId ? { ...queueContext, interactionCount: completed } : queueContext,
    responseRepair: { schema: "eic.greenfield.response-repair.v1", state: "NAVIGATE", detectedAt: new Date(now).toISOString(),
      sourceUrl: url, sourcePromptHash: prompt.hash, invalidResponseHash: response.hash,
      original: { prompt, response, decision: process.lastDecision || null, nano: process.lastNano || null,
        objectiveState: process.objectiveState || null, pendingPrompt: process.pendingPrompt || null,
        queueContext: process.queueContext || null, sessionHealth: process.sessionHealth || null }, automaticResend: false },
    lastError: null
  } };
}
