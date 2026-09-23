import test from "node:test";
import assert from "node:assert/strict";
import { NANO_SCHEMA } from "../lib/contracts.mjs";
import { buildNanoPrompt, normalizeNanoResult, validateNanoResult } from "../lib/nano.mjs";

test("Nano normalizes and validates compact advisory output", () => {
  const n = normalizeNanoResult({
    schema: NANO_SCHEMA,
    summary: "Response made progress.",
    intent: "Continue implementation",
    materialFacts: ["Tests were reported green."],
    uncertainties: ["No runtime readback."],
    continuityRisk: "LOW",
    recommendedFocus: "Verify runtime owner state.",
    confidence: "MEDIUM"
  });
  assert.deepEqual(validateNanoResult(n), { ok: true, errors: [] });
});

test("Nano rejects empty advisory output", () => {
  const n = normalizeNanoResult({ schema: NANO_SCHEMA });
  assert.equal(validateNanoResult(n).ok, false);
});

test("Nano prompt explicitly has advisory-only authority", () => {
  const p = buildNanoPrompt({ goal: "g", turn: 1, lastPrompt: "p", assistantResponse: "r" });
  assert.match(p, /do not own runtime state/i);
  assert.match(p, /do not decide the final action/i);
  assert.match(p, /PROMPT_ONLY/);
  assert.match(p, /No EIC\/project state, files, tools, web\/API, chat history, prior turns, or hidden context/i);
  assert.match(p, /materialFacts: only explicit supplied fields/i);
});


test("Nano observer prompt is aggressively bounded for Chrome Nano small context", () => {
  const huge = "X".repeat(50000);
  const prompt = buildNanoPrompt({
    goal: huge,
    turn: 9,
    lastPrompt: huge,
    assistantResponse: huge,
    targetDisposition: "CONTINUE",
    targetResponse: {
      status: "CONTINUE",
      summary: huge,
      blockers: [huge, huge, huge],
      nextSuggestedAction: huge
    },
    nanoTask: {
      requested: true,
      requestId: "nano-1",
      status: "COMPLETED",
      semanticStatus: "SATISFIED",
      sourceTask: huge,
      result: huge,
      error: huge,
      promptLanguage: "en",
      promptPolicy: "PROMPT_CLOSED_EXECUTION_V2"
    },
    operatorInstruction: huge
  });
  assert.ok(prompt.length < 3400, `Nano prompt too large: ${prompt.length}`);
  assert.doesNotMatch(prompt, /LAST PROMPT:/);
  assert.doesNotMatch(prompt, /LATEST ASSISTANT RESPONSE:/);
});
