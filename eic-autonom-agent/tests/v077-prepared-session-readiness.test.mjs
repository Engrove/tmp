import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SESSION_INIT_STATES,
  advanceReadinessStability,
  advanceSessionInitGate,
  createSessionInitGate,
  evaluateNewSessionReadiness
} from "../lib/session-readiness.mjs";
import { reconcileEffectRecord } from "../lib/effect-journal.mjs";

function preparedPage(overrides = {}) {
  return {
    ok: true,
    supported: true,
    composerFound: true,
    sendFound: false,
    generating: false,
    backgroundSignals: { active: false },
    documentEpoch: "epoch-v077",
    version: "0.7.7",
    url: "https://chatgpt.com/c/example",
    conversationKey: "chatgpt.com:c:example",
    assistantCount: 1,
    userCount: 1,
    ...overrides
  };
}

test("v0.7.7 does not require a visible send control before composer insertion", () => {
  const normal = evaluateNewSessionReadiness(preparedPage(), {
    requireEmptyConversation: false,
    expectedContentVersion: "0.7.7"
  });
  assert.equal(normal.ready, true);
  assert.deepEqual(normal.reasons, []);

  const diagnostic = evaluateNewSessionReadiness(preparedPage(), {
    requireEmptyConversation: false,
    expectedContentVersion: "0.7.7",
    requireSendControl: true
  });
  assert.equal(diagnostic.ready, false);
  assert.deepEqual(diagnostic.reasons, ["SEND_CONTROL_MISSING"]);
});

test("v0.7.7 can prove stable prepared-session identity while foreground work continues", () => {
  let state = null;
  for (let index = 0; index < 3; index += 1) {
    state = advanceReadinessStability(state, preparedPage({ generating: true }), {
      requiredStableProbes: 3,
      requireEmptyConversation: false,
      expectedContentVersion: "0.7.7",
      allowBusy: true
    });
  }
  assert.equal(state.settled, true);
  assert.equal(state.stableProbes, 3);

  const strict = evaluateNewSessionReadiness(preparedPage({ generating: true }), {
    requireEmptyConversation: false,
    expectedContentVersion: "0.7.7"
  });
  assert.deepEqual(strict.reasons, ["GENERATION_IN_PROGRESS"]);
});

test("v0.7.7 can queue during background work without treating it as submit-ready", () => {
  const busyPage = preparedPage({ backgroundSignals: { active: true } });
  const structural = evaluateNewSessionReadiness(busyPage, {
    requireEmptyConversation: false,
    expectedContentVersion: "0.7.7",
    allowBusy: true
  });
  assert.equal(structural.ready, true);

  const effect = {
    status: "PREPARED",
    turnId: "turn-v077",
    ackMode: "PROMPT_DIGEST",
    promptAckDigest: "a".repeat(64)
  };
  const reconciliation = reconcileEffectRecord(effect, busyPage);
  assert.equal(reconciliation.shouldExecute, false);
  assert.equal(reconciliation.reason, "TARGET_BUSY");
});

test("v0.7.7 queued one-shot prompt does not time out while existing work finishes", () => {
  let gate = createSessionInitGate({ now: 0, timeoutMs: 5_000 });
  gate = advanceSessionInitGate(gate, {
    tabReady: true,
    composerSettled: true
  }, { now: 100 });
  assert.equal(gate.state, SESSION_INIT_STATES.PENDING_PROMPT_ACK);

  gate = advanceSessionInitGate(gate, {
    reasons: ["GENERATION_IN_PROGRESS"]
  }, { now: 10_000_000 });
  assert.equal(gate.state, SESSION_INIT_STATES.PENDING_PROMPT_ACK);
});

test("v0.7.7 prepared-start source queues busy targets and never creates a tab", () => {
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");

  assert.match(background, /requireEmptyConversation:\s*false,[\s\S]{0,400}allowBusy:\s*true/);
  assert.doesNotMatch(
    background,
    /Den valda fliken (arbetar redan i bakgrunden|genererar redan)/
  );
  assert.match(
    background,
    /if \(page\.generating \|\| page\.backgroundSignals\?\.active\) \{[\s\S]{0,1200}Promptleverans köad/
  );
  assert.doesNotMatch(background + content, /chrome\.tabs\.create\s*\(/);

  const insertion = content.indexOf("setNativeValue(composer, prompt)");
  const sendLookup = content.indexOf("const sendButton = getSendButton()", insertion);
  const enterFallback = content.indexOf('key: "Enter"', sendLookup);
  assert.ok(insertion >= 0 && sendLookup > insertion && enterFallback > sendLookup);
});
