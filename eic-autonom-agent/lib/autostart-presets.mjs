import { deepClone } from "./common.mjs";

export const AUTOSTART_PRESET_SCHEMA = "eic.autonom.autostart-preset.v1";

function preset(value) {
  return Object.freeze({
    schema: AUTOSTART_PRESET_SCHEMA,
    version: 1,
    ...value
  });
}

export const AUTOSTART_PRESETS = Object.freeze([
  preset({
    id: "CONTEXT_ONLY",
    order: 10,
    label: "1 · Endast kontext",
    description: "Koppla aktiv ChatGPT-flik och starta automatisk Session Capture utan uppdrag eller Mjölnar.",
    quickProfileId: "VERIFIED_ANALYSIS",
    missionModeId: null,
    activateNano: false,
    startMission: false,
    mjolnarEnabled: false,
    mjolnarRolloutMode: "SHADOW",
    requiresConfirmation: false
  }),
  preset({
    id: "VERIFIED_ANALYSIS",
    order: 20,
    label: "2 · Verifierad analys",
    description: "Koppla fliken, aktivera Nano och starta en read-first fortsättningsmission.",
    quickProfileId: "VERIFIED_ANALYSIS",
    missionModeId: "CHATGPT_CONTINUATION",
    activateNano: true,
    startMission: true,
    mjolnarEnabled: false,
    mjolnarRolloutMode: "SHADOW",
    requiresConfirmation: false
  }),
  preset({
    id: "EXPLORATION_DESIGN",
    order: 30,
    label: "3 · Utforskning & design",
    description: "Bred analys och syntes utan Mjölnar eller underförstådda effekter.",
    quickProfileId: "EXPLORATION_DESIGN",
    missionModeId: "CHATGPT_CONTINUATION",
    activateNano: true,
    startMission: true,
    mjolnarEnabled: false,
    mjolnarRolloutMode: "SHADOW",
    requiresConfirmation: false
  }),
  preset({
    id: "BOUNDED_DELIVERY",
    order: 40,
    label: "4 · Avgränsad leverans",
    description: "Fryst arbetsenhet med Nano, inkrementell capture och stopp före högre effekt.",
    quickProfileId: "BOUNDED_DELIVERY",
    missionModeId: "CHATGPT_CONTINUATION",
    activateNano: true,
    startMission: true,
    mjolnarEnabled: false,
    mjolnarRolloutMode: "SHADOW",
    requiresConfirmation: false
  }),
  preset({
    id: "MJOLNAR_D0",
    order: 50,
    label: "5 · Mjölnar D0",
    description: "Avgränsad leverans med rutin-, read- och reconnect-dispatch.",
    quickProfileId: "BOUNDED_DELIVERY",
    missionModeId: "CHATGPT_CONTINUATION",
    activateNano: true,
    startMission: true,
    mjolnarEnabled: true,
    mjolnarRolloutMode: "D0_LIVE",
    requiresConfirmation: false
  }),
  preset({
    id: "MJOLNAR_D1",
    order: 60,
    label: "6 · Mjölnar D1",
    description: "Strikt drift med registrerade rollback- och readback-actions.",
    quickProfileId: "STRICT_OPERATIONS_RECOVERY",
    missionModeId: "CHATGPT_CONTINUATION",
    activateNano: true,
    startMission: true,
    mjolnarEnabled: true,
    mjolnarRolloutMode: "D1_LIVE",
    requiresConfirmation: true
  }),
  preset({
    id: "MJOLNAR_D2",
    order: 70,
    label: "7 · Mjölnar D2",
    description: "Högsta rollout för auth, permissions, merge, release och deploy; kräver explicit bekräftelse.",
    quickProfileId: "STRICT_OPERATIONS_RECOVERY",
    missionModeId: "CHATGPT_CONTINUATION",
    activateNano: true,
    startMission: true,
    mjolnarEnabled: true,
    mjolnarRolloutMode: "D2_LIVE",
    requiresConfirmation: true
  })
]);

export const DEFAULT_AUTOSTART_PRESET_ID = "VERIFIED_ANALYSIS";

export function getAutostartPreset(id) {
  return AUTOSTART_PRESETS.find((item) => item.id === String(id || "")) || null;
}

export function autostartConfigPatch(presetId) {
  const selected = getAutostartPreset(presetId);
  if (!selected) throw new Error("AUTOSTART_PRESET_UNKNOWN");
  return {
    autostartPresetId: selected.id,
    quickProfileId: selected.quickProfileId,
    scenarioPreset: selected.quickProfileId,
    autoSessionCaptureEnabled: true,
    mjolnarEnabled: selected.mjolnarEnabled,
    mjolnarRolloutMode: selected.mjolnarRolloutMode,
    defaultMissionModeId: selected.missionModeId || "CHATGPT_CONTINUATION"
  };
}

export function buildAutostartPlan(presetId) {
  const selected = getAutostartPreset(presetId);
  if (!selected) throw new Error("AUTOSTART_PRESET_UNKNOWN");
  return deepClone({
    schema: "eic.autonom.autostart-plan.v1",
    presetId: selected.id,
    configPatch: autostartConfigPatch(selected.id),
    linkActiveTab: true,
    activateNano: selected.activateNano,
    startMission: selected.startMission,
    missionModeId: selected.missionModeId,
    requiresConfirmation: selected.requiresConfirmation
  });
}
