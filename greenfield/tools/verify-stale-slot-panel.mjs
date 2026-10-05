// v1.8.13 real-browser check of the worker card after a dead turn gave its
// capacity slot back: the real sidepanel.html/sidepanel.js run in Chromium with
// in-memory chrome.storage and a background stub. The fleet status shows one
// worker in WAITING whose turn, after the 30-minute reload, showed no
// generation (waitingRefresh.capacityReleased) and a second worker that now
// holds the slot. Checks that the card says the slot was given back and that
// the answer is still read, that the slot line counts 1 of 1, and that a
// worker without the flag has no note. Not part of `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-stale-slot-panel.mjs [out.json]
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
const RELEASED_AT = Date.now() - 4 * 60_000;
const DEAD = {
  processId: "process-00000000-0000-4000-8000-0000000000d1", workerId: "worker-test", windowId: 7, tabId: 70, phase: "WAITING", turn: 3, sessionSeq: 3,
  goal: "Projekt: 900 - Syntetiskt projekt A - Gf: GF-900.", schedulerPriority: "HIGH",
  lastPrompt: { hash: "prompt-hash-d1", sentAt: new Date(Date.now() - 36 * 60_000).toISOString(), acknowledged: true },
  waitingRefresh: { stage: "F5_30", promptHash: "prompt-hash-d1", turn: 3, staleSince: new Date(Date.now() - 36 * 60_000).toISOString(),
    capacityReleased: { promptHash: "prompt-hash-d1", turn: 3, stage: "F5_30", atMs: RELEASED_AT, reason: "STALE_TURN_NO_GENERATION_AFTER_RELOAD" } },
  safety: { hold: null, proof: { allowed: true, model: "Extra hög", effort: "Extra hög", code: "UI_MODEL_COMPATIBLE" }, lastObservationAtMs: Date.now() - 10_000 },
  lastMaterialAt: new Date(Date.now() - 36 * 60_000).toISOString(), updatedAt: new Date().toISOString()
};
const RUNNING = {
  ...DEAD, processId: "process-00000000-0000-4000-8000-0000000000d2", workerId: "worker-other", windowId: 8, tabId: 80,
  goal: "Projekt: 901 - Syntetiskt projekt B - Gf: GF-901.", lastPrompt: { hash: "prompt-hash-d2", sentAt: new Date(Date.now() - 2 * 60_000).toISOString(), acknowledged: true },
  waitingRefresh: { stage: "", promptHash: "prompt-hash-d2", turn: 3 }
};
const FLEET = {
  generatedAt: new Date().toISOString(), activeCount: 2, usedCapacity: 1, effectiveCapacity: 1, waitingCount: 0, heldCount: 0,
  rateLimitState: "NORMAL", safety: { policy: { tokens24h: 3200000, messages24h: 156, messages3h: 36, messages7d: 1000 }, events: [] },
  storage: { known: false }, recovery: { restored: [], unresolved: [], errors: [], checkpointRepairs: [] },
  workers: [
    { process: DEAD, queue: { enabled: true, activeItemId: "queue-item-1", activeItem: { label: DEAD.goal }, readyCount: 2, pausedCount: 0, blockedCount: 0, doneCount: 0, totalCount: 3 } },
    { process: RUNNING, queue: { enabled: true, activeItemId: "queue-item-2", activeItem: { label: RUNNING.goal }, readyCount: 1, pausedCount: 0, blockedCount: 0, doneCount: 0, totalCount: 2 } }
  ]
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
            fleetStatus: { ...fleet, generatedAt: new Date().toISOString() } };
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
await page.waitForSelector("#fleetWorkers .fleet-worker", { timeout: 60000 });
await page.waitForTimeout(1500); // at least one 1 s card rebuild
const cards = await page.evaluate(() => [...document.querySelectorAll("#fleetWorkers .fleet-worker")].map((card) => {
  const note = card.querySelector(".worker-slot-note");
  return { title: card.querySelector(".fleet-worker-head strong")?.textContent || "", phase: card.querySelector(".fleet-phase")?.textContent || "",
    note: note?.textContent || "", noteVisible: Boolean(note && note.getBoundingClientRect().height > 0) };
}));
const slotLine = await page.evaluate(() => document.querySelector("#fleetGlobalDetail")?.textContent || "");
await browser.close();

const dead = cards.find((card) => /GF-900/.test(card.title));
const running = cards.find((card) => /GF-901/.test(card.title));
const hhmm = new Date(RELEASED_AT).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
const checks = [
  ["both workers are shown, the dead turn still WAITING", cards.length === 2 && dead?.phase === "WAITING"],
  ["the dead turn's card says the slot was given back, when, and that the answer is still read",
    Boolean(dead?.noteVisible) && dead.note.startsWith("Platsen lämnad tillbaka") && dead.note.includes(hhmm) && /Svaret läses ändå om det kommer/.test(dead.note)],
  ["a worker that holds its slot has no note", running && running.note === ""],
  ["the slot line counts the slot the other worker now holds", /^1\/1 platser/.test(slotLine)],
  ["no page errors", pageErrors.length === 0]
];
const out = { tool: "tools/verify-stale-slot-panel.mjs", root: process.env.GF_PANEL_ROOT ? "GF_PANEL_ROOT" : "this tree", cards, slotLine, pageErrors,
  checks: checks.map(([name, pass]) => ({ name, pass: Boolean(pass) })), passed: checks.filter(([, pass]) => pass).length, total: checks.length };
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify(out, null, 2)}\n`);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
console.log(`checks ${out.passed}/${out.total}`);
process.exitCode = out.passed === out.total ? 0 : 1;
