import { readStorage } from "./storage-read.mjs";
import { unpackStorageValue } from "./storage-codec.mjs";
import { STORAGE_RETENTION_KEY } from "./storage-retention.mjs";
import { serializedUtf8Bytes, MAX_LOG_BYTES } from "./log-byte-budget.mjs";
import { canonicalJson } from "./canonical-json.mjs";
import { RUNTIME_BUILD_SHA256 } from "./build-identity.mjs";
import { storageLockHealth } from "./durable-checkpoint.mjs";
import { sha256Hex } from "./common.mjs";
import { INCIDENT_LOG_KEY } from "./incident-log.mjs";
import { GLOBAL_CAPACITY_SCHEDULER_KEY } from "./global-capacity-scheduler.mjs";
import { GLOBAL_PROMPT_GATE_KEY } from "./global-prompt-gate.mjs";
import { MISSION_OWNERSHIP_KEY, missionOwnershipKey } from "./mission-ownership.mjs";
// Explicit operator export. Read raw records: never invoke a failing decoder
// before preserving the exact evidence needed to diagnose that decoder.
export async function createStartupDiagnostics(storage,{version,runtimeFault,recovery,storageContract=null,modelInspection=null,now=Date.now()}={}) {
  const all=await readStorage(storage,null,{decode:false});
  // v1.8.13: also the incident log and who holds the capacity slots and the
  // prompt gate (ids and times only), so stops and rotations can be explained.
  const keep=k=>k==="eic.gf.safety.v1" || k==="eic.gf.storage-contract-probe.v1" || k===INCIDENT_LOG_KEY || k===GLOBAL_CAPACITY_SCHEDULER_KEY || k===GLOBAL_PROMPT_GATE_KEY || k.startsWith("eic.gf.checkpoint.") || k.startsWith("eic.gf.rc1-checkpoint-repair.") || k.startsWith("eic.gf.process.worker.") || k.startsWith("eic.gf.mission-work-queue.") || k.startsWith("eic.gf.mission-history.v1.") || k==="eic.gf.recovery-notices.v1";
  const kept=Object.fromEntries(Object.entries(all).filter(([k])=>keep(k) || k===STORAGE_RETENTION_KEY || k.startsWith('eic.gf.unsent-draft-archive.v1.')));
  const logical={},storageCodecErrors=[];
  for(const [key,value] of Object.entries(kept)) {
    try { logical[key]=await unpackStorageValue(key,value); }
    catch(error) { storageCodecErrors.push({key,code:String(error?.message || error)}); }
  }
  const runtimeIdentity = { buildSha256: RUNTIME_BUILD_SHA256,
    evidence: "LOADED_MODULE_BUILD_STAMP", installedFilesVerified: false,
    storageWaits: storageLockHealth(storage) };
  const payload={schema:"eic.greenfield.startup-diagnostics.v1",appVersion:version,runtimeIdentity,createdAt:new Date(now).toISOString(),runtimeFault:String(runtimeFault||""),recovery:recovery||null,storageContract,modelInspection,storageRetention:all[STORAGE_RETENTION_KEY] || null,storageCodecErrors,startupProgress:startupProgressIndex(logical),queueProgress:queueProgressIndex(logical),responseObservation:responseObservationIndex(logical),incidents:incidentIndex(logical[INCIDENT_LOG_KEY]),storage:kept};
  const bounded = capDiagnosticExport(payload, MAX_LOG_BYTES);
  return {...bounded,sha256:await sha256Hex(canonicalJson(bounded))};
}

// Compact queue/process relations survive byte-budget trimming of raw queues.
// This is diagnostic evidence, never authority to activate or replay work.
export function queueProgressIndex(kept) {
  return Object.entries(kept).filter(([key])=>key.startsWith('eic.gf.mission-work-queue.worker.'))
    .map(([,q])=>({queueId:q.queueId,workerId:q.workerId,windowId:q.windowId,
      enabled:q.enabled,activeItemId:q.activeItemId,revision:q.revision,updatedAt:q.updatedAt,
      cursorOrder:q.cursorOrder,cooldownUntilMs:q.cooldownUntilMs,
      items:(q.items || []).map(item=>({itemId:item.itemId,status:item.status,
        label:String(item.label || '').slice(0,160),goal:String(item.goal || '').split(/\r?\n/,1)[0].slice(0,200),
        savedMissionId:item.savedMissionId || '',lastErrorCode:item.lastError?.code || '',
        lastOutcome:item.lastOutcome,quantumProgress:item.quantumProgress,maxInteractions:item.maxInteractions,
        pauseUntilMs:item.pauseUntilMs,blockedRetryAtMs:item.blockedRetryAtMs,
        lastQuantumCompletedAtMs:item.lastQuantumCompletedAtMs,
        processId:item.processSnapshot?.processId || '',phase:item.processSnapshot?.phase || '',
        objectiveStatus:item.processSnapshot?.objectiveState?.status || '',
        promptHash:item.processSnapshot?.lastPrompt?.hash || '',responseHash:item.processSnapshot?.lastResponse?.hash || '',
        pendingHash:item.processSnapshot?.pendingPrompt?.hash || '',
        pendingDispatchStatus:item.processSnapshot?.pendingPrompt?.dispatch?.status || '',
        pendingEffectPossible:item.processSnapshot?.pendingPrompt?.dispatch?.effectPossible ?? null,
        resumeResponseHash:item.resume?.previousResponseHash || ''}))}));
}

// Keep bounded progress evidence even if the export drops bulky raw history.
// Persisted phase is not a claim that the browser tab is still alive.
export function startupProgressIndex(kept) {
  return Object.entries(kept).filter(([key])=>key.startsWith('eic.gf.process.worker.')).map(([,p])=>({
    processId:p.processId, workerId:p.workerId, phase:p.phase, updatedAt:p.updatedAt,
    liveness:'NOT_ESTABLISHED_BY_STORAGE_EXPORT', tabId:p.tabId, windowId:p.windowId,
    pendingHash:p.pendingPrompt?.hash || '', sendAttempts:p.pendingPrompt?.sendAttempts ?? null,
    pendingDispatchStatus:p.pendingPrompt?.dispatch?.status || '',
    pendingEffectPossible:p.pendingPrompt?.dispatch?.effectPossible ?? null,
    lastPromptHash:p.lastPrompt?.hash || '',
    lastPromptHasUserTurn:Boolean(p.lastPrompt?.dispatchedUserTurnId),
    lastResponseHash:p.lastResponse?.hash || '',
    transportKind:p.pendingPrompt?.transportKind || '',
    dispatchStatus:p.pendingPrompt?.dispatch?.status || '',
    effectPossible:p.pendingPrompt?.dispatch?.effectPossible ?? null,
    dispatchError:p.pendingPrompt?.dispatch?.error?.code || '',
    rotationState:p.sessionRotation?.state || '',
    readinessWait:p.sessionRotation?.readinessWait || null,
    draftRecovery:p.sessionRotation?.draftRecovery || null,
    holdCode:p.safety?.hold?.code || '', lastErrorCode:p.lastError?.code || ''
  }));
}

// v1.8.13: counts per incident kind and code over the retained rows.
function incidentIndex(log){
  const rows=Array.isArray(log?.rows)?log.rows:[];
  const byKind={};
  for(const row of rows){
    const kind=String(row?.kind||"");
    const code=String(row?.code||"");
    byKind[kind]||={count:0,codes:{}};
    byKind[kind].count+=1;
    byKind[kind].codes[code]=(byKind[kind].codes[code]||0)+1;
  }
  return {rows:rows.length,droppedRows:Number(log?.droppedRows||0),firstAtMs:rows[0]?.atMs??null,lastAtMs:rows[rows.length-1]?.atMs??null,byKind};
}

// v1.8.2: why responses were held or admitted, per live process and per parked
// queue slot, read from the durable responseObservationTrace (ids, lengths and
// reasons only). The raw records stay in storage; this is an index over them.
export function responseObservationIndex(kept){
  const rows=[];
  const add=(source,process,extra={})=>{
    if(!process || typeof process!=="object" || !Array.isArray(process.responseObservationTrace)) return;
    const owner=kept[MISSION_OWNERSHIP_KEY]?.owners?.[missionOwnershipKey(process)];
    rows.push({source,processId:String(process.processId||""),workerId:String(process.workerId||""),phase:String(process.phase||""),turn:Number(process.turn||0),recordedAt:process.updatedAt||"",liveness:"NOT_ESTABLISHED_BY_STORAGE_EXPORT",supersededByWorkerId:owner && owner.workerId!==process.workerId ? owner.workerId : "",...extra,trace:process.responseObservationTrace});
  };
  for(const [key,value] of Object.entries(kept)){
    if(key.startsWith("eic.gf.process.worker.")) add("PROCESS_RECORD",value);
    else if(key.startsWith("eic.gf.mission-work-queue.worker.") && Array.isArray(value?.items)){
      for(const item of value.items) {
        const active=item?.itemId===value.activeItemId || item?.status==="ACTIVE";
        add(active?"ACTIVE_QUEUE_CHECKPOINT":"PARKED_QUEUE_SLOT",item?.processSnapshot,{itemId:String(item?.itemId||""),itemStatus:String(item?.status||""),isActiveQueueItem:active,checkpointPhase:String(item?.processSnapshot?.phase||""),label:String(item?.label||"").slice(0,120),lastOutcome:String(item?.lastOutcome||"")});
      }
    }
  }
  return rows;
}

// A diagnostics export is a bounded log, NOT a complete storage backup.
// Drop older observations/history first; if the raw storage snapshot is still
// larger, omit the oldest persisted records and report every omitted key.
export function capDiagnosticExport(original, maxBytes = MAX_LOG_BYTES) {
  const payload = {...original, responseObservation:[...(original.responseObservation || [])],
    storage:{...(original.storage || {})},
    exportRetention:{maxBytes, truncated:false, omittedObservations:0, omittedStorageKeys:[]}};
  const reserve = 4096; // SHA-256, retention metadata and file JSON envelope.
  let size = serializedUtf8Bytes(payload) + 80;
  if (size <= maxBytes - reserve) return payload;
  const observations = payload.responseObservation.sort((a,b)=>
    String(a.recordedAt || '').localeCompare(String(b.recordedAt || '')));
  while (size > maxBytes - reserve && observations.length) {
    const row = observations.shift();
    payload.exportRetention.omittedObservations++;
    size -= serializedUtf8Bytes(row) + 1;
  }
  const priority = key => {
    if (key.startsWith('eic.gf.mission-history.v1.')) return 0;
    if (key.startsWith('eic.gf.checkpoint.eic.gf.mission-history.v1.')) return 0;
    if (key.startsWith('eic.gf.checkpoint.eic.gf.mission-work-queue.worker.')) return 1;
    if (key.startsWith('eic.gf.checkpoint.eic.gf.process.worker.')) return 2;
    if (key.startsWith('eic.gf.mission-work-queue.worker.')) return 3;
    if (key.startsWith('eic.gf.process.worker.')) return 4;
    return 5;
  };
  const keys = Object.keys(payload.storage).sort((a,b)=>
    priority(a) - priority(b) || a.localeCompare(b));
  for (const key of keys) {
    if (size <= maxBytes - reserve) break;
    const value = payload.storage[key];
    delete payload.storage[key];
    payload.exportRetention.omittedStorageKeys.push(key);
    size -= serializedUtf8Bytes(value) + serializedUtf8Bytes(key) + 3;
  }
  payload.exportRetention.truncated = true;
  // Final check measures the ACTUAL bytes in the minified JSON output.
  // This loop also covers long omission metadata / non-ASCII strings.
  while (serializedUtf8Bytes({...payload,sha256:'0'.repeat(64)}) > maxBytes &&
      payload.exportRetention.omittedStorageKeys.length) {
    // Omission keys themselves can consume bytes on huge legacy registries.
    payload.exportRetention.omittedStorageKeys.shift();
    payload.exportRetention.omittedStorageKeyNamesTruncated = true;
  }
  if (serializedUtf8Bytes({...payload,sha256:'0'.repeat(64)}) > maxBytes)
    throw new Error('DIAGNOSTICS_EXPORT_BYTE_BUDGET_EXCEEDED');
  return payload;
}
