export const SAVED_MISSION_VAULT_SCHEMA = "eic.greenfield.saved-mission-vault.v1";
export const SAVED_MISSION_VAULT_FOLDER = "EIC Greenfield · Saved missions v1";
export const SAVED_MISSION_FOLDER_PREFIX = "GFV1:";
export const SAVED_MISSION_STAGE_PREFIX = "GFV1-STAGE:";
export const SAVED_MISSION_CHUNK_URL_PREFIX = "https://greenfield.invalid/v1/chunk/";
export const SAVED_MISSION_CHUNK_CHARS = 1800;

function text(value) {
  return String(value ?? "");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function base64UrlEncodeUtf8(value) {
  const bytes = new TextEncoder().encode(text(value));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, Math.min(bytes.length, i + 0x8000));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeUtf8(value) {
  const normalized = text(value).replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(normalized + padding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function splitChunks(value, size = SAVED_MISSION_CHUNK_CHARS) {
  const source = text(value);
  const out = [];
  for (let i = 0; i < source.length; i += size) out.push(source.slice(i, i + size));
  return out.length ? out : [""];
}

function timestampValue(value) {
  const ms = Date.parse(text(value));
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object") return null;
  const id = text(value.id).trim();
  const goal = text(value.goal).trim();
  if (!id || !goal) return null;
  return {
    id,
    label: text(value.label).trim() || goal.split(/\r?\n/, 1)[0].slice(0, 120),
    goal,
    createdAt: text(value.createdAt),
    updatedAt: text(value.updatedAt || value.createdAt)
  };
}

function findFolder(node, title) {
  if (!node || typeof node !== "object") return null;
  if (!node.url && node.title === title) return node;
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const found = findFolder(child, title);
    if (found) return found;
  }
  return null;
}

async function readTree(bookmarks) {
  if (!bookmarks?.getTree) throw new Error("SAVED_MISSION_VAULT_UNAVAILABLE");
  const tree = await bookmarks.getTree();
  return Array.isArray(tree) ? tree : [];
}

async function findVaultRoot(bookmarks) {
  const tree = await readTree(bookmarks);
  for (const node of tree) {
    const found = findFolder(node, SAVED_MISSION_VAULT_FOLDER);
    if (found) return found;
  }
  return null;
}

function chooseWritableRootParent(tree) {
  const root = Array.isArray(tree) ? tree[0] : null;
  const folders = (root?.children || []).filter((node) => node && !node.url && node.id);
  return folders.find((node) => String(node.id) === "2") || folders.at(-1) || folders[0] || null;
}

async function ensureVaultRoot(bookmarks) {
  const existing = await findVaultRoot(bookmarks);
  if (existing) return existing;
  const tree = await readTree(bookmarks);
  const parent = chooseWritableRootParent(tree);
  if (!parent) throw new Error("SAVED_MISSION_VAULT_PARENT_UNAVAILABLE");
  const created = await bookmarks.create({
    parentId: parent.id,
    title: SAVED_MISSION_VAULT_FOLDER
  });
  if (!created?.id) throw new Error("SAVED_MISSION_VAULT_CREATE_FAILED");
  const readback = await findVaultRoot(bookmarks);
  if (!readback || readback.id !== created.id) throw new Error("SAVED_MISSION_VAULT_ROOT_READBACK_MISMATCH");
  return readback;
}

function folderLooksFinal(node) {
  return Boolean(node && !node.url && text(node.title).startsWith(SAVED_MISSION_FOLDER_PREFIX));
}

function folderLooksStage(node) {
  return Boolean(node && !node.url && text(node.title).startsWith(SAVED_MISSION_STAGE_PREFIX));
}

async function readMissionFolder(folder, bookmarks) {
  if (!folder?.id) return null;
  const children = await bookmarks.getChildren(folder.id);
  const chunks = [];
  for (const child of Array.isArray(children) ? children : []) {
    if (!child?.url || !text(child.url).startsWith(SAVED_MISSION_CHUNK_URL_PREFIX)) continue;
    let url;
    try {
      url = new URL(child.url);
    } catch {
      continue;
    }
    const match = url.pathname.match(/^\/v1\/chunk\/(\d+)\/(\d+)$/);
    if (!match) continue;
    const index = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isInteger(index) || index < 0 || !Number.isInteger(total) || total < 1) continue;
    chunks.push({ index, total, data: url.hash.slice(1) });
  }
  if (!chunks.length) return null;
  chunks.sort((a, b) => a.index - b.index);
  const total = chunks[0].total;
  if (chunks.length !== total || chunks.some((item, index) => item.index !== index || item.total !== total)) return null;
  try {
    const payload = base64UrlDecodeUtf8(chunks.map((item) => item.data).join(""));
    const parsed = JSON.parse(payload);
    if (parsed?.schema !== SAVED_MISSION_VAULT_SCHEMA) return null;
    return normalizeRecord(parsed?.mission);
  } catch {
    return null;
  }
}

async function listFinalFolders(root, bookmarks) {
  if (!root?.id) return [];
  const children = await bookmarks.getChildren(root.id);
  return (Array.isArray(children) ? children : []).filter(folderLooksFinal);
}

export async function loadSavedMissionVault(bookmarks) {
  const root = await findVaultRoot(bookmarks);
  if (!root) return [];
  const folders = await listFinalFolders(root, bookmarks);
  const records = [];
  for (const folder of folders) {
    const record = await readMissionFolder(folder, bookmarks);
    if (record) records.push({ folderId: folder.id, record });
  }

  records.sort((a, b) => timestampValue(b.record.updatedAt) - timestampValue(a.record.updatedAt));
  const ids = new Set();
  const goals = new Set();
  const deduped = [];
  for (const item of records) {
    if (ids.has(item.record.id) || goals.has(item.record.goal)) continue;
    ids.add(item.record.id);
    goals.add(item.record.goal);
    deduped.push(item.record);
  }
  return deduped.map(clone);
}

async function pruneVault(root, bookmarks, maxSavedMissions) {
  const folders = await listFinalFolders(root, bookmarks);
  const parsed = [];
  for (const folder of folders) {
    const record = await readMissionFolder(folder, bookmarks);
    if (record) parsed.push({ folder, record });
  }
  parsed.sort((a, b) => timestampValue(b.record.updatedAt) - timestampValue(a.record.updatedAt));
  for (const item of parsed.slice(Math.max(0, Number(maxSavedMissions) || 0))) {
    await bookmarks.removeTree(item.folder.id);
  }
}

export async function writeSavedMissionVault(record, {
  bookmarks,
  maxSavedMissions = 24,
  nonce = ""
} = {}) {
  if (!bookmarks?.create || !bookmarks?.getChildren || !bookmarks?.update || !bookmarks?.removeTree) {
    throw new Error("SAVED_MISSION_VAULT_UNAVAILABLE");
  }
  const normalized = normalizeRecord(record);
  if (!normalized) throw new Error("SAVED_MISSION_VAULT_RECORD_INVALID");
  const root = await ensureVaultRoot(bookmarks);

  const payload = base64UrlEncodeUtf8(JSON.stringify({
    schema: SAVED_MISSION_VAULT_SCHEMA,
    mission: normalized
  }));
  const chunks = splitChunks(payload);
  const stageTitle = `${SAVED_MISSION_STAGE_PREFIX}${normalized.id}:${text(nonce) || Date.now()}`;
  const stage = await bookmarks.create({ parentId: root.id, title: stageTitle });
  if (!stage?.id) throw new Error("SAVED_MISSION_VAULT_STAGE_CREATE_FAILED");

  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const url = `${SAVED_MISSION_CHUNK_URL_PREFIX}${index}/${chunks.length}#${chunks[index]}`;
      await bookmarks.create({
        parentId: stage.id,
        title: `chunk ${String(index + 1).padStart(4, "0")}/${String(chunks.length).padStart(4, "0")}`,
        url
      });
    }

    const staged = await readMissionFolder(stage, bookmarks);
    if (JSON.stringify(staged) !== JSON.stringify(normalized)) {
      throw new Error("SAVED_MISSION_VAULT_STAGE_READBACK_MISMATCH");
    }

    const committed = await bookmarks.update(stage.id, {
      title: `${SAVED_MISSION_FOLDER_PREFIX}${normalized.id}`
    });
    if (!committed?.id) throw new Error("SAVED_MISSION_VAULT_COMMIT_FAILED");

    const folders = await listFinalFolders(root, bookmarks);
    for (const folder of folders) {
      if (folder.id === stage.id) continue;
      const prior = await readMissionFolder(folder, bookmarks);
      if (prior && (prior.id === normalized.id || prior.goal === normalized.goal)) {
        await bookmarks.removeTree(folder.id);
      }
    }

    await pruneVault(root, bookmarks, maxSavedMissions);
    const readback = await loadSavedMissionVault(bookmarks);
    const committedRecord = readback.find((item) => item.id === normalized.id);
    if (JSON.stringify(committedRecord) !== JSON.stringify(normalized)) {
      throw new Error("SAVED_MISSION_VAULT_COMMIT_READBACK_MISMATCH");
    }
    return readback;
  } catch (error) {
    const tree = await readTree(bookmarks).catch(() => []);
    let exists = false;
    for (const node of tree) {
      const found = findFolder(node, stageTitle);
      if (found?.id === stage.id) exists = true;
    }
    if (exists) await bookmarks.removeTree(stage.id).catch(() => undefined);
    throw error;
  }
}

export async function deleteSavedMissionVault(id, { bookmarks } = {}) {
  if (!bookmarks?.getChildren || !bookmarks?.removeTree) throw new Error("SAVED_MISSION_VAULT_UNAVAILABLE");
  const missionId = text(id).trim();
  if (!missionId) return loadSavedMissionVault(bookmarks);
  const root = await findVaultRoot(bookmarks);
  if (!root) return [];
  const folders = await listFinalFolders(root, bookmarks);
  for (const folder of folders) {
    const record = await readMissionFolder(folder, bookmarks);
    if (record?.id === missionId) await bookmarks.removeTree(folder.id);
  }
  const readback = await loadSavedMissionVault(bookmarks);
  if (readback.some((item) => item.id === missionId)) {
    throw new Error("SAVED_MISSION_VAULT_DELETE_READBACK_MISMATCH");
  }
  return readback;
}

export async function migrateSavedMissionsToVault(records, {
  bookmarks,
  maxSavedMissions = 24
} = {}) {
  const normalized = (Array.isArray(records) ? records : []).map(normalizeRecord).filter(Boolean);
  for (const record of normalized.slice(0, maxSavedMissions)) {
    await writeSavedMissionVault(record, { bookmarks, maxSavedMissions });
  }
  return loadSavedMissionVault(bookmarks);
}

export function savedMissionVaultContract() {
  return {
    schema: SAVED_MISSION_VAULT_SCHEMA,
    owner: "CHROME_PROFILE_BOOKMARK_STORE",
    extensionInstallIndependent: true,
    extensionIdIndependent: true,
    deleteRequiresDurableReadback: true
  };
}
