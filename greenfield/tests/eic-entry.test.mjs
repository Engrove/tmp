import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

// Optional baseline for the one recorded reproduction against immutable 1.9.16.
const root = process.env.GREENFIELD_ENTRY_PACKAGE_ROOT
  ? pathToFileURL(resolve(process.env.GREENFIELD_ENTRY_PACKAGE_ROOT) + '/') : new URL('../../', import.meta.url);
const M = await import(new URL('greenfield/lib/managed-eic-surface.mjs', root));
const { PHASES } = await import(new URL('greenfield/lib/contracts.mjs', root));
const { SESSION_ROTATION_STATES } = await import(new URL('greenfield/lib/session-rotation.mjs', root));
const background = await readFile(new URL('greenfield/background.js', root), 'utf8');
const expected = 'https://chatgpt.com/g/g-69e0b4be34308191aa6c05db1908be1b-eic';
const other = 'https://chatgpt.com/g/g-operatorchosen-eic';
const S = globalThis.GreenfieldSafetyPolicy;
const rotationPolicy = await import(new URL('greenfield/lib/rotation-timeout-policy.mjs', root));
const {readMissionOwnership, missionOwnershipKey, findDormantMissionRecoverySource} = await import(new URL('greenfield/lib/mission-ownership.mjs', root));
function storage(seed = {}) {
  const data = structuredClone(seed), writes = [];
  return { data, writes, get: async key => key == null ? structuredClone(data) : ({ [key]: structuredClone(data[key]) }),
    set: async value => { writes.push(structuredClone(value)); Object.assign(data, structuredClone(value)); } };
}
function runtime(name, deps) {
  const start = background.indexOf(`async function ${name}(`), end = background.indexOf('\n}\n', start) + 2;
  assert.ok(start >= 0 && end > start, `Actual runtime function ${name}`);
  return Function(...Object.keys(deps), background.slice(start, end) + `;return ${name};`)(...Object.values(deps));
}
function queueHarness({ seed = {}, url = 'https://chatgpt.com/', parkedRoot = '', priorRoot = '', samePriorMission = false, blockAt = 0 } = {}) {
  const local = storage(seed), navigation = [], bridgeCalls = [], saves = [], incidents = [];
  let current = null, boundaryCalls = 0;
  const tab = { id: 1, windowId: 2, url, status: 'complete' };
  const item = { itemId: 'item-original', savedMissionId: 'mission-original', goal: 'GF-1.71.1021', status: 'READY', maxInteractions: 5,
    ...(parkedRoot ? { processSnapshot: { gptRoot: parkedRoot } } : {}) };
  const queue = { queueId: 'queue-original', enabled: false, items: [item], activeItemId: '' };
  const deps = {
    ...M, ...rotationPolicy, readMissionOwnership, missionOwnershipKey, findDormantMissionRecoverySource, liveMissionWorkerIds: async () => [], PHASES, SESSION_ROTATION_STATES, Safety: S,
    chrome: { storage: { local }, tabs: { get: async () => tab, query: async () => [tab],
      update: async (id, patch) => { navigation.push({ id, ...patch }); return { ...tab, ...patch }; } } },
    supportedUrl: value => /^https:\/\/(chatgpt.com|chat.openai.com)(\/|$)/.test(value),
    queueActivationEffectBoundary: async () => ({ blocked: ++boundaryCalls === blockAt, code: 'OPERATOR_STOPPED' }),
    ensureContentBridgeVersion: async () => {},
    bridgeMessage: async (id, message) => {
      bridgeCalls.push(message.type);
      if (message.type === 'EIC_GF_GET_PAGE_STATE') return { ok: true, state: { url, modelEvidence: {
        gptSurface: { composerName: 'EIC', headerName: 'EIC', ambiguous: false } } } };
      if (message.type === 'EIC_GF_GPT_CONVERSATION_LINKS') return { ok: true, candidates: [] };
      throw new Error('Unexpected bridge effect: ' + message.type);
    },
    resolveSavedMissionReference: () => ({}), currentSavedMissions: async () => [],
    buildQueueActivationProcess: async args => ({ processId: 'process-original', runId: 'run-original', windowId: 2, tabId: 1,
      goal: item.goal, turn: 1, phase: PHASES.ROTATING, gptRoot: args.gptRoot,
      queueContext: { queueId: queue.queueId, itemId: item.itemId, savedMissionId: item.savedMissionId, interactionCount: 0 },
      sessionRotation: { rotationId: 'rotation-original', state: 'ARMED', gptRoot: args.gptRoot, hardReloadBeforeResume: false },
      pendingPrompt: { text: 'Synthetic held work prompt', hash: 'prompt-original' } }),
    BACKGROUND_AUDIT_SESSION_ID: 'audit', PROCESS_STATUS_REQUEST: 'FULL_NEXT_PROMPT', QUEUE_STATUS: { ACTIVE: 'ACTIVE', READY: 'READY' },
    nowIso: () => new Date().toISOString(), ensureMissionExecutionOwner: async () => ({ allowed: true }),
    saveProcess: async p => { current = structuredClone(p); saves.push(current); }, loadProcessForWindow: async () => current,
    persistMissionQueue: async q => structuredClone(q), recordIncident: async (...args) => incidents.push(args),
    setWatchdog: async () => {}, broadcast: async () => {}, scheduleFast: () => {}, audit: async () => {},
    invalidCapturedResponse: () => false, warmResumeTarget: () => '',
    saveRotationState: async (p, rotation) => ({ ...p, sessionRotation: rotation }),
    commitTransition: async (p, phase, patch) => ({ ...p, phase, ...patch }), errorRecord: e => ({ code: e.code }),
    tabMatchesGptRoot: (url, root) => !M.customGptRoot(url) || M.sameGpt(url, root)
  };
  deps.planEicRootDiscovery = runtime('planEicRootDiscovery', deps);
  return { local, navigation, bridgeCalls, saves, incidents, queue,
    activate: () => runtime('activateQueueItem', deps)({ queue, item, settings: {}, windowId: 2,
      priorProcess: priorRoot ? { tabId: 1, gptRoot: priorRoot,
        queueContext: { itemId: samePriorMission ? item.itemId : 'other-item', savedMissionId: samePriorMission ? item.savedMissionId : 'other-mission' } } : null }),
    rotate: p => runtime('tickRotating', deps)(p) };
}

test('empty-history queue startup binds EIC at generic URL without a probe prompt', async () => {
  const h = queueHarness(), result = await h.activate();
  assert.equal(result.process.gptRoot, expected);
  assert.equal(result.process.phase, PHASES.ROTATING);
  assert.equal(result.queue.enabled, true);
  assert.equal(result.queue.activeItemId, 'item-original');
  assert.equal(result.process.queueContext.savedMissionId, 'mission-original');
  assert.equal(result.process.pendingPrompt.hash, 'prompt-original');
  assert.equal(result.process.sessionRotation.eicDiscovery, undefined);
  assert.deepEqual(h.bridgeCalls, []);
  assert.deepEqual(h.navigation, []);
});

test('cold rotation navigates to the bound EIC target before any send', async () => {
  const h = queueHarness(), { process: p } = await h.activate(), next = await h.rotate(p);
  assert.deepEqual(h.navigation, [{ id: 1, url: expected }]);
  assert.equal(next.sessionRotation.state, 'NAVIGATING');
  assert.equal(next.gptRoot, expected);
  assert.equal(next.pendingPrompt.hash, p.pendingPrompt.hash);
  assert.deepEqual(h.bridgeCalls, []);
});

test('first read supplies a navigation default without forging observation or storage evidence', async () => {
  const local = storage(), state = await M.readEicSurfaceState(local);
  assert.equal(state.entryUrl, expected);
  assert.equal(state.entrySource, 'EIC_DISTRIBUTION_DEFAULT');
  assert.equal(state.lastKnownGoodEicUrl, '');
  assert.equal(state.updatedAt, '');
  assert.equal(local.writes.length, 0);
});

test('legacy observed root survives upgrade and outranks the distribution default', async () => {
  const h = queueHarness({ seed: { [M.EIC_SURFACE_STATE_KEY]: { lastKnownGoodEicUrl: other, updatedAt: 'original-time' } } });
  assert.equal((await h.activate()).process.gptRoot, other);
  const state = await M.readEicSurfaceState(h.local);
  assert.equal(state.entrySource, 'LAST_OBSERVED'); assert.equal(state.updatedAt, 'original-time');
});

test('operator target outranks incidental live GPT and old cache for a new binding', async () => {
  const h = queueHarness({ url: expected, seed: { [M.EIC_SURFACE_STATE_KEY]: { configuredEicUrl: other, lastKnownGoodEicUrl: expected } } });
  assert.equal((await h.activate()).process.gptRoot, other);
});

test('parked item retains its GPT instead of adopting the preceding slot or new configuration', async () => {
  const h = queueHarness({ parkedRoot: expected, priorRoot: other,
    seed: { [M.EIC_SURFACE_STATE_KEY]: { configuredEicUrl: other } } });
  assert.equal((await h.activate()).process.gptRoot, expected);
});

test('edited URL applies to an unbound mission even when the previous worker slot used another GPT', async () => {
  const h = queueHarness({ priorRoot: expected, seed: { [M.EIC_SURFACE_STATE_KEY]: { configuredEicUrl: other } } });
  assert.equal((await h.activate()).process.gptRoot, other);
});

test('restarting the same logical slot preserves its prior bound GPT', async () => {
  const h = queueHarness({ priorRoot: expected, samePriorMission: true,
    seed: { [M.EIC_SURFACE_STATE_KEY]: { configuredEicUrl: other } } });
  assert.equal((await h.activate()).process.gptRoot, expected);
});

for (const blockAt of [1, 2]) test(`queue ownership/operator boundary ${blockAt} still prevents publication`, async () => {
  const h = queueHarness({ blockAt }), result = await h.activate();
  assert.equal(result.blocked, true);
  assert.equal(h.saves.length, 0); assert.equal(h.navigation.length, 0);
});

test('valid GPT or conversation URL becomes a root without conversation data', () => {
  assert.equal(M.normalizeEicEntryUrl(expected + '/c/conv-123'), expected);
  assert.equal(M.normalizeEicEntryUrl(' ' + expected + '/ '), expected);
  assert.equal(M.normalizeEicEntryUrl('https://chat.openai.com/g/g-abc-eic'), 'https://chat.openai.com/g/g-abc-eic');
  assert.equal(M.normalizeEicEntryUrl('https://chatgpt.com/g/g-abc'), 'https://chatgpt.com/g/g-abc');
});

test('invalid and sensitive URL forms are refused without writes', async () => {
  const local = storage();
  for (const value of ['https://chatgpt.com/', 'https://chatgpt.com/c/abc', 'http://chatgpt.com/g/g-abc',
    'https://chatgpt.com.evil.invalid/g/g-abc', 'https://user:secret@chatgpt.com/g/g-abc',
    'https://chatgpt.com:444/g/g-abc', expected + '?token=secret', expected + '#secret',
    'https://chatgpt.com/g/g-p-abc-project', expected + '/edit', 'javascript:alert(1)', expected + '/c/x/extra']) {
    assert.equal(M.normalizeEicEntryUrl(value), '');
    await assert.rejects(M.configureEicEntryUrl(value, local), { code: 'EIC_ENTRY_URL_INVALID' });
  }
  assert.equal(local.writes.length, 0);
});

test('configuration persists across reads and concurrent observations cannot erase it', async () => {
  const local = storage();
  await Promise.all([M.configureEicEntryUrl(other + '/c/private-conversation', local, 1000), M.rememberGoodEicUrl(expected, local, 2000)]);
  const state = await M.readEicSurfaceState(local);
  assert.equal(state.entryUrl, other); assert.equal(state.lastKnownGoodEicUrl, expected);
  assert.equal(state.entrySource, 'OPERATOR_CONFIGURED');
  assert.doesNotMatch(JSON.stringify(local.data), /private-conversation/);
});

test('clearing override returns to observed target, while slugless observations preserve its name', async () => {
  const local = storage();
  await M.rememberGoodEicUrl(expected, local);
  await M.rememberGoodEicUrl(expected.replace(/-eic$/, '') + '/c/abc', local);
  await M.configureEicEntryUrl(other, local);
  assert.equal((await M.configureEicEntryUrl('', local)).entryUrl, expected);
});

test('only the actual operator panel may save entry configuration; save performs no navigation', async () => {
  const local = storage();
  const chrome = { storage: { local }, runtime: { id: 'extension', getURL: p => 'chrome-extension://extension/' + p } };
  const set = runtime('setEicEntryFromPanel', { chrome, configureEicEntryUrl: M.configureEicEntryUrl });
  for (const sender of [{ id: 'extension', tab: { id: 1 }, url: 'https://chatgpt.com/' },
    { id: 'other', url: chrome.runtime.getURL('sidepanel.html') }, { id: 'extension', url: chrome.runtime.getURL('content.js') }]) {
    await assert.rejects(set({ url: other }, sender), /OPERATOR_PANEL_REQUIRED/);
  }
  assert.equal(local.writes.length, 0);
  const result = await set({ url: other }, { id: 'extension', url: chrome.runtime.getURL('sidepanel.html') });
  assert.equal(result.eicSurface.entryUrl, other); assert.equal(local.writes.length, 1);
});

test('known target never proves ordinary ChatGPT, a wrong GPT or conflicting names safe', () => {
  for (const [url, surface] of [['https://chatgpt.com/', {}],
    [other, { composerName: 'EIC', headerName: 'EIC' }],
    ['https://chatgpt.com/', { composerName: 'EIC', headerName: 'Other' }],
    ['https://chatgpt.com/', { composerName: 'EIC', headerName: 'EIC', ambiguous: true }]]) {
    const evidence = { gptSurface: surface, source: 'CHATGPT_UI_CONTROLS_V2', observedAtMs: Date.now() };
    assert.equal(S.eicSurfaceProof(evidence, url, expected).ok, false);
    assert.equal(S.evaluateModel(evidence, S.defaults, { url, gptRoot: expected }).allowed, false);
  }
});

test('URL-less selected EIC is observable through existing DOM controls; body prose cannot impersonate it', async () => {
  // Reconstructed controls, NOT a captured DOM from the screenshots. The
  // screenshots establish labels and URL timing only, not selector accuracy.
  const dom = new JSDOM('<header><span>EIC</span><button aria-label="GPT-åtgärder">…</button></header><main><form><textarea></textarea><button aria-label="Ta bort EIC">EIC</button></form></main>',
    { url: 'https://chatgpt.com/', runScripts: 'outside-only' });
  try {
    const w = dom.window;
    w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 });
    w.eval(await readFile(new URL('greenfield/lib/safety-policy.js', root), 'utf8'));
    w.eval(await readFile(new URL('greenfield/lib/model-observation.js', root), 'utf8'));
    const surface = w.GreenfieldModelObservation.gptSurface();
    assert.equal(surface.composerName, 'EIC'); assert.equal(surface.headerName, 'EIC');
    assert.equal(w.GreenfieldSafetyPolicy.eicSurfaceProof({ gptSurface: surface }, w.location.href, expected).ok, true);
    w.document.body.innerHTML = '<article data-message-author-role="assistant"><span>EIC</span><button aria-label="GPT-åtgärder">…</button></article>';
    assert.equal(w.GreenfieldSafetyPolicy.eicSurfaceProof({ gptSurface: w.GreenfieldModelObservation.gptSurface() }, w.location.href, expected).ok, false);
  } finally { dom.window.close(); }
});
