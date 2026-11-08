import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as checkpoint from '../lib/durable-checkpoint.mjs';
import * as queue from '../lib/mission-work-queue.mjs';
import * as schedule from '../lib/queue-schedule.mjs';
import * as work from '../lib/work-mode.mjs';
import * as gate from '../lib/global-prompt-gate.mjs';
import * as capacity from '../lib/global-capacity-scheduler.mjs';
import {queueDispatchAdmission} from '../lib/queue-dispatch-admission.mjs';
import {completeBrokerTurn,sessionBrokerLimit} from '../lib/session-broker.mjs';
import {boundedJsonRequest} from '../lib/bounded-request.mjs';
import {maintainStorageHeadroom} from '../lib/storage-retention.mjs';
import {restoreWorkerBinding} from '../lib/worker-identity.mjs';

const NOW=Date.parse('2026-10-19T10:00:00Z');
function storage(seed={}) {const data=structuredClone(seed);return {data,QUOTA_BYTES:1e8,
 async getBytesInUse(){return JSON.stringify(data).length;},
 async get(k){return structuredClone(k==null?data:Object.fromEntries((Array.isArray(k)?k:[k]).filter(k=>k in data).map(k=>[k,data[k]])));},
 async set(v){Object.assign(data,structuredClone(v));},async remove(k){for(const key of Array.isArray(k)?k:[k])delete data[key];}};}
const pointer=(id,now)=>({schema:work.WMT_POINTER_SCHEMA,taskRef:`task-${id}`,revision:'1',nonce:'test-nonce',taskKey:'fixture-not-a-credential',objective:'bounded read',issuedAtMs:now,expiresAtMs:now+120000});
const item=(id='a')=>({itemId:id,savedMissionId:`m-${id}`,goal:`GF-1.1.${id}`,status:'READY'});

for(const when of ['before','after'])for(let step=1;step<=7;step++)test(`checkpoint crash ${when} I/O ${step}: restart sees old, new or explicit reconciliation, never absence`,async()=>{
 const local=storage(),key='fault-key';await checkpoint.writeCheckpoint(key,{id:'old',effect:'UNKNOWN'},local);
 let count=0,fired=false;const fault=Object.create(local);
 for(const op of ['get','set','remove'])fault[op]=async(...args)=>{
   const fail=++count===step;if(fail && when==='before'){fired=true;throw Error('INJECTED_CRASH');}
   const result=await local[op](...args);if(fail && when==='after'){fired=true;throw Error('INJECTED_CRASH');}return result;
 };
 await assert.rejects(checkpoint.writeCheckpoint(key,{id:'new',effect:'UNKNOWN'},fault),/INJECTED_CRASH/);assert.ok(fired);
 const restarted=storage(local.data),r=await checkpoint.readCheckpoint(key,restarted);
 assert.ok(['old','new'].includes(r.value.id));assert.ok(['VERIFIED','RECOVERY_REQUIRED'].includes(r.health));
 if(r.health==='RECOVERY_REQUIRED')await assert.rejects(checkpoint.writeCheckpoint(key,{id:'unsafe'},restarted),/RECONCILIATION_REQUIRED/);
 else assert.equal((await checkpoint.writeCheckpoint(key,{id:'after-restart'},restarted)).health,'VERIFIED');
});

test('checkpoint readers wait for publication; tampered data cannot pass checksum validation',async()=>{
 const local=storage();await checkpoint.writeCheckpoint('k',{a:1},local);
 let release,reached;const wait=new Promise(r=>release=r),start=new Promise(r=>reached=r),set=local.set.bind(local);
 local.set=async v=>{await set(v);if(Object.keys(v).some(k=>k.startsWith(checkpoint.CHECKPOINT_PREFIX))){reached();await wait;}};
 const writing=checkpoint.writeCheckpoint('k',{a:2},local);await start;let read=false;
 const reading=checkpoint.readCheckpoint('k',local).then(r=>{read=true;return r;});await Promise.resolve();assert.equal(read,false);
 release();await writing;assert.equal((await reading).health,'VERIFIED');
 for(const key of checkpoint.checkpointKeys('k'))if(local.data[key])local.data[key].value.a=999;
 await assert.rejects(checkpoint.readCheckpoint('k',local),/CHECKPOINT_UNRECOVERABLE/);
});
test('same-worker concurrent writes produce one explicit stale writer; five workers retain five registries',async()=>{
 const local=storage(),q={workerId:'w',windowId:1,queueId:'q',items:[item()]};const saved=await queue.saveMissionWorkQueue(q,local);
 const results=await Promise.allSettled([queue.saveMissionWorkQueue({...saved,enabled:true},local),queue.saveMissionWorkQueue({...saved,enabled:false},local)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/STALE_WRITE/);
 await Promise.all(Array.from({length:5},(_,i)=>queue.saveMissionWorkQueue({workerId:`w${i}`,windowId:i+2,queueId:`q${i}`,items:[item(String(i))]},local)));
 assert.equal(local.data[queue.MISSION_WORK_QUEUE_REGISTRY_KEY].entries.length,6);
});
test('retention at pressure preserves any process, checksum/WAL, history and live-worker evidence',async()=>{
 for(const kind of ['process','wal','history','live']) {
  const local=storage(),session=storage(),key=queue.missionWorkQueueWorkerKey(kind);local.QUOTA_BYTES=1;
  local.data[key]={workerId:kind,windowId:1,queueId:'q',enabled:false,items:[]};
  if(kind==='process')local.data[`eic.gf.process.worker.${kind}`]={phase:'DETACHED'};
  if(kind==='wal')await checkpoint.writeCheckpoint(key,local.data[key],local);
  if(kind==='history')local.data[key].history=[{itemId:'old'}];
  if(kind==='live')await restoreWorkerBinding(1,kind,session);
  await maintainStorageHeadroom(local,session,{force:true,targetRatio:0});assert.ok(local.data[key],kind);
 }
});
for(const delta of [-1,0,1])test(`schedule pause/interval and prompt lease at exact boundary ${delta}ms`,async()=>{
 const at=NOW+60000;
 assert.equal(schedule.scheduleAllows({pauseUntilMs:at},at+delta),delta>=0);
 assert.equal(schedule.scheduleAllows({minIntervalMinutes:1},at+delta,{lastQuantumCompletedAtMs:NOW}),delta>=0);
 const local=storage();await gate.claimGlobalPromptSend({reservationId:'a',processId:'a',promptHash:'ha',delaySeconds:0,now:NOW,storage:local});
 const result=await gate.claimGlobalPromptSend({reservationId:'b',processId:'b',promptHash:'hb',delaySeconds:0,now:NOW+gate.PROMPT_SEND_LEASE_MS+delta,storage:local});
 assert.equal(result.allowed,delta>=0);
});
for(const zone of ['UTC','Europe/Helsinki','America/New_York','Australia/Lord_Howe'])test(`weekly windows agree with independent wall-clock oracle across DST: ${zone}`,()=>{
 const old=process.env.TZ;process.env.TZ=zone;
 try {
  const s={windows:[{days:[1,3,7],start:'22:00',end:'04:00'},{days:[2,5],start:'08:15',end:'16:45'}]};
  for(const base of [Date.parse('2026-03-28T00:00Z'),Date.parse('2026-10-24T00:00Z')])for(let n=0;n<400;n++){
   const at=base+n*17*60000,d=new Date(at),day=d.getDay()||7,previous=day===1?7:day-1,minute=d.getHours()*60+d.getMinutes();
   const expected=([1,3,7].includes(day)&&minute>=1320)||([1,3,7].includes(previous)&&minute<240)||([2,5].includes(day)&&minute>=495&&minute<1005);
   assert.equal(schedule.scheduleAllows(s,at),expected);
   if(n%40===0){const next=schedule.nextScheduleOpenAtMs(s,at);assert.ok(next>=at);assert.equal(schedule.scheduleAllows(s,next),true);
    const close=schedule.scheduleClosesAtMs(s,next);assert.ok(close>next);assert.equal(schedule.scheduleAllows(s,close-1),true);assert.equal(schedule.scheduleAllows(s,close),false);}
  }
 }finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
test('invalid schedule is sticky through save/reload; full operator edit repairs only its own slot',async()=>{
 const local=storage();let q=await queue.saveMissionWorkQueue({workerId:'w',windowId:1,items:[{...item(),schedule:{windows:[{}]}},item('b')]},local);
 q=await queue.loadMissionWorkQueue(1,local,{workerId:'w'});assert.equal(queue.selectNextMissionItem(q,{now:NOW}).itemId,'b');
 assert.equal(schedule.parseScheduleEdit({minIntervalMinutes:0},{current:q.items[0].schedule,now:NOW}).ok,false);
 const edit=schedule.parseScheduleEdit({windows:[],pauseUntil:'',minIntervalMinutes:0},{current:q.items[0].schedule,now:NOW});assert.equal(edit.ok,true);
 q.items[0].schedule=edit.schedule;await queue.saveMissionWorkQueue(q,local);
 assert.equal(queue.isRunnableQueueItem((await queue.loadMissionWorkQueue(1,local,{workerId:'w'})).items[0],NOW),true);
});
test('WMT claim crash before effect safely expires; materializing and legacy claims never TTL-replay',async()=>{
 const local=storage();await work.enqueueWorkModePointer(pointer(1,NOW),local,{now:NOW});
 const first=await work.claimNextWorkModePointer(local,{now:NOW});
 assert.equal((await work.claimNextWorkModePointer(local,{now:NOW+work.WORK_MODE_CLAIM_MS-1})).item,null);
 const second=await work.claimNextWorkModePointer(local,{now:NOW+work.WORK_MODE_CLAIM_MS});assert.ok(second.item);assert.notEqual(second.item.claimId,first.item.claimId);
 await assert.rejects(work.beginWorkModeMaterialization(first.item.key,first.item.claimId,local,{now:NOW+30001}),/STALE/);
 await work.beginWorkModeMaterialization(second.item.key,second.item.claimId,local,{now:NOW+30001});
 assert.equal((await work.claimNextWorkModePointer(storage(local.data),{now:NOW+1e9})).item,null);
 const legacy=storage({[work.WORK_MODE_PREQUEUE_KEY]:{items:[{key:'legacy',state:'CLAIMED',pointer:pointer(2,NOW)}]}});
 const q=(await work.claimNextWorkModePointer(legacy,{now:NOW+1e9})).queue;
 assert.equal(q.items[0].state,'RECONCILIATION_REQUIRED');
});
test('WMT restart reconciles exactly the bound child, rejects cross-worker evidence and preserves unknown work',async()=>{
 const local=storage();await work.enqueueWorkModePointer(pointer(1,NOW),local,{now:NOW});const {item}=await work.claimNextWorkModePointer(local,{now:NOW});
 await work.beginWorkModeMaterialization(item.key,item.claimId,local,{now:NOW+1});await work.bindWorkModeMaterialization(item.key,item.claimId,local,{now:NOW+2,workerId:'w',windowId:1});
 const child={workerId:'w',windowId:1,processId:'p',workModeSource:{key:item.key,claimId:item.claimId}};
 let q=await work.reconcileWorkModeMaterialization([{...child,workerId:'other'}],local,{now:NOW+3});assert.equal(q.items[0].state,'RECONCILIATION_REQUIRED');
 q=await work.reconcileWorkModeMaterialization([child],local,{now:NOW+4});assert.equal(q.items.length,0);assert.equal(q.history[0].state,'MATERIALIZED');
 assert.equal((await work.claimNextWorkModePointer(local,{now:NOW+5})).item,null);
});
test('400 WMT lifecycles with concurrent claims, restarts and purging keep bounded secret-free receipts and never duplicate an effect',async()=>{
 let local=storage();const effects=new Set();
 for(let batch=0;batch<80;batch++){
  const now=NOW+batch*180000;await Promise.all(Array.from({length:5},(_,i)=>work.enqueueWorkModePointer(pointer(batch*5+i,now),local,{now})));
  const claims=await Promise.all(Array.from({length:7},()=>work.claimNextWorkModePointer(local,{now:now+1})));
  for(const {item} of claims.filter(c=>c.item)) {assert.ok(!effects.has(item.key));effects.add(item.key);
   await work.beginWorkModeMaterialization(item.key,item.claimId,local,{now:now+2});
   await work.completeWorkModePointer(item.key,'MATERIALIZED',local,{now:now+3,claimId:item.claimId,workerId:`w${batch}`,windowId:batch+1});
   await work.completeWorkModePointer(item.key,'READY',local,{now:now+4,claimId:item.claimId});}
  local=storage(local.data);const q=await work.loadWorkModePrequeue(local);assert.equal(q.items.length,0);assert.ok(q.history.length<=work.WORK_MODE_HISTORY_MAX);
  assert.doesNotMatch(JSON.stringify(q),/fixture-not-a-credential|test-nonce|bounded read/);
 }
 assert.equal(effects.size,400);
});
test('five-worker schedule/capacity composition over 150 turns: stopped workers never post, broker ceilings preserve mission identity',async()=>{
 const local=storage(),now=NOW;
 let workers=Array.from({length:5},(_,n)=>({workerId:`w${n}`,windowId:n,processId:`p${n}`,runId:`r${n}`,turn:1,sessionSeq:1,
  queueContext:{queueId:`q${n}`,itemId:`i${n}`,workerId:`w${n}`,savedMissionId:`m${n}`,activationCount:1},
  lastResponse:{observation:{conversationKey:`https://chatgpt.com/c/${n}`}},lastPrompt:{hash:'',promptProfile:{ordinal:1}}}));
 const queues=workers.map((p,n)=>({queueId:`q${n}`,workerId:p.workerId,windowId:n,enabled:true,activeItemId:`i${n}`,items:[{itemId:`i${n}`,savedMissionId:`m${n}`,status:'ACTIVE',activationCount:1,schedule:n>2?{pauseUntilMs:now+1e9}:null}]}));
 let posts=0,rotations=0;
 for(let round=0;round<50;round++){
  const at=now+round*600000;
  const admitted=workers.filter((p,i)=>queueDispatchAdmission(p,queues[i],at).ok);assert.equal(admitted.length,3);
  const grants=await Promise.all(admitted.map(p=>capacity.requestGlobalTurnSlot({processId:p.processId,workerId:p.workerId,windowId:p.windowId,promptHash:`${p.processId}-${round}`,capacity:3,now:at,storage:local})));
  assert.ok(grants.every(g=>g.allowed));assert.equal((await capacity.readGlobalCapacityScheduler(local,{capacity:3,now:at})).activeCount,3);
  for(const p of admitted){posts++;p.lastPrompt.hash=`${p.processId}-${round}`;p.lastPrompt.promptProfile.ordinal=Number(p.sessionBroker?.operativePrompts || 0)+1;
    p.sessionBroker=completeBrokerTurn(p,{quantumCompleted:(round+1)%5===0});
    const copy=structuredClone(p.sessionBroker);assert.deepEqual(completeBrokerTurn(p,{quantumCompleted:(round+1)%5===0}),copy);
    if(sessionBrokerLimit(p.sessionBroker)){rotations++;p.sessionSeq++;p.sessionBroker=null;p.lastResponse.observation.conversationKey+=`-${p.sessionSeq}`;}
    p.turn++;assert.equal(p.queueContext.savedMissionId,`m${p.windowId}`);
    await capacity.releaseGlobalTurnSlot({processId:p.processId,promptHash:p.lastPrompt.hash,capacity:3,now:at+100,storage:local});}
 }
 // v2.0.0 ceilings (10 prompts / 4 quanta): 50 posts per admitted worker rotate every 10 posts.
 assert.equal(posts,150);assert.equal(rotations,15);assert.equal((await capacity.readGlobalCapacityScheduler(local)).activeCount,0);
});
test('bounded request aborts timeout, ignores late success, enforces body size and does not retry mutation',async()=>{
 let resolve,calls=0,signal;const pending=boundedJsonRequest('https://example.invalid',{method:'POST'},{timeoutMs:5,fetchImpl:(_u,o)=>{calls++;signal=o.signal;return new Promise(r=>resolve=r);}});
 await assert.rejects(pending,e=>e.code==='REQUEST_TIMEOUT' && e.effectPossible===true);assert.equal(signal.aborted,true);assert.equal(calls,1);
 resolve(Response.json({late:true}));await new Promise(r=>setTimeout(r,1));assert.equal(calls,1);
 await assert.rejects(boundedJsonRequest('https://example.invalid',{method:'GET'},{maxBytes:4,fetchImpl:async()=>Response.json({too:'large'})}),/TOO_LARGE/);
 const noContent=await boundedJsonRequest('https://example.invalid',{method:'GET'},{fetchImpl:async()=>new Response(null,{status:204})});assert.equal(noContent.status,204);
});

test('recovery round-trip retains retirement/replay metadata, imports paused and cannot dispatch imported open WMT',async()=>{
 const {createOperatorBackup,restoreOperatorBackup}=await import('../lib/operator-backup.mjs');
 const {readSafety}=await import('../lib/usage-governor.mjs');
 const local=storage();await work.enqueueWorkModePointer(pointer(1,NOW),local,{now:NOW});
 const key=queue.WORKER_RETIRED_PREFIX+'retired';
 await checkpoint.writeCheckpoint(key,{schema:'eic.greenfield.worker-retired.v1',workerId:'retired',terminalAuthority:false},local);
 const backup=await createOperatorBackup(local,{version:'test',extensionId:'test',now:NOW});const restored=storage();
 assert.equal((await restoreOperatorBackup(backup,restored,{now:NOW+1})).paused,true);
 assert.equal((await readSafety(restored)).admissionPaused,true);
 assert.equal((await work.claimNextWorkModePointer(restored,{now:NOW+2})).item,null);
 await assert.rejects(queue.loadMissionWorkQueue(1,restored,{workerId:'retired'}),/RETIRED/);
 assert.doesNotMatch(JSON.stringify(backup),/fixture-not-a-credential|test-nonce/);
});

test('installed verifier rejects tampered bytes and stale running build, without claiming live mission PASS',async()=>{
 const {verifyInstalledBuild}=await import('../tools/verify-installed.mjs');
 const {createHash}=await import('node:crypto');
 const bytes=Buffer.from('fixture'),hash=createHash('sha256').update(bytes).digest('hex');
 const expected=createHash('sha256').update(JSON.stringify({'background.js':hash})).digest('hex');
 const descriptor={runtimeBuildSHA256:expected,version:'1.9.25',files:{'background.js':hash}};
 let running='old',tamper=false;
 const api={runtime:{getURL:p=>p,getManifest:()=>({version:'1.9.25'}),sendMessage:async()=>({ok:true,appVersion:'1.9.25',runtimeBuildSHA256:running})},
   tabs:{query:async()=>[],sendMessage:async()=>{throw Error('should not send');}},alarms:{getAll:async()=>[]}};
 const fetchImpl=async url=>url==='installed-integrity.json'?Response.json(descriptor):new Response(tamper?'changed':bytes);
 let r=await verifyInstalledBuild(expected,{chromeApi:api,fetchImpl});assert.equal(r.byteIdentityVerified,false);
 running=expected;r=await verifyInstalledBuild(expected,{chromeApi:api,fetchImpl});assert.equal(r.byteIdentityVerified,true);assert.equal(r.liveMissionBehavior,'NOT_VERIFIED');assert.equal(r.terminalAcceptance,'OPEN');
 tamper=true;r=await verifyInstalledBuild(expected,{chromeApi:api,fetchImpl});assert.deepEqual(r.fileMismatches,['background.js']);assert.equal(r.byteIdentityVerified,false);
});

test('legacy ownership contention no longer requires source-bound operator reconciliation',async()=>{
 const local=storage();
 await queue.saveMissionWorkQueue({workerId:'w',windowId:1,queueId:'q',enabled:true,
   items:[{...item('a'),status:'PAUSED',lastOutcome:'MISSION_OWNERSHIP_WAIT',
     lastError:{code:'MISSION_PRIOR_EFFECT_UNRESOLVED'},pauseUntilMs:NOW+300000}]},local);
 const q=await queue.loadMissionWorkQueue(1,local,{workerId:'w'});
 const runnable=queue.selectNextMissionItem(q,{now:NOW});
 assert.ok(runnable);assert.equal(runnable.itemId,'a');
 assert.equal(runnable.status,'READY');
});

