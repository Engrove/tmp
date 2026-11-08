import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {refreshModelEvidence} from '../lib/model-evidence-refresh.mjs';
import {APP_VERSION,PHASES} from '../lib/contracts.mjs';
import {functionSource,reasoningUI,levels,url,gptRoot} from './fixtures/queue-reasoning-ui.mjs';
import {withReasoningDependencies} from './fixtures/reasoning-dependencies.mjs';
import {ownerToken,isCurrentToken} from '../lib/state.mjs';

const root=process.env.GREENFIELD_STALE_BASELINE
  ? pathToFileURL(process.env.GREENFIELD_STALE_BASELINE.replace(/\/$/,'')+'/') : new URL('../',import.meta.url);
const source=await readFile(new URL('background.js',root),'utf8');
const content=await readFile(new URL('content.js',root),'utf8');
const {reconcileSafetyHoldWithFreshProof}=await import(new URL('lib/safety-hold-reconciliation.mjs',root));
const Safety=globalThis.GreenfieldSafetyPolicy;
const clock=()=>({value:Date.now()});
function evidence(c,patch={}) {
  return {source:'CHATGPT_UI_CONTROLS_V2',observedAtMs:c.value,modelLabel:'',effortLabel:'Extra hög',
    reasoningControlSeen:true,highestEffort:{status:'VERIFIED',url,verifiedAtMs:c.value,
      strategy:'ORDINAL_TARGET',reasoningLevel:'xhigh',label:'Extra hög'},...patch};
}
const page=(c,patch={})=>({documentId:'document',url,composerEmpty:true,composerReady:true,
  generating:false,modelEvidence:evidence(c),...patch});
function fixture({delay=0,read,stopped=false,policy={...Safety.defaults,reasoningLevel:'xhigh'},budget={allowed:true}}={}) {
  const c=clock(),counts={reads:0,holds:0,maintenance:0,selections:0};
  const p={processId:'process',workerId:'worker',generation:1,windowId:1,tabId:2,phase:PHASES.SENDING,gptRoot,
    safety:{},pendingPrompt:{text:'work',hash:'hash',dispatch:{operationId:'dispatch',effectPossible:false}}};
  const S={...Safety,evaluateModel:(e,p,o)=>Safety.evaluateModel(e,p,{...o,now:c.value})};
  const deps={Date:class extends Date{static now(){return c.value;}},Safety:S,PHASES,APP_VERSION,refreshModelEvidence,
    ownerToken,isCurrentToken,runtimeFault:'',chrome:{runtime:{id:'fixture'},storage:{local:{}}},
    readSafety:async()=>{c.value+=delay;return {policy,entries:[{id:'usage'}]};},
    reasoningPolicyForProcess:async()=>policy,
    transportTransitionBoundary:async()=>({blocked:stopped,process:stopped?{...p,phase:PHASES.STOPPED}:p}),
    holdForSafety:async(p,decision)=>{counts.holds++;return {...p,safety:{hold:decision}};},
    providerTransportPending:()=>false,sha256Hex:async()=>'hash',normalizeText:s=>s,
    budgetDecision:()=>budget,usageIdentity:()=>'usage',audit:async()=>{},
    tabState:async()=>page(c),
    maintainLocalStorage:async()=>{counts.maintenance++;c.value+=20000;},
    loadProcessForWindow:async()=>p,reasoningAuthorizationMatches:()=>true,
    authorizeUsageSend:async()=>({allowed:true,policy}),isInitializationPrompt:()=>false,
    bridgeMessage:async(tab,message)=>{
      assert.equal(tab,p.tabId);
      if(message.type==='EIC_GF_GET_MODEL_EVIDENCE'){
        counts.reads++;return read ? read({c,message,p}) : {ok:true,bridgeVersion:APP_VERSION,...page(c)};
      }
      assert.equal(message.type,'EIC_GF_ENSURE_HIGHEST_THINKING');counts.selections++;
      return {ok:true,proof:evidence(c).highestEffort};
    }
  };
  withReasoningDependencies(deps);
  const bind=name=>Function(...Object.keys(deps),functionSource(name,source)+';return '+name)(...Object.values(deps));
  return {c,p,counts,deps,bind};
}

test('fresh compatible proof clears stale hold even when an earlier observation already replaced prior proof',()=>{
  const c=clock(),proof=Safety.evaluateModel(evidence(c),Safety.defaults,{url,gptRoot,now:c.value});
  assert.equal(proof.code,'UI_MODEL_COMPATIBLE');
  const prior={hold:{code:'MODEL_EVIDENCE_STALE'},proof};
  assert.equal(reconcileSafetyHoldWithFreshProof(prior,proof).hold,null);
  assert.equal(reconcileSafetyHoldWithFreshProof(prior,proof,{code:'QUALITY'}).cleared,false);
  assert.equal(reconcileSafetyHoldWithFreshProof({...prior,hold:{code:'LOCAL_MESSAGE_BUDGET'}},proof).cleared,false);
});

test('slow policy read renews expired evidence in thinking preflight without a hold or operator action',async()=>{
  const f=fixture({delay:20000}),before=page(f.c),result=await f.bind('ensureHighestThinkingBeforeSend')(f.p,before);
  assert.equal(result.handled,false,JSON.stringify(result.process.safety));
  assert.equal(f.counts.reads,1);assert.equal(f.counts.holds,0);assert.equal(f.counts.selections,0);
  assert.ok(result.page.modelEvidence.observedAtMs>before.modelEvidence.observedAtMs);
});

test('send admission renews observation after slow storage, instead of repeatedly denying the old snapshot',async()=>{
  const f=fixture({delay:20000}),before=page(f.c),result=await f.bind('sendingSafetyDecision')(f.p,before,f.p.pendingPrompt);
  assert.equal(result.allowed,true,JSON.stringify(result));assert.equal(f.counts.reads,1);
  assert.equal(f.counts.maintenance,0);
  assert.equal(before.modelEvidence.observedAtMs+20000,result.page.modelEvidence.observedAtMs);
});

test('dispatch authorization cannot spend a model receipt lifetime on full storage maintenance',async()=>{
  const f=fixture(),started=f.c.value;
  f.p.safety.turnProof={allowed:true,highestEffortVerified:true,promptHash:'hash'};
  const result=await f.bind('authorizeDispatch')({dispatchId:'dispatch',promptHash:'hash'},
    {id:'fixture',tab:{windowId:1,id:2}});
  assert.equal(result.ok,true,JSON.stringify(result));assert.ok(f.c.value-started<15000);
  assert.equal(f.counts.maintenance,0);
});

test('pageState observes the model after asynchronous transcript hashing finishes',async()=>{
  const c=clock(),entry={id:'user',role:'user',text:'user'},reply={id:'assistant',role:'assistant',text:'reply'};
  const deps={Date:class extends Date{static now(){return c.value;}},CONTENT_VERSION:APP_VERSION,DOCUMENT_ID:'document',
    location:{href:url},document:{title:'fixture'},globalThis:{GreenfieldModelObservation:{observe:()=>evidence(c)}},
    canonicalEntries:()=>[entry,reply],messageText:e=>e?.text||'',generationSignals:()=>({generating:false,signals:{}}),
    detectRateLimitWarning:async()=>null,publicRateLimitWarning:()=>null,
    resolveAutonomousTurn:()=>({userEntry:entry,assistantEntry:reply}),getComposer:()=>({}),
    normalizeComposerText:s=>s,readComposerValue:()=>'',sha256Hex:async()=>{c.value+=16000;return 'hash';},
    providerTransportNotices:()=>[],pageHealthState:()=>({})};
  const run=Function(...Object.keys(deps),'let observationSequence=0;'+functionSource('pageState',content,'  ')+';return pageState')(...Object.values(deps));
  const result=await run();assert.ok(c.value-result.modelEvidence.observedAtMs<=15000);
  assert.equal(result.autonomousTurn.assistantHash,'hash');
});

for(const level of levels)test(`stale ${level} observation is refreshed through actual content handler and DOM, preserving selection`,async()=>{
  const f=reasoningUI();try{
    assert.equal((await f.ensure(level)).ok,true);
    const before=f.page();before.modelEvidence.observedAtMs-=20000;
    const opens=f.counts.opens;
    const result=await refreshModelEvidence(before,f.policy(level),{now:()=>f.w.Date.now(),gptRoot,expectedVersion:APP_VERSION,
      read:context=>f.w.handle({type:'EIC_GF_GET_MODEL_EVIDENCE',...context})});
    assert.equal(result.proof.allowed,true,JSON.stringify(result));assert.equal(result.proof.reasoningLevel,level);
    assert.equal(f.counts.opens,opens);assert.equal(f.counts.sends,0);
  }finally{f.close();}
});

for(const mismatch of ['documentId','url','bridgeVersion'])test(`refresh cannot join ${mismatch} mismatch to the original page`,async()=>{
  const f=fixture({read:({c})=>({ok:true,...page(c),bridgeVersion:APP_VERSION,[mismatch]:'different'})});
  const before=page(f.c);before.modelEvidence.observedAtMs-=20000;
  const result=await f.bind('ensureHighestThinkingBeforeSend')(f.p,before);
  assert.equal(result.handled,true);assert.equal(result.process.safety.hold.code,'MODEL_EVIDENCE_CONTEXT_CHANGED');
});

test('STOP during observation refresh wins over the old sending snapshot',async()=>{
  const f=fixture({stopped:true}),before=page(f.c);before.modelEvidence.observedAtMs-=20000;
  const result=await f.bind('ensureHighestThinkingBeforeSend')(f.p,before);
  assert.equal(result.handled,true);assert.equal(result.process.phase,PHASES.STOPPED);assert.equal(f.counts.holds,0);
});

for(const [patch,code] of [
  [{modelLabel:'GPT-5.6 Pro'},'MODEL_PRO_NOT_ALLOWED'],
  [{modelLabel:'GPT-4.1'},'MODEL_VERSION_MISMATCH'],
  [{quota:{active:true}},'PROVIDER_QUOTA_OR_FALLBACK'],
  [{blockingUi:true},'BLOCKING_CHATGPT_UI']
])test(`fresh observation still enforces ${code}`,async()=>{
  const f=fixture({read:({c})=>({ok:true,...page(c,{modelEvidence:evidence(c,patch)}),bridgeVersion:APP_VERSION})});
  const before=page(f.c);before.modelEvidence.observedAtMs-=20000;
  const result=await f.bind('sendingSafetyDecision')(f.p,before,f.p.pendingPrompt);
  assert.equal(result.allowed,false);assert.equal(result.code,code);
});

test('fresh observation with an expired reasoning receipt invokes actual selection path',async()=>{
  const f=fixture({read:({c})=>({ok:true,...page(c,{modelEvidence:evidence(c,{highestEffort:null})}),bridgeVersion:APP_VERSION})});
  const before=page(f.c);before.modelEvidence.observedAtMs-=20000;
  const result=await f.bind('ensureHighestThinkingBeforeSend')(f.p,before);
  assert.equal(result.handled,false,JSON.stringify(result.process.safety));
  assert.equal(f.counts.selections,1);assert.equal(f.counts.reads,1);
});

test('failed bridge refresh never rewrites old timestamps; a later successful attempt recovers',async()=>{
  let available=false;
  const f=fixture({read:({c})=>{if(!available)throw Error('BRIDGE_TIMEOUT');return {ok:true,...page(c),bridgeVersion:APP_VERSION};}});
  const before=page(f.c);before.modelEvidence.observedAtMs-=20000;const stamp=before.modelEvidence.observedAtMs;
  for(let i=0;i<4;i++){
    const result=await f.bind('ensureHighestThinkingBeforeSend')(f.p,before);
    assert.equal(result.process.safety.hold.code,'MODEL_EVIDENCE_REFRESH_UNAVAILABLE');
    assert.equal(before.modelEvidence.observedAtMs,stamp);
  }
  available=true;assert.equal((await f.bind('ensureHighestThinkingBeforeSend')(f.p,before)).handled,false);
  assert.equal(f.counts.reads,5);
});

test('fresh model observation cannot override a budget denial',async()=>{
  const f=fixture({delay:20000,budget:{allowed:false,code:'LOCAL_MESSAGE_BUDGET'}});
  const result=await f.bind('sendingSafetyDecision')(f.p,page(f.c),f.p.pendingPrompt);
  assert.equal(result.code,'LOCAL_MESSAGE_BUDGET');assert.equal(result.allowed,false);assert.equal(f.counts.reads,1);
});

test('missing evidence is reacquired from the same document without a manual recheck',async()=>{
  const f=fixture(),result=await f.bind('ensureHighestThinkingBeforeSend')(f.p,page(f.c,{modelEvidence:null}));
  assert.equal(result.handled,false);assert.equal(f.counts.reads,1);assert.equal(f.counts.holds,0);
});

test('a refresh that itself returns expired evidence is not re-stamped or admitted',async()=>{
  const f=fixture({read:({c})=>({ok:true,bridgeVersion:APP_VERSION,
    ...page(c,{modelEvidence:evidence(c,{observedAtMs:c.value-20000})})})});
  const result=await f.bind('sendingSafetyDecision')(f.p,page(f.c,{modelEvidence:null}),f.p.pendingPrompt);
  assert.equal(result.allowed,false);assert.equal(result.code,'MODEL_EVIDENCE_STALE');
  assert.equal(result.observedAtMs,f.c.value-20000);assert.equal(f.counts.reads,1);
});

test('observation retry is automatic and short without changing explicit retry deadlines',async()=>{
  const f=fixture();let scheduled;
  Object.assign(f.deps,{saveProcess:async()=>{},recordIncident:async()=>{},INCIDENT_QUIET_HOLD_CODES:new Set(),
    releaseSchedulerTurn:async()=>{},releaseGlobalPromptLease:async()=>{},broadcast:async()=>{},syncSafetyRetryAlarm:async()=>{},
    scheduleFast:(id,ms)=>{scheduled=ms;}});
  const hold=f.bind('holdForSafety');
  await hold(f.p,{code:'MODEL_EVIDENCE_STALE'});assert.equal(scheduled,1000);
  await hold(f.p,{code:'MODEL_EVIDENCE_REFRESH_UNAVAILABLE'});assert.equal(scheduled,1000);
  await hold(f.p,{code:'LOCAL_MESSAGE_BUDGET',retryAtMs:f.c.value+60000});assert.equal(scheduled,60000);
});
