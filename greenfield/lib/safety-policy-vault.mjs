// v1.9.1 durable owner for the run requirements (Körkrav); v1.9.2 adds the
// Drift settings as a second, independent section in the same folder.
//
// chrome.storage.local belongs to one extension identity. An unpacked
// extension's identity is derived from its folder path, and every release zip
// unpacks into a new version-named folder, so loading a release from its own
// folder started with an empty store and the default run requirements
// (operator report 2026-10-07, reproduced in Chromium: same profile, new
// folder -> new extension id -> 24 / 96 / 400 / 800000 / 24000).
// Saved missions (v1.2.2) and queue sets already survive this through the
// Chrome profile bookmark store; this vault gives the run requirements and
// (v1.9.2) the Drift settings the same owner. Same pattern as
// mission-queue-set-vault.mjs: staged write, byte readback, then commit; a
// damaged or foreign record reads as absent. Each section has its own
// committed copy, stage and save time, so saving one never touches the other.

export const SAFETY_POLICY_VAULT_SCHEMA = "eic.greenfield.safety-policy-vault.v1";
export const DRIFT_SETTINGS_VAULT_SCHEMA = "eic.greenfield.drift-settings-vault.v1";
// Kept from v1.9.1 so an existing vault is found; it holds both sections.
export const SAFETY_POLICY_VAULT_FOLDER = "EIC Greenfield · Run requirements v1";
const CHUNK_CHARS = 1800;
const MAX_CLOCK_SKEW_MS = 86400000;
const SECTIONS = Object.freeze({
  policy: Object.freeze({ schema: SAFETY_POLICY_VAULT_SCHEMA, field: "policy", final: "GFK1:ACTIVE", stage: "GFK1-STAGE:", path: "safety-policy-v1", code: "SAFETY_POLICY_VAULT" }),
  drift: Object.freeze({ schema: DRIFT_SETTINGS_VAULT_SCHEMA, field: "settings", final: "GFD1:ACTIVE", stage: "GFD1-STAGE:", path: "drift-settings-v1", code: "DRIFT_SETTINGS_VAULT", combine: combineDriftCopies, perKeyTimes: true })
});
// Normally one committed copy. With Chrome Sync two can meet; for the Drift
// section each setting is taken from the copy that saved it last. Equal times
// are decided by the value itself, so every machine picks the same one, and
// `copies` tells the caller to write the combination back as one copy.
function combineDriftCopies(records) {
  const values = {};
  const keySavedAtMs = {};
  const later = (a, r, key) => {
    const ta = a.settings.keySavedAtMs[key];
    const tr = r.settings.keySavedAtMs[key];
    if (tr !== ta) return tr > ta;
    return JSON.stringify(r.settings.values[key]) > JSON.stringify(a.settings.values[key]);
  };
  for (const key of Object.keys(records[0].settings.values)) {
    const best = records.reduce((a, r) => (later(a, r, key) ? r : a));
    values[key] = best.settings.values[key];
    keySavedAtMs[key] = best.settings.keySavedAtMs[key];
  }
  const newest = records.reduce((a, r) => (r.savedAtMs > a.savedAtMs ? r : a));
  return { settings: { values, keySavedAtMs }, savedAtMs: newest.savedAtMs, appVersion: newest.appVersion, copies: records.length };
}
const chunkUrlPrefix = (section) => `https://greenfield.invalid/${section.path}/chunk/`;

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
async function root(bookmarks, section, create = false) {
  if (!bookmarks?.getTree) throw new Error(`${section.code}_UNAVAILABLE`);
  const tree = await bookmarks.getTree();
  for (const node of tree || []) {
    const found = findFolder(node, SAFETY_POLICY_VAULT_FOLDER);
    if (found) return found;
  }
  if (!create) return null;
  const folders = (tree?.[0]?.children || []).filter((n) => n && !n.url && n.id);
  const parent = folders.find((n) => String(n.id) === "2") || folders.at(-1) || folders[0];
  if (!parent) throw new Error(`${section.code}_PARENT_UNAVAILABLE`);
  const made = await bookmarks.create({ parentId: parent.id, title: SAFETY_POLICY_VAULT_FOLDER });
  if (!made?.id) throw new Error(`${section.code}_CREATE_FAILED`);
  return made;
}

/**
 * A vault record: { <field>, savedAtMs, appVersion }. The value is validated
 * by the caller-supplied normalize (the same rules storage uses; it throws on
 * an invalid value), so a record that the current rules reject reads as absent.
 */
function decodeRecord(section, parsed, normalize, now = Date.now()) {
  if (parsed?.schema !== section.schema) return null;
  const savedAtMs = Number(parsed.savedAtMs);
  // A far-future stamp would outrank every real save; it reads as absent and
  // the next save or startup seed replaces it. A section with one time per
  // setting validates those itself; its record time is only a summary.
  if (!Number.isSafeInteger(savedAtMs) || savedAtMs <= 0) return null;
  if (savedAtMs > now + MAX_CLOCK_SKEW_MS && !section.perKeyTimes) return null;
  // normalize fills missing keys with defaults; a record missing any key is
  // damaged and must never be adopted as "the defaults".
  const value = parsed[section.field];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const normalized = normalize(value);
    if (Object.keys(normalized).some((key) => !Object.hasOwn(value, key))) return null;
    return { [section.field]: normalized, savedAtMs, appVersion: t(parsed.appVersion).slice(0, 40) };
  } catch {
    return null;
  }
}

async function readSnapshot(section, folder, bookmarks, normalize) {
  if (!folder?.id) return null;
  const prefix = chunkUrlPrefix(section);
  const children = await bookmarks.getChildren(folder.id);
  const parts = [];
  for (const child of children || []) {
    if (!child?.url || !t(child.url).startsWith(prefix)) continue;
    let url;
    try { url = new URL(child.url); } catch { continue; }
    const m = url.pathname.match(new RegExp(`/${section.path}/chunk/(\\d+)/(\\d+)$`));
    if (!m) continue;
    parts.push({ index: Number(m[1]), total: Number(m[2]), data: url.hash.slice(1) });
  }
  parts.sort((a, b) => a.index - b.index);
  if (!parts.length || parts.length !== parts[0].total || parts.some((p, i) => p.index !== i || p.total !== parts.length)) return null;
  try {
    return decodeRecord(section, JSON.parse(dec(parts.map((p) => p.data).join(""))), normalize);
  } catch {
    return null;
  }
}

async function loadSection(section, bookmarks, normalize) {
  const folder = await root(bookmarks, section, false);
  if (!folder) return null;
  const children = await bookmarks.getChildren(folder.id);
  // Normally one committed copy; with Chrome Sync two may meet in any order,
  // so the newest save is chosen by its own time, not by position.
  const records = [];
  for (const node of (children || []).filter((n) => !n.url && t(n.title) === section.final)) {
    const record = await readSnapshot(section, node, bookmarks, normalize);
    if (record) records.push(record);
  }
  if (!records.length) return null;
  if (records.length > 1 && section.combine) return section.combine(records);
  return records.reduce((a, r) => (r.savedAtMs > a.savedAtMs ? r : a));
}

async function writeSection(section, value, { savedAtMs, appVersion = "" }, { bookmarks, normalize, nonce = "" }) {
  if (!bookmarks?.create || !bookmarks?.getChildren || !bookmarks?.update || !bookmarks?.removeTree) {
    throw new Error(`${section.code}_UNAVAILABLE`);
  }
  const record = decodeRecord(section, { schema: section.schema, [section.field]: value, savedAtMs, appVersion }, normalize);
  if (!record) throw new Error(`${section.code}_RECORD_INVALID`);
  const folder = await root(bookmarks, section, true);
  // A stage of THIS section left by an interrupted write (browser closed
  // mid-write) is never a committed copy. The other section is never touched.
  for (const node of (await bookmarks.getChildren(folder.id)) || []) {
    if (!node.url && t(node.title).startsWith(section.stage)) await bookmarks.removeTree(node.id).catch(() => undefined);
  }
  const payload = enc(JSON.stringify({ schema: section.schema, ...record }));
  const parts = chunks(payload);
  const prefix = chunkUrlPrefix(section);
  const stage = await bookmarks.create({ parentId: folder.id, title: `${section.stage}${nonce || savedAtMs}` });
  let committed = false;
  try {
    for (let i = 0; i < parts.length; i += 1) {
      await bookmarks.create({
        parentId: stage.id,
        title: `chunk ${i + 1}/${parts.length}`,
        url: `${prefix}${i}/${parts.length}#${parts[i]}`
      });
    }
    const staged = await readSnapshot(section, stage, bookmarks, normalize);
    if (JSON.stringify(staged) !== JSON.stringify(record)) throw new Error(`${section.code}_STAGE_READBACK_MISMATCH`);
    await bookmarks.update(stage.id, { title: section.final });
    committed = true;
    for (const node of (await bookmarks.getChildren(folder.id)) || []) {
      if (node.id !== stage.id && !node.url && t(node.title) === section.final) await bookmarks.removeTree(node.id);
    }
    const readback = await loadSection(section, bookmarks, normalize);
    if (JSON.stringify(readback) !== JSON.stringify(record)) throw new Error(`${section.code}_COMMIT_READBACK_MISMATCH`);
    return readback;
  } catch (error) {
    // After the rename the stage IS the newest committed copy (older copies
    // may already be gone); removing it here could leave no copy at all.
    if (!committed) await bookmarks.removeTree(stage.id).catch(() => undefined);
    throw error;
  }
}

export function loadSafetyPolicyVault(bookmarks, { normalizePolicy }) {
  return loadSection(SECTIONS.policy, bookmarks, normalizePolicy);
}
export function writeSafetyPolicyVault({ policy, savedAtMs, appVersion = "" }, { bookmarks, normalizePolicy, nonce = "" }) {
  return writeSection(SECTIONS.policy, policy, { savedAtMs, appVersion }, { bookmarks, normalize: normalizePolicy, nonce });
}
// v1.9.2: settings = { values, keySavedAtMs } (one save time per setting).
// `normalizeSettings` must throw on any value storage would change or any
// missing time (operator-settings.mjs normalizeDriftVaultSettings), so a
// clamped or damaged record is never adopted. The record's savedAtMs is the
// newest per-setting time.
export function loadDriftSettingsVault(bookmarks, { normalizeSettings }) {
  return loadSection(SECTIONS.drift, bookmarks, normalizeSettings);
}
export function writeDriftSettingsVault({ settings, appVersion = "" }, { bookmarks, normalizeSettings, nonce = "" }) {
  const times = Object.values(settings?.keySavedAtMs || {}).map(Number).filter(Number.isSafeInteger);
  const savedAtMs = Math.min(Math.max(0, ...times), Date.now());
  return writeSection(SECTIONS.drift, settings, { savedAtMs, appVersion }, { bookmarks, normalize: normalizeSettings, nonce });
}

/**
 * What to do at startup. The newest operator save in this Chrome profile wins:
 *   ADOPT_VAULT  the vault was saved later than this installation's value
 *                (or this installation never saved one, e.g. a new extension id);
 *   SEED_VAULT   this installation's value is newer than the vault, or the
 *                vault is empty and the local value differs from the defaults
 *                (a value saved before the vault existed, or a vault write that failed);
 *   NONE         nothing to reconcile.
 * Pure.
 */
export function vaultSyncPlan({ localValue, localAtMs, vaultValue = null, vaultAtMs = 0, hasVault, defaults, equal, legacyReason }) {
  const local = localValue || defaults;
  const localAt = Number(localAtMs || 0);
  if (hasVault) {
    if (vaultAtMs > localAt) {
      return equal(vaultValue, local)
        ? { action: "NONE", reason: "VAULT_NEWER_SAME_POLICY" }
        : { action: "ADOPT_VAULT", reason: localAt ? "VAULT_NEWER_THAN_LOCAL" : "LOCAL_HAS_NO_SAVE_TIME" };
    }
    if (localAt > vaultAtMs && !equal(vaultValue, local)) return { action: "SEED_VAULT", reason: "LOCAL_NEWER_THAN_VAULT" };
    return { action: "NONE", reason: "IN_SYNC" };
  }
  if (!equal(local, defaults)) return { action: "SEED_VAULT", reason: localAt ? "VAULT_EMPTY" : legacyReason };
  return { action: "NONE", reason: "DEFAULTS_NO_VAULT" };
}
// `local` is the stored safety record (or null), `vault` a vault record (or null).
export function safetyPolicyVaultPlan({ local, vault, defaults, equalPolicy }) {
  return vaultSyncPlan({
    localValue: local?.policy, localAtMs: local?.policyUpdatedAtMs, hasVault: Boolean(vault),
    vaultValue: vault?.policy, vaultAtMs: vault?.savedAtMs, defaults, equal: equalPolicy,
    legacyReason: "VAULT_EMPTY_LEGACY_LOCAL_POLICY"
  });
}

export function safetyPolicyVaultContract() {
  return {
    schema: SAFETY_POLICY_VAULT_SCHEMA,
    owner: "CHROME_PROFILE_BOOKMARK_STORE",
    extensionInstallIndependent: true,
    extensionIdIndependent: true,
    precedence: "NEWEST_OPERATOR_SAVE_IN_PROFILE"
  };
}
export function driftSettingsVaultContract() {
  return { ...safetyPolicyVaultContract(), schema: DRIFT_SETTINGS_VAULT_SCHEMA, folder: SAFETY_POLICY_VAULT_FOLDER, independentOf: SAFETY_POLICY_VAULT_SCHEMA };
}
