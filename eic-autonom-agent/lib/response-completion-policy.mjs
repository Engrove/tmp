export function responseEligibleForNano(run = {}, page = {}) {
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
