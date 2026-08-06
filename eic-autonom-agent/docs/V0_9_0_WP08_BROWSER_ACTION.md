# v0.9.0 WP08 — Structured browser action contract

## Scope

WP08 introduces the parser, validator, exactly-once dispatch barrier and bounded executor for
`EIC_BROWSER_ACTION/1`. It does not implement the WP09 ChatGPT controller loop or screenshot
attachment.

## Protocol

A response contains zero or exactly one standalone marker:

```text
EIC_BROWSER_ACTION/1
```json
{
  "protocol": "EIC_BROWSER_ACTION/1",
  "schemaVersion": 1,
  "actionId": "action-...",
  "turnId": "turn-...",
  "observationId": "browser-observation-...",
  "observationDigest": "<sha256>",
  "operation": "click",
  "target": {
    "tabId": 1,
    "surfaceId": "surface-...",
    "documentEpoch": "epoch-...",
    "origin": "https://example.com",
    "elementRef": "el-..."
  },
  "args": {},
  "expectedEffect": "Open the selected item"
}
```
```

The outer marker is counted only as a standalone line; the protocol field inside JSON does not
count as a second action.

## Fixed registry

`observe`, `scroll`, `click`, `double_click`, `focus`, `type`, `clear`, `select`, `check`,
`uncheck`, `keypress`, `navigate`, `back`, `forward`, `reload`, `wait_for`, `capture`.

No target content, prompt text or model response can add operations.

## Grounding

`EIC_BROWSER_OBSERVATION/1` is generated from an accessibility tree. Interactive elements receive
deterministic refs bound to `surfaceId`, `documentEpoch` and `backendDOMNodeId`. The observation is
SHA-256 sealed, expires after 30 seconds and contains no field values. Sensitive field names are
redacted and such fields cannot receive `type` or `clear`.

## Exactly-once execution

Before CDP dispatch, background writes a bounded `PENDING_DISPATCH` entry with actionId and turnId.
This entry is persisted through the runtime owner route before any effect. Any reuse of either ID
is rejected. A crash after the barrier therefore blocks replay rather than risking a duplicate
effect.

## Executor boundary

Allowed CDP families are Accessibility, DOM, Input and Page. The executor explicitly denies
Runtime evaluation/function calls, response-body/post-data reads, request interception and cookie
writes. Navigation is same-origin only.

## Evidence

Observations and action receipts use explicit bounded evidence classes. Screenshot bodies remain
session-only and require decoded-byte digest plus body readback under the WP07 contract.

## Claim boundary

Node tests and source/package verification prove contract behavior in the isolated copy. They do
not prove a live target action, installed extension, Desktop Chrome runtime, ChatGPT attachment,
repository persistence, release or deployment.
