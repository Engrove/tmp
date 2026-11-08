// Read-only release gate: checks semantic version identity AND byte identity.
// It intentionally detects a package where every file hash is correct but
// content.js advertises a version different from the installed background.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = name => fs.readFileSync(path.join(root, name), 'utf8');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const match = (s, re, label) => { const m = s.match(re); if (!m) throw new Error(`VERSION_DECLARATION_MISSING:${label}`); return m[1]; };
const version = text('VERSION').trim();
const manifest = JSON.parse(text('manifest.json'));
const pkg = JSON.parse(text('package.json'));
const lock = JSON.parse(text('package-lock.json'));
const content = text('content.js');
const html = text('sidepanel.html');
const declarations = {
  manifest: manifest.version,
  package: pkg.version,
  packageLock: lock.version,
  packageLockRoot: lock.packages?.['']?.version,
  contracts: match(text('lib/contracts.mjs'), /export const APP_VERSION = "([^"]+)"/, 'contracts'),
  content: match(content, /const CONTENT_VERSION = "([^"]+)"/, 'content'),
  panelMeta: match(html, /name="greenfield-version" content="([^"]+)"/, 'panelMeta'),
  panelHeading: match(html, /<h1>Greenfield <span>v([^<]+)<\/span><\/h1>/, 'panelHeading')
};
const mismatches = Object.entries(declarations).filter(([,actual])=>actual!==version).map(([key,actual])=>({key,actual,expected:version}));
const descriptor = JSON.parse(text('installed-integrity.json'));
if (descriptor.version !== version) mismatches.push({key:'installed-integrity.json.version',actual:descriptor.version,expected:version});
const basis = {};
const byteMismatches = [];
for (const name of Object.keys(descriptor.files).sort()) {
  const file = path.join(root, name);
  const actual = fs.existsSync(file) ? hash(fs.readFileSync(file)) : 'MISSING';
  if (actual !== descriptor.files[name]) byteMismatches.push(name);
  if (name !== 'lib/build-identity.mjs') basis[name] = descriptor.files[name];
}
const mapHash = hash(Buffer.from(JSON.stringify(basis)));
const embeddedHash = match(text('lib/build-identity.mjs'), /RUNTIME_BUILD_SHA256 = "([a-f0-9]+)"/, 'buildIdentity');
const buildMatch = mapHash === descriptor.runtimeBuildSHA256 && mapHash === embeddedHash;
const result = {schema:'eic.greenfield.release-coherence.v1',version,
  declarations,mismatches,filesChecked:Object.keys(descriptor.files).length,byteMismatches,
  mapHash,descriptorHash:descriptor.runtimeBuildSHA256,embeddedHash,buildMatch,
  ready:mismatches.length===0 && byteMismatches.length===0 && buildMatch};
console.log(JSON.stringify(result,null,2));
if (!result.ready) process.exitCode=1;
