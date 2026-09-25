// v1.8.5 real-DOM verification: ChatGPT's slow-request notice ("Våra system
// bearbetar den här förfrågan lite till innan de svarar …") never breaks the
// session and never becomes assistant text. Synthetic markup with the element
// structure of the operator's 2026-09-25 page (turn without a role node, notice
// inside div[data-streaming-response-status], stop button "Sluta svara").
// Runs the manifest content scripts in Chromium via Playwright; not part of
// `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-processing-notice.mjs [out.json]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = ["lib/safety-policy.js", "lib/model-observation.js", "content.js"]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"));
const PAGE_URL = "https://chatgpt.com/g/g-69e0b4be-eic/c/6ab60d1b-518c-83eb-81a4-d0daaa753a54";
const USER_ID = "b2e3e940-0000-4000-8000-000000000001";

const NOTICE = `<div class="text-token-text-tertiary"><span class="loading-shimmer-tertiary"><span class="block">Våra system bearbetar den här förfrågan lite till innan de svarar. Du kan <button type="button">försöka igen med en snabbare modell</button> för att få ett snabbare svar, men den kan vara sämre på att hantera komplexa förfrågningar. <a href="#" target="_blank" rel="noopener noreferrer">Läs mer</a></span></span></div>`;
const userTurn = (text = "MISSION_START placeholder") => `
  <section data-testid="conversation-turn-1" data-turn="user" data-turn-id="${USER_ID}">
    <h4 class="sr-only">Du sade:</h4>
    <div data-message-author-role="user" data-message-id="${USER_ID}"><div class="whitespace-pre-wrap">${text}</div></div>
  </section>`;
const assistantTurn = (inner) => `
  <section data-testid="conversation-turn-2" data-turn="assistant" data-turn-id="request-WEB:00000000-0000-4000-8000-000000000002-0">
    <h4 class="sr-only">EIC sade:</h4>
    <div class="agent-turn"><div data-streaming-response-status="">${inner}</div><p></p></div>
  </section>`;
const composer = (stop) => `
  <form data-type="unified-composer">
    <div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox" style="min-height:20px;min-width:200px"><p></p></div>
    <button type="button" aria-label="Djupgående, klicka för att ta bort">Djupgående</button>
    ${stop
      ? `<button type="submit" id="composer-submit-button" aria-label="Sluta svara" data-testid="stop-button">■</button>`
      : `<button type="submit" id="composer-submit-button" aria-label="Skicka prompt" data-testid="send-button" disabled>↑</button>`}
  </form>`;
const page = (thread, stop) => `<!doctype html><html lang="sv-SE"><head><meta charset="utf-8"><title>EIC</title></head><body>
  <main style="display:block;width:900px"><div data-scroll-root="" ${stop ? 'data-stream-active=""' : ""}>${thread}</div>${composer(stop)}</main>
  <dialog></dialog>
  <div id="aria-notify-live-region-assertive" role="alert"><span></span></div>
  <div id="aria-notify-live-region-polite" role="status"><span></span></div>
  <div id="eic-gf-linked-overlay" data-eic-gf-ui="true">EIC Greenfield · CONNECTED · WAITING · GF-006</div>
</body></html>`;
const roleNode = (inner) => `<div data-message-author-role="assistant" data-message-id="a-2">${inner}</div>`;
const ANSWER = `<p>{"ok":true,"answer":"EIC svar"}</p>`;

const FIXTURES = {
  A_noticeStopVisible: page(userTurn() + assistantTurn(NOTICE), true),
  B_noticeNoStopButton: page(userTurn() + assistantTurn(NOTICE), false),
  E_baselineNoNotice: page(userTurn() + assistantTurn(""), true),
  F_noticeInsideRoleNodeNoSignal: page(userTurn() + assistantTurn(roleNode(NOTICE)), false),
  G_noticeAndAnswerInsideRoleNode: page(userTurn() + assistantTurn(roleNode(ANSWER + NOTICE)), false),
  H_userMessageQuotesNotice: page(userTurn("Våra system bearbetar den här förfrågan lite till innan de svarar.") + assistantTurn(roleNode(ANSWER)), false)
};

async function pageState(browser, html) {
  const context = await browser.newContext();
  const tab = await context.newPage();
  await tab.route("https://chatgpt.com/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
  await tab.addInitScript(() => {
    const listeners = [];
    globalThis.chrome = { runtime: { id: "test", onMessage: { addListener: (fn) => listeners.push(fn), removeListener() {} }, sendMessage: async () => ({ ok: true }) } };
    globalThis.__gfListeners = listeners;
  });
  await tab.goto(PAGE_URL);
  for (const content of scripts) await tab.addScriptTag({ content });
  const state = await tab.evaluate((userId) => new Promise((resolve) => {
    globalThis.__gfListeners.at(-1)(
      { type: "EIC_GF_GET_PAGE_STATE", expectedUserTurnId: userId, expectedUserIndex: 0 },
      {},
      (response) => resolve(response?.state || null)
    );
  }), USER_ID);
  await context.close();
  return state;
}

const browser = await chromium.launch();
const rows = {};
for (const [name, html] of Object.entries(FIXTURES)) {
  const s = await pageState(browser, html);
  const a = s?.autonomousTurn || {};
  rows[name] = {
    generating: s?.generating === true,
    stopVisible: s?.signals?.stopVisible === true,
    assistantFound: a.assistantFound === true,
    assistantText: String(a.assistantText || ""),
    lastUserText: String(s?.lastUserText || ""),
    providerNotice: s?.pageHealth?.providerNotice ?? null,
    rateLimitActive: s?.rateLimitWarning?.active === true,
    blockingUi: s?.modelEvidence?.blockingUi === true,
    composerPresent: s?.pageHealth?.composerPresent === true
  };
}
await browser.close();

const checks = [];
const check = (name, pass) => checks.push([name, Boolean(pass)]);
for (const [name, row] of Object.entries(rows)) {
  check(`${name}: no provider notice, rate limit or blocking UI`, row.providerNotice === null && !row.rateLimitActive && !row.blockingUi);
  check(`${name}: composer present`, row.composerPresent);
  check(`${name}: notice text never in assistant text`, !/Våra system bearbetar/.test(row.assistantText));
}
check("A: generating via stop button 'Sluta svara'", rows.A_noticeStopVisible.generating && rows.A_noticeStopVisible.stopVisible);
check("A: turn without role node gives no assistant entry", !rows.A_noticeStopVisible.assistantFound);
check("B: no assistant entry without stop button", !rows.B_noticeNoStopButton.assistantFound && rows.B_noticeNoStopButton.assistantText === "");
check("F: notice inside a role node is status, assistant text empty", rows.F_noticeInsideRoleNodeNoSignal.assistantFound && rows.F_noticeInsideRoleNodeNoSignal.assistantText === "");
check("G: real answer kept, notice removed", rows.G_noticeAndAnswerInsideRoleNode.assistantText === '{"ok":true,"answer":"EIC svar"}');
check("H: user text quoting the notice is kept", /Våra system bearbetar den här förfrågan/.test(rows.H_userMessageQuotesNotice.lastUserText));

const out = {
  tool: "tools/verify-processing-notice.mjs",
  contentVersion: (fs.readFileSync(path.join(root, "content.js"), "utf8").match(/CONTENT_VERSION = "([^"]+)"/) || [])[1] || "",
  rows,
  checks: checks.map(([name, pass]) => ({ name, pass })),
  passed: checks.filter(([, pass]) => pass).length,
  total: checks.length
};
const outFile = process.argv[2];
if (outFile) fs.writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
console.log(`checks ${out.passed}/${out.total}`);
process.exitCode = out.passed === out.total ? 0 : 1;
