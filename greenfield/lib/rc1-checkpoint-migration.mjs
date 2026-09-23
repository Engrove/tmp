import { CHECKPOINT_PREFIX, reconcileRc1Checkpoint } from "./durable-checkpoint.mjs";
import { SAFETY_KEY, readSafety, pauseAdmission } from "./usage-governor.mjs";
import { normalizeMissionWorkQueue } from "./mission-work-queue.mjs";
import { jsonEqual } from "./canonical-json.mjs";

export async function recoverRc1Checkpoints(storage) {
  const rows=await storage.get(null),queuePrefix="eic.gf.mission-work-queue.worker.";
  const keys=[...new Set(Object.keys(rows).filter(k=>k.startsWith(CHECKPOINT_PREFIX)).map(k=>k.slice(CHECKPOINT_PREFIX.length).replace(/\.[01]$/,"")))];
  keys.sort((a,b)=>a===SAFETY_KEY?-1:b===SAFETY_KEY?1:a.localeCompare(b));
  const repaired=[];
  for(const key of keys) {
    if(key!==SAFETY_KEY && !key.startsWith(queuePrefix))continue;
    const result=await reconcileRc1Checkpoint(key,storage,async(value,{primaryMatches})=>{
      if(key===SAFETY_KEY) {
        const probe={async get(){return {[SAFETY_KEY]:value};}};
        await readSafety(probe); // Validate policy and every retained usage row.
        const requiresReview=!primaryMatches && (value.entries.length>0 || Boolean(value.providerHold));
        return {value:{...value,admissionPaused:value.admissionPaused===true || requiresReview},requiresReview};
      }
      if(value.workerId!==key.slice(queuePrefix.length) || !jsonEqual(normalizeMissionWorkQueue(value),value))return null;
      const requiresReview=!primaryMatches && (value.items.length>0 || value.history.length>0 || Boolean(value.activeItemId) || value.enabled===true);
      if(requiresReview)await pauseAdmission(true,storage);
      return {value:primaryMatches ? value : {...value,enabled:false},requiresReview};
    });
    if(result.changed)repaired.push(result);
  }
  return repaired;
}
