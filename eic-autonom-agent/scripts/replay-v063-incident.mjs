import assert from "node:assert/strict";
import {
  isMetaOnlyAction,
  validateDecisionGrounding
} from "../lib/decision-grounding.mjs";
import {
  buildDeterministicDecision
} from "../lib/fallback-planner.mjs";
import {
  DETERMINISTIC_GATE_ACTIONS,
  evaluateDeterministicDispatch,
  prepareDeterministicDispatch
} from "../lib/deterministic-dispatch-gate.mjs";

const exactAction =
  "Reconcile or recreate the exact immutable v6 candidate through the canonical Workspace/Forgejo publication route, then verify a new descendant branch commit, exact 111-path digest/hash parity and stable publish status with verify_remote=true before creating the WP25.2.4 PR.";

const projection = {
  intent: "Slutför EIC backend WP25.2.",
  position: {
    workUnit: "Reconcile immutable v6 publication candidate",
    workUnitId: "wu-runtime-incident"
  },
  verifiedFacts: [],
  targetClaims: [
    { claim: "Målsessionen returnerade ett turn-bundet CONTINUE." }
  ],
  inferences: [],
  constraints: []
};

assert.equal(isMetaOnlyAction(exactAction), false);

const decision = buildDeterministicDecision({
  run: {
    targetTabId: 1974093336,
    conversationKey: "chatgpt.com:c:runtime-incident",
    maxAutonomousMode: true
  },
  observation: {
    targetResult: {
      valid: true,
      status: "CONTINUE",
      next: exactAction,
      completionEvidence: "",
      turnId: "turn-df609fac-ddb9-4a26-88f9-d67d49e781c7"
    }
  },
  continuityProjection: projection,
  maxAutonomousMode: true,
  requestMode: "CONTINUATION_ANALYSIS"
});

const grounding = validateDecisionGrounding(decision, projection);
assert.equal(grounding.valid, true, grounding.errors.join(", "));

let request = {
  requestId: "nano-request-runtime-incident",
  observationId: "observation-runtime-incident",
  status: "DETERMINISTIC_PENDING",
  deterministicDispatchState: "ARMED",
  deterministicDispatchAttempts: 0,
  deterministicScheduledAt: null
};

const initialGate = evaluateDeterministicDispatch(request, { now: 1_000 });
assert.equal(initialGate.action, DETERMINISTIC_GATE_ACTIONS.SCHEDULE);
request = prepareDeterministicDispatch(request, {
  decisionDigest: "incident-decision",
  now: 1_000
});

let scheduleCount = 1;
let waitCount = 0;
let recoverCount = 0;

// Reproduce the observed revision count pressure without allowing writes/schedules.
for (let tick = 0; tick < 6_224; tick += 1) {
  const gate = evaluateDeterministicDispatch(request, {
    now: 1_001 + Math.floor((tick / 6_224) * 14_900)
  });
  if (gate.action === DETERMINISTIC_GATE_ACTIONS.SCHEDULE) scheduleCount += 1;
  if (gate.action === DETERMINISTIC_GATE_ACTIONS.WAIT) waitCount += 1;
  if (gate.action === DETERMINISTIC_GATE_ACTIONS.RECOVER) recoverCount += 1;
}

assert.equal(scheduleCount, 1);
assert.equal(waitCount, 6_224);
assert.equal(recoverCount, 0);

const retryGate = evaluateDeterministicDispatch(request, { now: 16_001 });
assert.equal(retryGate.action, DETERMINISTIC_GATE_ACTIONS.SCHEDULE);
request = prepareDeterministicDispatch(request, {
  decisionDigest: "incident-decision",
  now: 16_001
});
scheduleCount += 1;

const exhaustedGate = evaluateDeterministicDispatch(request, { now: 31_002 });
assert.equal(exhaustedGate.action, DETERMINISTIC_GATE_ACTIONS.RECOVER);
recoverCount += 1;

console.log(JSON.stringify({
  result: "PASS",
  exactActionGrounded: true,
  simulatedTicks: 6_224,
  scheduleCount,
  waitCount,
  recoverCount,
  finalGate: exhaustedGate.action,
  expectedRuntimeEffect:
    "One callback lease, no revision writes during 6224 same-request ticks, bounded recovery after two expired attempts."
}, null, 2));
