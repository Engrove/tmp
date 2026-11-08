import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

// Allows the same regression to fail against the immutable delivered v1.9.20.
const root = process.env.GREENFIELD_QUEUE_BASELINE
  ? pathToFileURL(resolve(process.env.GREENFIELD_QUEUE_BASELINE) + '/') : new URL('../', import.meta.url);
const load = n => import(new URL(`lib/${n}.mjs`, root));
const background = await readFile(new URL('background.js', root), 'utf8');
const content = await readFile(new URL('content.js', root), 'utf8');
const { jsonEqual, canonicalJson } = await load('canonical-json');
const { PHASES, TERMINAL_PHASES } = await load('contracts');
const { createProcess, transitionProcess, ownerToken, isCurrentToken } = await load('state');
const { buildA2AEnvelope, validateA2AEnvelope } = await load('a2a');
const { SESSION_ROTATION_STATES } = await load('session-rotation');
const transport = await load('session-transport');
const { legacyInitializationRecoveryCandidate } = await load('initialization-recovery');
const { prepareSessionInitialization, expectedInitializationAck, isInitializationPrompt,
  isTransportPrompt, legacyInitializationUpgradeAllowed, DELIVERY_CONTINUATION } = transport;
const { conversationKey } = await load('restart-recovery');
const { autonomousResponseObservation, autonomousUserTurnProof } = await load('turn-causality');
const { initializationAcknowledged, advanceResponseCandidate } = await load('response-stability');
const { responseStructuralCompleteness } = await load('response-observation');
const { providerTransportPending } = await load('waiting-refresh');
const { normalizeMissionWorkQueue, selectNextMissionItem: uncheckedSelect, QUEUE_STATUS,
  requeueBlockedMissionWorkItem, reviveOwnershipContentionBlocks } = await load('mission-work-queue');
const rotationPolicy = await load('rotation-timeout-policy');
const { applyQueueParkTransition, latestResponseRoundTripMs } = await load('queue-planning');
const { scheduleBlockReason, queueItemNextRunnableAtMs } = await load('queue-schedule');
const { createKeyedQueue } = await load('keyed-queue');
const { workerReason, reasonLabel } = await load('operations-view');
const clone = structuredClone;
const digest = s => createHash('sha256').update(s).digest('hex');
const reordered = x => JSON.parse(canonicalJson(x));
function source(name, text = background, indent = '') {
  const hit = new RegExp(`^${indent}(?:async )?function ${name}\\(`, 'm').exec(text);
  assert.ok(hit, name);
  const tail = text.slice(hit.index), end = new RegExp(`^${indent}}\\s*$`, 'm').exec(tail);
  return tail.slice(0, end.index + end[0].length);
}
const runtime = (name, deps) => Function(...Object.keys(deps), source(name) + `;return ${name};`)(...Object.values(deps));
const warmResumeTarget = runtime('warmResumeTarget', {});
const common = { ...rotationPolicy, reviveOwnershipContentionBlocks, PHASES, TERMINAL_PHASES, SESSION_ROTATION_STATES, QUEUE_STATUS, warmResumeTarget,
  jsonEqual, canonicalJson, validateA2AEnvelope, isInitializationPrompt, isTransportPrompt,
  conversationKey, ownerToken, isCurrentToken, deepClone: clone, sha256Hex: async s => digest(s) };

function worker() {
  const p = { ...createProcess({ workerId: 'worker-a', windowId: 1, tabId: 2,
    goal: 'Projekt: 71 - Test - GFW: GF-1.71.1021', initialPrompt: ('Frozen obligation ' + 'scope '.repeat(270)).trim() }),
    phase: PHASES.WAITING, turn: 45, sessionSeq: 5, pendingPrompt: null, lastManagedUrl: 'https://chatgpt.com/c/original',
    queueContext: { queueId: 'queue-a', workerId: 'worker-a', itemId: 'item-a', savedMissionId: 'mission-a',
      interactionCount: 0, maxInteractions: 4 }, ownerProgress: { root: { ref: 'owner/frozen-root', terminal: false } },
    sessionBroker: { sessionSeq: 4, completedQuanta: 2, operativePrompts: 8 } };
  return p;
}
function workFor(p) {
  const a2a = buildA2AEnvelope({ process: p, objective: p.objectiveState.objective });
  const text = JSON.stringify(a2a);
  return { text, hash: digest(text), a2a, sendAttempts: 0, dispatch: null };
}
function blockedRotation() {
  const p = { ...worker(), phase: PHASES.BLOCKED, version: '1.9.20',
    lastError: { code: 'SESSION_ROTATION_CHAT_READY_TIMEOUT' },
    sessionRotation: { rotationId: 'rotation-a', state: 'NAVIGATING', sourceUrl: 'https://chatgpt.com/c/original',
      sourceResponseState: 'COMPLETED_RESPONSE_CAPTURED', navigationStartedAt: '2026-10-18T03:15:01.369Z' },
    lastPrompt: { text: 'prior work', hash: digest('prior work'), acknowledged: true, dispatchedUserTurnId: 'user-a',
      conversationKey: 'https://chatgpt.com/c/original' },
    lastResponse: { text: 'Owner verified partial checkpoint. Root remains OPEN.',
      hash: digest('Owner verified partial checkpoint. Root remains OPEN.'), messageId: 'assistant-a', contract: { ok: true },
      observation: { messageId: 'assistant-a', ownerTrusted: true, causalMatch: true,
        pairedUserTurnId: 'user-a', expectedUserTurnId: 'user-a', conversationKey: 'https://chatgpt.com/c/original' } } };
  p.pendingPrompt = workFor(p);
  return p;
}
function queueFor(p, next = true) {
  return normalizeMissionWorkQueue({ queueId: p.queueContext.queueId, workerId: p.workerId,
    windowId: p.windowId, enabled: true, activeItemId: 'item-a', items: [
      { itemId: 'item-a', savedMissionId: 'mission-a', goal: p.goal, status: 'ACTIVE', order: 0, maxInteractions: 4 },
      ...(next ? [{ itemId: 'item-b', savedMissionId: 'mission-b', goal: 'Independent GF-1.2.1022', status: 'READY', order: 1 }] : [])
    ] }, { workerId: p.workerId, windowId: p.windowId });
}
function queueHarness(seed, { next = true, paused = false, quota = false, nextPaused = false, crash = false } = {}) {
  let current = clone(seed), queue = queueFor(seed, next), clock = Date.now(), writes = 0, activations = 0;
  const events = [], schedules = [], holds = [];
  if (nextPaused) { queue.items[1].status = 'PAUSED'; queue.items[1].pauseUntilMs = clock + 3600000; }
  class Clock extends Date { static now() { return clock; } }
  const deps = { ...common, legacyInitializationRecoveryCandidate, APP_VERSION: '1.9.28', BACKGROUND_AUDIT_SESSION_ID: 'test', Date: Clock, MAX_QUEUE_HISTORY: 30, latestResponseRoundTripMs, applyQueueParkTransition,
    requeueBlockedMissionWorkItem, queueItemNextRunnableAtMs, scheduleBlockReason,
    nowIso: () => new Date(clock).toISOString(), queues: createKeyedQueue(),
    chrome: { storage: { local: {}, session: {} }, alarms: { clear: async () => true, create: async () => {} } },
    readSafety: async () => ({ admissionPaused: paused, providerHold: quota ? {} : null }),
    getWorkerBinding: async () => ({ workerId: current.workerId }),
    loadProcessForWindow: async () => reordered(current),
    loadMissionWorkQueue: async () => reordered(queue),
    missionQueueForWindow: async () => ({ queue: reordered(queue), worker: { workerId: current.workerId },
      settings: { queuePriorityAgingSeconds: 300 } }),
    readNextInstruction: async () => null, audit: async () => {}, appendAudit: async () => {},
    recordIncident: async (p, kind, code) => events.push({ kind, code }),
    persistMissionQueue: async q => { writes++; queue = reordered(q); if (crash) { crash = false; throw Error('CRASH_AFTER_QUEUE_WRITE'); } return clone(queue); },
    activateQueueItem: async ({ item }) => { activations++; queue.activeItemId = item.itemId;
      item.status = 'ACTIVE'; return { process: current = { ...worker(), processId: 'independent-process', phase: 'ROTATING',
        queueContext: { ...worker().queueContext, itemId: item.itemId, savedMissionId: item.savedMissionId } } }; },
    cancelSchedulerProcess: async () => {}, releaseSchedulerTurn: async () => {},
    alarmName: () => 'watch', missionPauseAlarmName: () => 'pause',
    syncMissionQueueWakeAlarm: async () => {}, syncOverlay: async () => {},
    scheduleFast: (id, delay) => schedules.push({ id, delay }),
    holdForSafety: async (p, hold) => { holds.push(hold.code); return current = { ...p, safety: { ...p.safety, hold } }; },
    saveObserved: async (p, patch) => current = { ...p, ...patch },
    commitTransition: async (p, phase, patch, options = {}) => {
      const boundary = await options.beforeSave?.();
      if (boundary?.blocked) return boundary.process;
      events.push({ kind: options.kind });
      return current = transitionProcess(p, phase, patch, clock);
    },
    queueResumeRecordFromAnalysis: ({ current, effectiveNextPrompt, previousDisposition, sessionReason }) => ({
      objective: effectiveNextPrompt, retainedObjective: current.objectiveState, previousDisposition, sessionReason }),
    legacyAdvisoryBlockedCandidate: () => false, legacyRotationBlockedCandidate: () => false,
    acceptPendingMissionDelegationsForQueue: async () => {}, refreshOwnerWaitingSlots: async q => q,
    terminalQueueDispatchCandidate: () => false, reconcileTerminalQueueSlot: async () => false };
  for (const name of ['queueItemForProcess', 'queuePendingEffectNeedsReconciliation', 'queueItemNeedsEffectReconciliation',
    'queueActivationSourceMatches', 'queueActivationEffectBoundary', 'terminalQueueDispatchOwner', 'transportTransitionBoundary'])
    deps[name] = runtime(name, deps);
  deps.selectNextMissionItem = (q, opts) => uncheckedSelect({ ...q,
    items: q.items.filter(item => !deps.queueItemNeedsEffectReconciliation(q, item)) }, { now: clock, ...opts });
  Object.assign(deps,{QUEUE_OWNERSHIP_DEFER_CODES:new Set(['MISSION_PRIOR_EFFECT_UNRESOLVED']),
    ROTATION_TIMEOUT_COOLDOWN_MS:300000, rotationTimeoutCooldownUntil:now=>now+300000});
  deps.activateRunnableQueueSuccessor=runtime('activateRunnableQueueSuccessor',deps);
  for (const name of ['earliestQueueWakeAtMs', 'enterQueueWait', 'parkedQueueWaitBoundary', 'finishParkedQueueHandoff', 'parkSlotAndActivateNext',
    'finalizeQueueTerminalAndMaybeAdvance', 'completedUnsentQueueRotationCandidate', 'reconcileRetryableTerminalQueueSlot', 'reconcileLegacyInitializationSlots', 'wakeMissionQueue'])
    if (background.includes(`function ${name}(`)) deps[name] = runtime(name, deps);
  return { deps, events, holds, schedules, get current() { return current; }, set current(p) { current = p; },
    get queue() { return queue; }, get writes() { return writes; }, get activations() { return activations; },
    get clock() { return clock; }, advance: ms => clock += ms };
}

test('JSON owner equality ignores key order but distinguishes absence, null, arrays and changed values', () => {
  assert.equal(jsonEqual({ b: 1, a: { y: 2, x: 3 } }, { a: { x: 3, y: 2 }, b: 1 }), true);
  assert.equal(jsonEqual(undefined, undefined), true); assert.equal(jsonEqual(undefined, null), false);
  assert.equal(jsonEqual([1, 2], [2, 1]), false); assert.equal(jsonEqual({ a: 1 }, { a: 2 }), false);
});
test('reordered durable process and queue do not falsely block queue activation', async () => {
  const p = worker(), h = queueHarness(p), q = clone(h.queue);
  const r = await h.deps.queueActivationEffectBoundary({ queue: q, item: q.items[0], windowId: 1,
    priorProcess: p, expectedProcess: p, expectedQueue: q });
  assert.equal(Boolean(r.blocked), false);
});
for (const mutation of ['stop', 'objective', 'receipt', 'revision', 'worker']) test(`queue activation still rejects changed ${mutation}`, async () => {
  const p = worker(), h = queueHarness(p), q = clone(h.queue);
  if (mutation === 'revision') h.queue.revision++;
  else if (mutation === 'stop') h.current.phase = PHASES.STOPPED;
  else if (mutation === 'objective') h.current.objectiveState.objective = 'changed';
  else if (mutation === 'worker') h.current.workerId = 'foreign';
  else h.current.pendingPrompt = { sendAttempts: 1, dispatch: { effectPossible: null } };
  const r = await h.deps.queueActivationEffectBoundary({ queue: q, item: q.items[0], windowId: 1, priorProcess: p });
  assert.equal(r.blocked, true); assert.equal(h.writes, 0);
});
test('BLOCKED publication survives reordered storage and saves a bounded retry instead of an ACTIVE orphan', async () => {
  const p = blockedRotation(), h = queueHarness(p, { next: false });
  await h.deps.finalizeQueueTerminalAndMaybeAdvance(p);
  assert.equal(h.queue.activeItemId, ''); assert.equal(h.queue.items[0].status, 'BLOCKED');
  assert.ok(h.queue.items[0].blockedRetryAtMs > h.clock); assert.equal(h.queue.items[0].blockedCount, 1);
  assert.deepEqual(h.queue.items[0].processSnapshot.pendingPrompt, p.pendingPrompt);
  assert.deepEqual(h.queue.items[0].processSnapshot.ownerProgress, p.ownerProgress);
  assert.equal(h.queue.items[0].resume.objective, p.objectiveState.objective); assert.equal(h.activations, 0);
});
test('startup repairs the completed-response rotation orphan once, then resumes same slot when cooldown expires', async () => {
  const p = blockedRotation(), h = queueHarness(p, { next: false });
  await h.deps.wakeMissionQueue(1, 'RESTART_QUEUE_RECONCILE');
  assert.equal(h.queue.items[0].blockedCount, 1); assert.equal(h.writes, 1);
  await h.deps.wakeMissionQueue(1, 'RESTART_QUEUE_RECONCILE');
  assert.equal(h.writes, 1, 'recovery cannot extend the cooldown on each scan');
  h.advance(h.queue.items[0].blockedRetryAtMs - h.clock + 1); await h.deps.wakeMissionQueue(1, 'QUEUE_WAKE_ALARM');
  assert.equal(h.activations, 1); assert.equal(h.current.queueContext.itemId, p.queueContext.itemId);
  assert.equal(h.current.queueContext.savedMissionId, p.queueContext.savedMissionId);
});
test('rotation orphan yields to an independent slot after the documented five-minute worker cooldown', async () => {
  const h = queueHarness(blockedRotation()); await h.deps.wakeMissionQueue(1, 'RESTART');
  assert.equal(h.activations, 0);
  assert.equal(h.queue.cooldownUntilMs - h.clock, 300000);
  h.advance(300001); await h.deps.wakeMissionQueue(1, 'QUEUE_WAKE_ALARM');
  assert.equal(h.activations, 1); assert.equal(h.current.queueContext.itemId, 'item-b');
  assert.equal(h.queue.items[0].status, 'BLOCKED');
});
for (const kind of ['unknown', 'untrusted', 'cross-turn', 'cross-run', 'pause', 'quota', 'hash', 'stopped', 'hard-stop'])
test(`rotation orphan recovery refuses ${kind}`, async () => {
  const p = blockedRotation();
  if (kind === 'unknown') p.pendingPrompt.dispatch = { effectPossible: null };
  if (kind === 'untrusted') p.lastResponse.observation.ownerTrusted = false;
  if (kind === 'cross-turn') p.lastResponse.observation.pairedUserTurnId = 'other';
  if (kind === 'cross-run') p.runId = 'foreign';
  if (kind === 'hash') p.pendingPrompt.hash = 'wrong';
  if (kind === 'stopped') p.phase = 'STOPPED';
  if (kind === 'hard-stop') p.greenfieldControl = { hardStop: true };
  const h = queueHarness(p, { paused: kind === 'pause', quota: kind === 'quota' });
  await h.deps.reconcileRetryableTerminalQueueSlot(p, 'RESTART'); assert.equal(h.writes, 0); assert.equal(h.activations, 0);
});

async function ackHarness(options = {}) {
  let p = worker(); p.turn = 7; p.sessionSeq = 2; p.pendingPrompt = null;
  const packet = await prepareSessionInitialization(p, workFor(p), { url: p.lastManagedUrl });
  p = { ...p, sessionInitialization: packet.sessionInitialization,
    lastPrompt: { ...packet.pendingPrompt, acknowledged: true, dispatchedUserTurnId: 'init-user', dispatchId: 'init-dispatch',
      conversationKey: conversationKey(p.lastManagedUrl) } };
  const h = queueHarness(p, options), deps = h.deps;
  Object.assign(deps, { autonomousResponseObservation, autonomousUserTurnProof, prepareSessionInitialization,
    expectedInitializationAck, initializationAcknowledged, responseStructuralCompleteness, providerTransportPending,
    legacyInitializationUpgradeAllowed, DELIVERY_CONTINUATION, FAST_RECHECK_MS: 900,
    advanceResponseCandidate: (c, o) => advanceResponseCandidate(c, o, { now: h.clock }),
    recordResponseObservation: async p => p, maybeEscalateWaitingRefresh: async p => ({ handled: false, process: p }),
    recordUsageOutput: async () => {} });
  deps.recoverInitializationAckWait = background.includes('function recoverInitializationAckWait(')
    ? runtime('recoverInitializationAckWait', deps) : undefined;
  if (background.includes('function guardInitializationAckRepair(')) deps.guardInitializationAckRepair = runtime('guardInitializationAckRepair', deps);
  const tick = runtime('tickSessionInitialization', deps);
  const page = (body = 'Project opened. Status: READY', patch = {}) => ({ url: h.current.lastManagedUrl,
    documentId: 'doc-a', generating: false, assistantCount: 1, assistantHash: digest(body),
    lastUserId: h.current.lastPrompt.dispatchedUserTurnId,
    autonomousTurn: { assistantFound: true, assistantId: `assistant-${h.current.lastPrompt.dispatchedUserTurnId}`,
      assistantOwnerKind: 'SHELL_MESSAGE', assistantOwnerTrusted: true, assistantReplicaCount: 1,
      assistantHash: digest(body), assistantText: body, assistantTextLength: body.length, assistantGenerating: false,
      resolvedUserTurnId: h.current.lastPrompt.dispatchedUserTurnId, resolvedBy: 'USER_TURN_ID' }, ...patch });
  return Object.assign(h, { page,
    sample: async (body, ms = 1600) => { h.advance(ms); return h.current = await tick(h.current, page(body)); },
    stable: async body => { for (const ms of [0, 1600, 1600]) { h.advance(ms); h.current = await tick(h.current, page(body)); } return h.current; },
    dispatch: () => { h.current = { ...h.current, phase: 'WAITING', lastPrompt: { ...h.current.pendingPrompt,
      acknowledged: true, dispatchedUserTurnId: 'repair-user', dispatchId: 'repair-dispatch',
      conversationKey: conversationKey(h.current.lastManagedUrl) }, pendingPrompt: null }; } });
}
test('missing-hash queue wait prepares only one same-conversation receipt clarification after the grace period', async () => {
  const h = await ackHarness(), original = clone(h.current);
  await h.stable(); await h.sample(undefined, 30000); assert.equal(h.current.phase, 'WAITING');
  await h.sample(undefined, 30000); assert.equal(h.current.phase, 'SENDING');
  assert.equal(h.current.sessionInitialization.ackRepair.attempts, 1);
  assert.match(h.current.pendingPrompt.text, /Do not repeat project opening or other tool actions/);
  assert.equal(h.current.pendingPrompt.requiredConversationKey, conversationKey(original.lastManagedUrl));
  assert.equal(h.current.pendingPrompt.sourceUserTurnId, 'init-user');
  assert.deepEqual(h.current.sessionInitialization.workPrompt, original.sessionInitialization.workPrompt);
  assert.deepEqual(h.current.queueContext, original.queueContext); assert.deepEqual(h.current.ownerProgress, original.ownerProgress);
  assert.deepEqual(h.current.sessionBroker, original.sessionBroker); assert.equal(h.current.turn, original.turn);
});
test('correct new hash releases the full original work once and does not consume a quantum interaction', async () => {
  const h = await ackHarness(), work = clone(h.current.sessionInitialization.workPrompt);
  await h.stable(); await h.sample(undefined, 60000); h.dispatch();
  await h.stable(`Kvittens: **${expectedInitializationAck(h.current)}**\nStatus: ready`);
  assert.equal(h.current.phase, 'SENDING'); assert.equal(h.current.pendingPrompt.text, work.text);
  assert.equal(h.current.pendingPrompt.hash, work.hash); assert.equal(h.current.sessionInitialization.status, 'READY');
  assert.equal(h.current.queueContext.interactionCount, 0); assert.equal(h.activations, 0);
});
test('second missing hash parks only its mission and advances another runnable slot, preserving unsent work', async () => {
  const h = await ackHarness(), work = clone(h.current.sessionInitialization.workPrompt), rootProof = clone(h.current.ownerProgress);
  await h.stable(); await h.sample(undefined, 60000); h.dispatch(); await h.stable(); await h.sample(undefined, 60000);
  assert.equal(h.activations, 1); assert.equal(h.current.queueContext.itemId, 'item-b');
  const item = h.queue.items[0]; assert.equal(item.status, 'BLOCKED'); assert.equal(item.blockedRetryAtMs, 0);
  assert.equal(item.lastOutcome, 'SESSION_INITIALIZATION_ACK_EXHAUSTED');
  assert.deepEqual(item.processSnapshot.sessionInitialization.workPrompt, work);
  assert.deepEqual(item.processSnapshot.ownerProgress, rootProof); assert.equal(item.quantumProgress, 0);
  assert.equal(item.processSnapshot.sessionInitialization.ackRepair.attempts, 1);
  assert.equal(item.resume.sourceResponseState, 'INITIALIZATION_UNCONFIRMED_WORK_UNSENT');
  assert.notEqual(uncheckedSelect(h.queue)?.itemId, item.itemId);
});
for (const options of [{ next: false }, { nextPaused: true }]) test(`missing ACK with no runnable sibling enters explicit QUEUE_WAIT ${JSON.stringify(options)}`, async () => {
  const h = await ackHarness(options); await h.stable(); await h.sample(undefined, 60000); h.dispatch();
  await h.stable(); await h.sample(undefined, 60000);
  assert.equal(h.current.phase, 'QUEUE_WAIT'); assert.equal(h.current.queueWait.reason, 'SESSION_INITIALIZATION_ACK_EXHAUSTED');
  assert.equal(h.queue.activeItemId, ''); assert.equal(h.activations, 0);
  if (options.nextPaused) assert.ok(h.current.queueWait.nextWakeAtMs > h.clock);
});
for (const kind of ['pause', 'quota', 'stop', 'foreign-user', 'unknown-work']) test(`ACK clarification respects ${kind}`, async () => {
  const h = await ackHarness({ paused: kind === 'pause', quota: kind === 'quota' }); await h.stable();
  const before = clone(h.current); h.advance(60000);
  if (kind === 'stop') h.current.phase = 'STOPPED';
  if (kind === 'unknown-work') { h.current.sessionInitialization.workPrompt.dispatch = { effectPossible: null }; before.sessionInitialization.workPrompt.dispatch = { effectPossible: null }; }
  const page = h.page(); if (kind === 'foreign-user') page.lastUserId = 'human';
  await h.deps.recoverInitializationAckWait(before, page);
  assert.equal(h.writes, 0); assert.equal(h.activations, 0); assert.equal(h.current.pendingPrompt, null);
});
test('queue publication crash resumes the same ACK handoff without a second clarification or duplicate activation', async () => {
  const h = await ackHarness({ crash: true }); await h.stable(); await h.sample(undefined, 60000); h.dispatch(); await h.stable();
  await assert.rejects(h.sample(undefined, 60000), /CRASH_AFTER_QUEUE_WRITE/);
  assert.equal(h.queue.activeItemId, ''); assert.equal(h.activations, 0);
  await h.sample(undefined, 1000); assert.equal(h.activations, 1);
  assert.equal(h.queue.items[0].processSnapshot.sessionInitialization.ackRepair.attempts, 1);
});
test('late original ACK cancels an unsent clarification and returns to original turn observation', async () => {
  const h = await ackHarness(); await h.stable(); const oldHash = expectedInitializationAck(h.current);
  await h.sample(undefined, 60000);
  const r = await h.deps.guardInitializationAckRepair(h.current, h.page(oldHash));
  assert.equal(r.handled, true); h.current = r.process; assert.equal(h.current.phase, 'WAITING');
  assert.equal(h.current.pendingPrompt, null); assert.equal(h.current.lastPrompt.dispatchedUserTurnId, 'init-user');
  await h.stable(oldHash); assert.equal(h.current.sessionInitialization.status, 'READY');
});
test('an uncertain clarification dispatch stays owned by exact-once reconciliation', async () => {
  const h = await ackHarness(); await h.stable(); await h.sample(undefined, 60000);
  h.current.pendingPrompt.dispatch = { operationId: 'sent-once', effectPossible: null };
  const r = await h.deps.guardInitializationAckRepair(h.current, h.page('changed'));
  assert.equal(r.handled, false); assert.equal(r.process.pendingPrompt.dispatch.operationId, 'sent-once');
});
test('operator retry preserves the saved mission, full checkpoint and configured schedule', async () => {
  const h = await ackHarness({ next: false }); await h.stable(); await h.sample(undefined, 60000); h.dispatch();
  await h.stable(); await h.sample(undefined, 60000); const before = clone(h.queue.items[0]);
  h.deps.publicMissionWorkQueue = q => q; h.deps.BACKGROUND_AUDIT_SESSION_ID = 'test';
  h.deps.enqueueMissionQueueWake = async () => h.current;
  const update = runtime('updateQueueFromUi', h.deps);
  await update({ windowId: 1, operation: 'RETRY_INITIALIZATION', itemId: before.itemId });
  assert.equal(h.queue.items[0].status, 'READY'); assert.equal(h.queue.items[0].savedMissionId, before.savedMissionId);
  assert.deepEqual(h.queue.items[0].processSnapshot, before.processSnapshot);
  assert.deepEqual(h.queue.items[0].schedule, before.schedule); assert.equal(h.activations, 0);
});
test('operator retry cannot bypass unresolved work effects', async () => {
  const h = await ackHarness({ next: false }); await h.stable(); await h.sample(undefined, 60000); h.dispatch();
  await h.stable(); await h.sample(undefined, 60000);
  h.queue.items[0].processSnapshot.sessionInitialization.workPrompt.dispatch = { effectPossible: null };
  const update = runtime('updateQueueFromUi', h.deps), before = h.writes;
  await assert.rejects(update({ windowId: 1, operation: 'RETRY_INITIALIZATION', itemId: 'item-a' }), /INITIALIZATION_RETRY_SOURCE_UNPROVEN/);
  assert.equal(h.writes, before);
});
test('UI describes a parked ACK as blocked and exposes a scoped retry, not a false ready claim', async () => {
  const panel = await readFile(new URL('sidepanel.js', root), 'utf8');
  assert.match(reasonLabel('SESSION_INITIALIZATION_ACK_EXHAUSTED'), /andra körbara uppdrag/);
  assert.match(workerReason({ phase: 'WAITING', sessionInitialization: { status: 'AWAITING_ACK' } }), /högst en gång/);
  assert.match(panel, /data-queue-action="retry-initialization"/);
  assert.match(panel, /const processCtx = active && state\.process/);
  assert.match(background, /RETRY_INITIALIZATION"\) requireRecoveryPanel\(sender\)/);
});

test('rotation timeout records the failed readiness predicate without capturing private UI text', async () => {
  const p = { ...worker(), phase: PHASES.ROTATING, pendingPrompt: workFor(worker()),
    sessionRotation: { rotationId: 'rotation-a', state: 'NAVIGATING',
      navigationStartedAt: new Date(Date.now() - 600000).toISOString() } };
  const gptRoot = 'https://chatgpt.com/g/g-test';
  const page = { url: gptRoot, userCount: 0, composerReady: false, composerEmpty: true,
    generating: true, composerText: 'PRIVATE_DRAFT_NOT_FOR_DIAGNOSTICS' };
  const deps = { ...common, EIC_LANDING_TIMEOUT_MS: 120000, nowIso: () => new Date().toISOString(),
    invalidCapturedResponse: () => false, readEicSurfaceState: async () => ({ entryUrl: gptRoot }),
    resolveManagedGptRoot: () => gptRoot, supportedUrl: () => true,
    chrome: { storage: { local: {} }, tabs: { get: async () => ({ id: 2, windowId: 1, url: gptRoot, status: 'complete' }) } },
    recheckExpiredRotationReady: async () => ({ handled: false }), ensureContentBridgeVersion: async () => {},
    bridgeMessage: async () => ({ ok: true, state: page }), providerTransportPending,
    observeRotationComposerWait: async p => ({ handled: false, process: p }),
    transportTransitionBoundary: async p => ({ blocked: false, process: p }),
    commitTransition: async (p, phase, patch) => ({ ...p, phase, ...patch }), errorRecord: e => ({ code: e.code }) };
  const next = await runtime('tickRotating', deps)(p);
  assert.equal(next.phase, PHASES.BLOCKED);
  assert.equal(next.sessionRotation.readinessTimeout.cause, 'COMPOSER_OR_PROVIDER_BUSY');
  assert.equal(next.sessionRotation.readinessTimeout.composerReady, false);
  assert.equal(next.sessionRotation.readinessTimeout.generating, true);
  assert.equal(JSON.stringify(next.sessionRotation).includes('PRIVATE_DRAFT'), false);
});

for (const change of ['none', 'user', 'response', 'owner', 'conversation']) test(`final content click fence for ACK clarification: ${change}`, async () => {
  const dom = new JSDOM('<form><textarea></textarea><button type="button">Send</button></form>',
    { url: 'https://chatgpt.com/c/original', runScripts: 'outside-only' });
  const w = dom.window, composer = w.document.querySelector('textarea'), button = w.document.querySelector('button');
  let clicks = 0, reads = 0; button.click = () => clicks++;
  const transportContext = { kind: 'SESSION_INITIALIZATION', sourceUserTurnId: 'init-user',
    requiredConversationKey: 'https://chatgpt.com/c/original', sourceResponseHash: 'completed-answer' };
  Object.assign(w, { DOCUMENT_ID: 'document', dispatchRecords: new Map(), assertContentActive: () => {},
    forensic: () => {}, serializeError: e => ({ code: e.code }),
    GreenfieldSafetyPolicy: { evaluateModel: () => ({ allowed: true }) }, GreenfieldModelObservation: { observe: () => ({}) },
    getComposer: () => composer, getSendButton: () => button, normalizeText: s => String(s).trim(), sha256Hex: async s => digest(s),
    setNativeValue: (el, value) => el.value = value, promptMarkerValue: s => s,
    sendRuntimeMessage: async () => ({ ok: true, transportContext, policy: {}, gptRoot: 'https://chatgpt.com/g/g-test' }),
    waitForMaterialization: async () => ({ acknowledged: true, state: {} }), materializedUserTurnReceipt:()=>({userTurnId:"fixture-user",userTurnIndex:0}),publishDispatchMaterialization: async () => ({}),
    pageState: async () => {
      if (++reads > 1 && change === 'conversation') w.history.pushState({}, '', '/c/foreign');
      return { composerEmpty: !composer.value, composerTextHash: digest(composer.value.trim()), modelEvidence: {},
        lastUserId: change === 'user' ? 'human' : 'init-user', autonomousTurn: { resolvedUserTurnId: 'init-user',
          assistantHash: change === 'response' ? 'changed' : 'completed-answer', assistantOwnerTrusted: change !== 'owner' } };
    } });
  try {
    w.eval(['normalizeComposerText','readComposerValue','submitPrompt'].map(name=>source(name,content,'  ')).join('\n') + '\nwindow.submit=submitPrompt;');
    const result = await w.submit('receipt only', digest('receipt only'), 'ack-dispatch', { policy: {}, gptRoot: 'https://chatgpt.com/g/g-test' });
    assert.equal(clicks, change === 'none' ? 1 : 0);
    assert.equal(result.effectPossible, change === 'none');
    if (change === 'none') { await w.submit('receipt only', digest('receipt only'), 'ack-dispatch'); assert.equal(clicks, 1); }
  } finally { w.close(); }
});
