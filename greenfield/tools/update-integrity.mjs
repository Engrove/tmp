// Release helper (v2.0.0): regenerates installed-integrity.json and
// lib/build-identity.mjs from the shipped runtime files, using the same
// basis as tools/verify-release-coherence.mjs. Run after the last code change
// of a release, then run verify-release-coherence.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const exists = name => fs.existsSync(path.join(root, name));
const descriptorPath = path.join(root, 'installed-integrity.json');
const previous = exists('installed-integrity.json') ? JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) : { files: {} };
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();

const names = new Set(Object.keys(previous.files || {}).filter(exists));
for (const file of fs.readdirSync(path.join(root, 'lib'))) {
  if (/\.(mjs|js)$/.test(file)) names.add(`lib/${file}`);
}
for (const file of ['VERSION', 'manifest.json', 'background.js', 'content.js', 'offscreen.html', 'offscreen.js',
  'sidepanel.html', 'sidepanel.js', 'sidepanel.css', 'tools/verify-installed.mjs',
  'tools/verify-release-coherence.mjs', 'tools/update-integrity.mjs']) {
  if (exists(file)) names.add(file);
}

const IDENTITY = 'lib/build-identity.mjs';
const files = {};
for (const name of [...names].sort()) {
  if (name !== IDENTITY) files[name] = hash(fs.readFileSync(path.join(root, name)));
}
const basis = Object.fromEntries(Object.keys(files).sort().map(name => [name, files[name]]));
const mapHash = hash(Buffer.from(JSON.stringify(basis)));
const identitySource = fs.readFileSync(path.join(root, IDENTITY), 'utf8')
  .replace(/RUNTIME_BUILD_SHA256 = "[a-f0-9]+"/, `RUNTIME_BUILD_SHA256 = "${mapHash}"`);
fs.writeFileSync(path.join(root, IDENTITY), identitySource);
files[IDENTITY] = hash(fs.readFileSync(path.join(root, IDENTITY)));

const descriptor = {
  version,
  runtimeBuildSHA256: mapHash,
  files: Object.fromEntries(Object.keys(files).sort().map(name => [name, files[name]]))
};
fs.writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
console.log(JSON.stringify({ version, files: Object.keys(descriptor.files).length, runtimeBuildSHA256: mapHash }));
