import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CONFIG_SCHEMA,
  CONFIG_VERSION,
  RUNTIME_SCHEMA,
  RUNTIME_VERSION,
  createDefaultConfig,
  createDefaultRuntime
} from "../lib/contracts.mjs";
import { currentStateOrFresh } from "../lib/forward-only-policy.mjs";
import {
  assertAutostartTabBinding,
  autostartActivationOutcome,
  evaluateAutostartConfirmation
} from "../lib/autostart-transaction.mjs";

test("v0.10.7 current config/runtime v13 round-trip without forward-only reset", () => {
  const config = createDefaultConfig();
  const runtime = createDefaultRuntime();

  const configResult = currentStateOrFresh(config, {
    schema: CONFIG_SCHEMA,
    version: CONFIG_VERSION,
    factory: createDefaultConfig,
    label: "CONFIG"
  });
  const runtimeResult = currentStateOrFresh(runtime, {
    schema: RUNTIME_SCHEMA,
    version: RUNTIME_VERSION,
    factory: createDefaultRuntime,
    label: "RUNTIME"
  });

  assert.equal(configResult.reset, false);
  assert.equal(configResult.reason, "CURRENT_SCHEMA");
  assert.equal(runtimeResult.reset, false);
  assert.equal(runtimeResult.reason, "CURRENT_SCHEMA");
});

test("the reproduced v0.10.4 stale v12 loader fixture resets current v13 state", () => {
  const result = currentStateOrFresh(createDefaultRuntime(), {
    schema: RUNTIME_SCHEMA,
    version: 12,
    factory: createDefaultRuntime,
    label: "RUNTIME"
  });
  assert.equal(result.reset, true);
  assert.equal(result.reason, "FORWARD_ONLY_RESET");
  assert.equal(result.value.forwardOnlyReset.priorVersion, RUNTIME_VERSION);
});

test("D1/D2 confirmation requires a second explicit click and expires closed", () => {
  const first = evaluateAutostartConfirmation({
    presetId: "MJOLNAR_D2",
    requiresConfirmation: true,
    now: 1_000
  });
  assert.equal(first.confirmed, false);
  assert.equal(first.reason, "ARMED");

  const second = evaluateAutostartConfirmation({
    presetId: "MJOLNAR_D2",
    requiresConfirmation: true,
    pending: first.pending,
    now: 2_000
  });
  assert.equal(second.confirmed, true);
  assert.equal(second.reason, "SECOND_EXPLICIT_CLICK");
  assert.equal(second.pending, null);

  const expired = evaluateAutostartConfirmation({
    presetId: "MJOLNAR_D2",
    requiresConfirmation: true,
    pending: first.pending,
    now: 40_000
  });
  assert.equal(expired.confirmed, false);
  assert.equal(expired.reason, "EXPIRED_REARMED");
});

test("non-confirming presets remain one-click", () => {
  const decision = evaluateAutostartConfirmation({
    presetId: "VERIFIED_ANALYSIS",
    requiresConfirmation: false,
    now: 1_000
  });
  assert.equal(decision.confirmed, true);
  assert.equal(decision.reason, "NOT_REQUIRED");
  assert.equal(decision.pending, null);
});

test("activation rejection is converted immediately into a handled outcome", async () => {
  const failure = new Error("USER_ACTIVATION_REQUIRED");
  const outcome = await autostartActivationOutcome(Promise.reject(failure));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, failure);
});

test("tab/controller owner readback must identify the same selected ChatGPT tab", () => {
  const result = assertAutostartTabBinding({
    selectedTabId: 42,
    linkedTabs: {
      "42": { tabId: 42, conversationKey: "conversation-1" }
    },
    surfacePair: {
      surfaces: {
        CHATGPT_CONTROLLER: { tabId: 42, lifecycleState: "BOUND" }
      }
    }
  });
  assert.equal(result.selectedTabId, 42);
  assert.equal(result.conversationKey, "conversation-1");

  assert.throws(
    () => assertAutostartTabBinding({
      selectedTabId: 42,
      linkedTabs: { "42": { tabId: 42 } },
      surfacePair: {
        surfaces: {
          CHATGPT_CONTROLLER: { tabId: 99, lifecycleState: "BOUND" }
        }
      }
    }),
    /AUTOSTART_CONTROLLER_BINDING_READBACK_FAILED/
  );
});

test("background current-state loader and config save use contract-owned versions", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const start = source.indexOf("function loadCurrentState");
  const end = source.indexOf("async function readStores", start);
  assert.notEqual(start, -1, "loadCurrentState anchor must exist");
  assert.notEqual(end, -1, "readStores anchor must exist");
  assert.ok(end > start, "source anchors must be ordered");
  const block = source.slice(start, end);
  assert.match(block, /version: CONFIG_VERSION/);
  assert.match(block, /version: RUNTIME_VERSION/);
  assert.doesNotMatch(block, /version: 12/);
  assert.match(source, /current\.version = CONFIG_VERSION/);
});

test("Autostart enters native create before await, handles rejection and verifies tab before mission", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  const start = source.indexOf("async function autostartClick()");
  const end = source.indexOf("async function activateNanoClick", start);
  assert.notEqual(start, -1, "autostartClick anchor must exist");
  assert.notEqual(end, -1, "activateNanoClick anchor must exist");
  assert.ok(end > start, "Autostart source anchors must be ordered");
  const block = source.slice(start, end);

  const create = block.indexOf(
    "autostartActivationOutcome(beginNanoCreateFromGestureWithConfig(preparedConfig))"
  );
  const firstAwait = block.indexOf('await command("SAVE_CONFIG"');
  const readback = block.indexOf("assertAutostartTabBinding");
  const mission = block.indexOf("startMissionMode");

  assert.ok(create >= 0 && create < firstAwait);
  assert.ok(readback >= 0 && readback < mission);
  assert.match(block, /\{ persistConfig: false \}/);
  assert.doesNotMatch(block, /confirm\(/);
});
