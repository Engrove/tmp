import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GREENFIELD_BEHAVIOR_ROOT
  ? pathToFileURL(resolve(process.env.GREENFIELD_BEHAVIOR_ROOT) + '/') : new URL('../', import.meta.url);
const load = name => import(new URL(`lib/${name}.mjs`, root));
const { PHASES, TERMINAL_PHASES } = await load('contracts');
const { createProcess } = await load('state');
const { createKeyedQueue } = await load('keyed-queue');
const { jsonEqual } = await load('canonical-json');
const { normalizeMissionWorkQueue, selectNextMissionItem, deferMissionOwnershipWorkItem } = await load('mission-work-queue');
const { queueItemNextRunnableAtMs } = await load('queue-schedule');
const { managedOverlayOverview } = await load('overlay-summary');
const background = await readFile(new URL('background.js', root), 'utf8');
const content = await readFile(new URL('content.js', root), 'utf8');
const panel = await readFile(new URL('sidepanel.js', root), 'utf8');
const clone = structuredClone;

function fn(name, source, deps = {}) {
  const match = new RegExp(`^([ ]*)(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, name);
  const tail = source.slice(match.index);
  const end = new RegExp(`^${match[1]}}[ \\t]*$`, 'm').exec(tail);
  return Function(...Object.keys(deps), tail.slice(0, end.index + end[0].length) + `;return ${name};`)(...Object.values(deps));
}

function harness() {
  let now = Date.parse('2026-11-06T06:48:52.938Z');
  let current = { ...createProcess({ workerId: 'worker', windowId: 1, tabId: 2, goal: 'GFW GF-2.105.1029', initialPrompt: 'work' }),
    phase: 'QUEUE_WAIT', pendingPrompt: null, queueContext: null,
    queueWait: { queueId: 'queue', parkedItemId: 'previous', reason: 'QUANTUM_EXHAUSTED',
      since: '2026-11-06T06:39:08.988Z', nextWakeAtMs: Date.parse('2026-11-06T06:43:33.409Z') },
    lastPrompt: { hash: 'completed-prompt' }, lastResponse: { hash: 'completed-response' } };
  let queue = normalizeMissionWorkQueue({ queueId: 'queue', workerId: 'worker', windowId: 1,
    enabled: true, activeItemId: '', cursorOrder: 0, items: [
      { itemId: 'successor', goal: 'GFW GF-4.59.1030', label: 'GFW GF-4.59.1030', savedMissionId: 'mission-next',
        order: 1, status: 'PAUSED', pauseUntilMs: now - 1, lastOutcome: 'MISSION_OWNERSHIP_WAIT',
        lastError: { code: 'MISSION_PRIOR_EFFECT_UNRESOLVED' } }
    ] }, { now });
  let workerId = 'worker', writes = 0, attempts = 0, saveHook = null, activationHook = null;
  const broadcasts = [], overlays = [], alarms = [];
  class Clock extends Date { static now() { return now; } }
  const deps = { PHASES, TERMINAL_PHASES, jsonEqual, queueItemNextRunnableAtMs, Date: Clock,
    nowIso: () => new Date(now).toISOString(), queues: createKeyedQueue(),
    MISSION_QUEUE_WAKE_PREFIX: 'wake:', BACKGROUND_AUDIT_SESSION_ID: 'test',
    chrome: { storage: { local: {}, session: {} }, alarms: {
      clear: async () => true, create: async (name, alarm) => alarms.push({ name, ...alarm }) } },
    loadProcessForWindow: async () => clone(current), loadMissionWorkQueue: async () => clone(queue),
    getWorkerBinding: async () => ({ workerId }),
    missionQueueForWindow: async () => ({ queue: clone(queue), settings: {} }),
    acceptPendingMissionDelegationsForQueue: async () => {}, terminalQueueDispatchCandidate: () => false,
    refreshOwnerWaitingSlots: async q => q, reconcileRetryableTerminalQueueSlot: async () => null,
    reconcileTerminalQueueSlot: async () => {}, reconcileLegacyInitializationSlots: async q => q,
    audit: async () => {}, syncOverlay: async p => overlays.push(clone(p)),
    broadcast: async p => broadcasts.push(clone(p)),
    saveProcess: async (next, _local, _session, { expectedProcess } = {}) => {
      assert.ok(expectedProcess, 'metadata updates must use the durable process CAS');
      if (saveHook) { const hook = saveHook; saveHook = null; hook(); }
      if (!jsonEqual(current, expectedProcess)) throw Error('PROCESS_CHECKPOINT_CHANGED');
      if (workerId !== next.workerId) throw Error('PROCESS_WORKER_BINDING_MISMATCH');
      writes++; current = clone(next);
    },
    activateRunnableQueueSuccessor: async ({ priorProcess }) => {
      if (selectNextMissionItem(queue, { now })) {
        attempts++;
        queue = deferMissionOwnershipWorkItem(queue, 'successor', {
          code: 'MISSION_PRIOR_EFFECT_UNRESOLVED', retryAfterSeconds: 300, now });
      }
      await deps.syncMissionQueueWakeAlarm(queue);
      const result = { none: true, process: priorProcess, queue: clone(queue) };
      if (activationHook) { const hook = activationHook; activationHook = null; hook(); }
      return result;
    }
  };
  for (const name of ['queuePendingEffectNeedsReconciliation', 'queueItemNeedsEffectReconciliation',
    'missionQueueWakeAlarmName', 'syncMissionQueueWakeAlarm', 'earliestQueueWakeAtMs', 'refreshQueueWaitStatus']) {
    if (background.includes(`function ${name}(`)) deps[name] = fn(name, background, deps);
  }
  const wake = fn('wakeMissionQueue', background, deps);
  return { wake: () => wake(1, 'QUEUE_WAKE_ALARM'), deps, broadcasts, overlays, alarms,
    get current() { return current; }, get queue() { return queue; }, get now() { return now; },
    get writes() { return writes; }, get attempts() { return attempts; },
    onSave: hook => { saveHook = hook; }, afterAttempt: hook => { activationHook = hook; },
    stop: () => { current = { ...current, phase: 'STOPPED', queueWait: null }; queue.enabled = false; },
    rebind: () => { workerId = 'replacement'; }, advance: ms => { now += ms; } };
}

test('ownership retry refreshes the durable QUEUE_WAIT deadline instead of leaving the expired 06:43 deadline', async () => {
  const h = harness(), before = clone(h.current);
  const result = await h.wake();
  assert.equal(result.phase, 'QUEUE_WAIT'); assert.equal(h.attempts, 1); assert.equal(h.writes, 1);
  assert.equal(result.queueWait.nextWakeAtMs, h.now + 300000);
  assert.equal(result.queueWait.nextWakeAtMs, h.queue.items[0].pauseUntilMs);
  assert.equal(result.queueWait.nextWakeAtMs, h.alarms.at(-1).when);
  assert.equal(result.queueWait.lastCheckedAtMs, h.now);
  assert.equal(result.queueWait.since, before.queueWait.since);
  assert.deepEqual(result.lastPrompt, before.lastPrompt); assert.deepEqual(result.lastResponse, before.lastResponse);
  assert.equal(result.pendingPrompt, null); assert.equal(h.broadcasts.length, 1);
  await h.wake(); assert.equal(h.writes, 1); assert.equal(h.attempts, 1, 'an unexpired retry is not retried');
  assert.equal(h.overlays.length, 1, 'unchanged deadline still refreshes the read-only overlay');
  h.advance(300000); await h.wake();
  assert.equal(h.attempts, 2); assert.equal(h.current.queueWait.nextWakeAtMs, h.now + 300000);
});

for (const mutation of ['stop', 'queue-edit', 'active-item', 'binding', 'process-change']) {
  test(`wait status refresh preserves a concurrent ${mutation} before publication`, async () => {
    const h = harness();
    h.afterAttempt(() => {
      if (mutation === 'stop') h.stop();
      if (mutation === 'queue-edit') { h.queue.revision++; h.queue.items[0].pauseUntilMs += 3600000; }
      if (mutation === 'active-item') { h.queue.activeItemId = 'successor'; h.queue.items[0].status = 'ACTIVE'; }
      if (mutation === 'binding') h.rebind();
      if (mutation === 'process-change') h.current.generation++;
    });
    await h.wake(); assert.equal(h.writes, 0); assert.equal(h.broadcasts.length, 0);
    if (mutation === 'stop') assert.equal(h.current.phase, 'STOPPED');
    if (mutation === 'queue-edit') assert.equal(h.queue.items[0].pauseUntilMs, h.now + 3900000);
  });
}

for (const mutation of ['stop', 'new-process', 'binding']) {
  test(`durable process CAS prevents ${mutation} being overwritten after status reads`, async () => {
    const h = harness();
    h.onSave(() => {
      if (mutation === 'stop') h.stop();
      if (mutation === 'new-process') { h.current.processId = 'new-owner'; h.current.phase = 'ROTATING'; }
      if (mutation === 'binding') h.rebind();
    });
    await h.wake(); assert.equal(h.writes, 0); assert.equal(h.broadcasts.length, 0);
    if (mutation === 'stop') assert.equal(h.current.phase, 'STOPPED');
    if (mutation === 'new-process') assert.equal(h.current.processId, 'new-owner');
  });
}

test('unknown current dispatch prevents a queue recheck and any wait-status write', async () => {
  const h = harness(); h.current.pendingPrompt = { hash: 'uncertain', dispatch: { effectPossible: true }, sendAttempts: 1 };
  const before = clone(h.current); await h.wake();
  assert.deepEqual(h.current, before); assert.equal(h.writes, 0); assert.equal(h.attempts, 0);
});

test('public process snapshots include the actual queue recheck deadline', () => {
  const h = harness(), snapshot = fn('publicSnapshot', background, {
    normalizeGreenfieldPriority: value => value, DEFAULT_GREENFIELD_PRIORITY: 'NORMAL', sessionHealthCapsule: () => null
  })(h.current);
  assert.deepEqual(snapshot.queueWait, h.current.queueWait);
});

test('ownership countdown describes a recheck rather than a promised scheduled start', async () => {
  const h = harness(); await h.wake();
  const overview = managedOverlayOverview(h.current, { queue: h.queue, now: h.now });
  assert.match(overview.countdown[0].template, /ägarskapskontroll/);
  assert.doesNotMatch(overview.countdown[0].template, /start/);
  assert.match(overview.status, /Omprövas: GF-4\.59\.1030/);
  assert.doesNotMatch(overview.status, /QUANTUM_EXHAUSTED/);
  assert.equal(overview.countdown[0].atMs, h.queue.items[0].pauseUntilMs);
});

test('ordinary schedule remains a possible start, while queue cooldown is honored', () => {
  const h = harness(); h.queue.items[0].lastOutcome = 'QUANTUM_EXHAUSTED';
  h.queue.items[0].pauseUntilMs = h.now + 60000; h.queue.cooldownUntilMs = h.now + 90000;
  const overview = managedOverlayOverview(h.current, { queue: h.queue, now: h.now });
  assert.match(overview.countdown[0].template, /möjliga start/);
  assert.equal(overview.countdown[0].atMs, h.now + 90000);
});

test('a due retry is shown as due instead of being hidden behind a later queue item', () => {
  const h = harness(); h.queue.items.push({ itemId: 'later', label: 'GF-0.71.1008', order: 2,
    status: 'PAUSED', pauseUntilMs: h.now + 3600000 });
  const overview = managedOverlayOverview(h.current, { queue: h.queue, now: h.now });
  assert.match(overview.status, /GF-4\.59\.1030/);
  assert.match(overview.phaseText, /ägarskapskontroll/);
  assert.equal(overview.countdown.length, 0);
});

test('content countdown changes to due text at expiry rather than freezing at 0:00', async () => {
  const h = harness(); await h.wake();
  const info = { phase: 'QUEUE_WAIT', processId: h.current.processId,
    overview: managedOverlayOverview(h.current, { queue: h.queue, now: h.now }) };
  const deps = { CONTENT_VERSION: 'fixture',
    formatRemaining: fn('formatRemaining', content), overlayCountdown: fn('overlayCountdown', content) };
  const lines = fn('overlayLines', content, deps);
  assert.match(lines(info, h.now).join('\n'), /ägarskapskontroll om 5:00/);
  const expired = lines(info, h.now + 300001).join('\n');
  assert.match(expired, /Tid för ny ägarskapskontroll/); assert.doesNotMatch(expired, /om 0:00/);
});

test('panel never labels an expired queue recheck as a future start', () => {
  const h = harness(), status = fn('statusText', panel, { PHASES,
    state: {}, Date: class extends Date { static now() { return h.now; } },
    missionPauseRemainingMs: () => 0, promptPauseRemainingMs: () => 0,
    formatScheduleTime: value => new Date(value).toISOString(), reasonLabel: value => value });
  assert.match(status(h.current), /ny kontroll/);
  h.current.queueWait.nextWakeAtMs = h.now + 300000;
  assert.match(status(h.current), /nästa kökontroll/);
});
