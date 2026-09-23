import { sha256Hex } from "./common.mjs";
import { canonicalJson, jsonEqual } from "./canonical-json.mjs";
import { CHECKPOINT_PREFIX, readCheckpoint, writeCheckpoint, storageLock } from "./durable-checkpoint.mjs";
import { SAFETY_KEY, readSafety } from "./usage-governor.mjs";
import { validateProcess } from "./state.mjs";
import { normalizeOperatorSettings, OPERATOR_SETTINGS_KEY } from "./operator-settings.mjs";
import { normalizeMissionWorkQueue, MISSION_WORK_QUEUE_SCHEMA, MISSION_WORK_QUEUE_REGISTRY_KEY, MISSION_WORK_QUEUE_REGISTRY_SCHEMA } from "./mission-work-queue.mjs";
import { normalizeMissionQueueSet, MISSION_QUEUE_SET_STORE_KEY, MISSION_QUEUE_SET_STORE_SCHEMA } from "./mission-queue-sets.mjs";
import { loadMissionQueueSetVault, writeMissionQueueSetVault } from "./mission-queue-set-vault.mjs";

const PROCESS = "eic.gf.process.worker.";
const QUEUE = "eic.gf.mission-work-queue.worker.";
const EXTRA = new Set([OPERATOR_SETTINGS_KEY, "eic.gf.mission-queue-sets.v1", "eic.gf.eic-surface.v1"]);
const durable = key => key === SAFETY_KEY || key.startsWith(PROCESS) || key.startsWith(QUEUE);
const allowed = key => durable(key) || EXTRA.has(key) || key.startsWith("eic.gf.next-instruction.process.");
const copy = value => JSON.parse(JSON.stringify(value));
const snapshotStorage = data => ({ async get(keys) { return Object.fromEntries((keys == null ? Object.keys(data) : typeof keys === "string" ? [keys] : keys).filter(k => Object.hasOwn(data,k)).map(k => [k,copy(data[k])])); } });
export const BACKUP_SCHEMA = "eic.greenfield.operator-backup.v3";
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

export async function createOperatorBackup(storage, {version,extensionId,now=Date.now()}={}) {
  const all=await storage.get(null), data={}, health=[];
  const keys=new Set(Object.keys(all).map(k=>k.startsWith(CHECKPOINT_PREFIX) ? k.slice(CHECKPOINT_PREFIX.length).replace(/\.[01]$/,"") : k).filter(allowed));
  // Each record is read under its normal writer lock. No account cookies,
  // credentials or capacity leases are exported.
  for (const key of keys) {
    if (durable(key)) {
      try {
        const record=await readCheckpoint(key,storage);
        if (record.value) data[key]=record.value;
        health.push({key,health:record.health});
      } catch(error) { health.push({key,health:"UNRECOVERABLE",code:String(error.message)}); }
    } else if (key===OPERATOR_SETTINGS_KEY) data[key]=normalizeOperatorSettings(all[key]);
    else data[key]=copy(all[key]);
  }
  const payload={schema:BACKUP_SCHEMA,version,extensionId,createdAt:new Date(now).toISOString(),
    scope:"GREENFIELD_MISSIONS_AND_LOCAL_USAGE_NOT_CHROME_PROFILE_OR_EIC_DATABASE",health,data};
  return {...payload,sha256:await sha256Hex(canonicalJson(payload))};
}

export async function validateOperatorBackup(backup) {
  if (!backup || new TextEncoder().encode(JSON.stringify(backup)).length>MAX_BACKUP_BYTES) throw Error("BACKUP_SIZE_INVALID");
  const {sha256,...payload}=backup;
  if (![BACKUP_SCHEMA,"eic.greenfield.operator-backup.v2"].includes(payload.schema) || !payload.data || Array.isArray(payload.data) || !Array.isArray(payload.health)) throw Error("BACKUP_SCHEMA_INVALID");
  const encoded=payload.schema===BACKUP_SCHEMA?canonicalJson(payload):JSON.stringify(payload);
  if (sha256!==await sha256Hex(encoded)) throw Error("BACKUP_CHECKSUM_MISMATCH");
  if (payload.health.some(r=>!["VERIFIED","LEGACY","EMPTY"].includes(r.health))) throw Error("BACKUP_CONTAINS_UNRECONCILED_STORAGE");
  for (const [key,value] of Object.entries(payload.data)) {
    if (!allowed(key) || !value || typeof value!=="object") throw Error("BACKUP_KEY_OR_VALUE_INVALID");
    if (key.startsWith(PROCESS)) {
      validateProcess(value);
      if (key!==PROCESS+value.workerId) throw Error("BACKUP_WORKER_IDENTITY_MISMATCH");
    }
    if (key.startsWith(QUEUE)) {
      if (key!==QUEUE+value.workerId || value.schema!==MISSION_WORK_QUEUE_SCHEMA || !Array.isArray(value.items) || value.items.length>48 || !Array.isArray(value.history) || value.history.length>100) throw Error("BACKUP_QUEUE_INVALID");
      const normalized=normalizeMissionWorkQueue(value);
      if (normalized.items.length!==value.items.length || normalized.history.length!==value.history.length || value.items.some(i=>typeof i.goal!=="string" || i.goal.length>120000)) throw Error("BACKUP_QUEUE_WOULD_LOSE_DATA");
    }
  }
  await readSafety(snapshotStorage(payload.data));
  return copy(payload);
}

export async function restoreOperatorBackup(backup,storage,{now=Date.now(),bookmarks=null}={}) {
  // Import never overwrites an existing process, queue or usage history.
  // Partial failure remains paused; no volatile ownership is imported.
  return storageLock(storage,"eic.gf.backup.import",async()=>{
    const payload=await validateOperatorBackup(backup);
    const present=await storage.get(null);
    const actualKeys=Object.keys(present).map(k=>k.startsWith(CHECKPOINT_PREFIX) ? k.slice(CHECKPOINT_PREFIX.length).replace(/\.[01]$/,"") : k);
    if (actualKeys.some(k=>k.startsWith(PROCESS)||k.startsWith(QUEUE))) throw Error("BACKUP_RESTORE_REQUIRES_EMPTY_INSTALLATION");
    const current=await readSafety(storage);
    if (current.entries.length || current.providerHold) throw Error("BACKUP_RESTORE_WOULD_OVERWRITE_USAGE");
    const priorVault=bookmarks ? await loadMissionQueueSetVault(bookmarks) : null;
    const templates=new Map((priorVault?.sets || present[MISSION_QUEUE_SET_STORE_KEY]?.sets || []).map(s=>[s.setId,s]));
    const includeTemplate=set=>{
      if(templates.has(set.setId) && !jsonEqual(templates.get(set.setId),set))set={...set,setId:`${set.setId}-restored-${now}`};
      templates.set(set.setId,set);
    };
    for(const set of payload.data[MISSION_QUEUE_SET_STORE_KEY]?.sets||[])includeTemplate(set);
    for(const [key,q] of Object.entries(payload.data)) if(key.startsWith(QUEUE) && q.items.length) {
      const set=normalizeMissionQueueSet({setId:`backup-${q.workerId}`,name:`Återläst: ${q.items[0].label || q.workerId} – granska EIC först`,items:q.items},{now});
      includeTemplate(set);
    }
    for(const mission of payload.data[OPERATOR_SETTINGS_KEY]?.savedMissions||[])includeTemplate(normalizeMissionQueueSet({setId:`backup-mission-${mission.id || await sha256Hex(mission.goal)}`,name:`Återläst uppdrag: ${mission.label}`,items:[mission]},{now}));
    if(templates.size>64)throw Error("BACKUP_QUEUE_SET_CAPACITY");
    const imported=await readSafety(snapshotStorage(payload.data));
    imported.admissionPaused=true;
    imported.events.push({atMs:now,code:"BACKUP_IMPORTED_PAUSED",detail:"Queues disabled. Prior effects require EIC owner review before starting a new run."});
    imported.events=imported.events.slice(-200);
    await writeCheckpoint(SAFETY_KEY,imported,storage);
    let processes=0,queues=0;
    for(const [key,value] of Object.entries(payload.data)) {
      if(key===SAFETY_KEY)continue;
      if(key.startsWith(PROCESS)) {
        value.safety={...(value.safety||{}),qualityIncident:{code:"IMPORTED_RECOVERY_REQUIRES_OWNER_REVIEW",sinceMs:now}};
        value.importedRecovery={atMs:now,sourceExtensionId:payload.extensionId};
        await writeCheckpoint(key,value,storage);processes++;
      } else if(key.startsWith(QUEUE)) {
        value.enabled=false;
        await writeCheckpoint(key,value,storage);queues++;
      } else {
        const row=key===OPERATOR_SETTINGS_KEY ? {...normalizeOperatorSettings(value),workModeEnabled:false,workModeSupervisorWorkerId:""} : value;
        await storage.set({[key]:row});
        if (!jsonEqual((await storage.get(key))[key],row)) throw Error("BACKUP_RESTORE_READBACK_FAILED");
      }
    }
    // The queue registry is rebuilt from the restored queues, not trusted input.
    const registry={schema:MISSION_WORK_QUEUE_REGISTRY_SCHEMA,entries:Object.entries(payload.data).filter(([k])=>k.startsWith(QUEUE)).map(([,q])=>({workerId:q.workerId,queueId:q.queueId,revision:q.revision,boundWindowId:q.windowId,itemCount:q.items.length,activeItemId:q.activeItemId,enabled:false,updatedAt:q.updatedAt})),updatedAt:new Date(now).toISOString()};
    await storage.set({[MISSION_WORK_QUEUE_REGISTRY_KEY]:registry});
    if(templates.size){
      const store={schema:MISSION_QUEUE_SET_STORE_SCHEMA,sets:[...templates.values()],updatedAt:new Date(now).toISOString()};
      await storage.set({[MISSION_QUEUE_SET_STORE_KEY]:store});
      // A pre-existing profile vault otherwise wins on the next panel read and
      // hides restored templates. Merge first, then publish through its readback protocol.
      if(bookmarks)await writeMissionQueueSetVault(store,{bookmarks});
    }
    return {processes,queues,paused:true,requiresOwnerReview:true};
  });
}
