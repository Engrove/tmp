import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  SESSION_ACTIONS,
  SESSION_ROTATION_STATES,
  createSessionRotationRecord,
  deriveGptRoot,
  isExplicitRotationAction,
  isExplicitStopAction,
  normalizeSessionAction,
  sessionRotationObjective
} from "../lib/session-rotation.mjs";

const EIC_ROOT = "https://chatgpt.com/g/g-69e0b4be34308191aa6c05db1908be1b-eic";

test("custom GPT root is derived from the live managed tab URL and strips conversation state", () => {
  assert.equal(
    deriveGptRoot(`${EIC_ROOT}/c/12345678?foo=bar#fragment`),
    EIC_ROOT
  );
  assert.equal(deriveGptRoot(EIC_ROOT), EIC_ROOT);
});

test("persisted custom GPT root wins when a conversation URL no longer carries the GPT path", () => {
  assert.equal(
    deriveGptRoot("https://chatgpt.com/c/abcdef", EIC_ROOT),
    EIC_ROOT
  );
});

test("generic ChatGPT root is a bounded fallback and non-ChatGPT URLs are rejected", () => {
  assert.equal(deriveGptRoot("https://chatgpt.com/c/abcdef"), "https://chatgpt.com/");
  assert.equal(deriveGptRoot("https://example.com/g/fake"), "");
});

test("session action control is explicit and defaults safely to KEEP", () => {
  assert.equal(normalizeSessionAction("rotate_session_now"), SESSION_ACTIONS.ROTATE_SESSION_NOW);
  assert.equal(normalizeSessionAction("STOP_PROCESS"), SESSION_ACTIONS.STOP_PROCESS);
  assert.equal(normalizeSessionAction("please rotate"), SESSION_ACTIONS.KEEP);
  assert.equal(isExplicitRotationAction("ROTATE_SESSION_NOW"), true);
  assert.equal(isExplicitStopAction("STOP_PROCESS"), true);
  assert.equal(isExplicitRotationAction("context drift"), false);
});

test("rotation record preserves session identity boundary without inventing a mission restart", () => {
  const record = createSessionRotationRecord({
    rotationId: "rotation-1",
    reasonCode: "EIC_ROTATE_SESSION_NOW",
    reason: "Context drift risk.",
    requestedBy: "EIC_AI",
    gptRoot: EIC_ROOT,
    sourceUrl: `${EIC_ROOT}/c/old`,
    sessionSeq: 4,
    now: Date.parse("2026-09-04T08:00:00Z")
  });
  assert.equal(record.state, SESSION_ROTATION_STATES.ARMED);
  assert.equal(record.sessionSeq, 4);
  assert.equal(record.gptRoot, EIC_ROOT);
  assert.equal(record.reasonCode, "EIC_ROTATE_SESSION_NOW");
  assert.equal(record.requestedBy, "EIC_AI");
  assert.equal(record.requestedAt, "2026-09-04T08:00:00.000Z");
  assert.match(sessionRotationObjective(""), /Greenfield Works/);
  assert.match(sessionRotationObjective(""), /without replaying completed work/);
});

test("background has one session-rotation path for stale, detached and explicit EIC control", () => {
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /async function armSessionRotation/);
  assert.match(background, /async function tickRotating/);
  assert.match(background, /WAITING_REFRESH_ESCALATION_ROTATE/);
  assert.match(background, /EIC_ROTATE_SESSION_NOW/);
  assert.match(background, /DETACHED_SESSION_RECOVERY_EXHAUSTED/);
  assert.match(background, /chrome\.tabs\.update\(tab\.id,\s*\{\s*url:\s*gptRoot\s*\}\)/);
  assert.match(background, /chrome\.tabs\.create\(\{/);
  assert.match(background, /messageType:\s*"SESSION_ROTATION"/);
  assert.match(background, /newChatVerified:\s*true/);
  assert.match(background, /SESSION_ROTATION_BLOCKED_UNKNOWN_PROMPT_EFFECT/);
});
