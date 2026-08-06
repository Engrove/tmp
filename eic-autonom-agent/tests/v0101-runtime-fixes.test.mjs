import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTurnObject,
  compileTurnPrompt,
  parseTargetResult
} from "../lib/prompt-contract.mjs";
import {
  START_RESPONSE_CONTRACTS,
  inspectStartPromptContract
} from "../lib/start-session.mjs";
import {
  canReferenceAcknowledgedMandate,
  createAutoRestartGuard,
  createCaptureFingerprint,
  evaluateAutoCapture,
  evaluateAutoRestart,
  evaluateInterruptedNanoRecovery
} from "../lib/auto-runtime-guards.mjs";
import { buildProtocolRepairDecision } from "../lib/task-integrity.mjs";
import { buildArchaeologyStartPrompt } from "../lib/archaeology-prompt.mjs";

test("v0.10.1 four-line EIC-AA/5 response is blocked and five-line twin emits", () => {
  const four = parseTargetResult(`EIC_TURN: turn-1
EIC_NEXT: continue
EIC_COMPLETION_EVIDENCE: MILESTONE_CONTINUE · evidence
EIC_AUTONOMY: CONTINUE`, "turn-1");
  assert.equal(four.valid, false);
  const five = parseTargetResult(`EIC_TURN: turn-1
EIC_NEXT: continue
EIC_COMPLETION_EVIDENCE: MILESTONE_CONTINUE · evidence
EIC_NEXT_ACTOR: AGENT
EIC_AUTONOMY: CONTINUE`, "turn-1");
  assert.equal(five.valid, true);
  assert.equal(five.nextActor, "AGENT");
});

test("v0.10.1 protocol repair and archaeology prompts require all five fields", () => {
  const repair = buildProtocolRepairDecision();
  assert.match(repair.requestedAction, /EIC_NEXT_ACTOR/);
  assert.match(repair.requiredEvidence[0], /Fem/);
  const archaeology = buildArchaeologyStartPrompt({
    question: "Inspect the current bounded system."
  });
  assert.match(archaeology, /exakt fem rader/);
  assert.match(archaeology, /EIC_NEXT_ACTOR:/);
  assert.doesNotMatch(archaeology, /FULL_STOP/);
});

test("v0.10.1 start contract detects current EIC-AA/5 and rejects legacy shape", () => {
  const current = inspectStartPromptContract(`Protocol: EIC-AA/5
EIC_TURN: turn-current
EIC_NEXT: step
EIC_COMPLETION_EVIDENCE: MILESTONE_CONTINUE · evidence
EIC_NEXT_ACTOR: AGENT
EIC_AUTONOMY: CONTINUE`);
  assert.equal(current.protocolDetected, true);
  assert.equal(current.responseContract, START_RESPONSE_CONTRACTS.TURN_BOUND_5);
  const legacy = inspectStartPromptContract(`Protocol: EIC-AA/4
EIC_TURN: turn-old
EIC_NEXT: step
EIC_COMPLETION_EVIDENCE: evidence
EIC_AUTONOMY: CONTINUE`);
  assert.equal(legacy.protocolDetected, false);
  assert.equal(legacy.responseContract, START_RESPONSE_CONTRACTS.UNBOUND);
});

test("v0.10.1 canonical target prompt contains one envelope and no mirrored marker format", async () => {
  const instruction = "Execute the exact bounded owner-read.";
  const turn = await buildTurnObject({
    turnId: "turn-canonical",
    targetMandate: "Current mandate.",
    targetMandateVersion: "target-core-v6",
    taskIntent: instruction,
    workUnit: instruction,
    requestedAction: instruction,
    requiredEvidence: ["Owner readback."],
    stopCriteria: ["Stop after owner readback."]
  });
  const compiled = await compileTurnPrompt(turn);
  assert.doesNotMatch(compiled.prompt, /EIC_FIELD|EIC_BLOCK|EIC_MACHINE_ENVELOPE/);
  assert.equal((compiled.prompt.match(new RegExp(instruction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 1);
  assert.ok(compiled.prompt.length < 5000);
  const envelope = JSON.parse(compiled.json);
  assert.equal(envelope.canonicalSource, "JSON");
  assert.equal(envelope.taskIntent, null);
  assert.equal(envelope.taskIntentRef, "requestedAction.instruction");
  assert.equal(envelope.mandate.text, "Current mandate.");
  assert.equal(envelope.responseContract, "EIC-AA/5_FIVE_LINE");
});

test("v0.10.1 mandate reference blocks PREPARED and emits only after matching ACK receipt", () => {
  const base = {
    priorTurnId: "turn-a",
    mandateVersion: "target-core-v6",
    mandateSha256: "abc",
    conversationKey: "conversation-1",
    taskFingerprint: "task-1"
  };
  assert.equal(canReferenceAcknowledgedMandate({
    ...base,
    receipt: { ...base, turnId: "turn-a" }
  }), false);
  assert.equal(canReferenceAcknowledgedMandate({
    ...base,
    receipt: {
      turnId: "turn-a",
      mandateVersion: "target-core-v6",
      mandateSha256: "abc",
      conversationKey: "conversation-1",
      taskFingerprint: "task-1",
      confirmedAt: "2026-08-06T00:00:00.000Z"
    }
  }), true);
  assert.equal(canReferenceAcknowledgedMandate({
    ...base,
    conversationKey: "conversation-2",
    receipt: {
      turnId: "turn-a",
      mandateVersion: "target-core-v6",
      mandateSha256: "abc",
      conversationKey: "conversation-1",
      taskFingerprint: "task-1",
      confirmedAt: "2026-08-06T00:00:00.000Z"
    }
  }), false);
});

test("v0.10.1 auto restart emits once and blocks same fingerprint during cooldown", () => {
  const input = {
    enabled: true,
    stale: true,
    staleReason: "MANDATE_CHANGED",
    availability: "available",
    priorCanaryVerified: true,
    busy: false,
    fingerprint: "fp",
    now: 1000000
  };
  assert.equal(evaluateAutoRestart(input).allowed, true);
  const guard = createAutoRestartGuard({ fingerprint: "fp", now: 1000000 });
  const blocked = evaluateAutoRestart({ ...input, guard, now: 1001000 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "COOLDOWN");
  const manual = evaluateAutoRestart({ ...input, staleReason: "EXTERNAL_MODEL_ASSET_BLOCKER" });
  assert.equal(manual.allowed, false);
  assert.equal(manual.reason, "MANUAL_ONLY_REASON");
});

test("v0.10.1 auto capture is mission-independent and deduplicates stable transcript identity", () => {
  const fingerprint = createCaptureFingerprint({
    conversationKey: "conversation",
    documentEpoch: "epoch",
    latestMessageHash: "hash"
  });
  const emit = evaluateAutoCapture({
    enabled: true,
    linked: true,
    stable: true,
    fingerprint,
    lastFingerprint: "",
    inFlight: false
  });
  assert.equal(emit.allowed, true);
  const block = evaluateAutoCapture({
    enabled: true,
    linked: true,
    stable: true,
    fingerprint,
    lastFingerprint: fingerprint,
    inFlight: false
  });
  assert.equal(block.allowed, false);
  assert.equal(block.reason, "UNCHANGED");
});

test("v0.10.1 orphaned RUNNING Nano request is requeue-eligible exactly once", () => {
  const run = {
    pendingObservation: { observationId: "observation-1" },
    pendingNanoRequest: null,
    nanoLifecycleRepairCount: 0,
    nanoTelemetry: {
      lastStatus: "RUNNING",
      lastStartedAt: "2026-08-06T00:00:00.000Z",
      lastCompletedAt: null
    }
  };
  assert.equal(evaluateInterruptedNanoRecovery(run, {
    now: Date.parse("2026-08-06T00:01:00.000Z")
  }).allowed, true);
  run.nanoLifecycleRepairCount = 1;
  const blocked = evaluateInterruptedNanoRecovery(run);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "REPAIR_LIMIT_REACHED");
});
