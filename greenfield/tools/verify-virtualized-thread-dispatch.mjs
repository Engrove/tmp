// v1.8.11 real-DOM check: does Greenfield find its own prompt in ChatGPT's
// virtualized thread? Operator report 2026-09-28 (v1.8.10): turn 6 was posted
// and answered, but the process stayed in SENDING with
// DISPATCH_EFFECT_UNRESOLVED / AUTONOMOUS_USER_TURN_NOT_RESOLVED (diagnostics
// 11:22: dispatch ACKNOWLEDGED by GENERATION_STARTED, baselineUserCount 5, no
// materialized user turn id; the same in two other conversations at 4 turns).
//
// Thread behaviour below follows ChatGPT's production JS (manifest 4da31bb4,
// and manifest 4ad86f39 loaded by the operator's tab 2026-09-28):
//   - the thread renders its turns through a virtual list (module iBd): only
//     turns in the viewport plus 2 overscan turns are in the DOM
//     (overscanCount:2, default viewportHeightPx:800, estimatedHeightPx??280,
//     entries.slice(startIndex,endIndex), row div[data-turn-key]);
//   - a long user message is collapsed to 20 lines (collapsedLineCount 20);
//     the full text stays in the DOM, followed by <span aria-hidden="true"
//     class="block">…</span> and a show-more button.
// The fixture keeps the newest 5 turns, which is what ~280 px per unmeasured
// turn gives in an 800 px viewport (hidden tab). Synthetic ids and texts only.
// Runs the manifest content scripts in Chromium via Playwright; not part of
// `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-virtualized-thread-dispatch.mjs [out.json]
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
const CONVERSATION_URL = `https://chatgpt.com/g/${GPT_ID}-eic/c/00000000-0000-4000-8000-00000000c0de`;
const WINDOW_TURNS = 5;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const filler = "Syntetisk uppdragstext som gör prompten lång nog att fällas ihop till tjugo rader. ".repeat(40);
const prompt = (turn) => JSON.stringify({
  schema: "eic.a2a.message.v1", protocol: "EIC-A2A/1", messageType: "CONTINUATION",
  messageId: `a2a-${id(0xa0 + turn)}`, correlationId: `run-${id(0xb1)}`,
  process: { processId: `process-${id(0xc1)}`, turn }, objective: `GF-900 tur ${turn}. ${filler}`
});
const answer = (turn) => `{"schema":"eic.a2a.response.v1","status":"CONTINUE","summary":"syntetiskt svar tur ${turn}"}`;
const PROMPT = prompt(6);
const MARKER = JSON.parse(PROMPT).messageId;
const USER6 = id(0xe6);
const ASSISTANT6 = id(0xf6);
const ICON = '<svg width="16" height="16" aria-hidden="true"></svg>';

const priorTurns = [1, 2, 3, 4, 5].map((turn) => ({
  key: `turn-${turn}`, userId: id(0xe0 + turn), userText: prompt(turn), assistantId: id(0xf0 + turn), answer: answer(turn)
}));

const picker = `<button type="button" aria-label="Välj ChatGPT-modell" aria-haspopup="menu"
  data-codex-intelligence-trigger="true" data-composer-navigation-target="reasoning" data-selected-reasoning-effort="medium"><span>
  <span aria-hidden="true" style="position:absolute;visibility:hidden"><span>Resonemangsansträngning</span></span>
  <span><span>Pro</span></span></span>${ICON}</button>`;
const sendButton = '<button type="submit" aria-label="Skicka" disabled>↑</button>';
const stopButton = '<button type="button" aria-label="Stoppa">■</button>';
const composer = `<form data-composer-placement="thread" data-chatgpt-composer="" data-thread-find-composer="true">
  <div contenteditable="true" aria-multiline="true" role="textbox" aria-label="Fråga ChatGPT" style="min-height:20px;min-width:200px"><p data-empty-paragraph="true"><br></p></div>
  <button type="button" aria-label="Lägg till filer med mera">${ICON}</button>
  ${picker}
  <span id="primary-slot">${sendButton}</span>
</form>`;

// Renders the turn model like ChatGPT's virtual list: only the newest
// WINDOW_TURNS rows, inside a spacer that keeps the full height.
const renderer = `
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const user = (t) => '<h4 class="sr-only m-0 select-none">Du sa:</h4>' +
    '<div class="group/user-message flex flex-col items-end gap-2" data-chatgpt-search-unit-key="user:' + t.key + '|message"' +
      (t.userId ? ' data-chatgpt-search-message-ids="' + t.userId + '"' : '') + '>' +
      '<div data-user-message-bubble="true" class="relative text-start"><div class="flex flex-col items-end gap-1">' +
        '<div class="relative w-full min-w-0 text-size-chat leading-relaxed">' +
          '<div class="overflow-hidden" style="max-height:19lh"><div><div class="text-size-chat whitespace-pre-wrap" dir="auto">' + esc(t.userText) + '</div></div></div>' +
          '<span aria-hidden="true" class="block">…</span>' +
        '</div>' +
        '<button type="button" aria-expanded="false" data-thread-find-skip="true"><span>Visa mer</span></button>' +
      '</div></div>' +
      '<div><button type="button" aria-label="Kopiera">${ICON}</button><button type="button" aria-label="Redigera meddelande">${ICON}</button></div>' +
    '</div>';
  const assistant = (t) => t.answer == null ? '' :
    '<div data-content-search-unit-key="assistant:' + t.assistantId + '|message" data-chatgpt-search-unit-key="assistant:' + t.assistantId + '|message" data-chatgpt-search-message-ids="' + t.assistantId + '">' +
      '<h4 class="sr-only m-0 select-none" data-conversation-role="assistant" tabindex="-1">ChatGPT sa:</h4>' +
      '<div class="markdown"><pre><code>' + esc(t.answer) + '</code></pre><p>Status: CONTINUE</p></div>' +
      '<div><button type="button" aria-label="Kopiera">${ICON}</button><span class="ms-1.5" data-assistant-message-sent-time="true">12:31</span></div>' +
    '</div>';
  const row = (t) => '<div style="margin-top:6px"><div data-turn-key="' + t.key + '"><div class="flex flex-col gap-1.5" data-content-search-turn-key="' + t.key + '">' +
    user(t) + assistant(t) + '</div></div></div>';
  globalThis.__renderThread = () => {
    const turns = globalThis.__turns, start = Math.max(0, turns.length - ${WINDOW_TURNS});
    document.querySelector("[data-thread-user-message-navigation-content]").innerHTML =
      '<div class="relative shrink-0" style="height:' + (turns.length * 286) + 'px"><div class="flex flex-col" style="margin-top:' + (start * 286) + 'px">' +
      turns.slice(start).map(row).join("") + '</div></div>';
  };`;

// ChatGPT's reaction to the send button, with the timing as parameters.
const behaviour = ({ pendingMs = 300, idMs = 1500, answerMs = 2500 } = {}) => `<script>
  (() => {
    ${renderer}
    const cfg = ${JSON.stringify({ pendingMs, idMs, answerMs, USER6, ASSISTANT6 })};
    const editor = () => document.querySelector("form[data-chatgpt-composer] [contenteditable='true']");
    const slot = () => document.getElementById("primary-slot");
    document.addEventListener("input", () => {
      const button = slot().querySelector("button[type='submit']");
      if (button) button.disabled = !editor().textContent.trim();
    }, true);
    document.addEventListener("click", (event) => {
      if (!event.target.closest("button[type='submit'][aria-label='Skicka']")) return;
      event.preventDefault();
      const sent = editor().textContent;
      editor().innerHTML = '<p data-empty-paragraph="true"><br></p>';
      slot().innerHTML = ${JSON.stringify(stopButton)};
      const turn = { key: "turn-6", userId: "", userText: sent, assistantId: cfg.ASSISTANT6, answer: null };
      setTimeout(() => { globalThis.__turns.push(turn); globalThis.__renderThread(); }, cfg.pendingMs);
      setTimeout(() => { turn.userId = cfg.USER6; turn.answer = ""; globalThis.__renderThread(); }, cfg.idMs);
      setTimeout(() => {
        turn.answer = ${JSON.stringify(answer(6))};
        globalThis.__renderThread();
        slot().innerHTML = ${JSON.stringify(sendButton)};
      }, cfg.answerMs);
    }, true);
    globalThis.__renderThread();
  })();
</script>`;

const page = (turns, timing) => `<!doctype html><html lang="sv-SE"><head><meta charset="utf-8"><title>EIC</title></head><body>
  <main data-app-shell-main-surface="browser" style="display:block;width:900px">
    <div data-app-shell-header-toolbar="true" style="display:block;height:40px"><div><span>EIC</span><button type="button" aria-label="GPT-åtgärder">${ICON}</button></div></div>
    <div data-request-input-activity-root="true"><div role="presentation" class="thread-scroll-container flex flex-col-reverse">
      <div data-mcp-app-portal-target="true" data-thread-user-message-navigation-content="true" class="relative flex flex-1 shrink-0 flex-col"></div>
    </div>
    <div data-thread-scroll-footer="true">${composer}</div></div>
  </main>
  <script>globalThis.__turns = ${JSON.stringify(turns)};</script>
  ${behaviour(timing)}
</body></html>`;

async function open(browser, html) {
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
  }, { gptRoot: `https://chatgpt.com/g/${GPT_ID}-eic` });
  await tab.goto(CONVERSATION_URL);
  for (const content of scripts) await tab.addScriptTag({ content });
  return { context, tab };
}
const call = (tab, message) => tab.evaluate((m) => new Promise((resolve) => {
  globalThis.__gfListeners.at(-1)(m, {}, (response) => resolve(response ?? null));
}), message);
const state = async (tab, { index = null, turnId = "", marker = "" } = {}) =>
  (await call(tab, { type: "EIC_GF_GET_PAGE_STATE", expectedUserTurnId: turnId, expectedUserIndex: index, expectedPromptMarker: marker }))?.state || null;
const sha256 = async (tab, text) => tab.evaluate(async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}, text);
const brief = (s) => s && ({
  userCount: s.userCount, assistantCount: s.assistantCount, lastUserId: s.lastUserId, lastAssistantId: s.lastAssistantId,
  generating: s.generating, lastUserHash: s.lastUserHash,
  autonomousTurn: s.autonomousTurn && { expectedUserIndex: s.autonomousTurn.expectedUserIndex, resolvedUserTurnId: s.autonomousTurn.resolvedUserTurnId,
    resolvedBy: s.autonomousTurn.resolvedBy, expectedPromptMarker: s.autonomousTurn.expectedPromptMarker ?? null,
    promptMarkerMatches: s.autonomousTurn.promptMarkerMatches ?? null, assistantFound: s.autonomousTurn.assistantFound,
    assistantId: s.autonomousTurn.assistantId, assistantText: s.autonomousTurn.assistantText, assistantGenerating: s.autonomousTurn.assistantGenerating }
});

async function dispatchRun(browser) {
  const timing = { pendingMs: 300, idMs: 1500, answerMs: 2500 };
  const { context, tab } = await open(browser, page(priorTurns, timing));
  const promptHash = await sha256(tab, PROMPT);
  const before = await state(tab);
  const result = await call(tab, {
    type: "EIC_GF_SUBMIT_PROMPT", prompt: PROMPT, promptHash, promptMarker: MARKER, dispatchId: `send-${id(0xd1)}`,
    safetyContext: { policy: await tab.evaluate(() => globalThis.GreenfieldSafetyPolicy.defaults), gptRoot: `https://chatgpt.com/g/${GPT_ID}-eic` }
  });
  // The background's re-check after the send: v1.8.10 asks by ordinal only
  // (expected index = baselineUserCount); v1.8.11 also passes the marker.
  const ordinalOnly = await state(tab, { index: before.userCount });
  const withMarker = await state(tab, { index: before.userCount, marker: MARKER });
  await tab.waitForTimeout(timing.answerMs + 400);
  const done = await state(tab, { index: before.userCount, marker: MARKER });
  const byId = await state(tab, { turnId: USER6 });
  const shiftedOrdinal = await state(tab, { index: 3, marker: MARKER });
  const absentMarker = await state(tab, { index: 4, marker: `a2a-${id(0xdead)}` });
  const sent = await tab.evaluate(() => globalThis.__gfSent.map((m) => ({ type: m.type, receipt: m.receipt || null, evidence: m.evidence || "" })));
  await context.close();
  return {
    promptHash, marker: MARKER,
    result: result && { ok: result.ok, effectPossible: result.effectPossible, acknowledged: result.acknowledged,
      acknowledgementEvidence: result.acknowledgementEvidence, code: result.code || "", materializedReceipt: result.materializedReceipt || null },
    before: brief(before), ordinalOnly: brief(ordinalOnly), withMarker: brief(withMarker), done: brief(done), byId: brief(byId),
    shiftedOrdinal: brief(shiftedOrdinal), absentMarker: brief(absentMarker),
    materializationMessages: sent.filter((m) => m.type === "EIC_GF_DISPATCH_MATERIALIZED")
  };
}

// A resent copy of the same prompt (two user messages with the same A2A
// messageId) must not be resolved to either of them.
async function duplicateMarker(browser) {
  const turns = [...priorTurns.slice(3),
    { key: "turn-6", userId: USER6, userText: PROMPT, assistantId: ASSISTANT6, answer: answer(6) },
    { key: "turn-7", userId: id(0xe7), userText: PROMPT, assistantId: id(0xf7), answer: answer(7) }];
  const { context, tab } = await open(browser, page(turns));
  const s = await state(tab, { index: 5, marker: MARKER });
  await context.close();
  return brief(s);
}

const browser = await chromium.launch();
let run;
let duplicate;
try {
  run = await dispatchRun(browser);
  duplicate = await duplicateMarker(browser);
} finally {
  await browser.close();
}

const receipt = run.result?.materializedReceipt;
const checks = [
  ["fixture: the thread holds the newest 5 turns before the send", run.before?.userCount === 5 && run.before.lastUserId === id(0xe5)],
  ["fixture: after the send the DOM still holds 5 user messages (oldest turn unmounted), the newest is the prompt",
    run.done?.userCount === 5 && run.done.lastUserId === USER6],
  ["fixture: the collapsed user message never hashes to the prompt hash", Boolean(run.done?.lastUserHash) && run.done.lastUserHash !== run.promptHash],
  ["send: acknowledged with a materialization receipt for ChatGPT's new user message id",
    run.result?.ok === true && run.result.acknowledged === true && receipt?.userTurnId === USER6],
  ["send: the receipt is bound by the prompt's A2A messageId and reported to the background",
    receipt?.resolvedBy === "PROMPT_MARKER" && receipt.promptMarker === MARKER &&
    run.materializationMessages.length === 1 && run.materializationMessages[0].receipt?.userTurnId === USER6],
  ["v1.8.10 view (ordinal = baselineUserCount 5, no marker): not resolvable in the virtualized thread",
    run.ordinalOnly?.autonomousTurn?.resolvedBy === "NONE" && run.ordinalOnly.autonomousTurn.resolvedUserTurnId === ""],
  ["re-check with the marker resolves the new user message by PROMPT_MARKER",
    run.withMarker?.autonomousTurn?.resolvedBy === "PROMPT_MARKER" && run.withMarker.autonomousTurn.resolvedUserTurnId === USER6 &&
    run.withMarker.autonomousTurn.expectedPromptMarker === MARKER && run.withMarker.autonomousTurn.promptMarkerMatches === 1],
  ["answer: the assistant reply after the marked user message is found and complete",
    run.done?.autonomousTurn?.resolvedBy === "PROMPT_MARKER" && run.done.autonomousTurn.assistantId === ASSISTANT6 &&
    run.done.autonomousTurn.assistantText.includes("syntetiskt svar tur 6") && run.done.autonomousTurn.assistantGenerating === false],
  ["answer: resolved by the receipt's user id as well", run.byId?.autonomousTurn?.resolvedBy === "USER_TURN_ID" && run.byId.autonomousTurn.assistantId === ASSISTANT6],
  ["a marker wins over a shifted ordinal (index 3 would be turn 5 in the window)",
    run.shiftedOrdinal?.autonomousTurn?.resolvedBy === "PROMPT_MARKER" && run.shiftedOrdinal.autonomousTurn.resolvedUserTurnId === USER6],
  ["a marker that is not in the thread resolves nothing (no ordinal guess in the app shell)",
    run.absentMarker?.autonomousTurn?.resolvedBy === "NONE" && run.absentMarker.autonomousTurn.resolvedUserTurnId === ""],
  ["two user messages with the same marker resolve nothing", duplicate?.autonomousTurn?.resolvedBy === "NONE" && duplicate.autonomousTurn.promptMarkerMatches === 2]
];
const out = { tool: "tools/verify-virtualized-thread-dispatch.mjs", contentRoot: process.env.GF_CONTENT_ROOT ? "GF_CONTENT_ROOT (another build)" : ".",
  run, duplicate, checks: checks.map(([name, pass]) => ({ name, pass: Boolean(pass) })),
  passed: checks.filter(([, pass]) => pass).length, total: checks.length };
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify(out, null, 2)}\n`);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
console.log(`checks ${out.passed}/${out.total}`);
process.exitCode = out.passed === out.total ? 0 : 1;
