// v1.8.4 real-browser check of the side panel's HTML pattern attributes in
// Chromium via Playwright. Chrome compiles a pattern attribute in unicodeSets
// (v) mode; an invalid one is ignored and logged as an extension error
// (operator report: "Pattern attribute value GPT[- ]... is not a valid regular
// expression"). Not part of `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-sidepanel-patterns.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Markup only: the panel scripts need extension APIs and are not under test.
const markup = fs.readFileSync(path.join(root, "sidepanel.html"), "utf8")
  .replace(/<script\b[\s\S]*?<\/script>/g, "")
  .replace(/<link\b[^>]*>/g, "");

const browser = await chromium.launch();
let result;
try {
  const page = await browser.newPage();
  const consoleMessages = [];
  page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text().slice(0, 240)}`));
  page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message.slice(0, 240)}`));
  await page.setContent(markup);
  result = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input[pattern]")];
    const model = document.getElementById("requiredModel");
    const accepts = {};
    for (const value of ["GPT-5.6", "GPT 5.6 Thinking", "gpt-5.6", "GPT-5.6 a b c d", "foo", "GPT-x"]) {
      model.value = value;
      accepts[value] = !model.validity.patternMismatch;
    }
    model.value = "foo";
    const formValidWithFoo = document.getElementById("safetyPolicyForm").checkValidity();
    for (const input of inputs) input.checkValidity();
    return { patterns: inputs.map((input) => ({ id: input.id, pattern: input.getAttribute("pattern") })), accepts, formValidWithFoo };
  });
  result.consoleMessages = consoleMessages;
} finally {
  await browser.close();
}

const checks = [
  ["no console error from any pattern attribute", !result.consoleMessages.some((line) => /pattern attribute/i.test(line))],
  ["requiredModel accepts GPT-5.6, 'GPT 5.6 Thinking' and gpt-5.6", result.accepts["GPT-5.6"] && result.accepts["GPT 5.6 Thinking"] && result.accepts["gpt-5.6"]],
  ["requiredModel rejects foo, GPT-x and four suffix words (pattern is enforced)", !result.accepts.foo && !result.accepts["GPT-x"] && !result.accepts["GPT-5.6 a b c d"]],
  ["safety policy form is invalid with requiredModel=foo", result.formValidWithFoo === false]
];
const report = { tool: "verify-sidepanel-patterns", checks: checks.map(([name, pass]) => ({ name, pass: Boolean(pass) })), result };
console.log(JSON.stringify(report, null, 2));
process.exitCode = checks.every(([, pass]) => pass) ? 0 : 1;
