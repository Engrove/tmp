import test from "node:test";
import assert from "node:assert/strict";
import { autonomousResponseObservation, expectedAutonomousUserTurn, isExternalAssistantInterleaved } from "../lib/turn-causality.mjs";

const process = {
  lastPrompt: {
    dispatchedUserTurnId: "auto-user",
    dispatchedUserTurnIndex: 3
  }
};

function page(patch = {}) {
  return {
    documentId: "doc-1",
    assistantCount: 5,
    lastUserId: "manual-user",
    lastAssistantId: "manual-assistant",
    autonomousTurn: {
      expectedUserTurnId: "auto-user",
      expectedUserIndex: 3,
      resolvedUserTurnId: "auto-user",
      resolvedBy: "USER_TURN_ID",
      assistantFound: true,
      assistantId: "auto-assistant",
      assistantOwnerKind: "EXPLICIT_TURN_SHELL",
      assistantOwnerTrusted: true,
      assistantText: "autonomous response",
      assistantTextLength: 19,
      assistantHash: "auto-hash",
      assistantGenerating: false,
      assistantSignals: { visibilityState: "visible" }
    },
    ...patch
  };
}

test("expected autonomous user turn is persisted from dispatch identity", () => {
  assert.deepEqual(expectedAutonomousUserTurn(process), { id: "auto-user", index: 3 });
});

test("manual latest assistant cannot replace the causally paired autonomous assistant", () => {
  const p = page();
  const r = autonomousResponseObservation(process, p);
  assert.equal(r.ready, true);
  assert.equal(r.observation.expectedUserTurnId, "auto-user");
  assert.equal(r.observation.pairedUserTurnId, "auto-user");
  assert.equal(r.observation.lastAssistantId, "auto-assistant");
  assert.equal(r.observation.assistantText, "autonomous response");
  assert.equal(isExternalAssistantInterleaved(p, r.observation), true);
});

test("mismatched resolved user turn is non-admissible", () => {
  const p = page({
    autonomousTurn: {
      ...page().autonomousTurn,
      resolvedUserTurnId: "manual-user"
    }
  });
  const r = autonomousResponseObservation(process, p);
  assert.equal(r.ready, false);
  assert.equal(r.reason, "AUTONOMOUS_USER_TURN_ID_MISMATCH");
});

test("ordinal fallback can reconcile a missing persisted user-turn id without assuming latest turn", () => {
  const byIndex = { lastPrompt: { dispatchedUserTurnId: "", dispatchedUserTurnIndex: 3 } };
  const p = page({
    autonomousTurn: {
      ...page().autonomousTurn,
      expectedUserTurnId: "",
      resolvedBy: "USER_ORDINAL"
    }
  });
  const r = autonomousResponseObservation(byIndex, p);
  assert.equal(r.ready, true);
  assert.equal(r.observation.expectedUserTurnId, "auto-user");
  assert.equal(r.observation.pairedUserTurnId, "auto-user");
  assert.equal(r.observation.pairedUserResolvedBy, "USER_ORDINAL");
});
