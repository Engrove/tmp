import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run the same field regression against the untouched previous release.
const root = process.env.GREENFIELD_OWNERSHIP_BASELINE
  ? pathToFileURL(resolve(process.env.GREENFIELD_OWNERSHIP_BASELINE) + '/') : new URL('../', import.meta.url);
const load = name => import(new URL(`lib/${name}.mjs`, root));
const { missionEffectsSettled, inspectMissionOwnership, claimMissionOwnership,
  readMissionOwnership, withMissionOwner, MISSION_OWNERSHIP_KEY } = await load('mission-ownership');
const { writeCheckpoint } = await load('durable-checkpoint');
const { DELIVERY_CONTINUATION } = await load('session-transport');
const { promptCausalMarker } = await load('turn-causality');
const { normalizeMissionQuantumInteractions } = await load('mission-work-queue');
const { SCHEDULE_BLOCK } = await load('queue-schedule');
const { sessionRotationObjective } = await load('session-rotation');
const { retainedObjectiveContext } = await load('continuation-integrity');
const { PHASES } = await load('contracts');
const background = await readFile(new URL('background.js', root), 'utf8');
const fixture = JSON.parse(await readFile(new URL('./fixtures/ownership-handoff-1030.json', import.meta.url), 'utf8'));
const digest = text => createHash('sha256').update(text).digest('hex');
const source = () => structuredClone(fixture.priorProcess);
const missionKey = fixture.expected.targetMissionKey;

function storage(seed = {}) {
  const data = structuredClone(seed);
  return { data,
    async get(keys) { return keys == null ? structuredClone(data) : Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])])); },
    async set(rows) { Object.assign(data, structuredClone(rows)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  };
}
function target(id = 'new-1030') {
  const item = fixture.queue.items.find(row => row.itemId === fixture.expected.targetItemId);
  const text = 'Read current owner state for this GFW before continuing its outstanding work.';
  return { workerId: id, processId: `process-${id}`, runId: `run-${id}`, goal: item.goal,
    phase: 'ROTATING', sessionSeq: 1,
    queueContext: { workerId: id, queueId: 'queue-new', itemId: item.itemId, savedMissionId: item.savedMissionId },
    pendingPrompt: { text, hash: digest(text), sendAttempts: 0, dispatch: null }, lastPrompt: null, lastResponse: null };
}
async function seeded(old = source()) {
  const local = storage();
  await writeCheckpoint(MISSION_OWNERSHIP_KEY, fixture.ownership, local);
  await writeCheckpoint(`eic.gf.process.worker.${old.workerId}`, old, local);
  await writeCheckpoint(`eic.gf.mission-work-queue.worker.${fixture.priorQueue.workerId}`, fixture.priorQueue, local);
  return local;
}
function production(name, deps) {
  const start = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(background)?.index;
  assert.notEqual(start, undefined, name);
  const tail = background.slice(start), end = /^}[ \t]*$/m.exec(tail);
  return Function(...Object.keys(deps), tail.slice(0, end.index + end[0].length) + ';return ' + name)(...Object.values(deps));
}
function withConfirmedNoEffect(status, viaError = false) {
  const old = source(), work = old.pendingPrompt;
  work.sendAttempts = 1;
  // Production PREPARED write-ahead shape plus the no-effect result patch.
  // The exception path retains the original receipt and has no completedAt.
  work.dispatch = { operationId: 'send-operative-not-materialized', status,
    startedAt: '2026-11-05T13:45:00.000Z', effectPossible: false,
    acknowledged: false, acknowledgementEvidence: '', method: '',
    baselineDocumentId: 'operative-document', baselineUserCount: 1,
    baselineAssistantCount: 1, baselineAssistantHash: work.baselineAssistantHash,
    baselineLastUserId: old.lastPrompt.dispatchedUserTurnId,
    promptMarker: promptCausalMarker(work.text), replayCount: 0,
    ...(viaError ? { error: { name: 'Error', code: 'SEND_CONTROL_UNAVAILABLE', message: 'No send control available.' } }
      : { completedAt: '2026-11-05T13:45:01.000Z' }) };
  return old;
}

test('completed bootstrap from the 1029 to 1030 diagnostic is settled without a work response', () => {
  const old = source(), before = structuredClone(old);
  assert.equal(old.phase, 'STOPPED');
  assert.equal(old.lastResponse, null);
  assert.equal(old.sessionInitialization.status, 'READY');
  assert.equal(old.pendingPrompt.sendAttempts, 0);
  assert.equal(old.pendingPrompt.dispatch, null);
  assert.equal(missionEffectsSettled(old), true);
  assert.deepEqual(old, before, 'recognition must not rewrite the stopped process or manufacture a work response');
});

test('completed bootstrap allows durable ownership transfer and fences the stopped prior owner', async () => {
  const old = source(), before = structuredClone(old), local = await seeded(old), next = target();
  const row = await inspectMissionOwnership(next, { storage: local, liveWorkerIds: fixture.liveWorkerIds });
  assert.equal(row.code, 'MISSION_OWNER_AVAILABLE');
  assert.equal(row.sources.find(p => p.processId === old.processId)?.effectsSettled, true);
  const claim = await claimMissionOwnership(next, { storage: local, allowTakeover: true, liveWorkerIds: fixture.liveWorkerIds });
  assert.equal(claim.allowed, true);
  assert.equal(claim.code, 'MISSION_OWNER_TRANSFERRED');
  assert.equal(claim.archivedRecovery, false);
  const saved = await readMissionOwnership(local);
  assert.equal(saved.owners[missionKey].workerId, next.workerId);
  assert.equal(saved.owners[missionKey].processId, next.processId);
  assert.equal(saved.history.at(-1).reconciliation, null, 'valid transport completion needs no operator override');
  assert.deepEqual(local.data[`eic.gf.process.worker.${old.workerId}`], before);
  let sends = 0;
  await assert.rejects(withMissionOwner(old, local, async () => { sends++; }), /MISSION_OWNERSHIP_SUPERSEDED/);
  assert.equal(sends, 0, 'the old queued work must not be replayed after transfer');
});

test('completed bootstrap keeps root-page initialization receipts compatible', () => {
  const old = source();
  // The initial user turn can be sent before ChatGPT allocates /c/<id>.
  old.lastPrompt.conversationKey = '';
  old.sessionInitialization.receipt.conversationKey = '';
  assert.equal(missionEffectsSettled(old), true);
});

test('completed bootstrap recognizes the exact bound delivery-continuation completion', () => {
  const old = source(), original = structuredClone(old.lastPrompt);
  old.lastPrompt = { ...original, text: 'Fortsätt', hash: digest('Fortsätt'),
    transportKind: DELIVERY_CONTINUATION, transportId: 'short-continue-completed',
    dispatchId: 'send-continue-completed', dispatchedUserTurnId: 'user-continue-completed',
    sourceUserTurnId: original.dispatchedUserTurnId };
  old.sessionInitialization.completionReceipt = structuredClone(old.lastPrompt);
  assert.equal(missionEffectsSettled(old), true);
  old.sessionInitialization.completionReceipt.dispatchedUserTurnId = 'another-continue-turn';
  assert.equal(missionEffectsSettled(old), false, 'identical Fortsätt text is not the same user turn');
});

for (const [status, viaError] of [['NO_EFFECT_CONFIRMED', true], ['NO_EFFECT_CONFIRMED', false],
  ['RATE_LIMIT_REJECTED_NO_EFFECT', false], ['ABORTED_BEFORE_EFFECT_GLOBAL_RATE_LIMIT', false]]) {
  test(`completed bootstrap accepts proven first-work no-effect receipt ${status} ${viaError ? 'exception' : 'result'}`, async () => {
    const old = withConfirmedNoEffect(status, viaError), before = structuredClone(old);
    assert.equal(missionEffectsSettled(old), true);
    const local = await seeded(old);
    const claim = await claimMissionOwnership(target(), { storage: local, allowTakeover: true });
    assert.equal(claim.allowed, true);
    assert.equal(claim.code, 'MISSION_OWNER_TRANSFERRED');
    assert.deepEqual(local.data[`eic.gf.process.worker.${old.workerId}`], before,
      'confirmed no effect transfers ownership without rewriting or replaying the old attempt');
  });
}

test('no-effect labels cannot conceal materialization, uncertain dispatch, or a foreign prompt receipt', () => {
  const changes = {
    unknown_status: p => { p.pendingPrompt.dispatch.status = 'TRANSPORT_UNKNOWN'; },
    prepared_status: p => { p.pendingPrompt.dispatch.status = 'PREPARED'; },
    possible_effect: p => { p.pendingPrompt.dispatch.effectPossible = true; },
    unknown_effect: p => { p.pendingPrompt.dispatch.effectPossible = null; },
    missing_effect: p => { delete p.pendingPrompt.dispatch.effectPossible; },
    acknowledged: p => { p.pendingPrompt.dispatch.acknowledged = true; },
    missing_acknowledgement: p => { delete p.pendingPrompt.dispatch.acknowledged; },
    posted_time: p => { p.pendingPrompt.dispatch.postedAtMs = 1793886301000; },
    send_method: p => { p.pendingPrompt.dispatch.method = 'send-button'; },
    materialized_turn: p => { p.pendingPrompt.dispatch.materializedUserTurnId = 'work-turn'; },
    materialized_index: p => { p.pendingPrompt.dispatch.materializedUserTurnIndex = 1; },
    materialization_receipt: p => { p.pendingPrompt.dispatch.materializationReceiptAt = '2026-11-05T13:45:01.000Z'; },
    foreign_prompt: p => { p.pendingPrompt.dispatch.promptMarker = 'a2a-00000000-0000-4000-8000-000000000000'; },
    missing_marker: p => { p.pendingPrompt.dispatch.promptMarker = ''; },
    missing_operation: p => { p.pendingPrompt.dispatch.operationId = ''; },
    changed_baseline: p => { p.pendingPrompt.dispatch.baselineAssistantHash = 'f'.repeat(64); },
    missing_attempt: p => { p.pendingPrompt.sendAttempts = 0; },
    fractional_attempt: p => { p.pendingPrompt.sendAttempts = 0.5; }
  };
  for (const [name, change] of Object.entries(changes)) {
    const old = withConfirmedNoEffect('NO_EFFECT_CONFIRMED'); change(old);
    assert.equal(missionEffectsSettled(old), false, name);
  }
});

test('completed bootstrap remains settled after production schedule parking discards the unsent draft', async () => {
  const old = source(); old.phase = PHASES.SENDING;
  const item = { itemId: old.queueContext.itemId, savedMissionId: old.queueContext.savedMissionId, status: 'ACTIVE' };
  const queue = { queueId: old.queueContext.queueId, workerId: old.workerId, enabled: true,
    activeItemId: item.itemId, items: [item] };
  const deps = { PHASES, SCHEDULE_BLOCK, normalizeMissionQuantumInteractions, sessionRotationObjective,
    retainedObjectiveContext, deepClone: structuredClone, PROCESS_STATUS_REQUEST: 'FULL_NEXT_PROMPT',
    nowIso: () => '2026-11-05T13:45:00.000Z',
    missionQueueForWindow: async () => ({ queue, settings: {} }),
    releaseGlobalPromptLease: async () => {}, parkSlotAndActivateNext: async args => args.parkedSnapshot,
    earliestQueueWakeAtMs: () => fixture.nowMs + 30000,
    commitTransition: async (current, phase, patch) => ({ ...current, ...patch, phase }),
    syncMissionQueueWakeAlarm: async () => {}, syncOverlay: async () => {} };
  for (const name of ['queueItemForProcess', 'queueResumeRecordFromAnalysis', 'scheduleParkOutcome',
    'parkQueueMissionForSchedule', 'enterQueueWait']) deps[name] = production(name, deps);
  const parked = await deps.parkQueueMissionForSchedule(old, SCHEDULE_BLOCK.OUTSIDE_WINDOW);
  assert.equal(parked.pendingPrompt, null);
  assert.equal(parked.objectiveState.status, 'PARKED_QUEUE');
  assert.equal(missionEffectsSettled(parked), true);

  const waiting = await deps.enterQueueWait(parked, queue, {
    reason: 'SCHEDULE_WINDOW_CLOSED', parkedItemId: item.itemId });
  assert.equal(waiting.pendingPrompt, null);
  assert.equal(waiting.queueContext, null);
  assert.equal(waiting.phase, PHASES.QUEUE_WAIT);
  assert.equal(missionEffectsSettled(waiting), true,
    'clearing the current queue context must not invalidate the completed transport receipt');
  const local = await seeded(waiting);
  assert.equal((await claimMissionOwnership(target(), { storage: local, allowTakeover: true })).allowed, true);

  waiting.queueWait.parkedItemId = 'foreign-parked-item';
  assert.equal(missionEffectsSettled(waiting), false);
});

test('without a future draft the completed receipt still requires the original historical binding', () => {
  const old = source(); old.pendingPrompt = null;
  assert.equal(missionEffectsSettled(old), true);
  for (const change of [p => { p.sessionInitialization.receipt = null; },
    p => { p.sessionInitialization.status = 'PENDING'; },
    p => { p.sessionInitialization.response = null; }, p => { p.sessionSeq++; },
    p => { p.queueContext.itemId = 'foreign-item'; }, p => { p.runId = 'foreign-run'; },
    p => { p.sessionInitialization.acknowledgement.binding.workPromptHash = ''; },
    p => { p.priorStateUnknown = true; }, p => { p.storageRecoveryRequired = true; }]) {
    const changed = structuredClone(old); change(changed);
    assert.equal(missionEffectsSettled(changed), false);
  }
});

test('READY alone, incomplete receipts, or an unrelated response never settle bootstrap effects', () => {
  const cases = {
    pending: p => { p.sessionInitialization.status = 'PENDING'; },
    awaiting_ack: p => { p.sessionInitialization.status = 'AWAITING_ACK'; },
    no_completion_stamp: p => { p.sessionInitialization.completedAt = ''; },
    no_response_id: p => { p.sessionInitialization.response.messageId = ''; },
    no_response_hash: p => { p.sessionInitialization.response.hash = ''; },
    unrelated_response: p => { p.sessionInitialization.response.hash = 'f'.repeat(64); },
    no_receipt: p => { p.sessionInitialization.receipt = null; },
    not_acknowledged: p => { p.lastPrompt.acknowledged = false; },
    receipt_not_acknowledged: p => { p.sessionInitialization.receipt.acknowledged = false; },
    wrong_dispatch: p => { p.lastPrompt.dispatchId = 'different-dispatch'; },
    wrong_user_turn: p => { p.lastPrompt.dispatchedUserTurnId = 'different-user-turn'; },
    no_user_turn: p => { p.lastPrompt.dispatchedUserTurnId = ''; },
    wrong_hash: p => { p.lastPrompt.hash = 'f'.repeat(64); },
    wrong_text: p => { p.lastPrompt.text += ' unrelated text'; },
    wrong_transport: p => { p.lastPrompt.transportId = 'different-initialization'; },
    stale_work_still_held: p => { p.sessionInitialization.workPrompt = structuredClone(p.pendingPrompt); }
  };
  for (const [name, change] of Object.entries(cases)) {
    const old = source(); change(old);
    assert.equal(missionEffectsSettled(old), false, name);
  }
});

test('bootstrap completion stays bound to its process, worker, run, session, queue slot, and exact work', () => {
  const cases = {
    process: p => { p.processId = 'foreign-process'; },
    worker: p => { p.workerId = 'foreign-worker'; },
    run: p => { p.runId = 'foreign-run'; },
    session: p => { p.sessionSeq++; },
    queue: p => { p.queueContext.queueId = 'foreign-queue'; },
    slot: p => { p.queueContext.itemId = 'foreign-item'; },
    mission: p => { p.queueContext.savedMissionId = 'foreign-mission'; },
    work_hash: p => { p.pendingPrompt.hash = 'f'.repeat(64); },
    no_challenge: p => { p.sessionInitialization.acknowledgement = null; },
    wrong_challenge: p => { p.sessionInitialization.acknowledgement.hash = 'f'.repeat(64); },
    wrong_response_conversation: p => { p.sessionInitialization.conversationKey = 'https://chatgpt.com/c/foreign'; },
    wrong_receipt_conversation: p => { p.sessionInitialization.receipt.conversationKey = 'https://chatgpt.com/c/foreign'; },
    wrong_prompt_conversation: p => { p.lastPrompt.conversationKey = 'https://chatgpt.com/c/foreign'; },
    wrong_work_conversation: p => { p.pendingPrompt.requiredConversationKey = 'https://chatgpt.com/c/foreign'; }
  };
  for (const [name, change] of Object.entries(cases)) {
    const old = source(); change(old);
    assert.equal(missionEffectsSettled(old), false, name);
  }
});

test('an operative prompt after bootstrap still requires its own paired response', () => {
  const old = source();
  old.lastPrompt = { ...old.pendingPrompt, transportKind: '', acknowledged: true,
    dispatchId: 'operative-dispatch', dispatchedUserTurnId: 'operative-user-turn' };
  old.pendingPrompt = null;
  assert.equal(missionEffectsSettled(old), false);
  old.lastResponse = { text: 'The requested operation completed and its checkpoint was verified.',
    observation: { pairedUserTurnId: 'other-user-turn' } };
  assert.equal(missionEffectsSettled(old), false);
  old.lastResponse.observation.pairedUserTurnId = 'operative-user-turn';
  assert.equal(missionEffectsSettled(old), true, 'normal operative response settlement remains unchanged');
});

test('unknown operative dispatches and damaged state cannot inherit bootstrap completion', async () => {
  const cases = {
    attempt_without_receipt: p => { p.pendingPrompt.sendAttempts = 1; },
    possible_send: p => { p.pendingPrompt.dispatch = { effectPossible: true }; },
    unknown_send: p => { p.pendingPrompt.dispatch = { effectPossible: null }; },
    missing_effect_status: p => { p.pendingPrompt.dispatch = {}; },
    unknown_prior_state: p => { p.priorStateUnknown = true; },
    storage_recovery: p => { p.storageRecoveryRequired = true; }
  };
  for (const [name, change] of Object.entries(cases)) {
    const old = source(); change(old);
    assert.equal(missionEffectsSettled(old), false, name);
    const local = await seeded(old);
    const result = await claimMissionOwnership(target(), { storage: local, allowTakeover: true });
    assert.equal(result.allowed, false, name, 'raw claim must first be converted into the automatic no-replay quarantine prompt');
    assert.equal(result.code, 'MISSION_PRIOR_EFFECT_QUARANTINE_REQUIRED', name);
  }
});

test('a live but settled prior owner is fenced automatically without an operator gate', async () => {
  const old = source(), local = await seeded(old), next = target();
  const result = await claimMissionOwnership(next, { storage: local, allowTakeover: true,
    liveWorkerIds: async () => [{workerId:old.workerId,processId:old.processId}] });
  assert.equal(result.allowed, true);
  assert.equal(result.code, 'MISSION_OWNER_TRANSFERRED');
  assert.equal((await readMissionOwnership(local)).owners[missionKey].workerId, next.workerId);
});

test('simultaneous successors cannot both inherit a completed bootstrap owner', async () => {
  const local = await seeded();
  const results = await Promise.all(['successor-a', 'successor-b'].map(id =>
    claimMissionOwnership(target(id), { storage: local, allowTakeover: true })));
  assert.equal(results.filter(row => row.allowed).length, 1);
  assert.equal(results.find(row => !row.allowed).code, 'MISSION_OWNER_CLAIM_IN_PROGRESS');
});

test('an interrupted checkpoint publication still blocks automatic ownership transfer', async () => {
  const old = source(), local = await seeded(old);
  delete local.data[`eic.gf.process.worker.${old.workerId}`];
  const result = await claimMissionOwnership(target(), { storage: local, allowTakeover: true });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'MISSION_PRIOR_CHECKPOINT_UNRECONCILED');
});
