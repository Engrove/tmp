import { deepClone, nowIso, sanitizeText } from "./common.mjs";

export const QUICK_PROFILE_SCHEMA = "eic.autonom.quick-profile.v1";
export const QUICK_PROFILE_BINDING_SCHEMA = "eic.autonom.quick-profile-binding.v1";

export const QUICK_PROFILE_IDS = Object.freeze({
  VERIFIED_ANALYSIS: "VERIFIED_ANALYSIS",
  BOUNDED_DELIVERY: "BOUNDED_DELIVERY",
  STRICT_OPERATIONS_RECOVERY: "STRICT_OPERATIONS_RECOVERY",
  EXPLORATION_DESIGN: "EXPLORATION_DESIGN"
});

const profile = (value) => Object.freeze({
  schema: QUICK_PROFILE_SCHEMA,
  version: 1,
  ...value,
  dimensions: Object.freeze({ ...value.dimensions }),
  startSignals: Object.freeze([...value.startSignals]),
  negativeSignals: Object.freeze([...(value.negativeSignals || [])])
});

export const QUICK_PROFILES = Object.freeze([
  profile({
    id: QUICK_PROFILE_IDS.VERIFIED_ANALYSIS,
    label: "Verifierad analys",
    description: "Read-first orientering, status, jämförelse och beslutsunderlag utan underförstådd effekt.",
    startSignals: ["status", "analysera", "granska", "jämför", "öppna projekt", "vad återstår"],
    negativeSignals: ["deploy", "restart", "commit", "implementera"],
    dimensions: {
      taskRouter: ["LOOKUP", "ANALYSIS", "PLAN"],
      autonomy: "READ_ONLY_MEDIUM_HIGH",
      evidence: "OWNER_BOUND_HIGH",
      ownerRouteDepth: "CLAIM_REQUIRED_ONLY",
      workspaceRepo: "ON_DEMAND",
      browserRuntime: "READ_ONLY_PROBE",
      sessionCapture: "OPTIONAL_OR_INCREMENTAL",
      sessionMemory: "SCOPED_REUSE",
      operatorBoundary: "MATERIAL_DECISIONS_ONLY",
      retry: "ONE_IDENTICAL_RETRY",
      antiLoop: "STABLE_OBSERVATION_IDENTITY",
      outputDensity: "COMPACT",
      completion: "ANALYSIS_COMPLETE"
    }
  }),
  profile({
    id: QUICK_PROFILE_IDS.BOUNDED_DELIVERY,
    label: "Avgränsad leverans",
    description: "Hög autonomi inom ett fryst manifest med test, readback och stopp före högre effekt.",
    startSignals: ["implementera", "patcha", "commit", "branch", "test", "paket", "artifact"],
    negativeSignals: ["produktion", "reboot", "credential", "rollback"],
    dimensions: {
      taskRouter: ["DEV", "WRITE", "EXPORT"],
      autonomy: "HIGH_WITHIN_FROZEN_MANIFEST",
      evidence: "TARGET_BASE_HASH_READBACK",
      ownerRouteDepth: "WORK_UNIT_COMPLETE",
      workspaceRepo: "PRIMARY_WHEN_BOUND",
      browserRuntime: "SEPARATE_ACCEPTANCE_GATE",
      sessionCapture: "INCREMENTAL_REQUIRED",
      sessionMemory: "ACTIVE_CAPSULE_ONLY",
      operatorBoundary: "ACTION_VS_DECISION_SPLIT",
      retry: "BOUNDED_TWO_NO_PROGRESS",
      antiLoop: "NO_DUPLICATE_OBSERVATION_OBJECTS",
      outputDensity: "DECISION_CAPSULE",
      completion: "SUBTASK_DONE_PROGRAM_CONTINUE"
    }
  }),
  profile({
    id: QUICK_PROFILE_IDS.STRICT_OPERATIONS_RECOVERY,
    label: "Strikt drift & återställning",
    description: "Fail-closed runtime-, infra-, credential-, restart- och rollbackarbete med full effektkedja.",
    startSignals: ["deploy", "restart", "reboot", "root", "credential", "migration", "rollback", "production", "incident"],
    negativeSignals: ["brainstorm", "idé", "designalternativ"],
    dimensions: {
      taskRouter: ["PLAN", "DEV", "EFFECT_VERIFICATION"],
      autonomy: "CONDITIONAL_LOW",
      evidence: "PRE_EFFECT_POST_ROLLBACK_OWNER_READBACK",
      ownerRouteDepth: "MAXIMUM_REQUIRED",
      workspaceRepo: "EXACT_EFFECT_CHAIN_ONLY",
      browserRuntime: "LIVE_OWNER_REQUIRED",
      sessionCapture: "FULL_REQUIRED",
      sessionMemory: "LIVE_FIELDS_STALE_ON_CHANGE",
      operatorBoundary: "AGGRESSIVE_EXPLICIT",
      retry: "NO_SILENT_RETRY",
      antiLoop: "TWO_OBSERVATIONS_THEN_STOP",
      outputDensity: "RECEIPT_COMPACT",
      completion: "POST_EFFECT_VERIFIED_OR_UNKNOWN"
    }
  }),
  profile({
    id: QUICK_PROFILE_IDS.EXPLORATION_DESIGN,
    label: "Utforskning & design",
    description: "Bred men märkt hypotes-, research- och designsyntes utan starka effectclaims.",
    startSignals: ["design", "forska", "arkitektur", "alternativ", "idé", "ux", "hårdvara", "spekulation"],
    negativeSignals: ["deploy", "produktion", "reboot"],
    dimensions: {
      taskRouter: ["ANALYSIS", "PLAN", "WRITE", "EXPORT"],
      autonomy: "BROAD_ANALYTICAL_NO_EFFECT",
      evidence: "GRADED_FACT_INFERENCE_DESIGN",
      ownerRouteDepth: "SOURCE_VALUE_DRIVEN",
      workspaceRepo: "OFF_UNTIL_MATERIALIZATION",
      browserRuntime: "RESEARCH_ONLY",
      sessionCapture: "OPTIONAL",
      sessionMemory: "PREFERENCES_AND_DECISIONS",
      operatorBoundary: "VALUE_CHOICES",
      retry: "INFORMATION_VALUE_DRIVEN",
      antiLoop: "STOP_WHEN_NO_NEW_VALUE",
      outputDensity: "MEDIUM_RICH",
      completion: "DESIGN_READY_FOR_DECISION"
    }
  })
]);

export const DEFAULT_QUICK_PROFILE_ID = QUICK_PROFILE_IDS.VERIFIED_ANALYSIS;

export function getQuickProfile(id) {
  return QUICK_PROFILES.find((item) => item.id === String(id || "")) || null;
}

function signalMatches(text, signal) {
  return text.includes(signal.toLocaleLowerCase("sv-SE"));
}

export function recommendQuickProfile(input = "") {
  const text = sanitizeText(input, 16000).toLocaleLowerCase("sv-SE");
  const scored = QUICK_PROFILES.map((item) => {
    const positive = item.startSignals.filter((signal) => signalMatches(text, signal));
    const negative = item.negativeSignals.filter((signal) => signalMatches(text, signal));
    return {
      profileId: item.id,
      score: positive.length * 3 - negative.length * 2,
      signals: positive,
      negativeSignals: negative
    };
  }).sort((a, b) => b.score - a.score || QUICK_PROFILES.findIndex((p) => p.id === a.profileId) -
    QUICK_PROFILES.findIndex((p) => p.id === b.profileId));
  const winner = scored[0];
  if (!winner || winner.score <= 0) {
    return {
      recommendedProfileId: DEFAULT_QUICK_PROFILE_ID,
      confidence: "LOW",
      signals: [],
      materialChangeRequiresConfirmation: false
    };
  }
  return {
    recommendedProfileId: winner.profileId,
    confidence: winner.score >= 6 ? "HIGH" : "MEDIUM",
    signals: winner.signals,
    materialChangeRequiresConfirmation: winner.profileId !== DEFAULT_QUICK_PROFILE_ID
  };
}

export function materialProfileDifference(fromId, toId) {
  const from = getQuickProfile(fromId);
  const to = getQuickProfile(toId);
  if (!from || !to) return { count: Number.POSITIVE_INFINITY, keys: ["UNKNOWN_PROFILE"] };
  const keys = Object.keys(from.dimensions).filter((key) =>
    JSON.stringify(from.dimensions[key]) !== JSON.stringify(to.dimensions[key]));
  return { count: keys.length, keys };
}

export function bindQuickProfile({
  profileId,
  missionId,
  taskFingerprint,
  mandateVersion,
  mandateSha256,
  selectedBy = "OPERATOR",
  now = Date.now()
} = {}) {
  const profile = getQuickProfile(profileId);
  if (!profile) throw new Error("QUICK_PROFILE_UNKNOWN");
  const mission = sanitizeText(missionId, 240);
  const fingerprint = sanitizeText(taskFingerprint, 240);
  if (!mission || !fingerprint) throw new Error("QUICK_PROFILE_BINDING_TARGET_REQUIRED");
  return {
    schema: QUICK_PROFILE_BINDING_SCHEMA,
    version: 1,
    profileId: profile.id,
    missionId: mission,
    taskFingerprint: fingerprint,
    mandateVersion: sanitizeText(mandateVersion, 240),
    mandateSha256: sanitizeText(mandateSha256, 128),
    selectedBy: sanitizeText(selectedBy, 80),
    boundAt: nowIso(now)
  };
}

export function assertQuickProfileBinding(binding, { missionId, taskFingerprint } = {}) {
  if (!binding || binding.schema !== QUICK_PROFILE_BINDING_SCHEMA) {
    return { valid: false, reason: "QUICK_PROFILE_BINDING_MISSING" };
  }
  if (binding.missionId !== sanitizeText(missionId, 240)) {
    return { valid: false, reason: "QUICK_PROFILE_MISSION_MISMATCH" };
  }
  if (binding.taskFingerprint !== sanitizeText(taskFingerprint, 240)) {
    return { valid: false, reason: "QUICK_PROFILE_TASK_MISMATCH" };
  }
  return { valid: true, reason: "OK", binding: deepClone(binding) };
}
