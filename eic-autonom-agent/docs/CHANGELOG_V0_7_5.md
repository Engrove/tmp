# Changelog — v0.7.5

## Changed

- Båda startknapparna kräver en användarförberedd, kopplad och vald ChatGPT-session.
- Automatisk nyfliksskapning och `createNewTab`-flaggor är borttagna.
- UI-copy och README beskriver den nya sessionsinvarianten.
- Auditparsern delar canonical trailer-normalisering med ordinarie EIC-parser.
- Auditevent strippas före Nano-komprimering.
- Root-queryparametrar ignoreras i pre-conversation identity.
- Workbenchklassificeringen får inte sänka högre risknivåer.
- Continuity-kompaktering hanterar stora stängda blockerare och återställer tidsordning.
- Nano-budgeten är strikt additiv.
- Submit-preflight skickar senaste message role.
- Mjölnars pending-status ingår i dubblettgrinden.
- Readbackmallen förifyller inte `READBACK_VERIFIED`.
- Projectionens emergency pass kan trimma optional lists under mjukt floor.

## Added

- `tests/v075-regressions.test.mjs`
- v0.7.5 RCA-, verifierings-, changelog- och desktopacceptansdokument.

## Unchanged

- Manifest V3.
- Permissions och host permissions.
- EIC_APP_AUDIT_EVENT/1 och EIC-AA/3-trailern.
- SQLite-ledgern ligger utanför addonen.
- Target-session-claims blir inte verified facts.
