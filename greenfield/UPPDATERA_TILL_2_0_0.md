# Uppdatera Greenfield till v2.0.0 — Progressmotor

## Vad versionen ändrar
v1.9.x höll sessionerna tekniskt vid liv men mätte aldrig om uppdraget gick
framåt. AI:ns `nextSuggestedAction` skickades ordagrant tillbaka som nästa
mål, upprepade blockerare syntes inte för någon kontroll, och det fanns ingen
väg att fråga operatören. v2.0.0 låter Greenfield äga framstegen:

- **Progressledger per uppdrag** (`lib/progress-engine.mjs`,
  `lib/progress-store.mjs`): etapper med leverans och klar-kriterium,
  accepterade resultat, döda spår, kända begränsningar och en turlogg.
  Ledgern överlever sessionsrotation och köbyten.
- **Fältet `progress` i varje operativ prompt** och som valfritt fält i svaret.
  Saknas etapper ber första operativa tur om en plan (3–8 etapper).
- **Turklassning** varje svar: ADVANCED, PLANNED, CHURN eller BLOCKED, baserat
  på rapporterad delta, nya identifierare (hashar, commit-ID, artefakt-ID;
  checkpoint- och milstolpsreferenser räknas inte) och upprepade blockerare.
- **Eskalering**: en tur utan framsteg → CHANGE_ROUTE, två → STRATEGY_SWITCH
  (AI:ns egen fastlåsta handoff skickas inte vidare), tre eller en
  operatörsfråga från AI:n → OPERATOR_REQUIRED. En etapp som tar mer än sex
  turer ger STRATEGY_SWITCH.
- **Operatörsparkering**: vid OPERATOR_REQUIRED parkeras köplatsen (och alla
  dubbletter av samma uppdrag) med en konkret fråga. Andra uppdrag fortsätter.
  Ikonen visar antal väntande frågor. I panelen **Framsteg** svarar du eller
  väljer "Fortsätt utan svar"; köplatsen släpps direkt och svaret ligger först
  i nästa prompt.
- **Billigare rotation**: initieringsturen bär en kort SESSION BRIEF i stället
  för en kopia av hela FULL-kontraktet (mätt: 49 322 → 2 086 tecken i samma
  fixtur; i de verkliga kösessionerna var den ~70 000). Sessionstaket är 10
  operativa promptar / 4 kvanta (tidigare 6 / 3).
- **Mindre ceremoni**: GFW-policytexten upprepas inte i varje COMPACT-prompt
  (4 972 → 455 tecken); policy läses vid sessionsstart och före första
  skrivning; AIK-discovery krävs vid nyckelpunkter och inte igen i samma
  session efter `aik_trusted_session_required`.
- **Rotationsmålet** pekar på ledgern: ny chatt fortsätter aktuell etapp och
  ser accepterade resultat och döda spår.

Oförändrat: transport, dispatch-staket, ägarskap, kö-schemaläggning,
runtimeControl, terminal stängning via owner-progress-grinden, säkerhetsspärrar.

## Installation
1. Ta bort inget. Öppna `chrome://extensions`, Utvecklarläge.
2. Ersätt innehållet i den installerade Greenfield-katalogen med denna
   `greenfield/`-katalog (samma installation behåller lagrad kö och uppdrag).
3. Klicka **Uppdatera** på tillägget och ladda om ChatGPT-flikarna.
4. Kontrollera att panelen visar `v2.0.0` och sektionen **Framsteg**.
5. Ladda upp det nya kunskapspaketet `knowledge/EIC_PROGRESS_KNOWLEDGE_v2`
   och justera Global Skills enligt `00_README_ACTIVATION.md` där.

## Förväntat beteende
- Första operativa turen efter uppdatering returnerar `progress.plan`.
- Panelen Framsteg visar etapper, räknare och eventuell varning.
- Ett uppdrag som inte avancerar får först instruktion att byta väg, sedan att
  byta etapp eller fråga dig, och parkeras senast efter tre turer utan
  framsteg i rad.

## Verifiering i denna leverans
- `npm test`: se `RAPPORT_v2.0.0.txt` för exakta siffror.
- `node tools/verify-release-coherence.mjs`: versions- och bytekoherens.
- Inte verifierat här: körning i riktig Chrome mot ChatGPT. Ledgerns
  tröskelvärden är kalibrerade mot fångade sessioner från 2026-11-08, inte mot
  nya live-körningar.
