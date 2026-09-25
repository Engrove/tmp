import { DEFAULT_WORK_MODE_ENDPOINT, normalizeWorkModeEndpoint } from "./work-mode.mjs";
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
    workModeEnabled: value.workModeEnabled === true,
    workModeSupervisorWorkerId: String(value.workModeSupervisorWorkerId || "").trim().slice(0, 200),
    workModeEndpoint: normalizeWorkModeEndpoint(value.workModeEndpoint ?? DEFAULT_WORK_MODE_ENDPOINT),
    savedMissions: deduped
  };
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
    return writeLocalOperatorSettings(next, storage);
  }
  return next;
}

export async function saveOperatorSettings(
  patch = {},
  storage = defaultStorage(),
  {
    bookmarks = defaultBookmarks(),
    restoreSavedMissions = true
  } = {}
) {
  const current = await loadOperatorSettings(storage, { bookmarks, restoreSavedMissions });
  const next = normalizeOperatorSettings({ ...current, ...patch });
  return writeLocalOperatorSettings(next, storage);
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
  const settings = await writeLocalOperatorSettings({ ...current, savedMissions: durable }, storage);
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

  const settings = await writeLocalOperatorSettings({ ...current, savedMissions: missions }, storage);
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
  return writeLocalOperatorSettings({ ...current, savedMissions }, storage);
}

export function savedMissionDurabilityContract() {
  return savedMissionVaultContract();
}
