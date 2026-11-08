import {withReasoningDependencies} from './fixtures/reasoning-dependencies.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';

const root=process.env.GREENFIELD_LIFECYCLE_BASELINE
  ? pathToFileURL(resolve(process.env.GREENFIELD_LIFECYCLE_BASELINE)+'/') : new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
const load=p=>import(new URL('lib/'+p+'.mjs',root));
const [background,policy,observation,adapter]=await Promise.all([
  read('background.js'),read('lib/safety-policy.js'),read('lib/model-observation.js'),read('lib/thinking-control.js')]);
await import(new URL('lib/safety-policy.js',root));
const Safety=globalThis.GreenfieldSafetyPolicy;
const {PHASES}=await load('contracts');
const {advanceTabHealth,TAB_HEALTH}=await load('tab-health');
const {expectedAutonomousUserTurn}=await load('turn-causality');
const {reconcileSafetyHoldWithFreshProof}=await load('safety-hold-reconciliation');
const lifecycleModules=Object.assign({},...await Promise.all(['contracts','state','turn-causality',
  'response-stability','response-observation','response-contract','session-health','session-transport',
  'waiting-refresh','restart-recovery'].map(load)));
let quality={};
try {quality=await load('turn-quality');} catch(e) {if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const url='https://chatgpt.com/g/g-test-eic/c/quality-test';
const key='https://chatgpt.com/c/quality-test';
const clock=1793374400000;
const captured=JSON.parse(await readFile(new URL('fixtures/quality-quarantine-2026-10-30.json',import.meta.url),'utf8'));

export function worker() {
  const observed=clock-1500000;
  const proof={allowed:true,code:'UI_MODEL_COMPATIBLE',effort:'Extra hög',currentReceiptValid:true,highestEffortVerified:true,
    observedAtMs:observed,receiptExpiresAtMs:observed+60000,promptHash:'prompt-a',usageId:'run-a:1:5:prompt-a',
    highestEffort:{status:'VERIFIED',label:'Extra hög',url,verifiedAtMs:observed-1000,strategy:'ORDINAL_TARGET'}};
  return {processId:'process-a',runId:'run-a',workerId:'worker-a',phase:'WAITING',turn:5,sessionSeq:1,
    gptRoot:'https://chatgpt.com/g/g-test-eic',lastManagedUrl:url,pendingPrompt:null,
    lastPrompt:{hash:'prompt-a',usageId:proof.usageId,modelProof:proof,acknowledged:true,dispatchId:'dispatch-a',
      sentAt:new Date(observed-49).toISOString(),postedAtMs:observed+7000,dispatchedUserTurnId:'user-a',conversationKey:key},
    safety:{turnProof:structuredClone(proof),proof:{allowed:true,code:'UI_MODEL_COMPATIBLE'}}};
}
function page(level='Balanserad') {return {url,documentId:'new-document',lastUserId:'user-a',
  autonomousTurn:{resolvedUserTurnId:'user-a',resolvedBy:'USER_TURN_ID'},
  modelEvidence:{source:'CHATGPT_UI_CONTROLS_V2',observedAtMs:Date.now(),effortLabel:level,effortControlSeen:true}};}
function runtime(name,deps) {
  const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(background);assert.ok(match,name);
  const tail=background.slice(match.index),end=/^}\s*$/m.exec(tail);
  return Function(...Object.keys(withReasoningDependencies(deps)),tail.slice(0,end.index+end[0].length)+`;return ${name};`)(...Object.values(deps));
}
function observer() {
  const events=[];
  const fn=runtime('observeSafetyForProcess',{...quality,Safety,PHASES,reconcileSafetyHoldWithFreshProof,
    readSafety:async()=>({policy:Safety.defaults}),observeProviderQuota:async()=>{},probeProviderRecovery:async()=>{},
    shouldRememberManagedUrl:()=>true,jsonEqual:(a,b)=>JSON.stringify(a)===JSON.stringify(b),saveProcess:async()=>{},
    audit:async(...args)=>events.push(args)});
  return {fn,events};
}

test('new document with lower composer setting cannot retroactively quarantine a verified dispatch',async()=>{
  const p=worker(),before=structuredClone(p.lastPrompt);await observer().fn(p,{...page(),lastUserId:'',autonomousTurn:{}});
  assert.equal(p.safety.proof.allowed,false);assert.equal(p.safety.proof.code,'THINKING_EFFORT_TOO_LOW');
  assert.equal(p.safety.qualityIncident,null);assert.deepEqual(p.lastPrompt,before);
});
test('existing composer quarantine resolves from original receipt and exact same turn, even with current lower level',async()=>{
  const p=worker();p.safety.qualityIncident={code:'IN_FLIGHT_QUALITY_QUARANTINE',reason:'THINKING_EFFORT_TOO_LOW',turn:5,atMs:clock-1000};
  p.safety.hold={code:'IN_FLIGHT_QUALITY_QUARANTINE',retryAtMs:clock+30000};
  await observer().fn(p,page());assert.equal(p.safety.qualityIncident,null);assert.equal(p.safety.hold,null);
  assert.equal(p.safety.qualityResolutions.length,1);assert.equal(p.safety.qualityResolutions[0].dispatchId,'dispatch-a');
});
test('recovery action spacing survives changed conditions and a transient healthy observation',()=>{
  let state=advanceTabHealth(null,'BRIDGE_UNRESPONSIVE',{now:100000}).state;
  assert.equal(advanceTabHealth(state,'BRIDGE_MISSING',{now:107500}).action,'');
  state=advanceTabHealth(state,'',{now:110000}).state;
  assert.equal(advanceTabHealth(state,'BRIDGE_MISSING',{now:120000}).action,'');
  assert.equal(advanceTabHealth(state,'BRIDGE_MISSING',{now:100000+TAB_HEALTH.STEP_SETTLE_MS}).action,'REINJECT_BRIDGE');
});
test('detached SENDING binds the pending dispatch, not the prior completed user',()=>{
  const p=worker();p.phase='DETACHED';p.detached={resumePhase:'SENDING'};
  p.pendingPrompt={hash:'next',dispatch:{materializedUserTurnId:'user-next'}};
  assert.equal(expectedAutonomousUserTurn(p).id,'user-next');
});
function domFixture(extra='') {
  const dom=new JSDOM(`<form><textarea></textarea><button type="button" data-composer-navigation-target="reasoning" aria-expanded="false">Extra hög</button>${extra}</form>`,{url,runScripts:'outside-only'});
  const w=dom.window;w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:24});
  w.eval(policy);w.eval(observation);return dom;
}
test('unrelated Standard tool button does not overrule the identified reasoning control',()=>{
  const dom=domFixture('<button type="button">Standard</button>');try{
    const v=dom.window.GreenfieldModelObservation.observe();assert.equal(v.ambiguous,false);assert.equal(v.effortLabel,'Extra hög');
  }finally{dom.window.close();}
});
test('hidden and inert ancestor controls cannot create model ambiguity',()=>{
  for(const attr of ['aria-hidden="true"','inert','hidden']){
    const dom=domFixture(`<div ${attr}><button data-composer-navigation-target="reasoning">Balanserad</button></div>`);try{
      assert.equal(dom.window.GreenfieldModelObservation.observe().ambiguous,false,attr);
    }finally{dom.window.close();}
  }
});
test('temporary options failure retries on the same DOM after cooldown without reload',async()=>{
  const dom=domFixture();const w=dom.window,d=w.document;let now=clock,opens=0,ready=false;
  w.Date.now=()=>now;w.setTimeout=(fn,ms=0)=>{queueMicrotask(()=>{now+=ms;fn();});return 1;};
  const trigger=d.querySelector('button');trigger.id='reasoning';trigger.setAttribute('aria-controls','menu');
  const close=()=>{d.getElementById('menu')?.remove();trigger.setAttribute('aria-expanded','false');};
  trigger.addEventListener('click',()=>{
    if(d.getElementById('menu')){close();return;}opens++;trigger.setAttribute('aria-expanded','true');
    const menu=d.createElement('div');menu.id='menu';menu.setAttribute('role','menu');menu.setAttribute('aria-labelledby','reasoning');
    if(ready){const item=d.createElement('button');item.type='button';item.setAttribute('role','menuitemradio');item.setAttribute('aria-checked','true');item.textContent='Extra hög';item.addEventListener('click',close);menu.append(item);}d.body.append(menu);
  });
  d.addEventListener('keydown',e=>{if(e.key==='Escape')close();});w.eval(adapter);
  const ensure=()=>w.GreenfieldThinkingControl.ensureHighest({guard:async()=>({ok:true})});
  try{
    const first=await ensure();assert.equal(first.ok,false);assert.ok(first.retryAtMs>now,JSON.stringify(first));
    const count=opens;ready=true;assert.equal((await ensure()).repeated,true);assert.equal(opens,count);
    now=first.retryAtMs+1;assert.equal((await ensure()).ok,true);assert.ok(opens>count);
  }finally{w.GreenfieldThinkingControl.dispose();dom.window.close();}
});

test('historical receipt remains valid after TTL but cannot authorize a new send',()=>{
  const p=worker();assert.equal(quality.dispatchedTurnQuality(p).allowed,true);
  const evidence={...page('Extra hög').modelEvidence,highestEffort:p.lastPrompt.modelProof.highestEffort};
  assert.equal(Safety.evaluateModel(evidence,Safety.defaults,{url,gptRoot:p.gptRoot,requireHighestEffort:true}).allowed,false);
});
const invalidReceipts={
  hash:p=>p.lastPrompt.modelProof.promptHash='other',
  run:p=>p.runId='other', session:p=>p.sessionSeq++, turn:p=>p.turn++,
  transport:p=>p.lastPrompt.transportId='other',
  usage:p=>p.lastPrompt.usageId='other', proofUsage:p=>p.lastPrompt.modelProof.usageId='other',
  dispatch:p=>p.lastPrompt.modelProof.dispatchId='other',
  missing:p=>{delete p.lastPrompt.modelProof;delete p.safety.turnProof;},
  primaryDenied:p=>p.lastPrompt.modelProof.allowed=false,
  unverified:p=>p.lastPrompt.modelProof.highestEffortVerified=false,
  invalid:p=>p.lastPrompt.modelProof.currentReceiptValid=false,
  reason:p=>p.lastPrompt.modelProof.receiptInvalidReason='CHANGED',
  lower:p=>p.lastPrompt.modelProof.effort='Hög',
  pro:p=>p.lastPrompt.modelProof.highestEffort.label='Pro',
  unknownStrategy:p=>p.lastPrompt.modelProof.highestEffort.strategy='GUESS',
  future:p=>p.lastPrompt.modelProof.highestEffort.verifiedAtMs+=3000,
  staleAtDispatch:p=>p.lastPrompt.modelProof.highestEffort.verifiedAtMs-=60001,
  expiredAtDispatch:p=>p.lastPrompt.modelProof.receiptExpiresAtMs=p.lastPrompt.modelProof.observedAtMs-1,
  timestamp:p=>p.lastPrompt.modelProof.observedAtMs=NaN,
  foreignReceipt:p=>p.lastPrompt.modelProof.highestEffort.url='https://chatgpt.com/c/other'
};
for(const [name,alter] of Object.entries(invalidReceipts))test(`original receipt rejects ${name} even when current UI is correct`,async()=>{
  const p=worker();alter(p);p.safety.qualityIncident={code:'IN_FLIGHT_QUALITY_QUARANTINE',reason:'THINKING_EFFORT_TOO_LOW',turn:5};
  assert.equal(quality.dispatchedTurnQuality(p).allowed,false);
  await observer().fn(p,page('Extra hög'));assert.ok(p.safety.qualityIncident);
});
test('matching legacy turnProof fallback and distinct short transport identity are supported',()=>{
  const p=worker();delete p.lastPrompt.modelProof;assert.equal(quality.dispatchedTurnQuality(p).allowed,true);
  p.lastPrompt.transportId='continue-2';p.lastPrompt.usageId+=':continue-2';
  p.safety.turnProof.usageId=p.lastPrompt.usageId;assert.equal(quality.dispatchedTurnQuality(p).allowed,true);
});
const unprovenRecovery={
  wrongConversation:(p,v)=>v.url='https://chatgpt.com/c/other',
  partialHydration:(p,v)=>{v.lastUserId='';v.autonomousTurn={};},
  foreignUser:(p,v)=>v.autonomousTurn.resolvedUserTurnId='other',
  ordinalOnly:p=>delete p.lastPrompt.dispatchedUserTurnId,
  unacknowledged:p=>p.lastPrompt.acknowledged=false,
  missingDispatch:p=>delete p.lastPrompt.dispatchId,
  otherTurnIncident:p=>p.safety.qualityIncident.turn=4,
  providerFallback:p=>p.safety.qualityIncident.reason='PROVIDER_QUOTA_OR_FALLBACK',
  directResponseIncident:p=>p.safety.qualityIncident.source='ASSISTANT_RESPONSE',
  unknownIncident:p=>p.safety.qualityIncident.code='IN_FLIGHT_MODEL_UNVERIFIED',
  sending:p=>p.phase='SENDING', storage:p=>p.storageRecoveryRequired=true,
  hardStop:p=>p.greenfieldControl={hardStop:true}
};
for(const [name,alter] of Object.entries(unprovenRecovery))test(`quarantine reconciliation refuses ${name}`,()=>{
  const p=worker(),v=page();p.safety.qualityIncident={code:'IN_FLIGHT_QUALITY_QUARANTINE',reason:'THINKING_EFFORT_TOO_LOW',turn:5};
  alter(p,v);const before=structuredClone(p);
  assert.ok(quality.reconcileTurnQuality(p,v).qualityIncident);assert.deepEqual(p,before);
});
test('reconciliation preserves unrelated storage/operator/effect holds and bounds history',()=>{
  for(const code of ['STORAGE_RECOVERY_REQUIRES_REVIEW','ADMISSION_PAUSED','DISPATCH_EFFECT_UNRESOLVED','MISSION_OWNED_BY_OTHER_WORKER']){
    const p=worker();p.safety.qualityIncident={code:'IN_FLIGHT_QUALITY_QUARANTINE',reason:'THINKING_EFFORT_TOO_LOW',turn:5};
    p.safety.hold={code};p.safety.qualityResolutions=Array.from({length:8},(_,atMs)=>({atMs}));
    const r=quality.reconcileTurnQuality(p,page());assert.equal(r.qualityIncident,null);assert.deepEqual(r.hold,{code});assert.equal(r.qualityResolutions.length,8);
  }
});
test('exact supplied diagnostic metadata unlocks only when its original user turn is observed again',()=>{
  const p=structuredClone(captured.process),t=captured.lastTrace.detail;
  assert.equal(quality.dispatchedTurnQuality(p).allowed,true);
  const v={url:p.lastManagedUrl,documentId:t.documentId,lastUserId:t.pageLastUserId,
    autonomousTurn:{resolvedUserTurnId:t.resolvedUserTurnId,resolvedBy:t.resolvedBy}};
  const before=structuredClone(p.lastPrompt),r=quality.reconcileTurnQuality(p,v);
  assert.equal(r.qualityIncident,null);assert.equal(r.hold,null);assert.deepEqual(p.lastPrompt,before);
  assert.equal(r.resolution.userTurnId,t.resolvedUserTurnId);
});

test('real dispatcher reconciles, waits for stable causal response, then captures without sending or rotating',async()=>{
  let current=structuredClone(captured.process),now=clock,commits=0,release=0;
  current.safety.hold.retryAtMs=now-1;
  const original=structuredClone(current.lastPrompt);
  const t=captured.lastTrace.detail;
  // The diagnostics omit response bytes. Replay exact causal metadata with
  // explicit synthetic content; do not pretend this is the production answer.
  const text='Synthetic replay: the bounded action completed and its owner readback was verified.';
  const v={...page(),url:current.lastManagedUrl,documentId:t.documentId,lastUserId:t.pageLastUserId,
    lastAssistantId:t.assistantId,assistantHash:'synthetic-hash',assistantCount:t.pageAssistantCount,userCount:t.pageUserCount,
    autonomousTurn:{resolvedUserTurnId:t.resolvedUserTurnId,resolvedBy:t.resolvedBy,assistantFound:true,
      assistantId:t.assistantId,assistantOwnerKind:t.ownerKind,assistantOwnerTrusted:t.ownerTrusted,assistantReplicaCount:1,
      assistantHash:'synthetic-hash',assistantText:text,assistantTextLength:text.length,assistantGenerating:false,
      assistantSignals:{visibilityState:'visible'}}};
  class Clock extends Date {static now(){return now;}}
  const pass=async p=>({handled:false,process:p});
  const observed=observer();
  const deps={...lifecycleModules,...quality,Date:Clock,PHASES,runtimeReady:Promise.resolve(),runtimeFault:'',
    findProcessById:async()=>current,missionOwnershipKey:()=>'',chrome:{tabs:{get:async()=>({})}},
    enforceManagedEicSurface:async()=>null,readSafety:async()=>({admissionPaused:true}),
    syncSafetyRetryAlarm:async()=>{},scheduleFast:()=>{},acceptPendingMissionDelegationForWorker:async p=>p,
    audit:async()=>{},tabState:async p=>{await observed.fn(p,v);return v;},
    recordResponseObservation:async p=>p,maybeRecoverPageHealth:pass,maybeHandleLostConversation:pass,
    maybeHandleProviderNotice:pass,maybeHandleDeliveryTimeout:pass,
    maybeReadoptStaleTurnCapacity:async p=>p,observeProviderTransportNotices:async p=>p,
    maybeResetStaleSessionCounter:async p=>p,maybeEscalateWaitingRefresh:pass,
    saveObserved:async(p,patch)=>current={...p,...patch},text:v=>v,nowIso:()=>new Date(now).toISOString(),
    advanceResponseCandidate:(c,o)=>lifecycleModules.advanceResponseCandidate(c,o,{now}),
    commitTransition:async(p,phase,patch)=>{commits++;return current={...p,...patch,phase};},
    holdForSafety:async()=>assert.fail('unexpected hold'),recordTurnMetrics:async()=>{},
    releaseSchedulerTurn:async()=>{release++;},
    tickSending:async()=>assert.fail('recovery must never dispatch'),tickRotating:async()=>assert.fail('must not rotate')};
  deps.tracedResponseObservation=runtime('tracedResponseObservation',deps);
  deps.hasCanonicalResponseControl=runtime('hasCanonicalResponseControl',deps);
  deps.protocolDisposition=runtime('protocolDisposition',deps);
  deps.tickWaiting=runtime('tickWaiting',deps);
  const tick=runtime('tickProcess',deps);
  await tick(current.processId);assert.equal(current.safety.qualityIncident,null);assert.equal(commits,0);
  // Serialize checkpoint to reproduce MV3 suspension between reconciliation
  // and processing; no in-memory permission is needed to complete recovery.
  current=JSON.parse(JSON.stringify(current));
  await tick(current.processId);assert.equal(current.phase,'WAITING');now+=1500;
  await tick(current.processId);assert.equal(current.phase,'WAITING');now+=1500;
  await tick(current.processId);assert.equal(current.phase,'ANALYZING');
  assert.equal(commits,1);assert.equal(release,1);assert.deepEqual(current.lastPrompt,original);
  assert.equal(current.lastResponse.text,text);assert.equal(current.lastResponse.observation.causalMatch,true);
  assert.equal(current.safety.proof.allowed,false,'current lower composer remains ineligible for next send');
});

test('real WAITING rejects an unbound original receipt before consuming a response',async()=>{
  const p=worker();p.lastPrompt.modelProof.promptHash='foreign';
  const pass=async p=>({handled:false,process:p});let reason='';
  const tick=runtime('tickWaiting',{...quality,tabState:async()=>page('Extra hög'),
    maybeHandleLostConversation:pass,maybeRecoverPageHealth:pass,maybeHandleProviderNotice:pass,
    maybeReadoptStaleTurnCapacity:async p=>p,observeProviderTransportNotices:async p=>p,
    recordResponseObservation:async p=>p,holdForSafety:async(p,r)=>{reason=r.code;return p;},
    maybeHandleDeliveryTimeout:async()=>assert.fail('must not consume')});
  await tick(p);assert.equal(reason,'IN_FLIGHT_MODEL_UNVERIFIED');assert.equal(p.safety.qualityIncident.source,'DISPATCH_RECEIPT');
});

test('multiple identified reasoning controls with conflicting levels remain ambiguous',()=>{
  const dom=domFixture('<button data-composer-navigation-target="reasoning">Hög</button>');try{
    assert.equal(dom.window.GreenfieldModelObservation.observe().ambiguous,true);
  }finally{dom.window.close();}
});
