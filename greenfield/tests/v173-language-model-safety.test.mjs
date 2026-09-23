import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import "../lib/safety-policy.js";
import { buildA2AEnvelope } from "../lib/a2a.mjs";
import { buildNanoPrompt } from "../lib/nano.mjs";
import { buildNanoExecutionPrompt } from "../lib/nano-task.mjs";
import { buildHjalmarPrompt } from "../lib/hjalmar-d2.mjs";
import { GREENFIELD_LANGUAGE_CONTEXT_SCHEMA } from "../lib/language-contract.mjs";

const S = globalThis.GreenfieldSafetyPolicy;
const adapterSource = await readFile(new URL("../lib/model-observation.js", import.meta.url), "utf8");

function adapter() {
  const context = {
    Date, Set, Map,
    GreenfieldSafetyPolicy: S,
    document: { querySelector: () => null, querySelectorAll: () => [] },
    getComputedStyle: () => ({ display: "block", visibility: "visible" })
  };
  vm.runInNewContext(adapterSource, context);
  return context.GreenfieldModelObservation;
}

const process = {
  processId: "process-language-1",
  runId: "run-language-1",
  generation: 1,
  turn: 7,
  goal: "Continue mixed-language Greenfield work safely."
};

test("v1.7.3 Swedish 'Nåla fast' is not English Fast reasoning", () => {
  assert.equal(S.effort("Nåla fast Djupanalys för lokal GPU-server"), -1);
  assert.equal(S.reasoningSignal("Nåla fast Djupanalys för lokal GPU-server"), false);
  assert.equal(S.degradedModelSignal("Nåla fast GPT-5.6 Sol"), false);
  assert.equal(S.degradedModelSignal("GPT-5.6 Fast"), true);
});

test("v1.7.3 diagnostic control set resolves the real Djupgående effort without ambiguity", () => {
  const a = adapter();
  const r = a.resolveEffortLabels([
    "Nåla fast Djupanalys för lokal GPU-server",
    "Öppna konversationsalternativ för Djupanalys för lokal GPU-server",
    "Djupgående, klicka för att ta bort",
    "Djupgående"
  ], S);
  assert.equal(r.ambiguous, false);
  assert.equal(r.label, "Djupgående");
});

test("v1.7.3 model observer no longer has a global substring selector for Swedish Djup", () => {
  assert.doesNotMatch(adapterSource, /button\[aria-label\*=['"]Djup['"] i\]/);
  assert.match(adapterSource, /COMPOSER_SELECTED_CONTROL/);
  assert.match(adapterSource, /adapterVersion:4/);
});

test("v1.7.3 Finnish model notices and reasoning labels are recognized", () => {
  const a = adapter();
  assert.equal(a.parseCurrentModelNotice("Käytät GPT-5.6 Sol -mallia."), "GPT-5.6 Sol");
  assert.equal(a.parseCurrentModelNotice("Käytössäsi on GPT-6 Astra."), "GPT-6 Astra");
  assert.equal(a.parseRecommendedModel("Suositeltu malli: GPT-5.6 Sol"), "GPT-5.6 Sol");
  assert.equal(S.effort("Syvä"), 3);
  assert.equal(S.effort("Syvällinen"), 3);
  assert.equal(S.effort("Laajennettu"), 2);
  assert.equal(S.effort("Nopea"), 0);
  assert.equal(S.reasoningSignal("Ajatteluaika"), true);
  assert.equal(S.reasoningSignal("Päättelytaso"), true);
});

test("v1.7.3 A2A internal control language is English while mixed en/sv/fi evidence is explicit", () => {
  const e = buildA2AEnvelope({ process, objective: "Inspect the current owner evidence." });
  assert.equal(e.languageContext.schema, GREENFIELD_LANGUAGE_CONTEXT_SCHEMA);
  assert.equal(e.languageContext.internalControlLanguage, "en");
  assert.deepEqual(e.languageContext.ambientLanguages, ["en", "sv", "fi"]);
  assert.equal(e.languageContext.mixedLanguageExpected, true);
  assert.equal(e.languageContext.rawEvidenceLanguage, "preserve");
  assert.equal(e.responseContract.language, "en");
  assert.equal(e.responseContract.operatorFacingLanguage, "preserve_operator_language_when_practical");
  assert.match(e.responseContract.note, /English, Swedish and Finnish/);
  assert.match(e.responseContract.note, /structural control identity/i);
});

test("v1.7.3 Nano and Mental Hjalmar receive the mixed-language boundary in English", () => {
  const observer = buildNanoPrompt({
    goal: process.goal,
    turn: 7,
    runtimeSafety: { code: "UI_MODEL_COMPATIBLE", model: "", effort: "Djupgående" }
  });
  assert.match(observer, /internal=en/);
  assert.match(observer, /ambient=en,sv,fi/);
  assert.match(observer, /structural\/local-language context/);

  const task = buildNanoExecutionPrompt('{"schema":"eic.greenfield.nano-task.request.v2","knowledgeBoundary":"PROMPT_ONLY","instruction":"Classify the supplied labels.","context":"Nåla fast; Fast; Syvä","output":"Return a short classification."}');
  assert.match(task, /use English for Nano control\/reasoning output/i);
  assert.match(task, /English, Swedish and Finnish/);
  assert.match(task, /nåla fast/);

  const hjalmar = buildHjalmarPrompt({
    goal: process.goal,
    turn: 7,
    currentObjective: "Review the mixed-language evidence.",
    targetDisposition: "CONTINUE"
  });
  assert.match(hjalmar, /Return English JSON/);
  assert.match(hjalmar, /English, Swedish and Finnish/);
  assert.match(hjalmar, /structural\/local-language context/);
});
