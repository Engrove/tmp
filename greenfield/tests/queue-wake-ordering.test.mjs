import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.GREENFIELD_BEHAVIOR_ROOT ? pathToFileURL(resolve(process.env.GREENFIELD_BEHAVIOR_ROOT)+'/') : new URL('../',import.meta.url);
const load=n=>import(new URL('lib/'+n+'.mjs',root));
const {createKeyedQueue}=await load('keyed-queue');
const {createProcess}=await load('state');
const {PHASES,TERMINAL_PHASES}=await load('contracts');
const {SESSION_ROTATION_STATES}=await load('session-rotation');
const {buildA2AEnvelope,validateA2AEnvelope}=await load('a2a');
const {sha256Hex}=await load('common');
const {conversationKey}=await load('restart-recovery');
const {isTransportPrompt}=await load('session-transport');
const {jsonEqual}=await load('canonical-json');
const {normalizeMissionWorkQueue,loadMissionWorkQueue,saveMissionWorkQueue,QUEUE_STATUS}=await load('mission-work-queue');
const background=await readFile(new URL('background.js',root),'utf8');
function fn(name,deps){const start=new RegExp('^(?:async )?function '+name+'\\(','m').exec(background)?.index;assert.notEqual(start,undefined,name);const tail=background.slice(start),end=/^}[ \t]*$/m.exec(tail);return Function(...Object.keys(deps),tail.slice(0,end.index+end[0].length)+';return '+name)(...Object.values(deps));}
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function storage(){const data={};return {get:async keys=>structuredClone(keys==null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]]))),set:async rows=>Object.assign(data,structuredClone(rows))};}
async function fixture(){
 let current={...createProcess({workerId:'worker',windowId:1,tabId:2,goal:'Mission',initialPrompt:'Continue safely'}),phase:'BLOCKED',
  lastError:{code:'SESSION_ROTATION_CHAT_READY_TIMEOUT'},queueContext:{queueId:'queue',itemId:'item',savedMissionId:'mission'},
  sessionRotation:{rotationId:'rotation',state:'NAVIGATING',sourceResponseState:'COMPLETED_RESPONSE_CHECKPOINTED',sourceUrl:'https://chatgpt.com/c/done'},
  lastPrompt:{text:'previous work',hash:await sha256Hex('previous work'),acknowledged:true,dispatchedUserTurnId:'turn',conversationKey:'https://chatgpt.com/c/done'},
  lastResponse:{text:'done',hash:await sha256Hex('done'),messageId:'reply',contract:{ok:true},observation:{ownerTrusted:true,causalMatch:true,messageId:'reply',expectedUserTurnId:'turn',pairedUserTurnId:'turn',conversationKey:'https://chatgpt.com/c/done'}}};
 const a2a=buildA2AEnvelope({process:current,objective:current.objectiveState.objective}),text=JSON.stringify(a2a);
 current.pendingPrompt={text,hash:await sha256Hex(text),a2a,sendAttempts:0,dispatch:null};
 const q=normalizeMissionWorkQueue({queueId:'queue',workerId:'worker',windowId:1,enabled:true,activeItemId:'item',items:[{itemId:'item',savedMissionId:'mission',goal:'Mission',status:'ACTIVE'}]});
 const s=storage(),events=[],alarms=[];await saveMissionWorkQueue(q,s);let finalized=0;
 const deps={PHASES,TERMINAL_PHASES,SESSION_ROTATION_STATES,QUEUE_STATUS,sha256Hex,jsonEqual,conversationKey,isTransportPrompt,validateA2AEnvelope,
  queues:createKeyedQueue(),missionQueueWakes:createKeyedQueue(),tickStartedAtMs:new Map(),runtimeReady:Promise.resolve(),runtimeFault:'',
  findProcessById:async()=>current,loadProcessForWindow:async()=>current,missionQueueForWindow:async()=>({queue:await loadMissionWorkQueue(1,s,{workerId:'worker'}),settings:{}}),
  loadMissionWorkQueue:(id,st,opts)=>loadMissionWorkQueue(id,s,opts),getWorkerBinding:async()=>({workerId:'worker'}),workerBindingMatches:async()=>true,
  readSafety:async()=>({}),acceptPendingMissionDelegationsForQueue:async()=>{},refreshOwnerWaitingSlots:async q=>q,
  legacyAdvisoryBlockedCandidate:()=>false,legacyRotationBlockedCandidate:()=>false,warmResumeTarget:()=>'',
  queueItemForProcess:(q,p)=>q.items.find(i=>i.itemId===p.queueContext.itemId),audit:async()=>{},
  finalizeQueueTerminalAndMaybeAdvance:async()=>{finalized++;return current={...current,phase:'QUEUE_WAIT',queueContext:null};},
  recordIncident:async(p,kind,code)=>events.push({kind,code}),handleUnhandledTickError:async(id,reason,error)=>{throw error;},
  MISSION_QUEUE_WAKE_PREFIX:'wake:',chrome:{storage:{local:s,session:{}},alarms:{create:async(name,opts)=>alarms.push({name,...opts})}}};
 for(const name of ['queuePendingEffectNeedsReconciliation','terminalQueueDispatchCandidate','completedUnsentQueueRotationCandidate','terminalQueueDispatchOwner',
  'reconcileRetryableTerminalQueueSlot','wakeMissionQueue','missionQueueWakeAlarmName'])deps[name]=fn(name,deps);
 // The pre-fix version has no wrapper; exercising its real enqueueTick still
 // demonstrates the nested process queue deadlock rather than a missing stub.
 deps.enqueueMissionQueueWake=background.includes('function enqueueMissionQueueWake(')?fn('enqueueMissionQueueWake',deps):deps.wakeMissionQueue;
 deps.tickProcess=fn('tickProcess',deps);
 return {deps,s,events,alarms,enqueue:fn('enqueueTick',deps),get current(){return current;},set current(p){current=p;},get finalized(){return finalized;}};
}
test('terminal tick releases process lock before real wake re-enters terminal reconciliation',async()=>{
 const h=await fixture();assert.equal(h.deps.completedUnsentQueueRotationCandidate(h.current),true);
 const result=await Promise.race([h.enqueue(h.current.processId,'test'),new Promise(r=>setTimeout(()=>r('DEADLOCK'),150))]);
 assert.notEqual(result,'DEADLOCK');assert.equal(h.finalized,1);assert.equal(h.deps.queues.size(),0);
});
test('terminal unresolved dispatch stays fenced and never requests queue wake',async()=>{
 const h=await fixture();h.current.pendingPrompt.dispatch={operationId:'uncertain',effectPossible:null};
 const result=await h.enqueue(h.current.processId,'test');assert.equal(result.phase,'BLOCKED');assert.equal(h.finalized,0);assert.equal(h.alarms.length,0);
});
test('timeout recovery retains proven conversation through previous about:blank',async()=>{
 const h=await fixture();h.current.lastManagedUrl=h.current.lastPrompt.conversationKey;
 h.current.sessionRotation.sourceUrl='about:blank';h.current.sessionRotation.readinessTimeout={aboutBlank:{result:'NAVIGATED'}};
 assert.equal(h.deps.completedUnsentQueueRotationCandidate(h.current),true);
 h.current.lastManagedUrl='https://chatgpt.com/c/foreign';assert.equal(h.deps.completedUnsentQueueRotationCandidate(h.current),false);
});
test('wake intents serialize per window while independent windows remain runnable',async()=>{
 const h=await fixture(),entered=gate(),release=gate();let calls=0,live=0,max=0;
 const deps={...h.deps,wakeMissionQueue:async id=>{calls++;live++;if(id===1){max=Math.max(max,live);entered.resolve();await release.promise;}live--;return id;}};
 const wake=fn('enqueueMissionQueueWake',deps),a=wake(1),b=wake(1);await entered.promise;
 assert.equal(calls,1);assert.equal(await wake(2),2);release.resolve();await Promise.all([a,b]);assert.equal(max,1);
});
test('queue CAS conflict preserves operator winner and arms fresh retry instead of replaying stale state',async()=>{
 const h=await fixture(),entered=gate(),release=gate();let attempts=0;
 const deps={...h.deps,wakeMissionQueue:async()=>{attempts++;const stale=await loadMissionWorkQueue(1,h.s,{workerId:'worker'});entered.resolve();await release.promise;stale.items[0].lastSummary='obsolete';return saveMissionWorkQueue(stale,h.s);}};
 const wake=fn('enqueueMissionQueueWake',deps),work=wake(1);await entered.promise;
 const winner=await loadMissionWorkQueue(1,h.s,{workerId:'worker'});winner.items[0].lastSummary='operator winner';await saveMissionWorkQueue(winner,h.s);
 release.resolve();await work;const after=await loadMissionWorkQueue(1,h.s,{workerId:'worker'});
 assert.equal(after.items[0].lastSummary,'operator winner');assert.equal(attempts,1);assert.equal(h.alarms.length,1);
 assert.ok(h.alarms[0].when>Date.now());assert.ok(h.events.some(e=>e.code==='MISSION_WORK_QUEUE_STALE_WRITE'));
});
for(const kind of ['disabled','rebound'])test('failed wake does not rearm '+kind+' worker',async()=>{
 const h=await fixture();if(kind==='disabled'){const q=await loadMissionWorkQueue(1,h.s,{workerId:'worker'});q.enabled=false;await saveMissionWorkQueue(q,h.s);}
 const deps={...h.deps,wakeMissionQueue:async()=>{throw Error('STORAGE_ERROR');},workerBindingMatches:async()=>kind!=='rebound'};
 await fn('enqueueMissionQueueWake',deps)(1);assert.equal(h.alarms.length,0);
});
test('late alarm for previous worker cannot activate replacement binding',async()=>{
 const h=await fixture();let calls=0;await fn('enqueueMissionQueueWake',{...h.deps,wakeMissionQueue:async()=>calls++})(1,'ALARM','old-worker');assert.equal(calls,0);
});
test('actual queue alarm callback consumes rejections including retry storage failure',()=>{
 const start=background.indexOf('chrome.alarms.onAlarm.addListener((alarm) => {'),end=background.indexOf('\n});',start)+4;
 const callback=background.slice(start,end);
 const child=`let cb;const chrome={storage:{session:{}},alarms:{onAlarm:{addListener:x=>cb=x}}};
 const ARCHIVED_MISSION_PURGE_ALARM='purge',STORAGE_MAINTENANCE_ALARM='storage',RECOVERY_SCAN_ALARM='scan',MISSION_QUEUE_WAKE_PREFIX='queue:';
 const parseMissionQueueWakeAlarmName=()=>({windowId:1,workerId:'w'}),workerBindingMatches=async()=>true;
 const wakeMissionQueue=async()=>{throw Object.assign(Error('stale'),{code:'MISSION_WORK_QUEUE_STALE_WRITE'});},enqueueMissionQueueWake=wakeMissionQueue;
 const recordIncident=async()=>{};let caught=[];process.on('unhandledRejection',e=>caught.push(e.code));${callback}
 cb({name:'queue:w:1'});setTimeout(()=>console.log(JSON.stringify(caught)),20);`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',child],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),[]);
});
