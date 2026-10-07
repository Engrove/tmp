# Uppdatera Greenfield 1.9.2 → 1.9.3

1. Säkerhetskopiera tilläggsmappen.
2. Packa upp `EIC_Autonom_Agent_Greenfield_v1.9.3.zip` och kopiera innehållet över **samma mapp** som Chrome redan använder. Då behålls extension-ID och all lokal state; körkrav och driftinställningar ligger dessutom kvar i bokmärkesvalvet (1.9.1/1.9.2).
3. I `chrome://extensions`: välj **Läs in igen**. En omstart av Chrome räcker inte.
4. Panelen ska visa `Greenfield v1.9.3`.

Inga inställningar behöver ändras. Pågående köer, processer och delegeringar följer med.

Version 1.9.3 bygger på operatörens rapporter 2026-10-07 och styrkontraktet `GFW_EIC_CONTROL_A2A_v1`. Kontraktet har företräde framför Greenfields promptar, utom där operatörens uttryckliga instruktion går före; det står då i avsnitt 7.

## 1. En avgränsad slice per interaktion

ChatGPT gick oftare i bakgrundsarbete ("Våra system bearbetar den här begäran …") och därefter till "Anslutningen bröts. Väntar på hela svaret". Analysen visade att Greenfields promptar aldrig bad om jättesteg, men att inget heller hindrade dem.

**Vad som ändrats i promptarna:**

| Före (1.9.2) | Nu (1.9.3) |
|---|---|
| Samma `planningHint` vid interaktion 1, 3 och 5 | Egen text per position: första, mellersta, sista/checkpoint, schemakontroll, enda interaktion, och utan kö |
| Startuppdraget: "…first bounded work package…, then continue autonomously" | "…execute only its first bounded slice in this interaction; Greenfield schedules the next interaction" |
| "Keep each response well inside this bound" (120 min) | Borttaget. 120/30/60/90 min och 4 h beskrivs som Greenfields egen watchdog, "not a provider limit and not a response-time budget", och räknas fram ur konstanterna |
| Ingen storleksstyrning utan kö | `control.interactionSlicing.planningHint` i varje prompt |
| Fortsättningens uppdrag skrevs om av Hjalmar D2 från 260 tecken | EIC:s egen strukturerade `nextSuggestedAction` skickas vidare ordagrant |

**Varje prompt säger nu:**
- en avgränsad, sammanhängande slice per interaktion;
- senare interaktioner är exekveringsdjup, och hela WORK_QUANTUM/envelope ska inte tryckas in i ett svar;
- samma `progressionEnvelopeRef` fortsätter om inte ägar-, risk- eller evidensläget verkligen ändras;
- sista interaktionen är en checkpoint, inte uppdragsavslut: avstämning, ägaråterläsning och överlämning går först;
- `nextSuggestedAction` ska vara nästa enda slice, inte hela resten av planen.

**Uppdrag i flera faser.** Ett uppdrag som räknar upp flera beroende faser ("slutför…, verifiera…, kör testerna och gör owner-readback") får en vaktmening. Den säger att bara första slicen görs nu och att resten lämnas vidare i ordning. Uppdraget själv skrivs aldrig om, eftersom det tillhör EIC.

## 2. Storleken följer observerat tryck, utan TTL

Ingen tidsgräns hos ChatGPT är känd, och ingen antas. Två nya kategorier av signaler i `sessionHealth` gör att nästa slice krymper (`control.interactionSlicing.slicePressure = SHRINK`):

- **Relativa signaler:** `COMPLETION_HIGH_RELATIVE` (minst 2,5×) och `COMPLETION_RISING` (minst 1,75×). Svarstiden jämförs med sessionens egna tidigare rena turer.
- **Händelser:**
  - `PROVIDER_BACKGROUND_PROCESSING`: ChatGPT:s bearbetningsnotis syntes.
  - `TRANSPORT_INTERRUPTED`: bannern om bruten anslutning syntes.

  Händelserna gäller i de tre senaste turerna och följer med över en ny chatt.

`TTFR_HIGH_RELATIVE` och `RECOVERY_CHURN` krymper också slicen. Lång session och stor kontext gör det inte, eftersom de är skäl att rotera.

## 3. Bearbetningsnotis och bruten anslutning

Greenfield läser båda som sidtillstånd (`providerNotices` från content-skriptet). Tidigare rensades notisen bara bort ur svarstexten, och bannern kändes inte igen alls.

- **Ingen ny prompt** postas medan någon av dem syns. Tidigare skickade Greenfield ibland en prompt rakt över "Anslutningen bröts". Spärren släpper efter högst 4 h, samma gräns som för en fastnad stoppknapp.
- **Inget halvfärdigt svar fångas** medan de syns. Undantag: ett komplett, schemagiltigt EIC-svar på sidan vinner över en kvarhängande anslutningsbanner.
- **Uppdateringsstegen** (F5 30, Ctrl-F5 60/90, byte vid 120 min) väntar medan de syns, inom den befintliga respiten på 4 h från utskicket.
- **Kapacitetsplatsen** lämnas inte tillbaka medan de syns.
- **Idle-keepalive och återhämtning efter en avbruten tur** postar inte medan de syns.
- **Incidentloggen** visar varje förekomst (`PROVIDER_TRANSPORT_NOTICE`), varje spärrad postning (`PROMPT_DISPATCH_HELD_PROVIDER_NOTICE`) och en rad per avslutad tur (`TURN_METRICS`): promptstorlek, position, roll, tryck, notiser, svarstider. Ingen text lagras.

Citat i svar, kod, användarmeddelanden eller Greenfields egen overlay räknas inte som notis.
- Verifierat i Chromium med `tools/verify-transport-notices.mjs`: 13 fixturer, 39/39.
- Bannerns engelska ordalydelse är ett antagande, eftersom inget riktigt prov finns.

## 4. Ny kvant i ny chatt

**Rapport:** GF-007 kom tillbaka i kön vid interaktion 1/5 och fortsatte i sin gamla chatt.

**Vad exporten visar:** det var GF-007:s egen chatt (`…/c/6ac5c63d…`), inte GF-045:s, och ingen GFW har någonsin skrivit i en annan GFW:s chatt. Felet var att den varma återupptagningen från 1.9.0 inte tog hänsyn till kvantgränsen. Det fanns kvar i 1.9.2.

**Nu:**
- En köaktivering som **startar en ny kvant** (interaktion 1) öppnar alltid en ny chatt med full prompt (`NEW_QUANTUM_FRESH_CHAT`).
- Varm återupptagning gäller bara en **ofärdig kvant**, till exempel efter en tidig YIELD eller en schemapaus mitt i kvanten.
- Platser med max 1 interaktion startar därför alltid i ny chatt.

**Utan köbyte:** en kö med en enda körbar plats fortsätter i samma chatt efter en full kvant. Där sker inget köbyte.

**Panelen och incidentloggen:**
- Panelens kryssruta heter nu "Fortsätt en ofärdig kvant i GFW:ns egen chatt …".
- `QUEUE_ITEM_ACTIVATED` visar `interactionInQuantum`, och `freshChat` är sann bara när en ny chatt öppnas.

## 5. Delegerat arbete stannar i samma fönster

Arbete som en GFW köar via `missionDelegations` hamnar nu sist i **samma fönsters** kö. Det läggs in vid ett senare tick av samma worker, aldrig inuti det delegerande svaret.

- **Före:** arbetet lades i ett annat fönsters kö. Exempel: GF-045:s "GF-007 P0-E …" och "GF-061 Q3 …" i fönstret med GF-060/061/062.
- **Kopplingen** är köns stabila id, som överlever en omstart av Chrome.
- **Befintliga delegeringar:** redan inlagda delegeringar ligger kvar där de är. En väntande delegering från 1.9.2 går till sitt eget fönster.

## 6. Kööversikt i varje prompt

Varje prompt, FULL och COMPACT, har `control.windowQueue`. Den listar alla platser i fönstrets kö i ordning, med:
- GF-ID och etikett;
- status, där den aktuella platsen är markerad;
- prioritet;
- kvant (`completedInteractions`/`maxInteractions`);
- schema: fönster, paus, öppen nu och nästa öppning;
- nästa körbara tid för pausade och blockerade platser;
- för delegerade platser, delegeringens `requestId`.

Id:n (`itemId`) finns bara för den aktuella platsen, och COMPACT hänvisar till FULL-promptens regeltext. Med fem platser är översikten cirka 2 000 tecken.

Översikten är skrivskyddad. EIC påverkar bara sin egen plats, via runtimeControl.

## 7. Övrigt i promptkontraktet

- **Hot-reload (C19).**
  - FULL har `responseContract.methodControl`: always-fetch-ägarna `greenfield_eic_session_contract` och `kaizen_self_help_runtime`, metod-id `GFW_INTERACTION_SLICING_2026_10_07` och företrädesregeln. COMPACT har en kort påminnelse.
  - Alla "remain fully in force" gäller nu "unless superseded by the current always-fetch owner method".
  - **Metod-id:t är en konstant, inte en inställning.** EIC-ägarens aktuella metod vinner oavsett vilket id prompten anger, så en panelinställning skulle inte ge någon styrning.
- **Linter för C01–C20.** Den kontrollerar varje prompt innan den postas. Bara text som Greenfield själv skriver granskas; uppdrag, mission och operatörsinstruktioner är data. Ett fynd stoppar posten (`A2A_PROMPT_LINT_FAILED`). Alla meddelandetyper, kvantpositioner och profiler passerar.
- **Lokal analys.**
  - **Lokal DONE.** Hjalmar D2 kan inte längre avsluta ett uppdrag på egen hand. Bara EIC:s status DONE, STOP_PROCESS eller ett godkänt COMPLETE_MISSION avslutar. Det gäller också när EIC samtidigt roterar sessionen eller lämnar platsen till kön (`ROTATE_SESSION_NOW`, `YIELD_TO_QUEUE`); där kunde 1.9.2 och tidiga 1.9.3-byggen avsluta på en lokal DONE.
  - **Upprepad lokal DONE utan förändring.** Se avsnitt 8. Ingen operatör behövs.
  - **Nano blockerar aldrig.** Följande blockerar inte uppdraget och stoppar inte starten (C14/F16):
    - ett okänt Nano-resultat;
    - en lokal modell som saknas, fortfarande kan laddas ned eller laddas ned;
    - en lokal modell som inte går att starta, svarar fel, når sin kvot eller överskrider tidsgränsen.

    Analysen faller då tillbaka på Greenfields deterministiska beslut. Nano-uppgiften spelas aldrig upp igen, och dess `NANO_TASK:`-rad skickas aldrig tillbaka till EIC. En sådan rad i fortsättningen tas bort i stället för att stoppa uppdraget.
  - **Etikett i prompten.** Greenfields lokala analys beskrivs nu som valfri och rådgivande, aldrig som ägarbevis.
  - **Hjalmars input.** Hjalmar får nästa interaktions position.
  - **EIC:s handoff.** EIC:s strukturerade CONTINUE-handoff går vidare ordagrant även i tre fall där den lokala texten tidigare vann: med en Nano-uppgift, vid READ_REQUIRED och vid rotation eller köbyte. Nano-resultatet följer separat i `analysisEvidence`.
- **Okänd effekt (C07).** En prompt efter en obesvarad tur säger alltid att effekten ska läsas hos exakt effektägare före omförsök, både med och utan kö.
- **Ingen förändring (C20).** Den ersättande fortsättningen vid upprepning erbjuder en ärlig status utan förändring i stället för bara blocker eller DONE. Den nämner bara styrningar som svarskontraktet erbjuder: YIELD/SLEEP/SET_SCHEDULE i en kö, PAUSE_PROCESS utan kö.
- **Avvikelse från kontraktet, på operatörens order.** Kontraktets observerade delegeringsregel (`ANOTHER_LIVE_QUEUE_MANAGED_GREENFIELD_WORKER`, "never self-create") ersätts av operatörens uttryckliga instruktion 2026-10-07: samma fönster. Det följer kontraktets egen prioritetsordning, där operatörens avsikt kommer först.

## 8. Ingen operatör i en GFW-session

Ingen operatör är närvarande i en GFW-session. Inget nytt i 1.9.3 väntar på eller kräver en operatör.

**Upprepad lokal DONE utan förändring.** Första gången den lokala analysen säger DONE utan att EIC har lämnat terminalstatus eller handoff fortsätter uppdraget och EIC tillfrågas. Händer det igen direkt efter (`ADVISORY_DONE_NO_DELTA_PAUSE`) pausar Greenfield:
- **I en kö:** platsen pausas (`ADVISORY_NO_DELTA_PAUSED`), kvantens framsteg sparas och nästa körbara plats kör. Finns ingen annan körbar plats pausas processen i stället.
- **Utan kö:** processen får en tidsatt paus (`MISSION_PAUSE_ARMED`, `requestedBy: GREENFIELD_NO_DELTA`).

Efter pausen tillfrågas EIC igen, med pausens nummer i prompten. Pausen är 15 min och fördubblas för varje upprepning upp till 6 h, samma form som återhämtningens backoff. En handoff från EIC nollställer räkningen. Tidigare 1.9.3-byggen blockerade här och väntade på en operatör.

**EIC:s DONE medan en operatörsinstruktion väntar.** Instruktionen går före, enligt kontraktets prioritetsordning. Avslutet skjuts upp (`EIC_TERMINAL_DEFERRED_FOR_OPERATOR_INSTRUCTION`), instruktionen följer med nästa prompt och EIC bekräftar avslutet därefter. Före 1.9.3 hamnade detta i en återhämtningsslinga med backoff upp till 6 h, utan att instruktionen eller avslutet genomfördes.

**Kvar sedan tidigare versioner:** fyra lägen blir fortfarande BLOCKED:
- EIC säger själv BLOCKED;
- EIC kräver mänskligt beslut (`humanAuthorityRequired`);
- ett EIC-avslut med fel target;
- en lokal blockering utan någon nästa åtgärd från EIC.

En köplats i BLOCKED försöks om automatiskt efter köns väntetid. En process utan kö stannar däremot. Det beteendet ändras inte i 1.9.3.

## 9. Kontrollera efter uppdateringen

- Nästa köbyte till en plats som börjar en ny kvant ska öppna en ny chatt och skicka FULL.
- I diagnostikexportens incidentlogg ska `QUEUE_ITEM_ACTIVATED` ha `interactionInQuantum` och, efter varje fångat svar, `TURN_METRICS`.
- När ChatGPT visar "Våra system bearbetar …" eller "Anslutningen bröts" ska `PROVIDER_TRANSPORT_NOTICE` synas. Ingen ny prompt ska skickas förrän notisen är borta.

**Effektmått enligt kontraktet:**
- färre bakgrundsarbeten och anslutningsavbrott per 100 turer (`TURN_METRICS.processingNotice`/`connectionInterrupted`);
- kortare median och p90 för `completionMs`;
- oförändrad andel uppdrag som når terminal stängning.
