import test from "node:test";
import assert from "node:assert/strict";
import { buildDeterministicDecision } from "../lib/fallback-planner.mjs";
import { NANO_ANALYSIS_MODES } from "../lib/nano-pipeline.mjs";
import { PAUSE_ORIGINS } from "../lib/state-machine.mjs";

test("ogrundad takeover kan inte bli CONTINUE i Max Mode", () => {
  const decision = buildDeterministicDecision({
    run: { maxAutonomousMode: true },
    observation: { targetResult: { valid: false, reason: "PROTOCOL_MISSING" } },
    continuityProjection: { intent: "", position: { workUnit: "" }, targetClaims: [], inferences: [], verifiedFacts: [] },
    maxAutonomousMode: true,
    requestMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP
  });
  assert.equal(decision.action, "PAUSE");
  assert.equal(decision.pauseOrigin, PAUSE_ORIGINS.NANO_HOST_REQUIRED);
  assert.equal(decision.requestedAction, "");
});

test("även grundad continuity får ingen generisk semantic fallback utan turn-markör", () => {
  const decision = buildDeterministicDecision({
    run: { maxAutonomousMode: true },
    observation: { targetResult: { valid: false, reason: "PROTOCOL_MISSING" } },
    continuityProjection: {
      intent: "Slutför WP25",
      position: { workUnit: "Reparera graph summary" },
      targetClaims: [{ claim: "Budgeten överskrids" }],
      inferences: [],
      verifiedFacts: []
    },
    maxAutonomousMode: true,
    requestMode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS
  });
  assert.equal(decision.action, "PAUSE");
  assert.equal(decision.requestedAction, "");
  assert.match(decision.reason, /utan ett unikt turn-bundet EIC_NEXT eller DONE/i);
});

test("unikt turn-bundet EIC_NEXT kan deterministiskt fortsätta under nivå 10", () => {
  const decision = buildDeterministicDecision({
    run: { maxAutonomousMode: true },
    observation: {
      targetResult: {
        valid: true,
        status: "CONTINUE",
        next: "Patcha lib/graph.mjs och returnera fokustestets exit status."
      }
    },
    continuityProjection: {
      intent: "Slutför WP25",
      position: { workUnit: "Graph repair" },
      targetClaims: [],
      inferences: [],
      verifiedFacts: []
    },
    maxAutonomousMode: true,
    requestMode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS
  });
  assert.equal(decision.action, "CONTINUE");
  assert.match(decision.requestedAction, /Patcha lib\/graph\.mjs/);
  assert.ok(decision.destructivenessLevel < 10);
  assert.equal(decision.pauseOrigin, PAUSE_ORIGINS.NONE);
  assert.match(decision.reason, /v0\.6\.4-policy/i);
});
