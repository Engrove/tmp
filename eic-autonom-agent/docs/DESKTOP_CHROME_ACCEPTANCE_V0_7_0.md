# DESKTOP CHROME ACCEPTANCE — v0.7.0

Kräver Chrome ≥ 137 med aktiverad Prompt API/Gemini Nano och en kopplad ChatGPT-flik.
Ingen av punkterna nedan kan köras i byggmiljön.

## A1 — Takeover av en pågående session utan continuity

1. Öppna en ChatGPT-session som redan har flera assistantsvar.
2. Koppla fliken. Continuity ska vara tom (`intent.setBy = "unset"`).
3. Aktivera Nano. Starta i vänteläge.
4. Vänta in ett stabilt komplett assistantsvar.

**Förväntat:** pipeline `TAKEOVER_BOOTSTRAP`; request går till `COMPLETED`, inte `INVALID`.
Om Nano avger tomma kontextarrayer ska auditen visa
`Takeover-kontext grundad lokalt från observationen`, inte
`Nano-beslut avvisat — exakt en repair-runda krävs`.

**Icke förväntat:** `GROUNDING_REJECTED: TASK_INTENT_EMPTY, WORK_UNIT_EMPTY, TAKEOVER_CONTEXT_EMPTY`.

## A2 — Nano-värdfel mitt i första takeover-analysen

1. Under pågående `TAKEOVER_BOOTSTRAP`, tvinga fram ett värdfel (stäng sidopanelen eller
   inaktivera modellen).

**Förväntat:** auditen visar `Takeover återköad mot färsk Nano-session · försök 1/3`.
Körstatus går till `ASSESSING`, inte till `RECOVERING` med `NANO_GROUNDING_REJECTED`.
Efter tre försök — och först då — sker owner-reconciliation.

**Icke förväntat:** `Deterministic grounding-spin avbruten`.

## A3 — Ingen generisk målprompt

1. Kör A2 till budgetens slut.

**Förväntat:** ingen prompt levereras till målsessionen i något skede. Målflikens
meddelandeantal är oförändrat. `requestedAction` i det deterministiska beslutet är tomt.

## A4 — Output-tak

1. Kör en normal continuation-analys och observera `Resultat`-fältet.

**Förväntat:** `outputChars` ligger under 6 000 för varje analys. Om taket nås loggas
`NanoOutputOverrunError` och analysen görs om mot en färsk session i stället för att
körningen avbryts.

## A5 — Sessionsisolering

1. Kör minst fyra analyser i följd.

**Förväntat:** analystiden ökar inte monotont mellan turerna. I fältincidenten steg första
analysen från 74 s till 902 s mellan två cykler på delad bassession. Om värden saknar
`clone()` ska `isolation` vara `FRESH_SESSION`.

## A6 — Tyst sessionsomstart

1. Framkalla en stale bassession.

**Förväntat:** panelen visar `Nano-sessionen återskapades automatiskt efter ett
återhämtningsbart fel` och analysen fortsätter. Ingen operatörsklick på
`Kontrollera / aktivera Nano` ska krävas.

## A7 — Bevarade gränser

1. Framkalla en nivå-10-klassificering (login, CAPTCHA, credentials eller irreversibel
   destruktion).

**Förväntat:** verklig PAUS med `HUMAN_REQUIRED`. Oförändrat mot v0.6.9. Direkt
operatörsstopp stoppar alltid.

## A8 — Migrering

1. Importera en `eic.autonom.export.v8`-fil från v0.6.9.

**Förväntat:** import lyckas. `takeoverRecoveryAttempts` och `nanoHostResetRequired` saknas i
gammalt state och behandlas som 0 respektive false.
