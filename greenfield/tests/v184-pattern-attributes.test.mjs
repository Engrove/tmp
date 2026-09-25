import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import '../lib/safety-policy.js';

// Chrome compiles an HTML pattern attribute as new RegExp(`^(?:${p})$`, "v")
// (HTML spec, unicodeSets mode). In v mode "-", "(", ")", "[", "]", "{", "}",
// "/", "\" and "|" must be escaped inside a character class; an invalid
// pattern is ignored (no constraint) and logged as an extension error.
// v1.8.3 and earlier: requiredModel used [- ] and [A-Za-z0-9_-] -> ignored.
const root = path.resolve(import.meta.dirname, '..');
const S = globalThis.GreenfieldSafetyPolicy;

function htmlPatterns() {
  const out = [];
  for (const file of fs.readdirSync(root).filter((name) => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of html.matchAll(/<input\b[^>]*\bid="([^"]*)"[^>]*\bpattern="([^"]*)"/g)) {
      out.push({ file, id: match[1], pattern: match[2].replaceAll('&quot;', '"').replaceAll('&amp;', '&') });
    }
  }
  return out;
}

const compile = (pattern) => new RegExp(`^(?:${pattern})$`, 'v');

test('v1.8.4 every HTML pattern attribute compiles in unicodeSets (v) mode as Chrome compiles it', () => {
  const patterns = htmlPatterns();
  assert.ok(patterns.some((row) => row.id === 'requiredModel'), 'requiredModel pattern present');
  for (const row of patterns) assert.doesNotThrow(() => compile(row.pattern), `${row.file}#${row.id}`);
});

test('v1.8.4 the pre-1.8.4 requiredModel pattern is the one Chrome rejected', () => {
  assert.throws(() => compile(String.raw`GPT[- ][0-9]+(\.[0-9]+){0,3}( [A-Za-z0-9_-]+){0,3}`), SyntaxError);
});

test('v1.8.4 requiredModel pattern accepts exactly what the safety policy accepts syntactically', () => {
  const pattern = compile(htmlPatterns().find((row) => row.id === 'requiredModel').pattern);
  const policyAccepts = (value) => {
    try { S.normalizePolicy({ requiredModel: value }); return true; } catch { return false; }
  };
  const samples = [
    'GPT-5.6', 'GPT 5.6', 'gpt-5.6', 'Gpt 5', 'GPT-5.6.1.2', 'GPT-5.6 Thinking', 'GPT-5.6  Pro', 'GPT-5.6\tPro',
    'GPT-5.6 Sol Luna Astra', 'GPT-5.6 a_b c-d e1', 'GPT-5.6 a b c d', 'GPT-5.6.1.2.3', 'GPT-x', 'GPT5.6',
    'foo', '', 'GPT-5.6 ö', 'GPT_5.6'
  ];
  for (const value of samples) assert.equal(pattern.test(value), policyAccepts(value), value);
});
