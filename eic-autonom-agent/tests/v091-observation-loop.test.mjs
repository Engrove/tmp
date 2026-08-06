import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  computeNanoActivationKey,
  computeObservationIdentity,
  consumePostCutoffAction,
  createDecisionCapsule,
  createObservationLoopState,
  recordObservationCycle,
  registerNanoActivation,
  registerObservationIdentity,
  resolveProgramTerminality,
  scoreTwinnedFixtures
} from "../lib/autonomy-progress.mjs";
import { COMPLETION_DISPOSITIONS, resolveCompletionDisposition } from "../lib/decision-grounding.mjs";
import { buildNanoDecisionPrompt } from "../lib/nano-pipeline.mjs";

const baseIdentityInput = {
  stableGoal: "Deliverera EIC Autonom Agent v0.9.1 säkert.",
  activeWorkUnit: "Stoppa upprepade Nano-groundingcykler.",
  ownerLocators: ["project:63", "artifact:1134"],
  claimBoundary: {
    ownerRoute: "PROJECT_AND_EXACT_SOURCE",
    targetTextAuthority: "NONE"
  },
  observation: {
    verdict: "BLOCKER",
    detail: "Repository binding är PENDING.",
    ownerRead: "project/get(63)"
  }
};

test("v0.9.1 observation identity är deterministisk", async () => {
  const first = await computeObservationIdentity(baseIdentityInput);
  const second = await computeObservationIdentity(baseIdentityInput);
  assert.equal(first, second);
  assert.match(first, /^obs-sha256:[a-f0-9]{64}$/);
});

test("v0.9.1 semantiskt identiska observationer dedupliceras", async () => {
  const first = await computeObservationIdentity(baseIdentityInput);
  const second = await computeObservationIdentity({
    ...baseIdentityInput,
    stableGoal: "  DELIVERERA  EIC Autonom Agent v0.9.1 säkert! ",
    ownerLocators: ["ARTIFACT:1134", "PROJECT:63"],
    observation: {
      observedAt: "2099-01-01T00:00:00Z",
      wordingRevision: 99,
      ownerRead: "PROJECT/GET(63)",
      detail: "Repository binding är pending",
      verdict: "blocker"
    }
  });
  assert.equal(first, second);
});

test("v0.9.1 oförändrad identitet återanvänder context-, twin- och receiptreferenser", async () => {
  const identity = await computeObservationIdentity(baseIdentityInput);
  const first = registerObservationIdentity(createObservationLoopState(), { identity, now: 1 });
  const second = registerObservationIdentity(first.state, { identity, now: 2 });
  assert.equal(first.objectsCreated, 3);
  assert.equal(second.objectsCreated, 0);
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.references, first.references);
});

test("v0.9.1 två no-progress-cykler ger NON_PROGRESSING_LOOP", async () => {
  const identity = await computeObservationIdentity(baseIdentityInput);
  let registration = registerObservationIdentity(createObservationLoopState(), { identity, now: 1 });
  const first = recordObservationCycle(registration.state, { identity, now: 2 });
  const second = recordObservationCycle(first.state, { identity, now: 3 });
  assert.equal(first.verdict, "CONTINUE_MONITOR");
  assert.equal(second.verdict, "NON_PROGRESSING_LOOP");
  assert.equal(second.consecutiveNoProgress, 2);
  assert.equal(second.canStartAnotherGrounding, false);
});

test("v0.9.1 post-cutoff tillåter exakt en bounded pivot eller stop", async () => {
  const identity = await computeObservationIdentity(baseIdentityInput);
  let state = registerObservationIdentity(createObservationLoopState(), { identity }).state;
  state = recordObservationCycle(state, { identity }).state;
  state = recordObservationCycle(state, { identity }).state;
  const first = consumePostCutoffAction(state, { identity, action: "SUBSYSTEM_PIVOT" });
  const second = consumePostCutoffAction(first.state, { identity, action: "BOUNDED_STOP" });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.reason, "POST_CUTOFF_ACTION_ALREADY_CONSUMED");
});

test("v0.9.1 emit twin fortsätter på färsk owner-evidens", async () => {
  const identity = await computeObservationIdentity(baseIdentityInput);
  let state = registerObservationIdentity(createObservationLoopState(), { identity }).state;
  state = recordObservationCycle(state, { identity }).state;
  const emit = recordObservationCycle(state, {
    identity,
    ownerEvidence: [{ locator: "artifact:1200", digest: "abc123", result: "READBACK_VERIFIED" }]
  });
  assert.equal(emit.verdict, "PROGRESS");
  assert.equal(emit.freshProgress, true);
  assert.equal(emit.consecutiveNoProgress, 0);
  assert.equal(emit.canStartAnotherGrounding, true);
});

test("v0.9.1 block twin stoppar oförändrad meta-grounding", async () => {
  const identity = await computeObservationIdentity(baseIdentityInput);
  let state = registerObservationIdentity(createObservationLoopState(), { identity }).state;
  state = recordObservationCycle(state, { identity, delivery: [] }).state;
  const block = recordObservationCycle(state, { identity, delivery: [] });
  assert.equal(block.verdict, "NON_PROGRESSING_LOOP");
  const repeated = registerObservationIdentity(block.state, { identity });
  assert.equal(repeated.canStartGrounding, false);
});

test("v0.9.1 block-only är inte full utility-täckning", () => {
  assert.deepEqual(scoreTwinnedFixtures({ blockPass: true, emitPass: false }), {
    covered: false,
    classification: "BLOCK_ONLY_DISCRIMINATING_POWER_UNVERIFIED"
  });
  assert.equal(scoreTwinnedFixtures({ blockPass: true, emitPass: true }).covered, true);
});

test("v0.9.1 SUBTASK_DONE med kvarvarande programarbete ger PROGRAM_CONTINUE", () => {
  const result = resolveProgramTerminality({
    subtaskDone: true,
    stableGoalComplete: false,
    programNextAction: "Implementera den separata Nano-timeout-enheten.",
    completionEvidence: "No-progress-enheten passerade sina tester."
  });
  assert.equal(result.subtask, "SUBTASK_DONE");
  assert.equal(result.program, "PROGRAM_CONTINUE");
  assert.equal(result.eicAutonomy, "CONTINUE");
  assert.equal(result.terminal, false);
});

test("v0.9.1 verkligt terminalt mandat tillåter DONE", () => {
  const result = resolveProgramTerminality({
    subtaskDone: true,
    stableGoalComplete: true,
    programNextAction: "",
    completionEvidence: "Alla mandatets acceptanskriterier är owner-verifierade."
  });
  assert.equal(result.program, "PROGRAM_DONE");
  assert.equal(result.eicAutonomy, "DONE");
  assert.equal(result.terminal, true);
});

test("v0.9.1 uppdiktade requestfält avvisas", async () => {
  await assert.rejects(
    computeObservationIdentity({ ...baseIdentityInput, invented_token: "model-authored" }),
    /okända fält/
  );
  assert.throws(
    () => recordObservationCycle(createObservationLoopState(), {
      identity: "obs-sha256:" + "a".repeat(64),
      guessedPreflight: true
    }),
    /registrerad observation identity|okända fält/
  );
});

test("v0.9.1 Decision Capsule begränsar locatorer till två", () => {
  const capsule = createDecisionCapsule({
    verdict: "PROGRAM_CONTINUE",
    reason: "Underuppgiften är klar.",
    consequence: "Timeout-enheten återstår.",
    nextAction: "Öppna timeout-enheten.",
    locators: ["code:166", "artifact:1200"]
  });
  assert.equal(capsule.locators.length, 2);
  assert.throws(() => createDecisionCapsule({
    verdict: "X", reason: "Y", consequence: "Z", nextAction: "N",
    locators: ["a", "b", "c"]
  }), /högst två/);
});

test("v0.9.1 Nano aktiveras högst en gång för oförändrad trusted-session/version/bindning", async () => {
  const key = await computeNanoActivationKey({
    trustedSession: "window:7",
    version: "0.9.1",
    binding: "LanguageModel|en|nano-core-v9"
  });
  const first = registerNanoActivation(createObservationLoopState(), { activationKey: key });
  const second = registerNanoActivation(first.state, { activationKey: key });
  assert.equal(first.activate, true);
  assert.equal(second.activate, false);
  assert.equal(second.reused, true);
  assert.equal(second.state.activationCount, 1);
});

test("v0.9.1 ändrad version eller bindning tillåter ny Nano-aktivering", async () => {
  const firstKey = await computeNanoActivationKey({
    trustedSession: "window:7", version: "0.9.1", binding: "LanguageModel|en|A"
  });
  const secondKey = await computeNanoActivationKey({
    trustedSession: "window:7", version: "0.9.1", binding: "LanguageModel|en|B"
  });
  let state = registerNanoActivation(createObservationLoopState(), { activationKey: firstKey }).state;
  const changed = registerNanoActivation(state, { activationKey: secondKey });
  assert.equal(changed.activate, true);
  assert.equal(changed.state.activationCount, 2);
});

test("v0.9.1 background kopplar identitet, dedupe och strikt cutoff till runtimevägen", () => {
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /computeObservationIdentity/);
  assert.match(background, /registerObservationIdentity/);
  assert.match(background, /NON_PROGRESSING_LOOP/);
  assert.match(background, /consumePostCutoffAction/);
  assert.doesNotMatch(background, /const recoveryBudget = Math\.max\(1, Number\(config\.recoveryBudget \|\| 9\)\)/);
});

test("v0.9.1 känd nästa programåtgärd blockerar terminal DONE", () => {
  const disposition = resolveCompletionDisposition({
    action: "DONE",
    completionConfirmed: true,
    completionScope: "STABLE_GOAL",
    completionEvidence: "Enheten är klar."
  }, {
    targetResult: {
      valid: true,
      status: "DONE",
      completionEvidence: "Enheten är klar."
    },
    programNextAction: "Implementera timeout-enheten."
  });
  assert.equal(disposition, COMPLETION_DISPOSITIONS.CONTINUE_NEXT_WORK_UNIT);
});

test("v0.9.3 Nano-kontraktet skiljer UNIT_DONE från fortsatt program", () => {
  const prompt = buildNanoDecisionPrompt({
    run: { mode: "WAITING_CONTINUE" },
    request: { mode: "CONTINUATION_ANALYSIS" },
    continuityProjection: {
      intent: "Leverera v0.9.1.",
      position: { workUnit: "No-progress-enhet." }
    },
    observation: {
      responseText: "Arbetsenheten är klar men timeout återstår.",
      conversationExcerpt: ""
    },
    targetMandate: "Fortsätt bounded."
  });
  assert.match(prompt, /UNIT_DONE, MILESTONE_CONTINUE, PROGRAM_BLOCKED and PROGRAM_DONE/);
  assert.match(prompt, /no concrete next action/i);
});

test("v0.9.1 sidepanel återanvänder Nano för oförändrad aktiveringsnyckel", () => {
  const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(panel, /buildNanoActivationBinding/);
  assert.match(panel, /state\.nanoActivationKey === activationKey/);
  assert.match(panel, /reusedActivation: true/);
  assert.match(panel, /if \(state\.modelCreatePromise\) return state\.modelCreatePromise;/);
});
