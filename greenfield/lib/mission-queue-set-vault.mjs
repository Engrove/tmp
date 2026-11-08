export const QUEUE_SET_VAULT_SCHEMA = "eic.greenfield.mission-queue-set-vault.v1";
export const QUEUE_SET_VAULT_FOLDER = "EIC Greenfield · Mission queue sets v1";
const FINAL_PREFIX = "GFQ1:ACTIVE";
const STAGE_PREFIX = "GFQ1-STAGE:";
const CHUNK_URL_PREFIX = "https://greenfield.invalid/queue-set-v1/chunk/";
const CHUNK_CHARS = 1800;

const t = (v) => String(v ?? "");
function enc(value) {
  const bytes = new TextEncoder().encode(t(value));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function dec(value) {
  const normalized = t(value).replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(normalized + padding);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}
function chunks(value) {
  const source = t(value);
  const out = [];
  for (let i = 0; i < source.length; i += CHUNK_CHARS) out.push(source.slice(i, i + CHUNK_CHARS));
  return out.length ? out : [""];
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
async function tree(bookmarks) {
  if (!bookmarks?.getTree) throw new Error("QUEUE_SET_VAULT_UNAVAILABLE");
  return bookmarks.getTree();
}
async function root(bookmarks, create = false) {
  const tr = await tree(bookmarks);
  for (const node of tr || []) {
    const found = findFolder(node, QUEUE_SET_VAULT_FOLDER);
    if (found) return found;
  }
  if (!create) return null;
  const r = tr?.[0];
  const folders = (r?.children || []).filter((n) => n && !n.url && n.id);
  const parent = folders.find((n) => String(n.id) === "2") || folders.at(-1) || folders[0];
  if (!parent) throw new Error("QUEUE_SET_VAULT_PARENT_UNAVAILABLE");
  const made = await bookmarks.create({ parentId: parent.id, title: QUEUE_SET_VAULT_FOLDER });
  if (!made?.id) throw new Error("QUEUE_SET_VAULT_CREATE_FAILED");
  return made;
}
async function readSnapshot(folder, bookmarks) {
  if (!folder?.id) return null;
  const children = await bookmarks.getChildren(folder.id);
  const parts = [];
  for (const child of children || []) {
    if (!child?.url || !t(child.url).startsWith(CHUNK_URL_PREFIX)) continue;
    let url; try { url = new URL(child.url); } catch { continue; }
    const m = url.pathname.match(/\/queue-set-v1\/chunk\/(\d+)\/(\d+)$/);
    if (!m) continue;
    parts.push({ index: Number(m[1]), total: Number(m[2]), data: url.hash.slice(1) });
  }
  parts.sort((a,b) => a.index-b.index);
  if (!parts.length || parts.length !== parts[0].total || parts.some((p,i)=>p.index!==i || p.total!==parts.length)) return null;
  try {
    const parsed = JSON.parse(dec(parts.map((p)=>p.data).join("")));
    return parsed?.schema === QUEUE_SET_VAULT_SCHEMA ? parsed.store || null : null;
  } catch { return null; }
}
export async function loadMissionQueueSetVault(bookmarks) {
  const r = await root(bookmarks, false);
  if (!r) return null;
  const children = await bookmarks.getChildren(r.id);
  const finals = (children || []).filter((n)=>!n.url && t(n.title) === FINAL_PREFIX);
  for (const folder of finals.slice().reverse()) {
    const store = await readSnapshot(folder, bookmarks);
    if (store) return store;
  }
  return null;
}
export async function writeMissionQueueSetVault(store, { bookmarks, nonce = "" } = {}) {
  if (!bookmarks?.create || !bookmarks?.getChildren || !bookmarks?.update || !bookmarks?.removeTree) throw new Error("QUEUE_SET_VAULT_UNAVAILABLE");
  const r = await root(bookmarks, true);
  const payload = enc(JSON.stringify({ schema: QUEUE_SET_VAULT_SCHEMA, store }));
  const parts = chunks(payload);
  const stage = await bookmarks.create({ parentId: r.id, title: `${STAGE_PREFIX}${nonce || Date.now()}` });
  try {
    for (let i=0;i<parts.length;i++) await bookmarks.create({
      parentId: stage.id, title: `chunk ${i+1}/${parts.length}`,
      url: `${CHUNK_URL_PREFIX}${i}/${parts.length}#${parts[i]}`
    });
    const staged = await readSnapshot(stage, bookmarks);
    if (JSON.stringify(staged) !== JSON.stringify(store)) throw new Error("QUEUE_SET_VAULT_STAGE_READBACK_MISMATCH");
    await bookmarks.update(stage.id, { title: FINAL_PREFIX });
    const siblings = await bookmarks.getChildren(r.id);
    for (const node of siblings || []) {
      if (node.id !== stage.id && !node.url && t(node.title) === FINAL_PREFIX) await bookmarks.removeTree(node.id);
    }
    const readback = await loadMissionQueueSetVault(bookmarks);
    if (JSON.stringify(readback) !== JSON.stringify(store)) throw new Error("QUEUE_SET_VAULT_COMMIT_READBACK_MISMATCH");
    return readback;
  } catch (error) {
    await bookmarks.removeTree(stage.id).catch(()=>undefined);
    throw error;
  }
}
export function missionQueueSetVaultContract() {
  return { schema: QUEUE_SET_VAULT_SCHEMA, owner: "CHROME_PROFILE_BOOKMARK_STORE", extensionInstallIndependent: true, extensionIdIndependent: true };
}
