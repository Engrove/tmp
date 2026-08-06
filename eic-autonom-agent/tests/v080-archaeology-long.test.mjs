import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  RUN_MODES,
  createDefaultConfig
} from "../lib/contracts.mjs";
import {
  CURRENT_NANO_MANDATE,
  CURRENT_TARGET_MANDATE,
  NANO_CORE_PROFILES,
  TARGET_CORE_PROFILES,
  SCENARIO_PRESETS
} from "../lib/core-profiles.mjs";
import {
  ARCHAEOLOGY_EFFECT_CEILING,
  ARCHAEOLOGY_EVENT_MARKER,
  ARCHAEOLOGY_EVENT_PROTOCOL,
  ARCHAEOLOGY_GATES,
  ARCHAEOLOGY_SCENARIOS,
  createArchaeologyRunState
} from "../lib/archaeology-contract.mjs";
import {
  applyArchaeologyEvent,
  archaeologyEventPlacement,
  evaluateArchaeologyEvent,
  parseArchaeologyEvent
} from "../lib/archaeology-parser.mjs";
import { buildArchaeologyStartPrompt } from "../lib/archaeology-prompt.mjs";
import { parseTargetResult } from "../lib/prompt-contract.mjs";
import { buildDeterministicDecision } from "../lib/fallback-planner.mjs";
import { protocolFastPathEligible } from "../lib/protocol-fast-path.mjs";
import { classifyDestructiveness } from "../lib/destructiveness.mjs";
import {
  NANO_ANALYSIS_MODES,
  buildNanoDecisionPromptDetailed
} from "../lib/nano-pipeline.mjs";
import { PAUSE_ORIGINS } from "../lib/state-machine.mjs";

const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");

function event(overrides = {}) {
  return {
    protocol: ARCHAEOLOGY_EVENT_PROTOCOL,
    run_id: "arch-run-1",
    turn_id: "turn-1",
    scenario: "ERP_REVERSE_ENGINEERING",
    step_no: 1,
    phase: "SOURCE_INVENTORY",
    coverage_unit: "erp-order-status",
    hypothesis_id: "H-001",
    hypothesis: "Order status transitions are controlled by a generation-specific lookup.",
    hypothesis_status: "OPEN",
    method: "Read schema metadata and compare status references.",
    observation: "Two status reference candidates were located; causality is not established.",
    result: "OBSERVED",
    evidence_locators: ["workspace:file:work/schema/status_candidates.json"],
    workspace_recommendations: [{
      capability_family: "source inspection",
      probe: "workspace.op.describe",
      reason: "Resolve the exact source inspection opcode and required fields."
    }],
    proposed_effect: "SOURCE_INSPECTION",
    next_micro_step: "Compare candidate keys read-only across two generations.",
    ...overrides
  };
}

function response(eventValue = event(), footerStatus = "CONTINUE") {
  const next = footerStatus === "DONE"
    ? "NONE"
    : footerStatus === "USER_PAUSE"
      ? "Välj exakt fortsatt forskningsinriktning."
      : "Compare candidate keys read-only across two generations.";
  const completion = footerStatus === "DONE"
    ? "PROGRAM_DONE · Forskningsmandatet är avslutat."
    : footerStatus === "USER_PAUSE"
      ? "PROGRAM_BLOCKED · Ett materiellt operatörsbeslut krävs."
      : "MILESTONE_CONTINUE · Forskningsmikrosteget är registrerat.";
  const nextActor = footerStatus === "DONE"
    ? "NONE"
    : footerStatus === "USER_PAUSE"
      ? "OPERATOR_DECISION"
      : "AGENT";
  return [
    "Research narrative.",
    ARCHAEOLOGY_EVENT_MARKER,
    JSON.stringify(eventValue),
    "EIC_TURN: turn-1",
    `EIC_NEXT: ${next}`,
    `EIC_COMPLETION_EVIDENCE: ${completion}`,
    `EIC_NEXT_ACTOR: ${nextActor}`,
    `EIC_AUTONOMY: ${footerStatus}`
  ].join("\n");
}

test("v0.9.3 uses delivery-first mandates as the active defaults", () => {
  const config = createDefaultConfig();
  assert.equal(config.nanoMandate, CURRENT_NANO_MANDATE);
  assert.equal(config.targetMandate, CURRENT_TARGET_MANDATE);
  assert.equal(config.nanoMandateProfile, "STANDARD_DELIVERY");
  assert.equal(config.targetMandateProfile, "STANDARD_DELIVERY");
  assert.equal(config.scenarioPreset, "VERIFIED_ANALYSIS");
});

test("v0.8.0 adds ARCHAEOLOGY_LONG without removing existing run modes", () => {
  assert.equal(RUN_MODES.ARCHAEOLOGY_LONG, "ARCHAEOLOGY_LONG");
  for (const legacy of ["WAITING_CONTINUE", "NEW_SESSION", "APP_AUDIT_LONG"]) {
    assert.equal(RUN_MODES[legacy], legacy);
  }
});

test("ERP reverse engineering is one of several archaeology scenarios", () => {
  assert.ok(ARCHAEOLOGY_SCENARIOS.length >= 6);
  assert.ok(ARCHAEOLOGY_SCENARIOS.some((item) => item.id === "ERP_REVERSE_ENGINEERING"));
  assert.ok(ARCHAEOLOGY_SCENARIOS.some((item) => item.id === "PROTOCOL_REVERSE_ENGINEERING"));
  assert.ok(ARCHAEOLOGY_SCENARIOS.some((item) => item.id === "BEHAVIORAL_FORENSICS"));
});

test("core surfaces expose independent current dropdown profiles", () => {
  assert.ok(NANO_CORE_PROFILES.length >= 4);
  assert.ok(TARGET_CORE_PROFILES.length >= 4);
  assert.equal(SCENARIO_PRESETS[0].id, "VERIFIED_ANALYSIS");
  assert.match(html, /id="scenarioPreset"/);
  assert.match(html, /id="nanoMandateProfile"/);
  assert.match(html, /id="targetMandateProfile"/);
  assert.match(html, /id="continuityViewProfile"/);
  assert.equal((html.match(/data-primary-instruction=/g) || []).length, 3);
});

test("ARCHAEOLOGY_LONG start prompt is analysis-only and Workspace-discovery aware", () => {
  const prompt = buildArchaeologyStartPrompt({
    scenario: "ERP_REVERSE_ENGINEERING",
    question: "How are ERP order status transitions represented?",
    archaeologyRunId: "arch-run-1",
    archaeologyTurnId: "turn-1"
  });
  assert.match(prompt, /dedikerat forskningsläge/i);
  assert.match(prompt, /workspace\.help/);
  assert.match(prompt, /workspace\.capabilities\.resolve/);
  assert.match(prompt, /workspace\.op\.describe/);
  assert.match(prompt, /implementation.*förbjudet|Implementera.*förbjudet/is);
  assert.match(prompt, /USER_PAUSE.*nivå-10/is);
});

test("Nano receives Workspace-aware research rules only for ARCHAEOLOGY_LONG", () => {
  const config = createDefaultConfig();
  const shared = {
    request: {
      requestId: "nano-request-1",
      mode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS,
      repairAttempt: 0
    },
    observation: {
      responseText: "Observed one relation.",
      responseHash: "sha256:test",
      conversationExcerpt: "Research context.",
      targetResult: { valid: true, status: "CONTINUE", next: "Inspect relation read-only." }
    },
    config,
    continuityProjection: {
      intent: "Research relation semantics.",
      position: { workUnit: "Inspect one relation." },
      targetClaims: ["A relation may exist."],
      verifiedFacts: [],
      inferences: [],
      blockers: []
    }
  };

  const archaeology = buildNanoDecisionPromptDetailed({
    ...shared,
    run: {
      runId: "arch-run-1",
      mode: RUN_MODES.ARCHAEOLOGY_LONG,
      state: "ANALYZING",
      turnIndex: 1,
      checkpointIndex: 0,
      currentTurn: { turnId: "turn-1" }
    }
  }).prompt;
  assert.match(archaeology, /ARCHAEOLOGY_LONG — ARCHAEOLOGY_LONG is exclusively/);
  assert.match(archaeology, /workspace\.help/);
  assert.match(archaeology, /workspace\.capabilities\.resolve/);
  assert.match(archaeology, /workspace\.op\.describe/);
  assert.match(archaeology, /exclusively for analysis, reverse engineering and research/i);
  assert.match(archaeology, /Never propose implementation, patch, commit/i);

  const standard = buildNanoDecisionPromptDetailed({
    ...shared,
    run: {
      runId: "standard-run-1",
      mode: RUN_MODES.WAITING_CONTINUE,
      state: "ANALYZING",
      turnIndex: 1,
      checkpointIndex: 0,
      currentTurn: { turnId: "turn-1" }
    }
  }).prompt;
  assert.doesNotMatch(standard, /ARCHAEOLOGY_LONG — ARCHAEOLOGY_LONG is exclusively/);
  assert.doesNotMatch(standard, /exclusively for analysis, reverse engineering and research/i);
});

test("sidepanel binds core-profile dropdown listeners once outside renderTabs", () => {
  const source = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  const renderTabsStart = source.indexOf("function renderTabs");
  const renderAuditStart = source.indexOf("function renderAudit", renderTabsStart);
  assert.ok(renderTabsStart >= 0 && renderAuditStart > renderTabsStart);
  const renderTabsBody = source.slice(renderTabsStart, renderAuditStart);
  assert.doesNotMatch(renderTabsBody, /addEventListener/);
  for (const id of ["scenarioPreset", "nanoMandateProfile", "targetMandateProfile", "continuityViewProfile"]) {
    assert.match(source, new RegExp(`elements\\.${id}\\.addEventListener`));
  }
});

test("a bound archaeology event passes, advances state and remains target provenance", () => {
  const source = response();
  const parsed = parseArchaeologyEvent(source);
  assert.equal(parsed.valid, true);
  const placement = archaeologyEventPlacement(source);
  assert.equal(placement, "BEFORE_TRAILER");
  const state = createArchaeologyRunState("arch-run-1", {
    scenario: "ERP_REVERSE_ENGINEERING",
    question: "How are ERP order status transitions represented?"
  });
  const gate = evaluateArchaeologyEvent(parsed.event, {
    researchState: state,
    expectedRunId: "arch-run-1",
    expectedTurnId: "turn-1",
    expectedScenario: "ERP_REVERSE_ENGINEERING",
    placement,
    markerCount: parsed.block.markerCount
  });
  assert.equal(gate.valid, true);
  assert.ok(gate.progress.delta > 0);
  const next = applyArchaeologyEvent(state, parsed.event, { turnId: "turn-1", at: "2026-08-03T12:00:00Z" });
  assert.equal(next.lastStepNo, 1);
  assert.equal(next.hypotheses["H-001"].provenance, "target-session-claim");
  assert.equal(next.workspaceRecommendations[0].provenance, "target-session-claim");
});

test("archaeology event gate rejects mutation, unknown effects and invented Workspace probes", () => {
  const state = createArchaeologyRunState("arch-run-1", { scenario: "ERP_REVERSE_ENGINEERING" });
  const forbidden = parseArchaeologyEvent(response(event({ proposed_effect: "COMMIT" }))).event;
  const forbiddenGate = evaluateArchaeologyEvent(forbidden, {
    researchState: state,
    expectedRunId: "arch-run-1",
    expectedTurnId: "turn-1",
    expectedScenario: "ERP_REVERSE_ENGINEERING"
  });
  assert.equal(forbiddenGate.valid, false);
  assert.ok(forbiddenGate.errors.includes(ARCHAEOLOGY_GATES.FORBIDDEN_EFFECT));

  const unknown = parseArchaeologyEvent(response(event({ proposed_effect: "MAGIC_RESEARCH" }))).event;
  const unknownGate = evaluateArchaeologyEvent(unknown, {
    researchState: state,
    expectedRunId: "arch-run-1",
    expectedTurnId: "turn-1",
    expectedScenario: "ERP_REVERSE_ENGINEERING"
  });
  assert.ok(unknownGate.errors.includes(ARCHAEOLOGY_GATES.EFFECT_UNKNOWN));

  const badProbe = parseArchaeologyEvent(response(event({
    workspace_recommendations: [{
      capability_family: "database magic",
      probe: "workspace.magic",
      reason: "Guess a route."
    }]
  }))).event;
  const badProbeGate = evaluateArchaeologyEvent(badProbe, {
    researchState: state,
    expectedRunId: "arch-run-1",
    expectedTurnId: "turn-1",
    expectedScenario: "ERP_REVERSE_ENGINEERING"
  });
  assert.ok(badProbeGate.errors.includes(ARCHAEOLOGY_GATES.WORKSPACE_PROBE_INVALID));
});

test("ARCHAEOLOGY_LONG has a level-4 runtime effect ceiling and isolated replan guard", () => {
  assert.equal(ARCHAEOLOGY_EFFECT_CEILING.level, 4);
  assert.match(background, /function enforceArchaeologyDecisionCeiling/);
  assert.match(background, /run\?\.mode !== RUN_MODES\.ARCHAEOLOGY_LONG/);
  assert.match(background, /ARCHAEOLOGY_LONG blockerade icke-forskningseffekt/);
});

test("USER_PAUSE is valid only with decision and PROGRAM_BLOCKED evidence", () => {
  const valid = parseTargetResult([
    "EIC_TURN: turn-user-pause",
    "EIC_NEXT: Välj A eller B för exakt mål; A fortsätter, B stoppar.",
    "EIC_COMPLETION_EVIDENCE: PROGRAM_BLOCKED · Icke-delegerbart operatörsbeslut krävs.",
    "EIC_NEXT_ACTOR: OPERATOR_DECISION",
    "EIC_AUTONOMY: USER_PAUSE"
  ].join("\n"), "turn-user-pause");
  assert.equal(valid.valid, true);
  assert.equal(valid.status, "USER_PAUSE");
  assert.equal(protocolFastPathEligible(valid), true);

  const missing = parseTargetResult([
    "EIC_TURN: turn-user-pause",
    "EIC_NEXT: NONE",
    "EIC_COMPLETION_EVIDENCE: PROGRAM_BLOCKED · Icke-delegerbart operatörsbeslut krävs.",
    "EIC_NEXT_ACTOR: OPERATOR_DECISION",
    "EIC_AUTONOMY: USER_PAUSE"
  ].join("\n"), "turn-user-pause");
  assert.equal(missing.valid, false);
  assert.equal(missing.reason, "PROTOCOL_USER_PAUSE_REQUIRES_DECISION");

  const completed = parseTargetResult([
    "EIC_TURN: turn-user-pause",
    "EIC_NEXT: Välj A eller B.",
    "EIC_COMPLETION_EVIDENCE: något",
    "EIC_NEXT_ACTOR: OPERATOR_DECISION",
    "EIC_AUTONOMY: USER_PAUSE"
  ].join("\n"), "turn-user-pause");
  assert.equal(completed.valid, false);
  assert.equal(completed.reason, "PROTOCOL_COMPLETION_EVIDENCE_INVALID");
});

test("USER_PAUSE deterministically produces level 10 and local HUMAN_REQUIRED handling", () => {
  const targetResult = {
    valid: true,
    status: "USER_PAUSE",
    next: "Välj om den exakta irreversibla åtgärden ska auktoriseras.",
    completionEvidence: "",
    turnId: "turn-user-pause"
  };
  const decision = buildDeterministicDecision({
    run: { targetTabId: 77, conversationKey: "chatgpt.com:c:test", maxAutonomousMode: true },
    observation: { targetResult },
    continuityProjection: { intent: "Research", position: { workUnit: "Decision boundary" }, blockers: [] },
    maxAutonomousMode: true,
    requestMode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS
  });
  assert.equal(decision.action, "PAUSE");
  assert.equal(decision.pauseOrigin, PAUSE_ORIGINS.USER_PAUSE);
  assert.equal(decision.destructivenessLevel, 10);
  assert.equal(decision.hjalmarMentalControl, "HUMAN_REQUIRED");
  assert.equal(classifyDestructiveness({ pauseOrigin: PAUSE_ORIGINS.USER_PAUSE }).level, 10);
  assert.match(background, /strictUserPause \? STATES\.AWAITING_OPERATOR_DECISION : STATES\.PROGRAM_BLOCKED/);
});
