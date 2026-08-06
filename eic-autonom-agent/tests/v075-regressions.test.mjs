import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { APP_VERSION, CONTENT_SCRIPT_VERSION } from "../lib/contracts.mjs";
import { classifyDestructiveness } from "../lib/destructiveness.mjs";
import { auditEventPlacement, stripAuditEventFromText } from "../lib/app-audit-parser.mjs";
import { parseTargetResult } from "../lib/prompt-contract.mjs";
import {
  boundProjectionToChars,
  compactContinuity,
  createContinuity
} from "../lib/continuity.mjs";
import { conversationKeyFromUrl } from "../lib/common.mjs";
import { classifyConversationLocatorChange } from "../lib/runtime-safety.mjs";
import { allocateNanoSectionBudget } from "../lib/nano-input-budget.mjs";
import {
  MJOLNAR_VERDICTS,
  adjudicateMjolnarRequest,
  buildMjolnarRequest,
  createMjolnarLedgerEntry
} from "../lib/mjolnar.mjs";
import { buildAppAuditStartPrompt } from "../lib/app-audit-prompt.mjs";
import { parseContentScriptVersion } from "../lib/release-identity.mjs";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const content = await readFile(new URL("../content.js", import.meta.url), "utf8");
const sidepanel = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
const sidepanelHtml = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
const coreProfiles = await readFile(new URL("../lib/core-profiles.mjs", import.meta.url), "utf8");

const actualTrailer = [
  "EIC_TURN: turn-2",
  "EIC_NEXT: Kor nasta mikrotest",
  "EIC_COMPLETION_EVIDENCE: UNIT_DONE · Den avgränsade audit-enheten är klar.",
  "EIC_NEXT_ACTOR: AGENT",
  "EIC_AUTONOMY: CONTINUE"
].join("\n");

function auditEvent(overrides = {}) {
  return [
    "EIC_APP_AUDIT_EVENT",
    JSON.stringify({
      protocol: "EIC_APP_AUDIT_EVENT/1",
      run_id: "run-2",
      turn_id: "turn-2",
      step_no: 2,
      phase: "MICRO_TEST",
      outcome: "PASS",
      coverage_cell: "cell-2",
      finding_id: null,
      finding_status: null,
      fingerprint: null,
      severity: null,
      major_candidate: false,
      reproduction_recorded: false,
      database_receipt: {
        relative_path: "analysis/eic-app-audit/run-2/findings.sqlite3",
        row_type: "step",
        row_id: "STEP-000002"
      },
      owner_receipt: null,
      next_micro_step: "Kor nasta mikrotest",
      ...overrides
    }, null, 2)
  ].join("\n");
}

test("v0.7.5 never creates, opens or requests a new ChatGPT tab", () => {
  assert.doesNotMatch(background, /chrome\.tabs\.create/);
  assert.doesNotMatch(background, /createAndLinkNewSessionTab/);
  assert.doesNotMatch(background, /\bcreateNewTab\b/);
  assert.doesNotMatch(sidepanel, /\bcreateNewTab\b/);
  assert.match(background, /preparePreparedSessionRunUnlocked/);
  assert.match(background, /Koppla och välj den förberedda ChatGPT-sessionens flik först/);
  assert.match(sidepanelHtml, /skapar aldrig en ny flik eller session/);
});

test("v0.7.5 routes both start commands into the selected prepared session", () => {
  const generic = background.slice(
    background.indexOf("async function startMission"),
    background.indexOf("const UI_COMMAND_HANDLERS")
  );
  const audit = background.slice(
    background.indexOf("async function startAppAudit"),
    background.indexOf("async function authorizeBoundary")
  );
  assert.match(generic, /preparePreparedSessionRunUnlocked/);
  assert.match(audit, /preparePreparedSessionRunUnlocked/);
  assert.doesNotMatch(generic, /chrome\.tabs\.(create|update)/);
  assert.doesNotMatch(audit, /chrome\.tabs\.(create|update)/);
});

test("v0.7.5 does not let Workbench vocabulary downgrade critical effects", () => {
  for (const action of [
    "merge to main package",
    "deploy production package",
    "permission change lock",
    "schema migration workspace",
    "restart service lease"
  ]) {
    const result = classifyDestructiveness({ requestedAction: action });
    assert.ok(result.level > 5, `${action} => ${result.level}`);
    assert.equal(result.hjalmarMentalControlRequired, true);
    assert.equal(result.workbenchCapped, false);
  }
  const explicit = classifyDestructiveness({
    requestedAction: "build package",
    destructivenessLevel: 9
  });
  assert.equal(explicit.level, 9);
  assert.equal(explicit.hjalmarMentalControlRequired, true);
});

test("v0.7.5 audit placement ignores quoted historical trailers", () => {
  const quoted = [
    "```text",
    "EIC_TURN: turn-old",
    "EIC_NEXT: old",
    "EIC_COMPLETION_EVIDENCE: UNIT_DONE · Den avgränsade audit-enheten är klar.",
    "EIC_NEXT_ACTOR: AGENT",
    "EIC_AUTONOMY: CONTINUE",
    "```"
  ].join("\n");
  const response = [quoted, auditEvent(), actualTrailer].join("\n\n");
  assert.equal(parseTargetResult(response, "turn-2").valid, true);
  assert.equal(auditEventPlacement(response), "BEFORE_TRAILER");
});

test("v0.7.5 content trailer detection strips code and quotes before scanning", () => {
  assert.match(content, /function stripProtocolNoise/);
  assert.match(content, /const lines = stripProtocolNoise\(value\)/);
});

test("v0.7.5 compaction removes closed blockers before saturating", () => {
  const continuity = createContinuity();
  continuity.position.turnIndex = 100;
  continuity.blockers = Array.from({ length: 16 }, (_, index) => ({
    id: `blocker-${index}`,
    turn: index,
    at: new Date(1_700_000_000_000 + index).toISOString(),
    statement: "x".repeat(1600),
    kind: "TEST",
    unlockedBy: "y".repeat(1000),
    open: false,
    assertedTurn: index,
    lastAssertedTurn: index,
    closedReason: "silent"
  }));
  const compacted = compactContinuity(continuity);
  assert.ok(Buffer.byteLength(JSON.stringify(compacted), "utf8") <= 32_000);
  assert.ok(compacted.blockers.length < 16);
});

test("v0.7.5 root query parameters are not conversation identity", () => {
  for (const url of [
    "https://chatgpt.com/",
    "https://chatgpt.com/?model=gpt-5",
    "https://chatgpt.com/?temporary-chat=true"
  ]) {
    const key = conversationKeyFromUrl(url);
    assert.equal(key, "chatgpt.com:/");
    assert.equal(
      classifyConversationLocatorChange(key, "chatgpt.com:c:conversation-1").kind,
      "PROMOTION"
    );
  }
});

test("v0.7.5 submit preflight includes the latest message role", () => {
  assert.match(content, /detectForegroundSignals\(latestAssistant, getLatestConversationMessage\(\)\.role\)/);
});

test("v0.7.5 section allocation is additive for every small budget", () => {
  for (let variable = 0; variable <= 3_000; variable += 1) {
    const budget = allocateNanoSectionBudget(variable);
    const sum = budget.projectionChars +
      budget.responseChars +
      budget.mandateChars +
      budget.conversationChars;
    assert.ok(sum <= budget.variableChars, `${variable}: ${sum} > ${budget.variableChars}`);
  }
});

test("v0.7.5 strips audit events before response projection", () => {
  const projection = background.indexOf("stripAuditEventFromText(page.latestAssistant)");
  const compact = background.indexOf("compactContextText(auditProjection.text");
  assert.ok(projection >= 0 && compact > projection);
  assert.doesNotMatch(background, /stripAuditEventFromText\(run\.pendingObservation\.responseText\)/);
});

test("v0.7.5 removes malformed audit protocol regions from Nano input", () => {
  const source = [
    "Narrative before.",
    "EIC_APP_AUDIT_EVENT",
    "{ broken json",
    actualTrailer
  ].join("\n");
  const stripped = stripAuditEventFromText(source);
  assert.equal(stripped.malformed, true);
  assert.ok(stripped.removedChars > 0);
  assert.match(stripped.text, /Narrative before/);
  assert.match(stripped.text, /EIC_TURN: turn-2/);
  assert.doesNotMatch(stripped.text, /broken json/);
});

async function mjolnarRequest() {
  return buildMjolnarRequest({
    sourceClass: "LOCAL_STATE_MACHINE",
    triggerType: "OPERATOR_PROXY_REQUIRED",
    actionCode: "REFRESH_TAB_STATUS",
    exactTarget: "tab:2|conversation:abc",
    proposedAction: "Läs aktuell tabstatus.",
    expectedEffect: "Färsk snapshot.",
    ownerSurface: "CHROME_TABS",
    ownerEvidenceLocator: "tab:2",
    reversibility: "YES",
    rollbackPath: "NOT_REQUIRED_READ_ONLY",
    humanAuthorityClass: "NOT_REQUIRED",
    materialAmbiguity: "NONE"
  }, {
    sessionId: "run-1",
    conversationLocator: "chatgpt.com:c:abc",
    stableGoal: "Fortsätt uppgiften",
    activeWorkUnit: "Verifiera status",
    verifiedState: ["Tab 2 är explicit kopplad."],
    governingAuthority: "USER_CONFIG_AND_EIC_STATE_MACHINE",
    hjalmarVerdict: "GO",
    hjalmarEvidenceLimit: "Local tab state only",
    hjalmarProvenance: "UNTRUSTED_OR_ABSENT",
    snapshotHash: "snap-1"
  });
}

test("v0.7.5 duplicate gate includes delegated pending dispatch", async () => {
  const request = await mjolnarRequest();
  const response = adjudicateMjolnarRequest(request);
  assert.equal(response.verdict, MJOLNAR_VERDICTS.DELEGABLE);
  const entry = createMjolnarLedgerEntry(request, response);
  assert.equal(entry.status, "DELEGATED_PENDING_DISPATCH");
  const duplicate = adjudicateMjolnarRequest(request, { priorLedger: [entry] });
  assert.equal(duplicate.reason, "DUPLICATE_OR_UNKNOWN_PRIOR_EFFECT");
});

test("v0.7.5 semantic compaction restores chronological order after dedupe", () => {
  const continuity = createContinuity();
  continuity.position.turnIndex = 10;
  continuity.attempts = [
    { id: "a1", turn: 1, at: "2026-01-01T00:00:01Z", action: "same", outcome: "old", reason: "" },
    { id: "b", turn: 2, at: "2026-01-01T00:00:02Z", action: "b", outcome: "x", reason: "" },
    { id: "c", turn: 3, at: "2026-01-01T00:00:03Z", action: "c", outcome: "x", reason: "" },
    { id: "d", turn: 4, at: "2026-01-01T00:00:04Z", action: "d", outcome: "x", reason: "" },
    { id: "a2", turn: 10, at: "2026-01-01T00:00:10Z", action: "same", outcome: "new", reason: "" }
  ];
  const compacted = compactContinuity(continuity);
  assert.deepEqual(compacted.attempts.map((item) => item.turn), [2, 3, 4, 10]);
  assert.equal(compacted.attempts.at(-1).outcome, "new");
});

test("v0.7.5 prompt does not prefill a verified readback state", () => {
  const prompt = buildAppAuditStartPrompt({
    testNeed: "test",
    auditRunId: "run",
    auditTurnId: "turn"
  });
  assert.doesNotMatch(prompt, /"result_state": "READBACK_VERIFIED"/);
  assert.match(prompt, /annars REQUEST_SENT eller WRITE_ATTEMPTED/);
});

test("v0.7.5 removes the identical-branch auth ternary", () => {
  assert.doesNotMatch(background, /authBoundary \? STATES\.HARD_BLOCKED : STATES\.HARD_BLOCKED/);
});

test("v0.7.5 projection emergency pass may trim optional lists below the soft floor", () => {
  const projection = {
    intent: "x",
    position: { phase: "p" },
    verifiedFacts: Array.from({ length: 4 }, (_, i) => ({ claim: "f".repeat(200), i })),
    constraints: Array.from({ length: 4 }, (_, i) => ({ text: "c".repeat(200), i })),
    targetClaims: Array.from({ length: 4 }, (_, i) => ({ claim: "t".repeat(200), i })),
    inferences: Array.from({ length: 4 }, (_, i) => ({ claim: "i".repeat(200), i })),
    blockers: [],
    recentAttempts: Array.from({ length: 4 }, (_, i) => ({ action: "a".repeat(200), i })),
    nextDirections: Array.from({ length: 4 }, (_, i) => ({ text: "n".repeat(200), i })),
    antiLoop: {}
  };
  const bounded = boundProjectionToChars(projection, 250, { minItems: 2 });
  assert.equal(bounded.withinBudget, true);
  assert.ok([
    bounded.projection.verifiedFacts,
    bounded.projection.constraints,
    bounded.projection.targetClaims,
    bounded.projection.inferences,
    bounded.projection.recentAttempts,
    bounded.projection.nextDirections
  ].some((items) => items.length < 2));
});

test("v0.9.8 reports the same version across all bridge and UI runtime surfaces", () => {
  // v0.10.12: "the same version" is now actually asserted. The previous form
  // matched a hard-coded 0.10.10 literal in content.js and passed happily while
  // the contract said 0.10.11 — the exact skew that blocked every mission start.
  assert.equal(APP_VERSION, "0.10.12");
  assert.equal(CONTENT_SCRIPT_VERSION, "0.10.12");
  assert.equal(parseContentScriptVersion(content), APP_VERSION);
  assert.equal(parseContentScriptVersion(content), CONTENT_SCRIPT_VERSION);
  assert.match(sidepanelHtml, /id="appVersion">v—<\/small>/);
  assert.match(sidepanel, /eic-autonom-agent-v\$\{APP_VERSION\}-export-/);
});

test("v0.9.8 removes compatibility profiles entirely", () => {
  assert.match(coreProfiles, /id: "VERIFIED_ANALYSIS"/);
  assert.doesNotMatch(coreProfiles, /LEGACY_|V078|backward-compatible/i);
});
