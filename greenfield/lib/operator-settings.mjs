import { DEFAULT_WORK_MODE_ENDPOINT, normalizeWorkModeEndpoint } from "./work-mode.mjs";
import {
  deleteSavedMissionVault,
  loadSavedMissionVault,
  migrateSavedMissionsToVault,
  savedMissionVaultContract,
  writeSavedMissionVault
} from "./saved-mission-vault.mjs";
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
export const MAX_SAVED_MISSIONS = 24;
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

export async function saveMissionPreset(goal, {
  storage = defaultStorage(),
  bookmarks = defaultBookmarks(),
  now = Date.now(),
  id = ""
} = {}) {
  const normalizedGoal = String(goal || "").trim();
  if (!normalizedGoal) throw new Error("SAVED_MISSION_GOAL_REQUIRED");
  const current = await loadOperatorSettings(storage, { bookmarks });
  const timestamp = new Date(now).toISOString();
  const existing = current.savedMissions.find((item) => item.goal === normalizedGoal);
  const missionId = existing?.id || String(id || `mission-${now}-${Math.random().toString(36).slice(2, 10)}`);
  const record = {
    id: missionId,
    label: missionLabel(normalizedGoal),
    goal: normalizedGoal,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };

  if (bookmarks) {
    const durable = await writeSavedMissionVault(record, {
      bookmarks,
      maxSavedMissions: MAX_SAVED_MISSIONS
    });
    return writeLocalOperatorSettings({
      ...current,
      savedMissions: durable
    }, storage);
  }

  const savedMissions = [
    record,
    ...current.savedMissions.filter((item) => item.id !== missionId && item.goal !== normalizedGoal)
  ].slice(0, MAX_SAVED_MISSIONS);
  return writeLocalOperatorSettings({ ...current, savedMissions }, storage);
}

export async function deleteMissionPreset(
  id,
  storage = defaultStorage(),
  {
    bookmarks = defaultBookmarks()
  } = {}
) {
  const current = await loadOperatorSettings(storage, { bookmarks });
  if (bookmarks) {
    const durable = await deleteSavedMissionVault(id, { bookmarks });
    return writeLocalOperatorSettings({
      ...current,
      savedMissions: durable
    }, storage);
  }

  const savedMissions = current.savedMissions.filter((item) => item.id !== String(id || ""));
  return writeLocalOperatorSettings({ ...current, savedMissions }, storage);
}

export function savedMissionDurabilityContract() {
  return savedMissionVaultContract();
}
