import { MODEL_EXPECTED_OUTPUTS } from "./contracts.mjs";

export function expectedOutputs() {
  return MODEL_EXPECTED_OUTPUTS.map((item) => ({
    type: item.type,
    languages: [...item.languages]
  }));
}

export function modelCreateOptions({
  systemPrompt = "",
  initialPrompts = null,
  monitor = null
} = {}) {
  const options = {
    expectedOutputs: expectedOutputs()
  };
  if (Array.isArray(initialPrompts)) options.initialPrompts = initialPrompts;
  else if (systemPrompt) options.initialPrompts = [{ role: "system", content: String(systemPrompt) }];
  if (typeof monitor === "function") options.monitor = monitor;
  return options;
}

export function modelFallbackCreateOptions({ systemPrompt = "", monitor = null } = {}) {
  const options = {
    expectedOutputs: expectedOutputs()
  };
  if (systemPrompt) options.systemPrompt = String(systemPrompt);
  if (typeof monitor === "function") options.monitor = monitor;
  return options;
}

export function modelAvailabilityOptions() {
  return {
    expectedOutputs: expectedOutputs()
  };
}
