import test from "node:test";
import assert from "node:assert/strict";
import { modelCreateOptions, modelFallbackCreateOptions, modelAvailabilityOptions } from "../lib/model-config.mjs";

test("all LanguageModel option paths declare English output", () => {
  for (const options of [
    modelCreateOptions({ systemPrompt: "x" }),
    modelFallbackCreateOptions({ systemPrompt: "x" }),
    modelAvailabilityOptions()
  ]) {
    assert.deepEqual(options.expectedOutputs, [{ type: "text", languages: ["en"] }]);
  }
});

test("primary and fallback preserve system instruction shape", () => {
  assert.equal(modelCreateOptions({ systemPrompt: "x" }).initialPrompts[0].content, "x");
  assert.equal(modelFallbackCreateOptions({ systemPrompt: "x" }).systemPrompt, "x");
});
