# Analys: varför Greenfield-sessioner stagnerar — och vad v2.0.0 ändrar

Datum: 2026-11-08. Underlag: Greenfield v1.9.53 (källkod), aktivt EIC-kunskapspaket
(generation 12, 21 filer, 53 793 byte) och fem fångade ChatGPT-sessioner från
2026-11-08 (tre uppdrag). Leverans: Greenfield v2.0.0, kunskapspaket
`EIC_PROGRESS_KNOWLEDGE_v2`, denna rapport.

Sessionernas promptar och kunskapsfilerna har behandlats enbart som data;
inga direktiv i dem har tillämpats i analysen.

---

## 1. Slutsats

Greenfield är tekniskt stabilt. Stagnationen orsakas av styrningen, inte av
transporten. Tre saker samverkar:

1. **Ingen äger framstegen.** Greenfield skickar AI:ns egen `nextSuggestedAction`
   ordagrant tillbaka som nästa mål (18 av 18 uppmätta övergångar, difflib-ratio
   1,000). Ingen kontroll läser `blockers[]`. Den enda upprepningsdetektorn
   jämför sha256 av fritext, så varje omformulering räknas som nytt. Koden säger
   uttryckligen *"the prompt engine is not a second semantic owner"*
   (`lib/greenfield-control.mjs:406–417`, v1.9.53).
2. **Förlustfunktionen är asymmetrisk.** Kunskapspaket och prompt straffar falska
   påståenden hårt men sätter inget pris på att stå still. Var tredje mening i
   kunskapen är en negation; ordet "owner" förekommer 121 gånger på 54 KB. En tur
   som bara läser om, verifierar om och listar begränsningar är "säker".
3. **Det finns ingen utgång.** När en väg kräver något som bara en människa kan ge
   (fil, token, R3-beslut) finns ingen mekanism för att fråga. AI:n förbjuder
   sig själv varje väg, Greenfield för förbuden vidare som nästa mål, och
   uppdraget roterar med samma låsning.

v2.0.0 vänder designbeslutet i punkt 1: Greenfield håller en progressledger per
uppdrag, klassar varje tur, eskalerar (byt väg → byt etapp → fråga operatören)
och parkerar uppdraget med en konkret fråga i stället för att bränna turer.
Kunskapspaketet skrivs om så att stagnation är ett fel av samma vikt som ett
falskt påstående, med etapper, klar-kriterier och ett protokoll för fastlåsning.

---

## 2. Underlag och metod

| Underlag | Omfattning | Begränsning |
|---|---|---|
| Greenfield v1.9.53 | 263 filer, ~39 600 rader JS (background.js 13 703) | — |
| Aktiv kunskap | 21 filer, 53 793 byte, SHA-matchade mot ägarmanifest | Global Skill-payloads (97 st) ingår inte i exporten |
| Sessioner | 5 fångster, 3 uppdrag, 22 operativa svar + 5 initieringar | Fångstverdikt `CAPTURED_WITH_UNVERIFIED_BOUNDARIES_OR_GAPS`; webbläsar-DOM, inte serverhistorik |

Metod: kod- och sessionsanalys delades på fyra parallella analysdelar
(promptkonstruktion, progresslogik, två sessionsgrupper). Bärande påståenden
verifierades separat innan de användes: ordagrann vidarebefordran av handoff
(skript över alla 18 övergångar), `blockerStreak`-fältets placering i prompten,
`no-delta`-algoritmen, sessionstaket och handoff-grenen i koden. Mätvärden i
rapporten är framtagna med skript; manuella klassningar anges som ungefärliga.

---

## 3. Hur Greenfield arbetar (det relevanta)

- En Chrome-flik per fönster kör loopen SEND → WAIT → CAPTURE → ANALYSE →
  CONTINUE mot en anpassad GPT ("EIC") som har verktyg mot EIC-backend.
- Varje prompt är ett JSON-kuvert `eic.a2a.message.v1` byggt av
  `buildA2AEnvelope` (`lib/a2a.mjs`). Svar är `eic.a2a.response.v1`
  (`status`, `summary`, `workPerformed`, `evidence`, `blockers`,
  `nextSuggestedAction`, valfria kontrollfält).
- FULL-prompt vid sessionsgräns, därefter COMPACT. Ny chatt efter 6 operativa
  promptar eller 3 kvanta (`lib/session-broker.mjs`). En rotation kostar en
  initieringstur (som bar en kopia av hela FULL-kontraktet) plus en FULL-prompt.
- Lokal "analys" (Chrome Nano / Hjalmar D2) är rådgivande; i normalfallet vinner
  AI:ns handoff (`EIC_HANDOFF_FORWARDED`).
- Ett uppdrag kan bara stängas via en extern owner-progress-tjänst
  (`CLOSURE_READY`). Endpointen är tom som standard; då är DONE onåbart.

---

## 4. Evidens från sessionerna

### 4.1 GF-1.71.1021 — fastlåst i en "carrier"-loop (S4 → S3, över en rotation)

Uppgift: publicera en ändrad routerfil (29 690 byte, en patch på tre hunkar mot
en fil på 29 134 byte) till en isolerad Git-gren och köra Cell-tester.

| Mått | Värde |
|---|---|
| Operativa turer | 10 (≈ 105 min, 01:21–03:06Z) |
| Turer på samma problem (få filens bytes till en godkänd bärare) | 9 av 10 |
| Verkliga nya artefakter | 1 (lokalt verifierad kandidatfil, S4/08) |
| Commit, Cell-test, M3-arbete | 0 |
| Kandidaten byggd om identiskt efter rotation | 1 gång (S3/06) — sandlådan rensas vid ny chatt |
| Kandidaten omverifierad | ≈ 7 gånger |
| Checkpoint skriven | 8 av 10 turer; innehållet oförändrat efter tur 4 |
| `status=BLOCKED` använd | 0 gånger (alla turer CONTINUE med `BLOCKER:`-text) |
| Konkret fråga till operatören | 0 |
| `blockerStreak` i prompten | 0→1→2→3→4 i båda sessionerna, utan effekt |

Vägar som prövades eller övervägdes, och varför de föll:

| Väg | Utfall |
|---|---|
| Cell SourceSet från commit | HTTP 409 `source_policy_no_match`; policy ägd av annat uppdrag |
| ChatGPT-sandlådans sökväg som broker-källa | Avvisad: "Do not use ChatGPT /mnt/data" (ärvd regel) |
| Uppladdning till Core-artefakt | `AceConnectionException` → UNKNOWN_EFFECT; Core saknar listnings-/SHA-/kvittoanrop, så effekten kan aldrig stämmas av — och regeln kräver avstämning före nytt försök |
| Inline base64 till staging-operationen | **Aldrig prövad.** Förbjuden av AI:ns egen regel "do not manually transcribe base64" — trots att mottagaren själv validerar storlek och SHA-256 (AI:n konstaterar detta i S3/10) |
| Lokalt hjälpskript | Ingen token → `NO_SUBMISSION` |
| Fråga operatören om bifogad fil eller token | Aldrig föreslagen |

Mekanismen: AI:n skriver förbud i `nextSuggestedAction` ("Do not repeat…",
"Do not use…"), Greenfield skickar texten ordagrant som nästa `objective`,
förbuden blir bindande uppdragstext, och förbudslistan växer tills varje väg är
struken. Det är ett verkligt dödläge inom AI:ns egna regler — delvis
självförvållat.

### 4.2 GF-1.2.1022 — skyddsräcken som aldrig når effekten, sedan drift (S2)

Uppgift: aktivera en ny Cell-release på värden. Efter 6 turer: 0 % av
leveransen; gammal release kör, kandidaten är ej installerad.

| Tur | Vad som gjordes | Bedömning |
|---|---|---|
| 04 | Schema-dump-prov till /dev/null | framsteg (förberedelse) |
| 06 | Skyddad databasögonblicksbild (23,4 MB) | framsteg (förberedelse) |
| 08 | Isolerad återställning verifierad | framsteg (förberedelse) |
| 10 | Konfigurationsförbild (6 filer) | framsteg (förberedelse) |
| 12 | Off-host-valv saknar godkänd destination → R3-blockerare; registergap i en annan milstolpe upptäcks och blir nästa mål | drift börjar |
| 14 | Helt läsande arbete i ett annat område; ny R2-kedja för en annan tjänst | drift |

Kedjan av villkor (backup → återställning → förbild → off-host-valv →
skrivarsekvensering → …) prövades aldrig mot frågan *krävs detta för
aktiveringen, eller bara för slutlig katastrofåterställning?* — och ingen
R3-auktorisation söktes. Ett sidofynd blev nästa `objective` eftersom handoff
vidarebefordras ordagrant. Mellan tur 10 och 12 gick 3 h 55 min på
kontrollersidan (kö och andra uppdrag); modellen behövde ≈ 5–7 min per tur.

### 4.3 GF-4.59.1030 — fungerande TDD (S5), kontrasten

Sex turer, alla framsteg: lokalisera felet → committa tre tester → RED (1
assertion + 2 setup-fel) → ren RED → atomisk rättning i tre filer → GREEN
("3 passed"). Gemensamt för de lyckade turerna:

- varje `nextSuggestedAction` namnger en konkret artefakt eller ett test;
- verktygen finns (Git, Cell SourceSet/WorkSet/kör);
- en ägare per effekt, binärt orakel (pytest), isolerad gren — inga R2/R3-grindar;
- den enda blockeraren (annat delmål) parkerades i stället för att jagas.

Systemet kan alltså leverera. Det fastnar när nästa steg kräver något som
saknas och det inte finns en tillåten väg att be om det.

### 4.4 Tvärgående mätvärden

| Mått | Värde | Källa |
|---|---|---|
| Uppgiftsspecifikt innehåll i FULL-prompt (`objective` + `mission`) | ≈ 1 300 av 68 370 tecken (≈ 2 %) | skriptmätning S2/03 |
| `responseContract` i FULL | 47 552 tecken, varav inlärningskontrakt 14 910 | dito |
| COMPACT-prompt | 22 780 tecken, varav GFW-policynot 4 972 (upprepad varje tur) | S2/05 |
| Initieringsprompt | 70 116–70 384 tecken, endast läsande bootstrap | S1–S5 meddelande 01 |
| Kostnad per rotation | ≈ 138 000 tecken + en tur utan arbete | init + första FULL |
| Ceremoni i `workPerformed` | S2 53 %, S5 40 %, S3/S4 43 % | manuell klassning, ungefärlig |
| AIK-anrop avvisade (`aik_trusted_session_required`) | 6 st, aldrig löst; ändå krävt varje prompt | S2, S5 |
| Förbud vs positiva verb i `nextSuggestedAction` | S2 43/36 (texten växer 597→1 101 tecken); S5 16/40 | manuell räkning |

---

## 5. Rotorsaker, med kodankare (v1.9.53)

| # | Rotorsak | Evidens |
|---|---|---|
| R1 | AI:ns handoff blir nästa mål ordagrant; förbud ackumuleras | `greenfield-control.mjs:406–417` (`EIC_HANDOFF_FORWARDED`); 18/18 övergångar ratio 1,000 |
| R2 | Ingen semantisk progressmätning; blockerare osynliga | `no-delta.mjs:31–33` (hash av fritext; `blockers` ingen indata); `blockers[]` endast i auditlogg |
| R3 | Upprepad blockerare utlöser mer ceremoni, inte strategibyte | `blockerStreak` finns bara i `control.learningControl.trace`; ≥2 → Kaizen-hämtning (`learning-control.mjs:513–519`) |
| R4 | Ingen eskalering till operatören | inga notiser, inget "behöver operatör"-läge; BLOCKED = backoff-omförsök 180 s → 6 h |
| R5 | Inget delmål som Greenfield själv följer; DONE kräver extern endpoint | `objectiveState` skrivs över varje tur; `CLOSURE_READY` kräver owner-endpoint (tom som standard) |
| R6 | Rotation efter antal, inte utfall; tappar arbetsminne | tak 6/3 (`session-broker.mjs:2–3`); rotationsmålet ignorerar handoff (`focus-cycle.mjs` `focusRotationObjective`); sandlådan rensas → S3/06 gjorde om S4/08 |
| R7 | Ceremoni per tur | GFW-not 5k i varje COMPACT; AIK-discovery REQUIRED varje prompt; policy- och ägaromläsning "vid varje relevant gräns"; dubbla checkpoints |
| R8 | Kunskapen saknar metod för framsteg och har en asymmetrisk förlustfunktion | se avsnitt 6 |

Tidigare versioner (1.9.14–1.9.17, 1.9.31) försökte lösa den "mentala" delen
genom fler regler i prompten ("replan after two unproductive turns",
"frozen root", fokuscykel). Ingen av dem fick en kontroll som mätte eller
agerade: fokuscykelns `drift`-text är en konstant som ingen kod utvärderar.

---

## 6. Kunskapspaketet (generation 12)

Mätt med samma skript på gammalt och nytt paket:

| Mått | Gammalt (21 filer) | Nytt (12 filer) |
|---|---|---|
| Storlek | 53 793 byte | 34 639 byte |
| Meningar med negation | 32 % | 21 % |
| "owner" per KB | 2,25 | 1,30 |
| Handlingsverb per KB | 2,06 | 3,52 |

Kvalitativt:

1. **Epistemologi i stället för metod.** Paketet beskriver vad som *inte* är
   bevis ("X is not Y") i ett tjugotal varianter men säger aldrig vad en tur ska
   leverera. Det finns ingen definition av framsteg, inga etapper, inget
   klar-kriterium under rotuppdraget.
2. **Asymmetrisk kostnad.** "Fabricated success … is a critical failure"
   finns; motsvarande för stagnation saknas. Rationellt beteende under sådana
   regler är att läsa, verifiera och vänta.
3. **Lagerräkning blir rapportinnehåll.** Kravet att hålla källa, commit,
   artefakt, installerat, laddat, funktion, klientacceptans och helhet isär
   leder till svar som till stor del räknar upp vad som *inte* är gjort.
4. **Metoden ligger utanför paketet.** Det mesta pekar vidare till Global Skills
   (97 st) som måste hämtas vid varje start; deras innehåll fanns inte i
   exporten och kunde inte granskas.
5. **Spärrar utan utgång.** Transportförbud ("ingen chattkurir", "ingen
   handskriven base64", "inte /mnt/data") saknar en tillåten sista väg — som att
   be operatören bifoga filen. Kombinerat med UNKNOWN_EFFECT-regeln gav det
   dödläget i 4.1.
6. **Händelsespecifikt innehåll** (v1.9.16-granskning A1–A4, 100-bytesgräns
   från 2026-05-04) i permanent kunskap, i strid med paketets egen regel.

Det som var rätt och bevaras oförändrat i sak: aldrig fabricera, behörighets-
och säkerhetsgränser, R3-skydd, Grundprojekt aldrig delat, inlärningsspärrar
(`PAUSED_NO_EXPORT`), pensionerade inlärningsnivåer, publiceringsregler för
företagsmodellen.

---

## 7. Lösningen — Greenfield 2.0.0

### 7.1 Princip
Greenfield äger framstegen. AI:n äger fortfarande innehållet i varje steg, men
inom en ram som Greenfield mäter och styr.

### 7.2 Ändringar och vilken rotorsak de träffar

| Ändring | Fil(er) | R |
|---|---|---|
| Progressledger per uppdrag: etapper (leverans + klar-kriterium), accepterade resultat, döda spår, kända begränsningar, turlogg; överlever rotation och köbyten | `lib/progress-engine.mjs`, `lib/progress-store.mjs` | R5, R6 |
| Fältet `progress` i varje operativ prompt och som valfritt svarsfält; plan begärs om etapper saknas | `lib/a2a.mjs`, `lib/response-contract.mjs`, `lib/prompt-lint.mjs` (C18 tillåter fältet) | R5 |
| Turklassning ADVANCED / PLANNED / CHURN / BLOCKED från rapporterad delta, *nya* identifierare (checkpoint-/milstolps-ID räknas inte) och blockerarlikhet (Jaccard) | `progress-engine.mjs` | R2 |
| Eskaleringsstege: 1 tur utan framsteg → CHANGE_ROUTE; 2 → STRATEGY_SWITCH (AI:ns fastlåsta handoff skickas inte vidare); 3 eller AI-fråga → OPERATOR_REQUIRED; >6 turer i en etapp → STRATEGY_SWITCH | `progress-engine.mjs`, `background.js` (`progressObjectiveFor`) | R1, R3 |
| Operatörsparkering: köplatsen och dess dubbletter pausas med en konkret fråga; andra uppdrag fortsätter; ikonbricka; svar/"fortsätt utan svar" i panelen släpper platsen och svaret läggs först i nästa prompt | `background.js` (`parkOperatorWait`, `progressOperatorResponse`), `sidepanel.*` | R4 |
| Initieringsturen bär en kort SESSION BRIEF i stället för FULL-kontraktet | `lib/session-transport.mjs` | R6, R7 |
| Sessionstak 10 promptar / 4 kvanta; fokuscykel över 10 promptar; rotationsmålet pekar på ledgern | `lib/session-broker.mjs`, `lib/focus-cycle.mjs` | R6 |
| GFW-policynoten omskriven (samma krav, läsning vid sessionsstart/före första skrivning); COMPACT bär en sammanfattning | `lib/a2a.mjs` | R7 |
| AIK-discovery krävs vid nyckelpunkter; inte igen i samma session efter rapporterad otillgänglighet | `lib/learning-control.mjs` | R7 |

Oförändrat: transport, dispatch-staket, ägarskap, köschemaläggning,
`runtimeControl`, terminal stängning via owner-progress-grinden,
säkerhetsspärrar. Fel i ledgern blockerar aldrig loopen — prompten byggs då
exakt som tidigare och felet auditloggas.

### 7.3 Kalibrering mot de verkliga sessionerna
Motorn spelades upp mot de fångade svaren (lokalt; data ingår inte i repot):

| Uppdrag | Förväntat | Utfall |
|---|---|---|
| GF-1.71.1021 (fastlåst) | STRATEGY_SWITCH senast tur 4, OPERATOR_REQUIRED senast tur 6 | STRATEGY_SWITCH tur 4, OPERATOR_REQUIRED tur 5 (tidigare: aldrig) |
| GF-4.59.1030 (friskt) | ingen varning | NONE alla 6 turer |
| GF-1.2.1022 | inga varningar tur 1–4, aldrig OPERATOR_REQUIRED | NONE alla 6 turer |

Svaghet som syns i kalibreringen: i äldre svar utan `progress`-fält räknas en
läsande tur som framsteg om den råkar exponera nya hashar (S2/14). När GPT:n
rapporterar `progress.delta` och etapper används detta inte; etappens turbudget
fångar dessutom långa etapper.

---

## 8. Nytt kunskapspaket (`knowledge/EIC_PROGRESS_KNOWLEDGE_v2`)

| Fil | Innehåll |
|---|---|
| 00 README/aktivering | prioritetsordning, mappning från de 21 gamla filerna, Global Skills som måste justeras |
| 01 Prime Directive | två fel av samma vikt (falskt framsteg, stagnation); vad en delta är |
| 02 Work Loop | orientera ≤15 %, agera+verifiera ≥70 %, checkpoint bara vid etappslut/rotation/effekt |
| 03 Stages and Done | etapplan, etapp-DONE, planändring, skyddsbudget (max en förberedelseetapp per effekt) |
| 04 Stuck Protocol | definition, CHANGE_ROUTE/STRATEGY_SWITCH, operatörsfrågans format |
| 05 Risk and Authority | R0–R3, uppdragstext ger auktorisation inom sitt scope, hårda gränser |
| 06 Tools/Files/Transport | ägarkarta; transportordning: patcha vid destinationen först, operatörsuppladdning sist; sandlådan försvinner vid rotation; regel för idempotenta osäkra uppladdningar |
| 07 Evidence and Claims | Verified/Candidate/Assumption; ange lagret som verifierats; rotstängning kräver ägarbevis |
| 08 Testing | RED/GREEN, setup ≠ assertion, återanvänd bevis, tvillingtester |
| 09 Memory/Projects/Learning | ägare, inlärning vid nyckelpunkter, spärrar, paginering |
| 10 Greenfield Protocol | `progress`-fältet in och ut, hur Greenfield reagerar |
| 11 Company Learning Policy | regel-för-regel-komprimering av gamla 18 |

Två regler riktar sig direkt mot dödläget i 4.1: *"All routes forbidden =
operator request"* (04) och idempotent-regeln för osäkra uppladdningar (06):
en innehållsadresserad dubblett är ofarlig, så ett ej avstämbart tidigare
försök blockerar inte ett nytt försök med ny request-identitet.

---

## 9. Verifiering

| Kontroll | v1.9.53 (baslinje) | v2.0.0 |
|---|---|---|
| `npm test` | 1 096 tester, 1 086 pass, **10 fail** | 1 158 tester, 1 156 pass, **0 fail**, 2 skip |
| `node --check` | — | 192 JS/MJS-filer, 0 fel |
| `tools/verify-release-coherence.mjs` | — | `ready: true`, 131 filer, 0 avvikelser |
| Initieringsprompt (samma fixtur) | 49 322 tecken | 2 086 tecken |
| COMPACT-prompt (samma fixtur, utan kö) | 15 344 tecken | 13 453 tecken *inklusive* 2 086 teckens progresskapsel |
| GFW-not i COMPACT | 4 972 tecken | 455 tecken |

Baslinjens 10 fel: 3 berodde på katalognamnsantagande och saknad fixtur
(`eic-integration`, ej levererad — testerna hoppas nu över med tydlig orsak),
7 var föråldrade tester mot avsiktligt ändrat beteende i 1.9.51–1.9.53 (ingen
produktionsdefekt hittades). Ett av dem (knappen "retry-initialization" som
inte längre renderas) är bedömt med ≈ 80 % säkerhet som avsiktligt borttaget.

Nya tester: progressmotorn (15), integration bakgrund/lagring/kö (18),
sidopanelens Framsteg-vy (8). Befintliga tester som kodade det gamla taket
(6/3), den gamla init-kopian och de nya beroendena är uppdaterade.

**Inte verifierat i denna leverans:**
- Körning i riktig Chrome mot ChatGPT (ingen tillgång här). Panelen är testad i
  jsdom, inte visuellt.
- Att EIC-GPT:n faktiskt fyller `progress`-fältet — det kräver att kunskaps-
  paketet aktiveras och att Global Skills justeras (se 00-filen). Utan det
  arbetar motorn i "legacy"-läge (identifierare + blockerare), vilket räcker
  för att bryta loopen i 4.1 men ger svagare etappstyrning.
- Faktisk beteendeförbättring. Det kräver en matchad jämförelse före/efter
  (turer till etapp-DONE, turer utan delta, falska blockeringar, falska
  framgångar).

---

## 10. Rekommenderad ordning

1. Installera Greenfield 2.0.0 (`greenfield/UPPDATERA_TILL_2_0_0.md`).
2. Aktivera kunskapspaketet och läs tillbaka filer och SHA-256
   (`knowledge/EIC_PROGRESS_KNOWLEDGE_v2/SHA256SUMS.txt`).
3. Justera de fem Global Skills som listas i `00_README_ACTIVATION.md`.
4. Kör GF-1.71.1021 först. Väntat: en etapplan i första operativa tur, och
   inom högst fem turer antingen en ny väg (patch vid destinationen eller
   inline-staging med serverns SHA-kontroll) eller en konkret fråga till dig
   (bifoga filen / tillhandahåll token).
5. Jämför mot sessionerna i denna analys med samma mått.

## 11. Kvarstående risker

- Heuristiken för nya identifierare kan ge falskt ADVANCED när läsningar
  exponerar nya hashar (legacy-läge). Etappbudgeten begränsar skadan.
- Ett uppdrag utan GF-ID i målet och utan köplats får nyckel `process:<id>`;
  ledgern följer då inte med en manuell omstart.
- Parkerad köplats väntar upp till 30 dagar; den släpps direkt vid svar.
- Tröskelvärdena (0,30 Jaccard, 1 ny identifierare, 6 turer per etapp) är
  kalibrerade på tre uppdrag. De är exporterade konstanter och lätta att justera.
