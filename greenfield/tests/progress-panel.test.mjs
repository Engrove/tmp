import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { releaseControl } from '../lib/panel-edit-guard.mjs';

const panel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../sidepanel.css', import.meta.url), 'utf8');

function extract(name) {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(panel);
  assert.ok(m, name);
  const tail = panel.slice(m.index), end = /^}\s*$/m.exec(tail);
  return tail.slice(0, end.index + end[0].length);
}
const FUNCS = ['progressEl', 'progressMissionLabel', 'buildProgressBody', 'buildProgressForm', 'renderProgress',
  'progressResponseMessage', 'submitProgressResponse', 'onProgressClick'];

function setup({ progress = [], items = [], send } = {}) {
  const dom = new JSDOM(`<body><div id="progressSummary"></div><div id="progressRows"></div></body>`);
  const document = dom.window.document;
  const $ = (id) => document.getElementById(id);
  const sent = [];
  const state = { windowId: 7, workerId: 'w1', auditSessionId: 'aud1', progress, progressBusy: {}, progressNotices: {},
    missionQueue: { items } };
  const chrome = { runtime: { sendMessage: async (m) => { sent.push(m); return send ? send(m) : { ok: true, progress }; } } };
  let snapshots = 0;
  const snapshot = async () => { snapshots += 1; };
  const consts = panel.split('\n').filter((l) => /^const PROGRESS_(STAGE_MARK|ALERT_LABEL)/.test(l)).join('\n');
  const api = Function('$', 'state', 'chrome', 'snapshot', 'releaseControl',
    `${consts}\n${FUNCS.map(extract).join('\n')}\nreturn { ${FUNCS.join(', ')} };`)($, state, chrome, snapshot, releaseControl);
  return { dom, document, $, state, sent, api, snapshots: () => snapshots };
}

const entry = (over = {}) => ({
  missionKey: 'saved-1',
  stages: [{ id: 's1', title: 'Analys', state: 'DONE' }, { id: 's2', title: 'Bygg', state: 'ACTIVE' },
    { id: 's3', title: 'Test', state: 'PENDING' }, { id: 's4', title: 'Drift', state: 'BLOCKED' }, { id: 's5', title: 'Extra', state: 'DROPPED' }],
  currentStageId: 's2', alert: 'CHANGE_ROUTE', alertReason: 'loop',
  counters: { turns: 9, advanced: 3, churn: 2, blocked: 0, churnStreak: 4, blockerRepeat: 0, stagesDone: 1 },
  operatorRequest: null, lastVerdicts: ['ADVANCED', 'CHURN'], deadEnds: [{ route: 'A', reason: 'fel' }], updatedAt: 1, ...over
});
const openReq = (over = {}) => ({ requestId: 'r1', ask: 'Vilken miljö?', why: 'Behövs för test', then: 'Jag kör vidare',
  options: ['Prod', 'Stage'], source: 'x', status: 'OPEN', ...over });

test('renders stages, markers, counters, alert chip and label from queue', () => {
  const t = setup({ progress: [entry()], items: [{ savedMissionId: 'saved-1', label: 'Mitt uppdrag' }] });
  t.api.renderProgress();
  const root = t.$('progressRows');
  assert.match(root.textContent, /Mitt uppdrag/);
  const marks = [...root.querySelectorAll('.stage-mark')].map((e) => e.textContent);
  assert.deepEqual(marks, ['✓', '▶', '·', '⚠', '–']);
  assert.match(root.textContent, /Etapper klara: 1\/5/);
  assert.match(root.textContent, /9 turer · 3 framsteg · 4 turer utan framsteg i rad/);
  assert.equal(root.querySelector('.progress-alert-chip').textContent, 'Byter väg');
  assert.equal(root.querySelectorAll('.progress-verdict').length, 2);
  assert.equal(root.querySelector('details.progress-deadends').open, false);
  assert.equal(root.querySelector('.progress-op-box'), null);
});

test('label falls back to missionKey; NONE alert has no chip; STRATEGY_SWITCH label', () => {
  const t = setup({ progress: [entry({ missionKey: 'gfw:GF-1.2.3', alert: 'NONE' })] });
  t.api.renderProgress();
  assert.match(t.$('progressRows').textContent, /gfw:GF-1\.2\.3/);
  assert.equal(t.$('progressRows').querySelector('.progress-alert-chip'), null);
  t.state.progress = [entry({ alert: 'STRATEGY_SWITCH' })];
  t.api.renderProgress();
  assert.equal(t.$('progressRows').querySelector('.progress-alert-chip').textContent, 'Strategibyte');
  t.state.progress = [entry({ alert: 'OPERATOR_REQUIRED' })];
  t.api.renderProgress();
  assert.equal(t.$('progressRows').querySelector('.progress-alert-chip').textContent, 'Väntar på dig');
});

test('OPEN request renders form with ask/why/then, option buttons and two actions', () => {
  const t = setup({ progress: [entry({ operatorRequest: openReq() })] });
  t.api.renderProgress();
  const root = t.$('progressRows');
  assert.match(root.textContent, /Vilken miljö\?/);
  assert.match(root.textContent, /Behövs för test/);
  assert.match(root.textContent, /Jag kör vidare/);
  assert.ok(root.querySelector('textarea'));
  assert.deepEqual([...root.querySelectorAll('[data-progress-send]')].map((b) => b.textContent), ['Skicka svar', 'Fortsätt utan svar']);
  root.querySelector('[data-progress-option="Stage"]').click?.();
  t.api.onProgressClick({ target: root.querySelector('[data-progress-option="Stage"]') });
  assert.equal(root.querySelector('textarea').value, 'Stage');
  // ANSWERED requests show no form
  t.state.progress = [entry({ operatorRequest: openReq({ status: 'ANSWERED' }) })];
  t.api.renderProgress();
  assert.equal(root.querySelector('.progress-op-box'), null);
});

test('typing survives re-render and details open state is preserved', () => {
  const t = setup({ progress: [entry({ operatorRequest: openReq() })] });
  t.api.renderProgress();
  const root = t.$('progressRows');
  const ta = root.querySelector('textarea');
  ta.value = 'halvskrivet svar';
  ta.focus();
  root.querySelector('details').open = true;
  t.state.progress = [entry({ operatorRequest: openReq(), counters: { turns: 10 } })];
  t.api.renderProgress();
  assert.equal(root.querySelector('textarea'), ta, 'same element kept');
  assert.equal(ta.value, 'halvskrivet svar');
  assert.equal(root.querySelector('details').open, true);
  assert.match(root.textContent, /10 turer/);
});

test('send handler posts the worker-bound envelope with missionKey/answer/mode', async () => {
  const t = setup({ progress: [entry({ operatorRequest: openReq() })] });
  t.api.renderProgress();
  const root = t.$('progressRows');
  root.querySelector('textarea').value = '  Stage  ';
  assert.equal(await t.api.submitProgressResponse('saved-1', 'ANSWER'), true);
  assert.deepEqual(t.sent[0], { type: 'EIC_GF_PROGRESS_OPERATOR_RESPONSE', windowId: 7, workerId: 'w1',
    auditSessionId: 'aud1', missionKey: 'saved-1', answer: 'Stage', mode: 'ANSWER' });
  assert.equal(t.snapshots(), 1);
  assert.equal(await t.api.submitProgressResponse('saved-1', 'CONTINUE'), true);
  assert.equal(t.sent[1].mode, 'CONTINUE');
  assert.equal(t.state.progressBusy['saved-1'], false);
});

test('empty answer is refused for ANSWER but CONTINUE is allowed', async () => {
  const t = setup({ progress: [entry({ operatorRequest: openReq() })] });
  t.api.renderProgress();
  assert.equal(await t.api.submitProgressResponse('saved-1', 'ANSWER'), false);
  assert.equal(t.sent.length, 0);
  assert.match(t.$('progressRows').querySelector('.progress-op-error').textContent, /Skriv ett svar/);
  assert.equal(await t.api.submitProgressResponse('saved-1', 'CONTINUE'), true);
  assert.equal(t.sent.length, 1);
});

test('errors are shown in Swedish and buttons are re-enabled', async () => {
  const t = setup({ progress: [entry({ operatorRequest: openReq() })], send: () => ({ ok: false, error: 'nope' }) });
  t.api.renderProgress();
  t.$('progressRows').querySelector('textarea').value = 'x';
  assert.equal(await t.api.submitProgressResponse('saved-1', 'ANSWER'), false);
  assert.match(t.$('progressRows').querySelector('.progress-op-error').textContent, /Svaret kunde inte skickas: nope/);
  assert.ok([...t.$('progressRows').querySelectorAll('button')].every((b) => !b.disabled));
});

test('untrusted text is escaped, never parsed as markup', () => {
  const evil = '<img src=x onerror=alert(1)><b>';
  const t = setup({ progress: [entry({ missionKey: evil, stages: [{ id: 'a', title: evil, state: 'ACTIVE' }],
    lastVerdicts: [evil], deadEnds: [{ route: evil, reason: evil }], operatorRequest: openReq({ ask: evil, why: evil, then: evil, options: [evil] }) })] });
  t.api.renderProgress();
  const root = t.$('progressRows');
  assert.equal(root.querySelector('img'), null);
  assert.equal(root.querySelector('b'), null);
  assert.ok(root.textContent.includes(evil));
});

test('static: html section, queue operatorWait text, message type, css, no innerHTML in progress code', () => {
  assert.match(html, /id="progressRows"/);
  assert.match(html, />Framsteg</);
  assert.match(panel, /item\.operatorWait\s*\n?\s*\? "Väntar på operatör"/);
  assert.match(panel, /title="\$\{escapeHtml\(item\.operatorWait\.ask/);
  assert.match(panel, /type: "EIC_GF_PROGRESS_OPERATOR_RESPONSE"/);
  assert.match(panel, /state\.progress = Array\.isArray\(result\.progress\)/);
  assert.match(css, /\.progress-op-box/);
  const code = ['renderProgress', 'buildProgressBody', 'buildProgressForm'].map(extract).join('\n');
  assert.doesNotMatch(code, /innerHTML/);
});
