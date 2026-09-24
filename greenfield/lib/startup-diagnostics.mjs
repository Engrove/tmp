import { canonicalJson } from "./canonical-json.mjs";
import { sha256Hex } from "./common.mjs";
// Explicit operator export. Read raw records: never invoke a failing decoder
// before preserving the exact evidence needed to diagnose that decoder.
export async function createStartupDiagnostics(storage,{version,runtimeFault,recovery,storageContract=null,modelInspection=null,now=Date.now()}={}) {
  const all=await storage.get(null);
  const keep=k=>k==="eic.gf.safety.v1" || k==="eic.gf.storage-contract-probe.v1" || k.startsWith("eic.gf.checkpoint.") || k.startsWith("eic.gf.rc1-checkpoint-repair.") || k.startsWith("eic.gf.process.worker.") || k.startsWith("eic.gf.mission-work-queue.");
  const kept=Object.fromEntries(Object.entries(all).filter(([k])=>keep(k)));
  const payload={schema:"eic.greenfield.startup-diagnostics.v1",appVersion:version,createdAt:new Date(now).toISOString(),runtimeFault:String(runtimeFault||""),recovery:recovery||null,storageContract,modelInspection,responseObservation:responseObservationIndex(kept),storage:kept};
  return {...payload,sha256:await sha256Hex(canonicalJson(payload))};
}

// v1.8.2: why responses were held or admitted, per live process and per parked
// queue slot, read from the durable responseObservationTrace (ids, lengths and
// reasons only). The raw records stay in storage; this is an index over them.
function responseObservationIndex(kept){
  const rows=[];
  const add=(source,process,extra={})=>{
    if(!process || typeof process!=="object" || !Array.isArray(process.responseObservationTrace)) return;
    rows.push({source,processId:String(process.processId||""),workerId:String(process.workerId||""),phase:String(process.phase||""),turn:Number(process.turn||0),...extra,trace:process.responseObservationTrace});
  };
  for(const [key,value] of Object.entries(kept)){
    if(key.startsWith("eic.gf.process.worker.")) add("LIVE_PROCESS",value);
    else if(key.startsWith("eic.gf.mission-work-queue.worker.") && Array.isArray(value?.items)){
      for(const item of value.items) add("PARKED_QUEUE_SLOT",item?.processSnapshot,{itemId:String(item?.itemId||""),label:String(item?.label||"").slice(0,120),lastOutcome:String(item?.lastOutcome||"")});
    }
  }
  return rows;
}
