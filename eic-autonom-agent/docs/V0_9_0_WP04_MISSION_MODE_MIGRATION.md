# v0.9.0 WP04 — Mission mode migration

## Purpose

WP04 migrates the four executable v0.8.2 start flows into the versioned Mission domain without
starting WP05 controller/target pairing or WP06 browser permissions.

## Closed mode surface

The standard build exposes these Mission modes:

- `CHATGPT_CONTINUATION`
- `CHATGPT_NEW_SESSION`
- `APP_AUDIT_LONG`
- `ARCHAEOLOGY_LONG`

`AI_WEB_RESEARCH` remains a registered, disabled browser-profile mode.

## Execution ownership

Mission is the execution owner from WP04.

The existing v0.8.2 run object remains temporarily as the bounded `LEGACY_RUN_V8` adapter because
the mature continuation, Nano, audit and archaeology engines still operate on that structure.
Every newly started run is created from a validated Mission request, receives one `missionId`, and
is synchronized back into exactly that Mission record. A Mission/run mode mismatch blocks
fail-closed.

This is an internal compatibility adapter. It is not a second execution authority and it does not
permit the legacy panel to bypass Mission validation.

## UI contract

The panel sends one start command:

`START_MISSION { modeId, input }`

The mode registry owns labels, panel identity, enabled state and legacy-adapter mapping. The old
four start commands remain in the background command registry only as bounded hot-reload and
backward-compatibility aliases; the WP04 panel does not emit them.

The `Uppdrag` view contains the closed mode selector and the four migrated standard-mode forms.
The persistent action dock starts the selected Mission. The browser-only mode is visible as
disabled so its absence cannot be mistaken for an unregistered mode.

## Control migration

All 44 interactive v0.8.2 controls remain present exactly once.

- Run status, Nano host and boundary approval: `Körning`
- Linked ChatGPT tabs and legacy selected target: `Webbytor`
- Mjölnar status and event log: `Evidens`
- Four executable Mission modes and disabled AI web mode: `Uppdrag`
- Mandates, continuity, autonomy, Mjölnar rollout and data/recovery: `Inställningar`

WP05 still owns explicit controller/target pairing. `selectedTabId` is only the legacy adapter
target in WP04.

## Preserved boundaries

- Package/application version remains `0.8.2`.
- Config/runtime/export/Mission/uiSnapshot schemas remain v9/v9/v11/v1/v2.
- Standard permissions and host permissions remain unchanged.
- No `debugger`, CDP, general website access, origin grants or browser actions.
- No arbitrary JavaScript execution.
- No Desktop Chrome rendering or runtime claim is made by source tests.
- WP05 has not started.

## Verification contract

WP04 requires:

1. focused Mission migration tests;
2. full regression;
3. static validator;
4. background service-worker smoke;
5. JavaScript/MJS syntax checks;
6. build-info hash verification;
7. source/install ZIP CRC and unsafe-entry checks;
8. exact source delta and immutable package hashes outside this source-contained document.
