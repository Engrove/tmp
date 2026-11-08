import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startHarness,storage,runtime} from './fixtures/start-runtime.mjs';
import {resetSessionStart,needsSessionStart} from '../lib/session-start.mjs';
import {DRAFT_ARCHIVE_PREFIX,staleDraftSource} from '../lib/stale-draft-recovery.mjs';
import {readCheckpoint} from '../lib/durable-checkpoint.mjs';
import {loadPersistedProcessInventory} from '../lib/process-store.mjs';
import {findDraftRecoverySource} from '../lib/draft-source-inventory.mjs';
import {reconcileRestart} from '../lib/restart-recovery.mjs';
import {sha256Hex} from '../lib/common.mjs';

for(const text of ['  Egen text utan Greenfield-identitet.\n','{"messageType":"SESSION_INITIALIZATION","messageId":"unknown"}','Flera\nrader\nmed åäö 👷'])test('new start archives any composer and prepares initialization: '+text.slice(0,22),async()=>{
 const h=await startHarness({text});try{
  const original=structuredClone(h.current);await h.establish();
  assert.equal(h.current.safety,null);assert.equal(h.current.greenfieldControl,null);assert.equal(h.current.ownerWait,null);
  assert.equal(h.current.missionPause,null);assert.equal(h.current.lastError,null);
  const saved=(await readCheckpoint(h.current.sessionStart.archiveKey,h.local)).value;
  assert.deepEqual(saved.process,original);assert.equal(saved.automaticReplay,false);
  assert.equal((await h.tick()).phase,'ROTATING');assert.equal(h.composer.textContent,'');
  assert.equal((await readCheckpoint(DRAFT_ARCHIVE_PREFIX+await sha256Hex(text),h.local)).value.text,text);
  await h.tick();assert.equal(h.current.phase,'SENDING');assert.equal(h.current.sessionStart.state,'READY');
  assert.equal(h.current.pendingPrompt.transportKind,'SESSION_INITIALIZATION');
  assert.equal(h.current.sessionInitialization.workPrompt.hash,original.pendingPrompt.hash);assert.equal(h.clicks,0);
 }finally{h.close();}
});
test('start reset is once per scope; a later STOP or newly observed failure is not erased by another tick',async()=>{
 const h=await startHarness();try{
  await h.establish();const p={...h.current,safety:{hold:{code:'NEW_FAILURE'}},greenfieldControl:{hardStop:true}};
  assert.equal(needsSessionStart(p),false);assert.strictEqual(resetSessionStart(p),p);
  assert.equal(needsSessionStart({...p,phase:'STOPPED'}),false);
 }finally{h.close();}
});
test('four transient cleanup failures do not become a permanent ownership blocker',async()=>{
 const h=await startHarness({failures:4});try{
  await h.establish();for(let i=0;i<5;i++){await h.tick();if(i<4){assert.equal(h.current.sessionRotation.readinessWait.reviewRequired,false);await h.expireRetry();}}
  assert.equal(h.requests,5);assert.equal(h.composer.textContent,'');await h.tick();assert.equal(h.current.phase,'SENDING');
 }finally{h.close();}
});
for(const late of ['edit','stop'])test('late '+late+' cannot be erased or overridden by stale cleanup',async()=>{
 const h=await startHarness({late});try{await h.establish();await h.tick();assert.notEqual(h.composer.textContent,'');assert.equal(h.clicks,0);
 if(late==='stop')assert.equal(h.current.phase,'STOPPED');}finally{h.close();}
});
test('failed archive is retried automatically and never destroys the only text copy',async()=>{
 const h=await startHarness({archiveFailure:true});try{await h.establish();await h.tick();assert.notEqual(h.composer.textContent,'');
 assert.equal(h.current.phase,'ROTATING');assert.equal(h.wakeups.at(-1),3000);assert.equal(h.clicks,0);}finally{h.close();}
});
test('a restored root draft between readiness and first initialization is cleared again',async()=>{
 const h=await startHarness();try{await h.establish();await h.tick();await h.tick();
 h.composer.textContent='Restored late by browser';await h.sendTick();assert.equal(h.composer.textContent,'');
 assert.equal(h.current.phase,'SENDING');assert.equal(h.current.pendingPrompt.sendAttempts,0);assert.equal(h.clicks,0);
 }finally{h.close();}
});

if(process.env.GREENFIELD_START_DIAGNOSTIC)test('field: both new workers start with no receipt history, including extension reload',async()=>{
 const diagnostic=JSON.parse(await readFile(process.env.GREENFIELD_START_DIAGNOSTIC,'utf8'));
 const old=JSON.parse(await readFile(process.env.GREENFIELD_DRAFT_TEXT_SOURCE,'utf8'));
 const previous=storage(old.storage),rows=await loadPersistedProcessInventory(previous);
 const hash='9dee7214b1a2d906fa1eb3d71b4642f73537f39e302215ff1f27aed90cb39ead';
 const oldCandidate=await findDraftRecoverySource(rows.processes[0],hash,previous,[]);assert.ok(oldCandidate);
 const local=storage(diagnostic.storage),session=storage(),inventory=await loadPersistedProcessInventory(local);
 assert.equal(inventory.processes.length,2);
 for(const p of inventory.processes)assert.equal(await findDraftRecoverySource(p,hash,local,[]),null);
 const originalTabs=inventory.processes.map(p=>({id:p.tabId,windowId:p.windowId,url:p.gptRoot}));
 let nextTabId=99000;const created=[];
 const tabs={query:async()=>[...originalTabs,...created],create:async args=>{const t={...args,id:nextTabId++};created.push(t);return t;},
  sendMessage:async()=>{throw new Error('Old browser content must not be an admission prerequisite');}};
 const report=await reconcileRestart({local,session,tabs,ensureBridge:async()=>{throw new Error('Unnecessary old-tab proof');}});
 assert.equal(report.restored.filter(r=>r.code==='FRESH_SESSION_STARTED').length,2);assert.equal(created.length,2);
 for(const p of inventory.processes){
  const source=(await readCheckpoint('eic.gf.process.worker.'+p.workerId,local)).value;
  assert.notEqual(source.tabId,p.tabId);assert.equal(source.sessionStart.policy,'ARCHIVE_COMPOSER_AND_START');
  const h=await startHarness({source,local,session,text:oldCandidate.text});try{
   await h.tick();assert.equal(h.composer.textContent,'');await h.tick();assert.equal(h.current.phase,'SENDING');
   assert.equal(h.current.sessionInitialization.workPrompt.hash,p.pendingPrompt.hash);
   assert.match(h.current.pendingPrompt.a2a.instruction,new RegExp('Open project '+(p.goal.includes('Projekt: 71')?'71':'103')+' for this session'));
   assert.equal(h.clicks,0);
  }finally{h.close();}
 }
});

test('panel reports automatic preparation without exposing archived draft text',async()=>{
 const h=await startHarness();try{await h.establish();await h.tick();
  const {managedOverlayOverview}=await import('../lib/overlay-summary.mjs');
  const p={...h.current,queueContext:null};
  const snapshot=runtime('publicSnapshot',{normalizeGreenfieldPriority:()=>'',DEFAULT_GREENFIELD_PRIORITY:'NORMAL',sessionHealthCapsule:()=>null})(p);
  assert.equal(snapshot.sessionStart.policy,'ARCHIVE_COMPOSER_AND_START');
  assert.match(managedOverlayOverview(snapshot).phaseText,/automatiskt/);
  assert.doesNotMatch(JSON.stringify(snapshot.sessionStart),/archiveKey|Ett eget/);
 }finally{h.close();}
});
