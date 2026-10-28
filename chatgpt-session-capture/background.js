'use strict';

importScripts('lib/db.js', 'lib/sanitize.js', 'lib/turn-merge.js', 'lib/capture-core.js');

const ACTIVE_KEY = 'cgscActiveByTab';
const PROGRESS_KEY = 'cgscProgressByTab';
const SW_BOOT_TIME = Date.now();
const portsByTab = new Map();
const chunkAssemblies = new WeakMap();
const debuggerRequestMeta = new Map();
const sessionQueues = new Map();
const pendingRevocations = new Map();
const { sanitizeUrl, sanitizeHeaders } = CgscSanitize;
const conversationIdFromUrl = CgscCaptureCore.conversationIdFromUrl;
let creatingOffscreen = null;
let activeMapCache = null;
let activeLock = Promise.resolve();

function now() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomId(prefix = 'record') {
  return `${prefix}-${now()}-${crypto.randomUUID()}`;
}

// The active-capture map lives in chrome.storage.session so it survives a
// service-worker restart; it is cached in memory because every port and
// debugger event needs it. This worker is the only writer, so the cache is
// updated together with every write and never from storage events, which can
// arrive after a newer write.
async function getActiveMap() {
  if (!activeMapCache) {
    const result = await chrome.storage.session.get(ACTIVE_KEY);
    activeMapCache = activeMapCache || result[ACTIVE_KEY] || {};
  }
  return activeMapCache;
}

async function getActive(tabId) {
  const map = await getActiveMap();
  return map[String(tabId)] || null;
}

function setActive(tabId, info) {
  const run = activeLock.then(async () => {
    const map = { ...(await getActiveMap()) };
    if (info) map[String(tabId)] = info;
    else delete map[String(tabId)];
    activeMapCache = map;
    await chrome.storage.session.set({ [ACTIVE_KEY]: map });
    notifyPorts(tabId, info);
  });
  activeLock = run.catch(() => {});
  return run;
}

function notifyPorts(tabId, info) {
  for (const port of portsByTab.get(tabId) || []) {
    try {
      port.postMessage({
        type: 'capture-status',
        enabled: Boolean(info),
        sessionId: info?.sessionId || null,
        options: info?.options || {}
      });
    } catch (_) {
      // Port may have disconnected between iteration and send.
    }
  }
}

// Delivers the authoritative capture state to the tab even when no port is
// open (the content script reopens its port lazily).
async function syncTabState(tabId, info) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: 'SYNC_STATE',
      enabled: Boolean(info),
      sessionId: info?.sessionId || null,
      options: info?.options || {}
    });
  } catch (_) {
    return null;
  }
}

async function setProgress(tabId, progress) {
  const result = await chrome.storage.session.get(PROGRESS_KEY);
  const map = result[PROGRESS_KEY] || {};
  if (progress) map[String(tabId)] = progress;
  else delete map[String(tabId)];
  await chrome.storage.session.set({ [PROGRESS_KEY]: map });
}

async function getProgress(tabId) {
  const result = await chrome.storage.session.get(PROGRESS_KEY);
  return result[PROGRESS_KEY]?.[String(tabId)] || null;
}

function isSupportedUrl(url = '') {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ['chatgpt.com', 'chat.openai.com'].includes(parsed.hostname);
  } catch (_) {
    return false;
  }
}

// Writes for one capture session are serialized: the turn merge and the
// chunk assembly are read-modify-write operations.
function enqueueForSession(sessionId, task) {
  const previous = sessionQueues.get(sessionId) || Promise.resolve();
  const next = previous.then(task, task);
  sessionQueues.set(sessionId, next);
  const cleanup = () => {
    if (sessionQueues.get(sessionId) === next) sessionQueues.delete(sessionId);
  };
  next.then(cleanup, cleanup);
  return next;
}

async function flushSessionQueue(sessionId) {
  const pending = sessionQueues.get(sessionId);
  if (pending) await pending.catch(() => {});
}

function normalizeAndStore(sessionId, rawRecord) {
  if (!sessionId || !rawRecord) return Promise.resolve(null);
  return enqueueForSession(sessionId, () => storeRecord(sessionId, rawRecord));
}

async function storeRecord(sessionId, rawRecord) {
  const session = await CgscDB.getSession(sessionId);
  if (!session) return null;
  const includeSensitive = Boolean(session.options?.includeSensitive);
  const finalId = `${sessionId}:${rawRecord.id || randomId()}`;
  const existing = await CgscDB.getRecord(finalId);
  const record = {
    ...rawRecord,
    id: finalId,
    sourceRecordId: rawRecord.id || null,
    sessionId,
    kind: rawRecord.kind || 'unknown',
    capturedAt: rawRecord.capturedAt || now()
  };
  if (record.pageUrl) record.pageUrl = sanitizeUrl(record.pageUrl, includeSensitive);
  if (record.data && typeof record.data === 'object') {
    const mode = record.kind === 'conversation-turn' ? 'transcript' : 'evidence';
    record.data = CgscSanitize.sanitizeValue(record.data, includeSensitive, 'data', undefined, 0, mode);
  }
  if (record.kind === 'conversation-turn' && record.data) {
    record.data = CgscTurnMerge.mergeTurnData(existing?.data || null, record.data, {
      capturedAt: record.capturedAt,
      previousCapturedAt: existing?.capturedAt
    });
  }
  await CgscDB.putRecord(record);
  return record;
}

async function attachDebugger(tabId, sessionId) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (error) {
    if (!String(error).includes('Another debugger is already attached')) throw error;
    throw new Error('Chrome DevTools or another debugger is already attached to this tab. Close DevTools and retry deep capture.');
  }

  try {
    await chrome.debugger.sendCommand(target, 'Network.enable', {
      maxTotalBufferSize: 500 * 1024 * 1024,
      maxResourceBufferSize: 100 * 1024 * 1024,
      maxPostDataSize: 100 * 1024 * 1024
    });
    await chrome.debugger.sendCommand(target, 'Page.enable');
    await chrome.debugger.sendCommand(target, 'Runtime.enable');
    await chrome.debugger.sendCommand(target, 'Log.enable');
    await chrome.debugger.sendCommand(target, 'Performance.enable');
    try {
      await chrome.debugger.sendCommand(target, 'Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: [
          { type: 'iframe', exclude: false },
          { type: 'worker', exclude: false },
          { type: 'service_worker', exclude: false },
          { type: 'shared_worker', exclude: false }
        ]
      });
    } catch (error) {
      await normalizeAndStore(sessionId, {
        id: randomId('debugger-warning'),
        kind: 'debugger-warning',
        capturedAt: now(),
        data: { operation: 'Target.setAutoAttach', error: String(error) }
      });
    }
  } catch (error) {
    try { await chrome.debugger.detach(target); } catch (_) {}
    throw error;
  }

  await normalizeAndStore(sessionId, {
    id: randomId('debugger-attached'),
    kind: 'debugger-state',
    capturedAt: now(),
    data: { state: 'attached', protocolVersion: '1.3' }
  });
}

async function detachDebugger(tabId, sessionId, reason = 'stopped') {
  try {
    await chrome.debugger.detach({ tabId });
  } catch (error) {
    if (!/not attached|No tab with given id/i.test(String(error))) {
      await normalizeAndStore(sessionId, {
        id: randomId('debugger-detach-error'),
        kind: 'debugger-error',
        capturedAt: now(),
        data: { operation: 'detach', error: String(error) }
      });
    }
  }
  for (const key of debuggerRequestMeta.keys()) {
    if (key.startsWith(`${tabId}:`)) debuggerRequestMeta.delete(key);
  }
  if (sessionId) {
    await normalizeAndStore(sessionId, {
      id: randomId('debugger-detached'),
      kind: 'debugger-state',
      capturedAt: now(),
      data: { state: 'detached', reason }
    });
  }
}

async function startCapture(tab, options) {
  if (!tab?.id || !isSupportedUrl(tab.url)) {
    throw new Error('Open a ChatGPT conversation at chatgpt.com before starting capture.');
  }

  await ensureContentScripts(tab.id);

  const existing = await getActive(tab.id);
  if (existing) await stopCapture(tab.id, 'replaced-by-new-capture');

  const sessionId = crypto.randomUUID();
  const aggressiveRuntime = Boolean(options.aggressiveRuntime);
  const normalizedOptions = {
    deepNetwork: Boolean(options.deepNetwork),
    pageNetwork: Boolean(options.pageNetwork),
    reloadAfterStart: Boolean(options.reloadAfterStart),
    includeStorage: Boolean(options.includeStorage),
    includeSensitive: Boolean(options.includeSensitive),
    captureRuntime: Boolean(options.captureRuntime || aggressiveRuntime),
    aggressiveRuntime,
    expandDetails: options.expandDetails !== false,
    settleMs: Math.max(250, Math.min(5000, Number(options.settleMs) || 1000))
  };
  const captureProfile = (
    normalizedOptions.deepNetwork ||
    normalizedOptions.pageNetwork ||
    normalizedOptions.includeStorage ||
    normalizedOptions.captureRuntime ||
    normalizedOptions.aggressiveRuntime
  ) ? 'browser-evidence' : 'ai-transcript';
  normalizedOptions.captureProfile = captureProfile;

  const session = {
    id: sessionId,
    tabId: tab.id,
    title: tab.title || 'ChatGPT session',
    startUrl: tab.url,
    currentUrl: tab.url,
    conversationId: conversationIdFromUrl(tab.url),
    startedAt: now(),
    updatedAt: now(),
    stoppedAt: null,
    status: 'active',
    recordCount: 0,
    captureProfile,
    options: normalizedOptions,
    extensionVersion: chrome.runtime.getManifest().version,
    userAgent: options.userAgent || null
  };
  await CgscDB.putSession(session);

  const activeInfo = { sessionId, options: session.options, startedAt: session.startedAt };
  await setActive(tab.id, activeInfo);
  await setProgress(tab.id, null);

  await normalizeAndStore(sessionId, {
    id: randomId('capture-start'),
    kind: 'capture-lifecycle',
    capturedAt: now(),
    data: { state: 'started', tabId: tab.id, url: tab.url, title: tab.title, conversationId: session.conversationId, options: session.options }
  });

  try {
    const synced = await syncTabState(tab.id, activeInfo);
    if (!synced?.ok || synced.sessionId !== sessionId) {
      throw new Error('The ChatGPT tab did not confirm the new capture state.');
    }
    if (session.options.deepNetwork) await attachDebugger(tab.id, sessionId);
    if (session.options.reloadAfterStart) {
      if (session.options.deepNetwork) {
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.reload', { ignoreCache: false });
      } else {
        await chrome.tabs.reload(tab.id, { bypassCache: false });
      }
    }
  } catch (error) {
    await setActive(tab.id, null);
    await syncTabState(tab.id, null);
    if (session.options.deepNetwork) await detachDebugger(tab.id, sessionId, 'start-failed');
    await flushSessionQueue(sessionId);
    const failed = { ...(await CgscDB.getSession(sessionId)), status: 'failed', stoppedAt: now(), updatedAt: now(), error: String(error) };
    await CgscDB.putSession(failed);
    throw error;
  }

  return session;
}

async function stopCapture(tabId, reason = 'user') {
  const active = await getActive(tabId);
  if (!active) return null;
  await setActive(tabId, null);
  // The content script aborts a running sweep as soon as it learns that the
  // capture is no longer active, so a stopped capture never ends with a
  // partially transmitted sweep that reports itself complete.
  await syncTabState(tabId, null);
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ABORT_SWEEP', reason: `capture-stopped:${reason}` });
  } catch (_) {}
  if (active.options?.deepNetwork) await detachDebugger(tabId, active.sessionId, reason);
  await normalizeAndStore(active.sessionId, {
    id: randomId('capture-stop'),
    kind: 'capture-lifecycle',
    capturedAt: now(),
    data: { state: 'stopped', reason }
  });
  await flushSessionQueue(active.sessionId);
  const session = await CgscDB.getSession(active.sessionId);
  if (session) {
    const count = await CgscDB.countRecords(active.sessionId);
    const updated = {
      ...session,
      status: 'stopped',
      stoppedAt: now(),
      updatedAt: now(),
      recordCount: count,
      stopReason: reason
    };
    await CgscDB.putSession(updated);
    return updated;
  }
  return null;
}

// Sessions left 'active' by a browser restart or an extension reload (both
// clear chrome.storage.session) are marked as interrupted.
async function reconcileOrphanedSessions() {
  const map = await getActiveMap();
  for (const tabId of Object.keys(map)) {
    try {
      await chrome.tabs.get(Number(tabId));
    } catch (_) {
      await stopCapture(Number(tabId), 'tab-missing');
    }
  }
  const activeIds = new Set(Object.values(await getActiveMap()).map((info) => info.sessionId));
  for (const session of await CgscDB.listSessions()) {
    if (session.status === 'active' && !activeIds.has(session.id) && (session.startedAt || 0) < SW_BOOT_TIME) {
      await CgscDB.putSession({
        ...session,
        status: 'interrupted',
        stoppedAt: session.stoppedAt || session.updatedAt || now(),
        stopReason: 'extension-reloaded-or-browser-restarted',
        updatedAt: now()
      });
    }
  }
}

const reconciled = reconcileOrphanedSessions().catch((error) => console.warn('[CGSC] Session reconciliation failed', error));

async function getStatus(tabId) {
  const active = tabId ? await getActive(tabId) : null;
  const current = active ? await CgscDB.getSession(active.sessionId) : null;
  const latest = current || (tabId ? await CgscDB.getLatestSessionForTab(tabId) : null);
  const count = latest ? await CgscDB.countRecords(latest.id) : 0;
  const ping = tabId ? await pingContentScript(tabId) : null;
  return {
    active: Boolean(active),
    activeInfo: active,
    session: latest ? { ...latest, recordCount: count } : null,
    contentReady: Boolean(ping),
    sweepRunning: Boolean(ping?.sweepRunning),
    progress: tabId ? await getProgress(tabId) : null
  };
}

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING_CONTENT' });
    return response?.ok ? response : null;
  } catch (_) {
    return null;
  }
}

async function injectContentScripts(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isSupportedUrl(tab?.url || '')) {
    throw new Error('The active tab is no longer a supported ChatGPT page.');
  }

  // MAIN is required only for optional page/runtime evidence, but installing it
  // here keeps the bridge complete when the extension was loaded after the tab.
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: ['main-hook.js'],
    injectImmediately: true
  });

  // capture-core must execute before bridge in the same isolated world.
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    files: ['lib/capture-core.js', 'bridge.js'],
    injectImmediately: true
  });
}

async function ensureContentScripts(tabId, attempts = 12, delayMs = 250) {
  const existing = await pingContentScript(tabId);
  if (existing) return { ...existing, injected: false };

  try {
    await injectContentScripts(tabId);
  } catch (error) {
    throw new Error(`Could not inject the ChatGPT capture scripts into the tab: ${error}`);
  }

  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'PING_CONTENT' });
      if (response?.ok) return { ...response, injected: true };
      lastError = new Error('PING_CONTENT returned no valid response.');
    } catch (error) {
      lastError = error;
    }
    await sleep(delayMs);
  }

  throw new Error(`Injected content scripts did not become ready: ${lastError || 'unknown error'}`);
}

const NOT_DELIVERED = /Receiving end does not exist|Could not establish connection|did not become ready|Could not inject/i;

// Retries only while the message could not be delivered. A delivered message
// whose response channel closed (for example after a navigation) is not
// re-sent, because RUN_SWEEP and CAPTURE_PAGE_STATE are not idempotent.
async function sendToTabWithRetry(tabId, message, attempts = 40, delayMs = 500) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await ensureContentScripts(tabId);
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response) return response;
      lastError = new Error('Content script returned no response.');
    } catch (error) {
      lastError = error;
      if (!NOT_DELIVERED.test(String(error))) throw error;
    }
    await sleep(delayMs);
  }
  throw new Error(`Content script did not respond after automatic reinjection: ${lastError || 'unknown error'}`);
}

async function captureRequestFor(tabId) {
  const active = await getActive(tabId);
  if (!active) throw new Error('Capture is not active for this tab.');
  const session = await CgscDB.getSession(active.sessionId);
  if (!session) throw new Error('The active capture session no longer exists.');
  const tab = await chrome.tabs.get(tabId);
  const currentConversationId = conversationIdFromUrl(tab.url);
  if (session.conversationId && currentConversationId !== session.conversationId) {
    throw new Error(`The tab now shows conversation ${currentConversationId || '(none)'}, but this capture belongs to ${session.conversationId}. Stop it and start a new capture for the current conversation.`);
  }
  if (!session.conversationId && currentConversationId) {
    await CgscDB.putSession({ ...session, conversationId: currentConversationId, updatedAt: now() });
  }
  return {
    active,
    request: {
      sessionId: active.sessionId,
      options: active.options || {},
      expectedConversationId: session.conversationId || currentConversationId || null
    }
  };
}

async function runFullCapture(tabId) {
  const { active, request } = await captureRequestFor(tabId);

  let pageState = { ok: true, skipped: true, result: { skipped: true, capturedKinds: [] } };
  if (active.options?.includeStorage || active.options?.captureRuntime) {
    pageState = await sendToTabWithRetry(tabId, { type: 'CAPTURE_PAGE_STATE', ...request });
    if (!pageState?.ok) throw new Error(pageState?.error || 'Optional page-state capture failed.');
  }

  const sweep = await sendToTabWithRetry(tabId, { type: 'RUN_SWEEP', ...request }, 5, 1000);
  if (!sweep?.ok) throw new Error(sweep?.error || 'Virtualization sweep failed.');

  const debuggerSnapshots = active.options?.deepNetwork
    ? await captureDebuggerSnapshots(tabId, active.sessionId)
    : { ok: true, skipped: true, reason: 'deep-debugger-disabled' };
  await flushSessionQueue(active.sessionId);
  const session = await CgscDB.getSession(active.sessionId);
  if (session) {
    await CgscDB.putSession({
      ...session,
      lastFullCaptureAt: now(),
      updatedAt: now(),
      fullCaptureResult: {
        pageState: pageState.result || pageState,
        sweep: sweep.result || null,
        debuggerSnapshots
      }
    });
  }
  return { pageState, sweep, debuggerSnapshots };
}

async function captureDebuggerSnapshots(tabId, sessionId) {
  const active = await getActive(tabId);
  if (!active || active.sessionId !== sessionId || !active.options?.deepNetwork) {
    return { ok: false, skipped: true, reason: 'deep-debugger-not-active' };
  }
  const target = { tabId };
  const results = {};

  async function command(kind, method, params = undefined) {
    try {
      const result = await chrome.debugger.sendCommand(target, method, params);
      await normalizeAndStore(sessionId, {
        id: randomId(kind),
        kind,
        capturedAt: now(),
        data: { method, result }
      });
      results[method] = 'ok';
    } catch (error) {
      await normalizeAndStore(sessionId, {
        id: randomId(`${kind}-error`),
        kind: `${kind}-error`,
        capturedAt: now(),
        data: { method, error: String(error), stack: error?.stack || null }
      });
      results[method] = String(error);
    }
  }

  await command('debugger-dom-snapshot', 'DOMSnapshot.captureSnapshot', {
    computedStyles: [],
    includePaintOrder: true,
    includeDOMRects: true,
    includeBlendedBackgroundColors: false,
    includeTextColorOpacities: false
  });
  await command('debugger-accessibility-tree', 'Accessibility.getFullAXTree', {});
  await command('debugger-performance-metrics', 'Performance.getMetrics', {});
  await command('debugger-layout-metrics', 'Page.getLayoutMetrics', {});
  await command('debugger-frame-tree', 'Page.getFrameTree', {});
  await command('debugger-navigation-history', 'Page.getNavigationHistory', {});
  if (active.options.includeSensitive) {
    await command('debugger-mhtml-snapshot', 'Page.captureSnapshot', { format: 'mhtml' });
  } else {
    // MHTML is a byte-exact page archive; redacting URLs inside it would
    // corrupt its quoted-printable encoding, so it is only captured when
    // sensitive capture is enabled.
    await normalizeAndStore(sessionId, {
      id: randomId('debugger-mhtml-snapshot-skipped'),
      kind: 'debugger-mhtml-snapshot-skipped',
      capturedAt: now(),
      data: { method: 'Page.captureSnapshot', reason: 'MHTML cannot be redacted without corrupting it; enable sensitive capture to include it.' }
    });
    results['Page.captureSnapshot'] = 'skipped: sensitive capture disabled';
  }

  return { ok: true, results };
}

async function updateSessionUrl(tabId, changeInfo, tab) {
  const active = await getActive(tabId);
  if (!active) return;
  const session = await CgscDB.getSession(active.sessionId);
  if (!session) return;
  const url = changeInfo.url || tab?.url || session.currentUrl;
  await CgscDB.putSession({
    ...session,
    currentUrl: url,
    title: tab?.title || session.title,
    updatedAt: now()
  });
  if (changeInfo.url) {
    const conversationId = conversationIdFromUrl(changeInfo.url);
    await normalizeAndStore(active.sessionId, {
      id: randomId('tab-navigation'),
      kind: 'tab-navigation',
      capturedAt: now(),
      data: {
        url: changeInfo.url,
        conversationId,
        captureConversationId: session.conversationId || null,
        conversationChanged: Boolean(session.conversationId && conversationId !== session.conversationId)
      }
    });
  }
}

function portSession(port) {
  return chunkAssemblies.get(port) || new Map();
}

async function recordPortError(tabId, operation, details) {
  const active = await getActive(tabId);
  if (!active) return;
  await normalizeAndStore(active.sessionId, {
    id: randomId('bridge-transport-error'),
    kind: 'bridge-transport-error',
    capturedAt: now(),
    data: { operation, ...details }
  });
}

async function storeFromPort(tabId, sessionId, record) {
  await normalizeAndStore(sessionId, record);
  if (record?.kind === 'sweep-progress' && record.data) {
    const data = record.data;
    await setProgress(tabId, {
      sessionId,
      stage: data.stage,
      sweepRunId: data.sweepRunId || null,
      round: data.round ?? null,
      scanIndex: data.scanIndex ?? null,
      uniqueTurns: data.uniqueTurnsSoFar ?? data.uniqueTurnCount ?? null,
      reason: data.reason || null,
      at: now()
    });
  }
}

async function handlePortMessage(port, tabId, message) {
  const active = await getActive(tabId);
  if (!active) return;
  if (message?.sessionId && message.sessionId !== active.sessionId) return;

  if (message.type === 'hello') {
    port.postMessage({ type: 'capture-status', enabled: true, sessionId: active.sessionId, options: active.options || {} });
    return;
  }
  if (message.type === 'record-json') {
    await storeFromPort(tabId, active.sessionId, JSON.parse(message.json));
    return;
  }
  if (message.type === 'record') {
    await storeFromPort(tabId, active.sessionId, message.record);
    return;
  }
  const assemblies = portSession(port);
  if (message.type === 'record-begin') {
    assemblies.set(message.transferId, {
      sessionId: active.sessionId,
      chunkCount: message.chunkCount,
      charLength: message.charLength,
      chunks: new Array(message.chunkCount),
      received: 0
    });
    return;
  }
  if (message.type === 'record-chunk') {
    const assembly = assemblies.get(message.transferId);
    if (!assembly) {
      await recordPortError(tabId, 'chunk-without-begin', { transferId: message.transferId, index: message.index });
      return;
    }
    if (assembly.chunks[message.index] !== undefined) return;
    assembly.chunks[message.index] = message.data;
    assembly.received += 1;
    return;
  }
  if (message.type === 'record-end') {
    const assembly = assemblies.get(message.transferId);
    if (!assembly) {
      // The begin message was processed by a previous service-worker instance.
      await recordPortError(tabId, 'end-without-begin', { transferId: message.transferId });
      return;
    }
    assemblies.delete(message.transferId);
    if (assembly.received !== assembly.chunkCount) {
      await normalizeAndStore(active.sessionId, {
        id: randomId('chunk-error'),
        kind: 'bridge-chunk-error',
        capturedAt: now(),
        data: { transferId: message.transferId, expected: assembly.chunkCount, received: assembly.received }
      });
      return;
    }
    await storeFromPort(tabId, active.sessionId, JSON.parse(assembly.chunks.join('')));
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cgsc-stream' || !port.sender?.tab?.id) return;
  const tabId = port.sender.tab.id;
  if (!portsByTab.has(tabId)) portsByTab.set(tabId, new Set());
  portsByTab.get(tabId).add(port);
  chunkAssemblies.set(port, new Map());

  getActive(tabId).then((active) => {
    port.postMessage({
      type: 'capture-status',
      enabled: Boolean(active),
      sessionId: active?.sessionId || null,
      options: active?.options || {}
    });
  }).catch(() => {});

  // Messages of one port are handled strictly in arrival order so that
  // record-begin, record-chunk and record-end can never be reordered.
  let queue = Promise.resolve();
  port.onMessage.addListener((message) => {
    queue = queue
      .then(() => handlePortMessage(port, tabId, message))
      .catch((error) => recordPortError(tabId, 'port-message', { error: String(error), stack: error?.stack || null }).catch(() => {}));
  });

  port.onDisconnect.addListener(() => {
    portsByTab.get(tabId)?.delete(port);
    if (portsByTab.get(tabId)?.size === 0) portsByTab.delete(tabId);
    chunkAssemblies.delete(port);
  });
});

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const tabId = source.tabId;
  if (!tabId) return;
  const active = await getActive(tabId);
  if (!active || !active.options?.deepNetwork) return;
  const sessionId = active.sessionId;
  const includeSensitive = Boolean(active.options.includeSensitive);

  try {
    if (method === 'Target.attachedToTarget' && params.sessionId) {
      const child = { tabId, sessionId: params.sessionId };
      const commands = [
        ['Runtime.enable'],
        ['Network.enable', {
          maxTotalBufferSize: 200 * 1024 * 1024,
          maxResourceBufferSize: 50 * 1024 * 1024,
          maxPostDataSize: 50 * 1024 * 1024
        }],
        ['Log.enable']
      ];
      const commandResults = [];
      for (const [childMethod, childParams] of commands) {
        try {
          await chrome.debugger.sendCommand(child, childMethod, childParams);
          commandResults.push({ method: childMethod, ok: true });
        } catch (error) {
          commandResults.push({ method: childMethod, ok: false, error: String(error) });
        }
      }
      try {
        await chrome.debugger.sendCommand(child, 'Target.setAutoAttach', {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true
        });
      } catch (_) {}
      await normalizeAndStore(sessionId, {
        id: randomId('cdp-target-attached'),
        kind: 'cdp-target-attached',
        capturedAt: now(),
        data: { targetInfo: params.targetInfo, waitingForDebugger: params.waitingForDebugger, commandResults }
      });
      return;
    }

    if (method === 'Network.requestWillBeSent') {
      debuggerRequestMeta.set(`${tabId}:${params.requestId}`, {
        url: params.request.url,
        method: params.request.method,
        type: params.type,
        loaderId: params.loaderId,
        frameId: params.frameId,
        documentURL: params.documentURL,
        timestamp: params.timestamp
      });
      await normalizeAndStore(sessionId, {
        id: `cdp-request-${params.requestId}-${params.timestamp}`,
        kind: 'cdp-network-request',
        capturedAt: now(),
        data: {
          requestId: params.requestId,
          loaderId: params.loaderId,
          frameId: params.frameId,
          documentURL: sanitizeUrl(params.documentURL, includeSensitive),
          type: params.type,
          initiator: params.initiator,
          redirectResponse: params.redirectResponse || null,
          request: {
            url: sanitizeUrl(params.request.url, includeSensitive),
            method: params.request.method,
            headers: sanitizeHeaders(params.request.headers, includeSensitive),
            postData: params.request.postData || null,
            hasPostData: params.request.hasPostData,
            mixedContentType: params.request.mixedContentType,
            initialPriority: params.request.initialPriority,
            referrerPolicy: params.request.referrerPolicy
          },
          wallTime: params.wallTime,
          timestamp: params.timestamp
        }
      });
      return;
    }

    if (method === 'Network.requestWillBeSentExtraInfo') {
      await normalizeAndStore(sessionId, {
        id: `cdp-request-extra-${params.requestId}-${now()}`,
        kind: 'cdp-network-request-extra-info',
        capturedAt: now(),
        data: {
          requestId: params.requestId,
          headers: sanitizeHeaders(params.headers, includeSensitive),
          associatedCookies: includeSensitive ? params.associatedCookies : '[not captured: includeSensitive=false]',
          clientSecurityState: params.clientSecurityState,
          connectTiming: params.connectTiming,
          siteHasCookieInOtherPartition: params.siteHasCookieInOtherPartition
        }
      });
      return;
    }

    if (method === 'Network.responseReceived') {
      await normalizeAndStore(sessionId, {
        id: `cdp-response-${params.requestId}-${params.timestamp}`,
        kind: 'cdp-network-response',
        capturedAt: now(),
        data: {
          requestId: params.requestId,
          loaderId: params.loaderId,
          frameId: params.frameId,
          type: params.type,
          hasExtraInfo: params.hasExtraInfo,
          response: {
            url: sanitizeUrl(params.response.url, includeSensitive),
            status: params.response.status,
            statusText: params.response.statusText,
            headers: sanitizeHeaders(params.response.headers, includeSensitive),
            mimeType: params.response.mimeType,
            charset: params.response.charset,
            connectionReused: params.response.connectionReused,
            connectionId: params.response.connectionId,
            remoteIPAddress: params.response.remoteIPAddress,
            remotePort: params.response.remotePort,
            fromDiskCache: params.response.fromDiskCache,
            fromServiceWorker: params.response.fromServiceWorker,
            fromPrefetchCache: params.response.fromPrefetchCache,
            encodedDataLength: params.response.encodedDataLength,
            protocol: params.response.protocol,
            securityState: params.response.securityState,
            securityDetails: params.response.securityDetails || null,
            timing: params.response.timing || null
          },
          timestamp: params.timestamp
        }
      });
      return;
    }

    if (method === 'Network.responseReceivedExtraInfo') {
      await normalizeAndStore(sessionId, {
        id: `cdp-response-extra-${params.requestId}-${now()}`,
        kind: 'cdp-network-response-extra-info',
        capturedAt: now(),
        data: {
          requestId: params.requestId,
          statusCode: params.statusCode,
          headers: sanitizeHeaders(params.headers, includeSensitive),
          blockedCookies: includeSensitive ? params.blockedCookies : '[not captured: includeSensitive=false]',
          resourceIPAddressSpace: params.resourceIPAddressSpace,
          cookiePartitionKey: includeSensitive ? params.cookiePartitionKey : '[not captured: includeSensitive=false]'
        }
      });
      return;
    }

    if (method === 'Network.loadingFinished') {
      let bodyResult;
      try {
        bodyResult = await chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId });
      } catch (error) {
        bodyResult = { captureError: String(error), body: null, base64Encoded: false };
      }
      const meta = debuggerRequestMeta.get(`${tabId}:${params.requestId}`) || null;
      debuggerRequestMeta.delete(`${tabId}:${params.requestId}`);
      await normalizeAndStore(sessionId, {
        id: `cdp-body-${params.requestId}-${params.timestamp}`,
        kind: 'cdp-network-response-body',
        capturedAt: now(),
        data: {
          requestId: params.requestId,
          encodedDataLength: params.encodedDataLength,
          shouldReportCorbBlocking: params.shouldReportCorbBlocking,
          timestamp: params.timestamp,
          requestMeta: meta,
          body: bodyResult
        }
      });
      return;
    }

    if (method === 'Network.loadingFailed') {
      debuggerRequestMeta.delete(`${tabId}:${params.requestId}`);
      await normalizeAndStore(sessionId, {
        id: `cdp-loading-failed-${params.requestId}-${params.timestamp}`,
        kind: 'cdp-network-loading-failed',
        capturedAt: now(),
        data: params
      });
      return;
    }

    if (method.startsWith('Network.webSocket')) {
      await normalizeAndStore(sessionId, {
        id: randomId(`cdp-${method.replaceAll('.', '-')}`),
        kind: `cdp-${method.replaceAll('.', '-').toLowerCase()}`,
        capturedAt: now(),
        data: params
      });
      return;
    }

    if (method === 'Network.eventSourceMessageReceived') {
      await normalizeAndStore(sessionId, {
        id: randomId('cdp-eventsource-message'),
        kind: 'cdp-eventsource-message',
        capturedAt: now(),
        data: params
      });
      return;
    }

    if (method === 'Runtime.consoleAPICalled' || method === 'Runtime.exceptionThrown' || method === 'Log.entryAdded') {
      await normalizeAndStore(sessionId, {
        id: randomId(`cdp-${method.replaceAll('.', '-')}`),
        kind: `cdp-${method.replaceAll('.', '-').toLowerCase()}`,
        capturedAt: now(),
        data: params
      });
      return;
    }

    if (method === 'Page.frameNavigated' || method === 'Page.navigatedWithinDocument' || method === 'Page.lifecycleEvent') {
      await normalizeAndStore(sessionId, {
        id: randomId(`cdp-${method.replaceAll('.', '-')}`),
        kind: `cdp-${method.replaceAll('.', '-').toLowerCase()}`,
        capturedAt: now(),
        data: params
      });
    }
  } catch (error) {
    await normalizeAndStore(sessionId, {
      id: randomId('debugger-event-error'),
      kind: 'debugger-error',
      capturedAt: now(),
      data: { method, error: String(error), stack: error?.stack || null }
    });
  }
});

chrome.debugger.onDetach.addListener(async (source, reason) => {
  if (!source.tabId) return;
  const active = await getActive(source.tabId);
  if (!active) return;
  await normalizeAndStore(active.sessionId, {
    id: randomId('debugger-unexpected-detach'),
    kind: 'debugger-state',
    capturedAt: now(),
    data: { state: 'detached', reason, unexpected: true }
  });
  const session = await CgscDB.getSession(active.sessionId);
  if (session) await CgscDB.putSession({ ...session, debuggerDetached: true, debuggerDetachReason: reason, updatedAt: now() });
});

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL('offscreen.html');
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url]
  });
  if (existing.length) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS', 'DOM_PARSER'],
    justification: 'Build a local ZIP archive from captured browser data.'
  }).finally(() => { creatingOffscreen = null; });
  return creatingOffscreen;
}

function revokeExportUrl(blobUrl) {
  return chrome.runtime.sendMessage({ type: 'OFFSCREEN_REVOKE_URL', target: 'offscreen', blobUrl }).catch(() => {});
}

function exportFilename(session) {
  const safeTitle = (session.title || 'chatgpt-session')
    .replace(/[<>:"/\\|?*\x00-\x1F\x7F]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s_~-]+/, '')
    .trim()
    .slice(0, 100)
    .replace(/[.\s]+$/, '') || 'chatgpt-session';
  const reserved = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(safeTitle) ? `${safeTitle}_` : safeTitle;
  return `${reserved}-${new Date(session.startedAt).toISOString().replace(/[:.]/g, '-')}.zip`;
}

async function exportSession(sessionId) {
  const session = await CgscDB.getSession(sessionId);
  if (!session) throw new Error('Capture session not found.');
  await flushSessionQueue(sessionId);
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_EXPORT', target: 'offscreen', sessionId });
  if (!response?.ok || !response.blobUrl) throw new Error(response?.error || 'Offscreen export failed.');
  const filename = exportFilename(session);
  let downloadId = null;
  try {
    downloadId = await chrome.downloads.download({ url: response.blobUrl, filename, saveAs: true, conflictAction: 'uniquify' });
    pendingRevocations.set(downloadId, response.blobUrl);
  } catch (error) {
    const fallback = await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_DIRECT_DOWNLOAD',
      target: 'offscreen',
      blobUrl: response.blobUrl,
      filename
    });
    if (!fallback?.ok) throw new Error(`Download failed: ${error}; fallback failed: ${fallback?.error || 'unknown'}`);
  }
  return { downloadId, filename, size: response.size || null, summary: response.summary || null };
}

// The ZIP's object URL is released when its download finishes; the offscreen
// document also releases it after a timeout if this worker was stopped.
chrome.downloads.onChanged.addListener((delta) => {
  const blobUrl = pendingRevocations.get(delta.id);
  const state = delta.state?.current;
  if (!blobUrl || (state !== 'complete' && state !== 'interrupted')) return;
  pendingRevocations.delete(delta.id);
  revokeExportUrl(blobUrl);
});

function isExtensionPage(sender) {
  return sender?.id === chrome.runtime.id && String(sender?.url || '').startsWith(chrome.runtime.getURL(''));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'offscreen') return false;
  (async () => {
    if (!message) return { ok: false, error: 'Empty message' };
    // Control messages are accepted only from the extension's own pages, not
    // from content scripts running inside chatgpt.com.
    if (!isExtensionPage(sender)) return { ok: false, error: 'Control messages are accepted only from extension pages.' };
    await reconciled;

    if (message.type === 'GET_STATUS') {
      return { ok: true, status: await getStatus(message.tabId) };
    }
    if (message.type === 'START_CAPTURE') {
      const tab = await chrome.tabs.get(message.tabId);
      return { ok: true, session: await startCapture(tab, message.options || {}) };
    }
    if (message.type === 'STOP_CAPTURE') {
      return { ok: true, session: await stopCapture(message.tabId, 'user') };
    }
    if (message.type === 'CAPTURE_PAGE_STATE') {
      const { request } = await captureRequestFor(message.tabId);
      const result = await sendToTabWithRetry(message.tabId, { type: 'CAPTURE_PAGE_STATE', ...request }, 8, 500);
      if (!result?.ok) throw new Error(result?.error || 'Optional page-state capture failed.');
      return { ok: true, result: result.result || result };
    }
    if (message.type === 'CAPTURE_DEBUGGER_SNAPSHOTS') {
      const sessionId = message.sessionId || (await getActive(message.tabId))?.sessionId;
      return { ok: true, result: await captureDebuggerSnapshots(message.tabId, sessionId) };
    }
    if (message.type === 'RUN_FULL_CAPTURE') {
      return { ok: true, result: await runFullCapture(message.tabId) };
    }
    if (message.type === 'EXPORT_SESSION') {
      return { ok: true, result: await exportSession(message.sessionId) };
    }
    if (message.type === 'LIST_SESSIONS') {
      return { ok: true, sessions: await CgscDB.listSessions() };
    }
    if (message.type === 'DELETE_SESSION') {
      const session = await CgscDB.getSession(message.sessionId);
      if (session && (await getActive(session.tabId))?.sessionId === session.id) await stopCapture(session.tabId, 'deleted');
      await flushSessionQueue(message.sessionId);
      await CgscDB.deleteSession(message.sessionId);
      return { ok: true };
    }
    if (message.type === 'CLEAR_ALL') {
      for (const tabId of Object.keys(await getActiveMap())) await stopCapture(Number(tabId), 'clear-all');
      for (const sessionId of [...sessionQueues.keys()]) await flushSessionQueue(sessionId);
      await activeLock;
      activeMapCache = {};
      await chrome.storage.session.set({ [ACTIVE_KEY]: {}, [PROGRESS_KEY]: {} });
      await CgscDB.clearAll();
      return { ok: true };
    }
    return { ok: false, error: `Unknown message type: ${message.type}` };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error), stack: error?.stack || null }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title) updateSessionUrl(tabId, changeInfo, tab).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopCapture(tabId, 'tab-closed').catch(() => {});
  setProgress(tabId, null).catch(() => {});
});
