// A new session/quantum owns a new startup scope. Historical runtime holds
// are evidence about the prior scope, not admission rules for this one.
export const SESSION_START_SCHEMA='eic.greenfield.session-start.v1';
export const SESSION_START_ARCHIVE_PREFIX='eic.gf.session-start-archive.v1.';
export function needsSessionStart(process){
 const rotation=process?.sessionRotation;
 return process?.phase==='ROTATING' && Boolean(rotation?.rotationId) &&
  process.pendingPrompt?.sendAttempts===0 && !process.pendingPrompt?.dispatch &&
  !['NAVIGATE','OBSERVE'].includes(process.responseRepair?.state) &&
  (process.sessionStart?.schema!==SESSION_START_SCHEMA || process.sessionStart.id!==rotation.rotationId || process.sessionStart.sessionSeq!==process.sessionSeq);
}
export function resetSessionStart(process,{now=Date.now()}={}){
 if(!needsSessionStart(process))return process;
 const rotation={...process.sessionRotation,readinessWait:null,draftRecovery:null,eicLanding:null};
 return {...process,sessionRotation:rotation,
  sessionStart:{schema:SESSION_START_SCHEMA,id:rotation.rotationId,sessionSeq:process.sessionSeq,
   processId:process.processId,workerId:process.workerId,state:'PREPARING',startedAt:new Date(now).toISOString(),
   policy:'ARCHIVE_COMPOSER_AND_START',priorStateArchived:true},
  safety:null,ownerWait:null,ownerProgressResult:null,missionPause:null,greenfieldControl:null,
  lastDecision:null,lastError:null,dispatchWait:null,responseCandidate:null,responseInterleave:null,
  waitingRefresh:null,deliveryRetry:null,deliveryNotice:null,noDeltaState:null,responseRepair:null,
  lastPrompt:null,lastResponse:null,sessionInitialization:null,sessionBroker:rotation.warmResume?.warm ? process.sessionBroker : null,
  providerContentBlocks:null,tabHealth:null,queueWait:null,
  storageRecoveryRequired:false,priorStateUnknown:false,
  recovery:null,detached:null,completedAt:null,updatedAt:new Date(now).toISOString()};
}
function managedChatPage(value){
 try { const u=new URL(value);return u.protocol==='https:' && ['chatgpt.com','chat.openai.com'].includes(u.hostname) && !u.username && !u.password; }
 catch { return false; }
}
export function sessionStartDraftTarget(process,page){
 const start=process?.sessionStart,rotation=process?.sessionRotation;
 const preparing=process?.phase==='ROTATING' && start?.state==='PREPARING' && rotation?.state==='NAVIGATING';
 const initializing=process?.phase==='SENDING' && start?.state==='READY' &&
  process.pendingPrompt?.transportKind==='SESSION_INITIALIZATION';
 return start?.schema===SESSION_START_SCHEMA && start.policy==='ARCHIVE_COMPOSER_AND_START' &&
  start.id===rotation?.rotationId && start.processId===process.processId && start.workerId===process.workerId &&
  start.sessionSeq===process.sessionSeq && (preparing || initializing) && rotation.targetTabId===process.tabId &&
  process.pendingPrompt?.sendAttempts===0 && !process.pendingPrompt.dispatch &&
  !process.greenfieldControl?.hardStop && !process.storageRecoveryRequired &&
  page?.documentId && managedChatPage(page.url) &&
  page.composerReady===true && page.composerEmpty===false && page.generating===false;
}
