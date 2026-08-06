export const UI_FOCUS_SCHEMA = "eic.autonom.ui-focus.v1";
export const UI_FOCUS_SESSION_KEY = "eic.autonom.ui-focus.v1";

export const UI_DENSITIES = Object.freeze({
  COMFORTABLE: "COMFORTABLE",
  COMPACT: "COMPACT"
});

export const OPERATIONAL_TONES = Object.freeze({
  IDLE: "IDLE",
  ACTIVE: "ACTIVE",
  ATTENTION: "ATTENTION",
  BLOCKED: "BLOCKED"
});

const DENSITY_SET = new Set(Object.values(UI_DENSITIES));
const TONE_SET = new Set(Object.values(OPERATIONAL_TONES));

export function createUiFocusPreference({
  enabled = false,
  density = UI_DENSITIES.COMFORTABLE,
  activeView = "RUN",
  updatedAt = null
} = {}) {
  return {
    schema: UI_FOCUS_SCHEMA,
    version: 1,
    enabled: enabled === true,
    density: DENSITY_SET.has(density) ? density : UI_DENSITIES.COMFORTABLE,
    activeView: String(activeView || "RUN").slice(0, 32),
    updatedAt: updatedAt ? String(updatedAt) : null
  };
}

export function normalizeUiFocusPreference(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createUiFocusPreference();
  }
  return createUiFocusPreference(value);
}

export function toggleUiFocusPreference(value, {
  activeView,
  now = Date.now()
} = {}) {
  const current = normalizeUiFocusPreference(value);
  return createUiFocusPreference({
    ...current,
    enabled: !current.enabled,
    activeView: activeView || current.activeView,
    updatedAt: new Date(now).toISOString()
  });
}

export function resolveOperationalTone({
  runState = "",
  missionState = "",
  recoveryState = "IDLE",
  approvalState = "",
  evidenceState = ""
} = {}) {
  const values = [
    String(runState || ""),
    String(missionState || ""),
    String(recoveryState || ""),
    String(approvalState || ""),
    String(evidenceState || "")
  ];
  if (values.some((value) =>
    /BLOCKED|ERROR|FAILED|HUMAN_REQUIRED|REBIND_REQUIRED|REQUIRED/.test(value))) {
    return OPERATIONAL_TONES.BLOCKED;
  }
  if (values.some((value) =>
    /PAUSED|WAITING_APPROVAL|PENDING|STALE|RECOVERING|WARNING/.test(value))) {
    return OPERATIONAL_TONES.ATTENTION;
  }
  if (values.some((value) =>
    /RUNNING|WAITING|ASSESSING|ACTIVE|ATTACHED|READY/.test(value))) {
    return OPERATIONAL_TONES.ACTIVE;
  }
  return OPERATIONAL_TONES.IDLE;
}

export function operationalToneLabel(tone) {
  const normalized = TONE_SET.has(tone) ? tone : OPERATIONAL_TONES.IDLE;
  return {
    [OPERATIONAL_TONES.IDLE]: "Ingen aktiv operativ avvikelse.",
    [OPERATIONAL_TONES.ACTIVE]: "Aktivt uppdrag pågår.",
    [OPERATIONAL_TONES.ATTENTION]: "Operatörens uppmärksamhet kan behövas.",
    [OPERATIONAL_TONES.BLOCKED]: "Körningen är blockerad eller kräver recovery."
  }[normalized];
}
