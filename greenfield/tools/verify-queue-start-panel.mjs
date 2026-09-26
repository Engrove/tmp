// v1.8.9 real-browser check of the side panel's queue start: the real
// sidepanel.html/sidepanel.js run in Chromium with in-memory chrome.storage, a
// LanguageModel stub (preflight answers READY) and a background stub that
// rejects EIC_GF_QUEUE_START the way the background does (ok:false + code).
// Operator report 2026-09-26: "Det går inte att starta upp arbetskön, den
// stoppas direkt" - the reason must stay visible, at the top status line and
// under the queue buttons. Not part of `npm test`. Run:
//   NODE_PATH="$(npm root -g)" node tools/verify-queue-start-panel.mjs [out.json]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://gf-panel.test";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const QUEUE = {
  queueId: "work-queue-test", workerId: "worker-test", windowId: 7, enabled: false, activeItemId: "", cursorOrder: -1, revision: 1,
  items: [{ itemId: "queue-item-1", order: 0, label: "Projekt: 71 - Greenfield Works - Gf: GF-045.", goal: "Projekt: 71 - Greenfield Works - Gf: GF-045.\nText.",
    status: "READY", priority: "URGENT", operatorPriority: "URGENT", maxInteractions: 1, quantumProgress: 0, schedule: null, savedMissionId: "mission-test" }],
  history: []
};

async function run(queueStartResponse) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));
  await page.route(`${ORIGIN}/**`, (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ contentType: TYPES[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
  });
  await page.addInitScript(({ queue, response }) => {
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
    globalThis.LanguageModel = {
      async availability() { return "available"; },
      async create() { return { async prompt() { return "READY"; }, destroy() {} }; }
    };
    let started = false;
    globalThis.chrome = {
      runtime: {
        id: "panel-test",
        onMessage: { addListener() {}, removeListener() {} },
        async sendMessage(message) {
          globalThis.__gfSent.push(clone(message));
          if (message?.type === "EIC_GF_GET_SNAPSHOT") {
            return { ok: true, workerId: "worker-test", process: null, missionQueue: { ...queue, enabled: started }, missionQueueSets: [] };
          }
          if (message?.type === "EIC_GF_QUEUE_START") {
            if (response.ok) started = true;
            return clone(response);
          }
          return { ok: true };
        }
      },
      storage: { local: area, session: area, onChanged: { addListener() {}, removeListener() {} } },
      windows: { async getCurrent() { return { id: 7 }; } },
      bookmarks: { async getTree() { return [{ id: "0", title: "", children: [{ id: "2", parentId: "0", title: "Other bookmarks", children: [] }] }]; },
        async getChildren() { return []; }, async create(node) { return { id: "99", ...node }; }, async update(id) { return { id }; }, async removeTree() {} }
    };
  }, { queue: QUEUE, response: queueStartResponse });
  await page.goto(`${ORIGIN}/sidepanel.html`);
  await page.click("#missionsTabButton"); // the operator starts the queue from "Uppdragskö"
  await page.waitForFunction(() => document.getElementById("queueStart") && !document.getElementById("queueStart").disabled, null, { timeout: 60000 });
  await page.click("#queueStart");
  await page.waitForFunction(() => globalThis.__gfSent.some((row) => row.type === "EIC_GF_QUEUE_START"), null, { timeout: 30000 });
  await page.waitForTimeout(800); // the finally-snapshot and render have run
  const result = await page.evaluate(() => {
    const status = document.getElementById("queueStartStatus");
    return {
      statusDetail: document.getElementById("statusDetail")?.textContent || "",
      queueStartStatus: status ? status.textContent : null,
      queueStartStatusVisible: Boolean(status && !status.hidden && status.getBoundingClientRect().height > 0),
      queueStartDisabled: document.getElementById("queueStart")?.disabled === true
    };
  });
  await browser.close();
  return { ...result, pageErrors };
}

const rejected = await run({ ok: false, error: "EIC_GPT_ROOT_UNKNOWN", code: "EIC_GPT_ROOT_UNKNOWN" });
const accepted = await run({ ok: true, process: null, missionQueue: { ...QUEUE, enabled: true } });
const checks = [
  ["rejected start: the reason stays in the top status line after the re-render", /Arbetskön startade inte: .*EIC-adressen kunde inte fastställas/.test(rejected.statusDetail)],
  ["rejected start: the reason is shown under the queue buttons", rejected.queueStartStatusVisible && /EIC-adressen kunde inte fastställas/.test(rejected.queueStartStatus || "")],
  ["rejected start: the button is usable again", rejected.queueStartDisabled === false],
  ["accepted start: no error line", !accepted.queueStartStatusVisible && !/startade inte/.test(accepted.statusDetail)],
  ["no page errors", rejected.pageErrors.length === 0 && accepted.pageErrors.length === 0]
];
const out = { tool: "tools/verify-queue-start-panel.mjs", rejected, accepted, checks: checks.map(([name, pass]) => ({ name, pass: Boolean(pass) })), passed: checks.filter(([, pass]) => pass).length, total: checks.length };
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify(out, null, 2)}\n`);
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
console.log(`checks ${out.passed}/${out.total}`);
process.exitCode = out.passed === out.total ? 0 : 1;
