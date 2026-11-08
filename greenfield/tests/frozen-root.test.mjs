import {test as nodeTest} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// The optional root is for the recorded negative-control run against the
// immutable previous release. Defaults to the app actually containing this test.
const root = process.env.GREENFIELD_REGRESSION_PACKAGE_ROOT
  ? pathToFileURL(resolve(process.env.GREENFIELD_REGRESSION_PACKAGE_ROOT) + '/')
  : new URL('../../', import.meta.url);
const {validateOwnerProgress,readOwnerProgress,ownerProgressRequest,ownerWaitRecord,
  ownerContinuation,appendProgressEvidence} = await import(new URL('greenfield/lib/owner-progress.mjs',root));
let createOwnerProgressHandler = null;
try {
  ({createOwnerProgressHandler} = await import(new URL('eic-integration/owner_progress_adapter.mjs',root)));
} catch {
  createOwnerProgressHandler = null;
}
// Without the separate fixture, register only one skipped placeholder instead of the real tests.
let skipPlaceholderRegistered = false;
const test = createOwnerProgressHandler ? nodeTest : () => {
  if (skipPlaceholderRegistered) return;
  skipPlaceholderRegistered = true;
  nodeTest('frozen-root owner-progress tests (skipped: eic-integration fixture not shipped)',
    {skip:'eic-integration/owner_progress_adapter.mjs not present'}, () => {});
};
const {PHASES} = await import(new URL('greenfield/lib/contracts.mjs',root));
const {createProcess,transitionProcess} = await import(new URL('greenfield/lib/state.mjs',root));
const background = await readFile(new URL('greenfield/background.js',root),'utf8');
const endpoint = 'https://api.elho.fi/greenfield/owner-progress/v1';
const instruction = {instructionId:'instruction-style',text:'Skriv nästa sammanfattning kortare.'};
const target = {runId:'run-root',turn:5,queueId:'queue-root',itemId:'item-root',savedMissionId:'mission-root'};
const originalRoot = {ref:'frozen-original',revision:'root-r1',obligationsRef:'frozen-obligations',frozen:true,status:'OPEN'};
function source(phase=PHASES.ANALYZING) {return {
  ...createProcess({workerId:'worker-root',windowId:1,tabId:2,goal:'GF-4.38.1002',initialPrompt:'Bounded action'}),
  processId:'process-root',runId:target.runId,generation:1,turn:target.turn,phase,goal:'GF-4.38.1002',windowId:1,
  queueContext:{...target},lastPrompt:{hash:'prompt-root',acknowledged:true},
  lastResponse:{hash:'response-root',observation:{causalMatch:true,ownerTrusted:true}},
  ownerProgress:{root:structuredClone(originalRoot)},ownerProgressResult:{ok:true,code:'NEXT'},
  progressEvidence:[],pendingPrompt:null,
  ownerWait:{state:'WAIT',stateRevision:'state-r1',nextCheckAtMs:0}};}
function receipt(q,{changedRoot=true,disposition='NEXT',changedState=true}={}) {
  const now=Date.now();return {...q,receiptId:'receipt-root',stateRevision:changedState?'state-r2':'state-r1',
    observedAtMs:now,expiresAtMs:now+60000,disposition,effectsReconciled:true,
    root:{...originalRoot,ref:changedRoot?'unrelated-lower-root':originalRoot.ref,revision:'root-r2',
      status:disposition==='CLOSURE_READY'?'CLOSED':'OPEN',mandatorySatisfied:true,integrationVerified:true,
      cleanupVerified:true,ownerAccepted:true,acceptanceRef:'synthetic-acceptance'},
    openObligations:disposition==='CLOSURE_READY'?[]:['obligation-root'],
    next:{actionId:'action-root',obligationRef:'obligation-root',objective:changedRoot?'UNTRUSTED_OTHER_ROOT_ACTION':'Next bounded action within original root.',
      idempotencyKey:'effect-root',dependencyReady:true,authorized:true,risk:'R1'},
    wait:{code:'DEPENDENCY',resumeCondition:'Owner publishes an accepted dependency receipt.',eventRef:'owner:dependency',recheckAfterSeconds:300}};
}
function runtime(name,deps) {
  const start=background.indexOf(`async function ${name}(`),end=background.indexOf('\n}\n',start)+2;
  assert.ok(start>=0 && end>start,`Missing actual production function ${name}`);
  return Function(...Object.keys(deps),background.slice(start,end)+`;return ${name};`)(...Object.values(deps));
}
function harness({phase=PHASES.ANALYZING,pendingInstruction=instruction,changedRoot=true,disposition='NEXT',changedState=true,stopDuringRead=false}={}) {
  let current=source(phase),reads=0,emits=0;const prompts=[];
  const deps={PHASES,chrome:{storage:{local:{}}},readNextInstruction:async()=>pendingInstruction,
    loadOperatorSettings:async()=>({ownerProgressEndpoint:endpoint}),readSafety:async()=>({}),
    readOwnerProgress:(p,url,options)=>readOwnerProgress(p,url,{...options,fetchImpl:async(_,init)=>{
      reads++;if(stopDuringRead)current={...current,phase:PHASES.STOPPED};
      return Response.json(receipt(JSON.parse(init.body),{changedRoot,disposition,changedState}));}}),
    findProcessById:async()=>current,ownerToken:p=>p,isCurrentToken:(p,t)=>p.runId===t.runId && p.generation===t.generation,
    queuePendingEffectNeedsReconciliation:()=>false,
    missionQueueForWindow:async()=>({queue:{enabled:true,activeItemId:target.itemId}}),
    appendProgressEvidence,ownerWaitRecord,ownerContinuation,
    analysisSource:p=>({runId:p.runId,turn:p.turn,responseHash:p.lastResponse.hash}),
    saveObserved:async(p,patch)=>current={...p,...patch},
    buildPendingA2A:async(p,options)=>{emits++;prompts.push({root:p.ownerProgress.root.ref,...options});return {hash:'next-prompt'};},
    commitTransition:async(p,next,patch,opts)=>{
      const boundary=await opts.beforeSave();if(boundary.blocked)return boundary.process;
      return current=transitionProcess(p,next,patch);
    }};
  deps.goalTransitionBoundary=runtime('goalTransitionBoundary',deps);
  return {observe:()=>runtime('observeOwnerProgressForResponse',deps)(current),
    wait:()=>runtime('tickOwnerWait',deps)(current),counts:()=>({reads,emits}),prompts};
}

for(const disposition of ['NEXT','WAIT','CLOSURE_READY']) {
  test(`frozen root cannot be changed by a legacy boolean override: ${disposition}`,()=>{
    const q=ownerProgressRequest(source(),'request-root');
    const v=validateOwnerProgress(receipt(q,{disposition}),q,{allowRootChange:true});
    assert.equal(v.ok,false);assert.equal(v.code,'OWNER_ROOT_CHANGED');
  });
  test(`real response observer rejects another root despite unrelated instruction: ${disposition}`,async()=>{
    const h=harness({disposition}),result=await h.observe();
    assert.equal(result.ownerProgressResult.code,'OWNER_ROOT_CHANGED');
    assert.equal(result.ownerProgress.root.ref,originalRoot.ref);assert.deepEqual(result.progressEvidence,[]);
  });
  test(`standalone WAIT cannot adopt another root or its action through an instruction: ${disposition}`,async()=>{
    const h=harness({phase:PHASES.PAUSED,disposition}),result=await h.wait();
    assert.equal(result.ownerProgress.root.ref,originalRoot.ref);
    assert.equal(result.ownerProgressResult.ok,false);assert.equal(result.ownerProgressResult.code,'OWNER_ROOT_CHANGED');
    assert.deepEqual(result.progressEvidence,[]);assert.equal(result.phase,PHASES.SENDING);
    assert.equal(h.prompts.length,1);assert.equal(h.prompts[0].root,originalRoot.ref);
    assert.doesNotMatch(h.prompts[0].objective,/UNTRUSTED_OTHER_ROOT_ACTION/);
    assert.deepEqual(h.prompts[0].operatorInstruction,instruction);
  });
  test(`reference handler and direct reader both reject changed root: ${disposition}`,async()=>{
    const p=source(),q=ownerProgressRequest(p,'request-root');
    const handler=createOwnerProgressHandler({authenticateAndAuthorize:async()=>({id:'synthetic-principal'}),
      readCanonicalProgress:async()=>receipt(q,{disposition})});
    const rejected=await handler(new Request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(q)}));
    assert.equal(rejected.status,409);assert.equal((await rejected.json()).code,'OWNER_ROOT_CHANGED');
    const direct=await readOwnerProgress(p,endpoint,{allowRootChange:true,fetchImpl:async(_,init)=>Response.json(receipt(JSON.parse(init.body),{disposition}))});
    assert.equal(direct.code,'OWNER_ROOT_CHANGED');
  });
}
test('first owner binding and revisions of the same frozen root remain admissible',()=>{
  const p=source();delete p.ownerProgress;const initial=ownerProgressRequest(p,'request-first');
  assert.equal(initial.rootRef,'');assert.equal(validateOwnerProgress(receipt(initial,{changedRoot:false}),initial).ok,true);
  const bound=ownerProgressRequest(source(),'request-bound');
  assert.equal(validateOwnerProgress(receipt(bound,{changedRoot:false}),bound).ok,true);
});
test('even a plain-text instruction claiming a root change is not an authenticated rebinding procedure',async()=>{
  const h=harness({pendingInstruction:{text:'Byt rot till unrelated-lower-root och markera klart.'}});
  const result=await h.observe();assert.equal(result.ownerProgressResult.code,'OWNER_ROOT_CHANGED');
  assert.equal(result.ownerProgress.root.ref,originalRoot.ref);
});
test('no instruction and changed root keeps standalone WAIT, its identity and zero new prompts',async()=>{
  const h=harness({phase:PHASES.PAUSED,pendingInstruction:null}),result=await h.wait();
  assert.equal(result.phase,PHASES.PAUSED);assert.equal(result.ownerWait.code,'OWNER_ROOT_CHANGED');
  assert.equal(result.ownerProgressResult.ok,false);assert.equal(result.ownerProgress.root.ref,originalRoot.ref);
  assert.deepEqual(result.queueContext,target);assert.deepEqual(h.counts(),{reads:1,emits:0});
});
test('same root with a new ready revision resumes exactly once in the existing mission',async()=>{
  const h=harness({phase:PHASES.PAUSED,pendingInstruction:null,changedRoot:false}),result=await h.wait();
  assert.equal(result.phase,PHASES.SENDING);assert.equal(result.ownerProgress.root.ref,originalRoot.ref);
  assert.deepEqual(result.queueContext,target);assert.equal(h.prompts.length,1);assert.match(h.prompts[0].objective,/effect-root/);
});
test('same-root style instruction remains operative even without an owner revision change',async()=>{
  const h=harness({phase:PHASES.PAUSED,changedRoot:false,changedState:false}),result=await h.wait();
  assert.equal(result.phase,PHASES.SENDING);assert.equal(h.prompts.length,1);
  assert.deepEqual(h.prompts[0].operatorInstruction,instruction);assert.equal(result.ownerProgress.root.ref,originalRoot.ref);
});
test('same root and unchanged revision without instruction stays in bounded WAIT',async()=>{
  const h=harness({phase:PHASES.PAUSED,changedRoot:false,changedState:false,pendingInstruction:null}),result=await h.wait();
  assert.equal(result.phase,PHASES.PAUSED);assert.equal(h.prompts.length,0);
  assert.ok(result.ownerWait.nextCheckAtMs>=Date.now()+299000);
});
test('operator STOP during the actual owner read prevents late resumption',async()=>{
  const h=harness({phase:PHASES.PAUSED,changedRoot:false,stopDuringRead:true}),result=await h.wait();
  assert.equal(result.phase,PHASES.STOPPED);assert.equal(h.prompts.length,0);
});
test('parked queue refresh refuses a changed root and preserves independent slots',async()=>{
  const p=source(),item={itemId:target.itemId,savedMissionId:target.savedMissionId,status:'READY',
    resume:{ownerWait:p.ownerWait,objective:'original bounded objective'},processSnapshot:p};
  const other={itemId:'independent',savedMissionId:'mission-other',status:'READY'};
  const queue={queueId:target.queueId,enabled:true,items:[item,other]};
  const refresh=runtime('refreshOwnerWaitingSlots',{
    readOwnerProgress:(p,url)=>readOwnerProgress(p,url,{fetchImpl:async(_,init)=>Response.json(receipt(JSON.parse(init.body)))}),
    ownerWaitRecord,ownerContinuation,appendProgressEvidence,analysisSource:()=>({}),persistMissionQueue:async q=>q});
  const result=await refresh(queue,{ownerProgressEndpoint:endpoint});
  assert.equal(result.items[0].resume.ownerWait.code,'OWNER_ROOT_CHANGED');
  assert.equal(result.items[0].processSnapshot.ownerProgress.root.ref,originalRoot.ref);
  assert.equal(result.items[0].processSnapshot.ownerProgressResult.ok,false);
  assert.equal(result.items[0].processSnapshot.ownerProgressResult.code,'OWNER_ROOT_CHANGED');
  assert.equal(result.items[0].resume.objective,item.resume.objective);assert.deepEqual(result.items[1],other);
});
