// v1.9.1 real-browser check: saved run requirements (Körkrav) must survive
// loading Greenfield from a new folder (new extension id) in the same Chrome
// profile. Operator report 2026-10-07: "Spara körkrav sparas inte bestående,
// värdena återgår till standard om man startar upp Greenfield initialt igen."
//
// The real extension (background.js + sidepanel) runs in Chromium with a real
// profile and bookmark store. Playwright cannot open the side panel itself,
// so sidepanel.html is opened as a tab; each test copy therefore relaxes the
// panel sender check (`sender.tab` / exact URL) and nothing else. Not part of
// `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-safety-policy-vault.mjs [out.json]
// GF_BASELINE_ROOT=<1.9.0 tree> adds the negative control and the upgrade in
// place (1.9.0 values -> copy 1.9.1 over the folder -> "Läs in igen").
// GF_CHROMIUM=<chrome binary> overrides Playwright's browser; GF_WORK_DIR=<dir>
// holds the temporary profiles and copies (default: the OS temp directory).
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = process.env.GF_BASELINE_ROOT ? path.resolve(process.env.GF_BASELINE_ROOT) : "";
// Profiles and test copies go here. Keep TMPDIR short: Chrome puts its
// singleton socket there and a long path exceeds the Unix socket limit.
const work = fs.mkdtempSync(path.join(process.env.GF_WORK_DIR || os.tmpdir(), "gf-v191-vault-"));
const FIELDS = ["requiredModel", "minimumEffort", "messages3h", "messages24h", "messages7d", "minGapSeconds", "tokens24h", "maxPromptTokens", "outputReserveTokens"];
const WANT = { messages3h: "48", messages24h: "256", messages7d: "1024", minGapSeconds: "180", tokens24h: "3600000", maxPromptTokens: "30000", outputReserveTokens: "8192" };
const DEFAULTS = { messages3h: "24", messages24h: "96", messages7d: "400", minGapSeconds: "180", tokens24h: "800000", maxPromptTokens: "24000", outputReserveTokens: "8192" };
const SENDER_CHECK = 'if (sender?.id!==chrome.runtime.id || sender?.tab || sender?.url!==chrome.runtime.getURL("sidepanel.html")) throw new Error("SAFETY_PANEL_SENDER_REQUIRED");';
const SENDER_TEST = 'if (sender?.id!==chrome.runtime.id || !String(sender?.url||"").startsWith(chrome.runtime.getURL("sidepanel.html"))) throw new Error("SAFETY_PANEL_SENDER_REQUIRED"); // TEST COPY ONLY: panel opened as a tab';
const SKIP = new Set(["tests", "dist", "verification", "node_modules", "tools"]);

function testCopy(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true, filter: (p) => !SKIP.has(path.relative(source, p).split(path.sep)[0]) });
  const file = path.join(target, "background.js");
  const text = fs.readFileSync(file, "utf8");
  if (text.split(SENDER_CHECK).length !== 2) throw new Error(`SENDER_CHECK_NOT_FOUND_ONCE:${source}`);
  fs.writeFileSync(file, text.replace(SENDER_CHECK, SENDER_TEST));
  return target;
}
const matches = (form, want) => Object.entries(want).every(([k, v]) => form?.[k] === v);

async function session(profile, ext, work) {
  const ctx = await chromium.launchPersistentContext(profile, {
    ...(process.env.GF_CHROMIUM ? { executablePath: process.env.GF_CHROMIUM } : {}),
    headless: false,
    args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
  });
  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: 15000 });
    const id = new URL(sw.url()).host;
    const errors = [];
    const openPanel = async () => {
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(e.message.slice(0, 300)));
      await page.goto(`chrome-extension://${id}/sidepanel.html`);
      await page.click("#runtimeTabButton");
      await page.waitForTimeout(4000);
      return page;
    };
    const observe = async (page) => ({
      form: Object.fromEntries(await Promise.all(FIELDS.map(async (f) => [f, await page.inputValue(`#${f}`)]))),
      vaultText: await page.locator("#safetyVaultStatus").textContent({ timeout: 500 }).catch(() => null),
      background: await page.evaluate(async () => {
        const w = await chrome.windows.getCurrent();
        const r = await chrome.runtime.sendMessage({ type: "EIC_GF_GET_SNAPSHOT", windowId: w.id });
        const f = r?.fleetStatus || {};
        return { appVersion: f.appVersion, runtimeFault: f.runtimeFault, safetyVault: f.safetyVault ?? null, policyOrigin: f.safety?.policyOrigin ?? null, lastSafetyEvent: (f.safety?.events || []).at(-1) || null };
      }),
      // Read from the panel page: after "Läs in igen" the first worker handle is gone.
      vaultBookmarks: await page.evaluate(async () => {
        const hits = await chrome.bookmarks.search({ title: "EIC Greenfield · Run requirements v1" });
        const out = [];
        for (const f of hits) out.push({ parentId: f.parentId, children: (await chrome.bookmarks.getSubTree(f.id))[0].children.map((c) => ({ title: c.title, chunks: (c.children || []).length })) });
        return out;
      }),
      manifestVersion: await page.evaluate(() => chrome.runtime.getManifest().version)
    });
    const result = await work({ ctx, id, openPanel, observe });
    return { extensionId: id, ...result, pageErrors: errors };
  } finally {
    await ctx.close();
  }
}
const save = async ({ openPanel, observe }) => {
  const page = await openPanel();
  const before = await observe(page);
  for (const [k, v] of Object.entries(WANT)) await page.fill(`#${k}`, v);
  await page.click("#safetyPolicyForm button[type=submit]");
  await page.waitForFunction(() => /sparad|fel|SAFETY/i.test(document.querySelector("#safetyActionResult").textContent), null, { timeout: 15000 });
  const saveResult = await page.textContent("#safetyActionResult");
  await page.waitForTimeout(6000); // several panel re-renders after the save
  return { before, saveResult, after: await observe(page) };
};
const check = async ({ openPanel, observe }) => ({ observed: await observe(await openPanel()) });
// The documented update step: chrome://extensions -> "Läs in igen" on the unpacked extension.
const reloadThenCheck = async ({ ctx, id, openPanel, observe }) => {
  const stale = await observe(await openPanel());
  const ext = await ctx.newPage();
  await ext.goto("chrome://extensions");
  await ext.waitForTimeout(1500);
  const dev = ext.locator("extensions-manager extensions-toolbar #devMode");
  if ((await dev.getAttribute("aria-pressed")) !== "true") await dev.click();
  await ext.waitForTimeout(800);
  await ext.locator(`extensions-item#${id} #dev-reload-button`).click();
  await ext.waitForTimeout(4000);
  return { beforeReload: stale, afterReload: await observe(await openPanel()) };
};

const out = { schema: "eic.greenfield.v191-safety-policy-vault-browser.v1", generatedAt: new Date().toISOString(), tree: JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")).version, baseline: baseline ? JSON.parse(fs.readFileSync(path.join(baseline, "manifest.json"), "utf8")).version : null, scenarios: {} };
// 1. Reported case: save in folder A, load folder B (new id) in the same profile.
{
  const profile = path.join(work, "profile-new-folder");
  const a = await session(profile, testCopy(root, path.join(work, "v191-folder-A")), save);
  const b = await session(profile, testCopy(root, path.join(work, "v191-folder-B")), check);
  out.scenarios.newFolder = {
    a, b,
    differentExtensionIds: a.extensionId !== b.extensionId,
    savedInA: matches(a.after.form, WANT),
    restoredInB: matches(b.observed.form, WANT) && b.observed.background.safetyVault?.state === "RESTORED",
    pass: a.extensionId !== b.extensionId && matches(a.after.form, WANT) && matches(b.observed.form, WANT) && b.observed.background.safetyVault?.state === "RESTORED"
  };
}
if (baseline) {
  // 2. Negative control: the same steps with the baseline (1.9.0) show the defaults.
  const profile = path.join(work, "profile-negative");
  const a = await session(profile, testCopy(baseline, path.join(work, "baseline-folder-A")), save);
  const b = await session(profile, testCopy(baseline, path.join(work, "baseline-folder-B")), check);
  out.scenarios.negativeControlBaseline = { a, b, savedInA: matches(a.after.form, WANT), defaultsInB: matches(b.observed.form, DEFAULTS), pass: matches(a.after.form, WANT) && matches(b.observed.form, DEFAULTS) };
  // 3. Upgrade in place: baseline values, copy 1.9.1 over the same folder, "Läs in igen", then a new folder.
  const up = path.join(work, "profile-upgrade");
  const x = path.join(work, "upgrade-folder-X");
  const x1 = await session(up, testCopy(baseline, x), save);
  testCopy(root, x);
  const x2 = await session(up, x, reloadThenCheck);
  const y = await session(up, testCopy(root, path.join(work, "upgrade-folder-Y")), check);
  out.scenarios.upgradeInPlace = {
    x1, x2, y,
    sameIdAfterCopy: x1.extensionId === x2.extensionId,
    seededAfterReload: x2.afterReload.background.safetyVault?.state === "SAVED" && x2.afterReload.background.safetyVault?.reason === "VAULT_EMPTY_LEGACY_LOCAL_POLICY",
    restoredInNewFolder: matches(y.observed.form, WANT) && y.observed.background.safetyVault?.state === "RESTORED",
    pass: x1.extensionId === x2.extensionId && matches(x2.afterReload.form, WANT) && x2.afterReload.background.safetyVault?.state === "SAVED" && matches(y.observed.form, WANT) && y.observed.background.safetyVault?.state === "RESTORED"
  };
}
out.pass = Object.values(out.scenarios).every((s) => s.pass);
const text = JSON.stringify(out, null, 2);
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${text}\n`);
console.log(JSON.stringify({ pass: out.pass, scenarios: Object.fromEntries(Object.entries(out.scenarios).map(([k, s]) => [k, s.pass])) }));
fs.rmSync(work, { recursive: true, force: true });
process.exit(out.pass ? 0 : 1);
