// v1.9.2 real-browser check: the Drift settings (Paus mellan analys och post,
// Max parallella, Grundparametrar för uppdragskö) must survive loading
// Greenfield from a new folder (new extension id) in the same Chrome profile.
// Operator request 2026-10-07: "lägga dem i samma valv" (as the run
// requirements in v1.9.1).
//
// The real, unmodified extension runs in Chromium with a real profile and
// bookmark store; sidepanel.html is opened as a tab and the settings are set
// through its own controls (range inputs fire "change", Spara grundparametrar
// is clicked). These save paths accept a panel opened as a tab, so unlike
// verify-safety-policy-vault.mjs no test copy is patched. Not part of
// `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-drift-settings-vault.mjs [out.json]
// GF_BASELINE_ROOT=<1.9.1 tree> adds the negative control and the upgrade in
// place (1.9.1 values -> copy 1.9.2 over the folder -> "Läs in igen").
// GF_CHROMIUM=<chrome binary> overrides Playwright's browser; GF_WORK_DIR=<dir>
// holds the temporary profiles and copies (default: the OS temp directory;
// keep it short, Chrome's singleton socket path is limited).
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = process.env.GF_BASELINE_ROOT ? path.resolve(process.env.GF_BASELINE_ROOT) : "";
const work = fs.mkdtempSync(path.join(process.env.GF_WORK_DIR || os.tmpdir(), "gf-v192-drift-"));
const SETTINGS_KEY = "eic.gf.operator.settings.v1";
const WANT = { postDelaySeconds: 45, maxActiveSessions: 4, defaultMissionQuantumInteractions: 12, queuePriorityAgingSeconds: 600, queueSwitchHardReload: false, queueSwitchDelaySeconds: 20, queueSwitchSettleSeconds: 9, warmQueueResume: false };
const DEFAULTS = { postDelaySeconds: 0, maxActiveSessions: 2, defaultMissionQuantumInteractions: 5, queuePriorityAgingSeconds: 180, queueSwitchHardReload: true, queueSwitchDelaySeconds: 5, queueSwitchSettleSeconds: 2, warmQueueResume: true };
const KEYS = Object.keys(WANT);
const SKIP = new Set(["tests", "dist", "verification", "node_modules", "tools"]);

function copyTree(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true, filter: (p) => !SKIP.has(path.relative(source, p).split(path.sep)[0]) });
  return target;
}
const matches = (values, want) => KEYS.every((k) => values?.[k] === want[k]);

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
      await page.waitForTimeout(4000);
      return page;
    };
    const observe = async (page) => ({
      stored: await page.evaluate(async ({ key, keys }) => {
        const row = (await chrome.storage.local.get(key))[key] || {};
        return { ...Object.fromEntries(keys.map((k) => [k, row[k] ?? null])), driftSettingsSavedAtMs: row.driftSettingsSavedAtMs ?? null, driftSettingsOrigin: row.driftSettingsOrigin ?? null };
      }, { key: SETTINGS_KEY, keys: KEYS }),
      controls: await page.evaluate((keys) => Object.fromEntries(keys.map((k) => {
        const el = document.getElementById(k === "postDelaySeconds" ? "postDelay" : k);
        return [k, !el ? null : el.type === "checkbox" ? el.checked : Number(el.value)];
      })), KEYS),
      vaultText: {
        runtime: await page.locator("#driftVaultStatusRuntime").textContent({ timeout: 500 }).catch(() => null),
        missions: await page.locator("#driftVaultStatus").textContent({ timeout: 500 }).catch(() => null)
      },
      background: await page.evaluate(async () => {
        const w = await chrome.windows.getCurrent();
        const r = await chrome.runtime.sendMessage({ type: "EIC_GF_GET_SNAPSHOT", windowId: w.id });
        const f = r?.fleetStatus || {};
        return { appVersion: f.appVersion, runtimeFault: f.runtimeFault, driftSettingsVault: f.driftSettingsVault ?? null, safetyVault: f.safetyVault?.state ?? null, configuredCapacity: f.configuredCapacity ?? null };
      }),
      statusDetail: await page.locator("#statusDetail").textContent({ timeout: 500 }).catch(() => null),
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
const setRange = (page, id, value) => page.locator(`#${id}`).evaluate((el, v) => {
  el.value = String(v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, value);
// Every Drift setting through the panel's own controls and save paths.
const save = async ({ openPanel, observe }) => {
  const page = await openPanel();
  const before = await observe(page);
  await page.click("#runtimeTabButton");
  await setRange(page, "postDelay", WANT.postDelaySeconds);
  await page.waitForTimeout(2500);
  await setRange(page, "maxActiveSessions", WANT.maxActiveSessions);
  await page.waitForTimeout(2500);
  await page.click("#missionsTabButton");
  for (const k of ["defaultMissionQuantumInteractions", "queuePriorityAgingSeconds", "queueSwitchDelaySeconds", "queueSwitchSettleSeconds"]) await page.fill(`#${k}`, String(WANT[k]));
  for (const k of ["queueSwitchHardReload", "warmQueueResume"]) await page.setChecked(`#${k}`, WANT[k]);
  await page.click("#saveQueueSettings");
  await page.waitForTimeout(6000); // the save, the vault write and several panel re-renders
  return { before, after: await observe(page) };
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

const version = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).version;
const out = { schema: "eic.greenfield.v192-drift-settings-vault-browser.v1", generatedAt: new Date().toISOString(), tree: version(root), baseline: baseline ? version(baseline) : null, want: WANT, scenarios: {} };
// 1. Reported case: save in folder A, load folder B (new id) in the same profile.
{
  const profile = path.join(work, "profile-new-folder");
  const a = await session(profile, copyTree(root, path.join(work, "folder-A")), save);
  const b = await session(profile, copyTree(root, path.join(work, "folder-B")), check);
  const savedInA = matches(a.after.stored, WANT) && a.after.background.driftSettingsVault?.state === "SAVED";
  const restoredInB = matches(b.observed.stored, WANT) && matches(b.observed.controls, WANT) && b.observed.background.driftSettingsVault?.state === "RESTORED" && b.observed.background.configuredCapacity === WANT.maxActiveSessions;
  out.scenarios.newFolder = { a, b, differentExtensionIds: a.extensionId !== b.extensionId, savedInA, restoredInB, pass: a.extensionId !== b.extensionId && savedInA && restoredInB };
}
if (baseline) {
  // 2. Negative control: the same steps with the baseline (1.9.1) show the defaults in B.
  const profile = path.join(work, "profile-negative");
  const a = await session(profile, copyTree(baseline, path.join(work, "baseline-A")), save);
  const b = await session(profile, copyTree(baseline, path.join(work, "baseline-B")), check);
  out.scenarios.negativeControlBaseline = { a, b, savedInA: matches(a.after.stored, WANT), defaultsInB: matches(b.observed.stored, DEFAULTS) || KEYS.every((k) => b.observed.stored[k] === null), pass: matches(a.after.stored, WANT) && (matches(b.observed.stored, DEFAULTS) || KEYS.every((k) => b.observed.stored[k] === null)) && matches(b.observed.controls, DEFAULTS) };
  // 3. Upgrade in place: baseline values, copy 1.9.2 over the same folder, "Läs in igen", then a new folder.
  const up = path.join(work, "profile-upgrade");
  const x = path.join(work, "upgrade-X");
  const x1 = await session(up, copyTree(baseline, x), save);
  copyTree(root, x);
  const x2 = await session(up, x, reloadThenCheck);
  const y = await session(up, copyTree(root, path.join(work, "upgrade-Y")), check);
  // Values saved before 1.9.2 have no save time: a non-default one enters the
  // vault with the legacy time 2, older than any real save
  // (operator-settings.mjs DRIFT_STAMP_LEGACY). Every WANT value is non-default.
  const legacyStamps = x2.afterReload.stored.driftSettingsSavedAtMs || {};
  const seeded = x2.afterReload.background.driftSettingsVault?.state === "SAVED" && KEYS.every((k) => legacyStamps[k] === 2);
  out.scenarios.upgradeInPlace = {
    x1, x2, y,
    sameIdAfterCopy: x1.extensionId === x2.extensionId,
    seededAfterReload: seeded,
    restoredInNewFolder: matches(y.observed.stored, WANT) && y.observed.background.driftSettingsVault?.state === "RESTORED",
    pass: x1.extensionId === x2.extensionId && matches(x1.after.stored, WANT) && matches(x2.afterReload.stored, WANT) && seeded && matches(y.observed.stored, WANT) && y.observed.background.driftSettingsVault?.state === "RESTORED"
  };
}
out.pass = Object.values(out.scenarios).every((s) => s.pass);
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ pass: out.pass, scenarios: Object.fromEntries(Object.entries(out.scenarios).map(([k, s]) => [k, s.pass])) }));
fs.rmSync(work, { recursive: true, force: true });
process.exit(out.pass ? 0 : 1);
