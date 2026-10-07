// v1.9.1: run requirements (Körkrav) survive a new extension identity.
// Operator report 2026-10-07: "Spara körkrav sparas inte bestående, värdena
// återgår till standard om man startar upp Greenfield initialt igen."
// Reproduced in Chromium: saving works and survives a browser restart, but a
// release loaded from a new folder gets a new extension id and an empty
// chrome.storage.local, so the panel showed the defaults. One mockBookmarks()
// below = one Chrome profile; each harness() with fresh storage = Greenfield
// loaded from a new folder in that profile.
import test from "node:test";
import assert from "node:assert/strict";
import "../lib/safety-policy.js";
import { harness, memory } from "./helpers/background-harness.mjs";
import { mockBookmarks } from "./helpers/mock-bookmarks.mjs";
import {
  SAFETY_POLICY_VAULT_FOLDER,
  SAFETY_POLICY_VAULT_SCHEMA,
  loadSafetyPolicyVault,
  writeSafetyPolicyVault,
  safetyPolicyVaultPlan,
  safetyPolicyVaultContract
} from "../lib/safety-policy-vault.mjs";
import { SAFETY_KEY, readSafety, updateSafetyPolicy, adoptSafetyPolicyFromVault, equalSafetyPolicy } from "../lib/usage-governor.mjs";
import { writeCheckpoint } from "../lib/durable-checkpoint.mjs";
import { SAVED_MISSION_VAULT_FOLDER } from "../lib/saved-mission-vault.mjs";
import { QUEUE_SET_VAULT_FOLDER } from "../lib/mission-queue-set-vault.mjs";

const S = globalThis.GreenfieldSafetyPolicy;
const normalizePolicy = S.normalizePolicy;
const DEFAULTS = { ...S.defaults };
const OPERATOR = { ...S.defaults, messages3h: 40, messages24h: 200, messages7d: 1000, tokens24h: 2000000, maxPromptTokens: 60000 };
const SECOND = { ...OPERATOR, messages3h: 30, minGapSeconds: 240 };
const THIRD = { ...OPERATOR, minimumEffort: "heavy", outputReserveTokens: 16000 };
const pick = (p) => Object.fromEntries(Object.keys(S.defaults).map((k) => [k, p?.[k]]));
const panel = (h) => ({ id: h.chrome.runtime.id, url: h.chrome.runtime.getURL("sidepanel.html") });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5)); // distinct save times
const plan = (local, vault) => safetyPolicyVaultPlan({ local, vault, defaults: DEFAULTS, equalPolicy: equalSafetyPolicy });
const legacyRecord = (policy) => ({ schema: "eic.gf.safety.v1", policy: normalizePolicy(policy), admissionPaused: false, providerHold: null, entries: [], events: [], createdAtMs: 1, lastClockMs: 0 });

function vaultFolder(bookmarks) {
  const find = (node) => (!node.url && node.title === SAFETY_POLICY_VAULT_FOLDER) ? node : (node.children || []).map(find).find(Boolean) || null;
  return find(bookmarks.debugTree());
}

// Writes a vault record without the writer's validation (damaged/foreign content).
async function plantRaw(bookmarks, payload, { chunkUrl = null } = {}) {
  const folder = vaultFolder(bookmarks) || await bookmarks.create({ parentId: "2", title: SAFETY_POLICY_VAULT_FOLDER });
  const final = await bookmarks.create({ parentId: folder.id, title: "GFK1:ACTIVE" });
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  await bookmarks.create({ parentId: final.id, title: "chunk 1/1", url: chunkUrl || `https://greenfield.invalid/safety-policy-v1/chunk/0/1#${data}` });
}

test("v1.9.1 vault: write/load round trip in its own profile folder, one committed copy, no stage left", async () => {
  const bookmarks = mockBookmarks();
  assert.equal(await loadSafetyPolicyVault(bookmarks, { normalizePolicy }), null);
  const first = await writeSafetyPolicyVault({ policy: OPERATOR, savedAtMs: 1000, appVersion: "1.9.1" }, { bookmarks, normalizePolicy });
  assert.deepEqual(first, { policy: normalizePolicy(OPERATOR), savedAtMs: 1000, appVersion: "1.9.1" });
  await writeSafetyPolicyVault({ policy: SECOND, savedAtMs: 2000, appVersion: "1.9.1" }, { bookmarks, normalizePolicy });
  const loaded = await loadSafetyPolicyVault(bookmarks, { normalizePolicy });
  assert.deepEqual(pick(loaded.policy), SECOND);
  assert.equal(loaded.savedAtMs, 2000);
  const folder = vaultFolder(bookmarks);
  assert.equal(folder.parentId, "2", "created under Other bookmarks");
  assert.deepEqual(folder.children.map((n) => n.title), ["GFK1:ACTIVE"], "exactly one committed copy, no staging folder");
  // Its own folder: no collision with the saved-mission or queue-set vaults.
  assert.equal(new Set([SAFETY_POLICY_VAULT_FOLDER, SAVED_MISSION_VAULT_FOLDER, QUEUE_SET_VAULT_FOLDER]).size, 3);
  assert.deepEqual(safetyPolicyVaultContract(), {
    schema: SAFETY_POLICY_VAULT_SCHEMA,
    owner: "CHROME_PROFILE_BOOKMARK_STORE",
    extensionInstallIndependent: true,
    extensionIdIndependent: true,
    precedence: "NEWEST_OPERATOR_SAVE_IN_PROFILE"
  });
});

test("v1.9.1 vault: damaged, foreign or out-of-range content reads as absent, never as a policy", async () => {
  const cases = [
    { schema: "other.schema", policy: OPERATOR, savedAtMs: 1000 },
    { schema: SAFETY_POLICY_VAULT_SCHEMA, policy: { ...OPERATOR, messages3h: 0 }, savedAtMs: 1000 },
    { schema: SAFETY_POLICY_VAULT_SCHEMA, policy: { ...OPERATOR, requiredModel: "GPT-4o mini" }, savedAtMs: 1000 },
    { schema: SAFETY_POLICY_VAULT_SCHEMA, policy: OPERATOR, savedAtMs: 0 },
    { schema: SAFETY_POLICY_VAULT_SCHEMA, policy: OPERATOR, savedAtMs: "soon" }
  ];
  for (const payload of cases) {
    const bookmarks = mockBookmarks();
    await plantRaw(bookmarks, payload);
    assert.equal(await loadSafetyPolicyVault(bookmarks, { normalizePolicy }), null, JSON.stringify(payload));
  }
  const missingChunk = mockBookmarks();
  await plantRaw(missingChunk, { schema: SAFETY_POLICY_VAULT_SCHEMA, policy: OPERATOR, savedAtMs: 1000 }, { chunkUrl: "https://greenfield.invalid/safety-policy-v1/chunk/0/2#e30" });
  assert.equal(await loadSafetyPolicyVault(missingChunk, { normalizePolicy }), null, "1 of 2 chunks");
  await assert.rejects(writeSafetyPolicyVault({ policy: { ...OPERATOR, tokens24h: 5 }, savedAtMs: 1000 }, { bookmarks: mockBookmarks(), normalizePolicy }), /SAFETY_POLICY_VAULT_RECORD_INVALID/);
});

test("v1.9.1 vault: a failed write removes its stage and keeps the previous committed copy", async () => {
  let failChunks = false;
  const bookmarks = mockBookmarks({ create: ({ url }) => (failChunks && url ? new Error("BOOKMARK_WRITE_TEST_FAILURE") : undefined) });
  await writeSafetyPolicyVault({ policy: OPERATOR, savedAtMs: 1000 }, { bookmarks, normalizePolicy });
  failChunks = true;
  await assert.rejects(writeSafetyPolicyVault({ policy: SECOND, savedAtMs: 2000 }, { bookmarks, normalizePolicy }), /BOOKMARK_WRITE_TEST_FAILURE/);
  assert.deepEqual(vaultFolder(bookmarks).children.map((n) => n.title), ["GFK1:ACTIVE"]);
  const loaded = await loadSafetyPolicyVault(bookmarks, { normalizePolicy });
  assert.deepEqual(pick(loaded.policy), OPERATOR);
  assert.equal(loaded.savedAtMs, 1000);
});

test("v1.9.1 plan: the newest operator save in the profile wins; defaults never seed the vault", () => {
  const vault = (policy, savedAtMs) => ({ policy: normalizePolicy(policy), savedAtMs, appVersion: "1.9.1" });
  const local = (policy, policyUpdatedAtMs) => ({ ...legacyRecord(policy), ...(policyUpdatedAtMs ? { policyUpdatedAtMs } : {}) });
  const rows = [
    ["new installation, empty profile", null, null, "NONE", "DEFAULTS_NO_VAULT"],
    ["new installation (new extension id), vault present", null, vault(OPERATOR, 1000), "ADOPT_VAULT", "LOCAL_HAS_NO_SAVE_TIME"],
    ["v1.9.0 values, vault empty (upgrade in place)", local(OPERATOR), null, "SEED_VAULT", "VAULT_EMPTY_LEGACY_LOCAL_POLICY"],
    ["v1.9.0 values, newer vault from another folder", local(SECOND), vault(OPERATOR, 1000), "ADOPT_VAULT", "LOCAL_HAS_NO_SAVE_TIME"],
    ["local saved after the vault", local(SECOND, 2000), vault(OPERATOR, 1000), "SEED_VAULT", "LOCAL_NEWER_THAN_VAULT"],
    ["vault saved after local", local(SECOND, 1000), vault(OPERATOR, 2000), "ADOPT_VAULT", "VAULT_NEWER_THAN_LOCAL"],
    ["same save", local(OPERATOR, 1000), vault(OPERATOR, 1000), "NONE", "IN_SYNC"],
    ["vault newer, same values", local(OPERATOR, 1000), vault(OPERATOR, 2000), "NONE", "VAULT_NEWER_SAME_POLICY"],
    ["local newer, same values", local(OPERATOR, 2000), vault(OPERATOR, 1000), "NONE", "IN_SYNC"],
    ["local saved without vault (failed vault write)", local(OPERATOR, 1000), null, "SEED_VAULT", "VAULT_EMPTY"],
    ["explicit save of the defaults is a save", local(DEFAULTS, 3000), vault(OPERATOR, 1000), "SEED_VAULT", "LOCAL_NEWER_THAN_VAULT"]
  ];
  for (const [name, l, v, action, reason] of rows) assert.deepEqual(plan(l, v), { action, reason }, name);
});

test("v1.9.1 governor: an operator save is stamped; adoption is re-checked inside the journal lock", async () => {
  const store = memory();
  const saved = await updateSafetyPolicy(OPERATOR, store, 5000);
  assert.equal(saved.policyUpdatedAtMs, 5000);
  assert.equal(saved.policyOrigin, "OPERATOR");
  // A vault record older than this save must not overwrite it (a save that
  // landed between the startup plan and the adoption).
  const kept = await adoptSafetyPolicyFromVault({ policy: normalizePolicy(SECOND), savedAtMs: 4000 }, store, 6000);
  assert.deepEqual(pick(kept.policy), OPERATOR);
  assert.equal(kept.policyOrigin, "OPERATOR");
  const adopted = await adoptSafetyPolicyFromVault({ policy: normalizePolicy(SECOND), savedAtMs: 7000 }, store, 8000);
  assert.deepEqual(pick(adopted.policy), SECOND);
  assert.equal(adopted.policyUpdatedAtMs, 7000);
  assert.equal(adopted.policyOrigin, "VAULT");
  const restored = (await readSafety(store)).events.at(-1);
  assert.equal(restored.code, "SAFETY_POLICY_RESTORED");
  assert.match(restored.detail, /messages3h 40→30/);
  assert.match(restored.detail, /minGapSeconds 180→240/);
});

test("v1.9.1 reported bug: körkrav saved in one folder are restored when Greenfield is loaded from a new folder", async () => {
  const profile = mockBookmarks();
  const a = await harness({ bookmarks: profile });
  const saved = await a.mod.panelSafetyAction({ type: "EIC_GF_SAFETY_UPDATE", policy: OPERATOR }, panel(a));
  assert.equal(saved.ok, true);
  assert.equal(saved.fleetStatus.safetyVault.state, "SAVED");
  assert.equal(saved.fleetStatus.safetyVault.folder, SAFETY_POLICY_VAULT_FOLDER);
  assert.deepEqual(pick(saved.fleetStatus.safety.policy), OPERATOR);
  // New folder = new extension id = empty chrome.storage.local; same profile bookmarks.
  const b = await harness({ bookmarks: profile });
  const fleet = await b.mod.fleetStatusSnapshot();
  assert.equal(fleet.runtimeFault, "");
  assert.deepEqual(pick(fleet.safety.policy), OPERATOR);
  assert.equal(fleet.safety.policyOrigin, "VAULT");
  assert.equal(fleet.safety.policyUpdatedAtMs, saved.fleetStatus.safetyVault.savedAtMs);
  assert.equal(fleet.safetyVault.state, "RESTORED");
  assert.ok(fleet.safety.events.some((e) => e.code === "SAFETY_POLICY_RESTORED"));
  assert.equal(b.sent.length, 0, "restoring requirements never dispatches");
});

test("v1.9.1 negative control: a new folder without the profile vault starts from the defaults (the v1.9.0 symptom)", async () => {
  const a = await harness({ bookmarks: mockBookmarks() });
  await a.mod.panelSafetyAction({ type: "EIC_GF_SAFETY_UPDATE", policy: OPERATOR }, panel(a));
  const b = await harness({ bookmarks: mockBookmarks() }); // different profile store
  const fleet = await b.mod.fleetStatusSnapshot();
  assert.deepEqual(pick(fleet.safety.policy), DEFAULTS);
  assert.equal(fleet.safetyVault.state, "EMPTY");
});

test("v1.9.1 upgrade in place: v1.9.0 values without a save time seed the vault and then follow to a new folder", async () => {
  const legacy = memory();
  await writeCheckpoint(SAFETY_KEY, legacyRecord(OPERATOR), legacy);
  const profile = mockBookmarks();
  const a = await harness({ seed: legacy.state, bookmarks: profile });
  let fleet = await a.mod.fleetStatusSnapshot();
  assert.equal(fleet.safetyVault.state, "SAVED");
  assert.equal(fleet.safetyVault.reason, "VAULT_EMPTY_LEGACY_LOCAL_POLICY");
  assert.deepEqual(pick(fleet.safety.policy), OPERATOR, "local values untouched");
  const b = await harness({ bookmarks: profile });
  fleet = await b.mod.fleetStatusSnapshot();
  assert.deepEqual(pick(fleet.safety.policy), OPERATOR);
  assert.equal(fleet.safetyVault.state, "RESTORED");
});

test("v1.9.1 newest save wins across two installation folders in the same profile", async () => {
  const profile = mockBookmarks();
  const a = await harness({ bookmarks: profile });
  await a.mod.panelSafetyAction({ type: "EIC_GF_SAFETY_UPDATE", policy: OPERATOR }, panel(a));
  const storageA = a.chrome.storage.local.state;
  await tick();
  const b = await harness({ bookmarks: profile });
  assert.deepEqual(pick((await b.mod.fleetStatusSnapshot()).safety.policy), OPERATOR);
  await b.mod.panelSafetyAction({ type: "EIC_GF_SAFETY_UPDATE", policy: SECOND }, panel(b));
  const storageB = b.chrome.storage.local.state;
  await tick();
  const a2 = await harness({ seed: storageA, bookmarks: profile }); // folder A started again
  let fleet = await a2.mod.fleetStatusSnapshot();
  assert.deepEqual(pick(fleet.safety.policy), SECOND);
  assert.equal(fleet.safetyVault.state, "RESTORED");
  await a2.mod.panelSafetyAction({ type: "EIC_GF_SAFETY_UPDATE", policy: THIRD }, panel(a2));
  await tick();
  const b2 = await harness({ seed: storageB, bookmarks: profile }); // folder B started again
  fleet = await b2.mod.fleetStatusSnapshot();
  assert.deepEqual(pick(fleet.safety.policy), THIRD);
});

test("v1.9.1 a failed vault write keeps the local save, is reported, and is retried at the next start", async () => {
  let failChunks = true;
  const profile = mockBookmarks({ create: ({ url }) => (failChunks && url ? new Error("BOOKMARK_WRITE_TEST_FAILURE") : undefined) });
  const a = await harness({ bookmarks: profile });
  const r = await a.mod.panelSafetyAction({ type: "EIC_GF_SAFETY_UPDATE", policy: OPERATOR }, panel(a));
  assert.equal(r.ok, true);
  assert.deepEqual(pick(r.fleetStatus.safety.policy), OPERATOR, "local journal committed");
  assert.equal(r.fleetStatus.safetyVault.state, "WRITE_FAILED");
  assert.match(r.fleetStatus.safetyVault.error, /BOOKMARK_WRITE_TEST_FAILURE/);
  assert.equal(await loadSafetyPolicyVault(profile, { normalizePolicy }), null);
  assert.deepEqual(vaultFolder(profile).children, [], "no partial copy left behind");
  failChunks = false;
  const a2 = await harness({ seed: a.chrome.storage.local.state, bookmarks: profile });
  const fleet = await a2.mod.fleetStatusSnapshot();
  assert.equal(fleet.safetyVault.state, "SAVED");
  assert.equal(fleet.safetyVault.reason, "VAULT_EMPTY");
  const b = await harness({ bookmarks: profile });
  assert.deepEqual(pick((await b.mod.fleetStatusSnapshot()).safety.policy), OPERATOR);
});

test("v1.9.1 an unreadable bookmark store never blocks startup or the local save", async () => {
  const broken = mockBookmarks({ getTree: () => new Error("BOOKMARKS_TREE_TEST_FAILURE") });
  const h = await harness({ bookmarks: broken });
  let fleet = await h.mod.fleetStatusSnapshot();
  assert.equal(fleet.runtimeFault, "");
  assert.equal(fleet.safetyVault.state, "ERROR");
  assert.match(fleet.safetyVault.error, /BOOKMARKS_TREE_TEST_FAILURE/);
  assert.deepEqual(pick(fleet.safety.policy), DEFAULTS);
  const r = await h.mod.panelSafetyAction({ type: "EIC_GF_SAFETY_UPDATE", policy: OPERATOR }, panel(h));
  assert.equal(r.ok, true);
  assert.deepEqual(pick(r.fleetStatus.safety.policy), OPERATOR);
  assert.equal(r.fleetStatus.safetyVault.state, "WRITE_FAILED");
  // Without the bookmarks API at all (test harness default) nothing changes from v1.9.0.
  const bare = await harness();
  fleet = await bare.mod.fleetStatusSnapshot();
  assert.equal(fleet.runtimeFault, "");
  assert.equal(fleet.safetyVault.state, "UNAVAILABLE");
});

test("v1.9.1 vault: a readback failure after the commit keeps the new copy; an interrupted stage is purged", async () => {
  let trap = false, armed = false;
  const bookmarks = mockBookmarks({ getTree: () => (armed ? new Error("BOOKMARKS_TREE_TEST_FAILURE") : undefined) });
  const update = bookmarks.update;
  bookmarks.update = async (id, changes) => {
    const out = await update(id, changes);
    if (trap && changes?.title === "GFK1:ACTIVE") armed = true; // fail every read after this rename
    return out;
  };
  await writeSafetyPolicyVault({ policy: OPERATOR, savedAtMs: 1000 }, { bookmarks, normalizePolicy });
  trap = true;
  await assert.rejects(writeSafetyPolicyVault({ policy: SECOND, savedAtMs: 2000 }, { bookmarks, normalizePolicy }), /BOOKMARKS_TREE_TEST_FAILURE/);
  trap = armed = false;
  const kept = await loadSafetyPolicyVault(bookmarks, { normalizePolicy });
  assert.deepEqual(pick(kept?.policy), SECOND, "the committed newer copy survives its failed readback");
  // A stage left behind by an interrupted write is removed by the next write.
  await bookmarks.create({ parentId: vaultFolder(bookmarks).id, title: "GFK1-STAGE:interrupted" });
  await writeSafetyPolicyVault({ policy: THIRD, savedAtMs: 3000 }, { bookmarks, normalizePolicy });
  assert.deepEqual(vaultFolder(bookmarks).children.map((n) => n.title), ["GFK1:ACTIVE"]);
});

test("v1.9.1 vault: incomplete or far-future records are rejected; the newest of two committed copies wins", async () => {
  const { messages3h, ...partial } = OPERATOR;
  const cases = [
    { schema: SAFETY_POLICY_VAULT_SCHEMA, savedAtMs: 1000 },
    { schema: SAFETY_POLICY_VAULT_SCHEMA, policy: partial, savedAtMs: 1000 },
    { schema: SAFETY_POLICY_VAULT_SCHEMA, policy: [], savedAtMs: 1000 },
    { schema: SAFETY_POLICY_VAULT_SCHEMA, policy: OPERATOR, savedAtMs: Date.now() + 3 * 86400000 }
  ];
  for (const payload of cases) {
    const bookmarks = mockBookmarks();
    await plantRaw(bookmarks, payload);
    assert.equal(await loadSafetyPolicyVault(bookmarks, { normalizePolicy }), null, JSON.stringify(payload).slice(0, 120));
  }
  assert.equal(messages3h, OPERATOR.messages3h);
  // Chrome Sync can merge two committed copies in any order.
  const synced = mockBookmarks();
  await plantRaw(synced, { schema: SAFETY_POLICY_VAULT_SCHEMA, policy: SECOND, savedAtMs: 2000 });
  await plantRaw(synced, { schema: SAFETY_POLICY_VAULT_SCHEMA, policy: OPERATOR, savedAtMs: 1000 });
  const loaded = await loadSafetyPolicyVault(synced, { normalizePolicy });
  assert.equal(loaded.savedAtMs, 2000);
  assert.deepEqual(pick(loaded.policy), SECOND);
});

test("v1.9.1 a settled sync is reused for the browser session; a worker restart does not reread bookmarks", async () => {
  let reads = 0;
  const profile = mockBookmarks({ getTree: () => { reads += 1; } });
  const a = await harness({ bookmarks: profile });
  await a.mod.panelSafetyAction({ type: "EIC_GF_SAFETY_UPDATE", policy: OPERATOR }, panel(a));
  const b = await harness({ bookmarks: profile });
  assert.equal((await b.mod.fleetStatusSnapshot()).safetyVault.state, "RESTORED");
  const readsAfterRestore = reads;
  // Same installation, same browser session (chrome.storage.session kept), new worker.
  const b2 = await harness({ seed: b.chrome.storage.local.state, sessionSeed: b.chrome.storage.session.state, bookmarks: profile });
  const fleet = await b2.mod.fleetStatusSnapshot();
  assert.equal(reads, readsAfterRestore, "no bookmark tree read");
  assert.equal(fleet.safetyVault.state, "RESTORED", "status survives the worker restart");
  assert.deepEqual(pick(fleet.safety.policy), OPERATOR);
});

test("v1.9.1 a hanging bookmark store times out instead of blocking startup", async () => {
  const hanging = mockBookmarks();
  hanging.getTree = () => new Promise(() => {});
  const starting = harness({ bookmarks: hanging });
  let timer = null;
  for (let i = 0; i < 2000 && !timer; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    timer = (globalThis.__gfHarnessTimers || []).find((t) => t.ms === 8000);
  }
  assert.ok(timer, "startup armed the vault timeout");
  timer.fn();
  const h = await starting;
  const fleet = await h.mod.fleetStatusSnapshot();
  assert.equal(fleet.runtimeFault, "");
  assert.equal(fleet.safetyVault.state, "ERROR");
  assert.match(fleet.safetyVault.error, /SAFETY_POLICY_VAULT_TIMEOUT/);
  assert.equal(await h.chrome.storage.session.get("eic.gf.safety-vault-status.v1").then((r) => r["eic.gf.safety-vault-status.v1"]), undefined, "a failed sync is retried at the next worker start");
});

test("v1.9.1 a save stamped ahead of the corrected clock still seeds the vault (clamped to now)", async () => {
  // Saved while the system clock ran 3 days fast; the clock has since been corrected.
  const skewed = memory();
  await writeCheckpoint(SAFETY_KEY, { ...legacyRecord(OPERATOR), policyUpdatedAtMs: Date.now() + 3 * 86400000, policyOrigin: "OPERATOR" }, skewed);
  const profile = mockBookmarks();
  const a = await harness({ seed: skewed.state, bookmarks: profile });
  const fleet = await a.mod.fleetStatusSnapshot();
  assert.equal(fleet.safetyVault.state, "SAVED", JSON.stringify(fleet.safetyVault));
  assert.ok(fleet.safetyVault.savedAtMs <= Date.now());
  const b = await harness({ bookmarks: profile });
  assert.deepEqual(pick((await b.mod.fleetStatusSnapshot()).safety.policy), OPERATOR);
});
