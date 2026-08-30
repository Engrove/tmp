import { conversationKeyFromUrl, deepClone, sha256Hex, stableStringify } from "./common.mjs";

export const RAW_SESSION_CONTEXT_EXPORT_SCHEMA = "eic.autonom.session-context-export.v1";
export const RAW_SESSION_CONTEXT_EXPORT_VERSION = 1;


export function canonicalSessionConversationKey(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  return conversationKeyFromUrl(text) || text;
}


export function rawSessionConversationSelectionKeys(conversationKey = "", linkedUrl = "") {
  const keys = [];
  const add = (value) => {
    const key = String(value || "").trim();
    if (key && !keys.includes(key)) keys.push(key);
  };
  add(conversationKey);
  try {
    const parsed = new URL(String(linkedUrl || ""));
    if (canonicalSessionConversationKey(parsed.href) === canonicalSessionConversationKey(conversationKey)) {
      add(`${parsed.origin}${parsed.pathname}`);
    }
  } catch {
    // The canonical key remains sufficient when no linked URL is available.
  }
  return keys;
}

export async function listRawSessionRecordsForConversation(db, store, conversationKeys = []) {
  const records = new Map();
  for (const conversationKey of conversationKeys) {
    const matches = await db.list(store, {
      index: "conversationKey",
      query: conversationKey,
      limit: 5000
    });
    for (const record of matches) {
      const id = String(record?.id || "");
      if (id && !records.has(id)) records.set(id, record);
    }
  }
  return [...records.values()];
}

function sortedRecords(records = []) {
  return [...(Array.isArray(records) ? records : [])]
    .filter((record) => record && typeof record === "object")
    .map((record) => deepClone(record))
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
}

async function digestRecord(kind, record) {
  return {
    kind,
    id: String(record?.id || ""),
    sha256: await sha256Hex(stableStringify(record))
  };
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

export async function buildRawSessionContextExport({
  appVersion = "",
  exportedAt = "",
  conversationKey = "",
  selection = {},
  capture = null,
  turns = [],
  sections = [],
  sectionSummaries = [],
  sessionMemory = null
} = {}) {
  const rawCapture = capture ? deepClone(capture) : null;
  const rawTurns = sortedRecords(turns);
  const rawSections = sortedRecords(sections);
  const rawSummaries = sortedRecords(sectionSummaries);
  const rawMemory = sessionMemory ? deepClone(sessionMemory) : null;

  const turnById = new Map(
    rawTurns.map((record) => [String(record.id || ""), record]).filter(([id]) => id)
  );
  const turnIds = new Set(turnById.keys());
  const turnSourceHashes = new Set(
    rawTurns.map((record) => String(record.sourceHash || "")).filter(Boolean)
  );
  const sectionIds = new Set(
    rawSections.map((record) => String(record.id || "")).filter(Boolean)
  );

  const captureTurnIds = uniqueStrings(rawCapture?.turnIds);
  const sectionTurnIds = uniqueStrings(rawSections.flatMap((record) => record.turnIds || []));
  const summaryTurnIds = uniqueStrings(rawSummaries.flatMap((record) => record.sourceTurnIds || []));
  const memorySourceTurnIds = uniqueStrings(rawMemory?.provenance?.sourceTurnIds);
  const memorySourceHashes = uniqueStrings(rawMemory?.provenance?.sourceHashes);
  const summarySectionIds = uniqueStrings(rawSummaries.map((record) => record.sectionId));
  const memorySummarySectionIds = uniqueStrings(
    (rawMemory?.sectionSummaries || []).map((record) => record?.sectionId)
  );

  const unresolvedCaptureTurnIds = captureTurnIds.filter((id) => !turnIds.has(id));
  const unresolvedSectionTurnIds = sectionTurnIds.filter((id) => !turnIds.has(id));
  const unresolvedSectionSummaryTurnIds = summaryTurnIds.filter((id) => !turnIds.has(id));
  const unresolvedMemorySourceTurnIds = memorySourceTurnIds.filter((id) => !turnIds.has(id));
  const unresolvedMemorySourceHashes = memorySourceHashes.filter((hash) => !turnSourceHashes.has(hash));
  const unresolvedSectionSummarySectionIds = uniqueStrings([
    ...summarySectionIds,
    ...memorySummarySectionIds
  ]).filter((id) => !sectionIds.has(id));

  const missingComponents = [];
  if (!rawCapture) missingComponents.push("capture");
  if (!rawMemory) missingComponents.push("sessionMemory");

  const conversationMismatch = [];
  const expectedConversation = String(conversationKey || "");
  const canonicalExpectedConversation = canonicalSessionConversationKey(expectedConversation);
  for (const [kind, record] of [
    ["capture", rawCapture],
    ["sessionMemory", rawMemory],
    ...rawTurns.map((record) => ["turn", record]),
    ...rawSections.map((record) => ["section", record]),
    ...rawSummaries.map((record) => ["sectionSummary", record])
  ]) {
    if (record?.conversationKey && canonicalExpectedConversation &&
        canonicalSessionConversationKey(record.conversationKey) !== canonicalExpectedConversation) {
      conversationMismatch.push(`${kind}:${record.id || "UNKNOWN"}`);
    }
  }

  const bindingMismatch = [];
  if (rawCapture && rawMemory?.captureId && rawMemory.captureId !== rawCapture.id) {
    bindingMismatch.push("SESSION_MEMORY_CAPTURE_ID_MISMATCH");
  }
  if (rawCapture?.sourceChainHash && rawMemory?.sourceChainHash &&
      rawMemory.sourceChainHash !== rawCapture.sourceChainHash) {
    bindingMismatch.push("SESSION_MEMORY_SOURCE_CHAIN_HASH_MISMATCH");
  }

  let derivedCaptureSourceChainHash = "";
  let captureSourceChainHashMatches = null;
  if (rawCapture && unresolvedCaptureTurnIds.length === 0) {
    derivedCaptureSourceChainHash = await sha256Hex(
      captureTurnIds
        .map((id) => `${id}:${turnById.get(id)?.sourceHash || ""}`)
        .join("\n")
    );
    captureSourceChainHashMatches = Boolean(rawCapture.sourceChainHash) &&
      derivedCaptureSourceChainHash === rawCapture.sourceChainHash;
    if (!captureSourceChainHashMatches) bindingMismatch.push("CAPTURE_SOURCE_CHAIN_HASH_MISMATCH");
  }

  const recordDigests = {
    capture: rawCapture ? [await digestRecord("capture", rawCapture)] : [],
    turns: await Promise.all(rawTurns.map((record) => digestRecord("turn", record))),
    sections: await Promise.all(rawSections.map((record) => digestRecord("section", record))),
    sectionSummaries: await Promise.all(
      rawSummaries.map((record) => digestRecord("sectionSummary", record))
    ),
    sessionMemory: rawMemory ? [await digestRecord("sessionMemory", rawMemory)] : []
  };
  const digestManifest = {
    schema: RAW_SESSION_CONTEXT_EXPORT_SCHEMA,
    version: RAW_SESSION_CONTEXT_EXPORT_VERSION,
    appVersion: String(appVersion || ""),
    conversationKey: expectedConversation,
    captureId: rawCapture?.id || null,
    memoryId: rawMemory?.id || null,
    recordDigests
  };
  const aggregateDigest = await sha256Hex(stableStringify(digestManifest));

  const recordSetComplete = (
    missingComponents.length === 0 &&
    unresolvedCaptureTurnIds.length === 0 &&
    unresolvedSectionTurnIds.length === 0 &&
    unresolvedSectionSummaryTurnIds.length === 0 &&
    unresolvedMemorySourceTurnIds.length === 0 &&
    unresolvedMemorySourceHashes.length === 0 &&
    unresolvedSectionSummarySectionIds.length === 0 &&
    conversationMismatch.length === 0 &&
    bindingMismatch.length === 0
  );

  return {
    schema: RAW_SESSION_CONTEXT_EXPORT_SCHEMA,
    version: RAW_SESSION_CONTEXT_EXPORT_VERSION,
    exportedAt: String(exportedAt || ""),
    appVersion: String(appVersion || ""),
    scope: {
      conversationKey: expectedConversation,
      selection: deepClone(selection || {})
    },
    diagnosticOnly: true,
    ownerTruth: false,
    liveStateImportable: false,
    rawPersistedRecords: {
      capture: rawCapture,
      turns: rawTurns,
      sections: rawSections,
      sectionSummaries: rawSummaries,
      sessionMemory: rawMemory
    },
    provenance: {
      captureId: rawCapture?.id || null,
      memoryId: rawMemory?.id || null,
      captureSourceChainHash: rawCapture?.sourceChainHash || "",
      derivedCaptureSourceChainHash,
      captureSourceChainHashMatches,
      captureTurnIds,
      memorySourceTurnIds,
      memorySourceHashes
    },
    completeness: {
      recordSetStatus: recordSetComplete ? "COMPLETE" : "INCOMPLETE",
      captureCompleteness: rawCapture?.completeness || "MISSING",
      captureGaps: deepClone(rawCapture?.gaps || []),
      missingComponents,
      unresolvedCaptureTurnIds,
      unresolvedSectionTurnIds,
      unresolvedSectionSummaryTurnIds,
      unresolvedMemorySourceTurnIds,
      unresolvedMemorySourceHashes,
      unresolvedSectionSummarySectionIds,
      conversationMismatch,
      bindingMismatch
    },
    counts: {
      capture: rawCapture ? 1 : 0,
      turns: rawTurns.length,
      sections: rawSections.length,
      sectionSummaries: rawSummaries.length,
      sessionMemory: rawMemory ? 1 : 0
    },
    integrity: {
      algorithm: "SHA-256",
      canonicalization: "stableStringify",
      recordDigests,
      aggregateDigest
    }
  };
}
