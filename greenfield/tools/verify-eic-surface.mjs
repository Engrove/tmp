// v1.8.7/1.8.9 real-DOM check for ChatGPT's newer shell (operator report and page
// export 2026-09-26). Hand-written markup with the element structure of that
// export; synthetic ids, no exported page content:
//   - EIC selected at "/": composer pill <button aria-label="Ta bort EIC">EIC</button>,
//     header <span>EIC</span><button aria-label="GPT-åtgärder">;
//   - standard chat at "/": neither;
//   - sidebar section[data-app-action-sidebar-section-heading="Pinned"] with
//     GPT buttons without href and "Ta bort fästning för GPT" unpin buttons;
//   - model picker "Pro" with data-selected-reasoning-effort="medium";
//   - processing notice "Våra system bearbetar den här begäran …" under a
//     status heading "Planerade åtkomst" (screenshot 2026-09-26).
// Runs the manifest content scripts in Chromium via Playwright; not part of
// `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-eic-surface.mjs [out.json]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = ["lib/safety-policy.js", "lib/model-observation.js", "content.js"]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"));
const HOME = "https://chatgpt.com/";
const EIC_ROOT = "https://chatgpt.com/g/g-0a1b2c3d4e5f60718293a4b5c6d7e8f9-eic";
const CONVERSATION = "https://chatgpt.com/g/g-0a1b2c3d4e5f60718293a4b5c6d7e8f9/c/00000000-0000-4000-8000-00000000c0de";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const ICON = '<svg width="16" height="16" aria-hidden="true"></svg>';

const header = (gpt) => `<div data-app-shell-header-toolbar="true" style="display:block;height:40px"><div>${gpt
  ? `<span>${gpt}</span><button type="button" aria-label="GPT-åtgärder" aria-haspopup="menu">${ICON}</button>` : ""}</div></div>`;
const picker = (text, { measurementVisible = false } = {}) => `<button type="button" aria-label="Välj ChatGPT-modell" aria-haspopup="menu"
  data-codex-intelligence-trigger="true" data-composer-navigation-target="reasoning" data-selected-reasoning-effort="medium"><span>
  <span aria-hidden="true" style="${measurementVisible ? "" : "position:absolute;visibility:hidden"}"><span>Resonemangsansträngning</span></span>
  <span><span>${text}</span></span></span>${ICON}</button>`;
const composer = ({ gpt = "", model = "Pro", measurementVisible = false, stop = false } = {}) => `
  <form data-composer-placement="home" data-chatgpt-composer="" data-thread-find-composer="true">
    <div data-above-composer-portal="true"></div>
    <div contenteditable="true" aria-multiline="true" role="textbox" aria-label="Fråga ChatGPT" style="min-height:20px;min-width:200px"><p data-empty-paragraph="true"><br></p></div>
    <button type="button" aria-label="Lägg till filer med mera">${ICON}</button>
    ${gpt ? `<span data-state="closed"><button type="button" aria-label="Ta bort ${gpt}"><span aria-hidden="true">${ICON}</span>${ICON}<span data-composer-footer-label-responsive="">${gpt}</span></button></span>` : ""}
    ${picker(model, { measurementVisible })}
    <button type="button" aria-label="Diktera">${ICON}</button>
    ${stop ? '<button type="submit" aria-label="Sluta svara" data-testid="stop-button">■</button>' : '<button type="submit" aria-label="Skicka" aria-disabled="true" disabled>↑</button>'}
  </form>`;
const pinned = (names) => `<section data-app-action-sidebar-section="" data-app-action-sidebar-section-heading="Pinned">
  <button data-app-action-sidebar-section-toggle="" role="button" type="button" aria-expanded="true"><span>Fästa</span>${ICON}</button>
  ${names.map((name, i) => `<div><button type="button" data-fixture-id="pin-${i}"><div><span><span aria-hidden="true">${ICON}</span></span><span>${name}</span></div></button>
    <div><span><button type="button" data-fixture-id="unpin-${i}" aria-label="Ta bort fästning för GPT">${ICON}</button></span></div></div>`).join("")}
</section>`;
// Recents as exported 2026-09-26: <a data-interactive-row-link aria-label=<title>
// href="/g/g-<id>/c/<conv>">; plus a project chat and a plain chat (synthetic).
const RECENT_LINKS = [
  ["/g/g-0a1b2c3d4e5f60718293a4b5c6d7e8f9/c/00000000-0000-4000-8000-0000000000a1", "Nattrapport"],
  ["/g/g-ffeeddccbbaa99887766554433221100/c/00000000-0000-4000-8000-0000000000b1", "Matlogg"],
  ["/g/g-0a1b2c3d4e5f60718293a4b5c6d7e8f9/c/00000000-0000-4000-8000-0000000000a2", "Status"],
  ["/g/g-p-00112233445566778899aabbccddeeff-projekt/c/00000000-0000-4000-8000-0000000000c1", "Projekt"],
  ["/c/00000000-0000-4000-8000-0000000000d1", "Vanlig chatt"]
];
const recents = `<section data-app-action-sidebar-section="" data-app-action-sidebar-section-heading="Recents">
  <button type="button" data-fixture-id="recent-eic"><span>EIC</span></button><a href="/c/00000000-0000-4000-8000-0000000000aa">EIC</a>
  ${RECENT_LINKS.map(([href, title]) => `<a data-interactive-row-link="true" aria-label="${title}" href="${href}" data-discover="true"><span data-thread-title="true">${title}</span></a>`).join("")}</section>`;
// A click on the pinned "EIC" button selects the GPT client-side (URL stays
// "/"), as observed; every click is recorded.
const spa = `<script>
  globalThis.__clicks = [];
  document.addEventListener("click", (event) => {
    const id = event.target.closest("[data-fixture-id]")?.getAttribute("data-fixture-id") || "";
    if (id) globalThis.__clicks.push(id);
    const name = event.target.closest("[data-fixture-id^='pin-']")?.innerText?.trim();
    if (name) {
      document.querySelector("#shell-header").innerHTML = ${JSON.stringify(header("__GPT__"))}.replace("__GPT__", name);
      document.querySelector("#shell-composer").innerHTML = ${JSON.stringify(composer({ gpt: "__GPT__" }))}.replaceAll("__GPT__", name);
    }
  }, true);
</script>`;
const page = ({ gpt = "", pins = ["Lycurgus III", "EIC"], thread = "", model = "Pro", measurementVisible = false, stop = false, banner = "" } = {}) => `<!doctype html><html lang="sv-SE"><head><meta charset="utf-8"><title>ChatGPT</title></head><body>
  <nav style="display:block;width:260px">${pinned(pins)}${recents}</nav>
  <div id="shell-header">${header(gpt)}</div>
  <main style="display:block;width:900px"><div data-scroll-root="">${thread}</div>${banner}<div id="shell-composer">${composer({ gpt, model, measurementVisible, stop })}</div></main>
  <div id="aria-notify-live-region-polite" role="status"><span></span></div>
  ${spa}
</body></html>`;

const userTurn = `<section data-testid="conversation-turn-1" data-turn="user" data-turn-id="${USER_ID}">
  <h4 class="sr-only">Du sade:</h4><div data-message-author-role="user" data-message-id="${USER_ID}"><div class="whitespace-pre-wrap">GF-052 uppdrag</div></div></section>`;
const NEW_NOTICE = '<div class="text-token-text-tertiary"><span>Våra system bearbetar den här begäran lite till innan de svarar.</span></div>';
const OLD_NOTICE = '<div class="text-token-text-tertiary"><span>Våra system bearbetar den här förfrågan lite till innan de svarar. Du kan <button type="button">försöka igen med en snabbare modell</button> för att få ett snabbare svar.</span></div>';
const HEADING = "<div><span>Planerade åtkomst</span></div>";
const assistantTurn = (inner, roleNode = true) => `<section data-testid="conversation-turn-2" data-turn="assistant" data-turn-id="request-WEB:00000000-0000-4000-8000-000000000002-0">
  <h4 class="sr-only">EIC sade:</h4><div class="agent-turn"><div data-streaming-response-status="">${roleNode
    ? `<div data-message-author-role="assistant" data-message-id="a-2">${inner}</div>` : inner}</div></div></section>`;
const ANSWER = '<p>{"ok":true,"answer":"EIC svar"}</p>';
// Banner text from the 2026-09-26 screenshot; its markup was not exported
// (assumption: a plain block above the composer with a link-button).
const MIGRATION_BANNER = `<div><strong>Migrera dina GPT:er till pluginer senast 11 december</strong><p>GPT:er som inte migreras kommer inte att vara tillgängliga efter 11 december. Migrera dina så att andra kan fortsätta använda dem som pluginer.</p><button type="button">Migrera till plugin</button><button type="button" aria-label="Stäng">×</button></div>`;

async function open(browser, url, html) {
  const context = await browser.newContext();
  const tab = await context.newPage();
  await tab.route("https://chatgpt.com/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
  await tab.addInitScript(() => {
    const listeners = [];
    globalThis.chrome = { runtime: { id: "test", onMessage: { addListener: (fn) => listeners.push(fn), removeListener() {} }, sendMessage: async () => ({ ok: true }) } };
    globalThis.__gfListeners = listeners;
  });
  await tab.goto(url);
  for (const content of scripts) await tab.addScriptTag({ content });
  return { context, tab };
}
const call = (tab, message) => tab.evaluate((m) => new Promise((resolve) => {
  globalThis.__gfListeners.at(-1)(m, {}, (response) => resolve(response ?? null));
}), message);
const gate = (tab, url, gptRoot) => tab.evaluate(({ url, gptRoot }) => {
  const S = globalThis.GreenfieldSafetyPolicy;
  const evidence = globalThis.GreenfieldModelObservation.observe();
  const proof = S.evaluateModel(evidence, S.defaults, { url, gptRoot });
  const heavy = S.evaluateModel(evidence, { ...S.defaults, minimumEffort: "heavy" }, { url, gptRoot });
  return { gptSurface: evidence.gptSurface, surface: S.eicSurfaceProof(evidence, url, gptRoot), proof: { allowed: proof.allowed, code: proof.code },
    heavyFloor: { allowed: heavy.allowed, code: heavy.code },
    modelLabel: evidence.modelLabel, effortLabel: evidence.effortLabel, effortEvidenceSource: evidence.effortEvidenceSource, adapterVersion: evidence.adapterVersion };
}, { url, gptRoot });

const browser = await chromium.launch();
const rows = {};

for (const [name, spec] of Object.entries({
  eicAtHome: { url: HOME, html: page({ gpt: "EIC" }) },
  standardAtHome: { url: HOME, html: page() },
  otherGptAtHome: { url: HOME, html: page({ gpt: "Lycurgus III" }) },
  eicConversationSlugless: { url: CONVERSATION, html: page({ gpt: "" }) },
  eicAtHomeMeasurementVisible: { url: HOME, html: page({ gpt: "EIC", measurementVisible: true }) },
  eicAtHomeExtraHog: { url: HOME, html: page({ gpt: "EIC", model: "Extra hög" }) },
  eicAtHomeMigrationBanner: { url: HOME, html: page({ gpt: "EIC", model: "Extra hög", banner: MIGRATION_BANNER }) }
})) {
  const { context, tab } = await open(browser, spec.url, spec.html);
  const g = await gate(tab, spec.url, EIC_ROOT);
  const state = (await call(tab, { type: "EIC_GF_GET_PAGE_STATE" }))?.state || {};
  rows[name] = { ...g, composerReady: state.composerReady === true, blockingUi: state.modelEvidence?.blockingUi === true,
    quotaActive: state.modelEvidence?.quota?.active === true, rateLimitActive: state.rateLimitWarning?.active === true,
    providerNotice: state.pageHealth?.providerNotice ?? null };
  await context.close();
}

{
  const { context, tab } = await open(browser, HOME, page({ gpt: "EIC" }));
  rows.discoveryCandidates = await call(tab, { type: "EIC_GF_GPT_CONVERSATION_LINKS" });
  await context.close();
}

for (const [name, pins] of Object.entries({ selectEic: ["Lycurgus III", "EIC"], selectAmbiguous: ["EIC", "EIC"], selectMissing: ["Lycurgus III"] })) {
  const { context, tab } = await open(browser, HOME, page({ pins }));
  const result = await call(tab, { type: "EIC_GF_SELECT_GPT", slug: "eic" });
  const clicks = await tab.evaluate(() => globalThis.__clicks);
  const after = await gate(tab, HOME, EIC_ROOT);
  rows[name] = { result, clicks, afterSurface: after.surface, afterGptSurface: after.gptSurface };
  await context.close();
}

for (const [name, thread] of Object.entries({
  noticeNewWithHeading: userTurn + assistantTurn(HEADING + NEW_NOTICE),
  noticeNewOnly: userTurn + assistantTurn(NEW_NOTICE),
  noticeOldWording: userTurn + assistantTurn(OLD_NOTICE),
  answerWithNewNotice: userTurn + assistantTurn(ANSWER + NEW_NOTICE),
  headingWithoutNotice: userTurn + assistantTurn(HEADING),
  noticeNewWithoutRoleNode: userTurn + assistantTurn(HEADING + NEW_NOTICE, false)
})) {
  const { context, tab } = await open(browser, CONVERSATION, page({ gpt: "", thread, stop: false }));
  const state = (await call(tab, { type: "EIC_GF_GET_PAGE_STATE", expectedUserTurnId: USER_ID, expectedUserIndex: 0 }))?.state || {};
  const a = state.autonomousTurn || {};
  rows[name] = { assistantFound: a.assistantFound === true, assistantText: String(a.assistantText || ""), providerNotice: state.pageHealth?.providerNotice ?? null };
  await context.close();
}
await browser.close();

const checks = [];
const check = (name, pass) => checks.push([name, Boolean(pass)]);
check("EIC at '/': pill and header read as 'EIC'", rows.eicAtHome.gptSurface.composerName === "EIC" && rows.eicAtHome.gptSurface.headerName === "EIC");
check("EIC at '/': surface verified by GPT name", rows.eicAtHome.surface.ok && rows.eicAtHome.surface.kind === "GPT_NAME_MATCH");
check("standard chat at '/': no GPT name, EIC_SURFACE_UNVERIFIED", !rows.standardAtHome.gptSurface.composerName && !rows.standardAtHome.gptSurface.headerName && rows.standardAtHome.proof.code === "EIC_SURFACE_UNVERIFIED");
check("another GPT at '/': EIC_SURFACE_UNVERIFIED (WRONG_GPT_NAME)", rows.otherGptAtHome.proof.code === "EIC_SURFACE_UNVERIFIED" && rows.otherGptAtHome.surface.kind === "WRONG_GPT_NAME");
check("slugless EIC conversation URL: verified by GPT id", rows.eicConversationSlugless.surface.ok && rows.eicConversationSlugless.surface.kind === "URL_GPT_ID");
// v1.8.9: "Pro" is the top thinking level by operator decision 2026-09-26
// (v1.8.7/1.8.8: THINKING_MODE_UNVERIFIED).
check("picker 'Pro' (effort medium): allowed as Heavy via the model picker, also under a Heavy floor",
  rows.eicAtHome.proof.allowed === true && rows.eicAtHome.effortEvidenceSource === "MODEL_SWITCHER_SELECTED_EFFORT" &&
  rows.eicAtHome.heavyFloor.allowed === true && rows.eicAtHomeMeasurementVisible.proof.allowed === true);
check("picker 'Extra hög' with EIC at '/': allowed", rows.eicAtHomeExtraHog.proof.allowed === true);
check("new composer (contenteditable, no #prompt-textarea) is ready", rows.eicAtHome.composerReady && rows.standardAtHome.composerReady);
check("model adapter unchanged (adapterVersion 5)", rows.eicAtHome.adapterVersion === 5);
check("GPT migration banner (assumed markup): no block, quota, rate limit or provider notice; still allowed",
  !rows.eicAtHomeMigrationBanner.blockingUi && !rows.eicAtHomeMigrationBanner.quotaActive && !rows.eicAtHomeMigrationBanner.rateLimitActive &&
  rows.eicAtHomeMigrationBanner.providerNotice === null && rows.eicAtHomeMigrationBanner.proof.allowed === true);
check("discovery candidates: GPT ids from Recents, most frequent first; no project or plain chats; ids and hrefs only",
  JSON.stringify(rows.discoveryCandidates) === JSON.stringify({ ok: true, candidates: [
    { gptId: "g-0a1b2c3d4e5f60718293a4b5c6d7e8f9", href: RECENT_LINKS[0][0] },
    { gptId: "g-ffeeddccbbaa99887766554433221100", href: RECENT_LINKS[1][0] }
  ] }));
check("select: clicks only the pinned EIC button", rows.selectEic.result?.ok && JSON.stringify(rows.selectEic.clicks) === JSON.stringify(["pin-1"]));
check("select: EIC then shown at '/' and verified", rows.selectEic.afterSurface.ok && rows.selectEic.afterGptSurface.composerName === "EIC");
check("select: two pinned 'EIC' -> PINNED_GPT_AMBIGUOUS, nothing clicked", rows.selectAmbiguous.result?.code === "PINNED_GPT_AMBIGUOUS" && rows.selectAmbiguous.clicks.length === 0);
check("select: EIC not pinned -> PINNED_GPT_NOT_FOUND, recent chat 'EIC' not clicked", rows.selectMissing.result?.code === "PINNED_GPT_NOT_FOUND" && rows.selectMissing.clicks.length === 0);
check("notice 'begäran' + heading 'Planerade åtkomst': assistant text empty", rows.noticeNewWithHeading.assistantFound && rows.noticeNewWithHeading.assistantText === "");
check("notice 'begäran' alone: assistant text empty", rows.noticeNewOnly.assistantText === "");
check("notice 'förfrågan' (v1.8.5 wording): assistant text empty", rows.noticeOldWording.assistantText === "");
check("answer + new notice: answer kept, notice removed", rows.answerWithNewNotice.assistantText === '{"ok":true,"answer":"EIC svar"}');
check("heading without notice is not stripped (boundary)", rows.headingWithoutNotice.assistantText === "Planerade åtkomst");
check("turn without role node: no assistant entry", !rows.noticeNewWithoutRoleNode.assistantFound);
for (const [name, row] of Object.entries(rows)) if ("assistantText" in row) check(`${name}: notice text never in assistant text`, !/Våra system bearbetar/.test(row.assistantText));

const out = {
  tool: "tools/verify-eic-surface.mjs",
  contentVersion: (fs.readFileSync(path.join(root, "content.js"), "utf8").match(/CONTENT_VERSION = "([^"]+)"/) || [])[1] || "",
  rows,
  checks: checks.map(([name, pass]) => ({ name, pass })),
  passed: checks.filter(([, pass]) => pass).length,
  total: checks.length
};
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify(out, null, 2)}\n`);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
console.log(`checks ${out.passed}/${out.total}`);
process.exitCode = out.passed === out.total ? 0 : 1;
