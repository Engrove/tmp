import test from "node:test";
import assert from "node:assert/strict";
import {
  isMetaOnlyAction,
  validateDecisionGrounding
} from "../lib/decision-grounding.mjs";
import { buildDeterministicDecision } from "../lib/fallback-planner.mjs";
import {
  NANO_ANALYSIS_MODES,
  NANO_DECISION_SOURCE,
  completeNanoRequestState,
  createNanoRequest
} from "../lib/nano-pipeline.mjs";
import {
  markDeterministicPending,
  preservedProtocolPageMatch,
  preservedProtocolRecoveryEligible,
  protocolFastPathEligible
} from "../lib/protocol-fast-path.mjs";
import { resolveAutonomousPause } from "../lib/destructiveness.mjs";

const INCIDENT_NEXT = "Utför owner-approved trusted-session handoff för cwp_wp2524_publication_recovery och dess publication job/request locator; läs därefter workspace.forgejo.publish.status med verify_remote=true.";

function continuityProjection() {
  return {
    intent: "Slutför EIC backend WP25.",
    position: { workUnit: "Publication recovery" },
    verifiedFacts: [],
    targetClaims: [{ claim: "Generation 48 är terminaliserad." }],
    inferences: []
  };
}

test("exakt v0.6.1-runtimeåtgärd är konkret och inte META_ONLY_ACTION", () => {
  assert.equal(isMetaOnlyAction(INCIDENT_NEXT), false);
  const grounding = validateDecisionGrounding({
    action: "CONTINUE",
    taskIntent: "Slutför EIC backend WP25.",
    workUnit: "Publication recovery",
    requestedAction: INCIDENT_NEXT,
    targetClaims: ["Generation 48 är terminaliserad."],
    inferences: [],
    contextEvidence: ["EIC_TURN: turn-ff4847b1-3a5f-4743-b854-87601aa98e75"],
    requiredEvidence: ["workspace.forgejo.publish.status verify_remote=true"]
  }, continuityProjection());
  assert.equal(grounding.valid, true);
  assert.deepEqual(grounding.errors, []);
});

test("giltig turn-bunden CONTINUE går direkt genom protocol fast path", () => {
  const targetResult = {
    valid: true,
    reason: "OK",
    status: "CONTINUE",
    next: INCIDENT_NEXT,
    completionEvidence: "UNIT_DONE · Den föregående bounded enheten är klar.",
    completionState: "UNIT_DONE",
    turnId: "turn-ff4847b1-3a5f-4743-b854-87601aa98e75"
  };
  assert.equal(protocolFastPathEligible(targetResult), true);
  const decision = buildDeterministicDecision({
    run: {
      targetTabId: 1974093336,
      conversationKey: "chatgpt.com:c:6a6d9e55-5aa8-83eb-a3d7-773d1bab5d0a",
      maxAutonomousMode: true
    },
    observation: { targetResult },
    continuityProjection: continuityProjection(),
    maxAutonomousMode: true,
    requestMode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS
  });
  assert.equal(decision.action, "CONTINUE");
  assert.equal(decision.requestedAction, INCIDENT_NEXT);
  assert.ok(decision.destructivenessLevel < 10);
});

test("importerad v0.6.1-stuck state återköas över content-epoch-byte", () => {
  const targetResult = {
    valid: true,
    reason: "OK",
    status: "CONTINUE",
    next: INCIDENT_NEXT,
    completionEvidence: "UNIT_DONE · Den föregående bounded enheten är klar.",
    completionState: "UNIT_DONE",
    turnId: "turn-ff4847b1-3a5f-4743-b854-87601aa98e75"
  };
  const run = {
    conversationKey: "chatgpt.com:c:6a6d9e55-5aa8-83eb-a3d7-773d1bab5d0a",
    currentTurn: {
      turnId: "turn-ff4847b1-3a5f-4743-b854-87601aa98e75",
      effectState: "ACKED"
    }
  };
  const observation = {
    responseHash: "754013f72b327e5653a5ba0462f3ed70c90e48e8558b938f535cd5f7a788da6b",
    documentEpoch: "old-v061-epoch",
    targetResult
  };
  const page = {
    latestAssistantComplete: true,
    latestAssistantHash: observation.responseHash,
    documentEpoch: "new-v062-epoch",
    conversationKey: run.conversationKey
  };
  const pageMatches = preservedProtocolPageMatch({ run, observation, page });
  assert.equal(pageMatches, true);
  assert.equal(preservedProtocolRecoveryEligible({
    pendingNanoRequest: null,
    targetResult,
    pageMatches,
    humanPause: false
  }), true);
  assert.equal(preservedProtocolRecoveryEligible({
    pendingNanoRequest: null,
    targetResult,
    pageMatches,
    humanPause: true
  }), false);
});


test("cross-epoch recovery kräver exakt conversation, hash, turn och ACKED effect", () => {
  const targetResult = {
    valid: true,
    status: "CONTINUE",
    next: INCIDENT_NEXT,
    completionEvidence: "UNIT_DONE · Den föregående bounded enheten är klar.",
    completionState: "UNIT_DONE",
    turnId: "turn-correct"
  };
  const observation = {
    responseHash: "hash-correct",
    documentEpoch: "epoch-old",
    targetResult
  };
  const baseRun = {
    conversationKey: "chatgpt.com:c:correct",
    currentTurn: { turnId: "turn-correct", effectState: "ACKED" }
  };
  const basePage = {
    latestAssistantComplete: true,
    latestAssistantHash: "hash-correct",
    documentEpoch: "epoch-new",
    conversationKey: "chatgpt.com:c:correct"
  };
  assert.equal(preservedProtocolPageMatch({ run: baseRun, observation, page: basePage }), true);
  assert.equal(preservedProtocolPageMatch({
    run: baseRun,
    observation,
    page: { ...basePage, conversationKey: "chatgpt.com:c:wrong" }
  }), false);
  assert.equal(preservedProtocolPageMatch({
    run: baseRun,
    observation,
    page: { ...basePage, latestAssistantHash: "hash-wrong" }
  }), false);
  assert.equal(preservedProtocolPageMatch({
    run: { ...baseRun, currentTurn: { turnId: "turn-wrong", effectState: "ACKED" } },
    observation,
    page: basePage
  }), false);
  assert.equal(preservedProtocolPageMatch({
    run: { ...baseRun, currentTurn: { turnId: "turn-correct", effectState: "PREPARED" } },
    observation,
    page: basePage
  }), false);
});

test("deterministic protocol completion kräver matchande pending source", () => {
  const base = createNanoRequest({
    requestId: "nano-request-incident",
    observationId: "observation-incident",
    mode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS,
    now: 1000
  });
  const pending = markDeterministicPending(
    base,
    NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL
  );
  const accepted = completeNanoRequestState(pending, {
    source: NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL,
    now: 1100
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.request.decisionSource, NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL);

  const rejected = completeNanoRequestState(pending, {
    source: NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY,
    now: 1100
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "RECOVERY_FAST_PATH_NOT_PENDING");
});

test("recoverable PAUS under nivå 10 omvandlas till CONTINUE", () => {
  const targetResult = {
    valid: true,
    status: "PAUSE",
    next: "Återläs workspace.lock.status och fortsätt när locks=[] ger owner-readback.",
    completionEvidence: ""
  };
  const decision = buildDeterministicDecision({
    run: { targetTabId: 1, conversationKey: "chatgpt.com:c:test", maxAutonomousMode: true },
    observation: { targetResult },
    continuityProjection: continuityProjection(),
    maxAutonomousMode: true
  });
  assert.equal(decision.action, "PAUSE");
  assert.ok(decision.destructivenessLevel < 10);
  const disposition = resolveAutonomousPause({
    decision,
    targetResult,
    assessment: {
      level: decision.destructivenessLevel,
      humanDecisionRequired: false,
      rationale: decision.destructivenessRationale
    },
    control: { verdict: "NOT_REQUIRED" }
  });
  assert.equal(disposition.action, "CONTINUE");
  assert.match(disposition.requestedAction, /workspace\.lock\.status/);
});

test("nivå 10 förblir verklig PAUS", () => {
  const targetResult = {
    valid: true,
    status: "PAUSE",
    next: "Logga in, lös CAPTCHA och lämna användarens credentials.",
    completionEvidence: ""
  };
  const decision = buildDeterministicDecision({
    run: { targetTabId: 1, conversationKey: "chatgpt.com:c:test", maxAutonomousMode: true },
    observation: { targetResult },
    continuityProjection: continuityProjection(),
    maxAutonomousMode: true
  });
  assert.equal(decision.action, "PAUSE");
  assert.equal(decision.destructivenessLevel, 10);
});
