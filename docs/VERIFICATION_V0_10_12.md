# Verification v0.10.12

## Source identity

Baseline: v0.10.11, superseded before field acceptance. v0.10.11 could not create a
run, so nothing in it was exercised in a live Chrome; see
`V0_10_12_INCIDENT_ANALYSIS.md`.

## Release identity

| Surface | Value |
|---|---|
| `package.json` | 0.10.12 |
| `manifest.json` | 0.10.12 |
| `APP_VERSION` | 0.10.12 |
| `CONTENT_SCRIPT_VERSION` | 0.10.12 |
| `content.js` `const VERSION` | 0.10.12 |

Verified three ways: computed parity in the validator, refusal-to-build in the
package script, and an executed `EIC_PING` against the real content bridge —
including the copy extracted from the built browser ZIP.

## Executed gates

- v0.10.12 release-identity fixtures: **9/9 PASS** (1 skipped before packaging,
  executed after)
- v0.10.11 focused fixtures: **16/16 PASS**
- v0.10.11 executed runtime integration: **11/11 PASS**
- Full Node regression suite: **871/871 PASS**
- Static validator: **PASS**
- JavaScript/ES module syntax: **167/167 PASS**
- SOURCE package: **PASS**
- STANDARD package: **PASS**
- BROWSER package: **PASS**

## New class of coverage

`tests/v01012-release-identity.test.mjs` executes `content.js` under
`tests/helpers/fake-dom.mjs` and asks the bridge `EIC_PING`, applying the exact
comparison `ensureContentScript` performs. It also:

- reproduces v0.10.11's skew as a negative fixture and asserts the gate rejects it;
- treats a missing version literal as an error rather than a silent pass;
- extracts `content.js` from the built browser ZIP and pings that copy;
- asserts the package script refuses to build on mismatch, before staging.

Two pre-existing tests were corrected rather than re-pinned: `v090-wp14-release`
and `v075-regressions` both asserted a hard-coded `const VERSION = "0.10.10";`
alongside a hard-coded contract constant. Both now compute the equality their
names promise.

`tests/helpers/fake-chrome.mjs` no longer accepts the bridge version as a
parameter; `createFakePage()` reads it from the shipped `content.js`. The v0.10.11
harness sourced it from the contract, so the fake bridge agreed with the background
by construction and could not have detected this defect.

## Covered acceptance logic

- five-surface version parity, and its failure modes;
- the real content bridge booting, registering `onMessage`, and answering `EIC_PING`;
- `ensureContentScript`'s acceptance decision, evaluated against the shipped file;
- the packaged browser ZIP's bridge;
- the package script's pre-stage refusal;
- Autostart synchronous precondition verdicts (no tab, unsupported host, unknown
  URL, supported host);
- that no `await` precedes native `create()` in `autostartClick`;
- Autostart rollback classified as `AUTOSTART_PRECONDITION_FAILED` with a distinct
  stale reason and detail.

## Safety preservation

- The v0.9.11 activation law is intact: native `create()` still runs in the operator
  click before the first await. The new precheck is synchronous.
- All v0.10.11 behaviour is unchanged; this release makes it reachable.
- No migration or compatibility path was added; the v0.9.3 forward-only law stands.

## Runtime boundary

The content bridge is executed against a DOM **stub**, not Chrome. This proves the
bridge's identity and message contract. It does not prove DOM selector behaviour,
transcript capture against the real ChatGPT UI, or service-worker lifecycle
eviction. Those, and the still-unexercised v0.10.11 dispatch and liveness chain,
remain governed by `DESKTOP_CHROME_ACCEPTANCE_V0_10_12.md`.
