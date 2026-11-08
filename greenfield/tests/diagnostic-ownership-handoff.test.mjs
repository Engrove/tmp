import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Replay the reported state through the production queue activation and
// ownership code. Only browser transport, UI/audit sinks and prompt composition
// are simulated; durable checkpoint, queue CAS, selection and ownership are real.
const root = process.env.GREENFIELD_DIAGNOSTIC_BASELINE
  ? pathToFileURL(resolve(process.env.GREENFIELD_DIAGNOSTIC_BASELINE) + '/')
  : new URL('../', import.meta.url);
const load = name => import(new URL('lib/' + name + '.mjs', root));
const {PHASES, TERMINAL_PHASES} = await load('contracts');
const {createProcess, ownerToken, isCurrentToken} = await load('state');
const {sha256Hex} = await load('common');
const {jsonEqual} = await load('canonical-json');
const {promptCausalMarker} = await load('turn-causality');
const {createKeyedQueue} = await load('keyed-queue');
const {writeCheckpoint, readCheckpoint} = await load('durable-checkpoint');
const {MISSION_OWNERSHIP_KEY, claimMissionOwnership, readMissionOwnership,
  missionOwnershipKey, findDormantMissionRecoverySource} = await load('mission-ownership');
const {QUEUE_STATUS, normalizeMissionWorkQueue, loadMissionWorkQueue,
  saveMissionWorkQueue, selectNextMissionItem: selectNextMissionItemUnchecked,
  deferMissionOwnershipWorkItem, reviveOwnershipContentionBlocks} = await load('mission-work-queue');
const {applyQueueParkTransition, latestResponseRoundTripMs} = await load('queue-planning');
const {queueItemNextRunnableAtMs} = await load('queue-schedule');
const {reviveArchivedEffectBlocks, prepareArchivedEffectRestart,
  archivedEffectRecoveryReceipt} = await load('mission-archive-recovery');
const background = await readFile(new URL('background.js', root), 'utf8');
const fixture = JSON.parse(await readFile(new URL('./fixtures/ownership-handoff-1030.json', import.meta.url), 'utf8'));

function production(name, deps) {
  const start = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(background)?.index;
  assert.notEqual(start, undefined, name);
  const tail = background.slice(start), end = /^}[ \t]*$/m.exec(tail);
  return Function(...Object.keys(deps), tail.slice(0, end.index + end[0].length) + ';return ' + name)(...Object.values(deps));
}
const ownershipDeferDeclaration = background.match(/const QUEUE_OWNERSHIP_DEFER_CODES = new Set\(\[[\s\S]*?\]\);/)[0];
const ownershipDeferCodes = Function(ownershipDeferDeclaration + ';return QUEUE_OWNERSHIP_DEFER_CODES;')();

class MemoryStorage {
  data = {};
  async get(keys) {
    if (keys == null) return structuredClone(this.data);
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    return structuredClone(Object.fromEntries(names.filter(k => k in this.data).map(k => [k, this.data[k]])));
  }
  async set(rows) { Object.assign(this.data, structuredClone(rows)); }
  async remove(keys) { for (const k of typeof keys === 'string' ? [keys] : keys) delete this.data[k]; }
}

async function harness(t, {firstHandoff = false, unresolvedWork = false, livePriorOwner = false,
  fallback = false, noEffectStatus = '', priorParkedNoWork = false} = {}) {
  const data = structuredClone(fixture), storage = new MemoryStorage();
  let now = firstHandoff ? data.firstHandoffAtMs : data.expected.targetAutomaticRetryAtMs;
  t.mock.method(Date, 'now', () => now);
  let current = data.currentProcess, queue = normalizeMissionWorkQueue(data.queue, {now});
  if (firstHandoff) {
    const parked = queue.items.find(i => i.processSnapshot?.processId === current.processId);
    current = {...structuredClone(parked.processSnapshot), phase: PHASES.ANALYZING,
      queueWait: null, pendingPrompt: null,
      queueContext: {...parked.processSnapshot.queueContext, interactionCount: 6}};
    queue.activeItemId = parked.itemId;
    queue.cursorOrder = 2;
    queue.items = queue.items.map(i => i.itemId === parked.itemId ? {...i, status: 'ACTIVE'}
      : {...i, status: 'READY', pauseUntilMs: 0, lastError: null, lastOutcome: ''});
  }
  if (unresolvedWork) {
    data.priorProcess.pendingPrompt.sendAttempts = 1;
    data.priorProcess.pendingPrompt.dispatch = {operationId: 'unresolved-operative-send', effectPossible: true};
  }
  if (noEffectStatus) {
    const work = data.priorProcess.pendingPrompt;
    work.sendAttempts = 1;
    work.dispatch = {operationId: 'confirmed-not-sent', status: noEffectStatus,
      startedAt: '2026-11-05T13:45:00.000Z', completedAt: '2026-11-05T13:45:01.000Z',
      effectPossible: false, acknowledged: false,
      acknowledgementEvidence: '', method: '', baselineDocumentId: 'original-document',
      baselineUserCount: 1, baselineAssistantCount: 1, baselineAssistantHash: work.baselineAssistantHash,
      baselineLastUserId: data.priorProcess.lastPrompt.dispatchedUserTurnId,
      promptMarker: promptCausalMarker(work.text), replayCount: 0};
  }
  if (priorParkedNoWork) {
    data.priorProcess.pendingPrompt = null;
    data.priorProcess.objectiveState.status = 'PARKED_QUEUE';
  }
  if (fallback) queue.items.push({itemId: 'independent-item', savedMissionId: 'independent-mission',
    goal: 'GFW: GF-0.71.1999.', label: 'Independent mission', status: 'READY',
    order: 4, maxInteractions: 3, activationCount: 0, reasoningLevel: 'high'});
  queue = normalizeMissionWorkQueue(queue, {now});
  const settings = {queueSwitchHardReload: true, queueSwitchDelaySeconds: 5,
    queueSwitchSettleSeconds: 2, warmQueueResume: true};
  const events = [], alarms = [], fast = [], savedProcesses = [];
  const live = livePriorOwner ? [...data.liveWorkerIds, data.priorProcess.workerId] : data.liveWorkerIds;
  await writeCheckpoint(MISSION_OWNERSHIP_KEY, data.ownership, storage);
  await writeCheckpoint('eic.gf.process.worker.' + data.priorProcess.workerId, data.priorProcess, storage);
  await writeCheckpoint('eic.gf.mission-work-queue.worker.' + data.priorQueue.workerId,
    normalizeMissionWorkQueue(data.priorQueue, {now}), storage);
  await writeCheckpoint('eic.gf.process.worker.' + current.workerId, current, storage);
  await writeCheckpoint('eic.gf.mission-work-queue.worker.' + queue.workerId, queue, storage);
  const workerId = current.workerId, windowId = queue.windowId;
  const getQueue = () => loadMissionWorkQueue(windowId, storage, {workerId});
  const deps = {
    PHASES, TERMINAL_PHASES, QUEUE_STATUS, ownerToken, isCurrentToken, jsonEqual,
    selectNextMissionItemUnchecked, queueItemNextRunnableAtMs, applyQueueParkTransition, latestResponseRoundTripMs,
    deferMissionOwnershipWorkItem, reviveOwnershipContentionBlocks, reviveArchivedEffectBlocks,
    prepareArchivedEffectRestart, archivedEffectRecoveryReceipt, readMissionOwnership,
    missionOwnershipKey, findDormantMissionRecoverySource, deepClone: structuredClone,
    QUEUE_OWNERSHIP_DEFER_CODES: ownershipDeferCodes, ROTATION_TIMEOUT_COOLDOWN_MS: 300000,
    ROTATION_TIMEOUT_BLANK_URL: 'about:blank', MISSION_QUEUE_WAKE_PREFIX: 'queue-wake:',
    ARCHIVED_MISSION_PURGE_ALARM: 'archive-purge', PROCESS_STATUS_REQUEST: 'FULL_NEXT_PROMPT',
    BACKGROUND_AUDIT_SESSION_ID: 'diagnostic-replay', nowIso: () => new Date(now).toISOString(),
    queues: createKeyedQueue(), instructionQueues: createKeyedQueue(),
    chrome: {storage: {local: storage}, tabs: {
      get: async id => ({id, windowId, url: 'https://chatgpt.com/g/g-test/c/current'}),
      query: async () => [], create: async () => { throw Error('Unexpected extra tab'); }
    }, alarms: {create: async (name, value) => alarms.push({name, ...value}), clear: async () => true}},
    loadMissionWorkQueue, loadProcessForWindow: async () => structuredClone(current),
    missionQueueForWindow: async () => ({queue: await getQueue(), settings}),
    persistMissionQueue: async (q, _settings, _process, kind) => {
      const saved = await saveMissionWorkQueue(q, storage);
      events.push({kind});
      await deps.syncMissionQueueWakeAlarm(saved);
      return saved;
    },
    saveProcess: async p => {
      current = structuredClone(p);
      savedProcesses.push(p.processId);
      await writeCheckpoint('eic.gf.process.worker.' + p.workerId, p, storage);
    },
    supportedUrl: () => true, readEicSurfaceState: async () => ({entryUrl: 'https://chatgpt.com/g/g-test'}),
    resolveManagedGptRoot: () => 'https://chatgpt.com/g/g-test',
    resolveSavedMissionReference: () => ({record: null}), currentSavedMissions: async () => [],
    liveMissionWorkerIds: async () => live,
    ensureMissionExecutionOwner: (p, opts) => claimMissionOwnership(p, {storage, liveWorkerIds: () => live, ...opts}),
    buildQueueActivationProcess: async ({queue: q, item, tab, gptRoot}) => {
      const objective = item.resume?.objective || 'Read current owner state';
      const fresh = createProcess({workerId, windowId, tabId: tab.id, goal: item.goal, initialPrompt: objective});
      const a2a = {messageType: 'MISSION_START', messageId: 'new-' + fresh.processId, mission: item.goal, objective};
      const text = JSON.stringify(a2a);
      return {...fresh, phase: PHASES.ROTATING, gptRoot,
        objectiveState: {...fresh.objectiveState, objective},
        queueContext: {queueId: q.queueId, workerId, itemId: item.itemId, savedMissionId: item.savedMissionId,
          activationCount: Number(item.activationCount || 0) + 1, interactionCount: 0},
        pendingPrompt: {text, hash: await sha256Hex(text), a2a, sendAttempts: 0, dispatch: null},
        lastPrompt: null, lastResponse: null, sessionRotation: {warmResume: {warm: false}}};
    },
    readNextInstruction: async () => null, readSafety: async () => ({}),
    cancelSchedulerProcess: async () => {}, setWatchdog: async () => {}, broadcast: async () => {},
    audit: async (_p, kind, component, detail) => events.push({kind, component, detail}),
    recordIncident: async (_p, kind, code, detail) => events.push({kind, code, detail}),
    scheduleFast: id => fast.push(id), alarmName: id => 'watch:' + id, missionPauseAlarmName: id => 'pause:' + id,
    acceptPendingMissionDelegationsForQueue: async () => {}, refreshOwnerWaitingSlots: async q => q,
    terminalQueueDispatchCandidate: () => false, reconcileRetryableTerminalQueueSlot: async () => null,
    reconcileTerminalQueueSlot: async () => {}, reconcileLegacyInitializationSlots: async q => q,
    // The positive cases must activate a successor directly; falling back to
    // idle here makes the regression fail rather than substituting a fake pass.
    finishParkedQueueHandoff: async () => { throw Error('HANDOFF_STILL_BLOCKED'); }
  };
  for (const name of ['queuePendingEffectNeedsReconciliation', 'queueItemNeedsEffectReconciliation',
    'selectNextMissionItem', 'queueActivationSourceMatches', 'queueActivationEffectBoundary',
    'missionQueueWakeAlarmName', 'syncMissionQueueWakeAlarm', 'activateQueueItem',
    'activateRunnableQueueSuccessor', 'parkSlotAndActivateNext', 'wakeMissionQueue']) {
    deps[name] = production(name, deps);
  }
  return {data, storage, events, alarms, fast, savedProcesses, deps, settings, getQueue,
    get current() { return current; },
    async wake() { return deps.wakeMissionQueue(windowId, 'SERVICE_WORKER_RESTART'); },
    async firstHandoff() {
      const q = await getQueue(), item = q.items.find(i => i.itemId === current.queueContext.itemId);
      const parkedSnapshot = {...structuredClone(current), queueContext: {...current.queueContext, interactionCount: 0},
        objectiveState: {...current.objectiveState, status: 'PARKED_QUEUE'}};
      return deps.parkSlotAndActivateNext({current: structuredClone(current), queue: q, settings, item,
        parkedSnapshot, resume: {objective: 'Continue from verified checkpoint', previousResponseHash: current.lastResponse.hash},
        outcome: 'QUANTUM_EXHAUSTED', summary: 'Six interactions completed', resumedQuantumProgress: 0,
        quantumCompleted: true, idleWhenNoNext: true});
    }
  };
}

test('diagnostic replay: sixth 1029 response parks once and immediately activates 1030', async t => {
  const h = await harness(t, {firstHandoff: true});
  const responseHash = h.current.lastResponse.hash;
  const result = await h.firstHandoff(), q = await h.getQueue();
  assert.equal(result.phase, PHASES.ROTATING);
  assert.equal(result.queueContext.itemId, fixture.expected.targetItemId);
  assert.equal(q.activeItemId, fixture.expected.targetItemId);
  const parked = q.items.find(i => i.goal.includes('1029'));
  assert.equal(parked.status, 'READY');
  assert.equal(parked.quantumProgress, 0);
  assert.equal(parked.processSnapshot.lastResponse.hash, responseHash);
  assert.equal(parked.lastQuantumCompletedAtMs, fixture.queue.items[0].lastQuantumCompletedAtMs,
    'replaying the same completed response must preserve its original interval deadline');
  assert.equal(h.events.filter(e => e.kind === 'MISSION_QUEUE_ITEM_PARKED').length, 1);
  assert.equal(h.events.filter(e => e.kind === 'MISSION_OWNERSHIP_HELD').length, 0);
  assert.equal(h.fast.length, 1);
  const owner = (await readMissionOwnership(h.storage)).owners[fixture.expected.targetMissionKey];
  assert.equal(owner.processId, result.processId);
  assert.equal(owner.workerId, fixture.currentProcess.workerId);
  assert.ok(owner.supersededWorkerIds.includes(fixture.priorProcess.workerId));
});

test('diagnostic replay: saved QUEUE_WAIT resumes 1030 on retry without resetting the queue', async t => {
  const h = await harness(t), originalParked = structuredClone((await h.getQueue()).items[0]);
  const result = await h.wake();
  assert.equal(result.queueContext?.itemId, fixture.expected.targetItemId);
  assert.equal(result.phase, PHASES.ROTATING);
  assert.equal(result.pendingPrompt.a2a.messageType, 'MISSION_START');
  assert.notEqual(result.pendingPrompt.hash, fixture.priorProcess.pendingPrompt.hash);
  assert.equal(result.pendingPrompt.sendAttempts, 0);
  assert.equal(result.lastPrompt, null);
  assert.deepEqual((await h.getQueue()).items[0], originalParked);
  await h.wake();
  assert.equal(h.savedProcesses.length, 1);
  assert.equal(h.fast.length, 1);
  assert.equal(h.events.filter(e => e.kind === 'MISSION_QUEUE_WAKE_ACTIVATED').length, 1);
});

for (const mode of ['unresolvedWork', 'livePriorOwner']) {
  test('diagnostic replay: ' + mode + ' automatically takes over 1030 with no-replay quarantine', async t => {
    const h = await harness(t, {[mode]: true, fallback: true});
    const result = await h.wake(), q = await h.getQueue();
    assert.equal(result.queueContext?.itemId, fixture.expected.targetItemId);
    assert.equal(result.phase, PHASES.ROTATING);
    if (mode === 'unresolvedWork') assert.match(result.pendingPrompt.text, /ARCHIVED_EFFECT_QUARANTINE/);
    else assert.equal(result.pendingPrompt.a2a.messageType, 'MISSION_START', 'settled prior work needs no quarantine prompt');
    assert.equal(result.pendingPrompt.sendAttempts, 0);
    assert.equal(result.pendingPrompt.dispatch, null);
    const owner = (await readMissionOwnership(h.storage)).owners[fixture.expected.targetMissionKey];
    assert.equal(owner.workerId, fixture.currentProcess.workerId);
    assert.ok(owner.supersededWorkerIds.includes(fixture.priorProcess.workerId));
    assert.equal(h.fast.length, 1);
  });
}

for (const noEffectStatus of ['NO_EFFECT_CONFIRMED', 'RATE_LIMIT_REJECTED_NO_EFFECT', 'ABORTED_BEFORE_EFFECT_GLOBAL_RATE_LIMIT']) {
  test('diagnostic replay: first work attempt confirmed not sent allows new owner: ' + noEffectStatus, async t => {
    const h = await harness(t, {noEffectStatus});
    const result = await h.wake();
    assert.equal(result.queueContext?.itemId, fixture.expected.targetItemId);
    assert.equal(result.phase, PHASES.ROTATING);
    assert.equal(result.pendingPrompt.dispatch, null);
    assert.equal(result.pendingPrompt.sendAttempts, 0);
    assert.notEqual(result.pendingPrompt.hash, fixture.priorProcess.pendingPrompt.hash);
    const old = (await readCheckpoint('eic.gf.process.worker.' + fixture.priorProcess.workerId, h.storage)).value;
    assert.equal(old.pendingPrompt.dispatch.status, noEffectStatus, 'original no-effect receipt remains intact');
    assert.equal(h.fast.length, 1);
  });
}

test('diagnostic replay: a completed bootstrap parked without a work draft permits cross-worker succession', async t => {
  const h = await harness(t, {priorParkedNoWork: true});
  const result = await h.wake();
  assert.equal(result.queueContext?.itemId, fixture.expected.targetItemId);
  assert.equal(result.phase, PHASES.ROTATING);
  assert.equal(h.fast.length, 1);
});
