import './safety-policy.js';

// Observation age is a request to observe again, never proof of a bad model.
// Keep the original policy TTL and selection receipt checks unchanged.
export const REFRESHABLE_MODEL_CODES = new Set(['MODEL_EVIDENCE_STALE', 'MODEL_EVIDENCE_MISSING']);

export async function refreshModelEvidence(page, policy, {
  read, expectedVersion, gptRoot = '', stage = '', requireHighestEffort = true,
  now = () => Date.now(), evaluate = globalThis.GreenfieldSafetyPolicy.evaluateModel
} = {}) {
  const evaluatePage = value => evaluate(value?.modelEvidence, policy, {
    now: now(), url: value?.url || '', gptRoot, requireHighestEffort
  });
  const initial = evaluatePage(page);
  if (!REFRESHABLE_MODEL_CODES.has(initial.code)) return {page, proof:initial, refreshed:false, attempted:false};

  const started = now();
  const priorAgeMs = Number.isFinite(page?.modelEvidence?.observedAtMs)
    ? started - page.modelEvidence.observedAtMs : null;
  const denied = code => ({page, refreshed:false, attempted:true, proof:{allowed:false, code,
    detail:`${stage} age=${priorAgeMs ?? 'missing'}ms refresh=${now()-started}ms`}});
  try {
    const result = await read({documentId:page?.documentId || '', expectedUrl:page?.url || ''});
    if (!result?.ok) return denied((REFRESHABLE_MODEL_CODES.has(result?.code) || result?.code==='MODEL_EVIDENCE_CONTEXT_CHANGED') ? result.code : 'MODEL_EVIDENCE_REFRESH_UNAVAILABLE');
    // A refreshed model observation must not be joined to another document's
    // composer or conversation observation. A normal next tick re-reads it.
    if (!page?.documentId || result.documentId !== page.documentId || result.url !== page.url ||
        expectedVersion && result.bridgeVersion !== expectedVersion)
      return denied('MODEL_EVIDENCE_CONTEXT_CHANGED');
    const fresh = {...page, modelEvidence:result.modelEvidence};
    const proof = evaluatePage(fresh);
    return {page:fresh, proof, refreshed:true, attempted:true, stage, priorAgeMs, elapsedMs:now()-started};
  } catch {
    return denied('MODEL_EVIDENCE_REFRESH_UNAVAILABLE');
  }
}
