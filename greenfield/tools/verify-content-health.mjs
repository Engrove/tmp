// v1.8.3 real-DOM verification of content.js page health and the ChatGPT
// content-block (Daybreak) detector, in Chromium via Playwright.
// Not part of `npm test` (no browser dependency there). Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-content-health.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
const URL = "https://chatgpt.com/g/g-69e0b4be-eic/c/6ab5fa1b-cf04-83eb-bfa1-7e3230efac0f";

const turn = (role, id, text) => `
  <article data-testid="conversation-turn-${id}" data-turn-id="${id}">
    <div data-message-author-role="${role}" data-message-id="${id}"><div class="markdown">${text}</div></div>
  </article>`;
const composer = `<form><div id="prompt-textarea" contenteditable="true" role="textbox" style="min-height:20px;min-width:200px">&nbsp;</div></form>`;
const noticeEn = `<div class="notice"><div><strong>This content can’t be shown</strong></div>
  <p>We take extra care with some cybersecurity requests. If you’re doing authorized security work, <a href="#">apply for Daybreak</a> to get broader access.</p>
  <button>Learn more</button><button aria-label="Close">×</button></div>`;
const noticeSv = `<div class="notice"><div><strong>Det här innehållet kan inte visas</strong></div>
  <p>Vi är särskilt försiktiga med förfrågningar som rör cybersäkerhet. Om du är säkerhetsexpert kan du vara berättigad att använda <a href="#">Daybreak</a>.</p></div>`;
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>EIC</title></head><body><main style="display:block;width:800px">${body}</main></body></html>`;

const FIXTURES = {
  daybreakEnglish: page(turn("user", "u1", "Run the next package.") + turn("assistant", "a1", "The current experimental state does not compile.") + noticeEn + composer),
  daybreakSwedish: page(turn("user", "u1", "Kör nästa paket.") + noticeSv + composer),
  assistantMentionsDaybreak: page(turn("user", "u1", "Explain.") + turn("assistant", "a1", "This content can’t be shown is a cybersecurity notice; apply for Daybreak.") + composer),
  operatorBubbleMentionsDaybreak: page(turn("user", "u1", "Informera EIC om \"Det här innehållet kan inte visas ... cybersäkerhet ... Daybreak\".") + composer),
  composerMissing: page(turn("user", "u1", "Run.") + turn("assistant", "a1", "Done.")),
  healthy: page(turn("user", "u1", "Run.") + turn("assistant", "a1", "Done.") + composer)
};

async function pageState(browser, html, { stopFrames = false, advanceMs = 0 } = {}) {
  const context = await browser.newContext();
  const tab = await context.newPage();
  await tab.route("https://chatgpt.com/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
  if (advanceMs) await tab.clock.install();
  await tab.addInitScript(({ stopFrames }) => {
    const listeners = [];
    globalThis.chrome = { runtime: { id: "test", onMessage: { addListener: (fn) => listeners.push(fn), removeListener() {} }, sendMessage: async () => ({ ok: true }) } };
    globalThis.__gfListeners = listeners;
    if (stopFrames) globalThis.requestAnimationFrame = () => 0;
  }, { stopFrames });
  await tab.goto(URL);
  await tab.addScriptTag({ content: contentSource });
  if (advanceMs) await tab.clock.runFor(advanceMs);
  const state = await tab.evaluate(() => new Promise((resolve) => {
    const listener = globalThis.__gfListeners.at(-1);
    const keep = listener({ type: "EIC_GF_GET_PAGE_STATE", expectedUserTurnId: "", expectedUserIndex: null }, {}, (response) => resolve(response));
    if (keep !== true && keep !== undefined && typeof keep?.then !== "function") resolve({ ok: false, error: "NO_ASYNC_RESPONSE" });
  }));
  await context.close();
  return state;
}

const browser = await chromium.launch();
const results = {};
try {
  for (const [name, html] of Object.entries(FIXTURES)) {
    const state = await pageState(browser, html);
    results[name] = { ok: state?.ok === true, pageHealth: state?.state?.pageHealth || null };
  }
  const stalled = await pageState(browser, FIXTURES.healthy, { stopFrames: true, advanceMs: 70_000 });
  results.renderStalled = { ok: stalled?.ok === true, pageHealth: stalled?.state?.pageHealth || null };
  const painting = await pageState(browser, FIXTURES.healthy, { advanceMs: 70_000 });
  results.renderPainting = { ok: painting?.ok === true, pageHealth: painting?.state?.pageHealth || null };
} finally {
  await browser.close();
}

const n = (name) => results[name]?.pageHealth?.providerNotice || null;
const checks = [
  ["english notice detected", n("daybreakEnglish")?.kind === "CONTENT_BLOCKED_DAYBREAK" && n("daybreakEnglish").headlineMatched && n("daybreakEnglish").cyberWordMatched],
  ["english notice follows the last user turn", n("daybreakEnglish")?.afterExpectedUserTurn === true],
  ["swedish notice detected", n("daybreakSwedish")?.headlineMatched === true && n("daybreakSwedish")?.cyberWordMatched === true],
  ["assistant text mentioning Daybreak is not a notice", n("assistantMentionsDaybreak") === null],
  ["operator bubble mentioning Daybreak is not a notice", n("operatorBubbleMentionsDaybreak") === null],
  ["healthy page: no notice, composer present, thread present", n("healthy") === null && results.healthy.pageHealth?.composerPresent === true && results.healthy.pageHealth?.turnCount === 2 && results.healthy.pageHealth?.conversationUrl === true],
  ["missing composer is reported", results.composerMissing.pageHealth?.composerPresent === false],
  ["no frames for 70 s while visible -> frameGapMs >= 45000", Number(results.renderStalled.pageHealth?.frameGapMs) >= 45000 && results.renderStalled.pageHealth?.visibilityState === "visible"],
  ["painting page -> frameGapMs < 45000", Number(results.renderPainting.pageHealth?.frameGapMs) < 45000]
];
const report = { tool: "verify-content-health", url: URL, checks: checks.map(([name, pass]) => ({ name, pass: Boolean(pass) })), results };
console.log(JSON.stringify(report, null, 2));
process.exitCode = checks.every(([, pass]) => pass) ? 0 : 1;
