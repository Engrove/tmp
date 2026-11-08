import {startHarness,storage} from './fixtures/start-runtime.mjs';
import {readCheckpoint} from '../lib/durable-checkpoint.mjs';
import {loadMissionWorkQueue} from '../lib/mission-work-queue.mjs';
import {APP_VERSION} from '../lib/contracts.mjs';
import {queueDispatchAdmission} from '../lib/queue-dispatch-admission.mjs';
import {SCHEDULE_BLOCK} from '../lib/queue-schedule.mjs';
import {sessionStartDraftTarget} from '../lib/session-start.mjs';
import {withReasoningDependencies} from './fixtures/reasoning-dependencies.mjs';
import {normalizeText} from '../lib/common.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import '../lib/safety-policy.js';
import {PHASES,TERMINAL_PHASES} from '../lib/contracts.mjs';
import {createKeyedQueue} from '../lib/keyed-queue.mjs';
import {reconcileDispatchObservation} from '../lib/dispatch-reconciliation.mjs';
import {promptCausalMarker} from '../lib/turn-causality.mjs';
import {conversationKey} from '../lib/restart-recovery.mjs';
import {withMissionOwner,missionOwnershipKey} from '../lib/mission-ownership.mjs';

const source=await readFile(process.env.GREENFIELD_RECHECK_BASELINE || new URL('../background.js',import.meta.url),'utf8');
const field=JSON.parse(await readFile(new URL('../rare/field_projection.json',import.meta.url),'utf8'));
const Safety=globalThis.GreenfieldSafetyPolicy;
const url='https://chatgpt.com/g/g-test';
function functionSource(name) {
  const start=source.indexOf(`async function ${name}(`);
  if(start<0)return '';
  const tail=source.slice(start),end=/^}\s*$/m.exec(tail);assert.ok(end,name);
  return tail.slice(0,end.index+end[0].length);
}
function worker(id='active',patch={}) {
  return {processId:id,workerId:id,windowId:1,tabId:1,generation:1,phase:PHASES.SENDING,gptRoot:url,
    pendingPrompt:{text:'initialization',hash:'hash-'+id,dispatch:null,promptPause:{reservationId:id,notBeforeAtMs:0}},
    safety:{hold:{code:'THINKING_SELECTION_TIMEOUT',retryAtMs:Date.now()+30000}},...patch};
}
function fixture({processes=[worker()],failed=new Set(),missing=new Set(),blocked=new Set(),globalSafety={},duringCheck,evidencePatch={},local={},snapshotAgeMs=0,inspection=null,fixedNow=null}={}) {
  const now=()=>fixedNow ?? Date.now();
  const targetUrl=inspection?.url || url;
  const ModelPolicy={...Safety,evaluateModel:(e,p,o)=>Safety.evaluateModel(e,p,{...o,now:now()})};
  const store=new Map(processes.map(p=>[p.processId,structuredClone(p)]));
  const receipts=new Map(),sent=new Map(),calls=[],wakes=[],audits=[];
  const policy=Safety.defaults;
  const freshEvidence=id=>inspection ? structuredClone(inspection.evidence) : ({...structuredClone(field.modelEvidence),...evidencePatch,observedAtMs:now(),highestEffort:receipts.get(id)||null});
  const page=p=>({url:targetUrl,documentId:'doc-'+p.processId,composerEmpty:true,composerReady:true,generating:false,modelEvidence:freshEvidence(p.processId),
    userCount:sent.has(p.processId)?1:0,assistantCount:0,lastUserId:sent.has(p.processId)?'user-'+p.processId:'',lastUserHash:sent.has(p.processId)?'hash-'+p.processId:''});
  const get=id=>structuredClone(store.get(id));
  const deps={Date:class extends Date{static now(){return now();}},sessionStartDraftTarget,normalizeText,Safety:ModelPolicy,PHASES,TERMINAL_PHASES,withMissionOwner,missionOwnershipKey,runtimeReady:Promise.resolve(),queues:createKeyedQueue(),
    chrome:{runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path},storage:{local},tabs:{get:async()=>null}},
    readSafety:async()=>({policy,...globalSafety}),loadAllProcesses:async()=>[...store.values()].map(p=>structuredClone(p)),
    findProcessById:async id=>get(id),loadProcessForWindow:async id=>[...store.values()].find(p=>p.windowId===id),
    saveProcess:async p=>{store.set(p.processId,structuredClone(p));return p;},
    tabState:async(p,kind)=>{calls.push(['observe',p.processId,kind]);if(missing.has(p.processId))throw Object.assign(new Error('MANAGED_TAB_MISSING'),{code:'MANAGED_TAB_MISSING'});const value=page(p);p.safety={...p.safety,proof:ModelPolicy.evaluateModel(value.modelEvidence,policy,{url:targetUrl,gptRoot:targetUrl})};value.modelEvidence.observedAtMs-=snapshotAgeMs;return value;},
    providerTransportPending:()=>false,
    transportTransitionBoundary:async p=>({blocked:store.get(p.processId)?.phase!==p.phase,process:get(p.processId)}),
    bridgeMessage:async(tab,message)=>{
      const p=[...store.values()].find(p=>p.tabId===tab);
      if(message.type==='EIC_GF_GET_MODEL_EVIDENCE'){
        calls.push(['model-refresh',p.processId]);
        return {ok:true,bridgeVersion:APP_VERSION,...page(p)};
      }
      if(message.type==='EIC_GF_SUBMIT_PROMPT'){
        assert.equal(p.pendingPrompt.dispatch.status,'PREPARED','write-ahead record must precede dispatch');
        assert.equal(ModelPolicy.evaluateModel(freshEvidence(p.processId),policy,{url:targetUrl,gptRoot:targetUrl,requireHighestEffort:true}).allowed,true);
        sent.set(p.processId,(sent.get(p.processId)||0)+1);
        return {ok:true,effectPossible:true,acknowledged:true,materializedReceipt:{userTurnId:'user-'+p.processId,userTurnIndex:0}};
      }
      calls.push(['maximize',p.processId]);
      await duringCheck?.(store,p);
      if(failed.has(p.processId))return {ok:false,code:'THINKING_SELECTION_TIMEOUT'};
      const proof={status:'VERIFIED',url,verifiedAtMs:Date.now(),strategy:'ORDINAL_MAXIMUM',target:'4',label:'Extra hög'};
      receipts.set(p.processId,proof);return {ok:true,proof};
    },
    holdForSafety:async(p,decision)=>{p.safety={...p.safety,hold:{...decision,retryAtMs:Date.now()+30000}};store.set(p.processId,structuredClone(p));return p;},
    probeProviderRecovery:async()=>{calls.push(['provider-recovery']);globalSafety.providerHold=null;return {};},
    scheduleFast:(id,ms)=>wakes.push({id,ms}),audit:async(p,kind,component,data)=>audits.push({id:p.processId,kind,data}),
    recordIncident:async()=>{},fleetStatusSnapshot:async()=>({workers:[...store.values()]}),
    maintainLocalStorage:async()=>{},sha256Hex:async()=>'',usageIdentity:p=>p.processId,
    budgetDecision:(state,id)=>state.admissionPaused?{allowed:false,code:'ADMISSION_PAUSED'}:state.providerHold?{allowed:false,code:'PROVIDER_QUOTA_HOLD'}:blocked.has(id)?{allowed:false,code:'LOCAL_MESSAGE_BUDGET'}:{allowed:true},
    activeSlotScheduleBlock:async p=>p.scheduleClosed?{resumeAtMs:Date.now()+60000}:null,
    ownerToken:p=>({processId:p.processId,generation:p.generation}),
    isCurrentToken:(p,t)=>Boolean(p&&p.processId===t.processId&&p.generation===t.generation),
    supportedUrl:()=>true,errorRecord:e=>({code:e.code||e.message}),nowIso:()=>new Date().toISOString()
  };
  Object.assign(deps,{runtimeFault:'',syncSafetyRetryAlarm:async()=>{},dispatchPostTime:()=>Date.now(),syncWorkModeForWorker:async()=>{},acceptPendingMissionDelegationForWorker:async p=>p,
    maybeHandleLostConversation:async p=>({handled:false,process:p}),guardShortContinuation:async p=>({handled:false,process:p}),
    guardInitializationAckRepair:async p=>({handled:false,process:p}),
    consumeCheckpointedInstructions:async()=>{},maybeHandleProviderNotice:async p=>({handled:false,process:p}),maybeRecoverPageHealth:async p=>({handled:false,process:p}),
    deliveryFencePage:(pending,p)=>p,reconcileDispatchObservation,promptCausalMarker,conversationKey,
    claimGlobalPromptSend:async()=>({allowed:true}),schedulerCapacityContext:async()=>({effectiveCapacity:2,configuredCapacity:2}),
    requestGlobalTurnSlot:async()=>({allowed:true}),wakeSchedulerProcesses:()=>{},normalizeGreenfieldPriority:s=>s,
    DEFAULT_GREENFIELD_PRIORITY:'NORMAL',PROMPT_PROFILE:{COMPACT:'COMPACT'},randomId:()=> 'dispatch-test',
    reserveUsage:async()=>({allowed:true}),TAB_HEALTH:{SUBMIT_TIMEOUT_MS:10000},isTransportPrompt:()=>true,
    commitGlobalPromptPost:async()=>({lastPromptPostedAtMs:Date.now()}),adoptSchedulerTurnForObservedEffect:async()=>{},
    createWaitingRefreshState:()=>({}),resetRecovery:()=>({recovery:{}}),
    commitTransition:async(p,phase,patch)=>{const next={...p,...patch,phase};store.set(p.processId,structuredClone(next));return next;},
    parkQueueMissionForSchedule:async p=>{const next={...p,phase:PHASES.PAUSED};store.set(p.processId,structuredClone(next));return next;}
  });
  if(local.get)deps.loadMissionWorkQueue=loadMissionWorkQueue;
  deps.enforceQueueDispatchAdmission=async()=>null;
  if(inspection){
    Object.assign(deps,{queueDispatchAdmission,SCHEDULE_BLOCK});
    for(const name of ['readQueueDispatchAdmission','enforceQueueDispatchAdmission'])
      deps[name]=Function(...Object.keys(deps),functionSource(name)+';return '+name)(...Object.values(deps));
  }
  const names=['ensureHighestThinkingBeforeSend','sendingSafetyDecision','recheckProviderHold','recheckProcessModel','panelSafetyAction','contentSend','commitObservedDispatchToWaiting','tickSending','tickProcess'];
  const runtime=Function(...Object.keys(withReasoningDependencies(deps)),names.map(functionSource).join('\n')+'\nreturn {action:panelSafetyAction,tick:tickProcess,sending:tickSending};')(...Object.values(deps));
  return {store,deps,calls,wakes,audits,receipts,sent,proof:id=>Safety.evaluateModel(freshEvidence(id),policy,{url,gptRoot:url,requireHighestEffort:true}),
    sending:id=>runtime.sending(get(id)),tick:id=>runtime.tick(id,'test'),run:()=>runtime.action({type:'EIC_GF_SAFETY_RECHECK',windowId:1},{id:'test',url:'chrome-extension://test/sidepanel.html'})};
}

test('captured label passes ordinary inspection but cannot prove highest available level',()=>{
  const evidence={...field.modelEvidence,observedAtMs:Date.now()};
  assert.equal(Safety.evaluateModel(evidence,Safety.defaults,{url,gptRoot:url}).allowed,true);
  assert.equal(Safety.evaluateModel(evidence,Safety.defaults,{url,gptRoot:url,requireHighestEffort:true}).code,'THINKING_MAXIMUM_UNVERIFIED');
});
test('breaking only ordinary approval removes false success with the same failed maximum control',async()=>{
  const rows=[];
  for(let run=1;run<=6;run++){
    const f=fixture({evidencePatch:{effortLabel:'Balanserad'},failed:new Set(['active'])});const result=await f.run();
    rows.push({run,ok:result.ok,maximumVerified:f.proof('active').allowed});
  }
  if(process.env.GREENFIELD_CAUSAL_OUTPUT)await writeFile(process.env.GREENFIELD_CAUSAL_OUTPUT,JSON.stringify(rows,null,2)+'\n');
  assert.equal(rows.filter(r=>r.ok&&!r.maximumVerified).length,0,JSON.stringify(rows));
});
test('manual recheck performs maximum verification before reporting success and waking initialization',async()=>{
  const rows=[];
  for(let run=1;run<=6;run++){
    const f=fixture(),result=await f.run();
    rows.push({run,ok:result.ok,maximumVerified:f.proof('active').allowed,attempts:f.calls.filter(c=>c[0]==='maximize').length,woken:f.wakes.some(w=>w.id==='active')});
  }
  if(process.env.GREENFIELD_RECHECK_FREQUENCY)await writeFile(process.env.GREENFIELD_RECHECK_FREQUENCY,JSON.stringify(rows,null,2)+'\n');
  assert.equal(rows.filter(r=>!r.maximumVerified||!r.woken||!r.attempts).length,0,JSON.stringify(rows));
});
test('failed maximum check is reported as failed and the hold is retained',async()=>{
  const f=fixture({failed:new Set(['active'])});const result=await f.run();
  assert.equal(result.ok,false);assert.equal(f.store.get('active').safety.hold.code,'THINKING_SELECTION_TIMEOUT');
  assert.equal(f.wakes.some(w=>w.id==='active'),false);
});
test('a missing sibling tab cannot cancel the healthy worker check',async()=>{
  const f=fixture({processes:[worker('missing',{tabId:2,windowId:2}),worker()],missing:new Set(['missing'])});
  const result=await f.run();assert.equal(f.proof('active').allowed,true);assert.ok(f.wakes.some(w=>w.id==='active'));
  assert.equal(result.recheck.results.find(r=>r.processId==='missing').ok,false);
});
test('a paused worker keeps its hold and phase while another worker resumes',async()=>{
  const f=fixture({processes:[worker('paused',{phase:PHASES.PAUSED,tabId:2,windowId:2,missionPause:{state:'ARMED'}}),worker()]});
  await f.run();assert.equal(f.store.get('paused').phase,PHASES.PAUSED);assert.ok(f.store.get('paused').safety.hold);
  assert.equal(f.calls.some(c=>c[1]==='paused'),false);assert.equal(f.wakes.some(w=>w.id==='paused'),false);
  assert.equal(f.proof('active').allowed,true);assert.ok(f.wakes.some(w=>w.id==='active'));
});
for(const code of ['ADMISSION_PAUSED','PROVIDER_QUOTA_HOLD','LOCAL_MESSAGE_BUDGET'])test(`model recheck cannot clear ${code}`,async()=>{
  const f=fixture({globalSafety:code==='ADMISSION_PAUSED'?{admissionPaused:true}:code==='PROVIDER_QUOTA_HOLD'?{providerHold:{sourceWorkerId:'other'}}:{},blocked:code==='LOCAL_MESSAGE_BUDGET'?new Set(['active']):new Set()});
  const result=await f.run();assert.equal(result.ok,false);assert.equal(f.store.get('active').safety.hold.code,code);assert.equal(f.wakes.length,0);
});
test('STOP while the UI check awaits cannot be overwritten or restarted',async()=>{
  const f=fixture({duringCheck:async(store,p)=>{store.set(p.processId,{...p,phase:PHASES.STOPPED,generation:p.generation+1});}});
  await f.run();assert.equal(f.store.get('active').phase,PHASES.STOPPED);assert.equal(f.wakes.length,0);
});
test('an uncertain previous dispatch remains owned by reconciliation',async()=>{
  const p=worker();p.pendingPrompt.dispatch={operationId:'prior',effectPossible:null};
  const f=fixture({processes:[p]});await f.run();assert.equal(f.calls.some(c=>c[0]==='maximize'),false);
  assert.equal(f.store.get('active').pendingPrompt.dispatch.operationId,'prior');assert.equal(f.receipts.size,0);
});
for(const manual of [false,true])test(`${manual?'manual recheck':'automatic start'} reaches dispatch and WAITING through real runtime functions`,async()=>{
  const p=worker();if(!manual)p.safety.hold=null;
  const f=fixture({processes:[p]});
  if(manual){const result=await f.run();assert.equal(result.ok,true);}
  await f.tick('active');assert.equal(f.sent.get('active'),1);
  assert.equal(f.store.get('active').pendingPrompt.dispatch.acknowledged,true);
  await f.tick('active');assert.equal(f.store.get('active').phase,PHASES.WAITING);
  assert.equal(f.store.get('active').lastPrompt.dispatchedUserTurnId,'user-active');assert.equal(f.sent.get('active'),1);
});
test('closed schedule parks one worker while the other initializes',async()=>{
  const scheduled=worker('scheduled',{tabId:2,windowId:2,queueContext:{itemId:'slot'},scheduleClosed:true});scheduled.safety.hold=null;
  const active=worker();active.safety.hold=null;const f=fixture({processes:[scheduled,active]});
  await Promise.all([f.tick('scheduled'),f.tick('active')]);
  assert.equal(f.store.get('scheduled').phase,PHASES.PAUSED);assert.equal(f.sent.has('scheduled'),false);
  await f.tick('active');assert.equal(f.store.get('active').phase,PHASES.WAITING);assert.equal(f.sent.get('active'),1);
});
test('explicit quota recovery still works when its source and every live worker have fresh approved UI',async()=>{
  const f=fixture({globalSafety:{providerHold:{sourceWorkerId:'active',signature:'quota',multipleSources:false}}});
  const result=await f.run();assert.equal(result.ok,true);assert.equal(f.proof('active').allowed,true);
  assert.equal(f.calls.filter(c=>c[0]==='provider-recovery').length,1);
  await f.tick('active');await f.tick('active');assert.equal(f.store.get('active').phase,PHASES.WAITING);
});

// Join the production archive/clear/initialization path to the production send
// dispatcher. Chrome messages and provider UI remain the fixture boundary.
test('unknown draft cleanup reaches one initialization dispatch and WAITING',async()=>{
 const h=await startHarness({text:'An old arbitrary draft with no owner receipt.'});try{
  h.w.history.replaceState({},'',url);
  await h.deps.saveProcess({...h.current,gptRoot:url,queueContext:null});
  await h.establish();await h.tick();await h.tick();
  assert.equal(h.current.phase,'SENDING');assert.equal(h.composer.textContent,'');
  const p=structuredClone(h.current),initialHash=p.pendingPrompt.hash;
  p.pendingPrompt.promptPause={reservationId:'start-reservation',notBeforeAtMs:0};
  const f=fixture({processes:[p],local:h.local});
  await f.sending(p.processId);assert.equal(f.sent.get(p.processId),1,JSON.stringify({phase:f.store.get(p.processId)?.phase,safety:f.store.get(p.processId)?.safety,dispatch:f.store.get(p.processId)?.pendingPrompt?.dispatch}));
  await f.sending(p.processId);const waiting=f.store.get(p.processId);
  assert.equal(waiting.phase,'WAITING');assert.equal(waiting.lastPrompt.hash,initialHash);
  assert.equal(waiting.lastPrompt.transportKind,'SESSION_INITIALIZATION');
  assert.equal(f.sent.get(p.processId),1);assert.equal(h.clicks,0);
 }finally{h.close();}
});


test('automatic stale-hold recovery reaches one dispatch and WAITING without manual recheck',async()=>{
 const p=worker();p.safety.hold={code:'MODEL_EVIDENCE_STALE',retryAtMs:Date.now()+30000};
 const f=fixture({processes:[p],snapshotAgeMs:20000});
 await f.tick(p.processId);assert.equal(f.sent.get(p.processId),1);
 assert.ok(f.calls.filter(c=>c[0]==='model-refresh').length>=2);
 assert.equal(f.store.get(p.processId).safety.hold,null);
 await f.tick(p.processId);assert.equal(f.store.get(p.processId).phase,PHASES.WAITING);
 assert.equal(f.store.get(p.processId).lastPrompt.hash,p.pendingPrompt.hash);assert.equal(f.sent.get(p.processId),1);
});

if(process.env.GREENFIELD_STALE_DIAGNOSTIC)test('field: captured stale initialization resumes same prompt, session and queue slot exactly once',async()=>{
 const diagnostic=JSON.parse(await readFile(process.env.GREENFIELD_STALE_DIAGNOSTIC,'utf8'));
 const local=storage(diagnostic.storage);
 const key=Object.keys(diagnostic.storage).find(k=>k.startsWith('eic.gf.process.worker.')&&k.endsWith('worker-05fa9358-1f6c-40e2-9250-20fa22cabcf7'));
 assert.ok(key);const p=(await readCheckpoint(key,local)).value;
 assert.equal(p.safety.hold.code,'MODEL_EVIDENCE_STALE');assert.equal(p.safety.proof.code,'UI_MODEL_COMPATIBLE');
 assert.equal(p.pendingPrompt.dispatch,null);assert.equal(p.pendingPrompt.sendAttempts,0);
 const fixedNow=Date.parse(diagnostic.createdAt),inspection=diagnostic.modelInspection;
 const f=fixture({processes:[p],local,inspection,fixedNow,snapshotAgeMs:20000});
 // Fixture boundary: Chrome transport/scheduler/provider replies. Queue and
 // ownership state come from the export; no historical receipts are inserted.
 const q=await loadMissionWorkQueue(p.windowId,local,{workerId:p.workerId});
 assert.equal(q.activeItemId,p.queueContext.itemId);
 assert.equal(q.items.find(i=>i.itemId===q.activeItemId).reasoningLevel,'xhigh');
 await f.sending(p.processId);
 const sent=f.store.get(p.processId);assert.equal(f.sent.get(p.processId),1,JSON.stringify(sent.safety));
 assert.equal(sent.safety.hold,null);assert.equal(sent.pendingPrompt.hash,p.pendingPrompt.hash);
 assert.equal(sent.sessionSeq,p.sessionSeq);assert.deepEqual(sent.queueContext,p.queueContext);
 await f.sending(p.processId);const waiting=f.store.get(p.processId);
 assert.equal(waiting.phase,PHASES.WAITING);assert.equal(waiting.lastPrompt.hash,p.pendingPrompt.hash);
 assert.equal(waiting.lastPrompt.transportKind,'SESSION_INITIALIZATION');assert.equal(f.sent.get(p.processId),1);
});
