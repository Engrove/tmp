# WP02 — Mission domain, mode registry and persistence schema

## Status

Implemented in the isolated WP02 working copy. This gate defines the durable Mission domain and its
compatibility bridge. It does not redesign the side panel and does not enable browser control.

## Inputs

- Verified WP01 source candidate:
  `0c1821271a35cbcdfc07504b9a4c5cbda5d6e0af789e0c427e955bceba698a04`.
- Explicit operator approval: `Godkänt`, interpreted from the immediately preceding WP01 gate as
  approval to start WP02.
- Governing development contract: `EIC.md`.
- Requirement boundary from the transcript and WP00 state map.

## Mission domain

A mission is a durable, versioned record with:

- `missionId`, `modeId`, lifecycle `state` and `stateRevision`;
- `currentStep` and `nextAction`;
- explicit `controllerSurfaceId` and `targetSurfaceId`;
- policy profile, origin grants, risk and approval state;
- bounded evidence policy, evidence index and receipts;
- recovery state;
- a compatibility binding to the current v0.8.2 run while that run remains execution owner.

Schemas:

- `eic.autonom.mission.v1`
- `eic.autonom.mission-store.v1`
- `eic.autonom.mission-view.v1`

## Closed mode registry

| Mode | Build profile | Required surface roles | WP02 status |
|---|---|---|---|
| `CHATGPT_CONTINUATION` | STANDARD | `CHATGPT_CONTROLLER` | enabled |
| `CHATGPT_NEW_SESSION` | STANDARD | `CHATGPT_CONTROLLER` | enabled |
| `APP_AUDIT_LONG` | STANDARD | `CHATGPT_CONTROLLER` | enabled |
| `ARCHAEOLOGY_LONG` | STANDARD | `CHATGPT_CONTROLLER` | enabled |
| `AI_WEB_RESEARCH` | BROWSER | `CHATGPT_CONTROLLER`, `WEB_TARGET` | disabled until later browser gates |

Unknown mode identifiers fail closed.

## Mission lifecycle

The closed lifecycle is:

`DRAFT`, `READY`, `RUNNING`, `WAITING_TARGET`, `WAITING_EVIDENCE`, `RECOVERING`,
`PAUSED`, `BLOCKED`, `COMPLETED`, `FAILED`, `CANCELLED`.

Transitions are allowlisted. Unknown states and disallowed transitions throw instead of being
coerced into forward progress. Unknown legacy run states map to `BLOCKED`.

## Persistence schema

WP02 advances:

- config: `eic.autonom.config.v9`;
- runtime: `eic.autonom.runtime.v9`;
- export: `eic.autonom.export.v11`;
- audit: `eic.autonom.audit.v9`;
- window context: `eic.autonom.window-context.v7`;
- UI snapshot: `eic.autonom.ui-snapshot.v2`.

Runtime v9 adds a normalized `missionStore`. Each window adds `activeMissionId` and `missionIds`.
The v8→v9 migration preserves the legacy run, continuity and existing configuration fields, then
creates one mission binding for each active run.

## Compatibility ownership

The legacy v0.8.2 run remains the execution owner through WP02. Before runtime persistence, its
current mode and state are projected into the bound Mission record. Mission identity remains stable
for the same `runId`.

`selectedTabId` is not reinterpreted as a generic web target. It is retained only inside the legacy
binding until WP05 introduces explicit controller/target surface objects.

## Export and import

The v11 export includes the window-scoped Mission view. Import accepts v3 through v11. A v11 Mission
view is schema-validated, bounded and rebound to the current window. Earlier exports remain accepted
through the existing migration chain.

## Security boundaries

- `AI_WEB_RESEARCH` is registered but disabled.
- No browser action registry is activated.
- No arbitrary JavaScript, cookies or request mutation is introduced.
- No new permission, host permission or optional origin grant is introduced.
- Evidence response bodies default to disabled and redaction-before-persist is required.

## Non-goals

- No Mission Control visual redesign.
- No navigation shell or action dock; those belong to WP03.
- No migration of existing UI features into missions; that belongs to WP04.
- No controller/target lifecycle implementation; that belongs to WP05.
- No `debugger`, CDP, broad host access or browser executor.
- No Desktop Chrome runtime claim.

## Gate

WP02 is complete only after focused Mission tests, full regression, validation, syntax checks,
packaging and ZIP integrity pass. WP03 remains blocked until explicit operator approval.
