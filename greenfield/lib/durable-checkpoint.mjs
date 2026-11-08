import { packStorageValue, unpackStorageValue, isPackedStorageValue, disableStoragePacking } from './storage-codec.mjs';
import { sha256Hex } from "./common.mjs";
import { canonicalJson, jsonEqual } from "./canonical-json.mjs";
import { readStorage } from "./storage-read.mjs";

// Two alternating, checksummed write-ahead slots. The compatibility key is
// published only after the new slot has been read back byte for byte.
export const CHECKPOINT_PREFIX = "eic.gf.checkpoint.";
const locks = new WeakMap();
export const STORAGE_LOCK_WAIT_MS = 30000;
const legacyCodecs = new Map();
export const REPAIR_PREFIX = "eic.gf.rc1-checkpoint-repair.";
export function registerLegacyCheckpointCodec(schema, codec) { legacyCodecs.set(schema,codec); }
const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
export const checkpointKeys = (key) => [0, 1].map((n) => `${CHECKPOINT_PREFIX}${key}.${n}`);
function lockWaitError(code, key, settlement = null) {
  const error = Object.assign(new Error(code), { code, effectPossible: Boolean(settlement), storageKey: key });
  // Internal dependency only: not serialized into audit records. A parent
  // lock must await a late child before relinquishing shared ownership.
  if (settlement) Object.defineProperty(error, "pendingStorageSettlement", { value: settlement });
  return error;
}

export function storageLock(storage, key, work) {
  let map = locks.get(storage);
  if (!map) locks.set(storage, map = new Map());
  let state = map.get(key);
  if (state?.uncertain) return Promise.reject(lockWaitError("STORAGE_LOCK_EFFECT_PENDING", key, state.uncertain));
  if (!state) map.set(key, state = { tail: Promise.resolve(), uncertain: null, sinceMs: Date.now() });
  let started = false, cancelled = false, timer;
  const timeout = () => lockWaitError(started ? "STORAGE_LOCK_EFFECT_PENDING" : "STORAGE_LOCK_WAIT_TIMEOUT", key, started ? job : null);
  const job = state.tail.catch(() => undefined).then(() => {
    // A queued caller that already timed out must never become a ghost write.
    if (cancelled) throw timeout();
    started = true;
    return work();
  }).catch(async error => {
    if (error?.pendingStorageSettlement && error.pendingStorageSettlement !== job) {
      state.uncertain = job;
      await error.pendingStorageSettlement.catch(() => undefined);
    }
    throw error;
  });
  state.tail = job;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (started) state.uncertain = job;
      else cancelled = true;
      reject(timeout());
    }, STORAGE_LOCK_WAIT_MS);
  });
  // The ORIGINAL job owns the fence until it settles. A wait timeout does
  // not cancel an already started mutation and never releases its lock.
  job.finally(() => {
    if (state.uncertain === job) state.uncertain = null;
    if (state.tail === job) map.delete(key);
  }).catch(() => undefined);
  return Promise.race([job, deadline]).finally(() => clearTimeout(timer));
}

export function storageLockHealth(storage) {
  return [...(locks.get(storage) || new Map())].map(([key, state]) => ({
    key, state: state.uncertain ? "UNKNOWN_EFFECT_PENDING" : "IN_FLIGHT", sinceMs: state.sinceMs
  }));
}

async function validEnvelope(envelope) {
  if (!envelope || !["eic.gf.checkpoint.v1","eic.gf.checkpoint.v2"].includes(envelope.schema) ||
      !Number.isSafeInteger(envelope.revision) || envelope.revision < 1 ||
      !envelope.value || typeof envelope.value !== "object") return false;
  if(envelope.schema === "eic.gf.checkpoint.v2") {
    if(envelope.codec!=="EIC_SORTED_JSON_V1")return false;
    const {sha256,...payload}=envelope;
    return sha256===await sha256Hex(canonicalJson(payload));
  }
  if(envelope.sha256 === await sha256Hex(JSON.stringify(envelope.value)))return true;
  // Recover RC1's exact original hash, never accept a mismatch as merely
  // cosmetic. A codec may reorder keys only, not normalize or discard data.
  try {
    const codec=legacyCodecs.get(envelope.value.schema);
    if(!codec)return false;
    const reordered=codec(clone(envelope.value));
    return jsonEqual(reordered,envelope.value) && envelope.sha256===await sha256Hex(JSON.stringify(reordered));
  }catch{return false;}
}

async function envelopeV2(value,revision,{savedAt=new Date().toISOString(),repairId}={}) {
  const payload={schema:"eic.gf.checkpoint.v2",codec:"EIC_SORTED_JSON_V1",revision,savedAt,value:clone(value),...(repairId?{repairId}:{})};
  return {...payload,sha256:await sha256Hex(canonicalJson(payload))};
}

async function readCheckpointUnlocked(key, storage) {
  const slots = checkpointKeys(key);
  const raw = await readStorage(storage,[key, ...slots],{decode:false});
  const rows = {};
  const candidates = [];
  let damaged = false;
  // Decode each copy independently. A damaged primary must not hide a valid
  // WAL, and a damaged WAL must never grant authority to the primary alone.
  for (const name of [key,...slots]) {
    try { rows[name] = await unpackStorageValue(name,raw[name]); }
    catch { damaged = true; }
  }
  for (const slot of slots) {
    if (rows[slot] == null) continue;
    if (await validEnvelope(rows[slot])) candidates.push(rows[slot]);
    else damaged = true;
  }
  candidates.sort((a, b) => b.revision - a.revision);
  if (!candidates.length) {
    if (damaged) throw new Error(`CHECKPOINT_UNRECOVERABLE:${key}`);
    return { value: clone(rows[key] ?? null), revision: 0, health: rows[key] ? "LEGACY" : "EMPTY" };
  }
  const latest = candidates[0];
  if(candidates.some(c=>c.revision===latest.revision && !jsonEqual(c.value,latest.value)))damaged=true;
  const primaryMatches = rows[key] && jsonEqual(rows[key],latest.value);
  // A missing compatibility write can be an interrupted publish. It is safe to
  // recover its data, but dispatch must be quarantined until reconciled.
  return {
    value: clone(latest.value), revision: latest.revision,
    health: damaged || !primaryMatches ? "RECOVERY_REQUIRED" : "VERIFIED"
  };
}

export async function readCheckpoint(key, storage) {
  // Readers in this owner wait until an in-progress publish has finished.
  // Seeing its staged slot halfway through a healthy write is not a crash.
  return storageLock(storage,key,()=>readCheckpointUnlocked(key,storage));
}

export async function writeCheckpoint(key, value, storage, { extra = {} } = {}) {
  return storageLock(storage, key, async () => {
    const prior = await readCheckpointUnlocked(key, storage);
    if (prior.health === "RECOVERY_REQUIRED") throw new Error(`CHECKPOINT_RECONCILIATION_REQUIRED:${key}`);
    const snapshot = clone(value);
    const revision = prior.revision + 1;
    const slots = checkpointKeys(key);
    const slot = slots[revision % 2];
    const envelope = await envelopeV2(snapshot,revision);
    await storage.set({ [slot]: await packStorageValue(slot, envelope) });
    const check = (await readStorage(storage,slot))[slot];
    if (!await validEnvelope(check) || check.revision !== revision || check.sha256 !== envelope.sha256) {
      throw new Error(`CHECKPOINT_WRITE_READBACK_FAILED:${key}`);
    }
    await storage.set({ ...extra, [key]: await packStorageValue(key, snapshot) });
    const published = (await readStorage(storage,key))[key];
    if (!published || !jsonEqual(published,snapshot)) {
      throw new Error(`CHECKPOINT_PUBLISH_READBACK_FAILED:${key}`);
    }

    // v1.7.5 rolling retention: once the new checkpoint and compatibility
    // value are both read back, the older alternating slot has no remaining
    // recovery purpose. Keep one checksummed slot plus the primary value.
    // During the write both slots can coexist, so crash safety is preserved.
    const staleSlots = slots.filter((candidate) => candidate !== slot);
    if (typeof storage.remove === "function") {
      await storage.remove(staleSlots);
    }
    const finalRecord = await readCheckpointUnlocked(key, storage);
    if (finalRecord.health !== "VERIFIED" || finalRecord.revision !== revision ||
        !jsonEqual(finalRecord.value, snapshot)) {
      throw new Error(`CHECKPOINT_COMPACTION_READBACK_FAILED:${key}`);
    }
    return { value: clone(snapshot), revision, health: "VERIFIED", savedAt: envelope.savedAt };
  });
}

export async function compactCheckpoint(key, storage) {
  return storageLock(storage, key, async () => {
    const before = await readCheckpointUnlocked(key, storage);
    if (before.health !== "VERIFIED") {
      return { changed:false, key, health:before.health, revision:before.revision };
    }
    const slots = checkpointKeys(key);
    const rows = await readStorage(storage,slots);
    const present = [];
    for (const slot of slots) {
      const envelope = rows?.[slot];
      if (envelope == null) continue;
      if (!await validEnvelope(envelope)) {
        return { changed:false, key, health:"RECOVERY_REQUIRED", revision:before.revision };
      }
      present.push({ slot, envelope });
    }
    if (present.length <= 1) {
      return { changed:false, key, health:"VERIFIED", revision:before.revision };
    }
    if (typeof storage.remove !== "function") {
      return { changed:false, key, health:"VERIFIED", revision:before.revision, code:"STORAGE_REMOVE_UNAVAILABLE" };
    }
    present.sort((a,b) => Number(b.envelope.revision) - Number(a.envelope.revision));
    const keep = present[0];
    const remove = present.slice(1).map((row) => row.slot);
    await storage.remove(remove);
    const after = await readCheckpointUnlocked(key, storage);
    if (after.health !== "VERIFIED" || after.revision !== before.revision ||
        !jsonEqual(after.value, before.value)) {
      throw new Error(`CHECKPOINT_COMPACTION_READBACK_FAILED:${key}`);
    }
    return { changed:true, key, kept:keep.slot, removed:remove, revision:after.revision, health:after.health };
  });
}

// Repair only RC1 records whose old checksum can still be reproduced exactly.
// The caller restricts supported record types and decides the paused recovery
// value. Preserve every original byte-equivalent JSON value before publication.
export async function reconcileRc1Checkpoint(key,storage,prepare) {
  return storageLock(storage,key,async()=>{
    const slots=checkpointKeys(key),rows=await readStorage(storage,[key,...slots]);
    const candidates=[];
    for(const slot of slots)if(rows[slot]!=null) {
      if(!await validEnvelope(rows[slot]))return {changed:false,code:"RC1_CHECKSUM_NOT_RECONSTRUCTABLE"};
      candidates.push(rows[slot]);
    }
    if(!candidates.length)return {changed:false};
    candidates.sort((a,b)=>b.revision-a.revision);
    const latest=candidates[0];
    if(candidates.some(e=>e.revision===latest.revision && !jsonEqual(e.value,latest.value)))return {changed:false,code:"RC1_REVISION_AMBIGUOUS"};
    let archive,archiveKey,envelope;
    if(latest.schema==="eic.gf.checkpoint.v2") {
      if(!latest.repairId || (await readCheckpointUnlocked(key,storage)).health==="VERIFIED")return {changed:false};
      archiveKey=latest.repairId;archive=(await readStorage(storage,archiveKey))[archiveKey];
      if(!archive)throw Error("RC1_REPAIR_ARCHIVE_MISSING");
      const {sha256,...payload}=archive;
      if(archiveKey!==REPAIR_PREFIX+sha256 || sha256!==await sha256Hex(canonicalJson(payload)) || archive.key!==key || archive.revision!==latest.revision || !jsonEqual(archive.preparedValue,latest.value))throw Error("RC1_REPAIR_ARCHIVE_INVALID");
      envelope=latest;
    }else {
      const primaryMatches=rows[key]!=null && jsonEqual(rows[key],latest.value);
      const prepared=await prepare(clone(latest.value),{primaryMatches,primary:clone(rows[key]??null)});
      if(!prepared)return {changed:false,code:"RC1_RECORD_REQUIRES_MANUAL_REVIEW"};
      const payload={schema:"eic.gf.rc1-checkpoint-repair.v1",key,at:new Date().toISOString(),revision:latest.revision+1,originals:clone(rows),preparedValue:prepared.value,requiresReview:prepared.requiresReview===true,code:primaryMatches?"RC1_ENCODING_MIGRATED":"RC1_STAGED_CHECKPOINT_RECOVERED"};
      const sha256=await sha256Hex(canonicalJson(payload));archiveKey=REPAIR_PREFIX+sha256;archive={...payload,sha256};
      await storage.set({[archiveKey]:archive});
      if(!jsonEqual((await readStorage(storage,archiveKey))[archiveKey],archive))throw Error("RC1_REPAIR_ARCHIVE_READBACK_FAILED");
      envelope=await envelopeV2(archive.preparedValue,archive.revision,{savedAt:archive.at,repairId:archiveKey});
    }
    // If interrupted, a verified repair envelope + immutable archive can finish
    // this same publication on the next startup. No dispatch is involved.
    await storage.set({[slots[0]]:envelope,[slots[1]]:envelope,[key]:clone(archive.preparedValue)});
    const checked=await readCheckpointUnlocked(key,storage);
    if(checked.health!=="VERIFIED" || !jsonEqual(checked.value,archive.preparedValue))throw Error("RC1_REPAIR_PUBLISH_READBACK_FAILED");
    return {changed:true,key,archiveKey,requiresReview:archive.requiresReview,code:archive.code};
  });
}

// Rewrite physical bytes under the same writer lock, with unchanged logical
// revision, independent WAL and decoded readback. No process or queue is erased.
export async function packCheckpointStorage(key, storage, {expand=false}={}) {
  return storageLock(storage,key,async()=>{
    const before=await readCheckpointUnlocked(key,storage);
    if(!['VERIFIED','LEGACY'].includes(before.health))return {changed:false,health:before.health};
    const keys=[key,...checkpointKeys(key)];
    const raw=await readStorage(storage,keys,{decode:false});
    const decoded=await readStorage(storage,keys);
    const updates={};let bytesBefore=0,bytesAfter=0;
    for(const name of keys) {
      if(raw[name]==null)continue;
      if(expand && !isPackedStorageValue(raw[name]))continue;
      if(!expand && isPackedStorageValue(raw[name]))continue;
      const value=expand ? decoded[name] : await packStorageValue(name,decoded[name]);
      if(!expand && !isPackedStorageValue(value))continue;
      updates[name]=value;
      bytesBefore+=new TextEncoder().encode(JSON.stringify(raw[name])).length;
      bytesAfter+=new TextEncoder().encode(JSON.stringify(value)).length;
    }
    if(!Object.keys(updates).length)return {changed:false,health:before.health};
    await storage.set(updates);
    const after=await readCheckpointUnlocked(key,storage);
    if(after.health!==before.health || after.revision!==before.revision || !jsonEqual(after.value,before.value))
      throw new Error(`STORAGE_PACK_READBACK_FAILED:${key}`);
    const readback=await readStorage(storage,Object.keys(updates),{decode:false});
    if(!jsonEqual(readback,updates))throw new Error(`STORAGE_PACK_PHYSICAL_READBACK_FAILED:${key}`);
    return {changed:true,keys:Object.keys(updates),bytesBefore,bytesAfter,health:after.health};
  });
}

// Run with admission paused and no active turns before installing an older
// release. Disabling packing first prevents concurrent writes from repacking.
export async function expandStorageForRollback(storage = chrome.storage.local) {
  disableStoragePacking();
  const rows=await readStorage(storage,null,{decode:false});
  const logical=[...new Set(Object.keys(rows).filter(k=>isPackedStorageValue(rows[k]))
    .map(k=>k.startsWith(CHECKPOINT_PREFIX)?k.slice(CHECKPOINT_PREFIX.length).replace(/\.[01]$/,''):k))];
  const results=[];for(const key of logical)results.push(await packCheckpointStorage(key,storage,{expand:true}));
  const remaining=Object.values(await readStorage(storage,null,{decode:false})).filter(isPackedStorageValue).length;
  if(remaining)throw new Error('STORAGE_ROLLBACK_EXPANSION_INCOMPLETE');
  return {expandedRecords:results.filter(r=>r.changed).length,remaining};
}
