import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeMissionWorkQueue, selectNextMissionItem, requeueBlockedMissionWorkItem, deferMissionOwnershipWorkItem, reviveOwnershipContentionBlocks } from '../lib/mission-work-queue.mjs';
import { ROTATION_TIMEOUT_COOLDOWN_MS, rotationTimeoutCooldownUntil, rotationBlankEligible } from '../lib/rotation-timeout-policy.mjs';
import { MAX_LOG_BYTES, fifoRowsByBytes, serializedUtf8Bytes } from '../lib/log-byte-budget.mjs';
import { capDiagnosticExport } from '../lib/startup-diagnostics.mjs';
import { preserveMissionHistory } from '../lib/mission-history.mjs';
import { purgeArchivedMissionSnapshots } from '../lib/mission-archive-cleanup.mjs';
import { readMissionOwnership, inspectMissionOwnership } from '../lib/mission-ownership.mjs';
import { readCheckpoint, checkpointKeys } from '../lib/durable-checkpoint.mjs';
const bg = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
function runtime(name, deps) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(bg);
  assert.ok(match, `function ${name} not found`);
  const tail = bg.slice(match.index); const end = /^}\s*$/m.exec(tail);
  return Function(...Object.keys(deps), tail.slice(0, end.index + end[0].length) + `;return ${name};`)(...Object.values(deps));
}
class Storage {
  constructor() { this.entries = {}; }
  async get(keys) {
    if (keys == null) return structuredClone(this.entries);
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const result = {};
    for (const key of list) if (Object.hasOwn(this.entries,key)) result[key] = structuredClone(this.entries[key]);
    return result;
  }
  async set(rows) { Object.assign(this.entries, structuredClone(rows)); }
  async remove(keys) { for (const k of typeof keys === 'string' ? [keys] : keys) delete this.entries[k]; }
}
function queue({now=Date.now(), cooldownUntilMs=0}={}) {
  return normalizeMissionWorkQueue({queueId:'q',workerId:'worker',windowId:1,enabled:true,
    cursorOrder:0,cooldownUntilMs,items:[
      {itemId:'held',savedMissionId:'held',goal:'Projekt: 103 - Test - GFW: GF-2.103.1027.',status:'READY',order:0},
      {itemId:'free',savedMissionId:'free',goal:'Projekt: 71 - Test - GFW: GF-0.71.1008.',status:'READY',order:1}
    ]}, {now});
}
test('rotation timeout may navigate the owned, unsent tab to about:blank exactly once', () => {
  const p={windowId:1,tabId:2,pendingPrompt:{sendAttempts:0,dispatch:null},sessionRotation:{}};
  const t={id:2,windowId:1};
  assert.equal(rotationBlankEligible(p,t),true);
  assert.equal(rotationBlankEligible({...p,sessionRotation:{readinessTimeout:{aboutBlank:{attempted:true}}}},t),false);
  assert.equal(rotationBlankEligible({...p,pendingPrompt:{sendAttempts:1}},t),false);
  assert.equal(rotationBlankEligible({...p,pendingPrompt:{dispatch:{effectPossible:true}}},t),false);
  assert.equal(rotationBlankEligible(p,{id:3,windowId:1}),false);
  assert.equal(rotationBlankEligible(p,{id:2,windowId:1,url:'about:blank'}),false,'reload must not repeat blank navigation');
});
test('timeout cooldown persists in queue and excludes all activation for five minutes', () => {
  const now=Date.parse('2026-10-26T05:00:00Z'); const expires=rotationTimeoutCooldownUntil(now);
  assert.equal(expires-now, ROTATION_TIMEOUT_COOLDOWN_MS);
  const original=queue({now,cooldownUntilMs:expires});
  const restored=normalizeMissionWorkQueue(structuredClone(original), {now:now+60_000});
  assert.equal(restored.cooldownUntilMs,expires);
  assert.equal(selectNextMissionItem(restored,{now:expires-1}),null);
  assert.equal(selectNextMissionItem(restored,{now:expires}).itemId,'free');
});
test('mission-owner conflict is isolated, persisted, and the next independently runnable mission starts', async () => {
  let persisted=0; const starts=[],incidents=[]; const initial=queue(); initial.cursorOrder=-1;
  const deps={ROTATION_TIMEOUT_COOLDOWN_MS,QUEUE_OWNERSHIP_DEFER_CODES:new Set(['MISSION_PRIOR_EFFECT_UNRESOLVED']),
    selectNextMissionItem,requeueBlockedMissionWorkItem,deferMissionOwnershipWorkItem,reviveOwnershipContentionBlocks,
    queueItemNeedsEffectReconciliation:()=>false,
    persistMissionQueue:async q=>{persisted++;return q;},
    syncMissionQueueWakeAlarm:async()=>{},
    recordIncident:async(_p,kind,code)=>incidents.push({kind,code}),
    activateQueueItem:async({item,queue:q})=>{
      starts.push(item.itemId);
      if(item.itemId==='held')return {blocked:true,code:'MISSION_PRIOR_EFFECT_UNRESOLVED',queue:q};
      return {process:{phase:'ROTATING',queueContext:{itemId:item.itemId}},queue:q};
    }};
  const successor=runtime('activateRunnableQueueSuccessor',deps);
  const activated=await successor({queue:initial,settings:{},windowId:1});
  assert.deepEqual(starts,['held','free']);
  assert.equal(activated.selectedItemId,'free');
  assert.equal(persisted,1);
  assert.equal(activated.queue.items[0].status,'PAUSED');
  assert.ok(activated.queue.items[0].pauseUntilMs>Date.now());
  assert.equal(activated.queue.items[0].blockedCount,0,'ownership must not create failure counter');
  assert.equal(activated.queue.items[0].lastOutcome,'MISSION_OWNERSHIP_WAIT');
  assert.deepEqual(incidents,[{kind:'MISSION_QUEUE_CONFLICT_ISOLATED',code:'MISSION_PRIOR_EFFECT_UNRESOLVED'}]);
});
test('a global dispatch/source hold cannot be bypassed by selecting another mission',async()=>{
  const attempts=[];
  const successor=runtime('activateRunnableQueueSuccessor',{
    ROTATION_TIMEOUT_COOLDOWN_MS,QUEUE_OWNERSHIP_DEFER_CODES:new Set(['MISSION_PRIOR_EFFECT_UNRESOLVED']),
    selectNextMissionItem,requeueBlockedMissionWorkItem,deferMissionOwnershipWorkItem,reviveOwnershipContentionBlocks,
    queueItemNeedsEffectReconciliation:()=>false,
    persistMissionQueue:async()=>{throw Error('must not persist');},
    recordIncident:async()=>{throw Error('must not log');},syncMissionQueueWakeAlarm:async()=>{},
    activateQueueItem:async({item})=>{attempts.push(item.itemId);return {blocked:true,code:'QUEUE_DISPATCH_SOURCE_UNPROVEN'};}
  });
  const result=await successor({queue:queue(),settings:{},windowId:1});
  assert.equal(result.blocked,true);
  assert.deepEqual(attempts,['free']);
});
test('ten-MB FIFO drops oldest rows, retaining chronological newest records',()=>{
  const records=Array.from({length:25},(_,i)=>({seq:i,data:'x'.repeat(80000)}));
  const budget=1000000; const result=fifoRowsByBytes(records,budget);
  assert.ok(result.dropped>0);
  assert.equal(result.rows.at(-1).seq,24);
  assert.equal(result.rows[0].seq,result.dropped);
  assert.ok(result.bytes<=budget);
  assert.equal(MAX_LOG_BYTES,10000000);
});
test('large diagnostic export is minified and bounded under 10 MB',()=>{
  const original={schema:'test',responseObservation:Array.from({length:250},(_,i)=>({recordedAt:new Date(1790000000000+i*1000).toISOString(),data:'x'.repeat(8000)})),storage:{}};
  for(let i=0;i<55;i++) original.storage[`eic.gf.process.worker.${i}`]='y'.repeat(320000);
  const bounded=capDiagnosticExport(original);
  assert.ok(serializedUtf8Bytes({...bounded,sha256:'0'.repeat(64)})<=MAX_LOG_BYTES);
  assert.equal(bounded.exportRetention.truncated,true);
  assert.ok(bounded.exportRetention.omittedObservations>0);
  assert.ok(bounded.exportRetention.omittedStorageKeys.length>0);
  assert.equal(Object.keys(original.storage).length,55,'export trim must not erase source storage');
});
test('historic mission archives are deleted while unknown prior effect remains fenced',async()=>{
  const storage=new Storage();
  const earlier={workerId:'previous',processId:'previous-process',goal:'Projekt: 71 - Greenfield Works - GFW: GF-0.71.1008.',
    lastPrompt:{dispatchedUserTurnId:'user-turn'},lastResponse:null};
  await preserveMissionHistory(earlier,storage);
  const key='eic.gf.mission-history.v1.gfw%3AGF-0.71.1008.previous';
  assert.ok((await readCheckpoint(key,storage)).value);
  const result=await purgeArchivedMissionSnapshots(storage);
  assert.equal(result.deleted,1);
  assert.equal(result.protectedUnresolved,1);
  assert.equal(result.errors.length,0);
  assert.equal((await readCheckpoint(key,storage)).value,null);
  const held=await readMissionOwnership(storage);
  assert.equal(held.archivedUnresolved['gfw:GF-0.71.1008'].sourceProcessId,'previous-process');
  const candidate={workerId:'next',processId:'next-process',goal:earlier.goal,queueContext:{queueId:'q',itemId:'i',savedMissionId:'saved'}};
  const inspected=await inspectMissionOwnership(candidate,{storage});
  assert.equal(inspected.code,'MISSION_ARCHIVED_RECOVERY_REQUIRED');
});
test('settled mission archive deletes without a false unresolved effect',async()=>{
  const storage=new Storage();
  const process={workerId:'prior',processId:'prior-process',goal:'Projekt: 71 - Greenfield Works - GFW: GF-0.71.1008.'};
  await preserveMissionHistory(process,storage);
  const result=await purgeArchivedMissionSnapshots(storage);
  assert.equal(result.deleted,1);
  assert.equal(result.protectedUnresolved,0);
  assert.equal(Object.keys((await readMissionOwnership(storage)).archivedUnresolved||{}).length,0);
});
test('real wake state machine honors rotation cooldown before recovery and permits successor after expiry',async()=>{
  let now=Date.parse('2026-10-26T06:00:00Z');
  const prior={processId:'prior-process',workerId:'worker',windowId:1,phase:'BLOCKED',
    lastError:{code:'SESSION_ROTATION_CHAT_READY_TIMEOUT'},queueContext:{itemId:'held'}};
  const stored=queue({now,cooldownUntilMs:now+ROTATION_TIMEOUT_COOLDOWN_MS});
  let reconciles=0, activations=0, alarm=0;
  const deps={Date:class extends Date {static now(){return now;}},
    PHASES:{BLOCKED:'BLOCKED',ANALYZING:'ANALYZING',PAUSED:'PAUSED'},
    TERMINAL_PHASES:new Set(['BLOCKED','QUEUE_WAIT','DONE','STOPPED']),
    BACKGROUND_AUDIT_SESSION_ID:'test',
    loadProcessForWindow:async()=>prior,
    missionQueueForWindow:async()=>({queue:stored,settings:{}}),
    acceptPendingMissionDelegationsForQueue:async()=>{},
    terminalQueueDispatchCandidate:()=>false,queuePendingEffectNeedsReconciliation:()=>false,
    refreshOwnerWaitingSlots:async q=>q,
    reconcileRetryableTerminalQueueSlot:async()=>{reconciles++;return null;},
    reconcileTerminalQueueSlot:async()=>{},reconcileLegacyInitializationSlots:async q=>q,
    syncMissionQueueWakeAlarm:async()=>{alarm++;},
    activateRunnableQueueSuccessor:async()=>{activations++;return{process:{processId:'next-process',phase:'ROTATING'},selectedItemId:'free'};},
    audit:async()=>{}};
  const wake=runtime('wakeMissionQueue',deps);
  const before=await wake(1,'QUEUE_WAKE_ALARM');
  assert.equal(before,prior);assert.equal(reconciles,0);assert.equal(activations,0);assert.equal(alarm,1);
  now+=ROTATION_TIMEOUT_COOLDOWN_MS;
  const after=await wake(1,'QUEUE_WAKE_ALARM');
  assert.equal(after.processId,'next-process');assert.equal(reconciles,1);assert.equal(activations,1);
});
