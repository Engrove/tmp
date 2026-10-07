// v1.9.3 deterministic conformance tests for GFW_EIC_CONTROL_A2A_v1
// (conformanceFixtures F01-F20, contradiction rules C01-C20, adaptive sizing,
// hot reload, window queue overview). Synthetic ids and texts only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildA2AEnvelope, composeA2APrompt, initialMissionObjective, UNKNOWN_EFFECT_RULE } from "../lib/a2a.mjs";
import { lintA2AEnvelope, authoredPromptStrings, PROMPT_LINT_NOT_TEXT_RULES } from "../lib/prompt-lint.mjs";
import {
  GFW_ALWAYS_FETCH_OWNERS,
  GFW_SLICING_METHOD_ID,
  INTERACTION_ROLES,
  interactionPosition,
  nextInteractionAfterResponse,
  objectiveGuard,
  planningHint,
  slicePressure
} from "../lib/interaction-slicing.mjs";
import {
  completeSessionHealthTurn,
  createSessionHealthState,
  markSessionHealthFirstResponse,
  markSessionHealthPromptPosted,
  markSessionHealthProviderNotice,
  PROVIDER_NOTICE_KINDS,
  resetSessionHealthForRotation,
  sessionHealthCapsule
} from "../lib/session-health.mjs";
import { resolveGreenfieldControl } from "../lib/greenfield-control.mjs";
import { evaluateContinuationAdmission } from "../lib/continuation-guard.mjs";
import { buildHjalmarPrompt } from "../lib/hjalmar-d2.mjs";
import { parseTargetResponse } from "../lib/response-contract.mjs";
import { gfIdOf, windowQueueOverview } from "../lib/window-queue-overview.mjs";

const PROFILE_FULL = { profile: "FULL", ordinal: 1, lastFullOrdinal: 1, nextFullOrdinal: 11, missionFingerprint: "fp", reason: "TEST" };
const PROFILE_COMPACT = { profile: "COMPACT", ordinal: 3, lastFullOrdinal: 1, nextFullOrdinal: 11, missionFingerprint: "fp", reason: "TEST" };

function proc({ count = null, max = 5, health = null } = {}) {
  return {
    processId: "process-t", runId: "run-t", generation: 1, turn: 7, sessionSeq: 3, windowId: 1,
    goal: "Projekt: 900 - Syntetiskt - Gf: GF-901.",
    sessionHealth: health || createSessionHealthState({ sessionSeq: 3, sessionStartTurn: 1, now: 0 }),
    queueContext: count === null ? null : {
      schema: "eic.greenfield.queue-context.v1", queueId: "q-1", itemId: "item-1", savedMissionId: "m-1",
      slotOrder: 1, priority: "NORMAL", interactionCount: count, maxInteractions: max, activationCount: 1
    }
  };
}

function envelope({ count = null, max = 5, objective = "Run the next bounded slice.", profile = PROFILE_FULL, messageType = "CONTINUATION", sessionRotation = null, health = null, windowQueue = null } = {}) {
  return composeA2APrompt({ process: proc({ count, max, health }), objective, messageType, promptProfile: profile, sessionRotation, windowQueue }).envelope;
}

function allAuthoredText(e) {
  return authoredPromptStrings(e).map((row) => row.text).join("\n");
}

test("F01 interaction 1/5: owner refresh plus first real bounded slice, later interactions are depth, no whole chain", () => {
  const e = envelope({ count: 0, messageType: "MISSION_START", objective: initialMissionObjective() });
  const hint = e.control.workQueue.planningHint;
  assert.match(hint, /^This is interaction 1 of 5 in the current queue-slot quantum \(5 including this turn remain\)\./);
  assert.match(hint, /read fresh owner state and execute the first real bounded effect\/readback slice/);
  assert.match(hint, /do not front-load later test\/repair\/package\/readback work/);
  assert.match(hint, /Use later interactions as execution depth; do not force the whole semantic WORK_QUANTUM\/progression envelope into this response\./);
  assert.match(hint, /Preserve the current terminal contract and progressionEnvelopeRef/);
  assert.equal(e.control.interactionSlicing.role, INTERACTION_ROLES.FIRST);
  assert.doesNotMatch(initialMissionObjective(), /continue autonomously/);
  assert.match(initialMissionObjective(), /execute only its first bounded slice in this interaction; Greenfield schedules the next interaction/);
  assert.equal(lintA2AEnvelope(e).ok, true);
});

test("F02 interaction 2/5: continue the same envelope with the next dependency slice; no frontier replan", () => {
  const e = envelope({ count: 1 });
  const hint = e.control.workQueue.planningHint;
  assert.match(hint, /^This is interaction 2 of 5/);
  assert.match(hint, /Continue the same semantic WORK_QUANTUM with the next dependency-ordered slice; do not replan the frontier merely because a response ended\./);
  assert.equal(e.control.interactionSlicing.role, INTERACTION_ROLES.MIDDLE);
});

test("F03 final interaction: checkpoint/readback/handoff priority, never DONE", () => {
  const e = envelope({ count: 4 });
  const hint = e.control.workQueue.planningHint;
  assert.match(hint, /^This is interaction 5 of 5 .*\(1 including this turn remain\)\./);
  assert.match(hint, /not mission completion: prioritize reconciliation, owner readback, unresolved-effect disposition and a restart-safe handoff/);
  assert.match(hint, /terminal closure still requires supported owner-verified closure/);
  assert.equal(e.control.interactionSlicing.role, INTERACTION_ROLES.FINAL);
  assert.equal(e.control.workQueue.checkpointRequired, true);
  assert.doesNotMatch(allAuthoredText(e), /final interaction[^.]{0,60}\b(means|implies)\b[^.]{0,20}DONE/i);
  // The same distinction holds in a COMPACT prompt and for a 1-interaction slot.
  assert.match(envelope({ count: 4, profile: PROFILE_COMPACT }).control.workQueue.planningHint, /not mission completion/);
  const only = envelope({ count: 0, max: 1 });
  assert.equal(only.control.interactionSlicing.role, INTERACTION_ROLES.ONLY);
  assert.match(only.control.workQueue.planningHint, /not mission completion/);
});

test("F04 hot reload: current always-fetch method wins over FULL/COMPACT sizing text without waiting for rotation", () => {
  const full = envelope({ count: 1 });
  assert.deepEqual(full.responseContract.methodControl.alwaysFetchOwners, [...GFW_ALWAYS_FETCH_OWNERS]);
  assert.equal(full.responseContract.methodControl.methodId, GFW_SLICING_METHOD_ID);
  assert.match(full.responseContract.methodControl.rule, /override conflicting older chat-local FULL\/COMPACT prompt-sizing guidance immediately/);
  assert.deepEqual(full.responseContract.methodControl.mustNotWaitFor, ["session rotation", "queue reset", "new mission", "next periodic FULL prompt"]);
  const compact = envelope({ count: 1, profile: PROFILE_COMPACT });
  assert.match(compact.responseContract.methodControl, /always-fetch owner method/);
  assert.match(compact.responseContract.methodControl, new RegExp(GFW_SLICING_METHOD_ID));
  assert.equal(compact.control.interactionSlicing.methodId, GFW_SLICING_METHOD_ID);
  for (const e of [full, compact]) {
    for (const { path, text } of authoredPromptStrings(e)) {
      if (/fully in force/i.test(text)) assert.match(text, /unless superseded by the current always-fetch owner method/, path);
    }
  }
});

test("F05 quantum boundary is transport only; a new quantum is announced as a fresh chat", () => {
  const e = envelope({ count: 4 });
  assert.match(e.control.workQueue.checkpointInstruction, /this may be the last response Greenfield uses from this ChatGPT conversation/);
  assert.match(e.control.workQueue.quantumRule, /A slot's new quantum after a queue switch always starts in a fresh ChatGPT chat with a FULL prompt/);
  assert.match(e.control.workQueue.quantumRule, /not a number of phases to pack into one response/);
  assert.deepEqual(nextInteractionAfterResponse({ itemId: "i", interactionCount: 4, maxInteractions: 5 }), { interaction: 1, of: 5, newQuantum: true, final: false });
  assert.deepEqual(nextInteractionAfterResponse({ itemId: "i", interactionCount: 1, maxInteractions: 5 }), { interaction: 3, of: 5, newQuantum: false, final: false });
});

test("F06 a lost response carries the exact-effect-owner rule in every prompt that follows, queue or not", () => {
  const rotation = { rotationId: "r", reasonCode: "STALE_SESSION_120M_EXHAUSTED", sourceResponseState: "PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE" };
  for (const count of [null, 2]) {
    const e = envelope({ count, messageType: "SESSION_ROTATION", sessionRotation: rotation });
    assert.equal(e.continuity.sessionRotation.unknownEffectRule, UNKNOWN_EFFECT_RULE);
    assert.match(UNKNOWN_EFFECT_RULE, /read the exact effect owner; never blind-replay/);
  }
  const plain = envelope({ count: 2, messageType: "SESSION_ROTATION", sessionRotation: { ...rotation, sourceResponseState: "COMPLETED_RESPONSE_CAPTURED" } });
  assert.equal("unknownEffectRule" in plain.continuity.sessionRotation, false);
});

test("F07/F13/F14/F20 receiver-side fixtures: Greenfield text does not contradict them", () => {
  const text = allAuthoredText(envelope({ count: 2 }));
  assert.doesNotMatch(text, /split (the|an) atomic mutation/i, "F07");
  assert.doesNotMatch(text, /email[^.]{0,40}\bis\b[^.]{0,20}approval/i, "F13/F14");
  assert.equal(envelope({ count: 2 }).sender.applicationId, "GREENFIELD", "F20 operative identity");
  assert.deepEqual(PROMPT_LINT_NOT_TEXT_RULES, ["C08", "C09", "C10", "C11", "C13", "C15"]);
});

test("F08 known future-time dependency: SET_SCHEDULE mandate, no prompt polling", () => {
  const e = envelope({ count: 2 });
  assert.match(e.control.workQueue.scheduleRule, /MANDATORY: manage this slot's time with runtimeControl SET_SCHEDULE instead of spending turns waiting, polling or re-checking/);
});

test("F09-F12, F19 are covered by existing deterministic tests (names asserted so they cannot vanish silently)", () => {
  const read = (file) => fs.readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
  assert.match(read("v177-runtime-control.test.mjs"), /stale or wrong run\/turn\/queue\/item\/mission targets are rejected without effect/, "F09");
  assert.match(read("v177-runtime-control.test.mjs"), /quantum outside 1\.\.15 or non-integer is rejected, never clamped/, "F10");
  assert.match(read("v174-ordered-loop-queue.test.mjs"), /inner queue is explicit-order cyclic even when slot priorities differ/, "F11");
  assert.match(read("v177-runtime-control-e2e.test.mjs"), /structured COMPLETE_MISSION with the exact target retires only its logical mission/, "F12");
  // F19: an unsupported root field makes the structured response invalid; it
  // is never carried as control.
  const parsed = parseTargetResponse(JSON.stringify({
    schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "s", workPerformed: [], evidence: [], blockers: [],
    nextSuggestedAction: "next", interactionSlice: { index: 2 }
  }));
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.includes("ADDITIONAL_PROPERTY:interactionSlice"));
  assert.equal(parsed.value?.interactionSlice, undefined);
});

test("F15 no fresh/external Hjalmar; local analysis is labelled optional advisory", () => {
  const e = envelope({ count: 2 });
  assert.deepEqual(e.sender.presentation.loop, ["SEND", "WAIT", "CAPTURE", "LOCAL_ADVISORY_ANALYSIS", "CONTINUE"]);
  assert.match(e.sender.presentation.policy, /never the EIC's same-session Mental Hjalmar/);
  assert.doesNotMatch(allAuthoredText(e), /Hjalmar D2 is fixed|Audit is mandatory/);
});

test("F16 Nano null/absent/unknown is never a mission blocker and is never replayed", () => {
  const control = resolveGreenfieldControl({
    targetDisposition: "CONTINUE", targetNextSuggestedAction: "Do the next slice.",
    decision: { disposition: "CONTINUE", nextPrompt: "x" }, nanoTask: { requested: true, status: "UNKNOWN_EFFECT" }
  });
  assert.equal(control.action, "NEXT");
  for (const status of ["UNKNOWN_EFFECT", "RUNNING", "PENDING"]) {
    const admission = evaluateContinuationAdmission({
      targetDisposition: "CONTINUE", currentObjective: "a",
      decision: { disposition: "CONTINUE", nextPrompt: "b" }, nanoTask: { requested: true, status }
    });
    assert.equal(admission.ok, true, status);
  }
  const offscreen = fs.readFileSync(new URL("../offscreen.js", import.meta.url), "utf8");
  assert.match(offscreen, /ANALYSIS_PIPELINE_MODEL_UNAVAILABLE_FALLBACK/);
  assert.match(offscreen, /LOCAL_LANGUAGE_MODEL_UNAVAILABLE: the Nano task was not executed\./);
  const sidepanel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(sidepanel, /async function prepareLocalAnalyzerOptional\(\)/);
  assert.doesNotMatch(sidepanel, /^\s+await ensureAnalyzerReadyFromGesture\(\);\n\s+const result = await chrome\.runtime\.sendMessage/m);
});

test("F17 stale current_focus: newer owner evidence wins", () => {
  const e = envelope({ count: 2 });
  assert.equal(e.control.ownerState.currentFocus.conflictRule, "NEWER_EXACT_OWNER_EVIDENCE_WINS");
  assert.equal(e.control.ownerState.completedEffectReplayFromStaleFocus, false);
});

test("F18 repeated no-delta: the replanned continuation offers a truthful no-delta exit, DONE only with closure", () => {
  const admission = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE", currentObjective: "Same objective.",
    decision: { disposition: "CONTINUE", nextPrompt: "Same objective." }
  });
  assert.equal(admission.code, "REPLANNED_STALE_OBJECTIVE_REPEAT");
  assert.match(admission.effectiveNextPrompt, /truthful no-delta status \(with sessionAction YIELD_TO_QUEUE or BACKGROUND_SLEEP, or runtimeControl SET_SCHEDULE/);
  assert.match(admission.effectiveNextPrompt, /status=DONE only with supported terminal closure/);
});

test("v1.9.3 local advisory DONE never closes a mission without an EIC terminal status", () => {
  const cont = resolveGreenfieldControl({ targetDisposition: "CONTINUE", targetNextSuggestedAction: "Next slice.", decision: { disposition: "DONE" } });
  assert.equal(cont.state, "ACTIVE");
  assert.equal(cont.effectiveDisposition, "CONTINUE");
  assert.equal(cont.effectiveNextPrompt, "Next slice.");
  const unknown = resolveGreenfieldControl({ targetDisposition: "UNKNOWN", decision: { disposition: "DONE" } });
  assert.equal(unknown.state, "ACTIVE");
  assert.match(unknown.effectiveNextPrompt, /Return status=DONE only with supported owner-verified terminal closure/);
  const blocked = resolveGreenfieldControl({ targetDisposition: "BLOCKED", decision: { disposition: "DONE" } });
  assert.equal(blocked.effectiveDisposition, "BLOCKED");
  const eicDone = resolveGreenfieldControl({ targetDisposition: "DONE", decision: { disposition: "CONTINUE", nextPrompt: "x" } });
  assert.equal(eicDone.state, "DONE");
});

test("v1.9.3 structured EIC CONTINUE handoff is forwarded verbatim without its NANO_TASK line", () => {
  const handoff = "Run the focused parser tests and read back the result.";
  const control = resolveGreenfieldControl({
    targetDisposition: "CONTINUE", targetNextSuggestedAction: `${handoff}\nNANO_TASK: compute 2+2`,
    decision: { disposition: "CONTINUE", nextPrompt: "paraphrase" }
  });
  assert.equal(control.reason, "EIC_HANDOFF_FORWARDED");
  assert.equal(control.effectiveNextPrompt, handoff);
});

test("C01 objective guard: a multi-phase objective gets a first-slice guard; a single slice does not", () => {
  const many = "Fortsätt: slutför byteöverföringen, verifiera payloaden, komplettera repo-filerna, kör testfamiljen och gör owner-readback.";
  const guard = objectiveGuard(many, interactionPosition({ interactionInQuantum: 3, maxInteractions: 5, remainingInteractionsIncludingCurrent: 3 }));
  assert.equal(guard.overpackSuspected, true);
  assert.match(guard.rule, /execute only its first bounded slice in this interaction/);
  const final = objectiveGuard(many, interactionPosition({ interactionInQuantum: 5, maxInteractions: 5, remainingInteractionsIncludingCurrent: 1, finalInteractionInQuantum: true }));
  assert.match(final.rule, /This is a checkpoint interaction/);
  assert.equal(objectiveGuard("Run the focused parser tests and read back the result.").overpackSuspected, false);
  const composed = composeA2APrompt({ process: proc({ count: 2 }), objective: many, messageType: "CONTINUATION", promptProfile: PROFILE_FULL });
  assert.equal(composed.metrics.overpackGuardFired, true);
  assert.equal(composed.lint.overpackGuardFired, true);
});

test("C16 no response-time budget or provider TTL in Greenfield text; the watchdog is labelled and derived", () => {
  const e = envelope({ count: 2 });
  const stale = e.responseContract.queueControl.staleSessionSemantics;
  assert.match(stale, /^Greenfield client recovery watchdog \(not a provider limit and not a response-time budget\)/);
  assert.match(stale, /reloads the same conversation at 30, 60 and 90 minutes and abandons it at 120 minutes/);
  assert.match(stale, /waits up to 4 hours from the post instead/);
  assert.doesNotMatch(allAuthoredText(e), /keep each response (well )?(inside|within)/i);
});

test("C01-C20 lint: every message type, role and profile composes clean", () => {
  let composed = 0;
  for (const messageType of ["MISSION_START", "MISSION_RESTORE", "CONTINUATION", "READ_REQUIRED", "IDLE_KEEPALIVE", "SESSION_ROTATION"]) {
    for (const [count, max] of [[null, 5], [0, 5], [2, 5], [4, 5], [0, 1]]) {
      for (const profile of [PROFILE_FULL, PROFILE_COMPACT]) {
        const r = composeA2APrompt({ process: proc({ count, max }), objective: "Next slice.", messageType, promptProfile: profile });
        assert.equal(r.lint.ok, true, `${messageType} ${count}/${max} ${profile.profile}`);
        composed += 1;
      }
    }
  }
  assert.equal(composed, 60);
});

test("C01-C20 lint catches each injected contradiction (mutation check)", () => {
  const base = envelope({ count: 2 });
  const mutate = (fn) => { const e = structuredClone(base); fn(e); return lintA2AEnvelope(e).findings.map((f) => `${f.rule}:${f.code}`); };
  assert.ok(mutate((e) => { e.responseContract.note += " Complete the whole envelope in this response."; }).includes("C01:WHOLE_ENVELOPE_DIRECTIVE"));
  assert.ok(mutate((e) => { e.responseContract.note += " Select a package, then continue autonomously."; }).includes("C01:CHAINING_DIRECTIVE"));
  assert.ok(mutate((e) => { e.control.workQueue.planningHint = "Plan a slice."; }).includes("C03:POSITION_STATEMENT_MISSING"));
  assert.ok(mutate((e) => { e.control.workQueue.planningHint = e.control.workQueue.planningHint.replace("interaction 3 of 5", "interaction 7 of 5"); }).includes("C03:POSITION_NOT_FROM_QUEUE_COUNTERS"));
  assert.ok(mutate((e) => { e.responseContract.note += " The final interaction means status=DONE."; }).includes("C04:FINAL_AS_DONE"));
  assert.ok(mutate((e) => { e.control.workQueue.planningHint = e.control.workQueue.planningHint.replace(" Preserve the current terminal contract and progressionEnvelopeRef unless a real owner/risk/evidence transition occurs.", ""); }).includes("C05:ENVELOPE_CONTINUITY_MISSING"));
  assert.ok(mutate((e) => { e.control.workQueue.planningHint = e.control.workQueue.planningHint.replace("do not replan the frontier merely because a response ended", "proceed"); }).includes("C06:SAME_QUANTUM_CONTINUITY_MISSING"));
  assert.ok(mutate((e) => { e.sender.presentation.policy = "Hjalmar D2 is fixed. Audit is mandatory."; }).includes("C12:HJALMAR_MANDATORY"));
  assert.ok(mutate((e) => { e.sender.presentation.loop = ["SEND", "NANO", "CONTINUE"]; }).includes("C12:MANDATORY_ANALYSIS_STEP"));
  assert.ok(mutate((e) => { e.responseContract.note += " The Nano stage is mandatory."; }).includes("C14:NANO_MANDATORY"));
  assert.ok(mutate((e) => { e.responseContract.queueControl.staleSessionSemantics += " Keep each response well inside this bound."; }).includes("C16:RESPONSE_TIME_BUDGET"));
  assert.ok(mutate((e) => { e.responseContract.queueControl.staleSessionSemantics = "Abandoned at 120 minutes."; }).includes("C16:WATCHDOG_NOT_LABELLED"));
  assert.ok(mutate((e) => { e.responseContract.note += " Split into PART-1 and PART-2 artifacts."; }).includes("C17:PART_ARTIFACTS"));
  assert.ok(mutate((e) => { e.responseContract.jsonSchema = { ...e.responseContract.jsonSchema, properties: { ...e.responseContract.jsonSchema.properties, interactionSlice: { type: "object" } } }; }).includes("C18:UNSUPPORTED_RESPONSE_ROOT_FIELD"));
  assert.ok(mutate((e) => { delete e.responseContract.methodControl; }).includes("C19:METHOD_CONTROL_MISSING"));
  assert.ok(mutate((e) => { e.promptProfile.rule = "Sections remain fully in force."; }).includes("C19:FULL_IN_FORCE_WITHOUT_METHOD_PRECEDENCE"));
  assert.ok(mutate((e) => { e.responseContract.note += " Tool runs count as mission progress."; }).includes("C20:ACTIVITY_AS_PROGRESS"));
  assert.throws(() => {
    const e = structuredClone(base);
    e.responseContract.note += " Keep each response well inside this bound.";
    if (!lintA2AEnvelope(e).ok) throw Object.assign(new Error("lint"), { code: "A2A_PROMPT_LINT_FAILED" });
  }, { code: "A2A_PROMPT_LINT_FAILED" });
});

test("adaptive sizing: completion pressure and provider notices shrink the next slice; context size alone does not", () => {
  let s = createSessionHealthState({ sessionSeq: 1, sessionStartTurn: 1, now: 0 });
  const turn = (n, completionMs, notice = null) => {
    s = markSessionHealthPromptPosted(s, { sessionSeq: 1, turn: n, promptHash: `h${n}`, promptChars: 9000, postedAtMs: n * 10_000_000 });
    s = markSessionHealthFirstResponse(s, { promptHash: `h${n}`, observedAtMs: n * 10_000_000 + 30_000 });
    if (notice) s = markSessionHealthProviderNotice(s, { kind: notice, observedAtMs: n * 10_000_000 + 60_000 });
    if (notice) s = markSessionHealthProviderNotice(s, { kind: notice, observedAtMs: n * 10_000_000 + 600_000 });
    s = completeSessionHealthTurn(s, { promptHash: `h${n}`, completedAtMs: n * 10_000_000 + 30_000 + completionMs, responseChars: 4000 });
  };
  turn(1, 400_000); turn(2, 420_000);
  assert.equal(slicePressure(sessionHealthCapsule(s)).level, "NORMAL");
  turn(3, 1_200_000);
  const c = sessionHealthCapsule(s);
  assert.equal(c.completionBaselineMs, 410_000);
  assert.ok(c.signals.includes("COMPLETION_HIGH_RELATIVE"), c.signals.join(","));
  assert.equal(slicePressure(c).level, "SHRINK");
  turn(4, 400_000, PROVIDER_NOTICE_KINDS.PROCESSING);
  const notice = sessionHealthCapsule(s);
  assert.ok(notice.signals.includes("PROVIDER_BACKGROUND_PROCESSING"));
  assert.equal(s.samples.at(-1).processingNoticeMs, 540_000);
  assert.equal(s.samples.at(-1).promptChars, 9000);
  // The notice survives a new chat for the recent-turn window, then decays.
  let rotated = resetSessionHealthForRotation(s, { sessionSeq: 2, sessionStartTurn: 5 });
  assert.ok(sessionHealthCapsule(rotated).signals.includes("PROVIDER_BACKGROUND_PROCESSING"));
  s = rotated;
  turn(5, 300_000); turn(6, 300_000); turn(7, 300_000);
  assert.equal(sessionHealthCapsule(s).signals.includes("PROVIDER_BACKGROUND_PROCESSING"), false);
  // An unanswered turn that saw a broken connection still counts.
  s = markSessionHealthPromptPosted(s, { sessionSeq: 2, turn: 8, promptHash: "h8", promptChars: 1, postedAtMs: 90_000_000 });
  s = markSessionHealthProviderNotice(s, { kind: PROVIDER_NOTICE_KINDS.CONNECTION_INTERRUPTED, observedAtMs: 90_100_000 });
  rotated = resetSessionHealthForRotation(s, { sessionSeq: 3, sessionStartTurn: 9 });
  assert.ok(sessionHealthCapsule(rotated).signals.includes("TRANSPORT_INTERRUPTED"));
  // Context-size signals do not shrink the slice.
  assert.equal(slicePressure({ signals: ["LONG_SESSION"], pressureBand: "WATCH" }).level, "NORMAL");
  // The prompt carries the SHRINK advice.
  const e = envelope({ count: 2, health: rotated });
  assert.equal(e.control.interactionSlicing.slicePressure.level, "SHRINK");
  assert.match(e.control.interactionSlicing.slicePressure.rule, /shrink this slice to one decision\/effect-owner lane/);
});

test("planning hint is built from counters only and is identical for identical counters", () => {
  const a = planningHint(interactionPosition({ interactionInQuantum: 2, maxInteractions: 5, remainingInteractionsIncludingCurrent: 4 }));
  const b = planningHint(interactionPosition({ interactionInQuantum: 2, maxInteractions: 5, remainingInteractionsIncludingCurrent: 4 }));
  assert.equal(a, b);
  const window = interactionPosition({ interactionInQuantum: 2, maxInteractions: 5, remainingInteractionsIncludingCurrent: 4, checkpointRequired: true });
  assert.equal(window.role, INTERACTION_ROLES.WINDOW_CHECKPOINT);
  assert.match(planningHint(window), /The slot's run window likely closes after this response/);
  const unqueued = envelope({ count: null });
  assert.equal(unqueued.control.interactionSlicing.role, INTERACTION_ROLES.UNQUEUED);
  assert.match(unqueued.control.interactionSlicing.planningHint, /Greenfield sends one prompt per interaction and schedules the next interaction itself/);
});

test("Hjalmar D2 sizes nextPrompt for the next interaction and cannot declare mission DONE on its own", () => {
  const prompt = buildHjalmarPrompt({ goal: "g", turn: 4, nextInteraction: { interaction: 3, of: 5, newQuantum: false, final: false } });
  assert.match(prompt, /NEXT_INTERACTION=\{"interaction":3,"of":5,"newQuantum":false,"final":false\}/);
  assert.match(prompt, /16\. nextPrompt is exactly one bounded dependency-ordered slice for NEXT_INTERACTION, never the whole remaining plan/);
  assert.match(prompt, /DONE = TARGET_DISPOSITION is DONE with supported terminal closure/);
  assert.match(buildHjalmarPrompt({ goal: "g", turn: 1 }), /NEXT_INTERACTION=NOT_QUEUED/);
});

test("window queue overview lists every GF slot with state, quantum and schedule, in queue order", () => {
  const now = Date.parse("2026-10-07T10:00:00Z");
  const queue = {
    queueId: "q-1", enabled: true,
    items: [
      { itemId: "a", order: 1, label: "Projekt: 83 - X - Gf: GF-061.", status: "READY", priority: "NORMAL", maxInteractions: 5, quantumProgress: 4, savedMissionId: "m-61" },
      { itemId: "b", order: 0, label: "Projekt: 59 - Y - Gf: GF-060.", status: "ACTIVE", priority: "HIGH", maxInteractions: 6, quantumProgress: 3 },
      { itemId: "c", order: 2, label: "GF-007 P0-E bounded Cell test completion", status: "PAUSED", priority: "URGENT", maxInteractions: 5, quantumProgress: 0,
        pauseUntilMs: now + 3_600_000, schedule: { windows: [{ days: [1, 2, 3, 4, 5], start: "22:00", end: "06:00" }], pauseUntilMs: now + 7_200_000 },
        delegation: { requestId: "gf045-gf007-p0e", sourceItemId: "src-1" } }
    ]
  };
  const overview = windowQueueOverview(queue, { now, currentItemId: "a" });
  assert.equal(overview.slotCount, 3);
  assert.deepEqual(overview.slots.map((slot) => slot.gf), ["GF-060", "GF-061", "GF-007"]);
  assert.deepEqual(overview.slots.map((slot) => slot.position), [1, 2, 3]);
  const current = overview.slots.find((slot) => slot.current);
  assert.equal(current.itemId, "a");
  assert.equal(current.status, "ACTIVE", "the prompted slot is the running one");
  assert.equal(current.completedInteractions, 4);
  const paused = overview.slots[2];
  assert.equal(paused.schedule.windows, "Mon-Fri 22:00-06:00");
  assert.ok(paused.schedule.pauseUntil);
  assert.ok(paused.nextRunnableAt);
  assert.equal(paused.delegatedBy, "gf045-gf007-p0e");
  assert.equal("itemId" in overview.slots[0], false, "ids only for the current slot");
  assert.equal("current" in overview.slots[0], false);
  assert.equal(overview.slots[0].schedule.windows, "ALWAYS_OPEN");
  assert.match(overview.rule, /Only the slot marked current is yours/);
  assert.equal(gfIdOf({ label: "", goal: "Gf: gf-12" }), "GF-12");
  assert.equal(windowQueueOverview({ items: [] }), null);
  // Carried in FULL and COMPACT prompts and lint-clean.
  for (const profile of [PROFILE_FULL, PROFILE_COMPACT]) {
    const e = envelope({ count: 2, profile, windowQueue: overview });
    assert.deepEqual(e.control.windowQueue.slots, overview.slots);
    assert.equal(e.control.windowQueue.rule, profile === PROFILE_FULL ? overview.rule : "UNCHANGED_FROM_LAST_FULL_PROMPT");
    assert.equal(lintA2AEnvelope(e).ok, true);
  }
});
