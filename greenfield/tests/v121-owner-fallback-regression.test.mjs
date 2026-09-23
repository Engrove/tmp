import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  advanceResponseCandidate,
  classifyResponseObservation
} from "../lib/response-stability.mjs";
import {
  autonomousResponseObservation,
  externalAssistantInterleaveEvidence
} from "../lib/turn-causality.mjs";

const fixture = JSON.parse(fs.readFileSync(
  new URL("./fixtures/v1.2.0-owner-untrusted-loop.json", import.meta.url),
  "utf8"
));
const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");

test("captured v1.2.0 FORENSIC/Audit loop observation has an exact visible causal fallback path in v1.2.1", () => {
  const observation = fixture.observation;
  const quality = classifyResponseObservation(observation);
  assert.equal(quality.admissible, true);
  assert.equal(quality.ownerAdmissionMode, fixture.v121Expected.admissionMode);

  let candidate = null;
  for (const now of [0, 1250, 2500, 3750, 5000]) {
    const result = advanceResponseCandidate(candidate, observation, {
      now,
      minStableMs: 2500,
      minStableReads: 3
    });
    candidate = result.candidate;
  }
  const result = advanceResponseCandidate(candidate, observation, {
    now: 5250,
    minStableMs: 2500,
    minStableReads: 3
  });
  assert.equal(result.complete, true);
  assert.equal(result.reason, fixture.v121Expected.terminalReason);
  assert.equal(result.requiredStableMs, fixture.v121Expected.minimumStableMs);
  assert.equal(result.requiredStableReads, fixture.v121Expected.minimumStableReads);
});

test("v1.2.1 causal fallback still selects the assistant inside the dispatched user-turn slot, not a later manual pair", () => {
  const process = {
    lastPrompt: {
      dispatchedUserTurnId: "auto-user",
      dispatchedUserTurnIndex: 0
    }
  };
  const page = {
    documentId: "doc-1",
    assistantCount: 2,
    lastUserId: "manual-user",
    lastAssistantId: "manual-assistant",
    assistantHash: "manual-hash",
    autonomousTurn: {
      expectedUserTurnId: "auto-user",
      expectedUserIndex: 0,
      resolvedUserTurnId: "auto-user",
      resolvedBy: "USER_TURN_ID",
      assistantFound: true,
      assistantId: "auto-assistant",
      assistantOwnerKind: "ROLE_NODE_FALLBACK",
      assistantOwnerTrusted: false,
      assistantReplicaCount: 1,
      assistantText: "autonomous stable response",
      assistantTextLength: "autonomous stable response".length,
      assistantHash: "auto-hash",
      assistantGenerating: false,
      assistantSignals: { visibilityState: "visible" },
      nextUserTurnId: "manual-user",
      responseSlotClosed: false
    }
  };

  const resolved = autonomousResponseObservation(process, page);
  assert.equal(resolved.ready, true);
  assert.equal(resolved.observation.lastAssistantId, "auto-assistant");
  assert.equal(resolved.observation.pairedUserTurnId, "auto-user");
  assert.equal(resolved.observation.pairedUserResolvedBy, "USER_TURN_ID");
  const interleave = externalAssistantInterleaveEvidence(page, resolved.observation);
  assert.equal(interleave.observed, true);
  assert.equal(interleave.latestAssistantTurnId, "manual-assistant");
  assert.equal(interleave.admissibleAsAutonomousResponse, false);

  const quality = classifyResponseObservation(resolved.observation);
  assert.equal(quality.admissible, true);
  assert.equal(quality.ownerAdmissionMode, "CAUSAL_VISIBLE_FALLBACK");
});

test("v1.2.1 response slot closure cannot be bypassed by a fallback-owned assistant", () => {
  const observation = {
    ...fixture.observation,
    responseSlotClosed: true,
    nextUserTurnId: "manual-user"
  };
  const quality = classifyResponseObservation(observation);
  assert.equal(quality.admissible, false);
  assert.equal(quality.reason, "OBSERVATION_OWNER_UNTRUSTED");
});

test("v1.2.1 source includes coherent renderer-replica ownership and idempotent overlay sync", () => {
  assert.match(content, /COHERENT_ROLE_REPLICA/);
  assert.match(content, /coherentRoleReplicaSet/);
  assert.match(content, /stableEntryIndex/);
  assert.match(content, /if \(root\.textContent === nextText && root\.title === nextTitle\) return false/);
  assert.match(background, /RESPONSE_CAUSAL_FALLBACK_ADMITTED/);
  assert.match(background, /overlayResult\?\.changed !== false/);
  assert.match(background, /reason !== "observation"/);
});
