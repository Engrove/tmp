import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  CAUSAL_EVENT,
  CAUSAL_EFFECT_STATUS,
  CAUSAL_OWNERSHIP_VERDICT,
  activeCausalEffect,
  causalOwnershipDesynced,
  classifyCausalOwnership,
  reduceCausalControl
} from "../lib/causal-transition-authority.mjs";
import {
  CAUSAL_OWNERSHIP_STRAND_CODE,
  causalOwnershipStrandFailure,
  evaluateCausalOwnershipStrand,
  openCausalOwnershipStrand
} from "../lib/causal-ownership-liveness.mjs";
import {
  PREPARED_EFFECT_OBSERVATION_DISPOSITION,
  classifyPreparedEffectObservation
} from "../lib/session-init-causal-model.mjs";
import { responseSettlePriorityPlan } from "../lib/response-settle-liveness.mjs";
import { parseTargetResult } from "../lib/prompt-contract.mjs";

let assertions = 0;
function check(condition, message) {
  assertions += 1;
  assert.ok(condition, message);
}

// Exact identities from the 2026-08-30T14:01Z incident export/NDJSON.
const TURN = "turn-2fa08bed-68fd-4c99-9cda-fc1cae97a76a";
const EFFECT = "effect-80c5dc39-eb63-4a3f-9c2f-0f0b6b1b2f7a";
const EPOCH = "b6400458-55db-47f4-8476-e97c08a98957";
const HASH_PARTIAL = "469f9aa1875b745822a37ddccc84a48df468f734ff076e14906b3fac6503405f";
const HASH_OLDER = "a37a87d6265baf8f68bbe4b4e4a0036d23eb45dc9091d3a9e41cc66e74beebea";
const HASH_FINAL = "4bb78cf4ae9a30b97047346e32770cea1c27ec4c8b784cef90c2e79f0e0cd78c";
const SEQ_OLDER = 12;
const SEQ_FINAL = 14;

const now = Date.UTC(2026, 7, 30, 14, 9, 37);

function drive(events, { runId = "run-incident" } = {}) {
  let state = {};
  const rejected = [];
  for (const event of events) {
    const result = reduceCausalControl(state, event, { runId, now });
    if (!result.accepted) rejected.push({ type: event.type, reason: result.reason });
    state = result.state;
  }
  return { state, rejected };
}

// ---------------------------------------------------------------------------
// 1. The incident state reproduces, and is now a typed verdict rather than a
//    silent contradiction between two planes.
// ---------------------------------------------------------------------------
const { state: consumedState } = drive([
  { type: CAUSAL_EVENT.EFFECT_REGISTER, effectId: EFFECT, turnId: TURN, responseContract: "TURN_BOUND_5" },
  { type: CAUSAL_EVENT.EFFECT_STATUS, effectId: EFFECT, status: CAUSAL_EFFECT_STATUS.DELIVERED },
  { type: CAUSAL_EVENT.EFFECT_STATUS, effectId: EFFECT, status: CAUSAL_EFFECT_STATUS.ACKED },
  { type: CAUSAL_EVENT.RESPONSE_BIND, effectId: EFFECT, responseIdentity: `${HASH_PARTIAL}|${EPOCH}`, responseHash: HASH_PARTIAL },
  { type: CAUSAL_EVENT.RESPONSE_CONSUME, responseIdentity: `${HASH_PARTIAL}|${EPOCH}` }
]);

check(
  consumedState.activeEffectId === "" && activeCausalEffect({ causalControl: consumedState }) === null,
  "RESPONSE_CONSUME must clear the active causal owner (the state the incident reached)."
);

// The legacy journal has no vocabulary for consumption, so it still reads ACKED.
const strandedRun = {
  runId: "run-incident",
  causalControl: consumedState,
  currentTurn: { turnId: TURN, responseContract: "TURN_BOUND_5" },
  effectJournal: [{ effectId: EFFECT, turnId: TURN, status: "ACKED", effectClass: "TARGET_CONTINUATION" }]
};
const legacyEffect = strandedRun.effectJournal.find((e) => e.turnId === strandedRun.currentTurn.turnId);
const strandedVerdict = classifyCausalOwnership(strandedRun, legacyEffect);

check(
  legacyEffect.status === "ACKED" && strandedVerdict.causalStatus === CAUSAL_EFFECT_STATUS.CLOSED,
  "The incident's defining contradiction must reproduce: legacy ACKED while causal is CLOSED."
);
check(
  strandedVerdict.verdict === CAUSAL_OWNERSHIP_VERDICT.OWNER_CONSUMED_WITHOUT_SUCCESSOR,
  "A consumed owner with no successor must be a named verdict, not an unnamed disagreement."
);
check(
  strandedVerdict.admissible === false && strandedVerdict.desynced === true &&
  causalOwnershipDesynced(strandedVerdict.verdict),
  "A stranded owner must be inadmissible and explicitly flagged as desynced."
);

// ---------------------------------------------------------------------------
// 2. Both gates must reach the same conclusion from the same verdict. In
//    v0.12.12 gate one said admission=1 while gate two refused, for 2m13s.
// ---------------------------------------------------------------------------
const gateOneAdmits = strandedVerdict.admissible;
const gateTwoAdmits = classifyCausalOwnership(strandedRun, legacyEffect).admissible;
check(
  gateOneAdmits === gateTwoAdmits && gateOneAdmits === false,
  "Both admission gates must agree; disagreement is what produced the no-producer live-lock."
);

// A healthy successor turn must still admit, or the fix would stall every run.
const { state: healthyState } = drive([
  { type: CAUSAL_EVENT.EFFECT_REGISTER, effectId: EFFECT, turnId: TURN, responseContract: "TURN_BOUND_5" },
  { type: CAUSAL_EVENT.EFFECT_STATUS, effectId: EFFECT, status: CAUSAL_EFFECT_STATUS.DELIVERED },
  { type: CAUSAL_EVENT.EFFECT_STATUS, effectId: EFFECT, status: CAUSAL_EFFECT_STATUS.ACKED },
  { type: CAUSAL_EVENT.RESPONSE_BIND, effectId: EFFECT, responseIdentity: `${HASH_PARTIAL}|${EPOCH}`, responseHash: HASH_PARTIAL },
  { type: CAUSAL_EVENT.RESPONSE_CONSUME, responseIdentity: `${HASH_PARTIAL}|${EPOCH}` },
  { type: CAUSAL_EVENT.EFFECT_REGISTER, effectId: "effect-next", turnId: "turn-next", responseContract: "TURN_BOUND_5" },
  { type: CAUSAL_EVENT.EFFECT_STATUS, effectId: "effect-next", status: CAUSAL_EFFECT_STATUS.DELIVERED },
  { type: CAUSAL_EVENT.EFFECT_STATUS, effectId: "effect-next", status: CAUSAL_EFFECT_STATUS.ACKED }
]);
const healthyRun = {
  runId: "run-healthy",
  causalControl: healthyState,
  currentTurn: { turnId: "turn-next", responseContract: "TURN_BOUND_5" },
  effectJournal: [{ effectId: "effect-next", turnId: "turn-next", status: "ACKED" }]
};
const healthyVerdict = classifyCausalOwnership(healthyRun, healthyRun.effectJournal[0]);
check(
  healthyVerdict.verdict === CAUSAL_OWNERSHIP_VERDICT.OWNER_ACTIVE && healthyVerdict.admissible === true,
  "A live ACKED owner on the current turn must still admit candidates."
);
check(
  classifyCausalOwnership({ causalControl: consumedState }, null).admissible === true,
  "A run with no legacy effect at all must remain admissible."
);

// ---------------------------------------------------------------------------
// 3. The v0.12.0 preflight could not repair this and hid both failures.
// ---------------------------------------------------------------------------
const reRegister = reduceCausalControl(
  consumedState,
  { type: CAUSAL_EVENT.EFFECT_REGISTER, effectId: EFFECT, turnId: TURN, responseContract: "TURN_BOUND_5" },
  { runId: "run-incident", now }
);
check(
  reRegister.accepted === false && reRegister.reason === "EFFECT_ALREADY_TERMINAL",
  "Re-registering a consumed effect is refused, so the preflight could never heal the desync."
);
check(
  ["CLOSED", "CANCELLED", "FAILED"].includes(activeCausalEffect({ causalControl: consumedState })?.status || "") === false,
  "The v0.12.12 guard compared against a null active effect, so its closed-effect check could not fire."
);

// ---------------------------------------------------------------------------
// 4. Bounded liveness: a stranded owner must terminalize, never wait silently.
// ---------------------------------------------------------------------------
const strandOpen = openCausalOwnershipStrand(null, strandedVerdict, {
  now, turnId: TURN, responseHash: HASH_FINAL
});
check(
  strandOpen && strandOpen.code === CAUSAL_OWNERSHIP_STRAND_CODE && strandOpen.observations === 1,
  "A stranded owner must open a typed liveness record on first sight."
);
check(
  evaluateCausalOwnershipStrand(strandOpen, { now }).overdue === false,
  "The strand must not fire immediately; recovery gets the whole bound to resolve it."
);

const strandLater = openCausalOwnershipStrand(strandOpen, strandedVerdict, {
  now: now + 30_000, turnId: TURN, responseHash: HASH_FINAL
});
check(
  strandLater.firstSeenAt === strandOpen.firstSeenAt && strandLater.deadlineAt === strandOpen.deadlineAt,
  "Re-observing the same strand must not renew its deadline, or the bound would never be reached."
);

const overdue = evaluateCausalOwnershipStrand(strandLater, { now: now + 60_000 });
check(overdue.overdue === true && overdue.code === CAUSAL_OWNERSHIP_STRAND_CODE,
  "A strand that outlives its bound must become overdue.");

const failure = causalOwnershipStrandFailure(strandLater, { latestAssistantHash: HASH_FINAL }, { now: now + 60_000 });
check(
  failure && failure.code === CAUSAL_OWNERSHIP_STRAND_CODE &&
  failure.responseHash === HASH_FINAL &&
  failure.verdict === CAUSAL_OWNERSHIP_VERDICT.OWNER_CONSUMED_WITHOUT_SUCCESSOR,
  "The bounded failure must name the stranded verdict and the response that could not be admitted."
);
check(
  causalOwnershipStrandFailure(strandOpen, {}, { now }) === null,
  "No failure record may be produced before the bound elapses."
);

// The v0.12.12 bound could not help here: it hangs off responseCandidate, and
// the incident export shows responseCandidate === null.
const settlePlan = responseSettlePriorityPlan(null, {
  latestAssistantHash: HASH_FINAL, documentEpoch: EPOCH, latestMessageRole: "assistant"
}, { now });
check(
  settlePlan.due === false && settlePlan.overdue === false,
  "Candidate-bound settle liveness is inert with candidate=null, which is why a turn-owned bound is required."
);

// ---------------------------------------------------------------------------
// 5. False supersession: 469f -> a37a was a step BACKWARDS to assistant ord 12.
// ---------------------------------------------------------------------------
const preparedEffect = {
  status: "PREPARED",
  turnId: "turn-73461de1",
  sourceObservationHash: HASH_PARTIAL,
  sourceObservationEpoch: EPOCH,
  sourceObservationTurnSeq: SEQ_FINAL
};
const regressed = classifyPreparedEffectObservation(preparedEffect, {
  latestAssistantHash: HASH_OLDER,
  documentEpoch: EPOCH,
  latestAssistantTurnSeq: SEQ_OLDER
});
check(
  regressed.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.OWNER_READBACK_REGRESSED &&
  regressed.superseded === false,
  "The exact 469f->a37a readback must be a regression to wait out, not a supersession."
);
check(
  regressed.reason === "ASSISTANT_TURN_READBACK_REGRESSED" && regressed.hashChanged === true,
  "The hash genuinely changed, but a lower turn sequence must override the supersession reading."
);

const genuinelyNewer = classifyPreparedEffectObservation(preparedEffect, {
  latestAssistantHash: HASH_FINAL,
  documentEpoch: EPOCH,
  latestAssistantTurnSeq: SEQ_FINAL + 1
});
check(
  genuinelyNewer.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.SUPERSEDED,
  "A genuinely newer turn must still supersede, or real supersession would be missed."
);
check(
  classifyPreparedEffectObservation(
    { sourceObservationHash: HASH_PARTIAL, sourceObservationEpoch: EPOCH },
    { latestAssistantHash: HASH_OLDER, documentEpoch: EPOCH }
  ).disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.SUPERSEDED,
  "Without sequence data the classifier must keep its v0.12.12 behaviour."
);

// ---------------------------------------------------------------------------
// 6. The trailer that the real final response actually carried.
// ---------------------------------------------------------------------------
const finalResponse = [
  "EIC_TURN: turn-2fa08bed-68fd-4c99-9cda-fc1cae97a76a",
  "EIC_NEXT: AGENT invalidates the stale proposal.",
  "EIC_COMPLETION_EVIDENCE: MILESTONE_CONTINUE",
  "EIC_NEXT_ACTOR: AGENT",
  "EIC_AUTONOMY: CONTINUE · Status: pågår · Project: EIC Autonom Agent · Time: 2026-08-30T14:09:37Z"
].join("\n");
const parsedFinal = parseTargetResult(finalResponse, TURN);
check(
  parsedFinal.valid === false && parsedFinal.reason === "PROTOCOL_TRAILER_NOT_EXACT",
  "Same-line trailer metadata must still fail the exact-trailer contract."
);
const repaired = parseTargetResult([
  "EIC_TURN: turn-2fa08bed-68fd-4c99-9cda-fc1cae97a76a",
  "EIC_NEXT: AGENT invalidates the stale proposal.",
  "EIC_COMPLETION_EVIDENCE: MILESTONE_CONTINUE",
  "EIC_NEXT_ACTOR: AGENT",
  "EIC_AUTONOMY: CONTINUE",
  "Status: pågår",
  "Project: EIC Autonom Agent",
  "Time: 2026-08-30T14:09:37Z"
].join("\n"), TURN);
check(
  repaired.reason !== "PROTOCOL_TRAILER_NOT_EXACT" &&
  repaired.status === "CONTINUE" &&
  repaired.nextActor === "AGENT",
  "Moving the metadata onto its own trailing lines must clear the trailer defect and expose the tuple, so protocol repair has a reachable target."
);

// ---------------------------------------------------------------------------
// 7. Source invariants for the controller wiring.
// ---------------------------------------------------------------------------
const background = await fs.readFile(new URL("../background.js", import.meta.url), "utf8");

check(
  background.includes("const postReconcileCausalOwnership = classifyCausalOwnership(run, reconciledEffect);") &&
  background.includes("postReconcileCausalOwnership.admissible &&"),
  "The admission gate must derive from the shared causal verdict, not from the legacy journal alone."
);
check(
  background.includes("const causalOwnership = classifyCausalOwnership(run, effect);") &&
  background.includes("const effectReady = causalOwnership.admissible;"),
  "The candidate gate must consume the identical verdict."
);
check(
  !background.includes('!["CLOSED","CANCELLED","FAILED"].includes(currentCausalEffect?.status || "")'),
  "The null-dereferencing closed-effect guard must be gone."
);
check(
  background.includes("const terminalCausalStatus = [\"CLOSED\", \"CANCELLED\", \"FAILED\", \"RESPONSE_CONSUMED\"]") &&
  background.includes("const postRegisterOwnership = classifyCausalOwnership(run, causalLegacyEffect);"),
  "The preflight must compare against the effect's own causal status."
);
check(
  background.includes("if (preflightOwnership.desynced) {") &&
  background.includes("Kausalt ägarskap strandat utan efterföljare"),
  "A stranded owner must be audited on first detection instead of retried silently."
);
check(
  background.includes("if (causalStrandLiveness.overdue) {") &&
  background.includes("CAUSAL_OWNERSHIP_STRAND_CODE}: legacy-journalen"),
  "The bounded strand must terminalize the run with a typed invariant."
);
check(
  background.includes("const controlTrailerIncomplete = Boolean(") &&
  background.includes('targetResult.reason === "PROTOCOL_TRAILER_NOT_EXACT" &&') &&
  background.includes("page.latestAssistantComplete !== true &&"),
  "A CONTROL response with an incomplete trailer must not be consumed on soft stability."
);
check(
  background.includes("PREPARED_EFFECT_OBSERVATION_DISPOSITION.OWNER_READBACK_REGRESSED") &&
  background.includes('effect.ownerReadbackStatus = readbackRegressed ? "REGRESSED" : "UNREADABLE";'),
  "A regressed readback must keep the prepared effect rather than discard it."
);
check(
  background.includes("sourceObservationTurnSeq: Number(observation?.latestAssistantTurnSeq || 0),"),
  "Prepared effects must stamp the turn sequence they were prepared from."
);

const content = await fs.readFile(new URL("../content.js", import.meta.url), "utf8");
check(
  content.includes("function registerAssistantTurnSequence(records, conversationKeyValue)") &&
  content.includes("latestAssistantTurnSeq,"),
  "content.js must publish a monotonic assistant turn sequence."
);
check(
  content.includes("assistantTurnLedger.clear();"),
  "The turn ledger must reset when the conversation changes."
);

// ---------------------------------------------------------------------------
// 8. End to end: the incident sequence must never end in a silent wait.
// ---------------------------------------------------------------------------
const timeline = [
  { at: now, hash: HASH_PARTIAL, seq: SEQ_FINAL },
  { at: now + 8_000, hash: HASH_OLDER, seq: SEQ_OLDER },
  { at: now + 70_000, hash: HASH_FINAL, seq: SEQ_FINAL }
];
let strand = null;
let terminalized = false;
for (const frame of timeline) {
  const verdict = classifyCausalOwnership(strandedRun, legacyEffect);
  if (verdict.desynced) {
    strand = openCausalOwnershipStrand(strand, verdict, {
      now: frame.at, turnId: TURN, responseHash: frame.hash
    });
    if (evaluateCausalOwnershipStrand(strand, { now: frame.at }).overdue) terminalized = true;
  }
}
check(
  strand !== null && strand.observations === timeline.length,
  "Every frame of the incident must be recorded against one strand."
);
check(
  terminalized === true,
  "Replaying 469f -> a37a -> 4bb78cf4 against a stranded owner must terminalize, never sit silently in WAITING_FOR_RESPONSE."
);

console.log(`v0.12.13 control-plane regression: ${assertions}/${assertions} PASS`);
