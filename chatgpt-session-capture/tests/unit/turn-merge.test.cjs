'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('../../lib/turn-merge.js');

const { mergeTurnData } = globalThis.CgscTurnMerge;

function turn(overrides = {}) {
  return {
    stableKey: 'msg-1',
    scanIndex: 0,
    finalText: 'Complete answer text',
    finalMarkdown: 'Complete answer text',
    messages: [{ messageId: 'msg-1', markdown: 'Complete answer text', text: 'Complete answer text' }],
    reasoning: [{ index: 0, title: 'Thought for 5s', expanded: true, contentFound: true, text: 'step one', markdown: 'step one' }],
    attachments: [],
    unclassifiedToggles: [],
    ...overrides
  };
}

test('first observation initialises bookkeeping', () => {
  const merged = mergeTurnData(null, turn({ scanIndex: 3 }), { capturedAt: 100 });
  assert.equal(merged.firstSeenScanIndex, 3);
  assert.equal(merged.firstSeenAt, 100);
  assert.equal(merged.observations, 1);
});

test('a later, emptier observation does not overwrite captured content', () => {
  const first = mergeTurnData(null, turn({ scanIndex: 1 }), { capturedAt: 100 });
  const poorer = turn({
    scanIndex: 7,
    finalText: '',
    finalMarkdown: '',
    messages: [],
    reasoning: [{ index: 0, title: 'Thought for 5s', expanded: false, contentFound: false, text: '', markdown: '' }]
  });
  const merged = mergeTurnData(first, poorer, { capturedAt: 200, previousCapturedAt: 100 });
  assert.equal(merged.finalMarkdown, 'Complete answer text');
  assert.equal(merged.messages.length, 1);
  assert.equal(merged.reasoning[0].contentFound, true);
  assert.equal(merged.reasoning[0].text, 'step one');
  assert.equal(merged.firstSeenScanIndex, 1);
  assert.equal(merged.lastSeenScanIndex, 7);
  assert.equal(merged.observations, 2);
  assert.equal(merged.shorterObservationsIgnored, 1);
});

test('a longer observation (completed streaming) replaces a shorter one', () => {
  const first = mergeTurnData(null, turn({ finalText: 'Part', finalMarkdown: 'Part' }));
  const merged = mergeTurnData(first, turn({ scanIndex: 2 }));
  assert.equal(merged.finalMarkdown, 'Complete answer text');
  assert.equal(merged.shorterObservationsIgnored, 0);
});

test('reasoning panels are merged per index and an expanded panel wins', () => {
  const collapsed = turn({ reasoning: [{ index: 0, title: 'Thought for 5s', expanded: false, contentFound: false, text: '' }] });
  const expanded = turn({ reasoning: [{ index: 0, title: 'Thought for 5s', expanded: true, contentFound: true, text: 'details' }, { index: 1, title: 'Analyzed', expanded: true, contentFound: true, text: 'x' }] });
  const merged = mergeTurnData(mergeTurnData(null, collapsed), expanded);
  assert.equal(merged.reasoning.length, 2);
  assert.equal(merged.reasoning[0].text, 'details');
  const again = mergeTurnData(merged, collapsed);
  assert.equal(again.reasoning[0].text, 'details');
  assert.equal(again.reasoning.length, 2);
});

test('attachments and unclassified toggles are unioned', () => {
  const a = turn({ attachments: [{ kind: 'image', url: 'u1', displayName: 'Uploaded image' }], unclassifiedToggles: ['Sources'] });
  const b = turn({ attachments: [{ kind: 'image', url: 'u2', displayName: 'Uploaded image' }, { kind: 'image', url: 'u1', displayName: 'Uploaded image' }], unclassifiedToggles: ['Sources', 'More'] });
  const merged = mergeTurnData(mergeTurnData(null, a), b);
  assert.deepEqual(merged.attachments.map((item) => item.url), ['u1', 'u2']);
  assert.deepEqual(merged.unclassifiedToggles, ['Sources', 'More']);
});
