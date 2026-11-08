import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepareArchivedEffectRestart, archivedEffectRecoveryReceipt, archivedEffectRecoveryEligible,
  reviveArchivedEffectBlocks, recordQuarantinedEffect, MAX_QUARANTINE_RECORDS } from '../lib/mission-archive-recovery.mjs';
import { claimMissionOwnership, inspectMissionOwnership, readMissionOwnership, MISSION_OWNERSHIP_KEY } from '../lib/mission-ownership.mjs';
import { writeCheckpoint } from '../lib/durable-checkpoint.mjs';
import { normalizeMissionWorkQueue } from '../lib/mission-work-queue.mjs';

class Storage {
  constructor() { this.entries = {}; }
  async get(keys) {
    if (keys == null) return structuredClone(this.entries);
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    return Object.fromEntries(list.filter(key=>key in this.entries).map(key=>[key,structuredClone(this.entries[key])]));
  }
  async set(obj) { Object.assign(this.entries,structuredClone(obj)); }
  async remove(keys) { for (const key of typeof keys === 'string' ? [keys] : keys) delete this.entries[key]; }
}
const goal = 'Projekt: 103 - Elli Lab / EXP8 - GFW: GF-2.103.1027.\nRead owner state.';
const key = 'gfw:GF-2.103.1027';
const archived = {sourceWorkerId:'old-worker',sourceProcessId:'process-9bf42511-7f40-44bb-9fbf-92ebbee9c9af',
  promptHash:'c65a443c738bd1ec4ec59caa3c125e5ee4a8af1c3da7a49015bc778b274fd0d0',recordedAtMs:1792997372836,
  reason:'ARCHIVED_EFFECT_UNRESOLVED_REQUIRES_OPERATOR_RECEIPT'};
function item() {
  return {itemId:'item-103',savedMissionId:'mission-103',goal,status:'BLOCKED',order:0,
    lastError:{code:'MISSION_PRIOR_EFFECT_UNRESOLVED'},blockedRetryAtMs:Date.now()+300000,
    processSnapshot:{processId:'old-process',workerId:'old-worker',pendingPrompt:{sendAttempts:0}},
    resume:{objective:'old objective must not replay',analysisEvidence:{old:'data'}}};
}
async function setupStorage() {
  const storage=new Storage();
  await writeCheckpoint(MISSION_OWNERSHIP_KEY,{schema:'eic.greenfield.mission-ownership.v1',
    owners:{[key]:{workerId:'old-worker',processId:archived.sourceProcessId,epoch:4,supersededWorkerIds:[]}},
    archivedUnresolved:{[key]:archived},resolutions:{},history:[]},storage);
  // Real latest diagnostic has a stopped old worker with an UNSENT prompt.
  storage.entries['eic.gf.process.worker.old-worker']={schema:'eic.greenfield.process.v1',
    goal,workerId:'old-worker',processId:'old-stopped-process',phase:'STOPPED',
    pendingPrompt:{sendAttempts:0,dispatch:null},lastPrompt:null,lastResponse:null};
  return storage;
}
function candidate(src=archived) {
  const prepared=prepareArchivedEffectRestart(item(),src);
  const text=JSON.stringify({type:'MISSION_START',objective:prepared.resume.objective,
    instruction:'Read fresh owner state, do not replay old effects'});
  const process={workerId:'new-worker',processId:'new-process',goal,phase:'ROTATING',turn:1,
    queueContext:{queueId:'q',itemId:'item-103',savedMissionId:'mission-103',interactionCount:0},
    pendingPrompt:{text,hash:createHash('sha256').update(text).digest('hex'),sendAttempts:0,dispatch:null},
    lastPrompt:null,lastResponse:null,sessionRotation:{warmResume:{warm:false}},
    objectiveState:{objective:prepared.resume.objective}};
  process.archivedEffectRecovery=archivedEffectRecoveryReceipt(src,process);
  return {process,prepared};
}
test('v1.9.32 archived tombstone is not allowed to block a fresh, no-replay owner restart',async()=>{
  const storage=await setupStorage(); const {process,prepared}=candidate();
  assert.equal(prepared.processSnapshot,null);
  assert.notEqual(prepared.resume.objective,'old objective must not replay');
  assert.equal(prepared.resume.analysisEvidence,null);
  assert.equal(archivedEffectRecoveryEligible(process,archived),true);
  assert.equal((await inspectMissionOwnership(process,{storage})).code,'MISSION_ARCHIVED_EFFECT_QUARANTINED');
  const claim=await claimMissionOwnership(process,{storage,allowTakeover:true,liveWorkerIds:[]});
  assert.equal(claim.allowed,true);
  assert.equal(claim.archivedRecovery,true);
  const state=await readMissionOwnership(storage);
  assert.equal(state.owners[key].workerId,'new-worker');
  assert.equal(state.archivedUnresolved[key],undefined,'old permanent blocker must be consumed');
  assert.equal(state.archivedEffectQuarantine[key].sourceProcessId,archived.sourceProcessId);
  assert.equal(state.archivedEffectQuarantine[key].outcome,'UNVERIFIED_OLD_EFFECT_NOT_REPLAYED');
  assert.equal(state.history.at(-1).archivedEffectQuarantined,true);
});
test('bare archive marker still prevents unsafe direct takeover and an identical old prompt',async()=>{
  const storage=await setupStorage(),{process}=candidate();
  delete process.archivedEffectRecovery;
  assert.equal((await claimMissionOwnership(process,{storage,allowTakeover:true})).allowed,false);
  process.archivedEffectRecovery=archivedEffectRecoveryReceipt(archived,process);
  process.pendingPrompt.hash=archived.promptHash;
  assert.equal((await claimMissionOwnership(process,{storage,allowTakeover:true})).allowed,false);
  process.pendingPrompt.hash='brand-new-hash';process.pendingPrompt.sendAttempts=1;
  assert.equal((await claimMissionOwnership(process,{storage,allowTakeover:true})).allowed,false);
});
test('live prior owner is automatically fenced; an uncertain dispatch from the new process is still rejected',async()=>{
  const storage=await setupStorage(),{process}=candidate();
  const claim=await claimMissionOwnership(process,{storage,allowTakeover:true,liveWorkerIds:[{workerId:'old-worker',processId:'old-stopped-process'}]});
  assert.equal(claim.allowed,true);
  assert.equal(claim.code,'MISSION_ARCHIVED_EFFECT_QUARANTINED');
  const second=await setupStorage(),candidate2=candidate().process;
  candidate2.pendingPrompt.sendAttempts=1;
  candidate2.pendingPrompt.dispatch={operationId:'new-send',status:'DISPATCHED',effectPossible:null};
  assert.equal((await claimMissionOwnership(candidate2,{storage:second,allowTakeover:true})).allowed,false);
});
test('old BLOCKED timer revives immediately on upgrade if and only if archive marker is present',()=>{
  const now=Date.now(); const q=normalizeMissionWorkQueue({queueId:'q',workerId:'w',windowId:1,
    enabled:true,items:[item(),{itemId:'independent',savedMissionId:'new',goal:'GF-0.71.1008',status:'READY',order:1}]},{now});
  const released=reviveArchivedEffectBlocks(q,{[key]:archived},{now,hasPendingEffect:()=>false});
  assert.deepEqual(released.revivedItemIds,['item-103']);
  assert.equal(released.queue.items[0].status,'READY');
  assert.equal(released.queue.items[0].blockedRetryAtMs,0);
  assert.equal(released.queue.items[0].lastError,null);
  assert.equal(released.queue.items[1].status,'READY');
  const denied=reviveArchivedEffectBlocks(q,{[key]:archived},{now,hasPendingEffect:()=>true});
  assert.deepEqual(denied.revivedItemIds,[]);
  assert.equal(denied.queue,q);
  assert.equal(reviveArchivedEffectBlocks(q,{}, {now}).queue,q);
});
test('the quarantine journal is bounded FIFO by latest issue per mission',()=>{
  let state={};
  for(let i=0;i<MAX_QUARANTINE_RECORDS+25;i++)
    state=recordQuarantinedEffect(state,`gfw:GF-0.71.${1000+i}`,archived,
      {workerId:'w',processId:'p'},1000+i);
  assert.equal(Object.keys(state).length,MAX_QUARANTINE_RECORDS);
  assert.ok(state['gfw:GF-0.71.1088']);
  assert.equal(state['gfw:GF-0.71.1000'],undefined);
});
test('background uses one-shot owner/archive recovery before creating a new process and clears stale copies',()=>{
  const bg=readFileSync(new URL('../background.js',import.meta.url),'utf8');
  const activation=bg.slice(bg.indexOf('async function activateQueueItem('), bg.indexOf('const QUEUE_OWNERSHIP_DEFER_CODES'));
  assert.ok(activation.includes('prepareArchivedEffectRestart(item, recoverySource)')); 
  assert.ok(activation.includes('item: activationItem'));
  assert.ok(activation.includes('process.archivedEffectRecovery = archivedEffectRecoveryReceipt'));
  assert.ok(activation.includes('processSnapshot: recoverySource ? null : candidate.processSnapshot')); 
  assert.ok(activation.includes('recoverySource && sameLogicalMission')); 
  assert.ok(activation.includes('if (missionOwner.archivedRecovery)'));
  const successor=bg.slice(bg.indexOf('async function activateRunnableQueueSuccessor('),bg.indexOf('async function startMissionQueue('));
  assert.ok(successor.includes('reviveArchivedEffectBlocks'));
  assert.ok(successor.includes('persistMissionQueue(revival.queue'));
});
test('stopped worker is not a live conflicting owner merely because its durable queue is enabled',async()=>{
  const bg=readFileSync(new URL('../background.js',import.meta.url),'utf8');
  const hit=bg.indexOf('async function liveMissionWorkerIds()');
  const tail=bg.slice(hit);const end=/^}\s*$/m.exec(tail);
  assert.ok(hit>=0 && end);
  const observed=[];
  const processes=[{workerId:'retired',phase:'STOPPED',windowId:1,tabId:10},
    {workerId:'waiting',phase:'QUEUE_WAIT',windowId:2,tabId:20},
    {workerId:'active',phase:'WAITING',windowId:3,tabId:30}];
  const deps={loadPersistedProcessInventory:async()=>({processes}),
    workerBindingMatches:async()=>true,
    chrome:{storage:{session:{}},tabs:{get:async id=>({id,windowId:id/10})}},
    TERMINAL_PHASES:new Set(['STOPPED','QUEUE_WAIT','BLOCKED','DONE'])};
  const run=Function(...Object.keys(deps),tail.slice(0,end.index+end[0].length)+';return liveMissionWorkerIds;')(...Object.values(deps));
  assert.deepEqual(await run(),[{workerId:'active',processId:undefined}]);
});
test('crash after ownership claim but before saveProcess can recover without an operator or previous resend',async()=>{
  const storage=await setupStorage(),first=candidate().process;
  const initial=await claimMissionOwnership(first,{storage,allowTakeover:true});
  assert.equal(initial.allowed,true);
  // Deliberately DO NOT write first process to storage: crash window.
  const ownership=await readMissionOwnership(storage);
  ownership.owners[key].claimedAtMs=Date.now()-16000;
  await writeCheckpoint(MISSION_OWNERSHIP_KEY,ownership,storage);
  const second=candidate().process;
  second.processId='after-crash-process';
  second.archivedEffectRecovery=archivedEffectRecoveryReceipt(archived,second);
  const verdict=await inspectMissionOwnership(second,{storage});
  assert.equal(verdict.allowed,true);
  assert.equal(verdict.code,'MISSION_ARCHIVED_EFFECT_QUARANTINED');
  const claim=await claimMissionOwnership(second,{storage,allowTakeover:true});
  assert.equal(claim.allowed,true);
  const owners=await readMissionOwnership(storage);
  assert.equal(owners.owners[key].processId,'after-crash-process');
  assert.equal(owners.archivedEffectQuarantine[key].newProcessId,'after-crash-process');
});
