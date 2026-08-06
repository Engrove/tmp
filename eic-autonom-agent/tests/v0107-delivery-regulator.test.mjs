import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DELIVERY_REGULATOR_DISPOSITIONS,
  evaluateDirectProgramDelta,
  resolveDeliveryRegulatorDisposition
} from "../lib/delivery-kernel.mjs";
import { buildDeterministicDecision } from "../lib/fallback-planner.mjs";
import { NANO_ANALYSIS_MODES } from "../lib/nano-pipeline.mjs";

const focus = {
  primaryProgramGoal: "Fortsätt EIC backend",
  activeMilestone: "WP25.3",
  boundedCurrentUnit: "Ägarbind arbetsenheten",
  proposedAction: "Mappa TARGET_SESSION_OWNER"
};

test("v0.10.7 emit twin: unresolved owner CONTINUE is a complete required-control delivery", () => {
  const decision = buildDeterministicDecision({
    run: {
      maxAutonomousMode: true,
      targetTabId: 1974095744,
      conversationKey: "chatgpt:eic-backend"
    },
    observation: {
      targetResult: {
        valid: true,
        status: "CONTINUE",
        nextActor: "EXTERNAL_SYSTEM",
        next: "Mappa TARGET_SESSION_OWNER till en route-native owner-locator och komplettera arbetsenheten med owner-verifierbara preconditions, terminalChecks och acceptanceCriteria före varje effekt."
      }
    },
    continuityProjection: {
      intent: "Fortsätt EIC backend",
      position: { workUnit: "Ägarbind arbetsenheten" },
      evidenceRequirements: [],
      blockers: [],
      nextDirections: []
    },
    maxAutonomousMode: true,
    requestMode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS
  });

  assert.equal(decision.action, "CONTINUE");
  assert.equal(decision.directProgramDelta, 0);
  assert.equal(decision.requiredControl, true);
  assert.equal(decision.boundedStop, false);
  assert.match(decision.omissionFailure, /färsk route-native owner-read/i);
  assert.match(decision.unlocksNextAction, /Mappa TARGET_SESSION_OWNER/i);

  const gate = evaluateDirectProgramDelta({
    ...focus,
    proposedAction: decision.requestedAction,
    directProgramDelta: decision.directProgramDelta,
    requiredOwnerAction: decision.requiredControl,
    omissionFailure: decision.omissionFailure,
    unlocksNextAction: decision.unlocksNextAction
  });
  assert.equal(gate.allowed, true);
  assert.equal(gate.workClass, "REQUIRED_OWNER_OR_SAFETY");

  const disposition = resolveDeliveryRegulatorDisposition({
    action: decision.action,
    gate,
    observationId: "obs-owner",
    responseIdentity: "response-owner",
    requestedAction: decision.requestedAction,
    workUnit: decision.workUnit,
    ownerRoute: decision.ownerRoute,
    omissionFailure: decision.omissionFailure,
    unlocksNextAction: decision.unlocksNextAction
  });
  assert.equal(disposition.disposition, DELIVERY_REGULATOR_DISPOSITIONS.ALLOW);
  assert.equal(disposition.consumeObservation, false);
});

test("v0.10.7 direct delivery twin: concrete bounded patch carries positive program delta", () => {
  const decision = buildDeterministicDecision({
    run: {
      maxAutonomousMode: true,
      targetTabId: 7,
      conversationKey: "chatgpt:code"
    },
    observation: {
      targetResult: {
        valid: true,
        status: "CONTINUE",
        nextActor: "AGENT",
        next: "Patcha lib/graph.mjs och returnera fokustestets exit status."
      }
    },
    continuityProjection: {
      intent: "Reparera graph",
      position: { workUnit: "Graph repair" },
      evidenceRequirements: [],
      blockers: [],
      nextDirections: []
    },
    maxAutonomousMode: true,
    requestMode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS
  });

  assert.equal(decision.action, "CONTINUE");
  assert.equal(decision.directProgramDelta, 1);
  assert.equal(decision.requiredControl, false);

  const gate = evaluateDirectProgramDelta({
    ...focus,
    proposedAction: decision.requestedAction,
    directProgramDelta: decision.directProgramDelta,
    requiredOwnerAction: decision.requiredControl,
    omissionFailure: decision.omissionFailure,
    unlocksNextAction: decision.unlocksNextAction
  });
  assert.equal(gate.allowed, true);
  assert.equal(gate.workClass, "CORE_DELIVERY");
});

test("v0.10.7 block twin: incomplete zero-delta CONTINUE becomes stable new-evidence wait", () => {
  const gate = evaluateDirectProgramDelta({
    ...focus,
    directProgramDelta: 0,
    requiredOwnerAction: false,
    omissionFailure: "",
    unlocksNextAction: ""
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "DIRECT_PROGRAM_DELTA_ZERO");

  const disposition = resolveDeliveryRegulatorDisposition({
    action: "CONTINUE",
    gate,
    observationId: "obs-zero",
    responseIdentity: "response-zero",
    requestedAction: "Fortsätt analysera",
    workUnit: "Ägarbind arbetsenheten",
    ownerRoute: "TARGET_RESPONSE_PROTOCOL_AND_EIC_STATE_MACHINE"
  });
  assert.equal(disposition.disposition, DELIVERY_REGULATOR_DISPOSITIONS.WAIT_FOR_NEW_EVIDENCE);
  assert.equal(disposition.consumeObservation, true);
  assert.equal(disposition.wait.status, "WAITING_OWNER_EVIDENCE");
  assert.equal(disposition.wait.responseIdentity, "response-zero");
  assert.equal(disposition.wait.requiresNewResponseIdentity, true);
  assert.match(disposition.wait.omissionFailure, /saknar både ett direkt programdelta/i);
});

test("v0.10.7 background consumes rejected observation instead of entering SOFT_PAUSED", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const start = background.indexOf("const deliveryDisposition = resolveDeliveryRegulatorDisposition");
  const end = background.indexOf("let autonomy = assessAutonomousDecision", start);
  assert.ok(start >= 0 && end > start);
  const slice = background.slice(start, end);
  assert.match(slice, /run\.pendingObservation = null/);
  assert.match(slice, /STATES\.WAITING_FOR_RESPONSE/);
  assert.match(slice, /run\.lastProcessedResponseIdentity/);
  assert.match(slice, /run\.timeoutSuspended = true/);
  assert.doesNotMatch(slice, /STATES\.SOFT_PAUSED/);
  assert.doesNotMatch(slice, /setTimeout\(\(\) => tickWindow/);
});
