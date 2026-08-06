import test from "node:test";
import assert from "node:assert/strict";
import {
  pageContainsTurn,
  pageContainsEffect,
  reconcileEffectRecord
} from "../lib/effect-journal.mjs";

test("turn i tidigare användarmeddelande förblir synligt efter senare operatörsmeddelande", () => {
  const effect = {
    turnId: "turn-123",
    status: "SUBMITTED_UNCONFIRMED",
    attempts: 1,
    submittedAt: new Date(0).toISOString()
  };
  const page = {
    latestUser: "Operatören skrev efter agentprompten.",
    userTurnIds: ["turn-123"],
    generating: false
  };
  assert.equal(pageContainsTurn(page, "turn-123"), true);
  const result = reconcileEffectRecord(effect, page, { now: 200_000 });
  assert.equal(result.reason, "TURN_VISIBLE");
  assert.equal(result.shouldExecute, false);
  assert.equal(result.effect.status, "ACKED");
});

test("saknat turn-ID kan fortfarande ge bounded retry", () => {
  const effect = {
    turnId: "turn-absent",
    status: "SUBMITTED_UNCONFIRMED",
    attempts: 1,
    submittedAt: new Date(0).toISOString()
  };
  const result = reconcileEffectRecord(effect, {
    latestUser: "senare text",
    userTurnIds: [],
    generating: false
  }, { now: 200_000, graceMs: 90_000, maxAttempts: 2 });
  assert.equal(result.reason, "BOUNDED_RETRY");
  assert.equal(result.shouldExecute, true);
});


test("raw startprompt can be acknowledged by canonical prompt digest without injected turn marker", () => {
  const effect = {
    ackMode: "PROMPT_DIGEST",
    promptAckDigest: "digest-raw",
    turnId: "internal-receipt-turn",
    status: "SUBMITTED_UNCONFIRMED",
    attempts: 1,
    submittedAt: new Date(0).toISOString()
  };
  const page = { userMessageHashes: ["digest-raw"], generating: false };
  assert.equal(pageContainsEffect(page, effect), true);
  const result = reconcileEffectRecord(effect, page, { now: 200000 });
  assert.equal(result.reason, "PROMPT_VISIBLE");
  assert.equal(result.effect.status, "ACKED");
});
