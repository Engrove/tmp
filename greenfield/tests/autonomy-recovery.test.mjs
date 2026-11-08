import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {claimMissionOwnership,readMissionOwnership,withMissionOwner,fenceSupersededQueue,MISSION_OWNERSHIP_KEY} from '../lib/mission-ownership.mjs';
import {writeCheckpoint,readCheckpoint,checkpointKeys} from '../lib/durable-checkpoint.mjs';
import {createProcess,transitionProcess} from '../lib/state.mjs';
import {reconcileRestart,conversationKey} from '../lib/restart-recovery.mjs';
import {PHASES} from '../lib/contracts.mjs';
import {createWaitingRefreshState} from '../lib/waiting-refresh.mjs';
import {responseContentAdmission,initializationAcknowledged,advanceResponseCandidate} from '../lib/response-stability.mjs';
import {responseStructuralCompleteness} from '../lib/response-observation.mjs';
import {prepareSessionInitialization,expectedInitializationAck,legacyInitializationUpgradeAllowed} from '../lib/session-transport.mjs';
import {queueBoundaryAnalysisDecision} from '../lib/queue-boundary.mjs';
import {appendIncident,readIncidentLog,INCIDENT_LOG_MAX_ROWS,INCIDENT_LOG_CRITICAL_RESERVE} from '../lib/incident-log.mjs';

function storage(seed={}) {
  const data=structuredClone(seed);return {data,
    async get(keys){if(keys==null)return structuredClone(data);return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]));},
    async set(value){Object.assign(data,structuredClone(value));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};
}
function worker(id,settled=true) {
  return {...createProcess({workerId:id,windowId:id==='old'?1:2,tabId:2,goal:'GF-4.38.1002\nRead fresh owner state.',initialPrompt:'work'}),
    phase:'ANALYZING',pendingPrompt:null,lastManagedUrl:'https://chatgpt.com/c/source',
    lastPrompt:{hash:'ph',text:'work',acknowledged:true,dispatchedUserTurnId:'u'},
    lastResponse:settled?{hash:'rh',text:'Checkpoint verified.',observation:{pairedUserTurnId:'u'}}:null};
}
test('takeover requires settled effects, persists ownership, fences old writes and preserves history',async()=>{
  const old=worker('old'),fresh=worker('new'),local=storage({'eic.gf.process.worker.old':old});
  const result=await claimMissionOwnership(fresh,{storage:local,allowTakeover:true});assert.equal(result.allowed,true);
  assert.equal(result.owner.epoch,1);assert.deepEqual(local.data['eic.gf.process.worker.old'],old);
  let effects=0;await assert.rejects(withMissionOwner(old,local,async()=>effects++),/MISSION_OWNERSHIP_SUPERSEDED/);assert.equal(effects,0);
  await withMissionOwner(fresh,local,async()=>effects++);assert.equal(effects,1);
  assert.equal((await claimMissionOwnership(old,{storage:local,allowTakeover:true})).allowed,false);
  const q=fenceSupersededQueue({workerId:'old',activeItemId:'i',items:[{itemId:'i',goal:old.goal,status:'ACTIVE',processSnapshot:old}]},await readMissionOwnership(local));
  assert.equal(q.items[0].status,'STOPPED');assert.equal(q.activeItemId,'');assert.deepEqual(q.items[0].processSnapshot,old);
  const unclaimed=fenceSupersededQueue({...q,workerId:'future',items:[{itemId:'i',goal:old.goal,status:'READY'}]},await readMissionOwnership(local));assert.equal(unclaimed.items[0].status,'READY');
});
for(const kind of ['unanswered','unknown-dispatch','shell','unpublished-checkpoint'])test(`uncertain prior effect requires a fresh quarantine prompt before ownership claim: ${kind}`,async()=>{
  const old=worker('old'),fresh=worker('new'),local=storage();
  if(kind==='unanswered')old.lastResponse=null;
  if(kind==='unknown-dispatch')old.pendingPrompt={dispatch:{effectPossible:null}};
  if(kind==='shell')old.lastResponse.text='ChatGPT sa:';
  await writeCheckpoint('eic.gf.process.worker.old',old,local);
  if(kind==='unpublished-checkpoint')delete local.data['eic.gf.process.worker.old'];
  const result=await claimMissionOwnership(fresh,{storage:local,allowTakeover:true});
  assert.equal(result.allowed,false);
  assert.equal(result.code,kind==='unpublished-checkpoint'?'MISSION_PRIOR_CHECKPOINT_UNRECONCILED':'MISSION_PRIOR_EFFECT_QUARANTINE_REQUIRED');
});
test('live settled owner does not block a new session; old process is fenced',async()=>{
  const old=worker('old'),fresh=worker('new'),local=storage();
  await writeCheckpoint('eic.gf.process.worker.old',old,local);
  const result=await claimMissionOwnership(fresh,{storage:local,allowTakeover:true,liveWorkerIds:[{workerId:'old',processId:old.processId}]});
  assert.equal(result.allowed,true);
  let effects=0;await assert.rejects(withMissionOwner(old,local,async()=>effects++),/MISSION_OWNERSHIP_SUPERSEDED/);
  assert.equal(effects,0);
});
test('parked mission is considered even after its old worker switches to another GFW',async()=>{
  const old=worker('old'),fresh=worker('new'),local=storage({'eic.gf.mission-work-queue.worker.old':{workerId:'old',items:[{goal:old.goal,processSnapshot:old,status:'READY'}]},
    'eic.gf.process.worker.old':{...old,goal:'GF-1.2.1022\nOther mission',lastResponse:null}});
  assert.equal((await claimMissionOwnership(fresh,{storage:local,allowTakeover:true,liveWorkerIds:['old']})).allowed,true,
    'a parked snapshot with a settled effect does not require an operator acknowledgement');
});
test('concurrent claims cannot grant the same mission to two workers',async()=>{
  const local=storage();
  const results=await Promise.all(['one','two'].map(id=>claimMissionOwnership(worker(id),{storage:local,allowTakeover:true})));
  assert.equal(results.filter(r=>r.allowed).length,1);
});
test('in-flight authorized send is serialized, then new owner takes over and fences the old process',async()=>{
  const local=storage(),a=worker('old'),b=worker('new');
  await claimMissionOwnership(a,{storage:local});
  await writeCheckpoint('eic.gf.process.worker.old',a,local);
  let release,started;const running=new Promise(r=>{started=r;});
  const send=withMissionOwner(a,local,async()=>{started();await new Promise(r=>{release=r;});return 'sent';});
  await running;let finished=false;
  const takeover=claimMissionOwnership(b,{storage:local,allowTakeover:true,liveWorkerIds:[{workerId:'old',processId:a.processId}]}).then(r=>{finished=true;return r;});
  await new Promise(r=>setImmediate(r));assert.equal(finished,false);release();assert.equal(await send,'sent');
  assert.equal((await takeover).allowed,true);
  await assert.rejects(withMissionOwner(a,local,async()=>assert.fail('old generation must be fenced')),/SUPERSEDED/);
});
test('interrupted ownership publication is quarantined and never grants stale send permission',async()=>{
  const local=storage();await claimMissionOwnership(worker('old'),{storage:local});
  const receipt=await readCheckpoint(MISSION_OWNERSHIP_KEY,local);assert.equal(receipt.health,'VERIFIED');
  delete local.data[MISSION_OWNERSHIP_KEY];
  assert.equal((await readCheckpoint(MISSION_OWNERSHIP_KEY,local)).health,'RECOVERY_REQUIRED');
  await assert.rejects(withMissionOwner(worker('old'),local,async()=>{assert.fail('must not send');}),/MISSION_OWNERSHIP_RECOVERY_REQUIRED/);
  assert.ok(checkpointKeys(MISSION_OWNERSHIP_KEY).some(k=>local.data[k]));
});
test('restart reports a superseded worker as preserved history instead of reopening its missing tab',async()=>{
  const old=worker('old'),local=storage({'eic.gf.process.worker.old':old}),session=storage();
  await claimMissionOwnership(worker('new'),{storage:local,allowTakeover:true});
  const report=await reconcileRestart({local,session,tabs:{query:async()=>[]},ensureBridge:async()=>assert.fail('superseded tab must not be reopened')});
  assert.equal(report.unresolved.length,0);assert.equal(report.superseded[0].workerId,'old');assert.deepEqual(local.data['eic.gf.process.worker.old'],old);
});

const background=await readFile(new URL('../background.js',import.meta.url),'utf8');
function functionSource(name,source=background) {const start=source.indexOf(`async function ${name}(`);assert.ok(start>=0,name);const tail=source.slice(start);const end=/^}\s*$/m.exec(tail);return tail.slice(0,end.index+end[0].length);}
function repairRuntime({stopAt='',proof=true}={}) {
  const sourceUrl='https://chatgpt.com/c/source';let current={...worker('old'),phase:PHASES.ROTATING,lastResponse:null,
    responseRepair:{state:'NAVIGATE',sourceUrl,sourcePromptHash:'ph',invalidResponseHash:'bad'}};
  let tab={id:2,windowId:1,url:'https://chatgpt.com/c/other'},updates=0,writes=0,slots=0;
  const deps={PHASES,conversationKey,createWaitingRefreshState,nowIso:()=>new Date().toISOString(),scheduleFast(){},recordIncident:async()=>{},
    chrome:{tabs:{get:async()=>tab,update:async(id,value)=>{updates++;tab={...tab,...value};if(stopAt==='navigation')current={...current,phase:PHASES.STOPPED};}}},
    saveObserved:async(p,patch)=>{writes++;current={...p,...patch};return current;},
    transportTransitionBoundary:async p=>({blocked:current.phase!==p.phase,process:current}),
    commitTransition:async(p,phase,patch,options)=>{if(stopAt==='commit')current={...current,phase:PHASES.STOPPED};const boundary=await options.beforeSave();if(boundary.blocked)return boundary.process;current=transitionProcess(p,phase,patch);return current;},
    tabState:async()=>({url:sourceUrl}),autonomousUserTurnProof:()=>({ok:proof}),
    holdForSafety:async(p,d)=>({...p,lastError:d}),handleDetached:async(p,e)=>({...p,lastError:e}),
    adoptSchedulerTurnForObservedEffect:async()=>slots++};
  const tick=Function(...Object.keys(deps),functionSource('tickResponseRepair')+'; return tickResponseRepair;')(...Object.values(deps));
  return {tick:async()=>{const next=await tick(current);current=next;return next;},get current(){return current;},counts:()=>({updates,writes,slots})};
}
test('runtime repair navigates to the original turn, then observes WAITING without dispatch',async()=>{
  const f=repairRuntime();assert.equal((await f.tick()).responseRepair.state,'OBSERVE');
  const next=await f.tick();assert.equal(next.phase,PHASES.WAITING);assert.equal(next.responseRepair.state,'WAITING_FOR_ORIGINAL_RESPONSE');
  assert.equal(next.pendingPrompt,null);assert.deepEqual(f.counts(),{updates:1,writes:2,slots:1});
});
for(const stopAt of ['navigation','commit'])test(`STOP during repair ${stopAt} cannot be overwritten or re-admit capacity`,async()=>{
  const f=repairRuntime({stopAt});await f.tick();if(stopAt==='commit')await f.tick();assert.equal(f.current.phase,PHASES.STOPPED);assert.equal(f.counts().slots,0);
  if(stopAt==='navigation')assert.equal(f.counts().writes,1);
});
test('repair waits for a still loading original user turn without sending or declaring completion',async()=>{
  const f=repairRuntime({proof:false});await f.tick();const p=await f.tick();assert.equal(p.phase,PHASES.ROTATING);assert.equal(p.lastResponse,null);assert.equal(f.counts().slots,0);
});
test('both background and offscreen reject UI-only captures before model creation or task effects',async()=>{
  const offscreen=await readFile(new URL('../offscreen.js',import.meta.url),'utf8');
  for(const [name,source,arg] of [['runAnalysis',background,{lastResponse:{text:'ChatGPT sa:'}}],['analyzePipeline',offscreen,{responseExcerpt:'ChatGPT sa:'}]]) {
    const run=Function('responseContentAdmission',functionSource(name,source)+`;return ${name};`)(responseContentAdmission);
    await assert.rejects(run(arg),/ANALYSIS_RESPONSE_INCOMPLETE/);
  }
});
test('queue boundary retains analysis for absent control, terminal decisions and Nano tasks',()=>{
  const base={queueManaged:true,controlValid:true,targetDisposition:'CONTINUE',interactionCount:4,maxInteractions:5};
  assert.equal(queueBoundaryAnalysisDecision(base).action,'SKIP');
  for(const patch of [{controlValid:false},{targetDisposition:'DONE'},{targetDisposition:'BLOCKED'},{sessionAction:'STOP_PROCESS'},{completionRequested:true},{nanoTaskRequested:true}])assert.equal(queueBoundaryAnalysisDecision({...base,...patch}).action,'ANALYZE');
});
for(const text of ['ChatGPT sa:','Work is complete.','ACK from a different turn','ACK'])test(`initialization runtime releases only current hash: ${text}`,async()=>{
  let current={...worker('old'),phase:PHASES.WAITING,responseCandidate:null,turn:10};
  const prepared=await prepareSessionInitialization(current,{hash:'work',text:'actual work'},{url:'https://chatgpt.com/c/source'});
  current={...current,sessionInitialization:prepared.sessionInitialization,lastPrompt:prepared.pendingPrompt};
  const hash=prepared.sessionInitialization.acknowledgement.hash;
  let clock=0,releases=0,escalations=0;
  const different=text==='ACK from a different turn';
  const body=different || text==='ACK'?hash:text;
  const observation={documentId:'doc',lastAssistantId:'assistant',lastAssistantOwnerTrusted:true,lastAssistantOwnerKind:'CONVERSATION_TURN',assistantHash:'hash',assistantCount:1,
    expectedUserTurnId:'u',pairedUserTurnId:different?'other':'u',pairedUserResolvedBy:'USER_TURN_ID',assistantText:body,assistantTextLength:body.length,generating:false,signals:{visibilityState:'visible'}};
  const deps={PHASES,conversationKey,initializationAcknowledged,responseStructuralCompleteness,DELIVERY_CONTINUATION:'DELIVERY_CONTINUATION',FAST_RECHECK_MS:100,
    prepareSessionInitialization,expectedInitializationAck,legacyInitializationUpgradeAllowed,
    nowIso:()=>new Date().toISOString(),scheduleFast(){},providerTransportPending:()=>false,
    autonomousResponseObservation:()=>({ready:true,observation}),advanceResponseCandidate:(c,o)=>advanceResponseCandidate(c,o,{now:clock}),
    saveObserved:async(p,patch)=>current={...p,...patch},transportTransitionBoundary:async p=>({blocked:false,process:p}),
    recordResponseObservation:async p=>p,maybeEscalateWaitingRefresh:async p=>{escalations++;return {handled:false,process:p};},
    commitTransition:async(p,phase,patch)=>current=transitionProcess(p,phase,patch),releaseSchedulerTurn:async()=>releases++,holdForSafety:async p=>p};
  const tick=Function(...Object.keys(deps),functionSource('tickSessionInitialization')+';return tickSessionInitialization;')(...Object.values(deps));
  for(clock of [0,1600,3135])current=await tick(current,{url:'https://chatgpt.com/c/source',generating:false});
  assert.equal(current.phase,text==='ACK'?PHASES.SENDING:PHASES.WAITING);
  assert.equal(releases,text==='ACK' || text==='Work is complete.'?1:0);assert.equal(current.turn,10);
  if(text!=='ACK')assert.ok(escalations>0,'incomplete initialization remains eligible for recovery until a stable answer establishes an explicit acknowledgement wait');
});
test('critical incident history survives routine metric churn with bounded size and stable event IDs',async()=>{
  const local=storage(),first=await appendIncident({kind:'SESSION_ROTATION',code:'KNOWN',appVersion:'1.9.14'},local);
  for(let n=0;n<INCIDENT_LOG_MAX_ROWS+5;n++)await appendIncident({kind:'TURN_METRICS',atMs:n+1},local);
  const log=await readIncidentLog(local);assert.ok(log.rows.some(r=>r.eventId===first.eventId&&r.appVersion==='1.9.14'));
  assert.ok(log.rows.length<=INCIDENT_LOG_MAX_ROWS+INCIDENT_LOG_CRITICAL_RESERVE);assert.equal(log.droppedRows,5);
  assert.equal(new Set(log.rows.map(r=>r.eventId)).size,log.rows.length);assert.equal((await readIncidentLog(local)).rows[0].eventId,first.eventId);
});
