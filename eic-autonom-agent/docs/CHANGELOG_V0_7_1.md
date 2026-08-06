# CHANGELOG — v0.7.1

Referensincident: 2026-08-03, Chrome-fönster `1974094166`.

## Fixat

- **Effektbaserad destruktivitetsklassificering.** `reason` och `boundaryEvidence` läses
  inte längre av nivåklassificeraren. Det var fälten Gemini Nano ekade det injicerade
  målmandatet in i, och eftersom mandatet självt räknar upp orden "CAPTCHA" och
  "hemligheter" klassade v0.7.0 ett beslut utan åtgärd som nivå 10.
- **Actionless cap.** Ett beslut vars åtgärd är tom eller en nulliteral (`None`, `null`,
  `N/A`, `Ingen`, `-`) kapas till nivå 1 med `NO_PROPOSED_EFFECT`. Kapet ligger över den
  explicita nivåöverstyrningen, så en modellsatt `destructivenessLevel` inte kan eskalera
  ett beslut som föreslår ingenting.
- **Ren rationale.** `rationale` promotar inte längre `input.reason`. En operatör som ska
  auktorisera en gräns får inte presenteras ekad måltext som motivering.
- **Lokal operatörsauktorisering.** Nytt kommando `AUTHORIZE_BOUNDARY` och en panelyta som
  visar exakt ursprung, nivå, mål, klassificerarversion och rationale. v0.7.0 hade ingen
  auktoriseringsyta alls: `RESUME` kastade för alla ursprung utom tre, och en nivå-10-gräns
  kunde bara lämnas genom att stoppa körningen.
- **Engångsbindning.** Gränsidentiteten är `runId|origin|level|pause.at|rationale`. Varje ny
  blockering mintar ny `pause.at`, så en auktorisering kan aldrig återanvändas.
- **Obligatorisk motivering.** Minst 12 tecken, skrivs till durable continuity som
  `OPERATOR_AUTHORIZED_BOUNDARY` och till recovery-loggen som
  `OPERATOR_BOUNDARY_AUTHORIZATION`.
- **Spårbar klassificering.** `classifierVersion` och `classificationInput` persisteras med
  varje bedömning.
- **Output-tak med marginal.** `NANO_MAX_OUTPUT_CHARS` går från 6 000 till 12 000. Fältdata
  visade legitima beslut på 5 999 och 5 969 tecken och ett avbrutet på 6 003 — en marginal
  på 0,05 %. En överskridning försöker nu först rädda ett komplett JSON-objekt ur det som
  redan strömmats och blir ett fel först om det misslyckas.

## Oförändrat

Måltext kan aldrig auktorisera en gräns; `authorizeBoundary()` rör ingen observation eller
målrespons. Verkliga nivå-9- och nivå-10-effekter eskalerar som förut. Direkt
operatörsstopp, login, CAPTCHA, credentials och okänd blast radius förblir
`HUMAN_REQUIRED` tills operatören uttryckligen auktoriserar dem lokalt.

## Test

273 tester passerar: 256 bevarade från v0.7.0 plus 17 nya i
`tests/v071-false-level10.test.mjs`. Ett v0.7.0-test om takets exakta värde är omskrivet
med motivering, inte borttaget.
