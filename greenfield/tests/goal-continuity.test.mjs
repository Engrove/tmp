import {dispatchedTurnQuality} from '../lib/turn-quality.mjs';
import {attachDispatchReceipt} from './fixtures/dispatch-receipt.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateOwnerProgress,readOwnerProgress,ownerProgressRequest,normalizeOwnerProgressEndpoint,ownerWaitRecord,ownerContinuation,appendProgressEvidence} from '../lib/owner-progress.mjs';
import {evaluateRuntimeControl,parseRuntimeControlRequest} from '../lib/runtime-control.mjs';
import {resolveGreenfieldControl,applyGreenfieldControlToDecision,eicHandoffWithoutNanoTask} from '../lib/greenfield-control.mjs';
import {DISPOSITIONS,normalizeHjalmarDecision,validateHjalmarDecision} from '../lib/hjalmar-d2.mjs';
import {evaluateContinuationAdmission} from '../lib/continuation-guard.mjs';
import {queueAfterResponseAction,QUEUE_AFTER_RESPONSE} from '../lib/queue-control-policy.mjs';
import {retireLogicalMissionSlots} from '../lib/queue-planning.mjs';
import {validateTargetResponse} from '../lib/response-contract.mjs';
import {completeBrokerTurn,sessionBrokerLimit} from '../lib/session-broker.mjs';
import {warmResumeDecision} from '../lib/warm-resume.mjs';
import {isRunnableQueueItem,selectNextMissionItem,normalizeMissionWorkQueue} from '../lib/mission-work-queue.mjs';
import {buildA2AEnvelope,validateA2AEnvelope} from '../lib/a2a.mjs';
import {transitionProcess,createProcess} from '../lib/state.mjs';
import {PHASES} from '../lib/contracts.mjs';
import {createOwnerProgressHandler} from '../../eic-integration/owner_progress_adapter.mjs';

const NOW=1792020000000;
const endpoint='https://api.elho.fi/greenfield/owner-progress/v1';
const target={runId:'run-a',turn:5,queueId:'queue-a',itemId:'item-a',savedMissionId:'mission-a'};
function processFixture() {return {...createProcess({workerId:'worker-a',windowId:1,tabId:2,goal:'GF-4.38.1002\nFrozen mission',initialPrompt:'bounded action'}),
  processId:'process-a',runId:target.runId,turn:target.turn,phase:'ANALYZING',queueContext:{...target,interactionCount:4,maxInteractions:5},sessionSeq:1,
  pendingPrompt:null,lastManagedUrl:'https://chatgpt.com/c/conversation-a',
  lastPrompt:{hash:'prompt-hash',acknowledged:true,dispatchedUserTurnId:'user-a',promptProfile:{schema:'eic.greenfield.prompt-profile.v1',ordinal:5}},
  lastResponse:{hash:'response-hash',text:'A substantive completed response.',contract:{ok:true,parseMode:'STRICT'},
    observation:{causalMatch:true,ownerTrusted:true,conversationKey:'https://chatgpt.com/c/conversation-a'}}};}
function receipt(request=ownerProgressRequest(processFixture(),'request-a'),kind='NEXT') {return {...request,
  receiptId:'receipt-a',stateRevision:'revision-a',observedAtMs:NOW,expiresAtMs:NOW+60000,disposition:kind,effectsReconciled:true,
  root:{ref:'root-a',revision:'r1',obligationsRef:'frozen-a',frozen:true,status:kind==='CLOSURE_READY'?'CLOSED':'OPEN',
    mandatorySatisfied:true,integrationVerified:true,cleanupVerified:true,ownerAccepted:true,acceptanceRef:'acceptance-a'},
  openObligations:kind==='CLOSURE_READY'?[]:['obligation-b'],
  next:{actionId:'action-b',obligationRef:'obligation-b',objective:'Implement the next dependency-ready bounded fix.',
    idempotencyKey:'effect-b',risk:'R1',authorized:true,dependencyReady:true},
  wait:{code:'DEPENDENCY',resumeCondition:'Owner publishes revision b.',eventRef:'owner:event-b',recheckAfterSeconds:300}};}
function owner(proof=null) {return {...target,queueManaged:true,item:{itemId:target.itemId,status:'ACTIVE'},responseHash:'response-hash',
  responseStrict:true,sourcePaired:true,effectUncertain:false,terminalProof:proof,nowMs:NOW,promptIssuedAtMs:NOW-1000};}
const proof={verified:true,disposition:'CLOSURE_READY',expiresAtMs:NOW+60000};
const request=()=>parseRuntimeControlRequest({target,actions:[{op:'COMPLETE_MISSION'}]});

test('a subtest PASS and model DONE without owner proof cannot retire a logical mission',()=>{
  const response={schema:'eic.a2a.response.v1',status:'DONE',summary:'One subtest passed.',workPerformed:[],evidence:[],blockers:[],nextSuggestedAction:''};
  assert.equal(validateTargetResponse(response).ok,true);
  assert.equal(evaluateRuntimeControl({status:'DONE',owner:owner()}).terminal.accepted,false);
  assert.notEqual(resolveGreenfieldControl({targetDisposition:'DONE',decision:{disposition:'DONE'}}).state,'DONE');
});
test('verified partial PASS with parent OPEN continues its exact owner action without another slot or GO',()=>{
  const v=receipt(); const before=structuredClone(v);const next=ownerContinuation(v);
  const d=resolveGreenfieldControl({targetDisposition:'DONE',decision:{disposition:'DONE'},terminalControl:{requested:true,accepted:false,nextObjective:next}});
  assert.equal(d.action,'NEXT');assert.equal(d.effectiveDisposition,'CONTINUE');assert.match(d.effectiveNextPrompt,/effect-b/);assert.deepEqual(v,before);
});
test('an independent R1 owner action proceeds despite an advisory blocker on another branch',()=>{
  const d=resolveGreenfieldControl({targetDisposition:'BLOCKED',decision:{disposition:'BLOCKED',humanAuthorityRequired:true},ownerNextObjective:ownerContinuation(receipt())});
  assert.equal(d.action,'NEXT');assert.equal(d.hardStop,false);
});
test('complete root proof admits the exact-target terminal; absent or malformed targets never bypass it',()=>{
  assert.equal(evaluateRuntimeControl({status:'DONE',request:request(),owner:owner(proof)}).terminal.accepted,true);
  for(const raw of [{target:{},actions:[{op:'COMPLETE_MISSION'}]},{target,actions:[{op:'UNKNOWN'}]},{actions:[]},{target,actions:[{op:'COMPLETE_MISSION',extra:true}]}])
    assert.equal(evaluateRuntimeControl({status:'DONE',request:parseRuntimeControlRequest(raw),owner:owner(proof)}).terminal.accepted,false);
});
for(const field of ['runId','turn','queueId','itemId','savedMissionId'])test(`cross-source terminal is rejected: ${field}`,()=>{
  const t={...target,[field]:field==='turn'?4:'other'};
  assert.equal(evaluateRuntimeControl({status:'DONE',owner:owner(proof),request:parseRuntimeControlRequest({target:t,actions:[{op:'COMPLETE_MISSION'}]})}).terminal.accepted,false);
});
for(const patch of [{responseStrict:false},{sourcePaired:false},{effectUncertain:true},{queueLoadError:true},{item:null},{item:{itemId:target.itemId,status:'PAUSED'}},{item:{itemId:target.itemId,status:'ACTIVE',operatorEditedAtMs:NOW}},{terminalProof:{...proof,expiresAtMs:NOW}}])test(`terminal guard refuses ${JSON.stringify(patch)}`,()=>{
  assert.equal(evaluateRuntimeControl({status:'DONE',owner:{...owner(proof),...patch},request:request()}).terminal.accepted,false);
});
test('owner acceptance must resolve all frozen root criteria',()=>{
  const q=ownerProgressRequest(processFixture(),'request-a'),v=receipt(q,'CLOSURE_READY');
  assert.equal(validateOwnerProgress(v,q,{now:NOW}).ok,true);
  for(const field of ['frozen','mandatorySatisfied','integrationVerified','cleanupVerified','ownerAccepted'])
    assert.equal(validateOwnerProgress({...v,root:{...v.root,[field]:false}},q,{now:NOW}).ok,false,field);
  for(const patch of [{effectsReconciled:false},{openObligations:['open']},{observedAtMs:NOW-180000},{expiresAtMs:NOW},{responseHash:'other'},{missionRef:'GF-1.2.9999'}])
    assert.equal(validateOwnerProgress({...v,...patch},q,{now:NOW}).ok,false);
});
test('bound owner root cannot change through instructions; empty progress arrays cannot infer closure',()=>{
  const q={...ownerProgressRequest(processFixture(),'request-a'),rootRef:'frozen-root'};
  assert.equal(validateOwnerProgress(receipt(q),q,{now:NOW}).code,'OWNER_ROOT_CHANGED');
  assert.equal(validateOwnerProgress(receipt(q),q,{now:NOW,allowRootChange:true}).code,'OWNER_ROOT_CHANGED');
  const sameRoot={...receipt(q),root:{...receipt(q).root,ref:q.rootRef},openObligations:[]};
  assert.equal(validateOwnerProgress(sameRoot,q,{now:NOW}).code,'OWNER_NEXT_UNPROVEN');
});
test('R2 safeguard and exact R3 authorization remain mandatory; UNKNOWN effects allow only reconciliation',()=>{
  const q=ownerProgressRequest(processFixture(),'request-a'),v=receipt(q);
  for(const risk of ['R2','R3'])assert.equal(validateOwnerProgress({...v,next:{...v.next,risk}},q,{now:NOW}).ok,false);
  assert.equal(validateOwnerProgress({...v,next:{...v.next,risk:'R3',authorizationRef:'operator-auth-a'}},q,{now:NOW}).ok,true);
  assert.equal(validateOwnerProgress({...v,effectsReconciled:false},q,{now:NOW}).ok,false);
  assert.equal(validateOwnerProgress({...v,effectsReconciled:false,next:{...v.next,reconciliationOnly:true}},q,{now:NOW}).ok,true);
});
test('direct owner reader sends no transcript or secrets, refuses redirects and binds nonce to returned evidence',async()=>{
  const p=processFixture();let seen;
  const result=await readOwnerProgress(p,endpoint,{now:()=>NOW,fetchImpl:async(url,options)=>{
    seen={url,options};const q=JSON.parse(options.body);return Response.json(receipt(q));}});
  assert.equal(result.ok,true);assert.equal(seen.url,endpoint);assert.equal(seen.options.redirect,'error');assert.equal(seen.options.cache,'no-store');
  assert.equal(seen.options.method,'POST');assert.doesNotMatch(seen.options.body,/Frozen mission|substantive|cookie|token/i);
  const forged=await readOwnerProgress(p,endpoint,{now:()=>NOW,fetchImpl:async()=>Response.json(receipt())});assert.equal(forged.ok,false);
});
test('owner endpoint is operator-bound to the existing origin; failures and oversized replies never grant proof',async()=>{
  for(const u of ['https://example.com/greenfield/state','http://api.elho.fi/greenfield/state','https://api.elho.fi/admin','https://api.elho.fi/greenfield/state?token=x','https://u:p@api.elho.fi/greenfield/state'])assert.equal(normalizeOwnerProgressEndpoint(u),'');
  let called=0;assert.equal((await readOwnerProgress(processFixture(),'',{fetchImpl:async()=>called++})).code,'OWNER_PROGRESS_NOT_CONFIGURED');assert.equal(called,0);
  for(const fetchImpl of [async()=>{throw Error('secret must not leak');},async()=>new Response('',{status:403}),async()=>Response.json({large:'x'.repeat(40000)})]) {
    const result=await readOwnerProgress(processFixture(),endpoint,{fetchImpl});assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/secret must/);
  }
});
test('bounded progress evidence is source-linked, idempotent, and retains previous deficits',()=>{
  let rows=[];const v=receipt(),src={runId:'r',turn:1,responseHash:'rh'};
  rows=appendProgressEvidence(rows,v,src,NOW);assert.equal(appendProgressEvidence(rows,v,src,NOW+1).length,1);
  for(let n=2;n<=70;n++)rows=appendProgressEvidence(rows,{...v,receiptId:`receipt-${n}`},{...src,turn:n},NOW+n);
  assert.equal(rows.length,64);assert.deepEqual(rows.at(-1).previousOpenObligations,['obligation-b']);assert.equal(rows.at(-1).effectKey,'effect-b');
});
test('WAIT keeps mission open, suppresses that slot and leaves independent slots runnable',()=>{
  const p=processFixture(),wait=ownerWaitRecord(null,{ok:true,receipt:receipt(undefined,'WAIT')},NOW);
  const q=normalizeMissionWorkQueue({queueId:'queue-a',workerId:'worker-a',windowId:1,enabled:true,activeItemId:'',items:[
    {itemId:'item-a',goal:p.goal,savedMissionId:'mission-a',status:'READY',order:1,resume:{ownerWait:wait}},
    {itemId:'item-b',goal:'GF-1.2.1022',savedMissionId:'mission-b',status:'READY',order:2}]});
  assert.equal(isRunnableQueueItem(q.items[0],NOW+1e9),false);assert.equal(selectNextMissionItem(q,{now:NOW}).itemId,'item-b');
  assert.ok(wait.nextCheckAtMs>=NOW+300000);
});
test('broker counts completed operative turns exactly once and rotates after six or three quanta',()=>{
  let p=processFixture();p.turn=1;p.lastPrompt.promptProfile.ordinal=1;
  for(let n=1;n<=6;n++) {p.turn=n;p.lastPrompt.hash=`p${n}`;p.lastPrompt.promptProfile.ordinal=n;
    p.sessionBroker=completeBrokerTurn(p,{quantumCompleted:n%2===0});
    const once=structuredClone(p.sessionBroker);p.sessionBroker=completeBrokerTurn(p,{quantumCompleted:n%2===0});assert.deepEqual(p.sessionBroker,once);
    if(n<6)assert.equal(sessionBrokerLimit(p.sessionBroker),'');}
  assert.equal(p.sessionBroker.completedQuanta,3);assert.equal(p.sessionBroker.operativePrompts,6);assert.equal(sessionBrokerLimit(p.sessionBroker),'SESSION_QUANTUM_CEILING');
  assert.equal(sessionBrokerLimit({operativePrompts:6,completedQuanta:1}),'SESSION_PROMPT_CEILING');
  assert.equal(sessionBrokerLimit({operativePrompts:5,completedQuanta:3}),'SESSION_QUANTUM_CEILING');
  p.sessionSeq=2;p.lastResponse.observation.conversationKey='https://chatgpt.com/c/new';p.lastPrompt.promptProfile.ordinal=1;
  assert.equal(completeBrokerTurn(p).operativePrompts,1);assert.equal(p.queueContext.savedMissionId,'mission-a');
});
test('warm resume crosses a completed quantum only with proven broker identity and remaining budget',()=>{
  const p=processFixture();p.sessionBroker=completeBrokerTurn(p,{quantumCompleted:true});
  const args={parked:p,item:{lastOutcome:'QUANTUM_EXHAUSTED',lastLeftAtMs:NOW,resume:{sourceResponseState:'COMPLETED_RESPONSE_CHECKPOINTED'}},interactionInQuantum:1,now:NOW+1000};
  assert.equal(warmResumeDecision(args).warm,true);
  p.sessionBroker.completedQuanta=3;assert.equal(warmResumeDecision(args).warm,false);
  p.sessionBroker.completedQuanta=1;p.sessionBroker.conversationKey='https://chatgpt.com/c/other';assert.equal(warmResumeDecision(args).warm,false);
});
test('current A2A response fields and statuses remain unchanged; FULL and COMPACT carry mission progress policy',()=>{
  const p=processFixture();p.ownerProgress=receipt();
  const full=buildA2AEnvelope({process:p,objective:'Continue'});assert.equal(validateA2AEnvelope(full).ok,true);assert.equal(full.control.goalProgress.ownerRootRef,'root-a');
  const compact=buildA2AEnvelope({process:p,objective:'Continue',promptProfile:{profile:'COMPACT',ordinal:6,lastFullOrdinal:5}});
  assert.equal(validateA2AEnvelope(compact).ok,true);assert.deepEqual(compact.control.goalProgress,full.control.goalProgress);
  const response={schema:'eic.a2a.response.v1',status:'CONTINUE',summary:'Partial PASS',workPerformed:[],evidence:[],blockers:[],nextSuggestedAction:'Next'};
  assert.equal(validateTargetResponse(response).ok,true);assert.equal(validateTargetResponse({...response,status:'CLOSURE_READY'}).ok,false);
  assert.equal(validateTargetResponse({...response,terminalProof:{}}).ok,false);
});

const background=await readFile(new URL('../background.js',import.meta.url),'utf8');
function runtime(name,deps) {const start=background.indexOf(`async function ${name}(`);assert.ok(start>=0);const end=background.indexOf('\n}\n',start)+2;
  return Function(...Object.keys(deps),background.slice(start,end)+`;return ${name};`)(...Object.values(deps));}
function waitHarness({changed=false,stop=false,paused=false}={}) {
  let current={...processFixture(),phase:'PAUSED',queueContext:null,ownerWait:{state:'WAIT',stateRevision:'revision-a',nextCheckAtMs:0}};
  let reads=0,prompts=0;const v=receipt();v.stateRevision=changed?'revision-b':'revision-a';
  const deps={PHASES,readNextInstruction:async()=>null,readSafety:async()=>({admissionPaused:paused}),loadOperatorSettings:async()=>({ownerProgressEndpoint:endpoint}),
    readOwnerProgress:async()=>{reads++;if(stop)current={...current,phase:'STOPPED'};return {ok:true,receipt:v};},findProcessById:async()=>current,
    ownerWaitRecord,ownerContinuation,appendProgressEvidence,analysisSource:p=>({runId:p.runId,turn:p.turn,responseHash:p.lastResponse.hash}),
    buildPendingA2A:async()=>{prompts++;return {text:'next',hash:'next-hash'};},
    saveObserved:async(p,patch)=>current={...p,...patch},commitTransition:async(p,phase,patch)=>current=transitionProcess(p,phase,patch)};
  const tick=runtime('tickOwnerWait',deps);return {run:()=>tick(current),counts:()=>({reads,prompts})};
}
test('runtime WAIT does not emit an AI prompt on unchanged evidence; a new ready event emits once',async()=>{
  const unchanged=waitHarness();assert.equal((await unchanged.run()).phase,'PAUSED');assert.deepEqual(unchanged.counts(),{reads:1,prompts:0});
  const changed=waitHarness({changed:true});assert.equal((await changed.run()).phase,'SENDING');assert.deepEqual(changed.counts(),{reads:1,prompts:1});
});
test('operator pause and STOP racing an owner read take precedence over continuation',async()=>{
  const paused=waitHarness({changed:true,paused:true});assert.equal((await paused.run()).phase,'PAUSED');assert.equal(paused.counts().reads,0);
  const stopped=waitHarness({changed:true,stop:true});assert.equal((await stopped.run()).phase,'STOPPED');assert.equal(stopped.counts().prompts,0);
});
test('UNKNOWN dispatch is preserved by the runtime wait transition and cannot be cleared or replayed',async()=>{
  const p=processFixture();p.pendingPrompt={hash:'uncertain',dispatch:{effectPossible:true}};
  const park=runtime('parkOwnerWait',{PHASES,findProcessById:async()=>p,queuePendingEffectNeedsReconciliation:()=>true,
    holdForSafety:async(source,condition)=>({...source,lastError:condition})});
  const held=await park(p,{ok:false,code:'OWNER_READ_FAILED'});assert.deepEqual(held.pendingPrompt,p.pendingPrompt);assert.equal(held.lastError.code,'DISPATCH_EFFECT_UNRESOLVED');
});

test('EIC reference adapter requires authentication and canonical state; it does not infer owner proof',async()=>{
  const q=ownerProgressRequest(processFixture(),'request-a');let reads=0;
  const req=()=>new Request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(q)});
  assert.throws(()=>createOwnerProgressHandler(),/capabilities/);
  const denied=createOwnerProgressHandler({authenticateAndAuthorize:async()=>null,readCanonicalProgress:async()=>reads++});
  assert.equal((await denied(req())).status,403);assert.equal(reads,0);
  const missing=createOwnerProgressHandler({authenticateAndAuthorize:async()=>({id:'operator'}),readCanonicalProgress:async()=>null});
  assert.equal((await missing(req())).status,503);
});
test('actual reader and EIC adapter interoperate for NEXT, WAIT and CLOSURE_READY without A2A extensions',async()=>{
  for(const disposition of ['NEXT','WAIT','CLOSURE_READY']) {
    const handler=createOwnerProgressHandler({now:()=>NOW,authenticateAndAuthorize:async()=>({id:'operator'}),readCanonicalProgress:async()=>receipt(undefined,disposition)});
    const result=await readOwnerProgress(processFixture(),endpoint,{now:()=>NOW,fetchImpl:(url,init)=>handler(new Request(url,init))});
    assert.equal(result.ok,true);assert.equal(result.receipt.disposition,disposition);
  }
});
test('operator instruction wins even when a terminal request and its target are invalid',()=>{
  const d=resolveGreenfieldControl({targetDisposition:'DONE',terminalControl:{requested:true,accepted:false},operatorInstructionPending:true});
  assert.equal(d.action,'NEXT');assert.equal(d.reason,'EIC_TERMINAL_DEFERRED_FOR_OPERATOR_INSTRUCTION');
});
test('real queue owner-event refresh preserves slot identities and does not wake unchanged state',async()=>{
  const source=processFixture();const wait={state:'WAIT',stateRevision:'revision-a',nextCheckAtMs:0};
  const initial={queueId:'queue-a',enabled:true,items:[{itemId:'item-a',savedMissionId:'mission-a',status:'READY',resume:{ownerWait:wait,objective:'wait'},processSnapshot:source},
    {itemId:'item-copy',savedMissionId:'mission-a',status:'PAUSED',pauseUntilMs:Date.now()+1e7,resume:{ownerWait:wait},processSnapshot:source},
    {itemId:'independent',savedMissionId:'other',status:'READY',resume:{objective:'independent'},processSnapshot:{}}]};
  for(const changed of [false,true]) {
    const q=structuredClone(initial);const r=receipt();r.stateRevision=changed?'revision-b':'revision-a';
    const refresh=runtime('refreshOwnerWaitingSlots',{readOwnerProgress:async()=>({ok:true,receipt:r}),ownerWaitRecord,ownerContinuation,
      appendProgressEvidence,analysisSource:()=>({runId:'r',turn:5,responseHash:'rh'}),persistMissionQueue:async x=>x});
    const next=await refresh(q,{ownerProgressEndpoint:endpoint});
    assert.deepEqual(next.items.map(x=>x.itemId),initial.items.map(x=>x.itemId));assert.equal(next.items.length,3);
    assert.equal(next.items[0].resume.ownerWait===null,changed);assert.equal(next.items[1].status,'PAUSED');
    assert.deepEqual(next.items[2],initial.items[2]);
  }
});
test('post-audit owner boundary rejects operator STOP and a replaced active slot before a commit',async()=>{
  const p=processFixture();
  for(const mode of ['same','stop','different-slot','queue-stopped','unknown-effect']) {
    const current=mode==='stop'?{...p,phase:'STOPPED'}:p;
    const boundary=runtime('goalTransitionBoundary',{findProcessById:async()=>current,
      isCurrentToken:(a,b)=>a.runId===b.runId&&a.generation===b.generation,ownerToken:x=>x,
      queuePendingEffectNeedsReconciliation:()=>mode==='unknown-effect',
      missionQueueForWindow:async()=>({queue:{enabled:mode!=='queue-stopped',activeItemId:mode==='different-slot'?'other':p.queueContext.itemId}})});
    assert.equal((await boundary(p)).blocked,mode!=='same');
  }
});
test('runtime terminal request reuses owner continuation, or emits only one reconciliation prompt before WAIT',async()=>{
  const p=processFixture();p.ownerProgressResult={ok:false,code:'OWNER_PROGRESS_NOT_CONFIGURED'};
  let executions=0;
  const evaluate=runtime('evaluateAndApplyRuntimeControl',{
    missionQueueForWindow:async()=>({queue:{queueId:target.queueId,items:[{itemId:target.itemId,status:'ACTIVE'}]}}),
    evaluateRuntimeControl,queuePendingEffectNeedsReconciliation:()=>false,errorRecord:x=>({code:x.message}),
    settleRuntimeControlReceipts:x=>x,nextRuntimeControlState:(_,rows)=>({lastReceipts:rows}),audit:async()=>{},ownerContinuation,
    applyRuntimeControlEffects:()=>{executions++;throw Error('unexpected effect');}
  });
  const result={targetDisposition:'DONE',targetResponse:{sessionAction:'KEEP'}};
  const first=await evaluate(p,result);assert.equal(first.terminal.accepted,false);assert.ok(first.terminal.nextObjective);assert.equal(p.terminalRecheckUsed,true);
  const second=await evaluate(p,result);assert.equal(second.terminal.nextObjective,'');assert.equal(executions,0);
});

function analyzingHarness(kind,{finalReadFails=false}={}) {
  let current=processFixture();current.safety={proof:{allowed:false,code:"THINKING_EFFORT_TOO_LOW"}};attachDispatchReceipt(current);
  const r=receipt(undefined,kind);r.observedAtMs=Date.now();r.expiresAtMs=Date.now()+60000;
  current.ownerProgressResult={ok:true,receipt:r};current.ownerProgress=r;
  let commits=0,parks=0,retired=0,emitted='';
  let queue={items:[{itemId:'item-a',savedMissionId:'mission-a'},{itemId:'copy-a',savedMissionId:'mission-a'},
    {itemId:'other',savedMissionId:'mission-b'}],history:[]};
  const decision=normalizeHjalmarDecision({disposition:'DONE',objectiveStatus:'SATISFIED',targetDisposition:'DONE',progressEvidence:'One child passed.',
    analysis:'Bounded child passed.',exactTarget:'child-a',ownerEvidence:'UNKNOWN',reversibility:'YES',rollbackPath:'No mutation.',readbackPlan:'Read root.',materialAmbiguity:'NONE',confidence:'HIGH'});
  const result={token:{operationId:'test'},decision,evidenceBinding:{ok:true},currentObjective:'A bounded child.',currentObjectiveId:'objective-a',
    targetDisposition:'DONE',targetResponse:{sessionAction:'KEEP',nextSuggestedAction:''},instructionSnapshotId:null};
  const deps={recoverParkedAnalysisHandoff:async()=>null,dispatchedTurnQuality,recordUsageOutput:async()=>{},PHASES,DISPOSITIONS,invalidCapturedResponse:()=>false,tabState:async()=>({}),consumeCheckpointedInstructions:async()=>{},
    observeOwnerProgressForResponse:async()=>current,readNextInstruction:async()=>null,
    saveObserved:async(p,patch)=>current={...p,...patch},completeBrokerTurn,maybeParkAtQueueBoundaryWithoutAnalysis:async()=>({handled:false}),
    runAnalysis:async()=>result,findProcessById:async()=>current,isCurrentToken:()=>true,instructionQueues:{enqueue:(_,fn)=>fn()},
    ownerContinuation,resolveGreenfieldControl,applyGreenfieldControlToDecision,validateHjalmarDecision,
    normalizeMissionQuantumInteractions:n=>Number(n || 5),audit:async()=>{},registerResponseMissionDelegations:async()=>({}),observeNoDelta:async()=>null,
    evaluateAndApplyRuntimeControl:async p=>{const e=evaluateRuntimeControl({status:'DONE',request:request(),owner:{...owner(),nowMs:Date.now(),
      terminalProof:{verified:true,disposition:r.disposition,expiresAtMs:r.expiresAtMs}}});
      if(e.terminal&&!e.terminal.accepted)e.terminal.nextObjective=ownerContinuation(r);
      return {terminal:e.terminal};},
    readOwnerProgress:async()=>finalReadFails?{ok:false,code:'OWNER_READ_FAILED'}:{ok:true,receipt:r},loadOperatorSettings:async()=>({ownerProgressEndpoint:endpoint}),
    appendProgressEvidence,analysisSource:p=>({runId:p.runId,turn:p.turn,responseHash:p.lastResponse.hash}),
    nowIso:()=>new Date().toISOString(),goalTransitionBoundary:async()=>({blocked:false}),
    commitTransition:async(p,phase,patch,opts)=>{if(opts.beforeSave){const b=await opts.beforeSave();if(b.blocked)return b.process;}
      commits++;current=transitionProcess(p,phase,patch);if(phase==='DONE'){const done=retireLogicalMissionSlots(queue,queue.items[0],{queueStatus:'DONE'});retired+=done.finalizedSlots.length;queue=done.queue;}return current;},
    parkOwnerWait:async(p,v)=>{parks++;current={...p,phase:'PAUSED',ownerWait:ownerWaitRecord(null,v)};return current;},
    eicHandoffWithoutNanoTask,evaluateContinuationAdmission,isExplicitRotationAction:v=>v==='ROTATE_SESSION_NOW',
    randomId:prefix=>`${prefix}-test`,capturedResponseObservationEvidence:()=>({}),capturedProtocolEvidence:()=>({}),
    sessionBrokerLimit,activeSlotScheduleBlock:async()=>'',queueAfterResponseAction,QUEUE_AFTER_RESPONSE,
    isExplicitQueueYieldAction:v=>v==='YIELD_TO_QUEUE',isExplicitBackgroundSleepAction:v=>v==='BACKGROUND_SLEEP',isExplicitPauseAction:v=>v==='PAUSE_PROCESS',
    parkQueueMissionAfterAnalysis:async options=>{parks++;emitted=options.effectiveNextPrompt;return current={...current,phase:'ROTATING'};}};
  const tick=runtime('tickAnalyzing',deps);
  return {run:()=>tick(current),counts:()=>({commits,parks,retired,emitted,remaining:queue.items.map(x=>x.itemId)})};
}
test('real analysis dispatcher turns child DONE with parent OPEN into exactly one bounded queue continuation',async()=>{
  const f=analyzingHarness('NEXT');assert.equal((await f.run()).phase,'ROTATING');
  const c=f.counts();assert.equal(c.retired,0);assert.equal(c.parks,1);assert.match(c.emitted,/effect-b/);assert.equal(c.remaining.length,3);
});
test('real analysis dispatcher closes once after final owner readback and retires only that logical mission',async()=>{
  const f=analyzingHarness('CLOSURE_READY');assert.equal((await f.run()).phase,'DONE');assert.equal((await f.run()).phase,'DONE');
  assert.deepEqual(f.counts(),{commits:1,parks:0,retired:2,emitted:'',remaining:['other']});
});
test('failed final owner readback never commits DONE or retires a queue slot',async()=>{
  const f=analyzingHarness('CLOSURE_READY',{finalReadFails:true});assert.equal((await f.run()).phase,'PAUSED');assert.equal(f.counts().retired,0);assert.equal(f.counts().commits,0);
});
test('restart after a persisted WAIT queue checkpoint resumes the wait without another analysis or dispatch',async()=>{
  const p=processFixture();p.ownerWait={state:'WAIT'};let waits=0;
  const tick=runtime('tickAnalyzing',{PHASES,missionQueueForWindow:async()=>({queue:{activeItemId:'',items:[{itemId:p.queueContext.itemId,resume:{ownerWait:p.ownerWait}}]}}),
    enterQueueWait:async(source,queue,detail)=>{waits++;assert.equal(detail.reason,'OWNER_EVENT_WAIT_RECOVERED');return {...source,phase:'PAUSED'};}});
  assert.equal((await tick(p)).phase,'PAUSED');assert.equal(waits,1);
});
test('direct owner reads reject untrusted DOM provenance before making a network call',async()=>{
  const p=processFixture();p.lastResponse.observation.ownerTrusted=false;let calls=0;
  const result=await readOwnerProgress(p,endpoint,{fetchImpl:async()=>{calls++;}});
  assert.equal(result.code,'OWNER_SOURCE_UNPROVEN');assert.equal(calls,0);
});
