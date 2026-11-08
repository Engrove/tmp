import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {claimMissionOwnership,inspectMissionOwnership,recordMissionReconciliation,withMissionOwner,
  MISSION_OWNERSHIP_KEY,missionEffectsSettled,fenceSupersededQueue} from '../lib/mission-ownership.mjs';
import {preserveMissionHistory,MISSION_HISTORY_PREFIX} from '../lib/mission-history.mjs';
import {recoveryNoticeView,acknowledgeRecoveryNotices,RECOVERY_NOTICES_KEY} from '../lib/recovery-notices.mjs';
import {readCheckpoint,writeCheckpoint,storageLock} from '../lib/durable-checkpoint.mjs';
import {createProcess} from '../lib/state.mjs';
import {reconcileRestart} from '../lib/restart-recovery.mjs';
import {getWorkerBinding,ensureWorkerBinding,restoreWorkerBinding,workerBindingMatches} from '../lib/worker-identity.mjs';
import {saveProcess} from '../lib/process-store.mjs';
import {saveMissionWorkQueue,loadMissionWorkQueue} from '../lib/mission-work-queue.mjs';
import {fleetHealth,reasonLabel} from '../lib/operations-view.mjs';
import {maintainStorageHeadroom} from '../lib/storage-retention.mjs';

function storage(seed={}) {
  const data=structuredClone(seed);
  return {data,QUOTA_BYTES:10000000,
    async getBytesInUse(){return JSON.stringify(data).length;},
    async get(keys){return keys==null?structuredClone(data):Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]))},
    async set(v){Object.assign(data,structuredClone(v))},
    async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};
}
function process(workerId='old',settled=true) {
  return {...createProcess({workerId,windowId:workerId==='old'?1:2,tabId:10,goal:'GFW GF-1.2.1022\nRead current owner state.',initialPrompt:'work'}),
    processId:`process-${workerId}`,runId:`run-${workerId}`,phase:'ANALYZING',pendingPrompt:null,
    queueContext:{queueId:`queue-${workerId}`,itemId:`item-${workerId}`,savedMissionId:'saved-mission'},
    lastManagedUrl:'https://chatgpt.com/c/original',lastPrompt:{text:'work',hash:'prompt',acknowledged:true,dispatchedUserTurnId:'user'},
    lastResponse:settled?{text:'Verified response',messageId:'assistant',hash:'response',observation:{pairedUserTurnId:'user',causalMatch:true,ownerTrusted:true,messageId:'assistant'}}:null};
}
const owned = ()=>({schema:'eic.greenfield.mission-ownership.v1',owners:{'gfw:GF-1.2.1022':{workerId:'old',processId:'process-old',epoch:1,supersededWorkerIds:[]}}});
const background=await readFile(new URL('../background.js',import.meta.url),'utf8');
const panel=await readFile(new URL('../sidepanel.js',import.meta.url),'utf8');
function fn(name,source,deps) {
  const match=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(match,name);
  const tail=source.slice(match.index),end=/^}\s*$/m.exec(tail);
  return Function(...Object.keys(deps),tail.slice(0,end.index+end[0].length)+`;return ${name};`)(...Object.values(deps));
}

test('missing owner is handled by automatic quarantine; manual receipts are no longer accepted',async()=>{
  const local=storage({[MISSION_OWNERSHIP_KEY]:owned()}),p=process('new');
  const row=await inspectMissionOwnership(p,{storage:local});
  assert.equal(row.operatorCanReconcile,false);
  await assert.rejects(recordMissionReconciliation(p,{storage:local,fingerprint:row.fingerprint,confirmed:true,
    receipt:'Owner receipt TEST-123: prior effects reconciled; remaining obligation stays open.'}),
    /MANUAL_WORKER_RECONCILIATION_REMOVED_AUTOMATIC_TAKEOVER/);
});
test('live prior worker is superseded automatically when the new session claims ownership',async()=>{
  const local=storage({[MISSION_OWNERSHIP_KEY]:owned(),'eic.gf.process.worker.old':process('old')});
  const p=process('new');
  const claim=await claimMissionOwnership(p,{storage:local,allowTakeover:true,
    liveWorkerIds:async()=>[{workerId:'old',processId:'process-old'}]});
  assert.equal(claim.allowed,true);
  assert.equal((await readCheckpoint(MISSION_OWNERSHIP_KEY,local)).value.owners['gfw:GF-1.2.1022'].workerId,'new');
  await assert.rejects(withMissionOwner(process('old'),local,async()=>assert.fail('old owner must be fenced')),/SUPERSEDED/);
});
test('new draft copies are not competing execution owners, even in live windows',async()=>{
  const local=storage({'eic.gf.mission-work-queue.worker.old':{workerId:'old',enabled:false,items:[{goal:process().goal,status:'READY'}]}});
  assert.equal((await claimMissionOwnership(process('new'),{storage:local,liveWorkerIds:['old'],allowTakeover:true})).allowed,true);
});
test('unknown dispatch stays held and independent mission remains claimable',async()=>{
  const old=process();old.pendingPrompt={dispatch:{effectPossible:true}};
  const local=storage({'eic.gf.process.worker.old':old});
  assert.equal((await claimMissionOwnership(process('new'),{storage:local,allowTakeover:true})).code,'MISSION_PRIOR_EFFECT_QUARANTINE_REQUIRED');
  const independent={...process('other'),goal:'GF-2.83.1019'};
  assert.equal((await claimMissionOwnership(independent,{storage:local,allowTakeover:true})).allowed,true);
});
test('archived mission survives process replacement and allows verified takeover',async()=>{
  const local=storage({[MISSION_OWNERSHIP_KEY]:owned(),'eic.gf.process.worker.old':process()}),session=storage();
  await restoreWorkerBinding(1,'old',session);
  const other={...process(),goal:'GF-2.83.1019',processId:'next-process'};
  await saveProcess(other,local,session);
  assert.ok(Object.keys(local.data).some(k=>k.startsWith(MISSION_HISTORY_PREFIX)));
  assert.equal((await claimMissionOwnership(process('new'),{storage:local,allowTakeover:true})).allowed,true);
});
test('removing a queue item preserves its full checkpoint and frozen objective',async()=>{
  const local=storage();let q=await loadMissionWorkQueue(1,local,{workerId:'old'});
  const p=process();p.objectiveState={objective:'Frozen terminal obligations remain open'};
  q.items=[{itemId:'item-old',goal:p.goal,savedMissionId:'saved-mission',status:'READY',processSnapshot:p}];
  q=await saveMissionWorkQueue(q,local);await saveMissionWorkQueue({...q,items:[]},local);
  const key=Object.keys(local.data).find(k=>k.startsWith(MISSION_HISTORY_PREFIX));assert.ok(key);
  assert.deepEqual(local.data[key].process.objectiveState,p.objectiveState);
});
test('a returning superseded worker cannot reclaim a mission',async()=>{
  const local=storage({[MISSION_OWNERSHIP_KEY]:owned(),'eic.gf.process.worker.old':process()});
  const next=process('new');await claimMissionOwnership(next,{storage:local,allowTakeover:true});
  local.data['eic.gf.process.worker.new']=next;
  const returning={...process(),processId:'replacement-old'};
  assert.equal((await claimMissionOwnership(returning,{storage:local,allowTakeover:true})).allowed,false);
});
test('partial ownership write quarantines permissions instead of clearing the error',async()=>{
  const local=storage({[MISSION_OWNERSHIP_KEY]:owned()});
  delete local.data[MISSION_OWNERSHIP_KEY];
  await assert.rejects(claimMissionOwnership(process('new'),{storage:local,allowTakeover:true}),/RECOVERY_REQUIRED/);
});
test('notices acknowledge only their exact state and remain inspectable across restart',async()=>{
  const local=storage(),row={workerId:'old',processId:'p',code:'CONVERSATION_TAB_NOT_RESTORED',stateSignature:'first'};
  let report={unresolved:[{...row,atMs:1}],errors:[]};const view=await recoveryNoticeView(report,local);
  await acknowledgeRecoveryNotices(report,[view.unresolved[0].noticeId],local);
  report={...report,unresolved:[{...row,atMs:2}]};
  const restarted=await recoveryNoticeView(report,storage(local.data));assert.equal(restarted.noticeCount,0);assert.equal(restarted.unresolved.length,1);
  assert.equal((await recoveryNoticeView({...report,unresolved:[{...row,stateSignature:'changed'}]},local)).noticeCount,1);
  assert.equal(fleetHealth({generatedAt:new Date().toISOString(),recovery:restarted}).label,'Ingen pågående körning');
  assert.deepEqual(Object.keys(local.data).filter(k=>!k.includes(RECOVERY_NOTICES_KEY)),[]);
});
test('a stale notice request cannot acknowledge a new event',async()=>{
  const local=storage(),report={unresolved:[{workerId:'old',code:'NEW_EVENT'}]};
  await assert.rejects(acknowledgeRecoveryNotices(report,['obsolete-id'],local),/NOTICE_STALE/);
});
test('never-started orphan queues are informational; started or enabled ones require recovery',async()=>{
  for(const started of [false,true]) {
    const local=storage();let q=await loadMissionWorkQueue(1,local,{workerId:'old'});
    q.items=[{itemId:'i',goal:process().goal,status:'READY'}];q.enabled=started;
    await saveMissionWorkQueue(q,local);
    const report=await reconcileRestart({local,session:storage(),tabs:{query:async()=>[]},ensureBridge:async()=>assert.fail()});
    assert.equal(report.unresolved.length,started?1:0);assert.equal(report.savedQueues.length,started?0:1);
  }
});
test('retention preserves an absent mission owner and all unresolved effect evidence',async()=>{
  const p=process('old',false),local=storage({[MISSION_OWNERSHIP_KEY]:owned(),'eic.gf.process.worker.old':p});
  const result=await maintainStorageHeadroom(local,storage(),{force:true,targetRatio:0,triggerRatio:0});
  assert.equal(result.removedWorkers.length,0);assert.deepEqual(local.data['eic.gf.process.worker.old'],p);
});
test('live owner detection ignores stopped disabled workers and reused numeric tab/window IDs',async()=>{
  const rows=[{...process('a'),phase:'STOPPED'},process('b'),process('c')];
  const live=fn('liveMissionWorkerIds',background,{loadPersistedProcessInventory:async()=>({processes:rows}),
    workerBindingMatches:async(w,id)=>id!=='c',chrome:{storage:{local:{},session:{}},tabs:{get:async()=>({windowId:2})}},
    loadMissionWorkQueue:async()=>({enabled:false}),TERMINAL_PHASES:new Set(['STOPPED'])});
  assert.deepEqual(await live(),['b']);
});
test('recovery mutations reject content scripts and non-panel senders',()=>{
  const guard=fn('requireRecoveryPanel',background,{chrome:{runtime:{id:'ext',getURL:()=> 'chrome-extension://ext/sidepanel.html'}}});
  for(const sender of [{id:'other'},{id:'ext',url:'chrome-extension://ext/sidepanel.html',tab:{id:1}},
    {id:'ext',url:'https://chatgpt.com'}])assert.throws(()=>guard(sender),/OPERATOR_PANEL_REQUIRED/);
  assert.doesNotThrow(()=>guard({id:'ext',url:'chrome-extension://ext/sidepanel.html'}));
});
test('worker collision UI is informational and has no manual acknowledgement or conversation-open action',async()=>{
  assert.doesNotMatch(panel,/worker-reconciliation-form/);
  assert.doesNotMatch(panel,/Stäm av och tillåt övertagande/);
  assert.doesNotMatch(panel,/Öppna tidigare konversation/);
  assert.match(panel,/Worker-krockar kräver inte längre manuell avstämning/);
  assert.match(background,/MANUAL_WORKER_RECONCILIATION_REMOVED_AUTOMATIC_TAKEOVER/);
});
for(const occupied of ['empty','work'])test(`recovery adopts only a proven original turn into an ${occupied} replacement window`,async()=>{
  const p={...process('old',false),phase:'DETACHED',detached:{resumePhase:'WAITING'}};
  const local=storage({'eic.gf.process.worker.old':p}),session=storage();
  await restoreWorkerBinding(1,'old',session);
  const target=await ensureWorkerBinding(3,session);
  if(occupied==='work')local.data[`eic.gf.mission-work-queue.worker.${target.workerId}`]={workerId:target.workerId,items:[{goal:'Other mission'}]};
  const report=await reconcileRestart({local,session,ensureBridge:async()=>{},tabs:{
    query:async()=>[{id:30,windowId:3,url:p.lastManagedUrl}],
    sendMessage:async()=>({ok:true,state:{url:p.lastManagedUrl,lastUserId:'user'}})}});
  if(occupied==='work') {
    assert.equal(report.unresolved[0].code,'RECOVERY_WINDOW_ALREADY_OWNED');
    assert.equal((await getWorkerBinding(3,session)).workerId,target.workerId);
  } else {
    assert.equal(report.restored.length,1);
    assert.equal((await getWorkerBinding(3,session)).workerId,'old');
    const restored=local.data['eic.gf.process.worker.old'];
    assert.equal(restored.phase,'WAITING');assert.equal(restored.lastPrompt.dispatchedUserTurnId,'user');
    assert.equal(restored.pendingPrompt,null);assert.equal(restored.lastResponse,null);
  }
});
test('failed original-turn proof never steals even an empty replacement binding',async()=>{
  const p={...process('old',false),phase:'DETACHED',detached:{resumePhase:'WAITING'}};
  const local=storage({'eic.gf.process.worker.old':p}),session=storage(),target=await ensureWorkerBinding(3,session);
  const report=await reconcileRestart({local,session,ensureBridge:async()=>{},tabs:{query:async()=>[{id:30,windowId:3,url:p.lastManagedUrl}],
    sendMessage:async()=>({ok:true,state:{url:p.lastManagedUrl,lastUserId:'foreign'}})}});
  assert.equal(report.restored.length,0);assert.equal((await getWorkerBinding(3,session)).workerId,target.workerId);
});
test('backup carries mission history and registry, then imports paused without old takeover approvals',async()=>{
  const {createOperatorBackup,restoreOperatorBackup}=await import('../lib/operator-backup.mjs');
  const local=storage({[MISSION_OWNERSHIP_KEY]:owned()});
  await preserveMissionHistory(process('old',false),local);
  const backup=await createOperatorBackup(local,{version:'1.9.18'});
  const key=Object.keys(backup.data).find(k=>k.startsWith(MISSION_HISTORY_PREFIX));assert.ok(key);
  assert.ok(backup.data[MISSION_OWNERSHIP_KEY]);
  const restored=storage();await restoreOperatorBackup(backup,restored);
  assert.deepEqual(restored.data[MISSION_OWNERSHIP_KEY].resolutions,{});
  assert.equal(restored.data[key].process.storageRecoveryRequired,true);
  assert.equal(restored.data['eic.gf.safety.v1'].admissionPaused,true);
});
test('manual worker reconciliation endpoint is removed',()=>{
  assert.match(background,/MANUAL_WORKER_RECONCILIATION_REMOVED_AUTOMATIC_TAKEOVER/);
  assert.doesNotMatch(panel,/EIC_GF_WORKER_RECONCILE/);
});

