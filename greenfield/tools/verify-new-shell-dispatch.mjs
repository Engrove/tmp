// v1.8.10 real-DOM check: does Greenfield see its own prompt land in ChatGPT's
// app shell? Operator report 2026-09-26 (v1.8.9): the prompt was posted and
// answered, but the process stayed in SENDING with DISPATCH_EFFECT_UNRESOLVED
// (diagnostics: dispatch EFFECT_POSSIBLE, acknowledged false, no evidence,
// baselineUserCount 0; the hold re-checked every 30 s for minutes).
//
// Thread markup below follows ChatGPT's production JS of the build the
// operator's page loaded (manifest 4da31bb4, fetched 2026-09-26; route
// g/:gizmoId/c/:conversationId -> ChatGptConversationPage -> turn module Xk9):
//   - turn row:   div.flex.flex-col.gap-1.5[data-content-search-turn-key=<turn id>]
//   - user:       h4.sr-only "Du sa:" + div.group/user-message
//                 [data-chatgpt-search-unit-key][data-chatgpt-search-message-ids=<id>]
//                 (the optimistic pending message is rendered without a message id)
//   - assistant:  div[data-content-search-unit-key][data-chatgpt-search-unit-key]
//                 [data-chatgpt-search-message-ids="<id> <source ids>"] with a
//                 child h4.sr-only[data-conversation-role=assistant] "ChatGPT sa:"
//   - composer:   form[data-chatgpt-composer]; its primary button is
//                 type=submit aria-label "Skicka", or type=button aria-label
//                 "Stoppa" while a response streams (sv-SE locale file).
// None of data-message-author-role, data-message-id, data-turn-id or
// stop-button occurs in that build. Synthetic ids and texts only.
// Runs the manifest content scripts in Chromium via Playwright; not part of
// `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-new-shell-dispatch.mjs [out.json]
// GF_CONTENT_ROOT=<dir> runs the same checks against another build's scripts.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = process.env.GF_CONTENT_ROOT
  ? path.resolve(process.env.GF_CONTENT_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = ["lib/safety-policy.js", "lib/model-observation.js", "content.js"]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"));

const GPT_ID = "g-0a1b2c3d4e5f60718293a4b5c6d7e8f9";
const EIC_ROOT = `https://chatgpt.com/g/${GPT_ID}-eic`;
const CONVERSATION_PATH = `/g/${GPT_ID}-eic/c/00000000-0000-4000-8000-00000000c0de`;
const USER_ID = "00000000-0000-4000-8000-0000000000e1";
const ASSISTANT_ID = "00000000-0000-4000-8000-0000000000e2";
const PROMPT = '{"schema":"eic.a2a.v1","kind":"MISSION_START","mission":"GF-900 syntetiskt uppdrag"}';
const ANSWER = '{"schema":"eic.a2a.response.v1","status":"OK","note":"syntetiskt svar"}';
const ICON = '<svg width="16" height="16" aria-hidden="true"></svg>';

const picker = `<button type="button" aria-label="Välj ChatGPT-modell" aria-haspopup="menu"
  data-codex-intelligence-trigger="true" data-composer-navigation-target="reasoning" data-selected-reasoning-effort="medium"><span>
  <span aria-hidden="true" style="position:absolute;visibility:hidden"><span>Resonemangsansträngning</span></span>
  <span><span>Pro</span></span></span>${ICON}</button>`;
const sendButton = '<button type="submit" aria-label="Skicka" disabled data-fixture="primary">↑</button>';
const stopButton = '<button type="button" aria-label="Stoppa" data-fixture="primary">■</button>';
const composer = `<form data-composer-placement="thread" data-chatgpt-composer="" data-thread-find-composer="true">
  <div contenteditable="true" aria-multiline="true" role="textbox" aria-label="Fråga ChatGPT" style="min-height:20px;min-width:200px"><p data-empty-paragraph="true"><br></p></div>
  <button type="button" aria-label="Lägg till filer med mera">${ICON}</button>
  ${picker}
  <span id="primary-slot">${sendButton}</span>
</form>`;

const userMessage = (text, withId) => `<h4 class="sr-only m-0 select-none">Du sa:</h4>
  <div class="group/user-message flex flex-col items-end gap-2" data-chatgpt-search-unit-key="user:turn-1|message"${withId ? ` data-chatgpt-search-message-ids="${USER_ID}"` : ""}>
    <div data-user-message-bubble="true" class="relative text-start"><div class="w-full" data-content-search-unit-key="user:turn-1|message"><div class="whitespace-pre-wrap">${text}</div></div></div>
    <div><button type="button" aria-label="Kopiera">${ICON}</button><button type="button" aria-label="Redigera meddelande">${ICON}</button></div>
  </div>`;
const assistantMessage = (inner) => `<div data-content-search-unit-key="assistant:${ASSISTANT_ID}|message" data-chatgpt-search-unit-key="assistant:${ASSISTANT_ID}|message" data-chatgpt-search-message-ids="${ASSISTANT_ID}">
  <h4 class="sr-only m-0 select-none" data-conversation-role="assistant" tabindex="-1">ChatGPT sa:</h4>
  <div class="markdown">${inner}</div>
  <div><button type="button" aria-label="Kopiera">${ICON}</button><span class="ms-1.5" data-assistant-message-sent-time="true">12:31</span></div>
</div>`;
const NOTICE = "<div><span>Våra system bearbetar den här begäran lite till innan de svarar.</span></div>";

// ChatGPT's reaction to the send button, with the timing as parameters.
const behaviour = ({ pendingMs = 300, idMs = 1500, answerMs = 2500, text = "" }) => `<script>
  (() => {
    const cfg = ${JSON.stringify({ pendingMs, idMs, answerMs, text })};
    const editor = () => document.querySelector("form[data-chatgpt-composer] [contenteditable='true']");
    const slot = () => document.getElementById("primary-slot");
    document.addEventListener("input", () => {
      const button = slot().querySelector("button[type='submit']");
      if (button) button.disabled = !editor().textContent.trim();
    }, true);
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button[type='submit'][aria-label='Skicka']");
      if (!button) return;
      event.preventDefault();
      const sent = cfg.text || editor().textContent;
      editor().innerHTML = '<p data-empty-paragraph="true"><br></p>';
      slot().innerHTML = ${JSON.stringify(stopButton)};
      history.pushState({}, "", ${JSON.stringify(CONVERSATION_PATH)});
      const thread = document.querySelector("[data-thread-user-message-navigation-content]");
      setTimeout(() => {
        thread.insertAdjacentHTML("beforeend", '<div class="flex flex-col gap-1.5" data-content-search-turn-key="turn-1"><div data-fixture="user"></div><div data-fixture="assistant"></div></div>');
        thread.querySelector("[data-fixture='user']").innerHTML = ${JSON.stringify(userMessage("__TEXT__", false))}.replace("__TEXT__", sent);
      }, cfg.pendingMs);
      setTimeout(() => {
        thread.querySelector(".group\\\\/user-message").setAttribute("data-chatgpt-search-message-ids", ${JSON.stringify(USER_ID)});
        thread.querySelector("[data-fixture='assistant']").innerHTML = ${JSON.stringify(assistantMessage(NOTICE))};
      }, cfg.idMs);
      setTimeout(() => {
        thread.querySelector("[data-fixture='assistant']").innerHTML = ${JSON.stringify(assistantMessage(`<p>${ANSWER}</p>`))};
        slot().innerHTML = ${JSON.stringify(sendButton)};
      }, cfg.answerMs);
    }, true);
  })();
</script>`;

const page = (timing = {}, preThread = "") => `<!doctype html><html lang="sv-SE"><head><meta charset="utf-8"><title>EIC</title></head><body>
  <main data-app-shell-main-surface="browser" style="display:block;width:900px">
    <div data-app-shell-header-toolbar="true" style="display:block;height:40px"><div><span>EIC</span><button type="button" aria-label="GPT-åtgärder">${ICON}</button></div></div>
    <div data-request-input-activity-root="true"><div data-app-action-timeline-scroll="" role="presentation" class="thread-scroll-container">
      <div data-mcp-app-portal-target="true" data-thread-user-message-navigation-content="true">${preThread}</div>
    </div>
    <div data-thread-scroll-footer="true">${composer}</div></div>
  </main>
  ${behaviour(timing)}
</body></html>`;

async function open(browser, url, html) {
  const context = await browser.newContext();
  const tab = await context.newPage();
  await tab.route("https://chatgpt.com/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
  await tab.addInitScript(({ gptRoot }) => {
    const listeners = [];
    globalThis.__gfSent = [];
    globalThis.chrome = { runtime: { id: "test", onMessage: { addListener: (fn) => listeners.push(fn), removeListener() {} },
      async sendMessage(message) {
        globalThis.__gfSent.push(JSON.parse(JSON.stringify(message)));
        if (message?.type === "EIC_GF_AUTHORIZE_DISPATCH") {
          return { ok: true, policy: globalThis.GreenfieldSafetyPolicy.defaults, gptRoot };
        }
        return { ok: true };
      } } };
    globalThis.__gfListeners = listeners;
  }, { gptRoot: EIC_ROOT });
  await tab.goto(url);
  for (const content of scripts) await tab.addScriptTag({ content });
  return { context, tab };
}
const call = (tab, message) => tab.evaluate((m) => new Promise((resolve) => {
  globalThis.__gfListeners.at(-1)(m, {}, (response) => resolve(response ?? null));
}), message);
const state = async (tab, expectedUserIndex = null, expectedUserTurnId = "") =>
  (await call(tab, { type: "EIC_GF_GET_PAGE_STATE", expectedUserTurnId, expectedUserIndex }))?.state || null;
const sha256 = async (tab, text) => tab.evaluate(async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}, text);
const brief = (s) => s && ({
  url: s.url, userCount: s.userCount, assistantCount: s.assistantCount, lastUserId: s.lastUserId, lastAssistantId: s.lastAssistantId,
  lastAssistantOwnerKind: s.lastAssistantOwnerKind, generating: s.generating, stopVisible: s.signals?.stopVisible,
  turnCount: s.pageHealth?.turnCount, providerNotice: s.pageHealth?.providerNotice?.kind || null,
  autonomousTurn: s.autonomousTurn && { resolvedUserTurnId: s.autonomousTurn.resolvedUserTurnId, resolvedBy: s.autonomousTurn.resolvedBy,
    assistantFound: s.autonomousTurn.assistantFound, assistantId: s.autonomousTurn.assistantId, assistantText: s.autonomousTurn.assistantText,
    assistantGenerating: s.autonomousTurn.assistantGenerating }
});

async function dispatchRun(browser, timing) {
  const { context, tab } = await open(browser, EIC_ROOT, page(timing));
  const promptHash = await sha256(tab, PROMPT);
  const before = await state(tab);
  const startedAt = Date.now();
  const result = await call(tab, {
    type: "EIC_GF_SUBMIT_PROMPT", prompt: PROMPT, promptHash, dispatchId: "send-00000000-0000-4000-8000-0000000000f1",
    safetyContext: { policy: await tab.evaluate(() => globalThis.GreenfieldSafetyPolicy.defaults), gptRoot: EIC_ROOT }
  });
  const elapsedMs = Date.now() - startedAt;
  const streaming = await state(tab, 0);
  await tab.waitForTimeout(Math.max(0, (timing.answerMs || 2500) + 400 - (Date.now() - startedAt)));
  const done = await state(tab, 0);
  const byId = result?.materializedReceipt?.userTurnId ? await state(tab, null, result.materializedReceipt.userTurnId) : null;
  const sent = await tab.evaluate(() => globalThis.__gfSent.map((m) => ({ type: m.type, receipt: m.receipt || null })));
  await context.close();
  return {
    promptHash, elapsedMs,
    result: result && { ok: result.ok, effectPossible: result.effectPossible, acknowledged: result.acknowledged,
      acknowledgementEvidence: result.acknowledgementEvidence, code: result.code || "", materializedReceipt: result.materializedReceipt || null },
    before: brief(before), streaming: brief(streaming), done: brief(done), byId: brief(byId),
    doneLastUserHash: done?.lastUserHash || "", materializationMessages: sent.filter((m) => m.type === "EIC_GF_DISPATCH_MATERIALIZED")
  };
}

// The cyber notice (module H4K: "Det här innehållet kan inte visas" + the
// Daybreak line) is the moderation disclaimer that the turn module renders as
// a sibling after the user message, inside the turn row. Its wrapper markup is
// not in the build text read here (assumption: plain block elements).
async function daybreakNotice(browser) {
  const notice = `<div><div><p class="font-semibold">Det här innehållet kan inte visas</p>Vi är särskilt försiktiga med förfrågningar som rör cybersäkerhet. Om du arbetar med säkerhet kan du kvalificera dig för <a href="#">Daybreak</a>.</div></div>`;
  const thread = `<div class="flex flex-col gap-1.5" data-content-search-turn-key="turn-1">${userMessage("Kör nästa paket.", true)}${notice}</div>`;
  const { context, tab } = await open(browser, `https://chatgpt.com${CONVERSATION_PATH}`, page({}, thread));
  const s = await state(tab, 0);
  await context.close();
  return { ...brief(s), notice: s?.pageHealth?.providerNotice || null };
}

async function daybreakMention(browser) {
  const mention = "Informera EIC om \"Det här innehållet kan inte visas ... cybersäkerhet ... Daybreak\".";
  const thread = `<div class="flex flex-col gap-1.5" data-content-search-turn-key="turn-1">${userMessage(mention, true)}${assistantMessage("<p>This content can’t be shown is a cybersecurity notice; apply for Daybreak.</p>")}</div>`;
  const { context, tab } = await open(browser, `https://chatgpt.com${CONVERSATION_PATH}`, page({}, thread));
  const s = await state(tab, 0);
  await context.close();
  return brief(s);
}

const browser = await chromium.launch();
let fast;
let slowId;
let mention;
let blocked;
try {
  fast = await dispatchRun(browser, { pendingMs: 300, idMs: 1500, answerMs: 2500 });
  slowId = await dispatchRun(browser, { pendingMs: 300, idMs: 6000, answerMs: 7000 });
  mention = await daybreakMention(browser);
  blocked = await daybreakNotice(browser);
} finally {
  await browser.close();
}

const checks = [
  ["send: acknowledged by the user turn appearing (v1.8.9: no evidence, EFFECT_POSSIBLE)",
    fast.result?.ok === true && fast.result.acknowledged === true && ["PAGE_LAST_USER_HASH", "USER_COUNT_INCREMENTED"].includes(fast.result.acknowledgementEvidence)],
  ["send: materialization receipt carries ChatGPT's user message id and ordinal 0",
    fast.result?.materializedReceipt?.userTurnId === USER_ID && fast.result.materializedReceipt.userTurnIndex === 0 && fast.result.materializedReceipt.userCount === 1],
  ["send: the receipt was reported to the background", fast.materializationMessages.length === 1 && fast.materializationMessages[0].receipt?.userTurnId === USER_ID],
  ["send: the user text hash equals the prompt hash", fast.doneLastUserHash === fast.promptHash],
  ["late message id: acknowledged, receipt waits for the id (optimistic message has none)",
    slowId.result?.acknowledged === true && slowId.result.materializedReceipt?.userTurnId === USER_ID],
  ["streaming: 'Stoppa' in the composer form counts as generating", fast.streaming?.generating === true && fast.streaming.stopVisible === true],
  ["answer: one user and one assistant message, turn resolved by ordinal",
    fast.done?.userCount === 1 && fast.done.assistantCount === 1 && fast.done.autonomousTurn?.resolvedBy === "USER_ORDINAL" && fast.done.autonomousTurn.resolvedUserTurnId === USER_ID],
  ["answer: resolved by the receipt's user id", fast.byId?.autonomousTurn?.resolvedBy === "USER_TURN_ID" && fast.byId.autonomousTurn.assistantFound === true],
  ["answer: assistant text is the JSON only (no 'ChatGPT sa:', no time stamp, no processing notice)",
    fast.done?.autonomousTurn?.assistantId === ASSISTANT_ID && fast.done.autonomousTurn.assistantText === ANSWER],
  ["answer: not generating after 'Skicka' returns", fast.done?.generating === false],
  ["page health counts the new-shell messages", fast.done?.turnCount === 2],
  ["Daybreak words inside new-shell messages are not a provider notice", mention?.providerNotice === null && mention.userCount === 1],
  ["the cyber notice beside the user message in the turn row is still detected, after the user turn",
    blocked?.notice?.kind === "CONTENT_BLOCKED_DAYBREAK" && blocked.notice.headlineMatched === true && blocked.notice.cyberWordMatched === true && blocked.notice.afterExpectedUserTurn === true]
];
const out = { tool: "tools/verify-new-shell-dispatch.mjs", contentRoot: process.env.GF_CONTENT_ROOT ? "GF_CONTENT_ROOT (another build)" : ".",
  fast, slowId, mention, blocked, checks: checks.map(([name, pass]) => ({ name, pass: Boolean(pass) })),
  passed: checks.filter(([, pass]) => pass).length, total: checks.length };
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify(out, null, 2)}\n`);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
console.log(`checks ${out.passed}/${out.total}`);
process.exitCode = out.passed === out.total ? 0 : 1;
