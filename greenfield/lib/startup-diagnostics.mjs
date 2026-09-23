import { canonicalJson } from "./canonical-json.mjs";
import { sha256Hex } from "./common.mjs";
// Explicit operator export. Read raw records: never invoke a failing decoder
// before preserving the exact evidence needed to diagnose that decoder.
export async function createStartupDiagnostics(storage,{version,runtimeFault,recovery,storageContract=null,modelInspection=null,now=Date.now()}={}) {
  const all=await storage.get(null);
  const keep=k=>k==="eic.gf.safety.v1" || k==="eic.gf.storage-contract-probe.v1" || k.startsWith("eic.gf.checkpoint.") || k.startsWith("eic.gf.rc1-checkpoint-repair.") || k.startsWith("eic.gf.process.worker.") || k.startsWith("eic.gf.mission-work-queue.");
  const payload={schema:"eic.greenfield.startup-diagnostics.v1",appVersion:version,createdAt:new Date(now).toISOString(),runtimeFault:String(runtimeFault||""),recovery:recovery||null,storageContract,modelInspection,storage:Object.fromEntries(Object.entries(all).filter(([k])=>keep(k)))};
  return {...payload,sha256:await sha256Hex(canonicalJson(payload))};
}
