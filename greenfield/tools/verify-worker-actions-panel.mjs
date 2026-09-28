// v1.8.11 real-browser check of the worker card actions "Läs svar" and "Gå
// till nästa uppgift i kön": the real sidepanel.html/sidepanel.js run in
// Chromium with in-memory chrome.storage and a background stub. The fleet
// status shows one worker in the state of the operator's report 2026-09-28
// (SENDING, DISPATCH_EFFECT_UNRESOLVED, prompt sent, 3 other slots ready).
// Checks that both buttons are on the card, that each asks first, that the
// background gets the worker's window, worker and process, and that the
// result is written on the card. Not part of `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-worker-actions-panel.mjs [out.json]
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
const FLEET = {
  generatedAt: new Date().toISOString(), activeCount: 1, usedCapacity: 1, effectiveCapacity: 2, waitingCount: 0, heldCount: 1,
  rateLimitState: "NORMAL", safety: { policy: { tokens24h: 3000000, messages24h: 156, messages3h: 36, messages7d: 500 }, events: [] },
  storage: { known: false }, recovery: { restored: [], unresolved: [], errors: [], checkpointRepairs: [] },
  workers: [{ process: PROCESS, queue: { enabled: true, activeItemId: "queue-item-1", activeItem: { label: "Projekt: 2 - EIC backend - Gf: GF-900." },
    readyCount: 3, pausedCount: 1, blockedCount: 0, doneCount: 0, totalCount: 5 } }]
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
        if (message?.type === "EIC_GF_OPERATOR_READ_RESPONSE") return { ok: true, outcome: "PROMPT_FOUND_READING", boundByOperator: true, phase: "WAITING" };
        if (message?.type === "EIC_GF_OPERATOR_NEXT_QUEUE_ITEM") return { ok: false, code: "QUEUE_NEXT_NONE_RUNNABLE" };
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
await page.waitForSelector("button[data-worker-action='read-response']", { timeout: 60000 });
const buttons = await page.evaluate(() => [...document.querySelectorAll("#fleetWorkers button[data-worker-action]")]
  .map((b) => ({ action: b.dataset.workerAction, text: b.textContent, disabled: b.disabled, visible: b.getBoundingClientRect().height > 0 })));
await page.waitForTimeout(1200); // at least one 1 s card rebuild before the click
await page.click("button[data-worker-action='read-response']");
await page.waitForFunction(() => document.querySelector(".worker-action-result"), null, { timeout: 30000 });
const afterRead = await page.evaluate(() => document.querySelector(".worker-action-result")?.textContent || "");
await page.click("button[data-worker-action='next-queue-item']");
await page.waitForFunction(() => /Ingen annan uppgift/.test(document.querySelector(".worker-action-result")?.textContent || ""), null, { timeout: 30000 });
const afterNext = await page.evaluate(() => document.querySelector(".worker-action-result")?.textContent || "");
await page.waitForTimeout(1500);
const stillShown = await page.evaluate(() => document.querySelector(".worker-action-result")?.textContent || "");
const sent = await page.evaluate(() => globalThis.__gfSent.filter((m) => /OPERATOR/.test(m.type)));
await browser.close();

const read = sent.find((m) => m.type === "EIC_GF_OPERATOR_READ_RESPONSE");
const next = sent.find((m) => m.type === "EIC_GF_OPERATOR_NEXT_QUEUE_ITEM");
const checks = [
  ["the card shows 'Läs svar' and 'Gå till nästa uppgift i kön', enabled and visible",
    buttons.length === 2 && buttons.some((b) => b.action === "read-response" && b.text === "Läs svar" && !b.disabled && b.visible) &&
    buttons.some((b) => b.action === "next-queue-item" && b.text === "Gå till nästa uppgift i kön" && !b.disabled && b.visible)],
  ["Läs svar asks first (SENDING: it may bind the newest user turn) and says nothing is resent",
    /Läs svar: .*Inget skickas om/.test(dialogs[0] || "")],
  ["Läs svar is sent with the card's window, worker and process",
    read?.windowId === 7 && read.workerId === "worker-test" && read.processId === PROCESS.processId],
  ["the result is written on the card", /ditt beslut.*Prompten hittades/.test(afterRead)],
  ["Gå till nästa uppgift i kön asks first and points to Läs svar", /Gå till nästa uppgift i kön: .*Läs svar först/.test(dialogs[1] || "")],
  ["Gå till nästa uppgift i kön is sent with the card's window, worker and process",
    next?.windowId === 7 && next.workerId === "worker-test" && next.processId === PROCESS.processId],
  ["a refusal is written on the card and survives the next rebuilds", /Ingen annan uppgift i kön är redo/.test(afterNext) && afterNext === stillShown],
  ["no page errors", pageErrors.length === 0]
];
const out = { tool: "tools/verify-worker-actions-panel.mjs", buttons, dialogs, sent, afterRead, afterNext, pageErrors,
  checks: checks.map(([name, pass]) => ({ name, pass: Boolean(pass) })), passed: checks.filter(([, pass]) => pass).length, total: checks.length };
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify(out, null, 2)}\n`);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
console.log(`checks ${out.passed}/${out.total}`);
process.exitCode = out.passed === out.total ? 0 : 1;
