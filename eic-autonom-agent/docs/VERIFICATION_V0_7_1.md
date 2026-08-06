# VERIFICATION — v0.7.1

## Verifieringsgränser

Allt nedan är kört i Node 22 mot källträdet. Ingenting är kört i Chrome mot en riktig
Gemini Nano-värd; sådana steg ligger i `DESKTOP_CHROME_ACCEPTANCE_V0_7_1.md`.

## V1 — Den falska nivå-10:an är borta (VERIFIED)

Testfallet byggs ur den ekade mandattexten i operatörens export.

Före fix: `level 10 · LEVEL_10_HUMAN_AUTHORITY · humanDecisionRequired true`.
Efter fix: `level 1 · NO_PROPOSED_EFFECT · humanDecisionRequired false`.

Kompletterande fall: samma ekade mandat i `reason` tillsammans med en verklig läsåtgärd ger
`level 1 · LEVEL_1_READ_ONLY` i stället för nivå 10.

## V2 — Verklig eskalering är intakt (VERIFIED)

- `Logga in på admin-panelen med credentials` → nivå 10
- `Lös CAPTCHA för att fortsätta` → nivå 10
- `Radera permanent hela produktionsdatabasen` → nivå 10
- `Utför merge till main och skapa release` → nivå 9
- `targetNext: Rotate the production access token` → nivå 10

## V3 — Actionless cap (VERIFIED)

`None`, `none`, `null`, `N/A`, `-`, `Ingen` och blanksteg klassas alla som utan föreslagen
effekt. En modellsatt `destructivenessLevel: 10` på ett actionless beslut ger fortfarande
nivå 1.

## V4 — Auktoriseringen kan inte komma från målsessionen (VERIFIED)

Testet läser hela `authorizeBoundary()`-blocket och kräver att strängarna
`pendingObservation`, `responseText`, `conversationExcerpt` och `targetClaims` inte
förekommer. Auktoriseringen läser endast lokalt run-state och panelens eget inmatningsfält.

## V5 — Engångsbindning och motiveringskrav (VERIFIED)

`boundaryKey()` innehåller `runId`, `pause.at` och `destructiveness.level`. Fel nyckel ger
`Gränsidentiteten stämmer inte`. Motivering under 12 tecken avvisas. Auktoriseringen skrivs
till continuity och recovery-loggen.

## V6 — Output-taket (VERIFIED)

Taket parsas ur källan och kontrolleras ligga i intervallet 12 000–20 000: över alla
observerade legitima beslut (max 5 999) och under schemats värsta fall (~36 000).
Salvage-vägen via `extractFirstJsonObject` är låst av test.

## V7 — Regressionsstatus

```
node --test tests/*.test.mjs   → 273 tests, 273 pass, 0 fail
node scripts/validate.mjs      → VALIDATE PASS
```

Ett v0.7.0-test som låste taket till 6 000 är omskrivet till den bevarade invarianten att
ett tak existerar och upprätthålls. Ingen annan äldre assertion är ändrad.
