import test from 'node:test';
import assert from 'node:assert/strict';
import { A2A_GFW_POLICY_COMPLIANCE_NOTE, buildA2AEnvelope, validateA2AEnvelope } from '../lib/a2a.mjs';
import { createProcess } from '../lib/state.mjs';
import { publicMissionWorkQueue, requeueBlockedMissionWorkItem } from '../lib/mission-work-queue.mjs';
import { windowQueueOverview } from '../lib/window-queue-overview.mjs';

test('FULL GFW prompt carries binding Project71 policy, AIK coordination and dynamic supervisor instruction', () => {
  for (const phrase of [
    'MANDATORY GFW POLICY COMPLIANCE',
    'Project71',
    'M1070',
    'AIK Stream',
    'GFW_FLEET_SUPERVISOR',
    'M1057',
    'repository commit',
    'PRIMARY MISSION PRIORITY',
    'TEMPORARY_EXPECTED_CONCURRENCY',
    'FEATURE PROPOSAL',
    'OPERATOR DECISION REQUIRED',
    'continue independent authorized work'
  ]) assert.ok(A2A_GFW_POLICY_COMPLIANCE_NOTE.includes(phrase), `missing ${phrase}`);
});

test('FULL and COMPACT operative GFW prompts both carry the binding policy note', () => {
  const process=createProcess({workerId:'w',windowId:1,tabId:2,goal:'Project 59 GFW GF-4.59.1030',initialPrompt:'Continue the bounded mission'});
  const full=buildA2AEnvelope({process,objective:'Continue'});
  const compact=buildA2AEnvelope({process,objective:'Continue',promptProfile:{profile:'COMPACT',ordinal:6,lastFullOrdinal:5}});
  assert.equal(validateA2AEnvelope(full).ok,true);
  assert.equal(validateA2AEnvelope(compact).ok,true);
  assert.match(full.responseContract.note,/MANDATORY GFW POLICY COMPLIANCE/);
  assert.match(compact.responseContract.note,/MANDATORY GFW POLICY COMPLIANCE/);
  assert.match(compact.promptProfile.rule,/unchanged from the most recent FULL Greenfield prompt/i);
});

test('public queue projection never exposes BLOCKED and preserves recovery outcome', () => {
  const queue = {
    queueId: 'q', workerId: 'w', windowId: 1, enabled: true, activeItemId: '', cursorOrder: 0,
    items: [{
      itemId: 'i', savedMissionId: 'm', label: 'GF-4.59.1030', goal: 'Project 59 GFW GF-4.59.1030',
      status: 'BLOCKED', order: 0, priority: 'URGENT', maxInteractions: 18,
      blockedRetryAtMs: 0, blockedCount: 3, lastOutcome: 'SESSION_INITIALIZATION_ACK_EXHAUSTED',
      lastSummary: 'init ack missing', processSnapshot: { processId: 'p' }, resume: { previousDisposition: 'INITIALIZATION_UNCONFIRMED' }
    }],
    history: [{itemId:'h',savedMissionId:'old',label:'old',goal:'old',status:'BLOCKED',order:0,priority:'NORMAL',maxInteractions:3}]
  };
  const projected = publicMissionWorkQueue(queue, 1000);
  assert.equal(projected.items[0].status, 'PAUSED');
  assert.equal(projected.items[0].lastOutcome, 'SESSION_INITIALIZATION_ACK_EXHAUSTED');
  assert.equal(projected.items[0].hasContinuation, true);
  assert.equal(projected.items[0].pauseUntilMs, 0);
  assert.equal(projected.items[0].needsOwnerReconciliation, true);
  assert.equal(projected.items[0].blockedCount, 0);
  assert.equal(projected.history[0].status, 'PAUSED');
  assert.ok(projected.items.every(item => item.status !== 'BLOCKED'));
});

test('window queue prompt projection reports parked GFW as PAUSED', () => {
  const view = windowQueueOverview({
    queueId: 'q', enabled: true,
    items: [{itemId:'i',label:'GF-4.59.1030',goal:'GF-4.59.1030',status:'BLOCKED',order:0,priority:'URGENT',maxInteractions:18,blockedRetryAtMs:0,pauseUntilMs:0}]
  }, {now:1000});
  assert.equal(view.slots[0].status, 'PAUSED');
  assert.ok(!view.slots.some(slot => slot.status === 'BLOCKED'));
});

test('AI-declared BLOCKED queue outcome becomes exponential PAUSED retry, not a BLOCKED list item', () => {
  const queue={queueId:'q',workerId:'w',windowId:1,enabled:true,activeItemId:'i',cursorOrder:0,items:[
    {itemId:'i',savedMissionId:'m',label:'GF-4.59.1030',goal:'GF-4.59.1030',status:'ACTIVE',order:0,maxInteractions:18,blockedCount:0}
  ]};
  const next=requeueBlockedMissionWorkItem(queue,'i',{now:1000,retryAfterSeconds:300,lastOutcome:'AI_BLOCKED',lastSummary:'AI identified a real dependency'});
  assert.equal(next.items[0].status,'PAUSED');
  assert.equal(next.items[0].pauseUntilMs,301000);
  assert.equal(next.items[0].lastOutcome,'AI_BLOCKED');
  assert.equal(next.activeItemId,'');
});
