import { deepClone, sanitizeText } from "./common.mjs";
import {
  MISSION_BUILD_PROFILES,
  MISSION_MODE_IDS,
  resolveMissionMode
} from "./mission-contract.mjs";

export const MISSION_START_SCHEMA = "eic.autonom.mission-start.v1";
export const MISSION_INPUT_SCHEMA = "eic.autonom.mission-input.v1";
export const MISSION_EXECUTION_OWNER = "MISSION";
export const CURRENT_RUN_ADAPTER = "CURRENT_RUN_V10";
export const DIRECT_MISSION_ADAPTER = "DIRECT_MISSION_V1";

function template({
  modeId,
  label,
  description,
  panelId,
  startButtonId,
  legacyCommand,
  enabled
}) {
  return Object.freeze({
    schema: "eic.autonom.mission-mode-template.v1",
    version: 1,
    modeId,
    label,
    description,
    panelId,
    startButtonId,
    legacyCommand,
    enabled
  });
}

export const MISSION_MODE_TEMPLATE_REGISTRY = Object.freeze({
  [MISSION_MODE_IDS.CHATGPT_CONTINUATION]: template({
    modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
    label: "Fortsätt session",
    description: "Vänta på nästa kompletta assistantsvar i en redan förberedd ChatGPT/EIC-session.",
    panelId: "missionModePanelContinuation",
    startButtonId: "startWaitingButton",
    legacyCommand: "START_WAITING",
    enabled: true
  }),
  [MISSION_MODE_IDS.CHATGPT_NEW_SESSION]: template({
    modeId: MISSION_MODE_IDS.CHATGPT_NEW_SESSION,
    label: "Ny session",
    description: "Analysera och leverera en engångsstartprompt till en uttryckligen vald session.",
    panelId: "missionModePanelNewSession",
    startButtonId: "startNewSessionButton",
    legacyCommand: "START_NEW_SESSION",
    enabled: true
  }),
  [MISSION_MODE_IDS.APP_AUDIT_LONG]: template({
    modeId: MISSION_MODE_IDS.APP_AUDIT_LONG,
    label: "Appgranskning",
    description: "Kör den befintliga systematiska, långvariga appgranskningen som Mission mode.",
    panelId: "appAuditSection",
    startButtonId: "startAppAuditButton",
    legacyCommand: "START_APP_AUDIT",
    enabled: true
  }),
  [MISSION_MODE_IDS.ARCHAEOLOGY_LONG]: template({
    modeId: MISSION_MODE_IDS.ARCHAEOLOGY_LONG,
    label: "Arkeologi",
    description: "Kör den befintliga read-only-forskningen och reverse engineering-flödet som Mission mode.",
    panelId: "archaeologySection",
    startButtonId: "startArchaeologyButton",
    legacyCommand: "START_ARCHAEOLOGY",
    enabled: true
  }),
  [MISSION_MODE_IDS.AI_WEB_RESEARCH]: template({
    modeId: MISSION_MODE_IDS.AI_WEB_RESEARCH,
    label: "AI-webbresearch",
    description: "Browserprofilens guarded webbresearchläge med bounded evidens och policygrindar.",
    panelId: "missionModePanelWebResearch",
    startButtonId: "startWebResearchButton",
    legacyCommand: null,
    enabled: true
  })
});

export const MISSION_MODE_TEMPLATE_ORDER = Object.freeze([
  MISSION_MODE_IDS.CHATGPT_CONTINUATION,
  MISSION_MODE_IDS.CHATGPT_NEW_SESSION,
  MISSION_MODE_IDS.APP_AUDIT_LONG,
  MISSION_MODE_IDS.ARCHAEOLOGY_LONG,
  MISSION_MODE_IDS.AI_WEB_RESEARCH
]);

/**
 * Every active mission can require local classification or recovery. The Chrome
 * LanguageModel session must therefore be created from the same operator gesture
 * that starts the mission, before any asynchronous config or input work occurs.
 */
export function missionModeRequiresNanoHost(modeId) {
  return MISSION_MODE_TEMPLATE_ORDER.includes(String(modeId || ""));
}

const MODE_INPUT_KEYS = Object.freeze({
  [MISSION_MODE_IDS.CHATGPT_CONTINUATION]: Object.freeze([]),
  [MISSION_MODE_IDS.CHATGPT_NEW_SESSION]: Object.freeze(["startPrompt", "analysis"]),
  [MISSION_MODE_IDS.APP_AUDIT_LONG]: Object.freeze([
    "testNeed", "context", "targetReadOnly",
    "allowWorkbenchAuditFiles", "allowForgejoFindingSink"
  ]),
  [MISSION_MODE_IDS.ARCHAEOLOGY_LONG]: Object.freeze([
    "scenario", "question", "context", "allowWorkspaceEvidence", "allowExport"
  ]),
  [MISSION_MODE_IDS.AI_WEB_RESEARCH]: Object.freeze([
    "goal", "scope", "startUrl", "evidencePolicy"
  ])
});

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertAllowedKeys(modeId, input) {
  const allowed = new Set(MODE_INPUT_KEYS[modeId] || []);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`MISSION_INPUT_KEY_NOT_ALLOWED:${modeId}:${key}`);
  }
}

function text(value, max) {
  return sanitizeText(value || "", max);
}

function normalizeBoolean(value, fallback) {
  return value === undefined ? fallback : Boolean(value);
}

function missionInput(modeId, fields = {}) {
  return {
    schema: MISSION_INPUT_SCHEMA,
    version: 1,
    modeId,
    ...fields
  };
}

export function resolveMissionModeTemplate(modeId) {
  const entry = MISSION_MODE_TEMPLATE_REGISTRY[String(modeId || "")];
  if (!entry) throw new Error(`MISSION_MODE_TEMPLATE_UNKNOWN:${modeId}`);
  return entry;
}

export function listMissionModeTemplates({ includeDisabled = true } = {}) {
  return MISSION_MODE_TEMPLATE_ORDER
    .map((modeId) => resolveMissionModeTemplate(modeId))
    .filter((entry) => includeDisabled || entry.enabled)
    .map((entry) => deepClone(entry));
}

export function normalizeMissionStartRequest({
  modeId,
  input = {},
  sourceCommand = "START_MISSION",
  buildProfile = MISSION_BUILD_PROFILES.STANDARD
} = {}) {
  const mode = resolveMissionMode(modeId);
  const templateEntry = resolveMissionModeTemplate(mode.modeId);
  if (!mode.enabled || !templateEntry.enabled) {
    throw new Error(`MISSION_MODE_DISABLED:${mode.modeId}`);
  }
  const profileAvailable = mode.buildProfile === MISSION_BUILD_PROFILES.BROWSER
    ? buildProfile === MISSION_BUILD_PROFILES.BROWSER
    : [MISSION_BUILD_PROFILES.STANDARD, MISSION_BUILD_PROFILES.BROWSER].includes(buildProfile);
  if (!profileAvailable) {
    throw new Error(`MISSION_BUILD_PROFILE_UNAVAILABLE:${mode.buildProfile}:${buildProfile}`);
  }
  if (!isRecord(input)) throw new Error(`MISSION_INPUT_NOT_OBJECT:${mode.modeId}`);
  assertAllowedKeys(mode.modeId, input);

  let runtimeInput;
  let storedInput;

  if (mode.modeId === MISSION_MODE_IDS.CHATGPT_CONTINUATION) {
    runtimeInput = {};
    storedInput = missionInput(mode.modeId, {
      activation: "WAIT_FOR_NEXT_COMPLETED_ASSISTANT"
    });
  } else if (mode.modeId === MISSION_MODE_IDS.CHATGPT_NEW_SESSION) {
    const startPrompt = String(input.startPrompt || "");
    if (!startPrompt.trim()) throw new Error("MISSION_NEW_SESSION_PROMPT_REQUIRED");
    if (!isRecord(input.analysis)) throw new Error("MISSION_NEW_SESSION_ANALYSIS_REQUIRED");
    runtimeInput = {
      startPrompt,
      analysis: deepClone(input.analysis)
    };
    storedInput = missionInput(mode.modeId, {
      startPromptLength: startPrompt.length,
      startPromptDigest: text(input.analysis.promptDigest, 160),
      taskIntent: text(input.analysis.taskIntent, 1200),
      firstWorkUnit: text(input.analysis.firstWorkUnit, 1200)
    });
  } else if (mode.modeId === MISSION_MODE_IDS.APP_AUDIT_LONG) {
    const testNeed = text(input.testNeed, 4000);
    if (!testNeed) throw new Error("MISSION_APP_AUDIT_TEST_NEED_REQUIRED");
    runtimeInput = {
      testNeed,
      context: text(input.context, 8000),
      targetReadOnly: normalizeBoolean(input.targetReadOnly, true),
      allowWorkbenchAuditFiles: normalizeBoolean(input.allowWorkbenchAuditFiles, true),
      allowForgejoFindingSink: normalizeBoolean(input.allowForgejoFindingSink, true)
    };
    storedInput = missionInput(mode.modeId, deepClone(runtimeInput));
  } else if (mode.modeId === MISSION_MODE_IDS.ARCHAEOLOGY_LONG) {
    const question = text(input.question, 5000);
    if (!question) throw new Error("MISSION_ARCHAEOLOGY_QUESTION_REQUIRED");
    runtimeInput = {
      scenario: text(input.scenario, 80).toUpperCase() || "GENERAL_RESEARCH",
      question,
      context: text(input.context, 12000),
      allowWorkspaceEvidence: normalizeBoolean(input.allowWorkspaceEvidence, true),
      allowExport: normalizeBoolean(input.allowExport, true)
    };
    storedInput = missionInput(mode.modeId, deepClone(runtimeInput));
  } else if (mode.modeId === MISSION_MODE_IDS.AI_WEB_RESEARCH) {
    const goal = text(input.goal, 5000);
    const scope = text(input.scope, 5000);
    if (!goal) throw new Error("MISSION_WEB_RESEARCH_GOAL_REQUIRED");
    if (!scope) throw new Error("MISSION_WEB_RESEARCH_SCOPE_REQUIRED");
    let startUrl = "";
    if (input.startUrl) {
      let parsed;
      try {
        parsed = new URL(String(input.startUrl));
      } catch {
        throw new Error("MISSION_WEB_RESEARCH_START_URL_INVALID");
      }
      if (!["http:", "https:"].includes(parsed.protocol) ||
          parsed.username || parsed.password ||
          ["chatgpt.com", "chat.openai.com"].includes(parsed.hostname.toLowerCase())) {
        throw new Error("MISSION_WEB_RESEARCH_START_URL_INVALID");
      }
      startUrl = parsed.href;
    }
    const evidencePolicy = text(input.evidencePolicy, 1200) || "BOUNDED_REDACTED_NO_RESPONSE_BODIES";
    runtimeInput = {
      goal,
      scope,
      startUrl,
      evidencePolicy
    };
    storedInput = missionInput(mode.modeId, {
      goal,
      scope,
      startUrl,
      evidencePolicy,
      targetContentAuthority: "NONE",
      responseBodies: false
    });
  } else {
    throw new Error(`MISSION_MODE_START_UNSUPPORTED:${mode.modeId}`);
  }

  return Object.freeze({
    schema: MISSION_START_SCHEMA,
    version: 1,
    modeId: mode.modeId,
    sourceCommand: text(sourceCommand, 80) || "START_MISSION",
    mode: deepClone(mode),
    template: deepClone(templateEntry),
    runtimeInput,
    missionInput: storedInput
  });
}
