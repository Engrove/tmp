'use strict';

// Verdict logic of export.js, exercised with synthetic records.

const test = require('node:test');
const assert = require('node:assert/strict');
require('../../lib/capture-core.js');
require('../../export.js');

const { buildCompleteness, collectAttachments, buildMarkdown, compareTurns } = globalThis.CgscExport;
const CONVERSATION = '11111111-2222-3333-4444-555555555555';
const PAGE = `https://chatgpt.com/c/${CONVERSATION}`;

function turnRecord(index, overrides = {}) {
  return {
    id: `s:turn-msg-${index}`,
    kind: 'conversation-turn',
    capturedAt: 1000 + index,
    data: {
      stableKey: `msg-${index}`,
      turnIndex: index,
      role: index % 2 ? 'user' : 'assistant',
      messageId: `msg-${index}`,
      finalText: `text ${index}`,
      finalMarkdown: `text ${index}`,
      reasoning: [],
      attachments: [],
      pageUrl: PAGE,
      ...overrides
    }
  };
}

function sweepRecord(indices, overrides = {}) {
  return {
    id: 's:sweep',
    kind: 'sweep-progress',
    capturedAt: 5000,
    data: {
      stage: 'sweep-complete',
      topVerified: true,
      bottomVerified: true,
      firstTurnIndexAtVerifiedTop: indices[0],
      turnIndices: indices,
      maximumTurnIndex: indices.at(-1),
      observedStableKeys: indices.map((index) => `msg-${index}`),
      expansion: { failed: 0 },
      transport: { turnRecordsFailed: 0, recordsFailed: 0 },
      ...overrides
    }
  };
}

const session = { id: 's', conversationId: CONVERSATION, startUrl: PAGE, options: {}, captureProfile: 'ai-transcript' };

function verdict(turns, extraRecords = [], sessionOverrides = {}) {
  const records = [...turns, ...extraRecords];
  const sorted = turns.slice().sort(compareTurns);
  return buildCompleteness({ ...session, ...sessionOverrides }, records, sorted, collectAttachments(sorted));
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

test('complete capture is verified', () => {
  const result = verdict(range(1, 6).map((i) => turnRecord(i)), [sweepRecord(range(1, 6))]);
  assert.equal(result.status, 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT');
  assert.deepEqual(result.failedChecks, []);
});

test('tail truncation (stored subset of observed turns) is not verified', () => {
  // The 1.1.1 false positive: turns 1..4 stored, 5..6 observed but lost.
  const result = verdict(range(1, 4).map((i) => turnRecord(i)), [sweepRecord(range(1, 6))]);
  assert.equal(result.status, 'CAPTURED_WITH_UNVERIFIED_BOUNDARIES_OR_GAPS');
  assert.ok(result.failedChecks.includes('everyObservedTurnStored'));
  assert.ok(result.failedChecks.includes('lastTurnMatchesSweep'));
  assert.deepEqual(result.turnSequence.observedIndicesMissingFromStore, [5, 6]);
});

test('numbering that starts at 2 is verified when the verified top shows turn 2', () => {
  const result = verdict(range(2, 7).map((i) => turnRecord(i)), [sweepRecord(range(2, 7))]);
  assert.equal(result.status, 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT');
  assert.equal(result.turnSequence.contiguousFromTurnOne, false);
});

test('missing first turn is detected via the verified top', () => {
  const result = verdict(range(3, 7).map((i) => turnRecord(i)), [sweepRecord(range(3, 7), { firstTurnIndexAtVerifiedTop: 2 })]);
  assert.ok(result.failedChecks.includes('firstTurnAtVerifiedTop'));
});

test('a legacy sweep without observations cannot be verified', () => {
  const legacy = sweepRecord(range(1, 3));
  delete legacy.data.observedStableKeys;
  delete legacy.data.firstTurnIndexAtVerifiedTop;
  const result = verdict(range(1, 3).map((i) => turnRecord(i)), [legacy]);
  assert.ok(result.failedChecks.includes('sweepObservationsAvailable'));
  assert.notEqual(result.status, 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT');
});

test('only the session fallback (no stored completion record) is not verified', () => {
  const result = verdict(range(1, 3).map((i) => turnRecord(i)), [], { fullCaptureResult: { sweep: sweepRecord(range(1, 3)).data } });
  assert.equal(result.sweepSource, 'session-fallback');
  assert.ok(result.failedChecks.includes('sweepCompletionRecordStored'));
});

test('turns from another conversation block verification', () => {
  const turns = range(1, 3).map((i) => turnRecord(i));
  turns[2].data.pageUrl = 'https://chatgpt.com/c/99999999-8888-7777-6666-555555555555';
  const result = verdict(turns, [sweepRecord(range(1, 3))]);
  assert.ok(result.failedChecks.includes('noTurnFromAnotherConversation'));
  assert.equal(result.conversation.foreignConversationTurns, 1);
});

test('page network failures do not block a transcript verdict; pipeline errors do', () => {
  const turns = range(1, 3).map((i) => turnRecord(i));
  const networkFailure = { id: 's:f', kind: 'cdp-network-loading-failed', capturedAt: 1, data: {} };
  assert.equal(verdict(turns, [sweepRecord(range(1, 3)), networkFailure]).status, 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT');
  const chunkError = { id: 's:c', kind: 'bridge-chunk-error', capturedAt: 1, data: {} };
  const result = verdict(turns, [sweepRecord(range(1, 3)), chunkError]);
  assert.ok(result.failedChecks.includes('noPipelineErrorRecord'));
});

test('reasoning panel without content blocks verification', () => {
  const turns = range(1, 2).map((i) => turnRecord(i));
  turns[1].data.reasoning = [{ index: 0, title: 'Thought for 3s', expanded: false, contentFound: false, text: '' }];
  assert.ok(verdict(turns, [sweepRecord(range(1, 2))]).failedChecks.includes('everyReasoningPanelHasContent'));
});

test('transport failures reported by the sweep block verification', () => {
  const result = verdict(range(1, 2).map((i) => turnRecord(i)), [sweepRecord(range(1, 2), { transport: { turnRecordsFailed: 1, recordsFailed: 1 } })]);
  assert.ok(result.failedChecks.includes('noTransportFailure'));
});

test('no completed sweep', () => {
  assert.equal(verdict([turnRecord(1)]).status, 'NO_COMPLETED_SWEEP_RECORDED');
});

test('turns without a numeric index sort after numbered ones (total order)', () => {
  const unnumbered = turnRecord(9, { turnIndex: null, dataTestId: null, stableKey: 'user-abc', firstSeenScanIndex: 0 });
  const sorted = [unnumbered, turnRecord(2), turnRecord(1)].sort(compareTurns);
  assert.deepEqual(sorted.map((record) => record.data.stableKey), ['msg-1', 'msg-2', 'user-abc']);
});

test('session.md keeps verbatim message text including blank-line runs', () => {
  const text = 'def f():\n    x = 1\n\n\n    return x';
  const turns = [turnRecord(1, { finalText: text, finalMarkdown: text })];
  const markdown = buildMarkdown(session, turns, null);
  assert.ok(markdown.includes(text));
  assert.match(markdown, /<!-- cgsc:turn sequence=1 index=1 role=user -->/);
});

test('reasoning body is printed even when the panel lists steps', () => {
  const turns = [turnRecord(2, { reasoning: [{ index: 0, title: 'Thought for 3s', expanded: true, contentFound: true, text: 'Body text\nRead file', markdown: 'Body text\n\nRead file', steps: ['Read file', 'Search web'] }] })];
  const markdown = buildMarkdown(session, turns, null);
  assert.match(markdown, /Body text/);
  assert.match(markdown, /\*\*Visible steps\*\*\n\n- Search web/);
  assert.doesNotMatch(markdown, /- Read file/);
});
