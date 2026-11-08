// Runtime-owned provenance and lossless context. Advisory previews are never
// authoritative replacements for the full instruction or current evidence.
export function analysisSource(process) {
  return { processId: String(process?.processId || ""), generation: Number(process?.generation || 0),
    turn: Number(process?.turn || 0), promptHash: String(process?.lastPrompt?.hash || ""),
    responseHash: String(process?.lastResponse?.hash || "") };
}

export function retainedObjectiveContext(process) {
  const response = process?.lastResponse?.contract;
  const canonical = response?.ok ? response.value : response?.controlOk ? response.control : null;
  if (String(canonical?.nextSuggestedAction || "").trim()) return null;
  const prior = process?.continuationContext || process?.lastPrompt?.a2a?.continuity?.retainedObjective;
  if (prior?.objective) return { ...prior };
  const objective = String(process?.lastPrompt?.a2a?.objective || process?.objectiveState?.objective || "").trim();
  if (!objective) return null;
  return { objective, source: analysisSource(process),
    interpretation: "CONSTRAINT_CONTEXT_NOT_A_REPLAY_REQUEST",
    rule: "Preserve applicable scope, prohibitions and owner constraints from this full instruction. Reconcile fresh owner state and completed effects before choosing the next bounded step. Old interaction numbers and checkpoint actions are historical; current control.workQueue owns this turn. Never replay the old instruction merely because it is retained here." };
}

export function withoutStaleQueueLabel(value) {
  return String(value || "").replace(/^\s*QUEUE INTERACTION\s+\d+\s*\/\s*\d+[^:\n]{0,100}:\s*/iu, "").trim();
}

const normalized = value => String(value || "").replace(/\s+/g, " ").trim();
const absent = value => /^(?:UNKNOWN|NO_NEW_PROGRESS|NONE_OBSERVED|NONE|N\/A)$/i.test(normalized(value));
export function currentEvidenceContains(evidence, quote) {
  const q = normalized(quote);
  return Boolean(q && !absent(q) && normalized(evidence).includes(q));
}

// Quotes establish provenance, not truth. Unsupported advisory progress is
// explicitly unknown and cannot certify a completed objective.
export function bindAdvisoryEvidence(decision, { evidence = "", source = null } = {}) {
  const d = { ...decision };
  const corrections = [];
  for (const field of ["progressEvidence", "ownerEvidence"]) {
    if (!currentEvidenceContains(evidence, d[field]) && !absent(d[field])) {
      d[field] = "UNKNOWN";
      corrections.push(`${field === "progressEvidence" ? "PROGRESS" : "OWNER"}_EVIDENCE_NOT_IN_CURRENT_INPUT`);
    }
  }
  if (absent(d.progressEvidence)) {
    if (d.objectiveStatus === "SATISFIED") d.objectiveStatus = "PENDING";
    if (d.confidence === "HIGH") d.confidence = "LOW";
  }
  if (corrections.length) {
    d.analysis = "The supplied current-response evidence does not substantiate the advisory progress claim. Preserve the full mission context and reconcile fresh owner state before the next effect.";
    d.confidence = "LOW";
  }
  d.evidenceSource = source ? { ...source } : null;
  d.progressEvidenceStatus = absent(d.progressEvidence) ? "NO_CURRENT_EVIDENCE" : "CURRENT_RESPONSE_QUOTE";
  return { decision: d, corrections };
}
