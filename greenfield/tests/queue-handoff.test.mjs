import {withReasoningDependencies} from './fixtures/reasoning-dependencies.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PHASES, TERMINAL_PHASES} from '../lib/contracts.mjs';
import {createProcess, transitionProcess, ownerToken, isCurrentToken} from '../lib/state.mjs';
import {jsonEqual} from '../lib/canonical-json.mjs';
import {applyQueueParkTransition, latestResponseRoundTripMs} from '../lib/queue-planning.mjs';
import {selectNextMissionItem, QUEUE_STATUS} from '../lib/mission-work-queue.mjs';
import {queueItemNextRunnableAtMs} from '../lib/queue-schedule.mjs';
const root=process.env.GREENFIELD_HANDOFF_BASELINE ? pathToFileURL(resolve(process.env.GREENFIELD_HANDOFF_BASELINE)+'/') : new URL('../',import.meta.url);
const bg=await readFile(new URL('background.js',root),'utf8');
function source(name) {
 const start=bg.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
 assert.ok(start>=0,name);const rest=bg.slice(start),end=rest.search(/^}\s*$/m);return rest.slice(0,end+1);
}
function fn(name,deps){return Function(...Object.keys(withReasoningDependencies(deps)),source(name)+`;return ${name};`)(...Object.values(deps));}
function seed(){
 const p={...createProcess({workerId:'w',windowId:1,tabId:2,goal:'GF-2.103.1028',initialPrompt:'owner task'}),phase:'ANALYZING',pendingPrompt:null,turn:33,
  queueContext:{queueId:'q',workerId:'w',itemId:'a',savedMissionId:'ma',interactionCount:5,maxInteractions:6},
  lastPrompt:{hash:'prompt',dispatchedUserTurnId:'u'},lastResponse:{hash:'response',text:'Completed; root remains open.',observation:{causalMatch:true,ownerTrusted:true,pairedUserTurnId:'u',expectedUserTurnId:'u'}},safety:{hold:null}};
 const q={queueId:'q',workerId:'w',windowId:1,enabled:true,activeItemId:'a',cursorOrder:0,items:[
 {goal:'GF-2.103.1028',itemId:'a',savedMissionId:'ma',status:'ACTIVE',order:0,maxInteractions:6},
 {goal:'GF-2.105.1029',itemId:'b',savedMissionId:'mb',status:'READY',order:1,maxInteractions:6}]};
 return {p,q};
}
function harness({blocked=false,none=false,crash=false}={}){
 const s=seed();let current=structuredClone(s.p),queue=structuredClone(s.q),activations=0,parks=0;
 const alarms=[],incidents=[];
 const deps={PHASES,TERMINAL_PHASES,QUEUE_STATUS,ownerToken,isCurrentToken,jsonEqual,deepClone:structuredClone,applyQueueParkTransition,latestResponseRoundTripMs,
  selectNextMissionItem,queueItemNextRunnableAtMs,Date,nowIso:()=>new Date().toISOString(),MISSION_QUEUE_WAKE_PREFIX:'wake:',
  chrome:{storage:{local:{}},alarms:{clear:async()=>true,create:async(name,opts)=>alarms.push({name,...opts})}},
  readNextInstruction:async()=>null,readSafety:async()=>({}),cancelSchedulerProcess:async()=>{},recordIncident:async(p,kind,code)=>incidents.push({kind,code}),
  alarmName:()=> 'watch',missionPauseAlarmName:()=> 'pause',audit:async()=>{},syncOverlay:async()=>{},
  loadProcessForWindow:async()=>structuredClone(current),loadMissionWorkQueue:async()=>structuredClone(queue),
  missionQueueForWindow:async()=>({queue:structuredClone(queue),settings:{}}),
  persistMissionQueue:async q=>{queue=structuredClone(q);parks++;if(crash){crash=false;throw Error('CRASH_AFTER_QUEUE_WRITE');}return structuredClone(queue);},
  commitTransition:async(p,phase,patch,opts)=>{const fence=await opts?.beforeSave?.();if(fence?.blocked)return fence.process;return current=transitionProcess(p,phase,patch);},
  activateRunnableQueueSuccessor:async({priorProcess,queue:q})=>{
   if(blocked)return{blocked:true,code:'MISSION_QUEUE_ACTIVATION_SOURCE_CHANGED',process:priorProcess,queue:q};
   if(none)return{none:true,process:priorProcess,queue:q};
   activations++;queue.activeItemId='b';queue.items[1].status='ACTIVE';return{process:current={...current,processId:'next',phase:'ROTATING',queueContext:{queueId:'q',itemId:'b'}},queue,selectedItemId:'b'};},
  queues:{enqueue:(_,f)=>f()},instructionQueues:{enqueue:(_,f)=>f()},
  acceptPendingMissionDelegationsForQueue:async()=>{},refreshOwnerWaitingSlots:async q=>q,terminalQueueDispatchCandidate:()=>false,
  reconcileRetryableTerminalQueueSlot:async()=>null,reconcileTerminalQueueSlot:async()=>{},reconcileLegacyInitializationSlots:async q=>q,
  BACKGROUND_AUDIT_SESSION_ID:'test'
 };
 for(const name of ['queuePendingEffectNeedsReconciliation','queueItemNeedsEffectReconciliation','queueActivationSourceMatches','missionQueueWakeAlarmName',
  'syncMissionQueueWakeAlarm','earliestQueueWakeAtMs','enterQueueWait','parkedQueueWaitBoundary','finishParkedQueueHandoff','parkedAnalysisHandoffItem','recoverParkedAnalysisHandoff']){
  if(bg.includes(`function ${name}(`))deps[name]=fn(name,deps);
 }
 const park=fn('parkSlotAndActivateNext',deps);
 deps.wakeMissionQueue=fn('wakeMissionQueue',deps);
 const args=()=>({current:structuredClone(current),queue:structuredClone(queue),settings:{},item:structuredClone(queue.items[0]),
  parkedSnapshot:{...structuredClone(current),queueContext:{...current.queueContext,interactionCount:0},objectiveState:{...current.objectiveState,status:'PARKED_QUEUE',objective:'Continue from owner'}},
  resume:{objective:'Continue from owner',previousResponseHash:current.lastResponse.hash},outcome:'QUANTUM_EXHAUSTED',summary:'completed',resumedQuantumProgress:0,quantumCompleted:true});
 return{deps,alarms,incidents,args,park:()=>park(args()),wake:()=>deps.wakeMissionQueue(1,'RESTART'),get current(){return current;},set current(v){current=v;},get queue(){return queue;},set queue(v){queue=v;},get activations(){return activations;},get parks(){return parks;},unblock:()=>{blocked=false;none=false;}};
}
test('aborted successor after durable park exits ANALYZING and later wakes exactly once',async()=>{
 const h=harness({blocked:true}),original=structuredClone(h.current);await h.park();
 assert.equal(h.current.phase,'QUEUE_WAIT');assert.equal(h.queue.activeItemId,'');assert.equal(h.activations,0);
 assert.deepEqual(h.queue.items[0].processSnapshot.lastResponse,original.lastResponse);
 assert.equal(h.queue.items[0].quantumProgress,0);h.unblock();await h.wake();await h.wake();
 assert.equal(h.activations,1);assert.equal(h.current.queueContext.itemId,'b');assert.equal(h.parks,1);
});
test('all successor candidates deferred still settles the completed park',async()=>{
 const h=harness({none:true});await h.park();assert.equal(h.current.phase,'QUEUE_WAIT');assert.equal(h.parks,1);
});
test('restart after queue-write crash consumes stored checkpoint without recounting or analysis',async()=>{
 const h=harness({crash:true});await assert.rejects(h.park(),/CRASH_AFTER_QUEUE_WRITE/);
 const checkpoint=structuredClone(h.queue.items[0]);assert.equal(h.current.phase,'ANALYZING');await h.wake();await h.wake();
 assert.equal(h.activations,1);assert.equal(h.parks,1);assert.deepEqual(h.queue.items[0],checkpoint);
});
test('empty active slot with runnable work has a durable wake, not an alarm clear',async()=>{
 const h=harness();h.queue.activeItemId='';h.queue.items[0].status='READY';await h.deps.syncMissionQueueWakeAlarm(h.queue);
 assert.ok(h.alarms.some(a=>a.when>Date.now()&&a.when<=Date.now()+60000),'bounded wake required');
});

for(const mutation of ['disabled','active-slot','other-active','worker','queue','turn','generation','prompt','response','pending','hold','quality','storage','missing-resume','stopped','changed-goal'])test(`park recovery refuses unproven/changed state: ${mutation}`,async()=>{
 const h=harness({crash:true});await assert.rejects(h.park());
 if(mutation==='disabled')h.queue.enabled=false;
 if(mutation==='active-slot')h.queue.activeItemId='b';
 if(mutation==='other-active')h.queue.items[1].status='ACTIVE';
 if(mutation==='worker')h.queue.workerId='other';
 if(mutation==='queue')h.queue.queueId='other';
 if(mutation==='turn')h.current.turn++;
 if(mutation==='generation')h.current.generation++;
 if(mutation==='prompt')h.current.lastPrompt.hash='other';
 if(mutation==='response')h.current.lastResponse.hash='other';
 if(mutation==='pending')h.current.pendingPrompt={hash:'in-flight',dispatch:{effectPossible:true}};
 if(mutation==='hold')h.current.safety.hold={code:'DISPATCH_EFFECT_UNRESOLVED'};
 if(mutation==='quality')h.current.safety.qualityIncident={code:'IN_FLIGHT_QUALITY_QUARANTINE'};
 if(mutation==='storage')h.current.storageRecoveryRequired=true;
 if(mutation==='missing-resume')h.queue.items[0].resume=null;
 if(mutation==='stopped')h.current.phase='STOPPED';
 if(mutation==='changed-goal')h.current.goal='different';
 const before=structuredClone(h.current),q=structuredClone(h.queue);
 const result=await h.deps.recoverParkedAnalysisHandoff(h.current);
 assert.equal(result,null);assert.deepEqual(h.current,before);assert.deepEqual(h.queue,q);assert.equal(h.activations,0);
});
test('STOP racing wait publication cannot be overwritten',async()=>{
 const h=harness({crash:true});await assert.rejects(h.park());
 const prior=structuredClone(h.current);h.current.phase='STOPPED';
 const result=await h.deps.finishParkedQueueHandoff(prior,h.queue,{reason:'test',parkedItemId:'a'});
 assert.equal(result.phase,'STOPPED');assert.equal(h.current.phase,'STOPPED');assert.equal(h.activations,0);
});
test('new checkpoint is never consumed twice by repeated recovery calls',async()=>{
 const h=harness({crash:true});await assert.rejects(h.park());
 await h.deps.recoverParkedAnalysisHandoff(h.current);const once=structuredClone(h.current);
 assert.equal(await h.deps.recoverParkedAnalysisHandoff(h.current),null);
 assert.deepEqual(h.current,once);assert.equal(h.parks,1);assert.equal(h.activations,0);
});

test('rejected real activation leaves caller queue and speculative resume untouched',async()=>{
 const h=harness(),q=structuredClone(h.queue),before=structuredClone(q),prior=structuredClone(h.current);
 const deps={...h.deps,
  queueActivationEffectBoundary:async()=>({current:prior,liveQueue:structuredClone(q)}),
  supportedUrl:()=>true,ROTATION_TIMEOUT_BLANK_URL:'about:blank',
  chrome:{storage:{local:{}},tabs:{get:async()=>({id:2,windowId:1,url:'https://chatgpt.com/g/g-test/c/chat'})},alarms:{create:async()=>{}}},
  readEicSurfaceState:async()=>({entryUrl:'https://chatgpt.com/g/g-test'}),resolveManagedGptRoot:()=> 'https://chatgpt.com/g/g-test',
  resolveSavedMissionReference:()=>({record:null}),currentSavedMissions:async()=>[],readMissionOwnership:async()=>({}),missionOwnershipKey:()=> 'gfw:other',
  findDormantMissionRecoverySource:async()=>null,liveMissionWorkerIds:()=>[],PROCESS_STATUS_REQUEST:'FULL_NEXT_PROMPT',
  buildQueueActivationProcess:async()=>({...prior,phase:'ROTATING',queueContext:{...prior.queueContext,itemId:'b'}}),
  ensureMissionExecutionOwner:async()=>({allowed:false,code:'MISSION_PRIOR_EFFECT_UNRESOLVED'}),ARCHIVED_MISSION_PURGE_ALARM:'purge'};
 const activate=fn('activateQueueItem',deps);
 const result=await activate({queue:q,item:q.items[1],settings:{},windowId:1,priorProcess:prior});
 assert.equal(result.blocked,true);assert.deepEqual(q,before,'rejection cannot leave ACTIVE in successor caller state');
});

// Exercise the actual analysis dispatcher entry: recovery precedes page/model
// inspection and owner enrichment, which used to reject the orphan forever.
test('analysis tick repairs persisted handoff before consulting page or models',async()=>{
 const h=harness({crash:true});await assert.rejects(h.park());
 const tick=fn('tickAnalyzing',{...h.deps,tabState:()=>{throw Error('must not query page');},runAnalysis:()=>{throw Error('must not analyze twice');}});
 assert.equal((await tick(h.current)).phase,'QUEUE_WAIT');assert.equal(h.parks,1);
});

test('truncated diagnostics retain queue checkpoint identity and alarm-relevant status',async()=>{
 const {queueProgressIndex,capDiagnosticExport}=await import('../lib/startup-diagnostics.mjs');
 const h=harness({crash:true});await assert.rejects(h.park());
 const storage={'eic.gf.mission-work-queue.worker.w':{...h.queue,padding:'x'.repeat(50000)}};
 const index=queueProgressIndex(storage);
 const bounded=capDiagnosticExport({storage,queueProgress:index},12000);
 assert.equal(bounded.exportRetention.truncated,true);assert.deepEqual(bounded.queueProgress,index);
 assert.equal(index[0].activeItemId,'');assert.equal(index[0].items[0].resumeResponseHash,'response');
 assert.equal(index[0].items[0].objectiveStatus,'PARKED_QUEUE');
});

test('duplicate-slot activation keeps the newly armed watchdog for the same process ID',async()=>{
 const h=harness(),cleared=[];
 const park=fn('parkSlotAndActivateNext',{...h.deps,chrome:{alarms:{clear:async name=>cleared.push(name)}},
  activateRunnableQueueSuccessor:async()=>({process:{...h.current,phase:'ROTATING'}})});
 assert.equal((await park(h.args())).phase,'ROTATING');assert.deepEqual(cleared,[]);
});
test('loss of successor eligibility during queue persistence does not reanalyze the saved response',async()=>{
 const h=harness();
 const park=fn('parkSlotAndActivateNext',{...h.deps,persistMissionQueue:async q=>{
  q.items[1].status='PAUSED';q.items[1].pauseUntilMs=Date.now()+3600000;h.queue=structuredClone(q);return structuredClone(q);
 }});
 assert.equal((await park(h.args())).phase,'QUEUE_WAIT');assert.equal(h.current.pendingPrompt,null);
 assert.equal(h.queue.items[0].quantumProgress,0);assert.equal(h.activations,0);
});
test('future schedule wake retains its original time, while current work gets a bounded retry',async()=>{
 const h=harness();h.queue.activeItemId='a';h.queue.items[1].status='PAUSED';
 const expected=Date.now()+15000;h.queue.items[1].pauseUntilMs=expected;
 await h.deps.syncMissionQueueWakeAlarm(h.queue);assert.equal(h.alarms.at(-1).when,expected);
});
