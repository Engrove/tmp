# v0.10.12 architecture — release identity as a build gate

## The property that was missing

The runtime version exists on five surfaces:

| Surface | Owner | Consumed by |
|---|---|---|
| `package.json` `version` | npm | package/dist naming |
| `manifest.json` `version` | Chrome | extension identity |
| `APP_VERSION` | `lib/contracts.mjs` | UI, export, audit filenames |
| `CONTENT_SCRIPT_VERSION` | `lib/contracts.mjs` | `ensureContentScript` comparison |
| `const VERSION` | `content.js` | the value the injected bridge reports |

The last one cannot import the fourth: a classic content script has no module
scope. The duplication is structural and cannot be removed — so the *equality*
has to be computed somewhere. In v0.10.11 it was computed nowhere, and the two
values diverged. `ensureContentScript` compares exactly those two, so the
extension rejected its own bridge and no run could be created.

## Design

`lib/release-identity.mjs` is a pure module with no I/O:

```
parseContentScriptVersion(source) -> "0.10.12" | ""
evaluateReleaseIdentity({ five values }) -> { ok, version, surfaces, mismatches, errors }
```

Three consumers apply it to the same values:

1. **`scripts/validate.mjs`** — reads the five surfaces from disk and fails the
   validator on any mismatch or malformed value.
2. **`scripts/package.mjs`** — runs the same check *before* creating the dist
   directory or copying a single file, and re-verifies each staged `content.js`
   against its staged manifest. Packaging a version-inconsistent build is now
   impossible rather than merely discouraged.
3. **`tests/v01012-release-identity.test.mjs`** — asserts parity, asserts the gate
   rejects v0.10.11's exact skew, and asserts a missing literal is an error rather
   than a silent pass.

### Executing the bridge

Static parity is necessary but not sufficient: it still reasons about source text.
The decisive gate executes the shipped `content.js` and asks it who it is.

`tests/helpers/fake-dom.mjs` provides the minimum surface for the content script
to boot — `document`, `location`, `MutationObserver`, `getComputedStyle`,
`sessionStorage`, and a `chrome.runtime.onMessage` double that captures the
registered listener. The test then sends `{ type: "EIC_PING" }` and asserts the
answer equals `CONTENT_SCRIPT_VERSION`, which is the identical comparison
`ensureContentScript` performs in Chrome.

When a built browser ZIP is present, the same ping runs against the `content.js`
extracted from it, so the artifact that ships is the artifact that answered.

### Closing the harness blind spot

The v0.10.11 integration harness took the bridge version as a parameter and every
caller passed the contract constant. The fake bridge agreed with the background by
construction. `createFakePage()` now derives the version from the shipped
`content.js` via `contentScriptRuntimeVersion()`. A future drift makes
`LINK_ACTIVE_TAB` fail inside the integration suite exactly as it failed in the
field.

## Autostart precondition and abort attribution

Two separate defects shared one symptom.

**Attribution.** `abortNanoHostCreate(reason = "OPERATOR_ABORT")` was called with
the default from the Autostart rollback path, so a failed bridge handshake was
persisted as an operator abort. The reason now flows through:
`AUTOSTART_ABORT_REASON.AUTOSTART_PRECONDITION_FAILED` sets its own
`modelStaleReason` and a detail that states the operator did not abort.

**Ordering.** The v0.9.11 activation law requires `LanguageModel.create()` to run
in the operator click before the first `await`, so the bridge handshake — a
message round trip — cannot precede it. What can precede it is a synchronous read
of cached snapshot state. `evaluateAutostartPrecondition(windowContext)` returns a
verdict from `selectedTabId` and the linked tab's URL alone:

| Condition | Verdict |
|---|---|
| no selected tab | `NO_SELECTED_TAB`, abort before activation |
| selected tab on a non-ChatGPT host | `UNSUPPORTED_TARGET_HOST`, abort before activation |
| URL not yet known | pass; the async readback owns it |
| supported host | pass |

The remaining asynchronous preconditions still run after create(); they now
classify their rollback correctly instead of blaming the operator.

## Non-goals

- The literal in `content.js` is not generated at build time. Generated source
  would make the shipped file differ from the repository file, which defeats the
  hash manifest's actual purpose.
- No compatibility path is added. The v0.9.3 forward-only law stands.
