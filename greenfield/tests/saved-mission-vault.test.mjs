import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteMissionPreset,
  loadOperatorSettings,
  saveMissionPreset
} from "../lib/operator-settings.mjs";
import {
  SAVED_MISSION_VAULT_FOLDER,
  loadSavedMissionVault,
  savedMissionVaultContract
} from "../lib/saved-mission-vault.mjs";

function mockStorage() {
  const data = {};
  return {
    async get(key) {
      if (key == null) return { ...data };
      if (typeof key === "string") return { [key]: data[key] };
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
  const bar = { id: "1", parentId: "0", title: "Bookmarks bar", children: [] };
  const other = { id: "2", parentId: "0", title: "Other bookmarks", children: [] };
  root.children.push(bar, other);
  nodes.set(root.id, root);
  nodes.set(bar.id, bar);
  nodes.set(other.id, other);

  function copy(node) {
    return JSON.parse(JSON.stringify(node));
  }

  function childrenOf(id) {
    const node = nodes.get(String(id));
    if (!node) throw new Error(`BOOKMARK_NOT_FOUND:${id}`);
    return node.children || [];
  }

  function stripChildren(node) {
    const out = { ...node };
    delete out.children;
    return copy(out);
  }

  function removeRecursive(id) {
    const node = nodes.get(String(id));
    if (!node) return;
    for (const child of node.children || []) removeRecursive(child.id);
    const parent = nodes.get(String(node.parentId));
    if (parent?.children) parent.children = parent.children.filter((child) => child.id !== node.id);
    nodes.delete(node.id);
  }

  return {
    async getTree() {
      return [copy(root)];
    },
    async getChildren(id) {
      return childrenOf(id).map(stripChildren);
    },
    async create({ parentId, title = "", url = undefined }) {
      const parent = nodes.get(String(parentId));
      if (!parent || url && parent.url) throw new Error("BOOKMARK_PARENT_INVALID");
      const id = String(nextId++);
      const node = {
        id,
        parentId: String(parentId),
        title: String(title),
        ...(url ? { url: String(url) } : { children: [] })
      };
      nodes.set(id, node);
      parent.children.push(node);
      return stripChildren(node);
    },
    async update(id, changes = {}) {
      const node = nodes.get(String(id));
      if (!node) throw new Error("BOOKMARK_NOT_FOUND");
      if (Object.hasOwn(changes, "title")) node.title = String(changes.title);
      if (Object.hasOwn(changes, "url")) node.url = String(changes.url);
      return stripChildren(node);
    },
    async removeTree(id) {
      removeRecursive(String(id));
    },
    debugTree() {
      return copy(root);
    }
  };
}

test("v1.2.2 saved mission vault survives extension-local uninstall and a new extension identity", async () => {
  const bookmarks = mockBookmarks();

  const extensionAStorage = mockStorage();
  let settings = await saveMissionPreset("Projekt: 24 - Linje - Gf: GF-006.\nMission A", {
    storage: extensionAStorage,
    bookmarks,
    now: 1_000,
    id: "mission-a"
  });
  settings = await saveMissionPreset("Projekt: 59 - Code Graph - Gf: GF-002.\nMission B", {
    storage: extensionAStorage,
    bookmarks,
    now: 2_000,
    id: "mission-b"
  });
  settings = await saveMissionPreset("Projekt: 38 - Monitor - Gf: GF-003.\nMission C", {
    storage: extensionAStorage,
    bookmarks,
    now: 3_000,
    id: "mission-c"
  });
  assert.deepEqual(settings.savedMissions.map((item) => item.id), ["mission-c", "mission-b", "mission-a"]);

  // Simulated uninstall: the old extension-local storage is discarded.
  // The Chrome-profile bookmark owner remains. A fresh extension-ID starts
  // with an empty local cache and must recover the same durable records.
  const extensionBStorage = mockStorage();
  const restored = await loadOperatorSettings(extensionBStorage, { bookmarks });
  assert.deepEqual(restored.savedMissions.map((item) => item.id), ["mission-c", "mission-b", "mission-a"]);
  assert.match(restored.savedMissions[2].goal, /Mission A/);

  await deleteMissionPreset("mission-b", extensionBStorage, { bookmarks });

  const extensionCStorage = mockStorage();
  const afterDelete = await loadOperatorSettings(extensionCStorage, { bookmarks });
  assert.deepEqual(afterDelete.savedMissions.map((item) => item.id), ["mission-c", "mission-a"]);
  assert.equal((await loadSavedMissionVault(bookmarks)).some((item) => item.id === "mission-b"), false);

  const tree = bookmarks.debugTree();
  const asText = JSON.stringify(tree);
  assert.match(asText, new RegExp(SAVED_MISSION_VAULT_FOLDER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("v1.2.2 migrates v1.2.1 local saved missions into the durable profile owner on first load", async () => {
  const bookmarks = mockBookmarks();
  const storage = mockStorage();

  // First create a legacy/local-only record by omitting the bookmark owner.
  await saveMissionPreset("Legacy saved mission", {
    storage,
    bookmarks: null,
    now: 4_000,
    id: "legacy-a"
  });

  const hydrated = await loadOperatorSettings(storage, { bookmarks });
  assert.equal(hydrated.savedMissions.length, 1);
  assert.equal(hydrated.savedMissions[0].id, "legacy-a");

  const freshStorage = mockStorage();
  const freshInstall = await loadOperatorSettings(freshStorage, { bookmarks });
  assert.equal(freshInstall.savedMissions[0].id, "legacy-a");
});

test("v1.2.2 durability contract is extension-install and extension-id independent", () => {
  assert.deepEqual(savedMissionVaultContract(), {
    schema: "eic.greenfield.saved-mission-vault.v1",
    owner: "CHROME_PROFILE_BOOKMARK_STORE",
    extensionInstallIndependent: true,
    extensionIdIndependent: true,
    deleteRequiresDurableReadback: true
  });
});
