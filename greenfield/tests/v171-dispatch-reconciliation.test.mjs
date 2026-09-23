import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  autonomousResponseObservation,
  autonomousUserTurnProof,
  expectedAutonomousUserTurn
} from "../lib/turn-causality.mjs";
import { reconcileDispatchObservation } from "../lib/dispatch-reconciliation.mjs";
import { recoveryProof } from "../lib/restart-recovery.mjs";
import { reconcileRecoveryReportWithLiveObservation } from "../lib/recovery-report.mjs";
import { sendFenceDecision } from "../lib/send-fence.mjs";
import { queueAfterResponseAction, QUEUE_AFTER_RESPONSE } from "../lib/queue-control-policy.mjs";

function sendingProcess({
  promptHash = "dispatch-prompt-hash",
  materializedUserTurnId = "",
  materializedUserTurnIndex = null,
  baselineUserCount = 0,
  effectPossible = true,
  acknowledged = true
} = {}) {
  return {
    phase: "SENDING",
    lastManagedUrl: "https://chatgpt.com/g/g-test-eic/c/conversation-1",
    pendingPrompt: {
      text: "A bounded autonomous prompt",
      hash: promptHash,
      dispatch: {
        operationId: "dispatch-1",
        status: acknowledged ? "ACKNOWLEDGED" : "TRANSPORT_UNKNOWN",
        effectPossible,
        acknowledged,
        baselineUserCount,
        materializedUserTurnId,
        materializedUserTurnIndex
      }
    }
  };
}

function observedPage({
  userTurnId = "runtime-user-turn",
  userTurnIndex = 0,
  renderedUserHash = "runtime-rendered-hash",
  resolvedBy = "USER_ORDINAL",
  assistantFound = true
} = {}) {
  return {
    url: "https://chatgpt.com/g/g-test-eic/c/conversation-1",
    userCount: userTurnIndex + 1,
    assistantCount: assistantFound ? 1 : 0,
    lastUserId: userTurnId,
    lastUserHash: renderedUserHash,
    lastAssistantId: assistantFound ? "runtime-assistant-turn" : "",
    lastAssistantOwnerTrusted: assistantFound,
    generating: false,
    autonomousTurn: {
      expectedUserTurnId: resolvedBy === "USER_TURN_ID" ? userTurnId : "",
      expectedUserIndex: userTurnIndex,
      resolvedUserTurnId: userTurnId,
      resolvedBy,
      userTextHash: renderedUserHash,
      assistantFound,
      assistantId: assistantFound ? "runtime-assistant-turn" : "",
      assistantOwnerKind: assistantFound ? "EXPLICIT_TURN_SHELL" : "NONE",
      assistantOwnerTrusted: assistantFound,
      assistantReplicaCount: assistantFound ? 1 : 0,
      assistantText: assistantFound ? "runtime response" : "",
      assistantTextLength: assistantFound ? 16 : 0,
      assistantHash: assistantFound ? "runtime-assistant-hash" : "",
      assistantGenerating: false,
      assistantSignals: {}
    }
  };
}

test("v1.7.1 pending dispatch materialization is a first-class autonomous turn identity", () => {
  const process = sendingProcess({
    materializedUserTurnId: "turn-from-content",
    materializedUserTurnIndex: 4,
    baselineUserCount: 4
  });
  assert.deepEqual(expectedAutonomousUserTurn(process), {
    id: "turn-from-content",
    index: 4
  });
});

test("v1.7.1 acknowledged v1.7.0 dispatch can recover its dynamic ordinal from baselineUserCount", () => {
  const acknowledged = sendingProcess({ baselineUserCount: 3, effectPossible: true, acknowledged: true });
  assert.deepEqual(expectedAutonomousUserTurn(acknowledged), { id: "", index: 3 });

  const unknownEffect = sendingProcess({ baselineUserCount: 3, effectPossible: null, acknowledged: false });
  assert.deepEqual(expectedAutonomousUserTurn(unknownEffect), { id: "", index: null });
});

test("v1.7.1 exact materialized turn identity wins over a different rendered-text hash", () => {
  const process = sendingProcess({
    materializedUserTurnId: "runtime-user-turn",
    materializedUserTurnIndex: 0
  });
  const page = observedPage({
    userTurnId: "runtime-user-turn",
    renderedUserHash: "different-from-dispatch-hash",
    resolvedBy: "USER_TURN_ID"
  });
  const proof = autonomousUserTurnProof(process, page);
  assert.equal(proof.ok, true);
  assert.equal(proof.code, "AUTONOMOUS_USER_TURN_ID_MATCH");

  const decision = reconcileDispatchObservation(process, page);
  assert.equal(decision.action, "ADVANCE_TO_WAITING");
  assert.equal(decision.resolvedUserTurnId, "runtime-user-turn");
  assert.equal(decision.resolvedUserTurnIndex, 0);
});

test("v1.7.1 exact materialized id mismatch is rejected even if a legacy text hash happens to match", () => {
  const process = sendingProcess({
    promptHash: "same-hash",
    materializedUserTurnId: "expected-turn",
    materializedUserTurnIndex: 0
  });
  const page = observedPage({
    userTurnId: "different-turn",
    renderedUserHash: "same-hash",
    resolvedBy: "USER_TURN_ID"
  });
  page.autonomousTurn.expectedUserTurnId = "expected-turn";

  const proof = autonomousUserTurnProof(process, page);
  assert.equal(proof.ok, false);
  assert.equal(proof.code, "AUTONOMOUS_USER_TURN_ID_MISMATCH");
  assert.equal(reconcileDispatchObservation(process, page).action, "HOLD_UNRESOLVED");
});

test("v1.7.1 acknowledged dispatch uses ordinal causality instead of requiring rendered-text identity", () => {
  const process = sendingProcess({
    promptHash: "original-dispatch-hash",
    baselineUserCount: 0,
    materializedUserTurnId: "",
    materializedUserTurnIndex: null,
    effectPossible: true,
    acknowledged: true
  });
  const page = observedPage({
    userTurnId: "observed-from-dom",
    userTurnIndex: 0,
    renderedUserHash: "different-rendered-hash",
    resolvedBy: "USER_ORDINAL"
  });

  const proof = autonomousUserTurnProof(process, page);
  assert.equal(proof.ok, true);
  assert.equal(proof.code, "AUTONOMOUS_USER_TURN_ORDINAL_MATCH");

  const response = autonomousResponseObservation(process, page);
  assert.equal(response.ready, true);
  assert.equal(response.observation.pairedUserTurnId, "observed-from-dom");

  const decision = reconcileDispatchObservation(process, page);
  assert.equal(decision.action, "ADVANCE_TO_WAITING");
  assert.equal(decision.resolvedUserTurnId, "observed-from-dom");
});

test("v1.7.1 unknown dispatch effect cannot use baseline ordinal as proof", () => {
  const process = sendingProcess({
    baselineUserCount: 0,
    effectPossible: null,
    acknowledged: false
  });
  const page = observedPage({
    userTurnId: "unattributed-user-turn",
    userTurnIndex: 0,
    renderedUserHash: "not-the-prompt-hash",
    resolvedBy: "USER_ORDINAL"
  });
  const proof = autonomousUserTurnProof(process, page);
  assert.equal(proof.ok, false);
  assert.equal(proof.code, "AUTONOMOUS_USER_TURN_EXPECTATION_MISSING");
});

test("v1.7.1 send fence recognizes a materialized browser turn without comparing prompt text", () => {
  const process = sendingProcess({
    materializedUserTurnId: "runtime-user-turn",
    materializedUserTurnIndex: 0
  });
  const page = observedPage({
    userTurnId: "runtime-user-turn",
    renderedUserHash: "different-rendered-hash",
    resolvedBy: "USER_TURN_ID"
  });
  const fence = sendFenceDecision(process.pendingPrompt, page);
  assert.equal(fence.action, "WAIT_NO_RESEND");
  assert.equal(fence.evidence, "MATERIALIZED_USER_TURN_ID");
  assert.equal(fence.acknowledged, true);
});

test("v1.7.1 restart recovery accepts the exact conversation and materialized turn despite text rendering differences", () => {
  const process = sendingProcess({
    promptHash: "original-dispatch-hash",
    materializedUserTurnId: "runtime-user-turn",
    materializedUserTurnIndex: 0
  });
  const page = observedPage({
    userTurnId: "runtime-user-turn",
    renderedUserHash: "different-rendered-hash",
    resolvedBy: "USER_TURN_ID"
  });
  const proof = recoveryProof(process, page, { url: process.lastManagedUrl });
  assert.equal(proof.ok, true);
  assert.equal(proof.code, "CONVERSATION_AND_USER_TURN_MATCH");
  assert.equal(proof.turnProof, "AUTONOMOUS_USER_TURN_ID_MATCH");
});

test("v1.7.1 restart recovery can resolve an acknowledged pre-1.7.1 dispatch by persisted ordinal", () => {
  const process = sendingProcess({
    promptHash: "original-dispatch-hash",
    baselineUserCount: 0,
    materializedUserTurnId: "",
    materializedUserTurnIndex: null,
    effectPossible: true,
    acknowledged: true
  });
  const page = observedPage({
    userTurnId: "runtime-user-turn",
    renderedUserHash: "different-rendered-hash",
    resolvedBy: "USER_ORDINAL"
  });
  const proof = recoveryProof(process, page, { url: process.lastManagedUrl });
  assert.equal(proof.ok, true);
  assert.equal(proof.code, "CONVERSATION_AND_USER_TURN_MATCH");
  assert.equal(proof.turnProof, "AUTONOMOUS_USER_TURN_ORDINAL_MATCH");
});



test("v1.7.1 dispatch reconciliation is identity-generic across runtime-generated turn ids", () => {
  for (let index = 0; index < 32; index += 1) {
    const userTurnId = randomUUID();
    const process = sendingProcess({
      promptHash: randomUUID(),
      materializedUserTurnId: userTurnId,
      materializedUserTurnIndex: index,
      baselineUserCount: index
    });
    const page = observedPage({
      userTurnId,
      userTurnIndex: index,
      renderedUserHash: randomUUID(),
      resolvedBy: "USER_TURN_ID",
      assistantFound: true
    });
    page.autonomousTurn.expectedUserTurnId = userTurnId;
    page.autonomousTurn.expectedUserIndex = index;

    const decision = reconcileDispatchObservation(process, page);
    assert.equal(decision.action, "ADVANCE_TO_WAITING");
    assert.equal(decision.resolvedUserTurnId, userTurnId);
    assert.equal(decision.resolvedUserTurnIndex, index);
  }
});



test("v1.7.1 a live exact conversation clears a stale missing-tab recovery row", () => {
  const process = {
    ...sendingProcess({
      materializedUserTurnId: "runtime-user-turn",
      materializedUserTurnIndex: 0
    }),
    workerId: "worker-live",
    processId: "process-live",
    goal: "Continue queue work"
  };
  const page = observedPage({
    userTurnId: "runtime-user-turn",
    userTurnIndex: 0,
    resolvedBy: "USER_TURN_ID"
  });
  const report = {
    atMs: 1,
    restored: [],
    unresolved: [{
      workerId: "worker-live",
      processId: "process-live",
      code: "CONVERSATION_TAB_NOT_RESTORED",
      goal: "Continue queue work"
    }],
    errors: []
  };

  const next = reconcileRecoveryReportWithLiveObservation(report, process, page, 2000);
  assert.equal(next.unresolved.length, 0);
  assert.equal(next.restored.length, 1);
  assert.equal(next.restored[0].code, "LIVE_OBSERVATION_RECOVERY_RESOLVED");
  assert.equal(next.restored[0].priorCode, "CONVERSATION_TAB_NOT_RESTORED");
});

test("v1.7.1 ambiguous conversation recovery is not hidden by one live observation", () => {
  const process = {
    ...sendingProcess(),
    workerId: "worker-ambiguous",
    processId: "process-ambiguous"
  };
  const page = observedPage();
  const report = {
    atMs: 1,
    restored: [],
    unresolved: [{
      workerId: "worker-ambiguous",
      processId: "process-ambiguous",
      code: "AMBIGUOUS_CONVERSATION"
    }],
    errors: []
  };
  const next = reconcileRecoveryReportWithLiveObservation(report, process, page, 2000);
  assert.equal(next, report);
  assert.equal(next.unresolved.length, 1);
});

test("v1.7.1 unresolved prior-turn recovery clears only when current live turn proof resolves", () => {
  const process = {
    ...sendingProcess({
      materializedUserTurnId: "expected-user-turn",
      materializedUserTurnIndex: 0
    }),
    workerId: "worker-turn",
    processId: "process-turn"
  };
  const report = {
    atMs: 1,
    restored: [],
    unresolved: [{
      workerId: "worker-turn",
      processId: "process-turn",
      code: "RECOVERY_USER_TURN_UNPROVEN"
    }],
    errors: []
  };

  const wrong = observedPage({
    userTurnId: "different-user-turn",
    userTurnIndex: 0,
    resolvedBy: "USER_TURN_ID"
  });
  wrong.autonomousTurn.expectedUserTurnId = "expected-user-turn";
  assert.equal(
    reconcileRecoveryReportWithLiveObservation(report, process, wrong, 2000).unresolved.length,
    1
  );

  const exact = observedPage({
    userTurnId: "expected-user-turn",
    userTurnIndex: 0,
    resolvedBy: "USER_TURN_ID"
  });
  const resolved = reconcileRecoveryReportWithLiveObservation(report, process, exact, 3000);
  assert.equal(resolved.unresolved.length, 0);
  assert.equal(resolved.restored[0].turnProof, "AUTONOMOUS_USER_TURN_ID_MATCH");
});

test("v1.7.1 BACKGROUND_SLEEP remains a worker-yield action for queue-managed missions", () => {
  assert.equal(queueAfterResponseAction({
    queueManaged: true,
    queueQuantumReached: false,
    sessionAction: "BACKGROUND_SLEEP"
  }), QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH);
});
