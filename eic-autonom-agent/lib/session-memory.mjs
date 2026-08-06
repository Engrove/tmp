import { deepClone, nowIso, sanitizeText, sha256Hex, stableStringify } from "./common.mjs";

export const SESSION_MEMORY_SCHEMA = "eic.autonom.session-memory.v1";
export const SESSION_SECTION_SCHEMA = "eic.autonom.session-section.v1";
export const SESSION_SECTION_SUMMARY_SCHEMA = "eic.autonom.session-section-summary.v1";

export const MEMORY_ITEM_STATES = Object.freeze({
  ACTIVE: "active",
  SUPERSEDED: "superseded",
  HISTORICAL: "historical"
});

export const SESSION_MEMORY_STATES = Object.freeze({
  FRESH: "FRESH",
  STALE: "STALE",
  RESET_REQUIRED: "RESET_REQUIRED"
});

export const MEMORY_REGISTER_KEYS = Object.freeze([
  "userGoals",
  "verifiedFacts",
  "assistantClaims",
  "inferences",
  "decisions",
  "constraints",
  "preferences",
  "openLoops",
  "blockers",
  "operatorActions",
  "artifactsAndOwnerLocators",
  "supersededItems"
]);

function tokenEstimate(text) {
  return Math.ceil(String(text || "").length / 4);
}

export async function sectionTurns(turns = [], {
  minTokens = 3500,
  targetTokens = 4000,
  maxTokens = 4500,
  captureId = "",
  conversationKey = ""
} = {}) {
  const sections = [];
  let current = [];
  let tokens = 0;
  const flush = async () => {
    if (!current.length) return;
    const hashes = current.map((turn) => turn.sourceHash || turn.id || "");
    const id = `section-${(await sha256Hex(stableStringify({
      captureId,
      conversationKey,
      hashes
    }))).slice(0, 32)}`;
    sections.push({
      schema: SESSION_SECTION_SCHEMA,
      version: 1,
      id,
      captureId,
      conversationKey,
      turnIds: current.map((turn) => turn.id),
      sourceHashes: hashes,
      tokenEstimate: tokens,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    current = [];
    tokens = 0;
  };
  for (const turn of turns) {
    const estimated = tokenEstimate(`${turn.role}\n${turn.text}\n${turn.reasoningSummary?.text || ""}`);
    if (current.length && tokens >= minTokens && tokens + estimated > maxTokens) await flush();
    current.push(turn);
    tokens += estimated;
    if (tokens >= targetTokens && tokens >= minTokens) await flush();
  }
  await flush();
  return sections;
}

function normalizeRegisterItem(item, defaults = {}) {
  return {
    id: sanitizeText(item?.id || defaults.id, 300),
    text: sanitizeText(item?.text || item?.summary || "", 12000),
    sourceTurnIds: [...new Set([...(item?.sourceTurnIds || defaults.sourceTurnIds || [])].map(String))],
    sourceHashes: [...new Set([...(item?.sourceHashes || defaults.sourceHashes || [])].map(String))],
    evidenceClass: sanitizeText(item?.evidenceClass || defaults.evidenceClass || "UNTRUSTED_TRANSCRIPT_DATA", 120),
    confidence: Math.max(0, Math.min(1, Number(item?.confidence ?? defaults.confidence ?? 0.5))),
    captureCompleteness: sanitizeText(item?.captureCompleteness || defaults.captureCompleteness || "PARTIAL", 120),
    state: Object.values(MEMORY_ITEM_STATES).includes(item?.state) ? item.state : MEMORY_ITEM_STATES.ACTIVE,
    supersedes: sanitizeText(item?.supersedes, 300) || null,
    createdAt: item?.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

export async function createSectionSummary(section, summaryInput = {}, turns = []) {
  const sourceTurnIds = section.turnIds || [];
  const sourceHashes = section.sourceHashes || [];
  const registers = {};
  for (const key of MEMORY_REGISTER_KEYS) {
    registers[key] = (summaryInput?.registers?.[key] || []).map((item, index) =>
      normalizeRegisterItem(item, {
        id: `${section.id}:${key}:${index}`,
        sourceTurnIds,
        sourceHashes,
        captureCompleteness: summaryInput.captureCompleteness
      }));
  }
  return {
    schema: SESSION_SECTION_SUMMARY_SCHEMA,
    version: 1,
    id: `summary-${section.id}`,
    sectionId: section.id,
    captureId: section.captureId,
    conversationKey: section.conversationKey,
    narrative: sanitizeText(summaryInput.narrative, 16000),
    registers,
    sourceTurnIds,
    sourceHashes,
    tokenEstimate: section.tokenEstimate,
    sourceTextHash: await sha256Hex(turns.map((turn) => turn.sourceHash || "").join("\n")),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function emptyRegisters() {
  return Object.fromEntries(MEMORY_REGISTER_KEYS.map((key) => [key, []]));
}

function mergeRegisters(summaries) {
  const merged = emptyRegisters();
  for (const summary of summaries) {
    for (const key of MEMORY_REGISTER_KEYS) {
      for (const item of summary?.registers?.[key] || []) {
        const priorIndex = merged[key].findIndex((existing) => existing.id === item.id);
        if (priorIndex >= 0) merged[key][priorIndex] = deepClone(item);
        else merged[key].push(deepClone(item));
      }
    }
  }
  for (const key of MEMORY_REGISTER_KEYS) {
    const bySuperseded = new Map(merged[key].filter((item) => item.supersedes).map((item) => [item.supersedes, item.id]));
    for (const item of merged[key]) {
      if (bySuperseded.has(item.id)) {
        item.state = MEMORY_ITEM_STATES.SUPERSEDED;
        item.supersededBy = bySuperseded.get(item.id);
      }
    }
  }
  return merged;
}

export async function synthesizeSessionMemory({
  memoryId,
  conversationKey,
  branchKey = "",
  projectId = null,
  taskFingerprint,
  mandateVersion,
  mandateSha256,
  capture,
  sectionSummaries = [],
  recentDelta = [],
  priorMemory = null,
  narrative = ""
} = {}) {
  const summaries = priorMemory
    ? [...(priorMemory.sectionSummaries || []), ...sectionSummaries]
    : sectionSummaries;
  const registers = mergeRegisters(summaries);
  const sourceHashes = [...new Set(summaries.flatMap((summary) => summary.sourceHashes || []))];
  const id = sanitizeText(memoryId, 300) ||
    `memory-${(await sha256Hex(`${conversationKey}:${taskFingerprint}:${sourceHashes.join(":")}`)).slice(0, 32)}`;
  return {
    schema: SESSION_MEMORY_SCHEMA,
    version: 1,
    id,
    conversationKey: sanitizeText(conversationKey, 1000),
    branchKey: sanitizeText(branchKey, 1000),
    projectId,
    taskFingerprint: sanitizeText(taskFingerprint, 500),
    mandateVersion: sanitizeText(mandateVersion, 200),
    mandateSha256: sanitizeText(mandateSha256, 128),
    captureId: capture?.id || null,
    captureCompleteness: capture?.completeness || "PARTIAL",
    sourceChainHash: capture?.sourceChainHash || "",
    state: SESSION_MEMORY_STATES.FRESH,
    staleReasons: [],
    narrative: sanitizeText(narrative || summaries.map((item) => item.narrative).filter(Boolean).join("\n\n"), 24000),
    registers,
    sectionSummaries: summaries,
    provenance: {
      sourceTurnIds: [...new Set(summaries.flatMap((summary) => summary.sourceTurnIds || []))],
      sourceHashes
    },
    recentDelta: deepClone(recentDelta).slice(-40),
    localDerivedContext: true,
    ownerTruth: false,
    createdAt: priorMemory?.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

export function supersedeMemoryItem(memoryInput, registerKey, oldId, newItem) {
  if (!MEMORY_REGISTER_KEYS.includes(registerKey)) throw new Error("SESSION_MEMORY_REGISTER_UNKNOWN");
  const memory = deepClone(memoryInput);
  const items = memory.registers?.[registerKey] || [];
  const old = items.find((item) => item.id === oldId);
  if (!old) throw new Error("SESSION_MEMORY_ITEM_NOT_FOUND");
  old.state = MEMORY_ITEM_STATES.SUPERSEDED;
  old.updatedAt = nowIso();
  const replacement = normalizeRegisterItem({ ...newItem, supersedes: oldId });
  items.push(replacement);
  memory.registers[registerKey] = items;
  memory.registers.supersededItems ||= [];
  memory.registers.supersededItems.push(deepClone(old));
  memory.updatedAt = nowIso();
  return memory;
}

export function evaluateSessionMemoryFreshness(memory, context = {}) {
  if (!memory || memory.schema !== SESSION_MEMORY_SCHEMA) {
    return { state: SESSION_MEMORY_STATES.RESET_REQUIRED, reasons: ["MEMORY_MISSING_OR_SCHEMA_MISMATCH"] };
  }
  const reasons = [];
  if (memory.conversationKey !== context.conversationKey) reasons.push("CONVERSATION_KEY_MISMATCH");
  if (context.branchKey && memory.branchKey && memory.branchKey !== context.branchKey) reasons.push("BRANCH_MISMATCH");
  if (memory.taskFingerprint !== context.taskFingerprint) reasons.push("TASK_FINGERPRINT_MISMATCH");
  if (context.mandateVersion && memory.mandateVersion !== context.mandateVersion) reasons.push("MANDATE_VERSION_CONFLICT");
  if (context.mandateSha256 && memory.mandateSha256 !== context.mandateSha256) reasons.push("MANDATE_HASH_CONFLICT");
  if (context.sourceChainHash && memory.sourceChainHash !== context.sourceChainHash) reasons.push("SOURCE_HASH_MISMATCH");
  if (memory.captureCompleteness === "GAPPED" || context.unexplainedGaps) reasons.push("UNEXPLAINED_CAPTURE_GAPS");
  return reasons.length
    ? { state: SESSION_MEMORY_STATES.STALE, reasons }
    : { state: SESSION_MEMORY_STATES.FRESH, reasons: [] };
}

export function markLiveFieldsStale(memoryInput, reason, fields = []) {
  const memory = deepClone(memoryInput);
  memory.state = SESSION_MEMORY_STATES.STALE;
  memory.staleReasons = [...new Set([...(memory.staleReasons || []), sanitizeText(reason, 300)])];
  memory.liveState = {
    ...(memory.liveState || {}),
    stale: true,
    staleFields: [...new Set([...(memory.liveState?.staleFields || []), ...fields.map(String)])],
    staleAt: nowIso()
  };
  memory.updatedAt = nowIso();
  return memory;
}

export function buildActiveMemoryCapsule(memory, { maxChars = 12000 } = {}) {
  if (!memory) return { schema: "eic.autonom.active-memory-capsule.v1", text: "", truncated: false };
  const active = {};
  for (const key of MEMORY_REGISTER_KEYS) {
    active[key] = (memory.registers?.[key] || [])
      .filter((item) => item.state === MEMORY_ITEM_STATES.ACTIVE)
      .slice(-12)
      .map((item) => ({ id: item.id, text: item.text, evidenceClass: item.evidenceClass, sourceTurnIds: item.sourceTurnIds }));
  }
  const raw = JSON.stringify({
    narrative: memory.narrative,
    captureCompleteness: memory.captureCompleteness,
    state: memory.state,
    staleReasons: memory.staleReasons,
    active
  });
  return {
    schema: "eic.autonom.active-memory-capsule.v1",
    text: raw.slice(0, maxChars),
    truncated: raw.length > maxChars,
    sourceMemoryId: memory.id,
    sourceHash: memory.sourceChainHash
  };
}
