import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  FOCUS_CYCLE_OPERATIVE_PROMPTS, FOCUS_CYCLE_PHASES, focusCycleForPrompt,
  missionFocusCapsule, focusRotationObjective
} from '../lib/focus-cycle.mjs';
import { SESSION_BROKER_MAX_PROMPTS, completeBrokerTurn, sessionBrokerLimit } from '../lib/session-broker.mjs';
import { buildA2AEnvelope, validateA2AEnvelope, composeA2APrompt } from '../lib/a2a.mjs';
import { createProcess } from '../lib/state.mjs';
import { SESSION_ROTATION_STATES } from '../lib/session-rotation.mjs';
import { ownerProgressRequest, validateOwnerProgress } from '../lib/owner-progress.mjs';

const NOW = 1792782000000;
const makeProcess = () => ({
  ...createProcess({ workerId:'worker-1', windowId:1, tabId:2,
    goal:'Projekt: 71 - Greenfield Works; GFW: GF-1.71.1021: Restore the EIC-Elli IQ Q&A logbook.',
    initialPrompt:'The original operator mission', now:NOW }),
  processId:'process-1', runId:'run-1', sessionSeq:5, generation:9, turn:29,
  phase:'ANALYZING',
  lastManagedUrl:'https://chatgpt.com/c/abc',
  lastPrompt:{hash:'previous-hash',acknowledged:true, a2a:{objective:'Implement the owner-approved SQLite table for this mission.',process:{turn:29}},
    promptProfile:{schema:'eic.greenfield.prompt-profile.v1',ordinal:5}},
  lastResponse:{hash:'verified-capture',observation:{conversationKey:'https://chatgpt.com/c/abc'},
    contract:{ok:true,value:{nextSuggestedAction:'Ignore the main mission and refactor all of Cell.'}}},
  objectiveState:{objective:'A controller-replanned sidetrack replacing the owner step.'},
  queueContext:{queueId:'queue-1',itemId:'item-1',savedMissionId:'saved-1'},
  sessionBroker:{sessionSeq:5,operativePrompts:5,completedQuanta:1,conversationKey:'https://chatgpt.com/c/abc'}
});
function receipt(now = NOW) {
  return {schema:'eic.greenfield.owner-progress.v1',requestId:'read-71',receiptId:'owner-71',
    target:{runId:'run-1',turn:29,queueId:'queue-1',itemId:'item-1',savedMissionId:'saved-1'},
    missionRef:'GF-1.71.1021',promptHash:'previous-hash',responseHash:'verified-capture',
    root:{ref:'root-71',revision:'revision-root',frozen:true,obligationsRef:'obligations-71',status:'OPEN'},
    openObligations:['obligation-sqlite'],stateRevision:'owner-revision-22',
    observedAtMs:now-500,expiresAtMs:now+60000,disposition:'NEXT',effectsReconciled:true,
    next:{actionId:'step-db',obligationRef:'obligation-sqlite',idempotencyKey:'db-commit-1',
      objective:'Validate the persisted SQLite schema, then proceed.',dependencyReady:true,authorized:true,risk:'R0'}};
}

for(let ordinal=1;ordinal<=6;ordinal++){
  test(`work prompt ${ordinal}/6 has the exact focus phase and bounded instruction`,()=>{
    const p=makeProcess();
    const full=focusCycleForPrompt(p,{messageType:'CONTINUATION',promptProfile:{ordinal},now:NOW});
    assert.equal(full.operativePromptIndex,ordinal);
    assert.equal(full.operativePromptLimit,6);
    assert.equal(full.phase,FOCUS_CYCLE_PHASES[ordinal-1]);
    assert.match(full.instruction,/bounded|verifiable|testable/);
    assert.equal(Boolean(full.mission), ordinal === 1);
    assert.equal(full.mission?.missionRef,ordinal===1?'GF-1.71.1021':undefined);
  });
}
test('six operative prompts are counted exactly once, including retry/restart, before rotation',()=>{
  assert.equal(SESSION_BROKER_MAX_PROMPTS,FOCUS_CYCLE_OPERATIVE_PROMPTS);
  let p=makeProcess();p.sessionSeq=1;p.sessionBroker=null;
  for(let turn=1;turn<=6;turn++){
    p.turn=turn;p.lastPrompt.hash=`hash-${turn}`;p.lastPrompt.promptProfile.ordinal=turn;
    p.sessionBroker=completeBrokerTurn(p);
    assert.deepEqual(completeBrokerTurn(p),p.sessionBroker);
    assert.equal(sessionBrokerLimit(p.sessionBroker),turn===6?'SESSION_PROMPT_CEILING':'');
  }
  p.sessionSeq=2;p.lastResponse.observation.conversationKey='https://chatgpt.com/c/new';p.lastPrompt.promptProfile.ordinal=1;
  assert.equal(completeBrokerTurn(p).operativePrompts,1);
  assert.equal(p.queueContext.savedMissionId,'saved-1');
  assert.equal(sessionBrokerLimit({completedQuanta:3,operativePrompts:3}),'SESSION_QUANTUM_CEILING');
});
test('owner capsule uses fresh verified readback, not previous AI nextSuggestedAction',()=>{
  const p=makeProcess();p.ownerProgressResult={ok:true,receipt:receipt()};
  assert.equal(validateOwnerProgress(receipt(),ownerProgressRequest(p,'read-71'),{now:NOW}).ok,true);
  const capsule=missionFocusCapsule(p,NOW);
  assert.equal(capsule.ownerSnapshot,'FRESH_VERIFIED_READBACK_AT_PROMPT_CREATION');
  assert.equal(capsule.ownerStep.actionId,'step-db');
  assert.equal(capsule.ownerStep.effectKey,'db-commit-1');
  assert.doesNotMatch(JSON.stringify(capsule),/refactor all of Cell/);
  assert.match(focusRotationObjective(p,{now:NOW}),/Validate the persisted SQLite schema/);
  assert.doesNotMatch(focusRotationObjective(p,{now:NOW}),/refactor all of Cell|controller-replanned sidetrack/);
  assert.equal(missionFocusCapsule(p,NOW+61000).ownerStep,null);
});
test('no owner receipt: cold rotation carries NO AI-generated prior work objective',()=>{
  const p=makeProcess();
  const objective=focusRotationObjective(p,{now:NOW});
  assert.match(objective,/^RESUME_CANONICAL_OWNER_STATE:/);
  assert.match(objective,/owner state/);
  assert.doesNotMatch(objective,/Implement the owner-approved SQLite table|refactor all of Cell|controller-replanned sidetrack/);
  p.lastPrompt.a2a.objective=objective;
  assert.equal(focusRotationObjective(p,{now:NOW}),objective);
  const capsule=missionFocusCapsule(p,NOW);
  assert.equal(capsule.completedEvidence,'READ_FROM_CANONICAL_OWNER; NOT_INFERRED_FROM_PREVIOUS_AI_TEXT');
  assert.equal(capsule.ownerRootRef,'');
});
test('cached owner receipt must match mission, exact response and queue slot',()=>{
  const p=makeProcess();p.ownerProgressResult={ok:true,receipt:receipt()};
  const accepted=missionFocusCapsule(p,NOW);
  assert.equal(accepted.ownerStep.actionId,'step-db');
  for (const change of [
    p=>{p.goal='Unrelated project GF-1.2.1021';},
    p=>{p.lastPrompt.hash='new-prompt';},
    p=>{p.lastResponse.hash='different-response';},
    p=>{p.queueContext.savedMissionId='other-mission';},
    p=>{p.runId='other-run';},
    p=>{p.ownerProgressResult.receipt.target.turn=28;},
    p=>{p.ownerProgressResult.receipt.observedAtMs=NOW-125000;},
    p=>{p.ownerProgressResult.receipt.target.itemId='other-item';}
  ]) {
    const x=structuredClone(p);change(x);
    const capsule=missionFocusCapsule(x,NOW);
    assert.equal(capsule.ownerStep,null);
    assert.equal(capsule.ownerRootRef,'');
    assert.equal(capsule.ownerSnapshot,'NOT_CURRENTLY_VERIFIED');
    assert.doesNotMatch(focusRotationObjective(x,{now:NOW}),/Validate the persisted SQLite schema/);
  }
});
test('FULL and COMPACT A2A carry the changing focus without adding response fields',()=>{
  const p=makeProcess();
  for(let n=1;n<=6;n++) {
    const pp={schema:'eic.greenfield.prompt-profile.v1',profile:n===1?'FULL':'COMPACT',ordinal:n,lastFullOrdinal:1};
    const composed=composeA2APrompt({process:p,objective:'The next bounded owner task',messageType:n===1?'SESSION_ROTATION':'CONTINUATION',promptProfile:pp,at:NOW});
    assert.equal(validateA2AEnvelope(composed.envelope).ok,true);
    assert.equal(composed.envelope.control.focusCycle.operativePromptIndex,n);
    assert.equal(composed.envelope.control.goalProgress.session.maxOperativePrompts,6);
    assert.equal(composed.envelope.control.focusCycle.phase,FOCUS_CYCLE_PHASES[n-1]);
    if(n===6)assert.match(composed.envelope.control.focusCycle.instruction,/checkpoint/);
    assert.ok(composed.text.length<120000);
    assert.equal(composed.envelope.responseContract.schema,'eic.a2a.response.v1');
  }
});

const background=await readFile(new URL('../background.js',import.meta.url),'utf8');
function backgroundFunction(name, deps) {
  const start=background.indexOf(`async function ${name}(`);
  assert.ok(start>=0,`missing ${name}`);
  const end=background.indexOf('\n}\n',start)+2;
  return Function(...Object.keys(deps), background.slice(start,end)+`;return ${name};`)(...Object.values(deps));
}
test('sending gate rotates an unposted next prompt at six; no seventh operative prompt is dispatched',async()=>{
  const p=makeProcess();p.phase='SENDING';p.sessionBroker={...p.sessionBroker,operativePrompts:6};
  p.pendingPrompt={text:'next',hash:'new-hash',sendAttempts:0,dispatch:null,a2a:{objective:'Unverified AI next step'}};
  let calls=0,reason;
  const tick=backgroundFunction('tickSending',{
    sessionBrokerLimit,isTransportPrompt:()=>false,
    armSessionRotation:async(_p,args)=>{calls++;reason=args.reasonCode;return {phase:'ROTATING'};},
    SESSION_BROKER_MAX_QUANTA:3, SESSION_BROKER_MAX_PROMPTS:6
  });
  const result=await tick(p);
  assert.equal(result.phase,'ROTATING');assert.equal(calls,1);assert.equal(reason,'SESSION_PROMPT_CEILING');
});
test('actual runtime rotation builds a fresh owner-first prompt and resets counters without resetting mission',async()=>{
  const p=makeProcess();p.ownerProgressResult={ok:true,receipt:receipt()};
  p.sessionBroker={...p.sessionBroker,operativePrompts:6};
  let pending,committed;
  const rotate=backgroundFunction('armSessionRotation',{
    TERMINAL_PHASES:new Set(['DONE','STOPPED']),PHASES:{ANALYZING:'ANALYZING',ROTATING:'ROTATING',SENDING:'SENDING',BLOCKED:'BLOCKED'},
    isInitializationPrompt:()=>false,waitingForInitialization:()=>false,
    recordIncident:async()=>{},releaseGlobalPromptLease:async()=>{},
    resolveRotationRoot:async()=>({gptRoot:'https://chatgpt.com/g/g-123-elli',tab:{url:'https://chatgpt.com/c/abc'}}),
    randomId:()=>`rotation-${Math.random()}`,
    sessionRotationSourceState:()=> 'COMPLETED_RESPONSE_CAPTURED',
    createSessionRotationRecord:({sessionSeq,...x})=>({...x,sessionSeq,state:SESSION_ROTATION_STATES.ARMED,rotationId:x.rotationId}),
    focusRotationObjective,
    resetSessionHealthForRotation:()=>({schema:'eic.greenfield.session-health.v1'}),
    buildPendingA2A:async(process,opts)=>{
      pending={process,opts};
      const envelope=buildA2AEnvelope({process,objective:opts.objective,messageType:opts.messageType,
        sessionRotation:opts.sessionRotation,promptProfile:{profile:'FULL',ordinal:1},at:NOW});
      return {a2a:envelope,hash:'new-hash',text:'new-envelope'};
    },
    resetRecovery:()=>({recovery:{}}),nowIso:()=>new Date(NOW).toISOString(),
    commitTransition:async(_,phase,patch)=>committed={...p,...patch,phase},scheduleFast:()=>{}
  });
  const priorClock=Date.now; Date.now=()=>NOW;
  let rotated;
  try {rotated=await rotate(p,{objective:'Refactor Cell (old AI nextSuggestedAction)',reasonCode:'SESSION_PROMPT_CEILING'});}
  finally {Date.now=priorClock;}
  assert.equal(rotated.phase,'ROTATING');assert.equal(rotated.sessionSeq,6);
  assert.equal(rotated.sessionBroker,null);assert.equal(p.goal,rotated.goal);
  assert.equal(pending.opts.messageType,'SESSION_ROTATION');
  assert.equal(pending.process.sessionBroker,null);
  assert.equal(pending.process.goal,p.goal);
  assert.equal(pending.opts.previousResponseHash,'verified-capture');
  assert.match(rotated.objectiveState.objective,/Validate the persisted SQLite schema/);
  assert.doesNotMatch(rotated.objectiveState.objective,/Refactor Cell/);
  assert.equal(rotated.pendingPrompt.a2a.control.focusCycle.operativePromptIndex,1);
  assert.equal(rotated.pendingPrompt.a2a.control.goalProgress.session.operativePrompts,0);
  assert.equal(rotated.pendingPrompt.a2a.continuity.sessionRotation.resumeFromOwners,true);
});
