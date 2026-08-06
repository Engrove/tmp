import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const sidepanel = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");

test("Nano pipeline has explicit claim, heartbeat, completion and failure owner commands", () => {
  for (const command of ["NANO_CLAIM", "NANO_HEARTBEAT", "NANO_DECISION", "NANO_FAILURE"]) {
    assert.match(background, new RegExp(`UI_COMMANDS\\.${command}`));
    assert.match(sidepanel, new RegExp(`"${command}"`));
  }
});

test("quiet Nano is not cancelled by the historical 45-second heartbeat shortcut", () => {
  assert.doesNotMatch(background, /NANO_HEARTBEAT_STALE_MS/);
  assert.doesNotMatch(background, /heartbeat upphörde/);
  assert.match(background, /nanoClaimLeaseState\(request, \{ now \}\)/);
});

// Restored in v0.7.2. v0.7.0 rewrote this guard to permit ["en", "sv"]; Swedish is not an
// implemented language for Chrome's on-device model, so the guard was correct and the
// change was not. Swedish target material is declared as untrusted quoted data in the base
// system prompt instead.
test("Nano LanguageModel declaration uses the supported English capability", () => {
  assert.match(sidepanel, /const MODEL_LANGUAGES = NANO_PROVIDER_OUTPUT_LANGUAGES;/);
  const options = sidepanel.slice(
    sidepanel.indexOf("const MODEL_LANGUAGES"),
    sidepanel.indexOf("const DECISION_SCHEMA")
  );
  assert.doesNotMatch(options, /"sv"/);
});

test("missing concrete Nano action is replaced by a bounded owner-read instead of a real pause", () => {
  assert.match(background, /Saknad requestedAction ersattes med bounded owner-read/);
  assert.match(background, /ingen verklig PAUS/);
  assert.match(background, /MISSING_ACTION_OWNER_READ/);
});

test("assistantCount is telemetry and not the response identity owner", () => {
  assert.match(background, /pageResponseIdentity/);
  const identityBlock = background.slice(
    background.indexOf("const pageResponseIdentity"),
    background.indexOf("if \(newCompleteResponse\)")
  );
  assert.doesNotMatch(identityBlock, /assistantCount/);
});
