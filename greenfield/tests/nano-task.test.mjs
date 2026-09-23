import test from "node:test";
import assert from "node:assert/strict";
import { assessNanoTaskPromptClosure, buildNanoExecutionPrompt, createNanoTask, evaluateNanoTaskSemanticStatus, extractNanoContextRequirement, NANO_CONTEXT_REQUIRED_PREFIX, NANO_KNOWLEDGE_BOUNDARY, NANO_TASK_LANGUAGE, NANO_TASK_PROMPT_POLICY, NANO_TASK_REQUEST_SCHEMA, splitNanoTaskDirective } from "../lib/nano-task.mjs";

test("Nano task directive is explicit and deterministic", () => {
  const parsed = splitNanoTaskDirective("First inspect evidence.\nNANO_TASK: Calculate 37 * 19 and return only the integer.");
  assert.equal(parsed.found, true);
  assert.equal(parsed.task, "Calculate 37 * 19 and return only the integer.");
});

test("ordinary Nano prose is not treated as a Nano task", () => {
  const parsed = splitNanoTaskDirective("Nano should probably inspect this later.");
  assert.equal(parsed.found, false);
});

test("Nano task has durable request identity and fresh one-prompt isolation contract", () => {
  const task = createNanoTask({ task: "Return 703", sourceResponseHash: "abc", at: 0 });
  assert.equal(task.requested, true);
  assert.equal(task.status, "PENDING");
  assert.equal(task.isolation, "FRESH_ONE_PROMPT_SESSION");
  assert.equal(task.promptCalls, 0);
  assert.match(task.requestId, /^nano-task-/);
});


test("Nano execution prompt is runtime-owned English direct-execution policy", () => {
  const prompt = buildNanoExecutionPrompt("Calculate 37 * 19 and return exactly NANO_TEST_ANSWER=<integer>.");
  assert.match(prompt, /^You are executing one isolated local Nano task\./);
  assert.match(prompt, /Language policy: use English/);
  assert.match(prompt, /do not describe a plan or restate the assignment/i);
  assert.match(prompt, /Do not output source code unless the task explicitly asks for source code\./);
  assert.match(prompt, /Follow any requested output format exactly\./);
});

test("Nano task persists source separately from English execution prompt", () => {
  const task = createNanoTask({
    task: "Calculate 37 * 19 and return exactly NANO_TEST_ANSWER=<integer>.",
    sourceResponseHash: "hash-1",
    at: 0
  });
  assert.equal(task.sourceTask, "Calculate 37 * 19 and return exactly NANO_TEST_ANSWER=<integer>.");
  assert.notEqual(task.executionPrompt, task.sourceTask);
  assert.equal(task.promptLanguage, NANO_TASK_LANGUAGE);
  assert.equal(task.promptLanguage, "en");
  assert.equal(task.promptPolicy, NANO_TASK_PROMPT_POLICY);
  assert.match(task.executionPrompt, /Task:\nCalculate 37 \* 19/);
});


test("Nano task directive owns one line and leaves continuation instructions outside the local task", () => {
  const parsed = splitNanoTaskDirective(
    "NANO_TASK: Return exactly GREENFIELD_OK.\nIn the next CONTINUATION, expose bounded evidence."
  );
  assert.equal(parsed.found, true);
  assert.equal(parsed.task, "Return exactly GREENFIELD_OK.");
  assert.equal(parsed.remainder, "In the next CONTINUATION, expose bounded evidence.");
});

test("deterministic exact-plain-text Nano verifier can close literal output semantics", () => {
  const task = {
    requested: true,
    status: "COMPLETED",
    sourceTask: "Return exactly one line of plain text containing GREENFIELD_V114_OK.",
    result: "GREENFIELD_V114_OK\n"
  };
  assert.equal(evaluateNanoTaskSemanticStatus(task), "SATISFIED");
  assert.equal(
    evaluateNanoTaskSemanticStatus({ ...task, result: "GREENFIELD_V114_BAD\n" }),
    "UNSATISFIED"
  );
});

test("generic Nano tasks remain semantically UNVERIFIED after execution", () => {
  const task = {
    requested: true,
    status: "COMPLETED",
    sourceTask: "Summarize this evidence.",
    result: "Summary"
  };
  assert.equal(evaluateNanoTaskSemanticStatus(task), "UNVERIFIED");
});

test("v1.3.0 rejects an EIC/file-dependent Nano task before any model call", () => {
  const sourceTask = "Build a bounded field inventory from existing CSV/JSON metadata only. Extract column names and JSON keys from manifest-like files, classify fields by provenance (source metadata vs derived metadata), and avoid reading full mail bodies or extracting ZIP members until the next owner-approved package.";
  const admission = assessNanoTaskPromptClosure(sourceTask);
  assert.equal(admission.ok, false);
  assert.equal(admission.knowledgeBoundary, "PROMPT_ONLY");
  assert.ok(admission.reasons.includes("EXTERNAL_ACCESS_REQUEST") || admission.reasons.includes("UNRESOLVED_EXTERNAL_REFERENCE"));

  const task = createNanoTask({ task: sourceTask, at: 0 });
  assert.equal(task.status, "CONTEXT_REQUIRED");
  assert.equal(task.promptCalls, 0);
  assert.equal(task.knowledgeBoundary, "PROMPT_ONLY");
  assert.match(task.error, /^NANO_CONTEXT_REQUIRED:/);
});

test("v1.3.0 admits complex reasoning when all task data is inline in a structured prompt", () => {
  const sourceTask = JSON.stringify({
    schema: NANO_TASK_REQUEST_SCHEMA,
    knowledgeBoundary: NANO_KNOWLEDGE_BOUNDARY,
    instruction: "Classify each supplied field as SOURCE or DERIVED and explain each classification briefly.",
    context: {
      fields: [
        { name: "message_id", origin: "export_manifest" },
        { name: "thread_key", origin: "computed_from_headers" }
      ]
    },
    output: "Return JSON only with fields name, class, and reason."
  });
  const parsed = splitNanoTaskDirective(`NANO_TASK: ${sourceTask}\nContinue after the local result.`);
  assert.equal(parsed.task, sourceTask);
  assert.match(parsed.remainder, /Continue after/);

  const admission = assessNanoTaskPromptClosure(parsed.task);
  assert.equal(admission.ok, true);
  assert.equal(admission.format, "STRUCTURED_V2");
  assert.ok(admission.contextChars > 0);

  const task = createNanoTask({ task: parsed.task, at: 0 });
  assert.equal(task.status, "PENDING");
  assert.match(task.executionPrompt, /computed_from_headers/);
  assert.match(task.executionPrompt, /Return JSON only/);
});

test("v1.3.0 keeps simple legacy self-contained Nano tasks valid", () => {
  const admission = assessNanoTaskPromptClosure("Calculate 37 * 19 and return only the integer.");
  assert.equal(admission.ok, true);
  const task = createNanoTask({ task: "Calculate 37 * 19 and return only the integer.", at: 0 });
  assert.equal(task.status, "PENDING");
});

test("v1.3.0 execution prompt makes the single-prompt epistemic boundary explicit", () => {
  const prompt = buildNanoExecutionPrompt("Calculate 37 * 19 and return only the integer.");
  assert.match(prompt, /single prompt is your entire world/i);
  assert.match(prompt, /no EIC\/project state, files, tools, browser, web, API access, chat history, previous turns, or hidden context/i);
  assert.match(prompt, new RegExp(NANO_CONTEXT_REQUIRED_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(prompt, /Do not guess, reconstruct, or pretend to access missing external state/i);
});

test("v1.3.0 recognizes Nano context-required fail-closed output", () => {
  const parsed = extractNanoContextRequirement("NANO_CONTEXT_REQUIRED: CSV headers were not supplied");
  assert.equal(parsed.required, true);
  assert.equal(parsed.reason, "CSV headers were not supplied");
  assert.equal(extractNanoContextRequirement("703"), null);
});

