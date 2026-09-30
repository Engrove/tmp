// v1.8.12 real-browser check of the reserved slot in the side panel: the real
// sidepanel.html/sidepanel.js run in Chromium with in-memory chrome.storage
// and a background stub. The fleet status holds two workers; the panel's own
// window (worker-test) owns the reserved slot at Max parallella 2. Checks the
// Drift controls, the card badge, the card button for the other window
// (asks first, sends that window's binding) and the toggle for this window.
// Not part of `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-reserved-slot-panel.mjs [out.json]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://gf-panel.test";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const PROCESS = {
  processId: "process-00000000-0000-4000-8000-0000000000c1", workerId: "worker-test", windowId: 7, tabId: 70, phase: "SENDING", turn: 6, sessionSeq: 1,
  goal: "Projekt: 2 - EIC backend - Gf: GF-900.", schedulerPriority: "URGENT",
  safety: { hold: { code: "DISPATCH_EFFECT_UNRESOLVED", detail: "AUTONOMOUS_USER_TURN_NOT_RESOLVED", retryAtMs: Date.now() + 20_000, sinceMs: Date.now() - 1_500_000 },
    proof: { allowed: true, model: "Pro", effort: "Pro", code: "UI_MODEL_COMPATIBLE" }, lastObservationAtMs: Date.now() - 24_000 },
  queueContext: { itemId: "queue-item-1", queueId: "work-queue-test", interactionCount: 5, maxInteractions: 15 },
  pendingDispatch: { status: "ACKNOWLEDGED", effectPossible: true, acknowledged: true, materializedBy: "" },
  lastMaterialAt: new Date(Date.now() - 1_631_000).toISOString(), updatedAt: new Date().toISOString()
};
const OTHER = { ...PROCESS, processId: "process-00000000-0000-4000-8000-0000000000c2", workerId: "worker-other", windowId: 8, tabId: 80,
  phase: "WAITING", safety: { ...PROCESS.safety, hold: null }, pendingDispatch: null, goal: "Projekt: 72 - Övrigt - Gf: GF-901." };
const FLEET = {
  generatedAt: new Date().toISOString(), activeCount: 1, usedCapacity: 1, effectiveCapacity: 2, waitingCount: 0, heldCount: 1,
  rateLimitState: "NORMAL", safety: { policy: { tokens24h: 3000000, messages24h: 156, messages3h: 36, messages7d: 500 }, events: [] },
  storage: { known: false }, recovery: { restored: [], unresolved: [], errors: [], checkpointRepairs: [] },
  reservation: { workerId: "worker-test", appliesNow: true, mode: "EXCLUSIVE", reservedActive: true, sharedCapacity: 1, workerHasProcess: true },
  workers: [{ process: PROCESS, queue: { enabled: true, activeItemId: "queue-item-1", activeItem: { label: "Projekt: 2 - EIC backend - Gf: GF-900." },
    readyCount: 3, pausedCount: 1, blockedCount: 0, doneCount: 0, totalCount: 5 } },
    { process: OTHER, queue: null }]
};

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
const dialogs = [];
page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));
page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.accept(); });
await page.route(`${ORIGIN}/**`, (route) => {
  const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: "" });
  return route.fulfill({ contentType: TYPES[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
});
await page.addInitScript(({ fleet }) => {
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const data = {};
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
  let reservation = clone(fleet.reservation);
  globalThis.__gfSent = [];
  globalThis.LanguageModel = { async availability() { return "available"; }, async create() { return { async prompt() { return "READY"; }, destroy() {} }; } };
  globalThis.chrome = {
    runtime: {
      id: "panel-test",
      onMessage: { addListener() {}, removeListener() {} },
      async sendMessage(message) {
        globalThis.__gfSent.push(clone(message));
        if (message?.type === "EIC_GF_GET_SNAPSHOT") {
          return { ok: true, workerId: "worker-test", process: fleet.workers[0].process, missionQueue: null, missionQueueSets: [],
            fleetStatus: { ...fleet, reservation, generatedAt: new Date().toISOString() } };
        }
        if (message?.type === "EIC_GF_SET_RESERVED_SLOT") {
          const previous = reservation.workerId;
          const next = message.enabled ? message.workerId : (previous === message.workerId ? "" : previous);
          reservation = { ...reservation, workerId: next, workerHasProcess: Boolean(next) };
          return { ok: true, changed: previous !== next, previousWorkerId: previous, reservedWorkerId: next, appliesNow: true };
        }
        return { ok: true };
      }
    },
    storage: { local: area, session: area, onChanged: { addListener() {}, removeListener() {} } },
    windows: { async getCurrent() { return { id: 7 }; } },
    bookmarks: { async getTree() { return [{ id: "0", title: "", children: [{ id: "2", parentId: "0", title: "Other bookmarks", children: [] }] }]; },
      async getChildren() { return []; }, async create(node) { return { id: "99", ...node }; }, async update(id) { return { id }; }, async removeTree() {} }
  };
}, { fleet: FLEET });
await page.goto(`${ORIGIN}/sidepanel.html`);
await page.waitForSelector("button[data-slot-action]", { timeout: 60000 });
const cards = await page.evaluate(() => [...document.querySelectorAll("#fleetWorkers article.fleet-worker")].map((card) => ({
  reserved: card.dataset.reserved === "true", badge: card.querySelector(".reserved-badge")?.textContent || "",
  slotButton: card.querySelector("button[data-slot-action]")?.textContent || "", slotAction: card.querySelector("button[data-slot-action]")?.dataset.slotAction || ""
})));
const capacityLine = await page.evaluate(() => document.getElementById("fleetGlobalDetail")?.textContent || "");
await page.click("#runtimeTabButton");
const drift = await page.evaluate(() => ({ state: document.getElementById("reservedSlotState")?.textContent || "",
  toggle: document.getElementById("reservedSlotToggle")?.textContent || "", detail: document.getElementById("reservedSlotDetail")?.textContent || "",
  visible: (document.getElementById("reservedSlotToggle")?.getBoundingClientRect().height || 0) > 0 }));
await page.click("#overviewTabButton");
await page.waitForTimeout(1200);
await page.click("button[data-slot-action='reserve']");
await page.waitForFunction(() => globalThis.__gfSent.some((m) => m.type === "EIC_GF_SET_RESERVED_SLOT"), null, { timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll("article.fleet-worker[data-reserved='true']").length === 1 &&
  document.querySelectorAll("article.fleet-worker")[1]?.dataset.reserved === "true", null, { timeout: 30000 });
await page.click("#runtimeTabButton");
const driftAfterMove = await page.evaluate(() => ({ state: document.getElementById("reservedSlotState")?.textContent || "",
  toggle: document.getElementById("reservedSlotToggle")?.textContent || "", detail: document.getElementById("reservedSlotDetail")?.textContent || "" }));
await page.click("#reservedSlotToggle");
await page.waitForFunction(() => document.getElementById("reservedSlotState")?.textContent === "Detta fönster", null, { timeout: 30000 });
const sent = await page.evaluate(() => globalThis.__gfSent.filter((m) => m.type === "EIC_GF_SET_RESERVED_SLOT"));
await browser.close();

const checks = [
  ["the reserved window's card carries the badge and 'Släpp reserverad plats'; the other card offers 'Reservera plats'",
    cards[0]?.reserved === true && /Reserverad plats/.test(cards[0].badge) && cards[0].slotAction === "release" &&
    cards[1]?.reserved === false && cards[1].slotAction === "reserve" && cards[1].slotButton === "Reservera plats"],
  ["the capacity line says one slot is reserved", /1 plats reserverad/.test(capacityLine)],
  ["Drift shows 'Detta fönster', the lock and the release button", drift.visible && drift.state === "Detta fönster" &&
    drift.toggle === "Ta bort reservationen" && /1 plats är låst för detta fönster\. Övriga fönster delar på 1 plats\./.test(drift.detail)],
  ["reserving another window asks first and says the reservation moves", /Reservationen flyttas från ett annat fönster/.test(dialogs[0] || "")],
  ["the card button sends that window's binding", sent[0]?.windowId === 8 && sent[0].workerId === "worker-other" && sent[0].enabled === true],
  ["after the move this window shows 'Ett annat fönster' and offers to reserve", driftAfterMove.state === "Ett annat fönster" &&
    driftAfterMove.toggle === "Reservera en plats för detta fönster"],
  ["the Drift toggle reserves this window again", sent[1]?.windowId === 7 && sent[1].workerId === "worker-test" && sent[1].enabled === true],
  ["no page errors", pageErrors.length === 0]
];
const out = { tool: "tools/verify-reserved-slot-panel.mjs", cards, capacityLine, drift, driftAfterMove, dialogs, sent, pageErrors,
  checks: checks.map(([name, pass]) => ({ name, pass: Boolean(pass) })), passed: checks.filter(([, pass]) => pass).length, total: checks.length };
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify(out, null, 2)}\n`);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
console.log(`checks ${out.passed}/${out.total}`);
process.exitCode = out.passed === out.total ? 0 : 1;
