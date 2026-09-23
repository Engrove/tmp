import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { advanceResponseCandidate } from "../lib/response-stability.mjs";
import { parseTargetResponse } from "../lib/response-contract.mjs";

const fixture = JSON.parse(fs.readFileSync(
  new URL("./fixtures/v1.1.6-live-hidden-fragment.json", import.meta.url),
  "utf8"
));

function obs({
  text,
  hash,
  documentId = "d86d2ffe-d21a-436f-bc1b-c721018dd463",
  trusted,
  ownerKind,
  visibilityState = "hidden",
  assistantCount = 3
}) {
  return {
    documentId,
    lastAssistantId: fixture.legacyPageObservation.lastAssistantId,
    lastAssistantOwnerKind: ownerKind,
    lastAssistantOwnerTrusted: trusted,
    assistantCount,
    expectedUserTurnId: "user-live",
    pairedUserTurnId: "user-live",
    assistantHash: hash,
    assistantText: text,
    assistantTextLength: text.length,
    generating: false,
    signals: { visibilityState }
  };
}

test("v1.1.6 exact hidden fragment cannot terminalize; complete trusted owner can", () => {
  const legacy = fixture.legacyPageObservation;
  let candidate = null;

  for (const sample of legacy.stableReads) {
    const step = advanceResponseCandidate(candidate, obs({
      text: legacy.assistantText,
      hash: legacy.assistantHash,
      documentId: legacy.documentId,
      trusted: false,
      ownerKind: "ROLE_NODE_FALLBACK",
      visibilityState: legacy.visibilityState,
      assistantCount: legacy.assistantCount
    }), {
      now: sample.ageMs,
      minStableMs: 2500,
      minStableReads: 3
    });
    assert.equal(step.complete, false);
    assert.equal(step.reason, "OBSERVATION_DOCUMENT_ID_MISSING");
    assert.equal(step.candidate, null);
    candidate = step.candidate;
  }

  const full = JSON.stringify({
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    summary: "Continue.",
    workPerformed: ["Observed response owner."],
    evidence: ["Full turn text is available."],
    blockers: [],
    nextSuggestedAction: "Continue with the next verified step."
  });

  let step = advanceResponseCandidate(candidate, obs({
    text: full,
    hash: "full-hash",
    trusted: true,
    ownerKind: "ROLE_BOUNDARY_ANCESTOR",
    visibilityState: "hidden"
  }), { now: 4000, minStableMs: 2500, minStableReads: 3 });
  assert.equal(step.complete, false);

  step = advanceResponseCandidate(step.candidate, obs({
    text: full,
    hash: "full-hash",
    trusted: true,
    ownerKind: "ROLE_BOUNDARY_ANCESTOR",
    visibilityState: "hidden"
  }), { now: 5300, minStableMs: 2500, minStableReads: 3 });

  step = advanceResponseCandidate(step.candidate, obs({
    text: full,
    hash: "full-hash",
    trusted: true,
    ownerKind: "ROLE_BOUNDARY_ANCESTOR",
    visibilityState: "hidden"
  }), { now: 6600, minStableMs: 2500, minStableReads: 3 });

  assert.equal(step.complete, true);

  const parsed = parseTargetResponse(full);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, "CONTINUE");
});
