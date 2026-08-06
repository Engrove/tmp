import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CLASSIFIER_VERSION,
  classifyDestructiveness,
  hasProposedEffect
} from "../lib/destructiveness.mjs";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const sidepanel = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
const panelHtml = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");

/**
 * Field incident 2026-08-03, Chrome window 1974094166, run
 * run-b175d216-8fba-4fa8-8b82-2a367fb39b90. Reconstructed from the operator export
 * `eic-autonom-agent-v0_7_0-export-1785728878892.json`.
 *
 * Gemini Nano echoed the injected target mandate into `reason` and
 * `destructivenessRationale`. The decision's action was the literal string "None" and
 * Mjölnar itself returned level 6 with verdict DELEGABLE, but v0.7.0 classified level 10
 * because the echoed mandate contains the words "CAPTCHA" and "hemligheter".
 */
const ECHOED_TARGET_MANDATE = [
  "MÅLSESSIONENS KÄRNMANDAT v2",
  "Fortsätt det användarstartade uppdraget genom nästa konkreta, säkra och evidensbärande åtgärd.",
  "Använd EIC_DESTRUCTIVENESS/1. Nivå 1–5 fortsätter autonomt; Workbench-hantering är högst nivå 5.",
  "Endast nivå 10 — login/CAPTCHA/användarnärvaro, credentials/hemligheter, verkligt irreversibel/okänd",
  "destruktion eller materiellt säkerhets-/policyundantag — kräver verklig PAUS."
].join("\n");

const FIELD_DECISION = Object.freeze({
  action: "DONE",
  requestedAction: "None",
  reason: ECHOED_TARGET_MANDATE,
  destructivenessRationale: ECHOED_TARGET_MANDATE,
  boundaryEvidence: ECHOED_TARGET_MANDATE,
  pauseOrigin: "TARGET_REQUESTED_PAUSE",
  exactTarget: ""
});

// ---------------------------------------------------------------------------
// The false level-10
// ---------------------------------------------------------------------------

test("v0.7.1 does not classify an echoed target mandate as a level-10 effect", () => {
  const result = classifyDestructiveness(FIELD_DECISION);
  assert.equal(
    result.level,
    1,
    `v0.7.0 field classification reproduced: level ${result.level} (${result.reasonCode})`
  );
  assert.equal(result.reasonCode, "NO_PROPOSED_EFFECT");
  assert.equal(result.humanDecisionRequired, false);
  assert.equal(result.hjalmarMentalControlRequired, false);
});

test("v0.7.1 ignores justification prose even when a real action is present", () => {
  const result = classifyDestructiveness({
    requestedAction: "Läs owner-state för paketet och rapportera revisionen",
    reason: ECHOED_TARGET_MANDATE,
    boundaryEvidence: ECHOED_TARGET_MANDATE
  });
  assert.equal(result.level, 1);
  assert.equal(result.reasonCode, "LEVEL_1_READ_ONLY");
});

test("v0.7.1 still escalates a genuine level-10 effect", () => {
  for (const requestedAction of [
    "Logga in på admin-panelen med credentials",
    "Lös CAPTCHA för att fortsätta",
    "Radera permanent hela produktionsdatabasen"
  ]) {
    const result = classifyDestructiveness({ requestedAction });
    assert.equal(result.level, 10, `missad nivå 10 för: ${requestedAction}`);
    assert.equal(result.humanDecisionRequired, true);
  }
});

test("v0.7.1 still escalates a genuine level-9 effect", () => {
  const result = classifyDestructiveness({ requestedAction: "Utför merge till main och skapa release" });
  assert.equal(result.level, 9);
  assert.equal(result.hjalmarMentalControlRequired, true);
});

test("v0.7.1 escalates on target-declared next actions", () => {
  // `targetNext` is untrusted, but escalating on it is the safe direction.
  const result = classifyDestructiveness({ targetNext: "Rotate the production access token" });
  assert.equal(result.level, 10);
});

test("v0.7.1 recognises actionless decisions in both languages", () => {
  for (const value of ["None", "none", "null", "N/A", "-", "Ingen", " "]) {
    assert.equal(hasProposedEffect({ requestedAction: value }), false, `borde vara actionless: ${value}`);
  }
  assert.equal(hasProposedEffect({ requestedAction: "Bygg paketet" }), true);
});

test("v0.7.1 does not let a model-supplied level escalate an actionless decision", () => {
  const result = classifyDestructiveness({ requestedAction: "None", destructivenessLevel: 10 });
  assert.equal(result.level, 1);
  assert.equal(result.humanDecisionRequired, false);
});

test("v0.7.1 persists the classification input and classifier version", () => {
  const result = classifyDestructiveness({
    requestedAction: "Utför merge till main",
    exactTarget: "repo:eic|branch:main",
    reason: ECHOED_TARGET_MANDATE
  });
  assert.equal(result.classifierVersion, CLASSIFIER_VERSION);
  assert.equal(result.classificationInput.requestedAction, "Utför merge till main");
  assert.equal(result.classificationInput.exactTarget, "repo:eic|branch:main");
  // The echoed mandate must not be retained anywhere in the persisted input or rationale.
  assert.equal(JSON.stringify(result.classificationInput).includes("KÄRNMANDAT"), false);
  assert.equal(result.rationale.includes("KÄRNMANDAT"), false);
});

// ---------------------------------------------------------------------------
// The local operator authorization surface
// ---------------------------------------------------------------------------

test("v0.7.1 provides a local authorization surface for a level-10 boundary", () => {
  assert.match(background, /async function authorizeBoundary\(windowId, message = \{\}\)/);
  assert.match(background, /UI_COMMANDS\.AUTHORIZE_BOUNDARY/);
  assert.match(background, /function boundaryKey\(run\)/);
  assert.match(background, /function boundaryAuthorized\(run\)/);
  assert.match(background, /if \(boundaryAuthorized\(run\)\) return false;/);
});

test("v0.10.0 binds a decision receipt to one exact decision, mission, run and boundary", () => {
  const block = background.slice(
    background.indexOf("async function authorizeBoundary"),
    background.indexOf("chrome.runtime.onMessage.addListener")
  );
  for (const field of ["decisionId", "missionId", "runId", "boundaryKey", "acknowledgement"]) {
    assert.match(block, new RegExp(field));
  }
  assert.match(block, /acceptOperatorDecisionReceipt/);
});

test("v0.10.0 delegates normalized 12-character validation to the level-10 owner module", () => {
  assert.match(background, /acceptOperatorDecisionReceipt/);
  assert.match(background, /OPERATOR_DECISION_RECEIPT_ACCEPTED/);
  assert.match(background, /authorizedBy: "LOCAL_OPERATOR_PANEL"/);
});

test("v0.10.0 records the accepted decision receipt in durable continuity before resume", () => {
  assert.match(background, /run\.boundaryAuthorization = \{/);
  assert.match(background, /receipt: deepClone\(accepted\.decision\.receipt\)/);
  assert.match(background, /continuity\.decisions = \[/);
  assert.match(background, /målstate verifieras före Nano-resume/);
});

test("v0.10.0 exposes owner-created decision identity to the panel", () => {
  assert.match(sidepanel, /const decision = run\?\.operatorDecision \|\| null/);
  assert.match(sidepanel, /command\("AUTHORIZE_BOUNDARY", \{/);
  for (const field of ["decisionId", "missionId", "runId", "boundaryKey", "acknowledgement"]) {
    assert.match(sidepanel, new RegExp(field));
  }
  assert.match(panelHtml, /id="authorizeBoundaryButton"/);
});

test("v0.7.1 keeps authorization off the target surface entirely", () => {
  // The authorization command reads only local run state and the panel's own input. It
  // must never consult the observation, the target response or any Nano decision field.
  const block = background.slice(
    background.indexOf("async function authorizeBoundary"),
    background.indexOf("chrome.runtime.onMessage.addListener")
  );
  for (const forbidden of ["pendingObservation", "responseText", "conversationExcerpt", "targetClaims"]) {
    assert.equal(block.includes(forbidden), false, `auktorisering läser måltext: ${forbidden}`);
  }
});

test("v0.7.1 lets an authorized hard block resume", () => {
  assert.match(background, /!boundaryAuthorized\(run\) &&/);
  assert.match(sidepanel, /!paused && !\(hard && !run\?\.boundaryRequiresOperator\)/);
});

// ---------------------------------------------------------------------------
// The v0.7.0 output ceiling regression
// ---------------------------------------------------------------------------

test("v0.7.1 gives the output ceiling headroom over observed legitimate decisions", () => {
  const ceiling = Number(/const NANO_MAX_OUTPUT_CHARS = ([\d_]+);/.exec(sidepanel)[1].replace(/_/g, ""));
  // Observed legitimate outputs in the field: 1475, 2062, 2398, 2447, 2942, 3605, 5969,
  // 5999. One at 6003 was aborted by the v0.7.0 ceiling of 6000.
  assert.ok(ceiling >= 12_000, `taket ${ceiling} har för liten marginal`);
  // Still well under the bounded schema's worst case of roughly 36 000 characters.
  assert.ok(ceiling <= 20_000, `taket ${ceiling} är för högt för att fånga runaway`);
});

test("v0.7.1 salvages a complete decision before declaring an overrun", () => {
  assert.match(sidepanel, /const salvaged = extractFirstJsonObject\(output\);/);
  assert.match(sidepanel, /if \(!salvaged\) throw new NanoOutputOverrunError\(overrun\);/);
  assert.match(sidepanel, /overrunRecovered = overrun;/);
});
