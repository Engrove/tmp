// v1.8.5 real-browser check of the saved-mission administration in the side
// panel: the real sidepanel.html/sidepanel.js/lib modules run in Chromium with
// in-memory chrome.storage and chrome.bookmarks (the durable vault). The
// background is a stub that records messages. Not part of `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-saved-mission-admin.mjs [out.json]
// IMPORT_FILE=<markdown with ### GF-xxx sections> replaces the built-in import.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://gf-panel.test";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const t = (key, project, body) => `Projekt: ${project} - Gf: ${key}.\n${body}`;
const LEGACY = [
  { id: "legacy-gf001", label: "old", goal: t("GF-001", "63 - Greenfield", "Gammal text v2."), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" },
  { id: "legacy-gf001-old", label: "old", goal: t("GF-001", "63 - Greenfield", "Gammal text v1."), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "legacy-free", label: "Fritt uppdrag", goal: "Fritt uppdrag utan GF-ID", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
];
const BUILTIN_IMPORT = [
  "Normaliserade texter.", "",
  "### GF-001", "", t("GF-001", "63 - Greenfield", "Fullfölj arbetet med Greenfield.\nUppdraget är slutfört först när …"), "",
  "### GF-008", "", t("GF-008", "67 - EIC Learning", "Fullfölj arbetet med EIC Learning."), "",
  "### GF-WC-RE-001", "", t("GF-WC-RE-001", "67 - EIC Learning", "Research som lämnas till GF-008."), "",
  "Det centrala i samtliga texter …"
].join("\n");
const importText = process.env.IMPORT_FILE ? fs.readFileSync(process.env.IMPORT_FILE, "utf8") : BUILTIN_IMPORT;

const browser = await chromium.launch();
const pageErrors = [];
async function openPanel(legacySeed) {
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));
await page.route(`${ORIGIN}/**`, (route) => {
  const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: "" });
  return route.fulfill({ contentType: TYPES[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
});
await page.addInitScript((legacy) => {
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const data = { "eic.gf.operator.settings.v1": { savedMissions: legacy } };
  const listeners = [];
  const area = {
    async get(key) {
      if (key == null) return clone(data);
      if (typeof key === "string") return data[key] === undefined ? {} : { [key]: clone(data[key]) };
      if (Array.isArray(key)) return Object.fromEntries(key.filter((k) => data[k] !== undefined).map((k) => [k, clone(data[k])]));
      return Object.fromEntries(Object.entries(key).map(([k, d]) => [k, data[k] === undefined ? d : clone(data[k])]));
    },
    async set(values) { Object.assign(data, clone(values)); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; }
  };
  let nextId = 10;
  const nodes = new Map();
  const treeRoot = { id: "0", title: "", children: [] };
  const other = { id: "2", parentId: "0", title: "Other bookmarks", children: [] };
  treeRoot.children.push(other);
  nodes.set("0", treeRoot);
  nodes.set("2", other);
  const strip = (node) => { const out = { ...node }; delete out.children; return clone(out); };
  const removeRecursive = (id) => {
    const node = nodes.get(String(id));
    if (!node) return;
    for (const child of node.children || []) removeRecursive(child.id);
    const parent = nodes.get(String(node.parentId));
    if (parent?.children) parent.children = parent.children.filter((child) => child.id !== node.id);
    nodes.delete(node.id);
  };
  const sent = [];
  globalThis.__gfSent = sent;
  globalThis.chrome = {
    runtime: {
      id: "panel-test",
      onMessage: { addListener() {}, removeListener() {} },
      async sendMessage(message) {
        sent.push(clone(message));
        if (message?.type === "EIC_GF_GET_SNAPSHOT") return { ok: true, workerId: "worker-test", process: null, missionQueue: null, missionQueueSets: [] };
        if (message?.type === "EIC_GF_SAVED_MISSIONS_CHANGED") {
          return { ok: true, summary: { setsChanged: 1, setItemsChanged: 2, setItemsUnresolved: 0, queueSlotsChanged: 0, queueSlotsUnresolved: 0 }, missionQueueSets: [] };
        }
        return { ok: true };
      }
    },
    storage: { local: area, session: area, onChanged: { addListener() {}, removeListener() {} } },
    windows: { async getCurrent() { return { id: 7 }; } },
    bookmarks: {
      async getTree() { return [clone(treeRoot)]; },
      async getChildren(id) { return (nodes.get(String(id))?.children || []).map(strip); },
      async create({ parentId, title = "", url }) {
        const parent = nodes.get(String(parentId));
        const id = String(nextId++);
        const node = { id, parentId: String(parentId), title: String(title), ...(url ? { url: String(url) } : { children: [] }) };
        nodes.set(id, node);
        parent.children.push(node);
        return strip(node);
      },
      async update(id, changes = {}) {
        const node = nodes.get(String(id));
        if (Object.hasOwn(changes, "title")) node.title = String(changes.title);
        return strip(node);
      },
      async removeTree(id) { removeRecursive(id); }
    }
  };
}, legacySeed);

await page.goto(`${ORIGIN}/sidepanel.html`);
await page.waitForFunction(() => document.getElementById("savedMissionAdminSelect")?.options.length > 1, null, { timeout: 60000 });
return page;
}

const page = await openPanel(LEGACY);
const results = {};
results.initialRuntimeCount = await page.textContent("#savedMissionCount");
results.initialCleanupRows = await page.$$eval("#savedMissionCleanupList .row", (rows) => rows.map((r) => r.textContent.replace(/\s+/g, " ").trim()));
await page.click("#missionsTabButton");
const status = () => page.textContent("#savedMissionAdminStatus");
const sentOfType = async (type) => page.evaluate((kind) => globalThis.__gfSent.filter((row) => row.type === kind), type);

results.initialState = await page.textContent("#savedMissionAdminState");
results.initialOptions = await page.$$eval("#savedMissionAdminSelect option", (opts) => opts.map((o) => o.textContent));

await page.click("#savedMissionImportDetails summary");
await page.fill("#savedMissionImportText", importText);
await page.click("#savedMissionImportPreview");
results.previewStatus = await status();
results.previewRows = await page.$$eval("#savedMissionImportPreviewList .row", (rows) => rows.map((r) => r.textContent.replace(/\s+/g, " ").trim()));
results.applyEnabledAfterPreview = !(await page.isDisabled("#savedMissionImportApply"));
await page.fill("#savedMissionImportText", `${importText}\n`);
results.applyDisabledAfterEdit = await page.isDisabled("#savedMissionImportApply");
await page.fill("#savedMissionImportText", importText);
await page.click("#savedMissionImportPreview");
await page.click("#savedMissionImportApply");
await page.waitForFunction(() => /Import klar|kan inte|Max|läsas tillbaka/.test(document.getElementById("savedMissionAdminStatus").textContent), null, { timeout: 60000 });
results.importStatus = await status();
results.importMessages = (await sentOfType("EIC_GF_SAVED_MISSIONS_CHANGED")).map((row) => ({ reason: row.reason, merged: row.merged }));
results.afterImportState = await page.textContent("#savedMissionAdminState");
results.afterImportOptions = await page.$$eval("#savedMissionAdminSelect option", (opts) => opts.map((o) => o.textContent));

const gf001 = await page.$eval("#savedMissionAdminSelect", (select) => [...select.options].find((o) => o.textContent.startsWith("GF-001 "))?.value || "");
await page.selectOption("#savedMissionAdminSelect", gf001);
await page.click("#savedMissionEdit");
results.editorLoaded = (await page.inputValue("#savedMissionEditor")).startsWith("Projekt: 63 - Greenfield - Gf: GF-001.");
results.updateDisabledUntilChanged = await page.isDisabled("#savedMissionUpdate");
await page.fill("#savedMissionEditor", `${await page.inputValue("#savedMissionEditor")}\nTillägg från panelen.`);
await page.click("#savedMissionUpdate");
await page.waitForFunction(() => /Uppdaterade|finns redan|Max/.test(document.getElementById("savedMissionAdminStatus").textContent), null, { timeout: 30000 });
results.updateStatus = await status();
results.updateKeptId = (await page.$eval("#savedMissionAdminMeta", (el) => el.textContent)).includes(`id ${gf001}`);
await page.click("#savedMissionCreate");
await page.waitForFunction(() => /finns redan/.test(document.getElementById("savedMissionAdminStatus").textContent), null, { timeout: 30000 });
results.createConflictStatus = await status();

const free = await page.$eval("#savedMissionAdminSelect", (select) => [...select.options].find((o) => o.textContent.startsWith("Fritt"))?.value || "");
await page.selectOption("#savedMissionAdminSelect", free);
await page.click("#savedMissionAdminDelete");
results.deleteArmedLabel = await page.textContent("#savedMissionAdminDelete");
await page.click("#savedMissionAdminDelete");
await page.waitForFunction(() => /Tog bort/.test(document.getElementById("savedMissionAdminStatus").textContent), null, { timeout: 30000 });
results.deleteStatus = await status();
results.afterDeleteState = await page.textContent("#savedMissionAdminState");

const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click("#savedMissionExport")]);
const exportPath = await download.path();
const exported = JSON.parse(fs.readFileSync(exportPath, "utf8"));
results.exportFile = download.suggestedFilename();
results.exportCount = exported.count;
results.exportSchema = exported.schema;
results.runtimeSavedMissionsOptions = await page.$$eval("#savedMissionSelect option", (opts) => opts.length - 1);

// Full vault: 62 keyed + 1 older duplicate + 1 without key = 64.
const FULL = [];
for (let i = 1; i <= 62; i += 1) {
  const key = `GF-${String(100 + i)}`;
  FULL.push({ id: `k${i}`, label: key, goal: t(key, "71 - Greenfield Works", `Uppdrag ${i}.`), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: `2026-03-01T00:00:${String(i % 60).padStart(2, "0")}.000Z` });
}
FULL.push({ id: "dup-old", label: "dup", goal: t("GF-101", "71 - Greenfield Works", "Äldre kopia."), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
FULL.push({ id: "nokey", label: "Utan nyckel", goal: "Uppdrag utan GF-ID", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
const full = await openPanel(FULL);
await full.click("#runtimeTabButton");
const fullStatus = () => full.textContent("#savedMissionRuntimeStatus");
results.full = {};
results.full.runtimeCount = await full.textContent("#savedMissionCount");
results.full.countIsRed = await full.$eval("#savedMissionCount", (el) => el.classList.contains("full"));
await full.fill("#goal", t("GF-900", "71 - Greenfield Works", "Nytt uppdrag."));
await full.click("#saveMission");
await full.waitForFunction(() => document.getElementById("savedMissionRuntimeStatus").textContent.length > 0, null, { timeout: 30000 });
results.full.refusedStatus = await fullStatus();
results.full.refusedIsError = await full.$eval("#savedMissionRuntimeStatus", (el) => el.classList.contains("error"));
results.full.countAfterRefusal = await full.textContent("#savedMissionCount");
await full.fill("#goal", t("GF-101", "71 - Greenfield Works", "Uppdrag 1, ny formulering."));
await full.click("#saveMission");
await full.waitForFunction(() => /Uppdaterade GF-101/.test(document.getElementById("savedMissionRuntimeStatus").textContent), null, { timeout: 30000 });
results.full.updateAtLimitStatus = await fullStatus();
await full.click("#missionsTabButton");
results.full.adminState = await full.textContent("#savedMissionAdminState");
results.full.flagged = await full.$$eval("#savedMissionCleanupList .row.changed", (rows) => rows.map((r) => r.textContent.replace(/\s+/g, " ").trim()));
await full.click("#savedMissionCleanupDetails summary");
await full.check('#savedMissionCleanupList input[data-cleanup-id="dup-old"]');
await full.click("#savedMissionCleanupDelete");
results.full.cleanupArmedLabel = await full.textContent("#savedMissionCleanupDelete");
await full.click("#savedMissionCleanupDelete");
await full.waitForFunction(() => /Tog bort/.test(document.getElementById("savedMissionAdminStatus").textContent), null, { timeout: 30000 });
results.full.cleanupStatus = await full.textContent("#savedMissionAdminStatus");
results.full.cleanupMessage = (await full.evaluate(() => globalThis.__gfSent.filter((row) => row.type === "EIC_GF_SAVED_MISSIONS_CHANGED" && row.reason === "CLEANUP"))).map((row) => row.merged);
await full.click("#runtimeTabButton");
await full.fill("#goal", t("GF-900", "71 - Greenfield Works", "Nytt uppdrag."));
await full.click("#saveMission");
await full.waitForFunction(() => /Sparade GF-900/.test(document.getElementById("savedMissionRuntimeStatus").textContent), null, { timeout: 30000 });
results.full.createAfterCleanupStatus = await fullStatus();
results.full.finalCount = await full.textContent("#savedMissionCount");

results.pageErrors = pageErrors;
await browser.close();

const expectBuiltin = !process.env.IMPORT_FILE;
const checks = [
  ["legacy missions migrate and show the duplicate count", /^3 \/ 64 · 1 GF-ID med dubbletter$/.test(results.initialState)],
  ["preview enables apply; editing the text disables it again", results.applyEnabledAfterPreview && results.applyDisabledAfterEdit],
  ["import applied with durable readback", /^Import klar/.test(results.importStatus) && /återläst ur bokmärkesvalvet/.test(results.importStatus)],
  ["import notifies the background (queue sets / queue) once with the merge map", results.importMessages.length === 1 &&
    results.importMessages[0].reason === "IMPORT" && results.importMessages[0].merged["legacy-gf001-old"] === "legacy-gf001"],
  ["no duplicate GF key remains after import", !/dubbletter/.test(results.afterImportState)],
  ["editor loads the selected mission; 'Spara ändring' only after a change", results.editorLoaded && results.updateDisabledUntilChanged],
  ["'Spara ändring' keeps the same id", /^Uppdaterade GF-001 \(samma id\)/.test(results.updateStatus) && results.updateKeptId && gf001 === "legacy-gf001"],
  ["'Spara som nytt' with an existing GF key is refused", /finns redan/.test(results.createConflictStatus)],
  ["delete needs a second click", results.deleteArmedLabel === "Bekräfta borttagning" && /^Tog bort/.test(results.deleteStatus)],
  ["export downloads every saved mission", results.exportSchema === "eic.greenfield.saved-missions-export.v1" && results.exportCount === Number(results.afterDeleteState.split(" ")[0])],
  ["runtime block shows the count and flags duplicate/no-key cleanup candidates", results.initialRuntimeCount === "3/64" &&
    results.initialCleanupRows.filter((row) => /äldre dubblett|utan GF-ID/.test(row)).length === 2],
  ["full vault: count shows 64/64 · fullt in red", results.full.runtimeCount === "64/64 · fullt" && results.full.countIsRed],
  ["full vault: a new mission is refused with a visible error and nothing is deleted",
    /^Max 64 sparade uppdrag/.test(results.full.refusedStatus) && results.full.refusedIsError && results.full.countAfterRefusal === "64/64 · fullt"],
  ["full vault: updating an existing GF key still works", /^Uppdaterade GF-101 \(samma id\)/.test(results.full.updateAtLimitStatus)],
  ["cleanup flags exactly the older duplicate and the mission without key", results.full.flagged.length === 2 &&
    results.full.flagged.some((row) => /GF-101/.test(row) && /äldre dubblett/.test(row)) && results.full.flagged.some((row) => /utan GF-ID/.test(row))],
  ["cleanup needs confirmation and moves the duplicate's references to the newer record",
    results.full.cleanupArmedLabel === "Bekräfta borttagning av 1" && /^Tog bort 1 sparade uppdrag; 1 dubbletters/.test(results.full.cleanupStatus) &&
    results.full.cleanupMessage.length === 1 && results.full.cleanupMessage[0]["dup-old"] === "k1"],
  ["after cleanup the new mission fits: 64/64", /^Sparade GF-900 som nytt uppdrag/.test(results.full.createAfterCleanupStatus) && results.full.finalCount === "64/64 · fullt"],
  ["no page errors", results.pageErrors.length === 0]
];
if (expectBuiltin) {
  checks.push(["built-in import preview: 2 new, 1 changed, 1 duplicate merged, prose ignored",
    /3 i importen: 2 nya, 1 ändras, 0 oförändrade, 1 dubbletter slås ihop/.test(results.previewStatus) &&
    results.previewRows.some((row) => row.startsWith("GF-WC-RE-001") && /1 rader efter tomrad ignoreras/.test(row))]);
  checks.push(["built-in import result: 4 saved missions", /^4 \/ 64$/.test(results.afterImportState)]);
}
const report = { tool: "tools/verify-saved-mission-admin.mjs", importSource: process.env.IMPORT_FILE ? "IMPORT_FILE" : "BUILTIN", results, checks: checks.map(([name, pass]) => ({ name, pass: Boolean(pass) })) };
const outFile = process.argv[2];
if (outFile) fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
console.log(`checks ${checks.filter(([, pass]) => pass).length}/${checks.length}`);
process.exitCode = checks.every(([, pass]) => pass) ? 0 : 1;
