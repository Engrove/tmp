import { conversationKey } from './restart-recovery.mjs';
export const SESSION_BROKER_MAX_QUANTA = 3;
export const SESSION_BROKER_MAX_PROMPTS = 6;
// Counts belong to a proven conversation, not process.turn or queue activation.
// Operative dispatches count once; initialization and transport continuation do not.
export function completeBrokerTurn(process, { quantumCompleted = false } = {}) {
  const key = conversationKey(process.lastResponse?.observation?.conversationKey || process.lastManagedUrl || '');
  const old = process.sessionBroker;
  const same = old?.conversationKey === key && Number(old.sessionSeq) === Number(process.sessionSeq);
  const profileCount = Math.max(1,Number(process.lastPrompt?.promptProfile?.ordinal || 1));
  const id = `${process.runId}:${process.turn}:${process.lastPrompt?.hash || ''}`;
  const state = same ? {...old} : {schema:'eic.greenfield.session-broker.v1',conversationKey:key,
    sessionSeq:process.sessionSeq,completedQuanta:0,operativePrompts:profileCount,lastTurnId:'',lastQuantumTurnId:''};
  if (state.lastTurnId !== id) {
    state.operativePrompts = same ? Math.max(profileCount,Number(state.operativePrompts || 0)+1) : profileCount;
    state.lastTurnId = id;
  }
  if (quantumCompleted && state.lastQuantumTurnId !== id) {
    state.completedQuanta = Number(state.completedQuanta || 0)+1; state.lastQuantumTurnId = id;
  }
  return state;
}
export function sessionBrokerLimit(state) {
  if (Number(state?.completedQuanta || 0) >= SESSION_BROKER_MAX_QUANTA) return 'SESSION_QUANTUM_CEILING';
  if (Number(state?.operativePrompts || 0) >= SESSION_BROKER_MAX_PROMPTS) return 'SESSION_PROMPT_CEILING';
  return '';
}
