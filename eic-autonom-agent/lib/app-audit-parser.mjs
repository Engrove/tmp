import { sanitizeText } from "./common.mjs";
import { locateTargetTrailer, stripProtocolNoise } from "./prompt-contract.mjs";
import {
  APP_AUDIT_ADVISORY_GATES,
  APP_AUDIT_DATABASE_ROW_TYPES,
  APP_AUDIT_EVENT_MARKER,
  APP_AUDIT_EVENT_PROTOCOL,
  APP_AUDIT_GATES,
  APP_AUDIT_READBACK_STATES,
  APP_AUDIT_WEAK_SINK_STATES,
  isKnownFindingStatus,
  isKnownOutcome,
  isKnownPhase,
  statusTransitionAllowed
} from "./app-audit-contract.mjs";

/**
 * The target response reaches the addon as `innerText`, so markdown fences are already
 * gone by the time this runs. The event is therefore located by its marker line and the
 * first balanced JSON object that follows it, not by a code fence.
 *
 * Measured against `parseTargetResult`: an event block placed *before* the EIC-AA/5
 * trailer costs nothing — the trailer scanner reads the last 24 non-empty lines from the
 * end, so the 20-line noise margin is unchanged. Placed *after* the trailer it produces
 * PROTOCOL_AMBIGUOUS. That asymmetry is a hard requirement, not a style preference, and
 * `auditEventPlacement()` below reports it.
 */
/**
 * The marker must own its own line.
 *
 * A substring search is not enough: the event's own `"protocol": "EIC_APP_AUDIT_EVENT/1"`
 * field contains the marker text, so a loose match finds the protocol line, counts two
 * markers and then searches for the object *after* the opening brace — which yields the
 * nested `database_receipt` or nothing at all. The marker line is anchored instead, with
 * an optional HTML-comment wrapper for responses that survived as raw markdown.
 */
function markerLines(source) {
  const pattern = new RegExp(`^[ \\t]*(?:<!--[ \\t]*)?${APP_AUDIT_EVENT_MARKER}[ \\t]*(?:-->)?[ \\t]*$`, "gm");
  return [...source.matchAll(pattern)];
}

export function extractAuditEventBlock(text) {
  const source = String(text || "");
  const markers = markerLines(source);
  if (!markers.length) return { found: false, raw: "", markerCount: 0, markerIndex: -1 };
  const first = markers[0];
  const from = first.index + first[0].length;
  const raw = extractFirstBalancedObject(source.slice(from));
  return {
    found: Boolean(raw),
    raw,
    markerCount: markers.length,
    markerIndex: first.index
  };
}

function extractFirstBalancedObject(text) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

/**
 * Reports whether the event sits where the trailer parser can still see the trailer.
 * The addon cannot repair a badly placed block, but it can name the exact defect instead
 * of surfacing a generic PROTOCOL_AMBIGUOUS.
 */
export function auditEventPlacement(text) {
  const source = stripProtocolNoise(text);
  const markers = markerLines(source);
  if (!markers.length) return "ABSENT";
  const trailer = locateTargetTrailer(source);
  if (!trailer.valid || !trailer.block?.length) return "NO_TRAILER";
  const trailerLine = trailer.block[0];
  const sourceLines = source.split("\n");
  let trailerIndex = 0;
  for (let index = 0; index < trailerLine.sourceLineIndex; index += 1) {
    trailerIndex += sourceLines[index].length + 1;
  }
  return markers[0].index < trailerIndex ? "BEFORE_TRAILER" : "AFTER_TRAILER";
}

export function parseAuditEvent(text) {
  const block = extractAuditEventBlock(text);
  if (!block.found) {
    return { valid: false, reason: APP_AUDIT_GATES.EVENT_MISSING, event: null, block };
  }
  let parsed;
  try {
    parsed = JSON.parse(block.raw);
  } catch {
    return { valid: false, reason: APP_AUDIT_GATES.EVENT_MALFORMED, event: null, block };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, reason: APP_AUDIT_GATES.EVENT_MALFORMED, event: null, block };
  }
  return { valid: true, reason: "", event: normalizeAuditEvent(parsed), block };
}

export function normalizeAuditEvent(value = {}) {
  const receipt = value.database_receipt && typeof value.database_receipt === "object"
    ? value.database_receipt
    : null;
  const owner = value.owner_receipt && typeof value.owner_receipt === "object"
    ? value.owner_receipt
    : null;
  return {
    protocol: sanitizeText(value.protocol, 80),
    runId: sanitizeText(value.run_id, 120),
    turnId: sanitizeText(value.turn_id, 120),
    stepNo: Number.isSafeInteger(value.step_no) ? value.step_no : null,
    phase: sanitizeText(value.phase, 40).toUpperCase(),
    outcome: sanitizeText(value.outcome, 40).toUpperCase(),
    findingId: sanitizeText(value.finding_id, 120),
    findingStatus: sanitizeText(value.finding_status, 40).toUpperCase(),
    fingerprint: sanitizeText(value.fingerprint, 128),
    severity: sanitizeText(value.severity, 40).toUpperCase(),
    majorCandidate: value.major_candidate === true,
    reproductionRecorded: value.reproduction_recorded === true,
    coverageCell: sanitizeText(value.coverage_cell, 200),
    databaseReceipt: receipt ? {
      relativePath: sanitizeText(receipt.relative_path, 400),
      rowType: sanitizeText(receipt.row_type, 40).toLowerCase(),
      rowId: sanitizeText(receipt.row_id, 120)
    } : null,
    ownerReceipt: owner ? {
      sinkType: sanitizeText(owner.sink_type, 60).toUpperCase(),
      target: sanitizeText(owner.target, 300),
      operation: sanitizeText(owner.operation, 80),
      resultState: sanitizeText(owner.result_state, 60).toUpperCase(),
      readbackLocator: sanitizeText(owner.owner_readback_locator, 400),
      bundleSha256: sanitizeText(owner.bundle_sha256, 64).toLowerCase()
    } : null,
    nextMicroStep: sanitizeText(value.next_micro_step, 1200)
  };
}

const SECRET_SHAPED = [
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /\b(?:sk|rk)-[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{8,}/i
];

export function containsSecretShapedValue(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return SECRET_SHAPED.some((pattern) => pattern.test(text));
}

/**
 * Applies every gate the addon can decide on its own.
 *
 * `auditState` is the addon's durable record of what previous turns claimed. The gates
 * compare the new event against that record; they never compare it against the world.
 * A pass therefore means "this claim is internally consistent and well-ordered", never
 * "this happened".
 */
export function evaluateAuditEvent(event, {
  auditState = {},
  expectedRunId = "",
  expectedTurnId = "",
  placement = "BEFORE_TRAILER",
  markerCount = 1
} = {}) {
  const errors = [];
  const advisories = [];
  const push = (code) => {
    if (APP_AUDIT_ADVISORY_GATES.includes(code)) advisories.push(code);
    else errors.push(code);
  };

  if (markerCount > 1) push(APP_AUDIT_GATES.EVENT_DUPLICATE_MARKER);
  // Placement is gated, not hoped for. A block after the trailer is only *sometimes*
  // fatal to `parseTargetResult`: the trailer scanner reads the last 24 non-empty lines
  // and `stripCodeAndQuotes` removes 4-space-indented lines, so a 22-line event with
  // 2-space JSON indent collapses to 19 and the trailer survives with one line to spare.
  // One extra field flips it. Depending on that margin would be depending on luck, so the
  // addon refuses the placement outright and names it.
  if (placement === "AFTER_TRAILER") push(APP_AUDIT_GATES.EVENT_AFTER_TRAILER);
  if (event.protocol !== APP_AUDIT_EVENT_PROTOCOL) push(APP_AUDIT_GATES.PROTOCOL_MISMATCH);
  if (!event.runId) push(APP_AUDIT_GATES.RUN_ID_MISSING);
  if (!event.turnId) push(APP_AUDIT_GATES.TURN_ID_MISSING);
  if (expectedRunId && event.runId && event.runId !== expectedRunId) push(APP_AUDIT_GATES.RUN_ID_MISMATCH);
  if (expectedTurnId && event.turnId && event.turnId !== expectedTurnId) push(APP_AUDIT_GATES.TURN_ID_MISMATCH);
  if (!Number.isSafeInteger(event.stepNo) || event.stepNo < 1) push(APP_AUDIT_GATES.STEP_INVALID);

  // Gate 1: monotonic step numbering. This is the addon's only self-owned progress
  // signal, so a repeat or a step backwards is a protocol violation, not stagnation.
  const lastStep = Number(auditState.lastStepNo || 0);
  if (Number.isSafeInteger(event.stepNo) && event.stepNo <= lastStep) {
    push(APP_AUDIT_GATES.STEP_NOT_MONOTONIC);
  }

  if (!isKnownPhase(event.phase)) push(APP_AUDIT_GATES.PHASE_UNKNOWN);
  if (!isKnownOutcome(event.outcome)) push(APP_AUDIT_GATES.OUTCOME_UNKNOWN);

  if (event.findingStatus && !isKnownFindingStatus(event.findingStatus)) {
    push(APP_AUDIT_GATES.FINDING_STATUS_UNKNOWN);
  }

  const findingFieldsPresent = Boolean(
    event.findingId || event.findingStatus || event.fingerprint ||
    event.severity || event.majorCandidate || event.reproductionRecorded
  );
  if (findingFieldsPresent && (!event.findingId || !event.findingStatus)) {
    push(APP_AUDIT_GATES.FINDING_FIELDS_INCOMPLETE);
  }
  if ((event.findingId && !event.fingerprint) ||
      (event.fingerprint && !/^[0-9a-f]{64}$/.test(event.fingerprint))) {
    push(APP_AUDIT_GATES.FINGERPRINT_INVALID);
  }

  const known = event.findingId ? (auditState.findings || {})[event.findingId] : null;
  if (event.findingId && event.findingStatus && isKnownFindingStatus(event.findingStatus)) {
    if (!statusTransitionAllowed(known?.status || "", event.findingStatus)) {
      push(APP_AUDIT_GATES.FINDING_STATUS_ILLEGAL_TRANSITION);
    }
  }
  if (event.findingId && event.fingerprint && known?.fingerprint &&
      known.fingerprint !== event.fingerprint) {
    push(APP_AUDIT_GATES.FINDING_ID_FINGERPRINT_CONFLICT);
  }

  // Gate 2: reproduction is a recorded step, not a ledger finding status.
  if (event.reproductionRecorded) {
    const validReproduction = Boolean(known) &&
      event.phase === "REPRODUCTION" &&
      event.findingStatus === "REPRODUCTION_REQUIRED" &&
      event.databaseReceipt?.rowType === "step" &&
      Boolean(event.databaseReceipt?.rowId);
    if (!validReproduction) push(APP_AUDIT_GATES.REPRODUCTION_EVIDENCE_INVALID);
  }
  if (event.findingStatus === "ACCEPTED_FINDING" && !known?.reproducedAtTurn) {
    push(APP_AUDIT_GATES.MAJOR_WITHOUT_REVIEW);
  }

  // Gate 3: persistence needs the exact receipt shape expected by the passive ledger.
  if (event.findingStatus === "PERSISTED") {
    const ownerReceipt = event.ownerReceipt;
    if (!ownerReceipt) {
      push(APP_AUDIT_GATES.PERSISTED_WITHOUT_RECEIPT);
    } else {
      if (!APP_AUDIT_READBACK_STATES.includes(ownerReceipt.resultState) ||
          APP_AUDIT_WEAK_SINK_STATES.includes(ownerReceipt.resultState)) {
        push(APP_AUDIT_GATES.RECEIPT_WEAK_STATE);
      }
      if (ownerReceipt.sinkType === "ZIP_BUNDLE") {
        if (!/^[0-9a-f]{64}$/.test(ownerReceipt.bundleSha256 || "")) {
          push(APP_AUDIT_GATES.ZIP_BUNDLE_HASH_MISSING);
        }
      } else if (!ownerReceipt.readbackLocator) {
        push(APP_AUDIT_GATES.PERSISTED_WITHOUT_RECEIPT);
      }
    }
    // Gate 4, the two-turn ordering rule. It limits same-response fabrication but is not
    // owner evidence and is never described as readback verification.
    if (known && known.acceptedAtTurn && known.acceptedAtTurn === event.turnId) {
      push(APP_AUDIT_GATES.READBACK_SAME_TURN);
    }
  }

  // Gate 5: a step or finding row must name where it was written.
  const writesRow = ["PASS", "ANOMALY", "FINDING_CANDIDATE", "INCONCLUSIVE"].includes(event.outcome);
  if (writesRow && (!event.databaseReceipt || !event.databaseReceipt.rowId)) {
    push(APP_AUDIT_GATES.DATABASE_RECEIPT_MISSING);
  }
  const relativePath = event.databaseReceipt?.relativePath || "";
  if (relativePath && (relativePath.startsWith("/") || relativePath.includes("..") || /^[A-Za-z]:[\\/]/.test(relativePath))) {
    push(APP_AUDIT_GATES.DATABASE_PATH_ESCAPE);
  }
  const expectedDatabasePath = event.runId
    ? `analysis/eic-app-audit/${event.runId}/findings.sqlite3`
    : "";
  if (relativePath && expectedDatabasePath && relativePath !== expectedDatabasePath) {
    push(APP_AUDIT_GATES.DATABASE_PATH_MISMATCH);
  }
  if (event.databaseReceipt?.rowType &&
      !APP_AUDIT_DATABASE_ROW_TYPES.includes(event.databaseReceipt.rowType)) {
    push(APP_AUDIT_GATES.DATABASE_ROW_TYPE_INVALID);
  }
  const expectedFindingRowType = event.reproductionRecorded
    ? "step"
    : ["OBSERVED", "REPRODUCTION_REQUIRED"].includes(event.findingStatus)
      ? "finding"
      : event.findingStatus === "ACCEPTED_FINDING"
        ? "review"
        : event.findingStatus === "PERSISTED"
          ? "sink_receipt"
          : "";
  if (expectedFindingRowType && event.databaseReceipt?.rowType &&
      event.databaseReceipt.rowType !== expectedFindingRowType) {
    push(APP_AUDIT_GATES.DATABASE_ROW_TYPE_MISMATCH);
  }

  // Secret-shaped content is blocking because accepted events are persisted to
  // chrome.storage.local. An advisory would still retain the suspected secret.
  if (containsSecretShapedValue(event)) push(APP_AUDIT_GATES.SECRET_SHAPED_VALUE);

  if (event.outcome === "DONE" && !auditState.exportClaimed &&
      !(auditState.sinkReceipts || []).length) {
    push(APP_AUDIT_GATES.DONE_WITHOUT_EXPORT_OR_SINK);
  }
  if (event.outcome !== "DONE" && event.outcome !== "BLOCKED" && !event.nextMicroStep) {
    push(APP_AUDIT_GATES.NEXT_STEP_MISSING);
  }

  return {
    valid: errors.length === 0,
    errors,
    advisories,
    placement,
    progress: computeAuditProgress(event, auditState)
  };
}

/**
 * Progress for an audit run is not `progressDelta` from the model.
 *
 * A systematic audit deliberately produces near-identical action keys: same work unit,
 * similar action, and a model that reasonably reports zero delta when a test simply
 * passes. Under the generic anti-loop rules that reads as stagnation — five cycles to
 * REDUCE_SCOPE, eight to NO_PROGRESS_BUDGET_EXHAUSTED — which is exactly the failure
 * mode observed in the field on 2026-08-02. Audit progress is instead derived from the
 * two things the addon can check itself: a new step number and a new coverage cell.
 */
export function computeAuditProgress(event, auditState = {}) {
  const lastStep = Number(auditState.lastStepNo || 0);
  const stepAdvanced = Number.isFinite(event.stepNo) && event.stepNo !== null && event.stepNo > lastStep;
  const cells = Array.isArray(auditState.coverageCells) ? auditState.coverageCells : [];
  const cell = String(event.coverageCell || "").trim().toLowerCase();
  const newCoverage = Boolean(cell) && !cells.includes(cell);
  const findingAdvanced = event.reproductionRecorded === true ||
    ["ACCEPTED_FINDING", "PERSISTED"].includes(event.findingStatus);
  const delta = (stepAdvanced ? 1 : 0) + (newCoverage ? 1 : 0) + (findingAdvanced ? 1 : 0);
  return {
    stepAdvanced,
    newCoverage,
    findingAdvanced,
    delta: Math.min(3, delta),
    productive: delta > 0
  };
}

/**
 * Folds an accepted event into the durable audit state. Everything written here is a
 * target claim; the field names say so where it matters.
 */
export function applyAuditEvent(auditState, event, { turnId = "", at = "" } = {}) {
  const next = {
    ...auditState,
    findings: { ...(auditState.findings || {}) },
    coverageCells: [...(auditState.coverageCells || [])],
    sinkReceipts: [...(auditState.sinkReceipts || [])]
  };
  if (Number.isFinite(event.stepNo) && event.stepNo !== null && event.stepNo > Number(next.lastStepNo || 0)) {
    next.lastStepNo = event.stepNo;
    next.stepCount = Number(next.stepCount || 0) + 1;
  }
  if (isKnownPhase(event.phase)) next.phase = event.phase;
  const cell = String(event.coverageCell || "").trim().toLowerCase();
  if (cell && !next.coverageCells.includes(cell)) next.coverageCells.push(cell);

  if (event.findingId) {
    const previous = next.findings[event.findingId] || {};
    next.findings[event.findingId] = {
      ...previous,
      findingId: event.findingId,
      fingerprint: event.fingerprint || previous.fingerprint || "",
      status: event.findingStatus || previous.status || "",
      severity: event.severity || previous.severity || "",
      provenance: "target-session-claim",
      firstSeenAtTurn: previous.firstSeenAtTurn || turnId,
      reproducedAtTurn: event.reproductionRecorded
        ? (previous.reproducedAtTurn || turnId)
        : previous.reproducedAtTurn || "",
      acceptedAtTurn: event.findingStatus === "ACCEPTED_FINDING"
        ? (previous.acceptedAtTurn || turnId)
        : previous.acceptedAtTurn || "",
      lastSeenAt: at || previous.lastSeenAt || ""
    };
  }
  if (event.ownerReceipt?.readbackLocator || event.ownerReceipt?.bundleSha256) {
    next.sinkReceipts = [
      ...next.sinkReceipts,
      {
        findingId: event.findingId,
        sinkType: event.ownerReceipt.sinkType,
        target: event.ownerReceipt.target,
        resultState: event.ownerReceipt.resultState,
        readbackLocator: event.ownerReceipt.readbackLocator,
        bundleSha256: event.ownerReceipt.bundleSha256,
        provenance: "target-session-claim",
        turnId,
        at
      }
    ].slice(-50);
  }
  if (event.ownerReceipt?.sinkType === "ZIP_BUNDLE" &&
      event.ownerReceipt?.resultState === "READBACK_VERIFIED" &&
      /^[0-9a-f]{64}$/.test(event.ownerReceipt?.bundleSha256 || "")) {
    next.exportClaimed = true;
  }
  next.lastEventAt = at || next.lastEventAt || "";
  return next;
}

/**
 * Removes the event block from the observation text before it is budgeted for Nano.
 *
 * The block is machine-readable by construction, so shipping it to the model as prose is
 * pure waste: field observations already run 8 900 characters against a 16 239 character
 * budget, and the first thing compaction drops is the continuity projection that carries
 * the anti-loop correction. The structured summary that replaces it is roughly a tenth
 * of the size.
 */
export function stripAuditEventFromText(text) {
  const source = String(text || "");
  const markers = markerLines(source);
  if (!markers.length) return { text: source, removedChars: 0, malformed: false };
  const marker = markers[0];
  const block = extractAuditEventBlock(source);
  let blockEnd = -1;
  let malformed = false;
  if (block.found) {
    const blockStart = source.indexOf(block.raw, marker.index);
    if (blockStart < 0) return { text: source, removedChars: 0, malformed: false };
    blockEnd = blockStart + block.raw.length;
  } else {
    // A malformed event must not consume Nano's observation budget forever. Remove only
    // the protocol region: from the marker through the next real trailer line, or to EOF
    // when the malformed block was incorrectly placed after the trailer.
    malformed = true;
    const fromMarker = source.slice(marker.index + marker[0].length);
    const trailerOffset = fromMarker.search(/^EIC_TURN:\s*.+$/mi);
    blockEnd = trailerOffset >= 0
      ? marker.index + marker[0].length + trailerOffset
      : source.length;
  }
  const stripped = `${source.slice(0, marker.index)}${source.slice(blockEnd)}`
    .replace(/\n{3,}/g, "\n\n");
  return {
    text: stripped,
    removedChars: source.length - stripped.length,
    malformed
  };
}

export function summarizeAuditEventForNano(event, gate) {
  if (!event) return "";
  return [
    `AUDIT step=${event.stepNo ?? "?"} phase=${event.phase || "?"} outcome=${event.outcome || "?"}`,
    event.coverageCell ? `coverage=${event.coverageCell}` : "",
    event.findingId ? `finding=${event.findingId}:${event.findingStatus || "?"}` : "",
    (event.ownerReceipt?.readbackLocator || event.ownerReceipt?.bundleSha256)
      ? "sink=target-session-claim" : "",
    gate?.errors?.length ? `gate=${gate.errors.join(",")}` : "gate=PASS"
  ].filter(Boolean).join(" · ");
}
