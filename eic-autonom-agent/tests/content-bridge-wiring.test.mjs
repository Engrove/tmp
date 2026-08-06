import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");

test("egen badge är explicit exkluderad från trusted page chrome", () => {
  assert.match(content, /data-eic-own-ui/);
  assert.match(content, /!element\.closest\("\[data-eic-own-ui='true'\]"\)/);
  assert.doesNotMatch(content, /badge\.setAttribute\("role",\s*"status"\)/);
  assert.doesNotMatch(content, /badge\.setAttribute\("aria-live"/);
});

test("BACKGROUND har egen label och kan inte falla till FRÅNKOPPLAD", () => {
  assert.match(content, /BACKGROUND:\s*"EIC · BAKGRUNDSVÄNTAN"/);
});

test("content skickar bounded turn-ID och promptdigest; background läser effect-setet", () => {
  assert.match(content, /userTurnIds/);
  assert.match(content, /userMessageHashes/);
  assert.match(background, /pageContainsEffect\(page, effect\)/);
  assert.doesNotMatch(background, /userMessageContainsTurn\(page\.latestUser/);
});

test("Nano-förslag separeras från lokal trusted Mjölnar-trigger", () => {
  assert.match(panel, /sourceClass:\s*"NANO_PROPOSED"/);
  assert.match(background, /sourceClass:\s*"LOCAL_STATE_MACHINE"/);
  assert.match(background, /const action = ACTION_REGISTRY\[actionCode\]/);
});

test("target-authored fallback är default av och panelstängning får inte skapa continuation", () => {
  assert.match(background, /allowTargetAuthoredFallback === true/);
  assert.match(background, /Nano-host saknas eller sidepanelen är stängd/);
});

test("storage failure öppnar fail-closed circuit", () => {
  assert.match(background, /storageCircuitOpen = true/);
  assert.match(background, /STORAGE_PERSISTENCE_FAILURE/);
  assert.match(background, /STATES\.PROGRAM_BLOCKED/);
});

test("tickAll isolerar fönsterfel", () => {
  assert.match(background, /for \(const windowId of windowIds\) \{\s*try \{/s);
});


test("takeover utan Nano-claim pausar efter värdfristen", () => {
  assert.match(background, /takeoverHostDue/);
  assert.match(background, /Takeover kräver lokal Nano-host/);
  assert.match(background, /ingen målprompt skickades/i);
});

test("locator promotion uppdaterar aktiv run i background", () => {
  assert.match(background, /classifyConversationLocatorChange/);
  assert.match(background, /conversationPromotion/);
  assert.match(background, /run\.conversationKey = locatorChange\.next/);
});

test("Mjölnar-verifierad effekt omgrundas före continuation", () => {
  assert.match(background, /mjolnarResult\.verified/);
  assert.match(background, /validateDecisionGrounding\(\s*\{\s*\.\.\.decision,\s*action:\s*"CONTINUE"\s*\}/s);
});

test("prompt repetition har egen pausklass och rapporteras inte som Nano-hostfel", () => {
  assert.match(background, /PAUSE_ORIGINS\.PROMPT_REPETITION_GUARD/);
});


test("v0.6.2 stabiliserar och supersederar foreground-observationer före claim decision och submit", () => {
  assert.match(background, /advanceResponseCandidate\(run\.responseCandidate, page/);
  assert.match(background, /nano-claim-freshness/);
  assert.match(background, /nano-decision-freshness/);
  assert.match(background, /sourceObservationHash/);
  assert.match(background, /CANCELLED_SUPERSEDED/);
});

test("Nano använder isolerad task clone och exporterar exakt stale reason", () => {
  assert.match(panel, /state\.modelSession\.clone/);
  assert.match(panel, /modelStaleReason/);
  assert.match(panel, /NANO_HOST_STATE/);
  assert.doesNotMatch(panel, /buildNanoSystemPrompt\(config, continuityProjection\)/);
});


test("foreground-detektering är composer-scopead och terminal EIC-trailer kan slå ut stale stop-knapp", () => {
  assert.match(content, /function detectForegroundSignals/);
  assert.match(content, /PROTOCOL_COMPLETION_OVERRIDE/);
  assert.match(content, /TERMINAL_EIC_TRAILER/);
  assert.match(content, /composerRegion/);
});

test("materiellt beslut och mekanisk operatörsåtgärd har separata väntelägen", () => {
  assert.match(background, /AWAITING_OPERATOR_DECISION/);
  assert.match(background, /AWAITING_OPERATOR_ACTION/);
  assert.match(background, /acceptOperatorDecisionReceipt/);
  assert.match(background, /submitOperatorActionEvidence/);
});
