import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const content = await readFile(new URL("../content.js", import.meta.url), "utf8");
const sidepanel = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");

// Restored in v0.7.2 alongside the guard in nano-runtime-regression.test.mjs.
test("current Prompt API bootstrap does not add unsupported modality declarations", () => {
  const options = sidepanel.slice(
    sidepanel.indexOf("const MODEL_LANGUAGES"),
    sidepanel.indexOf("const DECISION_SCHEMA")
  );
  assert.match(options, /const MODEL_LANGUAGES = NANO_PROVIDER_OUTPUT_LANGUAGES;/);
  assert.doesNotMatch(options, /expectedInputs/);
  assert.doesNotMatch(options, /"sv"/);
  assert.doesNotMatch(sidepanel, /MODEL_LANGUAGES_FALLBACK/);
});

test("v0.6.6 dirty notification handles invalidated extension context synchronously and asynchronously", () => {
  const block = content.slice(
    content.indexOf("function errorMessage"),
    content.indexOf("function startObserver")
  );
  assert.match(block, /function extensionContextAlive/);
  assert.match(block, /function isExtensionContextInvalidated/);
  assert.match(block, /try\s*\{[\s\S]*chrome\.runtime\.sendMessage/);
  assert.match(block, /Promise\.resolve\(pending\)\.catch/);
  assert.match(block, /stopLocalBridge\(\)/);
});

test("v0.6.6 reinjection replaces a stale same-version bridge", () => {
  const bootstrap = content.slice(0, content.indexOf("let disposed"));
  assert.match(bootstrap, /previous\?\.dispose\?\.\(\)/);
  assert.doesNotMatch(bootstrap, /previous\?\.version\s*===\s*VERSION[\s\S]*return/);
});

test("v0.6.6 bridge disposal tolerates an already invalidated runtime", () => {
  assert.match(content, /stopLocalBridge\(\{ removeRuntimeListener: true \}\)/);
  const stop = content.slice(
    content.indexOf("function stopLocalBridge"),
    content.indexOf("function scheduleDirty")
  );
  assert.match(stop, /try\s*\{[\s\S]*chrome\.runtime\.onMessage\.removeListener/);
});
