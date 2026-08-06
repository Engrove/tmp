# v0.9.0 WP06 — dual builds, exact origin permission and bounded CDP

## Scope

WP06 adds the privilege boundary required before browser evidence or action work:

1. one source tree produces separate standard and browser install packages;
2. the standard package remains restricted to the existing ChatGPT/OpenAI origins;
3. the browser package adds `debugger` and optional, not required, web origins;
4. permissions are requested for one exact target origin;
5. the CDP session is identity-bound and fail-closed.

WP07 evidence capture is explicitly out of scope.

## Build profiles

### STANDARD

- `permissions`: `sidePanel`, `storage`, `tabs`, `scripting`, `alarms`
- required hosts: only `https://chatgpt.com/*` and `https://chat.openai.com/*`
- no `debugger`
- no `optional_host_permissions`
- web-target permission and CDP controls render unavailable

### BROWSER

- all standard permissions plus `debugger`
- the same required ChatGPT/OpenAI hosts
- optional hosts: `http://*/*`, `https://*/*`
- no general required website host
- runtime detection rejects mixed or malformed privileged manifests

## Exact-origin permission contract

The operator binds a `WEB_TARGET`, then explicitly requests its current origin. The request body
contains one pattern, for example `https://example.org/*`. Readback through
`chrome.permissions.contains` is mandatory before the surface is marked `GRANTED`.

Revocation first detaches the bounded CDP session, removes the exact origin and verifies absence by
readback.

## Bounded CDP contract

Attachment requires all of:

- browser build profile;
- a bound `WEB_TARGET`;
- lifecycle `READY`;
- exact-origin permission readback;
- stable `tabId`, `surfaceId`, `documentEpoch` and origin.

WP06 calls only `chrome.debugger.attach` and `chrome.debugger.detach`. It does not call
`sendCommand`; DOM/AX, screenshots, console and network belong to WP07.

The session is invalidated or detached on target navigation, reload, replacement, close, move,
origin revocation, window close, Chrome detach notification or service-worker/session identity loss.

## Verification boundary

Node contracts, source wiring, background smoke, package manifests, build-info hashes and ZIP
integrity are source/package evidence. They are not Desktop Chrome attachment or permission-dialog
acceptance.
