// v1.9.3 interaction slicing. The single owner of Greenfield's prompt-sizing
// text (GFW_EIC_CONTROL_A2A_v1 handoff items 1-4): one bounded coherent slice
// per ChatGPT interaction, later interactions are execution depth, the final
// or checkpoint interaction prioritizes readback and handoff, and observed
// session pressure shrinks the next slice. Greenfield owns only these transport
// facts; semantic planning stays with the EIC's current always-fetch owners,
// whose method wins over any older FULL/COMPACT sizing text. No provider TTL or
// wall-clock budget is stated or assumed anywhere in this module. Pure.

export const INTERACTION_SLICING_SCHEMA = "eic.greenfield.interaction-slicing.v1";
export const METHOD_CONTROL_SCHEMA = "eic.greenfield.method-control.v1";

// The method version Greenfield's sizing text was written against. The EIC's
// current owner method wins whatever this says; it is a reference, not a gate.
export const GFW_SLICING_METHOD_ID = "GFW_INTERACTION_SLICING_2026_10_07";
export const GFW_ALWAYS_FETCH_OWNERS = Object.freeze([
  "greenfield_eic_session_contract",
  "kaizen_self_help_runtime"
]);

export const INTERACTION_ROLES = Object.freeze({
  FIRST: "FIRST",
  MIDDLE: "MIDDLE",
  FINAL: "FINAL_CHECKPOINT",
  WINDOW_CHECKPOINT: "SCHEDULE_CHECKPOINT",
  ONLY: "ONLY_INTERACTION",
  UNQUEUED: "UNQUEUED"
});

export const SLICE_PRESSURE = Object.freeze({
  NORMAL: "NORMAL",
  SHRINK: "SHRINK"
});

// sessionHealth signals that mean completion/round-trip pressure or transport
// risk (contract canonicalGranularityModel.interactionPlanning.adaptiveRule).
// LONG_SESSION and LARGE_MANAGED_CONTEXT are context-size signals: they inform
// rotation, not slice size.
export const SLICE_SHRINK_SIGNALS = Object.freeze([
  "COMPLETION_HIGH_RELATIVE",
  "COMPLETION_RISING",
  "PROVIDER_BACKGROUND_PROCESSING",
  "TRANSPORT_INTERRUPTED",
  "TTFR_HIGH_RELATIVE",
  "RECOVERY_CHURN"
]);

export const METHOD_PRECEDENCE_CLAUSE =
  "unless superseded by the current always-fetch owner method (responseContract.methodControl)";

export const HOT_RELOAD_RULE =
  "On every operative Greenfield turn, current owner-read always-fetch method/routing/control semantics override conflicting older chat-local FULL/COMPACT prompt-sizing guidance immediately.";

export const METHOD_CONTROL_COMPACT_REMINDER =
  `Current always-fetch owner method (${GFW_ALWAYS_FETCH_OWNERS.join(", ")}) overrides any conflicting older FULL/COMPACT prompt-sizing text immediately; Greenfield's sizing text follows ${GFW_SLICING_METHOD_ID}.`;

const SLICE = "Execute one bounded coherent slice that fits this interaction";
const DEPTH = "Use later interactions as execution depth; do not force the whole semantic WORK_QUANTUM/progression envelope into this response.";
const ENVELOPE = "Preserve the current terminal contract and progressionEnvelopeRef unless a real owner/risk/evidence transition occurs.";
const NEXT_SLICE = "Return nextSuggestedAction as the next single bounded slice, not the remaining plan.";
const CHECKPOINT = "This is a checkpoint/handoff interaction, not mission completion: prioritize reconciliation, owner readback, unresolved-effect disposition and a restart-safe handoff unless semantic closure already occurred; terminal closure still requires supported owner-verified closure.";
const HANDOFF = "Return nextSuggestedAction as a restart-safe handoff naming the next single bounded slice.";

function count(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Position of the coming interaction inside its queue-slot quantum, from the
 * exact workQueue counters only (never process.turn or sessionSeq). A null
 * workQueue means the process is not queue-managed.
 */
export function interactionPosition(workQueue = null) {
  if (!workQueue || typeof workQueue !== "object") {
    return { queued: false, role: INTERACTION_ROLES.UNQUEUED };
  }
  const maxInteractions = Math.max(1, count(workQueue.maxInteractions, 1));
  const interactionInQuantum = Math.min(maxInteractions, Math.max(1, count(workQueue.interactionInQuantum, 1)));
  const remaining = Math.max(1, count(
    workQueue.remainingInteractionsIncludingCurrent,
    maxInteractions - interactionInQuantum + 1
  ));
  const final = workQueue.finalInteractionInQuantum === true || interactionInQuantum >= maxInteractions;
  const checkpointRequired = workQueue.checkpointRequired === true || final;
  let role = INTERACTION_ROLES.MIDDLE;
  if (maxInteractions === 1) role = INTERACTION_ROLES.ONLY;
  else if (final) role = INTERACTION_ROLES.FINAL;
  else if (checkpointRequired) role = INTERACTION_ROLES.WINDOW_CHECKPOINT;
  else if (interactionInQuantum === 1) role = INTERACTION_ROLES.FIRST;
  return {
    queued: true,
    role,
    interactionInQuantum,
    maxInteractions,
    remainingInteractionsIncludingCurrent: remaining,
    finalInteractionInQuantum: final,
    checkpointRequired
  };
}

/**
 * The planning hint for one interaction (contract
 * promptGenerationAlgorithm.recommendedPlanningHintTemplate plus the role
 * clause). Built from counters only; identical inputs give identical text.
 */
export function planningHint(position) {
  const p = position?.role ? position : interactionPosition(position);
  if (!p.queued) {
    return `Greenfield sends one prompt per interaction and schedules the next interaction itself. ${SLICE}. ${DEPTH} ${ENVELOPE} ${NEXT_SLICE}`;
  }
  const where = `This is interaction ${p.interactionInQuantum} of ${p.maxInteractions} in the current queue-slot quantum (${p.remainingInteractionsIncludingCurrent} including this turn remain).`;
  switch (p.role) {
    case INTERACTION_ROLES.ONLY:
      return `${where} Read fresh owner state, execute one bounded coherent slice that fits this interaction and close it with owner readback; do not force the whole semantic WORK_QUANTUM/progression envelope into this response. ${CHECKPOINT} ${ENVELOPE} ${HANDOFF}`;
    case INTERACTION_ROLES.FINAL:
      return `${where} ${CHECKPOINT} ${ENVELOPE} ${HANDOFF}`;
    case INTERACTION_ROLES.WINDOW_CHECKPOINT:
      return `${where} The slot's run window likely closes after this response. ${CHECKPOINT} ${ENVELOPE} ${HANDOFF}`;
    case INTERACTION_ROLES.FIRST:
      return `${where} ${SLICE}: read fresh owner state and execute the first real bounded effect/readback slice; do not front-load later test/repair/package/readback work. ${DEPTH} ${ENVELOPE} ${NEXT_SLICE}`;
    default:
      return `${where} Continue the same semantic WORK_QUANTUM with the next dependency-ordered slice; do not replan the frontier merely because a response ended. ${SLICE}. ${DEPTH} ${ENVELOPE} ${NEXT_SLICE}`;
  }
}

/**
 * Slice-size advice from the sessionHealth capsule (contract adaptiveRule).
 * Relative and event signals only; no absolute time threshold.
 */
export function slicePressure(capsule = null) {
  const signals = Array.isArray(capsule?.signals)
    ? capsule.signals.filter((signal) => SLICE_SHRINK_SIGNALS.includes(signal))
    : [];
  const band = String(capsule?.pressureBand || "LOW").toUpperCase();
  const shrink = signals.length > 0 || band === "ELEVATED" || band === "HIGH";
  return shrink
    ? {
        level: SLICE_PRESSURE.SHRINK,
        signals,
        pressureBand: band,
        rule: "Observed session pressure: shrink this slice to one decision/effect-owner lane with bounded evidence output; expand only when owner-safe and clearly within headroom."
      }
    : { level: SLICE_PRESSURE.NORMAL, signals: [], pressureBand: band };
}

// Distinct work phases named in a free-text objective. English and Swedish
// stems; a soft heuristic that only adds a guard sentence, never blocks.
// Word edges are Unicode-aware (JS \b treats å/ä/ö as non-word characters).
function stems(alternatives) {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, "iu");
}
const PHASE_PATTERNS = Object.freeze([
  ["IMPLEMENT", stems("implement\\p{L}*|build\\p{L}*|bygg\\p{L}*")],
  ["COMPLETE", stems("complete\\p{L}*|finish\\p{L}*|finali[sz]e\\p{L}*|slutför\\p{L}*|fullfölj\\p{L}*|färdigställ\\p{L}*|komplettera\\p{L}*")],
  ["VERIFY", stems("verif\\p{L}*|validat\\p{L}*|validera\\p{L}*")],
  ["TEST", stems("run (?:the )?(?:\\p{L}+ )?tests?|test(?:s|ing)?|testa\\p{L}*|testfamilj\\p{L}*|kör (?:\\p{L}+ )?test\\p{L}*")],
  ["REPAIR", stems("repair\\p{L}*|fix\\p{L}*|reparera\\p{L}*|åtgärda\\p{L}*|rätta\\p{L}*")],
  ["PACKAGE", stems("package\\p{L}*|publish\\p{L}*|deploy\\p{L}*|paketera\\p{L}*|publicera\\p{L}*|driftsätt\\p{L}*")],
  ["TRANSFER", stems("transfer\\p{L}*|export\\p{L}*|migrat\\p{L}*|överför\\p{L}*|byteöverför\\p{L}*|migrera\\p{L}*")],
  ["COMMIT", stems("commit\\p{L}*|push\\p{L}*|merge\\p{L}*|committa\\p{L}*|pusha\\p{L}*")],
  ["READBACK", stems("read ?back\\p{L}*|owner-readback|läs tillbaka|återläs\\p{L}*")]
]);
export const OVERPACK_PHASE_THRESHOLD = 4;

export function objectivePhaseCount(objective = "") {
  const value = String(objective || "");
  const named = PHASE_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
  const numbered = (value.match(/(^|\s)(\d{1,2})[.)]\s+\S/gu) || []).length;
  return { phases: named, count: Math.max(named.length, numbered) };
}

/**
 * Overpack guard for the dynamic objective (contract C01, pseudocode
 * overpacks_full_semantic_quantum). The objective is the EIC's or the local
 * controller's text and is never rewritten; a suspected multi-phase objective
 * gets one guard sentence telling the receiver to run only its first slice now.
 */
export function objectiveGuard(objective = "", position = null) {
  const p = position?.role ? position : interactionPosition(position);
  const { phases, count: phaseCount } = objectivePhaseCount(objective);
  const suspected = phaseCount >= OVERPACK_PHASE_THRESHOLD;
  if (!suspected) return { overpackSuspected: false, phaseCount };
  const checkpoint = [INTERACTION_ROLES.FINAL, INTERACTION_ROLES.WINDOW_CHECKPOINT, INTERACTION_ROLES.ONLY].includes(p.role);
  return {
    overpackSuspected: true,
    phaseCount,
    phases,
    rule: checkpoint
      ? "The objective names several dependent phases. This is a checkpoint interaction: do only what can be read back in this response, then hand off the remaining phases in order through nextSuggestedAction."
      : "The objective names several dependent phases. Treat it as the ordered plan for this quantum: execute only its first bounded slice in this interaction and hand off the rest in order through nextSuggestedAction."
  };
}

/** Per-prompt slicing capsule (FULL and COMPACT). */
export function interactionSlicingCapsule({ workQueue = null, sessionHealth = null, objective = "" } = {}) {
  const position = interactionPosition(workQueue);
  return {
    schema: INTERACTION_SLICING_SCHEMA,
    methodId: GFW_SLICING_METHOD_ID,
    role: position.role,
    planningHint: position.queued ? "SEE control.workQueue.planningHint" : planningHint(position),
    slicePressure: slicePressure(sessionHealth),
    objectiveGuard: objectiveGuard(objective, position)
  };
}

/** FULL-prompt hot-reload reference (contract promptProfileContract.hotReload). */
export function methodControl() {
  return {
    schema: METHOD_CONTROL_SCHEMA,
    alwaysFetchOwners: [...GFW_ALWAYS_FETCH_OWNERS],
    methodId: GFW_SLICING_METHOD_ID,
    rule: HOT_RELOAD_RULE,
    mustNotWaitFor: ["session rotation", "queue reset", "new mission", "next periodic FULL prompt"],
    mustNotChange: [
      "factual owner truth",
      "authorization/effect authority",
      "frozen terminal target",
      "already completed effect history",
      "claim/evidence ceilings"
    ],
    greenfieldRole: "Greenfield owns transport facts (queue counters, schedule, session state, timings) and projects them; semantic planning rules belong to the current always-fetch owners."
  };
}

/**
 * Position of the interaction that follows the response being analyzed, for
 * the local advisory controller (Hjalmar D2). queueContext.interactionCount
 * counts interactions completed before that response.
 */
export function nextInteractionAfterResponse(queueContext = null) {
  if (!queueContext?.itemId) return null;
  const max = Math.max(1, count(queueContext.maxInteractions, 1));
  const completedAfter = count(queueContext.interactionCount, 0) + 1;
  if (completedAfter >= max) {
    return { interaction: 1, of: max, newQuantum: true, final: max === 1 };
  }
  const interaction = completedAfter + 1;
  return { interaction, of: max, newQuantum: false, final: interaction >= max };
}
