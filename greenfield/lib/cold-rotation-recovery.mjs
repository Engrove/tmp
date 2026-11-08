import {draftRecoveryTarget,staleDraftSource} from './stale-draft-recovery.mjs';
import {findDraftRecoverySource,readDraftRecoverySource} from './draft-source-inventory.mjs';
import {readCheckpoint,storageLock} from './durable-checkpoint.mjs';
import {jsonEqual} from './canonical-json.mjs';
import {readMissionOwnership,missionOwnerAllowed} from './mission-ownership.mjs';
import {getWorkerBinding,restoreWorkerBinding,workerBindingWorkerKey} from './worker-identity.mjs';
import {readStorage} from './storage-read.mjs';
import {saveProcess} from './process-store.mjs';
import {saveMissionWorkQueue} from './mission-work-queue.mjs';

// Extension reload loses storage.session. A cold rotation has no new user
// turn yet. Its own, already completed initialization draft can prove lineage;
// a root URL, reused numeric tab ID or a sibling's draft cannot.
export async function recoverColdRotation({original,local,session,tabs,liveTabs,ensureBridge}) {
 const none={restored:false};
 if(original?.phase!=='ROTATING' || original.sessionRotation?.state!=='NAVIGATING' ||
    original.sessionRotation?.queueSwitch!==true || !original.queueContext?.itemId ||
    !Number.isInteger(original.tabId) || original.sessionRotation.targetTabId!==original.tabId ||
    !Number.isSafeInteger(original.generation) || original.generation<1 || original.generation>=Number.MAX_SAFE_INTEGER) return none;
 const processKey='eic.gf.process.worker.'+original.workerId;
 const queueKey='eic.gf.mission-work-queue.worker.'+original.workerId;
 const processAt=tab=>({...original,windowId:tab.windowId,tabId:tab.id,
  sessionRotation:{...original.sessionRotation,targetTabId:tab.id}});
 const queueMatches=queue=>queue?.enabled===true && queue.workerId===original.workerId &&
  queue.queueId===original.queueContext.queueId && queue.activeItemId===original.queueContext.itemId &&
  Array.isArray(queue.items) && queue.items.some(item=>item.itemId===queue.activeItemId && item.status==='ACTIVE');
 const queueRecord=await readCheckpoint(queueKey,local);
 if(queueRecord.health==='RECOVERY_REQUIRED' || !queueMatches(queueRecord.value))return none;
 const roots=liveTabs.filter(tab=>tab.url===original.gptRoot);
 if(!roots.length || roots.length>16)return none;
 const matches=[];
 for(const tab of roots){
  if(await getWorkerBinding(tab.windowId,session))continue;
  // A failed observation cannot establish uniqueness among candidate tabs.
  await ensureBridge(tab.id);
  const observed=await tabs.sendMessage(tab.id,{type:'EIC_GF_GET_PAGE_STATE',source:'cold-rotation-restart-proof'});
  if(!observed?.ok)throw new Error('COLD_ROTATION_PAGE_UNAVAILABLE');
  const page=observed.state,target=processAt(tab);
  if(!draftRecoveryTarget(target,page))continue;
  const candidate=await findDraftRecoverySource(target,page.composerTextHash,local,liveTabs);
  if(candidate?.kind!=='SETTLED_INITIALIZATION' || candidate.sourceWorkerId!==original.workerId)continue;
  const source=await readDraftRecoverySource(candidate.sourceLocator,local);
  if(source?.sessionInitialization?.acknowledgement?.binding?.queueId!==original.queueContext.queueId)continue;
  matches.push({tab,page,candidate});
 }
 if(matches.length!==1)return none;
 const {tab,page,candidate}=matches[0];
 return storageLock(session,`worker-operation:${tab.windowId}`,async()=>{
  // Reobserve the exact document before the final durable state/owner checks.
  const liveTab=await tabs.get(tab.id);
  const observed=await tabs.sendMessage(tab.id,{type:'EIC_GF_GET_PAGE_STATE',source:'cold-rotation-restart-recheck'});
  if(liveTab.windowId!==tab.windowId || liveTab.url!==original.gptRoot || !observed?.ok ||
     observed.state?.documentId!==page.documentId || observed.state?.composerTextHash!==candidate.hash ||
     !draftRecoveryTarget(processAt(liveTab),observed.state))return none;
  const rootIdentity=rows=>rows.filter(t=>t.url===original.gptRoot).map(t=>`${t.windowId}:${t.id}`).sort();
  if(!jsonEqual(rootIdentity(await tabs.query({})),rootIdentity(roots)))return none;
  const current=await readCheckpoint(processKey,local),queue=await readCheckpoint(queueKey,local);
  if(current.health==='RECOVERY_REQUIRED' || queue.health==='RECOVERY_REQUIRED' ||
     !jsonEqual(current.value,original) || !jsonEqual(queue.value,queueRecord.value) || !queueMatches(queue.value) ||
     !missionOwnerAllowed(original,await readMissionOwnership(local)))return none;
  const source=await readDraftRecoverySource(candidate.sourceLocator,local);
  const proof=await staleDraftSource(source,original,candidate.hash);
  if(proof?.kind!=='SETTLED_INITIALIZATION' || proof.sourceWorkerId!==original.workerId ||
     source?.sessionInitialization?.acknowledgement?.binding?.queueId!==original.queueContext.queueId)return none;
  if(await getWorkerBinding(tab.windowId,session) ||
     (await readStorage(session,workerBindingWorkerKey(original.workerId)))[workerBindingWorkerKey(original.workerId)])return none;
  const code='COLD_ROTATION_SETTLED_DRAFT_PROVEN';
  const process={...processAt(tab),generation:original.generation+1,updatedAt:new Date().toISOString(),
   restartRecovery:{atMs:Date.now(),code,priorWindowId:original.windowId,priorTabId:original.tabId,
    draftHash:candidate.hash,sourceLocator:candidate.sourceLocator}};
  await restoreWorkerBinding(tab.windowId,original.workerId,session);
  await saveMissionWorkQueue({...queue.value,windowId:tab.windowId},local);
  await saveProcess(process,local,session,{expectedProcess:original});
  // This restores ownership only. Normal recovery archives/clears the draft,
  // and normal policy, schedule, budget and dispatch gates still own sending.
  return {restored:true,workerId:original.workerId,processId:original.processId,
   windowId:tab.windowId,tabId:tab.id,phase:process.phase,code};
 });
}
