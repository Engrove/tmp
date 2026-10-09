import { DEFAULT_WORK_MODE_ENDPOINT, normalizeWorkModeEndpoint } from "./work-mode.mjs";
import { storageLock } from "./durable-checkpoint.mjs";
import {
  deleteSavedMissionVault,
  loadSavedMissionVault,
  migrateSavedMissionsToVault,
  savedMissionVaultContract,
  writeSavedMissionVault
} from "./saved-mission-vault.mjs";
import {
  planSavedMissionImport,
  savedMissionKey,
  savedMissionsByKey
} from "./saved-mission-catalog.mjs";
import {
  DEFAULT_MAX_ACTIVE_SESSIONS,
  normalizeMaxActiveSessions
} from "./global-capacity-scheduler.mjs";
import {
  DEFAULT_MISSION_QUANTUM_INTERACTIONS,
  DEFAULT_QUEUE_PRIORITY_AGING_SECONDS,
  DEFAULT_QUEUE_SWITCH_HARD_RELOAD,
  DEFAULT_QUEUE_SWITCH_DELAY_SECONDS,
  DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS,
  DEFAULT_WARM_QUEUE_RESUME,
  normalizeMissionQuantumInteractions,
  normalizeQueuePriorityAgingSeconds,
  normalizeQueueSwitchDelaySeconds,
  normalizeQueueSwitchSettleSeconds
} from "./mission-work-queue.mjs";

export const OPERATOR_SETTINGS_KEY = "eic.gf.operator.settings.v1";
// v1.8.5: 64 (was 24); the vault refuses a new mission at the limit instead
// of silently dropping the oldest.
export const MAX_SAVED_MISSIONS = 64;
export const MIN_POST_DELAY_SECONDS = 0;
export const MAX_POST_DELAY_SECONDS = 300;

function defaultStorage() {
  return globalThis.chrome?.storage?.local || null;
}

function defaultBookmarks() {
  return globalThis.chrome?.bookmarks || null;
}

function requireStorage(storage) {
  if (!storage?.get || !storage?.set) throw new Error("OPERATOR_SETTINGS_STORAGE_UNAVAILABLE");
  return storage;
}

export function normalizePostDelaySeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(MIN_POST_DELAY_SECONDS, Math.min(MAX_POST_DELAY_SECONDS, Math.round(n)));
}

function missionLabel(goal) {
  const first = String(goal || "").trim().split(/\r?\n/, 1)[0] || "Sparat uppdrag";
  return first.length <= 80 ? first : `${first.slice(0, 77)}…`;
}

export function normalizeSavedMission(value) {
  if (!value || typeof value !== "object") return null;
  const goal = String(value.goal || "").trim();
  if (!goal) return null;
  return {
    id: String(value.id || "").trim(),
    label: String(value.label || missionLabel(goal)).trim().slice(0, 120) || missionLabel(goal),
    goal,
    createdAt: String(value.createdAt || ""),
    updatedAt: String(value.updatedAt || value.createdAt || "")
  };
}

export function normalizeOperatorSettings(value = {}) {
  const missions = Array.isArray(value.savedMissions)
    ? value.savedMissions.map(normalizeSavedMission).filter(Boolean)
    : [];
  const seen = new Set();
  const deduped = [];
  for (const item of missions) {
    const key = item.id || `goal:${item.goal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= MAX_SAVED_MISSIONS) break;
  }
  return {
    schema: "eic.greenfield.operator-settings.v3",
    postDelaySeconds: normalizePostDelaySeconds(value.postDelaySeconds),
    maxActiveSessions: value.maxActiveSessions == null
      ? DEFAULT_MAX_ACTIVE_SESSIONS
      : normalizeMaxActiveSessions(value.maxActiveSessions),
    defaultMissionQuantumInteractions: normalizeMissionQuantumInteractions(
      value.defaultMissionQuantumInteractions ?? DEFAULT_MISSION_QUANTUM_INTERACTIONS
    ),
    queuePriorityAgingSeconds: normalizeQueuePriorityAgingSeconds(
      value.queuePriorityAgingSeconds ?? DEFAULT_QUEUE_PRIORITY_AGING_SECONDS
    ),
    queueSwitchHardReload: value.queueSwitchHardReload == null
      ? DEFAULT_QUEUE_SWITCH_HARD_RELOAD
      : value.queueSwitchHardReload === true,
    queueSwitchDelaySeconds: normalizeQueueSwitchDelaySeconds(
      value.queueSwitchDelaySeconds ?? DEFAULT_QUEUE_SWITCH_DELAY_SECONDS
    ),
    queueSwitchSettleSeconds: normalizeQueueSwitchSettleSeconds(
      value.queueSwitchSettleSeconds ?? DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS
    ),
    // v1.9.0: a parked GFW resumes in its own conversation when eligible
    // (lib/warm-resume.mjs); on unless the operator turns it off.
    warmQueueResume: value.warmQueueResume == null
      ? DEFAULT_WARM_QUEUE_RESUME
      : value.warmQueueResume === true,
    // v1.8.12: the worker (Chrome window binding) that owns the reserved
    // capacity slot; "" = no reservation.
    reservedWorkerId: String(value.reservedWorkerId || "").trim().slice(0, 200),
    workModeEnabled: value.workModeEnabled === true,
    workModeSupervisorWorkerId: String(value.workModeSupervisorWorkerId || "").trim().slice(0, 200),
    workModeEndpoint: normalizeWorkModeEndpoint(value.workModeEndpoint ?? DEFAULT_WORK_MODE_ENDPOINT),
    // v1.9.2: when an operator last saved each of DRIFT_SETTINGS_KEYS (0 =
    // never), and whether the latest change came from a save or the vault.
    driftSettingsSavedAtMs: normalizeDriftStamps(value.driftSettingsSavedAtMs),
    driftSettingsOrigin: DRIFT_SETTINGS_ORIGINS.has(value.driftSettingsOrigin) ? value.driftSettingsOrigin : "",
    savedMissions: deduped
  };
}

const DRIFT_SETTINGS_ORIGINS = new Set(["OPERATOR", "VAULT"]);
// v1.9.2: one writer of the record at a time. The side panel and the service
// worker are separate JS contexts with the same chrome-extension:// origin;
// Web Locks (navigator.locks) is shared by both (verified in Chromium 141), so
// a panel write can no longer land between the worker's read and write (or
// the reverse). Where Web Locks is missing (Node tests) the per-context
// storageLock serializes writers of the same storage object.
const SETTINGS_WRITE_LOCK = `${OPERATOR_SETTINGS_KEY}.write`;
export function withOperatorSettingsLock(storage, work) {
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request === "function") return locks.request(SETTINGS_WRITE_LOCK, () => work());
  return storageLock(requireStorage(storage), SETTINGS_WRITE_LOCK, work);
}

// v1.9.2: the Drift settings that follow the operator to a new installation
// folder through the profile bookmark vault (lib/safety-policy-vault.mjs).
// Not included: reservedWorkerId and workModeSupervisorWorkerId name Chrome
// window bindings of this installation; workModeEnabled is switched on at
// every start (v1.9.0); savedMissions have their own vault (v1.2.2).
export const DRIFT_SETTINGS_KEYS = Object.freeze([
  "postDelaySeconds",
  "maxActiveSessions",
  "defaultMissionQuantumInteractions",
  "queuePriorityAgingSeconds",
  "queueSwitchHardReload",
  "queueSwitchDelaySeconds",
  "queueSwitchSettleSeconds",
  "warmQueueResume"
]);

export function driftSettingsOf(settings = {}) {
  const normalized = normalizeOperatorSettings(settings);
  return Object.fromEntries(DRIFT_SETTINGS_KEYS.map((key) => [key, normalized[key]]));
}

export const DEFAULT_DRIFT_SETTINGS = Object.freeze(driftSettingsOf({}));

export function equalDriftSettings(a, b) {
  return DRIFT_SETTINGS_KEYS.every((key) => a?.[key] === b?.[key]);
}

// Save times work as a logical clock: a save is stamped later than any time
// already seen for that setting (saveOperatorSettings), so a time from a clock
// that ran fast is outranked, never clamped (a moving clamp would let the vault
// win again right after the save). Only an absurd time is refused.
export const DRIFT_STAMP_MAX = Date.UTC(3000, 0, 1);
function normalizeDriftStamps(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(DRIFT_SETTINGS_KEYS.map((key) => {
    const n = Number(source[key]);
    return [key, Number.isSafeInteger(n) && n > 0 && n <= DRIFT_STAMP_MAX ? n : 0];
  }));
}

// For vault records: every key present with exactly the value storage keeps.
// normalizeOperatorSettings clamps and defaults silently; a clamped or
// defaulted value in a vault record means damage, so it is refused.
export function normalizeDriftSettingsStrict(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DRIFT_SETTINGS_INVALID");
  const normalized = driftSettingsOf(value);
  for (const key of DRIFT_SETTINGS_KEYS) {
    if (!Object.hasOwn(value, key) || value[key] !== normalized[key]) throw new Error(`DRIFT_SETTINGS_INVALID:${key}`);
  }
  return normalized;
}

// The Drift section of the profile vault: { values, keySavedAtMs }, one save
// time per setting. Refused when any value or time is missing or out of range.
export function normalizeDriftVaultSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DRIFT_SETTINGS_INVALID");
  const values = normalizeDriftSettingsStrict(value.values);
  const source = value.keySavedAtMs;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("DRIFT_SETTINGS_INVALID:keySavedAtMs");
  // Kept as written (see DRIFT_STAMP_MAX): a later save outranks a time from a
  // clock that ran fast; clamping on read would move with the reading clock.
  const keySavedAtMs = {};
  for (const key of DRIFT_SETTINGS_KEYS) {
    const n = source[key];
    if (!Number.isSafeInteger(n) || n < 1 || n > DRIFT_STAMP_MAX) throw new Error(`DRIFT_SETTINGS_INVALID:keySavedAtMs.${key}`);
    keySavedAtMs[key] = n;
  }
  return { values, keySavedAtMs };
}

// Save times below any real save (Date.now()), for values without one:
//   DRIFT_STAMP_DEFAULT  a never-saved default, carried into the vault so the
//                        record is complete; loses to every saved value;
//   DRIFT_STAMP_LEGACY   a non-default value saved before v1.9.2; beats a
//                        carried default, loses to every save made in 1.9.2.
export const DRIFT_STAMP_DEFAULT = 1;
export const DRIFT_STAMP_LEGACY = 2;
function effectiveDriftStamps(settings) {
  const values = driftSettingsOf(settings || {});
  const savedAt = normalizeDriftStamps(settings?.driftSettingsSavedAtMs);
  return Object.fromEntries(DRIFT_SETTINGS_KEYS.map((key) => [
    key,
    savedAt[key] || (values[key] !== DEFAULT_DRIFT_SETTINGS[key] ? DRIFT_STAMP_LEGACY : 0)
  ]));
}

/**
 * v1.9.2: per-setting merge of this installation and the vault. For each
 * setting the newer save wins (a tie with different values goes to the vault,
 * so every installation converges). A save of one setting therefore never
 * carries the other seven with it. Pure.
 *   values/stamps   the merged state for both sides
 *   adoptedKeys     settings whose value this installation takes from the vault
 *   localChanged    this installation's record must be rewritten
 *   vaultWrite      the vault must be (re)written (also when two copies met)
 * Without a vault, nothing is seeded while every setting is a never-saved
 * default.
 */
export function mergeDriftSettings(local, vault = null) {
  const localValues = driftSettingsOf(local || {});
  const savedAt = normalizeDriftStamps(local?.driftSettingsSavedAtMs);
  const effective = effectiveDriftStamps(local || {});
  const values = {};
  const stamps = {};
  const adoptedKeys = [];
  let localChanged = false;
  let vaultWrite = false;
  if (!vault) {
    const seed = DRIFT_SETTINGS_KEYS.some((key) => effective[key] > 0);
    for (const key of DRIFT_SETTINGS_KEYS) {
      values[key] = localValues[key];
      stamps[key] = seed ? (effective[key] || DRIFT_STAMP_DEFAULT) : savedAt[key];
      if (stamps[key] !== savedAt[key]) localChanged = true;
    }
    return { values, stamps, adoptedKeys, localChanged, vaultWrite: seed };
  }
  for (const key of DRIFT_SETTINGS_KEYS) {
    const vaultValue = vault.settings.values[key];
    const vaultAt = vault.settings.keySavedAtMs[key];
    if (vaultAt > effective[key] || (vaultAt === effective[key] && vaultValue !== localValues[key])) {
      values[key] = vaultValue;
      stamps[key] = vaultAt;
      if (vaultValue !== localValues[key]) adoptedKeys.push(key);
      if (vaultValue !== localValues[key] || vaultAt !== savedAt[key]) localChanged = true;
    } else {
      values[key] = localValues[key];
      stamps[key] = effective[key];
      if (localValues[key] !== vaultValue || effective[key] !== vaultAt) vaultWrite = true;
      if (effective[key] !== savedAt[key]) localChanged = true;
    }
  }
  if ((vault.copies || 1) > 1) vaultWrite = true; // collapse copies met through Chrome Sync
  return { values, stamps, adoptedKeys, localChanged, vaultWrite };
}

// v1.9.2 backup restore: per setting, the newer of this installation and the
// backup wins (a tie keeps this installation). Pure.
export function mergeImportedDriftSettings(current, imported) {
  const currentValues = driftSettingsOf(current || {});
  const importedValues = driftSettingsOf(imported || {});
  const currentAt = effectiveDriftStamps(current || {});
  const importedAt = effectiveDriftStamps(imported || {});
  const values = {};
  const stamps = {};
  for (const key of DRIFT_SETTINGS_KEYS) {
    const fromBackup = importedAt[key] > currentAt[key];
    values[key] = fromBackup ? importedValues[key] : currentValues[key];
    stamps[key] = fromBackup ? importedAt[key] : currentAt[key];
  }
  return { values, stamps };
}

async function readLocalOperatorSettings(storage) {
  const area = requireStorage(storage);
  const stored = await area.get(OPERATOR_SETTINGS_KEY);
  return normalizeOperatorSettings(stored?.[OPERATOR_SETTINGS_KEY] || {});
}

async function writeLocalOperatorSettings(settings, storage) {
  const area = requireStorage(storage);
  const next = normalizeOperatorSettings(settings);
  await area.set({ [OPERATOR_SETTINGS_KEY]: next });
  const readback = await readLocalOperatorSettings(area);
  if (JSON.stringify(readback) !== JSON.stringify(next)) {
    throw new Error("OPERATOR_SETTINGS_READBACK_MISMATCH");
  }
  return readback;
}

export async function loadOperatorSettings(
  storage = defaultStorage(),
  {
    bookmarks = defaultBookmarks(),
    restoreSavedMissions = true
  } = {}
) {
  const local = await readLocalOperatorSettings(storage);
  if (!restoreSavedMissions || !bookmarks) return local;

  let durable = await loadSavedMissionVault(bookmarks);
  if (!durable.length && local.savedMissions.length) {
    durable = await migrateSavedMissionsToVault(local.savedMissions, {
      bookmarks,
      maxSavedMissions: MAX_SAVED_MISSIONS
    });
  }

  const next = normalizeOperatorSettings({
    ...local,
    savedMissions: durable
  });
  if (JSON.stringify(next) !== JSON.stringify(local)) {
    return writeSavedMissionsInto(durable, storage);
  }
  return next;
}

// v1.9.2: the saved-mission paths read the record, then spend time on the
// bookmark vault. Their write therefore re-reads the record under the write
// lock and replaces only savedMissions, so a Drift change (an operator save in
// the other context, a vault adoption) made meanwhile is kept.
async function writeSavedMissionsInto(savedMissions, storage) {
  return withOperatorSettingsLock(storage, async () => {
    const fresh = await readLocalOperatorSettings(storage);
    return writeLocalOperatorSettings({ ...fresh, savedMissions }, storage);
  });
}

export async function saveOperatorSettings(
  patch = {},
  storage = defaultStorage(),
  {
    bookmarks = defaultBookmarks(),
    restoreSavedMissions = true,
    now = Date.now()
  } = {}
) {
  const { driftSettingsSavedAtMs, driftSettingsOrigin, ...operatorPatch } = patch || {};
  // The saved-mission sync (bookmarks) runs first and takes the lock itself.
  if (restoreSavedMissions && bookmarks) await loadOperatorSettings(storage, { bookmarks, restoreSavedMissions });
  return withOperatorSettingsLock(storage, async () => {
    const current = await readLocalOperatorSettings(requireStorage(storage));
    const next = normalizeOperatorSettings({ ...current, ...operatorPatch });
    // v1.9.2: each Drift setting the operator changes gets its own save time,
    // so the newest save of that setting in the Chrome profile wins. A value
    // sent unchanged (a form resubmitting what it shows) is not a new save.
    // The time never goes behind the setting's known time (a vault time from a
    // clock that ran fast), so the operator's latest change always wins.
    const changedKeys = DRIFT_SETTINGS_KEYS.filter((key) => Object.hasOwn(operatorPatch, key) && next[key] !== current[key]);
    if (changedKeys.length) {
      for (const key of changedKeys) next.driftSettingsSavedAtMs[key] = Math.max(now, current.driftSettingsSavedAtMs[key] + 1);
      next.driftSettingsOrigin = "OPERATOR";
    }
    return writeLocalOperatorSettings(next, storage);
  });
}

// v1.9.2: bring this installation in line with the vault (mergeDriftSettings),
// computed inside the write lock on the stored record, so a save that landed
// after the vault was read is merged, never overwritten. Only the Drift
// settings, their save times and the origin change.
export async function reconcileLocalDriftSettings(vault, storage = defaultStorage()) {
  return withOperatorSettingsLock(storage, async () => {
    const local = await readLocalOperatorSettings(requireStorage(storage));
    const merge = mergeDriftSettings(local, vault);
    if (!merge.localChanged) return { settings: local, merge };
    const settings = await writeLocalOperatorSettings({
      ...local,
      ...merge.values,
      driftSettingsSavedAtMs: merge.stamps,
      driftSettingsOrigin: merge.adoptedKeys.length ? "VAULT" : local.driftSettingsOrigin
    }, storage);
    return { settings, merge };
  });
}

function savedMissionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function newMissionId(now) {
  return `mission-${now}-${Math.random().toString(36).slice(2, 10)}`;
}

// One durable write of one record; returns the saved mission list after readback.
async function writeSavedMissionRecord(current, record, { storage, bookmarks }) {
  if (bookmarks) {
    return writeSavedMissionVault(record, { bookmarks, maxSavedMissions: MAX_SAVED_MISSIONS });
  }
  const replaces = current.some((item) => item.id === record.id || item.goal === record.goal);
  if (!replaces && current.length >= MAX_SAVED_MISSIONS) throw savedMissionError("SAVED_MISSION_LIMIT_REACHED");
  return [record, ...current.filter((item) => item.id !== record.id && item.goal !== record.goal)];
}

async function removeSavedMissionRecord(current, id, { bookmarks }) {
  if (bookmarks) return deleteSavedMissionVault(id, { bookmarks });
  return current.filter((item) => item.id !== String(id || ""));
}

/**
 * v1.8.5 save with identity. mode:
 *  AUTO   - "Spara aktuellt uppdrag": same text -> that record; else the newest
 *           record with the same first-line GFW key is updated in place (same
 *           id); else a new record (id, when given, names the new record).
 *  UPDATE - "Spara ändring": targetId is updated in place.
 *  CREATE - "Spara som nytt": always a new record.
 * A key held by another record is refused (SAVED_MISSION_KEY_CONFLICT) so one
 * GFW key never names two saved missions through these paths.
 */
export async function saveSavedMission(goal, {
  storage = defaultStorage(),
  bookmarks = defaultBookmarks(),
  now = Date.now(),
  id = "",
  targetId = "",
  mode = "AUTO"
} = {}) {
  const normalizedGoal = String(goal || "").trim();
  if (!normalizedGoal) throw savedMissionError("SAVED_MISSION_GOAL_REQUIRED");
  const op = String(mode || "AUTO").toUpperCase();
  if (!["AUTO", "UPDATE", "CREATE"].includes(op)) throw savedMissionError("SAVED_MISSION_MODE_INVALID");
  const current = await loadOperatorSettings(storage, { bookmarks });
  const missions = current.savedMissions;
  const key = savedMissionKey(normalizedGoal);
  const timestamp = new Date(now).toISOString();

  let existing = null;
  if (op === "UPDATE") {
    existing = missions.find((item) => item.id === String(targetId || "")) || null;
    if (!existing) throw savedMissionError("SAVED_MISSION_NOT_FOUND");
  } else if (op === "AUTO") {
    existing = missions.find((item) => item.goal === normalizedGoal) ||
      (key ? savedMissionsByKey(missions).get(key)?.[0] : null) ||
      null;
  }
  const missionId = existing?.id || String(id || newMissionId(now));
  if (key && missions.some((item) => item.id !== missionId && savedMissionKey(item.goal) === key)) {
    // AUTO picked the newest record for this key; older duplicates are only
    // a conflict when the operator explicitly targets another record.
    if (op !== "AUTO") throw savedMissionError("SAVED_MISSION_KEY_CONFLICT");
  }
  if (!existing && missions.length >= MAX_SAVED_MISSIONS) throw savedMissionError("SAVED_MISSION_LIMIT_REACHED");

  const record = {
    id: missionId,
    label: missionLabel(normalizedGoal),
    goal: normalizedGoal,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  const durable = await writeSavedMissionRecord(missions, record, { storage, bookmarks });
  const settings = await writeSavedMissionsInto(durable, storage);
  const saved = settings.savedMissions.find((item) => item.id === missionId);
  if (!saved || saved.goal !== normalizedGoal) throw savedMissionError("SAVED_MISSION_READBACK_MISMATCH");
  return {
    settings,
    record: saved,
    action: !existing ? "CREATED" : existing.goal === normalizedGoal ? "UNCHANGED" : "UPDATED",
    previous: existing ? { goal: existing.goal, label: existing.label } : null
  };
}

export async function saveMissionPreset(goal, {
  storage = defaultStorage(),
  bookmarks = defaultBookmarks(),
  now = Date.now(),
  id = ""
} = {}) {
  const result = await saveSavedMission(goal, { storage, bookmarks, now, id, mode: "AUTO" });
  return result.settings;
}

/**
 * v1.8.5 bulk import from parseSavedMissionImport(). Order: merge duplicates
 * (frees room), update, create. Every record is written with durable readback;
 * a failure stops the import and the next run is idempotent (UNCHANGED rows).
 */
export async function applySavedMissionImport(importedMissions, {
  storage = defaultStorage(),
  bookmarks = defaultBookmarks(),
  now = Date.now(),
  mergeDuplicates = true
} = {}) {
  const current = await loadOperatorSettings(storage, { bookmarks });
  const plan = planSavedMissionImport(current.savedMissions, importedMissions, {
    maxSavedMissions: MAX_SAVED_MISSIONS,
    mergeDuplicates
  });
  if (!plan.ok) throw savedMissionError(plan.error || "SAVED_MISSION_IMPORT_INVALID");

  let missions = current.savedMissions;
  const merged = {};
  const changes = [];
  if (plan.mergeDuplicates) {
    for (const row of plan.rows) {
      for (const duplicateId of row.duplicateIds) {
        missions = await removeSavedMissionRecord(missions, duplicateId, { bookmarks });
        merged[duplicateId] = row.targetId;
      }
    }
  }
  let offset = 0;
  for (const row of plan.rows.filter((item) => item.action === "UPDATE")) {
    const existing = missions.find((item) => item.id === row.targetId);
    if (!existing) throw savedMissionError("SAVED_MISSION_NOT_FOUND");
    const record = {
      id: existing.id,
      label: missionLabel(row.goal),
      goal: row.goal,
      createdAt: existing.createdAt || new Date(now).toISOString(),
      updatedAt: new Date(now + offset).toISOString()
    };
    offset += 1;
    missions = await writeSavedMissionRecord(missions, record, { storage, bookmarks });
    changes.push({ id: record.id, key: row.key, action: "UPDATED", label: record.label });
  }
  for (const row of plan.rows.filter((item) => item.action === "CREATE")) {
    const record = {
      id: newMissionId(now + offset),
      label: missionLabel(row.goal),
      goal: row.goal,
      createdAt: new Date(now + offset).toISOString(),
      updatedAt: new Date(now + offset).toISOString()
    };
    offset += 1;
    missions = await writeSavedMissionRecord(missions, record, { storage, bookmarks });
    changes.push({ id: record.id, key: row.key, action: "CREATED", label: record.label });
  }

  const settings = await writeSavedMissionsInto(missions, storage);
  const byKey = savedMissionsByKey(settings.savedMissions);
  for (const row of plan.rows) {
    const saved = byKey.get(row.key) || [];
    if (saved.length < 1 || saved[0].goal !== row.goal || (plan.mergeDuplicates && saved.length !== 1)) {
      throw savedMissionError("SAVED_MISSION_IMPORT_READBACK_MISMATCH");
    }
  }
  return { settings, plan, changes, merged };
}

export async function deleteMissionPreset(
  id,
  storage = defaultStorage(),
  {
    bookmarks = defaultBookmarks()
  } = {}
) {
  const current = await loadOperatorSettings(storage, { bookmarks });
  const savedMissions = await removeSavedMissionRecord(current.savedMissions, id, { bookmarks });
  return writeSavedMissionsInto(savedMissions, storage);
}

export function savedMissionDurabilityContract() {
  return savedMissionVaultContract();
}
