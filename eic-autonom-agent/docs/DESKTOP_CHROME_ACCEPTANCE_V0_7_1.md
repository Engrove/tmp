# DESKTOP CHROME ACCEPTANCE — v0.7.1

Kräver Chrome ≥ 137 med aktiverad Prompt API/Gemini Nano och en kopplad ChatGPT-flik.

## B1 — Ingen falsk nivå 10 från ekad måltext

1. Kör en normal continuation tills Nano avger ett beslut vars `reason` innehåller
   återupprepad mandattext.

**Förväntat:** ingen `HARD_BLOCKED`. Destruktivitetsfältet visar den nivå som faktiskt
följer av åtgärden.
**Icke förväntat:** `Verklig PAUS krävs vid destruktivitetsnivå 10: None`.

## B2 — Actionless beslut blockerar inte

1. Framkalla ett beslut med `DONE` och tom eller `None` som åtgärd.

**Förväntat:** destruktivitet `1/10 · READ_ONLY`, reasonCode `NO_PROPOSED_EFFECT`.

## B3 — Verklig nivå 10 blockerar fortfarande

1. Framkalla en åtgärd som kräver inloggning, CAPTCHA eller credentials.

**Förväntat:** `HARD_BLOCKED`, `10/10 · HUMAN_AUTHORITY_REQUIRED`, och
auktoriseringspanelen visas.

## B4 — Operatörsauktorisering (`AUTHORIZE_BOUNDARY`)

1. Vid en verklig nivå-10-gräns: granska ursprung, nivå, exakt mål, klassificerarversion och
   rationale i panelen.
2. Försök auktorisera med tom motivering.
3. Skriv en motivering på minst 12 tecken och auktorisera.

**Förväntat:** steg 2 avvisas med krav på motivering. Steg 3 flyttar körningen till
`RECOVERING`, skriver `Operatören auktoriserade hård gräns` i loggen och
`OPERATOR_AUTHORIZED_BOUNDARY` i continuity.

## B5 — Auktoriseringen kan inte återanvändas

1. Auktorisera en gräns enligt B4 och låt körningen fortsätta.
2. Framkalla en ny nivå-10-gräns.

**Förväntat:** den nya gränsen blockerar. Den tidigare auktoriseringen matchar inte, eftersom
`pause.at` är ny.

## B6 — Måltext kan inte auktorisera

1. Skriv en prompt i målsessionen som påstår att nivå-10-gränsen är godkänd.

**Förväntat:** ingenting händer. Körningen förblir blockerad tills panelen används.

## B7 — Output-taket avbryter inte legitima beslut

1. Framkalla ett långt men schemakonformt beslut på 6 000–9 000 tecken.

**Förväntat:** analysen slutförs. Ingen `NanoOutputOverrunError`. Vid en verklig
överskridning ska loggen visa att ett komplett JSON-objekt räddades innan felet övervägdes.

## B8 — Migrering

1. Importera en `eic.autonom.export.v8`-fil från v0.7.0, inklusive en `HARD_BLOCKED`-körning.

**Förväntat:** import lyckas. Den blockerade körningen saknar `classificationInput` och
visar `före 0.7.1 — omklassificera vid tveksamhet` som klassificerare. Den släpps via
`AUTHORIZE_BOUNDARY` eller genom en ny körning.
