import "./safety-policy.js";
import { usagePeriods } from "./usage-periods.mjs";
import { readCheckpoint, writeCheckpoint, storageLock, registerLegacyCheckpointCodec } from "./durable-checkpoint.mjs";
const S = globalThis.GreenfieldSafetyPolicy;
export const SAFETY_KEY = "eic.gf.safety.v1";
const WEEK = 7 * 86400000;
const clone = (v) => JSON.parse(JSON.stringify(v));
// Reconstruct RC1's first-write key order only. The checkpoint reader also
// requires semantic equality and an exact match to the OLD hash.
const order=(value,keys)=>value && typeof value==="object" ? Object.fromEntries([...keys.filter(k=>Object.hasOwn(value,k)),...Object.keys(value).filter(k=>!keys.includes(k))].map(k=>[k,value[k]])) : value;
registerLegacyCheckpointCodec(SAFETY_KEY,value=>{
  const v=order(value,["schema","policy","admissionPaused","providerHold","entries","events","createdAtMs","lastClockMs","lastAuthorizedAtMs","lastAuthorizedDispatchId"]);
  v.policy=order(v.policy,Object.keys(S.defaults));
  v.providerHold=order(v.providerHold,["sourceWorkerId","multipleSources","signature","reason","text","observedAtMs","resetAtMs","resetConfidence","goodProbeAtMs"]);
  v.entries=v.entries?.map(e=>order(e,["id","processId","workerId","atMs","inputTokens","reserveTokens","outputTokens","completedAtMs","model","effort","authorizedAtMs"]));
  v.events=v.events?.map(e=>order(e,["atMs","code","detail"]));
  return v;
});
export function usageIdentity(process, prompt) {
  const identity = [process.runId, process.sessionSeq, process.turn, prompt?.hash || ""];
  // Distinct short retries carry identical text but each is a real provider
  // message. Charge each durable transport operation exactly once.
  if (prompt?.transportId) identity.push(prompt.transportId);
  return identity.join(":");
}
export async function readSafety(storage = chrome.storage.local) {
  const record = await readCheckpoint(SAFETY_KEY, storage);
  if (record.health === "RECOVERY_REQUIRED") throw new Error("SAFETY_JOURNAL_RECOVERY_REQUIRED");
  if (!record.value) return { schema: "eic.gf.safety.v1", policy: { ...S.defaults }, admissionPaused: false, providerHold: null, entries: [], events: [], usageEpoch: 0, createdAtMs: Date.now(), lastClockMs: 0 };
  const v = record.value;
  if (v.schema !== "eic.gf.safety.v1" || !Array.isArray(v.entries) || !Array.isArray(v.events)) throw new Error("SAFETY_JOURNAL_INVALID");
  S.normalizePolicy(v.policy);
  const validEpoch = value => value === undefined || (Number.isSafeInteger(value) && value >= 0);
  if (!validEpoch(v.usageEpoch) || v.entries.some(e=>!validEpoch(e.usageEpoch) || (e.usageEpoch ?? 0) > (v.usageEpoch ?? 0))) throw new Error("SAFETY_USAGE_EPOCH_INVALID");
  if (v.entries.some(e => !e.id || !Number.isFinite(e.atMs) || !Number.isFinite(e.inputTokens) || e.inputTokens < 0 || !Number.isFinite(e.reserveTokens) || e.reserveTokens < 0 || !Number.isFinite(e.outputTokens) || e.outputTokens < 0)) throw new Error("SAFETY_USAGE_ENTRY_INVALID");
  return v;
}
async function change(storage, work) {
  return storageLock(storage, `${SAFETY_KEY}.transaction`, async () => {
    const value = clone(await readSafety(storage));
    const result = await work(value);
    if (result?.unchanged !== true) await writeCheckpoint(SAFETY_KEY, value, storage);
    return result?.value ?? value;
  });
}
function event(v, code, detail = "", now = Date.now()) {
  v.events.push({ atMs: now, code, detail: String(detail).slice(0,400) });
  v.events = v.events.slice(-200);
}
// Before authorization the reservation consumes budget. Once authorized, its
// first send authorization fixes its calendar period, including late answers.
const usageAtMs = e => Number.isFinite(e.authorizedAtMs) ? e.authorizedAtMs : e.atMs;
// Manual resets change accounting only. Old receipts remain available for
// idempotency and late answers; absent epochs belong to the original journal.
const currentUsageRows = v => v.entries.filter(e=>(e.usageEpoch ?? 0)===(v.usageEpoch ?? 0));
function retainedUsageRows(v, now) {
  const cutoff = Math.min(now-WEEK,usagePeriods(now).weekStartAtMs);
  // A 25-hour Sunday must not prune Monday's usage before the week ends.
  // Unfinished receipts survive period changes and remain idempotent.
  return v.entries.filter(e=>usageAtMs(e)>=cutoff || !e.completedAtMs);
}
export function usageSummary(v, now = Date.now()) {
  const periods = usagePeriods(now);
  const rows = currentUsageRows(v);
  const day = rows.filter(e=>usageAtMs(e)>=periods.dayStartAtMs);
  const week = rows.filter(e=>usageAtMs(e)>=periods.weekStartAtMs);
  return {
    scope: "GREENFIELD_THIS_EXTENSION_PROFILE", exactProviderUsage: false,
    // Keep existing field names for saved settings/backups and API consumers.
    // Their calendar basis and exact reset instants are explicit in periods.
    periods, usageEpoch: v.usageEpoch ?? 0, usageResetAtMs: v.usageResetAtMs ?? null,
    messages3h: rows.filter(e=>now-usageAtMs(e)<3*3600000).length,
    messages24h: day.length, messages7d: week.length,
    inputTokens24h: day.reduce((n,e) => n + e.inputTokens, 0),
    outputTokens24h: day.reduce((n,e) => n + e.outputTokens, 0),
    chargedTokens24h: day.reduce((n,e) => n + e.inputTokens + Math.max(e.outputTokens, e.reserveTokens), 0),
    pendingCount: v.entries.filter(e => !e.completedAtMs).length,
    lastDispatchAtMs: Math.max(0, ...v.entries.map(e => e.atMs)),
    policy: v.policy, policyUpdatedAtMs: Number(v.policyUpdatedAtMs || 0) || null, policyOrigin: v.policyOrigin || "",
    admissionPaused: v.admissionPaused, providerHold: v.providerHold,
    createdAtMs: v.createdAtMs, events: v.events.slice(-40)
  };
}
function quotaDecision(v, inputTokens, reserveTokens, now, excludeId=null) {
  const state = excludeId == null ? v : {...v,entries:v.entries.filter(e=>e.id!==excludeId)};
  const summary = usageSummary(state,now), policy = v.policy;
  const deny = (code,retryAtMs) => ({allowed:false,code,retryAtMs});
  if(summary.messages3h>=policy.messages3h) {
    const times = currentUsageRows(state).filter(e=>now-usageAtMs(e)<3*3600000).map(usageAtMs).sort((a,b)=>a-b);
    return deny("LOCAL_MESSAGES3H_BUDGET",times[Math.max(0,times.length-policy.messages3h)]+3*3600000+1);
  }
  if(summary.messages24h>=policy.messages24h)return deny("LOCAL_MESSAGES24H_BUDGET",summary.periods.nextDayAtMs);
  if(summary.messages7d>=policy.messages7d)return deny("LOCAL_MESSAGES7D_BUDGET",summary.periods.nextWeekAtMs);
  if(summary.chargedTokens24h+inputTokens+reserveTokens>policy.tokens24h)
    return deny("LOCAL_TOKENS24H_BUDGET",inputTokens+reserveTokens<=policy.tokens24h ? summary.periods.nextDayAtMs : null);
  return {allowed:true};
}
export function budgetDecision(v, id, prompt, now = Date.now()) {
  const policy = v.policy;
  const deny = (code, retryAtMs = null) => ({ allowed: false, code, retryAtMs });
  if (now < Number(v.lastClockMs || 0) - 60000) return deny("SYSTEM_CLOCK_ROLLBACK", v.lastClockMs + 60000);
  if (v.admissionPaused) return deny("OPERATOR_ADMISSION_PAUSED");
  if (v.providerHold) return deny("PROVIDER_QUOTA_HOLD", v.providerHold.resetAtMs);
  if (v.entries.some(e => e.id === id)) return { allowed: true, code: "USAGE_ALREADY_RESERVED" };
  const inputTokens = S.estimateTokens(prompt).estimate;
  if (inputTokens > policy.maxPromptTokens) return deny("PROMPT_LOCAL_TOKEN_BUDGET");
  const summary = usageSummary(v, now);
  if (summary.lastDispatchAtMs && now < summary.lastDispatchAtMs + policy.minGapSeconds * 1000) return deny("LOCAL_PACING_WAIT", summary.lastDispatchAtMs + policy.minGapSeconds * 1000);
  const quota = quotaDecision(v,inputTokens,policy.outputReserveTokens,now);
  if(!quota.allowed)return quota;
  if (retainedUsageRows(v,now).length >= 10000) return deny("USAGE_JOURNAL_FULL");
  return { allowed: true, code: "LOCAL_BUDGET_AVAILABLE", inputTokens, reserveTokens: policy.outputReserveTokens };
}
export async function reserveUsage({ id, processId, workerId, prompt, proof, now = Date.now() }, storage = chrome.storage.local) {
  return change(storage, v => {
    const decision = budgetDecision(v, id, prompt, now);
    if (!decision.allowed || decision.code === "USAGE_ALREADY_RESERVED") return { unchanged: true, value: decision };
    if (!proof?.allowed || !Number.isFinite(proof.observedAtMs) || now - proof.observedAtMs > 15000 || proof.observedAtMs>now+1000) return { unchanged:true, value:{allowed:false,code:"MODEL_PROOF_REQUIRED"} };
    v.entries = retainedUsageRows(v,now);
    v.entries.push({ id, processId, workerId, atMs: now, inputTokens: decision.inputTokens, reserveTokens: decision.reserveTokens, outputTokens: 0, completedAtMs: null, model: proof.model, effort: proof.effort, usageEpoch: v.usageEpoch ?? 0 });
    v.lastClockMs = Math.max(v.lastClockMs || 0, now);
    event(v,"DISPATCH_BUDGET_RESERVED",`${processId}: ~${decision.inputTokens} input tokens`,now);
    return { value: decision };
  });
}
export async function recordUsageOutput(id, text, storage = chrome.storage.local, now = Date.now()) {
  return change(storage, v => {
    const e = v.entries.find(e => e.id === id);
    if (!e) return { unchanged: true };
    const tokens = S.estimateTokens(text).estimate;
    if (e.completedAtMs && e.outputTokens >= tokens) return { unchanged: true };
    e.outputTokens = Math.max(e.outputTokens, tokens);
    e.completedAtMs ||= now;
    v.lastClockMs = Math.max(v.lastClockMs || 0, now);
    event(v,"RESPONSE_OBSERVED",`${e.processId}: ~${e.outputTokens} output tokens`,now);
  });
}

export async function authorizeUsageSend(id, dispatchId, storage = chrome.storage.local, now = Date.now()) {
  return change(storage,v=>{
    const entry=v.entries.find(e=>e.id===id);
    const deny=(code,retryAtMs=null)=>({unchanged:true,value:{allowed:false,code,retryAtMs}});
    if (!entry || !dispatchId) return deny("DISPATCH_AUTHORIZATION_MISSING");
    if (v.admissionPaused || v.providerHold) return deny(v.admissionPaused ? "ADMISSION_PAUSED" : "PROVIDER_QUOTA_HOLD");
    if (now<Number(v.lastClockMs||0)-60000) return deny("SYSTEM_CLOCK_ROLLBACK");
    if (v.lastAuthorizedDispatchId===dispatchId) return {unchanged:true,value:{allowed:true,policy:clone(v.policy)}};
    if (v.lastAuthorizedAtMs && now<v.lastAuthorizedAtMs+v.policy.minGapSeconds*1000) return deny("LOCAL_PACING_WAIT",v.lastAuthorizedAtMs+v.policy.minGapSeconds*1000);
    // A reservation made before midnight can reach Skicka afterwards. Check
    // its destination period under this same journal lock, counting it once.
    const firstAuthorization = !Number.isFinite(entry.authorizedAtMs) && !entry.completedAtMs;
    if(firstAuthorization) {
      const quota = quotaDecision(v,entry.inputTokens,entry.reserveTokens,now,id);
      if(!quota.allowed)return {unchanged:true,value:quota};
    }
    v.lastAuthorizedAtMs=now;
    v.lastAuthorizedDispatchId=dispatchId;
    v.lastClockMs=Math.max(v.lastClockMs||0,now);
    if(firstAuthorization) {
      entry.authorizedAtMs=now;
      // Reserved before a manual reset, first authorized afterwards: charge
      // the actual new send once, under the same lock as the quota recheck.
      entry.usageEpoch=v.usageEpoch ?? 0;
    }
    return {value:{allowed:true,policy:clone(v.policy)}};
  });
}
export async function observeProviderQuota(quota, storage = chrome.storage.local, now = Date.now()) {
  if (!quota?.active) return;
  return change(storage, v => {
    if (v.providerHold?.signature === quota.signature) {
      if (quota.workerId && v.providerHold.sourceWorkerId && quota.workerId!==v.providerHold.sourceWorkerId && !v.providerHold.multipleSources) { v.providerHold.multipleSources=true; return; }
      return { unchanged: true };
    }
    v.providerHold = { sourceWorkerId:quota.workerId || "", multipleSources:Boolean(v.providerHold?.sourceWorkerId && quota.workerId && v.providerHold.sourceWorkerId!==quota.workerId), signature: quota.signature, reason: "CHATGPT_QUOTA_OR_FALLBACK_UI", text: String(quota.text || "").slice(0,500), observedAtMs: now,
      resetAtMs: Math.max(v.providerHold?.resetAtMs || 0, Number(quota.resetAtMs || 0)) || null,
      resetConfidence: quota.resetConfidence || "UNKNOWN", goodProbeAtMs: null };
    event(v,"PROVIDER_QUOTA_HOLD",v.providerHold.text,now);
  });
}
export async function probeProviderRecovery(proof, storage = chrome.storage.local, { now = Date.now(), operator = false } = {}) {
  return change(storage, v => {
    const hold = v.providerHold;
    if (!hold) return { unchanged: true };
    if (!proof?.allowed || !Number.isFinite(proof.observedAtMs) || now-proof.observedAtMs>15000 || proof.observedAtMs>now+1000) { if (hold.goodProbeAtMs) hold.goodProbeAtMs=null; else return {unchanged:true}; return; }
    if (!operator && (!hold.resetAtMs || now < hold.resetAtMs)) return { unchanged: true };
    if (!operator && (!hold.goodProbeAtMs || proof.observedAtMs - hold.goodProbeAtMs < 5000)) {
      if (!hold.goodProbeAtMs) hold.goodProbeAtMs = proof.observedAtMs;
      else return {unchanged:true};
      return;
    }
    v.providerHold = null;
    event(v,"PROVIDER_HOLD_CLEARED",operator ? "OPERATOR_FRESH_UI_RECHECK" : "TWO_FRESH_UI_PROBES_AFTER_EXPLICIT_RESET",now);
  });
}
// v1.8.13: the event says what changed ("messages7d 400→1000"); diagnostics
// 2026-10-05 had the update but not the old or new limits.
export function safetyPolicyChanges(before = {}, after = {}) {
  return Object.keys(after).filter((key) => before[key] !== after[key]).map((key) => `${key} ${before[key] ?? "–"}→${after[key]}`);
}
export function equalSafetyPolicy(a, b) {
  return Object.keys(S.defaults).every((key) => a?.[key] === b?.[key]);
}
// v1.9.1: an operator save carries its own time, so the newest save in the
// Chrome profile can win over an older or never-saved installation
// (safety-policy-vault.mjs).
export async function updateSafetyPolicy(patch, storage = chrome.storage.local, now = Date.now()) {
  return change(storage, v => {
    const before = { ...v.policy };
    v.policy = S.normalizePolicy({...v.policy,...patch});
    v.policyUpdatedAtMs = now;
    v.policyOrigin = "OPERATOR";
    event(v,"SAFETY_POLICY_UPDATED",safetyPolicyChanges(before, v.policy).join(", ") || "unchanged",now);
  });
}
// Re-checked inside the journal lock: a save that landed after the startup
// plan was made is newer than the vault and is never overwritten.
export async function adoptSafetyPolicyFromVault(vault, storage = chrome.storage.local, now = Date.now()) {
  return change(storage, v => {
    if (!(Number(vault?.savedAtMs) > Number(v.policyUpdatedAtMs || 0)) || equalSafetyPolicy(vault.policy, v.policy)) return { unchanged: true };
    const before = { ...v.policy };
    v.policy = S.normalizePolicy(vault.policy);
    v.policyUpdatedAtMs = vault.savedAtMs;
    v.policyOrigin = "VAULT";
    event(v,"SAFETY_POLICY_RESTORED",`bookmark vault ${new Date(vault.savedAtMs).toISOString()}: ${safetyPolicyChanges(before, v.policy).join(", ")}`,now);
  });
}
export async function pauseAdmission(paused, storage = chrome.storage.local) {
  return change(storage, v => { v.admissionPaused = paused === true; event(v,paused ? "OPERATOR_PAUSED_NEW_WORK" : "OPERATOR_RESUMED_NEW_WORK"); });
}
export async function resetUsageCounters(storage = chrome.storage.local, now = Date.now()) {
  if (!Number.isFinite(now) || now <= 0) throw new Error("USAGE_RESET_TIME_INVALID");
  return change(storage, v => {
    const before=usageSummary(v,now), next=(v.usageEpoch ?? 0)+1;
    if (!Number.isSafeInteger(next)) throw new Error("SAFETY_USAGE_EPOCH_INVALID");
    v.usageEpoch=next;
    v.usageResetAtMs=now;
    event(v,"USAGE_COUNTERS_RESET",`3h ${before.messages3h}; day ${before.messages24h}; week ${before.messages7d}; charged tokens ${before.chargedTokens24h}`,now);
    // Preserve pacing, clock guards, pauses, provider holds and every receipt.
    return {value:usageSummary(v,now)};
  });
}
