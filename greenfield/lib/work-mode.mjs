import { readStorage } from "./storage-read.mjs";
import { jsonEqual } from "./canonical-json.mjs";
import { storageLock } from "./durable-checkpoint.mjs";
import { randomId } from "./common.mjs";
export const WORK_MODE_SCHEMA = "eic.greenfield.work-mode.v1";
export const WMT_POINTER_SCHEMA = "eic.greenfield.work-mode.pointer.v1";
export const DEFAULT_WORK_MODE_ENDPOINT = "https://api.elho.fi/greenfield/work-mode/v1";
export const WORK_MODE_POLL_MS = 15_000;
export const WMT_MAX_CLOCK_SKEW_MS = 60_000;

export function normalizeWorkModeEndpoint(value) {
  try {
    const u = new URL(String(value || DEFAULT_WORK_MODE_ENDPOINT));
    if (u.protocol !== "https:" || u.hostname !== "api.elho.fi") return DEFAULT_WORK_MODE_ENDPOINT;
    return u.href.replace(/\/$/, "");
  } catch { return DEFAULT_WORK_MODE_ENDPOINT; }
}

export function validateWmtPointer(value, { now = Date.now(), maxClockSkewMs = WMT_MAX_CLOCK_SKEW_MS } = {}) {
  const v = value && typeof value === "object" ? value : {};
  const errors = [];
  if (v.schema !== WMT_POINTER_SCHEMA) errors.push("SCHEMA");
  const taskRef = String(v.taskRef || "").trim();
  const nonce = String(v.nonce || "").trim();
  const taskKey = String(v.taskKey || "").trim();
  const objective = String(v.objective || "").trim();
  const issuedAtMs = Number(v.issuedAtMs);
  const expiresAtMs = Number(v.expiresAtMs);
  if (!taskRef || taskRef.length > 200) errors.push("TASK_REF");
  if (!nonce || nonce.length > 200) errors.push("NONCE");
  if (!taskKey || taskKey.length < 16 || taskKey.length > 300) errors.push("TASK_KEY");
  if (!objective || objective.length > 1200) errors.push("OBJECTIVE");
  if (!Number.isFinite(issuedAtMs) || Math.abs(Number(now) - issuedAtMs) > Number(maxClockSkewMs)) errors.push("ISSUED_AT_WINDOW");
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Number(now) || expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > 5 * 60_000) errors.push("EXPIRES_AT");
  return { ok: errors.length === 0, errors, value: { ...v, taskRef, nonce, taskKey, objective, issuedAtMs, expiresAtMs } };
}

export function wmtPointerMission(pointer, endpoint = DEFAULT_WORK_MODE_ENDPOINT) {
  const v = validateWmtPointer(pointer, { now: Number(pointer?.issuedAtMs || Date.now()) });
  if (!v.ok) throw new Error(`WMT_POINTER_INVALID:${v.errors.join(",")}`);
  const p = v.value;
  return [
    "EIC Greenfield Arbetsläge (GFW-WMT).",
    `WMT taskRef=${p.taskRef}; revision=${String(p.revision || "1")}; taskKey=${p.taskKey}; objective=${p.objective}`,
    `Resolve the complete immutable task package from ${normalizeWorkModeEndpoint(endpoint)} using taskRef and the taskKey carried by the Work Mode pointer.`,
    "The resolved WMT package is authoritative for scope and must be next-person-ready: execute it without asking for information already present there; never invent missing owner facts.",
    "Report progress and terminal state through the available EIC owner routes. This short prompt is only a pointer; do not treat it as the full task package."
  ].join("\n");
}

export function workModeStatusPayload({ taskRef, state, workerId, seq = 0, detail = "", now = Date.now() } = {}) {
  return {
    schema: "eic.greenfield.work-mode.status.v1",
    taskRef: String(taskRef || "").slice(0, 200),
    state: String(state || "UNKNOWN").toUpperCase().slice(0, 40),
    workerId: String(workerId || "").slice(0, 200),
    seq: Math.max(0, Number(seq || 0)),
    detail: String(detail || "").slice(0, 500),
    ts: Number(now)
  };
}

export const WORK_MODE_PREQUEUE_KEY = "eic.gf.work-mode.prequeue.v1";
export const WORK_MODE_PREQUEUE_MAX = 48;

// Payload is short lived; receipts outlive it without retaining task keys.
export const WORK_MODE_HISTORY_MAX = 256;
export const WORK_MODE_CLAIM_MS = 30_000;
const queueLock = storage => `${WORK_MODE_PREQUEUE_KEY}:write`;
const terminalStates = new Set(["MATERIALIZED","EXPIRED","FAILED"]);
const knownStates = new Set(["READY","CLAIMED","MATERIALIZING","RECONCILIATION_REQUIRED",...terminalStates]);

export async function loadWorkModePrequeue(storage = globalThis.chrome?.storage?.local) {
  if (!storage?.get) throw new Error("WORK_MODE_STORAGE_UNAVAILABLE");
  const r = await readStorage(storage,WORK_MODE_PREQUEUE_KEY), v = r?.[WORK_MODE_PREQUEUE_KEY] || {};
  if (v.items !== undefined && !Array.isArray(v.items)) throw new Error("WORK_MODE_PREQUEUE_CORRUPT");
  const items = (v.items || []).map(item => {
    if (!item || typeof item !== "object" || !item.key) throw new Error("WORK_MODE_PREQUEUE_CORRUPT");
    return knownStates.has(item.state) ? item : {...item,state:"RECONCILIATION_REQUIRED",code:"WORK_MODE_STATE_INVALID"};
  });
  return {schema:"eic.greenfield.work-mode.prequeue.v1",revision:Math.max(0,Number(v.revision || 0)),items,
    history:Array.isArray(v.history) ? v.history : []};
}
function receipt(item, now) {
  return {key:item.key,state:item.state,updatedAtMs:now,expiresAtMs:Number(item.pointer?.expiresAtMs || item.expiresAtMs || 0),
    workerId:item.workerId || "",windowId:item.windowId ?? null,processId:item.processId || "",claimId:item.claimId || ""};
}
function maintain(q, now) {
  for (const item of q.items) {
    if (item.state === "CLAIMED") {
      if (!item.claimId || !item.claimUntilMs) { item.state="RECONCILIATION_REQUIRED";item.code="WORK_MODE_LEGACY_CLAIM_UNKNOWN"; }
      else if (now >= item.claimUntilMs) { item.state="READY";item.claimId=""; }
    }
    if (item.state === "READY" && Number(item.pointer?.expiresAtMs || 0) <= now) item.state="EXPIRED";
    if (terminalStates.has(item.state)) {
      q.history = q.history.filter(row=>row.key!==item.key);
      q.history.push(receipt(item,now));
    }
  }
  q.items=q.items.filter(item=>!terminalStates.has(item.state));
  // Never evict a still-valid replay fence to make room. Such pressure is a
  // bounded wait until expiry, not authority to duplicate a task.
  const protectedRows=q.history.filter(row=>row.expiresAtMs>now);
  const expired=q.history.filter(row=>row.expiresAtMs<=now).sort((a,b)=>a.updatedAtMs-b.updatedAtMs);
  const remaining=Math.max(0,WORK_MODE_HISTORY_MAX-protectedRows.length);
  q.history=[...(remaining ? expired.slice(-remaining) : []),...protectedRows];
  if (protectedRows.length>=WORK_MODE_HISTORY_MAX) q.history=protectedRows;
}
async function publish(q,storage) {
  q.revision+=1;
  await storage.set({[WORK_MODE_PREQUEUE_KEY]:q});
  const check=await readStorage(storage,WORK_MODE_PREQUEUE_KEY);
  if (!jsonEqual(check[WORK_MODE_PREQUEUE_KEY],q)) throw new Error("WORK_MODE_PREQUEUE_READBACK_FAILED");
  return q;
}
export async function enqueueWorkModePointer(pointer, storage = globalThis.chrome?.storage?.local, { now = Date.now() } = {}) {
  const check=validateWmtPointer(pointer,{now});
  if(!check.ok)throw new Error(`WMT_POINTER_INVALID:${check.errors.join(",")}`);
  return storageLock(storage,queueLock(storage),async()=>{
    const q=await loadWorkModePrequeue(storage);maintain(q,now);
    const v=check.value,key=`${v.taskRef}:${String(v.revision || "1")}`;
    if (!q.items.some(x=>x.key===key) && !q.history.some(x=>x.key===key)) {
      if (q.items.length>=WORK_MODE_PREQUEUE_MAX)throw new Error("WORK_MODE_PREQUEUE_FULL");
      if (q.history.filter(x=>x.expiresAtMs>now).length>=WORK_MODE_HISTORY_MAX)throw new Error("WORK_MODE_HISTORY_FULL");
      q.items.push({key,pointer:v,state:"READY",createdAtMs:now,updatedAtMs:now});
    }
    return publish(q,storage);
  });
}
export async function claimNextWorkModePointer(storage = globalThis.chrome?.storage?.local, { now = Date.now() } = {}) {
  return storageLock(storage,queueLock(storage),async()=>{
    const q=await loadWorkModePrequeue(storage);maintain(q,now);
    const item=q.items.find(x=>x.state==="READY" && Number(x.pointer?.expiresAtMs || 0)>now);
    if (item) {item.state="CLAIMED";item.updatedAtMs=now;item.claimId=randomId("wmt-claim");item.claimUntilMs=now+WORK_MODE_CLAIM_MS;}
    await publish(q,storage);return {queue:q,item:item || null};
  });
}
export async function completeWorkModePointer(key, state, storage = globalThis.chrome?.storage?.local, {
  now=Date.now(),workerId="",windowId=null,processId="",claimId="",effectPossible=null
}={}) {
  return storageLock(storage,queueLock(storage),async()=>{
    const q=await loadWorkModePrequeue(storage);maintain(q,now);
    const item=q.items.find(x=>x.key===String(key || ""));
    if(!item)return q; // a terminal tombstone cannot be resurrected by a late reply
    if(claimId && item.claimId!==claimId)throw new Error("WORK_MODE_CLAIM_STALE");
    const next=String(state || "").toUpperCase();
    if(!knownStates.has(next))throw new Error("WORK_MODE_STATE_INVALID");
    if(next==="READY" && item.state!=="CLAIMED" && effectPossible!==false) {
      item.state="RECONCILIATION_REQUIRED";item.code="WORK_MODE_MATERIALIZATION_UNKNOWN";
    } else item.state=next;
    item.updatedAtMs=now;
    if(workerId)item.workerId=workerId;
    if(Number.isInteger(windowId))item.windowId=windowId;
    if(processId)item.processId=processId;
    maintain(q,now);return publish(q,storage);
  });
}
// Persist the uncertain-effect boundary BEFORE creating the child window.
export async function beginWorkModeMaterialization(key,claimId,storage,{now=Date.now()}={}) {
  return storageLock(storage,queueLock(storage),async()=>{
    const q=await loadWorkModePrequeue(storage);maintain(q,now);
    const item=q.items.find(x=>x.key===key);
    if(!item || item.state!=="CLAIMED" || item.claimId!==claimId || item.claimUntilMs<=now)throw new Error("WORK_MODE_CLAIM_STALE");
    item.state="MATERIALIZING";item.updatedAtMs=now;
    await publish(q,storage);return item;
  });
}
export async function bindWorkModeMaterialization(key,claimId,storage,{workerId,windowId,now=Date.now()}={}) {
  return completeWorkModePointer(key,"MATERIALIZING",storage,{claimId,workerId,windowId,now});
}
// On restart a source-linked child is positive evidence. Absence alone never
// licenses replay of MATERIALIZING or of a legacy claim with unknown effects.
export async function reconcileWorkModeMaterialization(processes,storage,{now=Date.now()}={}) {
  return storageLock(storage,queueLock(storage),async()=>{
    const q=await loadWorkModePrequeue(storage);maintain(q,now);
    for(const item of q.items.filter(x=>["MATERIALIZING","RECONCILIATION_REQUIRED"].includes(x.state))) {
      const children=processes.filter(p=>p.workModeSource?.key===item.key && p.workModeSource.claimId===item.claimId &&
        p.workerId===item.workerId && Number(p.windowId)===item.windowId && !p.storageRecoveryRequired);
      if(children.length===1){item.state="MATERIALIZED";item.processId=children[0].processId;}
      else {item.state="RECONCILIATION_REQUIRED";item.code=children.length>1?"WORK_MODE_CHILD_AMBIGUOUS":"WORK_MODE_MATERIALIZATION_UNKNOWN";}
    }
    maintain(q,now);await publish(q,storage);return q;
  });
}

// Recovery exports retain replay fences but never export task access keys.
// Imported open work requires source reconciliation; it cannot auto-dispatch.
export async function workModeRecoverySnapshot(storage,{now=Date.now()}={}) {
  return storageLock(storage,queueLock(storage),async()=>{
    const q=await loadWorkModePrequeue(storage);maintain(q,now);
    return {...q,items:q.items.map(item=>({...receipt(item,now),state:'RECONCILIATION_REQUIRED',
      code:'WORK_MODE_IMPORTED_REQUIRES_OWNER_REVIEW'}))};
  });
}
