import test from "node:test";
import assert from "node:assert/strict";
import { sendFenceDecision } from "../lib/send-fence.mjs";

const pending = { text: "p", hash: "h", dispatch: null };

test("fresh prompt may dispatch", () => {
  assert.equal(sendFenceDecision(pending, {}).action, "READY_TO_DISPATCH");
});

test("effect-possible dispatch can never auto resend", () => {
  const p = {
    ...pending,
    dispatch: {
      effectPossible: true,
      startedAt: "2026-01-01T00:00:00.000Z",
      baselineUserCount: 1,
      baselineAssistantHash: "a"
    }
  };
  assert.equal(sendFenceDecision(p, {}).action, "WAIT_NO_RESEND");
});

test("observed user count confirms existing dispatch without resend", () => {
  const p = {
    ...pending,
    dispatch: { effectPossible: true, startedAt: "x", baselineUserCount: 1 }
  };
  const d = sendFenceDecision(p, { userCount: 2 });
  assert.equal(d.action, "WAIT_NO_RESEND");
  assert.equal(d.evidence, "USER_COUNT_INCREMENTED");
});

test("only confirmed no-effect permits a retry", () => {
  const p = { ...pending, dispatch: { effectPossible: false, status: "NO_EFFECT_CONFIRMED" } };
  assert.equal(sendFenceDecision(p, {}).action, "RETRY_SAFE");
});

test("unknown transport in same content document replays the same dispatch id", () => {
  const p = {
    ...pending,
    dispatch: {
      operationId: "send-1",
      effectPossible: null,
      status: "TRANSPORT_UNKNOWN",
      baselineDocumentId: "doc-1",
      baselineUserCount: 1
    }
  };
  const d = sendFenceDecision(p, { documentId: "doc-1", userCount: 1 });
  assert.equal(d.action, "REPLAY_SAME_DISPATCH_ID");
  assert.equal(d.dispatchId, "send-1");
});

test("unknown transport after document replacement never blind-resends", () => {
  const p = {
    ...pending,
    dispatch: {
      operationId: "send-1",
      effectPossible: null,
      status: "TRANSPORT_UNKNOWN",
      baselineDocumentId: "doc-1",
      baselineUserCount: 1
    }
  };
  const d = sendFenceDecision(p, { documentId: "doc-2", userCount: 1 });
  assert.equal(d.action, "WAIT_NO_RESEND");
  assert.equal(d.evidence, "DISPATCH_EFFECT_UNKNOWN_DOCUMENT_CHANGED");
});
