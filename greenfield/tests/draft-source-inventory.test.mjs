import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settledRotationFixture} from './fixtures/settled-rotation.mjs';
import {findDraftRecoverySource,readDraftRecoverySource} from '../lib/draft-source-inventory.mjs';
import {staleDraftSource} from '../lib/stale-draft-recovery.mjs';
import {writeCheckpoint,checkpointKeys} from '../lib/durable-checkpoint.mjs';
import {preserveMissionHistory} from '../lib/mission-history.mjs';

const queueKey='eic.gf.mission-work-queue.worker.worker';
function storage(){const data={};return {data,get:async keys=>structuredClone(keys===null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]]))),set:async v=>Object.assign(data,structuredClone(v)),remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};}
async function fixture(){
 const f=await settledRotationFixture();f.source.goal='Projekt: 71 - Test - GFW: GF-1.71.1021.';
 f.source.sessionInitialization.receipt.conversationKey='';f.target.processId='replacement';
 return {...f,s:storage(),queue:{workerId:'worker',queueId:'queue',items:[{itemId:'old-slot',processSnapshot:f.source}]}};
}
test('interrupted queue publication stays quarantined; independently verified mission history remains usable',async()=>{
 const f=await fixture();await writeCheckpoint(queueKey,f.queue,f.s);await f.s.remove(queueKey);
 await assert.rejects(findDraftRecoverySource(f.target,f.hash,f.s,[]),/DRAFT_SOURCE_STORAGE_UNVERIFIED/);
 await preserveMissionHistory(f.source,f.s);
 const c=await findDraftRecoverySource(f.target,f.hash,f.s,[{id:f.source.tabId}]);
 assert.equal(c.sourceLocator.kind,'MISSION_HISTORY');
 assert.equal((await readDraftRecoverySource(c.sourceLocator,f.s)).processId,f.source.processId);
});
test('history survives removal of queue item and replacement of worker process',async()=>{
 const f=await fixture();await preserveMissionHistory(f.source,f.s);
 await writeCheckpoint(queueKey,{...f.queue,items:[]},f.s);
 await writeCheckpoint('eic.gf.process.worker.worker',f.target,f.s);
 const c=await findDraftRecoverySource(f.target,f.hash,f.s,[{id:f.source.tabId}]);
 assert.equal(c.sourceLocator.kind,'MISSION_HISTORY');assert.equal(c.text,f.text);
});
test('authorization refuses a replaced parked slot, even if the receipt exists elsewhere',async()=>{
 const f=await fixture();await writeCheckpoint(queueKey,f.queue,f.s);await preserveMissionHistory(f.source,f.s);
 const c=await findDraftRecoverySource(f.target,f.hash,f.s,[]);
 await writeCheckpoint(queueKey,{...f.queue,items:[{itemId:'old-slot',processSnapshot:f.target}]},f.s);
 assert.equal(await readDraftRecoverySource(c.sourceLocator,f.s),null);
 assert.equal((await findDraftRecoverySource(f.target,f.hash,f.s,[])).sourceLocator.kind,'MISSION_HISTORY');
});
test('ambiguous duplicate slot cannot authorize clearing',async()=>{
 const f=await fixture();await writeCheckpoint(queueKey,f.queue,f.s);
 const c=await findDraftRecoverySource(f.target,f.hash,f.s,[]);
 await writeCheckpoint(queueKey,{...f.queue,history:f.queue.items},f.s);
 assert.equal(await readDraftRecoverySource(c.sourceLocator,f.s),null);
});
test('malformed unrelated queue does not hide valid mission history',async()=>{
 const f=await fixture();await preserveMissionHistory(f.source,f.s);
 await writeCheckpoint(queueKey,{...f.queue,items:{},history:[null]},f.s);
 assert.equal((await findDraftRecoverySource(f.target,f.hash,f.s,[])).sourceLocator.kind,'MISSION_HISTORY');
});
test('wrong storage owner and invalid acknowledgement are never authority',async()=>{
 const f=await fixture();await writeCheckpoint(queueKey+'.other',f.queue,f.s);
 assert.equal(await findDraftRecoverySource(f.target,f.hash,f.s,[]),null);
 f.source.sessionInitialization.acknowledgement.binding.workerId='foreign';
 await writeCheckpoint(queueKey,f.queue,f.s);
 assert.equal(await findDraftRecoverySource(f.target,f.hash,f.s,[]),null);
});
test('corrupt sole source is not silently treated as an empty history',async()=>{
 const f=await fixture();await writeCheckpoint(queueKey,f.queue,f.s);await f.s.remove(queueKey);
 for(const key of checkpointKeys(queueKey))if(f.s.data[key])f.s.data[key].sha256='0'.repeat(64);
 await assert.rejects(findDraftRecoverySource(f.target,f.hash,f.s,[]),/DRAFT_SOURCE_STORAGE_UNVERIFIED/);
});
for(const mutation of ['missing-completion-route','conflicting-send-route','invalid-send-route','unacknowledged','missing-response'])test('legacy root receipt still rejects '+mutation,async()=>{
 const f=await fixture(),i=f.source.sessionInitialization;
 if(mutation==='missing-completion-route')i.conversationKey='';
 if(mutation==='conflicting-send-route')i.receipt.conversationKey='https://chatgpt.com/c/another';
 if(mutation==='invalid-send-route')i.receipt.conversationKey='invalid';
 if(mutation==='unacknowledged')i.receipt.acknowledged=false;
 if(mutation==='missing-response')i.response=null;
 assert.equal(await staleDraftSource(f.source,f.target,f.hash),null);
});
