// v1.9.2: the Drift settings (Paus mellan analys och post, Max parallella,
// Grundparametrar för uppdragskö) follow the operator to a new installation
// folder through the same profile bookmark vault as the run requirements
// (v1.9.1). Operator request 2026-10-07: "lägga dem i samma valv".
// Each setting has its own save time; for each setting the newest save in the
// profile wins, so saving one setting never carries the other seven with it.
// One mockBookmarks() = one Chrome profile; each harness() with fresh storage
// = Greenfield loaded from a new folder (new extension id) in that profile.
import test from "node:test";
import assert from "node:assert/strict";
import "../lib/safety-policy.js";
import { harness, memory } from "./helpers/background-harness.mjs";
import { mockBookmarks } from "./helpers/mock-bookmarks.mjs";
import {
  SAFETY_POLICY_VAULT_FOLDER,
  DRIFT_SETTINGS_VAULT_SCHEMA,
  loadDriftSettingsVault,
  writeDriftSettingsVault,
  loadSafetyPolicyVault,
  writeSafetyPolicyVault,
  driftSettingsVaultContract
} from "../lib/safety-policy-vault.mjs";
import {
  OPERATOR_SETTINGS_KEY,
  DRIFT_SETTINGS_KEYS,
  DEFAULT_DRIFT_SETTINGS,
  LEGACY_DRIFT_STAMP,
  driftSettingsOf,
  mergeDriftSettings,
  normalizeDriftSettingsStrict,
  normalizeDriftVaultSettings,
  normalizeOperatorSettings,
  saveOperatorSettings,
  loadOperatorSettings,
  reconcileLocalDriftSettings,
  saveMissionPreset
} from "../lib/operator-settings.mjs";

const S = globalThis.GreenfieldSafetyPolicy;
const normalizeSettings = normalizeDriftVaultSettings;
const OPERATOR = { postDelaySeconds: 45, maxActiveSessions: 4, defaultMissionQuantumInteractions: 12, queuePriorityAgingSeconds: 600, queueSwitchHardReload: false, queueSwitchDelaySeconds: 20, queueSwitchSettleSeconds: 9, warmQueueResume: false };
const SECOND = { ...OPERATOR, postDelaySeconds: 90, maxActiveSessions: 3, defaultMissionQuantumInteractions: 7 };
const QUEUE_KEYS = ["defaultMissionQuantumInteractions", "queuePriorityAgingSeconds", "queueSwitchHardReload", "queueSwitchDelaySeconds", "queueSwitchSettleSeconds", "warmQueueResume"];
const pickQueue = (v) => Object.fromEntries(QUEUE_KEYS.map((k) => [k, v[k]]));
const stampsAll = (ms) => Object.fromEntries(DRIFT_SETTINGS_KEYS.map((k) => [k, ms]));
const vaultRecord = (values, ms) => ({ settings: { values: { ...values }, keySavedAtMs: typeof ms === "number" ? stampsAll(ms) : ms }, savedAtMs: typeof ms === "number" ? ms : Math.max(...Object.values(ms)), appVersion: "1.9.2" });
const settingsOf = (h) => loadOperatorSettings(h.chrome.storage.local, { restoreSavedMissions: false, bookmarks: null });
const panelSender = (h) => ({ id: h.chrome.runtime.id, url: h.chrome.runtime.getURL("sidepanel.html") });
const EXPORTS = ["setMaxActiveSessions", "saveQueueSettingsFromPanel", "savePostDelayFromPanel"];
const start = (opts = {}) => harness({ extraExports: EXPORTS, ...opts });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5)); // distinct save times
const OPTS = { restoreSavedMissions: false, bookmarks: null };

// The three operator save paths, exactly as the panel drives them.
async function saveAllFromPanel(h, values) {
  const max = await h.mod.setMaxActiveSessions({ windowId: 1, maxActiveSessions: values.maxActiveSessions });
  const queue = await h.mod.saveQueueSettingsFromPanel({ windowId: 1, workerId: "w", ...pickQueue(values) });
  const pause = await h.mod.savePostDelayFromPanel({ type: "EIC_GF_SET_POST_DELAY", postDelaySeconds: values.postDelaySeconds }, panelSender(h));
  return { max, queue, pause };
}
function vaultFolder(bookmarks) {
  const find = (node) => (!node.url && node.title === SAFETY_POLICY_VAULT_FOLDER) ? node : (node.children || []).map(find).find(Boolean) || null;
  return find(bookmarks.debugTree());
}
async function plantRaw(bookmarks, payload) {
  const folder = vaultFolder(bookmarks) || await bookmarks.create({ parentId: "2", title: SAFETY_POLICY_VAULT_FOLDER });
  const final = await bookmarks.create({ parentId: folder.id, title: "GFD1:ACTIVE" });
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  await bookmarks.create({ parentId: final.id, title: "chunk 1/1", url: `https://greenfield.invalid/drift-settings-v1/chunk/0/1#${data}` });
}
const writeVault = (bookmarks, values, ms) => writeDriftSettingsVault({ settings: { values, keySavedAtMs: typeof ms === "number" ? stampsAll(ms) : ms }, appVersion: "1.9.2" }, { bookmarks, normalizeSettings });
const readVault = (bookmarks) => loadDriftSettingsVault(bookmarks, { normalizeSettings });

test("v1.9.2 vault: Drift settings are a second, independent section in the run-requirements folder", async () => {
  const bookmarks = mockBookmarks();
  await writeSafetyPolicyVault({ policy: { ...S.defaults, messages3h: 40 }, savedAtMs: 1000 }, { bookmarks, normalizePolicy: S.normalizePolicy });
  const folder0 = vaultFolder(bookmarks);
  await bookmarks.create({ parentId: folder0.id, title: "GFK1-STAGE:interrupted-policy" });
  await bookmarks.create({ parentId: folder0.id, title: "GFD1-STAGE:interrupted-drift" });
  const written = await writeVault(bookmarks, OPERATOR, 2000);
  assert.deepEqual(written, vaultRecord(OPERATOR, 2000));
  const titles = vaultFolder(bookmarks).children.map((n) => n.title).sort();
  assert.deepEqual(titles, ["GFD1:ACTIVE", "GFK1-STAGE:interrupted-policy", "GFK1:ACTIVE"], "a drift write purges only its own stage");
  assert.equal((await loadSafetyPolicyVault(bookmarks, { normalizePolicy: S.normalizePolicy })).policy.messages3h, 40, "the run requirements are untouched");
  // A failed drift write leaves both committed copies.
  const failing = mockBookmarks({ create: ({ url }) => (url?.includes("drift-settings-v1") && failing.armed ? new Error("BOOKMARK_WRITE_TEST_FAILURE") : undefined) });
  await writeSafetyPolicyVault({ policy: S.defaults, savedAtMs: 1000 }, { bookmarks: failing, normalizePolicy: S.normalizePolicy });
  await writeVault(failing, OPERATOR, 1000);
  failing.armed = true;
  await assert.rejects(writeVault(failing, SECOND, 2000), /BOOKMARK_WRITE_TEST_FAILURE/);
  assert.deepEqual((await readVault(failing)).settings.values, OPERATOR);
  assert.ok(await loadSafetyPolicyVault(failing, { normalizePolicy: S.normalizePolicy }));
  assert.deepEqual(driftSettingsVaultContract(), {
    schema: DRIFT_SETTINGS_VAULT_SCHEMA, owner: "CHROME_PROFILE_BOOKMARK_STORE", extensionInstallIndependent: true, extensionIdIndependent: true,
    precedence: "NEWEST_OPERATOR_SAVE_IN_PROFILE", folder: SAFETY_POLICY_VAULT_FOLDER, independentOf: "eic.greenfield.safety-policy-vault.v1"
  });
});

test("v1.9.2 vault: a clamped, mistyped or incomplete value, or a missing or far-future save time, is refused", async () => {
  const { postDelaySeconds, ...missing } = OPERATOR;
  const badValues = [{ ...OPERATOR, postDelaySeconds: 999 }, { ...OPERATOR, maxActiveSessions: 9 }, { ...OPERATOR, queueSwitchHardReload: "yes" }, { ...OPERATOR, defaultMissionQuantumInteractions: 2.5 }, missing, []];
  for (const values of badValues) assert.throws(() => normalizeDriftSettingsStrict(values), /DRIFT_SETTINGS_INVALID/, JSON.stringify(values));
  const { maxActiveSessions, ...stampMissing } = stampsAll(1000);
  const badRecords = [
    ...badValues.map((values) => ({ values, keySavedAtMs: stampsAll(1000) })),
    { values: OPERATOR, keySavedAtMs: stampMissing },
    { values: OPERATOR, keySavedAtMs: { ...stampsAll(1000), warmQueueResume: 0 } },
    { values: OPERATOR, keySavedAtMs: { ...stampsAll(1000), postDelaySeconds: Date.now() + 3 * 86400000 } },
    { values: OPERATOR }
  ];
  for (const settings of badRecords) {
    const bookmarks = mockBookmarks();
    await plantRaw(bookmarks, { schema: DRIFT_SETTINGS_VAULT_SCHEMA, settings, savedAtMs: 1000 });
    assert.equal(await readVault(bookmarks), null, JSON.stringify(settings).slice(0, 160));
  }
  assert.equal(postDelaySeconds, 45);
  assert.equal(maxActiveSessions, 1000);
  await assert.rejects(writeVault(mockBookmarks(), { ...OPERATOR, postDelaySeconds: 999 }, 1000), /DRIFT_SETTINGS_VAULT_RECORD_INVALID/);
  assert.deepEqual(DRIFT_SETTINGS_KEYS, ["postDelaySeconds", "maxActiveSessions", "defaultMissionQuantumInteractions", "queuePriorityAgingSeconds", "queueSwitchHardReload", "queueSwitchDelaySeconds", "queueSwitchSettleSeconds", "warmQueueResume"]);
});

test("v1.9.2 merge: per setting, the newest save wins; never-saved defaults never seed", () => {
  const local = (values, stamps = {}) => normalizeOperatorSettings({ ...values, driftSettingsSavedAtMs: stamps });
  const now = 10_000;
  // Fresh installation, empty profile: nothing to do.
  let m = mergeDriftSettings(local({}), null, { now });
  assert.deepEqual([m.vaultWrite, m.localChanged, m.adoptedKeys], [false, false, []]);
  // Values from before 1.9.2 (no save times), empty vault: seeded, older than any real save.
  m = mergeDriftSettings(local(OPERATOR), null, { now });
  assert.equal(m.vaultWrite, true);
  assert.deepEqual(m.values, OPERATOR);
  assert.deepEqual(m.stamps, stampsAll(LEGACY_DRIFT_STAMP));
  // New folder (never saved here), vault present: every value comes from the vault.
  m = mergeDriftSettings(local({}), vaultRecord(OPERATOR, 5000), { now });
  assert.deepEqual(m.values, OPERATOR);
  assert.equal(m.adoptedKeys.length, 8);
  assert.equal(m.vaultWrite, false);
  // One setting saved here after the vault: only that one goes to the vault,
  // the other seven come from the vault (review finding 2026-10-07, reproduced).
  m = mergeDriftSettings(local({ ...DEFAULT_DRIFT_SETTINGS, maxActiveSessions: 2 }, { maxActiveSessions: 6000 }), vaultRecord(OPERATOR, 5000), { now });
  assert.deepEqual(m.values, { ...OPERATOR, maxActiveSessions: 2 });
  assert.equal(m.vaultWrite, true);
  assert.deepEqual(m.adoptedKeys.sort(), DRIFT_SETTINGS_KEYS.filter((k) => k !== "maxActiveSessions" && OPERATOR[k] !== DEFAULT_DRIFT_SETTINGS[k]).sort());
  // Mixed: each side newer for different settings.
  m = mergeDriftSettings(local(SECOND, { ...stampsAll(3000), postDelaySeconds: 8000 }), vaultRecord(OPERATOR, { ...stampsAll(5000), postDelaySeconds: 4000 }), { now });
  assert.deepEqual(m.values, { ...OPERATOR, postDelaySeconds: SECOND.postDelaySeconds });
  assert.deepEqual([m.vaultWrite, m.localChanged], [true, true]);
  // Same save time, different value: the vault wins so every installation converges.
  m = mergeDriftSettings(local(SECOND, stampsAll(5000)), vaultRecord(OPERATOR, 5000), { now });
  assert.deepEqual(m.values, OPERATOR);
  assert.equal(m.vaultWrite, false);
  // In sync: nothing to do.
  m = mergeDriftSettings(local(OPERATOR, stampsAll(5000)), vaultRecord(OPERATOR, 5000), { now });
  assert.deepEqual([m.vaultWrite, m.localChanged, m.adoptedKeys], [false, false, []]);
  // A save time ahead of the clock is pulled back to now.
  m = mergeDriftSettings(local(OPERATOR, stampsAll(now + 99_999)), null, { now });
  assert.deepEqual(m.stamps, stampsAll(now));
  assert.equal(m.localChanged, true);
});

test("v1.9.2 settings: an operator save stamps exactly the saved settings; the stamp cannot be injected", async () => {
  const store = memory();
  const at = (now) => ({ ...OPTS, now });
  let s = await saveOperatorSettings({ workModeEnabled: true }, store, at(10));
  assert.deepEqual(s.driftSettingsSavedAtMs, stampsAll(0));
  s = await saveOperatorSettings({ reservedWorkerId: "worker-x", workModeSupervisorWorkerId: "worker-x" }, store, at(20));
  assert.deepEqual(s.driftSettingsSavedAtMs, stampsAll(0));
  s = await saveOperatorSettings({ postDelaySeconds: 30, driftSettingsSavedAtMs: stampsAll(9e12), driftSettingsOrigin: "VAULT" }, store, at(30));
  assert.deepEqual(s.driftSettingsSavedAtMs, { ...stampsAll(0), postDelaySeconds: 30 });
  assert.equal(s.driftSettingsOrigin, "OPERATOR");
  s = await saveOperatorSettings(pickQueue(OPERATOR), store, at(40));
  assert.deepEqual(s.driftSettingsSavedAtMs, { ...stampsAll(0), postDelaySeconds: 30, ...Object.fromEntries(QUEUE_KEYS.map((k) => [k, 40])) });
  assert.deepEqual(await loadOperatorSettings(store, OPTS), s, "stable across a reload");
  assert.deepEqual(normalizeOperatorSettings({ driftSettingsSavedAtMs: { postDelaySeconds: -5, maxActiveSessions: "x" }, driftSettingsOrigin: "HACK" }).driftSettingsSavedAtMs, stampsAll(0));
  assert.equal(normalizeOperatorSettings({ driftSettingsOrigin: "HACK" }).driftSettingsOrigin, "");
});

test("v1.9.2 settings: the local reconciliation changes only the Drift settings and merges a save made meanwhile", async () => {
  const store = memory();
  await saveOperatorSettings({ workModeEnabled: true, reservedWorkerId: "worker-r", workModeEndpoint: "http://127.0.0.1:8765/" }, store, OPTS);
  const vault = vaultRecord(OPERATOR, 5000);
  // An operator save that lands after the vault was read is merged, not lost.
  await saveOperatorSettings({ maxActiveSessions: 1 }, store, { ...OPTS, now: 6000 });
  const { merge } = await reconcileLocalDriftSettings(vault, store, { now: 7000 });
  const after = await loadOperatorSettings(store, OPTS);
  assert.deepEqual(driftSettingsOf(after), { ...OPERATOR, maxActiveSessions: 1 });
  assert.equal(merge.vaultWrite, true, "the newer maxActiveSessions goes to the vault");
  assert.equal(after.driftSettingsOrigin, "VAULT");
  assert.equal(after.workModeEnabled, true);
  assert.equal(after.reservedWorkerId, "worker-r");
  assert.equal(after.workModeEndpoint, normalizeOperatorSettings({ workModeEndpoint: "http://127.0.0.1:8765/" }).workModeEndpoint);
});

// A storage whose reads and writes take time, so read-modify-write windows overlap.
function slowStorage(seed = {}) {
  const base = memory(seed);
  return { state: base.state, async get(k) { await tick(); return base.get(k); }, async set(v) { await tick(); return base.set(v); }, remove: base.remove };
}

test("v1.9.2 lock: startup's work-mode write and the vault reconciliation never lose each other's fields", async () => {
  const slow = slowStorage();
  await saveOperatorSettings({ workModeEnabled: false }, slow, OPTS);
  await Promise.all([
    saveOperatorSettings({ workModeEnabled: true }, slow, OPTS),
    reconcileLocalDriftSettings(vaultRecord(OPERATOR, 7000), slow, { now: 8000 })
  ]);
  const after = await loadOperatorSettings(slow, OPTS);
  assert.equal(after.workModeEnabled, true);
  assert.deepEqual(driftSettingsOf(after), OPERATOR);
});

test("v1.9.2 lock: the panel's saved-mission sync no longer writes back stale Drift settings over an adoption (review finding, reproduced)", async () => {
  // New folder, the operator opens the side panel while the worker adopts the
  // vault: the panel's loadOperatorSettings restores saved missions from the
  // bookmark vault and writes the record. Both now take the same lock (Web
  // Locks across the two contexts in Chrome; the storage lock here) and the
  // panel write re-reads and replaces savedMissions only.
  const profile = mockBookmarks();
  await saveMissionPreset("Projekt: 900 - Syntetiskt testprojekt - Gf: GF-901.\nSyntetiskt uppdrag", { storage: memory(), bookmarks: profile, now: 1000, id: "mission-a" });
  const slow = slowStorage();
  const results = await Promise.allSettled([
    loadOperatorSettings(slow, { bookmarks: profile }),
    reconcileLocalDriftSettings(vaultRecord(OPERATOR, 7000), slow, { now: 8000 })
  ]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"], JSON.stringify(results.map((r) => r.reason?.message)));
  const after = await loadOperatorSettings(slow, OPTS);
  assert.deepEqual(driftSettingsOf(after), OPERATOR, "the adoption survives");
  assert.equal(after.savedMissions.length, 1, "the saved missions are restored");
});

test("v1.9.2 reported case: Drift settings saved in one folder are restored when Greenfield is loaded from a new folder", async () => {
  const profile = mockBookmarks();
  const a = await start({ bookmarks: profile });
  const saved = await saveAllFromPanel(a, OPERATOR);
  for (const r of [saved.max, saved.queue, saved.pause]) assert.equal(r.driftSettingsVault.state, "SAVED");
  assert.deepEqual(driftSettingsOf(await settingsOf(a)), OPERATOR);
  assert.deepEqual(driftSettingsOf(saved.pause.operatorSettings), OPERATOR);
  // New folder = new extension id = empty chrome.storage.local; same profile bookmarks.
  const b = await start({ bookmarks: profile });
  const fleet = await b.mod.fleetStatusSnapshot();
  assert.equal(fleet.runtimeFault, "");
  assert.equal(fleet.driftSettingsVault.state, "RESTORED");
  const restored = await settingsOf(b);
  assert.deepEqual(driftSettingsOf(restored), OPERATOR);
  assert.equal(restored.driftSettingsOrigin, "VAULT");
  assert.equal(fleet.configuredCapacity, 4, "the scheduler uses the restored Max parallella");
  assert.equal(fleet.safetyVault.state, "EMPTY", "the run requirements section is independent");
  assert.equal(b.sent.length, 0, "restoring settings never dispatches");
});

test("v1.9.2 negative control: a new folder in another profile starts from the defaults", async () => {
  const a = await start({ bookmarks: mockBookmarks() });
  await saveAllFromPanel(a, OPERATOR);
  const b = await start({ bookmarks: mockBookmarks() });
  assert.deepEqual(driftSettingsOf(await settingsOf(b)), DEFAULT_DRIFT_SETTINGS);
  assert.equal((await b.mod.fleetStatusSnapshot()).driftSettingsVault.state, "EMPTY");
});

test("v1.9.2 upgrade in place: values saved before 1.9.2 seed the vault, then follow to a new folder", async () => {
  const legacy = memory({ [OPERATOR_SETTINGS_KEY]: { ...OPERATOR, schema: "eic.greenfield.operator-settings.v3", savedMissions: [] } });
  const profile = mockBookmarks();
  const a = await start({ seed: legacy.state, bookmarks: profile });
  assert.equal((await a.mod.fleetStatusSnapshot()).driftSettingsVault.state, "SAVED");
  assert.deepEqual(driftSettingsOf(await settingsOf(a)), OPERATOR, "local values untouched");
  assert.deepEqual((await readVault(profile)).settings.keySavedAtMs, stampsAll(LEGACY_DRIFT_STAMP));
  const b = await start({ bookmarks: profile });
  assert.equal((await b.mod.fleetStatusSnapshot()).driftSettingsVault.state, "RESTORED");
  assert.deepEqual(driftSettingsOf(await settingsOf(b)), OPERATOR);
});

test("v1.9.2 per-setting newest save wins across two installation folders", async () => {
  const profile = mockBookmarks();
  const a = await start({ bookmarks: profile });
  await saveAllFromPanel(a, OPERATOR);
  const storageA = a.chrome.storage.local.state;
  await tick();
  const b = await start({ bookmarks: profile });
  await b.mod.setMaxActiveSessions({ windowId: 1, maxActiveSessions: 1 }); // B changes one setting
  await tick();
  const a2 = await start({ seed: storageA, bookmarks: profile }); // folder A started again (new browser session)
  assert.deepEqual(driftSettingsOf(await settingsOf(a2)), { ...OPERATOR, maxActiveSessions: 1 });
  await a2.mod.savePostDelayFromPanel({ postDelaySeconds: 120 }, panelSender(a2)); // A changes another one
  await tick();
  const b2 = await start({ seed: b.chrome.storage.local.state, bookmarks: profile });
  assert.deepEqual(driftSettingsOf(await settingsOf(b2)), { ...OPERATOR, maxActiveSessions: 1, postDelaySeconds: 120 });
});

test("v1.9.2 a failed startup read followed by a one-setting save keeps the vault's other settings (review finding, reproduced)", async () => {
  const profile = mockBookmarks();
  await writeVault(profile, OPERATOR, Date.now() - 60_000);
  let broken = true;
  profile.faults.getTree = () => (broken ? new Error("BOOKMARKS_TREE_TEST_FAILURE") : undefined);
  const b = await start({ bookmarks: profile }); // new folder; the startup read fails
  assert.equal((await b.mod.fleetStatusSnapshot()).driftSettingsVault.state, "ERROR");
  broken = false;
  const r = await b.mod.setMaxActiveSessions({ windowId: 1, maxActiveSessions: 2 });
  assert.equal(r.driftSettingsVault.state, "RESTORED", "the other settings come from the vault in the same step");
  assert.deepEqual((await readVault(profile)).settings.values, { ...OPERATOR, maxActiveSessions: 2 });
  assert.deepEqual(driftSettingsOf(await settingsOf(b)), { ...OPERATOR, maxActiveSessions: 2 });
});

test("v1.9.2 a vault updated by another installation mid-session is not reverted by a one-setting save (review finding, reproduced)", async () => {
  const profile = mockBookmarks();
  const b = await start({ bookmarks: profile });
  assert.equal((await b.mod.fleetStatusSnapshot()).driftSettingsVault.state, "EMPTY");
  await writeVault(profile, SECOND, Date.now()); // another installation / Chrome Sync
  await tick();
  // Same browser session: the worker restarts and reuses the settled result.
  const b2 = await start({ seed: b.chrome.storage.local.state, sessionSeed: b.chrome.storage.session.state, bookmarks: profile });
  assert.deepEqual(driftSettingsOf(await settingsOf(b2)), DEFAULT_DRIFT_SETTINGS);
  await b2.mod.savePostDelayFromPanel({ postDelaySeconds: 15 }, panelSender(b2));
  assert.deepEqual((await readVault(profile)).settings.values, { ...SECOND, postDelaySeconds: 15 });
  assert.deepEqual(driftSettingsOf(await settingsOf(b2)), { ...SECOND, postDelaySeconds: 15 });
});

test("v1.9.2 a failed vault write keeps the local save, is reported, and is retried at the next start", async () => {
  let fail = true;
  const profile = mockBookmarks({ create: ({ url }) => (fail && url?.includes("drift-settings-v1") ? new Error("BOOKMARK_WRITE_TEST_FAILURE") : undefined) });
  const a = await start({ bookmarks: profile });
  const r = await a.mod.saveQueueSettingsFromPanel({ windowId: 1, workerId: "w", ...pickQueue(OPERATOR) });
  assert.equal(r.ok, true);
  assert.deepEqual(pickQueue(r.operatorSettings), pickQueue(OPERATOR), "local save committed");
  assert.equal(r.driftSettingsVault.state, "WRITE_FAILED");
  assert.match(r.driftSettingsVault.error, /BOOKMARK_WRITE_TEST_FAILURE/);
  assert.equal(await readVault(profile), null);
  fail = false;
  const a2 = await start({ seed: a.chrome.storage.local.state, bookmarks: profile });
  assert.equal((await a2.mod.fleetStatusSnapshot()).driftSettingsVault.state, "SAVED");
  const b = await start({ bookmarks: profile });
  assert.deepEqual(pickQueue(await settingsOf(b)), pickQueue(OPERATOR));
});

test("v1.9.2 the pause is saved by the background, only on request of the side panel", async () => {
  const h = await start({ bookmarks: mockBookmarks() });
  await assert.rejects(h.mod.savePostDelayFromPanel({ postDelaySeconds: 30 }, { id: h.chrome.runtime.id, url: "https://chatgpt.com/g/g-test-eic/c/abc-123", tab: h.tab }), /POST_DELAY_PANEL_SENDER_REQUIRED/);
  await assert.rejects(h.mod.savePostDelayFromPanel({ postDelaySeconds: 30 }, { id: "other-extension", url: h.chrome.runtime.getURL("sidepanel.html") }), /POST_DELAY_PANEL_SENDER_REQUIRED/);
  assert.equal((await settingsOf(h)).postDelaySeconds, 0);
  const r = await h.mod.savePostDelayFromPanel({ postDelaySeconds: 999 }, panelSender(h));
  assert.equal(r.operatorSettings.postDelaySeconds, 300, "normalized like every other save");
});

test("v1.9.2 the two sections restore independently and a broken store never blocks startup", async () => {
  const profile = mockBookmarks();
  await writeSafetyPolicyVault({ policy: { ...S.defaults, messages3h: 40 }, savedAtMs: Date.now() - 1000 }, { bookmarks: profile, normalizePolicy: S.normalizePolicy });
  const b = await start({ bookmarks: profile });
  let fleet = await b.mod.fleetStatusSnapshot();
  assert.equal(fleet.safetyVault.state, "RESTORED");
  assert.equal(fleet.driftSettingsVault.state, "EMPTY");
  const broken = await start({ bookmarks: mockBookmarks({ getTree: () => new Error("BOOKMARKS_TREE_TEST_FAILURE") }) });
  fleet = await broken.mod.fleetStatusSnapshot();
  assert.equal(fleet.runtimeFault, "");
  assert.equal(fleet.driftSettingsVault.state, "ERROR");
  assert.match(fleet.driftSettingsVault.error, /BOOKMARKS_TREE_TEST_FAILURE/);
  assert.deepEqual(driftSettingsOf(await settingsOf(broken)), DEFAULT_DRIFT_SETTINGS);
  const bare = await start();
  assert.equal((await bare.mod.fleetStatusSnapshot()).driftSettingsVault.state, "UNAVAILABLE");
});

test("v1.9.2 a worker restart in the same browser session reuses the settled result (no bookmark read)", async () => {
  let reads = 0;
  const profile = mockBookmarks({ getTree: () => { reads += 1; } });
  const a = await start({ bookmarks: profile });
  await saveAllFromPanel(a, OPERATOR);
  const b = await start({ bookmarks: profile });
  assert.equal((await b.mod.fleetStatusSnapshot()).driftSettingsVault.state, "RESTORED");
  const before = reads;
  const b2 = await start({ seed: b.chrome.storage.local.state, sessionSeed: b.chrome.storage.session.state, bookmarks: profile });
  assert.equal(reads, before);
  assert.equal((await b2.mod.fleetStatusSnapshot()).driftSettingsVault.state, "RESTORED");
});

test("v1.9.2 two committed copies (Chrome Sync) are combined setting by setting", async () => {
  const bookmarks = mockBookmarks();
  await plantRaw(bookmarks, { schema: DRIFT_SETTINGS_VAULT_SCHEMA, settings: { values: OPERATOR, keySavedAtMs: { ...stampsAll(5000), postDelaySeconds: 1000 } }, savedAtMs: 5000 });
  await plantRaw(bookmarks, { schema: DRIFT_SETTINGS_VAULT_SCHEMA, settings: { values: SECOND, keySavedAtMs: { ...stampsAll(1000), postDelaySeconds: 6000 } }, savedAtMs: 6000 });
  const combined = await readVault(bookmarks);
  assert.deepEqual(combined.settings.values, { ...OPERATOR, postDelaySeconds: SECOND.postDelaySeconds });
  assert.equal(combined.settings.keySavedAtMs.postDelaySeconds, 6000);
  assert.equal(combined.settings.keySavedAtMs.maxActiveSessions, 5000);
});
