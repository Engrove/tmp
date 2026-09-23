import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { advanceResponseCandidate } from "../lib/response-stability.mjs";
import { parseTargetResponse } from "../lib/response-contract.mjs";
import { resolveGreenfieldControl } from "../lib/greenfield-control.mjs";
import { isExplicitRotationAction } from "../lib/session-rotation.mjs";

const fixture = JSON.parse(fs.readFileSync(
  new URL("./fixtures/v1.3.3-live-hidden-trusted-a2a-prefix.json", import.meta.url),
  "utf8"
));

function observation(text, hash) {
  return {
    documentId: "doc-v133-live",
    lastAssistantId: "request-WEB:v133-live",
    lastAssistantOwnerKind: fixture.incident.ownerKind,
    lastAssistantOwnerTrusted: fixture.incident.ownerTrusted,
    assistantCount: 3,
    expectedUserTurnId: "autonomous-user-v133",
    pairedUserTurnId: "autonomous-user-v133",
    assistantHash: hash,
    assistantText: text,
    assistantTextLength: text.length,
    generating: false,
    signals: { visibilityState: fixture.incident.visibilityState }
  };
}

test("v1.3.3 live regression: 42-char hidden trusted canonical prefix is held before parsing", () => {
  const prefix = fixture.incident.assistantText;
  assert.equal(prefix.length, fixture.incident.assistantTextLength);
  let candidate = null;
  for (const now of [0, 1200, 2600, 5200, 9000]) {
    const step = advanceResponseCandidate(candidate, observation(prefix, "live-prefix-42"), {
      now,
      minStableMs: 2500,
      minStableReads: 3
    });
    assert.equal(step.complete, false);
    assert.equal(step.reason, fixture.incident.expectedV133StabilityReason);
    assert.equal(step.candidate, null);
    candidate = step.candidate;
  }
});

test("v1.3.3 live regression: completed hidden trusted response reaches explicit rotation control", () => {
  const response = JSON.stringify({
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    sessionAction: "ROTATE_SESSION_NOW",
    sessionReason: "fresh session requested",
    summary: "continue",
    workPerformed: ["captured complete response"],
    evidence: ["complete canonical object"],
    blockers: [],
    nextSuggestedAction: "continue in fresh session"
  });

  let step = advanceResponseCandidate(null, observation(response, "complete-live-rotate"), {
    now: 0,
    minStableMs: 2500,
    minStableReads: 3
  });
  step = advanceResponseCandidate(step.candidate, observation(response, "complete-live-rotate"), {
    now: 1200,
    minStableMs: 2500,
    minStableReads: 3
  });
  step = advanceResponseCandidate(step.candidate, observation(response, "complete-live-rotate"), {
    now: 2600,
    minStableMs: 2500,
    minStableReads: 3
  });
  assert.equal(step.complete, true);

  const parsed = parseTargetResponse(response);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, "CONTINUE");
  assert.equal(parsed.value.sessionAction, "ROTATE_SESSION_NOW");
  assert.equal(isExplicitRotationAction(parsed.value.sessionAction), true);

  const control = resolveGreenfieldControl({
    targetDisposition: parsed.status,
    targetNextSuggestedAction: parsed.value.nextSuggestedAction,
    decision: { disposition: "CONTINUE", nextPrompt: "fallback" },
    sessionAction: parsed.value.sessionAction
  });
  assert.equal(control.reason, "EIC_EXPLICIT_SESSION_ROTATION");
  assert.equal(control.action, "NEXT");
});
