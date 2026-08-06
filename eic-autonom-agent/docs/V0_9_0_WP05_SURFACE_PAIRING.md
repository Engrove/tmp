# v0.9.0 WP05 — controller/target pairing and tab lifecycle

## Scope

WP05 materializes the explicit `CHATGPT_CONTROLLER` and `WEB_TARGET` roles without
starting WP06 permission or debugger work.

## Contract

- Pair schema: `eic.autonom.surface-pair.v1`.
- Surface schema: `eic.autonom.surface.v1`.
- One pair belongs to one Chrome window.
- One tab may own at most one role.
- Controller URLs are limited to the existing ChatGPT allowlist.
- Target URLs are limited to `http:` and `https:` and exclude ChatGPT.
- Surface identity survives navigation and tab replacement.
- Every navigation, reload/loading transition and tab replacement rotates the
  `documentEpoch`.
- Close, explicit detach and cross-window movement never cause automatic role takeover.
- Cross-window movement requires an explicit bind in the destination window.
- `WEB_TARGET.permissionState` remains `NOT_REQUESTED`.
- `WEB_TARGET.debuggerState` remains `NOT_AVAILABLE_WP05`.
- Standard Mission modes bind the controller only. The disabled `AI_WEB_RESEARCH`
  mode can resolve both surface IDs but cannot start.

## UI and commands

The Webbytor view exposes pair state, pair ID, role lifecycle, document epochs,
target origin and the WP05 permission/debugger boundary.

Two closed UI commands are added:

- `BIND_ACTIVE_WEB_TARGET`
- `DETACH_WEB_TARGET`

Existing ChatGPT linking continues to bind the controller role.

## Tab lifecycle

- `onActivated`: updates role activation flags only.
- `onUpdated`: updates metadata and rotates document epoch on navigation/loading.
- `onReplaced`: preserves `surfaceId`, adopts the new tab ID and rotates epoch.
- `onRemoved`: marks the role closed and does not select a replacement.
- `onDetached`/`onAttached`: marks movement and requires explicit rebind.
- window close archives the pair in `orphanedSurfacePairs`.

## Preserved boundaries

- Package and application version remain `0.8.2`.
- Standard permissions and host permissions are unchanged.
- No `chrome.debugger`, optional origin request, CDP, DOM/AX capture, screenshot,
  console, network or browser-action executor exists.
- `AI_WEB_RESEARCH` remains disabled.
- No Desktop Chrome runtime claim is made by source tests.

## Gate

WP05 is complete only after focused tests, full regression, validation, background
smoke, syntax checks, package identity and ZIP integrity pass. WP06 must wait for
explicit operator approval.
