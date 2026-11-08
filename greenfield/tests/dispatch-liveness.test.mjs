import {withReasoningDependencies} from './fixtures/reasoning-dependencies.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {setImmediate as turn} from 'node:timers/promises';
import {JSDOM} from 'jsdom';

// Run identical behavioral checks against the immutable prior release.
const root=process.env.GREENFIELD_DISPATCH_BASELINE
  ? pathToFileURL(resolve(process.env.GREENFIELD_DISPATCH_BASELINE)+'/') : new URL('../',import.meta.url);
const bg=await readFile(new URL('background.js',root),'utf8');
const content=await readFile(new URL('content.js',root),'utf8');
const {withMissionOwner,claimMissionOwnership,readMissionOwnership,missionOwnershipKey}=await import(new URL('lib/mission-ownership.mjs',root));
const {saveProcess,loadProcessForWindow}=await import(new URL('lib/process-store.mjs',root));
const {restoreWorkerBinding}=await import(new URL('lib/worker-identity.mjs',root));
const {jsonEqual}=await import(new URL('lib/canonical-json.mjs',root));
const {createProcess,ownerToken,isCurrentToken}=await import(new URL('lib/state.mjs',root));
const {createKeyedQueue}=await import(new URL('lib/keyed-queue.mjs',root));
const {readSafety,reserveUsage,authorizeUsageSend,usageIdentity,budgetDecision}=await import(new URL('lib/usage-governor.mjs',root));
const {PHASES,TERMINAL_PHASES}=await import(new URL('lib/contracts.mjs',root));
const hash=s=>createHash('sha256').update(s).digest('hex');
function source(name,text=bg,indent='') {
  const start=new RegExp(`^${indent}(?:async )?function ${name}\\(`,'m').exec(text);
  assert.ok(start,`actual runtime function ${name}`);
  const tail=text.slice(start.index),end=new RegExp(`^${indent}}\\s*$`,'m').exec(tail);
  return tail.slice(0,end.index+end[0].length);
}
function fn(name,deps,text=bg) { return Function(...Object.keys(withReasoningDependencies(deps)),source(name,text)+`;return ${name}`)(...Object.values(deps)); }
function storage(seed={}) {
  const data=structuredClone(seed);return {data,
    async get(keys){return keys==null?structuredClone(data):Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]))},
    async set(v){Object.assign(data,structuredClone(v))},
    async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};
}
async function dispatchHarness({dropReply=false}={}) {
  const local=storage(),session=storage(),queues=createKeyedQueue();
  await restoreWorkerBinding(1,'worker-a',session);
  const p=createProcess({windowId:1,tabId:11,workerId:'worker-a',goal:'GF-1.2.1022',initialPrompt:'work'});
  p.pendingPrompt.hash=hash('work');p.pendingPrompt.sendAttempts=1;
  p.pendingPrompt.dispatch={operationId:'send-a',startedAt:new Date().toISOString(),status:'PREPARED',effectPossible:null,
    baselineDocumentId:'doc-a',baselineUserCount:0,baselineLastUserId:'',promptMarker:'marker-a'};
  const proof={allowed:true,highestEffortVerified:true,observedAtMs:Date.now(),promptHash:p.pendingPrompt.hash};
  p.safety={turnProof:proof};
  await claimMissionOwnership(p,{storage:local});await saveProcess(p,local,session);
  await reserveUsage({id:usageIdentity(p,p.pendingPrompt),processId:p.processId,workerId:p.workerId,prompt:'work',proof},local);
  const sender={id:'extension',tab:{id:11,windowId:1}},events=[],receipts=[];
  const deps={chrome:{runtime:{id:'extension'},storage:{local,session}},queues,PHASES,ownerToken,isCurrentToken,
    runtimeFault:'',readSafety:()=>readSafety(local),authorizeUsageSend:(id,dispatch)=>authorizeUsageSend(id,dispatch,local),
    usageIdentity,maintainLocalStorage:async()=>{},withMissionOwner,
    loadProcessForWindow:id=>loadProcessForWindow(id,local,session),
    saveProcess:p=>saveProcess(p,local,session),nowIso:()=>new Date().toISOString(),
    audit:async(p,kind)=>events.push(kind),scheduleFast:()=>{},promptCausalMarker:()=> 'marker-a',
    errorRecord:e=>({code:e.code,message:e.message}),TAB_HEALTH:{SUBMIT_TIMEOUT_MS:90000},
    isInitializationPrompt:()=>false};
  if(bg.includes('function dispatchPostTime('))deps.dispatchPostTime=fn('dispatchPostTime',{});
  if(bg.includes('function persistDispatchMaterialization('))deps.persistDispatchMaterialization=fn('persistDispatchMaterialization',deps);
  const receipt=fn('recordDispatchMaterialization',deps),authorize=fn('authorizeDispatch',deps);
  const dom=new JSDOM('<textarea></textarea><button>Send</button>',{url:'https://chatgpt.com/c/source',runScripts:'outside-only'}),w=dom.window;
  let clicks=0,receiptCalled=false,expire,replyDone=false;
  const composer=w.document.querySelector('textarea'),button=w.document.querySelector('button');
  button.click=()=>{clicks++};
  const after={lastUserId:'user-a',userCount:1,autonomousTurn:{expectedPromptMarker:'marker-a',resolvedBy:'PROMPT_MARKER',resolvedUserTurnId:'user-a',userTextHash:hash('work')}};
  Object.assign(w,{DOCUMENT_ID:'doc-a',dispatchRecords:new Map(),assertContentActive:()=>{},forensic:()=>{},serializeError:e=>({code:e.code}),
    GreenfieldSafetyPolicy:{evaluateModel:()=>proof},GreenfieldModelObservation:{observe:()=>({})},
    getComposer:()=>composer,getSendButton:()=>button,normalizeText:s=>String(s).trim(),sha256Hex:async s=>hash(s),
    setNativeValue:(el,v)=>{el.value=v},promptMarkerValue:s=>s,
    pageState:async()=>({modelEvidence:{},composerEmpty:!composer.value,composerTextHash:hash(composer.value),userCount:0,assistantCount:0}),
    waitForMaterialization:async()=>({acknowledged:true,state:after,evidence:'PROMPT_MARKER'}),
    sendRuntimeMessage:message=>{
      if(message.type==='EIC_GF_AUTHORIZE_DISPATCH')return authorize(message,sender);
      if(message.type==='EIC_GF_DISPATCH_MATERIALIZED'){
        receiptCalled=true;const job=receipt(message,sender);receipts.push(job);return job;
      }
      throw Error(message.type);
    }});
  w.setTimeout=callback=>{queueMicrotask(callback);return 1};
  w.eval(['normalizeComposerText','readComposerValue','materializedUserTurnReceipt','publishDispatchMaterialization','submitPrompt'].map(name=>source(name,content,'  ')).join('\n')+'\nwindow.submit=submitPrompt;');
  deps.bridgeMessage=async()=>{
    const submitted=w.submit('work',p.pendingPrompt.hash,'send-a',{policy:{},gptRoot:w.location.href},'marker-a');
    return Promise.race([submitted.then(r=>dropReply?new Promise(()=>{}):r),new Promise((_,reject)=>{expire=()=>reject(Object.assign(Error('CONTENT_BRIDGE_TIMEOUT'),{code:'CONTENT_BRIDGE_TIMEOUT'}))})]);
  };
  const send=fn('contentSend',deps);
  const job=queues.enqueue(p.processId,async()=>{
    const result=await send(p,p.pendingPrompt,'send-a');
    const next={...p,phase:'WAITING',pendingPrompt:null,lastPrompt:{hash:p.pendingPrompt.hash,dispatchId:'send-a',dispatchedUserTurnId:'user-a'}};
    await saveProcess(next,local,session);replyDone=true;return result;
  });
  job.catch(()=>{});
  return {p,local,session,events,job,receipts,queues,receipt,sender,
    get receiptCalled(){return receiptCalled},get replyDone(){return replyDone},get clicks(){return clicks},
    expire:()=>expire?.(),read:()=>loadProcessForWindow(1,local,session),
    async close(){expire?.();await job.catch(()=>{});await Promise.allSettled(receipts);w.close()}};
}
async function flushUntil(predicate){const deadline=Date.now()+2000;while(!predicate()&&Date.now()<deadline)await turn();assert.ok(predicate(),'fixture reached the intended runtime seam');}

test('owner-fenced content send completes without waiting for its 90-second deadline',async()=>{
  const h=await dispatchHarness();try{
    await flushUntil(()=>h.receiptCalled);
    const deadline=Date.now()+500;while(!h.replyDone&&Date.now()<deadline)await turn();
    assert.equal(h.replyDone,true,'receipt must not await the mission lock held by its own send');
    const result=await h.job;await Promise.all(h.receipts);
    assert.equal(result.materializedReceipt.userTurnId,'user-a');assert.equal(h.clicks,1);
    assert.equal((await h.read()).phase,'WAITING','late receipt cannot overwrite committed WAITING');
    assert.ok(!h.events.includes('PROMPT_DISPATCH_TRANSPORT_ERROR'));
  }finally{await h.close()}
});
test('lost content reply still persists the exact original receipt after timeout without replay',async()=>{
  const h=await dispatchHarness({dropReply:true});try{
    await flushUntil(()=>h.receiptCalled);h.expire();await assert.rejects(h.job,/CONTENT_BRIDGE_TIMEOUT/);
    await Promise.all(h.receipts);const current=await h.read();
    assert.equal(current.pendingPrompt.dispatch.materializedUserTurnId,'user-a');
    assert.equal(current.pendingPrompt.dispatch.effectPossible,true);assert.equal(h.clicks,1);
  }finally{await h.close()}
});

test('a delayed receipt cannot overwrite STOPPED or a different current dispatch',async()=>{
  const h=await dispatchHarness();try{
    await h.job;await Promise.all(h.receipts);
    const message={type:'EIC_GF_DISPATCH_MATERIALIZED',dispatchId:'send-a',promptHash:h.p.pendingPrompt.hash,
      documentId:'doc-a',receipt:{userTurnId:'user-a',userTurnIndex:0,userCount:1,resolvedBy:'PROMPT_MARKER',promptMarker:'marker-a'}};
    for(const phase of ['STOPPED','SENDING']){
      const next={...await h.read(),phase,pendingPrompt:phase==='SENDING'
        ? {...h.p.pendingPrompt,dispatch:{...h.p.pendingPrompt.dispatch,operationId:'send-b'}}:null};
      await saveProcess(next,h.local,h.session);
      assert.equal((await h.receipt(message,h.sender)).ok,false);
      assert.deepEqual(await h.read(),next);
    }
    assert.equal(h.clicks,1);
  }finally{await h.close()}
});

test('earlier process wake preempts an existing later timer',()=>{
  let now=100000;const tasks=new Map(),fastTimers=new Map();let id=0;
  const deps={FAST_RECHECK_MS:100,fastTimers,Date:{now:()=>now},
    setTimeout:(fn,delay)=>{tasks.set(++id,{fn,due:now+delay});return id},clearTimeout:id=>tasks.delete(id),enqueueTick:()=>{}};
  const schedule=fn('scheduleFast',deps);schedule('a',30000);now+=1000;schedule('a',100);
  assert.equal(tasks.size,1);assert.equal([...tasks.values()][0].due,now+100,'receipt wake must not hide behind an old pacing timer');
  schedule('b',500);assert.equal(tasks.size,2,'independent workers retain independent timers');
  now+=10;schedule('a',30000);assert.equal([...tasks.values()].filter(t=>t.due===101100).length,1);
});
test('early held tick re-arms its exact retry instead of consuming the wake silently',async()=>{
  const now=100000,p={processId:'held',phase:'WAITING',safety:{hold:{code:'LOCAL_PACING_WAIT',retryAtMs:now+5000}}},wakes=[];
  const deps={runtimeReady:Promise.resolve(),runtimeFault:'',PHASES,TERMINAL_PHASES,Date:{now:()=>now},
    findProcessById:async()=>p,missionOwnershipKey:()=>'',chrome:{tabs:{get:async()=>null}},readSafety:async()=>({}),
    scheduleFast:(...args)=>wakes.push(args),syncSafetyRetryAlarm:async()=>{}};
  await fn('tickProcess',deps)(p.processId);
  assert.deepEqual(wakes,[['held',5000]]);
});

test('free parallel capacity does not override the independently configured 180-second budget gap',async()=>{
  const local=storage(),now=1000000;
  assert.equal((await reserveUsage({id:'one',processId:'one',workerId:'one',prompt:'work',proof:{allowed:true,observedAtMs:now},now},local)).allowed,true);
  const v=await readSafety(local);
  assert.equal(budgetDecision(v,'two','work',now+115000).code,'LOCAL_PACING_WAIT');
  assert.equal(budgetDecision(v,'two','work',now+180000).allowed,true);
});

test('legacy unsent recovery saves under one mission fence and preserves mission identity',async()=>{
  const local=storage(),session=storage();await restoreWorkerBinding(1,'old',session);
  const p=createProcess({windowId:1,tabId:2,workerId:'old',goal:'GF-1.2.1022',initialPrompt:'work'});
  p.phase='BLOCKED';p.version='1.9.19';p.lastError={code:'SESSION_ROTATION_CHAT_READY_TIMEOUT'};
  p.pendingPrompt.text=JSON.stringify({process:{generation:p.generation},objective:'frozen'});
  p.pendingPrompt.hash=hash(p.pendingPrompt.text);await claimMissionOwnership(p,{storage:local});await saveProcess(p,local,session);
  const deps={unsentQueueRotationCandidate:()=>true,sha256Hex:async s=>hash(s),withMissionOwner,readMissionOwnership,missionOwnershipKey,
    chrome:{storage:{local,session}},loadMissionWorkQueue:async()=>({}),readSafety:async()=>({}),getWorkerBinding:async()=>({workerId:'old'}),
    loadProcessForWindow:id=>loadProcessForWindow(id,local,session),saveProcess:p=>saveProcess(p,local,session),jsonEqual,
    terminalQueueDispatchOwner:()=>true,APP_VERSION:'1.9.22',PHASES,nowIso:()=>new Date().toISOString(),isCurrentToken,ownerToken,audit:async()=>{}};
  const job=fn('recoverUnsentQueueRotation',deps)(p,'test');let settled=false;job.then(()=>{settled=true});
  const deadline=Date.now()+500;while(!settled&&Date.now()<deadline)await turn();
  assert.equal(settled,true,'migration must not recursively acquire its own non-reentrant mission fence');
  const next=await job;assert.equal(next.phase,'ROTATING');assert.equal(next.generation,p.generation+1);
  assert.equal(next.processId,p.processId);assert.equal(next.runId,p.runId);assert.equal(next.pendingPrompt.sendAttempts,0);
});

test('dispatch post time uses the proven click instead of a delayed reply; invalid timestamps stay conservative',()=>{
  const time=fn('dispatchPostTime',{}),start=Date.parse('2026-10-18T09:24:06.522Z');
  const pending={hash:'hash-a',dispatch:{operationId:'send-a',baselineDocumentId:'doc-a',startedAt:new Date(start).toISOString()}};
  const receipt={dispatchId:'send-a',documentId:'doc-a',promptHash:'hash-a',postedAtMs:start+500};
  const later=start+90514;
  assert.equal(time(pending,receipt,later),start+500);
  for(const bad of [{dispatchId:'other'},{documentId:'other'},{promptHash:'other'},{postedAtMs:start-1},{postedAtMs:later+1},{postedAtMs:0}])
    assert.equal(time(pending,{...receipt,...bad},later),later);
  assert.equal(time(pending,null,later),later,'do not backdate an unproven legacy effect');
  pending.dispatch.materializedUserTurnId='user-a';pending.dispatch.postedAtMs=receipt.postedAtMs;
  assert.equal(time(pending,null,later),receipt.postedAtMs);
});

test('finite safety deadline survives service-worker timer loss and is cleared on stop',async()=>{
  const now=100000,alarms=new Map(),p={processId:'p',phase:'SENDING',safety:{hold:{retryAtMs:now+7000}}};
  const sync=fn('syncSafetyRetryAlarm',{SAFETY_RETRY_PREFIX:'retry:',PHASES,TERMINAL_PHASES,Date:{now:()=>now},
    chrome:{alarms:{create:async(n,v)=>alarms.set(n,v),clear:async n=>alarms.delete(n)}}});
  await sync(p);assert.deepEqual(alarms.get('retry:p'),{when:107000});
  alarms.clear();await sync(p);assert.equal(alarms.size,1,'hydration reconstructs the deadline');
  await sync({...p,phase:'STOPPED'});assert.equal(alarms.size,0);
});

test('short remaining pacing is not rounded up to another 30 seconds',async()=>{
  const now=100000,alarms=[],wakes=[],saved=[];
  const deps={Date:{now:()=>now},PHASES,INCIDENT_QUIET_HOLD_CODES:new Set(['LOCAL_PACING_WAIT']),
    saveProcess:async p=>saved.push(structuredClone(p)),audit:async()=>{},broadcast:async()=>{},recordIncident:async()=>{},
    releaseSchedulerTurn:async()=>{},releaseGlobalPromptLease:async()=>{},scheduleFast:(id,ms)=>wakes.push(ms),
    syncSafetyRetryAlarm:async p=>alarms.push(p.safety.hold.retryAtMs)};
  const p={processId:'p',phase:'SENDING',pendingPrompt:{hash:'h'},safety:{}};
  const hold=fn('holdForSafety',deps);await hold(p,{code:'LOCAL_PACING_WAIT',retryAtMs:now+325});
  assert.equal(p.safety.hold.retryAtMs,now+325);assert.deepEqual(wakes,[325]);assert.deepEqual(alarms,[100325]);
  await hold(p,{code:'LOCAL_PACING_WAIT',retryAtMs:now+5000});assert.equal(saved.at(-1).safety.hold.retryAtMs,105000);
});

test('read-only pacing view combines the actual gates without adding delays or granting dispatch',async()=>{
  const {dispatchWaitView}=await import(new URL('lib/dispatch-wait.mjs',root));
  const now=1000000,local=storage();await reserveUsage({id:'prior',processId:'prior',workerId:'prior',prompt:'work',proof:{allowed:true,observedAtMs:now},now},local);
  const safety=await readSafety(local);safety.lastAuthorizedAtMs=now+200;safety.lastAuthorizedDispatchId='prior-send';
  const p={phase:'SENDING',runId:'next',sessionSeq:1,turn:1,pendingPrompt:{text:'work',hash:'next-hash',postDelaySeconds:115,
    promptPause:{reservationId:'slot',notBeforeAtMs:now+115000}}};
  const gate={lastPromptPostedAtMs:now+500,rateLimit:{state:'NORMAL'}};
  const before=JSON.stringify({p,safety,gate});const view=dispatchWaitView(p,safety,gate,now+1000);
  assert.equal(view.retryAtMs,now+180200);assert.equal(view.code,'LOCAL_PACING_WAIT');assert.equal(view.grantsDispatch,false);
  assert.equal(JSON.stringify({p,safety,gate}),before);
  assert.equal(dispatchWaitView(p,safety,gate,now+181000),null);
  assert.equal(dispatchWaitView({...p,pendingPrompt:{...p.pendingPrompt,dispatch:{effectPossible:null}}},safety,gate,now),null);
  assert.equal(dispatchWaitView(p,{...safety,admissionPaused:true},gate,now),null);
});

test('one post is committed once across reply, restart and later observation, including serial recovery',async()=>{
  const {commitGlobalPromptPost,GLOBAL_PROMPT_GATE_KEY}=await import(new URL('lib/global-prompt-gate.mjs',root));
  const local=storage({[GLOBAL_PROMPT_GATE_KEY]:{rateLimit:{state:'SERIAL_RECOVERY',epoch:1,serialSuccessCount:0}}});
  const a={reservationId:'slot-a',processId:'a',windowId:1,promptHash:'hash-a',postedAtMs:1000000,storage:local};
  const first=await commitGlobalPromptPost(a);assert.equal(first.rateLimit.serialSuccessCount,1);
  const restart=await import(new URL('lib/global-prompt-gate.mjs?restart-test',root));
  const duplicate=await restart.commitGlobalPromptPost({...a,postedAtMs:1090000});
  assert.equal(duplicate.lastPromptPostedAtMs,1000000);assert.equal(duplicate.rateLimit.serialSuccessCount,1);
  const b=await commitGlobalPromptPost({...a,reservationId:'slot-b',processId:'b',promptHash:'hash-b',postedAtMs:1200000});
  const late=await commitGlobalPromptPost({...a,postedAtMs:1400000});
  assert.equal(late.lastPromptPostedAtMs,b.lastPromptPostedAtMs);assert.equal(late.lastPromptProcessId,'b');
  assert.equal(late.rateLimit.serialSuccessCount,2);
  await assert.rejects(commitGlobalPromptPost({...a,promptHash:'wrong'}),/RECEIPT_MISMATCH/);
  const historical=await commitGlobalPromptPost({...a,reservationId:'old',postedAtMs:500000});
  assert.equal(historical.lastPromptPostedAtMs,1200000);assert.equal(historical.rateLimit.serialSuccessCount,2);
});

test('three real admission gates progress three windows at due times and never consume capacity while pacing',async t=>{
  const gate=await import(new URL('lib/global-prompt-gate.mjs',root));
  const scheduler=await import(new URL('lib/global-capacity-scheduler.mjs',root));
  const {reconcileDispatchObservation}=await import(new URL('lib/dispatch-reconciliation.mjs',root));
  const {markSessionHealthPromptPosted}=await import(new URL('lib/session-health.mjs',root));
  const start=2000000,local=storage(),session=storage(),posted=[],wakes=[],alarms=new Map();
  t.mock.timers.enable({apis:['Date'],now:start});
  const realChrome=globalThis.chrome;globalThis.chrome={storage:{local,session}};
  const processes=[];
  try {
    for(let i=1;i<=3;i++){
      const workerId=`worker-${i}`;await restoreWorkerBinding(i,workerId,session);
      const p=createProcess({windowId:i,tabId:i+10,workerId,goal:`GF-1.${i}.1000`,initialPrompt:`work-${i}`});
      p.pendingPrompt.hash=hash(p.pendingPrompt.text);p.pendingPrompt.postDelaySeconds=115;
      await claimMissionOwnership(p,{storage:local});await saveProcess(p,local,session);processes.push(p);
    }
    const read=p=>loadProcessForWindow(p.windowId,local,session);
    const deps={chrome:{storage:{local,session},alarms:{create:async(n,v)=>alarms.set(n,v),clear:async n=>alarms.delete(n)}},
      PHASES,TERMINAL_PHASES,SAFETY_RETRY_PREFIX:'retry:',INCIDENT_QUIET_HOLD_CODES:new Set(['LOCAL_PACING_WAIT']),
      tabState:async p=>({url:'https://chatgpt.com/c/source-'+p.windowId,documentId:'doc-'+p.windowId,userCount:posted.some(x=>x.windowId===p.windowId)?1:0,assistantCount:0,
        lastUserId:posted.some(x=>x.windowId===p.windowId)?'user-'+p.windowId:'',autonomousTurn:{resolvedUserTurnId:'user-'+p.windowId,resolvedBy:'USER_TURN_ID'},
        composerEmpty:true,modelEvidence:{},generating:false}),
      Safety:{evaluateModel:()=>({allowed:true,highestEffortVerified:true,observedAtMs:Date.now()})},
      ensureHighestThinkingBeforeSend:async(p,page)=>({handled:false,process:p,page}),
      maybeHandleLostConversation:async p=>({handled:false,process:p}),guardShortContinuation:async p=>({handled:false,process:p}),
      guardInitializationAckRepair:async p=>({handled:false,process:p}),maybeHandleProviderNotice:async p=>({handled:false,process:p}),
      maybeRecoverPageHealth:async p=>({handled:false,process:p}),consumeCheckpointedInstructions:async()=>{},
      providerTransportPending:()=>false,deliveryFencePage:(p,page)=>page,reconcileDispatchObservation,
      isTransportPrompt:()=>false,markSessionHealthPromptPosted,PROMPT_PROFILE:{COMPACT:'COMPACT'},
      readSafety:()=>readSafety(local),reserveUsage:o=>reserveUsage(o,local),budgetDecision,usageIdentity,sha256Hex:async s=>hash(s),
      maintainLocalStorage:async()=>{},saveProcess:p=>saveProcess(p,local,session),
      findProcessById:async id=>read(processes.find(p=>p.processId===id)),
      reserveGlobalPromptSlot:gate.reserveGlobalPromptSlot,claimGlobalPromptSend:gate.claimGlobalPromptSend,
      commitGlobalPromptPost:gate.commitGlobalPromptPost,releaseGlobalPromptLease:gate.releaseGlobalPromptLease,
      schedulerCapacityContext:async()=>({effectiveCapacity:3,configuredCapacity:3}),requestGlobalTurnSlot:scheduler.requestGlobalTurnSlot,
      releaseSchedulerTurn:async(p,o)=>scheduler.releaseGlobalTurnSlot({...o,processId:p.processId,storage:local,capacity:3}),
      wakeSchedulerProcesses:()=>{},normalizeGreenfieldPriority:s=>s,DEFAULT_GREENFIELD_PRIORITY:'NORMAL',
      audit:async()=>{},recordIncident:async()=>{},broadcast:async()=>{},scheduleFast:(id,ms)=>wakes.push({id,at:Date.now()+ms}),
      nowIso:()=>new Date().toISOString(),randomId:prefix=>prefix+'-'+Math.random(),ownerToken,isCurrentToken,promptCausalMarker:()=>'',
      enterRecovery:async(p,error)=>{throw error},
      contentSend:async(p,pending,operationId)=>{
        const auth=await authorizeUsageSend(usageIdentity(p,pending),operationId,local);assert.equal(auth.allowed,true);
        posted.push({windowId:p.windowId,at:Date.now()});
        return {ok:true,effectPossible:true,acknowledged:true,dispatchId:operationId,documentId:'doc-'+p.windowId,
          postedAtMs:Date.now(),materializedReceipt:{userTurnId:'user-'+p.windowId,userTurnIndex:0}};
      }};
    deps.syncSafetyRetryAlarm=fn('syncSafetyRetryAlarm',deps);
    deps.holdForSafety=fn('holdForSafety',deps);deps.sendingSafetyDecision=fn('sendingSafetyDecision',deps);
    deps.dispatchPostTime=fn('dispatchPostTime',deps);
    Object.assign(deps,{adoptSchedulerTurnForObservedEffect:async()=>{},conversationKey:s=>s,createWaitingRefreshState:()=>({}),resetRecovery:p=>p,
      commitTransition:async(p,phase,patch)=>{const next={...p,phase,...patch};await saveProcess(next,local,session);return next}});
    deps.commitObservedDispatchToWaiting=fn('commitObservedDispatchToWaiting',deps);const tick=fn('tickSending',deps);
    const advance=async seconds=>{
      t.mock.timers.setTime(start+seconds*1000);
      for(const original of processes){const p=await read(original);if(p.phase==='SENDING')await tick(p)}
    };
    await advance(0);assert.equal(posted.length,0);
    await advance(115);assert.deepEqual(posted.map(x=>x.windowId),[1]);
    await advance(230);assert.equal(posted.length,1);
    let state=await local.get('eic.gf.global-capacity-scheduler.v1');assert.equal(state['eic.gf.global-capacity-scheduler.v1'].activeTurns.length,1);
    assert.equal((await read(processes[1])).safety.hold.code,'LOCAL_PACING_WAIT');
    await advance(295);assert.deepEqual(posted.map(x=>x.windowId),[1,2]);
    await advance(345);assert.equal(posted.length,2);
    await advance(475);assert.deepEqual(posted.map(x=>x.windowId),[1,2,3]);
    assert.deepEqual(posted.map(x=>x.at-start),[115000,295000,475000]);
    state=await local.get('eic.gf.global-capacity-scheduler.v1');assert.equal(state['eic.gf.global-capacity-scheduler.v1'].activeTurns.length,3);
    assert.equal((await readSafety(local)).entries.length,3);
    await advance(1000);assert.equal(posted.length,3,'unknown/in-flight effects are never sent again');
    for(const original of processes){const p=await read(original);assert.equal(p.runId,original.runId);assert.equal(p.goal,original.goal);assert.equal(p.phase,'WAITING');
      assert.equal(p.lastPrompt.postedAtMs,posted.find(x=>x.windowId===p.windowId).at)}
  } finally {globalThis.chrome=realChrome;t.mock.timers.reset()}
});
