import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { legacyReadyFixtures } from './fixtures/initialization-ready-2026-10-15.mjs';

// The override supports the recorded negative control against the immutable
// previous v1.9.17 delivery, never an unrecorded replacement of that source.
const root = process.env.GREENFIELD_ACK_PACKAGE_ROOT
  ? pathToFileURL(resolve(process.env.GREENFIELD_ACK_PACKAGE_ROOT) + '/') : new URL('../', import.meta.url);
const load = name => import(new URL(`lib/${name}.mjs`, root));
const transport = await load('session-transport');
const { prepareSessionInitialization, expectedInitializationAck, legacyInitializationUpgradeAllowed,
  SESSION_INITIALIZATION, DELIVERY_CONTINUATION } = transport;
const { initializationAcknowledged, advanceResponseCandidate } = await load('response-stability');
const { responseStructuralCompleteness } = await load('response-observation');
const { autonomousResponseObservation } = await load('turn-causality');
const { conversationKey } = await load('restart-recovery');
const { providerTransportPending } = await load('waiting-refresh');
const { createProcess, transitionProcess } = await load('state');
const { PHASES, TERMINAL_PHASES } = await load('contracts');
const { workerReason } = await load('operations-view');
const background = await readFile(new URL('background.js', root), 'utf8');
const panel = await readFile(new URL('sidepanel.js', root), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const contentSource = await readFile(new URL('content.js', root), 'utf8');
const readyHashFixture = JSON.parse(await readFile(new URL('./fixtures/ready-hash-2026-10-23.json', import.meta.url), 'utf8'));

// Run the shipped sanitizer. Only expose its private function to the test;
// do not replace text extraction or ACK parsing with test implementations.
function domReader() {
  const dom = new JSDOM('<main><article></article></main>', {
    url: 'https://chatgpt.com/c/one', runScripts: 'outside-only'
  });
  const w = dom.window;
  w.chrome = { runtime: { id: 'test', onMessage: { addListener() {}, removeListener() {} },
    sendMessage: async () => ({ ok: true }) } };
  w.eval(contentSource.replace(/\}\)\(\);\s*$/, 'window.testMessageText = messageText; })();'));
  const owner = w.document.querySelector('article');
  return {
    read(html, role = 'assistant') {
      owner.innerHTML = html;
      const before = owner.innerHTML;
      const text = w.testMessageText({ owner, role });
      assert.equal(owner.innerHTML, before, 'extraction must not modify the live message');
      return text;
    },
    close() { w.__EIC_GF_CONTENT_V2__.dispose(); w.close(); }
  };
}

function functionSource(name, source) {
  const found = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(found, name);
  const tail = source.slice(found.index), end = /^}\s*$/m.exec(tail);
  return tail.slice(0, end.index + end[0].length);
}
function runtime(name, source, deps) {
  return Function(...Object.keys(deps), `${functionSource(name, source)}; return ${name};`)(...Object.values(deps));
}
function worker(id = 'one', project = 71) {
  const goal = `Projekt: ${project} - Greenfield test - GFW: GF-1.${project}.1021.`;
  const p = createProcess({ workerId: `worker-${id}`, windowId: id === 'one' ? 1 : 2, tabId: 20, goal, initialPrompt: 'Initial work' });
  return { ...p, processId: `process-${id}`, runId: `run-${id}`, phase: PHASES.WAITING,
    pendingPrompt: null, lastManagedUrl: `https://chatgpt.com/c/${id}`, responseCandidate: null,
    queueContext: { queueId: `queue-${id}`, itemId: `item-${id}`, savedMissionId: `mission-${id}`, interactionCount: 0, maxInteractions: 5 } };
}
const work = () => ({ text: 'Complete bounded work. Preserve all scope constraints. Never replay uncertain effects.', hash: 'full-operative-work-hash', sendAttempts: 0, dispatch: null });
function dispatched(prompt, user = 'user-original') {
  return { ...prompt, dispatchedUserTurnId: user, dispatchedUserTurnIndex: 0, acknowledged: true };
}
async function prepared(id = 'one') {
  let p = worker(id);
  const packet = await prepareSessionInitialization(p, work(), { url: p.lastManagedUrl });
  return { ...p, sessionInitialization: packet.sessionInitialization, lastPrompt: dispatched(packet.pendingPrompt) };
}
function legacy(project = 71) {
  const p = worker('one', project), initializationId = 'a2a-10000000-1000-4000-8000-100000000001';
  const a2a = { messageId: initializationId, messageType: SESSION_INITIALIZATION,
    instruction: `Open project ${project}. Reply only READY, then await the next prompt. Do not start mission work or change project data.` };
  return { ...p, lastPrompt: dispatched({ text: JSON.stringify(a2a), hash: digest(JSON.stringify(a2a)), a2a,
    transportKind: SESSION_INITIALIZATION, transportId: initializationId, conversationKey: conversationKey(p.lastManagedUrl) }),
    sessionInitialization: { initializationId, sessionSeq: p.sessionSeq, status: 'PENDING', conversationKey: '', workPrompt: work() } };
}
function pageFor(p, text, patch = {}) {
  return { url: p.lastManagedUrl, documentId: 'document-original', assistantCount: 1, generating: false,
    lastUserId: p.lastPrompt.dispatchedUserTurnId,
    autonomousTurn: { assistantFound: true, assistantId: 'assistant-original', assistantOwnerKind: 'SHELL_MESSAGE',
      assistantOwnerTrusted: true, assistantReplicaCount: 1, assistantHash: digest(text), assistantText: text,
      assistantTextLength: text.length, assistantGenerating: false, resolvedUserTurnId: p.lastPrompt.dispatchedUserTurnId,
      resolvedBy: 'USER_TURN_ID', assistantSignals: { visibilityState: 'visible' }, ...patch } };
}
function harness(seed, options = {}) {
  let current = structuredClone(seed), clock = 100000, commits = 0, releases = 0, saves = 0, preparations = 0;
  const reasons = [], schedules = [], transitions = [];
  const boundary = async p => options.stopBeforeCommit && preparations
    ? { blocked: true, process: current = { ...current, phase: PHASES.STOPPED } } : { blocked: false, process: p };
  const deps = { PHASES, conversationKey, initializationAcknowledged, responseStructuralCompleteness,
    autonomousResponseObservation, providerTransportPending, expectedInitializationAck, legacyInitializationUpgradeAllowed,
    prepareSessionInitialization: async (...args) => { preparations++; return prepareSessionInitialization(...args); },
    DELIVERY_CONTINUATION, FAST_RECHECK_MS: 900, nowIso: () => new Date(clock).toISOString(),
    advanceResponseCandidate: (c, o) => advanceResponseCandidate(c, o, { now: clock }),
    scheduleFast: (id, delay) => schedules.push({ id, delay }),
    saveObserved: async (p, patch) => { saves++; return current = { ...p, ...patch }; },
    transportTransitionBoundary: boundary,
    recordResponseObservation: async (p, reason) => { reasons.push(reason); return p; },
    maybeEscalateWaitingRefresh: async p => ({ handled: false, process: p }),
    recordUsageOutput: async () => {},
    commitTransition: async (p, phase, patch, opts) => {
      const admitted = await opts.beforeSave();
      if (admitted.blocked) return admitted.process;
      commits++; transitions.push(opts.kind); return current = transitionProcess(p, phase, patch, clock);
    },
    releaseSchedulerTurn: async () => { releases++; },
    holdForSafety: async (p, hold) => { reasons.push(hold.code); return current = { ...p, safety: { ...p.safety, hold } }; }
  };
  const tick = runtime('tickSessionInitialization', background, deps);
  return { get current() { return current; }, get counts() { return { commits, releases, saves, preparations }; },
    reasons, schedules, transitions,
    async sample(page, delta = 1600) { clock += delta; return current = await tick(current, page); },
    async stable(page) { for (const delta of [0, 1600, 1600]) await this.sample(page, delta); return current; },
    dispatchPending(user = 'user-upgrade') {
      current = { ...current, phase: PHASES.WAITING, lastPrompt: dispatched(current.pendingPrompt, user), pendingPrompt: null };
      return current;
    }
  };
}

test('each initialization has a fresh 64-hex challenge bound to the original operative work', async () => {
  const a = await prepared(), b = await prepared(), c = await prepared('two');
  const hashes = [a, b, c].map(expectedInitializationAck);
  assert.equal(new Set(hashes).size, 3);
  for (const p of [a, b, c]) {
    assert.match(expectedInitializationAck(p), /^[a-f0-9]{64}$/);
    assert.ok(p.lastPrompt.text.includes(expectedInitializationAck(p)));
    assert.equal(p.sessionInitialization.acknowledgement.binding.workPromptHash, work().hash);
    assert.deepEqual(Object.keys(p.lastPrompt.a2a).sort(), ['instruction', 'messageId', 'messageType']);
  }
  assert.equal(expectedInitializationAck(JSON.parse(JSON.stringify(a))), hashes[0]);
});

test('hash search tolerates Markdown, labels, footers, uppercase and DOM-concatenated Status', async () => {
  const p = await prepared(), hash = expectedInitializationAck(p);
  for (const text of [hash, `**${hash}**`, `\`\`\`text\n${hash}\n\`\`\``, `Kvittens: [${hash}]\nStatus: klar`,
    `READY${hash}Status: Projekt öppnat\nProject: 71\nTime: now`, hash.toUpperCase(), `ChatGPT sa:\n${hash}`]) {
    assert.equal(initializationAcknowledged(text, hash), true, text);
  }
  for (const text of ['READY', 'not READY', 'READYStatus: klar', 'a'.repeat(64), hash.slice(0, -1), `${hash}a`, `a${hash}`])
    assert.equal(initializationAcknowledged(text, hash), false, text);
  assert.equal(initializationAcknowledged(hash, '.*'), false);
  assert.equal(initializationAcknowledged(hash), false);
});

test('2026-10-23 transcript reconstruction: both original and repair ACK survive DOM extraction', () => {
  const dom = domReader();
  try {
    for (const sample of [readyHashFixture.initial, readyHashFixture.repair]) {
      const text = dom.read(sample.html);
      assert.equal(initializationAcknowledged(text, sample.expectedHash), true);
    }
  } finally { dom.close(); }
});

test('2026-10-23 original READY releases the held work without an ACK repair, including a hidden tab', async () => {
  const dom = domReader();
  try {
    const p = await prepared(), f = harness(p), hash = expectedInitializationAck(p);
    const text = dom.read(readyHashFixture.initial.html.replaceAll(readyHashFixture.initial.expectedHash, hash));
    await f.stable(pageFor(p, text, { assistantSignals: { visibilityState: 'hidden' } }));
    assert.equal(f.current.phase, PHASES.SENDING);
    assert.equal(f.current.pendingPrompt.text, work().text);
    assert.equal(f.current.pendingPrompt.hash, work().hash);
    assert.equal(f.current.sessionInitialization.status, 'READY');
    assert.equal(f.current.turn, p.turn);
    assert.deepEqual(f.current.queueContext, p.queueContext);
    assert.equal(f.counts.preparations, 0);
    assert.equal(f.counts.commits, 1);
    assert.deepEqual(f.transitions, ['SESSION_INITIALIZED_WORK_PROMPT_RELEASED']);
    assert.ok(!f.reasons.includes('SESSION_INITIALIZATION_ACK_HASH_MISSING'));
  } finally { dom.close(); }
});

test('block boundaries preserve ACK tokens next to every hexadecimal character and across br', () => {
  const dom = domReader(), hash = readyHashFixture.initial.expectedHash;
  try {
    for (const hex of '0123456789abcdefABCDEF') {
      for (const html of [
        `<p>${hex}</p><p><strong><code>${hash}</code></strong></p><p>${hex}</p>`,
        `<div>${hex}</div><div>${hash}</div><div>${hex}</div>`,
        `<p>${hex}<br>${hash}<br>${hex}</p>`,
        `<h3>${hex}</h3><pre><code>${hash}</code></pre><h3>${hex}</h3>`,
        `<ul><li>${hex}</li><li>${hash}</li><li>${hex}</li></ul>`,
        `<table><tr><td>${hex}</td><td>${hash}</td><td>${hex}</td></tr></table>`
      ]) assert.equal(initializationAcknowledged(dom.read(html), hash), true, html);
    }
  } finally { dom.close(); }
});

test('inline markup does not legitimize extended, truncated, split or wrong hashes', () => {
  const dom = domReader(), hash = readyHashFixture.initial.expectedHash;
  try {
    for (const html of [
      `<p><span>A</span><code>${hash}</code></p>`,
      `<p><code>${hash}</code><em>f</em></p>`,
      `<p>${hash.slice(1)}</p>`, `<p>${'0'.repeat(64)}</p>`,
      `<p>${hash.slice(0, 32)}</p><p>${hash.slice(32)}</p>`,
      `<p>READY</p><button>${hash}</button>`,
      `<p>READY</p><span data-eic-gf-ui="true">${hash}</span>`
    ]) assert.equal(initializationAcknowledged(dom.read(html), hash), false, html);
    assert.equal(initializationAcknowledged(dom.read(`<p><span>${hash.slice(0, 32)}</span><span>${hash.slice(32)}</span></p>`), hash), true);
  } finally { dom.close(); }
});

test('assistant block extraction preserves JSON code, removes UI-only output and leaves user hashing unchanged', () => {
  const dom = domReader(), hash = readyHashFixture.initial.expectedHash;
  try {
    const json = '{\n  "schema": "eic.a2a.response.v1",\n  "summary": "A B"\n}';
    assert.equal(dom.read(`<pre><code>${json}</code></pre>`), json);
    assert.equal(dom.read('<p>First<br>Second</p>'), 'First\nSecond');
    assert.equal(dom.read('<p>ChatGPT sa:</p><div>Thinking</div><button>Copy</button>'), '');
    assert.equal(dom.read(`<p>A</p><p>${hash}</p><p>B</p>`, 'user'), `A${hash}B`);
    assert.equal(dom.read(`<div>Thinking</div><p>READY</p><p>${hash}</p>`).includes('Thinking'), false);
  } finally { dom.close(); }
});

for (const field of ['workerId', 'processId', 'runId', 'sessionSeq']) test(`copied challenge cannot bind to a different ${field}`, async () => {
  const p = await prepared(); p[field] = field === 'sessionSeq' ? 2 : 'foreign';
  assert.equal(expectedInitializationAck(p), '');
  const f = harness(p); await f.stable(pageFor(p, p.sessionInitialization.acknowledgement.hash));
  assert.equal(f.counts.commits, 0); assert.equal(f.counts.releases, 0);
});
for (const field of ['queueId', 'itemId', 'savedMissionId']) test(`challenge cannot move to another queue ${field}`, async () => {
  const p = await prepared(); p.queueContext[field] = 'foreign';
  assert.equal(expectedInitializationAck(p), '');
});
test('changed original work hash or substituted source prompt invalidates acknowledgement binding', async () => {
  const p = await prepared();
  p.sessionInitialization.workPrompt.hash = 'other-work'; assert.equal(expectedInitializationAck(p), '');
  const q = await prepared(); q.lastPrompt.transportId = 'another-initialization'; assert.equal(expectedInitializationAck(q), '');
});

test('a complete current hash response releases the exact full work prompt once, preserving mission state', async () => {
  const p = await prepared(), f = harness(p), hash = expectedInitializationAck(p);
  await f.stable(pageFor(p, `Kvittens: ${hash}\nStatus: initierad`));
  assert.equal(f.current.phase, PHASES.SENDING);
  assert.equal(f.current.pendingPrompt.text, work().text);
  assert.equal(f.current.pendingPrompt.hash, work().hash);
  assert.deepEqual(f.current.queueContext, p.queueContext);
  assert.equal(f.current.sessionSeq, p.sessionSeq); assert.equal(f.current.turn, p.turn);
  assert.equal(f.current.sessionInitialization.status, 'READY');
  assert.equal(f.counts.commits, 1); assert.equal(f.counts.releases, 1);
  assert.equal(f.current.pendingPrompt.requiredConversationKey, conversationKey(p.lastManagedUrl));
});

for (const condition of ['foreign-turn', 'foreign-conversation', 'generating', 'transport-pending', 'untrusted-owner'])
test(`correct hash is insufficient while ${condition}`, async () => {
  const p = await prepared(), f = harness(p), page = pageFor(p, expectedInitializationAck(p));
  if (condition === 'foreign-turn') page.autonomousTurn.resolvedUserTurnId = 'other';
  if (condition === 'foreign-conversation') page.url = 'https://chatgpt.com/c/other';
  if (condition === 'generating') page.autonomousTurn.assistantGenerating = true;
  if (condition === 'transport-pending') page.providerNotices = { processingNotice: true };
  if (condition === 'untrusted-owner') page.autonomousTurn.assistantOwnerTrusted = false;
  await f.stable(page); assert.equal(f.current.phase, PHASES.WAITING); assert.equal(f.counts.commits, 0);
});

test('a stable missing hash yields capacity; a corrected answer releases only the original work', async () => {
  const p = await prepared(), f = harness(p), page = pageFor(p, 'READY\nStatus: opened');
  await f.stable(page);
  assert.equal(f.current.sessionInitialization.status, 'AWAITING_ACK');
  const counts = f.counts;
  assert.deepEqual(f.counts, counts); assert.equal(counts.preparations, 0);
  assert.equal(counts.releases, 1); assert.equal(counts.commits, 1);
  assert.equal(f.current.pendingPrompt, null);
  assert.match(workerReason(f.current), /rätt kvittenshash saknas/);
  const corrected = pageFor(f.current, expectedInitializationAck(f.current));
  await f.stable(corrected); assert.equal(f.current.phase, PHASES.SENDING);
  assert.equal(f.current.sessionInitialization.ackWait, null);
});

for (const fixture of legacyReadyFixtures) test(`diagnostic project ${fixture.project}: safely upgrade exact legacy READY, then release work on new hash`, async () => {
  assert.equal(digest(fixture.body), fixture.sha256); assert.equal(fixture.body.length, fixture.length);
  const p = legacy(fixture.project), f = harness(p), page = pageFor(p, fixture.body);
  page.autonomousTurn.assistantSignals.visibilityState = fixture.visibility;
  await f.stable(page);
  assert.equal(f.counts.preparations, 1); assert.equal(f.current.phase, PHASES.SENDING);
  assert.equal(f.current.pendingPrompt.transportKind, SESSION_INITIALIZATION);
  assert.equal(f.current.sessionInitialization.workPrompt.text, work().text);
  assert.equal(f.current.sessionInitialization.legacyReceipt.responseHash, fixture.sha256);
  assert.match(f.current.pendingPrompt.text, /Do not repeat project opening/);
  const resumed = JSON.parse(JSON.stringify(f.current));
  assert.equal(expectedInitializationAck(resumed), f.current.sessionInitialization.acknowledgement.hash);
  const waiting = f.dispatchPending();
  const reply = pageFor(waiting, `${expectedInitializationAck(waiting)}Status: initierad`);
  await f.stable(reply);
  assert.deepEqual(f.current.queueContext, p.queueContext); assert.equal(f.current.pendingPrompt.text, work().text);
  assert.equal(f.current.pendingPrompt.hash, work().hash); assert.equal(f.current.turn, p.turn);
  assert.equal(f.counts.preparations, 1);
  assert.deepEqual(f.transitions, ['SESSION_INITIALIZATION_ACK_UPGRADED', 'SESSION_INITIALIZED_WORK_PROMPT_RELEASED']);
});

test('legacy upgrade refuses possibly sent work and unknown source dispatch', async () => {
  for (const change of [p => p.sessionInitialization.workPrompt.dispatch = { effectPossible: null },
    p => p.sessionInitialization.workPrompt.sendAttempts = 1, p => p.lastPrompt.acknowledged = false]) {
    const p = legacy(); change(p); const f = harness(p);
    await f.stable(pageFor(p, legacyReadyFixtures[0].body));
    assert.equal(f.counts.preparations, 0); assert.equal(f.counts.commits, 0);
    assert.ok(f.reasons.includes('SESSION_INITIALIZATION_LEGACY_EFFECT_UNPROVEN'));
  }
});

test('operator stop at the upgrade commit fence prevents preparing a send or releasing work', async () => {
  const p = legacy(), f = harness(p, { stopBeforeCommit: true });
  await f.stable(pageFor(p, legacyReadyFixtures[0].body));
  assert.equal(f.current.phase, PHASES.STOPPED); assert.equal(f.counts.commits, 0); assert.equal(f.counts.releases, 0);
});

test('late delivered acknowledgement suppresses a redundant Fortsätt and rejects a foreign hash', async () => {
  const p = await prepared(), hash = expectedInitializationAck(p);
  const delivered = runtime('sourceResponseAlreadyDelivered', background, { autonomousResponseObservation,
    responseContentAdmission: () => ({ admissible: true }), parseTargetResponse: () => ({ ok: false }),
    waitingForInitialization: transport.waitingForInitialization, initializationAcknowledged, expectedInitializationAck });
  assert.equal(delivered(p, pageFor(p, hash)), true);
  assert.equal(delivered(p, pageFor(p, 'READY')), false);
  assert.equal(delivered(p, pageFor(p, 'f'.repeat(64))), false);
  const continuation = { ...p, lastPrompt: dispatched({ text: 'Fortsätt', hash: 'continue', transportKind: DELIVERY_CONTINUATION }, 'continue-user'),
    deliveryRetry: { rootPrompt: p.lastPrompt } };
  assert.equal(expectedInitializationAck(continuation), hash);
  assert.equal(delivered(continuation, pageFor(continuation, hash)), true);
});

test('acknowledgement wait survives capacity reconciliation and does not send Fortsätt on a lingering timeout', async () => {
  const p = await prepared(), f = harness(p), page = pageFor(p, 'READY\nStatus: klar');
  await f.stable(page);
  const saved = JSON.parse(JSON.stringify(f.current));
  const descriptor = runtime('potentialActiveTurnDescriptor', background, { PHASES, TERMINAL_PHASES,
    normalizeGreenfieldPriority: x => x, DEFAULT_GREENFIELD_PRIORITY: 'NORMAL' });
  assert.equal(descriptor(saved), null, 'hydration must not reclaim the yielded slot');
  const delivered = runtime('sourceResponseAlreadyDelivered', background, { autonomousResponseObservation,
    responseContentAdmission: () => ({ admissible: true }), parseTargetResponse: () => ({ ok: false }),
    waitingForInitialization: transport.waitingForInitialization, initializationAcknowledged, expectedInitializationAck });
  assert.equal(delivered(saved, page), true, 'answer arrived, although it did not authorize work');
  assert.equal(initializationAcknowledged(page.autonomousTurn.assistantText, expectedInitializationAck(saved)), false);
  const timeout = runtime('maybeHandleDeliveryTimeout', background, { sourceResponseAlreadyDelivered: delivered });
  const result = await timeout(saved, { ...page, providerNotices: { deliveryTimeout: true } });
  assert.equal(result.handled, false); assert.equal(result.process.phase, 'WAITING');
});

test('renewed generation can readopt yielded capacity and clears the previous acknowledgement wait', async () => {
  const p = await prepared(), f = harness(p), page = pageFor(p, 'READY');
  await f.stable(page); let adopted = 0;
  const readopt = runtime('maybeReadoptStaleTurnCapacity', background, { PHASES,
    hasCurrentGenerationEvidence: () => true,
    saveObserved: async (p, patch) => ({ ...p, ...patch }),
    adoptSchedulerTurnForObservedEffect: async () => { adopted++; }, recordIncident: async () => {}, incidentPageEvidence: () => ({}) });
  const resumed = await readopt(f.current, { ...page, generating: true });
  assert.equal(adopted, 1); assert.equal(resumed.waitingRefresh.capacityReleased, null);
  const again = harness(resumed);
  await again.sample({ ...page, generating: true });
  assert.equal(again.current.sessionInitialization.ackWait, null);
  assert.equal(again.current.sessionInitialization.status, 'PENDING');
  assert.equal(again.current.responseCandidate, null);
});

test('generation resuming between samples restarts the full stability interval before accepting a hash', async () => {
  const p = await prepared(), f = harness(p), page = pageFor(p, expectedInitializationAck(p));
  await f.sample(page, 0); await f.sample(page, 1600);
  await f.sample({ ...page, generating: true }, 5000);
  assert.equal(f.current.responseCandidate, null);
  await f.sample(page, 1000); assert.equal(f.current.phase, PHASES.WAITING);
  await f.sample(page, 1600); assert.equal(f.current.phase, PHASES.WAITING);
  await f.sample(page, 1600); assert.equal(f.current.phase, PHASES.SENDING);
  assert.equal(f.counts.commits, 1);
});

test('an older pull reply cannot overwrite a newer sidepanel snapshot', async () => {
  const state = { windowId: 1, workerId: 'worker-one' }, pending = [];
  const snapshot = runtime('snapshot', panel, { state,
    chrome: { runtime: { sendMessage: () => new Promise(resolve => pending.push(resolve)) } }, render: async () => {}, $: () => ({}) });
  const old = snapshot(), fresh = snapshot();
  pending[1]({ ok: true, workerId: 'worker-one', process: { phase: 'SENDING' }, fleetStatus: { generatedAt: 'new' } }); await fresh;
  pending[0]({ ok: true, workerId: 'worker-one', process: { phase: 'WAITING' }, fleetStatus: { generatedAt: 'old' } }); await old;
  assert.equal(state.process.phase, 'SENDING'); assert.equal(state.fleetStatus.generatedAt, 'new');
});

test('a snapshot for a previous panel window is discarded', async () => {
  const state = { windowId: 1, workerId: 'one' }; let finish;
  const snapshot = runtime('snapshot', panel, { state,
    chrome: { runtime: { sendMessage: () => new Promise(resolve => finish = resolve) } }, render: async () => {}, $: () => ({}) });
  const pending = snapshot(); state.windowId = 2;
  finish({ ok: true, workerId: 'one', process: { windowId: 1 } }); await pending;
  assert.equal(state.process, undefined);
});

test('current-worker push supersedes an in-flight pull; foreign-worker push does not change this panel', async () => {
  const state = { windowId: 1, workerId: 'worker-one' }; let finish, listener;
  const chrome = { runtime: { sendMessage: () => new Promise(resolve => finish = resolve),
    onMessage: { addListener: callback => listener = callback } } };
  const deps = { state, chrome, render: async () => {}, renderAudit: async () => {}, $: () => ({}) };
  const start = panel.indexOf('chrome.runtime.onMessage.addListener((message) => {');
  const end = panel.indexOf('\n});', start) + 4;
  Function(...Object.keys(deps), panel.slice(start, end))(...Object.values(deps));
  const snapshot = runtime('snapshot', panel, deps), pending = snapshot();
  const requestId = state.snapshotRequestId;
  listener({ type: 'EIC_GF_SNAPSHOT_CHANGED', process: { workerId: 'foreign', windowId: 2, phase: 'WRONG' } });
  assert.equal(state.snapshotRequestId, requestId); assert.equal(state.process, undefined);
  listener({ type: 'EIC_GF_SNAPSHOT_CHANGED', process: { workerId: 'worker-one', windowId: 1, phase: 'SENDING' } });
  finish({ ok: true, workerId: 'worker-one', process: { phase: 'WAITING' } }); await pending;
  assert.equal(state.process.phase, 'SENDING');
});

test('fleet order is stable through two workers heartbeat changes and the rows retain their own queue', async () => {
  let rows = [worker('one'), worker('two')].map((p, i) =>
    ({ ...p, updatedAt: `2030-01-01T00:00:0${2 - i}.000Z` }));
  const deps = { chrome: { storage: { local: {}, session: {} } }, loadAllProcesses: async () => rows,
    loadMissionWorkQueue: async (windowId, _, { workerId }) => ({ enabled: true, activeItemId: workerId,
      items: [{ itemId: workerId, workerId, status: 'ACTIVE' }], history: [] }),
    publicMissionWorkQueue: x => x, publicSnapshot: x => x, QUEUE_STATUS: { READY: 'READY', PAUSED: 'PAUSED', BLOCKED: 'BLOCKED' },
    readGlobalPromptGate: async () => null, currentSchedulerSnapshot: async () => ({ scheduler: {} }), loadOperatorSettings: async () => ({}),
    nowIso: () => '', APP_VERSION: '1.9.17', runtimeFault: '', storageContractProof: {}, restartReport: {}, recoveryNoticeView: async report => report,
    readSafety: async () => ({}), dispatchWaitView: () => null, usageSummary: x => x, safetyVaultStatus: {}, driftVaultStatus: {}, storageHealth: async () => ({}),
    storageRetentionStatus: {}, TERMINAL_PHASES, PHASES, DEFAULT_MAX_ACTIVE_SESSIONS: 2 };
  const fleet = runtime('fleetStatusSnapshot', background, deps), first = await fleet();
  rows = rows.map((p, i) => ({ ...p, updatedAt: `2030-01-01T00:00:0${i + 1}.000Z` })).reverse();
  const second = await fleet();
  assert.deepEqual(first.workers.map(r => r.process.workerId), second.workers.map(r => r.process.workerId));
  for (const row of second.workers) assert.equal(row.queue.activeItem.workerId, row.process.workerId);
  assert.ok(panel.includes('Senast kontrollerad:')); assert.ok(panel.includes('detta fönster'));
});
