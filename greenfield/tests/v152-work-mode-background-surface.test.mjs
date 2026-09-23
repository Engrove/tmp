import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { queueAfterResponseAction, QUEUE_AFTER_RESPONSE } from "../lib/queue-control-policy.mjs";
import { parseTargetResponse } from "../lib/response-contract.mjs";
import { classifyManagedEicSurface, recoveryDecision } from "../lib/managed-eic-surface.mjs";
import { enqueueWorkModePointer, claimNextWorkModePointer, validateWmtPointer, wmtPointerMission } from "../lib/work-mode.mjs";

test("v1.5.2 BACKGROUND_SLEEP parks queue work instead of holding the worker", () => {
  assert.equal(queueAfterResponseAction({
    queueManaged: true,
    queueQuantumReached: false,
    sessionAction: "BACKGROUND_SLEEP"
  }), QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH);
  assert.equal(queueAfterResponseAction({
    queueManaged: true,
    queueQuantumReached: false,
    sessionAction: "PAUSE_PROCESS"
  }), QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH);
});

test("v1.5.2 BACKGROUND_SLEEP contract requires bounded pause and restart-safe continuation", () => {
  const good = JSON.stringify({
    schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "Wait for owner state.",
    workPerformed: ["Checkpointed."], evidence: ["owner receipt"], blockers: [],
    nextSuggestedAction: "Re-read owner state and continue from checkpoint.",
    sessionAction: "BACKGROUND_SLEEP", sessionReason: "Time dependency", pauseSeconds: 3600
  });
  assert.equal(parseTargetResponse(good).ok, true);
  const bad = JSON.stringify({
    schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "Wait.",
    workPerformed: [], evidence: [], blockers: [], nextSuggestedAction: "Resume.",
    sessionAction: "BACKGROUND_SLEEP", pauseSeconds: 10
  });
  assert.equal(parseTargetResponse(bad).ok, false);
});

test("v1.5.2 EIC surface guard distinguishes generic ChatGPT and recovers only after grace", () => {
  const eic = "https://chatgpt.com/g/g-abc-eic";
  assert.equal(classifyManagedEicSurface("https://chatgpt.com/", eic).kind, "GENERIC_CHATGPT");
  assert.equal(recoveryDecision({ observedUrl: "https://chatgpt.com/", processRoot: eic, wrongSinceMs: 1000, now: 10999 }).action, "GRACE");
  assert.equal(recoveryDecision({ observedUrl: "https://chatgpt.com/", processRoot: eic, wrongSinceMs: 1000, now: 11000 }).action, "RECOVER");
  assert.equal(recoveryDecision({ observedUrl: eic + "/c/123", processRoot: eic, now: 11000 }).action, "ACCEPT");
});

test("v1.5.2 WMT pointer admission is fresh, bounded and capability-keyed", () => {
  const now = 1000000;
  const pointer = {
    schema: "eic.greenfield.work-mode.pointer.v1",
    taskRef: "WMT-42", revision: 3, objective: "Review candidate",
    nonce: "nonce-123", taskKey: "0123456789abcdef0123456789abcdef",
    issuedAtMs: now, expiresAtMs: now + 120000
  };
  assert.equal(validateWmtPointer(pointer, { now }).ok, true);
  assert.match(wmtPointerMission(pointer), /taskRef=WMT-42/);
  assert.equal(validateWmtPointer({ ...pointer, issuedAtMs: now - 120000 }, { now }).ok, false);
  assert.equal(validateWmtPointer({ ...pointer, taskKey: "" }, { now }).ok, false);
});


test("v1.5.2 Work Mode prequeue dedupes and claims one WMT locally", async () => {
  const state = {};
  const storage = {
    async get(k) { return { [k]: structuredClone(state[k]) }; },
    async set(v) { Object.assign(state, structuredClone(v)); }
  };
  const now = 2000000;
  const p = { schema: "eic.greenfield.work-mode.pointer.v1", taskRef: "WMT-9", revision: 1,
    objective: "Do work", nonce: "n-9", taskKey: "0123456789abcdef", issuedAtMs: now, expiresAtMs: now + 120000 };
  await enqueueWorkModePointer(p, storage, { now });
  await enqueueWorkModePointer(p, storage, { now });
  const claim = await claimNextWorkModePointer(storage, { now });
  assert.equal(claim.queue.items.length, 1);
  assert.equal(claim.item.pointer.taskRef, "WMT-9");
  const second = await claimNextWorkModePointer(storage, { now });
  assert.equal(second.item, null);
});

test("v1.5.2 static Work Mode and surface recovery wiring are present without replacing existing queue", () => {
  const bg = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.match(bg, /syncWorkModeForWorker/);
  assert.match(bg, /drainWorkModePrequeue/);
  assert.match(bg, /chrome\.windows\.create/);
  assert.match(bg, /EIC_SURFACE_RECOVERY_TRIGGERED/);
  assert.match(html, /Arbetsläge/);
  assert.match(html, /Uppdragskö/);
  assert.ok(manifest.host_permissions.includes("https://api.elho.fi/*"));
});
