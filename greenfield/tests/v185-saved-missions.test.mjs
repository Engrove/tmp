import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  MAX_SAVED_MISSIONS,
  applySavedMissionImport,
  deleteMissionPreset,
  loadOperatorSettings,
  saveMissionPreset,
  saveSavedMission
} from "../lib/operator-settings.mjs";
import {
  buildSavedMissionExport,
  parseSavedMissionImport,
  planSavedMissionImport,
  reconcileItemsWithSavedMissions,
  resolveSavedMissionReference,
  savedMissionCleanupRows,
  savedMissionDisplayLabel,
  savedMissionKey
} from "../lib/saved-mission-catalog.mjs";
import { loadSavedMissionVault, writeSavedMissionVault } from "../lib/saved-mission-vault.mjs";
import {
  MISSION_QUEUE_SET_STORE_KEY,
  loadMissionQueueSets,
  reconcileMissionQueueSetsWithSavedMissions
} from "../lib/mission-queue-sets.mjs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

function mockStorage() {
  const data = {};
  return {
    async get(key) {
      if (key == null) return JSON.parse(JSON.stringify(data));
      if (typeof key === "string") return data[key] === undefined ? {} : { [key]: JSON.parse(JSON.stringify(data[key])) };
      return {};
    },
    async set(values) {
      Object.assign(data, JSON.parse(JSON.stringify(values)));
    }
  };
}

function mockBookmarks() {
  let nextId = 10;
  const nodes = new Map();
  const root = { id: "0", title: "", children: [] };
  const other = { id: "2", parentId: "0", title: "Other bookmarks", children: [] };
  root.children.push(other);
  nodes.set(root.id, root);
  nodes.set(other.id, other);
  const copy = (node) => JSON.parse(JSON.stringify(node));
  const strip = (node) => {
    const out = { ...node };
    delete out.children;
    return copy(out);
  };
  function removeRecursive(id) {
    const node = nodes.get(String(id));
    if (!node) return;
    for (const child of node.children || []) removeRecursive(child.id);
    const parent = nodes.get(String(node.parentId));
    if (parent?.children) parent.children = parent.children.filter((child) => child.id !== node.id);
    nodes.delete(node.id);
  }
  return {
    async getTree() { return [copy(root)]; },
    async getChildren(id) { return (nodes.get(String(id))?.children || []).map(strip); },
    async create({ parentId, title = "", url = undefined }) {
      const parent = nodes.get(String(parentId));
      if (!parent) throw new Error("BOOKMARK_PARENT_INVALID");
      const id = String(nextId++);
      const node = { id, parentId: String(parentId), title: String(title), ...(url ? { url: String(url) } : { children: [] }) };
      nodes.set(id, node);
      parent.children.push(node);
      return strip(node);
    },
    async update(id, changes = {}) {
      const node = nodes.get(String(id));
      if (!node) throw new Error("BOOKMARK_NOT_FOUND");
      if (Object.hasOwn(changes, "title")) node.title = String(changes.title);
      return strip(node);
    },
    async removeTree(id) { removeRecursive(String(id)); }
  };
}

const text = (key, project, body) => `Projekt: ${project} - Gf: ${key}.\n${body}`;
const GF001 = text("GF-001", "63 - Greenfield", "Fullfölj arbetet med Greenfield.\nUppdraget är slutfört först när …");
const GF008 = text("GF-008", "67 - EIC Learning", "Fullfölj arbetet med EIC Learning.");
const WC_RE = text("GF-WC-RE-001", "67 - EIC Learning", "Fullfölj research som lämnas till GF-008 utan att GF-008 ändras.");

test("v1.8.5 identity is the first-line GFW key only", () => {
  assert.equal(savedMissionKey(GF001), "GF-001");
  assert.equal(savedMissionKey(WC_RE), "GF-WC-RE-001", "body mention of GF-008 does not decide identity");
  assert.equal(savedMissionKey("Utan nyckel\nGf: GF-009 i brödtext"), "");
  assert.equal(savedMissionKey("Projekt: 1 - X - Gf: none."), "", "a key needs the GF- shape with a digit");
  assert.equal(savedMissionKey("GF-051 fristående rubrik"), "GF-051");
  assert.equal(savedMissionDisplayLabel({ goal: GF001, label: "x" }), "GF-001 · 63 Greenfield");
  assert.equal(savedMissionDisplayLabel({ goal: "Fritt uppdrag", label: "Fritt uppdrag" }), "Fritt uppdrag");
});

test("v1.8.5 Markdown import: ### KEY sections, first text block only, errors block the import", () => {
  const source = [
    "Jag har normaliserat texterna.",
    "",
    "### GF-001",
    "",
    GF001,
    "",
    "### GF-WC-RE-001",
    "",
    WC_RE,
    "",
    "Det centrala i samtliga texter är …",
    "Status: Klart"
  ].join("\n");
  const parsed = parseSavedMissionImport(source);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.missions.map((row) => row.key), ["GF-001", "GF-WC-RE-001"]);
  assert.equal(parsed.missions[0].goal, GF001);
  assert.equal(parsed.missions[1].goal, WC_RE, "trailing prose after a blank line is not imported");
  assert.equal(parsed.missions[1].ignoredLines, 2);
  assert.equal(parsed.preambleLines, 1);

  const mismatch = parseSavedMissionImport(`### GF-002\n\n${GF001}`);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.errors[0].code, "IMPORT_HEADING_KEY_MISMATCH");
  const duplicate = parseSavedMissionImport(`### GF-001\n\n${GF001}\n\n### GF-001\n\n${GF001}`);
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.some((row) => row.code === "IMPORT_DUPLICATE_KEY"));
  assert.equal(parseSavedMissionImport("   ").ok, false);
  assert.equal(parseSavedMissionImport("bara text").errors[0].code, "IMPORT_NO_SECTIONS");
});

test("v1.8.5 export is lossless and importable", () => {
  const records = [
    { id: "m1", label: "a", goal: GF001, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
    { id: "m2", label: "b", goal: "Multi\n\nparagraph\nGF-less", createdAt: "", updatedAt: "" }
  ];
  const exported = buildSavedMissionExport(records, { now: 0 });
  assert.equal(exported.count, 2);
  const back = parseSavedMissionImport(JSON.stringify(exported));
  assert.equal(back.ok, false, "a record without key cannot be imported by key");
  const keyedOnly = parseSavedMissionImport(JSON.stringify(buildSavedMissionExport([records[0]])));
  assert.equal(keyedOnly.ok, true);
  assert.equal(keyedOnly.missions[0].goal, GF001);
});

test("v1.8.5 import plan matches by key, merges duplicates and refuses to exceed the limit", () => {
  const saved = [
    { id: "old-1", goal: `${GF001}\nold`, updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "new-1", goal: `${GF001}\nnewer`, updatedAt: "2026-02-01T00:00:00.000Z" },
    { id: "gf8", goal: GF008, updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "free", goal: "Fritt uppdrag", updatedAt: "2026-01-01T00:00:00.000Z" }
  ];
  const plan = planSavedMissionImport(saved, [
    { key: "GF-001", goal: GF001 },
    { key: "GF-008", goal: GF008 },
    { key: "GF-WC-RE-001", goal: WC_RE }
  ]);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rows.map((row) => [row.key, row.action, row.targetId, row.duplicateIds]), [
    ["GF-001", "UPDATE", "new-1", ["old-1"]],
    ["GF-008", "UNCHANGED", "gf8", []],
    ["GF-WC-RE-001", "CREATE", "", []]
  ]);
  assert.deepEqual(plan.counts, { create: 1, update: 1, unchanged: 1, duplicates: 1, keptNotInImport: 0, keptWithoutKey: 1 });
  assert.equal(plan.finalCount, 4);
  const full = planSavedMissionImport(saved, [{ key: "GF-WC-RE-001", goal: WC_RE }], { maxSavedMissions: 4, mergeDuplicates: false });
  assert.equal(full.ok, false);
  assert.equal(full.error, "SAVED_MISSION_LIMIT_REACHED");
});

test("v1.8.5 saving the same GF key updates the saved mission in place (same id)", async () => {
  const storage = mockStorage();
  const bookmarks = mockBookmarks();
  const first = await saveSavedMission(GF001, { storage, bookmarks, now: Date.parse("2026-09-01T00:00:00Z"), id: "m-gf001" });
  assert.equal(first.action, "CREATED");
  const edited = `${GF001}\nNy mening.`;
  const second = await saveSavedMission(edited, { storage, bookmarks, now: Date.parse("2026-09-02T00:00:00Z") });
  assert.equal(second.action, "UPDATED");
  assert.equal(second.record.id, "m-gf001");
  assert.equal(second.record.createdAt, first.record.createdAt);
  const vault = await loadSavedMissionVault(bookmarks);
  assert.deepEqual(vault.map((row) => [row.id, row.goal]), [["m-gf001", edited]]);

  const explicit = await saveSavedMission(`${GF001}\nTredje.`, { storage, bookmarks, mode: "UPDATE", targetId: "m-gf001" });
  assert.equal(explicit.action, "UPDATED");
  await assert.rejects(saveSavedMission(`${GF001}\nKopia`, { storage, bookmarks, mode: "CREATE" }), /SAVED_MISSION_KEY_CONFLICT/);
  const gf8 = await saveSavedMission(GF008, { storage, bookmarks, mode: "CREATE" });
  await assert.rejects(saveSavedMission(GF001, { storage, bookmarks, mode: "UPDATE", targetId: gf8.record.id }), /SAVED_MISSION_KEY_CONFLICT/);
  await assert.rejects(saveSavedMission(GF001, { storage, bookmarks, mode: "UPDATE", targetId: "missing" }), /SAVED_MISSION_NOT_FOUND/);

  // Compatibility: saveMissionPreset still returns settings.
  const settings = await saveMissionPreset("Fritt uppdrag", { storage, bookmarks });
  assert.equal(settings.savedMissions.length, 3);
});

test("v1.8.5 the limit refuses a new mission and never drops an existing one", async () => {
  assert.equal(MAX_SAVED_MISSIONS, 64);
  const bookmarks = mockBookmarks();
  for (let i = 0; i < 3; i += 1) {
    await writeSavedMissionVault({ id: `m${i}`, goal: `Uppdrag ${i}`, updatedAt: `2026-01-0${i + 1}T00:00:00.000Z` }, { bookmarks, maxSavedMissions: 3 });
  }
  await assert.rejects(
    writeSavedMissionVault({ id: "m3", goal: "Uppdrag 3" }, { bookmarks, maxSavedMissions: 3 }),
    /SAVED_MISSION_LIMIT_REACHED/
  );
  assert.deepEqual((await loadSavedMissionVault(bookmarks)).map((row) => row.id).sort(), ["m0", "m1", "m2"]);
  const replaced = await writeSavedMissionVault({ id: "m0", goal: "Uppdrag 0 ny", updatedAt: "2026-02-01T00:00:00.000Z" }, { bookmarks, maxSavedMissions: 3 });
  assert.equal(replaced.length, 3, "replacing a record at the limit is allowed");
  assert.equal(read("lib/saved-mission-vault.mjs").includes("pruneVault"), false);
});

test("v1.8.5 bulk import writes, merges duplicates, reads back and is idempotent", async () => {
  const storage = mockStorage();
  const bookmarks = mockBookmarks();
  await writeSavedMissionVault({ id: "old", goal: `${GF001}\nv1`, updatedAt: "2026-01-01T00:00:00.000Z" }, { bookmarks });
  await writeSavedMissionVault({ id: "newer", goal: `${GF001}\nv2`, updatedAt: "2026-02-01T00:00:00.000Z" }, { bookmarks });
  await writeSavedMissionVault({ id: "free", goal: "Fritt uppdrag", updatedAt: "2026-01-01T00:00:00.000Z" }, { bookmarks });
  const parsed = parseSavedMissionImport(`### GF-001\n\n${GF001}\n\n### GF-008\n\n${GF008}\n`);
  const result = await applySavedMissionImport(parsed.missions, { storage, bookmarks, now: Date.parse("2026-09-25T08:00:00Z") });
  assert.deepEqual(result.merged, { old: "newer" });
  assert.deepEqual(result.changes.map((row) => [row.key, row.action]), [["GF-001", "UPDATED"], ["GF-008", "CREATED"]]);
  const vault = await loadSavedMissionVault(bookmarks);
  assert.equal(vault.length, 3);
  assert.equal(vault.find((row) => row.id === "newer").goal, GF001);
  assert.ok(vault.some((row) => row.id === "free"), "missions not in the import are kept");
  const fresh = await loadOperatorSettings(mockStorage(), { bookmarks });
  assert.equal(fresh.savedMissions.length, 3, "a new extension install restores the imported state");

  const again = await applySavedMissionImport(parsed.missions, { storage, bookmarks });
  assert.deepEqual(again.changes, []);
  assert.equal(again.plan.counts.unchanged, 2);
});

test("v1.8.5 references resolve by id, follow merges, re-link stale ids by key, never touch slots without id", () => {
  const saved = [
    { id: "gf1", label: "L1", goal: GF001 },
    { id: "gf8", label: "L8", goal: GF008 },
    { id: "dupA", label: "D", goal: `${WC_RE}\nA` },
    { id: "dupB", label: "D", goal: `${WC_RE}\nB` }
  ];
  assert.equal(resolveSavedMissionReference({ savedMissionId: "gf1", goal: "old" }, saved).via, "ID");
  assert.equal(resolveSavedMissionReference({ savedMissionId: "gone", goal: "old" }, saved, { merged: { gone: "gf8" } }).via, "MERGED");
  assert.equal(resolveSavedMissionReference({ savedMissionId: "stale", goal: `${GF001}\nold` }, saved).record.id, "gf1");
  const ambiguous = resolveSavedMissionReference({ savedMissionId: "stale", goal: WC_RE }, saved);
  assert.equal(ambiguous.record, null);
  assert.equal(ambiguous.ambiguous, true);
  assert.equal(resolveSavedMissionReference({ savedMissionId: "", goal: GF001 }, saved).record, null,
    "an ad hoc or AI-delegated slot is never re-linked");

  const items = [
    { savedMissionId: "gf1", label: "x", goal: "gammal text" },
    { savedMissionId: "", label: "delegerat", goal: GF001 },
    { savedMissionId: "gf8", label: "L8", goal: GF008 }
  ];
  const result = reconcileItemsWithSavedMissions(items, saved);
  assert.equal(result.items[0].goal, GF001);
  assert.equal(result.items[1], items[1]);
  assert.equal(result.items[2], items[2]);
  assert.equal(result.changes.length, 1);
  assert.equal(items[0].goal, "gammal text", "inputs are not mutated");
});

test("v1.8.5 stored queue sets are rewritten to the current text with readback", async () => {
  const storage = mockStorage();
  const bookmarks = mockBookmarks();
  await storage.set({
    [MISSION_QUEUE_SET_STORE_KEY]: {
      sets: [
        { setId: "s1", name: "Dag", items: [
          { savedMissionId: "gf1", label: "old", goal: `${GF001}\nold`, priority: "HIGH", maxInteractions: 7 },
          { savedMissionId: "gone", label: "old8", goal: `${GF008}\nold` },
          { savedMissionId: "", label: "fri", goal: "Fri text" }
        ] },
        { setId: "s2", name: "Natt", items: [{ savedMissionId: "other", label: "o", goal: "Annat" }] }
      ]
    }
  });
  const saved = [{ id: "gf1", label: "L1", goal: GF001 }, { id: "gf8", label: "L8", goal: GF008 }];
  const { store, summary } = await reconcileMissionQueueSetsWithSavedMissions(saved, { merged: { gone: "gf8" } }, storage, { bookmarks });
  assert.deepEqual({ setsChanged: summary.setsChanged, itemsChanged: summary.itemsChanged, relinked: summary.relinked, unresolved: summary.unresolved },
    { setsChanged: 1, itemsChanged: 2, relinked: 1, unresolved: 1 });
  const day = store.sets.find((set) => set.setId === "s1");
  assert.deepEqual(day.items.map((item) => [item.savedMissionId, item.goal]), [["gf1", GF001], ["gf8", GF008], ["", "Fri text"]]);
  assert.equal(day.items[0].priority, "HIGH", "slot settings are kept");
  assert.equal(day.items[0].maxInteractions, 7);
  const fromVault = await loadMissionQueueSets(mockStorage(), { bookmarks });
  assert.equal(fromVault.sets.find((set) => set.setId === "s1").items[0].goal, GF001, "the bookmark vault carries the new text");
  const second = await reconcileMissionQueueSetsWithSavedMissions(saved, {}, storage, { bookmarks });
  assert.equal(second.summary.setsChanged, 0);
});

test("v1.8.5 deleting a saved mission keeps queue copies (no silent loss)", async () => {
  const storage = mockStorage();
  const bookmarks = mockBookmarks();
  const created = await saveSavedMission(GF001, { storage, bookmarks });
  await deleteMissionPreset(created.record.id, storage, { bookmarks });
  const result = reconcileItemsWithSavedMissions([{ savedMissionId: created.record.id, goal: GF001 }], []);
  assert.equal(result.items[0].goal, GF001);
  assert.equal(result.unresolved.length, 1);
});

test("v1.8.5 background resolves saved-mission text at add, set save/load and activation", () => {
  const background = read("background.js");
  assert.match(background, /case "ADD": \{[\s\S]{0,200}resolveSavedMissionReference\(/);
  assert.match(background, /const resolvedQueue = \{ \.\.\.queue, items: reconcileItemsWithSavedMissions\(queue\.items, savedMissions\)\.items \}/);
  assert.match(background, /reconcileItemsWithSavedMissions\(set\.items, savedMissions\)/);
  assert.match(background, /const bootstrap = resolveSavedMissionReference\(item, await currentSavedMissions\(\)\)/);
  assert.match(background, /goal: String\(item\.goal \|\| parked\.goal \|\| ""\)/);
  assert.match(background, /"SAVED_MISSION_BOOTSTRAP_REFRESHED"/);
  assert.match(background, /case "EIC_GF_SAVED_MISSIONS_CHANGED":/);
  assert.match(background, /reconcileMissionQueueSetsWithSavedMissions\(/);
});

test("v1.8.5 panel exposes edit, save change, save as new, confirmed delete, import preview and export", () => {
  const html = read("sidepanel.html");
  const panel = read("sidepanel.js");
  for (const id of ["savedMissionAdminSelect", "savedMissionEdit", "savedMissionAdminDelete", "savedMissionEditor",
    "savedMissionUpdate", "savedMissionCreate", "savedMissionImportText", "savedMissionImportMerge",
    "savedMissionImportPreview", "savedMissionImportApply", "savedMissionExport"]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(panel, new RegExp(`\\$\\("${id}"\\)`));
  }
  assert.match(panel, /type: "EIC_GF_SAVED_MISSIONS_CHANGED"/);
  assert.match(panel, /saveSavedMission\(goal, \{ mode: "AUTO" \}\)/);
  assert.match(panel, /Bekräfta borttagning/);
});

test("v1.8.5 content script treats the processing notice as status for assistant turns only", () => {
  const content = read("content.js");
  assert.match(content, /Våra system bearbetar \(\?:den här\|denna\) förfrågan/);
  assert.match(content, /if \(entry\.role === "assistant"\) stripProviderProcessingNotice\(clone\);/);
  assert.match(content, /if \(providerProcessingNoticeText\(text\)\) return true;/);
});

test("v1.8.5 cleanup rows flag older duplicates (with their newer keeper) and missions without key; nothing preselected", () => {
  const rows = savedMissionCleanupRows([
    { id: "new", goal: GF001, updatedAt: "2026-02-01T00:00:00.000Z" },
    { id: "old", goal: `${GF001}\nv1`, updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "free", goal: "Fritt uppdrag", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "gf8", goal: GF008, updatedAt: "2026-01-01T00:00:00.000Z" }
  ]);
  assert.deepEqual(rows.map((row) => [row.id, row.reason, row.keeperId]), [
    ["old", "DUPLICATE", "new"],
    ["free", "NO_KEY", ""],
    ["new", "", ""],
    ["gf8", "", ""]
  ]);
  const html = read("sidepanel.html");
  assert.match(html, /id="savedMissionCleanupList"/);
  assert.match(html, /id="savedMissionRuntimeStatus"/);
  const panel = read("sidepanel.js");
  assert.match(panel, /setSavedMissionRuntimeStatus\(savedMissionErrorText\(error\), true\)/);
  assert.match(panel, /cleanupSelected: new Set\(\)/);
});
