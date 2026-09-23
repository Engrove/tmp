import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceResponseCandidate,
  assistantLifecycleStatusText,
  classifyResponseObservation
} from "../lib/response-stability.mjs";

function trusted(patch = {}) {
  return {
    documentId: "doc-1",
    lastAssistantId: "turn-1",
    lastAssistantOwnerKind: "EXPLICIT_TURN_SHELL",
    lastAssistantOwnerTrusted: true,
    assistantCount: 3,
    expectedUserTurnId: "user-1",
    pairedUserTurnId: "user-1",
    assistantHash: "h1",
    assistantText: "done",
    generating: false,
    signals: { visibilityState: "visible" },
    ...patch
  };
}

test("complete response requires repeated stable reads of one trusted document/message identity", () => {
  const obs = trusted();
  let r = advanceResponseCandidate(null, obs, { now: 0, minStableMs: 2500, minStableReads: 3 });
  assert.equal(r.complete, false);
  r = advanceResponseCandidate(r.candidate, obs, { now: 1200, minStableMs: 2500, minStableReads: 3 });
  assert.equal(r.complete, false);
  r = advanceResponseCandidate(r.candidate, obs, { now: 2600, minStableMs: 2500, minStableReads: 3 });
  assert.equal(r.complete, true);
  assert.equal(r.reason, "STABLE_TERMINAL_RESPONSE");
  assert.equal(r.candidate.documentId, "doc-1");
  assert.equal(r.candidate.messageId, "turn-1");
});

test("changed document/message/hash/count starts a new candidate instead of mixing states", () => {
  let r = advanceResponseCandidate(null, trusted({ assistantHash: "a", assistantText: "partial" }), { now: 1000 });
  r = advanceResponseCandidate(r.candidate, trusted({
    documentId: "doc-2",
    lastAssistantId: "turn-2",
    assistantHash: "b",
    assistantText: "final",
    assistantCount: 4
  }), { now: 3000 });
  assert.equal(r.candidate.documentId, "doc-2");
  assert.equal(r.candidate.messageId, "turn-2");
  assert.equal(r.candidate.hash, "b");
  assert.equal(r.candidate.reads, 1);
  assert.equal(r.complete, false);
});

test("streaming response cannot complete", () => {
  const r = advanceResponseCandidate(
    null,
    trusted({ generating: true }),
    { now: 100000 }
  );
  assert.equal(r.complete, false);
  assert.equal(r.candidate, null);
  assert.equal(r.reason, "OBSERVATION_GENERATING");
});

test("untrusted role-node fragment never becomes terminal even when bytes repeat", () => {
  const fragment = trusted({
    lastAssistantId: "request-live-31",
    lastAssistantOwnerKind: "ROLE_NODE_FALLBACK",
    lastAssistantOwnerTrusted: false,
    assistantText: 'EIC sade:{\n"schema": "eic.a2a.response',
    assistantHash: "live-fragment",
    signals: { visibilityState: "hidden" }
  });
  let candidate = null;
  for (const now of [0, 914, 1828, 2744, 9000]) {
    const r = advanceResponseCandidate(candidate, fragment, {
      now,
      minStableMs: 2500,
      minStableReads: 3
    });
    assert.equal(r.complete, false);
    assert.equal(r.reason, "OBSERVATION_OWNER_UNTRUSTED");
    assert.equal(r.candidate, null);
    candidate = r.candidate;
  }
});



test("causal user-turn mismatch is held even when assistant ownership is structurally trusted", () => {
  const r = classifyResponseObservation(trusted({
    expectedUserTurnId: "auto-user",
    pairedUserTurnId: "manual-user"
  }));
  assert.equal(r.admissible, false);
  assert.equal(r.reason, "OBSERVATION_CAUSAL_PAIR_MISMATCH");
});

test("documentId and assistant owner trust are mandatory two-ended observation fields", () => {
  assert.equal(classifyResponseObservation(trusted({ documentId: "" })).reason,
    "OBSERVATION_DOCUMENT_ID_MISSING");
  assert.equal(classifyResponseObservation(trusted({ lastAssistantId: "" })).reason,
    "OBSERVATION_MESSAGE_ID_MISSING");
  assert.equal(classifyResponseObservation(trusted({ lastAssistantOwnerTrusted: false })).reason,
    "OBSERVATION_OWNER_UNTRUSTED");
  assert.equal(classifyResponseObservation(trusted({ assistantTextLength: 999 })).reason,
    "OBSERVATION_TEXT_LENGTH_MISMATCH");
});

test("v1.2.1 exact-ID visible causal fallback is admissible without making ROLE_NODE_FALLBACK generally trusted", () => {
  const obs = trusted({
    lastAssistantOwnerKind: "ROLE_NODE_FALLBACK",
    lastAssistantOwnerTrusted: false,
    pairedUserResolvedBy: "USER_TURN_ID",
    responseSlotClosed: false,
    signals: { visibilityState: "visible" }
  });
  const classified = classifyResponseObservation(obs);
  assert.equal(classified.admissible, true);
  assert.equal(classified.ownerAdmissionMode, "CAUSAL_VISIBLE_FALLBACK");
  assert.equal(classified.reason, "OBSERVATION_CAUSAL_VISIBLE_FALLBACK");
  assert.equal(classified.structuralOwnerTrusted, false);
});

test("v1.2.1 causal fallback requires five stable reads and at least five seconds", () => {
  const obs = trusted({
    lastAssistantOwnerKind: "ROLE_NODE_FALLBACK",
    lastAssistantOwnerTrusted: false,
    pairedUserResolvedBy: "USER_TURN_ID",
    responseSlotClosed: false,
    signals: { visibilityState: "visible" }
  });
  let candidate = null;
  for (const now of [0, 1200, 2400, 3600, 4800]) {
    const r = advanceResponseCandidate(candidate, obs, {
      now,
      minStableMs: 2500,
      minStableReads: 3
    });
    assert.equal(r.complete, false);
    assert.equal(r.reason, "STABILIZING_CAUSAL_FALLBACK");
    assert.equal(r.requiredStableMs, 5000);
    assert.equal(r.requiredStableReads, 5);
    candidate = r.candidate;
  }
  const done = advanceResponseCandidate(candidate, obs, {
    now: 5200,
    minStableMs: 2500,
    minStableReads: 3
  });
  assert.equal(done.complete, true);
  assert.equal(done.reason, "STABLE_TERMINAL_RESPONSE_CAUSAL_FALLBACK");
  assert.equal(done.observationQuality.ownerAdmissionMode, "CAUSAL_VISIBLE_FALLBACK");
});

test("v1.2.1 causal fallback remains fail-closed for hidden, ordinal, or closed response slots", () => {
  const base = {
    lastAssistantOwnerKind: "ROLE_NODE_FALLBACK",
    lastAssistantOwnerTrusted: false,
    pairedUserResolvedBy: "USER_TURN_ID",
    responseSlotClosed: false,
    signals: { visibilityState: "visible" }
  };
  assert.equal(
    classifyResponseObservation(trusted({ ...base, signals: { visibilityState: "hidden" } })).reason,
    "OBSERVATION_OWNER_UNTRUSTED"
  );
  assert.equal(
    classifyResponseObservation(trusted({ ...base, pairedUserResolvedBy: "USER_ORDINAL" })).reason,
    "OBSERVATION_OWNER_UNTRUSTED"
  );
  assert.equal(
    classifyResponseObservation(trusted({ ...base, responseSlotClosed: true, nextUserTurnId: "manual-user" })).reason,
    "OBSERVATION_OWNER_UNTRUSTED"
  );
});

test("v1.3.3 holds the exact 42-char hidden trusted canonical A2A prefix instead of terminalizing it", () => {
  const prefix = '{"schema":"eic.a2a.response.v1","status":"';
  assert.equal(prefix.length, 42);
  const obs = trusted({
    lastAssistantId: "request-WEB:live-prefix",
    assistantText: prefix,
    assistantTextLength: prefix.length,
    assistantHash: "prefix-42",
    signals: { visibilityState: "hidden" }
  });
  let candidate = null;
  for (const now of [0, 1200, 2600, 5200, 9000]) {
    const r = advanceResponseCandidate(candidate, obs, {
      now,
      minStableMs: 2500,
      minStableReads: 3
    });
    assert.equal(r.complete, false);
    assert.equal(r.reason, "OBSERVATION_CANONICAL_A2A_RESPONSE_INCOMPLETE");
    assert.equal(r.candidate, null);
    candidate = r.candidate;
  }
});

test("v1.3.3 still terminalizes a complete hidden trusted ROTATE_SESSION_NOW A2A response", () => {
  const response = JSON.stringify({
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    sessionAction: "ROTATE_SESSION_NOW",
    sessionReason: "fresh session required",
    summary: "continue",
    workPerformed: [],
    evidence: [],
    blockers: [],
    nextSuggestedAction: "rotate"
  });
  const obs = trusted({
    lastAssistantId: "request-WEB:live-complete",
    assistantText: response,
    assistantTextLength: response.length,
    assistantHash: "complete-rotate",
    signals: { visibilityState: "hidden" }
  });
  let r = advanceResponseCandidate(null, obs, { now: 0, minStableMs: 2500, minStableReads: 3 });
  assert.equal(r.complete, false);
  r = advanceResponseCandidate(r.candidate, obs, { now: 1200, minStableMs: 2500, minStableReads: 3 });
  assert.equal(r.complete, false);
  r = advanceResponseCandidate(r.candidate, obs, { now: 2600, minStableMs: 2500, minStableReads: 3 });
  assert.equal(r.complete, true);
  assert.equal(r.reason, "STABLE_TERMINAL_RESPONSE");
});

test("v1.3.3 leaves stable protocol-absent prose behavior unchanged", () => {
  const obs = trusted({
    assistantText: "Ordinary prose response without the A2A schema.",
    assistantHash: "ordinary-prose",
    signals: { visibilityState: "hidden" }
  });
  let r = advanceResponseCandidate(null, obs, { now: 0, minStableMs: 2500, minStableReads: 3 });
  r = advanceResponseCandidate(r.candidate, obs, { now: 1200, minStableMs: 2500, minStableReads: 3 });
  r = advanceResponseCandidate(r.candidate, obs, { now: 2600, minStableMs: 2500, minStableReads: 3 });
  assert.equal(r.complete, true);
  assert.equal(r.reason, "STABLE_TERMINAL_RESPONSE");
});



test("v1.3.8 lifecycle-only assistant chrome is never a terminal response even for a hidden trusted turn owner", () => {
  for (const fragment of [
    "Working...",
    "Tänker…",
    "Arbetade i 51 sekunder >",
    "Worked for 2m 54s"
  ]) {
    assert.equal(assistantLifecycleStatusText(fragment), true);
    const obs = trusted({
      lastAssistantId: "request-WEB:lifecycle",
      assistantText: fragment,
      assistantTextLength: fragment.length,
      assistantHash: `lifecycle-${fragment.length}`,
      signals: { visibilityState: "hidden" }
    });
    for (const now of [0, 1200, 2600, 9000]) {
      const r = advanceResponseCandidate(null, obs, {
        now,
        minStableMs: 2500,
        minStableReads: 3
      });
      assert.equal(r.complete, false);
      assert.equal(r.candidate, null);
      assert.equal(r.reason, "OBSERVATION_ASSISTANT_LIFECYCLE_ONLY");
    }
  }
});

test("v1.3.8 exact ten-character Working fragment cannot mask the later PAUSE_PROCESS control", () => {
  const fragment = "Working...";
  assert.equal(fragment.length, 10);
  const fragmentObs = trusted({
    lastAssistantId: "request-WEB:pause-cycle",
    assistantText: fragment,
    assistantTextLength: fragment.length,
    assistantHash: "working-10",
    signals: { visibilityState: "hidden" }
  });
  const held = advanceResponseCandidate(null, fragmentObs, {
    now: 0,
    minStableMs: 2500,
    minStableReads: 3
  });
  assert.equal(held.complete, false);
  assert.equal(held.candidate, null);
  assert.equal(held.reason, "OBSERVATION_ASSISTANT_LIFECYCLE_ONLY");

  const response = JSON.stringify({
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    sessionAction: "PAUSE_PROCESS",
    sessionReason: "Owner-driven checkpoint is five minutes away.",
    pauseSeconds: 300,
    summary: "cycle closed",
    workPerformed: [],
    evidence: [],
    blockers: [],
    nextSuggestedAction: "After 300 s, refresh owner state."
  });
  const completeObs = trusted({
    lastAssistantId: "request-WEB:pause-cycle",
    assistantText: response,
    assistantTextLength: response.length,
    assistantHash: "pause-300-full",
    signals: { visibilityState: "hidden" }
  });
  let r = advanceResponseCandidate(held.candidate, completeObs, {
    now: 100,
    minStableMs: 2500,
    minStableReads: 3
  });
  r = advanceResponseCandidate(r.candidate, completeObs, {
    now: 1400,
    minStableMs: 2500,
    minStableReads: 3
  });
  r = advanceResponseCandidate(r.candidate, completeObs, {
    now: 2700,
    minStableMs: 2500,
    minStableReads: 3
  });
  assert.equal(r.complete, true);
  assert.equal(r.reason, "STABLE_TERMINAL_RESPONSE");
});
