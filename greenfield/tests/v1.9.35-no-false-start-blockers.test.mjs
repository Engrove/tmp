import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {findDormantMissionRecoverySource,claimMissionOwnership,inspectMissionOwnership,MISSION_OWNERSHIP_KEY} from '../lib/mission-ownership.mjs';
import {archivedEffectRecoveryReceipt,prepareArchivedEffectRestart} from '../lib/mission-archive-recovery.mjs';
import {writeCheckpoint} from '../lib/durable-checkpoint.mjs';
import {normalizeMissionWorkQueue,selectNextMissionItem,deferMissionOwnershipWorkItem,reviveOwnershipContentionBlocks} from '../lib/mission-work-queue.mjs';
import {queueItemNextRunnableAtMs} from '../lib/queue-schedule.mjs';
class Storage {
  constructor(){this.data={};}
  async get(keys){if(keys==null)return structuredClone(this.data);
    const list=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys);
    return Object.fromEntries(list.filter(k=>Object.hasOwn(this.data,k)).map(k=>[k,structuredClone(this.data[k])]));}
  async set(rows){Object.assign(this.data,structuredClone(rows));}
  async remove(keys){for(const key of typeof keys==='string'?[keys]:keys)delete this.data[key];}
}
const id='GF-2.102.1026',goal=`Projekt: 102 - Test - GFW: ${id}.`,key='gfw:'+id;
const hash='a'.repeat(64);
const item=()=>({itemId:'item-102',savedMissionId:'mission-102',goal,status:'READY',order:0,
  processSnapshot:{processId:'legacy',goal:'old response',pendingPrompt:{text:'DO NOT REPLAY'}},
  resume:{objective:'old instruction'}});
async function setup({phase='STOPPED',response='Recorded, but causal pairing missing',pendingPrompt=null}={}){
 const storage=new Storage();
 await writeCheckpoint(MISSION_OWNERSHIP_KEY,{schema:'eic.greenfield.mission-ownership.v1',
   owners:{[key]:{workerId:'old-worker',processId:'legacy-process',epoch:3,supersededWorkerIds:[]}},
   archivedUnresolved:{},resolutions:{},history:[]},storage);
 const old={schema:'eic.greenfield.process.v1',workerId:'old-worker',processId:'legacy-process',
   goal,phase,updatedAt:'2026-10-22T17:15:05.830Z',pendingPrompt,
   lastPrompt:{hash,dispatchedUserTurnId:'user-original'},
   lastResponse:response?{text:response,observation:{pairedUserTurnId:'different-user'}}:null};
 storage.data['eic.gf.process.worker.old-worker']=old;
 return {storage,old};
}
function probe(){return {workerId:'fresh-worker',processId:'preflight',goal,
 queueContext:{queueId:'test-queue',itemId:'item-102',savedMissionId:'mission-102'}};}
function newCandidate(source){
 const prepared=prepareArchivedEffectRestart(item(),source);
 assert.equal(prepared.processSnapshot,null);
 assert.notEqual(prepared.resume.objective,'old instruction');
 const text=JSON.stringify({objective:prepared.resume.objective,instruction:'Read fresh EIC owner status'});
 const next={...probe(),processId:'fresh-process',phase:'ROTATING',turn:1,
   queueContext:{...probe().queueContext,interactionCount:0},
   pendingPrompt:{text,hash:createHash('sha256').update(text).digest('hex'),sendAttempts:0,dispatch:null},
   sessionRotation:{warmResume:{warm:false}},lastPrompt:null,lastResponse:null,
   objectiveState:{objective:prepared.resume.objective}};
 next.archivedEffectRecovery=archivedEffectRecoveryReceipt(source,next);
 return next;
}
test('legacy STOPPED response with lost pairing restarts from owner state without BLOCKED',async()=>{
 const {storage}=await setup();
 const src=await findDormantMissionRecoverySource(probe(),{storage,liveWorkerIds:[]});
 assert.equal(src?.sourceProcessId,'legacy-process');
 const next=newCandidate(src);
 const before=await inspectMissionOwnership(next,{storage,liveWorkerIds:[]});
 assert.equal(before.code,'MISSION_PRIOR_EFFECT_QUARANTINED');
 const claim=await claimMissionOwnership(next,{storage,liveWorkerIds:[],allowTakeover:true});
 assert.equal(claim.allowed,true);assert.equal(claim.archivedRecovery,true);
 assert.equal(claim.code,'MISSION_PRIOR_EFFECT_QUARANTINED');
});
test('DETACHED with an observed response gets the same fresh state recovery',async()=>{
 const {storage}=await setup({phase:'DETACHED'});
 const src=await findDormantMissionRecoverySource(probe(),{storage});
 assert.equal(src?.sourceWorkerId,'old-worker');
 const next=newCandidate(src);
 assert.equal((await claimMissionOwnership(next,{storage,allowTakeover:true})).allowed,true);
});
test('live owner is automatically superseded by a fresh no-replay session',async()=>{
 const {storage}=await setup();
 const src=await findDormantMissionRecoverySource(probe(),{storage,liveWorkerIds:[{workerId:'old-worker',processId:'legacy-process'}]});
 assert.ok(src);
 const newProcess=newCandidate(src);
 const result=await claimMissionOwnership(newProcess,{storage,liveWorkerIds:[{workerId:'old-worker',processId:'legacy-process'}],allowTakeover:true});
 assert.equal(result.allowed,true);assert.equal(result.code,'MISSION_PRIOR_EFFECT_QUARANTINED');
});
test('missing observed response, WAITING process or effect-possible dispatch stay fenced',async()=>{
 for(const options of [{response:null},{phase:'WAITING'},
   {pendingPrompt:{sendAttempts:1,dispatch:{effectPossible:true}}}]){
  const {storage}=await setup(options);
  const src=await findDormantMissionRecoverySource(probe(),{storage});
  assert.ok(src,JSON.stringify(options));
 }
});
test('no old text or unverified pending send can pass a synthetic recovery receipt',async()=>{
 const {storage}=await setup();const src=await findDormantMissionRecoverySource(probe(),{storage});
 const next=newCandidate(src);next.pendingPrompt.sendAttempts=1;
 assert.equal((await claimMissionOwnership(next,{storage,allowTakeover:true})).allowed,false);
 next.pendingPrompt.sendAttempts=0;next.pendingPrompt.hash=hash;
 assert.equal((await claimMissionOwnership(next,{storage,allowTakeover:true})).allowed,false);
});
const queue=(now)=>normalizeMissionWorkQueue({workerId:'w',windowId:1,queueId:'q',enabled:true,cursorOrder:-1,items:[
 {itemId:'owner',savedMissionId:'m',goal,status:'READY',order:0,blockedCount:0},
 {itemId:'other',savedMissionId:'m2',goal:'Projekt 71 - GFW: GF-0.71.1008',status:'READY',order:1}
]}, {now});
test('an occupied mission is WAITING/PAUSED, never counted as BLOCKED',()=>{
 const now=1793005390000,original=queue(now);
 const next=deferMissionOwnershipWorkItem(original,'owner',{code:'MISSION_ACTIVE_ON_OTHER_WORKER',now,retryAfterSeconds:300});
 assert.equal(next.items[0].status,'PAUSED');
 assert.equal(next.items[0].lastOutcome,'MISSION_OWNERSHIP_WAIT');
 assert.equal(next.items[0].blockedCount,0);
 assert.equal(next.items[0].blockedRetryAtMs,0);
 assert.equal(next.items[0].pauseUntilMs,now+300000);
 assert.equal(queueItemNextRunnableAtMs(next.items[0],now),now+300000);
 assert.equal(selectNextMissionItem(next,{now}).itemId,'other');
 assert.equal(selectNextMissionItem({...next, items:next.items.map(i=>i.itemId==='other'?{...i,status:'PAUSED',pauseUntilMs:now+600000}:i)},{now:now+300001}).itemId,'owner');
});
test('migration removes legacy v1.9.34 ownership BLOCKED counters and preserves true local pending effects',()=>{
 const now=1793005390000,original=queue(now);
 original.items[0]={...original.items[0],status:'BLOCKED',blockedCount:17,
   blockedRetryAtMs:now+86400000,lastError:{code:'MISSION_PRIOR_EFFECT_UNRESOLVED'}};
 const migrated=reviveOwnershipContentionBlocks(original,{now,hasPendingEffect:()=>false});
 assert.equal(migrated.queue.items[0].status,'READY');
 assert.equal(migrated.queue.items[0].blockedCount,0);
 assert.equal(migrated.queue.items[0].blockedRetryAtMs,0);
 const protectedEffect=reviveOwnershipContentionBlocks(original,{now,hasPendingEffect:()=>true});
 assert.equal(protectedEffect.queue.items[0].status,'READY',
   'unknown prior effects are moved to the fresh-session no-replay quarantine, not an operator BLOCKED gate');
});
test('the real background launch path uses fresh state and schedules ownership wait rather than BLOCKED',()=>{
 const bg=readFileSync(new URL('../background.js',import.meta.url),'utf8');
 const activation=bg.slice(bg.indexOf('async function activateQueueItem('),bg.indexOf('const QUEUE_OWNERSHIP_DEFER_CODES'));
 const successor=bg.slice(bg.indexOf('async function activateRunnableQueueSuccessor('),bg.indexOf('async function startMissionQueue('));
 assert.match(activation,/findDormantMissionRecoverySource/);
 assert.match(activation,/prepareArchivedEffectRestart\(item, recoverySource\)/);
 assert.match(successor,/reviveOwnershipContentionBlocks/);
 assert.match(successor,/deferMissionOwnershipWorkItem/);
 assert.doesNotMatch(successor,/requeueBlockedMissionWorkItem\(/);
});
