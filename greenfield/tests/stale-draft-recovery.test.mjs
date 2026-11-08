import {test} from 'node:test';
import {settledRotationFixture} from './fixtures/settled-rotation.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {staleDraftSource,draftRecoveryTarget,archiveUnsentDraft,DRAFT_ARCHIVE_PREFIX} from '../lib/stale-draft-recovery.mjs';
import {sha256Hex,randomId,nowIso} from '../lib/common.mjs';
import {readCheckpoint,writeCheckpoint} from '../lib/durable-checkpoint.mjs';
import {createProcess} from '../lib/state.mjs';
import {loadPersistedProcessInventory} from '../lib/process-store.mjs';
import {findDraftRecoverySource,readDraftRecoverySource} from '../lib/draft-source-inventory.mjs';
import {preserveMissionHistory} from '../lib/mission-history.mjs';
import {reconcileRestart} from '../lib/restart-recovery.mjs';
import {getWorkerBinding} from '../lib/worker-identity.mjs';
import {fleetHealth} from '../lib/operations-view.mjs';
import {startupProgressIndex,capDiagnosticExport} from '../lib/startup-diagnostics.mjs';
import {prepareSessionInitialization} from '../lib/session-transport.mjs';
import {PHASES} from '../lib/contracts.mjs';
import {SESSION_ROTATION_STATES} from '../lib/session-rotation.mjs';
const root=new URL('../',import.meta.url);
const background=await readFile(new URL('background.js',root),'utf8');
const behaviorBackground=process.env.GREENFIELD_BEHAVIOR_ROOT?await readFile(process.env.GREENFIELD_BEHAVIOR_ROOT+'/background.js','utf8'):background;
const content=await readFile(new URL('content.js',root),'utf8');
const gptRoot='https://chatgpt.com/g/g-test';
function source(name,code=background,indent='') {
 const start=new RegExp('^'+indent+'(?:async )?function '+name+'\\(','m').exec(code)?.index;
 assert.notEqual(start,undefined,name);
 const end=new RegExp('^'+indent+'}[ \\t]*$','m').exec(code.slice(start));
 return code.slice(start,start+end.index+end[0].length);
}
const fn=(name,deps,code=background)=>Function(...Object.keys(deps),source(name,code)+`;return ${name};`)(...Object.values(deps));
function storage(){const data={};return {data,get:async keys=>structuredClone(keys===null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]]))),set:async v=>Object.assign(data,structuredClone(v)),remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};}
async function fixture(kind='UNSENT') {
 if (kind !== 'UNSENT') {
  const f=await settledRotationFixture();
  const target={...f.target,windowId:3,tabId:4};target.sessionRotation.targetTabId=4;
  target.sessionRotation.navigationStartedAt=new Date().toISOString();
  const old=kind==='SETTLED_SELF'?structuredClone(target):f.source;
  if(kind==='SETTLED_SIBLING'){target.processId='sibling';target.workerId='sibling-worker';}
  if(kind==='SETTLED_PARKED'){
   old.goal='Projekt: 71 - Test - GFW: GF-1.71.1021.';
   Object.assign(target,{processId:'next-process',sessionSeq:1,lastPrompt:null,lastResponse:null,sessionInitialization:null});
  }
  return {...f,old,target};
 }
 const text=JSON.stringify({messageId:'a2a-old',messageType:'SESSION_INITIALIZATION',instruction:'Initialize old session; never replay this prompt.'});
 const hash=await sha256Hex(text);
 const old={...createProcess({workerId:'old-worker',windowId:1,tabId:2,goal:'old',initialPrompt:'old'}),
  processId:'old-process',phase:'DETACHED',gptRoot,lastPrompt:null,lastResponse:null,
  sessionInitialization:{status:'PENDING',initializationId:'a2a-old'},
  pendingPrompt:{text,hash,sendAttempts:7,transportKind:'SESSION_INITIALIZATION',transportId:'a2a-old',a2a:JSON.parse(text),
   dispatch:{operationId:'old-send',status:'NO_EFFECT_CONFIRMED',effectPossible:false,acknowledged:false,method:'',error:{code:'THINKING_MAXIMUM_UNVERIFIED'}}}};
 const target={...createProcess({workerId:'new-worker',windowId:3,tabId:4,goal:'new',initialPrompt:'new'}),processId:'new-process',phase:'ROTATING',gptRoot,
  pendingPrompt:{text:'fresh work',hash:await sha256Hex('fresh work'),sendAttempts:0,dispatch:null},
  sessionInitialization:null,queueContext:{itemId:'i',queueId:'q'},
  sessionRotation:{rotationId:'r',state:'NAVIGATING',queueSwitch:true,targetTabId:4,hardReloadBeforeResume:true,hardReloadState:'COMPLETED',navigationStartedAt:new Date().toISOString()}};
 const page={url:gptRoot,documentId:'doc',userCount:0,generating:false,composerReady:true,composerEmpty:false,composerTextHash:hash};
 return {text,hash,old,target,page};
}
test('captured failure shape: exact old no-effect initialization is archived without replay permission',async()=>{
 const f=await fixture();assert.equal(draftRecoveryTarget(f.target,f.page),true);
 const c=await staleDraftSource(f.old,f.target,f.hash);assert.equal(c.text,f.text);assert.equal(c.sourceProcessId,'old-process');
 const s=storage(),key=await archiveUnsentDraft(c,s);const saved=(await readCheckpoint(key,s)).value;
 assert.equal(saved.text,f.text);assert.equal(saved.automaticReplay,false);
 await archiveUnsentDraft(c,s);assert.equal((await readCheckpoint(key,s)).revision,1);
});
for(const kind of ['modified-by-human','hash-tampered','effect-unknown','effect-true','acknowledged','already-posted','active-source','last-prompt','last-response','different-gpt','storage-damage','different-init'])test(`preserve draft when ${kind}`,async()=>{
 const f=await fixture(),s=f.old,p=s.pendingPrompt,d=p.dispatch;
 if(kind==='modified-by-human')p.text+=' edited';if(kind==='hash-tampered')p.hash='a'.repeat(64);
 if(kind==='effect-unknown')d.effectPossible=null;if(kind==='effect-true')d.effectPossible=true;
 if(kind==='acknowledged')d.acknowledged=true;if(kind==='already-posted')d.method='send-button';
 if(kind==='active-source')s.phase='SENDING';if(kind==='last-prompt')s.lastPrompt={hash:f.hash};
 if(kind==='last-response')s.lastResponse={text:'reply'};if(kind==='different-gpt')s.gptRoot+='2';
 if(kind==='storage-damage')s.storageRecoveryRequired=true;if(kind==='different-init')s.sessionInitialization.initializationId='other';
 assert.equal(await staleDraftSource(s,f.target,f.hash),null);
});
for(const kind of ['stopped','warm','already-attempted','unknown-dispatch','prior-reply','human-pause','wrong-root','user-turn','generating','provider-busy','missing-document'])test(`recovery target rejects ${kind}`,async()=>{
 const f=await fixture(),p=f.target,page=f.page;
 if(kind==='stopped')p.phase='STOPPED';if(kind==='warm')p.sessionRotation.warmResume={warm:true};
 if(kind==='already-attempted')p.pendingPrompt.sendAttempts=1;if(kind==='unknown-dispatch')p.pendingPrompt.dispatch={effectPossible:null};
 if(kind==='prior-reply')p.lastResponse={text:'reply'};if(kind==='human-pause')p.missionPause={};
 if(kind==='wrong-root')page.url+='/c/other';if(kind==='user-turn')page.userCount=1;
 if(kind==='generating')page.generating=true;if(kind==='provider-busy')page.providerNotices={processingNotice:true};
 if(kind==='missing-document')delete page.documentId;
 assert.equal(draftRecoveryTarget(p,page),false);
});
test('conflicting backup never gets replaced',async()=>{
 const f=await fixture(),c=await staleDraftSource(f.old,f.target,f.hash),s=storage();
 await writeCheckpoint(DRAFT_ARCHIVE_PREFIX+f.hash,{text:'foreign',hash:f.hash},s);
 await assert.rejects(archiveUnsentDraft(c,s),/DRAFT_ARCHIVE_READBACK_FAILED/);
 assert.equal((await readCheckpoint(DRAFT_ARCHIVE_PREFIX+f.hash,s)).value.text,'foreign');
});
async function bridgeFixture({initial,authorize,afterClear,kind='UNSENT',providedFixture}={}) {
 const f=providedFixture||await fixture(kind);
 const dom=new JSDOM('<form><div id="prompt-textarea" contenteditable="true"></div><button type="button">Send</button></form>',{url:f.page.url,runScripts:'outside-only'}),w=dom.window;
 let composer=w.document.querySelector('[contenteditable]'),clicks=0,active=true,userCount=0,generating=false;
 composer.textContent=initial??f.text;w.document.querySelector('button').addEventListener('click',()=>clicks++);
 let inputObserver;
 const originalAdd=w.document.addEventListener.bind(w.document);
 w.document.addEventListener=(name,listener,...rest)=>{if(name==='input')inputObserver=listener;return originalAdd(name,listener,...rest);};
 const controls={w,get composer(){return composer;},humanInput:()=>inputObserver({isTrusted:true,target:composer}),
  replace:()=>{const next=composer.cloneNode(true);composer.replaceWith(next);composer=next;},dispose:()=>{active=false;},
  user:()=>{userCount=1;},generate:()=>{generating=true;}};
 const state=async()=>({...f.page,url:w.location.href,userCount,generating,composerEmpty:!composer.textContent,composerTextHash:await sha256Hex(composer.textContent)});
 Object.assign(w,{DOCUMENT_ID:'doc',getComposer:()=>composer,sha256Hex,assertContentActive:()=>{if(!active)throw new Error('DISPOSED');},
  pageState:state,canonicalEntries:()=>userCount?[{role:'user'}]:[],generationSignals:()=>({generating}),
  sendRuntimeMessage:async message=>authorize?authorize(controls,message):{ok:true,expiresAtMs:Date.now()+15000},
  setNativeValue:(el,text)=>{el.textContent=text;afterClear?.(controls);}});
 w.eval(['readComposerValue','recoverUnsentDraft'].map(name=>source(name,content,'  ')).join('\n')+'\nwindow.clearOwned=recoverUnsentDraft;');
 const request={recoveryId:'recovery',documentId:'doc',url:f.page.url,hash:f.hash,expectedText:f.text,expiresAtMs:Date.now()+15000};
 return {...f,...controls,state,request,run:()=>w.clearOwned(request),get clicks(){return clicks;},close:()=>w.close()};
}
test('content compare-and-clear never submits; repeat command cannot clear replacement text',async()=>{
 const h=await bridgeFixture();try {assert.equal((await h.run()).ok,true);assert.equal(h.composer.textContent,'');assert.equal(h.clicks,0);
 h.composer.textContent='Human note';assert.equal((await h.run()).ok,false);assert.equal(h.composer.textContent,'Human note');}finally{h.close();}
});
for(const kind of ['human-edit','human-edit-revert','remount','navigate','dispose','stop','expired','schedule-closed','user-turn','generation'])test(`late ${kind} blocks clear without erasing text`,async()=>{
 const h=await bridgeFixture({authorize:c=>{
  if(kind==='human-edit')c.composer.textContent='Human note';if(kind==='human-edit-revert')c.humanInput();
  if(kind==='remount')c.replace();if(kind==='navigate')c.w.history.pushState({},'','/c/other');
  if(kind==='dispose')c.dispose();if(kind==='user-turn')c.user();if(kind==='generation')c.generate();
  return {ok:kind!=='stop',expiresAtMs:kind==='expired'?Date.now()-1:Date.now()+15000,closesAtMs:kind==='schedule-closed'?Date.now()-1:0};
 }});try {let result;try{result=await h.run();}catch(e){assert.equal(kind,'dispose');}
 assert.notEqual(result?.ok,true);assert.ok(h.w.document.querySelector('[contenteditable]').textContent);assert.equal(h.clicks,0);
 }finally{h.close();}
});
test('editor restoration after clear is not reported as successful',async()=>{
 const h=await bridgeFixture({afterClear:c=>{c.composer.textContent='Restored by editor';}});
 try{assert.equal((await h.run()).code,'DRAFT_CLEAR_UNCONFIRMED');assert.equal(h.clicks,0);}finally{h.close();}
});
// Actual recovery orchestration + durable checkpoint + final authorization +
// content clear. Chrome is a simulated tab transport; no real account/send.
async function integration({blocked='',bg=behaviorBackground,kind='UNSENT',sourceStore='PROCESS',legacyRootReceipt=false,bridgeFailures=0,loseClearReply=false,providedFixture,providedStorage}={}) {
 const f=providedFixture||await fixture(kind),s=providedStorage||storage();let current=f.target,oldTabLive=blocked==='old-tab-live',bridgeCalls=0;
 if(legacyRootReceipt)f.old.sessionInitialization.receipt.conversationKey='';
 const sourceKey=sourceStore==='QUEUE_ITEM'?'eic.gf.mission-work-queue.worker.'+f.old.workerId:'eic.gf.process.worker.'+f.old.workerId;
 if(!providedStorage){
  if(sourceStore==='QUEUE_ITEM')await writeCheckpoint(sourceKey,{workerId:f.old.workerId,queueId:'parked-queue',items:[{itemId:'parked-item',processSnapshot:f.old}]},s);
  else if(sourceStore==='MISSION_HISTORY')await preserveMissionHistory(f.old,s);
  else await writeCheckpoint(sourceKey,f.old,s);
  if(sourceStore!=='PROCESS')await writeCheckpoint('eic.gf.process.worker.'+f.target.workerId,f.target,s);
 }
 const sender={id:'extension',tab:{id:current.tabId,windowId:current.windowId}},events=[],wakeups=[];
 const deps={runtimeFault:'',staleDraftSource,findDraftRecoverySource,readDraftRecoverySource,draftRecoveryTarget,archiveUnsentDraft,DRAFT_ARCHIVE_PREFIX,readCheckpoint,
  draftRecoveryChecks:new Map(),randomId,nowIso,
  readSafety:async()=>({admissionPaused:blocked==='paused'}),readQueueDispatchAdmission:async()=>({ok:blocked!=='schedule'}),
  loadPersistedProcessInventory:()=>loadPersistedProcessInventory(s),loadProcessForWindow:async()=>current,
  transportTransitionBoundary:async p=>({blocked:current.phase!==p.phase,process:current}),
  saveRotationState:async(p,rotation,kind)=>{events.push(kind);return current={...p,sessionRotation:rotation};},
  recordIncident:async()=>{},scheduleFast:(id,delay)=>wakeups.push(delay),
  chrome:{runtime:{id:'extension'},storage:{local:s},tabs:{query:async()=>{
   if(blocked==='tab-scan-failed')throw new Error('TAB_SCAN_FAILED');if(kind!=='UNSENT')return [{id:f.old.tabId},{id:current.tabId}];return oldTabLive?[{id:2},{id:current.tabId}]:[{id:current.tabId}];},get:async id=>{
   if(id===2&&!oldTabLive)throw new Error('NO_TAB');return {id,windowId:id===current.tabId?current.windowId:1,url:f.page.url,status:'complete'};}}}};
 deps.authorizeDraftRecovery=fn('authorizeDraftRecovery',deps,bg);
 const bridge=await bridgeFixture({kind,providedFixture:f,authorize:async(c,message)=>{
  if(blocked==='stop-during-clear')current={...current,phase:'STOPPED'};
  if(blocked==='source-changed'){
   const next=structuredClone(f.old);if(kind==='UNSENT')next.pendingPrompt.dispatch.effectPossible=true;else next.sessionInitialization.status='PENDING';
   if(sourceStore==='QUEUE_ITEM')await writeCheckpoint(sourceKey,{workerId:f.old.workerId,queueId:'parked-queue',items:[{itemId:'parked-item',processSnapshot:next}]},s);
   else if(sourceStore==='MISSION_HISTORY')await preserveMissionHistory(next,s);
   else await writeCheckpoint(sourceKey,next,s);
  }
  return deps.authorizeDraftRecovery(message,sender);
 }});
 deps.bridgeMessage=async(tab,message)=>{
  if(message.type==='EIC_GF_GET_PAGE_STATE')return {ok:true,state:await bridge.state()};
  bridgeCalls++;if(bridgeCalls<=bridgeFailures)throw new Error('BRIDGE_TRANSIENT');Object.assign(bridge.request,message);
  const result=await bridge.run();if(loseClearReply)throw new Error('REPLY_LOST_AFTER_CLEAR');return result;};
 deps.recoverStaleRotationDraft=fn('recoverStaleRotationDraft',deps,bg);
 const observe=fn('observeRotationComposerWait',deps,bg);
 Object.assign(deps,{PHASES,SESSION_ROTATION_STATES,prepareSessionInitialization,EIC_LANDING_TIMEOUT_MS:60000,
  invalidCapturedResponse:()=>false,warmResumeTarget:()=>'',readEicSurfaceState:async()=>({entryUrl:f.page.url}),
  resolveManagedGptRoot:()=>f.page.url,supportedUrl:()=>true,recheckExpiredRotationReady:async()=>({handled:false}),
  ensureContentBridgeVersion:async()=>{},providerTransportPending:()=>false,
  Safety:{eicSurfaceProof:()=>({ok:true,kind:'EIC'})},observeRotationComposerWait:observe,
  commitTransition:async(p,phase,patch,options)=>{if(options.beforeSave)await options.beforeSave();return current={...p,...patch,phase};}});
 deps.commitFreshRotationReady=fn('commitFreshRotationReady',deps,bg);
 const rotate=fn('tickRotating',deps,bg);
 if(blocked==='archive-write')s.set=async()=>{throw new Error('WRITE_FAILED');};
 return {bridge,s,events,wakeups,checks:deps.draftRecoveryChecks,get current(){return current;},get bridgeCalls(){return bridgeCalls;},
  async tick(){return observe(current,current.sessionRotation,await bridge.state());},
  async rotate(){return rotate(current);},close:bridge.close};
}
test('restored old draft no longer traps a new queue; backup precedes clear and fresh observation releases rotation',async()=>{
 const bg=process.env.GREENFIELD_BEHAVIOR_ROOT?await readFile(process.env.GREENFIELD_BEHAVIOR_ROOT+'/background.js','utf8'):background;
 const h=await integration({bg});try {
  const originalPending=structuredClone(h.current.pendingPrompt);
  assert.equal((await h.tick()).handled,true);
  assert.equal(h.bridge.composer.textContent,'','old prompt must be archived and removed, never submitted');
  assert.equal(h.current.phase,'ROTATING');assert.equal(h.bridge.clicks,0);assert.equal(h.bridgeCalls,1);
  const archive=(await readCheckpoint(DRAFT_ARCHIVE_PREFIX+h.bridge.hash,h.s)).value;assert.equal(archive.text,h.bridge.text);
  assert.equal((await h.tick()).handled,false);
  assert.deepEqual(h.current.pendingPrompt,originalPending);
  const ready=await h.rotate();assert.equal(ready.phase,'SENDING');
  assert.equal(ready.pendingPrompt.transportKind,'SESSION_INITIALIZATION');
  assert.notEqual(ready.pendingPrompt.hash,h.bridge.hash);
  assert.equal(ready.sessionInitialization.workPrompt.hash,originalPending.hash);
  assert.equal(h.bridge.clicks,0,'initialization is prepared; normal send gates still own the click');
 }finally{h.close();}
});
for(const blocked of ['paused','schedule','old-tab-live','tab-scan-failed','archive-write','source-changed','stop-during-clear'])test(`integrated recovery preserves draft on ${blocked}`,async()=>{
 const h=await integration({blocked});try{await h.tick();assert.equal(h.bridge.composer.textContent,h.bridge.text);assert.equal(h.bridge.clicks,0);
 if(blocked==='stop-during-clear')assert.equal(h.current.phase,'STOPPED');}finally{h.close();}
});
test('compact diagnostic index retains block and no-effect evidence after trimming',async()=>{
 const f=await fixture();f.target.sessionRotation.readinessWait={code:'SESSION_ROTATION_COMPOSER_DRAFT_PRESENT',composerTextHash:f.hash};
 const index=startupProgressIndex({'eic.gf.process.worker.old':f.old,'eic.gf.process.worker.new':f.target});
 assert.equal(index[0].effectPossible,false);assert.equal(index[1].readinessWait.composerTextHash,f.hash);assert.ok(!JSON.stringify(index).includes(f.text));
 const bounded=capDiagnosticExport({startupProgress:index,storage:{'eic.gf.mission-history.v1.old':{text:'x'.repeat(100000)}}},12000);
 assert.deepEqual(bounded.startupProgress,index);assert.equal(bounded.exportRetention.truncated,true);
});
test('startup waits are reported ahead of nominal storage pressure',()=>{
 const h=fleetHealth({generatedAt:new Date().toISOString(),startupWaitCount:2,storage:{ratio:1.9},activeCount:2});
 assert.equal(h.tone,'warn');assert.match(h.label,/2 worker väntar på start/);
});
test('fleet snapshot counts cold-rotation waits even when capacity is idle',async()=>{
 const f=await fixture();f.target.sessionRotation.readinessWait={code:'SESSION_ROTATION_COMPOSER_DRAFT_PRESENT'};
 const bg=process.env.GREENFIELD_BEHAVIOR_ROOT?await readFile(process.env.GREENFIELD_BEHAVIOR_ROOT+'/background.js','utf8'):background;
 const deps={loadAllProcesses:async()=>[f.target,{...f.target,processId:'sibling',workerId:'sibling-worker'}],
  chrome:{storage:{local:{},session:{}}},readGlobalPromptGate:async()=>null,readSafety:async()=>({}),
  loadMissionWorkQueue:async()=>null,publicSnapshot:p=>p,dispatchWaitView:()=>null,
  currentSchedulerSnapshot:async()=>({scheduler:{activeCount:0,waiters:[]}}),loadOperatorSettings:async()=>({}),
  nowIso,APP_VERSION:'test',runtimeFault:'',storageContractProof:null,recoveryNoticeView:async()=>({}),
  restartReport:{},usageSummary:s=>s,safetyVaultStatus:{},driftVaultStatus:{},storageHealth:async()=>({ratio:1.5}),
  storageRetentionStatus:null,readStorageRetentionStatus:async()=>null,PHASES,TERMINAL_PHASES:new Set(['STOPPED']),DEFAULT_MAX_ACTIVE_SESSIONS:3};
 const status=await fn('fleetStatusSnapshot',deps,bg)();
 assert.equal(status.usedCapacity,0);assert.equal(status.startupWaitCount,2);assert.equal(status.waitingCount,2);assert.equal(status.heldCount,0);
});

for(const kind of ['SETTLED_SELF','SETTLED_SIBLING'])test(kind+': archived completed init clears with source tab open, then fresh observation prepares new init',async()=>{
 const h=await integration({kind});try{
  const pending=structuredClone(h.current.pendingPrompt);await h.tick();
  assert.equal(h.bridge.composer.textContent,'');assert.equal(h.current.sessionRotation.draftRecovery.sourceKind,'SETTLED_INITIALIZATION');
  const archive=(await readCheckpoint(DRAFT_ARCHIVE_PREFIX+h.bridge.hash,h.s)).value;
  assert.equal(archive.text,h.bridge.text);assert.equal(archive.kind,'SETTLED_INITIALIZATION');assert.equal(archive.automaticReplay,false);
  assert.deepEqual(h.current.pendingPrompt,pending);assert.equal(h.bridge.clicks,0);
  const next=await h.rotate();assert.equal(next.phase,'SENDING');assert.equal(next.sessionInitialization.workPrompt.hash,pending.hash);
  assert.notEqual(next.pendingPrompt.hash,h.bridge.hash);assert.equal(h.bridge.clicks,0);
 }finally{h.close();}
});
for(const kind of ['SETTLED_SELF','SETTLED_SIBLING'])for(const blocked of ['paused','schedule','archive-write','source-changed','stop-during-clear'])test(kind+' preserves draft: '+blocked,async()=>{
 const h=await integration({kind,blocked});try{await h.tick();assert.equal(h.bridge.composer.textContent,h.bridge.text);assert.equal(h.bridge.clicks,0);}finally{h.close();}
});

for(const sourceStore of ['QUEUE_ITEM','MISSION_HISTORY']) {
 test(`${sourceStore}: overwritten worker pointer and legacy root receipt recover without replay`,async()=>{
  const h=await integration({sourceStore,kind:'SETTLED_PARKED',legacyRootReceipt:true});try{
   const pending=structuredClone(h.current.pendingPrompt);
   await h.tick();assert.equal(h.bridge.composer.textContent,'');
   assert.equal(h.current.sessionRotation.draftRecovery.sourceLocator.kind,sourceStore);
   assert.equal(h.current.sessionRotation.readinessWait.reviewRequired,false);
   assert.equal((await h.rotate()).phase,'SENDING');
   assert.equal(h.current.sessionInitialization.workPrompt.hash,pending.hash);
   assert.equal(h.bridge.clicks,0);
  }finally{h.close();}
 });
 for(const blocked of ['source-changed','stop-during-clear','archive-write','schedule','paused'])test(`${sourceStore}: final authorization preserves draft on ${blocked}`,async()=>{
  const h=await integration({sourceStore,kind:'SETTLED_PARKED',legacyRootReceipt:true,blocked});try{
   await h.tick();assert.equal(h.bridge.composer.textContent,h.bridge.text);assert.equal(h.bridge.clicks,0);
  }finally{h.close();}
 });
}
test('four bridge failures retain owned-draft status, rate-limit retries and recover on fifth attempt',async()=>{
 const h=await integration({kind:'SETTLED_PARKED',sourceStore:'QUEUE_ITEM',legacyRootReceipt:true,bridgeFailures:4});try{
  for(let attempt=1;attempt<=5;attempt++){
   await h.tick();assert.equal(h.bridgeCalls,attempt);assert.equal(h.current.sessionRotation.draftRecovery.attempts,attempt);
   if(attempt<=4){
    assert.equal(h.bridge.composer.textContent,h.bridge.text);
    assert.equal(h.current.sessionRotation.readinessWait.reason,'KNOWN_DRAFT_RECOVERY_PENDING');
    assert.equal(h.current.sessionRotation.readinessWait.reviewRequired,false);assert.equal(h.wakeups.at(-1),30000);
    await h.tick();assert.equal(h.bridgeCalls,attempt,'immediate ticks must not hammer the bridge');
    for(const key of h.checks.keys())h.checks.set(key,Date.now()-31000);
   }
  }
  assert.equal(h.bridge.composer.textContent,'');assert.equal((await h.rotate()).phase,'SENDING');assert.equal(h.bridge.clicks,0);
 }finally{h.close();}
});
test('restarted worker and backward wall-clock both permit a fresh owned-draft check',async()=>{
 const h=await integration({kind:'SETTLED_PARKED',sourceStore:'QUEUE_ITEM',legacyRootReceipt:true,bridgeFailures:2});try{
  await h.tick();h.checks.clear();await h.tick();assert.equal(h.bridgeCalls,2);
  for(const key of h.checks.keys())h.checks.set(key,Date.now()+3600000);
  await h.tick();assert.equal(h.bridgeCalls,3);assert.equal(h.bridge.composer.textContent,'');assert.equal(h.bridge.clicks,0);
 }finally{h.close();}
});
test('lost clear reply uses a fresh empty-composer observation without repeating cleanup or send',async()=>{
 const h=await integration({kind:'SETTLED_PARKED',sourceStore:'QUEUE_ITEM',legacyRootReceipt:true,loseClearReply:true});try{
  await h.tick();assert.equal(h.bridge.composer.textContent,'');
  assert.equal((await h.rotate()).phase,'SENDING');assert.equal(h.bridgeCalls,1);assert.equal(h.bridge.clicks,0);
 }finally{h.close();}
});

// Optional replay of the operator's original diagnostic. Its private full
// prompts remain outside the distributable; all source checks are production.
if(process.env.GREENFIELD_FIELD_DIAGNOSTIC)test('field diagnostic: exact parked receipt releases recorded rotation via content compare-and-clear',async()=>{
 const diagnostic=JSON.parse(await readFile(process.env.GREENFIELD_FIELD_DIAGNOSTIC,'utf8'));
 const s=storage();Object.assign(s.data,diagnostic.storage);
 const key='eic.gf.process.worker.worker-9efbfa01-2585-49cd-be3f-116a3563d05f';
 let target=(await readCheckpoint(key,s)).value;
 const hash=target.sessionRotation.readinessWait.composerTextHash;
 const candidate=await findDraftRecoverySource(target,hash,s,[{id:target.tabId}]);
 assert.equal(candidate.sourceLocator.kind,'QUEUE_ITEM');
 const old=await readDraftRecoverySource(candidate.sourceLocator,s);
 assert.equal(old.sessionInitialization.receipt.conversationKey,'','retain the original root-send receipt');
 const page={url:target.gptRoot,documentId:'doc',userCount:0,generating:false,composerReady:true,composerEmpty:false,composerTextHash:hash};
 const session=storage(),tab={id:target.tabId,windowId:target.windowId,url:target.gptRoot,status:'complete'};
 const report=await reconcileRestart({local:s,session,ensureBridge:async()=>{},
  tabs:{query:async()=>[tab],get:async()=>tab,sendMessage:async()=>({ok:true,state:page})}});
 assert.ok(report.restored.some(row=>row.processId===target.processId && row.code==='COLD_ROTATION_SETTLED_DRAFT_PROVEN'));
 assert.equal((await getWorkerBinding(target.windowId,session)).workerId,target.workerId);
 target=(await readCheckpoint(key,s)).value;
 const h=await integration({kind:'SETTLED_PARKED',providedStorage:s,providedFixture:{old,target,text:candidate.text,hash,page}});try{
  const pending=structuredClone(target.pendingPrompt);
  assert.equal(h.current.sessionRotation.readinessWait.reviewRequired,true);
  await h.tick();assert.equal(h.bridge.composer.textContent,'');
  assert.equal(h.current.sessionRotation.draftRecovery.state,'CLEARED');
  const archive=(await readCheckpoint(DRAFT_ARCHIVE_PREFIX+hash,s)).value;
  assert.equal(archive.text,candidate.text);assert.equal(archive.automaticReplay,false);
  assert.equal((await h.rotate()).phase,'SENDING');
  assert.equal(h.current.sessionInitialization.workPrompt.hash,pending.hash);assert.equal(h.bridge.clicks,0);
  assert.match(h.current.pendingPrompt.a2a.instruction,/Open project 105 for this session/);
  assert.equal(h.current.sessionInitialization.acknowledgement.binding.processId,target.processId);
 }finally{h.close();}
});
