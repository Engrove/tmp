import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createCaptureFingerprint,
  createAutoCaptureGuard,
  evaluateAutoCapture,
  runBlocksAutomaticCapture
} from "../lib/auto-runtime-guards.mjs";

test("capture fingerprint is stable across document epochs", async () => {
  const a = createCaptureFingerprint({
    conversationKey: "conversation",
    latestMessageHash: "hash",
    assistantCount: 7,
    documentEpoch: "epoch-a"
  });
  const b = createCaptureFingerprint({
    conversationKey: "conversation",
    latestMessageHash: "hash",
    assistantCount: 7,
    documentEpoch: "epoch-b"
  });
  assert.equal(a, b);
});

test("paused and terminal runs block automatic capture", () => {
  for (const state of [
    "SOFT_PAUSED", "STOPPED", "AWAITING_OPERATOR_ACTION",
    "AWAITING_OPERATOR_DECISION", "PROGRAM_BLOCKED", "PROGRAM_DONE", "ERROR_TERMINAL"
  ]) {
    assert.equal(runBlocksAutomaticCapture({ state }), true, state);
  }
  assert.equal(runBlocksAutomaticCapture({ state: "WAITING_FOR_RESPONSE" }), false);
});

test("one attempt per fingerprint blocks loops", () => {
  const guard = createAutoCaptureGuard({
    fingerprint: "f",
    requestId: "r",
    status: "STARTED"
  });
  const decision = evaluateAutoCapture({
    enabled: true,
    linked: true,
    stable: true,
    fingerprint: "f",
    lastFingerprint: "",
    inFlight: false,
    paused: false,
    guard
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "FINGERPRINT_ALREADY_ATTEMPTED");
});

test("pause and stop signal in-flight capture before the queued state transition", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const content = await readFile(new URL("../content.js", import.meta.url), "utf8");
  assert.match(background, /signalAutomaticCaptureCancellation\(windowId, "OPERATOR_PAUSE"\)/);
  assert.match(background, /signalAutomaticCaptureCancellation\(windowId, "OPERATOR_STOP"\)/);
  assert.match(background, /type: "EIC_CANCEL_CAPTURE"/);
  assert.match(content, /EIC_CANCEL_CAPTURE/);
  assert.match(content, /SESSION_CAPTURE_CANCELLED/);
});
