import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../lib/safety-policy.js";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow, saveProcess } from "../lib/process-store.mjs";
import {
  addMissionWorkItem,
  createQueueContext,
  loadMissionWorkQueue,
  saveMissionWorkQueue
} from "../lib/mission-work-queue.mjs";

const MIN = 60 * 1000;
const S = globalThis.GreenfieldSafetyPolicy;
const URL_OK = { url: "https://chatgpt.com/g/g-x-eic/c/abc", gptRoot: "https://chatgpt.com/g/g-x-eic" };

// Model evidence exactly as exported on 2026-09-26 (diagnostics, v1.8.5):
// ChatGPT's new composer shows the thinking level inside the model picker
// ("Välj ChatGPT-modell") instead of the former "Djupgående" chip.
const pickerEvidence = (text, { effortControlSeen = false, effortLabel = "" } = {}) => ({
  source: "CHATGPT_UI_CONTROLS_V1",
  observedAtMs: Date.now(),
  modelLabel: `${text} Välj ChatGPT-modell`,
  effortLabel,
  reasoningControlSeen: effortControlSeen,
  effortControlSeen,
  ambiguous: false,
  ambiguityKind: "",
  mode: "CHAT",
  quota: { active: false },
  blockingUi: false
});

function realClock() {
  const realNow = Date.now;
  let offset = 0;
  return {
    advance(ms) { offset += ms; Date.now = () => realNow() + offset; },
    restore() { Date.now = realNow; }
  };
}

async function waiting(h, goal = "Projekt: 71 - Greenfield Works - Gf: GF-052.") {
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  await h.mod.startRun({ windowId: 1, goal });
  let p = await loadProcessForWindow(1);
  p = await h.mod.tickSending(p);
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");
  return p;
}

// ---------------------------------------------------------------------------
// A: a model-evidence hold in WAITING no longer stops the stale-session ladder.

test("v1.8.6 E2E: THINKING_MODE_UNVERIFIED in WAITING still runs F5 30, Ctrl-F5 60/90 and the 120 min rotation", async () => {
  const h = await harness();
  const t = realClock();
  try {
    let p = await waiting(h);
    const reloads = [];
    h.chrome.tabs.reload = async (tabId, options = {}) => { reloads.push(options.bypassCache ? "CTRL_F5" : "F5"); };
    h.page.generating = false;
    h.page.modelEvidence = pickerEvidence("Direkt");

    p = await h.mod.tickWaiting(p);
    assert.equal(p.safety.hold?.code, "THINKING_MODE_UNVERIFIED", "the hold itself is unchanged");
    assert.deepEqual(reloads, [], "nothing before 30 min");

    for (const [minutes, expected] of [[31, ["F5"]], [61, ["F5", "CTRL_F5"]], [91, ["F5", "CTRL_F5", "CTRL_F5"]]]) {
      t.advance(minutes * MIN - (Date.now() - Date.parse(p.lastPrompt.sentAt)));
      p = await h.mod.tickWaiting(await loadProcessForWindow(1));
      assert.deepEqual(reloads, expected, `ladder at ${minutes} min`);
      assert.equal(p.phase, "WAITING");
    }
    t.advance(30 * MIN);
    p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    assert.equal(p.phase, "ROTATING", "120 min: the stale session is rotated instead of hanging");
    assert.equal(p.sessionRotation.reasonCode, "STALE_SESSION_120M_EXHAUSTED");
    assert.ok(p.responseObservationTrace.some((row) => row.reason === "SAFETY_HOLD:THINKING_MODE_UNVERIFIED"));
    assert.ok(p.responseObservationTrace.some((row) => row.reason === "STALE_SESSION_120M_ROTATE"));
    assert.equal(h.sent.length, 1, "no prompt is posted by the ladder");
  } finally {
    t.restore();
  }
});

test("v1.8.6 E2E: a held queue slot switches to the next GFW when its TTL runs out (GF-052 -> GF-051)", async () => {
  const h = await harness();
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 71 - Greenfield Works - Gf: GF-052." });
  let p = await loadProcessForWindow(1);
  const storage = h.chrome.storage.local;
  for (const [goal, id] of [["Projekt: 71 - Greenfield Works - Gf: GF-052.", "gfw-052"], ["Projekt: 71 - Greenfield Works - Gf: GF-051.", "gfw-051"]]) {
    await addMissionWorkItem(1, goal, { storage, workerId: p.workerId, savedMissionId: id, maxInteractions: 5 });
  }
  let queue = await loadMissionWorkQueue(1, storage, { workerId: p.workerId });
  queue.items[0] = { ...queue.items[0], status: "ACTIVE" };
  queue.activeItemId = queue.items[0].itemId;
  queue.enabled = true;
  queue = await saveMissionWorkQueue(queue, storage);
  await saveProcess({ ...p, queueContext: createQueueContext(queue, queue.items[0], { interactionCount: 2 }) });
  p = await h.mod.tickSending(await loadProcessForWindow(1));
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");

  const t = realClock();
  try {
    h.chrome.tabs.reload = async () => {};
    h.page.generating = false;
    h.page.modelEvidence = pickerEvidence("Direkt");
    const ladder = [31, 61, 91, 121];
    for (const minutes of ladder) {
      t.advance(minutes * MIN - (Date.now() - Date.parse(p.lastPrompt.sentAt)));
      p = await h.mod.tickWaiting(await loadProcessForWindow(1));
    }
    assert.equal(p.queueContext.savedMissionId, "gfw-051", "the queue advanced to the next GFW");
    const after = await loadMissionWorkQueue(1, storage, { workerId: p.workerId });
    const parked = after.items.find((item) => item.savedMissionId === "gfw-052");
    assert.equal(parked.status, "READY");
    assert.ok(parked.processSnapshot, "the held GFW is parked with its continuation");
  } finally {
    t.restore();
  }
});

test("v1.8.6 a quality incident (definite in-flight downgrade) still holds without the ladder", () => {
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const start = background.indexOf("async function tickWaiting(process)");
  const body = background.slice(start, background.indexOf("const baselineHash", start));
  const incident = body.indexOf("if (process.safety?.qualityIncident)");
  const proofHold = body.indexOf("if (!process.safety?.proof?.allowed)");
  assert.ok(incident > 0 && proofHold > incident);
  assert.equal(body.slice(incident, proofHold).includes("maybeEscalateWaitingRefresh"), false);
  assert.match(body.slice(proofHold), /maybeEscalateWaitingRefresh\(process, page, \{ reason: `SAFETY_HOLD:\$\{holdCode\}` \}\)/);
});

// ---------------------------------------------------------------------------
// B: the thinking level shown in the model picker is effort evidence.

test("v1.8.6 effort ranks: Extra hög = heavy, Hög = extended, Direkt is no reasoning level", () => {
  assert.equal(S.effort("Extra hög Välj ChatGPT-modell"), 3);
  assert.equal(S.effort("Extra high"), 3);
  assert.equal(S.effort("xhigh"), 3);
  assert.equal(S.effort("Hög Välj ChatGPT-modell"), 2);
  assert.equal(S.effort("High"), 2);
  assert.equal(S.effort("Direkt Välj ChatGPT-modell"), -1);
  assert.equal(S.effort("Djupgående"), 3, "the former chip is unchanged");
  assert.equal(S.effort("Högtalare"), -1, "whole words only");
});

test("v1.8.6 policy: the picker level proves thinking mode; Direkt stays held without a sticky quarantine", () => {
  const extra = S.evaluateModel(pickerEvidence("Extra hög", { effortControlSeen: true, effortLabel: "Extra hög Välj ChatGPT-modell" }), S.defaults, URL_OK);
  assert.equal(extra.allowed, true);
  assert.equal(extra.effortAssurance, "NAMED_EFFORT");
  const high = S.evaluateModel(pickerEvidence("Hög", { effortControlSeen: true, effortLabel: "Hög Välj ChatGPT-modell" }), S.defaults, URL_OK);
  assert.equal(high.allowed, true, "Hög meets the default Extended floor");
  const highAtHeavy = S.evaluateModel(pickerEvidence("Hög", { effortControlSeen: true, effortLabel: "Hög Välj ChatGPT-modell" }), { ...S.defaults, minimumEffort: "heavy" }, URL_OK);
  assert.equal(highAtHeavy.code, "THINKING_EFFORT_TOO_LOW", "a Heavy floor accepts only Extra hög");
  const direct = S.evaluateModel(pickerEvidence("Direkt"), S.defaults, URL_OK);
  assert.equal(direct.code, "THINKING_MODE_UNVERIFIED",
    "not MODEL_DEGRADED/THINKING_EFFORT_TOO_LOW, which would quarantine an in-flight turn");
});

test("v1.8.6 model observation reads the picker's level when no composer chip exists", () => {
  const observation = fs.readFileSync(new URL("../lib/model-observation.js", import.meta.url), "utf8");
  assert.match(observation, /MODEL_SWITCHER_SELECTED_EFFORT/);
  assert.match(observation, /adapterVersion:5/);
});
