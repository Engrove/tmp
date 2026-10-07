// v1.9.3 operator rule (2026-10-07): work a GFW delegates through
// missionDelegations lands in the queue of the same Chrome window as the
// delegating GFW, on a later worker tick. End-to-end through the real
// background.js with the Chrome harness; synthetic ids and texts only.
import test from "node:test";
import assert from "node:assert/strict";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow, saveProcess } from "../lib/process-store.mjs";
import { addMissionWorkItem, loadMissionWorkQueue } from "../lib/mission-work-queue.mjs";
import { ensureWorkerBinding } from "../lib/worker-identity.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { conversationKey } from "../lib/restart-recovery.mjs";
import { loadMissionDelegationRegistry, MISSION_DELEGATION_STATE } from "../lib/mission-delegation.mjs";

const ROOT = "https://chatgpt.com/g/g-test-eic";
const CONV_A = `${ROOT}/c/00000000-0000-4000-8000-0000000000aa`;

function clock() {
  const RealDate = globalThis.Date;
  let now = RealDate.now();
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  return { advance(ms) { now += ms; }, restore() { globalThis.Date = RealDate; } };
}

function showFreshChat(h) {
  Object.assign(h.page, { url: ROOT, userCount: 0, assistantCount: 0, lastUserId: "", generating: false, composerReady: true, composerEmpty: true });
  h.tab.url = ROOT;
}

async function tickUntil(h, t, predicate, max = 80) {
  let p = await loadProcessForWindow(1);
  for (let i = 0; i < max && !predicate(p); i += 1) {
    const tick = p.phase === "ROTATING" ? h.mod.tickRotating : p.phase === "SENDING" ? h.mod.tickSending : null;
    if (!tick) break;
    await tick(p);
    t.advance(4000);
    p = await loadProcessForWindow(1);
  }
  return p;
}

const DELEGATION = {
  requestId: "req-same-window-001",
  label: "GF-903 synthetic follow-up",
  mission: "Projekt: 900 - Syntetiskt testprojekt - Gf: GF-903. Synthetic follow-up mission.",
  priority: "NORMAL",
  relation: "SUPPORTS_CURRENT"
};

test("v1.9.3 E2E: a GFW's missionDelegations are appended to its own window's queue", async () => {
  const t = clock();
  try {
    const h = await harness({ extraExports: ["startMissionQueue", "tickRotating"] });
    h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
    h.chrome.tabs.update = (update => async (id, patch) => {
      if (patch?.url) h.page.url = patch.url;
      return update(id, patch);
    })(h.chrome.tabs.update);
    h.chrome.tabs.reload = async () => {};
    const worker = await ensureWorkerBinding(1);
    for (const [gf, maxInteractions] of [["GF-901", 5], ["GF-902", 1]]) {
      await addMissionWorkItem(1, `Projekt: 900 - Syntetiskt testprojekt - Gf: ${gf}.`, {
        storage: h.chrome.storage.local, workerId: worker.workerId, maxInteractions
      });
    }
    showFreshChat(h);
    await h.mod.startMissionQueue({ windowId: 1 });
    const a = await tickUntil(h, t, (p) => p.phase === "WAITING");
    assert.equal(a.phase, "WAITING");

    // The prompt lists this window's queue (operator request 2026-10-07).
    const sentEnvelope = JSON.parse(h.sent.at(-1).prompt);
    assert.deepEqual(sentEnvelope.control.windowQueue.slots.map((slot) => slot.gf), ["GF-901", "GF-902"]);
    assert.equal(sentEnvelope.control.windowQueue.slots[0].current, true);
    assert.equal(sentEnvelope.control.windowQueue.slots[0].status, "ACTIVE");
    assert.equal(sentEnvelope.responseContract.missionDelegationControl.target, "SAME_WINDOW_GREENFIELD_QUEUE");

    // A yields early with one delegation; the boundary path persists it.
    const text = JSON.stringify({
      schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "Synthetic bounded work.",
      workPerformed: ["Read owner state."], evidence: ["Owner readback."], blockers: [],
      nextSuggestedAction: "Continue the synthetic package.", sessionAction: "YIELD_TO_QUEUE", sessionReason: "Queue turn.",
      missionDelegations: [DELEGATION]
    });
    const hash = await sha256Hex(text);
    await saveProcess({
      ...a, phase: "ANALYZING", lastManagedUrl: CONV_A,
      lastResponse: { text, hash, messageId: "assistant-a", observation: { documentId: h.page.documentId, conversationKey: conversationKey(CONV_A), messageId: "assistant-a" } },
      updatedAt: new Date().toISOString()
    });
    const b = await h.mod.tickAnalyzing(await loadProcessForWindow(1));
    assert.notEqual(b.processId, a.processId, "the queue moved on to B");

    let registry = await loadMissionDelegationRegistry(h.chrome.storage.local);
    const pending = registry.items.find((item) => item.requestId === DELEGATION.requestId);
    assert.equal(pending.state, MISSION_DELEGATION_STATE.PENDING);
    const queueBefore = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: worker.workerId });
    assert.equal(pending.sourceQueueId, queueBefore.queueId);

    // The same window's worker accepts it on its next tick.
    await h.mod.tickProcess(b.processId, "test-delegation");
    const queue = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: worker.workerId });
    const added = queue.items.find((item) => item.delegation?.requestId === DELEGATION.requestId);
    assert.ok(added, "the delegated slot is in the delegating window's queue");
    assert.equal(added.delegation.sourceQueueId, queue.queueId);
    assert.equal(added.delegation.sourceWindowId, 1);
    assert.equal(added.label, DELEGATION.label);
    assert.ok(Number(added.order) > Math.max(...queue.items.filter((item) => item !== added).map((item) => Number(item.order))), "appended at the end");
    registry = await loadMissionDelegationRegistry(h.chrome.storage.local);
    const applied = registry.items.find((item) => item.requestId === DELEGATION.requestId);
    assert.equal(applied.state, MISSION_DELEGATION_STATE.APPLIED);
    assert.equal(applied.targetQueueId, queue.queueId);

    // A second tick does not duplicate it.
    await h.mod.tickProcess(b.processId, "test-delegation-again");
    const again = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: worker.workerId });
    assert.equal(again.items.filter((item) => item.delegation?.requestId === DELEGATION.requestId).length, 1);
  } finally { t.restore(); }
});
