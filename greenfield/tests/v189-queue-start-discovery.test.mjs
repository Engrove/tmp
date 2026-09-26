import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../lib/safety-policy.js";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow } from "../lib/process-store.mjs";
import { addMissionWorkItem, loadMissionWorkQueue } from "../lib/mission-work-queue.mjs";
import { ensureWorkerBinding } from "../lib/worker-identity.mjs";
import { readEicSurfaceState } from "../lib/managed-eic-surface.mjs";

// Operator report 2026-09-26 (v1.8.8): "Det går inte att starta upp arbetskön,
// den stoppas direkt." Diagnostics: tab at https://chatgpt.com/, EIC selected
// (gptSurface composer "EIC", header "EIC"), picker "Pro", no process, fresh
// queue (revision 1), no eic.gf.safety.v1 record (fresh storage). Synthetic ids.
const S = globalThis.GreenfieldSafetyPolicy;
const HOME = "https://chatgpt.com/";
const EIC_ROOT = "https://chatgpt.com/g/g-test-eic"; // harness EIC root
const EIC_CONVERSATION = "/g/g-test/c/00000000-0000-4000-8000-00000000e1c1";
const OTHER_CONVERSATION = "/g/g-other/c/00000000-0000-4000-8000-00000000a7b8";

function fakeClock() {
  const realNow = Date.now;
  let offset = 0;
  return { advance(ms) { offset += ms; Date.now = () => realNow() + offset; }, restore() { Date.now = realNow; } };
}

// ChatGPT's newer shell: GPT conversations live at /g/g-<id>/c/<conv> and show
// the GPT name in the header; a GPT address opens that GPT's fresh chat.
const NAMES = { "g-test": "EIC", "g-other": "Matlogg" };
const defaultLand = (url) => {
  const ref = S.gptRef(url);
  return ref ? { url, gpt: NAMES[ref.id] || "" } : { url: HOME, gpt: "" };
};

async function freshInstall({ candidates = [
  { gptId: "g-other", href: OTHER_CONVERSATION },
  { gptId: "g-test", href: EIC_CONVERSATION }
], land = defaultLand, selectedGpt = "EIC" } = {}) {
  const h = await harness({ extraExports: ["startMissionQueue", "tickRotating", "enforceManagedEicSurface"] });
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  const show = (url, gpt = "") => {
    h.tab.url = url;
    Object.assign(h.page, { url, userCount: 0, assistantCount: 0, generating: false, lastUserText: "", lastUserHash: "", lastUserId: "" });
    h.page.modelEvidence = { ...h.page.modelEvidence, gptSurface: { composerName: gpt, headerName: gpt, ambiguous: false, version: 1 } };
  };
  const navigations = [];
  h.chrome.tabs.update = async (_id, patch) => {
    if (typeof patch?.url !== "string") return Object.assign(h.tab, patch);
    navigations.push(patch.url);
    const shown = land(patch.url);
    show(shown.url, shown.gpt);
    return h.tab;
  };
  const linkRequests = [];
  const send = h.chrome.tabs.sendMessage;
  h.chrome.tabs.sendMessage = async (id, message) => {
    if (message.type === "EIC_GF_GPT_CONVERSATION_LINKS") {
      linkRequests.push(message);
      return { ok: true, candidates };
    }
    return send(id, message);
  };
  show(HOME, selectedGpt);
  const storage = h.chrome.storage.local;
  const binding = await ensureWorkerBinding(1, h.chrome.storage.session);
  for (const [goal, id] of [["Projekt: 71 - Greenfield Works - Gf: GF-045.", "gfw-045"], ["Projekt: 2 - EIC backend - Gf: GF-007.", "gfw-007"]]) {
    await addMissionWorkItem(1, goal, { storage, workerId: binding.workerId, savedMissionId: id, maxInteractions: 2 });
  }
  return { h, navigations, linkRequests, workerId: binding.workerId };
}

async function drive(h, clock, until, max = 80) {
  let p = await loadProcessForWindow(1);
  for (let i = 0; i < max && p && !until(p); i += 1) {
    if (p.phase === "ROTATING") await h.mod.tickRotating(p);
    else if (p.phase === "SENDING") await h.mod.tickSending(p);
    else break;
    clock.advance(5_000);
    p = await loadProcessForWindow(1);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Reproduction (fails on v1.8.8).

test("v1.8.9 repro E2E: fresh install, EIC selected at chatgpt.com/ -> the queue starts, finds EIC's id and sends one prompt in EIC", async () => {
  const { h, navigations } = await freshInstall();
  const clock = fakeClock();
  try {
    const started = await h.mod.startMissionQueue({ windowId: 1 });
    assert.equal(started.ok, true, "the queue starts (v1.8.8: EIC_GPT_ROOT_UNKNOWN)");
    const p = await drive(h, clock, (q) => q.phase === "WAITING");
    assert.deepEqual(navigations.slice(0, 3), [
      `https://chatgpt.com${OTHER_CONVERSATION}`,
      `https://chatgpt.com${EIC_CONVERSATION}`,
      EIC_ROOT
    ], "Matlogg candidate rejected by name, EIC candidate bound, then a fresh EIC chat");
    assert.equal(p.phase, "WAITING");
    assert.equal(p.gptRoot, EIC_ROOT, "bound to EIC's id with its name");
    assert.equal(h.sent.length, 1, "exactly one prompt");
    assert.equal((await readEicSurfaceState(h.chrome.storage.local)).lastKnownGoodEicUrl, EIC_ROOT, "remembered for the next start");
  } finally {
    clock.restore();
  }
});

test("v1.8.9 repro: the picker's 'Pro' is the highest thinking level (operator decision 2026-09-26)", () => {
  assert.equal(S.effort("Pro Välj ChatGPT-modell"), 3);
  assert.equal(S.effort("Pro"), 3);
  const pro = {
    source: "CHATGPT_UI_CONTROLS_V1", observedAtMs: Date.now(), modelLabel: "Pro Välj ChatGPT-modell",
    effortLabel: "Pro Välj ChatGPT-modell", reasoningControlSeen: true, effortControlSeen: true,
    ambiguous: false, mode: "CHAT", quota: { active: false },
    gptSurface: { composerName: "EIC", headerName: "EIC", ambiguous: false, version: 1 }
  };
  const extended = S.evaluateModel(pro, S.defaults, { url: HOME, gptRoot: EIC_ROOT });
  assert.equal(extended.allowed, true, extended.code);
  assert.equal(extended.effortAssurance, "NAMED_EFFORT");
  const heavy = S.evaluateModel(pro, { ...S.defaults, minimumEffort: "heavy" }, { url: HOME, gptRoot: EIC_ROOT });
  assert.equal(heavy.allowed, true, heavy.code);
});

test("v1.8.9 repro: the side panel keeps a queue-start error visible instead of re-rendering it away", () => {
  const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  const start = panel.slice(panel.indexOf("async function startMissionQueue()"), panel.indexOf("async function stopMissionQueueUi()"));
  assert.match(start, /state\.queueStartNotice = \{/, "the error is kept in panel state");
  const render = panel.slice(panel.indexOf("async function render()"), panel.indexOf("async function render()") + 800);
  assert.match(render, /queueStartNotice/, "render shows it while no process runs");
});

// ---------------------------------------------------------------------------
// Fail-closed boundaries.

test("v1.8.9 no EIC shown at chatgpt.com/ and nothing remembered -> EIC_GPT_ROOT_UNKNOWN, no navigation", async () => {
  const { h, navigations, linkRequests } = await freshInstall({ selectedGpt: "" });
  await assert.rejects(h.mod.startMissionQueue({ windowId: 1 }), /EIC_GPT_ROOT_UNKNOWN/);
  assert.deepEqual(navigations, []);
  assert.equal(linkRequests.length, 0, "no candidate search without a named GPT on the page");
  assert.equal(h.sent.length, 0);
});

test("v1.8.9 EIC selected but no GPT conversation in the sidebar -> EIC_GPT_ROOT_UNKNOWN, no navigation", async () => {
  const { h, navigations } = await freshInstall({ candidates: [] });
  await assert.rejects(h.mod.startMissionQueue({ windowId: 1 }), /EIC_GPT_ROOT_UNKNOWN/);
  assert.deepEqual(navigations, []);
  assert.equal(h.sent.length, 0);
});

test("v1.8.9 no candidate shows EIC -> BLOCKED EIC_GPT_ROOT_UNKNOWN, queue stopped (no slot churn), nothing sent", async () => {
  const { h, navigations, workerId } = await freshInstall({ candidates: [{ gptId: "g-other", href: OTHER_CONVERSATION }] });
  const clock = fakeClock();
  try {
    await h.mod.startMissionQueue({ windowId: 1 });
    const p = await drive(h, clock, (q) => q.phase === "BLOCKED");
    assert.equal(p.phase, "BLOCKED");
    assert.equal(p.lastError.code, "EIC_GPT_ROOT_UNKNOWN");
    assert.deepEqual(navigations, [`https://chatgpt.com${OTHER_CONVERSATION}`]);
    assert.equal(h.sent.length, 0);
    const queue = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId });
    assert.equal(queue.enabled, false, "the queue stops instead of blocking every slot in turn");
    assert.equal((await readEicSurfaceState(h.chrome.storage.local)).lastKnownGoodEicUrl, "");
  } finally {
    clock.restore();
  }
});

test("v1.8.9 the surface guard never binds or remembers a GPT while discovery visits candidates", async () => {
  const { h, navigations } = await freshInstall();
  await h.mod.startMissionQueue({ windowId: 1 });
  let p = await loadProcessForWindow(1);
  p = await h.mod.tickRotating(p); // opens the first candidate (Matlogg)
  assert.equal(navigations[0], `https://chatgpt.com${OTHER_CONVERSATION}`);
  const guard = await h.mod.enforceManagedEicSurface(await loadProcessForWindow(1), h.tab);
  assert.equal(guard.action, "EIC_DISCOVERY_OWNS_NAVIGATION");
  assert.equal((await readEicSurfaceState(h.chrome.storage.local)).lastKnownGoodEicUrl, "", "Matlogg is not remembered as EIC");
  assert.equal((await loadProcessForWindow(1)).gptRoot, "");
});

test("v1.8.9 a candidate that never shows its GPT name is skipped after its time limit", async () => {
  const { h, navigations } = await freshInstall({
    land: (url) => (url.includes("g-other") ? { url, gpt: "" } : defaultLand(url))
  });
  const clock = fakeClock();
  try {
    await h.mod.startMissionQueue({ windowId: 1 });
    const p = await drive(h, clock, (q) => q.phase === "WAITING");
    assert.equal(p.phase, "WAITING");
    assert.equal(navigations[1], `https://chatgpt.com${EIC_CONVERSATION}`);
    assert.equal(h.sent.length, 1);
  } finally {
    clock.restore();
  }
});

test("v1.8.9 'Pro' ranking is whole-word only; other thinking-level rules unchanged", () => {
  for (const text of ["Projekt", "Proffs", "Program", "Process"]) assert.equal(S.effort(text), -1, text);
  assert.equal(S.effort("Extra hög"), 3);
  assert.equal(S.effort("Hög"), 2);
  assert.equal(S.effort("Direkt Välj ChatGPT-modell"), -1);
});

test("v1.8.9 content lists sidebar GPT conversations for EIC discovery (ids and hrefs only)", () => {
  const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
  assert.match(content, /message\.type === "EIC_GF_GPT_CONVERSATION_LINKS"/);
  assert.match(content, /section\[data-app-action-sidebar-section-heading='Recents'\]/);
});
