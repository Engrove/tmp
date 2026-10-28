'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('../../lib/sanitize.js');

const { sanitizeUrl, sanitizeString, sanitizeValue, sanitizeHeaders, REDACTED } = globalThis.CgscSanitize;
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjZ3NjLXRlc3QifQ.c2lnbmF0dXJlLWNnc2MtdGVzdA';

test('URLs without sensitive parameters are returned byte-identical', () => {
  for (const url of ['https://example.com', 'https://Example.com/a b', 'https://example.com/doc?id=5&page=2', 'https://example.com/x?q=%7E']) {
    assert.equal(sanitizeUrl(url, false), url);
  }
});

test('sensitive URL parameters are redacted, others kept', () => {
  const out = sanitizeUrl('https://files.example/f?se=2026&sig=SECRET&x=1', false);
  assert.match(out, /sig=REDACTED/);
  assert.match(out, /se=2026/);
  assert.match(out, /x=1/);
  assert.doesNotMatch(out, /SECRET/);
});

test('HTML-encoded URLs keep their &amp; encoding', () => {
  assert.equal(sanitizeUrl('https://a.example/p?x=1&amp;token=abc', false), 'https://a.example/p?x=1&amp;token=REDACTED');
});

test('sanitizeString leaves ordinary text and URLs unchanged', () => {
  const text = 'See https://example.com. and https://example.com/a?b=1, then stop.';
  assert.equal(sanitizeString(text, false), text);
});

test('sanitizeString redacts JWTs, bearer tokens and sensitive JSON string fields', () => {
  const body = JSON.stringify({ user: { name: 'x' }, accessToken: JWT, expires: '2099', max_tokens: 10, csrf_token: 'abc' });
  const out = sanitizeString(body, false);
  assert.ok(!out.includes(JWT));
  assert.match(out, /"accessToken":"\[REDACTED\]"/);
  assert.match(out, /"csrf_token":"\[REDACTED\]"/);
  assert.match(out, /"max_tokens":10/);
  assert.match(out, /"expires":"2099"/);
  assert.equal(sanitizeString('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123', false), 'Authorization: Bearer [REDACTED]');
  assert.equal(sanitizeString(`token ${JWT} end`, false), 'token [REDACTED JWT] end');
});

test('includeSensitive disables every redaction', () => {
  const body = JSON.stringify({ accessToken: JWT });
  assert.equal(sanitizeString(body, true), body);
  assert.deepEqual(sanitizeValue({ cookie: 'a=b' }, true), { cookie: 'a=b' });
});

test('headers are redacted by name', () => {
  const out = sanitizeHeaders({
    Authorization: 'Bearer x',
    'openai-sentinel-chat-requirements-token': 'abc',
    'x-csrf-token': 'abc',
    'content-type': 'application/json'
  }, false);
  assert.equal(out.Authorization, REDACTED);
  assert.equal(out['openai-sentinel-chat-requirements-token'], REDACTED);
  assert.equal(out['x-csrf-token'], REDACTED);
  assert.equal(out['content-type'], 'application/json');
});

test('transcript mode preserves message text exactly but redacts URL fields and evidence HTML', () => {
  const data = {
    finalText: `Python:\n    x = 1\nhttps://example.com.\n${JWT}`,
    finalMarkdown: 'session=requests.Session()',
    messages: [{ text: '  indented', markdown: '  indented' }],
    reasoning: [{ text: 'token=abc', steps: ['Open https://a.example/?sig=1'] }],
    attachments: [{ url: 'https://f.example/x?sig=SECRET' }],
    html: `<img src="https://f.example/x?sig=SECRET&amp;a=1">`,
    maxTokens: 5
  };
  const out = sanitizeValue(data, false, 'data', undefined, 0, 'transcript');
  assert.equal(out.finalText, data.finalText);
  assert.equal(out.finalMarkdown, data.finalMarkdown);
  assert.deepEqual(out.messages, data.messages);
  assert.equal(out.reasoning[0].text, 'token=abc');
  assert.deepEqual(out.reasoning[0].steps, data.reasoning[0].steps);
  assert.match(out.attachments[0].url, /sig=REDACTED/);
  assert.doesNotMatch(out.html, /SECRET/);
  assert.equal(out.maxTokens, 5);
});

test('evidence mode redacts nested structures and handles cycles', () => {
  const value = { response: { headers: { 'set-cookie': 'a' }, body: JSON.stringify({ refresh_token: 'r' }) } };
  value.self = value;
  const out = sanitizeValue(value, false);
  assert.equal(out.response.headers['set-cookie'], REDACTED);
  assert.match(out.response.body, /"refresh_token":"\[REDACTED\]"/);
  assert.equal(out.self, out);
});
