# Changelog v0.10.12

Release-identity hotfix. v0.10.11 could not start a mission at all: its content
bridge identified itself as `0.10.10` while the background required `0.10.11`,
so `ensureContentScript` rejected the bridge on every `LINK_ACTIVE_TAB` and
every Autostart, before a run was ever created. The v0.10.11 dispatch and
liveness work was therefore never exercised in a real runtime.

## Fixed

- `content.js` now carries the current runtime version. The literal
  (`const VERSION`) cannot be imported from the contract, because a classic
  content script cannot import a module — so it is now **compared** to it.
- Added `lib/release-identity.mjs`: one pure owner for the five version surfaces
  (`package.json`, `manifest.json`, `APP_VERSION`, `CONTENT_SCRIPT_VERSION`, and
  the `content.js` literal). The validator, the package script and the test suite
  all apply the identical rule to the same values.
- `scripts/package.mjs` refuses to build when identity is inconsistent, before
  anything is copied, and re-verifies the staged `content.js` against the staged
  manifest. A per-file SHA-256 manifest cannot catch this class: it faithfully
  records the wrong file.
- `scripts/validate.mjs` parses the `content.js` literal and compares it, instead
  of only checking the contract constant against itself.
- Corrected two tests that codified the defect. `v090-wp14-release` ("synchronizes
  package, manifest and runtime versions") and `v075-regressions` ("reports the
  same version across all bridge and UI runtime surfaces") both asserted a
  hard-coded `const VERSION = "0.10.10";`. Both now compute the equality their
  names promise.
- Autostart rollback is classified as `AUTOSTART_PRECONDITION_FAILED` with its own
  stale reason and detail. v0.10.11 called `abortNanoHostCreate()` with the default
  reason, so a failed bridge handshake was recorded as "avbröts av operatören" —
  blaming the operator for an abort they never requested.
- Autostart runs a **synchronous** precondition check inside the operator gesture
  before `LanguageModel.create()`: no ChatGPT tab selected, or a selected tab on an
  unsupported host, now aborts before a model activation is spent. The bridge
  handshake still runs after create(), because the v0.9.11 activation law forbids
  an await before it.

## Added

- `tests/helpers/fake-dom.mjs` and `tests/v01012-release-identity.test.mjs`: the
  content bridge is now **executed** and asked `EIC_PING`. The suite also extracts
  `content.js` from the built browser ZIP and pings that copy when a build is
  present.
- A negative fixture that reproduces v0.10.11's exact skew and asserts the gate
  rejects it.

## Fixed in the harness

- `createFakePage()` derives its bridge version from the shipped `content.js`
  instead of accepting `CONTENT_SCRIPT_VERSION` as a parameter. The v0.10.11
  harness passed the contract value in, so the fake bridge always agreed with the
  background by construction and could not have detected this skew. The
  integration suite now fails on a drift exactly where Chrome does.

## Preserved

- Everything delivered in v0.10.11: in-band deterministic dispatch, owned dispatch
  failures, the bounded re-arm budget, the delivered-turn invariant, session-context
  liveness with the bounded operator retry, and capture backoff. None of it changed;
  it is simply reachable now.
- The v0.9.11 activation law: native `create()` still runs in the operator click
  before the first await.
