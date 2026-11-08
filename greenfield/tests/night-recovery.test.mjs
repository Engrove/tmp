import {withReasoningDependencies} from './fixtures/reasoning-dependencies.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';

// Override replays these expectations against the immutable delivered 1.9.18.
const root=process.env.GREENFIELD_RECOVERY_PACKAGE_ROOT
  ? pathToFileURL(resolve(process.env.GREENFIELD_RECOVERY_PACKAGE_ROOT)+'/') : new URL('../',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');
const load=name=>import(new URL(`lib/${name}.mjs`,root));
const transport=await load('session-transport');
const {deliveryContinuationEligibility,prepareDeliveryContinuation,deliveryRetryForPrompt,deliveryFencePage,
  DELIVERY_CONTINUATION,DELIVERY_CONTINUATION_MAX_ATTEMPTS,DELIVERY_NOTICE_SETTLE_MS}=transport;
const {PHASES}=await load('contracts');
const {transitionProcess,createProcess}=await load('state');
const {applyQueueParkTransition,latestResponseRoundTripMs}=await load('queue-planning');
const {normalizeMissionWorkQueue,selectNextMissionItem,publicMissionWorkQueue,QUEUE_STATUS,reviveOwnershipContentionBlocks}=await load('mission-work-queue');
const {providerTransportPending,hasCurrentGenerationEvidence,createWaitingRefreshState}=await load('waiting-refresh');
const {conversationKey}=await load('restart-recovery');
const {usageIdentity}=await load('usage-governor');
const background=await read('background.js'),content=await read('content.js');
const policy=await read('lib/safety-policy.js'),observation=await read('lib/model-observation.js');
const captured=JSON.parse(await readFile(new URL('fixtures/night-stall-2026-10-17.json',import.meta.url),'utf8'));
const url='https://chatgpt.com/g/g-test/c/night-replay';
function fnSource(name,source=background,indent='') {
  const hit=new RegExp(`^${indent}(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(hit,name);
  const tail=source.slice(hit.index),end=new RegExp(`^${indent}}\\s*$`,'m').exec(tail);
  return tail.slice(0,end.index+end[0].length);
}
const fn=(name,deps,source=background)=>Function(...Object.keys(withReasoningDependencies(deps)),fnSource(name,source)+`;return ${name};`)(...Object.values(deps));
const clone=structuredClone;
function worker() {return {...createProcess({workerId:'worker-a',windowId:1,tabId:10,goal:'GF-4.38.1002',initialPrompt:'work'}),
  processId:'p38',workerId:'worker-a',windowId:1,tabId:10,runId:'run-a',generation:2,
  phase:PHASES.WAITING,turn:8,sessionSeq:1,goal:'GF-4.38.1002\nFrozen obligations',lastManagedUrl:url,
  objectiveState:{objective:'A'.repeat(1465),status:'OPEN'},ownerProgress:{root:{ref:'owner-root',terminal:false}},
  lastPrompt:{hash:captured.p38.promptHash,text:'original work',a2a:{messageId:'a2a-original'},
    acknowledged:true,dispatchedUserTurnId:captured.p38.userTurnId,conversationKey:conversationKey(url)},
  lastResponse:{hash:'previous-response',text:'Prior turn only',observation:{pairedUserTurnId:'previous-user'}},
  pendingPrompt:null,safety:{hold:{code:'DELIVERY_SOURCE_TURN_UNPROVEN'}},
  queueContext:{queueId:'queue-a',itemId:'item-a',savedMissionId:'mission-a',interactionCount:2,maxInteractions:5},
  sessionBroker:{operativePrompts:7,completedQuanta:1}};}
function page(p=worker()) {return {url,lastUserId:p.lastPrompt.dispatchedUserTurnId,lastUserHash:'collapsed-prompt-hash',
  generating:false,signals:{},providerNotices:{deliveryTimeout:true},
  autonomousTurn:{resolvedUserTurnId:p.lastPrompt.dispatchedUserTurnId,resolvedBy:'USER_TURN_ID'}};}

test('recorded acknowledged P38 id survives a collapsed DOM hash; original log does not claim a captured DOM hash',()=>{
  assert.equal(captured.p38.holdCode,'DELIVERY_SOURCE_TURN_UNPROVEN');assert.equal(captured.runtimeFault,'');
  assert.equal(deliveryContinuationEligibility(worker(),page()),'');
});
for(const kind of ['conversation','latest-user','causal-user','unacknowledged','pending-effect','quality','storage'])test(`Fortsätt rejects unproven source: ${kind}`,()=>{
  const p=worker(),v=page(p);
  if(kind==='conversation')v.url='https://chatgpt.com/g/g-test/c/other';
  if(kind==='latest-user')v.lastUserId='operator-interleaved';
  if(kind==='causal-user')v.autonomousTurn.resolvedUserTurnId='other-turn';
  if(kind==='unacknowledged')p.lastPrompt.acknowledged=false;
  if(kind==='pending-effect')p.pendingPrompt={dispatch:{effectPossible:null}};
  if(kind==='quality')p.safety.qualityIncident={code:'UNVERIFIED'};
  if(kind==='storage')p.storageRecoveryRequired=true;
  assert.ok(deliveryContinuationEligibility(p,v));
});

test('recorded Pro/medium mismatch resolves visibly as Pro but no longer authorizes sends',()=>{
  const dom=new JSDOM('<form><textarea></textarea><button aria-label="Välj ChatGPT-modell" aria-haspopup="menu" data-selected-reasoning-effort="medium">Pro</button></form>',{url,runScripts:'outside-only'});
  try {const w=dom.window;w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});
    w.Date.now=()=>captured.p59.evidence.observedAtMs;
    w.eval(policy);
    w.GreenfieldThinkingControl={proof:()=>clone(captured.p59.evidence.highestEffort),receiptStatus:()=>clone(captured.p59.evidence.receiptStatus)};
    w.eval(observation);const evidence=w.GreenfieldModelObservation.observe(),S=w.GreenfieldSafetyPolicy;
    const options={url,gptRoot:'https://chatgpt.com/g/g-test',now:w.Date.now(),requireHighestEffort:true};
    assert.equal(evidence.ambiguous,false);assert.equal(evidence.effortLabel,'Pro');
    assert.equal(S.evaluateModel(evidence,S.defaults,options).allowed,false);
    assert.equal(S.evaluateModel({...evidence,highestEffort:null},S.defaults,options).allowed,false);
    assert.equal(S.evaluateModel({...evidence,quota:{active:true}},S.defaults,options).allowed,false);
    assert.equal(S.evaluateModel({...evidence,modelLabel:'GPT-4.1'},S.defaults,options).allowed,false);
    const second=w.document.createElement('button');second.textContent='Balanserad';second.setAttribute('data-composer-navigation-target','reasoning');w.document.querySelector('form').append(second);
    assert.equal(w.GreenfieldModelObservation.observe().ambiguous,true);
  }finally{dom.window.close();}
});

function harness({next=true,paused=false,stop=false,queueChanged=false,nextPaused=false,crashAfterCheckpoint=false}={}) {
  let current=worker(),persisted=null;const events=[],sent=[];
  let queue=normalizeMissionWorkQueue({workerId:'worker-a',windowId:1,queueId:'queue-a',enabled:true,activeItemId:'item-a',items:[
    {itemId:'item-a',savedMissionId:'mission-a',goal:current.goal,status:'ACTIVE',order:0,maxInteractions:5,quantumProgress:2},
    {itemId:'copy-a',savedMissionId:'mission-a',goal:current.goal,status:'READY',order:1,maxInteractions:5},
    ...(next?[{itemId:'item-b',savedMissionId:'mission-b',goal:'GF-4.24.1004',status:nextPaused?'PAUSED':'READY',pauseUntilMs:nextPaused?Date.now()+3600000:0,order:2,maxInteractions:5}]:[])
  ]},{workerId:'worker-a',windowId:1});
  const deps={...transport,PHASES,QUEUE_STATUS,conversationKey,deepClone:clone,nowIso:()=>new Date().toISOString(),
    sourceResponseAlreadyDelivered:(_,v)=>v.complete===true,hasCurrentGenerationEvidence,providerTransportPending,createWaitingRefreshState,
    scheduleFast:()=>{},transportTransitionBoundary:async()=>stop?{blocked:true,process:{...current,phase:'STOPPED'}}:{blocked:false,process:current},
    readSafety:async()=>({admissionPaused:paused}),
    holdForSafety:async(p,d)=>{events.push(['hold',d.code]);return current={...p,safety:{...p.safety,hold:d}};},
    saveObserved:async(p,patch)=>current={...p,...patch},
    commitTransition:async(p,phase,patch,options)=>{if(options.beforeSave){const b=await options.beforeSave();if(b.blocked)return b.process;}return current=transitionProcess(p,phase,patch);},
    missionQueueForWindow:async()=>({queue:clone(queue),settings:{}}),queueItemForProcess:(q,p)=>q.items.find(i=>i.itemId===p.queueContext?.itemId),
    queueResumeRecordFromAnalysis:({current,effectiveNextPrompt,...rest})=>({objective:effectiveNextPrompt,retainedObjective:current.goal,...rest}),
    sessionRotationSourceState:()=> 'PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE',
    queueActivationEffectBoundary:async()=>queueChanged?{blocked:true,process:current}:{},
    readNextInstruction:async()=>null,applyQueueParkTransition,latestResponseRoundTripMs,selectNextMissionItem,
    cancelSchedulerProcess:async(p,reason)=>events.push(['release',p.processId,reason]),recordIncident:async()=>{},
    chrome:{alarms:{clear:async()=>{}}},alarmName:id=>id,missionPauseAlarmName:id=>id,
    persistMissionQueue:async q=>{events.push(['persist']);persisted=clone(q);queue=clone(q);
      if(crashAfterCheckpoint){crashAfterCheckpoint=false;throw new Error('SIMULATED_WORKER_STOP');}return queue;},
    activateQueueItem:async({item,queue:q})=>{events.push(['activate',item.itemId]);assert.ok(persisted,'checkpoint precedes activation');
      return {process:current={...worker(),processId:'p-next',queueContext:{queueId:q.queueId,itemId:item.itemId,savedMissionId:item.savedMissionId},phase:'SENDING'}};},
    enterQueueWait:async(p,q,opts)=>{events.push(['idle']);return current={...p,phase:'QUEUE_WAIT',queueContext:null,queueWait:opts};}
  };
  Object.assign(deps,{reviveOwnershipContentionBlocks, queueItemNeedsEffectReconciliation:fn('queueItemNeedsEffectReconciliation',deps), syncMissionQueueWakeAlarm:async()=>{}});
  deps.activateRunnableQueueSuccessor=fn('activateRunnableQueueSuccessor',deps);
 deps.finishParkedQueueHandoff=deps.enterQueueWait; // handoff fences are covered by queue-handoff.test.mjs
  deps.parkSlotAndActivateNext=fn('parkSlotAndActivateNext',deps);
  // Baseline has no scoped exhaustion handler. The negative control reports
  // a deliberate failure instead of silently substituting the new function.
  deps.parkExhaustedDelivery=background.includes('async function parkExhaustedDelivery(')?fn('parkExhaustedDelivery',deps):async()=>assert.fail('baseline has no scoped exhaustion handler');
  deps.maybeEscalateWaitingRefresh=async()=>({handled:false,process:current});
  const timeout=fn('maybeHandleDeliveryTimeout',deps),guard=fn('guardShortContinuation',{...deps,autonomousResponseObservation:()=>({ready:false,observation:{}})});
  return {events,sent,guard,get current(){return current;},set current(p){current=p;},get queue(){return queue;},get persisted(){return persisted;},
    async fail(v=page(current)) {
      current.deliveryNotice={promptHash:current.lastPrompt.hash,firstSeenAtMs:Date.now()-DELIVERY_NOTICE_SETTLE_MS-1};
      const result=await timeout(current,v);current=result.process;return current;
    },
    acknowledge(){assert.equal(current.pendingPrompt.text,'Fortsätt');assert.equal(current.pendingPrompt.postDelaySeconds,0);
      sent.push(current.pendingPrompt.text);current={...current,phase:'WAITING',lastPrompt:{...current.pendingPrompt,acknowledged:true,dispatchedUserTurnId:'continue-'+sent.length,conversationKey:conversationKey(url)},pendingPrompt:null};
      // A real restart serializes this same checkpoint; no in-memory budget.
      current=JSON.parse(JSON.stringify(current));
    }
  };
}

test('three consecutive Fortsätt then one independent activation; checkpoint, root, counters and unknown effects preserved',async()=>{
  assert.equal(DELIVERY_CONTINUATION_MAX_ATTEMPTS,3);
  const h=harness(),original=clone(h.current);
  for(let n=1;n<=3;n++){await h.fail();assert.equal(h.current.phase,'SENDING');assert.equal(h.current.deliveryRetry.attempts,n);h.acknowledge();}
  await h.fail();assert.deepEqual(h.sent,['Fortsätt','Fortsätt','Fortsätt']);
  assert.equal(h.current.queueContext.itemId,'item-b');assert.equal(h.events.filter(e=>e[0]==='activate').length,1);
  const [a,copy]=h.queue.items;for(const i of [a,copy]){assert.equal(i.status,'BLOCKED');assert.equal(i.blockedRetryAtMs,0);
    assert.equal(i.processSnapshot.deliveryRetry.status,'EXHAUSTED');assert.deepEqual(i.processSnapshot.deliveryRetry.rootPrompt,original.lastPrompt);
    assert.deepEqual(i.processSnapshot.lastResponse,original.lastResponse);assert.deepEqual(i.processSnapshot.ownerProgress,original.ownerProgress);
    assert.equal(i.resume.objective.length,1465);assert.equal(i.processSnapshot.turn,8);assert.deepEqual(i.processSnapshot.sessionBroker,original.sessionBroker);}
  assert.equal(a.quantumProgress,2);assert.equal(a.processSnapshot.phase,'BLOCKED');
  assert.equal(publicMissionWorkQueue(h.queue).items[0].lastOutcome,'DELIVERY_CONTINUATION_LIMIT');
  assert.equal(selectNextMissionItem({...h.queue,items:[a,copy]},{now:Date.now()+7*86400000}),null);
  await assert.rejects(prepareDeliveryContinuation(a.processSnapshot,page(a.processSnapshot)),/DELIVERY_CONTINUATION_LIMIT/);
});
for(const options of [{next:false},{nextPaused:true}])test(`no independent runnable item => bounded QUEUE_WAIT ${JSON.stringify(options)}`,async()=>{
  const h=harness(options);for(let n=0;n<3;n++){await h.fail();h.acknowledge();}await h.fail();
  assert.equal(h.current.phase,'QUEUE_WAIT');assert.equal(h.events.filter(e=>e[0]==='activate').length,0);
  assert.equal(h.queue.items[0].status,'BLOCKED');
});
for(const options of [{paused:true},{stop:true},{queueChanged:true}])test(`exhaustion respects operator/queue boundary ${JSON.stringify(options)}`,async()=>{
  const h=harness(options),p=h.current;
  h.current={...p,deliveryRetry:{rootPrompt:p.lastPrompt,sourcePrompt:p.lastPrompt,sessionSeq:1,attempts:3},lastPrompt:{...p.lastPrompt,transportKind:DELIVERY_CONTINUATION}};
  await h.fail();assert.equal(h.persisted,null);assert.equal(h.events.filter(e=>['release','activate'].includes(e[0])).length,0);
});
test('completed late answer, active generation and provider pending notice never trigger a short retry',async()=>{
  for(const extra of [{complete:true},{generating:true},{providerNotices:{deliveryTimeout:true,processingNotice:true}}]){
    const h=harness();await h.fail({...page(h.current),...extra});assert.equal(h.current.pendingPrompt,null);assert.equal(h.persisted,null);
  }
});
test('restart after checkpoint publication completes the handoff once without a fourth prompt',async()=>{
  const h=harness({crashAfterCheckpoint:true});for(let n=0;n<3;n++){await h.fail();h.acknowledge();}
  await assert.rejects(h.fail(),/SIMULATED_WORKER_STOP/);assert.equal(h.queue.activeItemId,'');
  h.current=JSON.parse(JSON.stringify(h.current));await h.fail();
  assert.equal(h.current.queueContext.itemId,'item-b');assert.equal(h.sent.length,3);
  assert.equal(h.events.filter(e=>e[0]==='activate').length,1);
});
test('retry budgets and usage receipts are isolated across workers; new work starts a fresh budget',async()=>{
  const a=worker(),b={...worker(),processId:'p-other',workerId:'worker-other',runId:'run-other'};
  const one=await prepareDeliveryContinuation(a,page(a)),other=await prepareDeliveryContinuation(b,page(b));
  assert.equal(one.pendingPrompt.hash,other.pendingPrompt.hash);assert.notEqual(one.pendingPrompt.transportId,other.pendingPrompt.transportId);
  assert.notEqual(usageIdentity(a,one.pendingPrompt),usageIdentity(b,other.pendingPrompt));
  a.deliveryRetry={...one.deliveryRetry,attempts:3,status:'COMPLETED'};
  a.lastPrompt={...a.lastPrompt,hash:'new-work-hash',dispatchedUserTurnId:'new-work-user'};
  const fresh=await prepareDeliveryContinuation(a,page(a));assert.equal(fresh.deliveryRetry.attempts,1);
  assert.equal(fresh.deliveryRetry.rootPrompt.hash,'new-work-hash');assert.equal(other.deliveryRetry.attempts,1);
});
test('unsent continuation cancellation refunds the attempt; an uncertain dispatch is retained',async()=>{
  const h=harness();await h.fail();let p=h.current;const v={...page({...p,lastPrompt:p.deliveryRetry.sourcePrompt}),providerNotices:{}};
  const result=await h.guard(p,v);assert.equal(result.process.phase,'WAITING');assert.equal(result.process.deliveryRetry.attempts,0);
  h.current=worker();await h.fail();p=h.current;p.pendingPrompt.dispatch={effectPossible:null};
  assert.equal((await h.guard(p,v)).handled,false);assert.equal(p.deliveryRetry.attempts,1);
});
test('pre-send guard accepts collapsed source but refuses another user; identical Fortsätt cannot acknowledge itself',async()=>{
  const h=harness();await h.fail();const p=h.current,v=page({...p,lastPrompt:p.deliveryRetry.sourcePrompt});
  assert.equal((await h.guard(p,v)).handled,false);
  const bad=await h.guard(p,{...v,lastUserId:'different-user'});assert.equal(bad.process.safety.hold.code,'DELIVERY_SOURCE_TURN_UNPROVEN');
  v.lastUserHash=p.pendingPrompt.hash;v.autonomousTurn.userTextHash=p.pendingPrompt.hash;
  assert.equal(deliveryFencePage(p.pendingPrompt,v).lastUserHash,'');assert.equal(deliveryFencePage(p.pendingPrompt,v).autonomousTurn.userTextHash,'');
});

function notices(html) {
  const dom=new JSDOM(html,{url,runScripts:'outside-only'}),w=dom.window;
  w.visible=()=>true;w.OVERLAY_ID='greenfield-overlay';w.MESSAGE_TURN_SELECTOR='article';w.SHELL_MESSAGE_SELECTOR='[data-testid="message"]';
  w.PROVIDER_PROCESSING_NOTICE_MAX_CHARS=240;w.providerProcessingNoticeText=s=>/^Our systems are/.test(s);
  const start=content.indexOf('  const PROVIDER_PROCESSING_NOTICE_PROBE'),end=content.indexOf('\n  function pageHealthState',start);
  w.eval(content.slice(start,end)+'\nwindow.detect=providerTransportNotices;');
  return {w,detect:()=>w.detect({owner:w.document.querySelector('#user')},null,''),close:()=>w.close()};
}
const failureCopy=[
  'Meddelandet kunde inte levereras inom tidsgränsen. Försök igen.',
  'Something went wrong while generating the response. Please try again.',
  'There was an error generating a response.', 'A network error occurred. Please try again.',
  'The request timed out. Please try again.', 'Jokin meni pieleen. Yritä uudelleen.',
  'Die Nachricht konnte nicht zugestellt werden. Versuche es erneut.',
  'Une erreur s’est produite. Réessayez.', 'No se pudo entregar el mensaje. Inténtalo de nuevo.',
  'Si è verificato un errore. Riprova.', 'Ocorreu um erro. Tente novamente.',
  'Er is iets misgegaan. Probeer het opnieuw.', 'Wystąpił błąd. Spróbuj ponownie.',
  'Произошла ошибка. Повторите попытку.', 'エラーが発生しました。もう一度お試しください。',
  '发生了错误。请重试。', '오류가 발생했습니다. 다시 시도하세요.', 'حدث خطأ. حاول مرة أخرى.'
];
for(const copy of failureCopy)test(`provider failure UI: ${copy}`,()=>{
  const f=notices(`<article id="user" data-message-author-role="user">work</article><article><div role="alert">${copy}</div></article>`);
  try{assert.equal(f.detect().deliveryTimeout,true);}finally{f.close();}
});
test('failure text in prompts, answer prose, stale turns, code, overlay and composer is not a transport error',()=>{
  for(const html of [
    '<article id="user" data-message-author-role="user">Something went wrong</article>',
    '<article id="user">work</article><article data-message-author-role="assistant">Something went wrong</article>',
    '<article id="user">work</article><article><div class="markdown" role="alert">Something went wrong</div></article>',
    '<article role="alert">Something went wrong</article><article id="user">work</article>',
    '<article id="user">work</article><pre>Something went wrong</pre>',
    '<article id="user">work</article><div id="greenfield-overlay">Something went wrong</div>',
    '<article id="user">work</article><form>Something went wrong</form>'
  ]) {const f=notices(html);try{assert.equal(f.detect().deliveryTimeout,false,html);}finally{f.close();}}
});
test('structured provider error inside assistant chrome is retried; connection waiting, quota and refusals are not',()=>{
  let f=notices('<article id="user">work</article><article data-message-author-role="assistant"><div role="alert">Something went wrong</div></article>');
  try{assert.equal(f.detect().deliveryTimeout,true);}finally{f.close();}
  for(const copy of ['Anslutningen bröts. Väntar på hela svaret','You have reached your usage limit','I cannot help with this request']){
    f=notices(`<article id="user">work</article><div role="alert">${copy}</div>`);
    try{assert.equal(f.detect().deliveryTimeout,false);}finally{f.close();}
  }
});

for(const change of ['none','conversation','user','causal','late-answer','pending','quota','maximum','pro'])test(`real submitPrompt final click guard and idempotent dispatch: ${change}`,async()=>{
  const dom=new JSDOM('<form><textarea></textarea><button type="button" id="send">Send</button></form>',{url,runScripts:'outside-only'});
  const w=dom.window;let clicks=0,authorized=false;
  try {
    w.eval(policy);const S=w.GreenfieldSafetyPolicy,gptRoot='https://chatgpt.com/g/g-test';
    const evidence=()=>({...captured.p59.evidence,modelLabel:'',effortLabel:authorized&&change==='pro'?'Pro':'Extra hög',ambiguous:false,mode:'CHAT',observedAtMs:Date.now(),
      quota:{active:authorized&&change==='quota'},highestEffort:authorized&&change==='maximum'?null:
        {...captured.p59.evidence.highestEffort,label:'Extra hög',value:'max',target:'4',strategy:'ORDINAL_TARGET',verifiedAtMs:Date.now()}});
    const textarea=w.document.querySelector('textarea'),send=w.document.querySelector('#send');send.addEventListener('click',()=>clicks++);
    Object.assign(w,{DOCUMENT_ID:'document',dispatchRecords:new Map(),assertContentActive:()=>{},forensic:()=>{},serializeError:e=>({code:e.code}),
      GreenfieldModelObservation:{observe:evidence},getComposer:()=>textarea,getSendButton:()=>send,
      normalizeText:s=>String(s).trim(),sha256Hex:async s=>s==='Fortsätt'?'continue-hash':'other',setNativeValue:(el,value)=>{el.value=value;},
      pageState:async()=>({modelEvidence:evidence(),composerEmpty:!textarea.value,composerTextHash:textarea.value?'continue-hash':'',
        userCount:5,assistantCount:5,lastUserId:authorized&&change==='user'?'other':'original',lastUserHash:'collapsed-hash',
        autonomousTurn:{resolvedUserTurnId:authorized&&change==='causal'?'other':'original'},
        assistantHash:authorized&&change==='late-answer'?'new-answer':'shell',
        providerNotices:{deliveryTimeout:true,processingNotice:authorized&&change==='pending'}}),
      sendRuntimeMessage:async()=>{authorized=true;if(change==='conversation')w.history.pushState({},'','/g/g-test/c/other');
        return {ok:true,policy:S.defaults,gptRoot,transportContext:{kind:DELIVERY_CONTINUATION,sourceUserTurnId:'original',
          sourcePromptHash:'full-original-hash',baselineAssistantHash:'shell',requiredConversationKey:conversationKey(url)}};},
      promptMarkerValue:s=>s,materializedUserTurnReceipt:()=>({userTurnId:"fixture-user",userTurnIndex:0}),publishDispatchMaterialization:async()=>({userTurnId:'new-continue'}),
      waitForMaterialization:async()=>({acknowledged:true,evidence:'USER_TURN',elapsedMs:1,state:{}})});
    w.eval(['normalizeComposerText','readComposerValue','submitPrompt'].map(name=>fnSource(name,content,'  ')).join('\n')+'\nwindow.submit=submitPrompt;');
    const args=['Fortsätt','continue-hash','dispatch-unique',{policy:S.defaults,gptRoot}];
    const result=await w.submit(...args);
    assert.equal(result.ok,change==='none',result.code);assert.equal(clicks,change==='none'?1:0);
    await w.submit(...args);assert.equal(clicks,change==='none'?1:0,'same dispatch id never clicks twice');
  }finally{w.close();}
});
