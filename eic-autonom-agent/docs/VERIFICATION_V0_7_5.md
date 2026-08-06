# Verifiering — v0.7.5

## Automatiska kontroller

- `node --test tests/*.test.mjs`
- `node scripts/validate.mjs`
- `node scripts/package.mjs`
- CRC-kontroll av installations- och käll-ZIP
- statisk runtime-sökning efter `chrome.tabs.create`, `createAndLinkNewSessionTab` och `createNewTab`

## Förväntat utfall

- 341 tester, 0 fel
- `VALIDATE PASS`
- inga runtime-träffar på nyfliksvägen
- manifestversion, package-version, APP_VERSION och CONTENT_SCRIPT_VERSION = `0.7.5`
- oförändrad permissions- och host-permissions-allowlist

## Specifika regressioner

1. Båda startkommandona använder samma valda, kopplade flik.
2. Kritiska effekter degraderas inte av Workbench-ord.
3. Historisk trailer i kodblock påverkar inte auditeventplacering.
4. 16 stora stängda blockerare orsakar inte permanent saturation.
5. ChatGPT-root med query promoveras till conversation locator.
6. Submit-preflight använder senaste meddelanderoll.
7. Sektionsbudgetens summa överstiger aldrig `variableChars` för intervallet 0–3000.
8. Auditevent strippas före projection; malformed event tas ur Nano-input.
9. Mjölnar blockerar dubblett från `DELEGATED_PENDING_DISPATCH`.
10. Dedupe återställer kronologisk ordning.
11. Startprompten förifyller inte stark owner-readback.
12. Emergency projection trim kan gå under mjukt floor.
