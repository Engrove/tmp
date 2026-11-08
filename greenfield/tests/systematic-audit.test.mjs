import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GREENFIELD_AUDIT_BASELINE
  ? pathToFileURL(resolve(process.env.GREENFIELD_AUDIT_BASELINE) + '/') : new URL('../', import.meta.url);
const load = name => import(new URL(`lib/${name}.mjs`, root));
const schedule = await load('queue-schedule');
const queue = await load('mission-work-queue');
const work = await load('work-mode');
const durable = await load('durable-checkpoint');
const retention = await load('storage-retention');
const source = name => readFile(new URL(name,root),'utf8');
const auditSource = await source('lib/audit-store.mjs');
const background = await source('background.js');
function fn(name, sourceText, deps = {}) {
  const start = new RegExp(`^(?:export )?(?:async )?function ${name}\\(`,'m').exec(sourceText);
  assert.ok(start, name);
  const tail = sourceText.slice(start.index).replace(/^export /,''), end = /^}\s*$/m.exec(tail);
  return Function(...Object.keys(deps), tail.slice(0,end.index+end[0].length)+`;return ${name};`)(...Object.values(deps));
}
function storage(seed={}) {
  const data=structuredClone(seed);
  return {data, QUOTA_BYTES:100,
    async getBytesInUse(){return JSON.stringify(data).length;},
    async get(keys){return structuredClone(keys==null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]])));},
    async set(v){Object.assign(data,structuredClone(v));},
    async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};
}
const NOW = Date.parse('2026-10-19T10:00:00Z');
const baseItem = patch => ({itemId:'i',goal:'GF-1.1.1000\nKeep frozen root OPEN',savedMissionId:'m',status:'READY',...patch});
function pointer(n,now=NOW) {return {schema:work.WMT_POINTER_SCHEMA,taskRef:`task-${n}`,revision:'1',nonce:`nonce-${n}`,taskKey:'test-key-never-real-credential',objective:'Read bounded test state',issuedAtMs:now,expiresAtMs:now+60000};}
const pause = ms => new Promise(r=>setTimeout(r,ms));

for(const value of [{windows:[{days:[1],start:'broken',end:'17:00'}]}, {windows:'broken'}, {windows:[],minIntervalMinutes:-1},'broken'])
 test(`RED schedule corruption remains closed: ${JSON.stringify(value)}`,()=>{
   const s=schedule.normalizeQueueSchedule(value,{now:NOW});
   assert.equal(schedule.scheduleAllows(s,NOW),false);
   assert.equal(schedule.nextScheduleOpenAtMs(s,NOW),null);
 });
test('RED clock rollback cannot erase an accepted 30-day operator pause',()=>{
 const result=schedule.parseScheduleEdit({pauseUntil:new Date(NOW+schedule.MAX_SCHEDULE_PAUSE_MS).toISOString()},{now:NOW});
 assert.equal(result.ok,true);
 const restored=schedule.normalizeQueueSchedule(result.schedule,{now:NOW-60000});
 assert.equal(schedule.scheduleBlockReason(restored,NOW-60000),'SCHEDULE_PAUSED');
});
test('RED unknown persisted queue status never becomes executable READY',()=>{
 const q=queue.normalizeMissionWorkQueue({workerId:'w',windowId:1,items:[baseItem({status:'PURGED'})]},{now:NOW});
 assert.equal(queue.selectNextMissionItem(q,{now:NOW}),null);
 assert.equal(q.items[0].lastError?.code,'QUEUE_ITEM_STATE_INVALID');
});
test('RED second ACTIVE item is quarantined instead of being silently retried',()=>{
 const q=queue.normalizeMissionWorkQueue({workerId:'w',windowId:1,activeItemId:'i',items:[baseItem({status:'ACTIVE'}),baseItem({itemId:'j',status:'ACTIVE'})]},{now:NOW});
 assert.equal(queue.selectNextMissionItem(q,{now:NOW}),null);
 assert.equal(q.items.find(i=>i.itemId==='j').lastError?.code,'QUEUE_MULTIPLE_ACTIVE_ITEMS');
});
// These run in Helsinki explicitly; restore TZ even after an assertion.
async function helsinki(task) {const old=process.env.TZ;process.env.TZ='Europe/Helsinki';try{return await task();}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}}
const sunday = {windows:[{days:[7],start:'03:15',end:'03:45'}]};
test('RED DST repeated hour returns the actual future close, not the past first occurrence',()=>helsinki(()=>{
 const now=Date.parse('2026-10-25T03:30:00+02:00');
 assert.equal(schedule.scheduleAllows(sunday,now),true);
 assert.equal(schedule.scheduleClosesAtMs(sunday,now),Date.parse('2026-10-25T03:45:00+02:00'));
}));
test('RED DST repeated opening later today is not skipped for a week',()=>helsinki(()=>{
 const now=Date.parse('2026-10-25T03:50:00+03:00');
 assert.equal(schedule.nextScheduleOpenAtMs(sunday,now),Date.parse('2026-10-25T03:15:00+02:00'));
}));
test('RED DST nonexistent opening never returns a time the schedule itself rejects',()=>helsinki(()=>{
 const now=Date.parse('2026-03-29T02:59:00+02:00');
 const next=schedule.nextScheduleOpenAtMs(sunday,now);
 assert.equal(schedule.scheduleAllows(sunday,next),true);
 assert.equal(next,Date.parse('2026-04-05T03:15:00+03:00'));
}));

test('RED cleanup and concurrent queue save cannot lose another worker registry entry',async()=>{
 const registry=queue.MISSION_WORK_QUEUE_REGISTRY_KEY, key=queue.missionWorkQueueWorkerKey('old');
 const local=storage({[key]:{workerId:'old',windowId:1,queueId:'old-q',enabled:false,items:[]},
   [registry]:{entries:[{workerId:'old',boundWindowId:1,queueId:'old-q',revision:0,updatedAt:new Date(NOW).toISOString()}]}});
 let release, reached;
 const atRead = new Promise(r=>reached=r), gate=new Promise(r=>release=r);
 const originalGet=local.get.bind(local);let paused=false;
 local.get=async keys=>{const result=await originalGet(keys);
   if(keys===registry && !paused){paused=true;reached();await gate;}return result;};
 const cleaning=retention.maintainStorageHeadroom(local,storage(),{force:true,triggerRatio:0,targetRatio:0});
 await atRead;
 const writing=queue.saveMissionWorkQueue({workerId:'new',windowId:2,queueId:'new-q',items:[baseItem()]},local);
 // Correct shared locking makes this wait; the old split locks allow publish.
 await pause(20);release();await Promise.all([cleaning,writing]);
 assert.ok(local.data[registry].entries.some(e=>e.workerId==='new'),'new queue must stay discoverable');
 assert.ok(!local.data[registry].entries.some(e=>e.workerId==='old'),'removed queue cannot return');
});

// The filter is used by real readAudit / auditAsNdjson, including {limit} exports.
const matchesFilter=fn('matchesFilter',auditSource);
test('RED audit export with only a limit must retain rows; since works without an owner selector',()=>{
 const row={timestamp:new Date(NOW).toISOString(),processId:'p',scope:'RUN'};
 assert.equal(matchesFilter(row,{limit:5000}),true);
 assert.equal(matchesFilter(row,{since:new Date(NOW-1).toISOString()}),true);
 assert.equal(matchesFilter(row,{since:new Date(NOW+1).toISOString()}),false);
 assert.equal(matchesFilter(row,{processId:'other'}),false);
});
test('RED blocked IndexedDB open settles and closes a late success',async()=>{
 const request={};let expired,closed=0;
 const open=fn('openDb',auditSource,{indexedDB:{open:()=>request},DB_NAME:'test',DB_VERSION:3,
   AUDIT_IO_TIMEOUT_MS:5000,setTimeout:f=>{expired=f;return 1;},clearTimeout:()=>{},ensureIndex:()=>{},EVENT_STORE:'e',COUNTER_STORE:'c'});
 const pending=open().then(()=> 'opened',e=>e.message);
 await Promise.resolve();expired?.();
 const outcome=await Promise.race([pending,pause(20).then(()=> 'STILL_PENDING')]);
 assert.equal(outcome,'AUDIT_DB_OPEN_TIMEOUT');
 request.result={close(){closed++;}};request.onsuccess();
 assert.equal(closed,1);
});

test('RED simultaneous WMT enqueue keeps both pointers',async()=>{
 const local=storage();await Promise.all([work.enqueueWorkModePointer(pointer(1),local,{now:NOW}),work.enqueueWorkModePointer(pointer(2),local,{now:NOW})]);
 assert.equal((await work.loadWorkModePrequeue(local)).items.length,2);
});
test('RED simultaneous WMT claim gives a pointer to only one caller',async()=>{
 const local=storage();await work.enqueueWorkModePointer(pointer(1),local,{now:NOW});
 const results=await Promise.all([work.claimNextWorkModePointer(local,{now:NOW}),work.claimNextWorkModePointer(local,{now:NOW})]);
 assert.equal(results.filter(r=>r.item).length,1);
});
test('RED exact pointer expiry is expired, not one last claim',async()=>{
 const p=pointer(1);assert.equal(work.validateWmtPointer(p,{now:p.expiresAtMs}).ok,false);
 const local=storage();await work.enqueueWorkModePointer(p,local,{now:NOW});
 assert.equal((await work.claimNextWorkModePointer(local,{now:p.expiresAtMs})).item,null);
});
test('RED expired READY payloads release capacity and leave an explicit expired receipt',async()=>{
 const local=storage();for(let n=0;n<48;n++)await work.enqueueWorkModePointer(pointer(n),local,{now:NOW});
 const later=NOW+120000;
 await work.enqueueWorkModePointer(pointer(49,later),local,{now:later});
 const q=await work.loadWorkModePrequeue(local);assert.equal(q.items.filter(i=>i.state==='READY').length,1);
 assert.ok(q.history?.some(i=>i.key==='task-0:1' && i.state==='EXPIRED'),'retain lifecycle distinction');
 assert.equal(JSON.stringify(q.history).includes('test-key-never-real-credential'),false);
 assert.equal((await work.claimNextWorkModePointer(local,{now:later})).item.key,'task-49:1');
});
test('RED materialized pointers cannot be reset to READY by a late failure callback',async()=>{
 const local=storage();await work.enqueueWorkModePointer(pointer(1),local,{now:NOW});
 const claim=await work.claimNextWorkModePointer(local,{now:NOW});
 await work.completeWorkModePointer(claim.item.key,'MATERIALIZED',local,{now:NOW+1,workerId:'w',windowId:1});
 await work.completeWorkModePointer(claim.item.key,'READY',local,{now:NOW+2});
 assert.equal((await work.claimNextWorkModePointer(local,{now:NOW+2})).item,null);
});

function drainHarness({ failAfterStart=false, enabled=true, paused=false, capacityKnown=true }={}) {
 const local=storage(),states=[],removed=[],started=[];let failed=false;
 const p=pointer(1,Date.now()), item={key:'task-1:1',claimId:'claim',pointer:p};
 const deps={chrome:{storage:{local},windows:{create:async()=>({id:10}),remove:async id=>removed.push(id)}},
  currentSchedulerSnapshot:async()=>capacityKnown?({context:{effectiveCapacity:3},scheduler:{activeCount:0}}):null,
  claimNextWorkModePointer:async()=>({item}),readEicSurfaceState:async()=>({entryUrl:'https://chatgpt.com/g/test'}),
  completeWorkModePointer:async(key,state)=>{states.push(state);if(state==='MATERIALIZED' && failAfterStart && !failed){failed=true;throw Error('storage interrupted after child started');}},
  beginWorkModeMaterialization:async()=>item, bindWorkModeMaterialization:async()=>item,
  ensureWorkerBinding:async()=>({workerId:'child'}),wmtPointerMission:()=> 'test mission',
  startRun:async()=>{started.push('child');return{ok:true,process:{processId:'child-process'}};},
  normalizeGreenfieldPriority:()=> 'NORMAL',BACKGROUND_AUDIT_SESSION_ID:'test',
  workModeStatusPayload:()=>({}),fetch:async()=>({ok:true,status:200}),workModeRequest:async()=>({ok:true,status:200}),
  audit:async()=>{},errorRecord:e=>({message:e.message}),loadOperatorSettings:async()=>({workModeEnabled:enabled}),
  readSafety:async()=>({admissionPaused:paused}),loadProcessForWindow:async()=>({processId:'child-process',workModeSource:{key:item.key,claimId:item.claimId}})};
 return {run:fn('drainWorkModePrequeue',background,deps),states,removed,started,local};
}
test('RED child creation followed by checkpoint failure must not delete/replay the child',async()=>{
 const h=drainHarness({failAfterStart:true});await h.run({auditSessionId:'s'},{workModeEnabled:true,maxActiveSessions:3});
 assert.equal(h.started.length,1);assert.equal(h.states.includes('READY'),false);assert.equal(h.removed.length,0);
});

for(const stage of ['headers','body'])test(`RED WMT ${stage} has a bounded wait`,async()=>{
 const network = await import(new URL('lib/bounded-request.mjs',new URL('../',import.meta.url))).catch(()=>null);
  const hang=()=>new Promise(()=>{}),fetchImpl=stage==='headers'?hang:async()=>({ok:true,status:200,json:hang,
    headers:new Headers({'content-type':'application/json'}),body:new ReadableStream({pull:hang})});
  const deps={chrome:{storage:{local:storage()}},Date,WORK_MODE_POLL_MS:15000,workModeLastPoll:new Map(),
    loadOperatorSettings:async()=>({workModeEnabled:true,workModeSupervisorWorkerId:'w',workModeEndpoint:'https://api.elho.fi/greenfield/work-mode/v1'}),
    fetch:fetchImpl,workModeRequest:network?((url,options)=>network.boundedJsonRequest(url,options,{fetchImpl,timeoutMs:10,maxBytes:32768})):null,
    audit:async()=>{},errorRecord:()=>({}),validateWmtPointer:()=>({ok:false,errors:['test']})};
  const sync=fn(background.includes('async function syncWorkModeForWorkerLocked(')?'syncWorkModeForWorkerLocked':'syncWorkModeForWorker',background,deps);
  const result=await Promise.race([sync({workerId:'w',windowId:1}),pause(80).then(()=>({state:'STILL_PENDING'}))]);
  assert.notEqual(result.state,'STILL_PENDING',stage);
});

test('RED owner read budget also bounds a body cancellation that never settles',async()=>{
 const text=await source('lib/owner-progress.mjs');
 const {boundedJsonRequest}=await import('../lib/bounded-request.mjs');
 const deps={normalizeOwnerProgressEndpoint:x=>x,ownerProgressRequest:()=>({promptHash:'ph',responseHash:'rh'}),
   OWNER_PROGRESS_TIMEOUT_MS:10,AbortController,setTimeout,clearTimeout,validateOwnerProgress:()=>({ok:false,code:'test'}),
   boundedJsonRequest,MAX_BYTES:32768};
 if(text.includes('async function boundedJson('))deps.boundedJson=fn('boundedJson',text,{MAX_BYTES:32768,TextDecoder});
 const read=fn('readOwnerProgress',text,deps);
 const p={lastPrompt:{acknowledged:true},lastResponse:{observation:{causalMatch:true,ownerTrusted:true}}};
 const response={ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({
   read:async()=>({done:true}),cancel:()=>new Promise(()=>{})})}};
 const result=await Promise.race([read(p,'https://api.elho.fi/greenfield/test',{fetchImpl:async()=>response}),pause(80).then(()=>({code:'STILL_PENDING'}))]);
 assert.notEqual(result.code,'STILL_PENDING');assert.equal(result.ok,false);
});

test('RED metadata left after cleanup failure distinguishes retired queue from never-created queue',async()=>{
 const registry=queue.MISSION_WORK_QUEUE_REGISTRY_KEY, key=queue.missionWorkQueueWorkerKey('old');
 const local=storage({[key]:{workerId:'old',windowId:1,queueId:'old-q',enabled:false,items:[]},
   [registry]:{entries:[{workerId:'old',boundWindowId:1,queueId:'old-q',revision:0,updatedAt:new Date(NOW).toISOString()}]}});
 const original=local.set.bind(local);
 local.set=async values=>{if(values[registry])throw Error('crash after payload deletion before registry publish');return original(values);};
 await retention.maintainStorageHeadroom(local,storage(),{force:true,targetRatio:0});
 assert.ok(!local.data[key]);assert.ok(local.data[registry].entries.length);
 await assert.rejects(queue.loadMissionWorkQueue(1,local,{workerId:'old'}),/MISSION_WORK_QUEUE_RETIRED/);
 assert.equal((await queue.loadMissionWorkQueue(2,local,{workerId:'never'})).items.length,0);
});

test('RED cleanup must retain a disabled legacy queue containing never-started operator work',async()=>{
 const key=queue.missionWorkQueueWorkerKey('saved');
 const local=storage({[key]:{workerId:'saved',windowId:1,queueId:'q',enabled:false,items:[baseItem()]}});
 await retention.maintainStorageHeadroom(local,storage(),{force:true,targetRatio:0});
 assert.ok(local.data[key]?.items.length,'saved work is payload, not garbage');
});
test('RED completed later turn survives wall-clock rollback in mission history',async()=>{
 const history=await load('mission-history'),local=storage();
 const p={workerId:'w',processId:'p',runId:'r',goal:'GF-1.1.1000',turn:8,generation:1,updatedAt:new Date(NOW).toISOString(),lastResponse:{hash:'old'}};
 await history.preserveMissionHistory(p,local);
 await history.preserveMissionHistory({...p,turn:9,updatedAt:new Date(NOW-60000).toISOString(),lastResponse:{hash:'new'}},local);
 const key=history.MISSION_HISTORY_PREFIX+encodeURIComponent(history.missionOwnershipKey(p))+'.w';
 assert.equal((await durable.readCheckpoint(key,local)).value.process.lastResponse.hash,'new');
 // A late old snapshot with a newer wall-clock timestamp is not more recent work.
 await history.preserveMissionHistory({...p,updatedAt:new Date(NOW+60000).toISOString()},local);
 assert.equal((await durable.readCheckpoint(key,local)).value.process.turn,9);
});
for(const status of ['DONE','STOPPED','FAILED','ACTIVE'])test(`RED ${status} with stale owner WAIT cannot schedule another queue wake`,()=>{
 assert.equal(schedule.queueItemNextRunnableAtMs(baseItem({status,resume:{ownerWait:{state:'WAIT',nextCheckAtMs:NOW-1}}}),NOW),null);
});

test('RED recovery backup preserves WMT replay fences without exporting task credentials',async()=>{
 const backup=await load('operator-backup'),local=storage();
 await work.enqueueWorkModePointer(pointer(1),local,{now:NOW});
 const out=await backup.createOperatorBackup(local,{version:'fixture',extensionId:'test',now:NOW});
 const q=out.data[work.WORK_MODE_PREQUEUE_KEY];assert.ok(q,'replay state must survive backup');
 assert.equal(q.items[0].state,'RECONCILIATION_REQUIRED');
 assert.doesNotMatch(JSON.stringify(q),/test-key-never-real-credential|nonce-1/);
});
test('RED recovery backup retains retired identity after its payload is gone',async()=>{
 const backup=await load('operator-backup'),local=storage(),key='eic.gf.worker-retired.v1.old';
 await durable.writeCheckpoint(key,{schema:'eic.greenfield.worker-retired.v1',workerId:'old',retiredAtMs:NOW,terminalAuthority:false},local);
 const out=await backup.createOperatorBackup(local,{version:'fixture',extensionId:'test',now:NOW});
 assert.ok(out.data[key]);
});

for(const name of ['readAudit','pruneAudit'])test(`RED ${name} bounds a cursor/transaction that never signals completion`,async()=>{
 const tx={objectStore:()=>({index:()=>({openCursor:()=>({})})}),abort(){this.onabort?.();}};
 const deps={openDb:async()=>({transaction:()=>tx,close(){}}),EVENT_STORE:'events',MAX_PERSISTED_AUDIT_EVENTS:5000,
   indexedCandidates:()=>new Promise(()=>{}),matchesFilter:()=>true,
   txDone:fn('txDone',auditSource,{setTimeout,clearTimeout,AUDIT_IO_TIMEOUT_MS:10})};
 const run=fn(name,auditSource,deps);
 const outcome=await Promise.race([run().then(()=> 'done',()=> 'aborted'),pause(80).then(()=> 'STILL_PENDING')]);
 assert.notEqual(outcome,'STILL_PENDING');
});

for(const options of [{enabled:false},{paused:true},{capacityKnown:false}])test(`RED WMT last admission respects ${JSON.stringify(options)}`,async()=>{
 const h=drainHarness(options);await h.run({auditSessionId:'s'},{workModeEnabled:true,maxActiveSessions:3});
 assert.equal(h.started.length,0);
});

for(const state of [{status:'PURGED'},{status:'BLOCKED',lastError:{code:'QUEUE_MULTIPLE_ACTIVE_ITEMS'}}])
test(`RED mission takeover cannot bypass an unknown queue state: ${JSON.stringify(state)}`,async()=>{
 const ownership=await load('mission-ownership'),local=storage();
 const goal='GF-1.1.1000\nKeep frozen root';
 local.data[queue.missionWorkQueueWorkerKey('old')]={workerId:'old',windowId:1,queueId:'old-q',enabled:false,items:[baseItem({goal,...state})]};
 const target={workerId:'new',processId:'new-p',goal,queueContext:{queueId:'new-q',itemId:'new-i',savedMissionId:'m'}};
 const result=await ownership.claimMissionOwnership(target,{storage:local,allowTakeover:true,now:NOW});
 assert.equal(result.allowed,false);assert.equal(result.code,'MISSION_QUEUE_STATE_UNPROVEN');
});

test('RED healthy current process cannot erase the unknown second ACTIVE slot during takeover',async()=>{
 const own=await load('mission-ownership'),local=storage(),goal='GF-1.1.1000\nFrozen root';
 const p={workerId:'old',processId:'old-p',goal,lastPrompt:{dispatchedUserTurnId:'u'},
  lastResponse:{text:'Substantive completed response.',observation:{pairedUserTurnId:'u'}}};
 local.data[queue.missionWorkQueueWorkerKey('old')]={workerId:'old',windowId:1,queueId:'old-q',activeItemId:'i',items:[
  baseItem({goal,status:'ACTIVE',processSnapshot:p}),baseItem({itemId:'j',goal,status:'ACTIVE'})]};
 local.data['eic.gf.process.worker.old']=p;
 const result=await own.claimMissionOwnership({workerId:'new',processId:'new-p',goal},{storage:local,allowTakeover:true,now:NOW});
 assert.equal(result.allowed,false);assert.equal(result.code,'MISSION_QUEUE_STATE_UNPROVEN');
});
