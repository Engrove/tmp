# v0.9.0 WP01 — UI/runtime boundary

## Status

Implementation scope for the manually approved WP01 gate.

WP01 establishes the contract used by the current v0.8.2 panel and the future Mission Control shell.
It does not create the Mission domain, change persistent storage schemas or redesign the visible panel.

## Scope

WP01 delivers three foundations:

1. a versioned `uiSnapshot` read model;
2. a closed, versioned UI command envelope and central dispatcher;
3. separation between DOM rendering and the Chrome runtime transport.

## uiSnapshot contract

Schema:

`eic.autonom.ui-snapshot.v1`

The background service worker remains the runtime and storage owner. It reads the durable bundle,
derives operator-facing fields such as the boundary identity and produces a detached snapshot:

```text
uiSnapshot
├─ schema, snapshotVersion, snapshotId, capturedAt
├─ appVersion, windowId
└─ model
   ├─ config
   ├─ continuity
   ├─ window
   └─ audit
```

The snapshot is cloned before it crosses the boundary. UI code cannot mutate background-owned
objects by changing the received model.

For one transition version, the snapshot also exposes `config`, `continuity`, `window` and `audit`
as legacy aliases. This keeps an already-open v0.8.2 side panel readable during extension reload.
New panel code reads only `model` through `readUiSnapshotModel()`.

## Command contract

Request schema:

`eic.autonom.ui-command.v1`

Result schema:

`eic.autonom.ui-command-result.v1`

A request contains routing metadata and a separate payload:

```json
{
  "type": "EIC_UI_COMMAND",
  "schema": "eic.autonom.ui-command.v1",
  "requestId": "ui-command-…",
  "command": "SELECT_TAB",
  "windowId": 7,
  "payload": {
    "tabId": 42
  }
}
```

The registry contains exactly the commands already supported by v0.8.2. Unknown commands and
unknown payload keys fail closed. Command results are bound to `requestId` and `command`.

All commands return a `uiSnapshot` except `NANO_HEARTBEAT`, which returns a bounded acknowledgement.
This prevents heartbeat traffic from being mistaken for a complete UI state read.

## Runtime dispatch

`background.js` owns a single `UI_COMMAND_HANDLERS` registry. `dispatchUiCommand()`:

1. validates schema, command, window identity and payload keys;
2. calls exactly one registered handler;
3. wraps the response as snapshot or acknowledgement;
4. preserves a one-version legacy path for a pre-WP01 panel message.

There is no `switch (message.command)` command router after WP01.

## Panel separation

`lib/ui-runtime-client.mjs` is the only panel transport adapter. The DOM layer:

- supplies the current Chrome window id;
- asks the client to dispatch a named command;
- receives a validated snapshot or acknowledgement;
- renders the snapshot read model.

The panel no longer builds `EIC_UI_COMMAND` envelopes or interprets result envelopes itself.

## Preserved invariants

- application and manifest version remain `0.8.2`;
- config/runtime/export/continuity schemas remain v8/v8/v10/v2;
- standard permissions and host permissions are unchanged;
- existing run modes, imports, exports and event handlers retain their behavior;
- background/storage remains the runtime owner;
- no browser target, general website permission, CDP session or browser action exists yet.

## Explicit non-goals

- **No Mission Control visual redesign in WP01.**
- No Mission domain or persistence migration; that belongs to WP02.
- No new navigation shell; that belongs to WP03.
- No migration of existing feature cards; that belongs to WP04.
- No controller/target pairing, permissions, CDP or browser execution.

## Gate evidence

WP01 requires:

- focused `v090-wp01-ui-boundary` tests;
- full `npm test`;
- `npm run validate`;
- syntax checks for changed JavaScript modules;
- a source delta proving manifest, package and persistent schema files are unchanged;
- updated execution ledger and machine-readable evidence.

## Claim boundary

WP01 source tests can verify the command and snapshot contracts and their source wiring. They do not
prove rendering in Desktop Chrome, service-worker update behavior in an installed profile or future
Mission Control behavior. Those claims require their later work-package and browser-owner evidence.
