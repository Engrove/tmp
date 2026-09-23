import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseTargetResponse, targetResponseEvidence } from "../lib/response-contract.mjs";
import { evaluateNanoTaskSemanticStatus } from "../lib/nano-task.mjs";

const fixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/v1.1.5-live-evidence-quote-loss.json", import.meta.url), "utf8")
);

test("v1.1.5 live renderer evidence quote loss preserves canonical CONTINUE control without full-schema promotion", () => {
  const parsed = parseTargetResponse(fixture.assistantText);
  assert.equal(parsed.ok, fixture.expected.fullSchemaValid);
  assert.equal(parsed.controlOk, fixture.expected.controlValid);
  assert.equal(parsed.status, fixture.expected.status);
  assert.equal(parsed.parseMode, fixture.expected.parseMode);
  assert.ok(parsed.control.nextSuggestedAction.includes(fixture.expected.nextSuggestedActionContains));

  const evidence = targetResponseEvidence(parsed, "hash-v115-live");
  assert.equal(evidence.schemaValid, false);
  assert.equal(evidence.controlValid, true);
  assert.equal(evidence.degraded, true);
  assert.equal(evidence.status, "CONTINUE");
});

test("v1.1.5 exact literal task grammar and one terminal line ending are deterministically satisfied", () => {
  const task = {
    requested: true,
    status: "COMPLETED",
    sourceTask: "Return exactly GREENFIELD_V115_OK and nothing else.",
    result: "GREENFIELD_V115_OK\n"
  };
  assert.equal(evaluateNanoTaskSemanticStatus(task), "SATISFIED");
});

test("exact literal semantic verifier does not broadly trim arbitrary whitespace", () => {
  const task = {
    requested: true,
    status: "COMPLETED",
    sourceTask: "Return exactly GREENFIELD_V115_OK and nothing else.",
    result: " GREENFIELD_V115_OK\n"
  };
  assert.equal(evaluateNanoTaskSemanticStatus(task), "UNSATISFIED");
});
