import {
  boundedArray, clampInteger, deepClone, normalizeWhitespace,
  nowIso, nullableInteger, randomId, sanitizeText, sha256Hex, stableStringify, utf8Bytes
} from "./common.mjs";
import { CONTINUITY_SCHEMA } from "./contracts.mjs";
import { isMetaOnlyAction } from "./decision-grounding.mjs";
import {
  baselineRoutingSummary,
  createEmptyMainTaskTrack,
  normalizeMainTaskBaseline,
  normalizeTrackControl
} from "./main-task-guard.mjs";
import {
  assertDistinctClaimsAndInferences,
  assertTaskBindingTransition,
  stableFingerprint
} from "./task-integrity.mjs";

const MAX_BYTES = 32_000;
const HARD_FACT_BYTES = 10_000;
const HARD_BLOCKER_BYTES = 6_000;
// v0.6.4: durable continuity must stay compact enough to survive many prompts on a
// small local context window. Compaction is therefore semantic (dedupe + age) and
// runs on every decision, not only above the byte ceiling.
const SEMANTIC_RETAIN_TURNS = 8;
const SEMANTIC_KEEP_MIN = 4;
const BLOCKER_SILENT_TURNS = 6;
const PROJECTION_MIN_ITEMS = 2;

function itemText(item) {
  return JSON.stringify(item);
}

function uniqueById(items, maxItems) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }
  return result.slice(-maxItems);
}

export function createContinuity({
  intent = "",
  workUnit = "",
  scopeWindowId = null,
  scopeRunId = "",
  now = Date.now()
} = {}) {
  return {
    schema: CONTINUITY_SCHEMA,
    version: 5,
    compactionGeneration: 0,
    updatedAt: nowIso(now),
    scope: {
      kind: "WINDOW_RUN",
      windowId: scopeWindowId !== null && scopeWindowId !== undefined && scopeWindowId !== "" &&
        nullableInteger(scopeWindowId) !== null && Number(scopeWindowId) >= 0
        ? Number(scopeWindowId)
        : null,
      runId: sanitizeText(scopeRunId, 180),
      conversationKey: ""
    },
    intent: {
      text: sanitizeText(intent, 6000),
      setBy: intent ? "operator" : "unset",
      at: nowIso(now)
    },
    activeTaskBinding: null,
    mainTaskBaseline: null,
    trackControl: createEmptyMainTaskTrack(),
    transition: {
      lastProgressDelta: 0,
      blockerFingerprint: "",
      nextDirection: "",
      updatedAt: nowIso(now)
    },
    position: {
      phase: "initial",
      workUnit: sanitizeText(workUnit, 2400),
      workUnitId: workUnit ? randomId("wu") : "",
      workUnitSource: workUnit ? "operator" : "",
      updatedAt: nowIso(now),
      turnIndex: 0,
      conversationKey: "",
      taskFingerprint: ""
    },
    verifiedFacts: [],
    constraints: [],
    targetClaims: [],
    inferences: [],
    decisions: [],
    attempts: [],
    failures: [],
    blockers: [],
    nextDirections: [],
    evidenceRequirements: [],
    antiLoop: {
      progressDeltas: [],
      actionKeys: [],
      auditActionCount: 0,
      productiveActionCount: 0,
      concreteActionCount: 0,
      lastActionClass: "UNKNOWN",
      stagnationCycles: 0,
      lastCorrection: null
    },
    compaction: {
      sourceDigest: "",
      removedItems: 0,
      mergedItems: 0,
      expiredBlockers: 0,
      lastAt: null
    },
    integrity: null
  };
}

export function normalizeContinuity(value) {
  // Canonical normalization must be deterministic. Creation boundaries own wall-clock stamps.
  const base = createContinuity({ now: 0 });
  if (!value || typeof value !== "object") return base;
  const mainTaskBaseline = normalizeMainTaskBaseline(value.mainTaskBaseline);
  const result = {
    ...base,
    ...deepClone(value),
    schema: CONTINUITY_SCHEMA,
    version: 5,
    activeTaskBinding: value.activeTaskBinding ? deepClone(value.activeTaskBinding) : null,
    mainTaskBaseline,
    trackControl: normalizeTrackControl({
      ...(value.trackControl || {}),
      baselinePresent: Boolean(mainTaskBaseline)
    }, {
      baselinePresent: Boolean(mainTaskBaseline),
      updatedAt: value.trackControl?.updatedAt ?? null
    }),
    transition: { ...base.transition, ...(value.transition || {}) },
    scope: { ...base.scope, ...(value.scope || {}) },
    intent: { ...base.intent, ...(value.intent || {}) },
    position: { ...base.position, ...(value.position || {}) },
    antiLoop: { ...base.antiLoop, ...(value.antiLoop || {}) },
    compaction: { ...base.compaction, ...(value.compaction || {}) }
  };
  result.verifiedFacts = uniqueById(value.verifiedFacts, 40);
  result.constraints = uniqueById(value.constraints, 30);
  result.targetClaims = uniqueById(value.targetClaims, 30);
  result.inferences = uniqueById(value.inferences, 30);
  result.decisions = uniqueById(value.decisions, 24);
  result.attempts = uniqueById(value.attempts, 30);
  result.failures = uniqueById(value.failures, 20);
  result.blockers = uniqueById(value.blockers, 20);
  result.nextDirections = uniqueById(value.nextDirections, 12);
  result.evidenceRequirements = uniqueById(value.evidenceRequirements, 16);
  result.antiLoop.progressDeltas = boundedArray(value.antiLoop?.progressDeltas, 8)
    .map((entry) => clampInteger(entry, 0, 3, 0));
  result.antiLoop.actionKeys = boundedArray(value.antiLoop?.actionKeys, 8)
    .map((entry) => sanitizeText(entry, 240));
  return result;
}

function boundedItem(kind, input, turnIndex, now) {
  const source = typeof input === "string" ? { text: input } : (input || {});
  input = source;
  const base = {
    id: input?.id || randomId(kind),
    turn: clampInteger(turnIndex, 0, Number.MAX_SAFE_INTEGER, 0),
    at: nowIso(now)
  };
  switch (kind) {
    case "fact":
      return {
        ...base,
        claim: sanitizeText(input?.claim ?? input?.text, 1600),
        status: "VERIFIED",
        provenance: sanitizeText(input?.provenance ?? "operator-or-local-evidence", 800)
      };
    case "constraint":
      return {
        ...base,
        text: sanitizeText(input?.text ?? input?.claim, 1600),
        status: "OPERATOR_CONSTRAINT",
        provenance: sanitizeText(input?.provenance ?? "start-prompt-analysis", 800)
      };
    case "target":
      return {
        ...base,
        claim: sanitizeText(input?.claim ?? input?.text, 1600),
        status: "CLAIMED_BY_TARGET",
        provenance: sanitizeText(input?.provenance ?? "target-session-response", 800)
      };
    case "inference":
      return {
        ...base,
        claim: sanitizeText(input?.claim ?? input?.text, 1600),
        confidence: ["low", "medium", "high"].includes(input?.confidence) ? input.confidence : "medium",
        provenance: sanitizeText(input?.provenance ?? "nano-analysis", 800)
      };
    case "decision":
      return {
        ...base,
        choice: sanitizeText(input?.choice ?? input?.text, 1600),
        because: sanitizeText(input?.because, 1000)
      };
    case "attempt":
      return {
        ...base,
        action: sanitizeText(input?.action ?? input?.text, 1600),
        outcome: sanitizeText(input?.outcome ?? "unknown", 300),
        reason: sanitizeText(input?.reason, 1000)
      };
    case "failure":
      return {
        ...base,
        action: sanitizeText(input?.action ?? input?.text, 1200),
        reason: sanitizeText(input?.reason, 1200),
        fingerprint: sanitizeText(input?.fingerprint, 300)
      };
    case "blocker":
      return {
        ...base,
        statement: sanitizeText(input?.statement ?? input?.text, 1600),
        kind: sanitizeText(input?.kind ?? "UNKNOWN", 160),
        unlockedBy: sanitizeText(input?.unlockedBy, 1000),
        open: input?.open !== false,
        assertedTurn: clampInteger(input?.assertedTurn ?? turnIndex, 0, Number.MAX_SAFE_INTEGER, 0),
        lastAssertedTurn: clampInteger(input?.lastAssertedTurn ?? turnIndex, 0, Number.MAX_SAFE_INTEGER, 0),
        closedReason: sanitizeText(input?.closedReason, 200)
      };
    case "direction":
      return {
        ...base,
        text: sanitizeText(input?.text, 1600),
        derivedFrom: Array.isArray(input?.derivedFrom) ? input.derivedFrom.slice(0, 8) : []
      };
    default:
      throw new TypeError(`Okänd continuity item-typ: ${kind}`);
  }
}

/**
 * A repeated blocker statement is a re-assertion, not a duplicate. v0.6.3 dropped it
 * silently, so `lastAssertedTurn` never moved and an open blocker could never be
 * distinguished from a stale one. Re-assertion refreshes the record in place.
 */
function upsertBlocker(items, item, turnIndex) {
  const normalized = normalizeWhitespace(item.statement || "").toLowerCase();
  if (!normalized) return items;
  const existingIndex = items.findIndex(
    (entry) => normalizeWhitespace(entry.statement || "").toLowerCase() === normalized
  );
  if (existingIndex < 0) return [...items, item];
  const existing = items[existingIndex];
  const next = [...items];
  next[existingIndex] = {
    ...existing,
    lastAssertedTurn: clampInteger(turnIndex, 0, Number.MAX_SAFE_INTEGER, existing.lastAssertedTurn || 0),
    unlockedBy: sanitizeText(item.unlockedBy || existing.unlockedBy, 1000),
    kind: sanitizeText(item.kind !== "UNKNOWN" ? item.kind : existing.kind, 160),
    open: true,
    closedReason: ""
  };
  return next;
}

/**
 * Marks blockers that have not been re-asserted for `maxSilentTurns` turns as no
 * longer open. This is explicitly NOT a resolution claim: `closedReason` records
 * that the blocker simply stopped being asserted, so an operator can tell the
 * difference between "unlocked" and "went silent".
 */
export function expireStaleBlockers(continuityValue, {
  turnIndex = 0,
  maxSilentTurns = BLOCKER_SILENT_TURNS,
  now = Date.now()
} = {}) {
  const continuity = continuityValue && typeof continuityValue === "object"
    ? continuityValue
    : normalizeContinuity(continuityValue);
  const currentTurn = clampInteger(turnIndex, 0, Number.MAX_SAFE_INTEGER, 0);
  const silentLimit = Math.max(1, clampInteger(maxSilentTurns, 1, 1000, BLOCKER_SILENT_TURNS));
  let expired = 0;
  continuity.blockers = (continuity.blockers || []).map((blocker) => {
    if (blocker?.open === false) return blocker;
    const lastAsserted = clampInteger(
      blocker?.lastAssertedTurn ?? blocker?.assertedTurn ?? blocker?.turn,
      0,
      Number.MAX_SAFE_INTEGER,
      0
    );
    if (currentTurn - lastAsserted < silentLimit) return blocker;
    expired += 1;
    return {
      ...blocker,
      open: false,
      closedReason: `STALE_NO_REASSERTION_AFTER_${silentLimit}_TURNS`,
      closedAt: nowIso(now)
    };
  });
  return { continuity, expired };
}

function addUnique(items, item, key) {
  const normalized = normalizeWhitespace(item[key] || "").toLowerCase();
  if (!normalized) return items;
  if (items.some((existing) => normalizeWhitespace(existing[key] || "").toLowerCase() === normalized)) {
    return items;
  }
  return [...items, item];
}

/**
 * Action keys are composed as `workUnit|requestedAction`. v0.6.3 classified the
 * whole composite string, so a work unit containing the word "verify" made every
 * turn count as an audit action forever: productiveActionCount could never leave
 * zero and auditRatio was pinned at 1.0. Only the action segment may be classified.
 */
export function actionSegmentFromKey(actionKey) {
  const raw = String(actionKey ?? "");
  if (!raw) return "";
  const parts = raw.split("|");
  const last = sanitizeText(parts[parts.length - 1], 500);
  return last || sanitizeText(raw, 500);
}

function isAuditAction(actionKey) {
  const segment = actionSegmentFromKey(actionKey);
  return Boolean(segment) && isMetaOnlyAction(segment);
}

export function classifyActionKey(actionKey) {
  const segment = actionSegmentFromKey(actionKey);
  if (!segment) return "UNKNOWN";
  return isMetaOnlyAction(segment) ? "META" : "CONCRETE";
}

export function classifyActionSubsystem(actionKey) {
  const segment = normalizeWhitespace(actionSegmentFromKey(actionKey)).toLowerCase();
  if (!segment) return "UNKNOWN";
  const families = [
    ["WORKSPACE", [
      /\bworkspace\b/, /\bwork[- ]?package\b/, /\btwin\.entry\b/,
      /package[- ]?revision/, /source[- ]?binding/, /evidence\.bind/
    ]],
    ["HJALMAR", [/\bhjalmar\b/, /strict[_ -]?audit/, /controller_used/]],
    ["ARTIFACT", [/\bartifact\b/, /manifest[- ]?sha/, /patch[- ]?sha/]],
    ["TEST", [
      /\bnpm test\b/, /\bnode --test\b/, /\bpytest\b/, /\bpydantic\b/,
      /near[- ]?regression/, /\bfull core\b/, /\bfocused\b/
    ]],
    ["REPOSITORY", [/\bforgejo\b/, /\bgit\b/, /\brepository\b/, /\bcommit\b/, /\bpull request\b/]],
    ["RUNTIME", [/\bruntime\b/, /\bdeploy/, /\bchrome\b/, /\bservice worker\b/]],
    ["NANO", [/\bnano\b/, /language model/, /modellhost/]],
    ["OWNER_READ", [
      /owner[- ]?(?:read|läs)/, /owner-state/, /readback/, /statusread/,
      /\bkvitto\b/, /\breceipt\b/
    ]]
  ];
  for (const [family, patterns] of families) {
    if (patterns.some((pattern) => pattern.test(segment))) return family;
  }
  return isMetaOnlyAction(segment) ? "META" : "OTHER";
}

const NO_PROGRESS_PIVOT_INSTRUCTIONS = Object.freeze({
  WORKSPACE: "Exkludera Workspace, work-package, twin-handoff och package-bindning under nästa recoverycykel. Använd en oberoende lokal källväg eller direkt ägarrutt och producera exakt en konkret arbetsprodukt: patch/diff, körbar testlogg eller exakt blockerarkvitto. Återgå inte till Workspace förrän ny evidens finns.",
  HJALMAR: "Exkludera Hjalmar och ytterligare kontroll-/auditvarv under nästa recoverycykel. Utför den minsta direkta implementationen eller det fokuserade test som kan ändra leveransen och återinför kontroll först efter en faktisk diff eller ett nytt testresultat.",
  ARTIFACT: "Exkludera artifact-bindning och checksumskedjor under nästa recoverycykel. Arbeta direkt mot den verifierade källan och producera en patch eller ett fokuserat testresultat innan artifactflödet återupptas.",
  TEST: "Exkludera den aktuella testmiljön under nästa recoverycykel. Gör först den minsta källändringen eller använd en tekniskt oberoende testväg; kör inte samma testfamilj igen utan ändrad kod eller ny miljöevidens.",
  OWNER_READ: "Exkludera ytterligare generella owner-read/statusread under nästa recoverycykel. Använd redan lästa locators för att skapa den minsta konkreta leveransen, eller ange den enda exakta saknade ägarfaktan och dess unlock-händelse.",
  REPOSITORY: "Exkludera repository-/Git-vägen under nästa recoverycykel. Producera en lokal, hashbunden patch och fokuserad testlogg; återgå till repo först när kandidatinnehållet faktiskt har ändrats.",
  RUNTIME: "Exkludera den aktuella runtimevägen under nästa recoverycykel. Reparera och verifiera källan lokalt med en reproducerbar fixture innan ny runtimekontroll.",
  NANO: "Exkludera ny Nano-omplanering under nästa recoverycykel. Använd deterministisk state, senaste målrespons och befintlig källkontext för att utföra en konkret, bounded åtgärd.",
  META: "Exkludera ytterligare meta-/kontrollarbete under nästa recoverycykel. Producera den minsta konkreta diffen, testloggen eller blockeraren som direkt ändrar leveransläget.",
  OTHER: "Exkludera den senast upprepade åtgärdsfamiljen under nästa recoverycykel och välj en tekniskt oberoende väg som producerar en konkret diff, testlogg eller exakt blockerare."
});

export function buildNoProgressRecoveryPivot(continuityValue, {
  currentAction = "",
  existingExclusions = []
} = {}) {
  const continuity = normalizeContinuity(continuityValue);
  const keys = [...continuity.antiLoop.actionKeys.slice(-8)];
  const currentKey = sanitizeText(currentAction, 240);
  if (currentKey && keys.at(-1) !== currentKey) keys.push(currentKey);

  const excluded = new Set(
    (Array.isArray(existingExclusions) ? existingExclusions : [])
      .map((value) => String(value || "").toUpperCase())
      .filter((value) => value.startsWith("SUBSYSTEM:"))
      .map((value) => value.slice("SUBSYSTEM:".length))
  );
  const stats = new Map();
  keys.forEach((key, index) => {
    const subsystem = classifyActionSubsystem(key);
    if (subsystem === "UNKNOWN" || excluded.has(subsystem)) return;
    const previous = stats.get(subsystem) || { count: 0, lastIndex: -1 };
    stats.set(subsystem, { count: previous.count + 1, lastIndex: index });
  });
  const ranked = [...stats.entries()].sort((a, b) =>
    b[1].count - a[1].count || b[1].lastIndex - a[1].lastIndex
  );
  const subsystem = ranked[0]?.[0] || "";
  if (!subsystem) {
    return {
      available: false,
      subsystem: "",
      exclusion: "",
      instruction: "",
      observedActionKeys: keys
    };
  }
  return {
    available: true,
    subsystem,
    exclusion: `SUBSYSTEM:${subsystem}`,
    instruction: NO_PROGRESS_PIVOT_INSTRUCTIONS[subsystem] || NO_PROGRESS_PIVOT_INSTRUCTIONS.OTHER,
    observedActionKeys: keys
  };
}

export function applyNanoDecision(continuityValue, decision, {
  turnIndex = 0,
  actionKey = "",
  now = Date.now()
} = {}) {
  const continuity = normalizeContinuity(continuityValue);
  const progressDelta = clampInteger(decision?.progressDelta, 0, 3, 0);
  const key = sanitizeText(actionKey || decision?.requestedAction || decision?.action, 240);
  assertDistinctClaimsAndInferences(decision?.targetClaims || [], decision?.inferences || []);
  if (decision?.activeTaskBinding) {
    const transition = assertTaskBindingTransition(
      continuity.activeTaskBinding,
      decision.activeTaskBinding,
      { operation: decision.taskOperation || "CONTINUE" }
    );
    continuity.activeTaskBinding = deepClone(transition.binding);
  }

  if (decision?.mainTaskBaseline) {
    const baseline = normalizeMainTaskBaseline(decision.mainTaskBaseline, {
      source: decision.mainTaskBaseline.source || "TARGET_RESPONSE_ROUTING_CONTEXT",
      observedAt: decision.mainTaskBaseline.observedAt || nowIso(now)
    });
    if (baseline) continuity.mainTaskBaseline = baseline;
  }
  if (decision?.trackControl) {
    continuity.trackControl = normalizeTrackControl(decision.trackControl, {
      baselinePresent: Boolean(continuity.mainTaskBaseline),
      updatedAt: nowIso(now)
    });
  }

  continuity.position.turnIndex = turnIndex;
  if (decision?.intent) {
    const nextIntent = sanitizeText(decision.intent, 6000);
    const currentIntent = sanitizeText(continuity.intent?.text, 6000);
    const currentOwner = sanitizeText(continuity.intent?.setBy, 120);
    const takeoverMayInitialize = decision.analysisMode === "TAKEOVER_BOOTSTRAP" &&
      (!currentIntent || ["unset", "nano-takeover-inference"].includes(currentOwner));
    const ordinaryMayInitialize = !currentIntent;
    if (nextIntent && (takeoverMayInitialize || ordinaryMayInitialize)) {
      continuity.intent.text = nextIntent;
      continuity.intent.setBy = decision.analysisMode === "TAKEOVER_BOOTSTRAP"
        ? "nano-takeover-inference"
        : "nano-analysis";
      continuity.intent.at = nowIso(now);
    } else if (nextIntent && currentIntent && nextIntent !== currentIntent &&
        decision.analysisMode === "TAKEOVER_BOOTSTRAP") {
      continuity.inferences = addUnique(
        continuity.inferences,
        boundedItem("inference", {
          claim: `Takeover-intent avvisades; etablerat intent ägs av ${currentOwner || "durable continuity"}.`,
          confidence: "high",
          provenance: "local-intent-ownership-gate"
        }, turnIndex, now),
        "claim"
      );
    }
  }
  if (decision?.workUnit) {
    const nextWorkUnit = sanitizeText(decision.workUnit, 2400);
    if (nextWorkUnit && nextWorkUnit !== continuity.position.workUnit) {
      continuity.position.workUnit = nextWorkUnit;
      continuity.position.workUnitId = randomId("wu");
      continuity.position.workUnitSource = sanitizeText(
        decision.workUnitSource || (decision.analysisMode ? "nano-analysis" : "decision"),
        120
      );
      continuity.position.updatedAt = nowIso(now);
    }
  }
  if (continuity.position.workUnit && continuity.position.phase === "initial") {
    // v0.6.3 left phase pinned at "initial" for the whole run because only the
    // start-prompt seed ever wrote it. A takeover run therefore never showed a
    // position that advanced with the actual continuation.
    continuity.position.phase = "active";
    continuity.position.updatedAt = nowIso(now);
  }
  if (decision?.analysisMode === "TAKEOVER_BOOTSTRAP") {
    continuity.position.conversationKey = sanitizeText(decision?.conversationKey, 1200);
    continuity.position.taskFingerprint = sanitizeText(decision?.taskFingerprint, 256);
  }

  for (const constraint of decision?.constraints || []) {
    continuity.constraints = addUnique(
      continuity.constraints,
      boundedItem("constraint", constraint, turnIndex, now),
      "text"
    );
  }

  // Nano/target output may not promote new verified facts. Verified facts are
  // operator/local-evidence owned and are changed only through trusted import/migration paths.
  for (const claim of decision?.targetClaims || []) {
    continuity.targetClaims = addUnique(
      continuity.targetClaims,
      boundedItem("target", claim, turnIndex, now),
      "claim"
    );
  }
  for (const inference of decision?.inferences || []) {
    continuity.inferences = addUnique(
      continuity.inferences,
      boundedItem("inference", inference, turnIndex, now),
      "claim"
    );
  }
  for (const evidence of decision?.contextEvidence || []) {
    const text = sanitizeText(typeof evidence === "string" ? evidence : evidence?.claim || evidence?.text, 1600);
    if (!text) continue;
    continuity.inferences = addUnique(
      continuity.inferences,
      boundedItem("inference", {
        claim: text,
        confidence: "high",
        provenance: "nano-takeover-context-evidence-unverified"
      }, turnIndex, now),
      "claim"
    );
  }
  if (decision?.reason) {
    continuity.decisions = addUnique(
      continuity.decisions,
      boundedItem("decision", {
        choice: `${decision.action}: ${decision.requestedAction || ""}`,
        because: decision.reason
      }, turnIndex, now),
      "choice"
    );
  }
  for (const attempt of decision?.attempts || []) {
    continuity.attempts = addUnique(
      continuity.attempts,
      boundedItem("attempt", attempt, turnIndex, now),
      "action"
    );
  }
  for (const blocker of decision?.blockers || []) {
    continuity.blockers = upsertBlocker(
      continuity.blockers,
      boundedItem("blocker", blocker, turnIndex, now),
      turnIndex
    );
  }
  for (const evidence of decision?.requiredEvidence || []) {
    continuity.evidenceRequirements = addUnique(
      continuity.evidenceRequirements,
      boundedItem("direction", typeof evidence === "string" ? { text: evidence } : evidence, turnIndex, now),
      "text"
    );
  }
  for (const direction of decision?.alternatives || []) {
    continuity.nextDirections = addUnique(
      continuity.nextDirections,
      boundedItem("direction", typeof direction === "string" ? { text: direction } : direction, turnIndex, now),
      "text"
    );
  }

  continuity.antiLoop.progressDeltas = [...continuity.antiLoop.progressDeltas, progressDelta].slice(-8);
  continuity.antiLoop.actionKeys = [...continuity.antiLoop.actionKeys, key].filter(Boolean).slice(-8);
  const actionClass = classifyActionKey(key);
  // Verified progress outranks wording. A turn that produced deterministic progress
  // is productive even if the action text also contains a verification verb.
  if (key && progressDelta > 0) continuity.antiLoop.productiveActionCount += 1;
  else if (actionClass === "META") continuity.antiLoop.auditActionCount += 1;
  if (key && actionClass === "CONCRETE") continuity.antiLoop.concreteActionCount += 1;
  continuity.antiLoop.lastActionClass = actionClass;
  continuity.antiLoop.stagnationCycles = decision?.recoveryPivot
    ? 0
    : progressDelta > 0
      ? 0
      : continuity.antiLoop.stagnationCycles + 1;
  if (decision?.recoveryPivot) {
    continuity.antiLoop.lastCorrection = {
      code: "SUBSYSTEM_PIVOT",
      subsystem: sanitizeText(decision?.recoverySubsystem || "UNKNOWN", 80),
      at: nowIso(now)
    };
  }
  const openBlockerText = (continuity.blockers || [])
    .filter((item) => item?.open !== false)
    .map((item) => sanitizeText(item?.statement, 1600))
    .filter(Boolean)
    .sort();
  continuity.transition = {
    lastProgressDelta: progressDelta,
    blockerFingerprint: openBlockerText.length ? stableFingerprint(openBlockerText) : "",
    nextDirection: sanitizeText(
      (Array.isArray(decision?.alternatives) ? decision.alternatives[0] : "") ||
      decision?.requestedAction ||
      "",
      2000
    ),
    updatedAt: nowIso(now)
  };
  continuity.updatedAt = nowIso(now);

  expireStaleBlockers(continuity, { turnIndex, now });
  return compactContinuity(continuity, { now });
}

export function seedContinuityFromStartAnalysis(continuityValue, analysis, {
  conversationKey = "",
  taskFingerprint = "",
  now = Date.now()
} = {}) {
  const continuity = normalizeContinuity(continuityValue);
  const intent = sanitizeText(analysis?.taskIntent, 6000);
  const workUnit = sanitizeText(analysis?.firstWorkUnit, 2400);
  if (!intent || !workUnit) {
    throw new Error("START_ANALYSIS_UNGROUNDED: taskIntent och firstWorkUnit krävs.");
  }
  continuity.intent = { text: intent, setBy: "nano-start-analysis", at: nowIso(now) };
  continuity.position.phase = "started";
  continuity.position.workUnit = workUnit;
  continuity.position.workUnitId = randomId("wu");
  continuity.position.conversationKey = sanitizeText(conversationKey, 1200);
  continuity.position.taskFingerprint = sanitizeText(taskFingerprint, 256);
  for (const constraint of analysis?.constraints || []) {
    continuity.constraints = addUnique(
      continuity.constraints,
      boundedItem("constraint", { text: constraint, provenance: "nano-start-analysis" }, 0, now),
      "text"
    );
  }
  for (const risk of analysis?.risks || []) {
    continuity.inferences = addUnique(
      continuity.inferences,
      boundedItem("inference", {
        claim: `Startprompt-risk: ${sanitizeText(risk, 1200)}`,
        confidence: "medium",
        provenance: "nano-start-analysis"
      }, 0, now),
      "claim"
    );
  }
  for (const evidence of analysis?.requiredEvidence || []) {
    continuity.evidenceRequirements = addUnique(
      continuity.evidenceRequirements,
      boundedItem("direction", { text: sanitizeText(evidence, 1200) }, 0, now),
      "text"
    );
  }
  continuity.decisions = addUnique(
    continuity.decisions,
    boundedItem("decision", {
      choice: "Seed durable continuity from start-prompt analysis",
      because: sanitizeText(analysis?.summary, 1000)
    }, 0, now),
    "choice"
  );
  continuity.updatedAt = nowIso(now);
  return compactContinuity(continuity, { now });
}

export function detectLoopCorrection(continuityValue) {
  const continuity = normalizeContinuity(continuityValue);
  const keys = continuity.antiLoop.actionKeys.slice(-6);
  const deltas = continuity.antiLoop.progressDeltas.slice(-6);
  const repeated = keys.length >= 2 && keys.slice(-2).every((key) => key === keys.at(-1));
  const stagnant = deltas.length >= 2 && deltas.slice(-2).every((value) => value === 0);
  const recentMetaStagnation = keys.length >= 2 && keys.slice(-2).every(isAuditAction) && stagnant;
  const total = continuity.antiLoop.auditActionCount + continuity.antiLoop.productiveActionCount;
  const auditRatio = total ? continuity.antiLoop.auditActionCount / total : 0;

  let code = null;
  let text = "";
  if (continuity.antiLoop.stagnationCycles >= 8) {
    code = "NO_PROGRESS_CHECKPOINT";
    text = "Ingen verifierbar framdrift har registrerats under åtta cykler. I Max Autonomous Mode ska nästa steg vara en bounded subsystem-pivot eller väntan på ett exakt unlock-event — inte en mänsklig paus.";
  } else if (recentMetaStagnation) {
    code = "STOP_META_LOOP";
    text = "De två senaste turerna var meta-/kontrollåtgärder utan verifierbar framdrift. Skicka inte ännu en generell läs-, verifierings- eller auditprompt. Härled den verkliga arbetsenheten från målsessionens kontext eller pausa fail-closed.";
  } else if (repeated && stagnant) {
    code = "PRODUCE_SMALLEST_DELIVERABLE";
    text = "De två senaste turerna upprepade samma åtgärd utan verifierbar framdrift. Gör inte samma kontroll igen. Leverera den minsta konkreta arbetsprodukten eller välj en annan evidensväg.";
  } else if (stagnant && auditRatio > 0.6) {
    code = "STOP_REAUDITING";
    text = "Arbetet har fastnat i audit/preflight utan ny evidens. Stoppa omgranskningen och gå till nästa producerande, säkra åtgärd.";
  } else if (continuity.antiLoop.stagnationCycles >= 5) {
    code = "REDUCE_SCOPE";
    text = "Ingen framdrift har registrerats under fem cykler. Minska arbetsenheten till den minsta verifierbara delen eller deklarera exakt yttre blockerare.";
  }
  return { triggered: Boolean(code), code, text, repeated, stagnant, recentMetaStagnation, auditRatio };
}

/**
 * Shrinks an already-built projection to fit a character budget. Priority order,
 * lowest value first: recent attempts, inferences, next directions, target claims,
 * constraints, verified facts. Intent, position and open blockers are never dropped
 * — they are the load-bearing continuity that makes a continuation grounded at all.
 */
export function boundProjectionToChars(projection, maxChars, {
  serialize = (value) => JSON.stringify(value),
  minItems = PROJECTION_MIN_ITEMS,
  trimKeys = ["recentAttempts", "inferences", "nextDirections", "targetClaims", "constraints", "verifiedFacts"]
} = {}) {
  const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
  if (!limit) return { projection: {}, trimmed: Object.keys(projection || {}), withinBudget: true };
  const result = deepClone(projection || {});
  const trimmed = [];
  const floor = Math.max(0, Math.floor(Number(minItems) || 0));
  const order = [...new Set((Array.isArray(trimKeys) ? trimKeys : []).filter(Boolean))];
  const size = () => String(serialize(result) ?? "").length;

  let guard = 0;
  while (size() > limit && guard < 400) {
    guard += 1;
    const key = order.find((candidate) => (result[candidate] || []).length > floor);
    if (!key) break;
    result[key] = result[key].slice(1);
    if (!trimmed.includes(key)) trimmed.push(key);
  }
  if (size() > limit) {
    // Emergency pass: the preferred floor is soft. If the projection still exceeds the
    // caller's hard budget after the first pass (or its guard), trim optional lists below
    // the floor rather than returning an avoidably oversized Nano input.
    for (const key of order) {
      while ((result[key] || []).length > 0 && size() > limit) {
        result[key] = result[key].slice(1);
        if (!trimmed.includes(key)) trimmed.push(key);
      }
    }
  }
  return { projection: result, trimmed, withinBudget: size() <= limit };
}

export function projectContinuity(continuityValue, {
  maxFacts = 12,
  maxClaims = 6,
  maxBlockers = 6,
  maxAttempts = 6,
  maxChars = 0
} = {}) {
  const continuity = normalizeContinuity(continuityValue);
  const projection = {
    intent: continuity.intent.text,
    activeTaskBinding: continuity.activeTaskBinding,
    mainTaskBaseline: baselineRoutingSummary(continuity.mainTaskBaseline),
    trackControl: continuity.trackControl,
    transition: continuity.transition,
    position: continuity.position,
    verifiedFacts: continuity.verifiedFacts.slice(-maxFacts),
    constraints: continuity.constraints.slice(-maxClaims),
    targetClaims: continuity.targetClaims.slice(-maxClaims),
    inferences: continuity.inferences.slice(-maxClaims),
    blockers: continuity.blockers.filter((item) => item.open !== false).slice(-maxBlockers),
    recentAttempts: continuity.attempts.slice(-maxAttempts),
    nextDirections: continuity.nextDirections.slice(-6),
    evidenceRequirements: continuity.evidenceRequirements.slice(-8),
    nanoReviewedContext: continuity.nanoReviewedContext || null,
    antiLoop: {
      ...continuity.antiLoop,
      correction: detectLoopCorrection(continuity)
    }
  };
  if (!maxChars) return projection;
  const bounded = boundProjectionToChars(projection, maxChars);
  if (bounded.trimmed.length) {
    bounded.projection.projectionCompaction = {
      trimmedLists: bounded.trimmed,
      withinBudget: bounded.withinBudget,
      maxChars
    };
  }
  return bounded.projection;
}

const PRIMARY_TEXT_KEYS = Object.freeze({
  constraints: "text",
  targetClaims: "claim",
  inferences: "claim",
  decisions: "choice",
  attempts: "action",
  failures: "action",
  nextDirections: "text",
  evidenceRequirements: "text"
});

function primaryText(item, key) {
  return normalizeWhitespace(item?.[key] || "").toLowerCase();
}

/**
 * Semantic compaction. v0.6.3 only trimmed above hard byte/count ceilings, so a
 * live continuity of 18 630 bytes never compacted at all (`compactionGeneration: 0`)
 * while every stale claim kept riding along into the Nano input. This merges exact
 * semantic duplicates and drops items that are older than the retain window,
 * always keeping the newest `keepMin` of every list.
 */
function semanticCompaction(continuity, {
  retainTurns = SEMANTIC_RETAIN_TURNS,
  keepMin = SEMANTIC_KEEP_MIN
} = {}) {
  const currentTurn = clampInteger(continuity.position?.turnIndex, 0, Number.MAX_SAFE_INTEGER, 0);
  const cutoff = currentTurn - Math.max(1, retainTurns);
  let removed = 0;
  let merged = 0;

  for (const [listKey, textKey] of Object.entries(PRIMARY_TEXT_KEYS)) {
    const items = Array.isArray(continuity[listKey]) ? continuity[listKey] : [];
    if (!items.length) continue;

    const byText = new Map();
    for (const item of items) {
      const text = primaryText(item, textKey);
      if (!text) {
        byText.set(Symbol("empty-continuity-item"), item);
        continue;
      }
      if (byText.has(text)) merged += 1;
      // Keep the newest occurrence so turn/timestamps stay truthful.
      byText.set(text, item);
    }
    let deduped = [...byText.values()];
    deduped.sort((left, right) => {
      const turnDelta = clampInteger(left?.turn, 0, Number.MAX_SAFE_INTEGER, 0) -
        clampInteger(right?.turn, 0, Number.MAX_SAFE_INTEGER, 0);
      if (turnDelta) return turnDelta;
      return String(left?.at || "").localeCompare(String(right?.at || ""));
    });

    if (cutoff > 0 && deduped.length > keepMin) {
      const fresh = deduped.filter(
        (item) => clampInteger(item?.turn, 0, Number.MAX_SAFE_INTEGER, 0) > cutoff
      );
      const kept = fresh.length >= keepMin ? fresh : deduped.slice(-keepMin);
      removed += deduped.length - kept.length;
      deduped = kept;
    }
    continuity[listKey] = deduped;
  }
  return { removed, merged };
}

export function compactContinuity(value, { now = Date.now() } = {}) {
  const continuity = normalizeContinuity(value);
  // Blocker expiry belongs to every durable write path, not only to the decision
  // path, so an imported or hand-edited continuity gets the same lifecycle.
  const expiry = expireStaleBlockers(continuity, {
    turnIndex: continuity.position?.turnIndex,
    now
  });
  const semantic = semanticCompaction(continuity);
  let removed = semantic.removed;
  let merged = semantic.merged;
  const expiredBlockers = expiry.expired;

  if (utf8Bytes(continuity.verifiedFacts.map(itemText).join("")) > HARD_FACT_BYTES) {
    throw new Error("CONTINUITY_SATURATED: verifierade fakta överskrider säker gräns.");
  }
  const openBlockers = continuity.blockers.filter((item) => item.open !== false);
  if (utf8Bytes(openBlockers.map(itemText).join("")) > HARD_BLOCKER_BYTES) {
    throw new Error("CONTINUITY_SATURATED: öppna blockerare överskrider säker gräns.");
  }

  const trim = (key, max) => {
    if (continuity[key].length > max) {
      removed += continuity[key].length - max;
      continuity[key] = continuity[key].slice(-max);
    }
  };

  trim("constraints", 20);
  trim("targetClaims", 20);
  trim("inferences", 20);
  trim("decisions", 16);
  trim("attempts", 20);
  trim("failures", 12);
  trim("blockers", 16);
  trim("nextDirections", 8);
  trim("evidenceRequirements", 12);

  while (utf8Bytes(JSON.stringify(continuity)) > MAX_BYTES) {
    // Closed blockers are historical diagnostics, not active constraints. Remove the
    // oldest closed blocker before sacrificing current reasoning lists. Open blockers
    // remain protected by HARD_BLOCKER_BYTES and are never silently dropped here.
    const closedBlockerIndex = continuity.blockers.findIndex((item) => item.open === false);
    if (closedBlockerIndex >= 0) {
      continuity.blockers.splice(closedBlockerIndex, 1);
      removed += 1;
      continue;
    }
    const candidates = ["constraints", "targetClaims", "inferences", "attempts", "decisions", "failures", "nextDirections", "evidenceRequirements"];
    const key = candidates.find((candidate) => continuity[candidate].length > 2);
    if (!key) throw new Error("CONTINUITY_SATURATED: säker komprimering kan inte skapa mer utrymme.");
    continuity[key].shift();
    removed += 1;
  }

  if (removed || merged || expiredBlockers) {
    continuity.compactionGeneration += 1;
    continuity.compaction.removedItems += removed;
    continuity.compaction.mergedItems += merged;
    continuity.compaction.expiredBlockers =
      Number(continuity.compaction.expiredBlockers || 0) + expiredBlockers;
    continuity.compaction.lastAt = nowIso(now);
  }
  continuity.updatedAt = nowIso(now);
  return continuity;
}

export function continuityToEditableJson(value) {
  return JSON.stringify(normalizeContinuity(value), null, 2);
}

export function continuityFromEditableJson(text) {
  const parsed = JSON.parse(String(text));
  return compactContinuity(parsed);
}


function continuityDigestPayload(value) {
  const normalized = normalizeContinuity(value);
  delete normalized.integrity;
  return stableStringify(normalized);
}

export async function sealContinuity(value, { now = Date.now() } = {}) {
  const continuity = compactContinuity(value, { now });
  delete continuity.integrity;
  const digest = await sha256Hex(continuityDigestPayload(continuity));
  continuity.integrity = {
    algorithm: "SHA-256",
    digest,
    sealedAt: nowIso(now)
  };
  return continuity;
}

export async function verifyContinuity(value) {
  if (!value || typeof value !== "object") {
    return { valid: false, reason: "MISSING", continuity: null };
  }
  const expected = sanitizeText(value.integrity?.digest, 128);
  if (!expected || value.integrity?.algorithm !== "SHA-256") {
    return { valid: false, reason: "UNSEALED", continuity: normalizeContinuity(value) };
  }
  const actual = await sha256Hex(continuityDigestPayload(value));
  return {
    valid: actual === expected,
    reason: actual === expected ? "OK" : "DIGEST_MISMATCH",
    expected,
    actual,
    continuity: normalizeContinuity(value)
  };
}
