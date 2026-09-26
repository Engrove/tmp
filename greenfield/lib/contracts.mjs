export const APP_NAME = "EIC Autonom Agent Greenfield";
export const APP_VERSION = "1.8.7";
export const AUDIT_SCHEMA = "eic.greenfield.audit.v2";
export const PROCESS_SCHEMA = "eic.greenfield.process.v1";
export const ANALYSIS_SCHEMA = "eic.greenfield.hjalmar-d2.v3";
export const NANO_SCHEMA = "eic.greenfield.nano.v1";
export const A2A_MESSAGE_SCHEMA = "eic.a2a.message.v1";
export const A2A_RESPONSE_SCHEMA = "eic.a2a.response.v1";
export const A2A_PROTOCOL = "EIC-A2A/1";

export const PHASES = Object.freeze({
  SENDING: "SENDING",
  WAITING: "WAITING",
  ANALYZING: "ANALYZING",
  PAUSED: "PAUSED",
  RECOVERING: "RECOVERING",
  DETACHED: "DETACHED",
  ROTATING: "ROTATING",
  BLOCKED: "BLOCKED",
  DONE: "DONE",
  STOPPED: "STOPPED",
  AUDIT_FAILURE: "AUDIT_FAILURE",
  // v1.8.1: queue worker idle until the next slot becomes runnable (schedule).
  // Terminal for the process: the queue wake alarm activates the next slot.
  QUEUE_WAIT: "QUEUE_WAIT"
});

export const TERMINAL_PHASES = new Set([
  PHASES.BLOCKED,
  PHASES.DONE,
  PHASES.STOPPED,
  PHASES.AUDIT_FAILURE,
  PHASES.QUEUE_WAIT
]);

export const WATCHDOG_MINUTES = 0.5;
export const FAST_RECHECK_MS = 900;
export const RESPONSE_STABLE_MIN_MS = 2_500;
export const RESPONSE_STABLE_READS = 3;
// A structurally untrusted role node may be admitted only through the stricter
// exact-user-turn causal fallback in response-stability.mjs. Keep this slower
// than ordinary structural admission so a renderer fragment cannot terminalize
// on the normal 0.9s observation cadence.
export const RESPONSE_CAUSAL_FALLBACK_MIN_MS = 5_000;
export const RESPONSE_CAUSAL_FALLBACK_READS = 5;
export const ANALYSIS_WALL_MS = 180_000;
export const IDLE_KEEPALIVE_MS = 7_200_000;
export const IDLE_KEEPALIVE_MIN_MS = 600_000;
export const MAX_PROMPT_CHARS = 120_000;
export const MAX_NEXT_INSTRUCTION_CHARS = 12_000;
export const MAX_RESPONSE_CHARS = 120_000;
export const MAX_AUDIT_TEXT_CHARS = 120_000;
export const AUDIT_DB_VERSION = 3;
export const AUDIT_DEFAULT_ENABLED = false;
export const AUDIT_FIFO_LIMIT = 25;
export const MAX_PERSISTED_AUDIT_EVENTS = 5_000;
export const AUDIT_NOISE_SAMPLE_MS = 5_000;

// Chrome Prompt API currently requires an output language declaration.
// Controller/Nano output is normalized to English JSON. Source session text may
// be in another language and is treated as quoted task data.
export const MODEL_EXPECTED_OUTPUTS = Object.freeze([
  Object.freeze({ type: "text", languages: Object.freeze(["en"]) })
]);
