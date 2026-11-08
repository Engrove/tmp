import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';

const root=process.env.GREENFIELD_COMPOSER_BASELINE
  ? pathToFileURL(resolve(process.env.GREENFIELD_COMPOSER_BASELINE)+'/') : new URL('../',import.meta.url);
const content=await readFile(new URL('content.js',root),'utf8');
const background=await readFile(new URL('background.js',root),'utf8');
const {workerReason}=await import(new URL('lib/operations-view.mjs',root));
const {managedOverlayOverview}=await import(new URL('lib/overlay-summary.mjs',root));
const {reserveUsage,authorizeUsageSend,readSafety}=await import(new URL('lib/usage-governor.mjs',root));
const captured=JSON.parse(await readFile(new URL('fixtures/composer-stall-2026-10-17.json',import.meta.url),'utf8'));
const digest=s=>createHash('sha256').update(s).digest('hex');
function source(name,text=background,indent='') {
  const hit=new RegExp(`^${indent}(?:async )?function ${name}\\(`,'m').exec(text);assert.ok(hit,name);
  const tail=text.slice(hit.index),end=new RegExp(`^${indent}}\\s*$`,'m').exec(tail);
  return tail.slice(0,end.index+end[0].length);
}
const runtime=(name,deps)=>Function(...Object.keys(deps),source(name)+`;return ${name};`)(...Object.values(deps));
function fixture({initial='',authorize,afterWrite,clickError=false,active=true}={}) {
  const dom=new JSDOM('<form><textarea></textarea><button type="button">Send</button></form>',{url:'https://chatgpt.com/g/g-test',runScripts:'outside-only'});
  const w=dom.window;let clicks=0,reads=0,writes=[],authSeen=[],composer=w.document.querySelector('textarea');
  composer.value=initial;const button=w.document.querySelector('button');
  const editListeners=[];const originalAdd=w.document.addEventListener.bind(w.document);
  w.document.addEventListener=(name,fn,...rest)=>{if(name==='input')editListeners.push(fn);return originalAdd(name,fn,...rest);};
  button.click=()=>{clicks++;if(clickError)throw new Error('CLICK_RETURN_LOST');};
  Object.assign(w,{DOCUMENT_ID:'document',dispatchRecords:new Map(),
    assertContentActive:()=>{if(!active)throw Object.assign(new Error('DISPOSED'),{code:'CONTENT_BRIDGE_DISPOSED'});},
    forensic:()=>{},serializeError:e=>({code:e.code}),
    GreenfieldSafetyPolicy:{evaluateModel:()=>({allowed:true})},GreenfieldModelObservation:{observe:()=>({})},
    getComposer:()=>composer,getSendButton:()=>button,
    normalizeText:s=>String(s).trim(),sha256Hex:async s=>digest(s),
    setNativeValue:(el,value)=>{writes.push(value);el.value=value;},
    pageState:async()=>{if(++reads===2)afterWrite?.({w,composer,button,setComposer:el=>{composer=el;},
      dispose:()=>{active=false;},humanInput:()=>editListeners.forEach(fn=>fn({isTrusted:true,target:composer}))});
      return {url:w.location.href,modelEvidence:{},composerEmpty:!composer.value,composerTextHash:digest(composer.value.trim()),userCount:0,assistantCount:0};},
    sendRuntimeMessage:async()=>{authSeen.push(composer.value);return authorize?await authorize({w,composer}):{ok:true,policy:{},gptRoot:'https://chatgpt.com/g/g-test'};},
    promptMarkerValue:s=>s,waitForMaterialization:async()=>({acknowledged:true,evidence:'USER_TURN',elapsedMs:1,state:{}}),
    materializedUserTurnReceipt:()=>({userTurnId:"fixture-user",userTurnIndex:0}),publishDispatchMaterialization:async()=>({userTurnId:'new-user'})});
  w.eval(['normalizeComposerText','readComposerValue','submitPrompt'].map(name=>source(name,content,'  ')).join('\n')+'\nwindow.submit=submitPrompt;');
  return {w,writes,authSeen,get composer(){return composer;},get clicks(){return clicks;},
    submit:()=>w.submit('work',digest('work'),'dispatch-a',{policy:{},gptRoot:'https://chatgpt.com/g/g-test'}),close:()=>w.close()};
}

test('captured log identifies three unsent rotations and the old draft last denied by local pacing',()=>{
  assert.equal(captured.appVersion,'1.9.19');assert.equal(captured.runtimeFault,'');
  assert.equal(captured.old.dispatchError,'LOCAL_PACING_WAIT');assert.equal(captured.old.dispatchEffectPossible,false);
  assert.equal(captured.old.sendAttempts,6);assert.equal(captured.rotating.length,3);
  assert.ok(captured.rotating.every(p=>p.state==='NAVIGATING'&&p.hardReloadState==='COMPLETED'&&!p.hasLastPrompt&&p.sendAttempts===0));
});
for(const code of ['LOCAL_PACING_WAIT','ADMISSION_PAUSED','DISPATCH_OWNER_UNVERIFIED'])test(`authorization denial ${code} leaves an empty composer untouched`,async()=>{
  const f=fixture({authorize:()=>({ok:false,code,retryAtMs:123456})});try{
    const r=await f.submit();assert.equal(r.code,code);assert.equal(r.effectPossible,false);
    assert.deepEqual(f.authSeen,['']);assert.deepEqual(f.writes,[]);assert.equal(f.composer.value,'');
    assert.equal(f.clicks,0);assert.equal(r.retryAtMs,123456);
  }finally{f.close();}
});
test('authorized normal send clicks once; replay of the same dispatch never sends twice',async()=>{
  const f=fixture();try{assert.equal((await f.submit()).acknowledged,true);assert.deepEqual(f.authSeen,['','work']);
    assert.equal((await f.submit()).acknowledged,true);assert.equal(f.clicks,1);assert.deepEqual(f.writes,['work']);
  }finally{f.close();}
});
test('late send-control failure clears only the newly staged unsent draft',async()=>{
  const f=fixture({afterWrite:({button})=>{button.disabled=true;}});try{
    const r=await f.submit();assert.equal(r.effectPossible,false);assert.equal(r.draftCleanup,'CLEARED_OWN_UNSENT_DRAFT');
    assert.equal(f.clicks,0);assert.equal(f.composer.value,'');assert.deepEqual(f.writes,['work','']);
  }finally{f.close();}
});
test('operator pause after staging is rechecked and rolls back without sending',async()=>{
  let calls=0;
  const f=fixture({authorize:()=>++calls===1?{ok:true}:{ok:false,code:'ADMISSION_PAUSED'}});try{
    const r=await f.submit();assert.equal(r.code,'ADMISSION_PAUSED');assert.equal(f.clicks,0);
    assert.equal(r.draftCleanup,'CLEARED_OWN_UNSENT_DRAFT');assert.equal(f.composer.value,'');
  }finally{f.close();}
});
test('schedule edit during asynchronous page observation blocks the final click',async()=>{
  let closed=false;
  const f=fixture({afterWrite:()=>{closed=true;},authorize:()=>closed?{ok:false,code:'OUTSIDE_RUN_WINDOW'}:{ok:true}});
  try { const r=await f.submit();assert.equal(r.code,'OUTSIDE_RUN_WINDOW');assert.equal(r.effectPossible,false);
    assert.equal(f.clicks,0);assert.equal(f.composer.value,'');assert.equal(r.draftCleanup,'CLEARED_OWN_UNSENT_DRAFT');
  } finally { f.close(); }
});
test('schedule close deadline is checked synchronously at the click boundary',async()=>{
  const f=fixture({authorize:()=>({ok:true,queueAdmission:{ok:true,closesAtMs:Date.now()-1}})});
  try { const r=await f.submit();assert.equal(r.code,'OUTSIDE_RUN_WINDOW');assert.equal(r.effectPossible,false);
    assert.equal(f.clicks,0);assert.equal(f.composer.value,'');
  } finally { f.close(); }
});
for(const initial of ['Human draft','work'])test(`pre-existing draft ${initial} is never deleted`,async()=>{
  const f=fixture({initial,afterWrite:({button})=>{button.disabled=true;}});try{
    const r=await f.submit();assert.equal(r.ok,false);assert.equal(f.clicks,0);assert.equal(f.composer.value,initial);
    assert.ok(!f.writes.includes(''));
  }finally{f.close();}
});
test('human input while authorization is pending is not overwritten',async()=>{
  const f=fixture({authorize:({composer})=>{composer.value='Operator new draft';return {ok:true};}});try{
    const r=await f.submit();assert.equal(r.code,'OPERATOR_DRAFT_CHANGED_BEFORE_SEND');assert.equal(f.clicks,0);
    assert.equal(f.composer.value,'Operator new draft');assert.deepEqual(f.writes,[]);
  }finally{f.close();}
});
for(const mutation of ['edit','edit-and-revert','new-composer','navigation','disposal'])test(`late ${mutation} preserves draft and prevents a send`,async()=>{
  const f=fixture({afterWrite:({w,composer,button,humanInput,setComposer,dispose})=>{
    if(mutation==='edit')composer.value='Operator edits';
    if(mutation==='edit-and-revert')humanInput();
    if(mutation==='new-composer'){const replacement=composer.cloneNode();replacement.value='Replacement draft';composer.replaceWith(replacement);setComposer(replacement);}
    if(mutation==='navigation')w.history.pushState({},'','/g/g-test/c/different');
    if(mutation==='disposal')dispose();
    button.disabled=true;
  }});try{
    const r=await f.submit();assert.equal(r.ok,false);assert.equal(f.clicks,0);assert.ok(f.composer.value);
    assert.ok(!f.writes.includes(''),'no cleanup after another owner takes over');
  }finally{f.close();}
});
test('possible effect after click is never cleared or replayed',async()=>{
  const f=fixture({clickError:true});try{
    const r=await f.submit();assert.equal(r.effectPossible,true);assert.equal(f.composer.value,'work');
    await f.submit();assert.equal(f.clicks,1);assert.deepEqual(f.writes,['work']);
  }finally{f.close();}
});

function storage(){const data={};return {get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])])),
  set:async v=>Object.assign(data,structuredClone(v)),remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};}
test('two workers preserve global minimum gap and return its precise wake time',async()=>{
  const s=storage(),t=1000000;
  for(const [id,now] of [['a',t],['b',t+180000]])assert.equal((await reserveUsage({id,processId:id,workerId:id,prompt:'work',proof:{allowed:true,observedAtMs:now},now},s)).allowed,true);
  assert.equal((await authorizeUsageSend('a','send-a',s,t+180001)).allowed,true);
  const gap=(await readSafety(s)).policy.minGapSeconds*1000;
  const denied=await authorizeUsageSend('b','send-b',s,t+180002);assert.equal(denied.code,'LOCAL_PACING_WAIT');
  assert.equal(denied.retryAtMs,t+180001+gap);
  assert.equal((await authorizeUsageSend('a','send-a',s,t+180003)).allowed,true,'idempotent original authorization');
  assert.equal((await authorizeUsageSend('b','send-b',s,denied.retryAtMs)).allowed,true);
});

function rotationHarness({stop=false}={}) {
  let current={processId:'new-p71',phase:'ROTATING',turn:1,sessionSeq:1,pendingPrompt:{text:'mission',hash:'mission-hash',sendAttempts:0},
    queueContext:{itemId:'item-71',savedMissionId:'mission-71'},ownerProgress:{root:{ref:'frozen-root',terminal:false}},
    sessionRotation:{rotationId:'r',state:'NAVIGATING',hardReloadState:'COMPLETED'}};
  const events=[],delays=[];
  const deps={recoverStaleRotationDraft:async p=>({handled:false,process:p}),nowIso:()=>new Date().toISOString(),
    transportTransitionBoundary:async()=>({blocked:stop,process:stop?{...current,phase:'STOPPED'}:current}),
    saveRotationState:async(p,rotation,kind,detail)=>{events.push({kind,detail});return current={...p,sessionRotation:rotation};},
    recordIncident:async()=>{},scheduleFast:(id,ms)=>delays.push(ms)};
  const observe=runtime('observeRotationComposerWait',deps);
  return {events,delays,get current(){return current;},async tick(empty=false){const result=await observe(current,current.sessionRotation,{composerReady:true,composerEmpty:empty,composerTextHash:empty?'':'old-project59-hash'});current=result.process;return result;}};
}
test('restored foreign draft is explicit WAIT; unchanged reads do not rewrite state; clearing resumes same mission',async()=>{
  const h=rotationHarness(),initial=structuredClone(h.current);
  for(let n=0;n<4;n++)assert.equal((await h.tick()).handled,true);
  assert.equal(h.events.length,1);assert.equal(h.current.sessionRotation.readinessWait.resumeCondition,'COMPOSER_EMPTY');
  assert.deepEqual(h.current.pendingPrompt,initial.pendingPrompt);assert.deepEqual(h.current.queueContext,initial.queueContext);
  assert.deepEqual(h.current.ownerProgress,initial.ownerProgress);assert.ok(h.delays.every(ms=>ms===5000));
  assert.equal((await h.tick(true)).handled,false);assert.equal(h.current.sessionRotation.readinessWait,null);assert.equal(h.events.length,2);
});
test('STOP cannot be overwritten while a draft wait is being saved',async()=>{
  const h=rotationHarness({stop:true});assert.equal((await h.tick()).process.phase,'STOPPED');assert.equal(h.events.length,0);
});
test('worker and page overlay explain the composer block instead of only rotating',()=>{
  const p={phase:'ROTATING',sessionRotation:{readinessWait:{code:'SESSION_ROTATION_COMPOSER_DRAFT_PRESENT'}}};
  assert.match(workerReason(p),/sessionsstart.*automatiskt/i);assert.match(managedOverlayOverview(p).phaseText,/Kontrollerar utkast/);
  p.sessionRotation.readinessWait.reviewRequired=true;
  assert.match(managedOverlayOverview(p).phaseText,/Utkast bevarat/);
  assert.doesNotMatch(managedOverlayOverview(p).phaseText,/egen text/);
});

test('real cold-rotation dispatcher waits beyond loading timeout, then initializes once when draft is cleared',async()=>{
  const {PHASES}=await import(new URL('lib/contracts.mjs',root));
  const {SESSION_ROTATION_STATES}=await import(new URL('lib/session-rotation.mjs',root));
  const gptRoot='https://chatgpt.com/g/g-test';
  let p={processId:'p71',phase:'ROTATING',windowId:1,tabId:2,turn:1,sessionSeq:1,
    goal:'Project 71',queueContext:{queueId:'queue',itemId:'item71',savedMissionId:'mission71'},
    pendingPrompt:{text:'work',hash:'work-hash',sendAttempts:0},
    sessionRotation:{rotationId:'r',state:'NAVIGATING',targetTabId:2,queueSwitch:true,hardReloadBeforeResume:true,
      hardReloadState:'COMPLETED',navigationStartedAt:new Date(Date.now()-600000).toISOString()}};
  let page={url:gptRoot,userCount:0,composerReady:true,composerEmpty:false,composerTextHash:'project59-draft',generating:false};
  let initializations=0,navigations=0,waitWrites=0;
  const deps={PHASES,SESSION_ROTATION_STATES,EIC_LANDING_TIMEOUT_MS:60000,nowIso:()=>new Date().toISOString(),
    invalidCapturedResponse:()=>false,warmResumeTarget:()=>'',readEicSurfaceState:async()=>({entryUrl:gptRoot}),resolveManagedGptRoot:()=>gptRoot,
    chrome:{storage:{local:{}},tabs:{get:async()=>({id:2,windowId:1,url:gptRoot,status:'complete'}),update:async()=>navigations++}},
    supportedUrl:()=>true,recheckExpiredRotationReady:async()=>({handled:false}),ensureContentBridgeVersion:async()=>{},
    bridgeMessage:async()=>({ok:true,state:page}),providerTransportPending:()=>false,recoverStaleRotationDraft:async p=>({handled:false,process:p}),
    Safety:{eicSurfaceProof:()=>({ok:true,kind:'EIC'})},scheduleFast:()=>{},recordIncident:async()=>{},
    transportTransitionBoundary:async()=>({blocked:false,process:p}),
    saveRotationState:async(v,r)=>{waitWrites++;return p={...v,sessionRotation:r};},
    prepareSessionInitialization:async()=>{initializations++;return {sessionInitialization:{status:'PENDING'}};},
    commitTransition:async(v,phase,patch,options)=>{if(options.beforeSave)await options.beforeSave();return p={...v,...patch,phase};}};
  deps.observeRotationComposerWait=runtime('observeRotationComposerWait',deps);
  deps.commitFreshRotationReady=runtime('commitFreshRotationReady',deps);
  const tick=runtime('tickRotating',deps),identity=structuredClone(p.queueContext);
  p=await tick(p);p=await tick(p);assert.equal(p.phase,'ROTATING');assert.equal(initializations,0);assert.equal(waitWrites,1);
  page={...page,composerEmpty:true,composerTextHash:''};p=await tick(p);
  assert.equal(p.phase,'SENDING');assert.equal(initializations,1);assert.equal(navigations,0);
  assert.equal(p.sessionRotation.readinessWait,null);assert.deepEqual(p.queueContext,identity);assert.equal(p.turn,1);
});

test('the actual panel snapshot carries the wait reason but no draft bytes',()=>{
  const p={phase:'ROTATING',sessionRotation:{rotationId:'r',state:'NAVIGATING',readinessWait:{
    code:'SESSION_ROTATION_COMPOSER_DRAFT_PRESENT',sinceAt:'now',resumeCondition:'COMPOSER_EMPTY',composerTextHash:'private-draft-hash'}},
    sessionHealth:null};
  const pub=runtime('publicSnapshot',{normalizeGreenfieldPriority:()=>'',DEFAULT_GREENFIELD_PRIORITY:'NORMAL',sessionHealthCapsule:()=>null})(p);
  assert.match(workerReason(pub),/sessionsstart.*automatiskt/i);
  assert.doesNotMatch(JSON.stringify(pub.sessionRotation),/private-draft-hash/);
});

const {PHASES,APP_VERSION}=await import(new URL('lib/contracts.mjs',root));
const {SESSION_ROTATION_STATES}=await import(new URL('lib/session-rotation.mjs',root));
const {buildA2AEnvelope,validateA2AEnvelope}=await import(new URL('lib/a2a.mjs',root));
const {createProcess}=await import(new URL('lib/state.mjs',root));
const {canonicalJson,jsonEqual}=await import(new URL('lib/canonical-json.mjs',root));
function legacyBlocked() {
  const p={...createProcess({workerId:'worker',windowId:1,tabId:2,goal:'GF-1.71.1021\nFrozen goal',initialPrompt:'work'}),
    version:'1.9.19',phase:PHASES.BLOCKED,lastError:{code:'SESSION_ROTATION_CHAT_READY_TIMEOUT'},
    queueContext:{queueId:'q',itemId:'i',savedMissionId:'m',maxInteractions:5,interactionCount:0},
    objectiveState:{objective:'Frozen bounded obligation'},sessionRotation:{rotationId:'r',state:'NAVIGATING',queueSwitch:true,
      sourceResponseState:'NEW_QUEUE_MISSION',hardReloadState:'COMPLETED'}};
  const a2a=buildA2AEnvelope({process:p,objective:p.objectiveState.objective});
  const text=JSON.stringify(a2a);p.pendingPrompt={text,hash:digest(text),a2a,sendAttempts:0,dispatch:null};
  return p;
}
const candidateDeps={jsonEqual,PHASES,SESSION_ROTATION_STATES,warmResumeTarget:()=>'',validateA2AEnvelope,canonicalJson};
test('diagnostic/checkpoint property reordering preserves identity but cannot change payload',()=>{
  const candidate=runtime('unsentQueueRotationCandidate',candidateDeps),p=legacyBlocked();
  p.pendingPrompt.a2a=JSON.parse(canonicalJson(p.pendingPrompt.a2a));
  assert.equal(candidate(p),true);
  p.pendingPrompt.a2a.objective='Different scope';assert.equal(candidate(p),false);
});
test('legacy recovery only admits the exact never-sent initial cold rotation',()=>{
  const candidate=runtime('unsentQueueRotationCandidate',candidateDeps),p=legacyBlocked();assert.equal(candidate(p),true);
  for(const patch of [{version:'1.9.20'},{phase:'DONE'},{phase:'STOPPED'},{turn:2},{sessionSeq:2},{priorStateUnknown:true},
    {lastError:{code:'OTHER_ERROR'}},{lastPrompt:{acknowledged:true}},{lastResponse:{text:'answer'}},{detached:{}},
    {storageRecoveryRequired:true},{safety:{qualityIncident:{code:'QUALITY'}}},{safety:{hold:{code:'OPERATOR'}}},
    {sessionInitialization:{status:'PENDING'}},{pendingPrompt:{...p.pendingPrompt,sendAttempts:1}},
    {pendingPrompt:{...p.pendingPrompt,dispatch:{effectPossible:null}}},
    {pendingPrompt:{...p.pendingPrompt,dispatch:{effectPossible:false}}},
    {pendingPrompt:{...p.pendingPrompt,a2a:{...p.pendingPrompt.a2a,correlationId:'foreign-run'}}}])
      assert.equal(candidate({...p,...patch}),false,JSON.stringify(patch));
});

for(const block of ['none','paused','quota','queue-stopped','item-changed','binding','ownership','process-changed','hash'])test(`legacy never-sent recovery respects ${block}`,async()=>{
  let p=legacyBlocked();const initial=structuredClone(p);let writes=0;
  if(block==='hash')p.pendingPrompt.hash='bad';
  const queue={enabled:block!=='queue-stopped',queueId:'q',workerId:'worker',activeItemId:block==='item-changed'?'other':'i',
    items:[{itemId:'i',savedMissionId:'m',status:'ACTIVE'}]};
  const deps={...candidateDeps,APP_VERSION,sha256Hex:async s=>digest(s),nowIso:()=>new Date().toISOString(),
    chrome:{storage:{local:{},session:{}}},missionOwnershipKey:()=> 'mission',
    readMissionOwnership:async()=>({owners:{mission:{workerId:block==='ownership'?'other':'worker',processId:p.processId,processFence:true}}}),
    withMissionOwner:async(p,s,fn)=>fn(),loadMissionWorkQueue:async()=>queue,
    readSafety:async()=>({admissionPaused:block==='paused',providerHold:block==='quota'?{}:null}),
    getWorkerBinding:async()=>({workerId:block==='binding'?'other':'worker'}),
    loadProcessForWindow:async()=>block==='process-changed'?{...p,phase:'STOPPED'}:p,
    queueItemForProcess:q=>q.items.find(i=>i.itemId==='i'),QUEUE_STATUS:{ACTIVE:'ACTIVE'},
    saveProcess:async v=>{writes++;p=structuredClone(v);},isCurrentToken:(p,t)=>p.generation===t.generation,
    ownerToken:p=>({generation:p.generation}),audit:async()=>{}};
  deps.unsentQueueRotationCandidate=runtime('unsentQueueRotationCandidate',deps);
  deps.terminalQueueDispatchOwner=runtime('terminalQueueDispatchOwner',deps);
  const recover=runtime('recoverUnsentQueueRotation',deps);
  const next=await recover(p,'upgrade');assert.equal(writes,block==='none'?1:0);
  if(block==='none') {
    assert.equal(next.phase,'ROTATING');assert.equal(next.generation,initial.generation+1);assert.equal(next.version,APP_VERSION);
    assert.deepEqual(next.queueContext,initial.queueContext);assert.deepEqual(next.objectiveState,initial.objectiveState);
    assert.equal(next.runId,initial.runId);assert.equal(next.processId,initial.processId);assert.equal(next.pendingPrompt.sendAttempts,0);
    assert.equal(next.pendingPrompt.hash,digest(next.pendingPrompt.text));assert.equal(next.pendingPrompt.a2a.process.generation,next.generation);
    assert.equal(next.unsentRotationRecovery.automaticSend,false);
    await recover(next,'second-hydration');assert.equal(writes,1,'one repair only');
  }
});
