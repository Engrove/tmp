import {withReasoningDependencies} from './fixtures/reasoning-dependencies.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { queueDispatchAdmission } from '../lib/queue-dispatch-admission.mjs';
import { scheduleBlockReason, SCHEDULE_BLOCK } from '../lib/queue-schedule.mjs';
import { loadMissionWorkQueue, saveMissionWorkQueue, updateMissionWorkItem } from '../lib/mission-work-queue.mjs';
import { restoreWorkerBinding } from '../lib/worker-identity.mjs';
import { createProcess, ownerToken, isCurrentToken } from '../lib/state.mjs';
import { loadProcessForWindow, saveProcess } from '../lib/process-store.mjs';
import { reconcileDispatchObservation } from '../lib/dispatch-reconciliation.mjs';
import { PHASES } from '../lib/contracts.mjs';

const root = process.env.GREENFIELD_SCHEDULE_BASELINE
  ? pathToFileURL(resolve(process.env.GREENFIELD_SCHEDULE_BASELINE) + '/') : new URL('../', import.meta.url);
const background = await readFile(new URL('background.js', root), 'utf8');
function fn(name, deps, source = background) {
  const start = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(start, name);
  const tail = source.slice(start.index), end = /^}\s*$/m.exec(tail);
  return Function(...Object.keys(withReasoningDependencies(deps)), tail.slice(0, end.index + end[0].length) + `;return ${name}`)(...Object.values(deps));
}
function storage() {
  const data = {};
  return { data, async get(keys) { return structuredClone(keys == null ? data : Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys]).filter(k => k in data).map(k => [k, data[k]]))); },
  async set(values) { Object.assign(data, structuredClone(values)); },
  async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; } };
}
// Monday local noon, independent of the developer machine's time zone.
const now = new Date(2026, 9, 19, 12, 0).getTime();
const day = { windows: [{ days: [1,2,3,4,5], start: '08:00', end: '17:00' }] };
const night = { windows: [{ days: [1,2,3,4,5], start: '22:00', end: '03:00' }] };
function pair(n, schedule = null) {
  const p = createProcess({ windowId: n, tabId: n+10, workerId: `worker-${n}`, goal: `GF-1.${n}.1000`, initialPrompt: `work-${n}` });
  p.queueContext = { queueId: `queue-${n}`, itemId: `item-${n}`, workerId: p.workerId, savedMissionId: `mission-${n}`, activationCount: 1, schedule: null };
  p.pendingPrompt.hash = `hash-${n}`;
  p.pendingPrompt.dispatch = { operationId: `send-${n}`, status: 'PREPARED', effectPossible: null };
  p.safety = { turnProof: { allowed: true, highestEffortVerified: true, promptHash: p.pendingPrompt.hash } };
  return { p, q: { queueId: p.queueContext.queueId, workerId: p.workerId, windowId: n, enabled: true, revision: 0,
    activeItemId: p.queueContext.itemId, items: [{ itemId: p.queueContext.itemId, savedMissionId: p.queueContext.savedMissionId,
      goal: p.goal, activationCount: 1, status: 'ACTIVE', schedule }] } };
}
async function harness(schedules = [day, night, null, night, null]) {
  const local = storage(), session = storage(), pairs = schedules.map((s,i) => pair(i+1,s));
  for (const {p,q} of pairs) {
    await restoreWorkerBinding(p.windowId, p.workerId, session);
    await saveMissionWorkQueue(q, local); await saveProcess(p, local, session);
  }
  const calls = [], reads = [];
  let mutateDuringUsage = null;
  const deps = { chrome: { runtime: { id: 'extension' }, storage: { local, session } }, runtimeFault: '', PHASES, ownerToken, isCurrentToken,
    Date: { now: () => now }, queueDispatchAdmission, isInitializationPrompt: () => false,
    maintainLocalStorage: async () => {}, usageIdentity: p => p.processId,
    loadProcessForWindow: id => loadProcessForWindow(id,local,session),
    loadMissionWorkQueue: async (id,area,options) => { reads.push({id,workerId:options.workerId}); return loadMissionWorkQueue(id,area,options); },
    readSafety: async () => ({ entries: pairs.map(({p}) => ({id:p.processId})) }),
    authorizeUsageSend: async (id,dispatch) => { calls.push({id,dispatch}); await mutateDuringUsage?.(id); return {allowed:true,policy:{}}; } };
  // The prior version has no final queue check. The extra dependency does not
  // change its authorization code; negative controls must fail on assertions.
  deps.readQueueDispatchAdmission = background.includes('async function readQueueDispatchAdmission(')
    ? fn('readQueueDispatchAdmission',deps) : async () => { throw Error('unused by baseline'); };
  const authorize = fn('authorizeDispatch',deps);
  return { local,session,pairs,calls,reads,deps,
    set duringUsage(f) { mutateDuringUsage = f; },
    authorize: p => authorize({dispatchId:p.pendingPrompt.dispatch.operationId,promptHash:p.pendingPrompt.hash},
      {id:'extension',tab:{id:p.tabId,windowId:p.windowId}}) };
}

test('five windows: a fleet grant never admits the two closed workers', async () => {
  const h = await harness();
  const results = await Promise.all(h.pairs.map(({p}) => h.authorize(p)));
  assert.deepEqual(results.map(x => x.ok), [true,false,true,false,true]);
  assert.equal(h.calls.length,3);
  for (const read of h.reads) assert.equal(read.workerId,`worker-${read.id}`);
  for (const n of [1,3]) assert.equal(results[n].code,'OUTSIDE_RUN_WINDOW');
});

test('schedule edited during shared usage authorization is re-read before grant', async () => {
  const h = await harness([day]);
  h.duringUsage = () => updateMissionWorkItem(1,'item-1',{schedule:night},h.local,{workerId:'worker-1'});
  const result = await h.authorize(h.pairs[0].p);
  assert.equal(result.ok,false); assert.equal(result.code,'OUTSIDE_RUN_WINDOW');
});

test('a cross-slot queue context cannot borrow another worker admission', async () => {
  const h = await harness([day,day]), p = structuredClone(h.pairs[0].p);
  p.queueContext = h.pairs[1].p.queueContext;
  await saveProcess(p,h.local,h.session);
  const result = await h.authorize(p);
  assert.equal(result.ok,false); assert.equal(result.code,'QUEUE_DISPATCH_OWNER_MISMATCH');
});

test('foreign sender tab cannot claim a sibling dispatch even when both windows are open', async () => {
  const h = await harness([day,day]), p = structuredClone(h.pairs[0].p);
  p.windowId=2;p.tabId=h.pairs[1].p.tabId;
  assert.equal((await h.authorize(p)).ok,false);
  assert.equal(h.calls.length,0);
});

test('initialization and Fortsätt obey the same local schedule without changing retry identity', async () => {
  for (const kind of ['SESSION_INITIALIZATION','DELIVERY_CONTINUATION']) {
    const h=await harness([night]),p=h.pairs[0].p;
    p.pendingPrompt.transportKind=kind;await saveProcess(p,h.local,h.session);
    assert.equal((await h.authorize(p)).code,'OUTSIDE_RUN_WINDOW');
    assert.equal((await loadProcessForWindow(p.windowId,h.local,h.session)).pendingPrompt.dispatch.operationId,p.pendingPrompt.dispatch.operationId);
  }
});

test('authoritative missing queue cannot fall back to an always-open prompt copy', async () => {
  const h = await harness([day]);
  h.deps.loadMissionWorkQueue = async () => { throw Error('checkpoint unavailable'); };
  const read = fn('readQueueDispatchAdmission',h.deps);
  const result = await read(h.pairs[0].p);
  assert.equal(result.ok,false); assert.equal(result.code,'QUEUE_SCHEDULE_UNAVAILABLE');
});

test('parallel edits in five worker queues preserve every slot schedule and registry identity', async () => {
  const h = await harness([null,null,null,null,null]);
  await Promise.all(h.pairs.map(({p}) => updateMissionWorkItem(p.windowId,p.queueContext.itemId,
    {schedule:p.windowId%2 ? day : night},h.local,{workerId:p.workerId})));
  const queues = await Promise.all(h.pairs.map(({p}) => loadMissionWorkQueue(p.windowId,h.local,{workerId:p.workerId})));
  assert.equal(new Set(queues.map(q=>q.queueId)).size,5);
  assert.deepEqual(queues.map(q=>scheduleBlockReason(q.items[0].schedule,now)),['','OUTSIDE_RUN_WINDOW','','OUTSIDE_RUN_WINDOW','']);
  for (const [i,q] of queues.entries()) assert.equal(q.items[0].itemId,`item-${i+1}`);
});

test('stopped, missing, foreign, superseded and paused queue ownership is scoped closed', () => {
  const {p,q} = pair(1,day);
  for (const patch of [{workerId:'foreign'},{queueId:'other'},{windowId:2},{activeItemId:'other'},{items:[]}])
    assert.equal(queueDispatchAdmission(p,{...q,...patch},now).ok,false);
  assert.equal(queueDispatchAdmission(p,{...q,enabled:false},now).code,'QUEUE_DISPATCH_STOPPED');
  q.items[0].schedule = {pauseUntilMs:now+30000};
  assert.equal(queueDispatchAdmission(p,q,now).code,'SCHEDULE_PAUSED');
});

test('daytime, overnight and inter-quantum interval retain their separate semantics', () => {
  const {p,q} = pair(1,day);
  const admitted = queueDispatchAdmission(p,q,now);
  assert.equal(admitted.ok,true); assert.equal(admitted.closesAtMs,new Date(2026,9,19,17).getTime());
  q.items[0].schedule = night;
  assert.equal(queueDispatchAdmission(p,q,new Date(2026,9,20,2).getTime()).ok,true);
  assert.equal(queueDispatchAdmission(p,q,new Date(2026,9,20,3).getTime()).ok,false);
  q.items[0].schedule = {minIntervalMinutes:180}; q.items[0].lastQuantumCompletedAtMs=now;
  assert.equal(queueDispatchAdmission(p,q,now).ok,true,'interval applies at quantum selection, not inside an active quantum');
});

test('a no-effect schedule denial parks after reconciliation; unknown effects are never discarded', async () => {
  const {p} = pair(1,night), parked=[],held=[],saved=[];
  const deps = {SCHEDULE_BLOCK,readQueueDispatchAdmission:async()=>({ok:false,code:'OUTSIDE_RUN_WINDOW'}),
    saveProcess:async x=>saved.push(x),nowIso:()=>new Date(now).toISOString(),
    parkQueueMissionForSchedule:async x=>{parked.push(x);return {...x,phase:'QUEUE_WAIT'};},
    holdForSafety:async(x,d)=>{held.push(d);return x;}};
  const enforce=fn('enforceQueueDispatchAdmission',deps);
  const unknown={...p,pendingPrompt:{...p.pendingPrompt,dispatch:{status:'TRANSPORT_UNKNOWN',effectPossible:null,baselineDocumentId:'old'}}};
  assert.equal(await enforce(unknown,reconcileDispatchObservation(unknown,{documentId:'new'})),null);
  assert.equal(parked.length,0); assert.equal(saved.length,0);
  const safe={...p,pendingPrompt:{...p.pendingPrompt,dispatch:{status:'NO_EFFECT_CONFIRMED',effectPossible:false}}};
  const result=await enforce(safe,reconcileDispatchObservation(safe,{}));
  assert.equal(result.phase,'QUEUE_WAIT');assert.equal(parked.length,1);assert.equal(parked[0].pendingPrompt.dispatch,null);
  assert.equal(result.runId,p.runId);assert.equal(result.queueContext.itemId,p.queueContext.itemId);assert.equal(held.length,0);
});
