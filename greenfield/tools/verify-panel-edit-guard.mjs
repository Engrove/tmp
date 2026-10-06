// v1.9.0 real-browser check: the side panel's periodic re-render must not
// take a control away from the operator. Operator report 2026-10-06: a
// checkbox that was just clicked is reset, dropdowns reset, focused controls
// change under the cursor. The real sidepanel.html/sidepanel.js run in
// Chromium with in-memory chrome.storage and a background stub that, like a
// busy fleet, fires storage changes and process broadcasts several times a
// second (each one re-renders the panel). Not part of `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-panel-edit-guard.mjs [out.json]
// GF_PANEL_ROOT=<tree> runs another tree's panel (negative control).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = process.env.GF_PANEL_ROOT ? path.resolve(process.env.GF_PANEL_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://gf-panel.test";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const SETTINGS_KEY = "eic.gf.operator.settings.v1";
const SAVED = [
  { id: "mission-00000000-0000-4000-8000-000000000001", label: "Syntetiskt A", goal: "Projekt: 900 - Syntetiskt testprojekt - Gf: GF-901.", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
  { id: "mission-00000000-0000-4000-8000-000000000002", label: "Syntetiskt B", goal: "Projekt: 900 - Syntetiskt testprojekt - Gf: GF-902.", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }
];
const PROCESS = {
  processId: "process-00000000-0000-4000-8000-0000000000e1", runId: "run-00000000-0000-4000-8000-0000000000e1", workerId: "worker-test",
  windowId: 7, tabId: 70, phase: "WAITING", turn: 3, sessionSeq: 1, goal: SAVED[0].goal, schedulerPriority: "NORMAL",
  safety: { hold: null, proof: { allowed: true, model: "Extra hög", effort: "Extra hög" } },
  queueContext: { itemId: "queue-item-e1", queueId: "work-queue-test", interactionCount: 0, maxInteractions: 1 },
  updatedAt: new Date().toISOString(), lastMaterialAt: new Date().toISOString()
};
const QUEUE = {
  queueId: "work-queue-test", workerId: "worker-test", enabled: true, activeItemId: "queue-item-e1", cursorOrder: 0, history: [],
  items: [
    { itemId: "queue-item-e1", order: 0, label: "Syntetiskt A", goal: SAVED[0].goal, savedMissionId: SAVED[0].id, status: "ACTIVE", priority: "NORMAL", maxInteractions: 1 },
    { itemId: "queue-item-e2", order: 1, label: "Syntetiskt B", goal: SAVED[1].goal, savedMissionId: SAVED[1].id, status: "READY", priority: "NORMAL", maxInteractions: 3 }
  ]
};

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));
page.on("dialog", (dialog) => dialog.accept());
await page.route(`${ORIGIN}/**`, (route) => {
  const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: "" });
  return route.fulfill({ contentType: TYPES[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
});
await page.addInitScript(({ process: proc, queue, saved, settingsKey }) => {
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const data = { [settingsKey]: { savedMissions: saved, queueSwitchHardReload: true, workModeEnabled: false } };
  const changeListeners = [];
  const messageListeners = [];
  const area = {
    async get(key) {
      if (key == null) return clone(data);
      if (typeof key === "string") return data[key] === undefined ? {} : { [key]: clone(data[key]) };
      if (Array.isArray(key)) return Object.fromEntries(key.filter((k) => data[k] !== undefined).map((k) => [k, clone(data[k])]));
      return Object.fromEntries(Object.entries(key).map(([k, d]) => [k, data[k] === undefined ? d : clone(data[k])]));
    },
    async set(values) {
      Object.assign(data, clone(values));
      for (const listener of changeListeners) listener(Object.fromEntries(Object.keys(values).map((k) => [k, { newValue: clone(values[k]) }])), "local");
    },
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
  globalThis.__gfSent = [];
  // Another window saves settings (the panel must show them when not held).
  globalThis.__gfExternalSettings = (patch) => area.set({ [settingsKey]: { ...data[settingsKey], ...patch } });
  globalThis.LanguageModel = { async availability() { return "available"; }, async create() { return { async prompt() { return "READY"; }, destroy() {} }; } };
  globalThis.chrome = {
    runtime: {
      id: "panel-test",
      onMessage: { addListener(fn) { messageListeners.push(fn); }, removeListener() {} },
      async sendMessage(message) {
        globalThis.__gfSent.push(clone(message));
        if (message?.type === "EIC_GF_GET_SNAPSHOT") {
          return { ok: true, workerId: "worker-test", process: clone(proc), nextInstruction: null, missionQueue: clone(queue), missionQueueSets: [],
            fleetStatus: { generatedAt: new Date().toISOString(), activeCount: 1, usedCapacity: 1, effectiveCapacity: 2, waitingCount: 0, heldCount: 0,
              rateLimitState: "NORMAL", safety: { policy: {}, events: [] }, storage: { known: false }, recovery: { restored: [], unresolved: [], errors: [], checkpointRepairs: [] },
              workers: [{ process: clone(proc), queue: { enabled: true, activeItemId: queue.activeItemId, activeItem: { label: "Syntetiskt A" }, readyCount: 1, pausedCount: 0, blockedCount: 0, doneCount: 0, totalCount: 2 } }] } };
        }
        if (message?.type === "EIC_GF_SET_QUEUE_SETTINGS") {
          const next = { ...data[settingsKey], ...Object.fromEntries(Object.entries(message).filter(([k]) => !["type", "windowId", "workerId"].includes(k))) };
          await area.set({ [settingsKey]: next });
          return { ok: true, operatorSettings: clone(next) };
        }
        if (message?.type === "EIC_GF_QUEUE_MUTATE" && message.operation === "UPDATE") {
          const item = queue.items.find((entry) => entry.itemId === message.itemId);
          if (item && message.priority) item.priority = message.priority;
          if (item && message.maxInteractions) item.maxInteractions = message.maxInteractions;
          return { ok: true, missionQueue: clone(queue) };
        }
        if (message?.type === "EIC_GF_SET_WORK_MODE") {
          const next = { ...data[settingsKey], workModeEnabled: message.enabled === true, workModeEndpoint: message.endpoint };
          await area.set({ [settingsKey]: next });
          return { ok: true, operatorSettings: clone(next) };
        }
        return { ok: true };
      }
    },
    storage: { local: area, session: area, onChanged: { addListener(fn) { changeListeners.push(fn); }, removeListener() {} } },
    windows: { async getCurrent() { return { id: 7 }; } },
    // In-memory bookmark tree (the saved-mission vault), as in
    // tools/verify-saved-mission-admin.mjs.
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
  // A busy fleet: storage changes and process broadcasts several times per second.
  globalThis.__gfRerenders = 0;
  setInterval(() => {
    globalThis.__gfRerenders += 1;
    for (const listener of changeListeners) listener({ "eic.gf.global-capacity-scheduler.v1": { newValue: { tick: Date.now() } } }, "local");
    for (const listener of messageListeners) listener({ type: "EIC_GF_SNAPSHOT_CHANGED", workerId: "worker-test", process: clone(proc), nextInstruction: null, missionQueue: clone(queue) });
  }, 400);
}, { process: PROCESS, queue: QUEUE, saved: SAVED, settingsKey: SETTINGS_KEY });

await page.goto(`${ORIGIN}/sidepanel.html`);
await page.waitForSelector("#missionQueueList select[data-queue-field='priority']", { state: "attached", timeout: 60000 });
const showTab = (id) => page.click(`#${id}`, { force: true });
await page.waitForTimeout(1200);
const settle = () => page.waitForTimeout(2500); // ~6 re-renders
const tag = (selector, name) => page.evaluate(([s, n]) => { const el = document.querySelector(s); if (el) el.dataset.probe = n; return Boolean(el); }, [selector, name]);
const focusProbe = (name) => page.evaluate((n) => { const el = document.querySelector(`[data-probe='${n}']`); el?.focus(); return document.activeElement === el && Boolean(el); }, name);
const probe = (name) => page.evaluate((n) => {
  const el = document.querySelector(`[data-probe='${n}']`);
  return { present: Boolean(el), focused: Boolean(el) && document.activeElement === el, value: el?.value ?? null, checked: el?.checked ?? null, unsaved: Boolean(el?.classList.contains("gf-unsaved")) };
}, name);

// 1 queue settings checkbox (saved with a button)
await showTab("missionsTabButton");
await page.evaluate(() => { document.querySelector("#queueSwitchHardReload").scrollIntoView(); });
await tag("#queueSwitchHardReload", "hardReload");
await page.click("#queueSwitchHardReload", { force: true });
await page.click("h1", { force: true }); // focus elsewhere
await settle();
const hardReload = await probe("hardReload");

// 2 Aktivera Arbetsläge
await showTab("workModeTabButton");
await page.evaluate(() => { document.querySelector("#workModeEnabled").scrollIntoView(); });
await tag("#workModeEnabled", "workMode");
const workModeBefore = await page.evaluate(() => document.querySelector("#workModeEnabled").checked);
await page.click("#workModeEnabled", { force: true });
await page.click("h1", { force: true });
await settle();
const workMode = await probe("workMode");

// 3 a queue row's priority dropdown that has focus (open)
await showTab("missionsTabButton");
await tag("#missionQueueList select[data-queue-field='priority']", "rowPriority");
await focusProbe("rowPriority");
await settle();
const rowPriority = await probe("rowPriority");

// 4 typing in a queue row's quantum field
await tag("#missionQueueList .queue-row:nth-child(2) input[data-queue-field='maxInteractions']", "rowQuantum");
await focusProbe("rowQuantum");
await page.keyboard.press("Control+A");
await page.keyboard.type("7");
await settle();
const rowQuantum = await probe("rowQuantum");
await page.click("h1", { force: true });

// 5 an instruction draft, then the cursor leaves the field
await showTab("runtimeTabButton");
await tag("#nextInstruction", "instruction");
await focusProbe("instruction");
await page.keyboard.type("Utkast till tilläggsinstruktion");
await page.click("h1", { force: true });
await settle();
const instruction = await probe("instruction");

// 6 a numeric queue setting being typed into
await showTab("missionsTabButton");
await tag("#queueSwitchDelaySeconds", "delay");
await focusProbe("delay");
await page.keyboard.press("Control+A");
await page.keyboard.type("17");
await settle();
const delay = await probe("delay");
await page.click("h1", { force: true });

// 7 saving the queue settings keeps the saved values and clears the marks
await page.click("#saveQueueSettings", { force: true });
await settle();
const afterSave = await page.evaluate(() => ({
  hardReload: document.querySelector("#queueSwitchHardReload").checked,
  delay: document.querySelector("#queueSwitchDelaySeconds").value,
  unsaved: [...document.querySelectorAll("#queueSwitchHardReload.gf-unsaved, #queueSwitchDelaySeconds.gf-unsaved")].length
}));

// 8 a committed queue-row change is shown at once and the cursor stays on it
await tag("#missionQueueList .queue-row:nth-child(2) select[data-queue-field='priority']", "rowCommit");
await focusProbe("rowCommit");
await page.selectOption("[data-probe='rowCommit']", "HIGH");
await settle();
const rowCommit = await page.evaluate(() => {
  const select = document.querySelector("#missionQueueList .queue-row:nth-child(2) select[data-queue-field='priority']");
  const row = select?.closest(".queue-row");
  return { rebuilt: Boolean(select) && !select.dataset.probe, value: select?.value ?? null, focused: document.activeElement === select,
    meta: row?.querySelector(".queue-row-meta")?.textContent || "", label: select?.selectedOptions?.[0]?.textContent || "" };
});
await page.click("h1", { force: true });

// 9 a value saved elsewhere is shown when the operator does not hold the control
await page.evaluate(() => globalThis.__gfExternalSettings({ queueSwitchSettleSeconds: 4 }));
await settle();
const external = await page.evaluate(() => ({ settle: document.querySelector("#queueSwitchSettleSeconds").value,
  unsaved: document.querySelector("#queueSwitchSettleSeconds").classList.contains("gf-unsaved") }));
const sentSettings = await page.evaluate(() => globalThis.__gfSent.filter((m) => m.type === "EIC_GF_SET_QUEUE_SETTINGS").at(-1) || null);
const rerenders = await page.evaluate(() => globalThis.__gfRerenders);
await browser.close();

const checks = [
  ["re-renders happened while editing (stub fired storage changes and broadcasts)", rerenders >= 20],
  ["a clicked queue-settings checkbox stays as clicked through re-renders (marked unsaved)", hardReload.present && hardReload.checked === false && hardReload.unsaved],
  ["Aktivera Arbetsläge stays as clicked through re-renders", workMode.present && workMode.checked === !workModeBefore],
  ["a focused (open) queue-row dropdown is not rebuilt under the cursor", rowPriority.present && rowPriority.focused],
  ["typing in a queue row's quantum field is not overwritten and keeps focus", rowQuantum.present && rowQuantum.focused && rowQuantum.value === "7"],
  ["an unsent instruction draft survives re-renders after the cursor leaves", instruction.present && instruction.value === "Utkast till tilläggsinstruktion"],
  ["a numeric setting being typed keeps the typed value", delay.present && delay.focused && delay.value === "17"],
  ["Spara grundparametrar sends the edited values", sentSettings?.queueSwitchHardReload === false && Number(sentSettings?.queueSwitchDelaySeconds) === 17],
  ["after saving, the controls show the saved values and are no longer marked unsaved", afterSave.hardReload === false && afterSave.delay === "17" && afterSave.unsaved === 0],
  ["a committed queue-row change is shown at once (row rebuilt) and keeps the cursor", rowCommit.rebuilt && rowCommit.value === "HIGH" && rowCommit.focused && Boolean(rowCommit.label) && rowCommit.meta.startsWith(rowCommit.label)],
  ["a setting saved elsewhere is shown when the control is not held", external.settle === "4" && !external.unsaved],
  ["no page errors", pageErrors.length === 0]
];
const out = { tool: "tools/verify-panel-edit-guard.mjs", root: process.env.GF_PANEL_ROOT ? "GF_PANEL_ROOT" : "this tree", rerenders,
  observed: { hardReload, workMode, workModeBefore, rowPriority, rowQuantum, instruction, delay, afterSave, rowCommit, external, sentSettings }, pageErrors,
  checks: checks.map(([name, pass]) => ({ name, pass: Boolean(pass) })), passed: checks.filter(([, pass]) => pass).length, total: checks.length };
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify(out, null, 2)}\n`);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
console.log(`checks ${out.passed}/${out.total}`);
process.exitCode = out.passed === out.total ? 0 : 1;
