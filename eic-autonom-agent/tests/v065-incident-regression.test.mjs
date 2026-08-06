import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildNanoDecisionPromptDetailed,
  compactContextText
} from "../lib/nano-pipeline.mjs";
import {
  detectLoopCorrection,
  normalizeContinuity,
  projectContinuity
} from "../lib/continuity.mjs";
import { allocateNanoSectionBudget } from "../lib/nano-input-budget.mjs";
import { parseTargetResult } from "../lib/prompt-contract.mjs";
import { classifyDestructiveness } from "../lib/destructiveness.mjs";
import {
  acquireNanoDispatchLock,
  releaseNanoDispatchLock,
  resolveLifecycleDeadlineExtension
} from "../lib/runtime-safety.mjs";

const incidentAction =
  "Kör WP25.2.4 U1F-R5d: Upprepa omedelbar effect-preflight, fastställ merge-sätt " +
  "och ge exakt snapshotbunden mergeauktorisation; utför merge endast vid " +
  "ALLOW_MERGE_EXACT_SNAPSHOT och stoppa före release, migration och deployment.";

function incidentProjection() {
  return projectContinuity(normalizeContinuity({
    intent: { text: "Slutför WP25.2.4", setBy: "operator" },
    position: { workUnit: "WP25.2.4 U1F-R5d", turnIndex: 19 },
    blockers: [{ id: "b1", statement: "stale blocker", open: true, turn: 19, lastAssertedTurn: 19 }],
    targetClaims: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, claim: `claim ${i} ${incidentAction}`, turn: 19 })),
    inferences: Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, claim: `infer ${i} ${incidentAction}`, turn: 19 })),
    attempts: Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, action: `attempt ${i} ${incidentAction}`, turn: 19 })),
    antiLoop: {
      stagnationCycles: 19,
      actionKeys: Array.from({ length: 8 }, (_, i) => `key${i}:${incidentAction}`),
      progressDeltas: Array(8).fill(0)
    }
  }));
}

test("D-19: explicit zero context budget emits zero characters", () => {
  assert.equal(compactContextText("X".repeat(5000), 0).text.length, 0);
  assert.equal(compactContextText("X".repeat(5000), 1).text.length, 1);
});

test("D-19/D-21: section allocation never exceeds its variable budget", () => {
  for (const budget of [0, 1, 32, 512, 2400]) {
    const allocation = allocateNanoSectionBudget(budget, { fixedChars: 0 });
    const sum = allocation.projectionChars + allocation.responseChars +
      allocation.mandateChars + allocation.conversationChars;
    assert.ok(sum <= allocation.variableChars, `${budget}: ${sum} > ${allocation.variableChars}`);
  }
});

test("D-20/D-21: incident-sized Nano input converges under 2400 characters", () => {
  const built = buildNanoDecisionPromptDetailed({
    run: { runId: "r", state: "ASSESSING", turnIndex: 19, currentTurn: { turnId: "t" }, pendingNanoRequest: {} },
    request: { requestId: "q", mode: "CONTINUATION_ANALYSIS" },
    observation: {
      responseText: "R".repeat(5000),
      conversationExcerpt: "C".repeat(5000),
      targetResult: { valid: true, status: "DONE", completionEvidence: "E".repeat(1600) }
    },
    config: { targetMandate: "M".repeat(5359) },
    continuityProjection: incidentProjection(),
    maxPromptChars: 2400
  });
  assert.equal(built.budget.withinBudget, true);
  assert.ok(built.prompt.length <= 2400, `${built.prompt.length} > 2400`);
  assert.ok(built.budget.sections.contextRouter.chars < 1800);
});

test("D-01/D-27: coherent DONE trailer survives bounded trailing DOM text", () => {
  const base = [
    "Arbetet är klart.",
    "EIC_TURN: turn-42",
    "EIC_NEXT: NONE",
    "EIC_COMPLETION_EVIDENCE: PROGRAM_DONE · commit abc + owner-readback",
    "EIC_NEXT_ACTOR: NONE",
    "EIC_AUTONOMY: DONE"
  ].join("\n");
  for (let trailing = 0; trailing <= 5; trailing += 1) {
    const text = `${base}${trailing ? `\n${Array.from({ length: trailing }, (_, i) => `UI ${i}`).join("\n")}` : ""}`;
    const parsed = parseTargetResult(text, "turn-42");
    assert.equal(parsed.valid, true);
    assert.equal(parsed.status, "DONE");
  }
});

test("D-01: duplicate trailer marker is still rejected", () => {
  const parsed = parseTargetResult([
    "EIC_TURN: turn-42",
    "EIC_NEXT: NONE",
    "EIC_COMPLETION_EVIDENCE: PROGRAM_DONE · artifact 42",
    "EIC_NEXT_ACTOR: NONE",
    "EIC_AUTONOMY: DONE",
    "EIC_NEXT_ACTOR: AGENT",
    "EIC_AUTONOMY: CONTINUE"
  ].join("\n"), "turn-42");
  assert.equal(parsed.valid, false);
  assert.equal(parsed.reason, "PROTOCOL_AMBIGUOUS");
});

test("D-31: Swedish merge authorization is critical reversible and Hjalmar-controlled", () => {
  const result = classifyDestructiveness({ requestedAction: incidentAction });
  assert.equal(result.level, 9);
  assert.equal(result.hjalmarMentalControlRequired, true);
  assert.equal(result.humanDecisionRequired, false);
});

test("D-31: unknown non-empty action fails closed instead of READ_ONLY", () => {
  const result = classifyDestructiveness({ requestedAction: "Zorbla frobnicator alpha." });
  assert.equal(result.level, 6);
  assert.equal(result.name, "UNCLASSIFIED");
  assert.equal(result.hjalmarMentalControlRequired, true);
});

test("D-24: Nano dispatch lock is atomic and token-owned", () => {
  const state = {
    modelBusy: false,
    activeNanoRequestId: null,
    activeNanoInvocationToken: null
  };
  assert.equal(acquireNanoDispatchLock(state, "request-1", "token-a"), true);
  assert.equal(acquireNanoDispatchLock(state, "request-1", "token-b"), false);
  assert.equal(releaseNanoDispatchLock(state, "token-b"), false);
  assert.equal(state.modelBusy, true);
  assert.equal(state.activeNanoRequestId, "request-1");
  assert.equal(releaseNanoDispatchLock(state, "token-a"), true);
  assert.equal(state.modelBusy, false);
  assert.equal(state.activeNanoRequestId, null);
});

test("D-07: lifecycle deadline extension has a cumulative cap", () => {
  const first = resolveLifecycleDeadlineExtension({
    gapMs: 900_000,
    responseTimeoutMs: 7_200_000,
    alreadyExtendedMs: 0
  });
  assert.equal(first.appliedMs, 300_000);
  assert.equal(first.capped, true);
  const second = resolveLifecycleDeadlineExtension({
    gapMs: 900_000,
    responseTimeoutMs: 7_200_000,
    alreadyExtendedMs: first.totalExtensionMs
  });
  assert.equal(second.appliedMs, 0);
  assert.equal(second.totalExtensionMs, 300_000);
});

test("D-29 superseded by v0.6.9: eight stagnant cycles require autonomous checkpoint", () => {
  const continuity = normalizeContinuity({
    antiLoop: {
      stagnationCycles: 8,
      actionKeys: ["same", "same"],
      progressDeltas: [0, 0]
    }
  });
  const correction = detectLoopCorrection(continuity);
  assert.equal(correction.triggered, true);
  assert.equal(correction.code, "NO_PROGRESS_CHECKPOINT");
});

test("D-22/D-24/D-26/D-27: integration guards are wired in browser entrypoints", () => {
  const sidepanel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");

  const lockIndex = sidepanel.indexOf("acquireNanoDispatchLock(state, request.requestId");
  const firstMeasureAfterProcess = sidepanel.indexOf("await measureNanoInputTokens", sidepanel.indexOf("async function processPendingNano"));
  assert.ok(lockIndex >= 0 && lockIndex < firstMeasureAfterProcess);
  assert.match(sidepanel, /NanoBudgetExceededError/);
  assert.match(sidepanel, /command\("ADD_AUDIT"/);
  assert.match(background, /UI_COMMANDS\.ADD_AUDIT/);
  assert.doesNotMatch(content, /const status = lines\.find\(\(line\) => \/\^Status:/);
});
