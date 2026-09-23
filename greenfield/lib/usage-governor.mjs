import "./safety-policy.js";
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
  return [process.runId, process.sessionSeq, process.turn, prompt?.hash || ""].join(":");
}
export async function readSafety(storage = chrome.storage.local) {
  const record = await readCheckpoint(SAFETY_KEY, storage);
  if (record.health === "RECOVERY_REQUIRED") throw new Error("SAFETY_JOURNAL_RECOVERY_REQUIRED");
  if (!record.value) return { schema: "eic.gf.safety.v1", policy: { ...S.defaults }, admissionPaused: false, providerHold: null, entries: [], events: [], createdAtMs: Date.now(), lastClockMs: 0 };
  const v = record.value;
  if (v.schema !== "eic.gf.safety.v1" || !Array.isArray(v.entries) || !Array.isArray(v.events)) throw new Error("SAFETY_JOURNAL_INVALID");
  S.normalizePolicy(v.policy);
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
export function usageSummary(v, now = Date.now()) {
  const windowRows = (ms) => v.entries.filter(e => now - e.atMs < ms); // Future rows also consume budget after clock rollback.
  const day = windowRows(86400000);
  return {
    scope: "GREENFIELD_THIS_EXTENSION_PROFILE", exactProviderUsage: false,
    messages3h: windowRows(3*3600000).length, messages24h: day.length, messages7d: windowRows(WEEK).length,
    inputTokens24h: day.reduce((n,e) => n + e.inputTokens, 0),
    outputTokens24h: day.reduce((n,e) => n + e.outputTokens, 0),
    chargedTokens24h: day.reduce((n,e) => n + e.inputTokens + Math.max(e.outputTokens, e.reserveTokens), 0),
    pendingCount: v.entries.filter(e => !e.completedAtMs).length,
    lastDispatchAtMs: Math.max(0, ...v.entries.map(e => e.atMs)),
    policy: v.policy, admissionPaused: v.admissionPaused, providerHold: v.providerHold,
    createdAtMs: v.createdAtMs, events: v.events.slice(-40)
  };
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
  for (const [key, ms] of [["messages3h",3*3600000],["messages24h",86400000],["messages7d",WEEK]]) {
    if (summary[key] >= policy[key]) {
      const times = v.entries.filter(e => now - e.atMs < ms).map(e => e.atMs).sort((a,b) => a-b);
      return deny(`LOCAL_${key.toUpperCase()}_BUDGET`, times[Math.max(0, times.length - policy[key])] + ms + 1);
    }
  }
  if (summary.chargedTokens24h + inputTokens + policy.outputReserveTokens > policy.tokens24h) {
    let total = summary.chargedTokens24h;
    let retry = null;
    for (const e of v.entries.filter(e => now-e.atMs<86400000).sort((a,b)=>a.atMs-b.atMs)) {
      total -= e.inputTokens + Math.max(e.outputTokens,e.reserveTokens);
      if (total + inputTokens + policy.outputReserveTokens <= policy.tokens24h) { retry=e.atMs+86400001; break; }
    }
    return deny("LOCAL_TOKENS24H_BUDGET", retry);
  }
  if (v.entries.filter(e=>now-e.atMs<WEEK).length >= 10000) return deny("USAGE_JOURNAL_FULL");
  return { allowed: true, code: "LOCAL_BUDGET_AVAILABLE", inputTokens, reserveTokens: policy.outputReserveTokens };
}
export async function reserveUsage({ id, processId, workerId, prompt, proof, now = Date.now() }, storage = chrome.storage.local) {
  return change(storage, v => {
    const decision = budgetDecision(v, id, prompt, now);
    if (!decision.allowed || decision.code === "USAGE_ALREADY_RESERVED") return { unchanged: true, value: decision };
    if (!proof?.allowed || !Number.isFinite(proof.observedAtMs) || now - proof.observedAtMs > 15000 || proof.observedAtMs>now+1000) return { unchanged:true, value:{allowed:false,code:"MODEL_PROOF_REQUIRED"} };
    v.entries = v.entries.filter(e => now - e.atMs < WEEK);
    v.entries.push({ id, processId, workerId, atMs: now, inputTokens: decision.inputTokens, reserveTokens: decision.reserveTokens, outputTokens: 0, completedAtMs: null, model: proof.model, effort: proof.effort });
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
    const deny=code=>({unchanged:true,value:{allowed:false,code}});
    if (!entry || !dispatchId) return deny("DISPATCH_AUTHORIZATION_MISSING");
    if (v.admissionPaused || v.providerHold) return deny(v.admissionPaused ? "ADMISSION_PAUSED" : "PROVIDER_QUOTA_HOLD");
    if (now<Number(v.lastClockMs||0)-60000) return deny("SYSTEM_CLOCK_ROLLBACK");
    if (v.lastAuthorizedDispatchId===dispatchId) return {unchanged:true,value:{allowed:true,policy:clone(v.policy)}};
    if (v.lastAuthorizedAtMs && now<v.lastAuthorizedAtMs+v.policy.minGapSeconds*1000) return deny("LOCAL_PACING_WAIT");
    v.lastAuthorizedAtMs=now;
    v.lastAuthorizedDispatchId=dispatchId;
    v.lastClockMs=Math.max(v.lastClockMs||0,now);
    entry.authorizedAtMs=now;
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
export async function updateSafetyPolicy(patch, storage = chrome.storage.local) {
  return change(storage, v => { v.policy = S.normalizePolicy({...v.policy,...patch}); event(v,"SAFETY_POLICY_UPDATED"); });
}
export async function pauseAdmission(paused, storage = chrome.storage.local) {
  return change(storage, v => { v.admissionPaused = paused === true; event(v,paused ? "OPERATOR_PAUSED_NEW_WORK" : "OPERATOR_RESUMED_NEW_WORK"); });
}
