import test from "node:test";
import assert from "node:assert/strict";
import { parseTargetResponse } from "../lib/response-contract.mjs";
import { splitNanoTaskDirective } from "../lib/nano-task.mjs";
import { evaluateContinuationAdmission } from "../lib/continuation-guard.mjs";

const renderedTurn2Response = `EIC sade:{
  "schema": "eic.a2a.response.v1",
  "status": "CONTINUE",
  "summary": "v1.1.2 English Nano execution PASS; prompt metadata evidence incomplete",
  "workPerformed": ["Verified Nano execution."],
  "evidence": ["nanoTask.result=NANO_TEST_ANSWER=703."],
  "blockers": [],
  "nextSuggestedAction": "NANO_TASK: Return exactly one line of plain text containing GREENFIELD_DIRECT_OK. Do not output code, markdown, explanation, punctuation, or any additional text. Execute this task exactly once. In the next CONTINUATION, include nanoTask.promptLanguage="en" and nanoTask.promptPolicy="ENGLISH_DIRECT_EXECUTION_V1" in bounded analysisEvidence."
}
Status: v1.1.2 English Nano execution PASS
Project: EIC Autonom Agent
Time: 2026-09-01T06:29:13.530949Z`;

test("v1.1.2 live renderer regression reparses CONTINUE and recovers pending Nano task", () => {
  const parsed = parseTargetResponse(renderedTurn2Response);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, "CONTINUE");
  assert.equal(parsed.parseMode, "REPAIRED_UNESCAPED_QUOTES");
  const directive = splitNanoTaskDirective(parsed.value.nextSuggestedAction);
  assert.equal(directive.found, true);
  assert.match(directive.task, /GREENFIELD_DIRECT_OK/);
});

test("historical v1.1.2 UNKNOWN protocol status is advisory in the current controller", () => {
  const admission = evaluateContinuationAdmission({
    targetDisposition: "UNKNOWN",
    currentObjective: "Current objective",
    decision: {
      disposition: "CONTINUE",
      nextPrompt: "Continue from the completed assistant response.",
      nanoTaskAssessment: "NOT_REQUESTED"
    },
    nanoTask: null
  });
  assert.equal(admission.ok, true);
  assert.equal(admission.code, "ADMISSIBLE");
});
