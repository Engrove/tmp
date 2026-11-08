import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_VERSION } from '../lib/contracts.mjs';

const load = async file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const versionFrom = (text, pattern, component) => {
  const match = text.match(pattern);
  assert.ok(match, `${component}: version declaration missing`);
  return match[1];
};

test('all runtime entrypoints expose one exact release version', async () => {
  const [manifest, pkg, lock, html, content, version] = await Promise.all([
    load('manifest.json'), load('package.json'), load('package-lock.json'),
    load('sidepanel.html'), load('content.js'), load('VERSION')
  ]);
  const references = {
    manifest: JSON.parse(manifest).version,
    package: JSON.parse(pkg).version,
    packageLock: JSON.parse(lock).version,
    panelMeta: versionFrom(html, /name="greenfield-version"\s+content="([^"]+)"/, 'panel meta'),
    panelHeadline: versionFrom(html, /<h1>Greenfield\s+<span>v([^<]+)<\/span><\/h1>/, 'panel heading'),
    contentBridge: versionFrom(content, /const CONTENT_VERSION = "([^"]+)"/, 'content bridge'),
    versionFile: version.trim()
  };
  for (const [component, found] of Object.entries(references)) {
    assert.equal(found, APP_VERSION, `${component}=${found}, application=${APP_VERSION}`);
  }
  assert.match(content, /version:\s*CONTENT_VERSION/, 'PING must return the content version constant');
  assert.match(content, /bridgeVersion:\s*CONTENT_VERSION/, 'page state must carry the content version');
});

test('runtime reinjection is bounded when the shipped content always reports the wrong version', async () => {
  const background = await load('background.js');
  const start = background.indexOf('async function ensureContentBridgeVersion(');
  const end = background.indexOf('\n\nfunction hasCanonicalResponseControl(', start);
  assert.ok(start > 0 && end > start, 'bridge validation source could not be located');
  const source = background.slice(start, end);
  let injections = 0;
  const repairAttempts = new Map();
  let now = 1_000_000;
  const environment = new Function('pingContentBridge', 'injectContentBridge', 'APP_VERSION',
    'bridgeRepairAttempts', 'BRIDGE_REPAIR_BACKOFF_MS', 'Date',
    `${source}; return ensureContentBridgeVersion;`);
  const ensure = environment(
    async () => ({ ok: true, version: 'always-wrong-version' }),
    async () => { injections++; }, APP_VERSION, repairAttempts, 60_000,
    { now: () => now }
  );
  await assert.rejects(ensure(42), /CONTENT_BRIDGE_VERSION_MISMATCH/);
  assert.equal(injections, 1);
  for (let i = 0; i < 20; i++) {
    await assert.rejects(ensure(42), /CONTENT_BRIDGE_VERSION_MISMATCH/);
  }
  assert.equal(injections, 1, 'a permanently mismatched bridge cannot be torn down repeatedly');
  now += 60_001;
  await assert.rejects(ensure(42), /CONTENT_BRIDGE_VERSION_MISMATCH/);
  assert.equal(injections, 2, 'a bounded later recovery attempt must remain possible');
});

test('a properly injected bridge is accepted and clears the repair backoff', async () => {
  const background = await load('background.js');
  const start = background.indexOf('async function ensureContentBridgeVersion(');
  const end = background.indexOf('\n\nfunction hasCanonicalResponseControl(', start);
  const repairAttempts = new Map();
  const ensure = new Function('pingContentBridge', 'injectContentBridge', 'APP_VERSION',
    'bridgeRepairAttempts', 'BRIDGE_REPAIR_BACKOFF_MS', 'Date',
    `${background.slice(start, end)}; return ensureContentBridgeVersion;`)(
    async () => ({ ok:true, version:APP_VERSION }),
    async () => { throw new Error('Unnecessary injection'); }, APP_VERSION,
    repairAttempts, 60_000, { now: () => 2_000_000 }
  );
  repairAttempts.set(17, { atMs:1_999_950, observedVersion:'wrong', expectedVersion: APP_VERSION });
  const result = await ensure(17);
  assert.equal(result.refreshed, false);
  assert.equal(repairAttempts.has(17), false);
});
