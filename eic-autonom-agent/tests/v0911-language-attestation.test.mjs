import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  NANO_PROVIDER_AVAILABILITY,
  NANO_PROVIDER_CONTRACT,
  NANO_PROVIDER_KIND,
  NANO_PROVIDER_POLICY,
  NanoUserActivationRequiredError,
  discoverNanoProviders,
  nanoProviderInventory,
  providerAvailabilityCall,
  providerCreateOptions,
  selectNanoProvider,
  startOfficialLanguageModelCreate
} from "../lib/nano-provider.mjs";
import {
  NANO_HOST_CANARY_TIMEOUT_MS,
  NANO_HOST_CREATE_TIMEOUT_MS,
  NANO_HOST_PROGRESS_STALL_TIMEOUT_MS,
  NANO_HOST_STATUS,
  NANO_HOST_TELEMETRY_SCHEMA
} from "../lib/nano-host-admission.mjs";

const sidepanel = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const contracts = await import("../lib/contracts.mjs");

function standardProvider(overrides = {}) {
  return {
    kind: NANO_PROVIDER_KIND.STANDARD,
    contract: NANO_PROVIDER_CONTRACT,
    api: {
      create() {},
      ...overrides
    }
  };
}

test("v0.10.0 uses only the current standard LanguageModel surface", () => {
  assert.equal(NANO_PROVIDER_POLICY, "STANDARD_LANGUAGE_MODEL_ONLY");
  assert.deepEqual(discoverNanoProviders({
    LanguageModel: { create() {} },
    ai: { languageModel: { create() {} } }
  }).map((item) => item.kind), ["LanguageModel"]);
  assert.equal(selectNanoProvider({
    LanguageModel: { create() {} },
    ai: { languageModel: { create() {} } }
  }).kind, "LanguageModel");
});

test("v0.10.0 never promotes the obsolete ai.languageModel namespace", () => {
  assert.deepEqual(discoverNanoProviders({
    ai: { languageModel: { create() {} } }
  }), []);
  assert.deepEqual(nanoProviderInventory({
    ai: { languageModel: { create() {} } }
  }), []);
});

test("v0.10.0 passive availability uses the required output-language options", async () => {
  let args = null;
  const provider = standardProvider({
    availability(...value) {
      args = value;
      return "available";
    }
  });
  assert.equal(
    await providerAvailabilityCall(provider),
    NANO_PROVIDER_AVAILABILITY.AVAILABLE
  );
  assert.deepEqual(args, [{
    expectedOutputs: [{ type: "text", languages: ["en"] }]
  }]);
});

test("v0.10.0 activation options attest supported English output", () => {
  const signal = new AbortController().signal;
  const monitor = () => {};
  const options = providerCreateOptions({ signal, monitor });
  assert.equal(options.signal, signal);
  assert.equal(options.monitor, monitor);
  assert.equal("initialPrompts" in options, false);
  assert.equal("expectedInputs" in options, false);
  assert.deepEqual(options.expectedOutputs, [
    { type: "text", languages: ["en"] }
  ]);
  assert.equal("topK" in options, false);
  assert.equal("temperature" in options, false);
});

test("v0.10.0 mandate base options preserve the same output-language attestation", () => {
  const options = providerCreateOptions({ systemPrompt: "bounded mandate" });
  assert.deepEqual(options, {
    expectedOutputs: [{ type: "text", languages: ["en"] }],
    initialPrompts: [{ role: "system", content: "bounded mandate" }]
  });
});

test("v0.10.0 native create is entered synchronously with active user activation", () => {
  const calls = [];
  const provider = standardProvider({
    create(options) {
      calls.push(options);
      return Promise.resolve({ prompt() {} });
    }
  });
  const promise = startOfficialLanguageModelCreate(provider, {
    navigatorValue: { userActivation: { isActive: true } }
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    expectedOutputs: [{ type: "text", languages: ["en"] }]
  });
  assert.equal(typeof promise?.then, "function");
});

test("v0.10.0 blocks native create without an active user gesture", () => {
  const provider = standardProvider();
  assert.throws(
    () => startOfficialLanguageModelCreate(provider, {
      navigatorValue: { userActivation: { isActive: false } }
    }),
    NanoUserActivationRequiredError
  );
});


test("v0.10.0 never declares unsupported Swedish native output", () => {
  const options = providerCreateOptions();
  assert.deepEqual(options.expectedOutputs, [
    { type: "text", languages: ["en"] }
  ]);
  assert.equal(JSON.stringify(options).includes('"sv"'), false);
});

test("v0.10.0 telemetry exposes the output-language attestation", () => {
  assert.match(sidepanel, /outputLanguages: \[\.\.\.NANO_PROVIDER_OUTPUT_LANGUAGES\]/);
  assert.match(sidepanel, /outputLanguageAttested: true/);
  assert.match(background, /assignIfPresent\("outputLanguageAttested", Boolean/);
});

test("v0.10.0 admission has current telemetry and bounded verification", () => {
  assert.equal(NANO_HOST_TELEMETRY_SCHEMA, "eic.autonom.nano-host-telemetry.v4");
  assert.equal(NANO_HOST_PROGRESS_STALL_TIMEOUT_MS, 1_200_000);
  assert.equal(NANO_HOST_CREATE_TIMEOUT_MS, 1_500_000);
  assert.equal(NANO_HOST_CANARY_TIMEOUT_MS, 120_000);
  assert.equal(NANO_HOST_STATUS.READY_TO_CREATE, "ready_to_create");
  assert.equal(NANO_HOST_STATUS.VERIFYING, "verifying");
});

test("v0.10.0 activation block contains no await before the native create call", async () => {
  const block = sidepanel.slice(
    sidepanel.indexOf("function beginNanoCreateFromGesture"),
    sidepanel.indexOf("const downloadStallPromise")
  );
  const prefix = block.slice(0, block.indexOf("createCall = startOfficialLanguageModelCreate"));
  const executablePrefix = prefix.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(executablePrefix, /\bawait\b/);
  assert.match(block, /startOfficialLanguageModelCreate\(adapter/);
  assert.doesNotMatch(block, /providerAvailabilityCall/);
  assert.match(await readFile(new URL("../lib/nano-provider.mjs", import.meta.url), "utf8"), /expectedOutputs/);
});

test("v0.10.0 activation canary gates the durable base session", () => {
  const block = sidepanel.slice(
    sidepanel.indexOf("async function verifyCreatedLanguageModelSession"),
    sidepanel.indexOf("function beginNanoCreateFromGesture")
  );
  assert.match(block, /session\.prompt/);
  assert.match(block, /withNanoHostCanaryDeadline/);
  assert.match(block, /session\.destroy/);
  assert.match(block, /adapter\.api\.create\(providerCreateOptions/);
  assert.match(block, /clean-session-created/);
});

test("v0.10.0 mission start cannot silently create a model", () => {
  const block = sidepanel.slice(
    sidepanel.indexOf("async function startMissionMode"),
    sidepanel.indexOf("function loadUiFocusPreference")
  );
  assert.doesNotMatch(block, /beginNanoCreateFromGesture/);
  assert.match(block, /NANO_HOST_NOT_READY/);
});

test("v0.10.0 task sessions require a canary-verified base", () => {
  const block = sidepanel.slice(
    sidepanel.indexOf("async function createTaskSession"),
    sidepanel.indexOf("function recoverableTaskSessionError")
  );
  assert.match(block, /!state\.modelCanaryVerified/);
  assert.match(block, /selectNanoProvider\(globalThis\)/);
});

test("v0.10.0 passive preflight runs on panel initialization", () => {
  const block = sidepanel.slice(
    sidepanel.indexOf("async function initialize()"),
    sidepanel.indexOf("window.addEventListener", sidepanel.indexOf("async function initialize()"))
  );
  assert.match(block, /probeNanoAvailability\(\{ quiet: true \}\)/);
  assert.match(block, /event: "panel-opened"/);
});

test("v0.10.0 telemetry records user activation and canary evidence", () => {
  assert.match(sidepanel, /eic\.autonom\.nano-host-telemetry\.v4/);
  assert.match(sidepanel, /userActivationActiveAtStart/);
  assert.match(sidepanel, /canaryStartedAt/);
  assert.match(sidepanel, /canaryCompletedAt/);
  assert.match(sidepanel, /canaryVerified/);
  assert.match(background, /eic\.autonom\.nano-host-telemetry\.v4/);
  assert.match(background, /assignIfPresent\("userActivationActiveAtStart", Boolean/);
  assert.match(background, /assignIfPresent\("canaryVerified", Boolean/);
});

test("v0.10.0 extension baseline matches the official stable extension floor", () => {
  assert.equal(manifest.version, "0.10.11");
  assert.equal(manifest.minimum_chrome_version, "138");
  assert.equal(contracts.APP_VERSION, "0.10.11");
  assert.equal(contracts.CONTENT_SCRIPT_VERSION, "0.10.11");
  assert.equal(contracts.EXPORT_SCHEMA, "eic.autonom.export.v20");
  assert.equal(contracts.EXPORT_VERSION, 20);
});

test("v0.10.0 source contains no active legacy provider policy", async () => {
  assert.doesNotMatch(sidepanel, /LEGACY_NATIVE_FIRST|ai\.languageModel/);
  const providerSource = await readFile(new URL("../lib/nano-provider.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(providerSource, /LEGACY_NATIVE_FIRST|ai\.languageModel/);
});
