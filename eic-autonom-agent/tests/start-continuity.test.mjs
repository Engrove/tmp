import test from "node:test";
import assert from "node:assert/strict";
import { createContinuity, projectContinuity, seedContinuityFromStartAnalysis } from "../lib/continuity.mjs";

test("start analysis seeds durable intent work unit constraints risks and evidence", () => {
  const seeded = seedContinuityFromStartAnalysis(createContinuity(), {
    summary: "Close the exact package safely.",
    taskIntent: "Close WP25.2 from current owner state.",
    firstWorkUnit: "Read the exact publication receipt and current review-branch commit.",
    constraints: ["No merge without a human gate."],
    risks: ["Review branch may be missing."],
    requiredEvidence: ["Receipt id and commit hash."]
  }, {
    conversationKey: "chatgpt.com:c:abc",
    taskFingerprint: "task-1",
    now: 1000
  });
  const projection = projectContinuity(seeded);
  assert.equal(projection.intent, "Close WP25.2 from current owner state.");
  assert.equal(projection.position.workUnit, "Read the exact publication receipt and current review-branch commit.");
  assert.equal(projection.position.conversationKey, "chatgpt.com:c:abc");
  assert.equal(projection.constraints[0].text, "No merge without a human gate.");
  assert.match(projection.inferences[0].claim, /Review branch may be missing/);
  assert.equal(projection.nextDirections.length, 0);
  assert.match(projection.evidenceRequirements[0].text, /Receipt id and commit hash/);
  assert.equal(seeded.version, 4);
});
