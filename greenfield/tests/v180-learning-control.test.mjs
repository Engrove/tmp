import test from "node:test";
import assert from "node:assert/strict";

import {
  EIC_LEARNING_CONTROL_CONTRACT,
  LEARNING_KEYPOINTS,
  OBLIGATION,
  buildLearningControlContext,
  missionLearningScope,
  normalizeLearningControlResult,
  reportedLearningObligations
} from "../lib/learning-control.mjs";
import { composeA2APrompt, validateA2AEnvelope } from "../lib/a2a.mjs";
import { parseTargetResponse } from "../lib/response-contract.mjs";
import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow } from "../lib/process-store.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { ANALYSIS_SCHEMA } from "../lib/contracts.mjs";

const GOAL = "Projekt: 59 - EIC Backend / ELLM Backend - Gf: GF-002.\nFullfölj arbetet.";

function processFixture(patch = {}) {
  return {
    processId: "process-1",
    runId: "run-1",
    generation: 1,
    turn: 4,
    sessionSeq: 1,
    goal: GOAL,
    queueContext: {
      schema: "eic.greenfield.queue-context.v1",
      queueId: "q1",
      itemId: "slot-1",
      savedMissionId: "m-002",
      interactionCount: 2,
      maxInteractions: 5,
      priority: "HIGH",
      activationCount: 3
    },
    ...patch
  };
}

function keypointNames(context) {
  return context.keypoints.map((row) => row.keypoint);
}

function responseText(learningControl, extra = {}) {
  return JSON.stringify({
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    summary: "Bounded work was performed.",
    workPerformed: ["Read owner state."],
    evidence: ["Owner readback."],
    blockers: [],
    nextSuggestedAction: "Continue with the next bounded owner-verified work package.",
    ...(learningControl ? { learningControl } : {}),
    ...extra
  });
}

// ---------------------------------------------------------------------------
// Layer A: the contract is self-contained.

test("v1.8.0 contract is self-contained: EIC baseline, owner truth, every surface defined with is/usedFor/isNot", () => {
  const c = EIC_LEARNING_CONTROL_CONTRACT;
  assert.equal(c.baseline[0], "You have no built-in knowledge of EIC.");
  assert.match(c.baseline.join(" "), /Do not infer undocumented EIC behavior/);
  assert.match(c.ownerTruthModel.join(" "), /THE FACTUAL OWNER WINS/);
  assert.match(c.ownerTruthModel.join(" "), /never replaces fresh owner truth about mutable facts/);
  assert.deepEqual(Object.keys(c.surfaces), [
    "AIK_LEARNED", "AIK_STREAM", "SELF_LEARN", "KAIZEN", "OPERATOR_LEARNING",
    "MEMORY", "PROJECT_CHRONOLOGY", "GLOBAL_SKILL", "REPO_RUNTIME_INFRA_OWNER"
  ]);
  for (const [name, surface] of Object.entries(c.surfaces)) {
    for (const key of ["is", "usedFor", "isNot"]) assert.ok(surface[key]?.length > 10, `${name}.${key}`);
  }
  const whole = JSON.stringify(c);
  assert.doesNotMatch(whole, /normal EIC|as usual|EIC[- ]rutin|standard EIC routine/i, "no reliance on implicit EIC knowledge");
});

test("v1.8.0 contract spells out AIK, Self-learn, Kaizen, Operator Learning and routing rules literally", () => {
  const c = EIC_LEARNING_CONTROL_CONTRACT;
  const aik = c.aik.join(" ");
  for (const outcome of ["DISCOVERY_HIT_USED", "DISCOVERY_NO_HIT", "FRESH_DISCOVERY_REUSED", "WRITE_LEARNED", "REVISE_EXISTING", "NO_WRITE_DUPLICATE", "NO_WRITE_SENSITIVE"]) {
    assert.match(aik, new RegExp(outcome));
  }
  assert.match(aik, /Silent omission is NON_CONFORMANT/);
  assert.match(aik, /AIK_CONTINUITY_OPPORTUNITY_CHECK/);
  assert.match(aik, /Deduplicate before any AIK Learned or Memory write/);
  assert.match(aik, /owner readback/);
  for (const closure of ["NO_DURABLE_LEARNING", "PROJECT_CHRONOLOGY_ONLY", "OPERATOR_LEARNING_CANDIDATE", "SUPERSEDE_EXISTING_LESSON"]) {
    assert.match(c.selfLearn.join(" "), new RegExp(closure));
  }
  assert.equal(c.routing.length, 9);
  assert.ok(c.routing.some((row) => /Current server status/.test(row.information) && /not a learning store/.test(row.canonicalOwner)));
  for (const keypoint of Object.values(LEARNING_KEYPOINTS)) assert.match(c.kaizen[0], new RegExp(keypoint));
  assert.match(c.kaizen.join(" "), /state the concrete METHOD \/ ROUTING \/ CONTROL delta/);
  assert.match(c.operatorLearning.join(" "), /at least two owner-verified occurrences/);
  assert.match(c.operatorLearning.join(" "), /method_delta/);
  assert.match(c.origin.join(" "), /GREENFIELD_AUTONOMOUS/);
  assert.match(c.closureOutput.join(" "), /Do not write it to AIK/);
});

test("v1.8.0 FULL prompts carry the contract and result schema; every prompt carries the dynamic capsule", () => {
  const process = processFixture();
  const full = composeA2APrompt({ process, objective: "Continue.", messageType: "CONTINUATION" }).envelope;
  assert.deepEqual(full.responseContract.learningControlContract, EIC_LEARNING_CONTROL_CONTRACT);
  assert.ok(full.responseContract.jsonSchema.properties.learningControl.properties.aik);
  assert.match(full.responseContract.note, /control\.learningControl obligations decided by Greenfield/);
  assert.equal(full.control.learningControl.block, "EIC_LEARNING_CONTEXT");

  const compact = composeA2APrompt({
    process,
    objective: "Continue.",
    messageType: "CONTINUATION",
    promptProfile: { profile: "COMPACT", ordinal: 3, lastFullOrdinal: 1, nextFullOrdinal: 11 }
  }).envelope;
  assert.deepEqual(compact.control.learningControl, full.control.learningControl);
  assert.equal(compact.responseContract.learningControlContract, undefined);
  assert.match(compact.responseContract.learningControl, /remains fully in force/);

  const broken = { ...compact, control: { ...compact.control, learningControl: undefined } };
  assert.ok(validateA2AEnvelope(broken).errors.includes("LEARNING_CONTROL_CONTEXT"));
});

test("v1.8.0 the final interaction of a real queue quantum makes closure REQUIRED in the composed prompt", () => {
  const at = (interactionCount) => composeA2APrompt({
    process: processFixture({ queueContext: { ...processFixture().queueContext, interactionCount } }),
    objective: "Continue.",
    messageType: "CONTINUATION"
  }).envelope;
  const last = at(4);
  assert.equal(last.control.workQueue.checkpointRequired, true);
  assert.deepEqual(last.control.learningControl.keypoints, [{
    keypoint: LEARNING_KEYPOINTS.CHECKPOINT_HANDOFF_STOP_OR_TERMINAL_CLOSE,
    trigger: "FINAL_INTERACTION_IN_QUANTUM"
  }]);
  assert.equal(last.control.learningControl.obligations.SELF_LEARN_CLOSURE, OBLIGATION.REQUIRED);
  const middle = at(2);
  assert.equal(middle.control.workQueue.checkpointRequired, false);
  assert.equal(middle.control.learningControl.obligations.SELF_LEARN_CLOSURE, OBLIGATION.REQUIRED_WHEN_ENDING_WORK_BLOCK);
});

// ---------------------------------------------------------------------------
// Layer B: deterministic keypoints and obligations.

test("v1.8.0 project scope comes from the mission header", () => {
  assert.deepEqual(missionLearningScope(GOAL), { projectId: 59, projectName: "EIC Backend / ELLM Backend", subject: "GF-002", source: "MISSION_HEADER" });
  assert.deepEqual(missionLearningScope("Projekt: 2 - EIC backend - Gf: GF-007."), { projectId: 2, projectName: "EIC backend", subject: "GF-007", source: "MISSION_HEADER" });
  const none = missionLearningScope("Fix the build.");
  assert.equal(none.projectId, null);
  const context = buildLearningControlContext({ process: processFixture({ goal: "Fix the build." }), messageType: "MISSION_START" });
  assert.equal(context.project.aikScope, "RESOLVE_EXACT_PROJECT_SCOPE_FROM_OWNER_STATE_FIRST");
});

test("v1.8.0 session boundaries and new quanta are START_RESUME keypoints with REQUIRED checks", () => {
  for (const messageType of ["MISSION_START", "MISSION_RESTORE", "SESSION_ROTATION"]) {
    const context = buildLearningControlContext({ process: processFixture(), messageType });
    assert.deepEqual(keypointNames(context), [LEARNING_KEYPOINTS.START_RESUME_AFTER_OWNER_BOOTSTRAP]);
    assert.equal(context.obligations.AIK_DISCOVERY, OBLIGATION.REQUIRED);
    assert.equal(context.obligations.KAIZEN_RETRIEVAL, OBLIGATION.REQUIRED);
    assert.equal(context.project.aikScope, "project:59");
    assert.equal(context.origin, "GREENFIELD_AUTONOMOUS");
  }
  const newQuantum = buildLearningControlContext({
    process: processFixture({ queueContext: { ...processFixture().queueContext, interactionCount: 0 } }),
    messageType: "CONTINUATION"
  });
  assert.deepEqual(newQuantum.keypoints, [{ keypoint: LEARNING_KEYPOINTS.START_RESUME_AFTER_OWNER_BOOTSTRAP, trigger: "NEW_QUEUE_QUANTUM" }]);
});

test("v1.8.0 failures, unknown effects, recurring blockers, operator replans and quantum end are detected by Greenfield", () => {
  const stale = buildLearningControlContext({
    process: processFixture(),
    messageType: "SESSION_ROTATION",
    previousDisposition: "SESSION_UNRESPONSIVE",
    sessionRotation: { sourceResponseState: "PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE" }
  });
  assert.deepEqual(keypointNames(stale), [
    LEARNING_KEYPOINTS.START_RESUME_AFTER_OWNER_BOOTSTRAP,
    LEARNING_KEYPOINTS.POST_FAILURE_FALSE_BLOCKER_UNKNOWN_EFFECT_RECOVERY
  ]);

  const blocked = buildLearningControlContext({
    process: processFixture(),
    messageType: "CONTINUATION",
    analysisEvidence: { protocol: { disposition: "BLOCKED" } }
  });
  assert.equal(blocked.keypoints[0].trigger, "PREVIOUS_RESPONSE_BLOCKED");

  const withBlockers = (streak) => processFixture({
    lastPrompt: { a2a: { control: { learningControl: { workBlockId: "GF-002-s1-a3", obligations: {}, trace: { blockerStreak: streak } } } } },
    lastResponse: { contract: { value: { blockers: ["Workspace projection denied."] } } }
  });
  assert.ok(!keypointNames(buildLearningControlContext({ process: withBlockers(0), messageType: "CONTINUATION" }))
    .includes(LEARNING_KEYPOINTS.RECURRING_SOFT_BLOCKER_OR_FAILURE_FAMILY));
  const recurring = buildLearningControlContext({ process: withBlockers(1), messageType: "CONTINUATION" });
  assert.deepEqual(recurring.keypoints, [{
    keypoint: LEARNING_KEYPOINTS.RECURRING_SOFT_BLOCKER_OR_FAILURE_FAMILY,
    trigger: "BLOCKERS_IN_2_CONSECUTIVE_RESPONSES"
  }]);

  const replan = buildLearningControlContext({
    process: processFixture(),
    messageType: "CONTINUATION",
    operatorInstruction: { text: "Switch to the migration first." }
  });
  assert.deepEqual(keypointNames(replan), [LEARNING_KEYPOINTS.MAJOR_REPLAN_OR_SCOPE_DRIFT_RISK]);
  assert.equal(replan.operatorInstructionOrigin, "HUMAN_OPERATOR");
  assert.equal(replan.origin, "GREENFIELD_AUTONOMOUS");

  const closing = buildLearningControlContext({ process: processFixture(), messageType: "CONTINUATION", checkpointRequired: true });
  assert.deepEqual(keypointNames(closing), [LEARNING_KEYPOINTS.CHECKPOINT_HANDOFF_STOP_OR_TERMINAL_CLOSE]);
  assert.equal(closing.obligations.SELF_LEARN_CLOSURE, OBLIGATION.REQUIRED);
  assert.equal(closing.obligations.AIK_CONTINUITY_CHECK, OBLIGATION.REQUIRED);

  const mid = buildLearningControlContext({ process: processFixture(), messageType: "CONTINUATION" });
  assert.deepEqual(mid.keypoints, []);
  assert.equal(mid.obligations.KAIZEN_RETRIEVAL, OBLIGATION.REQUIRED_AT_DECLARED_KEYPOINT);
  assert.equal(mid.obligations.SELF_LEARN_CLOSURE, OBLIGATION.REQUIRED_WHEN_ENDING_WORK_BLOCK);
  assert.equal(mid.obligations.OWNER_TRUTH_REFRESH, OBLIGATION.REQUIRED_BEFORE_ACTING_ON_RETAINED_LEARNING);
});

test("v1.8.0 an executed check in the same work block is reusable; an unreported REQUIRED check is carried over", () => {
  const previousPrompt = (workBlockId) => ({
    a2a: { control: { learningControl: {
      workBlockId,
      obligations: { AIK_DISCOVERY: "REQUIRED", KAIZEN_RETRIEVAL: "REQUIRED", SELF_LEARN_CLOSURE: "REQUIRED_WHEN_ENDING_WORK_BLOCK" },
      trace: { blockerStreak: 0 }
    } } }
  });
  const reported = {
    aik: { discovery: "DISCOVERY_NO_HIT", continuityCheck: "NOT_TRIGGERED" },
    kaizen: { keypointOutcome: "APPLICABLE_DELTA", executionDelta: "Recover owner truth before declaring a Workspace blocker." },
    operatorLearning: {
      retrieval: "CHECK_EXECUTED_APPLICABLE",
      lessons: [{ id: "3", title: "Recover owner truth", applicability: "APPLICABLE", methodDelta: "Run the canonical owner read before reporting a blocker." }],
      executionDeltaApplied: true
    },
    ownerTruthRefreshed: true
  };
  const fresh = buildLearningControlContext({
    process: processFixture({
      lastPrompt: previousPrompt("GF-002-s1-a3"),
      lastResponse: { contract: { value: { blockers: [], learningControl: normalizeLearningControlResult(reported) } } }
    }),
    messageType: "CONTINUATION"
  });
  assert.equal(fresh.obligations.AIK_DISCOVERY, OBLIGATION.FRESH_RESULT_REUSABLE);
  assert.equal(fresh.freshChecksReusable.aikDiscovery, true);
  assert.deepEqual(fresh.carriedOverObligations, []);
  assert.equal(fresh.previousResult.kaizenOutcome, "APPLICABLE_DELTA");
  assert.deepEqual(fresh.previousResult.applicableLessons, [{ id: "3", title: "Recover owner truth", methodDelta: "Run the canonical owner read before reporting a blocker." }]);

  const otherBlock = buildLearningControlContext({
    process: processFixture({
      lastPrompt: previousPrompt("GF-002-s1-a2"),
      lastResponse: { contract: { value: { learningControl: normalizeLearningControlResult(reported) } } }
    }),
    messageType: "CONTINUATION"
  });
  assert.equal(otherBlock.obligations.AIK_DISCOVERY, OBLIGATION.REQUIRED, "a new work block needs its own discovery");

  const silent = buildLearningControlContext({
    process: processFixture({ lastPrompt: previousPrompt("GF-002-s1-a3"), lastResponse: { contract: { value: { learningControl: null } } } }),
    messageType: "CONTINUATION"
  });
  assert.deepEqual(silent.carriedOverObligations, ["AIK_DISCOVERY", "KAIZEN_RETRIEVAL"]);
  assert.equal(silent.obligations.AIK_DISCOVERY, OBLIGATION.REQUIRED);
  assert.equal(silent.obligations.KAIZEN_RETRIEVAL, OBLIGATION.REQUIRED);
  assert.equal(silent.previousResult, null);
});

// ---------------------------------------------------------------------------
// Response side: accepted, bounded, never breaks the response.

test("v1.8.0 learningControl results are normalized into a closed shape and never break response parsing", () => {
  const parsed = parseTargetResponse(responseText({
    keypoints: ["START_RESUME_AFTER_OWNER_BOOTSTRAP", "INVENTED_KEYPOINT"],
    aik: { discovery: "DISCOVERY_HIT_USED", recordsConsumed: [{ id: "17", canonicalKey: "greenfield.runtime.restartability", applicability: "APPLICABLE", extra: "x" }], continuityCheck: "WRITE_LEARNED", recordsWritten: [{ id: "18", kind: "LEARNED", readbackVerified: true }] },
    selfLearn: { closure: "PROJECT_CHRONOLOGY_ONLY", canonicalOwner: "Project 59 chronology", writeReadbackVerified: true },
    unexpected: { anything: true }
  }));
  assert.equal(parsed.ok, true);
  const result = parsed.value.learningControl;
  assert.deepEqual(result.keypoints, ["START_RESUME_AFTER_OWNER_BOOTSTRAP"]);
  assert.deepEqual(result.aik.recordsConsumed, [{ id: "17", canonicalKey: "greenfield.runtime.restartability", applicability: "APPLICABLE" }]);
  assert.equal(result.aik.recordsWritten[0].readbackVerified, true);
  assert.equal(Object.hasOwn(result, "unexpected"), false);
  assert.deepEqual([...reportedLearningObligations(result)].sort(), ["AIK_CONTINUITY_CHECK", "AIK_DISCOVERY", "SELF_LEARN_CLOSURE"]);

  const bad = normalizeLearningControlResult({ aik: { discovery: "MAYBE" }, kaizen: { keypointOutcome: "NOT_AT_KEYPOINT" } });
  assert.equal(bad.aik.discovery, "");
  assert.deepEqual([...reportedLearningObligations(bad)], [], "invalid or not-at-keypoint values do not count as executed");

  for (const raw of ["checked everything", ["DISCOVERY_NO_HIT"], { aik: { discovery: "x".repeat(9000) } }]) {
    const response = parseTargetResponse(responseText(raw, { status: "DONE", sessionAction: "STOP_PROCESS" }));
    assert.equal(response.ok, true, "a malformed learning result never hides the response status");
    assert.equal(response.status, "DONE");
    assert.deepEqual(response.value.learningControl, { malformed: true });
    assert.deepEqual(normalizeLearningControlResult(response.value.learningControl), { malformed: true });
  }
  assert.equal(parseTargetResponse(responseText(null)).value.learningControl, null);
});

// ---------------------------------------------------------------------------
// E2E through background.js prompt composition.

function mockAnalyzer(h) {
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  h.chrome.runtime.sendMessage = async (message) => message?.type === "EIC_GF_ANALYZE_PIPELINE"
    ? {
        ok: true,
        nano: null,
        decision: {
          schema: ANALYSIS_SCHEMA, disposition: "CONTINUE", targetDisposition: "CONTINUE", objectiveStatus: "PENDING",
          nanoTaskAssessment: "NOT_REQUESTED", progressEvidence: "Bounded progress.", analysis: "Mocked controller verdict.",
          nextPrompt: "Continue with the next bounded owner-verified work package.", exactTarget: "Objective.",
          ownerEvidence: "Response.", reversibility: "YES", rollbackPath: "Owner state.", readbackPlan: "Readback.",
          materialAmbiguity: "NONE", humanAuthorityRequired: false, confidence: "HIGH"
        }
      }
    : { ok: true };
}

function clock() {
  const realNow = Date.now;
  let offset = 0;
  return {
    advance(ms) {
      offset += ms;
      Date.now = () => realNow() + offset;
    },
    restore() {
      Date.now = realNow;
    }
  };
}

// Drives the real capture path (WAITING -> ANALYZING) so the learningControl
// result travels exactly as in production: content-script capture, contract
// parse into lastResponse, controller verdict, next prompt composition.
async function secondPrompt(learningControl) {
  const h = await harness();
  mockAnalyzer(h);
  const t = clock();
  try {
    await h.mod.startRun({ windowId: 1, goal: GOAL });
    let p = await loadProcessForWindow(1);
    p = await h.mod.tickSending(p);
    p = await h.mod.tickSending(p);
    assert.equal(p.phase, "WAITING");
    const first = JSON.parse(h.sent[0].prompt);

    const text = responseText(learningControl);
    const hash = await sha256Hex(text);
    Object.assign(h.page, {
      generating: false,
      assistantCount: 1,
      lastAssistantId: "assistant-1",
      assistantText: text,
      assistantHash: hash,
      autonomousTurn: {
        expectedUserTurnId: h.page.lastUserId,
        expectedUserIndex: h.page.userCount - 1,
        resolvedUserTurnId: h.page.lastUserId,
        resolvedBy: "USER_TURN_ID",
        userTextHash: h.page.lastUserHash,
        assistantFound: true,
        assistantId: "assistant-1",
        assistantOwnerKind: "EXPLICIT_TURN_SHELL",
        assistantOwnerTrusted: true,
        assistantReplicaCount: 1,
        assistantText: text,
        assistantTextLength: text.length,
        assistantHash: hash,
        assistantGenerating: false,
        assistantSignals: {}
      }
    });
    for (let i = 0; i < 8 && p.phase === "WAITING"; i += 1) {
      t.advance(3000);
      p = await h.mod.tickWaiting(p);
    }
    assert.equal(p.phase, "ANALYZING");
    const captured = p.lastResponse.contract.value.learningControl;
    p = await h.mod.tickAnalyzing(p);
    assert.equal(p.phase, "SENDING");
    return { first, captured, next: JSON.parse(p.pendingPrompt.text), profile: p.pendingPrompt.promptProfile.profile };
  } finally {
    t.restore();
  }
}

test("v1.8.0 E2E: the posted first prompt requires discovery; a reported result makes it reusable in the COMPACT follow-up", async () => {
  const { first, captured, next, profile } = await secondPrompt({
    keypoints: ["START_RESUME_AFTER_OWNER_BOOTSTRAP"],
    aik: { discovery: "DISCOVERY_NO_HIT", continuityCheck: "NOT_TRIGGERED" },
    kaizen: { keypointOutcome: "NO_APPLICABLE_LESSON" },
    operatorLearning: { retrieval: "NO_LESSONS" },
    ownerTruthRefreshed: true
  });
  assert.equal(first.messageType, "MISSION_START");
  assert.equal(first.responseContract.learningControlContract.baseline[0], "You have no built-in knowledge of EIC.");
  assert.equal(first.control.learningControl.obligations.AIK_DISCOVERY, "REQUIRED");
  assert.equal(first.control.learningControl.project.aikScope, "project:59");

  assert.equal(captured.aik.discovery, "DISCOVERY_NO_HIT", "capture keeps the normalized learning result");
  assert.equal(profile, "COMPACT");
  const capsule = next.control.learningControl;
  assert.equal(capsule.obligations.AIK_DISCOVERY, "FRESH_RESULT_REUSABLE");
  assert.deepEqual(capsule.carriedOverObligations, []);
  assert.equal(capsule.previousResult.aikDiscovery, "DISCOVERY_NO_HIT");
  assert.equal(capsule.previousResult.kaizenOutcome, "NO_APPLICABLE_LESSON");
  assert.equal(next.responseContract.learningControlContract, undefined);
});

test("v1.8.0 E2E: a response that silently skipped the required checks gets them carried over as REQUIRED", async () => {
  const { captured, next } = await secondPrompt(null);
  assert.equal(captured, null);
  const capsule = next.control.learningControl;
  assert.deepEqual(capsule.carriedOverObligations, ["AIK_DISCOVERY", "KAIZEN_RETRIEVAL"]);
  assert.equal(capsule.obligations.AIK_DISCOVERY, "REQUIRED");
  assert.equal(capsule.obligations.KAIZEN_RETRIEVAL, "REQUIRED");
  assert.equal(capsule.previousResult, null);
});
