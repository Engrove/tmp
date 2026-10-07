// v1.9.3 real-DOM verification: ChatGPT's background-processing notice and its
// connection-lost banner are reported as page state (providerNotices) and
// quoted copies of the same sentences in answers, prompts or Greenfield's own
// UI are not. Synthetic markup following the operator's 2026-09-25 page
// (turn without a role node, notice in div[data-streaming-response-status])
// and the 2026-10-07 screenshot ("Anslutningen bröts. Väntar på hela svaret").
// Runs the manifest content scripts in Chromium via Playwright; not part of
// `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-transport-notices.mjs [out.json]
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
const OLD_USER_ID = "b2e3e940-0000-4000-8000-000000000000";

const NOTICE = `<div class="text-token-text-tertiary"><span class="loading-shimmer-tertiary"><span class="block">Våra system bearbetar den här begäran lite till innan de svarar. Du kan <button type="button">försöka igen med en snabbare modell</button> för att få ett snabbare svar. <a href="#">Läs mer</a></span></span></div>`;
const BANNER = `<div class="flex items-center gap-2"><span>Anslutningen bröts. Väntar på hela svaret</span><button type="button">Försök igen</button></div>`;
const LONG_ANSWER = `<div class="markdown prose"><p>${"Status: CONTINUE — owner-verified readback complete. ".repeat(4)}</p><p>Våra system bearbetar den här begäran lite till innan de svarar.</p><p>Anslutningen bröts. Väntar på hela svaret</p></div>`;
const userTurn = (id, text = "Greenfield prompt") => `
  <section data-testid="conversation-turn-${id === USER_ID ? 3 : 1}" data-turn="user" data-turn-id="${id}">
    <div data-message-author-role="user" data-message-id="${id}"><div class="whitespace-pre-wrap">${text}</div></div>
  </section>`;
const assistantTurn = (n, inner) => `
  <section data-testid="conversation-turn-${n}" data-turn="assistant" data-turn-id="request-WEB:00000000-0000-4000-8000-00000000000${n}-0">
    <div class="agent-turn"><div data-streaming-response-status="">${inner}</div></div>
  </section>`;
const roleNode = (inner) => `<div data-message-author-role="assistant" data-message-id="a-${Math.random().toString(16).slice(2, 8)}">${inner}</div>`;
const composer = (stop) => `
  <form data-type="unified-composer">
    <div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox" style="min-height:20px;min-width:200px"><p></p></div>
    ${stop
      ? `<button type="submit" aria-label="Sluta svara" data-testid="stop-button">■</button>`
      : `<button type="submit" aria-label="Skicka prompt" data-testid="send-button" disabled>↑</button>`}
  </form>`;
const page = (thread, { stop = false, toast = "", overlay = "EIC Greenfield · CONNECTED · WAITING · GF-006" } = {}) => `<!doctype html><html lang="sv-SE"><head><meta charset="utf-8"><title>EIC</title></head><body>
  <main style="display:block;width:900px"><div data-scroll-root="">${thread}</div>${composer(stop)}</main>
  ${toast}
  <div id="eic-gf-linked-overlay" data-eic-gf-ui="true">${overlay}</div>
</body></html>`;
const history = userTurn(OLD_USER_ID, "Earlier prompt") + assistantTurn(2, roleNode(`<div class="markdown prose"><p>${"Earlier complete answer. ".repeat(8)}</p></div>`));

const FIXTURES = {
  A_processingWithStop: [page(history + userTurn(USER_ID) + assistantTurn(4, NOTICE), { stop: true }), { processing: true, connection: false }],
  B_processingNoStopButton: [page(history + userTurn(USER_ID) + assistantTurn(4, NOTICE)), { processing: true, connection: false }],
  E_baselineNoNotice: [page(history + userTurn(USER_ID) + assistantTurn(4, ""), { stop: true }), { processing: false, connection: false }],
  F_processingInsideRoleNode: [page(history + userTurn(USER_ID) + assistantTurn(4, roleNode(NOTICE))), { processing: true, connection: false }],
  G_shortPartialAnswerAndNotice: [page(history + userTurn(USER_ID) + assistantTurn(4, roleNode(`<p>{"ok":true}</p>` + NOTICE))), { processing: true, connection: false }],
  H_userMessageQuotesBoth: [page(history + userTurn(USER_ID, "Våra system bearbetar den här begäran lite till innan de svarar. Anslutningen bröts. Väntar på hela svaret") + assistantTurn(4, "")), { processing: false, connection: false }],
  I_longAnswerQuotesBothInProse: [page(history + userTurn(USER_ID) + assistantTurn(4, roleNode(LONG_ANSWER))), { processing: false, connection: false }],
  J_connectionToastOutsideMain: [page(history + userTurn(USER_ID) + assistantTurn(4, roleNode(`<div class="markdown prose"><p>Delvis svar …</p></div>`)), { toast: `<div role="status" class="toast">${BANNER}</div>` }), { processing: false, connection: true }],
  K_connectionBannerInCurrentTurn: [page(history + userTurn(USER_ID) + assistantTurn(4, roleNode(`<div class="markdown prose"><p>Delvis svar …</p></div>`) + BANNER)), { processing: false, connection: true }],
  L_bannerInEarlierTurnOnly: [page(userTurn(OLD_USER_ID, "Earlier prompt") + assistantTurn(2, BANNER + NOTICE) + userTurn(USER_ID) + assistantTurn(4, "")), { processing: false, connection: false }],
  M_greenfieldOverlayQuotesBoth: [page(history + userTurn(USER_ID) + assistantTurn(4, ""), { overlay: "Anslutningen bröts. Väntar på hela svaret · Våra system bearbetar den här begäran lite till" }), { processing: false, connection: false }],
  N_codeBlockQuotesBoth: [page(history + userTurn(USER_ID) + assistantTurn(4, roleNode(`<pre><code>Anslutningen bröts. Väntar på hela svaret\nVåra system bearbetar den här begäran</code></pre>`))), { processing: false, connection: false }],
  O_englishBanner: [page(history + userTurn(USER_ID) + assistantTurn(4, ""), { toast: `<div role="status"><span>Connection lost. Waiting for the full response</span></div>` }), { processing: false, connection: true }]
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
      { type: "EIC_GF_GET_PAGE_STATE", expectedUserTurnId: userId, expectedUserIndex: 1 },
      {},
      (response) => resolve(response?.state || null)
    );
  }), USER_ID);
  await context.close();
  return state;
}

const browser = await chromium.launch();
const rows = {};
const checks = [];
for (const [name, [html, expected]] of Object.entries(FIXTURES)) {
  const s = await pageState(browser, html);
  rows[name] = {
    providerNotices: s?.providerNotices ?? null,
    generating: s?.generating === true,
    assistantText: String(s?.autonomousTurn?.assistantText || "").slice(0, 120)
  };
  checks.push([`${name}: processingNotice=${expected.processing}`, s?.providerNotices?.processingNotice === expected.processing]);
  checks.push([`${name}: connectionInterrupted=${expected.connection}`, s?.providerNotices?.connectionInterrupted === expected.connection]);
  checks.push([`${name}: notice text never in assistant text`, !/Våra system bearbetar den här begäran lite till/.test(name.startsWith("I_") ? "" : rows[name].assistantText)]);
}
await browser.close();

const out = {
  tool: "tools/verify-transport-notices.mjs",
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
