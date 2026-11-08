import {readCheckpoint,writeCheckpoint,storageLock} from './durable-checkpoint.mjs';
import {resetSessionStart,needsSessionStart,SESSION_START_ARCHIVE_PREFIX} from './session-start.mjs';
import {getWorkerBinding,restoreWorkerBinding,workerBindingWorkerKey} from './worker-identity.mjs';
import {readStorage} from './storage-read.mjs';
import {readMissionOwnership,missionOwnerAllowed} from './mission-ownership.mjs';
import {saveMissionWorkQueue} from './mission-work-queue.mjs';
import {saveProcess} from './process-store.mjs';
import {jsonEqual} from './canonical-json.mjs';
import {randomId} from './common.mjs';

// A persisted, enabled startup is an instruction to start work, not a claim
// that any preexisting tab is ours. After reload create a new managed tab;
// leave every old page untouched, including drafts with no known history.
export async function recoverFreshStart({original,local,session,tabs,liveTabs}) {
 const none={restored:false};
 if(original?.phase!=='ROTATING' || original.sessionRotation?.warmResume?.warm ||
    !original.sessionRotation?.rotationId || original.pendingPrompt?.sendAttempts!==0 ||
    original.pendingPrompt.dispatch || !original.gptRoot || !original.queueContext?.itemId ||
    !Number.isSafeInteger(original.generation) || original.generation>=Number.MAX_SAFE_INTEGER ||
    !liveTabs.some(t=>t.windowId===original.windowId))return none;
 const processKey='eic.gf.process.worker.'+original.workerId,queueKey='eic.gf.mission-work-queue.worker.'+original.workerId;
 return storageLock(session,`worker-operation:${original.windowId}`,async()=>{
  if(await getWorkerBinding(original.windowId,session) ||
     (await readStorage(session,workerBindingWorkerKey(original.workerId)))[workerBindingWorkerKey(original.workerId)])return none;
  const queue=await readCheckpoint(queueKey,local);
  if(queue.health==='RECOVERY_REQUIRED' || !queue.value?.enabled || queue.value.queueId!==original.queueContext.queueId ||
     queue.value.activeItemId!==original.queueContext.itemId)return none;
  const archiveKey=SESSION_START_ARCHIVE_PREFIX+randomId('restart');
  await writeCheckpoint(archiveKey,{schema:'eic.greenfield.session-start-archive.v1',process:original,automaticReplay:false},local);
  const tab=await tabs.create({windowId:original.windowId,url:original.gptRoot,active:false});
  if(!Number.isInteger(tab?.id) || tab.windowId!==original.windowId)throw new Error('SESSION_START_TAB_CREATE_FAILED');
  const current=await readCheckpoint(processKey,local),latestQueue=await readCheckpoint(queueKey,local);
  if(current.health==='RECOVERY_REQUIRED' || latestQueue.health==='RECOVERY_REQUIRED' ||
     !jsonEqual(current.value,original) || !jsonEqual(latestQueue.value,queue.value) ||
     !missionOwnerAllowed(original,await readMissionOwnership(local)))return none;
  let process={...original,tabId:tab.id,generation:original.generation+1,sessionStart:null,
   sessionRotation:{...original.sessionRotation,rotationId:randomId('restart-start'),state:'NAVIGATING',
    targetTabId:tab.id,sourceTabId:original.tabId,navigationStartedAt:new Date().toISOString(),
    hardReloadBeforeResume:false,hardReloadState:'DISABLED',warmResume:null}};
  if(!needsSessionStart(process))return none;
  process=resetSessionStart(process);process.sessionStart.archiveKey=archiveKey;
  process.restartRecovery={atMs:Date.now(),code:'FRESH_SESSION_STARTED',priorTabId:original.tabId,createdTabId:tab.id};
  await restoreWorkerBinding(original.windowId,original.workerId,session);
  await saveMissionWorkQueue(queue.value,local);
  await saveProcess(process,local,session,{expectedProcess:original});
  return {restored:true,workerId:original.workerId,processId:original.processId,phase:process.phase,
   windowId:process.windowId,tabId:tab.id,code:'FRESH_SESSION_STARTED'};
 });
}
