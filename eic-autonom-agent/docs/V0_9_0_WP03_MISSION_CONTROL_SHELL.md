# v0.9.0 WP03 — Mission Control application shell

## Scope

WP03 introduces the visual application shell only:

- sticky Mission Control header;
- five keyboard-accessible views: `Körning`, `Webbytor`, `Evidens`, `Uppdrag`, `Inställningar`;
- a persistent action dock for the existing start/pause/resume/stop controls;
- read-only rendering of the active WP02 Mission summary and explicit surface-role fields;
- responsive layout for the Chrome side panel.

## Source boundaries

- `lib/mission-control-shell.mjs` owns the closed local view registry and navigation state.
- Navigation is panel-local presentation state. It is not written to `chrome.storage`.
- `uiSnapshot` remains the only runtime read boundary.
- The shell may render WP02 Mission fields but may not create, mutate or execute Missions.
- Existing v0.8.2 control IDs and command dispatch remain unchanged.

## View allocation in WP03

- `Körning`: status and Chrome Nano host.
- `Webbytor`: explicit `CHATGPT_CONTROLLER` / `WEB_TARGET` display and linked ChatGPT tabs.
- `Evidens`: Mjölnar status and the existing event log.
- `Uppdrag`: existing new-session, archaeology and app-audit controls.
- `Inställningar`: existing core mandates, continuity profiles and data/recovery.

This allocation is a visual shell. WP04 owns the semantic migration of all v0.8.2 features into Mission modes.

## Action dock

The existing controls keep their IDs and command handlers:

- `startWaitingButton`;
- `pauseButton`;
- `resumeButton`;
- `stopButton`.

WP03 only moves them into a sticky, always-visible dock. No command, permission, state-machine or persistence behavior changes.

## Accessibility contract

- Navigation uses `role=tablist`, `role=tab` and `role=tabpanel`.
- Exactly one view is active.
- Inactive panels are hidden.
- Arrow Left/Right, Home and End move and focus navigation.
- Selected tab state is reflected through `aria-selected` and `tabindex`.

## Non-goals

WP03 does not:

- migrate legacy functions into Mission execution;
- enable `AI_WEB_RESEARCH`;
- add controller/target pairing;
- add browser permissions, origin grants, debugger/CDP or general website access;
- change config/runtime/export/Mission/uiSnapshot schemas;
- change the package/application version;
- claim Desktop Chrome rendering or runtime acceptance.

## Gate

WP03 is source-gate complete only when:

1. the focused shell contract passes;
2. the full regression passes;
3. `npm run validate` passes;
4. JavaScript/MJS syntax checks pass;
5. package and ZIP integrity pass;
6. manifest, package, persistent contracts and background/content runtime remain unchanged;
7. WP04 remains blocked pending explicit operator approval.
