import { writeCheckpoint, readCheckpoint, checkpointKeys } from "./durable-checkpoint.mjs";
import { jsonEqual } from "./canonical-json.mjs";
// Runs once per service-worker lifetime against installed Chrome storage,
// before migration or new work. This never submits a model request.
export async function probeStorageContract(storage) {
  const key="eic.gf.storage-contract-probe.v1";
  const value={z:"Åäö / 😀",a:{z:2,a:1},list:[{b:2,a:1},null,true],schema:"eic.gf.storage-contract-probe.v1"};
  try {
    // Only this reserved disposable probe namespace is reset. A crash during
    // yesterday's self-test must not strand startup like RC1's queue did.
    await storage.remove([key,...checkpointKeys(key)]);
    await writeCheckpoint(key,value,storage);
    const record=await readCheckpoint(key,storage);
    if(record.health!=="VERIFIED" || !jsonEqual(record.value,value))throw Error("VALUE_CHANGED");
    await storage.remove([key,...checkpointKeys(key)]);
    return {verified:true,codec:"EIC_SORTED_JSON_V1",checkedAt:new Date().toISOString(),keyOrderChanged:Object.keys(record.value).join("|")!==Object.keys(value).join("|")};
  }catch(error){throw Error(`STORAGE_CONTRACT_PROBE_FAILED:${error.message}`);}
}
