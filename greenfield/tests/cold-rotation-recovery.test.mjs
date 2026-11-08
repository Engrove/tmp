import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settledRotationFixture} from './fixtures/settled-rotation.mjs';
import {recoverColdRotation} from '../lib/cold-rotation-recovery.mjs';
import {reconcileRestart} from '../lib/restart-recovery.mjs';
import {readCheckpoint,writeCheckpoint} from '../lib/durable-checkpoint.mjs';
import {saveMissionWorkQueue,loadMissionWorkQueue} from '../lib/mission-work-queue.mjs';
import {getWorkerBinding,ensureWorkerBinding} from '../lib/worker-identity.mjs';
function storage(){const data={};return {data,get:async keys=>structuredClone(keys===null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]]))),set:async v=>Object.assign(data,structuredClone(v)),remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};}
async function harness(change=''){
 const f=await settledRotationFixture(),local=storage(),session=storage();
 const original={...f.target,processId:'next-process',sessionSeq:1,lastPrompt:null,lastResponse:null,sessionInitialization:null,
  goal:'Projekt: 71 - GFW: GF-1.71.1022.',queueContext:{queueId:'queue',itemId:'next'},lastManagedUrl:null};
 f.source.sessionInitialization.receipt.conversationKey='';
 const sourceItem={itemId:'old',goal:'Projekt: 71 - GFW: GF-1.71.1021.',status:'READY',processSnapshot:f.source};
 const processKey='eic.gf.process.worker.worker';
 let queue={workerId:'worker',windowId:original.windowId,queueId:'queue',enabled:true,activeItemId:'next',items:[sourceItem,{itemId:'next',goal:original.goal,status:'ACTIVE'}]};
 if(change==='stopped')original.phase='STOPPED';
 if(change==='unknown-effect')original.pendingPrompt.dispatch={effectPossible:null};
 if(change==='paused-queue')queue.enabled=false;
 if(change==='wrong-active-slot'){queue.activeItemId='old';queue.items[0].status='ACTIVE';queue.items[1].status='READY';}
 if(change==='different-queue')original.queueContext.queueId='another';
 if(change==='source-unsettled')f.source.sessionInitialization.status='PENDING';
 if(change==='sibling-source'){f.source.workerId='sibling';}
 await writeCheckpoint(processKey,original,local);queue=await saveMissionWorkQueue(queue,local);
 if(change==='stop-during-binding'){
  const set=session.set;session.set=async rows=>{
   await writeCheckpoint(processKey,{...original,phase:'STOPPED'},local);return set(rows);
  };
 }
 const tab={id:400,windowId:300,url:original.gptRoot,status:'complete'};
 const page={...f.page,documentId:'reloaded-doc'};
 if(change==='human-draft')page.composerTextHash='a'.repeat(64);
 if(change==='empty-root')page.composerEmpty=true;
 if(change==='generating')page.generating=true;
 if(change==='occupied-window')await ensureWorkerBinding(tab.windowId,session);
 let reads=0;
 const tabs={query:async()=>change==='ambiguous'?[tab,{...tab,id:401,windowId:301}]:[tab],get:async()=>tab,
  sendMessage:async(id,message)=>{
   assert.equal(message.type,'EIC_GF_GET_PAGE_STATE','recovery must only observe, never clear/navigate/send');reads++;
   if(reads===2){
    if(change==='late-stop')await writeCheckpoint(processKey,{...original,phase:'STOPPED'},local);
    if(change==='late-queue-stop')queue=await saveMissionWorkQueue({...queue,enabled:false},local);
    if(change==='late-edit')page.composerTextHash='a'.repeat(64);
    if(change==='late-navigation')page.url+='/c/foreign';
    if(change==='late-document')page.documentId='different';
   }
   if(change==='unavailable')throw new Error('BRIDGE_OFFLINE');
   return {ok:true,state:{...page}};
  }};
 const options={original,local,session,tabs,liveTabs:await tabs.query(),ensureBridge:async()=>{}};
 return {...f,...options,processKey,tab,get reads(){return reads;},run:()=>recoverColdRotation(options)};
}
test('extension reload restores an unsent cold rotation from its own unique completed receipt, even with new tab IDs',async()=>{
 const h=await harness(),result=await h.run();assert.equal(result.restored,true);
 const p=(await readCheckpoint(h.processKey,h.local)).value;
 assert.equal(p.phase,'ROTATING');assert.equal(p.generation,h.original.generation+1);
 assert.equal(p.tabId,400);assert.equal(p.windowId,300);assert.equal(p.sessionRotation.targetTabId,400);
 assert.deepEqual(p.pendingPrompt,h.original.pendingPrompt);assert.equal(h.reads,2);
 assert.equal((await getWorkerBinding(300,h.session)).workerId,'worker');
 assert.equal((await loadMissionWorkQueue(300,h.local,{workerId:'worker'})).activeItemId,'next');
});
for(const change of ['stopped','unknown-effect','paused-queue','wrong-active-slot','different-queue','source-unsettled','sibling-source','human-draft','empty-root','generating','occupied-window','ambiguous','unavailable','late-stop','late-queue-stop','late-edit','late-navigation','late-document'])test('cold restart does not bind or send on '+change,async()=>{
 const h=await harness(change);
 if(change==='unavailable')await assert.rejects(h.run(),/BRIDGE_OFFLINE/);else assert.equal((await h.run()).restored,false);
 assert.notEqual((await getWorkerBinding(300,h.session))?.workerId,'worker');
 const p=(await readCheckpoint(h.processKey,h.local)).value;
 assert.equal(p.generation,h.original.generation);assert.deepEqual(p.pendingPrompt,h.original.pendingPrompt);
});
test('normal restart reconciler uses cold proof and repeat hydration makes no duplicate transition',async()=>{
 const h=await harness();const first=await reconcileRestart(h);
 assert.equal(first.restored[0]?.code,'COLD_ROTATION_SETTLED_DRAFT_PROVEN');
 const p=(await readCheckpoint(h.processKey,h.local)).value;
 const second=await reconcileRestart(h);assert.equal(second.restored.length,0);
 assert.equal((await readCheckpoint(h.processKey,h.local)).value.generation,p.generation);
});
test('STOP racing with binding publication wins the conditional process write',async()=>{
 const h=await harness('stop-during-binding');await assert.rejects(h.run(),/PROCESS_CHECKPOINT_CHANGED/);
 const p=(await readCheckpoint(h.processKey,h.local)).value;
 assert.equal(p.phase,'STOPPED');assert.equal(p.generation,h.original.generation);assert.deepEqual(p.pendingPrompt,h.original.pendingPrompt);
});
