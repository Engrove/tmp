import { text } from "./common.mjs";
import { GREENFIELD_PRIORITIES } from "./global-capacity-scheduler.mjs";

// v1.7.7 AI-requested runtime control.
//
// The EIC AI may REQUEST a bounded set of runtime effects on the logical GFW /
// queue slot it is currently serving. Greenfield is the effect owner: every
// request is parsed against a closed whitelist, bound to the exact target of
// the prompt it answers, checked against operator precedence and owner state,
// and only then turned into a typed effect. Nothing here evaluates code,
// follows property paths or spreads AI-supplied objects into runtime state.
//
// Precedence: operator runtime control > validated Greenfield owner state >
// AI runtime-control request.

export const RUNTIME_CONTROL_FIELD = "runtimeControl";
export const RUNTIME_CONTROL_STATE_SCHEMA = "eic.greenfield.runtime-control.state.v1";
export const RUNTIME_CONTROL_CONTRACT_SCHEMA = "eic.greenfield.runtime-control.contract.v1";

export const RUNTIME_CONTROL_OPS = Object.freeze({
  COMPLETE_MISSION: "COMPLETE_MISSION",
  SET_QUANTUM: "SET_QUANTUM",
  SET_PRIORITY: "SET_PRIORITY"
});

export const RUNTIME_CONTROL_RECEIPT = Object.freeze({
  APPLIED: "APPLIED",
  ALREADY_APPLIED: "ALREADY_APPLIED",
  REJECTED: "REJECTED",
  STALE: "STALE",
  INVALID: "INVALID"
});

export const RUNTIME_CONTROL_SOURCE = Object.freeze({
  RUNTIME_CONTROL: "RUNTIME_CONTROL",
  LEGACY_STATUS_DONE: "LEGACY_STATUS_DONE",
  LEGACY_STOP_PROCESS: "LEGACY_STOP_PROCESS"
});

export const RUNTIME_CONTROL_MAX_ACTIONS = 4;
export const RUNTIME_CONTROL_MAX_JSON_CHARS = 4000;
export const RUNTIME_CONTROL_REASON_MAX_CHARS = 1000;
// AI-requested quantum is deliberately narrower than the operator range
// (1..50): the AI may shape its own slot cadence inside the normal 1..15
// band but can never grant itself an operator-sized quantum.
export const AI_QUANTUM_MIN = 1;
export const AI_QUANTUM_MAX = 15;
export const AI_PRIORITY_VALUES = Object.freeze(Object.keys(GREENFIELD_PRIORITIES));

const MAX_RECEIPTS = 8;
const MAX_LEDGER = 32;
const TARGET_KEYS = Object.freeze(["runId", "turn", "queueId", "itemId", "savedMissionId"]);
const TOP_LEVEL_KEYS = new Set(["target", "actions"]);
// Maps, not object literals: an AI-supplied op such as "__proto__" or
// "constructor" must never resolve to an inherited property.
const OP_FIELDS = new Map([
  [RUNTIME_CONTROL_OPS.COMPLETE_MISSION, new Set(["op", "reason"])],
  [RUNTIME_CONTROL_OPS.SET_QUANTUM, new Set(["op", "reason", "maxInteractions"])],
  [RUNTIME_CONTROL_OPS.SET_PRIORITY, new Set(["op", "reason", "priority"])]
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function ownKeys(value) {
  return Object.keys(value);
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function priorityRank(value) {
  return Object.prototype.hasOwnProperty.call(GREENFIELD_PRIORITIES, value)
    ? GREENFIELD_PRIORITIES[value]
    : null;
}

function parseTarget(raw) {
  if (raw === undefined) return { state: "ABSENT", target: null };
  if (!isPlainObject(raw)) return { state: "MALFORMED", target: null };
  const keys = ownKeys(raw);
  if (keys.length !== TARGET_KEYS.length || !TARGET_KEYS.every((key) => keys.includes(key))) {
    return { state: "MALFORMED", target: null };
  }
  if (!Number.isInteger(raw.turn) || raw.turn < 0) return { state: "MALFORMED", target: null };
  for (const key of ["runId", "queueId", "itemId", "savedMissionId"]) {
    if (typeof raw[key] !== "string" || raw[key].length > 200) return { state: "MALFORMED", target: null };
  }
  if (!raw.runId) return { state: "MALFORMED", target: null };
  return {
    state: "WELL_FORMED",
    target: {
      runId: raw.runId,
      turn: raw.turn,
      queueId: raw.queueId,
      itemId: raw.itemId,
      savedMissionId: raw.savedMissionId
    }
  };
}

function parseAction(raw, index) {
  if (!isPlainObject(raw)) return { index, op: "", value: null, reason: "", error: "ACTION_NOT_OBJECT" };
  const op = typeof raw.op === "string" ? raw.op : "";
  const allowed = OP_FIELDS.get(op);
  if (!allowed) return { index, op: text(op, 64), value: null, reason: "", error: "UNKNOWN_OPERATION" };
  const extra = ownKeys(raw).find((key) => !allowed.has(key));
  if (extra) return { index, op, value: null, reason: "", error: `UNKNOWN_FIELD:${text(extra, 64)}` };
  if ("reason" in raw &&
      (typeof raw.reason !== "string" || raw.reason.length > RUNTIME_CONTROL_REASON_MAX_CHARS)) {
    return { index, op, value: null, reason: "", error: "REASON_INVALID" };
  }
  const reason = typeof raw.reason === "string" ? raw.reason : "";
  if (op === RUNTIME_CONTROL_OPS.SET_QUANTUM) {
    const value = raw.maxInteractions;
    if (!Number.isInteger(value)) return { index, op, value: null, reason, error: "QUANTUM_NOT_INTEGER" };
    if (value < AI_QUANTUM_MIN || value > AI_QUANTUM_MAX) {
      return { index, op, value, reason, error: "QUANTUM_OUT_OF_BOUNDS" };
    }
    return { index, op, value, reason, error: "" };
  }
  if (op === RUNTIME_CONTROL_OPS.SET_PRIORITY) {
    const value = raw.priority;
    if (typeof value !== "string" || !AI_PRIORITY_VALUES.includes(value)) {
      return { index, op, value: typeof value === "string" ? text(value, 32) : null, reason, error: "PRIORITY_NOT_ALLOWED" };
    }
    return { index, op, value, reason, error: "" };
  }
  return { index, op, value: null, reason, error: "" };
}

/**
 * Parse the optional response field into a closed, bounded request model.
 * Returns null when the field is absent or null. Malformed input never throws and is
 * represented by errors, so a bad control block cannot break response liveness.
 */
export function parseRuntimeControlRequest(raw) {
  if (raw === undefined || raw === null) return null;
  const request = {
    present: true,
    targetState: "ABSENT",
    target: null,
    actions: [],
    errors: []
  };
  let size = Infinity;
  try {
    size = String(JSON.stringify(raw) ?? "").length;
  } catch {}
  if (size > RUNTIME_CONTROL_MAX_JSON_CHARS) {
    request.errors.push("RUNTIME_CONTROL_TOO_LARGE");
    return request;
  }
  if (!isPlainObject(raw)) {
    request.errors.push("RUNTIME_CONTROL_NOT_OBJECT");
    return request;
  }
  const parsedTarget = parseTarget(raw.target);
  request.targetState = parsedTarget.state;
  request.target = parsedTarget.target;
  const unknown = ownKeys(raw).filter((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknown.length) request.errors.push(`RUNTIME_CONTROL_UNKNOWN_FIELD:${text(unknown[0], 64)}`);
  if (!Array.isArray(raw.actions)) {
    request.errors.push("RUNTIME_CONTROL_ACTIONS_REQUIRED");
    return request;
  }
  if (raw.actions.length === 0) request.errors.push("RUNTIME_CONTROL_ACTIONS_EMPTY");
  if (raw.actions.length > RUNTIME_CONTROL_MAX_ACTIONS) request.errors.push("RUNTIME_CONTROL_TOO_MANY_ACTIONS");
  if (request.errors.length) return request;

  request.actions = raw.actions.map((item, index) => parseAction(item, index));
  const counts = new Map();
  for (const action of request.actions) {
    if (!action.error) counts.set(action.op, (counts.get(action.op) || 0) + 1);
  }
  for (const action of request.actions) {
    if (!action.error && counts.get(action.op) > 1) action.error = "DUPLICATE_OPERATION";
  }
  return request;
}

/**
 * The exact target identity Greenfield publishes in each prompt. The AI copies
 * it verbatim into runtimeControl.target; Greenfield compares, never dereferences.
 */
export function runtimeControlTarget(process) {
  const ctx = process?.queueContext?.itemId ? process.queueContext : null;
  return {
    runId: String(process?.runId || ""),
    turn: Number.isInteger(Number(process?.turn)) ? Number(process.turn) : 0,
    queueId: String(ctx?.queueId || ""),
    itemId: String(ctx?.itemId || ""),
    savedMissionId: String(ctx?.savedMissionId || "")
  };
}

function targetMismatch(target, owner) {
  if (target.runId !== owner.runId) return "WRONG_RUN";
  if (target.turn !== owner.turn) return "STALE_TURN";
  if (target.queueId !== owner.queueId) return "WRONG_QUEUE";
  if (target.itemId !== owner.itemId) return "WRONG_QUEUE_ITEM";
  if (target.savedMissionId !== owner.savedMissionId) return "WRONG_SAVED_MISSION";
  return "";
}

function effectKey(owner, action) {
  return `${text(owner.responseHash, 128)}:${action.index}:${action.op}`;
}

function receipt(action, status, reason, extra = {}) {
  return {
    op: action.op || "*",
    status,
    reason,
    requested: action.value ?? null,
    source: extra.source || RUNTIME_CONTROL_SOURCE.RUNTIME_CONTROL,
    effective: extra.effective || "",
    itemId: extra.itemId || "",
    effectKey: extra.effectKey || ""
  };
}

function ownerSlot(owner) {
  return owner.queueManaged && owner.item && owner.item.itemId === owner.itemId ? owner.item : null;
}

function evaluateCompleteMission(action, owner, source) {
  const ack = { index: action.index, op: RUNTIME_CONTROL_OPS.COMPLETE_MISSION, value: null };
  if (owner.queueManaged && owner.queueLoadError) {
    // Terminal truth is owned by the causally paired response; queue retirement
    // is executed (and retried/self-healed) by the terminal finalize path.
    return {
      accepted: true,
      receipt: receipt(ack, RUNTIME_CONTROL_RECEIPT.APPLIED, "PROCESS_TERMINAL_QUEUE_RETIREMENT_PENDING", {
        source,
        effective: "TERMINAL"
      })
    };
  }
  if (owner.queueManaged && !ownerSlot(owner)) {
    // The effect is logically idempotent: the slot is already retired or not
    // present. Terminal commit is still correct for this causally paired turn.
    return {
      accepted: true,
      receipt: receipt(ack, RUNTIME_CONTROL_RECEIPT.ALREADY_APPLIED, "QUEUE_SLOT_ALREADY_RETIRED_OR_ABSENT", {
        source,
        effective: "TERMINAL"
      })
    };
  }
  return {
    accepted: true,
    receipt: receipt(ack, RUNTIME_CONTROL_RECEIPT.APPLIED, owner.queueManaged
      ? "LOGICAL_GFW_TERMINAL_ALL_DUPLICATE_SLOTS_RETIRE"
      : "PROCESS_TERMINAL", {
      source,
      effective: "TERMINAL"
    })
  };
}

function evaluateSlotPrecondition(action, owner) {
  if (!owner.queueManaged) return receipt(action, RUNTIME_CONTROL_RECEIPT.REJECTED, "NOT_QUEUE_MANAGED");
  const slot = ownerSlot(owner);
  if (!slot || owner.queueLoadError) return receipt(action, RUNTIME_CONTROL_RECEIPT.STALE, "TARGET_NOT_IN_QUEUE");
  if (slot.status !== "ACTIVE") return receipt(action, RUNTIME_CONTROL_RECEIPT.STALE, "SLOT_NOT_ACTIVE");
  const operatorEditedAtMs = Number(slot.operatorEditedAtMs || 0);
  if (operatorEditedAtMs > 0 && operatorEditedAtMs >= Number(owner.promptIssuedAtMs || 0)) {
    return receipt(action, RUNTIME_CONTROL_RECEIPT.REJECTED, "OPERATOR_PRECEDENCE");
  }
  return null;
}

function evaluateSetQuantum(action, owner) {
  const blocked = evaluateSlotPrecondition(action, owner);
  if (blocked) return { receipt: blocked, effect: null };
  const key = effectKey(owner, action);
  const slot = ownerSlot(owner);
  if (owner.ledger.includes(key) || Number(slot.maxInteractions) === action.value) {
    return {
      receipt: receipt(action, RUNTIME_CONTROL_RECEIPT.ALREADY_APPLIED, "VALUE_ALREADY_CURRENT", {
        effective: "NEXT_QUANTUM",
        itemId: slot.itemId,
        effectKey: key
      }),
      effect: { op: action.op, itemId: slot.itemId, field: "maxInteractions", value: action.value, effectKey: key, noop: true }
    };
  }
  return {
    receipt: receipt(action, RUNTIME_CONTROL_RECEIPT.APPLIED, "SLOT_QUANTUM_UPDATED", {
      effective: "NEXT_QUANTUM",
      itemId: slot.itemId,
      effectKey: key
    }),
    effect: { op: action.op, itemId: slot.itemId, field: "maxInteractions", value: action.value, effectKey: key, noop: false }
  };
}

function evaluateSetPriority(action, owner) {
  const blocked = evaluateSlotPrecondition(action, owner);
  if (blocked) return { receipt: blocked, effect: null };
  const slot = ownerSlot(owner);
  const ceiling = priorityRank(slot.operatorPriority) ?? priorityRank(slot.priority) ?? GREENFIELD_PRIORITIES.NORMAL;
  if (priorityRank(action.value) > ceiling) {
    return { receipt: receipt(action, RUNTIME_CONTROL_RECEIPT.REJECTED, "PRIORITY_ABOVE_OPERATOR_CEILING"), effect: null };
  }
  const key = effectKey(owner, action);
  if (owner.ledger.includes(key) || slot.priority === action.value) {
    return {
      receipt: receipt(action, RUNTIME_CONTROL_RECEIPT.ALREADY_APPLIED, "VALUE_ALREADY_CURRENT", {
        effective: "IMMEDIATE",
        itemId: slot.itemId,
        effectKey: key
      }),
      effect: { op: action.op, itemId: slot.itemId, field: "priority", value: action.value, effectKey: key, noop: true }
    };
  }
  return {
    receipt: receipt(action, RUNTIME_CONTROL_RECEIPT.APPLIED, "SLOT_PRIORITY_UPDATED", {
      effective: "IMMEDIATE",
      itemId: slot.itemId,
      effectKey: key
    }),
    effect: { op: action.op, itemId: slot.itemId, field: "priority", value: action.value, effectKey: key, noop: false }
  };
}

// Non-terminal handlers. Adding a runtime control means adding one whitelisted
// op, its field set in OP_FIELDS, its parser branch and one handler here.
const SLOT_HANDLERS = new Map([
  [RUNTIME_CONTROL_OPS.SET_QUANTUM, evaluateSetQuantum],
  [RUNTIME_CONTROL_OPS.SET_PRIORITY, evaluateSetPriority]
]);

function normalizeOwner(owner = {}) {
  return {
    runId: String(owner.runId || ""),
    turn: Number.isInteger(Number(owner.turn)) ? Number(owner.turn) : 0,
    queueManaged: owner.queueManaged === true,
    queueId: String(owner.queueId || ""),
    itemId: String(owner.itemId || ""),
    savedMissionId: String(owner.savedMissionId || ""),
    item: owner.item && typeof owner.item === "object" ? owner.item : null,
    queueLoadError: owner.queueLoadError === true,
    promptIssuedAtMs: Number(owner.promptIssuedAtMs || 0),
    responseHash: String(owner.responseHash || ""),
    ledger: Array.isArray(owner.ledger) ? owner.ledger.map(String) : []
  };
}

/**
 * Evaluate one captured response against current owner state.
 *
 * Returns:
 *   terminal: null when no terminal was requested, else { requested, accepted,
 *             source, receipt } - accepted terminal is executed by the existing
 *             DONE commit + logical-GFW queue retirement path;
 *   effects:  typed slot effects (only whitelisted fields) to persist;
 *   receipts: one receipt per evaluated action / rejected block.
 */
export function evaluateRuntimeControl({ request = null, status = "", sessionAction = "KEEP", owner = {} } = {}) {
  const o = normalizeOwner(owner);
  const receipts = [];
  const effects = [];
  const statusValue = upper(status);
  const sessionValue = upper(sessionAction) || "KEEP";
  const terminalSignal = statusValue === "DONE" || sessionValue === "STOP_PROCESS";
  const legacySource = sessionValue === "STOP_PROCESS"
    ? RUNTIME_CONTROL_SOURCE.LEGACY_STOP_PROCESS
    : RUNTIME_CONTROL_SOURCE.LEGACY_STATUS_DONE;
  let terminal = null;

  const blockPresent = Boolean(request?.present);
  const mismatch = blockPresent && request.targetState === "WELL_FORMED"
    ? targetMismatch(request.target, o)
    : "";
  let actionable = [];

  if (blockPresent) {
    if (request.errors.length) {
      receipts.push(receipt({ op: "*" }, RUNTIME_CONTROL_RECEIPT.INVALID, request.errors[0]));
    } else if (request.targetState !== "WELL_FORMED") {
      receipts.push(receipt({ op: "*" }, RUNTIME_CONTROL_RECEIPT.INVALID,
        request.targetState === "ABSENT" ? "TARGET_REQUIRED" : "TARGET_MALFORMED"));
    } else if (mismatch) {
      for (const action of request.actions) {
        receipts.push(receipt(action, RUNTIME_CONTROL_RECEIPT.STALE, mismatch));
      }
    } else {
      for (const action of request.actions) {
        if (action.error) receipts.push(receipt(action, RUNTIME_CONTROL_RECEIPT.INVALID, action.error));
        else actionable.push(action);
      }
    }
  }

  const explicitComplete = actionable.find((action) => action.op === RUNTIME_CONTROL_OPS.COMPLETE_MISSION) || null;
  const blockRequestsComplete = Boolean(request?.actions?.some((action) => action.op === RUNTIME_CONTROL_OPS.COMPLETE_MISSION));
  if (explicitComplete && !terminalSignal) {
    receipts.push(receipt(explicitComplete, RUNTIME_CONTROL_RECEIPT.INVALID, "TERMINAL_STATUS_REQUIRED"));
    actionable = actionable.filter((action) => action !== explicitComplete);
  }

  if (terminalSignal) {
    if (mismatch) {
      // A well-formed but mismatching target is positive evidence that this
      // terminal decision was formed about another GFW/turn. Fail closed.
      const source = blockRequestsComplete ? RUNTIME_CONTROL_SOURCE.RUNTIME_CONTROL : legacySource;
      terminal = {
        requested: true,
        accepted: false,
        source,
        receipt: receipt({ op: RUNTIME_CONTROL_OPS.COMPLETE_MISSION }, RUNTIME_CONTROL_RECEIPT.STALE, mismatch, {
          source,
          effective: "TERMINAL"
        })
      };
      receipts.push(terminal.receipt);
    } else {
      const source = explicitComplete ? RUNTIME_CONTROL_SOURCE.RUNTIME_CONTROL : legacySource;
      const verdict = evaluateCompleteMission(explicitComplete || { index: -1 }, o, source);
      terminal = { requested: true, accepted: verdict.accepted, source, receipt: verdict.receipt };
      receipts.push(verdict.receipt);
    }
  }

  for (const action of actionable) {
    if (action.op === RUNTIME_CONTROL_OPS.COMPLETE_MISSION) continue;
    if (terminal?.accepted) {
      receipts.push(receipt(action, RUNTIME_CONTROL_RECEIPT.REJECTED, "SUPERSEDED_BY_TERMINAL"));
      continue;
    }
    if (terminal && !terminal.accepted) {
      receipts.push(receipt(action, RUNTIME_CONTROL_RECEIPT.REJECTED, "TERMINAL_REJECTED"));
      continue;
    }
    const handler = SLOT_HANDLERS.get(action.op);
    if (!handler) {
      receipts.push(receipt(action, RUNTIME_CONTROL_RECEIPT.INVALID, "UNKNOWN_OPERATION"));
      continue;
    }
    const outcome = handler(action, o);
    receipts.push(outcome.receipt);
    if (outcome.effect) effects.push(outcome.effect);
  }

  return { terminal, effects, receipts };
}

/**
 * Apply accepted slot effects to queue items. Only whitelisted fields of the
 * exact target slot are written; operator ceilings/edit markers are untouched.
 */
export function applyRuntimeControlEffects(items, effects, { now = Date.now() } = {}) {
  const rows = Array.isArray(items) ? items : [];
  const pending = (Array.isArray(effects) ? effects : []).filter((effect) => effect && effect.noop !== true);
  if (!pending.length) return rows;
  return rows.map((item) => {
    const mine = pending.filter((effect) => effect.itemId === item?.itemId);
    if (!mine.length) return item;
    const next = { ...item };
    for (const effect of mine) {
      if (effect.field === "maxInteractions" && Number.isInteger(effect.value) &&
          effect.value >= AI_QUANTUM_MIN && effect.value <= AI_QUANTUM_MAX) {
        next.maxInteractions = effect.value;
      } else if (effect.field === "priority" && AI_PRIORITY_VALUES.includes(effect.value)) {
        next.priority = effect.value;
      }
    }
    next.updatedAt = new Date(Number(now)).toISOString();
    return next;
  });
}

/**
 * Receipts are provisional until the queue write has read back. A failed write
 * turns every would-be APPLIED effect into REJECTED so no receipt claims an
 * effect that did not persist.
 */
export function settleRuntimeControlReceipts(receipts, { committed = true, errorCode = "" } = {}) {
  const rows = Array.isArray(receipts) ? receipts : [];
  if (committed) return rows;
  return rows.map((row) => row.status === RUNTIME_CONTROL_RECEIPT.APPLIED && row.effective !== "TERMINAL"
    ? { ...row, status: RUNTIME_CONTROL_RECEIPT.REJECTED, reason: `EFFECT_COMMIT_FAILED:${text(errorCode, 120)}` }
    : row);
}

/**
 * An accepted terminal is only effective once the DONE transition commits. When
 * a higher-precedence condition (e.g. a pending operator instruction) prevents
 * that commit, the carried receipts must say so instead of claiming APPLIED.
 */
export function withTerminalReceiptsRejected(state, reason) {
  if (!state || typeof state !== "object" || !Array.isArray(state.lastReceipts)) return state;
  return {
    ...state,
    lastReceipts: state.lastReceipts.map((row) => row.effective === "TERMINAL" &&
        [RUNTIME_CONTROL_RECEIPT.APPLIED, RUNTIME_CONTROL_RECEIPT.ALREADY_APPLIED].includes(row.status)
      ? { ...row, status: RUNTIME_CONTROL_RECEIPT.REJECTED, reason: text(reason, 200) }
      : row)
  };
}

export function nextRuntimeControlState(previous, receipts, { turn = 0, responseHash = "", now = Date.now() } = {}) {
  const prior = previous && typeof previous === "object" ? previous : {};
  const rows = (Array.isArray(receipts) ? receipts : []).slice(0, MAX_RECEIPTS).map((row) => ({
    op: text(row.op, 64),
    status: text(row.status, 32),
    reason: text(row.reason, 200),
    requested: row.requested ?? null,
    source: text(row.source, 64),
    effective: text(row.effective, 32),
    itemId: text(row.itemId, 200),
    turn: Number(turn) || 0,
    responseHash: text(responseHash, 16)
  }));
  const applied = (Array.isArray(receipts) ? receipts : [])
    .filter((row) => row.effectKey && [RUNTIME_CONTROL_RECEIPT.APPLIED, RUNTIME_CONTROL_RECEIPT.ALREADY_APPLIED].includes(row.status))
    .map((row) => String(row.effectKey));
  const ledger = [...(Array.isArray(prior.ledger) ? prior.ledger.map(String) : []), ...applied]
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(-MAX_LEDGER);
  return {
    schema: RUNTIME_CONTROL_STATE_SCHEMA,
    lastReceipts: rows,
    ledger,
    updatedAt: new Date(Number(now)).toISOString()
  };
}

/**
 * Per-prompt dynamic capsule: exact target, current slot values and the receipts
 * for the previous response. Always present in FULL and COMPACT prompts.
 */
export function runtimeControlPromptState(process) {
  const ctx = process?.queueContext?.itemId ? process.queueContext : null;
  const pending = ctx && Number.isInteger(Number(ctx.pendingMaxInteractions)) && Number(ctx.pendingMaxInteractions) > 0
    ? Number(ctx.pendingMaxInteractions)
    : null;
  const priority = ctx ? upper(ctx.priority) || "NORMAL" : null;
  const ceiling = ctx
    ? (priorityRank(upper(ctx.operatorPriority)) !== null ? upper(ctx.operatorPriority) : priority)
    : null;
  return {
    schema: RUNTIME_CONTROL_STATE_SCHEMA,
    field: RUNTIME_CONTROL_FIELD,
    available: true,
    target: runtimeControlTarget(process),
    operations: ctx
      ? [RUNTIME_CONTROL_OPS.COMPLETE_MISSION, RUNTIME_CONTROL_OPS.SET_QUANTUM, RUNTIME_CONTROL_OPS.SET_PRIORITY]
      : [RUNTIME_CONTROL_OPS.COMPLETE_MISSION],
    current: ctx ? {
      queueManaged: true,
      priority,
      priorityCeiling: ceiling,
      currentQuantumMaxInteractions: Number(ctx.maxInteractions) || null,
      nextQuantumMaxInteractions: pending ?? (Number(ctx.maxInteractions) || null)
    } : { queueManaged: false },
    lastReceipts: Array.isArray(process?.runtimeControl?.lastReceipts)
      ? process.runtimeControl.lastReceipts.slice(0, MAX_RECEIPTS)
      : []
  };
}

export const RUNTIME_CONTROL_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["target", "actions"],
  properties: {
    target: {
      type: "object",
      additionalProperties: false,
      required: [...TARGET_KEYS],
      properties: {
        runId: { type: "string", minLength: 1, maxLength: 200 },
        turn: { type: "integer", minimum: 0 },
        queueId: { type: "string", maxLength: 200 },
        itemId: { type: "string", maxLength: 200 },
        savedMissionId: { type: "string", maxLength: 200 }
      }
    },
    actions: {
      type: "array",
      minItems: 1,
      maxItems: RUNTIME_CONTROL_MAX_ACTIONS,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["op"],
            properties: {
              op: { const: RUNTIME_CONTROL_OPS.COMPLETE_MISSION },
              reason: { type: "string", maxLength: RUNTIME_CONTROL_REASON_MAX_CHARS }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["op", "maxInteractions"],
            properties: {
              op: { const: RUNTIME_CONTROL_OPS.SET_QUANTUM },
              maxInteractions: { type: "integer", minimum: AI_QUANTUM_MIN, maximum: AI_QUANTUM_MAX },
              reason: { type: "string", maxLength: RUNTIME_CONTROL_REASON_MAX_CHARS }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["op", "priority"],
            properties: {
              op: { const: RUNTIME_CONTROL_OPS.SET_PRIORITY },
              priority: { type: "string", enum: [...AI_PRIORITY_VALUES] },
              reason: { type: "string", maxLength: RUNTIME_CONTROL_REASON_MAX_CHARS }
            }
          }
        ]
      }
    }
  }
});

/** Response-field JSON schema; outside a queue only COMPLETE_MISSION exists. */
export function runtimeControlJsonSchema({ queueManaged = false } = {}) {
  const items = RUNTIME_CONTROL_JSON_SCHEMA.properties.actions.items.oneOf;
  return {
    ...RUNTIME_CONTROL_JSON_SCHEMA,
    properties: {
      ...RUNTIME_CONTROL_JSON_SCHEMA.properties,
      actions: {
        ...RUNTIME_CONTROL_JSON_SCHEMA.properties.actions,
        items: {
          oneOf: queueManaged
            ? [...items]
            : items.filter((item) => item.properties.op.const === RUNTIME_CONTROL_OPS.COMPLETE_MISSION)
        }
      }
    }
  };
}

/**
 * Static, English machine-control contract. Carried in every FULL prompt.
 */
export function runtimeControlContract({ queueManaged = false } = {}) {
  const operations = {
    COMPLETE_MISSION: queueManaged
      ? "Declare the current logical GFW finished. Requires status=DONE (or sessionAction=STOP_PROCESS) in the same response. Greenfield validates the target, commits the terminal state and retires EVERY queue slot of this logical mission (all slots sharing control.workQueue.savedMissionId; a slot without savedMissionId retires only itself). Slots of any other savedMissionId are never touched. Idempotent."
      : "Declare the current mission finished. Requires status=DONE (or sessionAction=STOP_PROCESS) in the same response. Greenfield validates the target and commits the terminal state. Idempotent."
  };
  if (queueManaged) {
    operations.SET_QUANTUM = `Set maxInteractions (integer ${AI_QUANTUM_MIN}..${AI_QUANTUM_MAX}) for THIS queue slot only (target.itemId). The current quantum is unchanged; the new value applies from this slot's next quantum or next activation. Unfinished progress is clamped to the new quantum. Values outside ${AI_QUANTUM_MIN}..${AI_QUANTUM_MAX} or non-integers are rejected, never clamped. To end the current quantum early, return sessionAction=YIELD_TO_QUEUE.`;
    operations.SET_PRIORITY = `Set THIS queue slot's priority to one of ${AI_PRIORITY_VALUES.join("|")}. It must not exceed control.runtimeControl.current.priorityCeiling (the operator-assigned priority of this slot); lowering and restoring up to that ceiling are allowed. Applies immediately and non-preemptively to the profile-global capacity scheduler; it never reorders the inner queue.`;
  }
  return {
    schema: RUNTIME_CONTROL_CONTRACT_SCHEMA,
    field: RUNTIME_CONTROL_FIELD,
    authority: "REQUEST_ONLY_GREENFIELD_VALIDATES_AND_OWNS_EFFECT",
    precedence: "operator runtime control > validated Greenfield owner state > AI runtime-control request",
    format: "Optional top-level response field runtimeControl = {\"target\": <copy of control.runtimeControl.target from THIS prompt, verbatim>, \"actions\": [{\"op\": \"...\", ...}]}. At most " +
      `${RUNTIME_CONTROL_MAX_ACTIONS} actions, each op at most once, no other fields. Optional per-action "reason" is audit text only and is never interpreted.`,
    target: "control.runtimeControl.target identifies the exact run, turn, queue, queue slot and saved mission of this prompt. Copy it unchanged. A target from an older prompt, another slot or another GFW is rejected as STALE and has no effect; if such a mismatching target accompanies status=DONE or STOP_PROCESS, the terminal effect is also rejected and the GFW is blocked instead of retired.",
    operations,
    constraints: {
      operations: Object.keys(operations),
      quantumMin: queueManaged ? AI_QUANTUM_MIN : null,
      quantumMax: queueManaged ? AI_QUANTUM_MAX : null,
      priorities: queueManaged ? [...AI_PRIORITY_VALUES] : [],
      priorityCeiling: queueManaged ? "control.runtimeControl.current.priorityCeiling" : null,
      maxActionsPerResponse: RUNTIME_CONTROL_MAX_ACTIONS,
      unknownOperation: "REJECTED_NO_EFFECT",
      malformedControl: "REJECTED_NO_EFFECT"
    },
    validation: "Every request may be accepted or rejected by Greenfield after validation. A rejected request never mutates state. Receipts (APPLIED, ALREADY_APPLIED, REJECTED, STALE, INVALID) for your previous response appear in control.runtimeControl.lastReceipts together with the current slot values in control.runtimeControl.current. Do not repeat a request that is already APPLIED or ALREADY_APPLIED; re-request a rejected control only after the cause has changed.",
    operatorPrecedence: "Operator queue edits, stops and instructions are authoritative. A priority/quantum request for a slot the operator edited after this prompt was issued is REJECTED (OPERATOR_PRECEDENCE). Runtime control never widens the mission's authority.",
    terminalSemantics: "status=DONE and sessionAction=STOP_PROCESS are terminal for the current logical GFW. Without runtimeControl they are normalized to COMPLETE_MISSION for this prompt's own target (backward compatible). With runtimeControl, include {\"op\":\"COMPLETE_MISSION\"} and the verbatim target. After an accepted terminal no further prompt is sent to this GFW, so persist durable mission state first (see control.workQueue.checkpointInstruction when queue-managed).",
    duplicateSlots: queueManaged
      ? "COMPLETE_MISSION retires all duplicate slots of the same savedMissionId. SET_QUANTUM and SET_PRIORITY change only the target slot; duplicate slots keep independent scheduling parameters."
      : "Not queue-managed.",
    structuredOnly: "Runtime effects come only from the structured runtimeControl field or the explicit terminal status/sessionAction. Prose in summary, evidence, blockers or nextSuggestedAction is never parsed as control; writing 'retire this mission' in prose has no effect.",
    example: queueManaged
      ? {
          status: "CONTINUE",
          runtimeControl: {
            target: "<control.runtimeControl.target copied verbatim>",
            actions: [
              { op: RUNTIME_CONTROL_OPS.SET_QUANTUM, maxInteractions: 8 },
              { op: RUNTIME_CONTROL_OPS.SET_PRIORITY, priority: "LOW" }
            ]
          }
        }
      : {
          status: "DONE",
          runtimeControl: {
            target: "<control.runtimeControl.target copied verbatim>",
            actions: [{ op: RUNTIME_CONTROL_OPS.COMPLETE_MISSION }]
          }
        }
  };
}

export const RUNTIME_CONTROL_COMPACT_REMINDER = "runtimeControl remains available exactly as defined in the most recent FULL prompt: copy control.runtimeControl.target verbatim, use only the listed operations, Greenfield validates every request and operator control wins. See control.runtimeControl.lastReceipts before repeating a request.";
