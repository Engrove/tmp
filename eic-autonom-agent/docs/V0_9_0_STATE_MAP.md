# v0.9.0 state map

## Current durable ownership after WP02

`chrome.storage.local` remains the durable state owner.

| Storage key | Schema/current shape | Purpose |
|---|---|---|
| `eicAutonomAgent.v3.config` | `eic.autonom.config.v9` | mandates, profiles, mode defaults, timeouts, Mjölnar and UI preferences |
| `eicAutonomAgent.v3.runtime` | `eic.autonom.runtime.v9` | revisioned per-window runtime plus normalized Mission store |
| `eicAutonomAgent.v3.continuity` | `eic.nano.continuity.v2` | legacy/global sealed continuity |
| `eicAutonomAgent.v3.continuityBackup` | continuity v2 | backup for recovery |
| `eicAutonomAgent.v3.audit` | `eic.autonom.audit.v9` | bounded event list |
| `eicAutonomAgent.v3.migrationBackup` | migration-dependent | rollback input |
| `eicAutonomAgent.v2` / `.v1` | legacy | migration sources |

## Runtime v9 tree

```text
runtime v9
├─ missionStore: mission-store v1
│  └─ missions[missionId]: mission v1
└─ windows[windowId]: window-context v7
   ├─ targetMode: FOLLOW | LOCKED
   ├─ selectedTabId
   ├─ linkedTabs[tabId]
   ├─ run: run v8 | null
   ├─ activeMissionId
   ├─ missionIds[]
   ├─ continuity / continuityBackup
   ├─ startPromptReceipts[]
   ├─ nanoHostTelemetry
   └─ lastActiveTabId
```

`selectedTabId` still means the selected ChatGPT target for the legacy continuation engine. It is not
a generic web target and is copied only into the Mission compatibility binding.

## Mission record v1

```text
mission
├─ missionId, modeId, state, stateRevision
├─ currentStep, nextAction
├─ controllerSurfaceId -> CHATGPT_CONTROLLER
├─ targetSurfaceId -> WEB_TARGET
├─ policyProfile, originGrants
├─ risk and approval state
├─ evidencePolicy, evidenceIndex, receipts
├─ recovery
└─ legacyBinding -> runId/runMode/runState/selectedTabId
```

WP02 stores explicit surface role fields but does not yet materialize the surface objects. That work
belongs to WP05.

## Closed mode registry

- `CHATGPT_CONTINUATION`
- `CHATGPT_NEW_SESSION`
- `APP_AUDIT_LONG`
- `ARCHAEOLOGY_LONG`
- `AI_WEB_RESEARCH`

The first four map to existing run modes. `AI_WEB_RESEARCH` is browser-profile-only and disabled
until the later permission, evidence, protocol and safety gates.

## Mission lifecycle

`DRAFT`, `READY`, `RUNNING`, `WAITING_TARGET`, `WAITING_EVIDENCE`, `RECOVERING`, `PAUSED`,
`BLOCKED`, `COMPLETED`, `FAILED`, `CANCELLED`.

Transitions are allowlisted. An unknown legacy run state maps to `BLOCKED`.

## Current run model

Legacy run modes remain:

- `WAITING_CONTINUE`
- `NEW_SESSION`
- `APP_AUDIT_LONG`
- `ARCHAEOLOGY_LONG`

Legacy run states remain:

`IDLE`, `PREPARING`, `WAITING_FOR_RESPONSE`, `WAITING_FOREGROUND`, `WAITING_BACKGROUND`,
`ASSESSING`, `CONTINUING`, `RECOVERING`, `SOFT_PAUSED`, `HARD_BLOCKED`, `DONE`, `STOPPED`,
`ERROR_RETRYABLE`, `ERROR_TERMINAL`, `MJOLNAR_ADJUDICATING`, `MJOLNAR_DISPATCH`,
`MJOLNAR_READBACK`, `HUMAN_REQUIRED`.

The run remains execution owner in WP02. Its state is synchronized into the bound mission before
persistence. WP04 will migrate existing behavior to Mission-owned execution.

## Current process ownership

| Process/surface | Responsibility |
|---|---|
| Background service worker | durable state transitions, tab lifecycle, continuation/effect dispatch and Mission reconciliation |
| Side panel | UI, local Nano host, config editing and snapshot rendering |
| ChatGPT content script | page observation, composer interaction and ChatGPT-specific bridge |
| `chrome.storage.local` | durable source of truth |
| alarms/tabs events | wake-up and lifecycle signals, not durable truth |

## Migration invariants

- v0.8.2 exports remain importable through the migration chain.
- v11 exports include a window-scoped Mission view.
- Existing run modes retain semantics through explicit Mission mappings.
- Continuity integrity and per-window scoping remain fail closed.
- Mission identity is stable for the same `runId`.
- `selectedTabId` remains backward-compatible for migrated ChatGPT controller state until WP05.
- Standard builds never materialize browser-only permission or CDP state.
- Unknown mission mode/state, stale document epoch, origin change, debugger detach or missing receipt
  must produce pause/block, not best-effort dispatch.
- Migration must remain reversible until WP14 release acceptance.

## UI/runtime boundary after WP02

```text
sidepanel DOM
└─ ui-runtime-client
   └─ EIC_UI_COMMAND / eic.autonom.ui-command.v1
      └─ background UI_COMMAND_HANDLERS
         ├─ runtime/storage owner operations
         └─ eic.autonom.ui-snapshot.v2
            └─ detached model: config, continuity, window, missions, audit
```

The command registry remains closed. The Mission view is exposed without visual redesign. WP03 owns
the new app shell.


## WP05 materialized surface state

Each window context now carries `surfacePair`:

- `pairId`, `pairState`, revision and timestamps;
- `CHATGPT_CONTROLLER`: stable identity, ChatGPT tab and conversation locator;
- `WEB_TARGET`: stable identity, target origin, no permission grant and no debugger;
- independent lifecycle and document epoch for each role;
- explicit movement/close/detach states with no automatic takeover.

`selectedTabId` remains the legacy ChatGPT/run selector. It is not the target identity.
