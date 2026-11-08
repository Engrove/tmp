import {readFile} from 'node:fs/promises';
import {extract} from './fixtures/start-runtime.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtime,startHarness} from './fixtures/start-runtime.mjs';
import {createProcess,ownerToken,isCurrentToken} from '../lib/state.mjs';
import {createSessionRotationRecord} from '../lib/session-rotation.mjs';
import {initialMissionObjective,composeA2APrompt} from '../lib/a2a.mjs';
import {selectPromptProfile,PROMPT_PROFILE,upgradedFullProfile} from '../lib/prompt-profile.mjs';
import {retainedObjectiveContext,withoutStaleQueueLabel} from '../lib/continuation-integrity.mjs';
import {readEicSurfaceState,resolveManagedGptRoot} from '../lib/managed-eic-surface.mjs';
import {missionOwnershipKey} from '../lib/mission-history.mjs';
import {loadMissionWorkQueue,saveMissionWorkQueue,QUEUE_STATUS} from '../lib/mission-work-queue.mjs';
import {readCheckpoint} from '../lib/durable-checkpoint.mjs';
import {createKeyedQueue} from '../lib/keyed-queue.mjs';
import {TERMINAL_PHASES,APP_VERSION,MAX_PROMPT_CHARS} from '../lib/contracts.mjs';
import {normalizeGreenfieldPriority} from '../lib/global-capacity-scheduler.mjs';
import {ensureWorkerBinding} from '../lib/worker-identity.mjs';
import {sessionStartDraftTarget,resetSessionStart,needsSessionStart} from '../lib/session-start.mjs';

async function harness({lateStop=false}={}) {
 const h=await startHarness();let tabsCreated=0;const cancelled=[],released=[];
 Object.assign(h.deps,{createProcess,createSessionRotationRecord,initialMissionObjective,
  composeA2APrompt,selectPromptProfile,PROMPT_PROFILE,upgradedFullProfile,retainedObjectiveContext,withoutStaleQueueLabel,
  readEicSurfaceState,resolveManagedGptRoot,PROCESS_STATUS_REQUEST:'FULL_NEXT_PROMPT',
  windowQueueForPrompt:async()=>null,delegationStatusForPrompt:async()=>null,
  progressForPrompt:async(_process,objective)=>({progress:null,objective}),loadOperatorSettings:async()=>({postDelaySeconds:0}),
  cancelSchedulerProcess:async p=>cancelled.push(p.runId),releaseGlobalPromptLease:async p=>released.push(p.reservationId),
  runtimeReady:Promise.resolve(),queues:createKeyedQueue(),publicSnapshot:p=>p,publicMissionWorkQueue:q=>q,
  missionOwnershipKey,QUEUE_STATUS,TERMINAL_PHASES,APP_VERSION,MAX_PROMPT_CHARS,normalizeGreenfieldPriority,
  DEFAULT_GREENFIELD_PRIORITY:'NORMAL',ensureWorkerBinding,appendAudit:async()=>{},setWatchdog:async()=>{},
  missionQueueForWindow:async()=>({queue:await loadMissionWorkQueue(h.current.windowId,h.local,{workerId:h.current.workerId}),settings:{}}),
  persistMissionQueue:async q=>saveMissionWorkQueue(q,h.local)});
 h.deps.chrome.tabs.create=async args=>{
  tabsCreated++;if(lateStop)await h.deps.saveProcess({...h.current,phase:'STOPPED',generation:h.current.generation+1});
  return {...args,id:100+tabsCreated};
 };
 h.deps.chrome.tabs.query=async()=>[{id:99,windowId:1,url:'https://example.org/not-chatgpt'}];
 for(const name of ['buildPendingA2A','restartRequestedSession','startMissionQueue','startRun'])h.deps[name]=runtime(name,h.deps);
 return {...h,h,get tabsCreated(){return tabsCreated;},cancelled,released};
}

for(const phase of ['PAUSED','BLOCKED','STOPPED','SENDING','WAITING','ROTATING'])test('explicit START replaces old '+phase+' with a fresh run and archives uncertain effects',async()=>{
 const f=await harness(),h=f.h;try{
  await h.deps.saveProcess({...h.current,phase,providerContentBlocks:{pauseUntilMs:Date.now()+86400000},
   pendingPrompt:{...h.current.pendingPrompt,sendAttempts:1,dispatch:{operationId:'old-send',effectPossible:null},promptPause:{reservationId:'old-lease'}}});
  const old=structuredClone(h.current),token=ownerToken(old);
  const p=await h.deps.restartRequestedSession(old);
  assert.equal(p.phase,'ROTATING');assert.notEqual(p.runId,old.runId);assert.equal(p.processId,old.processId);
  assert.equal(isCurrentToken(p,token),false);assert.equal(p.generation,old.generation+1);
  assert.equal(p.safety,null);assert.equal(p.ownerWait,null);assert.equal(p.greenfieldControl,null);
  assert.equal(p.providerContentBlocks,null);assert.equal(p.pendingPrompt.sendAttempts,0);assert.equal(p.pendingPrompt.dispatch,null);
  assert.notEqual(p.pendingPrompt.hash,old.pendingPrompt.hash);assert.match(p.pendingPrompt.a2a.objective,/do not replay/);
  assert.equal(p.queueContext.itemId,old.queueContext.itemId);assert.notEqual(p.tabId,old.tabId);
  assert.deepEqual((await readCheckpoint(p.sessionStart.archiveKey,h.local)).value.process,old);
  assert.deepEqual(f.cancelled,[old.runId]);assert.deepEqual(f.released,['old-lease']);
 }finally{h.close();}
});

test('repeating the same queued start request does not replace the newer run',async()=>{
 const f=await harness(),h=f.h;try{const old=structuredClone(h.current);
  const first=await h.deps.restartRequestedSession(old),second=await h.deps.restartRequestedSession(old);
  assert.equal(second.runId,first.runId);assert.equal(f.tabsCreated,1);
 }finally{h.close();}
});
test('a later STOP wins while START is creating the new tab',async()=>{
 const f=await harness({lateStop:true}),h=f.h;try{const old=structuredClone(h.current),p=await h.deps.restartRequestedSession(old);
  assert.equal(p.phase,'STOPPED');assert.equal(p.runId,old.runId);assert.equal(f.cancelled.length,0);
 }finally{h.close();}
});
test('Start work queue restarts active blocked slot and clears its old pause',async()=>{
 const f=await harness(),h=f.h;try{
  let q=await loadMissionWorkQueue(h.current.windowId,h.local,{workerId:h.current.workerId});
  await saveMissionWorkQueue({...q,enabled:false,items:q.items.map(i=>({...i,status:'BLOCKED',pauseUntilMs:Date.now()+3600000,lastError:{code:'OLD_BLOCK'}}))},h.local);
  await h.deps.saveProcess({...h.current,phase:'BLOCKED'});
  const result=await h.deps.startMissionQueue({windowId:1});
  assert.equal(result.ok,true);assert.equal(result.process.phase,'ROTATING');
  q=await loadMissionWorkQueue(h.current.windowId,h.local,{workerId:h.current.workerId});
  assert.equal(q.enabled,true);assert.equal(q.items[0].status,'ACTIVE');assert.equal(q.items[0].pauseUntilMs,0);assert.equal(q.items[0].lastError,null);
 }finally{h.close();}
});
test('manual start works from an unrelated browser page with no current process',async()=>{
 const f=await harness(),h=f.h;try{
  const oldLoader=h.deps.loadProcessForWindow;let first=true;
  const start=runtime('startRun',{...h.deps,loadProcessForWindow:async id=>{if(first){first=false;return null;}return oldLoader(id);}});
  const result=await start({windowId:1,goal:'Projekt: 103 - Test - GFW: GF-2.103.1028.'});
  assert.equal(result.ok,true);assert.equal(result.process.phase,'ROTATING');assert.equal(f.tabsCreated,1);
  assert.match(result.process.gptRoot,/69e0b4be34308191aa6c05db1908be1b-eic/);
  assert.equal(result.process.sessionRotation.sourceTabId,99);assert.equal(result.process.pendingPrompt.sendAttempts,0);
 }finally{h.close();}
});
test('start cleanup follows managed ChatGPT document through canonical and generic routes',async()=>{
 const h=await startHarness();try{await h.establish();const p=h.current,page=await h.page();
  for(const url of ['https://chatgpt.com/','https://chatgpt.com/g/g-start','https://chatgpt.com/g/g-start/c/older'])
   assert.equal(Boolean(sessionStartDraftTarget(p,{...page,url})),true,url);
  for(const url of ['https://example.org/','http://chatgpt.com/','https://chatgpt.com.example.org/'])
   assert.equal(Boolean(sessionStartDraftTarget(p,{...page,url})),false,url);
  assert.equal(Boolean(sessionStartDraftTarget({...p,tabId:999},page)),false);
 }finally{h.close();}
});
test('warm-to-cold fallback receives a new startup scope; warm counters are preserved',async()=>{
 const h=await startHarness();try{
  const p={...h.current,sessionBroker:{sessionSeq:1,completedQuanta:2},sessionRotation:{...h.current.sessionRotation,warmResume:{warm:true}}};
  const warm=resetSessionStart(p);assert.deepEqual(warm.sessionBroker,p.sessionBroker);
  const cold={...warm,sessionSeq:2,sessionRotation:{...warm.sessionRotation,warmResume:null}};
  assert.equal(needsSessionStart(cold),true);assert.equal(resetSessionStart(cold).sessionStart.sessionSeq,2);
 }finally{h.close();}
});

for(const phase of ['ROTATING','PAUSED','BLOCKED'])test('panel restart button reaches actual backend from '+phase,async()=>{
 const f=await harness(),h=f.h;try{
  await h.deps.saveProcess({...h.current,phase});
  const panel=await readFile(new URL('../sidepanel.js',import.meta.url),'utf8');
  const state={process:h.current,missionQueue:await loadMissionWorkQueue(1,h.local,{workerId:h.current.workerId}),queueBusy:false,windowId:1,workerId:h.current.workerId};
  const button=h.w.document.querySelector('button'),status=h.w.document.createElement('div');let messages=0;
  const deps={state,$:id=>id==='queueStart'?button:status,TERMINAL_PHASES,
   prepareLocalAnalyzerOptional:async()=>{},snapshot:async()=>{},
   chrome:{runtime:{sendMessage:async message=>{messages++;assert.equal(message.type,'EIC_GF_QUEUE_START');return h.deps.startMissionQueue(message);}}}};
  const code=['activeProcess','renderQueueStartButton','startMissionQueue'].map(name=>extract(name,panel)).join('\n');
  const ui=Function(...Object.keys(deps),code+';return {render:renderQueueStartButton,start:startMissionQueue};')(...Object.values(deps));
  deps.renderMissionQueue=()=>ui.render(state.missionQueue);
  // Handler calls its lexical renderer; supply the full queue renderer boundary.
  const start=Function(...Object.keys(deps),extract('startMissionQueue',panel)+';return startMissionQueue;')(...Object.values(deps));
  ui.render(state.missionQueue);assert.equal(button.disabled,false);assert.match(button.textContent,/Starta om/);
  const runId=h.current.runId;await start();assert.equal(messages,1);assert.notEqual(h.current.runId,runId);assert.equal(state.queueBusy,false);
 }finally{h.close();}
});
