import { advisoryNoDeltaPauseSeconds } from "./greenfield-control.mjs";

const HISTORY_LIMIT = 8;
const count = (value) => Math.max(0, Math.min(1_000_000, Math.floor(Number(value) || 0)));

// These are pacing observations, not a verdict that the owner made no progress.
// A changed owner-reported work/evidence capsule or a committed runtime effect
// breaks a repeat. Merely alternating already-seen handoffs does not.
export function advanceNoDeltaState({
  previous = null, responseId = "", handoffKey = "", objectiveKey = "",
  factsKey = "", materialEffect = false, blocked = false,
  operatorInstructionPending = false
} = {}) {
  const state = {
    version: 1,
    noDeltaTurns: count(previous?.noDeltaTurns),
    pauseStreak: count(previous?.pauseStreak),
    lastResponseId: String(previous?.lastResponseId || ""),
    lastFactsKey: String(previous?.lastFactsKey || ""),
    handoffHistory: [...new Set((Array.isArray(previous?.handoffHistory) ? previous.handoffHistory : [])
      .filter((key) => typeof key === "string" && key))].slice(-HISTORY_LIMIT),
    lastPause: previous?.lastPause || null
  };
  // One-shot operator input must be delivered without an advisory delay.
  if (operatorInstructionPending) {
    return { state: { ...state, lastResponseId: responseId, lastPause: null }, pause: null };
  }
  // A retried analysis/queue commit of this same turn is not a second response.
  if (responseId && responseId === state.lastResponseId) return { state, pause: state.lastPause };

  const changedFacts = Boolean(state.lastFactsKey && factsKey && factsKey !== state.lastFactsKey);
  const repeatedHandoff = !handoffKey || handoffKey === objectiveKey || state.handoffHistory.includes(handoffKey);
  const noDelta = blocked || (repeatedHandoff && !changedFacts && !materialEffect);
  const noDeltaTurns = noDelta ? count(state.noDeltaTurns + 1) : 0;
  const pauseStreak = noDelta && (blocked || noDeltaTurns >= 2)
    ? count(state.pauseStreak + 1)
    : noDelta ? state.pauseStreak : 0;
  const pause = noDelta && (blocked || noDeltaTurns >= 2)
    ? { streak: pauseStreak, pauseSeconds: advisoryNoDeltaPauseSeconds(pauseStreak), cause: blocked ? "EIC_BLOCKED" : "NO_NEW_HANDOFF_OR_FACTS" }
    : null;
  return {
    state: {
      ...state, noDeltaTurns, pauseStreak, lastResponseId: responseId,
      lastFactsKey: factsKey,
      handoffHistory: handoffKey
        ? [...state.handoffHistory.filter((key) => key !== handoffKey), handoffKey].slice(-HISTORY_LIMIT)
        : state.handoffHistory,
      lastPause: pause
    },
    pause
  };
}
