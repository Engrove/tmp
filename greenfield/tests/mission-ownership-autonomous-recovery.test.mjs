import {test} from 'node:test';
import assert from 'node:assert/strict';
import {claimMissionOwnership,findDormantMissionRecoverySource,MISSION_OWNERSHIP_KEY} from '../lib/mission-ownership.mjs';
import {archivedEffectRecoveryReceipt} from '../lib/mission-archive-recovery.mjs';

function storage(seed={}) {
  const data=structuredClone(seed);
  return {data,
    async get(keys){return keys==null?structuredClone(data):Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]))},
    async set(value){Object.assign(data,structuredClone(value))},
    async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key]}
  };
}
function missionProcess(workerId,processId,phase='ANALYZING') {
  return {workerId,processId,runId:`run-${processId}`,windowId:1,tabId:10,phase,
    goal:'Projekt: 71 - Greenfield Works - GFW: GF-1.71.1021.',
    updatedAt:'2026-11-06T10:00:00.000Z',
    queueContext:{queueId:`queue-${workerId}`,itemId:`item-${workerId}`,savedMissionId:'saved-1021',interactionCount:0},
    pendingPrompt:null,
    lastPrompt:{hash:`old-hash-${processId}`,dispatchedUserTurnId:`user-${processId}`},
    lastResponse:null};
}
function freshQuarantineProcess(source,workerId='new',processId='new-process') {
  const p=missionProcess(workerId,processId,'ROTATING');
  p.turn=1;
  p.queueContext.interactionCount=0;
  p.lastPrompt=null;p.lastResponse=null;
  p.objectiveState={objective:'ARCHIVED_EFFECT_QUARANTINE: Read fresh owner state; do not replay prior work.'};
  p.pendingPrompt={text:'ARCHIVED_EFFECT_QUARANTINE: fresh owner reread only',hash:'fresh-prompt-hash',sendAttempts:0,dispatch:null};
  p.archivedEffectRecovery=archivedEffectRecoveryReceipt(source,p);
  return p;
}

test('terminal QUEUE_WAIT with lost response pairing is quarantined and may resume in a fresh chat',async()=>{
  const prior=missionProcess('old','old-process','QUEUE_WAIT');
  prior.lastResponse={text:'A response was observed, but the causal pair receipt was not retained.',hash:'response-hash'};
  const local=storage({'eic.gf.process.worker.old':prior});
  const candidate=missionProcess('new','preflight-process','ROTATING');
  const source=await findDormantMissionRecoverySource(candidate,{storage:local,liveWorkerIds:[]});
  assert.equal(source.sourceProcessId,'old-process');
  const next=freshQuarantineProcess(source);
  const result=await claimMissionOwnership(next,{storage:local,allowTakeover:true,liveWorkerIds:[]});
  assert.equal(result.allowed,true);
  assert.equal(result.code,'MISSION_PRIOR_EFFECT_QUARANTINED');
  assert.equal(result.archivedRecovery,true);
  const state=local.data[MISSION_OWNERSHIP_KEY];
  assert.equal(state.archivedEffectQuarantine['gfw:GF-1.71.1021'].outcome,'UNVERIFIED_OLD_EFFECT_NOT_REPLAYED');
});

test('DETACHED process without an observed response is quarantined and never replayed',async()=>{
  const prior=missionProcess('old','old-process','DETACHED');
  prior.pendingPrompt={hash:'unanswered-prompt-hash',text:'old prompt',sendAttempts:1,
    dispatch:{operationId:'send-1',status:'DISPATCHED',effectPossible:true}};
  prior.lastPrompt=null;prior.lastResponse=null;
  const local=storage({'eic.gf.process.worker.old':prior});
  const candidate=missionProcess('new','preflight-process','ROTATING');
  const source=await findDormantMissionRecoverySource(candidate,{storage:local,liveWorkerIds:[]});
  assert.ok(source);
  const next=freshQuarantineProcess(source);
  const result=await claimMissionOwnership(next,{storage:local,allowTakeover:true,liveWorkerIds:[]});
  assert.equal(result.allowed,true);
  assert.equal(result.code,'MISSION_PRIOR_EFFECT_QUARANTINED');
  assert.match(next.pendingPrompt.text,/ARCHIVED_EFFECT_QUARANTINE/);
});

test('an exact live process in the same worker is fenced by an automatic no-replay takeover',async()=>{
  const prior=missionProcess('same-worker','old-process','ANALYZING');
  prior.pendingPrompt={hash:'in-flight',text:'old',sendAttempts:1,
    dispatch:{operationId:'send-2',status:'DISPATCHED',effectPossible:true}};
  const local=storage({'eic.gf.process.worker.same-worker':prior});
  const candidate=missionProcess('same-worker','preflight-process','ROTATING');
  const source=await findDormantMissionRecoverySource(candidate,{storage:local,
    liveWorkerIds:[{workerId:'same-worker',processId:'old-process'}]});
  assert.ok(source);
  const next=freshQuarantineProcess(source,'same-worker','new-process');
  const result=await claimMissionOwnership(next,{storage:local,allowTakeover:true,
    liveWorkerIds:[{workerId:'same-worker',processId:'old-process'}]});
  assert.equal(result.allowed,true);
  assert.equal(result.code,'MISSION_PRIOR_EFFECT_QUARANTINED');
});

test('orphaned durable owner record without its process checkpoint is quarantined for automatic takeover',async()=>{
  const owner={workerId:'old-worker',processId:'missing-process',processFence:true,epoch:3,claimedAtMs:1793960000000,supersededWorkerIds:[]};
  const local=storage({[MISSION_OWNERSHIP_KEY]:{schema:'eic.greenfield.mission-ownership.v1',owners:{'gfw:GF-1.71.1021':owner}}});
  const candidate=missionProcess('new-worker','preflight-process','ROTATING');
  const source=await findDormantMissionRecoverySource(candidate,{storage:local,liveWorkerIds:[]});
  assert.ok(source);
  const next=freshQuarantineProcess(source,'new-worker','new-process');
  const result=await claimMissionOwnership(next,{storage:local,allowTakeover:true,liveWorkerIds:[]});
  assert.equal(result.allowed,true);
  assert.equal(result.code,'MISSION_PRIOR_EFFECT_QUARANTINED');
});

test('an unresolved parked slot is not overwritten by a newer healthy process from the same worker',async()=>{
  const old=missionProcess('shared-worker','old-process','WAITING');
  old.pendingPrompt={hash:'old-in-flight',text:'old prompt',sendAttempts:1,
    dispatch:{operationId:'send-old',status:'DISPATCHED',effectPossible:true}};
  const current=missionProcess('shared-worker','current-process','ANALYZING');
  current.lastResponse={text:'A newer unrelated response.',hash:'new-response',observation:{pairedUserTurnId:'user-current',causalMatch:true}};
  current.lastPrompt={hash:'new-prompt',dispatchedUserTurnId:'user-current'};
  const queue={'workerId':'shared-worker','queueId':'queue-shared','items':[
    {itemId:'old-slot',status:'PAUSED',goal:old.goal,savedMissionId:'saved-1021',processSnapshot:old}
  ]};
  const local=storage({'eic.gf.mission-work-queue.worker.shared-worker':queue,
    'eic.gf.process.worker.shared-worker':current});
  const candidate=missionProcess('new-worker','new-process','ROTATING');
  const source=await findDormantMissionRecoverySource(candidate,{storage:local,liveWorkerIds:[]});
  assert.ok(source);
  const next=freshQuarantineProcess(source);
  const result=await claimMissionOwnership(next,{storage:local,allowTakeover:true,liveWorkerIds:[]});
  assert.equal(result.allowed,true);
  assert.equal(result.code,'MISSION_PRIOR_EFFECT_QUARANTINED');
});

test('nonterminal unresolved process without live evidence is quarantined before takeover',async()=>{
  const prior=missionProcess('old','old-process','WAITING');
  prior.pendingPrompt={hash:'unknown',text:'old',sendAttempts:1,
    dispatch:{operationId:'send-3',status:'DISPATCHED',effectPossible:true}};
  const local=storage({'eic.gf.process.worker.old':prior});
  const candidate=missionProcess('new','new-process','ROTATING');
  const source=await findDormantMissionRecoverySource(candidate,{storage:local,liveWorkerIds:[]});
  assert.ok(source);
  const next=freshQuarantineProcess(source);
  const result=await claimMissionOwnership(next,{storage:local,allowTakeover:true,liveWorkerIds:[]});
  assert.equal(result.allowed,true);
  assert.equal(result.code,'MISSION_PRIOR_EFFECT_QUARANTINED');
});
