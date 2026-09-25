// v1.8.5 saved-mission catalog.
//
// A saved mission's identity is its GFW key, read only from the first line
// ("Projekt: 63 - Greenfield - Gf: GF-001."). Bodies may name other missions
// (the GF-WC texts name GF-008), so the rest of the text never decides
// identity. Queue slots and queue sets reference a saved mission through
// savedMissionId; the text they carry is a fallback copy that is resolved to
// the saved mission's current text. Pure functions only: no chrome.* access.

export const SAVED_MISSION_EXPORT_SCHEMA = "eic.greenfield.saved-missions-export.v1";

const KEY_TAGGED = /\bGf\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9])/i;
const KEY_BARE = /\bGF-[A-Za-z0-9_-]*[A-Za-z0-9]/i;
const KEY_SHAPE = /^GF-[A-Z0-9_-]*\d[A-Z0-9_-]*$/;
const IMPORT_HEADING = /^#{2,4}[ \t]+(\S+)[ \t]*$/;
const PROJECT_HEADER = /^Pro(?:jekt|ject)\s*:\s*(\d+)\s*[-–]\s*(.+?)(?:\s*[-–]\s*Gf\s*:\s*[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9])?\s*\.?\s*$/i;

function firstLine(goal) {
  return String(goal ?? "").trim().split(/\r?\n/, 1)[0].trim();
}

function timestampValue(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

/** First-line GFW key, upper case ("GF-001", "GF-WC-RE-001"); "" when absent. */
export function savedMissionKey(goal) {
  const line = firstLine(goal);
  const tagged = line.match(KEY_TAGGED);
  const candidate = (tagged ? tagged[1] : line.match(KEY_BARE)?.[0] || "").toUpperCase();
  return KEY_SHAPE.test(candidate) ? candidate : "";
}

/** "Projekt: 63 - Greenfield - Gf: GF-001." -> { projectId: 63, projectName: "Greenfield" }. */
export function savedMissionProject(goal) {
  const match = firstLine(goal).match(PROJECT_HEADER);
  if (!match) return null;
  return { projectId: Number(match[1]), projectName: match[2].trim() };
}

/** Operator-facing option text: "GF-001 · 63 Greenfield", else the stored label. */
export function savedMissionDisplayLabel(record) {
  const key = savedMissionKey(record?.goal);
  const project = savedMissionProject(record?.goal);
  const fallback = String(record?.label || firstLine(record?.goal).slice(0, 80) || "Sparat uppdrag");
  if (key && project) return `${key} · ${project.projectId} ${project.projectName}`;
  if (key) return `${key} · ${fallback}`;
  return fallback;
}

/** Records grouped by key, newest updatedAt first. Records without key are left out. */
export function savedMissionsByKey(savedMissions) {
  const groups = new Map();
  for (const record of Array.isArray(savedMissions) ? savedMissions : []) {
    const key = savedMissionKey(record?.goal);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt));
  }
  return groups;
}

function parseJsonImport(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { ok: false, format: "JSON", missions: [], errors: [{ code: "IMPORT_JSON_INVALID" }], ignoredLines: 0 };
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.missions) ? parsed.missions
      : Array.isArray(parsed?.savedMissions) ? parsed.savedMissions : null;
  if (!rows) {
    return { ok: false, format: "JSON", missions: [], errors: [{ code: "IMPORT_JSON_NO_MISSIONS" }], ignoredLines: 0 };
  }
  const missions = [];
  const errors = [];
  rows.forEach((row, index) => {
    const goal = String(typeof row === "string" ? row : row?.goal || "").replace(/\r\n?/g, "\n").trim();
    const key = savedMissionKey(goal);
    if (!goal) errors.push({ code: "IMPORT_EMPTY_BODY", index });
    else if (!key) errors.push({ code: "IMPORT_KEY_MISSING", index });
    else missions.push({ key, goal, index });
  });
  return { ok: errors.length === 0, format: "JSON", missions, errors, ignoredLines: 0 };
}

function parseMarkdownImport(source) {
  const lines = source.split("\n");
  const sections = [];
  let current = null;
  let preambleLines = 0;
  lines.forEach((line, index) => {
    const heading = line.match(IMPORT_HEADING);
    if (heading) {
      current = { heading: heading[1].replace(/[.:]+$/, "").toUpperCase(), line: index + 1, body: [] };
      sections.push(current);
      return;
    }
    if (current) current.body.push(line.trimEnd());
    else if (line.trim()) preambleLines += 1;
  });

  const missions = [];
  const errors = [];
  const seen = new Set();
  if (!sections.length) errors.push({ code: "IMPORT_NO_SECTIONS" });
  for (const section of sections) {
    // The mission text is the first contiguous block of non-empty lines after
    // the heading; anything after a blank line is reported, never imported.
    let start = 0;
    while (start < section.body.length && !section.body[start].trim()) start += 1;
    let end = start;
    while (end < section.body.length && section.body[end].trim()) end += 1;
    const goal = section.body.slice(start, end).join("\n").trim();
    const ignoredLines = section.body.slice(end).filter((line) => line.trim()).length;
    const key = savedMissionKey(goal);
    const at = { heading: section.heading, line: section.line };
    if (!KEY_SHAPE.test(section.heading)) errors.push({ code: "IMPORT_HEADING_NOT_A_KEY", ...at });
    else if (!goal) errors.push({ code: "IMPORT_EMPTY_BODY", ...at });
    else if (key !== section.heading) errors.push({ code: "IMPORT_HEADING_KEY_MISMATCH", key, ...at });
    else if (seen.has(key)) errors.push({ code: "IMPORT_DUPLICATE_KEY", ...at });
    else {
      seen.add(key);
      missions.push({ key, goal, line: section.line, ignoredLines });
    }
  }
  return {
    ok: errors.length === 0,
    format: "MARKDOWN",
    missions,
    errors,
    preambleLines,
    ignoredLines: missions.reduce((sum, row) => sum + row.ignoredLines, 0)
  };
}

/**
 * Parse an operator import. Markdown: "### GF-001" headings, each followed by
 * the mission text. JSON: an array of missions, {missions:[…]} (our export) or
 * {savedMissions:[…]}. Any error makes the whole import inapplicable.
 */
export function parseSavedMissionImport(value) {
  const source = String(value ?? "").replace(/\r\n?/g, "\n");
  const trimmed = source.trim();
  if (!trimmed) {
    return { ok: false, format: "EMPTY", missions: [], errors: [{ code: "IMPORT_EMPTY" }], ignoredLines: 0 };
  }
  const parsed = trimmed.startsWith("{") || trimmed.startsWith("[")
    ? parseJsonImport(trimmed)
    : parseMarkdownImport(source);
  const seen = new Set();
  const duplicates = parsed.missions.filter((row) => {
    if (seen.has(row.key)) return true;
    seen.add(row.key);
    return false;
  });
  if (!duplicates.length) return parsed;
  return {
    ...parsed,
    ok: false,
    errors: [...parsed.errors, ...duplicates.map((row) => ({ code: "IMPORT_DUPLICATE_KEY", heading: row.key }))]
  };
}

/**
 * Plan an import against the current saved missions. Matching is by key only.
 * Several saved records with one key are duplicates: the newest is the target,
 * the others are merged into it when mergeDuplicates is on. Saved missions not
 * in the import are kept.
 */
export function planSavedMissionImport(savedMissions, importedMissions, {
  maxSavedMissions = 64,
  mergeDuplicates = true
} = {}) {
  const existing = Array.isArray(savedMissions) ? savedMissions : [];
  const groups = savedMissionsByKey(existing);
  const imported = Array.isArray(importedMissions) ? importedMissions : [];
  const importedKeys = new Set(imported.map((row) => row.key));
  const rows = [];
  const counts = { create: 0, update: 0, unchanged: 0, duplicates: 0, keptNotInImport: 0, keptWithoutKey: 0 };

  for (const mission of imported) {
    const candidates = groups.get(mission.key) || [];
    if (!candidates.length) {
      rows.push({ key: mission.key, action: "CREATE", goal: mission.goal, targetId: "", duplicateIds: [] });
      counts.create += 1;
      continue;
    }
    const target = candidates[0];
    const duplicateIds = candidates.slice(1).map((record) => record.id);
    const action = target.goal === mission.goal ? "UNCHANGED" : "UPDATE";
    rows.push({
      key: mission.key,
      action,
      goal: mission.goal,
      previousGoal: target.goal,
      targetId: target.id,
      duplicateIds
    });
    counts[action === "UPDATE" ? "update" : "unchanged"] += 1;
    counts.duplicates += duplicateIds.length;
  }
  for (const record of existing) {
    const key = savedMissionKey(record?.goal);
    if (!key) counts.keptWithoutKey += 1;
    else if (!importedKeys.has(key)) counts.keptNotInImport += 1;
  }

  const finalCount = existing.length + counts.create - (mergeDuplicates ? counts.duplicates : 0);
  const withinLimit = finalCount <= maxSavedMissions;
  const changes = counts.create + counts.update + (mergeDuplicates ? counts.duplicates : 0);
  return {
    ok: withinLimit,
    error: withinLimit ? "" : "SAVED_MISSION_LIMIT_REACHED",
    mergeDuplicates: mergeDuplicates === true,
    rows,
    counts,
    changes,
    finalCount,
    maxSavedMissions
  };
}

/**
 * Resolve a queue slot or set template to its saved mission. A reference is
 * savedMissionId (following merges). Only a stale reference (an id that no
 * longer exists) may be re-linked by key, and only to exactly one record; a
 * slot without savedMissionId (ad hoc or AI-delegated text) is never resolved.
 */
export function resolveSavedMissionReference(ref, savedMissions, { merged = {} } = {}) {
  const originalId = String(ref?.savedMissionId || "").trim();
  if (!originalId) return { record: null, via: "NONE", ambiguous: false };
  const records = Array.isArray(savedMissions) ? savedMissions : [];
  const mergedId = String(merged?.[originalId] || "").trim();
  const id = mergedId || originalId;
  const byId = records.find((record) => record?.id === id);
  if (byId) return { record: byId, via: mergedId ? "MERGED" : "ID", ambiguous: false };
  const key = savedMissionKey(ref?.goal);
  if (!key) return { record: null, via: "NONE", ambiguous: false };
  const candidates = savedMissionsByKey(records).get(key) || [];
  if (candidates.length === 1) return { record: candidates[0], via: "KEY", ambiguous: false };
  return { record: null, via: "NONE", ambiguous: candidates.length > 1 };
}

/**
 * Bring template/slot items in line with the saved missions. Returns new item
 * objects (inputs untouched) and one change row per item that changed.
 */
export function reconcileItemsWithSavedMissions(items, savedMissions, { merged = {} } = {}) {
  const changes = [];
  const unresolved = [];
  const out = (Array.isArray(items) ? items : []).map((item, index) => {
    const resolved = resolveSavedMissionReference(item, savedMissions, { merged });
    if (!resolved.record) {
      if (String(item?.savedMissionId || "").trim()) {
        unresolved.push({ index, savedMissionId: String(item.savedMissionId), ambiguous: resolved.ambiguous });
      }
      return item;
    }
    const record = resolved.record;
    const goalChanged = String(item.goal || "") !== record.goal;
    const idChanged = String(item.savedMissionId || "") !== record.id;
    const labelChanged = String(item.label || "") !== String(record.label || item.label || "");
    if (!goalChanged && !idChanged && !labelChanged) return item;
    changes.push({
      index,
      via: resolved.via,
      fromId: String(item.savedMissionId || ""),
      toId: record.id,
      key: savedMissionKey(record.goal),
      goalChanged
    });
    return {
      ...item,
      savedMissionId: record.id,
      label: record.label || item.label,
      goal: record.goal
    };
  });
  return { items: out, changes, unresolved };
}

/** Lossless export that parseSavedMissionImport accepts. */
export function buildSavedMissionExport(savedMissions, { now = Date.now() } = {}) {
  const missions = (Array.isArray(savedMissions) ? savedMissions : []).map((record) => ({
    id: String(record?.id || ""),
    key: savedMissionKey(record?.goal),
    label: String(record?.label || ""),
    goal: String(record?.goal || ""),
    createdAt: String(record?.createdAt || ""),
    updatedAt: String(record?.updatedAt || "")
  }));
  return {
    schema: SAVED_MISSION_EXPORT_SCHEMA,
    exportedAt: new Date(now).toISOString(),
    count: missions.length,
    missions
  };
}

/**
 * Cleanup view: every saved mission, flagged when it is an older duplicate of
 * a newer record with the same key (keeperId = that record) or has no key.
 * Flagged rows first. Nothing here deletes; the operator selects.
 */
export function savedMissionCleanupRows(savedMissions) {
  const records = Array.isArray(savedMissions) ? savedMissions : [];
  const keeperById = new Map();
  for (const rows of savedMissionsByKey(records).values()) {
    for (const record of rows.slice(1)) keeperById.set(record.id, rows[0].id);
  }
  const reasonRank = { DUPLICATE: 0, NO_KEY: 1, "": 2 };
  return records
    .map((record) => {
      const key = savedMissionKey(record?.goal);
      const reason = keeperById.has(record.id) ? "DUPLICATE" : key ? "" : "NO_KEY";
      return {
        id: String(record.id),
        key,
        label: savedMissionDisplayLabel(record),
        updatedAt: String(record.updatedAt || ""),
        reason,
        keeperId: keeperById.get(record.id) || ""
      };
    })
    .sort((a, b) => reasonRank[a.reason] - reasonRank[b.reason] ||
      a.label.localeCompare(b.label, "sv", { numeric: true }) ||
      timestampValue(b.updatedAt) - timestampValue(a.updatedAt));
}
