import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  CAUSAL_OWNERSHIP_PRODUCER,
  CAUSAL_OWNERSHIP_RECOVERY_ACTION,
  CAUSAL_OWNERSHIP_REARM_SCHEMA,
  CAUSAL_OWNERSHIP_STRAND_CODE,
  CAUSAL_OWNERSHIP_STRAND_MAX_AGE_MS,
  CAUSAL_OWNERSHIP_STRAND_MAX_REARM,
  causalOwnershipRearmAdmits,
  classifyCausalOwnershipProducer,
  evaluateCausalOwnershipStrand,
  grantCausalOwnershipRearm,
  markCausalOwnershipRearm,
  openCausalOwnershipStrand,
  planCausalOwnershipRecovery
} from "../lib/causal-ownership-liveness.mjs";
import { CAUSAL_OWNERSHIP_VERDICT } from "../lib/causal-transition-authority.mjs";
import { STATES, createRun } from "../lib/state-machine.mjs";

let assertions = 0;
function check(condition, message) {
  assertions += 1;
  assert.ok(condition, message);
}

// Exact identities from the 2026-08-30T15:08Z v0.12.13 field NDJSON.
const EFFECT = "effect-783bedcb-92ac-468";
const TURN = "turn-8f2c41ad-5b90-4e7c-9a11-6d3f0c58e2b4";
const NANO_REQUEST = "nano-request-a54fcbc6";
const NANO_CLAIM = "nano-claim-3214c6a9";
const HASH_CONSUMED = "a37a87d6265baf8f68bbe4b4e4a0036d23eb45dc9091d3a9e41cc66e74beebea";
const HASH_LIVE = "4bb78cf4ae9a30b97047346e32770cea1c27ec4c8b784cef90c2e79f0e0cd78c";
const EPOCH = "b6400458-55db-47f4-8476-e97c08a98957";

// 15:08:16.844 — the millisecond NANO_CLAIM took the turn and v0.12.13 opened
// the strand that would kill the run 49.8 s later.
const T_CLAIM = Date.parse("2026-08-30T15:08:16.844Z");
const T_DECISION = Date.parse("2026-08-30T15:09:06.369Z");
const T_TERMINAL = Date.parse("2026-08-30T15:09:06.642Z");

const strandedVerdict = {
  verdict: CAUSAL_OWNERSHIP_VERDICT.OWNER_CONSUMED_WITHOUT_SUCCESSOR,
  effectId: EFFECT,
  legacyStatus: "ACKED",
  causalStatus: "CLOSED",
  closeReason: "RESPONSE_CONSUMED",
  desynced: true,
  admissible: false
};

// ---------------------------------------------------------------------------
// 1. The incident itself: a live Nano claim IS the producer.
// ---------------------------------------------------------------------------
const runWithNano = {
  pendingNanoRequest: { requestId: NANO_REQUEST, claimId: NANO_CLAIM, status: "RUNNING" },
  sessionContextInit: { state: "READY" }
};
const nanoProducer = classifyCausalOwnershipProducer(runWithNano);
check(
  nanoProducer.active === true && nanoProducer.producer === CAUSAL_OWNERSHIP_PRODUCER.NANO_PENDING,
  "A RUNNING Nano request must be recognised as the producer that owns the next step."
);
check(
  nanoProducer.detail.includes(NANO_REQUEST),
  "The producer verdict must name the request that holds the turn, for the audit trail."
);

for (const status of ["PENDING", "DETERMINISTIC_PENDING", "RUNNING"]) {
  check(
    classifyCausalOwnershipProducer({ pendingNanoRequest: { status } }).active === true,
    `A ${status} Nano request must count as a live producer.`
  );
}
for (const status of ["COMPLETED", "FAILED", ""]) {
  check(
    classifyCausalOwnershipProducer({ pendingNanoRequest: { status } }).active === false,
    `A ${status || "statusless"} Nano request must not be mistaken for a live producer.`
  );
}

// The whole failure in one assertion: with Nano claiming the turn, the plan
// must clear, not terminalize.
const incidentStrand = openCausalOwnershipStrand(null, strandedVerdict, {
  now: T_CLAIM, turnId: TURN, responseHash: HASH_CONSUMED
});
const incidentPlan = planCausalOwnershipRecovery({
  strand: incidentStrand,
  producer: nanoProducer,
  ownership: strandedVerdict,
  now: T_TERMINAL
});
check(
  incidentPlan.action === CAUSAL_OWNERSHIP_RECOVERY_ACTION.CLEAR,
  "With Nano mid-analysis the strand must clear; v0.12.13 terminalized here 95 ms after session-init reported READY."
);
check(
  incidentPlan.reason === `PRODUCER_ACTIVE:${CAUSAL_OWNERSHIP_PRODUCER.NANO_PENDING}`,
  "The clear must state which producer held the turn."
);
check(
  T_TERMINAL - T_CLAIM > CAUSAL_OWNERSHIP_STRAND_MAX_AGE_MS &&
  evaluateCausalOwnershipStrand(incidentStrand, { now: T_TERMINAL }).overdue === true,
  "The incident strand really was overdue by the bound — the producer check, not the clock, is what saves the run."
);
check(
  T_DECISION - T_CLAIM > CAUSAL_OWNERSHIP_STRAND_MAX_AGE_MS,
  "Nano's own 49.2 s analysis outruns the 45 s strand bound, so this collision is structural, not a race."
);

// ---------------------------------------------------------------------------
// 2. Every other legitimate owner of the next step.
// ---------------------------------------------------------------------------
const producerCases = [
  [{ sessionContextInit: { state: "NANO_ANALYZING" } }, CAUSAL_OWNERSHIP_PRODUCER.SESSION_INIT],
  [{ sessionContextInit: { state: "WAITING_BASELINE_RESPONSE" } }, CAUSAL_OWNERSHIP_PRODUCER.SESSION_INIT],
  [{ responseCandidate: { hash: HASH_LIVE } }, CAUSAL_OWNERSHIP_PRODUCER.RESPONSE_CANDIDATE],
  [{ pendingObservation: { hash: HASH_LIVE } }, CAUSAL_OWNERSHIP_PRODUCER.PENDING_OBSERVATION],
  [{ waitingObservation: { turnId: TURN } }, CAUSAL_OWNERSHIP_PRODUCER.WAITING_OBSERVATION],
  [{ operatorAction: { id: "op-1" } }, CAUSAL_OWNERSHIP_PRODUCER.OPERATOR_PENDING]
];
for (const [run, expected] of producerCases) {
  const verdict = classifyCausalOwnershipProducer(run);
  check(
    verdict.active === true && verdict.producer === expected,
    `${expected} must be recognised as a producer.`
  );
}
check(
  classifyCausalOwnershipProducer({}, { legacyEffect: { status: "SUBMITTED_UNCONFIRMED" } }).producer ===
    CAUSAL_OWNERSHIP_PRODUCER.PREPARED_EFFECT,
  "An outbound effect still in flight owns the next step."
);
check(
  classifyCausalOwnershipProducer({}, { pageGenerating: true }).producer ===
    CAUSAL_OWNERSHIP_PRODUCER.PAGE_GENERATING,
  "ChatGPT still writing is a producer; nothing is stranded while the answer is being generated."
);
check(
  classifyCausalOwnershipProducer({ sessionContextInit: { state: "READY" } }).producer ===
    CAUSAL_OWNERSHIP_PRODUCER.NONE,
  "A finished session-init is not a producer — READY means the turn is handed back."
);
check(
  classifyCausalOwnershipProducer({ sessionContextInit: { state: "FAILED" } }).producer ===
    CAUSAL_OWNERSHIP_PRODUCER.NONE,
  "A failed session-init is not a producer either; nothing is going to finish that turn."
);

// ---------------------------------------------------------------------------
// 3. The stale strand: v0.12.13 could only clear on the healthy branch.
// ---------------------------------------------------------------------------
// After a turn completes, latestEffect(run) is null, so preflight ownership is
// null. v0.12.13 skipped the entire block and the strand aged untouched.
const orphanPlan = planCausalOwnershipRecovery({
  strand: incidentStrand,
  producer: { active: false, producer: CAUSAL_OWNERSHIP_PRODUCER.NONE },
  ownership: null,
  now: T_CLAIM + 1_000
});
check(
  orphanPlan.action !== CAUSAL_OWNERSHIP_RECOVERY_ACTION.RECOVER,
  "A strand inside its bound must never escalate, whatever the journal looks like."
);
const resyncedPlan = planCausalOwnershipRecovery({
  strand: incidentStrand,
  producer: { active: false, producer: CAUSAL_OWNERSHIP_PRODUCER.NONE },
  ownership: { ...strandedVerdict, desynced: false, verdict: CAUSAL_OWNERSHIP_VERDICT.OWNER_ACTIVE },
  now: T_TERMINAL
});
check(
  resyncedPlan.action === CAUSAL_OWNERSHIP_RECOVERY_ACTION.CLEAR &&
  resyncedPlan.reason.startsWith("OWNERSHIP_RESYNCED:"),
  "An overdue strand whose ownership has re-synced must clear, not fire on a condition that no longer holds."
);

// ---------------------------------------------------------------------------
// 4. The remedy ladder: HOLD -> REARM -> REARM -> RECOVER. Never terminal.
// ---------------------------------------------------------------------------
const idle = { active: false, producer: CAUSAL_OWNERSHIP_PRODUCER.NONE };
let strand = openCausalOwnershipStrand(null, strandedVerdict, {
  now: T_CLAIM, turnId: TURN, responseHash: HASH_CONSUMED
});
check(
  planCausalOwnershipRecovery({ strand, producer: idle, ownership: strandedVerdict, now: T_CLAIM + 10_000 })
    .action === CAUSAL_OWNERSHIP_RECOVERY_ACTION.HOLD,
  "Inside the bound the ladder holds and lets ordinary processing resolve it."
);

const ladder = [];
let clock = T_CLAIM;
let priorRearms = 0;
for (let step = 0; step < 4; step += 1) {
  clock += CAUSAL_OWNERSHIP_STRAND_MAX_AGE_MS + 1_000;
  const plan = planCausalOwnershipRecovery({
    strand, producer: idle, ownership: strandedVerdict, now: clock, priorRearms
  });
  ladder.push(plan.action);
  if (plan.action === CAUSAL_OWNERSHIP_RECOVERY_ACTION.REARM) {
    strand = markCausalOwnershipRearm(strand, { now: clock });
    priorRearms += 1;
  }
}
check(
  ladder.join(">") === "REARM>REARM>RECOVER>RECOVER",
  `The ladder must re-arm ${CAUSAL_OWNERSHIP_STRAND_MAX_REARM}x and then hand to recovery, got ${ladder.join(">")}.`
);
check(
  !ladder.includes(STATES.ERROR_TERMINAL) &&
  Object.values(CAUSAL_OWNERSHIP_RECOVERY_ACTION).every((a) => a !== "TERMINALIZE"),
  "No rung of this ladder may end the run; ERROR_TERMINAL requires a human and this agent is autonomous."
);

// A re-arm restarts the clock, so the next rung is a full bound away.
const rearmedOnce = markCausalOwnershipRearm(
  openCausalOwnershipStrand(null, strandedVerdict, { now: T_CLAIM, responseHash: HASH_CONSUMED }),
  { now: T_CLAIM + 50_000 }
);
check(
  evaluateCausalOwnershipStrand(rearmedOnce, { now: T_CLAIM + 60_000 }).overdue === false,
  "A freshly re-armed strand must get the whole bound again before the next rung."
);
const reopened = openCausalOwnershipStrand(rearmedOnce, strandedVerdict, {
  now: T_CLAIM + 60_000, responseHash: HASH_CONSUMED
});
check(
  reopened.rearmCount === 1 && reopened.deadlineAt === rearmedOnce.deadlineAt,
  "Re-observing a re-armed strand must carry the re-arm count and the re-armed deadline forward."
);

// ---------------------------------------------------------------------------
// 5. The grant: admits a genuinely new response, never the consumed one.
// ---------------------------------------------------------------------------
const grant = grantCausalOwnershipRearm(strand, {
  latestAssistantHash: HASH_LIVE, documentEpoch: EPOCH
}, { now: clock });
check(
  grant.schema === CAUSAL_OWNERSHIP_REARM_SCHEMA &&
  grant.effectId === EFFECT &&
  grant.consumedResponseHash === HASH_CONSUMED &&
  grant.observedResponseHash === HASH_LIVE,
  "The grant must name the effect it was issued against and both hashes it distinguishes."
);
check(
  causalOwnershipRearmAdmits(grant, { effectId: EFFECT }, { latestAssistantHash: HASH_LIVE }) === true,
  "The 4bb78cf4 response that no gate would admit in v0.12.12 must be admitted by the grant."
);
check(
  causalOwnershipRearmAdmits(grant, { effectId: EFFECT }, { latestAssistantHash: HASH_CONSUMED }) === false,
  "The grant must never re-admit the response that was already consumed."
);
check(
  causalOwnershipRearmAdmits(grant, null, { latestAssistantHash: HASH_LIVE }) === true,
  "Retiring the stranded legacy claim is part of the remedy, so an empty journal must not void the grant."
);
check(
  causalOwnershipRearmAdmits(grant, { effectId: "effect-someone-else" }, { latestAssistantHash: HASH_LIVE }) === false,
  "A different live effect has its own owner and must never borrow this grant."
);
check(
  causalOwnershipRearmAdmits(grant, { effectId: EFFECT }, {}) === false,
  "With nothing on screen there is nothing to admit."
);
check(
  causalOwnershipRearmAdmits({ effectId: EFFECT }, { effectId: EFFECT }, { latestAssistantHash: HASH_LIVE }) === false,
  "Only a properly schema'd grant may open a gate."
);
check(
  grantCausalOwnershipRearm(null, {}) === null &&
  grantCausalOwnershipRearm({ effectId: "" }, {}) === null,
  "No grant may be minted without the effect it is bound to."
);

// ---------------------------------------------------------------------------
// 6. The run-level budget: re-arms only accumulate without progress.
// ---------------------------------------------------------------------------
check(
  planCausalOwnershipRecovery({
    strand: openCausalOwnershipStrand(null, strandedVerdict, { now: T_CLAIM }),
    producer: idle,
    ownership: strandedVerdict,
    now: T_CLAIM + 60_000,
    priorRearms: CAUSAL_OWNERSHIP_STRAND_MAX_REARM
  }).action === CAUSAL_OWNERSHIP_RECOVERY_ACTION.RECOVER,
  "A re-arm retires the effect and the next tick sees a fresh strand, so the budget must be carried at run level."
);
check(
  planCausalOwnershipRecovery({
    strand: openCausalOwnershipStrand(null, strandedVerdict, { now: T_CLAIM }),
    producer: idle,
    ownership: strandedVerdict,
    now: T_CLAIM + 60_000,
    priorRearms: 0
  }).action === CAUSAL_OWNERSHIP_RECOVERY_ACTION.REARM,
  "Progress zeroes the ladder, so a run that hits this divergence once still gets its full budget."
);

// ---------------------------------------------------------------------------
// 7. Run shape.
// ---------------------------------------------------------------------------
const run = createRun({ runId: "run-test", windowId: 1, targetTabId: 2, conversationKey: "c" });
check(
  run.causalOwnershipRearm === null && run.causalOwnershipRearmLedger === null,
  "createRun must declare the re-arm fields so they survive durable write/readback."
);

// ---------------------------------------------------------------------------
// 8. Source invariants for the controller wiring.
// ---------------------------------------------------------------------------
const background = await fs.readFile(new URL("../background.js", import.meta.url), "utf8");

check(
  background.includes("const causalOwnerStranded = Boolean(preflightOwnership?.desynced) && !causalProducer.active;"),
  "The strand must be gated on the absence of a producer — the condition its own failure code asserts."
);
check(
  background.includes("} else if (run.causalOwnershipStrand) {") &&
  background.includes("run.causalOwnershipStrand = clearCausalOwnershipStrand();"),
  "Clearing must be unconditional, reachable when there is no legacy effect at all."
);
check(
  background.includes("const preflightOwnership = causalLegacyEffect?.effectId") &&
  background.includes("if (preflightOwnership && !preflightOwnership.desynced) {"),
  "Classification must precede mutation so the clear path does not depend on the register path."
);
check(
  !/causalStrandLiveness\.overdue[\s\S]{0,400}STATES\.ERROR_TERMINAL/.test(background),
  "The overdue strand must no longer terminalize the run."
);
check(
  background.includes("run = transitionRun(run, STATES.RECOVERING, {") &&
  background.includes("Kausalt ägarskap lämnat till autonom recovery"),
  "The last rung must hand the turn to the autonomous recovery ladder."
);
check(
  background.includes("nextRecoveryAt: nowIso(now),"),
  "Recovery must be schedulable on the next tick; transitionRun's default would null it out."
);
check(
  background.includes("Kausalt ägarskap återarmat autonomt") &&
  background.includes("ingen människa krävs."),
  "The re-arm must be audited as an autonomous remedy."
);
check(
  background.includes("run.causalOwnershipRearmLedger = {") &&
  background.includes("sinceProgressAt: run.lastProgressAt || null"),
  "The re-arm budget must be anchored to run progress, not to a strand that resets every tick."
);
check(
  background.includes("const postReconcileRearmAdmits = causalOwnershipRearmAdmits(") &&
  background.includes("const causalRearmAdmits = causalOwnershipRearmAdmits(run.causalOwnershipRearm, effect, page);"),
  "Both admission gates must consume the same grant; a grant only one gate honours reintroduces the split brain."
);

const stateMachine = await fs.readFile(new URL("../lib/state-machine.mjs", import.meta.url), "utf8");
check(
  stateMachine.includes("causalOwnershipRearm: null,") &&
  stateMachine.includes("causalOwnershipRearmLedger: null,"),
  "state-machine.mjs must declare the re-arm fields."
);

console.log(`v0.12.14 autonomy regression: ${assertions}/${assertions} PASS`);
