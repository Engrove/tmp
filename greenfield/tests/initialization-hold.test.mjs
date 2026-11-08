import {withReasoningDependencies} from './fixtures/reasoning-dependencies.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The same runtime assertions run against the immutable previous release.
const root = process.env.GREENFIELD_HOLD_BASELINE
  ? pathToFileURL(resolve(process.env.GREENFIELD_HOLD_BASELINE) + '/') : new URL('../', import.meta.url);
const lib = name => import(new URL(`lib/${name}`, root));
await lib('safety-policy.js');
const Safety = globalThis.GreenfieldSafetyPolicy;
const { reconcileSafetyHoldWithFreshProof } = await lib('safety-hold-reconciliation.mjs');
const {reconcileTurnQuality} = await lib('turn-quality.mjs');
const transport = await lib('session-transport.mjs');
const { prepareSessionInitialization, expectedInitializationAck, DELIVERY_CONTINUATION } = transport;
const { autonomousResponseObservation } = await lib('turn-causality.mjs');
const { conversationKey } = await lib('restart-recovery.mjs');
const { advanceResponseCandidate, initializationAcknowledged } = await lib('response-stability.mjs');
const { responseStructuralCompleteness } = await lib('response-observation.mjs');
const { providerTransportPending } = await lib('waiting-refresh.mjs');
const { dispatchWaitView } = await lib('dispatch-wait.mjs');
const { workerReason } = await lib('operations-view.mjs');
const { PHASES } = await lib('contracts.mjs');
const { createProcess, transitionProcess } = await lib('state.mjs');
const background = await readFile(new URL('background.js', root), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const gptRoot = 'https://chatgpt.com/g/g-hold-test-eic';
const url = `${gptRoot}/c/fixture-conversation`;
const hold = () => ({ code: 'SESSION_INITIALIZATION_CONVERSATION_UNPROVEN', retryAtMs: 1 });

function runtime(name, deps) {
  const found = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(background);
  assert.ok(found, name);
  const tail = background.slice(found.index), end = /^}\s*$/m.exec(tail);
  return Function(...Object.keys(withReasoningDependencies(deps)), tail.slice(0, end.index + end[0].length) + `;return ${name};`)(...Object.values(deps));
}
async function seed() {
  const p = { ...createProcess({ workerId: 'worker-fixture', windowId: 1, tabId: 2, gptRoot,
    goal: 'Projekt: 71 - Test - GFW: GF-1.71.1021.', initialPrompt: 'bounded work' }),
    phase: PHASES.WAITING, pendingPrompt: null,
    queueContext: { queueId: 'queue-fixture', itemId: 'item-fixture', savedMissionId: 'mission-fixture', interactionCount: 0, maxInteractions: 5 } };
  const text = 'One bounded action; preserve complete mission obligations.';
  const packet = await prepareSessionInitialization(p, { text, hash: digest(text), postDelaySeconds: 115 }, { url: gptRoot });
  return { ...p, sessionInitialization: packet.sessionInitialization,
    lastPrompt: { ...packet.pendingPrompt, dispatchId: 'send-fixture', dispatchedUserTurnId: 'user-fixture',
      dispatchedUserTurnIndex: 0, acknowledged: true, conversationKey: '' },
    safety: { proof: { allowed: true, code: 'UI_MODEL_COMPATIBLE' }, hold: hold() } };
}
function pageFor(p, patch = {}) {
  const text = `Kvittens: ${p.sessionInitialization.acknowledgement.hash}\nStatus: initierad`;
  return { url, documentId: 'document-fixture', lastUserId: p.lastPrompt.dispatchedUserTurnId,
    generating: false, assistantCount: 1,
    modelEvidence: { source: 'CHATGPT_UI_CONTROLS_V1', observedAtMs: Date.now(), mode: 'CHAT',
      modelLabel: '', effortLabel: 'Extra hög', reasoningControlSeen: true, effortControlSeen: true,
      highestEffort: null, quota: { active: false }, ambiguous: false, blockingUi: false },
    autonomousTurn: { resolvedUserTurnId: p.lastPrompt.dispatchedUserTurnId, resolvedBy: 'USER_TURN_ID',
      assistantFound: true, assistantId: 'assistant-fixture', assistantOwnerKind: 'SHELL_MESSAGE',
      assistantOwnerTrusted: true, assistantHash: digest(text), assistantText: text,
      assistantTextLength: text.length, assistantGenerating: false }, ...patch };
}
function ready(p) {
  return { ...p, phase: PHASES.SENDING,
    pendingPrompt: { ...p.sessionInitialization.workPrompt, requiredConversationKey: conversationKey(url),
      promptPause: { reservationId: 'reservation-fixture', notBeforeAtMs: Date.now() + 115000 } },
    sessionInitialization: { ...p.sessionInitialization, status: 'READY', workPrompt: null,
      conversationKey: conversationKey(url), receipt: { ...p.lastPrompt },
      response: { messageId: 'assistant-fixture', hash: pageFor(p).autonomousTurn.assistantHash } } };
}
function harness(initial) {
  let current = structuredClone(initial), clock = Date.now(), commits = 0, saves = 0;
  const audits = [], wakeups = [];
  const deps = { Safety, PHASES, reconcileTurnQuality, reconcileSafetyHoldWithFreshProof,
    readSafety: async () => ({ policy: Safety.defaults }),
    observeProviderQuota: async () => {}, probeProviderRecovery: async () => {},
    jsonEqual: (a,b) => JSON.stringify(a) === JSON.stringify(b), shouldRememberManagedUrl: () => true,
    saveProcess: async p => { saves++; current = structuredClone(p); },
    audit: async (p, kind) => audits.push(kind),
    conversationKey, expectedInitializationAck, autonomousResponseObservation, providerTransportPending,
    initializationAcknowledged, responseStructuralCompleteness, DELIVERY_CONTINUATION,
    FAST_RECHECK_MS: 900, nowIso: () => new Date(clock).toISOString(),
    advanceResponseCandidate: (c,o) => advanceResponseCandidate(c,o,{now:clock}),
    saveObserved: async (p, patch) => current = { ...p, ...patch },
    transportTransitionBoundary: async p => ({ blocked: false, process: p }),
    maybeEscalateWaitingRefresh: async p => ({ handled: false, process: p }),
    scheduleFast: (id, delay) => wakeups.push({id,delay}), recordUsageOutput: async () => {},
    recordResponseObservation: async p => p, releaseSchedulerTurn: async () => {},
    commitTransition: async (p,phase,patch,opts) => {
      const fence = await opts.beforeSave(); assert.equal(fence.blocked,false);
      commits++; return current = transitionProcess(p,phase,patch,clock);
    },
    holdForSafety: async (p, decision) => current = { ...p, safety: { ...p.safety, hold: decision } }
  };
  const observe = runtime('observeSafetyForProcess', deps);
  const tick = runtime('tickSessionInitialization', deps);
  return { get current(){return current;}, get commits(){return commits;}, get saves(){return saves;}, audits, wakeups,
    async observe(page) { page.modelEvidence.observedAtMs = Date.now(); await observe(current,page); return current; },
    async sample(page,delta=1600) { clock+=delta; await this.observe(page); return current=await tick(current,page); } };
}

test('root-to-conversation handoff clears only the resolved hold while generation is still pending',async()=>{
  const p=await seed(), f=harness(p), page=pageFor(p,{generating:true});
  await f.observe({...page,url:gptRoot}); assert.equal(f.current.safety.hold.code,hold().code);
  await f.sample(page); assert.equal(f.current.safety.hold,null);
  assert.equal(f.current.phase,PHASES.WAITING); assert.equal(f.commits,0);
  assert.equal(f.current.pendingPrompt,null); assert.equal(f.current.sessionInitialization.status,'PENDING');
  assert.ok(f.audits.includes('INITIALIZATION_CONVERSATION_HOLD_RESOLVED'));
});

test('completed initialization releases unchanged work without carrying the conversation hold into its pause',async()=>{
  const p=await seed(), f=harness(p), page=pageFor(p);
  for(const delta of [0,1600,1600])await f.sample(page,delta);
  assert.equal(f.current.sessionInitialization.status,'READY'); assert.equal(f.current.safety.hold,null);
  assert.equal(f.current.phase,PHASES.SENDING); assert.equal(f.commits,1);
  assert.deepEqual(f.current.queueContext,p.queueContext);
  assert.equal(f.current.pendingPrompt.text,p.sessionInitialization.workPrompt.text);
  assert.equal(f.current.pendingPrompt.hash,p.sessionInitialization.workPrompt.hash);
  assert.equal(f.current.pendingPrompt.dispatch,null); assert.equal(f.current.pendingPrompt.sendAttempts,0);
  assert.equal(f.current.sessionInitialization.receipt.conversationKey,conversationKey(url),
    'completion binds the root-origin send receipt to the causally verified conversation');
});

test('already READY v1.9.22 state is reconciled before its prompt pause and remains unsent',async()=>{
  const p=ready(await seed()), f=harness(p), original=structuredClone(p.pendingPrompt);
  await f.observe(pageFor(p)); assert.equal(f.current.safety.hold,null);
  assert.deepEqual(f.current.pendingPrompt,original); assert.equal(f.commits,0);
  const view=dispatchWaitView(f.current,{policy:Safety.defaults,entries:[],events:[]},{},Date.now());
  assert.equal(view.code,'GLOBAL_PROMPT_POST_PAUSE'); assert.equal(view.grantsDispatch,false);
  const saves=f.saves; await f.observe(pageFor(p)); assert.equal(f.saves,saves,'resolution must be idempotent');
});

test('a READY receipt completed by bound Fortsätt keeps the original initialization binding',async()=>{
  const p=ready(await seed()), source={...p.lastPrompt};
  p.lastPrompt={...source,text:'Fortsätt',hash:digest('Fortsätt'),transportKind:DELIVERY_CONTINUATION,
    dispatchedUserTurnId:'continue-user',dispatchId:'continue-dispatch'};
  p.sessionInitialization.completionReceipt={...p.lastPrompt};
  const f=harness(p);await f.observe(pageFor(p));assert.equal(f.current.safety.hold,null);
  assert.equal(f.current.sessionInitialization.receipt.hash,source.hash);assert.equal(f.commits,0);
});

test('foreign conversation, user, run, worker, queue item and work hash cannot clear the hold',async()=>{
  for(const alter of [
    (p,page)=>page.url=gptRoot+'/c/foreign',
    (p,page)=>page.lastUserId='foreign',
    (p,page)=>page.autonomousTurn.resolvedUserTurnId='foreign',
    p=>p.runId='foreign',p=>p.workerId='foreign',p=>p.queueContext.itemId='foreign',
    p=>p.queueContext.savedMissionId='foreign',p=>p.sessionSeq++,
    p=>p.pendingPrompt.hash='foreign',p=>p.lastPrompt.dispatchId='foreign'
  ]) {
    const p=ready(await seed()),page=pageFor(p);alter(p,page);
    const f=harness(p);await f.observe(page);assert.equal(f.current.safety.hold.code,hold().code);
  }
});

test('missing acknowledgement or exact user identity cannot be replaced by READY text or hash resemblance',async()=>{
  for(const alter of [p=>p.sessionInitialization.acknowledgement.hash='a'.repeat(64),
    p=>p.sessionInitialization.acknowledgement=null,p=>p.lastPrompt.acknowledged=false,
    p=>p.lastPrompt.dispatchedUserTurnId='',p=>p.lastPrompt.transportId='foreign']) {
    const p=await seed(),page=pageFor(p);alter(p);const f=harness(p);await f.observe(page);
    assert.equal(f.current.safety.hold.code,hold().code);
  }
});

test('unrelated, quality and storage holds survive correct conversation evidence',async()=>{
  for(const code of ['ADMISSION_PAUSED','PROVIDER_QUOTA_HOLD','LOCAL_PACING_WAIT','DISPATCH_EFFECT_UNRESOLVED']) {
    const p=await seed();p.safety.hold={code,retryAtMs:Date.now()+30000};
    const f=harness(p);await f.observe(pageFor(p));assert.equal(f.current.safety.hold.code,code);
  }
  for(const alter of [p=>p.storageRecoveryRequired=true,p=>p.safety.qualityIncident={code:'IN_FLIGHT_QUALITY_QUARANTINE'},
    p=>p.greenfieldControl={hardStop:true},p=>p.phase=PHASES.PAUSED,
    p=>p.pendingPrompt.dispatch={effectPossible:null},p=>p.pendingPrompt.sendAttempts=1]) {
    const p=ready(await seed());alter(p);const f=harness(p);await f.observe(pageFor(p));
    assert.equal(f.current.safety.hold.code,hold().code);
  }
});

test('vanished model controls remain unverified despite a historical max receipt',async()=>{
  const p=await seed(),page=pageFor(p);
  p.safety.turnProof={allowed:true,highestEffortVerified:true,promptHash:p.lastPrompt.hash};
  Object.assign(page.modelEvidence,{modelLabel:'',effortLabel:'',reasoningControlSeen:false,effortControlSeen:false,
    thinkingControl:{ok:true,stage:'VERIFIED',selected:{value:'max'}}});
  const f=harness(p);await f.observe(page);
  assert.equal(f.current.safety.proof.allowed,false);assert.equal(f.current.safety.proof.code,'THINKING_MODE_UNVERIFIED');
  assert.equal(f.current.safety.hold.code,hold().code);
  await f.observe(pageFor(p));assert.equal(f.current.safety.hold,null);
});

test('a lower current composer blocks the next send and cannot resolve the initialization hold',async()=>{
  const p=await seed(),page=pageFor(p);page.modelEvidence.effortLabel='Light';
  const f=harness(p);await f.observe(page);
  assert.equal(f.current.safety.proof.allowed,false);assert.equal(f.current.safety.qualityIncident,null);
  assert.equal(f.current.safety.hold.code,hold().code);
});

test('unresolved initialization status is described in Swedish without claiming READY',async()=>{
  const p=await seed();const text=workerReason(p);
  assert.match(text,/initieringens konversation/);assert.doesNotMatch(text,/READY|PASS|SESSION_INITIALIZATION_/);
});
