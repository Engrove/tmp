export function responseEligibleForNano(run = {}, page = {}) {
  // v0.11.19: rendered assistant text has one canonical extraction boundary.
  // Stable DOM reads are not sufficient when the extractor itself reports that
  // it could not preserve the complete rendered response. Incomplete extraction
  // must never reach baseline parsing/Nano and must not consume correction budget.
  if (page?.latestAssistantExtractionComplete === false) {
    return { eligible: false, reason: "CANONICAL_RESPONSE_EXTRACTION_INCOMPLETE" };
  }
  const mode = String(run?.mode || "");
  const specialized = mode === "ARCHAEOLOGY_LONG" || mode === "APP_AUDIT_LONG";
  if (!specialized) return { eligible: true, reason: "GENERAL_DYNAMIC_STABILITY_ALLOWED" };
  if (page?.latestAssistantComplete === true) {
    return { eligible: true, reason: "STRICT_UI_IDLE" };
  }
  if (page?.foregroundSignals?.protocolCompletionOverride === true) {
    return { eligible: true, reason: "PROTOCOL_COMPLETION_OVERRIDE" };
  }
  return { eligible: false, reason: "SPECIALIZED_MODE_REQUIRES_CONFIRMED_COMPLETION" };
}
