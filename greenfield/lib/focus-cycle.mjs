// v1.9.31: focus is prompt guidance, not a second mission planner or a gate.
// Only the existing session broker decides when to rotate a completed chat.
// A previous EIC nextSuggestedAction is never the owner of the next mission step.
export const FOCUS_CYCLE_SCHEMA = "eic.greenfield.focus-cycle.v1";
export const FOCUS_CYCLE_OPERATIVE_PROMPTS = 6;
export const FOCUS_CYCLE_PHASES = Object.freeze([
  "START", "PRODUCE", "PRODUCE", "REANCHOR", "COMPLETE_STEP", "CHECKPOINT_ROTATE"
]);
const FOCUS_INSTRUCTIONS = Object.freeze([
  "Read the canonical mission owner and its current, dependency-ready step. Identify this session's specific testable deliverable. Do one bounded useful slice; a technical side issue gets only its smallest necessary fix. Do not create a new mission.",
  "Produce the next bounded result for the current owner step. Prefer a concrete change and required test over speculative investigation. Record only actual evidence.",
  "Continue the same owner step with one bounded, verifiable result. If the prior approach yielded no verified progress, change the method instead of extending the investigation.",
  "Re-anchor to the canonical mission and open owner obligations. Park unrelated work; select one bounded owner-supported slice. If two consecutive interactions genuinely lacked verified progress, reassess the method; unavailable owner evidence is UNKNOWN, not proof of no progress. Do not let the previous AI's suggested next step become an independent mission.",
  "Converge on the current bounded step's required tests, correction and verifiable evidence. Open no optional cleanup, infrastructure work or new subproject. Keep mandatory incomplete work visible; do not invent PASS.",
  "Perform one bounded useful slice and checkpoint its owner-verifiable outcome. Record the current owner step, proof locators, unresolved effects and next executable owner action; report unknowns honestly. Greenfield rotates this chat after the completed response, not the logical mission. Do not request a second handoff solely for rotation."
]);
const truncate = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
// The owner adapter validates the signed-in endpoint response at read time.
// Recheck that this *cached* receipt still names this exact mission, issued
// prompt and queue slot before displaying it as fresh in another session.
// In a rotation virtual process.turn has already advanced, but lastPrompt
// still identifies the precise source turn that the owner receipt attests.
function verifiedOwnerReceipt(process, now) {
  const receipt = process?.ownerProgressResult?.ok === true
    ? process.ownerProgressResult.receipt : null;
  if (!receipt || receipt.schema !== 'eic.greenfield.owner-progress.v1' ||
      receipt.root?.frozen !== true || !receipt.root.ref || !receipt.root.revision ||
      !Number.isSafeInteger(receipt.observedAtMs) ||
      !Number.isSafeInteger(receipt.expiresAtMs) ||
      receipt.observedAtMs > now + 5000 || now - receipt.observedAtMs > 120000 ||
      receipt.expiresAtMs <= now || receipt.expiresAtMs - receipt.observedAtMs > 120000) return null;

  const currentMission = String(process?.goal || '').match(/\bGF-\d+\.\d+\.\d+\b/)?.[0] || '';
  const source = process?.lastPrompt;
  const sentTurn = source?.a2a?.process?.turn;
  const expectedTurn = Number.isSafeInteger(sentTurn) ? sentTurn : Number(process?.turn || 0);
  const queue = process?.queueContext?.itemId ? process.queueContext : null;
  const expectedTarget = {
    runId: String(process?.runId || ''), turn: expectedTurn,
    queueId: String(queue?.queueId || ''), itemId: String(queue?.itemId || ''),
    savedMissionId: String(queue?.savedMissionId || '')
  };
  if (receipt.missionRef !== currentMission ||
      receipt.promptHash !== source?.hash ||
      receipt.responseHash !== process?.lastResponse?.hash ||
      Object.entries(expectedTarget).some(([key, value]) => receipt.target?.[key] !== value) ||
      (process?.ownerProgress?.root?.ref && process.ownerProgress.root.ref !== receipt.root.ref)) return null;
  return receipt;
}

// A compact, provenance-conscious snapshot; no assertion of completed work is
// reconstructed from an AI response, a controller summary or current_focus.
export function missionFocusCapsule(process, now = Date.now()) {
  const receipt = verifiedOwnerReceipt(process, now);
  // An old authenticated root is not proof of the active mission after edits,
  // queue activation or process recovery. Only a source-bound fresh receipt
  // may populate the handoff capsule; otherwise instruct a canonical reread.
  const root = receipt?.root || null;
  const next = receipt?.disposition === "NEXT" ? receipt.next : null;
  const missionRef = String(process?.goal || "").match(/\bGF-\d+\.\d+\.\d+\b/)?.[0] || "";
  return {
    missionRef,
    savedMissionId: String(process?.queueContext?.savedMissionId || ""),
    ownerRootRef: truncate(root?.ref, 180),
    ownerRootRevision: truncate(root?.revision, 180),
    ownerStateRevision: truncate(receipt?.stateRevision, 180),
    ownerSnapshot: receipt ? "FRESH_VERIFIED_READBACK_AT_PROMPT_CREATION" : "NOT_CURRENTLY_VERIFIED",
    ownerStep: next ? {
      actionId: truncate(next.actionId, 180),
      obligationRef: truncate(next.obligationRef, 180),
      objective: truncate(next.objective, 700),
      effectKey: truncate(next.idempotencyKey, 180),
      authority: "REVALIDATE_OWNER_BEFORE_EFFECT"
    } : null,
    completedEvidence: "READ_FROM_CANONICAL_OWNER; NOT_INFERRED_FROM_PREVIOUS_AI_TEXT",
    nextActionAuthority: "CANONICAL_OWNER_ONLY; PRIOR_NEXT_SUGGESTED_ACTION_IS_ADVISORY"
  };
}

export function focusCycleForPrompt(process, { promptProfile = null, messageType = "CONTINUATION", now = Date.now() } = {}) {
  // A FULL profile may be forced by the EIC during this same conversation; its
  // ordinal is retained. Initialization/transport messages are excluded by the broker.
  const ordinal = Number(promptProfile?.ordinal);
  const completed = Number(process?.sessionBroker?.sessionSeq) === Number(process?.sessionSeq)
    ? Number(process?.sessionBroker?.operativePrompts || 0) : 0;
  const index = Math.max(1, Math.min(FOCUS_CYCLE_OPERATIVE_PROMPTS,
    Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : completed + 1));
  return {
    schema: FOCUS_CYCLE_SCHEMA,
    operativePromptIndex: index,
    operativePromptLimit: FOCUS_CYCLE_OPERATIVE_PROMPTS,
    phase: FOCUS_CYCLE_PHASES[index - 1],
    instruction: FOCUS_INSTRUCTIONS[index - 1],
    currentWork: "ONE_BOUNDED_VERIFIABLE_SLICE",
    sessionBoundary: "ROTATE_CHAT_ONLY_KEEP_LOGICAL_MISSION_AND_OWNER_AUTHORITY",
    drift: "After two genuinely unproductive turns, replan the method. Request early ROTATE_SESSION_NOW only for corroborated context drift, not merely absent evidence; avoid repeated rotations without changed owner facts.",
    mission: messageType === "SESSION_ROTATION" || index === 1
      ? missionFocusCapsule(process, now) : null
  };
}

export function focusRotationObjective(process, { now = Date.now() } = {}) {
  const receipt = verifiedOwnerReceipt(process, now);
  const next = receipt?.disposition === "NEXT" ? receipt.next : null;
  const base = "RESUME_CANONICAL_OWNER_STATE: Re-read the current Greenfield Works mission and exact subject-project owner state. Reconcile current_focus as a steering hint only. Preserve verified completed work and effect identities; choose the next dependency-ready bounded slice. Never create a new mission from prior chat suggestions.";
  if (next) {
    return `${base} Last verified owner snapshot proposed action ${truncate(next.actionId, 100)} on obligation ${truncate(next.obligationRef, 100)}: ${truncate(next.objective, 600)}. This is a checkpoint reference, not authorization to replay an effect; revalidate before acting.`;
  }
  // No unverifiable previous-step hint crosses a cold session boundary.
  // lastPrompt.a2a.objective can itself have originated in the AI's prior
  // nextSuggestedAction, even when the explicit handoff field is ignored.
  // The canonical mission and owner read remain the only restart anchors.
  return base;
}
