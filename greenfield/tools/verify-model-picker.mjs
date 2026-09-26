// v1.8.6 real-DOM check of the model evidence adapter against ChatGPT's newer
// composer, where the thinking level is the model picker's text ("Extra hög",
// "Direkt" - diagnostics 2026-09-26) instead of the former "Djupgående" chip.
// Loads lib/safety-policy.js + lib/model-observation.js in Chromium and runs
// observe() + evaluateModel(). Not part of `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-model-picker.mjs [out.json]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = ["lib/safety-policy.js", "lib/model-observation.js"].map((file) => fs.readFileSync(path.join(root, file), "utf8"));
const PAGE_URL = "https://chatgpt.com/g/g-69e0b4be-eic/c/6ab6838a-9248-83eb-9231-6264f3d1d566";
const GPT_ROOT = "https://chatgpt.com/g/g-69e0b4be-eic";

const picker = (text) => `<button type="button" aria-label="Välj ChatGPT-modell" aria-haspopup="menu" data-state="closed">${text}<svg width="12" height="12"></svg></button>`;
const chip = `<button type="button" aria-label="Djupgående, klicka för att ta bort">Djupgående</button>`;
const composer = (inside) => `<form data-type="unified-composer"><div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox" style="min-height:20px;min-width:200px"><p></p></div>
  <button type="button" aria-label="Lägg till filer">+</button>${inside}<button type="button" aria-label="Diktera">mic</button>
  <button type="submit" id="composer-submit-button" data-testid="send-button" aria-label="Skicka prompt" disabled>↑</button></form>`;
const page = ({ header = "", inside = "" } = {}) => `<!doctype html><html lang="sv-SE"><head><meta charset="utf-8"><title>EIC</title></head><body>
  <header style="display:block;height:40px"><span>EIC</span>${header}</header>
  <main style="display:block;width:900px"><section data-testid="conversation-turn-1" data-turn="user"><div data-message-author-role="user" data-message-id="u1">Hög prioritet: Extra hög kvalitet</div></section>${composer(inside)}</main>
</body></html>`;

const FIXTURES = {
  pickerExtraHogInComposer: { html: page({ inside: picker("Extra hög") }), expect: { allowed: true, code: "UI_MODEL_COMPATIBLE", source: "COMPOSER_SELECTED_CONTROL" } },
  pickerHogInComposer: { html: page({ inside: picker("Hög") }), expect: { allowed: true, code: "UI_MODEL_COMPATIBLE", source: "COMPOSER_SELECTED_CONTROL" } },
  pickerDirektInComposer: { html: page({ inside: picker("Direkt") }), expect: { allowed: false, code: "THINKING_MODE_UNVERIFIED", source: "NONE" } },
  pickerExtraHogInHeader: { html: page({ header: picker("Extra hög") }), expect: { allowed: true, code: "UI_MODEL_COMPATIBLE", source: "MODEL_SWITCHER_SELECTED_EFFORT" } },
  pickerDirektInHeader: { html: page({ header: picker("Direkt") }), expect: { allowed: false, code: "THINKING_MODE_UNVERIFIED", source: "NONE" } },
  formerChipDjupgaende: { html: page({ inside: chip }), expect: { allowed: true, code: "UI_MODEL_COMPATIBLE", source: "COMPOSER_SELECTED_CONTROL" } },
  formerChipPlusPickerSameRank: { html: page({ inside: chip + picker("Extra hög") }), expect: { allowed: true, code: "UI_MODEL_COMPATIBLE", source: "COMPOSER_SELECTED_CONTROL" } },
  noControls: { html: page(), expect: { allowed: false, code: "THINKING_MODE_UNVERIFIED", source: "NONE" } }
};

const browser = await chromium.launch();
const rows = {};
for (const [name, fixture] of Object.entries(FIXTURES)) {
  const context = await browser.newContext();
  const tab = await context.newPage();
  await tab.route("https://chatgpt.com/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture.html }));
  await tab.goto(PAGE_URL);
  for (const content of scripts) await tab.addScriptTag({ content });
  const result = await tab.evaluate(({ url, gptRoot }) => {
    const evidence = globalThis.GreenfieldModelObservation.observe();
    const S = globalThis.GreenfieldSafetyPolicy;
    return { evidence, proof: S.evaluateModel(evidence, S.defaults, { url, gptRoot }), heavyFloor: S.evaluateModel(evidence, { ...S.defaults, minimumEffort: "heavy" }, { url, gptRoot }) };
  }, { url: PAGE_URL, gptRoot: GPT_ROOT });
  await context.close();
  rows[name] = {
    expect: fixture.expect,
    allowed: result.proof.allowed,
    code: result.proof.code,
    source: result.evidence.effortEvidenceSource,
    effortLabel: result.evidence.effortLabel,
    modelLabel: result.evidence.modelLabel,
    adapterVersion: result.evidence.adapterVersion,
    heavyFloorAllowed: result.heavyFloor.allowed,
    heavyFloorCode: result.heavyFloor.code
  };
}
await browser.close();

const checks = Object.entries(rows).map(([name, row]) => [
  `${name}: ${row.expect.allowed ? "allowed" : row.expect.code} via ${row.expect.source}`,
  row.allowed === row.expect.allowed && row.code === row.expect.code && row.source === row.expect.source
]);
checks.push(["Heavy floor: Extra hög allowed, Hög refused (THINKING_EFFORT_TOO_LOW)",
  rows.pickerExtraHogInComposer.heavyFloorAllowed === true && rows.pickerHogInComposer.heavyFloorCode === "THINKING_EFFORT_TOO_LOW"]);
checks.push(["user message text 'Hög … Extra hög' never counts as a control", rows.noControls.effortLabel === ""]);
const out = { tool: "tools/verify-model-picker.mjs", rows, checks: checks.map(([name, pass]) => ({ name, pass })), passed: checks.filter(([, pass]) => pass).length, total: checks.length };
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify(out, null, 2)}\n`);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
console.log(`checks ${out.passed}/${out.total}`);
process.exitCode = out.passed === out.total ? 0 : 1;
