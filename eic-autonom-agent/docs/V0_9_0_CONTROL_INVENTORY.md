# v0.9.0 control inventory

## Baseline scope

Source: exact v0.8.2 files `sidepanel.html`, `sidepanel.js` and `background.js`.

- Top-level UI sections: 11.
- DOM elements with IDs: 110.
- Interactive elements with IDs: 44.
- Background command cases: 35.
- Current UI architecture: one long feature stack with status, Nano, tab selection, three
  instruction surfaces, start modes, autonomy, specialized modes, boundary approval, Mjölnar,
  data/recovery and event log.

## Migration rule

Every interactive baseline control must end in one of four states during WP03–WP04:

1. retained in a Mission Control view;
2. represented by a mission-mode template;
3. moved to advanced settings;
4. intentionally replaced with a documented compatibility adapter.

No control may disappear silently.

## Interactive controls

| Current section | ID | Element | Current purpose/label |
|---|---|---|---|
| Körstatus | `refreshButton` | button/button | Uppdatera |
| Nano | `activateNanoButton` | button/button | Kontrollera / aktivera Nano |
| Flikkoppling | `linkActiveTabButton` | button/button | Koppla aktiv flik |
| Flikkoppling | `detachActiveTabButton` | button/button | Koppla bort aktiv flik |
| Flikkoppling | `linkedTabSelect` | select | Ingen kopplad flik |
| Kärnytor | `scenarioPreset` | select | Snabbprofil för hela appen Väljer kompatibla standardprofiler för kärnyta 1–3 |
| Nano | `nanoMandateProfile` | select | Standardläge för Nano-kärnmandat |
| Nano | `nanoMandate` | textarea | 1. Nano only — kärnmandat och stående regel Privat för Nano · skickas aldrig till målsessionen |
| Körstatus | `targetMandateProfile` | select | Standardläge för målsessionens kärnmandat |
| Körstatus | `targetMandateVersion` | input/text | Målmandatets version |
| Körstatus | `targetAuthorityScope` | select | Normal AI-session EIC-session |
| Körstatus | `targetMandate` | textarea | 2. EIC/AI only — målsessionens kärnmandat Infogas som header i varje Nano-levererad prompt |
| Kärnytor | `continuityViewProfile` | select | Visningsläge för kontinuitetsdata |
| Kärnytor | `continuityData` | textarea | 3. Nano — kontinuitetsdata Kompakt vad/varför-transkript · verifierade fakta separeras från inferenser |
| Ny session | `newSessionPrompt` | textarea | Ny sessions engångsstartprompt |
| Ny session | `startNewSessionButton` | button/button | Starta Ny Session |
| Autonom kontroll | `maxAutonomousMode` | input/checkbox | — |
| Körstatus | `backgroundWaitEnabled` | input/checkbox | — |
| Autonom kontroll | `maxTurns` | input/number | — |
| Autonom kontroll | `responseTimeout` | select | 30 minuter 60 minuter 120 minuter 180 minuter 240 minuter |
| ARCHAEOLOGY_LONG | `archaeologyScenario` | select | — |
| ARCHAEOLOGY_LONG | `archaeologyQuestion` | textarea | Vilken exakt fråga ska undersökas eller reverse-engineeras? |
| ARCHAEOLOGY_LONG | `archaeologyContext` | textarea | System, generation, källor, miljö, read-only-gränser och kända locators. |
| ARCHAEOLOGY_LONG | `archaeologyAllowWorkspaceEvidence` | input/checkbox | — |
| ARCHAEOLOGY_LONG | `archaeologyAllowExport` | input/checkbox | — |
| Övrigt | `startArchaeologyButton` | button/button | Starta ARCHAEOLOGY_LONG |
| APP_AUDIT_LONG | `appAuditTestNeed` | textarea | Kort beskrivning av vad som ska testas. |
| APP_AUDIT_LONG | `appAuditContext` | textarea | App, miljö, begränsningar och relevanta testuppgifter. |
| APP_AUDIT_LONG | `appAuditTargetReadOnly` | input/checkbox | — |
| APP_AUDIT_LONG | `appAuditAllowWorkbenchFiles` | input/checkbox | — |
| APP_AUDIT_LONG | `appAuditAllowForgejoSink` | input/checkbox | — |
| Övrigt | `startAppAuditButton` | button/button | Starta systematisk granskning |
| Körkontroll | `startWaitingButton` | button/button | Start/Continue i vänteläge |
| Körstatus | `pauseButton` | button/button | Pausa addon |
| Körkontroll | `resumeButton` | button/button | Återuppta |
| Körkontroll | `stopButton` | button/button | Stoppa addon |
| Gränsbeslut | `boundaryJustification` | textarea | Ange varför denna exakta åtgärd är auktoriserad. |
| Gränsbeslut | `authorizeBoundaryButton` | button/button | Auktorisera denna exakta gräns och fortsätt |
| Mjölnar | `mjolnarEnabled` | input/checkbox | — |
| Mjölnar | `mjolnarRolloutMode` | select | Shadow — ingen dispatch D0 live — rutin/read/reconnect D1 live — registrerade rollback/readback-actions D2 live — auth/permissions/merge/release/deploy |
| Data/recovery | `exportButton` | button/button | Exportera |
| Data/recovery | `importInput` | input/file | — |
| Data/recovery | `resetWindowButton` | button/button | Återställ fönsterkontext |
| Logg | `clearLogButton` | button/button | Rensa |

## Background command surface

The v0.8.2 panel sends `EIC_UI_COMMAND` with a `command` value. Current background commands:

`ADD_AUDIT`, `AUTHORIZE_BOUNDARY`, `AUTH_OWNER_ROUTE`, `CHANGE_PERMISSION`, `CLEAR_AUDIT`, `CREATE_RELEASE`, `DEPLOY_PRODUCTION`, `DETACH_SELECTED_TAB`, `GET_SNAPSHOT`, `IMPORT`, `LINK_ACTIVE_TAB`, `MERGE_BRANCH`, `NANO_CLAIM`, `NANO_DECISION`, `NANO_FAILURE`, `NANO_HEARTBEAT`, `NANO_HOST_STATE`, `PAUSE`, `RECONNECT_CONTENT`, `REFRESH`, `REFRESH_TAB_STATUS`, `RELOAD_SELECTED_TAB`, `RESET_WINDOW`, `RESTORE_AUTO_DISCARDABLE`, `RESUME`, `RESUME_VERIFIED_MARKER`, `SAVE_CONFIG`, `SELECT_TAB`, `SET_AUTO_DISCARDABLE_FALSE`, `SET_TARGET_MODE`, `START_APP_AUDIT`, `START_ARCHAEOLOGY`, `START_NEW_SESSION`, `START_WAITING`, `STOP`

Commands that are mock/owner-route-oriented (`AUTH_OWNER_ROUTE`, `CHANGE_PERMISSION`,
`CREATE_RELEASE`, `DEPLOY_PRODUCTION`, `MERGE_BRANCH`) are not evidence that those external effects
exist or succeeded. Their actual runtime path must remain bounded.

## Current rendering/data outputs

The panel renders:

- run/window state and recovery;
- Nano host and pipeline telemetry;
- linked ChatGPT tabs and one `selectedTabId`;
- mandate/profile/continuity configuration;
- specialized-mode progress;
- destructiveness/boundary decisions;
- Mjölnar state;
- audit/event log.

## Planned Mission Control placement

| Target view | Baseline responsibilities |
|---|---|
| Körning | run status, current/next action, pause/blocker, state-specific controls |
| Webbytor | linked tabs, controller/target roles, origin and browser/CDP state |
| Evidens | audit log, receipts, screenshots, DOM/AX, console and network |
| Uppdrag | new session, waiting continuation, APP_AUDIT_LONG, ARCHAEOLOGY_LONG, AI_WEB_RESEARCH |
| Inställningar | mandates, continuity inspection, autonomy, Mjölnar, data and recovery |

WP01 must introduce a pure snapshot/command boundary before visual restructuring.

## WP04 final migration result

The 44 baseline interactive controls remain present exactly once. Their final WP04 placement is:

| View | Controls/responsibility |
|---|---|
| Körning | run/Nano status, refresh, local level-10 boundary authorization |
| Webbytor | link, detach, select and legacy target-mode controls |
| Evidens | Mjölnar state/receipts and event log |
| Uppdrag | closed Mission selector, continuation, new session, APP_AUDIT_LONG, ARCHAEOLOGY_LONG and disabled AI_WEB_RESEARCH |
| Inställningar | three mandate/continuity surfaces, autonomy, timeout, Mjölnar rollout, export/import/reset |

The panel emits `START_MISSION` for every executable mode. The four historical start commands are
retained only as background compatibility aliases and route through the same Mission validator.
No baseline control is silently removed.



## WP05 delta

The 44 v0.8.2 baseline controls remain present exactly once. WP05 adds two explicit
surface controls in the Webbytor view:

- `bindActiveWebTargetButton`
- `detachWebTargetButton`

These controls bind or detach identity/lifecycle only. They do not request origin
permissions and do not open a debugger/CDP session.
