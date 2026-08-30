# EIC Autonom Agent v0.10.0 verification

## Mandated baseline

- Source: `eic-autonom-agent-v0.9.11-source.zip`
- SHA-256: `987282a2abe7c7c02336e9e9fae51a3211db3568c4296497d0a5b95a12deded2`
- Size: `933596` bytes
- Entries: `348`
- CRC/path/symlink/encryption preflight: PASS

## Unmodified baseline

- Full test suite: `703/703 PASS`, exit `0`
- Validator: PASS, exit `0`
- Syntax: `126/126 PASS`
- Packaging: PASS, exit `0`

## v0.10.0 discriminating set

Command:

```text
node --test tests/v010*.test.mjs
```

Result before packaging:

- `40/40 PASS`
- block and emit twins cover operator action, level-10 acknowledgement, capture, memory and profiles;
- IndexedDB tests cover transaction/readback, quota, corruption, missing factory, redaction and purge.

## Full regression

Command:

```text
npm test
```

Result before packaging:

- `743/743 PASS`
- exit `0`

## Local final gates

Direct results before the final frozen-source rerun:

- Focused v0.10.0: `40/40 PASS`, exit `0`
- Full regression: `743/743 PASS`, exit `0`
- Validator: PASS, exit `0`
- Syntax: `140/140 PASS`
- Packaging: PASS, exit `0`
- Runtime build file count: `91` for SOURCE, STANDARD and BROWSER

The external delivery receipt records final ZIP hashes, CRC/path checks and the independent frozen-source rerun.

## Claim boundary

These tests verify the local v0.10.0 source and packages only. They do not prove an installed extension, Desktop Chrome rendering, live IndexedDB behavior in Chrome, live `LanguageModel`, repository persistence, release, deployment or publication.
