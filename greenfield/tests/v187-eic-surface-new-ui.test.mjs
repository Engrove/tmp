import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../lib/safety-policy.js";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow } from "../lib/process-store.mjs";
import { addMissionWorkItem } from "../lib/mission-work-queue.mjs";
import { ensureWorkerBinding } from "../lib/worker-identity.mjs";
import {
  EIC_SURFACE_STATE_KEY,
  classifyManagedEicSurface,
  readEicSurfaceState,
  recoveryDecision,
  rememberGoodEicUrl
} from "../lib/managed-eic-surface.mjs";
import { deriveGptRoot } from "../lib/session-rotation.mjs";
import { memory } from "./helpers/background-harness.mjs";

// ChatGPT's newer shell (operator report 2026-09-26): conversation URLs of a
// custom GPT drop the name slug (/g/g-<id>/c/<conv> instead of
// /g/g-<id>-eic/c/<conv>), and a pinned GPT is selected client-side and shown
// at "/" with a composer pill "EIC" and a page header "EIC". Synthetic ids.
const S = globalThis.GreenfieldSafetyPolicy;
const EIC_ROOT = "https://chatgpt.com/g/g-test-eic"; // the harness's EIC root
const EIC_SLUGLESS = "https://chatgpt.com/g/g-test";
const HOME = "https://chatgpt.com/";
const NOW = Date.now();
const evidence = (gpt = null) => ({
  source: "CHATGPT_UI_CONTROLS_V1",
  observedAtMs: NOW,
  modelLabel: "GPT-5.6 Thinking",
  effortLabel: "Extended",
  mode: "CHAT",
  quota: { active: false },
  ...(gpt ? { gptSurface: { composerName: "", headerName: "", ambiguous: false, version: 1, ...gpt } } : {})
});
const proof = (url, ev = evidence(), gptRoot = EIC_ROOT) => S.evaluateModel(ev, S.defaults, { now: NOW, url, gptRoot });

// ---------------------------------------------------------------------------
// Reproduction (fails on v1.8.6): GPT identity compared with the name slug.

test("v1.8.7 repro: a slugless conversation URL is the same EIC GPT and keeps the named root", () => {
  const c = classifyManagedEicSurface(`${EIC_SLUGLESS}/c/6ab7-conv`, EIC_ROOT);
  assert.equal(c.ok, true);
  assert.equal(c.kind, "EIC_CUSTOM_GPT");
  assert.equal(c.observedRoot, EIC_ROOT, "the slug is kept: it names the GPT where ChatGPT shows it at '/'");
  assert.equal(recoveryDecision({ observedUrl: `${EIC_SLUGLESS}/c/6ab7-conv`, processRoot: EIC_ROOT, now: 50_000 }).action, "ACCEPT");
});

test("v1.8.7 repro: the model gate accepts the EIC conversation at its slugless URL", () => {
  const r = proof(`${EIC_SLUGLESS}/c/6ab7-conv`);
  assert.equal(r.allowed, true, r.code);
});

test("v1.8.7 repro: the model gate accepts EIC shown at '/' by its composer pill and header", () => {
  assert.equal(proof(HOME, evidence({ composerName: "EIC", headerName: "EIC" })).allowed, true);
  assert.equal(proof(HOME, evidence({ composerName: "EIC" })).allowed, true);
  assert.equal(proof(HOME, evidence({ headerName: "EIC" })).allowed, true);
});

test("v1.8.7 repro: a rotation root derived from a slugless URL keeps the named EIC root", () => {
  assert.equal(deriveGptRoot(`${EIC_SLUGLESS}/c/6ab7-conv`, EIC_ROOT), EIC_ROOT);
});

test("v1.8.7 repro: a slugless URL never erases the remembered named EIC root", async () => {
  const storage = memory();
  await rememberGoodEicUrl(`${EIC_ROOT}/c/first`, storage);
  await rememberGoodEicUrl(`${EIC_SLUGLESS}/c/second`, storage);
  assert.equal((await readEicSurfaceState(storage)).lastKnownGoodEicUrl, EIC_ROOT);
  await rememberGoodEicUrl("https://chatgpt.com/g/g-other-matlogg/c/x", storage);
  assert.equal((await readEicSurfaceState(storage)).lastKnownGoodEicUrl, "https://chatgpt.com/g/g-other-matlogg",
    "a different GPT id is a new verified root, as before");
});

// ---------------------------------------------------------------------------
// Fail-closed rules for the new proof.

test("v1.8.7 the '/' proof is the GPT name and fails closed on anything else", () => {
  const denied = (url, ev, root) => {
    const r = proof(url, ev, root);
    assert.equal(r.allowed, false);
    assert.equal(r.code, "EIC_SURFACE_UNVERIFIED");
  };
  denied(HOME, evidence());
  denied(HOME, evidence({}));
  denied(HOME, evidence({ composerName: "Matlogg" }));
  denied(HOME, evidence({ composerName: "EIC", headerName: "Matlogg" }));
  denied(HOME, evidence({ composerName: "EIC", ambiguous: true }));
  denied(HOME, evidence({ composerName: "EIC" }), EIC_SLUGLESS);
  denied("https://chatgpt.com/g/g-other/c/abc", evidence({ composerName: "EIC" }));
  denied("https://chatgpt.com/g/g-other-eic/c/abc", evidence({ composerName: "EIC" }));
  denied("https://chatgpt.com.evil.test/c/abc", evidence({ composerName: "EIC" }));
  denied("https://chat.openai.com/", evidence({ composerName: "EIC" }));
  denied("https://chatgpt.com/gpts/editor", evidence());
  denied(HOME, evidence({ composerName: "EIC" }), HOME);
  assert.equal(S.eicSurfaceProof(evidence({ composerName: "EIC" }), HOME, EIC_ROOT).kind, "GPT_NAME_MATCH");
  assert.equal(S.eicSurfaceProof(evidence(), `${EIC_SLUGLESS}/c/x`, EIC_ROOT).kind, "URL_GPT_ID");
  assert.equal(S.gptRef("https://chatgpt.com/g/g-0a1b2c3d4e5f60718293a4b5c6d7e8f9-eic/c/x").id, "g-0a1b2c3d4e5f60718293a4b5c6d7e8f9");
  assert.equal(S.gptRef("https://chatgpt.com/g/g-p-abc123-greenfield/project").id, "g-p-abc123");
  assert.equal(S.gptNameSlug("Åtgärds Lista 2"), "atgards-lista-2");
});

test("v1.8.7 the processing gate for 'Pro' is unchanged: THINKING_MODE_UNVERIFIED, never a quarantine code", () => {
  // Model picker as exported 2026-09-26: text "Pro", data-selected-reasoning-effort="medium".
  const pro = { ...evidence({ composerName: "EIC", headerName: "EIC" }), modelLabel: "Pro Välj ChatGPT-modell", effortLabel: "", reasoningControlSeen: false, effortControlSeen: false };
  const r = proof(HOME, pro);
  assert.equal(r.code, "THINKING_MODE_UNVERIFIED");
  assert.notEqual(r.code, "THINKING_EFFORT_TOO_LOW");
  assert.notEqual(r.code, "MODEL_DEGRADED");
});

// ---------------------------------------------------------------------------
// E2E: queue start and session rotation in ChatGPT's newer shell.

function fakeClock() {
  const realNow = Date.now;
  let offset = 0;
  return {
    advance(ms) { offset += ms; Date.now = () => realNow() + offset; },
    restore() { Date.now = realNow; }
  };
}

async function newShell({ remember = true, land, select = () => null } = {}) {
  const h = await harness({ extraExports: ["startMissionQueue", "tickRotating", "enforceManagedEicSurface"] });
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  const storage = h.chrome.storage.local;
  if (remember) {
    await storage.set({ [EIC_SURFACE_STATE_KEY]: { schema: "eic.greenfield.eic-surface.v1", lastKnownGoodEicUrl: EIC_ROOT, updatedAt: new Date().toISOString() } });
  }
  const show = (url, gpt = "") => {
    h.tab.url = url;
    Object.assign(h.page, { url, userCount: 0, assistantCount: 0, generating: false, lastUserText: "", lastUserHash: "", lastUserId: "" });
    h.page.modelEvidence = { ...h.page.modelEvidence, gptSurface: { composerName: gpt, headerName: gpt, ambiguous: false, version: 1 } };
  };
  const navigations = [];
  const selects = [];
  h.chrome.tabs.update = async (_id, patch) => {
    if (typeof patch?.url !== "string") return Object.assign(h.tab, patch);
    navigations.push(patch.url);
    const shown = land(patch.url);
    show(shown.url, shown.gpt);
    return h.tab;
  };
  const send = h.chrome.tabs.sendMessage;
  h.chrome.tabs.sendMessage = async (id, message) => {
    if (message.type === "EIC_GF_SELECT_GPT") {
      selects.push(message.slug);
      const shown = select(message.slug);
      if (shown) show(shown.url, shown.gpt);
      return shown ? { ok: true, clicked: true, code: "PINNED_GPT_CLICKED", candidates: 1 } : { ok: false, clicked: false, code: "PINNED_GPT_NOT_FOUND", candidates: 0 };
    }
    return send(id, message);
  };
  // Operator's start page: ChatGPT home ("/") in the new shell.
  show(HOME, "");
  const binding = await ensureWorkerBinding(1, h.chrome.storage.session);
  await addMissionWorkItem(1, "Projekt: 71 - Greenfield Works - Gf: GF-052.", { storage, workerId: binding.workerId, savedMissionId: "gfw-052", maxInteractions: 5 });
  return { h, navigations, selects, show };
}

async function drive(h, clock, until, max = 60) {
  let p = await loadProcessForWindow(1);
  for (let i = 0; i < max && !until(p); i += 1) {
    if (p.phase === "ROTATING") await h.mod.tickRotating(p);
    else if (p.phase === "SENDING") await h.mod.tickSending(p);
    else break;
    clock.advance(5_000);
    p = await loadProcessForWindow(1);
  }
  return p;
}

test("v1.8.7 repro E2E: queue start from ChatGPT home navigates to the EIC GPT, not to standard chat", async () => {
  const shownAsEic = (url) => (String(url).startsWith(EIC_SLUGLESS) ? { url: EIC_SLUGLESS, gpt: "EIC" } : { url: HOME, gpt: "" });
  const { h, navigations } = await newShell({ land: shownAsEic });
  const clock = fakeClock();
  try {
    const started = await h.mod.startMissionQueue({ windowId: 1 });
    assert.equal(started.ok, true);
    const p = await drive(h, clock, (q) => q.phase === "WAITING");
    assert.equal(navigations[0], EIC_ROOT, "first navigation is the remembered EIC GPT");
    assert.equal(navigations.includes(HOME), false, "never navigates to standard chat");
    assert.equal(p.phase, "WAITING");
    assert.equal(h.sent.length, 1, "exactly one prompt, in EIC");
    assert.equal(p.gptRoot, EIC_ROOT, "the named root is kept");
  } finally {
    clock.restore();
  }
});

test("v1.8.7 repro E2E: a rotation that lands in standard chat is steered to EIC before anything is sent", async () => {
  // Worst case: every GPT address opens standard chat at "/"; only a click on
  // the pinned GPT selects EIC (client-side, the URL stays "/").
  const { h, navigations, selects } = await newShell({
    land: () => ({ url: HOME, gpt: "" }),
    select: (slug) => (slug === "eic" ? { url: HOME, gpt: "EIC" } : null)
  });
  const clock = fakeClock();
  try {
    await h.mod.startMissionQueue({ windowId: 1 });
    const seen = [];
    const p = await drive(h, clock, (q) => { seen.push(`${q.phase}:${h.page.modelEvidence.gptSurface?.composerName || ""}`); return q.phase === "WAITING"; });
    assert.deepEqual(navigations, [EIC_ROOT, EIC_SLUGLESS], "named root, then the slugless form");
    assert.deepEqual(selects, ["eic"], "then the pinned GPT is clicked once");
    assert.equal(p.phase, "WAITING");
    assert.equal(h.sent.length, 1, "exactly one prompt, sent after EIC was shown");
    assert.equal(seen.some((row) => row === "SENDING:"), false, "never SENDING while standard chat is shown");
  } finally {
    clock.restore();
  }
});

test("v1.8.7 E2E: EIC never selectable -> BLOCKED SESSION_ROTATION_EIC_NOT_SELECTED, nothing sent", async () => {
  const { h, navigations, selects } = await newShell({ land: () => ({ url: HOME, gpt: "" }) });
  const clock = fakeClock();
  try {
    await h.mod.startMissionQueue({ windowId: 1 });
    const p = await drive(h, clock, (q) => q.phase === "BLOCKED");
    assert.equal(p.phase, "BLOCKED");
    assert.equal(p.lastError.code, "SESSION_ROTATION_EIC_NOT_SELECTED");
    assert.equal(h.sent.length, 0);
    assert.equal(selects.length, 3, "at most three pinned-GPT clicks");
    assert.deepEqual(navigations, [EIC_ROOT, EIC_SLUGLESS]);
  } finally {
    clock.restore();
  }
});

test("v1.8.7 E2E: without any known EIC address the queue refuses to start (no standard chat)", async () => {
  const { h, navigations } = await newShell({ remember: false, land: () => ({ url: HOME, gpt: "" }) });
  await assert.rejects(h.mod.startMissionQueue({ windowId: 1 }), /EIC_GPT_ROOT_UNKNOWN/);
  assert.deepEqual(navigations, []);
  assert.equal(h.sent.length, 0);
});

test("v1.8.7 E2E surface guard: accepts EIC shown at '/', stays out of a rotation, still recovers standard chat", async () => {
  const h = await harness({ extraExports: ["enforceManagedEicSurface"] });
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 71 - Greenfield Works - Gf: GF-052." });
  const navigations = [];
  h.chrome.tabs.update = async (_id, patch) => { navigations.push(patch.url); return h.tab; };
  const p = await loadProcessForWindow(1);
  h.tab.url = HOME;
  h.page.url = HOME;
  h.page.modelEvidence = { ...h.page.modelEvidence, gptSurface: { composerName: "EIC", headerName: "EIC", ambiguous: false, version: 1 } };
  const accepted = await h.mod.enforceManagedEicSurface(p, h.tab);
  assert.equal(accepted.action, "ACCEPT");
  assert.equal(accepted.classification, "EIC_BY_NAME");
  const rotating = await h.mod.enforceManagedEicSurface({ ...p, phase: "ROTATING" }, { ...h.tab, url: "https://chatgpt.com/g/g-other/c/x" });
  assert.equal(rotating.action, "ROTATION_OWNS_NAVIGATION");
  h.page.modelEvidence = { ...h.page.modelEvidence, gptSurface: { composerName: "", headerName: "", ambiguous: false, version: 1 } };
  const grace = await h.mod.enforceManagedEicSurface(p, h.tab);
  assert.equal(grace.action, "GRACE");
  const realNow = Date.now;
  Date.now = () => realNow() + 11_000;
  try {
    const recover = await h.mod.enforceManagedEicSurface(p, h.tab);
    assert.equal(recover.action, "RECOVER");
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual(navigations, [EIC_ROOT]);
});

// ---------------------------------------------------------------------------
// Content script contracts (DOM behaviour: tools/verify-eic-surface.mjs).

test("v1.8.7 content selects only a pinned GPT and reads the processing notice's new wording", () => {
  const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
  const observation = fs.readFileSync(new URL("../lib/model-observation.js", import.meta.url), "utf8");
  assert.match(content, /message\.type === "EIC_GF_SELECT_GPT"/);
  assert.match(content, /section\[data-app-action-sidebar-section-heading='Pinned'\]/);
  assert.match(content, /Våra system bearbetar \(\?:den här\|denna\) begäran/);
  assert.match(observation, /gptSurface:gptSurface\(\)/);
  assert.match(observation, /adapterVersion:5/, "the model adapter is unchanged");
});
