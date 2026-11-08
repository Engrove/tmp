import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProcess } from '../lib/state.mjs';
import { writeCheckpoint, readCheckpoint } from '../lib/durable-checkpoint.mjs';
import {
  claimMissionOwnership, findDormantMissionRecoverySource, withMissionOwner,
  readMissionOwnership, MISSION_OWNERSHIP_KEY
} from '../lib/mission-ownership.mjs';
import {
  prepareArchivedEffectRestart, archivedEffectRecoveryReceipt
} from '../lib/mission-archive-recovery.mjs';
import { loadMissionWorkQueue, saveMissionWorkQueue } from '../lib/mission-work-queue.mjs';
import { fenceSupersededQueue } from '../lib/mission-ownership.mjs';

function storage(seed = {}) {
  const data = structuredClone(seed);
  return { data,
    async get(keys) { return keys == null ? structuredClone(data) : Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).filter(k => k in data).map(k => [k, structuredClone(data[k])])) },
    async set(value) { Object.assign(data, structuredClone(value)); },
    async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; }
  };
}
const hash = value => createHash('sha256').update(value).digest('hex');
function oldProcess() {
  const goal = 'Projekt: 59 - EIC Backend / ELLM Backend - GFW: GF-4.59.1030.';
  const p = createProcess({workerId:'old-worker',windowId:11,tabId:111,goal,initialPrompt:'previous work'});
  return {...p,processId:'old-process',runId:'old-run',phase:'WAITING',turn:4,
    queueContext:{queueId:'old-queue',itemId:'old-item',savedMissionId:'mission-1030',interactionCount:1},
    lastManagedUrl:'https://chatgpt.com/c/old-conversation',
    lastPrompt:{text:'previous work',hash:hash('previous work'),acknowledged:true,
      dispatchId:'old-dispatch',dispatchedUserTurnId:'old-user-turn'},
    lastResponse:null,
    pendingPrompt:{text:'old pending action',hash:hash('old pending action'),sendAttempts:1,
      dispatch:{operationId:'old-send',status:'TRANSPORT_UNKNOWN',effectPossible:null,acknowledged:false}}};
}
function newTarget(id='new-worker') {
  const goal='Projekt: 59 - EIC Backend / ELLM Backend - GFW: GF-4.59.1030.';
  return {workerId:id,processId:`${id}-process`,runId:`${id}-run`,goal,phase:'ROTATING',turn:1,sessionSeq:1,
    queueContext:{queueId:`${id}-queue`,itemId:`${id}-item`,savedMissionId:'mission-1030',interactionCount:0}};
}
function quarantineProcess(target, source) {
  const item=prepareArchivedEffectRestart({goal:target.goal,label:target.goal,itemId:target.queueContext.itemId,
    savedMissionId:target.queueContext.savedMissionId,processSnapshot:null,quantumProgress:0,resume:null},source);
  const objective=item.resume.objective;
  const p={...createProcess({workerId:target.workerId,windowId:12,tabId:121,goal:target.goal,initialPrompt:objective}),
    ...target,windowId:12,tabId:121,turn:1,sessionSeq:1,phase:'ROTATING',
    queueContext:{...target.queueContext,interactionCount:0},
    objectiveState:{objective},lastPrompt:null,lastResponse:null,
    pendingPrompt:{text:objective,hash:hash(objective),sendAttempts:0,dispatch:null}};
  p.archivedEffectRecovery=archivedEffectRecoveryReceipt(source,p);
  return p;
}

test('new session automatically takes over a live worker collision with no-replay quarantine', async()=>{
  const local=storage(),old=oldProcess();
  const first=await claimMissionOwnership(old,{storage:local,allowTakeover:true});
  assert.equal(first.allowed,true);
  await writeCheckpoint(`eic.gf.process.worker.${old.workerId}`,old,local);
  const target=newTarget();
  const live=async()=>[{workerId:old.workerId,processId:old.processId}];
  const source=await findDormantMissionRecoverySource(target,{storage:local,liveWorkerIds:live});
  assert.ok(source,'live old generation is converted to a quarantine source');
  assert.equal(source.unresolvedSourceCount,1);
  const next=quarantineProcess(target,source);
  const claim=await claimMissionOwnership(next,{storage:local,allowTakeover:true,liveWorkerIds:live});
  assert.equal(claim.allowed,true);
  assert.equal(claim.code,'MISSION_PRIOR_EFFECT_QUARANTINED');
  assert.deepEqual(claim.priorLiveWorkerIds,[old.workerId]);
  assert.equal((await readMissionOwnership(local)).owners['gfw:GF-4.59.1030'].processId,next.processId);
  await assert.rejects(withMissionOwner(old,local,async()=>assert.fail('superseded worker must not write or send')),
    /MISSION_OWNERSHIP_SUPERSEDED/);
  let writes=0;
  await withMissionOwner(next,local,async()=>writes++);
  assert.equal(writes,1);
  assert.match(next.pendingPrompt.text,/ARCHIVED_EFFECT_QUARANTINE/);
  assert.match(next.pendingPrompt.text,/Do not resend its prompt/);
});

test('an owner record without a recoverable process also becomes an automatic quarantine, not an operator gate', async()=>{
  const local=storage();
  const old=oldProcess();
  await claimMissionOwnership(old,{storage:local,allowTakeover:true});
  // Simulate an owner record whose process checkpoint was lost, but whose owner
  // identity remains durable. This must not require a manual reconciliation.
  await local.remove(`eic.gf.process.worker.${old.workerId}`);
  const ownership=await readMissionOwnership(local);
  ownership.owners['gfw:GF-4.59.1030'].claimedAtMs=Date.now()-60000;
  await writeCheckpoint(MISSION_OWNERSHIP_KEY,ownership,local);
  const target=newTarget('replacement-worker');
  const source=await findDormantMissionRecoverySource(target,{storage:local,liveWorkerIds:[]});
  assert.ok(source);
  const next=quarantineProcess(target,source);
  const claim=await claimMissionOwnership(next,{storage:local,allowTakeover:true,liveWorkerIds:[]});
  assert.equal(claim.allowed,true);
  assert.equal(claim.archivedRecovery,true);
});

test('quarantine retains exact-once protection: old prompt hash is never reused', async()=>{
  const local=storage(),old=oldProcess();
  await claimMissionOwnership(old,{storage:local,allowTakeover:true});
  await writeCheckpoint(`eic.gf.process.worker.${old.workerId}`,old,local);
  const target=newTarget(),source=await findDormantMissionRecoverySource(target,{storage:local,liveWorkerIds:[]});
  const next=quarantineProcess(target,source);
  assert.notEqual(next.pendingPrompt.hash,old.pendingPrompt.hash);
  assert.equal(next.pendingPrompt.sendAttempts,0);
  assert.equal(next.pendingPrompt.dispatch,null);
  const archive=await readCheckpoint(MISSION_OWNERSHIP_KEY,local);
  assert.equal(archive.health,'VERIFIED');
});

test('legacy worker-collision pause is cleared on queue read without operator acknowledgement', async()=>{
  const local=storage();
  let queue=await loadMissionWorkQueue(31,local,{workerId:'queue-worker'});
  queue.enabled=true;
  queue.items=[{itemId:'paused-item',goal:'Projekt: 59 - EIC Backend / ELLM Backend - GFW: GF-4.59.1030.',
    label:'GF-4.59.1030',savedMissionId:'mission-1030',status:'PAUSED',pauseUntilMs:Date.now()+300000,
    lastOutcome:'MISSION_OWNERSHIP_WAIT',lastError:{code:'MISSION_PRIOR_EFFECT_UNRESOLVED'},
    quantumProgress:0,maxInteractions:12,order:0}];
  await saveMissionWorkQueue(queue,local);
  const loaded=await loadMissionWorkQueue(31,local,{workerId:'queue-worker'});
  assert.equal(loaded.items[0].status,'READY');
  assert.equal(loaded.items[0].pauseUntilMs,0);
  assert.equal(loaded.items[0].lastError,null);
  assert.equal(loaded.items[0].lastOutcome,'AUTO_OWNERSHIP_TAKEOVER_READY');
});

test('queue-state integrity holds are isolated and are not mistaken for worker collisions', async()=>{
  const local=storage();
  let queue=await loadMissionWorkQueue(32,local,{workerId:'integrity-worker'});
  queue.enabled=true;
  queue.items=[{itemId:'unknown-state',goal:'GF-1.71.1021',savedMissionId:'mission-1021',status:'PAUSED',
    pauseUntilMs:Date.now()+300000,lastOutcome:'MISSION_OWNERSHIP_WAIT',
    lastError:{code:'MISSION_QUEUE_STATE_UNPROVEN'},quantumProgress:0,maxInteractions:12,order:0}];
  await saveMissionWorkQueue(queue,local);
  const loaded=await loadMissionWorkQueue(32,local,{workerId:'integrity-worker'});
  assert.equal(loaded.items[0].status,'PAUSED');
  assert.equal(loaded.items[0].lastError.code,'MISSION_QUEUE_STATE_UNPROVEN');
});

test('same Chrome worker can start a new process generation after its previous generation was superseded', async()=>{
  const local=storage(),old=oldProcess();
  old.workerId='same-window-worker';
  old.queueContext={queueId:'same-worker-old-queue',workerId:old.workerId,itemId:'old-slot',savedMissionId:'mission-1030',interactionCount:0};
  const initial=await claimMissionOwnership(old,{storage:local,allowTakeover:true});
  assert.equal(initial.allowed,true);
  await writeCheckpoint(`eic.gf.process.worker.${old.workerId}`,old,local);
  await writeCheckpoint(`eic.gf.mission-work-queue.worker.${old.workerId}`,{
    workerId:old.workerId,windowId:12,queueId:'same-worker-old-queue',enabled:true,activeItemId:'old-slot',items:[
      {itemId:'old-slot',goal:old.goal,savedMissionId:'mission-1030',status:'ACTIVE',processSnapshot:old},
      {itemId:'stale-duplicate-slot',goal:old.goal,savedMissionId:'mission-1030',status:'READY'}
    ]},local);
  const target=newTarget('same-window-worker');
  const source=await findDormantMissionRecoverySource(target,{storage:local,liveWorkerIds:[]});
  assert.ok(source);
  const next=quarantineProcess(target,source);
  const claim=await claimMissionOwnership(next,{storage:local,allowTakeover:true,liveWorkerIds:[]});
  assert.equal(claim.allowed,true);
  assert.equal(claim.owner.workerId,old.workerId);
  assert.notEqual(claim.owner.processId,old.processId);
  assert.ok(claim.owner.supersededProcesses.some(g=>g.workerId===old.workerId && g.processId===old.processId));
  await assert.rejects(withMissionOwner(old,local,async()=>assert.fail('old process generation must be fenced')),
    /MISSION_OWNERSHIP_SUPERSEDED/);
  let writes=0;await withMissionOwner(next,local,async()=>writes++);assert.equal(writes,1);
  const oldQueue=fenceSupersededQueue(await readCheckpoint(`eic.gf.mission-work-queue.worker.${old.workerId}`,local).then(x=>x.value),
    {owners:{'gfw:GF-4.59.1030':claim.owner}});
  assert.equal(oldQueue.items[0].status,'STOPPED');
  assert.equal(oldQueue.items[1].status,'STOPPED','duplicate queue slot without a process snapshot is also retired');
  const newQueue=fenceSupersededQueue({workerId:next.workerId,queueId:next.queueContext.queueId,items:[
    {itemId:next.queueContext.itemId,goal:next.goal,savedMissionId:next.queueContext.savedMissionId,status:'ACTIVE',processSnapshot:next}
  ]}, {owners:{'gfw:GF-4.59.1030':claim.owner}});
  assert.equal(newQueue.items[0].status,'ACTIVE');
});
