import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const digest=s=>createHash('sha256').update(s).digest('hex');
import {pathToFileURL} from 'node:url';
const root=process.env.GF_AUDIT_BASELINE?pathToFileURL(resolve(process.env.GF_AUDIT_BASELINE)+'/'):new URL('../',import.meta.url);
const bg=await readFile(new URL('background.js',root),'utf8');
const load=n=>import(new URL('lib/'+n+'.mjs',root));
const {conversationKey}=await load('restart-recovery');
const {PHASES}=await load('contracts');
const transport=await load('session-transport');
const {evaluateWaitingRefresh,WAITING_STALE_INTERVAL_MS}=await load('waiting-refresh');
const {createStartupDiagnostics}=await load('startup-diagnostics');
const {RUNTIME_BUILD_SHA256}=await load('build-identity');
function runtime(name,deps){const start=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(bg);assert.ok(start,name);const tail=bg.slice(start.index),end=/^}\s*$/m.exec(tail);return Function(...Object.keys(deps),tail.slice(0,end.index+end[0].length)+`;return ${name}`)(...Object.values(deps));}
const MIN=60000, posted=Date.parse('2026-10-19T20:20:34.448Z');
function seed(){return {processId:'p',workerId:'w',runId:'r',windowId:1,tabId:2,phase:'WAITING',turn:9,sessionSeq:2,
  queueContext:{queueId:'q',itemId:'i',savedMissionId:'m',interactionCount:3,maxInteractions:5},
  sessionInitialization:{status:'PENDING',sessionSeq:2,conversationKey:'',workPrompt:{text:'Full frozen objective',hash:digest('Full frozen objective'),dispatch:null,sendAttempts:0}},
  pendingPrompt:null,lastPrompt:{transportKind:'SESSION_INITIALIZATION',hash:'init',acknowledged:true,conversationKey:'',dispatchedUserTurnId:'user',postedAtMs:posted,postedAt:new Date(posted).toISOString()},safety:{proof:{allowed:true}}};}
const page={url:'https://chatgpt.com/g/g-test-eic',generating:false,assistantCount:0};
for(const elapsed of [30*MIN-1,30*MIN,30*MIN+1,479*MIN])test(`unproven initialization conversation still reaches recovery, elapsed ${elapsed} ms`,async()=>{
  const calls=[];
  const p=seed();
  const tick=runtime('tickSessionInitialization',{conversationKey,
    holdForSafety:async(p,d)=>{calls.push(['hold',d.code]);return p;},
    recordResponseObservation:async(p,r)=>{calls.push(['observe',r]);return p;},
    maybeEscalateWaitingRefresh:async p=>{const d=evaluateWaitingRefresh({now:posted+elapsed,waitingSince:p.lastPrompt.postedAt,acknowledged:true});calls.push(['recovery',d.action]);return{handled:d.action!=='WAIT',process:p};}});
  await tick(p,page);
  assert.equal(calls.some(c=>c[0]==='recovery'),true,'a missing URL must not bypass bounded recovery');
  assert.equal(calls.find(c=>c[0]==='recovery')[1],elapsed<30*MIN?'WAIT':'F5');
  assert.equal(p.pendingPrompt,null);assert.equal(p.queueContext.interactionCount,3);
});
test('corrupt initialization state is held without navigating or admitting work',async()=>{
  const p=seed();p.sessionInitialization.sessionSeq=1;let reloads=0;
  const tick=runtime('tickSessionInitialization',{conversationKey,holdForSafety:async p=>p,
    recordResponseObservation:async p=>p,maybeEscalateWaitingRefresh:async p=>{reloads++;return{handled:false,process:p};}});
  await tick(p,page);assert.equal(reloads,0);assert.equal(p.pendingPrompt,null);
});
test('stale init is parked blocked with exact unsent work, even without a next runnable slot',async()=>{
  const p=seed(), item={itemId:'i',savedMissionId:'m',status:'ACTIVE'},queue={queueId:'q',workerId:'w',enabled:true,activeItemId:'i',items:[item]};let args;
  const f=runtime('parkQueueMissionAfterStale',{PHASES,QUEUE_STATUS:{BLOCKED:'BLOCKED',ACTIVE:'ACTIVE'},...transport,
    missionQueueForWindow:async()=>({queue,settings:{}}),queueItemForProcess:()=>item,
    sha256Hex:async s=>digest(s),normalizeMissionQuantumInteractions:n=>n,deepClone:structuredClone,nowIso:()=>new Date(posted+120*MIN).toISOString(),
    queueResumeRecordFromAnalysis:x=>({objective:x.effectiveNextPrompt}),
    queueActivationEffectBoundary:async()=>({blocked:false,process:p}),
    parkSlotAndActivateNext:async a=>{args=a;return a.parkedSnapshot;}});
  const result=await f(p);
  assert.equal(args.blockedUntilReconciled,true,'unconfirmed init must not be returned to READY and silently retried');
  assert.equal(args.idleWhenNoNext,true,'single-slot queue must not spin fresh initialization sessions');
  assert.equal(result.phase,'BLOCKED');assert.deepEqual(result.sessionInitialization.workPrompt,p.sessionInitialization.workPrompt);
  assert.deepEqual(result.queueContext,p.queueContext);assert.equal(args.resume.sourceResponseState,'INITIALIZATION_UNCONFIRMED_WORK_UNSENT');
  assert.equal(typeof args.beforePark,'function','operator/queue ownership must be rechecked at park');
});
test('diagnostics disclose loaded build identity and do not claim installed-file verification',async()=>{
  const d=await createStartupDiagnostics({get:async()=>({})},{version:'fixture'});
  assert.equal(d.runtimeIdentity?.buildSha256,RUNTIME_BUILD_SHA256);
  assert.equal(d.runtimeIdentity?.installedFilesVerified,false);
});

test('scoped operator retry resolves the parked conversation hold, retaining full work and schedule',async()=>{
 const p=seed();p.phase='BLOCKED';p.safety.hold={code:'SESSION_INITIALIZATION_CONVERSATION_UNPROVEN',sinceMs:posted};
 const schedule={timeZone:'Europe/Helsinki',enabled:true};
 let q={queueId:'q',workerId:'w',activeItemId:'',items:[{itemId:'i',savedMissionId:'m',status:'BLOCKED',lastOutcome:'SESSION_INITIALIZATION_RECOVERY_EXHAUSTED',processSnapshot:p,schedule}]};
 const original=structuredClone(q);let writes=0;
 const update=runtime('updateQueueFromUi',{PHASES,QUEUE_STATUS:{BLOCKED:'BLOCKED',READY:'READY',ACTIVE:'ACTIVE'},
   missionQueueForWindow:async()=>({settings:{},worker:{workerId:'w'}}),chrome:{storage:{local:{}}},
   loadMissionWorkQueue:async()=>q,queueItemNeedsEffectReconciliation:()=>false,sha256Hex:async s=>digest(s),
   nowIso:()=>new Date().toISOString(),deepClone:structuredClone,
   persistMissionQueue:async next=>{writes++;return q=next;},enqueueMissionQueueWake:async()=>{},
   appendAudit:async()=>{},BACKGROUND_AUDIT_SESSION_ID:'fixture',publicMissionWorkQueue:q=>q});
 await update({windowId:1,operation:'RETRY_INITIALIZATION',itemId:'i'});
 assert.equal(writes,1);assert.equal(q.items[0].status,'READY');
 assert.deepEqual(q.items[0].processSnapshot.sessionInitialization.workPrompt,original.items[0].processSnapshot.sessionInitialization.workPrompt);
 assert.deepEqual(q.items[0].schedule,original.items[0].schedule);
 assert.equal(q.items[0].savedMissionId,'m');assert.equal(q.items[0].processSnapshot.safety.hold,null);
 q=original;q.items[0].processSnapshot.safety.hold={code:'DISPATCH_EFFECT_UNRESOLVED'};
 await assert.rejects(update({windowId:1,operation:'RETRY_INITIALIZATION',itemId:'i'}),/INITIALIZATION_RETRY_SOURCE_UNPROVEN/);
 assert.equal(writes,1);
});

for(const foreign of ['worker','queue','mission','item'])test(`stale initialization cannot park a different ${foreign} in a reused window`,async()=>{
 const p=seed(),item={itemId:'i',savedMissionId:'m',status:'ACTIVE'},q={queueId:'q',workerId:'w',activeItemId:'i',enabled:true,items:[item]};
 if(foreign==='worker')q.workerId='other';if(foreign==='queue')q.queueId='other';
 if(foreign==='mission')item.savedMissionId='other';if(foreign==='item')q.activeItemId='other';
 let parks=0;const f=runtime('parkQueueMissionAfterStale',{PHASES,QUEUE_STATUS:{BLOCKED:'BLOCKED',ACTIVE:'ACTIVE'},...transport,
   missionQueueForWindow:async()=>({queue:q,settings:{}}),queueItemForProcess:()=>item,
   normalizeMissionQuantumInteractions:n=>n,deepClone:structuredClone,sha256Hex:async s=>digest(s),nowIso:()=>new Date().toISOString(),
   queueResumeRecordFromAnalysis:()=>({}),queueActivationEffectBoundary:async()=>({blocked:false}),
   parkSlotAndActivateNext:async()=>{parks++;return p;}});
 await f(p);assert.equal(parks,0,'window identity alone cannot authorize another queue mutation');
});

for(const missing of ['disabled','removed-item'])test(`operator ${missing} never falls through to a new session on stale recovery`,async()=>{
 const p=seed(),item={itemId:'i',savedMissionId:'m',status:'ACTIVE'},q={queueId:'q',workerId:'w',activeItemId:'i',enabled:missing!=='disabled',items:[item]};
 const f=runtime('parkQueueMissionAfterStale',{missionQueueForWindow:async()=>({queue:q,settings:{}}),queueItemForProcess:()=>missing==='removed-item'?null:item});
 assert.equal(await f(p),p,'null would authorize the caller\'s fallback rotation');
});

const {applyQueueParkTransition,latestResponseRoundTripMs}=await load('queue-planning');
const {selectNextMissionItem}=await load('mission-work-queue');
for(const mode of ['next','single','paused','crash','stop-at-fence'])test(`actual park composition preserves identity and advances once: ${mode}`,async()=>{
 let current={...seed(),generation:3}, writes=0,activations=0,crash=mode==='crash';
 current.safety.hold={code:'SESSION_INITIALIZATION_CONVERSATION_UNPROVEN'};
 let queue={queueId:'q',workerId:'w',windowId:1,enabled:true,activeItemId:'i',cursorOrder:0,
   items:[{itemId:'i',savedMissionId:'m',status:'ACTIVE',order:0,maxInteractions:5,goal:'Projekt: 73 - Test - GFW: GF-5.73.1009.'},
   ...(mode==='single'?[]:[{itemId:'next',savedMissionId:'independent',goal:'Projekt: 74 - Test - GFW: GF-3.74.1011.',status:mode==='paused'?'PAUSED':'READY',order:1,maxInteractions:5,pauseUntilMs:mode==='paused'?Date.now()+3600000:0}])]};
 const otherWorkers=Array.from({length:4},(_,i)=>({workerId:`other-${i}`,activeItemId:'untouched',schedule:{pauseUntilMs:Date.now()+3600000}}));
 const beforeOthers=structuredClone(otherWorkers), original=structuredClone(current);
 const deps={PHASES,QUEUE_STATUS:{BLOCKED:'BLOCKED',ACTIVE:'ACTIVE'},...transport,applyQueueParkTransition,latestResponseRoundTripMs,
   selectNextMissionItem,deepClone:structuredClone,nowIso:()=>new Date().toISOString(),normalizeMissionQuantumInteractions:n=>n,
   sha256Hex:async s=>digest(s),queueResumeRecordFromAnalysis:x=>({objective:x.effectiveNextPrompt}),
   missionQueueForWindow:async()=>({queue:structuredClone(queue),settings:{}}),queueItemForProcess:(q,p)=>q.items.find(i=>i.itemId===p.queueContext.itemId),
   queueActivationEffectBoundary:async()=>mode==='stop-at-fence'?{blocked:true,process:current={...current,phase:'STOPPED'}}:{blocked:false},
   readNextInstruction:async()=>null,cancelSchedulerProcess:async()=>{},recordIncident:async()=>{},
   chrome:{alarms:{clear:async()=>{}}},alarmName:()=>'',missionPauseAlarmName:()=>'',
   persistMissionQueue:async q=>{writes++;queue=structuredClone(q);if(crash){crash=false;throw Error('CRASH_AFTER_CHECKPOINT');}return queue;},
   enterQueueWait:async(p,q,why)=>current={...p,phase:'QUEUE_WAIT',queueWait:why},
   activateQueueItem:async({item})=>{activations++;queue.activeItemId=item.itemId;return{process:current={...current,processId:'next-process',phase:'ROTATING'}};}};
 Object.assign(deps, {QUEUE_OWNERSHIP_DEFER_CODES:new Set(['MISSION_PRIOR_EFFECT_UNRESOLVED']),ROTATION_TIMEOUT_COOLDOWN_MS:300000,
   syncMissionQueueWakeAlarm:async()=>{}, queueItemNeedsEffectReconciliation:()=>false,
   requeueBlockedMissionWorkItem:(await load('mission-work-queue')).requeueBlockedMissionWorkItem,
   deferMissionOwnershipWorkItem:(await load('mission-work-queue')).deferMissionOwnershipWorkItem,
   reviveOwnershipContentionBlocks:(await load('mission-work-queue')).reviveOwnershipContentionBlocks,
   reviveOwnershipContentionBlocks:(await load('mission-work-queue')).reviveOwnershipContentionBlocks});
 deps.activateRunnableQueueSuccessor=runtime('activateRunnableQueueSuccessor',deps);
 deps.finishParkedQueueHandoff=deps.enterQueueWait; // handoff fences are covered by queue-handoff.test.mjs
 deps.parkSlotAndActivateNext=runtime('parkSlotAndActivateNext',deps);
 const tick=runtime('parkQueueMissionAfterStale',deps);
 if(mode==='crash')await assert.rejects(tick(current),/CRASH_AFTER_CHECKPOINT/);
 await tick(current);
 assert.deepEqual(otherWorkers,beforeOthers);
 if(mode==='stop-at-fence'){assert.equal(writes,0);assert.equal(activations,0);return;}
 const held=queue.items[0];assert.equal(held.status,'BLOCKED');assert.equal(held.blockedRetryAtMs,0);
 assert.equal(held.savedMissionId,'m');assert.deepEqual(held.processSnapshot.sessionInitialization.workPrompt,original.sessionInitialization.workPrompt);
 assert.equal(held.quantumProgress,3);assert.equal(held.processSnapshot.sessionSeq,2);
 assert.equal(activations,['single','paused'].includes(mode)?0:1);
 if(['single','paused'].includes(mode))assert.equal(current.phase,'QUEUE_WAIT');
});

const waiting=await load('waiting-refresh');
test('standalone initialization stops at exhausted recovery instead of repeating a fresh session',async()=>{
 const p=seed();p.queueContext=null;p.lastPrompt.sentAt=new Date(posted).toISOString();
 p.waitingRefresh={promptHash:'init',turn:9,stage:'CTRL_F5_90',staleSince:new Date(posted).toISOString(),requestedAt:new Date(posted+90*MIN).toISOString()};
 let rotations=0;const f=runtime('maybeEscalateWaitingRefresh',{PHASES,...waiting,...transport,
   incidentPageEvidence:()=>({}),audit:async()=>{},recordIncident:async()=>{},tracedResponseObservation:()=>({trace:[]}),
   saveObserved:async(p,patch)=>({...p,...patch}),
   armSessionRotation:async p=>{rotations++;return p;},
   commitTransition:async(p,phase,patch,opts)=>{const b=await opts.beforeSave();return b.blocked?b.process:{...p,phase,...patch};},
   transportTransitionBoundary:async p=>({blocked:false,process:p}),cancelSchedulerProcess:async()=>{},
   deepClone:structuredClone,nowIso:()=>new Date().toISOString()});
 const r=await f(p,page);assert.equal(rotations,0);assert.equal(r.process.phase,'BLOCKED');
 assert.deepEqual(r.process.sessionInitialization.workPrompt,p.sessionInitialization.workPrompt);
});
