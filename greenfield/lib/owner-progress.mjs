import { boundedJsonRequest } from "./bounded-request.mjs";
import { runtimeControlTarget } from './runtime-control.mjs';

// This is a READ adapter for canonical EIC state, not another VTF or planner.
// Only the operator-configured, existing EIC origin is contacted. AI evidence
// strings, DOM ownerTrusted and advisory-model output never enter this reader.
export const OWNER_PROGRESS_SCHEMA = 'eic.greenfield.owner-progress.v1';
export const OWNER_PROGRESS_TIMEOUT_MS = 5000;
const MAX_BYTES = 32768;
const token = (x, max = 500) => typeof x === 'string' && x.length > 0 && x.length <= max;
export function normalizeOwnerProgressEndpoint(value) {
  if (!value) return '';
  try {
    const u = new URL(String(value));
    return u.origin === 'https://api.elho.fi' && u.pathname.startsWith('/greenfield/') &&
      !u.username && !u.password && !u.search && !u.hash ? u.href : '';
  } catch { return ''; }
}
export function ownerProgressRequest(process, requestId = crypto.randomUUID()) {
  return { schema: OWNER_PROGRESS_SCHEMA, requestId, target: runtimeControlTarget(process),
    missionRef: String(process.goal || '').match(/\bGF-\d+\.\d+\.\d+\b/)?.[0] || '',
    promptHash: String(process.lastPrompt?.hash || ''), responseHash: String(process.lastResponse?.hash || ''),
    rootRef: String(process.ownerProgress?.root?.ref || '') };
}
export function validateOwnerProgress(value, request, { now = Date.now() } = {}) {
  const fail = code => ({ ok: false, code });
  const v = value;
  if (!v || v.schema !== OWNER_PROGRESS_SCHEMA || v.requestId !== request.requestId) return fail('OWNER_RECEIPT_IDENTITY');
  for (const key of ['runId','turn','queueId','itemId','savedMissionId']) {
    if (v.target?.[key] !== request.target[key]) return fail('OWNER_RECEIPT_TARGET');
  }
  if (v.missionRef !== request.missionRef || v.promptHash !== request.promptHash || v.responseHash !== request.responseHash)
    return fail('OWNER_RECEIPT_SOURCE');
  if (!token(v.receiptId) || !token(v.stateRevision) || !Number.isSafeInteger(v.observedAtMs) ||
      !Number.isSafeInteger(v.expiresAtMs) || v.observedAtMs > now + 5000 || now - v.observedAtMs > 120000 ||
      v.expiresAtMs <= now || v.expiresAtMs - v.observedAtMs > 120000) return fail('OWNER_RECEIPT_EXPIRED');
  const root = v.root;
  if (!root || !token(root.ref) || !token(root.revision) || !token(root.obligationsRef) || root.frozen !== true ||
      !['OPEN','CLOSED'].includes(root.status)) return fail('OWNER_ROOT_UNPROVEN');
  // A pending instruction (including one that mentions scope) is not a verified
  // owner rebinding. This read protocol has no root-change authorization path.
  // Preserve the first bound root through analysis, WAIT and session rotation.
  if (request.rootRef && request.rootRef !== root.ref) return fail('OWNER_ROOT_CHANGED');
  if (!['NEXT','WAIT','CLOSURE_READY'].includes(v.disposition)) return fail('OWNER_DISPOSITION_INVALID');
  if (!Array.isArray(v.openObligations) || v.openObligations.length > 100 || !v.openObligations.every(x => token(x)) ||
      new Set(v.openObligations).size !== v.openObligations.length) return fail('OWNER_OBLIGATIONS_INVALID');
  if (v.disposition === 'NEXT') {
    const n = v.next;
    if (root.status !== 'OPEN' || !n || !token(n.actionId) || !token(n.obligationRef) || !v.openObligations.includes(n.obligationRef) ||
        !token(n.objective,12000) || !token(n.idempotencyKey) || n.dependencyReady !== true || n.authorized !== true ||
        !['R0','R1','R2','R3'].includes(n.risk) || (n.risk === 'R2' && !token(n.safeguardRef)) ||
        (n.risk === 'R3' && !token(n.authorizationRef))) return fail('OWNER_NEXT_UNPROVEN');
    if (v.effectsReconciled !== true && n.reconciliationOnly !== true) return fail('OWNER_EFFECT_UNKNOWN');
  }
  if (v.disposition === 'WAIT' && (!v.wait || !token(v.wait.code) || !token(v.wait.resumeCondition,2000) ||
      !token(v.wait.eventRef) || !Number.isSafeInteger(v.wait.recheckAfterSeconds) ||
      v.wait.recheckAfterSeconds < 300 || v.wait.recheckAfterSeconds > 21600)) return fail('OWNER_WAIT_INVALID');
  if (v.disposition === 'CLOSURE_READY' && (root.status !== 'CLOSED' || v.openObligations.length !== 0 ||
      v.effectsReconciled !== true || root.mandatorySatisfied !== true || root.integrationVerified !== true ||
      root.cleanupVerified !== true || root.ownerAccepted !== true || !token(root.acceptanceRef))) return fail('OWNER_CLOSURE_UNPROVEN');
  return { ok: true, code: v.disposition, receipt: structuredClone(v) };
}
export async function readOwnerProgress(process, endpoint, { fetchImpl = fetch, now = Date.now } = {}) {
  const base = normalizeOwnerProgressEndpoint(endpoint);
  if (!base) return { ok: false, code: 'OWNER_PROGRESS_NOT_CONFIGURED' };
  const request = ownerProgressRequest(process);
  if (!request.promptHash || !request.responseHash || !process.lastPrompt?.acknowledged ||
      !process.lastResponse?.observation?.causalMatch || !process.lastResponse?.observation?.ownerTrusted)
    return { ok:false, code:'OWNER_SOURCE_UNPROVEN' };
  try {
    // POST is a read-only query here, so private identifiers never enter URL or
    // ordinary access logs. The EIC route must not commit any mutation.
    const response = await boundedJsonRequest(base,{method:'POST',credentials:'include',cache:'no-store',redirect:'error',
      headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(request)}, {fetchImpl,timeoutMs:OWNER_PROGRESS_TIMEOUT_MS,maxBytes:MAX_BYTES});
    if (!response.ok) return {ok:false,code:`OWNER_HTTP_${response.status}`};
    return validateOwnerProgress(response.body,request,{now:now()});
  } catch { return {ok:false,code:'OWNER_READ_FAILED'}; }
}
export function ownerContinuation(receipt) {
  if (receipt?.disposition !== 'NEXT') return '';
  return `${receipt.next.objective}\nOwner action: ${receipt.next.actionId}; obligation: ${receipt.next.obligationRef}; effect idempotency key: ${receipt.next.idempotencyKey}. Reconcile this key before any retry; preserve already accepted partial results.`;
}
export function ownerWaitRecord(previous, verdict, now = Date.now()) {
  const receipt = verdict?.ok ? verdict.receipt : null;
  const attempts = Math.min(30, Number(previous?.attempts || 0) + 1);
  const seconds = receipt?.wait?.recheckAfterSeconds || Math.min(21600,300 * 2 ** Math.min(6,attempts-1));
  return { state:'WAIT',code:receipt?.wait?.code || verdict?.code || 'NO_EXECUTABLE_OWNER_ACTION',
    resumeCondition:receipt?.wait?.resumeCondition || 'An authenticated EIC owner read supplies a new dependency-ready action or verified terminal closure.',
    eventRef:receipt?.wait?.eventRef || 'EIC_OWNER_PROGRESS_AVAILABLE',attempts,
    stateRevision:receipt?.stateRevision || previous?.stateRevision || '',
    nextCheckAtMs:now + seconds*1000 };
}
export function appendProgressEvidence(state, receipt, source, now = Date.now()) {
  const rows = Array.isArray(state) ? state : [];
  const key = `${source.runId}:${source.turn}:${source.responseHash}:${receipt.receiptId}`;
  if (rows.some(x=>x.key===key)) return rows;
  return [...rows,{key,atMs:now,source,receiptId:receipt.receiptId,rootRef:receipt.root.ref,
    rootRevision:receipt.root.revision,stateRevision:receipt.stateRevision,
    previousOpenObligations:rows.at(-1)?.openObligations || null,
    openObligations:receipt.openObligations,disposition:receipt.disposition,
    nextActionId:receipt.next?.actionId || '',effectKey:receipt.next?.idempotencyKey || '',
    waitCode:receipt.wait?.code || ''}].slice(-64);
}
