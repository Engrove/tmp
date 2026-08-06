import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  pageContainsNewAssistantReply,
  reconcileEffectRecord
} from "../lib/effect-journal.mjs";
import {
  isAssistantResponseCandidate
} from "../lib/response-trigger.mjs";
import {
  buildNanoDecisionPromptDetailed
} from "../lib/nano-pipeline.mjs";
import {
  buildTurnObject,
  compileTurnPrompt,
  parseTargetResult
} from "../lib/prompt-contract.mjs";
import {
  protocolFastPathEligible
} from "../lib/protocol-fast-path.mjs";
import {
  canTerminateRun
} from "../lib/decision-grounding.mjs";
import {
  createRun,
  STATES
} from "../lib/state-machine.mjs";
import {
  detachRunFromTab,
  reattachRunToTab,
  runIsDetached
} from "../lib/tab-attachment.mjs";

function assistantPage(overrides = {}) {
  return {
    conversationKey: "chatgpt.com:c:session-1",
    taskFingerprint: "task-new",
    latestAssistantHash: "assistant-new",
    latestMessageRole: "assistant",
    latestAssistantCandidate: true,
    latestAssistantComplete: false,
    assistantCount: 2,
    foregroundSignals: { streamingAssistant: false },
    backgroundSignals: { active: false, cancelled: false, error: false },
    ...overrides
  };
}

test("v0.7.8 new assistant reply implicitly ACKs UNCERTAIN_EXHAUSTED prompt delivery", () => {
  const page = assistantPage();
  assert.equal(pageContainsNewAssistantReply(page, {
    baselineAssistantCount: 0,
    lastProcessedAssistantCount: 0,
    lastProcessedResponseIdentity: "chatgpt.com:c:old|old-task|old-hash"
  }), true);

  const result = reconcileEffectRecord({
    turnId: "turn-start",
    status: "UNCERTAIN_EXHAUSTED",
    attempts: 2,
    submittedAt: new Date(0).toISOString()
  }, page, {
    now: 200_000,
    baselineAssistantCount: 0,
    lastProcessedAssistantCount: 0,
    lastProcessedResponseIdentity: "chatgpt.com:c:old|old-task|old-hash"
  });

  assert.equal(result.reason, "ASSISTANT_RESPONSE_VISIBLE");
  assert.equal(result.effect.status, "ACKED");
  assert.equal(result.effect.ackEvidence, "ASSISTANT_RESPONSE_IMPLICIT_ACK");
  assert.equal(result.shouldPause, false);
});

test("v0.7.8 does not use an unchanged baseline assistant as implicit ACK", () => {
  const page = assistantPage({ assistantCount: 1 });
  const identity = "chatgpt.com:c:session-1|task-new|assistant-new";
  assert.equal(pageContainsNewAssistantReply(page, {
    baselineAssistantCount: 1,
    lastProcessedAssistantCount: 1,
    baselineResponseIdentity: identity,
    lastProcessedResponseIdentity: identity
  }), false);
});

test("current missing footer remains a response candidate and triggers repair-only", () => {
  const page = assistantPage();
  assert.equal(isAssistantResponseCandidate(page), true);
  const built = buildNanoDecisionPromptDetailed({
    run: {
      runId: "run-1",
      mode: "NEW_SESSION",
      state: "ASSESSING",
      turnIndex: 1,
      checkpointIndex: 0,
      maxAutonomousMode: true,
      currentTurn: { turnId: "turn-1" }
    },
    request: { requestId: "request-1", mode: "CONTINUATION_ANALYSIS" },
    observation: {
      responseText: "Ett stabilt assistantsvar utan EIC-footer.",
      conversationExcerpt: "Användaren bad om konkret arbete.",
      responseHash: "assistant-new",
      targetResult: { valid: false, reason: "PROTOCOL_MISSING", status: null }
    },
    config: { targetMandate: "Fortsätt säkert." },
    continuityProjection: {
      intent: "Slutför uppdraget.",
      position: { workUnit: "Utför nästa konkreta steg." },
      targetClaims: ["Svar observerat."]
    }
  });
  assert.match(built.prompt, /REPAIR_ONLY.*EIC-AA\/5/i);
  assert.match(built.prompt, /REPAIR_ONLY.*current EIC-AA\/5 footer/i);
  assert.doesNotMatch(built.prompt, /Ett stabilt assistantsvar|Användaren bad om konkret arbete/);
});

test("v0.9.5 rejects retired FULL_STOP and accepts current PROGRAM_DONE", () => {
  const retired = parseTargetResult(`Klart.

EIC_TURN: turn-old
EIC_NEXT: NONE
EIC_COMPLETION_EVIDENCE: COMPLETE_PASS: alla kriterier verifierade.
EIC_NEXT_ACTOR: NONE\nEIC_AUTONOMY: FULL_STOP`, "turn-old");
  assert.equal(retired.valid, false);
  assert.equal(retired.reason, "PROTOCOL_TRAILER_NOT_EXACT");

  const current = parseTargetResult(`Klart.

EIC_TURN: turn-current
EIC_NEXT: NONE
EIC_COMPLETION_EVIDENCE: PROGRAM_DONE · alla acceptanskriterier owner-verifierade.
EIC_NEXT_ACTOR: NONE\nEIC_AUTONOMY: DONE`, "turn-current");
  assert.equal(current.valid, true);
  assert.equal(current.status, "DONE");
  assert.equal(current.completionState, "PROGRAM_DONE");
  assert.equal(protocolFastPathEligible(current), true);
});

test("v0.10.1 rejects retired FULL_STOP in the completion decision gate", () => {
  const targetResult = {
    valid: true,
    status: "FULL_STOP",
    fullStopReason: "COMPLETE_PASS",
    completionEvidence: "COMPLETE_PASS: owner-supported PASS"
  };
  assert.equal(canTerminateRun({
    completionConfirmed: true,
    completionEvidence: "Owner-supported PASS",
    completionScope: "STABLE_GOAL"
  }, { targetResult }), false);
});

test("current compiled target turn repeats EIC-AA/5 completion-state footer rule", async () => {
  const turn = await buildTurnObject({
    turnId: "turn-footer",
    targetMandate: "Fortsätt uppdraget säkert.",
    targetMandateVersion: "target-core-v2",
    taskIntent: "Slutför uppdraget.",
    workUnit: "Implementera den minsta säkra ändringen.",
    requestedAction: "Patcha filen och rapportera testresultatet."
  });
  const compiled = await compileTurnPrompt(turn);
  assert.match(compiled.prompt, /Return exactly these five final lines/);
  assert.match(compiled.prompt, /EIC_NEXT_ACTOR: <AGENT\|OPERATOR_ACTION\|OPERATOR_DECISION\|EXTERNAL_SYSTEM\|NONE>[\s\S]*EIC_AUTONOMY: <CONTINUE\|OPERATOR_ACTION_REQUIRED\|USER_PAUSE\|DONE>/);
  assert.match(compiled.prompt, /PROGRAM_DONE|PROGRAM_BLOCKED|UNIT_DONE/s);
});

test("v0.7.8 detach preserves the active run and exact reattach resumes through RECOVERING", () => {
  const original = createRun({
    windowId: 10,
    targetTabId: 20,
    conversationKey: "chatgpt.com:c:session-1"
  });
  original.state = STATES.WAITING_FOR_RESPONSE;
  original.currentTurn = { turnId: "turn-1", effectState: "UNCERTAIN_EXHAUSTED" };
  original.effectJournal = [{ turnId: "turn-1", status: "UNCERTAIN_EXHAUSTED" }];
  original.pendingObservation = { observationId: "obs-1" };

  const detached = detachRunFromTab(original, {
    tabId: 20,
    conversationKey: "chatgpt.com:c:session-1"
  });
  assert.equal(detached.detached, true);
  assert.equal(detached.run.state, STATES.SOFT_PAUSED);
  assert.equal(runIsDetached(detached.run), true);
  assert.deepEqual(detached.run.currentTurn, original.currentTurn);
  assert.deepEqual(detached.run.effectJournal, original.effectJournal);
  assert.deepEqual(detached.run.pendingObservation, original.pendingObservation);

  const reattached = reattachRunToTab(detached.run, {
    tabId: 21,
    conversationKey: "chatgpt.com:c:session-1"
  });
  assert.equal(reattached.reattached, true);
  assert.equal(reattached.run.targetTabId, 21);
  assert.equal(reattached.run.state, STATES.RECOVERING);
  assert.equal(runIsDetached(reattached.run), false);
  assert.deepEqual(reattached.run.currentTurn, original.currentTurn);
});

test("v0.7.8 detach UI and command are present", () => {
  const html = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(html, /id="detachActiveTabButton"[^>]*>Koppla bort aktiv flik/);
  assert.match(panel, /DETACH_SELECTED_TAB/);
  assert.match(background, /UI_COMMANDS\.DETACH_SELECTED_TAB/);
});
