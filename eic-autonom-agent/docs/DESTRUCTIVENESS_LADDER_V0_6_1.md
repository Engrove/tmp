# EIC_DESTRUCTIVENESS/1 — nivåstege 1–10

## Beslutsregel

Endast nivå 10 leder till verkligt mänskligt beslut och runtime-PAUS. Nivå 6–9 kräver lokal deterministisk Hjalmar mental kontroll. Nivå 1–5 fortsätter autonomt. Direkt operatörs-Stop/Paus respekteras oberoende av skalan.

## Stege

| Nivå | Namn | Typiska effekter | Gate |
|---:|---|---|---|
| 1 | READ_ONLY | get/list/status/read/inspect/verify/query, färsk owner-read | Fortsätt |
| 2 | LOCAL_NAVIGATION | retry, poll, reconcile, navigation, wait | Fortsätt |
| 3 | LOCAL_RUNTIME_RECOVERY | reconnect content, reload tab, reinject, resume verified marker | Fortsätt |
| 4 | EPHEMERAL_WORKBENCH | Workspace/Workbench lock, lease, package, temp state | Fortsätt |
| 5 | BOUNDED_ENGINEERING_CHANGE | lokal sourcepatch, test, package, candidate branch, PR-preparation | Fortsätt |
| 6 | CORE_ADMIN_LOW | EIC backend core adminwrite utan runtimeavbrott | Hjalmar mental kontroll |
| 7 | CORE_RUNTIME_CONTROLLED | kontrollerad restart/reload av en core-tjänst | Hjalmar mental kontroll |
| 8 | CORE_HIGH_IMPACT_REVERSIBLE | core config/schema/migration, multi-service restart | Hjalmar mental kontroll |
| 9 | CORE_CRITICAL_REVERSIBLE | merge, release, deploy, permission/share, hög-impact admin | Hjalmar mental kontroll |
| 10 | HUMAN_AUTHORITY_REQUIRED | CAPTCHA/login/user-presence, secrets, permanent delete, no rollback, unknown blast radius, safety/policy/value decision | Verklig PAUS |

## Workbench-cap

Om texten gäller Workbench, Workspace, work package, flyktigt package, candidate branch, lock eller lease är nivån högst 5, även om ord som branch, force eller release förekommer. Capen upphävs endast av en separat nivå-10-signal, exempelvis secret, authentication eller irreversibel dataförlust.

## Hjalmar mental kontroll för nivå 6–9

Kontrollen kräver:

1. exakt mål;
2. owner route;
3. aktuellt mandat;
4. rollback;
5. readbackplan;
6. `materialAmbiguity = NONE`.

Alla sex ger `PASS`. Saknade fakta ger `READ_REQUIRED`, vilket innebär en autonom owner-read och ny bedömning. Det är inte ett externt Hjalmar PASS och får inte beskrivas som owner-verifiering.

## Scenarioanalys från det äldre WP25.2-transkriptet

Arkivet innehåller 50 browserfångade turer och har uttryckligen ofullständiga bilagekroppar/reasoninggränser. Klassificeringen nedan gäller synliga scenarier, inte dold state.

| Scenario | Nivå | Rätt beteende |
|---|---:|---|
| Färsk project/Forgejo/session/workspace owner-read | 1 | Läs och fortsätt |
| Fel bootstrapordning; carrier-free workspace.resolve behövs | 2 | Korrigera ordning, fortsätt |
| Vänta på ägande trusted session/lock expiry och återläs | 2–4 | Poll/reconcile; ingen mänsklig PAUS |
| Workspace lock, generation, lease, work package | 4 | Fortsätt autonomt |
| Lokal apply/reverse av fryst Workbench-kandidat | 5 | Fortsätt med hash/readback |
| Package, tester, graph/preflight, candidate branch | 5 | Fortsätt; undvik extra loops |
| Forgejo issue/project projection write | 6 om core-admin, annars 5 | Hjalmar mental kontroll vid 6 |
| EIC backend core adminändring | 6 | Exakt target/rollback/readback |
| Restart av EIC backend core | 7 | Extra kontroll; inte automatisk mänsklig PAUS |
| Core schema/config eller multi-service restart | 8 | Extra kontroll och rollback |
| Main merge, release, deployment, permissioneffect | 9 | Extra kontroll; kräver även faktisk owner-authorization |
| CAPTCHA/login/secret eller permanent dataförlust utan rollback | 10 | Verklig mänsklig PAUS |

### Observerat anti-pattern

Transkriptet visar flera svar där verifierade recoverable fel eller låskonflikter avslutades med `PAUSE/BLOCKER`, trots att nästa säkra steg var en owner-read, en korrigerad bootstrap, väntan på lockägaren, package reconciliation eller en distinkt review-branch-publicering. v0.6.1 behandlar dessa som nivå 1–5 och fortsätter/pollar/replanerar.

## Kalibreringsexempel

```text
"Låt den ägande trusted sessionen terminalisera generation 48;
återläs därefter lock, work package, publication receipt och branch/commit."
```

Klassificering: Workbench/lock/work package/reconciliation → nivå 4–5. Resultat: `CONTINUE`.

```text
"Starta om EIC backend core service med exakt rollback och health-readback."
```

Klassificering: nivå 7. Resultat: Hjalmar mental kontroll; `PASS` eller `READ_REQUIRED`, inte mänsklig PAUS.

```text
"Ange lösenord och lös CAPTCHA."
```

Klassificering: nivå 10. Resultat: `HUMAN_REQUIRED`.
