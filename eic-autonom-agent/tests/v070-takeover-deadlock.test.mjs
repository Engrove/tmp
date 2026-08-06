import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  authorsTargetPrompt,
  validateDecisionGrounding
} from "../lib/decision-grounding.mjs";
import {
  NANO_ANALYSIS_MODES,
  deriveObservationAnchors,
  groundDecisionFromObservation,
  validateNanoDecisionGrounding
} from "../lib/nano-pipeline.mjs";
import {
  buildDeterministicDecision,
  repairDeterministicDecision
} from "../lib/fallback-planner.mjs";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const sidepanel = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");

/**
 * Field incident 2026-08-02, Chrome window 1974094030, run
 * run-876655fe-8177-412d-885b-70e288bc1d0d. Reconstructed from the operator export
 * `eic-autonom-agent-v0_6_9-export-1785695504899.json`.
 */
const UNGROUNDED_PROJECTION = Object.freeze({
  intent: "",
  position: { phase: "initial", workUnit: "", workUnitId: "", workUnitSource: "", turnIndex: 0 },
  verifiedFacts: [],
  constraints: [],
  targetClaims: [],
  inferences: [],
  blockers: [],
  nextDirections: []
});

const FIELD_OBSERVATION = Object.freeze({
  observationId: "observation-03a89ad9-5699-4cd1-9628-09481fe4d16b",
  responseText: [
    "Nano-specifika variabler är aktiverade och owner-verifierade för aktuell session:",
    "Skill: nano_marker_skeptical_autonomy_guard",
    "Version: v1",
    "Skill-version: 424"
  ].join("\n"),
  conversationExcerpt: "ASSISTANT: Hjalmar CONTROL/STRICT_AUDIT kördes mot den package-bundna kandidaten.",
  responseHash: "c66d3b5d2a0392b3553b7102fc78ea20c14b6145215e5541035f7f93d4bd8298",
  targetResult: {
    valid: false,
    reason: "PROTOCOL_MISSING",
    status: "",
    next: "",
    completionEvidence: "",
    turnId: ""
  }
});

const FIELD_RUN = Object.freeze({
  runId: "run-876655fe-8177-412d-885b-70e288bc1d0d",
  targetTabId: 1974094088,
  conversationKey: "chatgpt.com:c:6a6f5a5f-0368-83ed-9f78-b2d6aaadbf96",
  maxAutonomousMode: true,
  pendingNanoRequest: {
    mode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
    recoveryReason: "Nano fail-closed är recoverable; autonom DETERMINISTIC_RECOVERY tar över utan verklig PAUS. UnknownError: An unknown error occurred: kErrorUnknown"
  }
});

function takeoverRecoveryDecision() {
  return buildDeterministicDecision({
    run: FIELD_RUN,
    observation: FIELD_OBSERVATION,
    continuityProjection: UNGROUNDED_PROJECTION,
    maxAutonomousMode: true,
    requestMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP
  });
}

// ---------------------------------------------------------------------------
// D1 — the terminal livelock
// ---------------------------------------------------------------------------

test("v0.7.0 deterministic takeover recovery passes the gate that consumes it", () => {
  const decision = takeoverRecoveryDecision();
  const grounding = validateNanoDecisionGrounding(decision, {
    analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
    continuityProjection: UNGROUNDED_PROJECTION,
    observation: FIELD_OBSERVATION
  });
  assert.equal(decision.action, "PAUSE");
  assert.equal(
    grounding.valid,
    true,
    `v0.6.9 field errors reproduced: ${grounding.errors.join(", ")}`
  );
  assert.deepEqual(grounding.errors, []);
});

test("v0.7.0 takeover recovery still authors no target prompt", () => {
  const decision = takeoverRecoveryDecision();
  // The whole point of the v0.6.9 PAUSE was that no generic prompt may be sent. That
  // property must survive the fix: only CONTINUE can ever reach prompt compilation.
  assert.equal(decision.requestedAction, "");
  assert.equal(authorsTargetPrompt(decision.action), false);
  assert.equal(decision.pauseOrigin, "NANO_HOST_REQUIRED");
});

test("v0.7.0 grounding requirements still apply in full to every prompt-authoring action", () => {
  const continueDecision = {
    action: "CONTINUE",
    analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
    intent: "",
    workUnit: "",
    requestedAction: "",
    targetClaims: [],
    inferences: [],
    contextEvidence: []
  };
  const grounding = validateDecisionGrounding(continueDecision, UNGROUNDED_PROJECTION, { takeover: true });
  assert.equal(grounding.valid, false);
  for (const code of ["TASK_INTENT_EMPTY", "WORK_UNIT_EMPTY", "REQUESTED_ACTION_EMPTY", "TAKEOVER_CONTEXT_EMPTY"]) {
    assert.ok(grounding.errors.includes(code), `saknar ${code}`);
  }
});

test("v0.7.0 a meta-only CONTINUE is still rejected after local context grounding", () => {
  const decision = {
    action: "CONTINUE",
    analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
    intent: "Fortsätt uppdraget.",
    workUnit: "Granska paketet.",
    requestedAction: "Verifiera och granska hela paketet",
    contextEvidence: []
  };
  const grounded = groundDecisionFromObservation(decision, {
    observation: FIELD_OBSERVATION,
    analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP
  });
  const grounding = validateNanoDecisionGrounding(grounded.decision, {
    analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
    continuityProjection: UNGROUNDED_PROJECTION,
    observation: FIELD_OBSERVATION
  });
  assert.equal(grounding.valid, false);
  assert.ok(grounding.errors.includes("META_ONLY_ACTION"));
});

test("v0.7.0 PAUSE and DONE carry their own obligations instead of prompt obligations", () => {
  const emptyPause = validateDecisionGrounding({ action: "PAUSE" }, UNGROUNDED_PROJECTION, { takeover: true });
  assert.equal(emptyPause.valid, false);
  assert.ok(emptyPause.errors.includes("PAUSE_REASON_EMPTY"));
  assert.ok(emptyPause.errors.includes("PAUSE_ORIGIN_EMPTY"));
  assert.ok(!emptyPause.errors.includes("TAKEOVER_CONTEXT_EMPTY"));

  const emptyDone = validateDecisionGrounding({ action: "DONE" }, UNGROUNDED_PROJECTION, { takeover: true });
  assert.equal(emptyDone.valid, false);
  assert.ok(emptyDone.errors.includes("COMPLETION_EVIDENCE_EMPTY"));
});

test("v0.7.0 the deterministic repair path is no longer reached by a well-formed PAUSE", () => {
  const decision = takeoverRecoveryDecision();
  const grounding = validateNanoDecisionGrounding(decision, {
    analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
    continuityProjection: UNGROUNDED_PROJECTION,
    observation: FIELD_OBSERVATION
  });
  assert.equal(grounding.valid, true);
  // v0.6.9 fell through to this and got NOT_REPAIRABLE_CONTINUE, which is what made
  // the failure terminal. It is retained for genuine CONTINUE repairs only.
  const repair = repairDeterministicDecision(decision, {
    run: FIELD_RUN,
    observation: FIELD_OBSERVATION,
    continuityProjection: UNGROUNDED_PROJECTION,
    validationErrors: grounding.errors
  });
  assert.equal(repair.repaired, false);
  assert.equal(repair.reason, "NOT_REPAIRABLE_CONTINUE");
});

// ---------------------------------------------------------------------------
// D2 — schema/gate contract alignment and local grounding
// ---------------------------------------------------------------------------

test("v0.9.3 derives compact structured anchors without copying target prose", () => {
  const anchors = deriveObservationAnchors(FIELD_OBSERVATION, { max: 6 });
  assert.ok(anchors.length >= 2);
  assert.ok(anchors.some((item) => item.startsWith("RESPONSE_HASH: ")));
  assert.ok(anchors.some((item) => item.startsWith("TARGET_REASON: ")));
  assert.equal(new Set(anchors).size, anchors.length);
  assert.doesNotMatch(anchors.join("\n"), /Nano-specifika variabler|Hjalmar CONTROL/);
});

test("v0.7.0 local grounding never invents context for an empty observation", () => {
  const result = groundDecisionFromObservation(
    { action: "CONTINUE", contextEvidence: [] },
    { observation: { responseText: "", conversationExcerpt: "" }, analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP }
  );
  assert.equal(result.applied, false);
  assert.equal(result.reason, "OBSERVATION_HAS_NO_ANCHORS");
});

test("v0.7.0 local grounding never overwrites context the model already produced", () => {
  const result = groundDecisionFromObservation(
    { action: "CONTINUE", contextEvidence: ["Modellens eget ankare"] },
    { observation: FIELD_OBSERVATION, analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP }
  );
  assert.equal(result.applied, false);
  assert.equal(result.reason, "CONTEXT_ALREADY_PRESENT");
  assert.deepEqual(result.decision.contextEvidence, ["Modellens eget ankare"]);
});

test("v0.7.0 local grounding never promotes target text to verified facts", () => {
  const result = groundDecisionFromObservation(
    { action: "CONTINUE", contextEvidence: [] },
    { observation: FIELD_OBSERVATION, analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP }
  );
  assert.equal(result.applied, true);
  assert.equal(result.decision.verifiedFacts, undefined);
  for (const claim of result.decision.targetClaims) {
    assert.match(claim, /^Målsessionen visade: /);
  }
});

test("v0.7.0 the response constraint no longer accepts what the gate rejects", () => {
  const schema = sidepanel.slice(
    sidepanel.indexOf("const DECISION_SCHEMA"),
    sidepanel.indexOf("const START_ANALYSIS_SCHEMA")
  );
  assert.match(schema, /contextEvidence: \{ type: "array", items: \{ type: "string", maxLength: 400 \}, minItems: 1/);
  assert.match(schema, /intent: \{ type: "string", minLength: 1/);
  assert.match(schema, /workUnit: \{ type: "string", minLength: 1/);
  // Every free-form string must be bounded so constrained decoding cannot run away.
  const unbounded = schema.match(/\{ type: "string" \}/g) || [];
  assert.deepEqual(unbounded, [], "obundna strängfält kvar i DECISION_SCHEMA");
});

// ---------------------------------------------------------------------------
// D3–D6 — Nano host bounding and session isolation
// ---------------------------------------------------------------------------

// Ceiling value superseded by v0.7.1: 6 000 aborted legitimate 6 003-character decisions
// in the field. The invariant that survives is that a ceiling exists and is enforced.
test("v0.7.0 bounds Nano output in the panel instead of trusting the host", () => {
  assert.match(sidepanel, /const NANO_MAX_OUTPUT_CHARS = 12_000;/);
  assert.match(sidepanel, /const NANO_MAX_OUTPUT_CHUNKS = 4_000;/);
  assert.match(sidepanel, /class NanoOutputOverrunError extends Error/);
  assert.match(sidepanel, /if \(!salvaged\) throw new NanoOutputOverrunError\(overrun\);/);
});

test("v0.7.0 isolates every analysis even on hosts without clone()", () => {
  assert.match(sidepanel, /isolation: "FRESH_SESSION"/);
  assert.match(sidepanel, /isolation: "SHARED_BASE"/);
  assert.match(sidepanel, /state\.modelCreateOptions = providerCreateOptions\(\{ systemPrompt \}\);/);
});

test("v0.7.0 bounds the shared base session when the host exposes no context usage", () => {
  assert.match(sidepanel, /const NANO_SHARED_SESSION_CHAR_BUDGET = 14_000;/);
  assert.match(sidepanel, /state\.sharedSessionChars = Number\(state\.sharedSessionChars \|\| 0\) \+ prompt\.length \+ output\.length;/);
});

test("v0.7.0 treats kErrorUnknown as recoverable rather than terminal", () => {
  const classifier = sidepanel.slice(
    sidepanel.indexOf("function recoverableTaskSessionError"),
    sidepanel.indexOf("function mergeStreamingChunk")
  );
  assert.match(classifier, /"UnknownError"/);
  assert.match(classifier, /"NanoOutputOverrunError"/);
});

test("v0.7.0 rebuilds a stale Nano session without an operator gesture", () => {
  assert.match(sidepanel, /async function ensureNanoSessionForRequest\(run\)/);
  assert.match(sidepanel, /run\?\.nanoHostResetRequired/);
});

// ---------------------------------------------------------------------------
// D7 — the repair round must not regress
// ---------------------------------------------------------------------------

test("v0.7.0 carries prior valid decision fields into the single repair round", () => {
  assert.match(background, /priorDecisionFields: \{/);
  assert.match(sidepanel, /request\.priorDecisionFields/);
  assert.match(sidepanel, /decision\.workUnit = sanitizeText\(decision\.workUnit \|\| prior\.workUnit, 2400\);/);
});

// ---------------------------------------------------------------------------
// Terminal-state escape
// ---------------------------------------------------------------------------

test("v0.7.0 requeues a failed takeover against a fresh session before any reconciliation", () => {
  assert.match(background, /const TAKEOVER_MAX_RECOVERY_ATTEMPTS = 3;/);
  assert.match(background, /Takeover återköad mot färsk Nano-session/);
  assert.match(background, /run\.nanoHostResetRequired = true;/);
  assert.match(background, /TAKEOVER_NANO_HOST_RESET/);
});

test("v0.7.0 clears the takeover budget once a takeover is genuinely grounded", () => {
  assert.match(background, /run\.takeoverRecoveryAttempts = 0;/);
});

test("v0.7.0 keeps the hard prompt-authoring guard", () => {
  assert.match(background, /if \(effectiveAction !== "CONTINUE"\) \{/);
  assert.match(background, /const nanoGroundingRequired = requestedPauseOrigin === PAUSE_ORIGINS\.NANO_HOST_REQUIRED/);
});
