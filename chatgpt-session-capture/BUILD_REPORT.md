# Build and verification report

Version: **1.1.1**

## Defect reproduced from the supplied screenshot

The popup showed an active capture with one lifecycle record, followed by:

```text
Content script did not respond: Could not establish connection. Receiving end does not exist.
```

The root cause was deterministic: version 1.1.0 relied on statically declared content scripts. Chrome injects those scripts when a matching document loads, but an already-open ChatGPT document does not receive a newly installed or reloaded extension's static scripts until the page itself reloads. Because the user's minimal profile deliberately had **Reload tab after start** disabled, the background worker created an active session without first proving that the tab had a message receiver.

## Corrective implementation

- Added the Manifest V3 `scripting` permission.
- Added a `PING_CONTENT` readiness probe.
- Added programmatic injection of `main-hook.js` into the MAIN world.
- Added ordered programmatic injection of `lib/capture-core.js` and `bridge.js` into the ISOLATED world.
- Added idempotent readiness verification after injection. Existing guards in `main-hook.js` and `bridge.js` prevent duplicate installation.
- `startCapture()` now verifies the receiver before creating or activating the capture.
- `sendToTabWithRetry()` now performs automatic reinjection and retries instead of waiting on a permanently missing receiver.
- Optional page-state capture is routed through the background controller so it uses the same repair path.

## Static validation

- `manifest.json` parsed successfully as JSON.
- Manifest version is 1.1.1 and includes `scripting`.
- Every JavaScript file passed `node --check`.
- Chromium successfully packed the final Manifest V3 source tree.
- The source contains no external JavaScript dependencies, analytics endpoints or telemetry endpoints.

## Regression validation

A local API-harness test exercised the new control flow with a simulated tab whose first `PING_CONTENT` call failed with `Receiving end does not exist`. The harness verified that:

- MAIN-world injection is requested once;
- ISOLATED-world injection is requested once with `capture-core.js` before `bridge.js`;
- readiness is re-probed after injection;
- the requested sweep message is sent only after readiness succeeds;
- an injection/readiness failure is surfaced before a new capture can be marked active.

The existing transcript extraction and compact-export implementation is unchanged from 1.1.0.
