import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  AI_QUANTUM_MAX,
  AI_QUANTUM_MIN,
  RUNTIME_CONTROL_MAX_JSON_CHARS,
  applyRuntimeControlEffects,
  evaluateRuntimeControl,
  nextRuntimeControlState,
  parseRuntimeControlRequest,
  runtimeControlPromptState,
  settleRuntimeControlReceipts,
  withTerminalReceiptsRejected
} from "../lib/runtime-control.mjs";
import {
  PROMPT_PROFILE,
  compactPromptStillValid,
  missionFingerprint,
  nextFullOrdinal,
  promptSessionKey,
  selectPromptProfile,
  upgradedFullProfile
} from "../lib/prompt-profile.mjs";
import {
  applyGreenfieldControlToDecision,
  resolveGreenfieldControl
} from "../lib/greenfield-control.mjs";
import { validateHjalmarDecision } from "../lib/hjalmar-d2.mjs";
import { retireLogicalMissionSlots } from "../lib/queue-planning.mjs";
import {
  addMissionWorkItem,
  createQueueContext,
  loadMissionWorkQueue,
  normalizeMissionWorkItem,
  updateMissionWorkItem
} from "../lib/mission-work-queue.mjs";
import { parseTargetResponse } from "../lib/response-contract.mjs";
import {
  A2A_MESSAGE_TYPES,
  buildA2AEnvelope,
  composeA2APrompt,
  validateA2AEnvelope
} from "../lib/a2a.mjs";
import { ANALYSIS_SCHEMA } from "../lib/contracts.mjs";

const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");

const OWNER = Object.freeze({
  runId: "run-1",
  turn: 7,
  queueManaged: true,
  queueId: "queue-1",
  itemId: "slot-a1",
  savedMissionId: "gfw-a",
  promptIssuedAtMs: 10_000,
  responseHash: "hash-response-7",
  ledger: [],
  item: {
    itemId: "slot-a1",
    savedMissionId: "gfw-a",
    status: "ACTIVE",
    priority: "HIGH",
    operatorPriority: "HIGH",
    operatorEditedAtMs: 0,
    maxInteractions: 5
  }
});

const TARGET = Object.freeze({
  runId: "run-1",
  turn: 7,
  queueId: "queue-1",
  itemId: "slot-a1",
  savedMissionId: "gfw-a"
});

function request(actions, target = TARGET) {
  return parseRuntimeControlRequest({ target: { ...target }, actions });
}

function owner(patch = {}) {
  return { ...OWNER, ...patch, item: patch.item === null ? null : { ...OWNER.item, ...(patch.item || {}) } };
}

function hjalmarContinue() {
  return {
    schema: ANALYSIS_SCHEMA,
    disposition: "CONTINUE",
    targetDisposition: "DONE",
    objectiveStatus: "PENDING",
    nanoTaskAssessment: "NOT_REQUESTED",
    progressEvidence: "Progress evidence.",
    analysis: "Controller analysis.",
    nextPrompt: "Continue with the next bounded package.",
    exactTarget: "Objective.",
    ownerEvidence: "Response.",
    reversibility: "YES",
    rollbackPath: "Owner state.",
    readbackPlan: "Readback.",
    materialAmbiguity: "NONE",
    humanAuthorityRequired: false,
    confidence: "HIGH"
  };
}

function slots() {
  return [
    { itemId: "slot-a1", savedMissionId: "gfw-a", status: "ACTIVE", order: 0, priority: "HIGH", maxInteractions: 5, lastSummary: "" },
    { itemId: "slot-b", savedMissionId: "gfw-b", status: "READY", order: 1, priority: "NORMAL", maxInteractions: 3, lastSummary: "" },
    { itemId: "slot-a2", savedMissionId: "gfw-a", status: "READY", order: 2, priority: "LOW", maxInteractions: 2, lastSummary: "" },
    { itemId: "slot-c", savedMissionId: "", status: "READY", order: 3, priority: "NORMAL", maxInteractions: 4, lastSummary: "" },
    { itemId: "slot-d", savedMissionId: "", status: "READY", order: 4, priority: "NORMAL", maxInteractions: 4, lastSummary: "" }
  ];
}

function storageMock(initial = {}) {
  const state = structuredClone(initial);
  return {
    state,
    async get(key) {
      if (typeof key === "string") return { [key]: structuredClone(state[key]) };
      return structuredClone(state);
    },
    async set(values) {
      Object.assign(state, structuredClone(values));
    }
  };
}

// 1
test("v1.7.7 valid COMPLETE_MISSION for the current GFW is accepted and overrides a CONTINUE controller verdict", () => {
  const evaluation = evaluateRuntimeControl({
    request: request([{ op: "COMPLETE_MISSION" }]),
    status: "DONE",
    owner: owner()
  });
  assert.equal(evaluation.terminal.requested, true);
  assert.equal(evaluation.terminal.accepted, true);
  assert.equal(evaluation.terminal.source, "RUNTIME_CONTROL");
  assert.equal(evaluation.receipts[0].status, "APPLIED");
  assert.equal(evaluation.receipts[0].reason, "LOGICAL_GFW_TERMINAL_ALL_DUPLICATE_SLOTS_RETIRE");
  assert.deepEqual(evaluation.effects, []);

  const control = resolveGreenfieldControl({
    targetDisposition: "DONE",
    decision: hjalmarContinue(),
    sessionAction: "KEEP",
    terminalControl: evaluation.terminal
  });
  assert.equal(control.reason, "EIC_RUNTIME_CONTROL_COMPLETE_MISSION");
  assert.equal(control.controllerOverride, true);
  const decision = applyGreenfieldControlToDecision(hjalmarContinue(), control);
  assert.equal(decision.disposition, "DONE");
  assert.equal(decision.objectiveStatus, "SATISFIED");
  assert.equal(decision.nextPrompt, "");
  assert.equal(validateHjalmarDecision(decision).ok, true);
});

// 2 + 3
test("v1.7.7 completion retires every duplicate slot of the logical mission and nothing else", () => {
  const queue = { queueId: "queue-1", items: slots(), history: [] };
  const { queue: after, finalizedSlots } = retireLogicalMissionSlots(queue, queue.items[0], {
    queueStatus: "DONE",
    completedAt: "2026-09-23T00:00:00.000Z",
    lastOutcome: "EIC_EXPLICIT_STOP_PROCESS",
    lastSummary: "done"
  });
  assert.deepEqual(finalizedSlots.map((item) => item.itemId), ["slot-a1", "slot-a2"]);
  assert.ok(finalizedSlots.every((item) => item.status === "DONE" && item.processSnapshot === null && item.resume === null));
  assert.deepEqual(after.items.map((item) => item.itemId), ["slot-b", "slot-c", "slot-d"]);
  assert.deepEqual(after.history.map((item) => item.itemId), ["slot-a1", "slot-a2"]);

  // A slot without savedMissionId retires only itself, never other unsaved slots.
  const unsaved = retireLogicalMissionSlots({ items: slots(), history: [] }, slots()[3], { queueStatus: "DONE" });
  assert.deepEqual(unsaved.finalizedSlots.map((item) => item.itemId), ["slot-c"]);
  assert.deepEqual(unsaved.queue.items.map((item) => item.itemId), ["slot-a1", "slot-b", "slot-a2", "slot-d"]);
});

// 4
test("v1.7.7 completion is idempotent at queue and control level", () => {
  const queue = { items: slots(), history: [] };
  const first = retireLogicalMissionSlots(queue, queue.items[0], { queueStatus: "DONE" });
  const second = retireLogicalMissionSlots(first.queue, queue.items[0], { queueStatus: "DONE" });
  assert.equal(second.finalizedSlots.length, 0);
  assert.deepEqual(second.queue.items, first.queue.items);
  assert.equal(second.queue.history.length, 2);

  const replay = evaluateRuntimeControl({
    request: request([{ op: "COMPLETE_MISSION" }]),
    status: "DONE",
    owner: owner({ item: null })
  });
  assert.equal(replay.terminal.accepted, true);
  assert.equal(replay.receipts[0].status, "ALREADY_APPLIED");
});

// 5
test("v1.7.7 stale or wrong run/turn/queue/item/mission targets are rejected without effect", () => {
  const cases = [
    [{ runId: "run-0" }, "WRONG_RUN"],
    [{ turn: 6 }, "STALE_TURN"],
    [{ queueId: "queue-2" }, "WRONG_QUEUE"],
    [{ itemId: "slot-a2" }, "WRONG_QUEUE_ITEM"],
    [{ savedMissionId: "gfw-b" }, "WRONG_SAVED_MISSION"]
  ];
  for (const [patch, reason] of cases) {
    const continued = evaluateRuntimeControl({
      request: request([{ op: "SET_PRIORITY", priority: "LOW" }], { ...TARGET, ...patch }),
      status: "CONTINUE",
      owner: owner()
    });
    assert.deepEqual(continued.effects, [], reason);
    assert.equal(continued.receipts[0].status, "STALE");
    assert.equal(continued.receipts[0].reason, reason);

    const terminal = evaluateRuntimeControl({
      request: request([{ op: "COMPLETE_MISSION" }], { ...TARGET, ...patch }),
      status: "DONE",
      owner: owner()
    });
    assert.equal(terminal.terminal.accepted, false, reason);
    const control = resolveGreenfieldControl({
      targetDisposition: "DONE",
      decision: hjalmarContinue(),
      terminalControl: terminal.terminal
    });
    assert.equal(control.reason, "RUNTIME_CONTROL_TERMINAL_REJECTED");
    assert.equal(applyGreenfieldControlToDecision(hjalmarContinue(), control).disposition, "BLOCKED");
  }
});

// 6
test("v1.7.7 valid SET_QUANTUM targets only the current slot and applies from the next quantum", () => {
  const evaluation = evaluateRuntimeControl({
    request: request([{ op: "SET_QUANTUM", maxInteractions: 8 }]),
    status: "CONTINUE",
    owner: owner()
  });
  assert.equal(evaluation.receipts[0].status, "APPLIED");
  assert.equal(evaluation.receipts[0].effective, "NEXT_QUANTUM");
  assert.deepEqual(evaluation.effects.map((effect) => [effect.itemId, effect.field, effect.value]), [["slot-a1", "maxInteractions", 8]]);
  const items = applyRuntimeControlEffects(slots(), evaluation.effects, { now: 0 });
  assert.equal(items.find((item) => item.itemId === "slot-a1").maxInteractions, 8);
  assert.equal(items.find((item) => item.itemId === "slot-a2").maxInteractions, 2);
  assert.equal(items.find((item) => item.itemId === "slot-a1").priority, "HIGH");
});

// 7
test("v1.7.7 quantum outside 1..15 or non-integer is rejected, never clamped", () => {
  for (const value of [0, -1, AI_QUANTUM_MAX + 1, 50, 2.5, "8", null, true]) {
    const evaluation = evaluateRuntimeControl({
      request: request([{ op: "SET_QUANTUM", maxInteractions: value }]),
      status: "CONTINUE",
      owner: owner()
    });
    assert.deepEqual(evaluation.effects, [], String(value));
    assert.equal(evaluation.receipts[0].status, "INVALID");
    assert.match(evaluation.receipts[0].reason, /^QUANTUM_(NOT_INTEGER|OUT_OF_BOUNDS)$/);
  }
  for (const value of [AI_QUANTUM_MIN, AI_QUANTUM_MAX]) {
    const evaluation = evaluateRuntimeControl({
      request: request([{ op: "SET_QUANTUM", maxInteractions: value }]),
      status: "CONTINUE",
      owner: owner()
    });
    assert.equal(evaluation.receipts[0].status, "APPLIED");
  }
});

// 8
test("v1.7.7 valid SET_PRIORITY lowers and later restores up to the operator ceiling", () => {
  const lower = evaluateRuntimeControl({
    request: request([{ op: "SET_PRIORITY", priority: "LOW" }]),
    status: "CONTINUE",
    owner: owner()
  });
  assert.equal(lower.receipts[0].status, "APPLIED");
  assert.equal(lower.receipts[0].effective, "IMMEDIATE");
  const items = applyRuntimeControlEffects(slots(), lower.effects, { now: 0 });
  assert.equal(items.find((item) => item.itemId === "slot-a1").priority, "LOW");
  assert.equal(items.find((item) => item.itemId === "slot-a2").priority, "LOW", "unchanged original value");
  assert.equal(items.find((item) => item.itemId === "slot-b").priority, "NORMAL");

  const restore = evaluateRuntimeControl({
    request: request([{ op: "SET_PRIORITY", priority: "HIGH" }]),
    status: "CONTINUE",
    owner: owner({ item: { priority: "LOW", operatorPriority: "HIGH" } })
  });
  assert.equal(restore.receipts[0].status, "APPLIED");
});

// 9
test("v1.7.7 priorities outside the whitelist or above the operator ceiling are rejected", () => {
  for (const priority of ["low", "CRITICAL", "", 3, null]) {
    const evaluation = evaluateRuntimeControl({
      request: request([{ op: "SET_PRIORITY", priority }]),
      status: "CONTINUE",
      owner: owner()
    });
    assert.deepEqual(evaluation.effects, []);
    assert.equal(evaluation.receipts[0].status, "INVALID");
    assert.equal(evaluation.receipts[0].reason, "PRIORITY_NOT_ALLOWED");
  }
  const escalation = evaluateRuntimeControl({
    request: request([{ op: "SET_PRIORITY", priority: "URGENT" }]),
    status: "CONTINUE",
    owner: owner()
  });
  assert.deepEqual(escalation.effects, []);
  assert.equal(escalation.receipts[0].status, "REJECTED");
  assert.equal(escalation.receipts[0].reason, "PRIORITY_ABOVE_OPERATOR_CEILING");
});

// 10
test("v1.7.7 unknown runtime-control operations are rejected without effect", () => {
  for (const op of ["DELETE_QUEUE", "SET_ORDER", "complete_mission", "__proto__", ""]) {
    const evaluation = evaluateRuntimeControl({
      request: request([{ op }]),
      status: "CONTINUE",
      owner: owner()
    });
    assert.deepEqual(evaluation.effects, []);
    assert.equal(evaluation.terminal, null);
    assert.equal(evaluation.receipts[0].status, "INVALID");
    assert.equal(evaluation.receipts[0].reason, "UNKNOWN_OPERATION");
  }
});

// 11
test("v1.7.7 malformed or hostile control yields INVALID receipts and no mutation", () => {
  const hostile = [
    "retire everything",
    ["SET_PRIORITY"],
    42,
    { actions: [{ op: "SET_PRIORITY", priority: "LOW" }] },
    { target: "slot-a1", actions: [{ op: "SET_PRIORITY", priority: "LOW" }] },
    { target: { ...TARGET, extra: 1 }, actions: [{ op: "SET_PRIORITY", priority: "LOW" }] },
    { target: { ...TARGET }, actions: [] },
    { target: { ...TARGET }, actions: "SET_PRIORITY" },
    { target: { ...TARGET }, actions: [{ op: "SET_PRIORITY", priority: "LOW" }], path: "queue.items[0].priority" },
    { target: { ...TARGET }, actions: [{ op: "SET_PRIORITY", priority: "LOW", field: "status", value: "DONE" }] },
    { target: { ...TARGET }, actions: Array.from({ length: 5 }, () => ({ op: "SET_PRIORITY", priority: "LOW" })) },
    { target: { ...TARGET }, actions: [{ op: "SET_PRIORITY", priority: "LOW", reason: "x".repeat(RUNTIME_CONTROL_MAX_JSON_CHARS) }] },
    JSON.parse('{"target":{"runId":"run-1","turn":7,"queueId":"queue-1","itemId":"slot-a1","savedMissionId":"gfw-a"},"actions":[{"op":"SET_PRIORITY","priority":"LOW","__proto__":{"status":"DONE"}}]}')
  ];
  for (const raw of hostile) {
    const parsed = parseRuntimeControlRequest(raw);
    const evaluation = evaluateRuntimeControl({ request: parsed, status: "CONTINUE", owner: owner() });
    assert.deepEqual(evaluation.effects, [], JSON.stringify(raw).slice(0, 80));
    assert.equal(evaluation.terminal, null);
    assert.ok(evaluation.receipts.length >= 1);
    assert.ok(evaluation.receipts.every((row) => row.status === "INVALID"));
  }
  assert.equal(Object.prototype.status, undefined);

  // A malformed block never hides the response's terminal status from Greenfield.
  const text = JSON.stringify({
    schema: "eic.a2a.response.v1",
    status: "DONE",
    sessionAction: "STOP_PROCESS",
    summary: "Done.",
    workPerformed: ["x"],
    evidence: ["y"],
    blockers: [],
    nextSuggestedAction: "",
    runtimeControl: "please retire this mission"
  });
  const parsedResponse = parseTargetResponse(text);
  assert.equal(parsedResponse.ok, true);
  assert.equal(parsedResponse.status, "DONE");
  assert.equal(parsedResponse.value.runtimeControl.errors[0], "RUNTIME_CONTROL_NOT_OBJECT");
  const legacy = evaluateRuntimeControl({
    request: parsedResponse.value.runtimeControl,
    status: parsedResponse.status,
    sessionAction: parsedResponse.value.sessionAction,
    owner: owner()
  });
  assert.equal(legacy.terminal.accepted, true, "legacy terminal is not made worse by a malformed block");
  assert.equal(legacy.terminal.source, "LEGACY_STOP_PROCESS");
});

// 12
test("v1.7.7 an operator edit after the prompt wins over a stale AI request; operator path stamps precedence", async () => {
  const stale = evaluateRuntimeControl({
    request: request([{ op: "SET_QUANTUM", maxInteractions: 3 }, { op: "SET_PRIORITY", priority: "LOW" }]),
    status: "CONTINUE",
    owner: owner({ item: { operatorEditedAtMs: OWNER.promptIssuedAtMs + 1 } })
  });
  assert.deepEqual(stale.effects, []);
  assert.deepEqual(stale.receipts.map((row) => [row.status, row.reason]), [
    ["REJECTED", "OPERATOR_PRECEDENCE"],
    ["REJECTED", "OPERATOR_PRECEDENCE"]
  ]);

  const storage = storageMock();
  let queue = await addMissionWorkItem(1, "Mission A", { storage, workerId: "w", savedMissionId: "gfw-a", priority: "HIGH", now: 1 });
  const itemId = queue.items[0].itemId;
  assert.equal(queue.items[0].operatorPriority, "HIGH");
  assert.equal(queue.items[0].operatorEditedAtMs, 0);
  queue = await updateMissionWorkItem(1, itemId, { priority: "NORMAL", maxInteractions: 5 }, storage, { workerId: "w", now: 12_345 });
  assert.equal(queue.items[0].priority, "NORMAL");
  assert.equal(queue.items[0].operatorPriority, "NORMAL");
  assert.equal(queue.items[0].operatorEditedAtMs, 12_345);
  const reloaded = await loadMissionWorkQueue(1, storage, { workerId: "w" });
  assert.equal(reloaded.items[0].operatorEditedAtMs, 12_345);
});

// 13
test("v1.7.7 a normal v1.7.6 response without runtimeControl keeps working and is a control no-op", () => {
  const text = JSON.stringify({
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    summary: "Progress.",
    workPerformed: ["x"],
    evidence: ["y"],
    blockers: [],
    nextSuggestedAction: "Continue with the next bounded package."
  });
  const parsed = parseTargetResponse(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.runtimeControl, null);
  const evaluation = evaluateRuntimeControl({ request: parsed.value.runtimeControl, status: "CONTINUE", owner: owner() });
  assert.deepEqual(evaluation, { terminal: null, effects: [], receipts: [] });
  const control = resolveGreenfieldControl({
    targetDisposition: "CONTINUE",
    targetNextSuggestedAction: parsed.value.nextSuggestedAction,
    decision: { ...hjalmarContinue(), targetDisposition: "CONTINUE" },
    terminalControl: evaluation.terminal
  });
  assert.equal(control.reason, "HJALMAR_CONTINUE");
  assert.equal(control.controllerOverride, undefined);
  assert.equal(parseRuntimeControlRequest(null), null, "explicit null is treated as absent");
});

// 14
test("v1.7.7 legacy status=DONE and sessionAction=STOP_PROCESS normalize to the same terminal handler", () => {
  for (const [status, sessionAction, source, reason] of [
    ["DONE", "KEEP", "LEGACY_STATUS_DONE", "EIC_EXPLICIT_STATUS_DONE"],
    ["DONE", "STOP_PROCESS", "LEGACY_STOP_PROCESS", "EIC_EXPLICIT_STOP_PROCESS"],
    ["CONTINUE", "STOP_PROCESS", "LEGACY_STOP_PROCESS", "EIC_EXPLICIT_STOP_PROCESS"]
  ]) {
    const evaluation = evaluateRuntimeControl({ request: null, status, sessionAction, owner: owner() });
    assert.equal(evaluation.terminal.accepted, true);
    assert.equal(evaluation.terminal.source, source);
    assert.equal(evaluation.receipts[0].op, "COMPLETE_MISSION");
    assert.equal(evaluation.receipts[0].status, "APPLIED");
    const control = resolveGreenfieldControl({
      targetDisposition: status,
      decision: hjalmarContinue(),
      sessionAction,
      terminalControl: evaluation.terminal
    });
    assert.equal(control.reason, reason);
    const decision = applyGreenfieldControlToDecision(hjalmarContinue(), control);
    assert.equal(decision.disposition, "DONE", "v1.7.6 defect: controller CONTINUE must not survive an EIC terminal control");
    assert.equal(validateHjalmarDecision(decision).ok, true);
  }
  // Legacy callers without a terminal verdict get the same enforced override.
  const legacyCaller = resolveGreenfieldControl({
    targetDisposition: "CONTINUE",
    decision: hjalmarContinue(),
    sessionAction: "STOP_PROCESS"
  });
  assert.equal(legacyCaller.controllerOverride, true);
  assert.equal(applyGreenfieldControlToDecision(hjalmarContinue(), legacyCaller).disposition, "DONE");
});

// 15
test("v1.7.7 Greenfield prompt publishes runtime-control operations, exact schema, target and constraints", () => {
  const process = {
    processId: "p",
    runId: "run-1",
    generation: 1,
    turn: 7,
    sessionSeq: 1,
    goal: "Mission A",
    queueContext: createQueueContext(
      { queueId: "queue-1", workerId: "w" },
      normalizeMissionWorkItem({ itemId: "slot-a1", savedMissionId: "gfw-a", goal: "Mission A", priority: "HIGH", maxInteractions: 5 })
    )
  };
  const envelope = buildA2AEnvelope({ process, objective: "Continue.", messageType: "CONTINUATION" });
  const contract = envelope.responseContract.runtimeControlContract;
  assert.deepEqual(Object.keys(contract.operations), ["COMPLETE_MISSION", "SET_QUANTUM", "SET_PRIORITY"]);
  assert.match(contract.format, /runtimeControl = \{"target"/);
  assert.match(contract.target, /Copy it unchanged/);
  assert.equal(contract.constraints.quantumMin, 1);
  assert.equal(contract.constraints.quantumMax, 15);
  assert.deepEqual(contract.constraints.priorities, ["LOW", "NORMAL", "HIGH", "URGENT"]);
  assert.match(contract.terminalSemantics, /status=DONE and sessionAction=STOP_PROCESS are terminal/);
  assert.match(contract.operations.COMPLETE_MISSION, /retires EVERY queue slot of this logical mission/);
  assert.match(contract.duplicateSlots, /all duplicate slots of the same savedMissionId/);
  assert.match(contract.structuredOnly, /never parsed as control/);
  const schema = envelope.responseContract.jsonSchema.properties.runtimeControl;
  assert.deepEqual(schema.required, ["target", "actions"]);
  assert.deepEqual(schema.properties.target.required, ["runId", "turn", "queueId", "itemId", "savedMissionId"]);
  assert.equal(schema.properties.actions.items.oneOf.length, 3);
  assert.deepEqual(envelope.control.runtimeControl.target, {
    runId: "run-1",
    turn: 7,
    queueId: "queue-1",
    itemId: "slot-a1",
    savedMissionId: "gfw-a"
  });
  assert.equal(envelope.control.runtimeControl.current.priorityCeiling, "HIGH");
  assert.match(envelope.responseContract.note, /runtimeControl requests typed runtime effects/);
  assert.match(envelope.control.workQueue.loopRule, /COMPLETE_MISSION is the structured form/);

  const single = buildA2AEnvelope({ process: { ...process, queueContext: null }, objective: "Continue.", messageType: "CONTINUATION" });
  assert.deepEqual(Object.keys(single.responseContract.runtimeControlContract.operations), ["COMPLETE_MISSION"]);
  assert.equal(single.responseContract.jsonSchema.properties.runtimeControl.properties.actions.items.oneOf.length, 1);
  assert.deepEqual(single.control.runtimeControl.operations, ["COMPLETE_MISSION"]);
});

// 16
test("v1.7.7 prompt states that Greenfield validates every request and operator control has precedence", () => {
  const envelope = buildA2AEnvelope({
    process: { processId: "p", runId: "r", generation: 1, turn: 1, sessionSeq: 1, goal: "Mission" },
    objective: "Start.",
    messageType: "MISSION_START"
  });
  const contract = envelope.responseContract.runtimeControlContract;
  assert.equal(contract.authority, "REQUEST_ONLY_GREENFIELD_VALIDATES_AND_OWNS_EFFECT");
  assert.equal(contract.precedence, "operator runtime control > validated Greenfield owner state > AI runtime-control request");
  assert.match(contract.validation, /may be accepted or rejected by Greenfield after validation/);
  assert.match(contract.validation, /never mutates state/);
  assert.match(contract.operatorPrecedence, /authoritative/);
  assert.match(contract.operatorPrecedence, /never widens/);
  assert.match(envelope.responseContract.note, /operator runtime control always wins/);
  assert.match(envelope.responseContract.note, /never come from prose/);
});

test("v1.7.7 replay of an applied effect is ALREADY_APPLIED; duplicate ops and terminal-less COMPLETE are invalid", () => {
  const first = evaluateRuntimeControl({
    request: request([{ op: "SET_QUANTUM", maxInteractions: 9 }]),
    status: "CONTINUE",
    owner: owner()
  });
  const state = nextRuntimeControlState(null, first.receipts, { turn: 7, responseHash: OWNER.responseHash });
  assert.equal(state.ledger.length, 1);
  const replay = evaluateRuntimeControl({
    request: request([{ op: "SET_QUANTUM", maxInteractions: 9 }]),
    status: "CONTINUE",
    owner: owner({ ledger: state.ledger })
  });
  assert.equal(replay.receipts[0].status, "ALREADY_APPLIED");
  assert.equal(replay.effects[0].noop, true);
  assert.deepEqual(applyRuntimeControlEffects(slots(), replay.effects), slots());

  const valueAlreadyCurrent = evaluateRuntimeControl({
    request: request([{ op: "SET_PRIORITY", priority: "HIGH" }]),
    status: "CONTINUE",
    owner: owner()
  });
  assert.equal(valueAlreadyCurrent.receipts[0].status, "ALREADY_APPLIED");

  const duplicate = evaluateRuntimeControl({
    request: request([{ op: "SET_PRIORITY", priority: "LOW" }, { op: "SET_PRIORITY", priority: "NORMAL" }]),
    status: "CONTINUE",
    owner: owner()
  });
  assert.deepEqual(duplicate.effects, []);
  assert.ok(duplicate.receipts.every((row) => row.reason === "DUPLICATE_OPERATION"));

  const noTerminal = evaluateRuntimeControl({
    request: request([{ op: "COMPLETE_MISSION" }]),
    status: "CONTINUE",
    owner: owner()
  });
  assert.equal(noTerminal.terminal, null);
  assert.equal(noTerminal.receipts[0].reason, "TERMINAL_STATUS_REQUIRED");
});

test("v1.7.7 terminal supersedes slot controls; inactive, absent or non-queue slots are not mutated", () => {
  const superseded = evaluateRuntimeControl({
    request: request([{ op: "COMPLETE_MISSION" }, { op: "SET_PRIORITY", priority: "LOW" }]),
    status: "DONE",
    owner: owner()
  });
  assert.equal(superseded.terminal.accepted, true);
  assert.deepEqual(superseded.effects, []);
  assert.equal(superseded.receipts.find((row) => row.op === "SET_PRIORITY").reason, "SUPERSEDED_BY_TERMINAL");

  const inactive = evaluateRuntimeControl({
    request: request([{ op: "SET_PRIORITY", priority: "LOW" }]),
    status: "CONTINUE",
    owner: owner({ item: { status: "PAUSED" } })
  });
  assert.equal(inactive.receipts[0].reason, "SLOT_NOT_ACTIVE");

  const absent = evaluateRuntimeControl({
    request: request([{ op: "SET_PRIORITY", priority: "LOW" }]),
    status: "CONTINUE",
    owner: owner({ item: null })
  });
  assert.equal(absent.receipts[0].status, "STALE");

  const single = evaluateRuntimeControl({
    request: request([{ op: "SET_QUANTUM", maxInteractions: 4 }], { runId: "run-1", turn: 7, queueId: "", itemId: "", savedMissionId: "" }),
    status: "CONTINUE",
    owner: { runId: "run-1", turn: 7, queueManaged: false }
  });
  assert.equal(single.receipts[0].reason, "NOT_QUEUE_MANAGED");
  assert.deepEqual(single.effects, []);
});

test("v1.7.7 receipts never claim an effect whose queue write failed and are carried in the next prompt", () => {
  const evaluation = evaluateRuntimeControl({
    request: request([{ op: "SET_PRIORITY", priority: "LOW" }]),
    status: "CONTINUE",
    owner: owner()
  });
  const settled = settleRuntimeControlReceipts(evaluation.receipts, { committed: false, errorCode: "MISSION_WORK_QUEUE_STALE_WRITE" });
  assert.equal(settled[0].status, "REJECTED");
  assert.match(settled[0].reason, /^EFFECT_COMMIT_FAILED:/);
  const state = nextRuntimeControlState(null, settled, { turn: 7, responseHash: "abcdef0123456789xyz" });
  assert.equal(state.ledger.length, 0, "failed effects never enter the replay ledger");
  const prompt = runtimeControlPromptState({
    runId: "run-1",
    turn: 8,
    runtimeControl: state,
    queueContext: { itemId: "slot-a1", queueId: "queue-1", savedMissionId: "gfw-a", priority: "HIGH", operatorPriority: "HIGH", maxInteractions: 5, pendingMaxInteractions: 9 }
  });
  assert.equal(prompt.lastReceipts[0].status, "REJECTED");
  assert.equal(prompt.lastReceipts[0].responseHash.length, 16);
  assert.equal(prompt.target.turn, 8);
  assert.equal(prompt.current.currentQuantumMaxInteractions, 5);
  assert.equal(prompt.current.nextQuantumMaxInteractions, 9);
});

test("v1.7.7 legacy queue items gain an operator ceiling equal to their priority", () => {
  const legacy = normalizeMissionWorkItem({ itemId: "x", goal: "g", priority: "HIGH" });
  assert.equal(legacy.operatorPriority, "HIGH");
  assert.equal(legacy.operatorEditedAtMs, 0);
  const context = createQueueContext({ queueId: "q" }, { ...legacy, priority: "LOW" });
  assert.equal(context.operatorPriority, "HIGH");
});

test("v1.7.7 prompt profile: session-boundary prompts are FULL, same-conversation follow-ups COMPACT, every 10th FULL", () => {
  const process = { processId: "p", runId: "r", sessionSeq: 1, tabId: 11, goal: "Mission" };
  const observed = { responseConversationKey: "https://chatgpt.com/c/abc" };
  for (const messageType of ["MISSION_START", "MISSION_RESTORE", "SESSION_ROTATION", "IDLE_KEEPALIVE"]) {
    assert.equal(selectPromptProfile({ process, messageType, previous: null, observed }).profile, PROMPT_PROFILE.FULL);
  }
  let previous = selectPromptProfile({ process, messageType: "MISSION_START" });
  assert.equal(previous.ordinal, 1);
  const profiles = [];
  for (let prompt = 2; prompt <= 22; prompt += 1) {
    previous = selectPromptProfile({ process, messageType: "CONTINUATION", previous, observed });
    profiles.push([previous.ordinal, previous.profile]);
  }
  const full = profiles.filter(([, profile]) => profile === "FULL").map(([ordinal]) => ordinal);
  assert.deepEqual(full, [11, 21]);
  assert.equal(profiles.filter(([, profile]) => profile === "COMPACT").length, 19);
  assert.equal(nextFullOrdinal(2), 11);
  assert.equal(nextFullOrdinal(11), 21);
});

test("v1.7.8 prompt profile: any session or conversation discontinuity forces FULL; a same-conversation reload does not", () => {
  const process = { processId: "p", runId: "r", sessionSeq: 1, tabId: 11, goal: "Mission" };
  const observed = { responseConversationKey: "https://chatgpt.com/c/abc" };
  const first = selectPromptProfile({ process, messageType: "MISSION_START" });
  const compact = selectPromptProfile({ process, messageType: "CONTINUATION", previous: first, observed });
  assert.equal(compact.profile, "COMPACT");
  const cases = [
    [{ ...process, sessionSeq: 2 }, observed, "SESSION_BOUNDARY"],
    [{ ...process, tabId: 12 }, observed, "SESSION_BOUNDARY"],
    [{ ...process, goal: "Other mission" }, observed, "SESSION_BOUNDARY"],
    [{ ...process, queueContext: { itemId: "slot-2", queueId: "q" } }, observed, "SESSION_BOUNDARY"],
    [process, { responseConversationKey: "https://chatgpt.com/c/other" }, "CONVERSATION_CHANGED"],
    [process, { responseConversationKey: "" }, "SESSION_IDENTITY_UNPROVEN"],
    [process, {}, "SESSION_IDENTITY_UNPROVEN"]
  ];
  for (const [proc, obs, reason] of cases) {
    const next = selectPromptProfile({ process: proc, messageType: "CONTINUATION", previous: compact, observed: obs });
    assert.equal(next.profile, "FULL", reason);
    assert.equal(next.reason, reason);
  }
  const forced = selectPromptProfile({ process, messageType: "CONTINUATION", previous: compact, observed, forceFull: true, forceReason: "AI_REQUESTED_FULL_PROMPT" });
  assert.equal(forced.profile, "FULL");
  assert.equal(forced.reason, "AI_REQUESTED_FULL_PROMPT");

  const next = selectPromptProfile({ process, messageType: "CONTINUATION", previous: compact, observed });
  assert.equal(next.profile, "COMPACT");
  assert.equal(next.anchorConversationKey, "https://chatgpt.com/c/abc");
  assert.equal(Object.hasOwn(next, "anchorDocumentId"), false, "document identity is not a continuity criterion");
  assert.equal(compactPromptStillValid(next, { conversationKey: "https://chatgpt.com/c/abc" }), true, "reload of the same conversation stays valid");
  assert.equal(compactPromptStillValid(next, { conversationKey: "https://chatgpt.com/c/new" }), false);
  assert.equal(compactPromptStillValid(next, { conversationKey: "" }), false, "new chat without /c/ id is not the anchor");
  assert.equal(upgradedFullProfile(next).profile, "FULL");
  assert.notEqual(promptSessionKey(process), promptSessionKey({ ...process, runId: "r2" }));
  assert.match(missionFingerprint("Mission"), /^fnv1a32:[0-9a-f]{8}$/);
});

test("v1.7.7 COMPACT envelope keeps every per-turn and safety invariant and validates", () => {
  const process = {
    processId: "p",
    runId: "run-1",
    generation: 1,
    turn: 4,
    sessionSeq: 1,
    goal: "Mission A with a long session-wide description.",
    queueContext: createQueueContext(
      { queueId: "queue-1", workerId: "w" },
      normalizeMissionWorkItem({ itemId: "slot-a1", savedMissionId: "gfw-a", goal: "Mission A", priority: "HIGH", maxInteractions: 3, quantumProgress: 2 }),
      { interactionCount: 2 }
    )
  };
  const profile = { profile: "COMPACT", ordinal: 4, lastFullOrdinal: 1, nextFullOrdinal: 11, missionFingerprint: missionFingerprint(process.goal) };
  const args = {
    process,
    objective: "Continue the bounded package.",
    messageType: "CONTINUATION",
    operatorInstruction: { instructionId: "i1", text: "Operator note." },
    at: 5
  };
  const full = composeA2APrompt(args);
  const compact = composeA2APrompt({ ...args, promptProfile: profile });
  assert.equal(validateA2AEnvelope(compact.envelope).ok, true);
  assert.ok(compact.text.length < full.text.length / 2);
  const e = compact.envelope;
  assert.equal(e.promptProfile.profile, "COMPACT");
  assert.equal(e.objective, "Continue the bounded package.");
  assert.equal(e.operatorInstruction.text, "Operator note.");
  assert.deepEqual(e.process, full.envelope.process);
  assert.deepEqual(e.control.runtimeControl, full.envelope.control.runtimeControl);
  assert.deepEqual(e.control.ownerState, full.envelope.control.ownerState);
  assert.equal(e.responseContract.ownerStateRule, full.envelope.responseContract.ownerStateRule);
  assert.equal(e.control.selfContinuationAuthority, false);
  assert.equal(e.control.workQueue.checkpointRequired, true);
  assert.equal(e.control.workQueue.checkpointInstruction, full.envelope.control.workQueue.checkpointInstruction,
    "final interaction keeps the checkpoint rule even in COMPACT");
  assert.equal(e.control.workQueue.orderRule, undefined);
  assert.match(e.mission, new RegExp(`missionFingerprint=${profile.missionFingerprint}`));
  assert.match(e.responseContract.runtimeControl, /Greenfield validates every request and operator control wins/);
  assert.equal(e.responseContract.jsonSchema, undefined);
  assert.equal(full.envelope.promptProfile.profile, "FULL");
  assert.ok(full.envelope.responseContract.runtimeControlContract);
});

test("v1.7.7 MISSION_RESTORE is an admitted A2A message type (queue restore path)", () => {
  assert.ok(A2A_MESSAGE_TYPES.includes("MISSION_RESTORE"));
  const envelope = buildA2AEnvelope({
    process: { processId: "p", runId: "r", generation: 1, turn: 1, sessionSeq: 1, goal: "Mission" },
    objective: "Resume from owner state.",
    messageType: "MISSION_RESTORE"
  });
  assert.equal(envelope.messageType, "MISSION_RESTORE");
  assert.equal(envelope.promptProfile.profile, "FULL");
});

test("v1.7.7 background wires one control point, terminal verdicts, self-heal and dispatch-time FULL upgrade", () => {
  assert.match(background, /async function evaluateAndApplyRuntimeControl\(current, result\)/);
  assert.match(background, /terminalControl: runtimeControl\.terminal/);
  assert.match(background, /persistTerminalQueueRetirement/);
  assert.match(background, /retireLogicalMissionSlots/);
  assert.match(background, /await reconcileTerminalQueueSlot\(current\);/);
  assert.match(background, /await reconcileTerminalQueueSlot\(process\);/);
  assert.match(background, /upgradeCompactPendingPrompt\(process, page\)/);
  assert.match(background, /conversationKey: conversationKey\(page\.url \|\| ""\)/);
  assert.match(background, /responseConversationKey: process\.lastResponse\?\.observation\?\.conversationKey/);
  assert.match(background, /promptProfile: pending\.promptProfile/);
  assert.doesNotMatch(background, /\beval\(|new Function\(/);
});

test("v1.7.7 receipts identify the mutated slot and an uncommitted terminal is reported as rejected", () => {
  const slot = evaluateRuntimeControl({
    request: request([{ op: "SET_PRIORITY", priority: "LOW" }]),
    status: "CONTINUE",
    owner: owner()
  });
  const state = nextRuntimeControlState(null, slot.receipts, { turn: 7, responseHash: "h" });
  assert.equal(state.lastReceipts[0].itemId, "slot-a1");

  const terminal = evaluateRuntimeControl({ request: null, status: "DONE", owner: owner() });
  const terminalState = nextRuntimeControlState(null, terminal.receipts, { turn: 7, responseHash: "h" });
  assert.equal(terminalState.lastReceipts[0].status, "APPLIED");
  const rejected = withTerminalReceiptsRejected(terminalState, "OPERATOR_INSTRUCTION_PENDING");
  assert.equal(rejected.lastReceipts[0].status, "REJECTED");
  assert.equal(rejected.lastReceipts[0].reason, "OPERATOR_INSTRUCTION_PENDING");
  assert.equal(withTerminalReceiptsRejected(null, "X"), null);
});

test("v1.7.7 an operator priority edit is never blocked by an AI-changed quantum on the active slot", async () => {
  const storage = storageMock();
  let queue = await addMissionWorkItem(1, "Mission A", { storage, workerId: "w", savedMissionId: "gfw-a", priority: "HIGH", maxInteractions: 5, now: 1 });
  const itemId = queue.items[0].itemId;
  queue.items = applyRuntimeControlEffects(
    queue.items.map((item) => ({ ...item, status: "ACTIVE" })),
    [{ itemId, field: "maxInteractions", value: 8 }]
  );
  queue.activeItemId = itemId;
  const { saveMissionWorkQueue } = await import("../lib/mission-work-queue.mjs");
  await saveMissionWorkQueue(queue, storage);
  queue = await updateMissionWorkItem(1, itemId, { priority: "LOW", maxInteractions: undefined }, storage, { workerId: "w", now: 99 });
  assert.equal(queue.items[0].priority, "LOW");
  assert.equal(queue.items[0].operatorPriority, "LOW");
  assert.equal(queue.items[0].maxInteractions, 8, "absent field is not reset");
  await assert.rejects(
    updateMissionWorkItem(1, itemId, { maxInteractions: 3 }, storage, { workerId: "w" }),
    /MISSION_WORK_QUEUE_ACTIVE_QUANTUM_IMMUTABLE/
  );
  const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(panel, /\? \{ itemId, priority: event\.target\.value \}/);
});
