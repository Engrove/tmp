import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  autonomousResponseObservation,
  expectedAutonomousUserTurn
} from "../lib/turn-causality.mjs";
import { reconcileDispatchObservation } from "../lib/dispatch-reconciliation.mjs";
import { parseTargetResponse } from "../lib/response-contract.mjs";
import { buildHjalmarPrompt } from "../lib/hjalmar-d2.mjs";
import { evaluateContinuationAdmission } from "../lib/continuation-guard.mjs";
import { reconcileSafetyHoldWithFreshProof } from "../lib/safety-hold-reconciliation.mjs";
import {
  fleetWorkerDetailsKey,
  reconcileOpenFleetWorkerKeys
} from "../lib/panel-details-state.mjs";

function dynamicTurn(index) {
  return {
    userTurnId: randomUUID(),
    assistantTurnId: randomUUID(),
    promptHash: randomUUID().replaceAll("-", ""),
    renderedHash: randomUUID().replaceAll("-", ""),
    assistantHash: randomUUID().replaceAll("-", ""),
    index
  };
}

function pendingProcess({ prior, current }) {
  return {
    phase: "SENDING",
    turn: current.index + 1,
    lastPrompt: prior ? {
      hash: prior.promptHash,
      dispatchedUserTurnId: prior.userTurnId,
      dispatchedUserTurnIndex: prior.index,
      acknowledged: true
    } : null,
    pendingPrompt: {
      text: `prompt-${randomUUID()}`,
      hash: current.promptHash,
      dispatch: {
        operationId: randomUUID(),
        status: "ACKNOWLEDGED",
        effectPossible: true,
        acknowledged: true,
        baselineUserCount: current.index,
        materializedUserTurnId: current.userTurnId,
        materializedUserTurnIndex: current.index
      }
    }
  };
}

function observedCurrentPage(current) {
  return {
    userCount: current.index + 1,
    assistantCount: current.index + 1,
    lastUserId: current.userTurnId,
    lastUserHash: current.renderedHash,
    lastAssistantId: current.assistantTurnId,
    assistantHash: current.assistantHash,
    generating: false,
    autonomousTurn: {
      expectedUserTurnId: current.userTurnId,
      expectedUserIndex: current.index,
      resolvedUserTurnId: current.userTurnId,
      resolvedBy: "USER_TURN_ID",
      userTextHash: current.renderedHash,
      assistantFound: true,
      assistantId: current.assistantTurnId,
      assistantOwnerKind: "EXPLICIT_TURN_SHELL",
      assistantOwnerTrusted: true,
      assistantReplicaCount: 1,
      assistantText: `assistant-${randomUUID()}`,
      assistantTextLength: 46,
      assistantHash: current.assistantHash,
      assistantGenerating: false,
      assistantSignals: {}
    }
  };
}

test("v1.7.2 SENDING lifecycle ownership never inherits the prior turn when a current pending prompt exists", () => {
  for (let index = 1; index <= 64; index += 1) {
    const prior = dynamicTurn(index - 1);
    const current = dynamicTurn(index);
    const process = pendingProcess({ prior, current });
    assert.deepEqual(expectedAutonomousUserTurn(process), {
      id: current.userTurnId,
      index: current.index
    });
  }
});

test("v1.7.2 a pending prompt without dispatch evidence does not reuse historical lastPrompt identity", () => {
  const prior = dynamicTurn(0);
  const process = {
    phase: "SENDING",
    lastPrompt: {
      hash: prior.promptHash,
      dispatchedUserTurnId: prior.userTurnId,
      dispatchedUserTurnIndex: prior.index
    },
    pendingPrompt: {
      text: `prompt-${randomUUID()}`,
      hash: randomUUID().replaceAll("-", "")
    }
  };
  assert.deepEqual(expectedAutonomousUserTurn(process), { id: "", index: null });
});

test("v1.7.2 multi-turn dispatch reconciliation binds the current materialized browser turn, never N-1", () => {
  for (let index = 1; index <= 48; index += 1) {
    const prior = dynamicTurn(index - 1);
    const current = dynamicTurn(index);
    const process = pendingProcess({ prior, current });
    const page = observedCurrentPage(current);
    const decision = reconcileDispatchObservation(process, page);

    assert.equal(decision.action, "ADVANCE_TO_WAITING");
    assert.equal(decision.resolvedUserTurnId, current.userTurnId);
    assert.equal(decision.resolvedUserTurnIndex, current.index);
    assert.notEqual(decision.resolvedUserTurnId, prior.userTurnId);

    const waitingProcess = {
      phase: "WAITING",
      turn: process.turn,
      pendingPrompt: null,
      lastPrompt: {
        hash: current.promptHash,
        dispatchedUserTurnId: decision.resolvedUserTurnId,
        dispatchedUserTurnIndex: decision.resolvedUserTurnIndex,
        acknowledged: true
      }
    };
    const response = autonomousResponseObservation(waitingProcess, page);
    assert.equal(response.ready, true);
    assert.equal(response.observation.pairedUserTurnId, current.userTurnId);
    assert.equal(response.observation.lastAssistantId, current.assistantTurnId);
  }
});

test("v1.7.2 a canonical full A2A response is simultaneously full-schema valid and control-valid", () => {
  const next = `continue-${randomUUID()}`;
  const canonical = {
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    sessionAction: "KEEP",
    sessionReason: `reason-${randomUUID()}`,
    summary: `summary-${randomUUID()}`,
    workPerformed: [`work-${randomUUID()}`],
    evidence: [`evidence-${randomUUID()}`],
    blockers: [],
    nextSuggestedAction: next
  };
  const parsed = parseTargetResponse(JSON.stringify(canonical));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.controlOk, true);
  assert.equal(parsed.control.ok, true);
  assert.equal(parsed.control.status, "CONTINUE");
  assert.equal(parsed.control.nextSuggestedAction, next);
});

test("v1.7.2 Hjalmar keeps a bounded preview while declaring whether target continuation is complete", () => {
  const segments = Array.from({ length: 40 }, () => randomUUID());
  const completeNextAction = segments.join(" ");
  assert.ok(completeNextAction.length > 260);

  const prompt = buildHjalmarPrompt({
    goal: `goal-${randomUUID()}`,
    turn: 2,
    targetDisposition: "CONTINUE",
    currentObjective: `objective-${randomUUID()}`,
    targetResponse: {
      status: "CONTINUE",
      summary: `summary-${randomUUID()}`,
      blockers: [],
      nextSuggestedAction: completeNextAction
    }
  });

  assert.ok(prompt.length < 6000);
  assert.ok(prompt.includes('"nextSuggestedActionComplete":false'));
  assert.ok(prompt.includes('"nextSuggestedActionLength":'));
  assert.equal(prompt.includes(completeNextAction), false);
});

test("v1.7.2 continuation admission restores a complete target handoff when advisory nextPrompt is a strict prefix", () => {
  const head = Array.from({ length: 8 }, () => randomUUID()).join(" ");
  const tail = Array.from({ length: 8 }, () => randomUUID()).join(" ");
  const full = `${head} ${tail}`;
  const admission = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE",
    currentObjective: `objective-${randomUUID()}`,
    targetNextSuggestedAction: full,
    previousDecision: null,
    decision: {
      disposition: "CONTINUE",
      nextPrompt: head,
      nanoTaskAssessment: "NOT_REQUESTED"
    },
    nanoTask: null
  });

  assert.equal(admission.ok, true);
  assert.equal(admission.replanned, true);
  assert.equal(admission.code, "REPLANNED_LOSSY_TARGET_PREFIX");
  assert.equal(admission.effectiveNextPrompt, full);
});

test("v1.7.2 a fresh allowed model proof clears only the stale hold produced by the prior model proof", () => {
  const staleCode = `MODEL_${randomUUID()}`;
  const safety = {
    proof: { allowed: false, code: staleCode },
    hold: { code: staleCode, sinceMs: Date.now() - 1000 }
  };
  const cleared = reconcileSafetyHoldWithFreshProof(
    safety,
    { allowed: true, code: `MODEL_OK_${randomUUID()}` },
    null
  );
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.hold, null);

  const independentHoldCode = `DISPATCH_${randomUUID()}`;
  const independent = reconcileSafetyHoldWithFreshProof(
    {
      proof: { allowed: false, code: staleCode },
      hold: { code: independentHoldCode }
    },
    { allowed: true, code: `MODEL_OK_${randomUUID()}` },
    null
  );
  assert.equal(independent.cleared, false);
  assert.equal(independent.hold.code, independentHoldCode);
});

test("v1.7.2 fleet detail expansion follows stable process identity across refresh and row reorder", () => {
  const first = randomUUID();
  const second = randomUUID();
  const workersBefore = [
    { process: { processId: first, workerId: randomUUID() } },
    { process: { processId: second, workerId: randomUUID() } }
  ];
  const workersAfter = [workersBefore[1], workersBefore[0]];

  assert.equal(fleetWorkerDetailsKey(workersBefore[0]), first);
  const open = reconcileOpenFleetWorkerKeys(new Set([first]), workersAfter);
  assert.deepEqual([...open], [first]);

  const removed = reconcileOpenFleetWorkerKeys(new Set([first]), [workersBefore[1]]);
  assert.equal(removed.size, 0);
});
