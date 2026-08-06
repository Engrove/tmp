# v0.10.12 incident analysis — the v0.10.11 release-identity failure

## Observed

v0.10.11 could not start a mission. Direct inspection of all three delivered
packages showed the same file in each:

```js
// content.js
const VERSION = "0.10.10";
```

against

```js
// lib/contracts.mjs
export const CONTENT_SCRIPT_VERSION = "0.10.11";
```

`content.js` in every v0.10.11 package had SHA-256
`3a6408a96b316c84538fc281d04a28907a9893681e46fe7331ceedd87cd55959` — byte-identical
to v0.10.10.

`ensureContentScript()` injects the packaged `content.js`, pings it, and rejects
the bridge unless the reported version equals `CONTENT_SCRIPT_VERSION`. Both
`LINK_ACTIVE_TAB` and Autostart therefore failed with:

> Content bridge kunde inte verifieras — förväntad 0.10.11, observerad 0.10.10.

The export's end state has `run: null`, `activeMissionId: null`, no missions,
`selectedTabId: null`, `surfacePair: EMPTY`. Nothing downstream — catch, baseline
prompt, Nano track control, core review — could start. Reloading the tab does not
help: the reinjected file reports 0.10.10 again.

## Root cause

The runtime version is duplicated by necessity. `content.js` is a classic content
script; it cannot `import` `lib/contracts.mjs`, so it must carry its own literal.
v0.10.11 bumped `APP_VERSION` and `CONTENT_SCRIPT_VERSION` and left the literal
behind, and **nothing in the release pipeline compared the two values**.

## Why every gate passed

Four gates ran, and each was correct within its own scope while collectively
proving nothing about the property that mattered.

1. **The validator** checked that `CONTENT_SCRIPT_VERSION` in `contracts.mjs` was
   the expected string. It compared the constant to itself. It never opened
   `content.js`.

2. **The package hash manifest** verified 154/154 files. It was cryptographically
   correct and semantically empty here: it proved the wrong file had been packaged
   unchanged. A content-addressed manifest cannot detect a semantic version skew —
   that is not what it measures.

3. **Two tests codified the defect.** Both were named for the property they failed
   to check:

   ```js
   // v090-wp14-release: "synchronizes package, manifest and runtime versions"
   // v075-regressions:  "reports the same version across all bridge and UI runtime surfaces"
   assert.equal(CONTENT_SCRIPT_VERSION, "0.10.11");
   assert.match(read("content.js"), /const VERSION = "0\.10\.10";/);
   ```

   A hard-coded literal on both sides of an equality is not an equality check. When
   the contract moved and the literal did not, the assertions kept passing because
   each was pinned independently.

4. **The v0.10.11 runtime harness could not have caught it.** `createFakePage`
   accepted `contentScriptVersion` as a parameter and the integration test passed
   `CONTENT_SCRIPT_VERSION` from the contract. The fake bridge therefore always
   agreed with the background by construction. The harness executed the *background*
   for the first time — a real advance — but it never executed the *bridge*, and it
   sourced the one value in dispute from the wrong side.

The unifying failure: every gate verified a value against another copy of itself,
and none asked the shipped artifact what it actually was.

## Secondary defect

Autostart begins `LanguageModel.create()` inside the operator gesture, as the
v0.9.11 activation law requires. When the subsequent bridge handshake failed, the
catch branch called `abortNanoHostCreate()` with its default reason,
`OPERATOR_ABORT`, and the Nano host recorded "avbröts av operatören". The export
therefore attributed to the operator an abort caused by a failed precondition,
which is why the Nano aborts in the export looked like user action.

## Fixes

1. `content.js` carries the current version.
2. `lib/release-identity.mjs` owns the five-surface equality as a pure function.
3. The validator parses and compares the literal.
4. The package script refuses to build on mismatch, before staging, and re-checks
   the staged copy.
5. `tests/v01012-release-identity.test.mjs` boots the real content bridge under a
   DOM stub and asks it `EIC_PING`, including the copy extracted from the built
   browser ZIP.
6. The harness derives the bridge version from the shipped `content.js`.
7. Autostart rollback is `AUTOSTART_PRECONDITION_FAILED`; a synchronous
   precondition check runs before native activation.

## Standing consequence

v0.10.11's dispatch and liveness changes remain unproven in a live Chrome runtime.
They pass the executed harness, but the field acceptance in
`DESKTOP_CHROME_ACCEPTANCE_V0_10_12.md` sections A–E is the first real test of
them, because v0.10.11 never reached mission creation.
