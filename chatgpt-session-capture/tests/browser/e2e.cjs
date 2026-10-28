'use strict';

// End-to-end regression harness. Loads an unpacked build of the extension
// into Playwright's Chromium, serves a deterministic mock ChatGPT
// conversation for https://chatgpt.com/*, drives the real background message
// API and downloads the real ZIP export through chrome.downloads.
//
// Usage: node tests/browser/e2e.cjs <unpacked-extension-dir> [--json out.json] [--only A,B]
// Exit code: 0 when every check passes, 1 otherwise.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const mock = require('../fixtures/mock-chatgpt.cjs');

const CONVERSATION_URL = 'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555';
const OTHER_CONVERSATION_PATH = '/c/99999999-8888-7777-6666-555555555555';
const READ_ZIP = path.join(__dirname, '..', 'tools', 'read_zip.py');

const args = process.argv.slice(2);
const extensionDir = path.resolve(args[0] || path.join(__dirname, '..', '..'));
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;

const results = [];
function check(scenario, id, description, pass, detail = '') {
  results.push({ scenario, id, description, pass: Boolean(pass), detail: String(detail).slice(0, 400) });
}

async function launch(config = {}) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgsc-e2e-'));
  const ctx = await chromium.launchPersistentContext(path.join(workDir, 'profile'), {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    downloadsPath: path.join(workDir, 'downloads'),
    viewport: { width: 1280, height: 720 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const html = mock.buildMockHtml(config);
  await ctx.route('https://chatgpt.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/session') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: mock.SESSION_JSON });
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  const chat = ctx.pages()[0] || await ctx.newPage();
  // Simulates a page script that listens to window messages (as any script on chatgpt.com can).
  await chat.addInitScript(() => {
    window.addEventListener('message', (event) => {
      if (event.data?.source === 'CGSC_BRIDGE_V1' && event.data.type === 'INIT') window.__observedBridgeToken = event.data.token;
    });
  });
  await chat.goto(CONVERSATION_URL);
  await chat.waitForSelector('[data-testid^="conversation-turn-"]');
  const control = await ctx.newPage();
  await control.goto(`chrome-extension://${extensionId}/popup.html`);
  await chat.bringToFront();
  const tabId = await control.evaluate(async () => (await chrome.tabs.query({ url: 'https://chatgpt.com/*' }))[0].id);
  return { ctx, chat, control, tabId, extensionId, workDir };
}

async function api(control, message) {
  return control.evaluate((msg) => chrome.runtime.sendMessage(msg), message);
}

async function stopServiceWorker(control) {
  const cdp = await control.context().newCDPSession(control);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function exportZip(session, sessionId) {
  const response = await api(session.control, { type: 'EXPORT_SESSION', sessionId });
  if (!response?.ok) throw new Error(`EXPORT_SESSION failed: ${response?.error}`);
  const downloadId = response.result.downloadId;
  let item = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    [item] = await session.control.evaluate((id) => chrome.downloads.search({ id }), downloadId);
    if (item?.state === 'complete') break;
    if (item?.state === 'interrupted') throw new Error(`Download interrupted: ${item.error}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (item?.state !== 'complete') throw new Error('Download did not complete');
  if (process.env.CGSC_E2E_KEEP) {
    fs.mkdirSync(process.env.CGSC_E2E_KEEP, { recursive: true });
    fs.copyFileSync(item.filename, path.join(process.env.CGSC_E2E_KEEP, `${session.label || 'export'}-${sessionId.slice(0, 8)}.zip`));
  }
  const output = execFileSync('python3', ['-I', READ_ZIP, item.filename], { maxBuffer: 512 * 1024 * 1024 });
  const parsed = JSON.parse(output.toString('utf8'));
  parsed.downloadFilename = response.result.filename;
  return parsed;
}

function text(zip, name) {
  return zip.entries[name]?.text ?? '';
}

function allText(zip) {
  return Object.values(zip.entries).map((entry) => entry.text || '').join('\n');
}

function jsonEntry(zip, name) {
  try { return JSON.parse(text(zip, name)); } catch (_) { return null; }
}

const TRANSCRIPT_OPTIONS = { expandDetails: true, settleMs: 250 };

async function scenarioServiceWorkerRestart() {
  const s = await launch({ sessionPollMs: 0 });
  try {
    const start = await api(s.control, { type: 'START_CAPTURE', tabId: s.tabId, options: TRANSCRIPT_OPTIONS });
    check('A', 'A1', 'Capture starts', start?.ok, start?.error);
    await stopServiceWorker(s.control);
    const full = await api(s.control, { type: 'RUN_FULL_CAPTURE', tabId: s.tabId });
    check('A', 'A2', 'Full sweep succeeds after the service worker was terminated between start and sweep', full?.ok, full?.error);
    await api(s.control, { type: 'STOP_CAPTURE', tabId: s.tabId });
    if (full?.ok) {
      const zip = await exportZip(s, start.session.id);
      const completeness = jsonEntry(zip, 'diagnostics/completeness.json');
      check('A', 'A3', 'All 40 turns stored after service-worker restart', completeness?.counts?.uniqueTurns === 40, completeness?.counts?.uniqueTurns);
    } else {
      check('A', 'A3', 'All 40 turns stored after service-worker restart', false, 'sweep failed');
    }
  } finally {
    await s.ctx.close();
  }
}

async function scenarioTranscript() {
  const s = await launch({ sessionPollMs: 0 });
  s.label = 'B-transcript';
  try {
    const start = await api(s.control, { type: 'START_CAPTURE', tabId: s.tabId, options: TRANSCRIPT_OPTIONS });
    const full = await api(s.control, { type: 'RUN_FULL_CAPTURE', tabId: s.tabId });
    check('B', 'B0', 'Full sweep succeeds', full?.ok, full?.error);
    await api(s.control, { type: 'STOP_CAPTURE', tabId: s.tabId });
    const zip = await exportZip(s, start.session.id);
    const md = text(zip, 'conversation/session.md');
    const structured = jsonEntry(zip, 'conversation/session.json');
    const completeness = jsonEntry(zip, 'diagnostics/completeness.json');
    const attachments = jsonEntry(zip, 'attachments/manifest.json');
    const messages = structured?.messages || [];
    const byTurn = (n) => messages.find((m) => m.turnIndex === n);

    check('B', 'B1', 'ZIP passes CRC validation (zipfile.testzip)', zip.firstBadEntry === null, zip.firstBadEntry);
    check('B', 'B2', 'All 40 turns captured, including 20 lazily loaded older turns', messages.length === 40, messages.length);
    check('B', 'B3', 'Verdict is VERIFIED_COMPLETE_BROWSER_TRANSCRIPT', completeness?.status === 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT', completeness?.status);
    check('B', 'B4', 'User Python indentation preserved verbatim (session.json finalAnswer.text)',
      byTurn(1)?.finalAnswer?.text === mock.PYTHON_USER_TEXT, JSON.stringify(byTurn(1)?.finalAnswer?.text));
    check('B', 'B5', 'User Python indentation and blank lines preserved in session.md',
      md.includes(mock.PYTHON_USER_TEXT), 'expected verbatim user text in session.md');
    const turn6 = byTurn(6)?.finalAnswer?.markdown || '';
    check('B', 'B6', 'Assistant code block reproduced verbatim with language tag',
      turn6.includes('```python\n' + mock.PYTHON_CODE_BLOCK + '\n```'), (turn6.match(/```[\s\S]*?```/) || [turn6.slice(0, 200)])[0]);
    check('B', 'B7', 'Code-block header/button text ("Copy code") not mixed into code',
      /Answer for turn 6/.test(turn6) && !/Copy code/.test(turn6), turn6.slice(0, 200));
    check('B', 'B8', 'Turn 2 final answer is the answer, not the expanded reasoning block',
      /Answer for turn 2/.test(byTurn(2)?.finalAnswer?.markdown || '') && !/Reasoning summary for turn 2/.test(byTurn(2)?.finalAnswer?.markdown || ''),
      (byTurn(2)?.finalAnswer?.markdown || '').slice(0, 200));
    const turn2Section = md.slice(md.indexOf('Turn: `2`'), md.indexOf('Turn: `3`'));
    check('B', 'B9', 'Reasoning body text present in session.md even when the panel contains buttons',
      /Reasoning summary for turn 2/.test(turn2Section) && /Checking the indentation/.test(turn2Section), turn2Section.slice(0, 300));
    check('B', 'B10', 'Turn with two assistant message roots keeps both parts',
      /Part A of turn 4/.test(byTurn(4)?.finalAnswer?.markdown || '') && /Part B of turn 4/.test(byTurn(4)?.finalAnswer?.markdown || ''),
      (byTurn(4)?.finalAnswer?.markdown || '').slice(0, 200));
    check('B', 'B11', 'URL in message text is not rewritten ("https://example.com." stays as typed)',
      byTurn(5)?.finalAnswer?.text === 'See https://example.com. for details.', JSON.stringify(byTurn(5)?.finalAnswer?.text));
    const items = attachments?.items || [];
    check('B', 'B12', 'Uploaded image without file extension is listed as an attachment reference',
      items.some((item) => item.turnIndex === 3 && item.kind === 'image'), JSON.stringify(items.map((i) => [i.turnIndex, i.kind, i.displayName])));
    check('B', 'B13', 'File chip report.pdf is listed as an attachment reference',
      items.some((item) => item.turnIndex === 3 && item.displayName === 'report.pdf'), JSON.stringify(items.map((i) => i.displayName)));
    check('B', 'B14', 'Multi-line table cell stays on one Markdown table row',
      /\| a \| line one(?: |<br>)line two \|/.test(turn6), (turn6.match(/\| a \|[^\n]*\n?[^\n]*/) || [turn6.slice(0, 200)])[0]);
    const turn8 = byTurn(8)?.browserVisibleReasoning?.[0];
    check('B', 'B17', 'Reasoning panel without .markdown class captured expanded with content',
      turn8?.expanded === true && /Reasoning summary for turn 8/.test(turn8?.text || ''), JSON.stringify(turn8 || null).slice(0, 200));
    check('B', 'B15', 'Signed attachment URL parameter (sig) is not exported in transcript mode',
      !allText(zip).includes('SECRETSIG'), 'SECRETSIG found');
    check('B', 'B16', 'Clean capture reports zero error records',
      (completeness?.counts?.errorRecords ?? 0) === 0, completeness?.counts?.errorRecords);
  } finally {
    await s.ctx.close();
  }
}

async function scenarioEvidenceToken() {
  const s = await launch({ sessionPollMs: 300 });
  s.label = 'C-evidence';
  try {
    const start = await api(s.control, { type: 'START_CAPTURE', tabId: s.tabId, options: { ...TRANSCRIPT_OPTIONS, pageNetwork: true } });
    await s.chat.waitForTimeout(1500);
    // A page script that observed the bridge token forges a transcript record.
    await s.chat.evaluate(() => {
      const token = window.__observedBridgeToken;
      window.postMessage({ source: 'CGSC_PAGE_V1', token, type: 'RECORD', payload: {
        id: 'forged-turn', kind: 'conversation-turn', capturedAt: Date.now(),
        data: { stableKey: 'forged', turnIndex: 999, role: 'user', finalText: 'FORGED BY PAGE', finalMarkdown: 'FORGED BY PAGE', reasoning: [], attachments: [] }
      } }, '*');
    });
    await s.chat.waitForTimeout(500);
    const full = await api(s.control, { type: 'RUN_FULL_CAPTURE', tabId: s.tabId });
    check('C', 'C0', 'Evidence sweep succeeds', full?.ok, full?.error);
    await api(s.control, { type: 'STOP_CAPTURE', tabId: s.tabId });
    const zip = await exportZip(s, start.session.id);
    const ndjson = text(zip, 'evidence/records.ndjson');
    check('C', 'C1', 'Page fetch of /api/auth/session was captured (precondition for C2)',
      /page-fetch-response[^\n]*\/api\/auth\/session/.test(ndjson), `ndjson bytes=${ndjson.length}`);
    check('C', 'C2', 'Bearer access token is not exported when sensitive capture is off',
      !allText(zip).includes(mock.FAKE_ACCESS_TOKEN), 'token found in export');
    check('C', 'C3', 'A conversation-turn record forged by a page script is rejected',
      !text(zip, 'conversation/session.md').includes('FORGED BY PAGE'), 'forged turn present in session.md');
  } finally {
    await s.ctx.close();
  }
}

async function scenarioStopDuringSweep() {
  const s = await launch({ sessionPollMs: 0 });
  try {
    const start = await api(s.control, { type: 'START_CAPTURE', tabId: s.tabId, options: TRANSCRIPT_OPTIONS });
    const fullPromise = api(s.control, { type: 'RUN_FULL_CAPTURE', tabId: s.tabId });
    // Stop while the downward pass is in progress: all older turns are loaded
    // and the scroll position is in the middle of the thread.
    await s.chat.waitForFunction(() => window.__mockStats.loads >= 2 && document.getElementById('scroller').scrollTop > 9000,
      null, { timeout: 60000, polling: 50 });
    await api(s.control, { type: 'STOP_CAPTURE', tabId: s.tabId });
    const full = await fullPromise;
    const zip = await exportZip(s, start.session.id);
    const completeness = jsonEntry(zip, 'diagnostics/completeness.json');
    const turns = completeness?.counts?.uniqueTurns;
    check('D', 'D1', 'Stopping during a sweep never yields a VERIFIED verdict for an incomplete transcript',
      !(completeness?.status === 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT' && turns !== 40),
      `status=${completeness?.status} turns=${turns} fullOk=${full?.ok} ${full?.error || ''}`);
  } finally {
    await s.ctx.close();
  }
}

async function scenarioConversationChange() {
  const s = await launch({ sessionPollMs: 0 });
  try {
    const start = await api(s.control, { type: 'START_CAPTURE', tabId: s.tabId, options: TRANSCRIPT_OPTIONS });
    await s.chat.evaluate((p) => history.pushState({}, '', p), OTHER_CONVERSATION_PATH);
    const full = await api(s.control, { type: 'RUN_FULL_CAPTURE', tabId: s.tabId });
    await api(s.control, { type: 'STOP_CAPTURE', tabId: s.tabId });
    const zip = await exportZip(s, start.session.id);
    const completeness = jsonEntry(zip, 'diagnostics/completeness.json');
    check('E', 'E1', 'Sweep after in-app navigation to another conversation is refused or not verified',
      !full?.ok || completeness?.status !== 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT',
      `fullOk=${full?.ok} ${full?.error || ''} status=${completeness?.status}`);
  } finally {
    await s.ctx.close();
  }
}

async function scenarioPopupBusyLock() {
  const s = await launch({ sessionPollMs: 0 });
  try {
    const popupPromise = s.ctx.waitForEvent('page');
    await s.control.evaluate(async ({ extensionId, tabId }) => {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.create({ url: `chrome-extension://${extensionId}/popup.html`, active: false, windowId: tab.windowId });
    }, { extensionId: s.extensionId, tabId: s.tabId });
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 10000 });
    await popup.evaluate(() => {
      const input = document.getElementById('settleMs');
      input.value = '250';
      input.dispatchEvent(new Event('change'));
      document.getElementById('start').click();
    });
    await popup.waitForFunction(() => document.getElementById('stateBadge').textContent.trim() === 'AKTIV', null, { timeout: 10000 });
    await popup.waitForFunction(() => !document.getElementById('full').disabled, null, { timeout: 10000 });
    await popup.evaluate(() => document.getElementById('full').click());
    await popup.waitForTimeout(2600);
    const state = await popup.evaluate(() => ({
      start: document.getElementById('start').disabled,
      full: document.getElementById('full').disabled,
      stop: document.getElementById('stop').disabled
    }));
    check('F', 'F1', 'Popup keeps Start and Full sweep disabled while a sweep is running (after status polling)',
      state.start && state.full, JSON.stringify(state));
    const progress = await popup.evaluate(() => document.getElementById('sweepProgress')?.textContent || null);
    check('F', 'F2', 'Popup shows live sweep progress', Boolean(progress) && progress !== '—' && /turer|runda|steg|pågår/.test(progress), String(progress));
    await popup.reload();
    await popup.waitForFunction(() => document.getElementById('stateBadge').textContent.trim() !== '', null, { timeout: 10000 });
    await popup.waitForTimeout(1600);
    const reopened = await popup.evaluate(() => ({
      settleMs: document.getElementById('settleMs')?.value,
      settleDisabled: document.getElementById('settleMs')?.disabled,
      full: document.getElementById('full').disabled,
      badge: document.getElementById('stateBadge').textContent.trim()
    }));
    check('F', 'F3', 'Reopened popup during the sweep shows the capture options, locked, and the sweep state',
      reopened.settleMs === '250' && reopened.settleDisabled === true && reopened.full === true && reopened.badge === 'SVEPER', JSON.stringify(reopened));
  } finally {
    await s.ctx.close();
  }
}

async function scenarioWorkerKilledDuringSweep() {
  const s = await launch({ sessionPollMs: 0 });
  try {
    const start = await api(s.control, { type: 'START_CAPTURE', tabId: s.tabId, options: TRANSCRIPT_OPTIONS });
    const firstSweep = api(s.control, { type: 'RUN_FULL_CAPTURE', tabId: s.tabId }).catch((error) => ({ ok: false, error: String(error) }));
    await s.chat.waitForFunction(() => window.__mockStats.loads >= 2 && document.getElementById('scroller').scrollTop > 6000,
      null, { timeout: 60000, polling: 50 });
    await stopServiceWorker(s.control);
    // Wait until the content script has finished the interrupted sweep.
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const ping = await s.control.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'PING_CONTENT' }).catch(() => null), s.tabId);
      if (ping && !ping.sweepRunning) break;
      await s.chat.waitForTimeout(250);
    }
    const first = await Promise.race([firstSweep, new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'no response (service worker was stopped)' }), 2000))]);
    const zip1 = await exportZip(s, start.session.id);
    const c1 = jsonEntry(zip1, 'diagnostics/completeness.json');
    check('G', 'G1', 'Worker killed mid-sweep: export never claims VERIFIED with missing turns',
      !(c1?.status === 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT' && c1?.counts?.uniqueTurns !== 40),
      `status=${c1?.status} turns=${c1?.counts?.uniqueTurns} failed=${(c1?.failedChecks || []).join(',')} firstSweep=${first?.ok} ${first?.error || ''}`);
    const second = await api(s.control, { type: 'RUN_FULL_CAPTURE', tabId: s.tabId });
    check('G', 'G2', 'A second sweep after the worker restart succeeds', second?.ok, second?.error);
    await api(s.control, { type: 'STOP_CAPTURE', tabId: s.tabId });
    const zip2 = await exportZip(s, start.session.id);
    const c2 = jsonEntry(zip2, 'diagnostics/completeness.json');
    check('G', 'G3', 'After the second sweep all 40 turns are stored and verified',
      c2?.status === 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT' && c2?.counts?.uniqueTurns === 40,
      `status=${c2?.status} turns=${c2?.counts?.uniqueTurns} failed=${(c2?.failedChecks || []).join(',')}`);
  } finally {
    await s.ctx.close();
  }
}

async function scenarioOrphanedSession() {
  const s = await launch({ sessionPollMs: 0 });
  try {
    // An 'active' session that is not in the active-capture map, as left by
    // an extension reload or a browser restart (both clear storage.session).
    await s.control.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('chatgpt_session_capture_v1');
      request.onsuccess = () => {
        const tx = request.result.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put({ id: 'orphan-1', tabId: 123456, title: 'Orphan', startedAt: Date.now() - 60000, updatedAt: Date.now() - 50000, status: 'active', options: {} });
        tx.oncomplete = () => { request.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    }));
    await stopServiceWorker(s.control);
    const list = await api(s.control, { type: 'LIST_SESSIONS' });
    const orphan = (list?.sessions || []).find((item) => item.id === 'orphan-1');
    check('H', 'H1', 'A capture left active by a reload/restart is marked interrupted', orphan?.status === 'interrupted', `status=${orphan?.status}`);
  } finally {
    await s.ctx.close();
  }
}

async function scenarioDeepNetwork() {
  const s = await launch({ sessionPollMs: 400 });
  s.label = 'I-deep-network';
  try {
    const start = await api(s.control, { type: 'START_CAPTURE', tabId: s.tabId, options: { ...TRANSCRIPT_OPTIONS, deepNetwork: true } });
    check('I', 'I0', 'Deep-network capture starts (chrome.debugger attached)', start?.ok, start?.error);
    if (!start?.ok) return;
    await s.chat.waitForTimeout(1500);
    const full = await api(s.control, { type: 'RUN_FULL_CAPTURE', tabId: s.tabId });
    check('I', 'I1', 'Deep-network sweep succeeds', full?.ok, full?.error);
    await api(s.control, { type: 'STOP_CAPTURE', tabId: s.tabId });
    const zip = await exportZip(s, start.session.id);
    const ndjson = text(zip, 'evidence/records.ndjson');
    const completeness = jsonEntry(zip, 'diagnostics/completeness.json');
    check('I', 'I2', 'Debugger response bodies for /api/auth/session were captured (precondition for I3)',
      /cdp-network-response-body[^\n]*\/api\/auth\/session/.test(ndjson), `kinds=${JSON.stringify(completeness?.kinds || {})}`);
    check('I', 'I3', 'Bearer access token absent from a deep-network export without sensitive capture',
      !allText(zip).includes(mock.FAKE_ACCESS_TOKEN), 'token found in export');
    check('I', 'I4', 'MHTML is skipped without sensitive capture and no evidence/mhtml file exists',
      (completeness?.kinds?.['debugger-mhtml-snapshot'] || 0) === 0 && !Object.keys(zip.entries).some((name) => name.startsWith('evidence/mhtml/')),
      JSON.stringify(Object.keys(zip.entries)));
    check('I', 'I5', 'Transcript verdict in deep-network mode is verified', completeness?.status === 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT',
      `${completeness?.status} ${(completeness?.failedChecks || []).join(',')}`);
  } finally {
    await s.ctx.close();
  }
}

async function scenarioReloadAfterStart() {
  const s = await launch({ sessionPollMs: 0 });
  try {
    const navigation = s.chat.waitForEvent('load', { timeout: 15000 });
    const start = await api(s.control, { type: 'START_CAPTURE', tabId: s.tabId, options: { ...TRANSCRIPT_OPTIONS, reloadAfterStart: true } });
    check('J', 'J1', 'Capture with "reload tab after start" starts and the tab reloads', start?.ok && Boolean(await navigation.catch(() => null)), start?.error);
    await s.chat.waitForSelector('[data-testid^="conversation-turn-"]');
    const full = await api(s.control, { type: 'RUN_FULL_CAPTURE', tabId: s.tabId });
    await api(s.control, { type: 'STOP_CAPTURE', tabId: s.tabId });
    const zip = await exportZip(s, start.session.id);
    const completeness = jsonEntry(zip, 'diagnostics/completeness.json');
    check('J', 'J2', 'Sweep after the reload captures and verifies all 40 turns',
      full?.ok && completeness?.status === 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT' && completeness?.counts?.uniqueTurns === 40,
      `fullOk=${full?.ok} ${full?.error || ''} status=${completeness?.status} turns=${completeness?.counts?.uniqueTurns}`);
  } finally {
    await s.ctx.close();
  }
}

const SCENARIOS = {
  A: scenarioServiceWorkerRestart,
  B: scenarioTranscript,
  C: scenarioEvidenceToken,
  D: scenarioStopDuringSweep,
  E: scenarioConversationChange,
  F: scenarioPopupBusyLock,
  G: scenarioWorkerKilledDuringSweep,
  H: scenarioOrphanedSession,
  I: scenarioDeepNetwork,
  J: scenarioReloadAfterStart
};

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  console.log(`Extension under test: ${manifest.name} ${manifest.version} (${extensionDir})`);
  for (const [key, run] of Object.entries(SCENARIOS)) {
    if (only && !only.has(key)) continue;
    const started = Date.now();
    try {
      await run();
    } catch (error) {
      check(key, `${key}!`, 'Scenario ran to completion', false, error?.stack || String(error));
    }
    console.log(`Scenario ${key} finished in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  const width = Math.max(...results.map((r) => r.description.length));
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(4)} ${r.description.padEnd(width)}${r.pass ? '' : `  -> ${r.detail}`}`);
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed for version ${manifest.version}.`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ version: manifest.version, results }, null, 2));
  process.exit(failed ? 1 : 0);
})();
