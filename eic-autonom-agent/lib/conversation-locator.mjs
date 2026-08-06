import {
  conversationKeyFromUrl,
  deepClone
} from "./common.mjs";

/**
 * Repair legacy conversation locators that used the Custom GPT id instead of
 * the exact /c/<conversation-id> locator. The linked tab URL is the local
 * browser owner for this migration. Ambiguous continuity mappings fail closed.
 */
export function upgradeConversationLocators(runtimeValue, continuityValue) {
  const runtime = deepClone(runtimeValue || {});
  const continuity = deepClone(continuityValue || {});
  const mappings = new Map();
  let runtimeChanged = false;
  let continuityChanged = false;

  for (const context of Object.values(runtime.windows || {})) {
    const linkedTabs = context?.linkedTabs || {};
    for (const record of Object.values(linkedTabs)) {
      const exact = conversationKeyFromUrl(record?.url || "");
      const prior = String(record?.conversationKey || "");
      if (!exact || exact === prior) continue;
      if (prior) {
        if (!mappings.has(prior)) mappings.set(prior, new Set());
        mappings.get(prior).add(exact);
      }
      record.conversationKey = exact;
      runtimeChanged = true;
    }

    const run = context?.run;
    if (run && Number.isInteger(run.targetTabId)) {
      const target = linkedTabs[String(run.targetTabId)];
      const exact = target?.conversationKey || conversationKeyFromUrl(target?.url || "");
      if (exact && run.conversationKey !== exact) {
        if (run.conversationKey) {
          if (!mappings.has(run.conversationKey)) mappings.set(run.conversationKey, new Set());
          mappings.get(run.conversationKey).add(exact);
        }
        run.conversationKey = exact;
        run.takeoverBootstrapRequired = true;
        runtimeChanged = true;
      }
    }
  }

  const priorContinuityKey = String(continuity?.position?.conversationKey || "");
  const candidates = mappings.get(priorContinuityKey);
  if (priorContinuityKey && candidates?.size === 1) {
    continuity.position.conversationKey = [...candidates][0];
    continuityChanged = true;
  }

  return {
    runtime,
    continuity,
    changed: runtimeChanged || continuityChanged,
    runtimeChanged,
    continuityChanged,
    ambiguousContinuityLocator: Boolean(priorContinuityKey && candidates?.size > 1)
  };
}
