'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
require('../../lib/zip.js');

const READ_ZIP = path.join(__dirname, '..', 'tools', 'read_zip.py');

test('ZipBuilder output is a valid archive with correct CRCs, sizes and UTF-8 names', async () => {
  const zip = new globalThis.CgscZip.ZipBuilder();
  const when = new Date(2026, 9, 28, 13, 37, 42);
  const compressible = 'def f():\n    return 1\n'.repeat(500);
  const random = crypto.randomBytes(4096);
  zip.add('AI_TO_AI_INSTRUCTIONS.md', '# x\n', when);
  zip.add('conversation/session.md', compressible, when);
  zip.add('evidence/random.bin', random, when);
  zip.add('Åäö/ünïcode.txt', 'ok', when);
  zip.add('empty.txt', '', when);
  const blob = await zip.build();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cgsc-zip-')), 'out.zip');
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  const parsed = JSON.parse(execFileSync('python3', ['-I', READ_ZIP, file]).toString('utf8'));
  assert.equal(parsed.firstBadEntry, null);
  assert.deepEqual(Object.keys(parsed.entries), ['AI_TO_AI_INSTRUCTIONS.md', 'conversation/session.md', 'evidence/random.bin', 'Åäö/ünïcode.txt', 'empty.txt']);
  assert.equal(parsed.entries['conversation/session.md'].text, compressible);
  assert.equal(parsed.entries['conversation/session.md'].method, 8, 'compressible entry uses DEFLATE');
  assert.equal(parsed.entries['evidence/random.bin'].method, 0, 'incompressible entry is stored');
  assert.equal(parsed.entries['evidence/random.bin'].size, 4096);
  assert.equal(parsed.entries['Åäö/ünïcode.txt'].utf8Flag, true);
  assert.equal(parsed.entries['empty.txt'].size, 0);
});
