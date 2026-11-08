import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.GF_BOOTSTRAP_BASELINE ? pathToFileURL(resolve(process.env.GF_BOOTSTRAP_BASELINE) + '/') : new URL('../', import.meta.url);
const load = n => import(new URL('lib/' + n + '.mjs', root));
const transport = await load('session-transport');
const { savedMissionProject } = await load('saved-mission-catalog');
const { buildA2AEnvelope, validateA2AEnvelope } = await load('a2a');
const { focusRotationObjective } = await load('focus-cycle');
const { PHASES, TERMINAL_PHASES } = await load('contracts');
const { createProcess, ownerToken, isCurrentToken } = await load('state');
const { jsonEqual } = await load('canonical-json');
const { createKeyedQueue } = await load('keyed-queue');
const { normalizeMissionWorkQueue, QUEUE_STATUS, requeueBlockedMissionWorkItem, deferMissionOwnershipWorkItem, reviveOwnershipContentionBlocks, selectNextMissionItem: uncheckedSelect } = await load('mission-work-queue');
const { conversationKey } = await load('restart-recovery');
const { queueItemNextRunnableAtMs } = await load('queue-schedule');
const background = await readFile(new URL('background.js', root), 'utf8');
const digest = s => createHash('sha256').update(s).digest('hex');
const clone = structuredClone;
const at = Date.parse('2026-10-20T16:46:51.208Z');
function runtime(name, deps) {
  const hit = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(background); assert.ok(hit, name);
  const tail = background.slice(hit.index), end = /^}\s*$/m.exec(tail);
  return Function(...Object.keys(deps), tail.slice(0, end.index + end[0].length) + `;return ${name};`)(...Object.values(deps));
}
function worker() {
  return { ...createProcess({ workerId: 'w', windowId: 1, tabId: 2,
    goal: '102 Research fixture - GFW: GF-2.102.1026\nRead current owner state; do not repeat accepted effects.',
    initialPrompt: 'Preserve full objective. ' + 'Bounded obligation and owner guard. '.repeat(60) }),
    phase: PHASES.WAITING, turn: 11, sessionSeq: 2, pendingPrompt: null,
    lastManagedUrl: 'https://chatgpt.com/c/original',
    queueContext: { workerId: 'w', queueId: 'q', itemId: 'i', savedMissionId: 'm', activationCount: 3,
      interactionCount: 0, maxInteractions: 5 } };
}
function workFor(p) {
  const a2a = buildA2AEnvelope({ process: p, objective: p.objectiveState.objective, messageType: 'SESSION_ROTATION' });
  const text = JSON.stringify(a2a);
  return { text, a2a, hash: digest(text), sendAttempts: 0, dispatch: null,
    promptProfile: { profile: 'FULL' }, oneShotInstruction: { instructionId: 'operator-one', text: 'Preserve operator scope' } };
}
// Sanitized structural reproduction of the supplied v1.9.27 incident. No private
// project body or transcript is shipped. Real input digest is in the report.
async function legacy() {
  const p = worker(), work = workFor(p);
  const packet = await transport.prepareSessionInitialization(p, work, { url: p.lastManagedUrl });
  const initial = packet.pendingPrompt;
  initial.a2a = { messageId: initial.a2a.messageId, messageType: 'SESSION_INITIALIZATION',
    instruction: `Session initialization only. Do not call tools or change any state. When initialization has succeeded, include this exact acknowledgement hash as a separate token in your final response: ${packet.sessionInitialization.acknowledgement.hash}.` };
  initial.text = JSON.stringify(initial.a2a); initial.hash = digest(initial.text);
  p.sessionInitialization = packet.sessionInitialization;
  delete p.sessionInitialization.bootstrapContract;
  delete p.sessionInitialization.bootstrapRepair;
  p.lastPrompt = { ...initial, acknowledged: true, dispatchedUserTurnId: 'init-user', dispatchId: 'dispatch', conversationKey: p.lastManagedUrl };
  p.sessionInitialization.status = 'AWAITING_ACK';
  p.sessionInitialization.ackWait = { responseHash: 'blocked-response', messageId: 'assistant', documentId: 'doc', observedAt: new Date(at - 120000).toISOString() };
  p.responseObservationTrace = [{ reason: 'SESSION_INITIALIZATION_ACK_HASH_MISSING', promptHash: initial.hash.slice(0, 16), turn: p.turn,
    detail: { expectedUserTurnId: 'init-user', resolvedUserTurnId: 'init-user', resolvedBy: 'USER_TURN_ID', ownerTrusted: true,
      assistantId: 'assistant', assistantHash: 'blocked-response'.slice(0, 12), documentId: 'doc' } }];
  p.phase = PHASES.BLOCKED;
  p.lastError = { code: 'SESSION_INITIALIZATION_ACK_EXHAUSTED' };
  return p;
}

test('numeric launcher header identifies its explicit project without using body references', () => {
  assert.deepEqual(savedMissionProject('102 Research fixture - GFW: GF-2.102.1026\nProjekt: 71 - registry'), { projectId: 102, projectName: 'Research fixture' });
  assert.deepEqual(savedMissionProject('Projekt: 71 - Greenfield Works - GFW: GF-0.71.1008.'), { projectId: 71, projectName: 'Greenfield Works' });
  assert.equal(savedMissionProject('Independent mission\nProjekt: 71 - registry'), null);
});
test('project resolution preserves old headers and rejects contradictory, zero and body-only identities', () => {
  assert.deepEqual(savedMissionProject('Project: 63 - Name - Gf: GF-001.'), { projectId: 63, projectName: 'Name' });
  assert.deepEqual(savedMissionProject('102 Research fixture — GFW: GF-2.102.1026.'), { projectId: 102, projectName: 'Research fixture' });
  for (const header of ['102 Unbound numeric phrase', 'GF-2.102.1026', 'Projekt: 0 - Zero',
    '102 Name - GFW: GF-2.71.1026', 'Projekt: 102 - Name - GFW: GF-2.71.1026']) assert.equal(savedMissionProject(header), null, header);
});
for (const goal of ['102 Research fixture - GFW: GF-2.102.1026', 'Projekt: 71 - Fixture - GFW: GF-0.71.1008.', 'Unbound mission']) {
  test(`fresh initialization contains complete session context and permits required bootstrap: ${goal}`, async () => {
    const p = worker(); p.goal = goal; const work = workFor(p), before = clone(work);
    const packet = await transport.prepareSessionInitialization(p, work, { url: p.lastManagedUrl });
    const instruction = packet.pendingPrompt.a2a.instruction;
    assert.doesNotMatch(instruction, /Do not call tools/);
    assert.match(instruction, /getMe/); assert.match(instruction, /global\.get/);
    assert.ok(instruction.includes(p.goal));
    assert.ok(instruction.includes('FRESH_READ_BEFORE_FIRST_BOUNDED_WORK_PACKAGE'), 'full owner-state contract reaches the first session turn');
    assert.ok(instruction.includes('eic.a2a.response.v1'), 'operative response schema is available as context');
    assert.ok(instruction.includes('selfContinuationAuthority'), 'full controller boundary is present');
    assert.doesNotMatch(instruction, /Preserve full objective/, 'operative objective is still held for the next work prompt');
    assert.deepEqual(packet.sessionInitialization.workPrompt, before); assert.deepEqual(work, before);
    assert.deepEqual(Object.keys(packet.pendingPrompt.a2a).sort(), ['instruction', 'messageId', 'messageType']);
    assert.equal(transport.expectedInitializationAck({ ...p, phase: 'SENDING', ...packet }), packet.sessionInitialization.acknowledgement.hash);
  });
}
test('legacy no-tool bootstrap is repaired with full bootstrap, not confirmation of an incomplete initialization', async () => {
  const p = await legacy(), work = clone(p.sessionInitialization.workPrompt);
  const packet = await transport.prepareSessionInitialization(p, work, { url: p.lastManagedUrl }, { acknowledgementOnly: true });
  assert.match(packet.pendingPrompt.a2a.instruction, /getMe/);
  assert.doesNotMatch(packet.pendingPrompt.a2a.instruction, /Confirm only if that initialization succeeded/);
  assert.deepEqual(packet.sessionInitialization.workPrompt, work);
});

async function harness() {
  const parked = await legacy();
  let queue = normalizeMissionWorkQueue({ queueId: 'q', workerId: 'w', windowId: 1, enabled: true, activeItemId: '', revision: 10, cursorOrder: 0,
    items: [{ itemId: 'i', savedMissionId: 'm', goal: parked.goal, status: 'BLOCKED', order: 0,
      maxInteractions: 5, quantumProgress: 0, activationCount: 3, processSnapshot: parked,
      lastOutcome: 'SESSION_INITIALIZATION_ACK_EXHAUSTED', schedule: { minIntervalMinutes: 5 },
      lastQuantumCompletedAtMs: Date.parse('2026-10-20T16:28:18.489Z'),
      resume: { objective: parked.objectiveState.objective, sourceResponseState: 'INITIALIZATION_UNCONFIRMED_WORK_UNSENT' } },
      { itemId: 'other', savedMissionId: 'other-m', goal: 'Projekt: 71 - Fixture - GFW: GF-0.71.1008.', status: 'READY', order: 1,
        schedule: { minIntervalMinutes: 180 }, lastQuantumCompletedAtMs: Date.parse('2026-10-20T15:00:18.546Z') }] }, { now: at });
  let current = { ...clone(parked), phase: 'QUEUE_WAIT', queueContext: null, lastError: null,
    queueWait: { queueId: 'q', parkedItemId: 'i', reason: 'SESSION_INITIALIZATION_ACK_EXHAUSTED' } };
  let writes = 0, activations = 0, paused = false, crash = false, mutateAtFence = null;
  const events = [];
  const deps = { ...transport, APP_VERSION: '1.9.28', PHASES, TERMINAL_PHASES, QUEUE_STATUS, jsonEqual, ownerToken, isCurrentToken,
    Date: class extends Date { static now() { return at; } }, deepClone: clone,
    nowIso: () => new Date(at).toISOString(), sha256Hex: async s => digest(s),
    chrome: { storage: { local: {}, session: {} } }, BACKGROUND_AUDIT_SESSION_ID: 'test',
    queues: createKeyedQueue(), queueItemNextRunnableAtMs,
    loadProcessForWindow: async () => clone(current), loadMissionWorkQueue: async () => clone(queue),
    getWorkerBinding: async () => ({ workerId: current.workerId }),
    missionQueueForWindow: async () => ({ queue: clone(queue), settings: {} }),
    readSafety: async () => ({ admissionPaused: paused, providerHold: null }),
    acceptPendingMissionDelegationsForQueue: async () => {}, refreshOwnerWaitingSlots: async q => q,
    terminalQueueDispatchCandidate: () => false, reconcileRetryableTerminalQueueSlot: async () => null,
    reconcileTerminalQueueSlot: async () => {}, syncMissionQueueWakeAlarm: async () => {},
    audit: async () => {}, syncOverlay: async () => {}, broadcast: async () => {},
    saveProcess: async (next, _local, _session, { expectedProcess } = {}) => {
      if (!jsonEqual(current, expectedProcess)) throw Error('PROCESS_CHECKPOINT_CHANGED');
      current = clone(next);
    },
    persistMissionQueue: async q => { assert.equal(q.revision, queue.revision, 'revision fence'); writes++; queue = clone({ ...q, revision: q.revision + 1 });
      if (crash) { crash = false; throw Error('CRASH_AFTER_QUEUE_WRITE'); } return clone(queue); },
    activateQueueItem: async ({ item, queue: q, priorProcess }) => { const boundary = await deps.queueActivationEffectBoundary({ queue: q, item, windowId: 1, priorProcess });
      if (boundary.blocked) return boundary;
      activations++; events.push(item.itemId); queue.activeItemId = item.itemId;
      queue.items.find(i => i.itemId === item.itemId).status = 'ACTIVE';
      return { process: current = await activation(parked, item) }; }
  };
  for (const name of ['queuePendingEffectNeedsReconciliation', 'queueItemNeedsEffectReconciliation', 'selectNextMissionItem', 'queueActivationSourceMatches', 'queueActivationEffectBoundary']) {
    deps.selectNextMissionItemUnchecked = (q, o) => uncheckedSelect(q, { ...o, now: at });
    deps[name] = runtime(name, deps);
  }
  const originalBoundary = deps.queueActivationEffectBoundary;
  deps.queueActivationEffectBoundary = async args => { if (mutateAtFence) { const mutate = mutateAtFence; mutateAtFence = null; mutate(); } return originalBoundary(args); };
  if (background.includes('async function reconcileLegacyInitializationSlots(')) {
    Object.assign(deps, await load('initialization-recovery'));
    deps.reconcileLegacyInitializationSlots = runtime('reconcileLegacyInitializationSlots', deps);
  }
  Object.assign(deps, { QUEUE_OWNERSHIP_DEFER_CODES: new Set(['MISSION_PRIOR_EFFECT_UNRESOLVED']),
    ROTATION_TIMEOUT_COOLDOWN_MS: 300000, requeueBlockedMissionWorkItem, deferMissionOwnershipWorkItem, reviveOwnershipContentionBlocks,
    recordIncident: async () => {} });
  deps.activateRunnableQueueSuccessor = runtime('activateRunnableQueueSuccessor', deps);
  if (background.includes('async function refreshQueueWaitStatus(')) {
    deps.earliestQueueWakeAtMs = runtime('earliestQueueWakeAtMs', deps);
    deps.refreshQueueWaitStatus = runtime('refreshQueueWaitStatus', deps);
  }
  const wake = runtime('wakeMissionQueue', deps);
  return { wake, deps, events, get queue() { return queue; }, get current() { return current; },
    get writes() { return writes; }, get activations() { return activations; },
    pause() { paused = true; }, crash() { crash = true; }, fence(fn) { mutateAtFence = fn; } };
}
test('recorded queue state automatically resumes GF-2.102.1026 while GF-0.71.1008 remains interval-blocked', async () => {
  const h = await harness(), original = clone(h.queue), other = clone(h.queue.items[1]);
  assert.equal(queueItemNextRunnableAtMs(h.queue.items[1], at, h.queue), Date.parse('2026-10-20T18:00:18.546Z'));
  await h.wake(1, 'RESTART_QUEUE_RECONCILE');
  assert.deepEqual(h.events, ['i'], 'the eligible exact slot must start without a manual retry');
  assert.deepEqual(h.queue.items[1], other);
  assert.equal(h.current.queueContext.savedMissionId, 'm');
  assert.deepEqual(h.queue.items[0].processSnapshot.sessionInitialization.workPrompt, original.items[0].processSnapshot.sessionInitialization.workPrompt);
  await h.wake(1, 'QUEUE_WAKE_ALARM'); assert.equal(h.activations, 1);
});

for (const mode of ['disabled', 'operator-stop', 'operator-pause', 'worker', 'queue', 'slot', 'mission', 'run', 'work-hash',
  'unknown-effect', 'duplicate-unknown-effect', 'quality', 'owner-wait', 'untrusted-response', 'stale-response', 'wrong-ack', 'already-repaired', 'already-bootstrapped', 'source-error']) {
  test(`automatic legacy recovery rejects ${mode}`, async () => {
    const h = await harness(), i = h.queue.items[0], p = i.processSnapshot;
    if (mode === 'disabled') h.queue.enabled = false;
    if (mode === 'operator-stop') h.current.phase = 'STOPPED';
    if (mode === 'operator-pause') h.pause();
    if (mode === 'worker') p.workerId = 'other-worker';
    if (mode === 'queue') p.queueContext.queueId = 'other-queue';
    if (mode === 'slot') p.queueContext.itemId = 'other-slot';
    if (mode === 'mission') p.queueContext.savedMissionId = 'other-mission';
    if (mode === 'run') p.runId = 'other-run';
    if (mode === 'work-hash') p.sessionInitialization.workPrompt.hash = digest('different');
    if (mode === 'unknown-effect') p.sessionInitialization.workPrompt.dispatch = { effectPossible: null };
    if (mode === 'duplicate-unknown-effect') h.queue.items.push({ ...clone(i), itemId: 'duplicate', processSnapshot: { pendingPrompt: { dispatch: { effectPossible: null }, sendAttempts: 1 } } });
    if (mode === 'quality') p.safety = { ...p.safety, qualityIncident: { code: 'UNVERIFIED_ORIGINAL_TURN' } };
    if (mode === 'owner-wait') p.ownerWait = { state: 'WAIT' };
    if (mode === 'untrusted-response') p.responseObservationTrace[0].detail.ownerTrusted = false;
    if (mode === 'stale-response') p.responseObservationTrace[0].detail.resolvedUserTurnId = 'old-user';
    if (mode === 'wrong-ack') p.sessionInitialization.acknowledgement.binding.itemId = 'other';
    if (mode === 'already-repaired') i.resume.initializationRepair = { version: '1.9.28' };
    if (mode === 'already-bootstrapped') { p.sessionInitialization.bootstrapContract = 'FULL_READ_ONLY_V1'; p.sessionInitialization.bootstrapRepair = true; }
    if (mode === 'source-error') p.lastError.code = 'EXTERNAL_EFFECT_UNRESOLVED';
    await h.wake(1, 'RESTART');
    assert.equal(h.writes, 0); assert.equal(h.activations, 0); assert.equal(i.status, 'BLOCKED');
  });
}
for (const offset of [-1, 0, 1]) test(`recovered slot honors the five-minute interval at boundary ${offset} ms`, async () => {
  const h = await harness(), i = h.queue.items[0];
  i.lastQuantumCompletedAtMs = at - 300000 - offset;
  await h.wake(1, 'RESTART');
  assert.equal(h.writes, 1); assert.equal(h.activations, offset < 0 ? 0 : 1);
  assert.equal(h.queue.items[0].lastQuantumCompletedAtMs, i.lastQuantumCompletedAtMs);
});
test('crash after the recovery checkpoint restarts without another recovery write or duplicate activation', async () => {
  const h = await harness(); h.crash();
  await assert.rejects(h.wake(1, 'RESTART'), /CRASH_AFTER_QUEUE_WRITE/);
  assert.equal(h.writes, 1); assert.equal(h.activations, 0);
  await h.wake(1, 'RESTART'); assert.equal(h.writes, 1); assert.equal(h.activations, 1);
});
for (const mode of ['stop', 'queue-edit']) test(`mutation at recovery fence rejects stale ${mode}`, async () => {
  const h = await harness(); h.fence(() => { if (mode === 'stop') h.current.phase = 'STOPPED'; else h.queue.revision++; });
  await h.wake(1, 'RESTART'); assert.equal(h.writes, 0); assert.equal(h.activations, 0);
});

async function activation(p, item) {
  const deps = { ...transport, PHASES, APP_VERSION: '1.9.28', deepClone: clone, sha256Hex: async s => digest(s), Date: class extends Date { static now() { return at; } },
    nowIso: () => new Date(at).toISOString(), randomId: prefix => prefix + '-test', readNextInstruction: async () => null,
    conversationsOfOtherGfws: () => [], capturedTargetResponse: () => ({ targetResponse: null }), focusRotationObjective };
  for (const name of ['state', 'mission-work-queue', 'queue-planning', 'warm-resume', 'session-rotation', 'session-health',
    'response-repair', 'continuation-integrity', 'global-capacity-scheduler']) Object.assign(deps, await load(name));
  deps.buildPendingA2A = async (process, args) => {
    const a2a = buildA2AEnvelope({ ...args, process });
    const text = JSON.stringify(a2a);
    return { text, hash: digest(text), a2a, sendAttempts: 0, dispatch: null, oneShotInstruction: args.operatorInstruction };
  };
  const build = runtime('buildQueueActivationProcess', deps);
  return build({ queue: { queueId: 'q', workerId: 'w', windowId: 1, items: [item] }, item, settings: {},
    windowId: 1, tab: { id: 2, url: 'https://chatgpt.com/c/original' }, gptRoot: 'https://chatgpt.com/g/g-test',
    priorProcess: { ...p, phase: 'QUEUE_WAIT', queueContext: null } });
}
test('cold recovery does not consume an unsent operative turn and retains objective, operator instruction and mission identity', async () => {
  const h = await harness(), i = clone(h.queue.items[0]), p = i.processSnapshot, work = clone(p.sessionInitialization.workPrompt);
  i.resume.initializationRepair = { sourceWorkPromptHash: work.hash, version: '1.9.28' };
  i.lastOutcome = 'LEGACY_INITIALIZATION_BOOTSTRAP_RETRY';
  const next = await activation(p, i);
  assert.equal(next.turn, p.turn, 'initialization never consumed operative turn 11');
  assert.equal(next.sessionSeq, p.sessionSeq + 1); assert.equal(next.runId, p.runId); assert.equal(next.processId, p.processId);
  assert.equal(next.queueContext.itemId, i.itemId); assert.equal(next.queueContext.savedMissionId, i.savedMissionId);
  assert.equal(next.queueContext.interactionCount, 0); assert.equal(next.pendingPrompt.a2a.promptProfile.profile, 'FULL');
  assert.equal(next.pendingPrompt.a2a.objective, work.a2a.objective);
  assert.deepEqual(next.pendingPrompt.oneShotInstruction, work.oneShotInstruction);
  assert.equal(validateA2AEnvelope(next.pendingPrompt.a2a).ok, true);
});

for (const response of ['matching-hash', 'bare-READY', 'previous-session-hash', 'other-user-turn']) {
  test(`wake -> cold activation -> full bootstrap -> response admission: ${response}`, async () => {
    const h = await harness(); await h.wake(1, 'RESTART');
    let current = clone(h.current), clock = at;
    const originalWork = clone(current.pendingPrompt), transitions = [];
    const deps = { ...transport, PHASES, FAST_RECHECK_MS: 900, conversationKey, nowIso: () => new Date(clock).toISOString(),
      commitTransition: async (p, phase, patch, options) => { const b = await options.beforeSave(); if (b.blocked) return b.process;
        transitions.push(options.kind); return current = { ...p, phase, ...patch }; },
      transportTransitionBoundary: async () => ({ blocked: false, process: current }),
      saveObserved: async (p, patch) => current = { ...p, ...patch },
      scheduleFast: () => {}, recordUsageOutput: async () => {}, releaseSchedulerTurn: async () => {},
      holdForSafety: async (_, why) => { throw Error(why.code); }, recordResponseObservation: async p => p,
      maybeEscalateWaitingRefresh: async p => ({ handled: false, process: p }) };
    for (const name of ['session-rotation', 'response-stability', 'response-observation', 'turn-causality', 'waiting-refresh']) Object.assign(deps, await load(name));
    const advance = deps.advanceResponseCandidate;
    deps.advanceResponseCandidate = (c, o) => advance(c, o, { now: clock });
    const ready = runtime('commitFreshRotationReady', deps);
    await ready(current, current.sessionRotation, { id: 2 }, { url: 'https://chatgpt.com/g/g-test', userCount: 0, composerReady: true },
      'https://chatgpt.com/g/g-test', { kind: 'URL_GPT_ID' });
    assert.equal(current.pendingPrompt.transportKind, 'SESSION_INITIALIZATION');
    assert.match(current.pendingPrompt.a2a.instruction, /FULL SESSION PRE-PROMPT/);
    assert.match(current.pendingPrompt.a2a.instruction, /Open project 102/);
    assert.equal(current.sessionInitialization.workPrompt.hash, originalWork.hash);
    assert.equal(current.turn, 11);
    const ack = transport.expectedInitializationAck(current);
    current = { ...current, phase: 'WAITING', pendingPrompt: null, lastManagedUrl: 'https://chatgpt.com/c/recovered',
      lastPrompt: { ...current.pendingPrompt, acknowledged: true, dispatchedUserTurnId: 'new-init-user', dispatchedUserTurnIndex: 0,
        conversationKey: 'https://chatgpt.com/c/recovered' } };
    // Persisted round-trip represents service-worker suspension between send
    // and observation; Chrome I/O and the EIC responder are simulated.
    current = JSON.parse(JSON.stringify(current));
    const body = response === 'bare-READY' ? 'Session initialized. READY.'
      : `Session initialized. **${response === 'previous-session-hash' ? '0'.repeat(64) : ack}**`;
    const page = { url: current.lastManagedUrl, documentId: 'new-doc', generating: false, assistantCount: 1,
      assistantHash: digest(body), lastUserId: 'new-init-user',
      autonomousTurn: { assistantFound: true, assistantId: 'new-assistant', assistantOwnerKind: 'SHELL_MESSAGE',
        assistantOwnerTrusted: true, assistantReplicaCount: 1, assistantHash: digest(body), assistantText: body,
        assistantTextLength: body.length, assistantGenerating: false, resolvedBy: 'USER_TURN_ID',
        resolvedUserTurnId: response === 'other-user-turn' ? 'foreign' : 'new-init-user' } };
    const tick = runtime('tickSessionInitialization', deps);
    for (const elapsed of [0, 1600, 3200]) { clock = at + elapsed; await tick(current, page); }
    if (response === 'matching-hash') {
      assert.equal(current.phase, 'SENDING'); assert.equal(current.pendingPrompt.transportKind, undefined);
      assert.equal(current.pendingPrompt.text, originalWork.text); assert.equal(current.pendingPrompt.hash, originalWork.hash);
      assert.equal(current.queueContext.savedMissionId, 'm'); assert.equal(current.queueContext.interactionCount, 0);
      assert.equal(current.sessionInitialization.status, 'READY');
      assert.equal(transitions.filter(k => k === 'SESSION_INITIALIZED_WORK_PROMPT_RELEASED').length, 1);
    } else { assert.equal(current.pendingPrompt, null); assert.equal(current.phase, 'WAITING'); }
  });
}
