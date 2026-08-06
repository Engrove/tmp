import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EIGHTY_TWENTY_VERDICT,
  MAIN_TASK_BASELINE_REQUEST_PROMPT,
  MAIN_TASK_RELATION,
  MAIN_TASK_TRACK_STATUS,
  normalizeMainTaskBaseline,
  parseMainTaskBaseline,
  validateMainTaskBaseline,
  validateTrackControl
} from "../lib/main-task-guard.mjs";
import {
  createContinuity,
  normalizeContinuity,
  projectContinuity
} from "../lib/continuity.mjs";
import { buildNanoDecisionPromptDetailed } from "../lib/nano-pipeline.mjs";
import {
  fullAuditSinkStatus,
  isFullAuditSegmentName,
  validateFullAuditDirectoryName
} from "../lib/full-audit-log.mjs";

const baselineFixture = {
  schema: "eic.main-task-baseline.v1",
  mainTask: {
    title: "Leverera v0.10.10",
    objective: "Korrigera full audit och ge Nano spårhållningsansvar.",
    programGoal: "En source/package-kandidat som håller EIC på huvudspåret."
  },
  success: {
    criteria: ["Audit write/readback PASS", "Nano track block/emit PASS"],
    doneWhen: "Källpaket och verifiering är levererade."
  },
  current: {
    activeMilestone: "v0.10.10",
    boundedWorkUnit: "Audit + main-task guard",
    lastMaterialDelta: "v0.10.7 granskad",
    nextHighLeverageAction: "Implementera och testa de två avgränsade fixarna."
  },
  scope: {
    inScope: ["Full audit", "Nano track guard"],
    outOfScope: ["Deployment"],
    constraints: ["Owner-route claim boundary"]
  },
  owners: [
    { claim: "source", surface: "supplied source ZIP", locator: "sha256:test" }
  ],
  blockers: [],
  eightyTwenty: {
    vitalFew: ["Fix audit write path", "Bind Nano to main task"],
    deferredMany: ["Unrelated refactors"],
    rationale: "De två felen står för den materiella nyttan."
  },
  globalSkills: {
    active: [{ code: "strong_claim_evidence_kernel", payloadHash: "sha256:test", reason: "claim control" }],
    required: [{ code: "code_review_guard", payloadHash: "", reason: "review" }],
    gaps: []
  },
  detourPolicy: {
    allowedReasons: ["BLOCKER_REMOVAL"],
    returnCondition: "Återgå till package-verifiering när blockeraren är borttagen.",
    maxDetourTurns: 2
  },
  evidence: {
    locators: ["project-update:6548"],
    asOf: "2026-08-06T14:34:00Z"
  }
};

test("v0.10.10 baseline request is predetermined and includes 80/20 plus global skills", () => {
  assert.match(MAIN_TASK_BASELINE_REQUEST_PROMPT, /eic\.main-task-baseline\.v1/);
  assert.match(MAIN_TASK_BASELINE_REQUEST_PROMPT, /eightyTwenty/);
  assert.match(MAIN_TASK_BASELINE_REQUEST_PROMPT, /vitalFew/);
  assert.match(MAIN_TASK_BASELINE_REQUEST_PROMPT, /deferredMany/);
  assert.match(MAIN_TASK_BASELINE_REQUEST_PROMPT, /globalSkills/);
  assert.match(MAIN_TASK_BASELINE_REQUEST_PROMPT, /active/);
  assert.match(MAIN_TASK_BASELINE_REQUEST_PROMPT, /required/);
  assert.match(MAIN_TASK_BASELINE_REQUEST_PROMPT, /gaps/);
  assert.match(MAIN_TASK_BASELINE_REQUEST_PROMPT, /returnCondition/);
});

test("v0.10.10 valid baseline emit twin parses from a target response", () => {
  const response = `Förklarande text\n${JSON.stringify(baselineFixture)}\nEIC_TURN: turn-1`;
  const parsed = parseMainTaskBaseline(response);
  assert.equal(parsed.valid, true, parsed.errors.join(", "));
  assert.equal(parsed.baseline.mainTask.programGoal, baselineFixture.mainTask.programGoal);
  assert.equal(parsed.baseline.evidenceClass, "ROUTING_CONTEXT");
});

test("v0.10.10 incomplete baseline block twin fails closed", () => {
  const incomplete = { schema: "eic.main-task-baseline.v1", mainTask: { objective: "x" } };
  const validation = validateMainTaskBaseline(incomplete);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("BASELINE_PROGRAM_GOAL_REQUIRED"));
  assert.equal(normalizeMainTaskBaseline(incomplete), null);
});

test("v0.10.10 justified detour requires reason, return condition and 80/20 enabler", () => {
  const valid = validateTrackControl({
    status: MAIN_TASK_TRACK_STATUS.JUSTIFIED_DETOUR,
    baselinePresent: true,
    currentActionRelation: MAIN_TASK_RELATION.REQUIRED_DETOUR,
    eightyTwentyVerdict: EIGHTY_TWENTY_VERDICT.NECESSARY_ENABLER,
    activeGlobalSkills: [],
    requiredGlobalSkills: [],
    skillGaps: [],
    detourReason: "Owner locator måste lösas innan huvudleveransen kan fortsätta.",
    returnCondition: "Återgå när exakt locator är owner-read.",
    correctionPrompt: ""
  }, { baselinePresent: true });
  assert.equal(valid.valid, true, valid.errors.join(", "));

  const invalid = validateTrackControl({
    ...valid.track,
    returnCondition: ""
  }, { baselinePresent: true });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes("TRACK_DETOUR_RETURN_CONDITION_REQUIRED"));
});

test("v0.10.10 drift requires a concrete correction back to main track", () => {
  const invalid = validateTrackControl({
    status: MAIN_TASK_TRACK_STATUS.DRIFT,
    baselinePresent: true,
    currentActionRelation: MAIN_TASK_RELATION.UNRELATED,
    eightyTwentyVerdict: EIGHTY_TWENTY_VERDICT.LOW_LEVERAGE,
    activeGlobalSkills: [],
    requiredGlobalSkills: [],
    skillGaps: [],
    detourReason: "",
    returnCondition: "",
    correctionPrompt: ""
  }, { baselinePresent: true });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes("TRACK_DRIFT_CORRECTION_REQUIRED"));
});

test("v0.10.10 continuity carries baseline and latest track classification", () => {
  const continuity = normalizeContinuity({
    ...createContinuity(),
    mainTaskBaseline: baselineFixture,
    trackControl: {
      status: "ON_TRACK",
      baselinePresent: true,
      currentActionRelation: "DIRECT",
      eightyTwentyVerdict: "HIGH_LEVERAGE",
      activeGlobalSkills: [],
      requiredGlobalSkills: [],
      skillGaps: [],
      detourReason: "",
      returnCondition: "",
      correctionPrompt: ""
    }
  });
  const projection = projectContinuity(continuity);
  assert.equal(projection.mainTaskBaseline.mainTask.title, "Leverera v0.10.10");
  assert.equal(projection.trackControl.status, "ON_TRACK");
});

test("v0.10.10 first Nano prompt requests the structured baseline", () => {
  const built = buildNanoDecisionPromptDetailed({
    run: {
      runId: "run-1",
      mode: "WAITING_CONTINUE",
      state: "ASSESSING",
      activeTaskBinding: { mandateVersion: "target-core-v6", mandateSha256: "a".repeat(64) }
    },
    request: { requestId: "request-1", mode: "TAKEOVER_BOOTSTRAP" },
    observation: {
      responseText: "Baseline is missing.",
      conversationExcerpt: "Active task exists.",
      targetResult: { valid: false, reason: "MAIN_TASK_BASELINE_REQUIRED" }
    },
    config: { targetMandateVersion: "target-core-v6" },
    continuityProjection: projectContinuity(createContinuity()),
    maxPromptChars: 12000
  });
  assert.match(built.prompt, /NANO DECISION REQUEST v12/);
  assert.match(built.prompt, /baselineRequestPrompt/);
  assert.match(built.prompt, /BASELINE_REQUESTED/);
  assert.match(built.prompt, /80\/20/);
  assert.match(built.prompt, /global skills/);
});

test("v0.10.10 audit accepts an operator-selected safe basename without claiming an absolute path", () => {
  assert.equal(validateFullAuditDirectoryName("temp"), true);
  assert.equal(validateFullAuditDirectoryName("EIC audit"), true);
  assert.equal(validateFullAuditDirectoryName(""), false);
  assert.equal(validateFullAuditDirectoryName("../temp"), false);
  const sink = fullAuditSinkStatus({ writeProbeVerified: true });
  assert.equal(sink.writeProbeVerified, true);
  assert.match(sink.claimBoundary, /does not expose or prove its absolute Windows path/);
});

test("v0.10.10 retention matcher is version-neutral", () => {
  assert.equal(isFullAuditSegmentName("eic-autonom-agent-v0.10.6-session-0001-2026.ndjson"), true);
  assert.equal(isFullAuditSegmentName("eic-autonom-agent-v0.10.7-session-0001-2026.ndjson"), true);
  assert.equal(isFullAuditSegmentName("eic-autonom-agent-v0.10.10-session-0001-2026.ndjson"), true);
  assert.equal(isFullAuditSegmentName("unrelated.ndjson"), false);
});

test("v0.10.10 sidepanel verifies write/readback and removes the probe", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(source, /verifyFullAuditDirectoryWrite/);
  assert.match(source, /FULL_AUDIT_WRITE_READBACK_MISMATCH/);
  assert.match(source, /await file\.text\(\)/);
  assert.match(source, /await handle\.removeEntry\(probeName\)/);
  assert.doesNotMatch(source, /FULL_AUDIT_DIRECTORY_MUST_BE_EXISTING_TEMP_FOLDER/);
  assert.match(source, /eicAutonomAgent\.fullAuditSink\.v1/);
  assert.match(source, /LEGACY_FULL_AUDIT_SINK_STATE_KEYS/);
  assert.match(source, /isFullAuditSegmentName\(name\)/);
});

test("v0.10.10 background arms baseline intake and blocks protocol fast path until baseline exists", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(source, /armMainTaskBaselineRequest/);
  assert.match(source, /MAIN_TASK_BASELINE_REQUIRED/);
  assert.match(source, /mainTaskBaselinePresent/);
  assert.match(source, /Boolean\(continuityValue\?\.mainTaskBaseline\)/);
  assert.match(source, /parseMainTaskBaseline\(page\.latestAssistant/);
});
