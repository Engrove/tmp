# EIC Autonom Agent Greenfield 1.9.2

Chrome MV3-tillägg för EIC GPT i vanligt Chat-läge.

Version 1.9.2 lägger **driftinställningarna** i samma bokmärkesvalv som körkraven: Paus mellan analys och post, Max parallella Greenfield och Grundparametrar för uppdragskö. De följer nu med när Greenfield laddas från en ny mapp; senast sparade version i Chrome-profilen gäller. Se [UPPDATERA_TILL_1_9_2.md](UPPDATERA_TILL_1_9_2.md).

Version 1.9.1 rättar att sparade **körkrav** gick tillbaka till standardvärdena när Greenfield laddades från en ny mapp.
- Orsak: körkraven låg bara i `chrome.storage.local`, som tillhör extension-ID:t. Varje uppackad release-mapp ger ett nytt ID.
- Rättelse: körkraven sparas nu också i Chrome-profilens bokmärken (mappen "EIC Greenfield · Run requirements v1"), och den senast sparade versionen gäller vid start.

Se [UPPDATERA_TILL_1_9_1.md](UPPDATERA_TILL_1_9_1.md).

Version 1.9.0 har tre delar:

- **Varm återupptagning.** En parkerad GFW som får tur i kön igen fortsätter i sin egen ChatGPT-chatt, i stället för att öppna en ny chatt med FULL prompt. Promptprofilen följer reglerna från 1.7.7: kort prompt i samma chatt, FULL var tionde gång eller när uppdraget har ändrats. Varje tvivel ger den gamla vägen: chatten raderad, någon annan har skrivit i den, AI:n har begärt ny chatt, eller chatten är för lång eller för gammal. Inställningen är på som standard.
- **Panelen skriver inte över det du ändrar.** Kryssrutor, fält, dropdowns och instruktionsutkast behåller ditt värde genom panelens omritningar. Osparade ändringar markeras med streckad ram.
- **Arbetsläge är på vid start.** Det slås på vid varje start av Chrome och tillägget. En körande worker tar över hämtningen när den sparade ansvariga workern inte längre finns.

Se [UPPDATERA_TILL_1_9_0.md](UPPDATERA_TILL_1_9_0.md).

Version 1.8.14 hoppar över analysen av svaret vid ett köbyte. När en köplats kvant är fullbordad (1/1, 15/15 …), eller när svaret självt lämnar platsen till kön (`YIELD_TO_QUEUE`, `PAUSE_PROCESS`, `BACKGROUND_SLEEP`), parkeras platsen direkt och nästa GFW startar, utan Nano och Hjalmar. Runtime-kontroller, delegeringar, paus, schema och checkpoint hanteras som förut. Analysen körs fortfarande när den kan ändra utfallet, till exempel vid DONE, vid en Nano-uppgift, vid en väntande operatörsinstruktion eller när ingen annan köplats kan ta över. Se [UPPDATERA_TILL_1_8_14.md](UPPDATERA_TILL_1_8_14.md).

Version 1.8.13 kommer från en analys av fem dygns drift i fyra fönster (diagnostik 2026-10-05). 30 utskick fick aldrig något svar, och varje sådan tur höll sin plats i hela 120-minutersstegen. Det var en tredjedel av tiden för den plats som de tre icke-reserverade fönstren delar. Nu lämnar en tur tillbaka sin plats när sidan efter omladdningen vid 30 min varken genererar eller har svarat. Turen väntar kvar, stegen är oförändrad och ett sent svar läses ändå. Exporten har dessutom fått en varaktig händelselogg över automatiska beslut, så att nästa stopp och rotation går att förklara. Se [UPPDATERA_TILL_1_8_13.md](UPPDATERA_TILL_1_8_13.md).

Version 1.8.12 låter ett fönster få en **reserverad plats**. Med Max parallella 2 eller fler låses en plats för det fönstret, också när det inte kör just då. Övriga fönster delar på resten, och det reserverade fönstret väntar aldrig på platser bakom dem. Det är tänkt för GFW:er som ska gå dygnet runt. Pågående svar avbryts inte. Se [UPPDATERA_TILL_1_8_12.md](UPPDATERA_TILL_1_8_12.md).

Version 1.8.11 rättar att sessionen inte visste att svaret redan var levererat. ChatGPT:s tråd är virtualiserad: bara turerna nära fönstret ligger i sidan, och långa användarmeddelanden fälls ihop med ett extra ”…”. Efter ungefär fem turer växte därför inte antalet synliga användarmeddelanden, och Greenfield kunde inte koppla den skickade prompten till sin tur. Processen stod kvar i SENDING med ”Oklart om prompten skickades – inget omskick”, trots att ChatGPT hade svarat. Nu letar Greenfield upp prompten på dess eget A2A-`messageId` i tråden. Två nya knappar på workerkortet låter operatören driva på: **Läs svar** och **Gå till nästa uppgift i kön**. Se [UPPDATERA_TILL_1_8_11.md](UPPDATERA_TILL_1_8_11.md).

Version 1.8.10 rättar att Greenfield inte förstod att en prompt faktiskt hade skickats. ChatGPT:s nya gränssnitt märker inte längre meddelandena med de attribut Greenfield letade efter (data-message-author-role m.fl.). Greenfield såg därför 0 turer och höll processen i SENDING med spärren DISPATCH_EFFECT_UNRESOLVED, trots att prompten var skickad och besvarad. Meddelandena känns nu igen enligt ChatGPT:s egen kod: användarblocket group/user-message och svarsblocket med rubriken ”ChatGPT sa:”. Knappen ”Stoppa” räknas som pågående svar. Daybreak-ord i ett meddelande tolkas inte längre som ChatGPT:s spärrnotis. Se [UPPDATERA_TILL_1_8_10.md](UPPDATERA_TILL_1_8_10.md).

Version 1.8.9 rättar att arbetskön stoppades direkt vid start. Med tom lagring och EIC vald på ChatGPT:s nya startsida (utan GPT-id i adressen) avbröts köstarten med EIC_GPT_ROOT_UNKNOWN. Panelen skrev dessutom över orsaken direkt. Nu hittar köstarten EIC:s adress själv via sidofältets Senaste-konversationer: id i adressen plus namnet EIC på sidan. Startfel syns under köknapparna, och modellväljarens ”Pro” godkänns som högsta tänknivå (operatörsbeslut).

Version 1.8.8 rättar fyra kvarvarande felgrupper: verifierad generering får en tidsbegränsad respit från återhämtning, sena återhämtningssteg separeras med minst 60 sekunder, en annan aktiv GPT får inte byta köns bundna mål, och en omdirigering till GPT-roten raderar inte en pågående konversations återställningsadress. Respiten är högst fyra timmar från promptens utskick och kräver positiv stopp-/strömningssignal. Modellkrav, kvalitetskarantän och runtimeControl-kontrakt är oförändrade. Se [UPPDATERA_TILL_1_8_8.md](UPPDATERA_TILL_1_8_8.md) och [funktionell patchanalys](docs/RISKANALYS_FUNKTION_V1_8_8.md). **Live Chrome är inte verifierat i denna leverans.**

Version 1.8.7 anpassar Greenfield till ChatGPT:s nya gränssnitt. Köstarten kunde öppna standardchatten i stället för EIC och fastna där med spärren EIC_SURFACE_UNVERIFIED. Köstart och ny chatt går nu alltid till den verifierade EIC-GPT:n. Visar ChatGPT ändå standardchatten väljs EIC under Fästa, och ingen prompt skickas förrän sidan visar EIC. GPT-adresser utan namnslug (/g/g-<id>/c/…) känns igen som samma GPT, och EIC vald på startsidan bevisas med EIC-pillret och rubriken. Den nya väntetexten ”Våra system bearbetar den här begäran …” fångas aldrig som svar. En funktionell riskanalys av hela applikationen finns i [docs/RISKANALYS_FUNKTION_V1_8_7.md](docs/RISKANALYS_FUNKTION_V1_8_7.md).

Version 1.8.6 rättar att kön kunde hänga i timmar när TTL hade gått ut. En modellspärr i WAITING stoppade hela tidsstegen: F5 30 kördes, men varken Ctrl-F5 60/90 eller köbytet vid 120 min. Spärrade processer höll dessutom sina kapacitetsplatser. Nu fortsätter tidsstegen under spärren, och inget skickas förrän modellbeviset är giltigt igen. Greenfield läser också tänknivån i ChatGPT:s nya modellväljare (”Extra hög”, ”Hög”). ”Direkt” spärras som tidigare.

Version 1.8.5 gör sparade uppdrag administrerbara. Ett uppdrags identitet är GF-ID:t på första raden (”Projekt: … - Gf: GF-001.”). Samma GF-ID uppdaterar det befintliga uppdraget på plats, och köplatser och kö-set hämtar alltid uppdragets aktuella text. Taket är höjt från 24 till 64, och inget raderas längre automatiskt. ChatGPT:s notis ”Våra system bearbetar den här förfrågan lite till …” kan aldrig fångas som svar.

Version 1.8.4 rättar mönstret för fältet Modellgolv i panelen. Chrome avvisade det som ogiltigt reguljärt uttryck och loggade ett fel i tilläggets felsida. Fältet godtog då vad som helst, men bakgrundens kontroll stoppade fortfarande ogiltiga värden.

Version 1.8.3 gör att Greenfield inte längre fryser tillsammans med en flik som hänger. Alla anrop till sidan har tidsgräns. En vit ruta, ett halvladdat ChatGPT-gränssnitt eller en sida som inte svarar återhämtas i steg: F5, Ctrl-F5, samma URL, ny flik med samma konversation, och först därefter ny chatt. Ett Daybreak-spärrkort från ChatGPT gör att samma GFW fortsätter i en ny chatt. Upprepas det pausas GFW:n i 2, 6 eller 24 h och kön går vidare. Den blir aldrig BLOCKED.

Version 1.8.2 stoppar fångst av halvfärdiga svar. I den live-körda 1.8.0-sessionen fångades 45 av 78 turer som några tecken av ett JSON-svar som fortfarande skrevs, och Greenfield skickade då nästa prompt mitt i svaret. Nu godkänns ett JSON-objekt som öppnats men inte stängts aldrig som färdigt svar. Varje process har dessutom ett varaktigt observationsspår som följer med vid köbyte och syns i diagnostikexporten (`responseObservation`), även när Audit är avslaget.

Version 1.8.1 ger varje köplats en **schemaläggare**: veckofönster i lokal tid och en engångspaus till en tidpunkt. En plats körs bara när schemat tillåter det. En pågående tur avbryts aldrig. Stänger fönstret under en tur parkeras platsen efter svaret och nästa plats startar. Finns ingen annan körbar plats väntar kön i `QUEUE_WAIT` tills nästa plats öppnar. EIC-AI:n kan ändra aktuell plats schema med `runtimeControl` `SET_SCHEDULE`, och FULL-prompten påbjuder schemaläggaren för tidsberoende arbete. Ett sparat kö-set kan nu skrivas över med aktiv kö (**Uppdatera valt**).

Version 1.8.0 bygger ut Greenfields prompt med **EIC Learning & Continuity Control**. Varje FULL-prompt bär ett fristående kontrakt som definierar AIK, Self-learn, Kaizen, Operator Learning, Memory och owner-ytor, deras regler och en routingtabell. Kontraktet utgår från att AI:n inte har någon inbyggd EIC-kunskap och att factual owner alltid vinner. Varje prompt, även COMPACT, bär en dynamisk kapsel `control.learningControl`. I kapseln anger Greenfield deterministiskt projektscope, arbetsblock, detekterade keypoints och vilka kontroller som är obligatoriska just nu. AI:n rapporterar utfallet i det nya valfria svarsfältet `learningControl`. En obligatorisk kontroll som inte rapporterades förs över till nästa prompt. Greenfield hämtar eller skriver inget i AIK/Kaizen själv; kontrollerna körs av EIC-sessionen.

Version 1.7.9 ändrar vad som händer när ett svar aldrig blir klart. Greenfield laddar om samma chatt efter 30, 60 och 90 min. Efter 120 min utan färdigt svar gör en köstyrd körning nu ett fullständigt köbyte: chatten överges och köplatsen parkeras med sin ofärdiga kvant (den obesvarade turen räknas inte). Nästa körbara köplats i listordning startar. När den parkerade GFW:n kommer tillbaka får den veta att föregående prompt saknade färdigt svar och att owner-state ska läsas om. Finns ingen annan körbar plats byter samma GFW till en ny chatt som tidigare. Overlayen i ChatGPT-fliken visar nu också GFW-id, köplats, prioritet, interaktion/kvant, en nedräkning till köbytet och nästa omladdning, tur, session, promptprofil, nästa GFW i kön och eventuell spärr.

Version 1.7.8 rättar FULL/COMPACT-promptprofilen från 1.7.7. En omladdning av samma ChatGPT-konversation räknas inte längre som sessionsgräns. Det gäller både Greenfields egen stale-ladder-F5/Ctrl-F5 efter 30/60/90 min och en manuell F5. I den live-körda 1.7.7-sessionen gjorde Greenfields egen 30-minuters-F5 att tur 2 skickades som FULL. Modellens kontext ligger i konversationen (`/c/<id>`) och påverkas inte av en omladdning. FULL skickas vid ny chatt, byte av konversation, rotation, köaktivering, nytt fönster eller ny process, var tionde prompt och på AI-begäran.

Version 1.7.7 gör **AI-begärd runtime-control** till en validerad, avgränsad kontrollpunkt. När EIC-AI:n svarar `status=DONE` eller `sessionAction=STOP_PROCESS` (eller strukturerat `runtimeControl` `COMPLETE_MISSION`) avslutar Greenfield nu faktiskt den logiska GFW:n och pensionerar alla dess köplatser. I 1.7.6 kunde Hjalmars lokala `CONTINUE` tyst köra över den terminala signalen. AI:n kan också begära ändrad kvant (`SET_QUANTUM`) och prioritet (`SET_PRIORITY`) för aktuell köplats. Greenfield validerar target, gränser och operatörsföreträde och återrapporterar kvitton i nästa prompt. Följdprompter i samma ChatGPT-konversation kan skickas som COMPACT. FULL-prompten skickas vid sessionsgräns (ny chatt, rotation, köaktivering, konversationsbyte) och var tionde prompt.

## Nytt i 1.9.2

- **Driftinställningar i bokmärkesvalvet**:
  - **Valvet:** `lib/safety-policy-vault.mjs` har två oberoende sektioner, `policy` och `drift`, i mappen "EIC Greenfield · Run requirements v1". Driftsektionen lagras som `{values, keySavedAtMs}`, med en sparningstid per inställning. Möts två kopior via Chrome Sync slås de ihop inställning för inställning.
  - **Lagringen:** i `lib/operator-settings.mjs` stämplar `saveOperatorSettings` bara de sparade inställningarna i `driftSettingsSavedAtMs`. `mergeDriftSettings` låter den senast sparade versionen vinna per inställning. `reconcileLocalDriftSettings` räknar fram sammanslagningen inne i skrivlåset.
  - **En skrivare åt gången:** `withOperatorSettingsLock` använder `navigator.locks`, som delas av sidopanel och bakgrund. Alla skrivare av inställningsposten läser om den inne i låset. Det gäller också synken av sparade uppdrag och säkerhetskopians återläsning.
  - **Bakgrunden:** `background.js` kör alla driftsparningar genom `saveDriftSettings`: `setMaxActiveSessions`, `saveQueueSettingsFromPanel` och det nya `EIC_GF_SET_POST_DELAY`. Därefter körs `reconcileDriftSettings`, som är köad. Samma avstämning körs vid start (en gång per Chrome-session) och efter import. Status finns i `fleetStatus.driftSettingsVault`.
  - **Panelen:** två statusrader visar valvets läge.
  - **Granskning:** första designen hade en enda sparningstid för hela gruppen och skrivning från panelen. Granskningen 2026-10-07 reproducerade dataförlust med den och ersatte den.

## Nytt i 1.9.1

- **Körkrav i bokmärkesvalv** (`lib/safety-policy-vault.mjs`; `syncSafetyPolicyVault` och `EIC_GF_SAFETY_UPDATE` i `background.js`; `updateSafetyPolicy`/`adoptSafetyPolicyFromVault` i `lib/usage-governor.mjs`):
  - **Spara körkrav** stämplar `policyUpdatedAtMs` i säkerhetsjournalen och skriver sedan valvet: mellanmapp, readback, commit.
  - **Start:** `safetyPolicyVaultPlan` väljer `ADOPT_VAULT`, `SEED_VAULT` eller `NONE`. Senast sparade version i profilen gäller. Värden från 1.9.0 saknar sparningstid och räknas som äldre än valvet.
  - **Valet görs om inne i journalens lås**, så en sparning som kommer under starten skrivs aldrig över.
  - **Synk en gång per Chrome-session.** Resultatet hålls i `chrome.storage.session`, och tidsgränsen är 8 s. Ett valvfel blockerar aldrig start eller sparning.
  - **Panelen** visar valvets status under Drift → Körkrav. `fleetStatus.safetyVault` och `safety.policyOrigin` exponeras.
  - **Händelseloggen** visar `SAFETY_POLICY_RESTORED`. Incidentloggen visar `SAFETY_POLICY_RESTORED` och `SAFETY_POLICY_VAULT_WRITE_FAILED`.

## Nytt i 1.9.0

- **Varm återupptagning** (`lib/warm-resume.mjs`; `buildQueueActivationProcess`, `tickRotating` och `abandonWarmResume` i `background.js`):
  - **Beslutet** `warmResumeDecision` fattas vid köaktivering. Varm väg kräver allt detta:
    - besvarad och fångad senaste tur;
    - parkering vid ett vanligt köbyte (`WARM_RESUME_PARK_OUTCOMES`);
    - ingen `ROTATE_SESSION_NOW`;
    - känd och entydig konversation, som ingen annan GFW har använt;
    - färre än 10 prompter i chatten;
    - högst 24 h sedan GFW:n lämnade den.
  - **Varm väg:** `sessionSeq` är oförändrad, meddelandet är `CONTINUATION` med `warmResumeObjective`, och fliken navigeras till GFW:ns konversation. Promptprofilen väljs av `selectPromptProfile` (COMPACT/FULL enligt 1.7.7).
  - **Sidkontrollen** `warmResumePageVerdict` kräver rätt konversation (15 s för omdirigering), laddad tråd, inget pågående svar, tom inmatning och att senaste användarmeddelandet är GFW:ns egen prompt. Sidan måste bli klar inom 90 s. Annars bygger `abandonWarmResume` den kalla FULL `SESSION_ROTATION`-prompten (`sessionSeq`+1) och öppnar en ny chatt.
  - **Inställningen** `warmQueueResume` är på som standard och syns i panelen under Grundparametrar.
  - **Händelseloggen** visar `QUEUE_ITEM_ACTIVATED` med `warmResume`, samt `WARM_RESUME_READY` och `WARM_RESUME_ABANDONED`.
- **Panelens redigeringsskydd** (`lib/panel-edit-guard.mjs`, `sidepanel.js`):
  - `guardedSet` skriver inte över ett fält som har fokus eller en osparad ändring, och markerar ändringen med `gf-unsaved`.
  - `guardedHtml` bygger inte om kölistan, rensningslistan eller dropdownernas alternativ när innehållet är oförändrat, när ett fält i dem har fokus eller medan en ändring verkställs.
  - Efter en verkställd köplatsändring byggs raden om direkt, och markören står kvar i fältet.
  - Processhändelsen tömmer inte längre instruktionsutkastet.
- **Arbetsläge vid start** (`lib/work-mode-supervisor.mjs`; `enableWorkModeAtStartup` och `syncWorkModeForWorker` i `background.js`):
  - `runtime.onStartup` och `runtime.onInstalled` slår på `workModeEnabled`, med readback.
  - En ansvarig worker som inte längre kör ersätts av den körande workern. Den reserverade workern föredras.
  - Händelseloggen visar `WORK_MODE_ENABLED_AT_STARTUP` och `WORK_MODE_SUPERVISOR_CLAIMED`.

## Nytt i 1.8.14

- **Köbyte utan analys** (`lib/queue-boundary.mjs`, `maybeParkAtQueueBoundaryWithoutAnalysis` i `background.js`):
  - Gäller när ett köstyrt svar har giltig A2A-kontroll med status CONTINUE och antingen fullbordar kvanten eller begär `YIELD_TO_QUEUE`, `PAUSE_PROCESS` eller `BACKGROUND_SLEEP`.
  - En annan köplats måste kunna ta över. Det kontrolleras med samma parkeringsövergång, tillämpad på en kopia av kön.
  - Då parkeras platsen utan Nano/Hjalmar. Runtime-kontroll (med kvitton), delegeringar, schemaspärr, paus och checkpoint hanteras som efter en analys.
  - Den parkerade GFW:n återupptas från svarets eget `nextSuggestedAction`. `analysisEvidence.hjalmar` är `null` och beslutet är märkt `QUEUE_BOUNDARY_NO_ANALYSIS`.
- **Full analys som förut** vid:
  - ingen strukturerad kontroll;
  - status annan än CONTINUE;
  - `STOP_PROCESS` eller `COMPLETE_MISSION`;
  - `NANO_TASK`;
  - väntande operatörsinstruktion;
  - ingen annan körbar köplats.
- **Händelseloggen** får raden `ANALYSIS_SKIPPED_AT_QUEUE_BOUNDARY`.

## Nytt i 1.8.13

- **Död tur lämnar tillbaka platsen** (`staleTurnCapacityDecision` i `lib/waiting-refresh.mjs`):
  - Villkor: minst 60 s efter stegens F5 vid 30 min, sidan färdigladdad, ingen Stopp-knapp, ingen strömning, ingen upptagen inmatning och inget svar.
  - Flaggan `waitingRefresh.capacityReleased` skrivs före frisläppningen. Minutskanningen (`potentialActiveTurnDescriptor`) tar inte platsen igen.
  - Syns Stopp-knapp eller strömning igen tas platsen tillbaka med `observedEffect`, och den släpps inte igen förrän efter nästa omladdning.
  - F5/Ctrl-F5/köbyte efter 30/60/90/120 min är oförändrat. Ingenting skickas om.
  - Workerkortet visar ”Platsen lämnad tillbaka …”.
- **Händelselogg** (`lib/incident-log.mjs`, `eic.gf.incident-log.v1`, 400 rader):
  - Innehåller stegets moment med sidans läge, rotationer med orsak, köbyten och aktiveringar, platser som lämnas och tas tillbaka, spärrar som börjar (utom takten), Daybreak-spärrar, flikåterhämtning, återanslutningar och policyändringar.
  - Bara id, koder, tal och flaggor.
- **Diagnostikexporten** tar med händelseloggen, en sammanställning (`incidents`), kapacitetsschemaläggaren och promptgrinden.
- **Mindre rättelser:**
  - `SAFETY_POLICY_UPDATED` anger vad som ändrades.
  - Återanslutningsrader har egen tid.

## Nytt i 1.8.12

- **Reserverad plats:**
  - Inställningen heter `reservedWorkerId`.
  - Den väljs i fönstrets panel under **Drift → Reserverad plats**, eller på workerkortet med **Reservera plats** (`EIC_GF_SET_RESERVED_SLOT`, bunden till fönstrets verifierade worker).
  - Bara en reservation åt gången gäller.
- **Schemaläggaren** (`lib/global-capacity-scheduler.mjs`) räknar platser i två körfiler:
  - Med effektiv kapacitet 2 eller mer är en plats exklusiv för den reserverade workern (`EXCLUSIVE`), och övriga delar på kapacitet − 1.
  - Vid 1 plats (seriell återhämtning) går den reserverade först (`FIRST_IN_LINE`). Vid 0 skickar ingen.
  - Med Max parallella = 1 gäller ingen reservation.
  - Väntande och aktiva turer bär `workerId`.
  - Ingen pågående tur avbryts.
- **Panel och drift:**
  - Märket **Reserverad plats** visas på workerkortet och ”1 plats reserverad” i kapacitetsraden.
  - Driftstatus (`fleetStatus.reservation`) visar reservationens läge.

## Nytt i 1.8.11

- **Skickad prompt hittas i lång tråd.**
  - Underlag: ChatGPT:s produktionskod, manifest 4da31bb4 och 4ad86f39, läst 2026-09-28. Tråden renderar via en virtuell lista (`overscanCount` 2, `viewportHeightPx` 800, `estimatedHeightPx` 280). Långa användarmeddelanden fälls ihop (`collapsedLineCount` 20 och ett ”…”).
  - Content letar upp det användarmeddelande vars text innehåller promptens A2A-`messageId` (`resolvedBy` `PROMPT_MARKER`). Kvittot bygger på det i stället för på antalet turer.
  - Background skickar markören med i varje sidavläsning, också vid återställning efter omstart. Två träffar kopplar ingenting. I appskalet används inget ordningstal när en markör är given.
- **Skydd mot dubbelsändning:** syns markören i tråden före utskick skickas prompten inte (`PAGE_PROMPT_MARKER`).
- **Läs svar** på workerkortet (`EIC_GF_OPERATOR_READ_RESPONSE`):
  - Läser svaret direkt.
  - Kopplar vid behov ChatGPT:s senaste användartur efter föregående Greenfield-tur, med operatörens proveniens.
  - Skickar aldrig om.
- **Gå till nästa uppgift i kön** på workerkortet (`EIC_GF_OPERATOR_NEXT_QUEUE_ITEM`):
  - Parkerar uppdraget med checkpoint och startar nästa körbara plats i en ny chatt.
  - Det parkerade uppdraget får `previousDisposition` `OPERATOR_QUEUE_ADVANCE` och promptens utfall (`sourceResponseState`).
- **Svar utan JSON** tas emot som alla andra svar; det är nu verifierat med test.

## Nytt i 1.8.10

- **Meddelanden i ChatGPT:s nya gränssnitt känns igen:**
  - Användarmeddelandet är `div.group/user-message`. Id:t i `data-chatgpt-search-message-ids` kommer när ChatGPT har sparat meddelandet.
  - Svaret är `div[data-chatgpt-search-message-ids]` med rubriken `h4[data-conversation-role=assistant]`.
  - Rubriken och tidsstämpeln tas bort ur fångad text.
  - Underlaget är ChatGPT:s produktionskod, build 4da31bb4, läst 2026-09-26.
- **Kvittot på skickad prompt väntar på meddelandets id** (inom samma 15 s). Utan id kvitteras sändningen ändå men utan kvitto, och turen löses sedan via ordningstal.
- **”Stoppa”/”Stop”** i `form[data-chatgpt-composer]` räknas som pågående generering.
- **Daybreak:** text inuti meddelanden utesluts från notisdetektorn. Turraden gör det inte, eftersom den riktiga notisen ligger där bredvid användarmeddelandet.
- Background är oförändrad. En process som hänger i `DISPATCH_EFFECT_UNRESOLVED` går till WAITING vid nästa omprövning utan omskick.

## Nytt i 1.8.9

- **EIC-adressen hittas vid köstart:** utan sparad adress, och med EIC vald på startsidan (pillret och rubriken har samma namn), öppnas högst tre GPT-konversationer från **Senaste**. Den vars URL har GPT-id och vars sida visar samma namn binder och sparar adressen. Ingen prompt skickas före bindningen. Utan träff stoppas kön (`EIC_GPT_ROOT_UNKNOWN`). Ytvakten binder inget medan kandidaterna besöks.
- **Startfel syns** under Starta/Stoppa arbetskö och i statusraden. Tidigare skrevs felet över direkt.
- **”Pro”** i modellväljaren räknas som Heavy (operatörsbeslut 2026-09-26), bara som helt ord.

## Nytt i 1.8.7

- **Köstart utan standardchatt:** roten för en köplats är flikens GPT, processens GPT eller den senast verifierade EIC-adressen, aldrig `chatgpt.com/`. Saknas alla tre avbryts köstarten med `EIC_GPT_ROOT_UNKNOWN`.
- **Landningskontroll i ny chatt:** sidan måste visa EIC (GPT-id i adressen, eller EIC-pillret och rubriken vid `/`). Annars prövas adressen utan namn, sedan klick på EIC under Fästa (högst tre). Efter 2 min utan EIC blir köplatsen `SESSION_ROTATION_EIC_NOT_SELECTED` och får försöka igen efter pausen.
- **GPT-identitet = id:** `/g/g-<id>-eic` och `/g/g-<id>` är samma GPT. Den namngivna adressen behålls som återställningsadress.
- **Ytvakten** godtar EIC vid startsidan och navigerar inte under en rotation.
- **Väntetexten** ”… den här begäran …” med statusrubrik räknas som status, inte svar.
- **Oförändrat:** modellspärren. Väljarläget ”Pro” hålls som `THINKING_MODE_UNVERIFIED` (policyfråga, se riskanalysen).

## Nytt i 1.8.6

- **Tidsstegen trots modellspärr:** i WAITING körs F5 30, Ctrl-F5 60/90 och köbyte eller ny chatt vid 120 min även när modellbeviset saknas. Stegen skickar ingen prompt, och varje senare utskick kontrolleras på nytt. En karantän efter bekräftad nedgradering mitt i en tur (`IN_FLIGHT_QUALITY_QUARANTINE`) är oförändrad.
- **Ny modellväljare:** tänknivån som ChatGPT visar i ”Välj ChatGPT-modell” räknas som bevis. Extra hög räknas som Heavy och Hög som Extended. Direkt är ingen tänknivå och förblir spärrad, utan karantän.

## Nytt i 1.8.5

- **Sparade uppdrag under Uppdragskö:** välj, **Redigera**, **Spara ändring** (samma id), **Spara som nytt** och **Ta bort** med bekräftelse. Räknaren visar `N / 64`, markerar fullt valv och anger antal GF-ID med dubbletter.
- **Import och export:** klistra in texter med rubriker `### GF-001`, eller en exporterad JSON-fil. **Förhandsgranska** visar ny, ändras och oförändrad samt dubbletter och ignorerade rader innan något skrivs. Varje post läses tillbaka ur bokmärkesvalvet. **Exportera alla** ger en JSON-fil som kan importeras igen.
- **Städa sparade uppdrag:** en lista med kryssrutor där äldre dubbletter och uppdrag utan GF-ID är märkta. Inget är förvalt. Köreferenser till en borttagen dubblett flyttas till det nyare uppdraget.
- **Referenser i stället för kopior:** köplatser och kö-set hämtar den sparade textens aktuella version när ett uppdrag läggs i kön, när ett set sparas eller laddas och när en köplats aktiveras, även en parkerad. Lagrade kö-set skrivs om direkt vid ändring. En pågående process byter text först vid nästa aktivering. Köplatser utan sparat uppdrag, till exempel EIC-delegerade, berörs aldrig.
- **Tak 64, ingen tyst radering:** ett nytt uppdrag i ett fullt valv nekas med ett synligt fel. **Spara aktuellt uppdrag** har en egen statusrad.
- **ChatGPT:s bearbetningsnotis:** ”Våra system bearbetar den här förfrågan …” räknas som statusrad och blir aldrig assistenttext, även om ChatGPT skulle lägga den i ett assistentmeddelande.

## Nytt i 1.8.4

- **Modellgolv:** `pattern` är giltigt i Chromes v-läge och godtar samma syntax som bakgrundens kontroll. Felet ”Pattern attribute value GPT[- ]… is not a valid regular expression” försvinner.

## Nytt i 1.8.3

- **Tidsgränser** på alla anrop till sidan, så att en hängd flik inte fryser processen.
- **Flikhälsa och återhämtningsstege:** sidan svarar inte, sidan ritas inte, inmatningsfältet eller tråden saknas → F5 → Ctrl-F5 → samma URL → ny flik → ny chatt. Stegen har takt, budget och tar aldrig åtgärd mitt i ett utskick.
- **Daybreak:** rotation till ny chatt, och vid upprepning paus 2 h → 6 h → 24 h. Aldrig BLOCKED.
- Se [TAB_HEALTH_DAYBREAK_V1_8_3.md](docs/TAB_HEALTH_DAYBREAK_V1_8_3.md).

## Nytt i 1.8.2

- **Ingen fångst av oavslutad JSON.** Detta gäller ledande objekt, objekt efter bilagekort och en avslutande `{`. Greenfield väntar vidare, och 120-minutersstegen är gränsen.
- **Observationsspår.** `process.responseObservationTrace` visar varför ett svar hölls eller godkändes, utan svarstext. Spåret följer med vid köbyte och indexeras i diagnostikexporten.
- Se [RESPONSE_OBSERVATION_V1_8_2.md](docs/RESPONSE_OBSERVATION_V1_8_2.md).

## Nytt i 1.8.1

- **Schema per köplats.** Högst 7 veckofönster (`days` 1–7, `HH:MM`, över midnatt tillåtet, `24:00` = dygnets slut) plus paus-till (högst 30 dagar). Platser utanför sitt schema hoppas över.
- **Pågående tur, sedan köbyte.** Parkering sker efter svaret med bevarad kvant (`SCHEDULE_WINDOW_CLOSED`/`SCHEDULE_PAUSED`). En spärr före utskick stoppar prompter som aldrig skickats.
- **`QUEUE_WAIT`.** Ny terminal fas när ingen plats är körbar. Kapaciteten släpps och väckarlarmet tar nästa plats.
- **AI `SET_SCHEDULE`.** Strikt validerad, operatörsföreträde, kvitton. Påbjuds i FULL-prompten (`control.workQueue.scheduleRule`). `control.workQueue.schedule` finns i varje prompt.
- **Kö-set.** Fönster sparas i set, och **Uppdatera valt** skriver över valt set med aktiv kö.
- Se [QUEUE_SCHEDULER_V1_8_1.md](docs/QUEUE_SCHEDULER_V1_8_1.md).

## Nytt i 1.8.0

- **Lager A – kontrakt i varje FULL-prompt.** `responseContract.learningControlContract` innehåller baseline (`You have no built-in knowledge of EIC.`), `THE FACTUAL OWNER WINS` och varje yta med *is / usedFor / isNot*. Där finns också AIK discovery och continuity check, Self-learn-klassning, Kaizen-keypoints, Operator Learning, routing, 3M, origin och stående triggers.
- **Lager B – dynamisk kapsel i varje prompt.** `control.learningControl` innehåller `project.aikScope` (`project:<id>` ur `Projekt: <id> - … - Gf: <GF-id>`), `workBlockId`, keypoints med trigger och obligationer (`REQUIRED`, `FRESH_RESULT_REUSABLE`, `REQUIRED_AT_DECLARED_KEYPOINT` …), plus `carriedOverObligations` och `previousResult`.
- **Deterministiska keypoints.** De utlöses av sessionsgräns och ny kvant, föregående blockering, stall eller okänd effekt, blockerare i två svar i följd, operatörsinstruktion och kvantens sista interaktion.
- **Lager C – resultat.** Det valfria svarsfältet `learningControl` normaliseras till en sluten, avgränsad form. Ett felaktigt värde påverkar aldrig svarets status.
- **Ingen prefetch, inga nya effekter.** Greenfield läser och skriver inte AIK, Kaizen eller Operator Learning.
- Se [LEARNING_CONTROL_V1_8_0.md](docs/LEARNING_CONTROL_V1_8_0.md).

## Nytt i 1.7.7

- **Terminal AI-signal verkställs.** `DONE`/`STOP_PROCESS` normaliseras till `COMPLETE_MISSION` och går genom samma DONE-commit och logiska retirement av alla dubblettplatser med samma `savedMissionId`. Andra GFW:er påverkas inte.
- **`runtimeControl` i svarskontraktet.** Target (`runId`, `turn`, `queueId`, `itemId`, `savedMissionId`) publiceras i varje prompt och måste kopieras exakt. Stale eller fel target ger `STALE` och ingen effekt. Ett felaktigt target tillsammans med `DONE` blockerar i stället för att pensionera.
- **Kvant och prioritet.** `SET_QUANTUM` tar heltal 1..15 och gäller från platsens nästa kvant. `SET_PRIORITY` tar `LOW|NORMAL|HIGH|URGENT`, aldrig över operatörens tilldelade prioritet för platsen.
- **Operatören vinner.** Köändringar som operatören gör efter att prompten skickades avvisar äldre AI-begäran (`OPERATOR_PRECEDENCE`). En väntande operatörsinstruktion stoppar AI-terminal. Panelen skickar bara det fält operatören ändrade.
- **Kvitton.** `APPLIED`, `ALREADY_APPLIED`, `REJECTED`, `STALE` och `INVALID` visas för AI:n i `control.runtimeControl.lastReceipts`.
- **FULL/COMPACT-prompter.** `promptProfile` visar profilen. COMPACT används bara med positiv konversationskontinuitet och uppgraderas till FULL före utskick om konversationen bytts (sedan 1.7.8 inte vid omladdning av samma konversation).
- **Självläkning.** Om kö-retirement efter DONE inte kunde skrivas görs den om innan kön väljer nästa plats.
- **`MISSION_RESTORE`** accepteras nu som A2A-meddelandetyp i köns återställningsväg.

## Bevarat från 1.7.6


- **`current_focus` är steering pointer, inte factual owner.** Nyare exakt owner-evidence styr alltid sin faktadomän.
- **Fresh owner-state före bounded work.** Project-bound continuation måste läsa/reconcile färsk subject-project state och `current_focus` före första arbetspaketet.
- **Material-delta-only writes.** `current_focus` får bara uppdateras när restart/lead-state materiellt ändrats; write är inte komplett utan owner readback.
- **Ingen stale replay.** Completed objectives/effects får inte köras igen därför att en steering pointer är gammal.
- **Scoped metadata failure.** Om focus-write saknas bevaras restart pointer via korrekt durable owner/chronology-route, metadatafelet routas till sin owner och unrelated safe work fortsätter utan blind retry.
- **Effect-owner revalidation.** Exakt effect target/owner ska revalideras före material effect.
- **Handoff-safe restart.** Mission state persisteras före pause/yield/block/done/handoff och focus ändras bara vid material restart delta.
- **Ingen 90 %-dispatchspärr.** Lagringsprocenten stoppar inte längre promptutskick.
- **Rolling checkpoint retention.** Efter verifierad checkpoint-publicering behålls primärvärdet plus en checksummad återställningsslot; den äldre alternerande slotten tas bort automatiskt.
- **Proaktiv high-water-städning.** Vid 80 % körs retention mot ett mål på 70 %.
- **Äldsta obundna workers först.** Om checkpointkompaktering inte räcker raderas hela process+queue-bundles för de äldsta workers som inte längre har en live `storage.session`-binding.
- **Aktiva workers skyddas.** En worker som är live-bunden kontrolleras igen precis före radering och lämnas orörd.
- **Kortare avslutshistorik.** Uppdragsköernas historik begränsas till 30 avslutade slots i stället för 100.
- **Kvotbuffert.** `unlimitedStorage` läggs till för att undvika att Chromes nominella 10 MiB-gräns hindrar en pågående kompaktering.
- **Driftstatus visar auto-retention.** Panelen visar procent och markerar lagringen som automatisk.
- **1.7.4-funktionerna bevaras.** Ordered cyclic queue, per-slot quantum, duplicate-GFW continuity och mixed-language model safety är kvar.

## Bevarat från 1.7.4

- **Strikt listordning.** Nästa körbara köplats väljs efter explicit position och kön wrappar cykliskt efter sista platsen; köplats-prioritet får inte längre omordna den inre worker-kön.
- **Riktig per-plats-kvant.** `maxInteractions` följs för den aktiva köplatsen. Tidig yield, pause eller blockerare bevarar ofärdig kvantprogress; först full kvant nollställer platsens räknare inför nästa varv.
- **Samma GFW flera gånger.** En sparad GFW kan läggas till flera gånger med separata `itemId`, positioner, prioriteter och kvanta. `savedMissionId` binder den gemensamma logiska missionens continuation.
- **Logisk stop/pause/block.** PAUSE/BACKGROUND_SLEEP pausar alla dubblettplatser av samma GFW och låter annan runnable köplats fortsätta; BLOCKED delar cooldown; DONE/STOP_PROCESS tar bort alla dubblettplatser för den avslutade logiska GFW:n.
- **Prioritetens ansvar är tydligt.** Per-plats-prioritet används när den aktiva platsen konkurrerar i den profilglobala kapacitetsschedulern, inte för att hoppa i den lokala listordningen.
- **Queue-set bevarar dubbletter.** Samma GFW kan finnas flera gånger i ett sparat set med olika ordning/prioritet/kvant.
- **A2A beskriver kökontraktet för EIC.** `ORDERED_CYCLIC_SLOTS`, kvantregeln, duplicate continuity och queue-local pause semantics annonseras i varje queue-managed envelope.
- **EIC ser sin faktiska kvant.** Varje queue-prompt innehåller bland annat `operatorDisplay`, t.ex. `Hög · 1 interaktioner/kvant · 0/1 slutförda i kvanten`, samt engelskt `planningHint`, återstående interaktioner och final-quantum-flagga.
- **Roundtrip-telemetri.** Prompten exponerar ungefärlig föregående response-roundtrip och, när slotten återkommer, loop-roundtrip för exakt samma köplats.
- **Full process-status på begäran.** EIC kan returnera `greenfieldStatusRequest=FULL_NEXT_PROMPT`; nästa prompt för samma logiska GFW får ett bounded `eic.greenfield.process-status.v1`-objekt utan prompt-/responsekroppar, hidden reasoning eller credentials.
- **BACKGROUND_SLEEP är inte DONE.** `CONTINUE + BACKGROUND_SLEEP`, även på sista interaktionen i kvanten, parkerar missionen och får inte placera den i `Klart/avslutade`; endast `DONE`/`STOP_PROCESS` är terminalt.
- **Mixed-language model safety bevaras.** Composer-first reasoning evidence, `nåla fast`/English Fast collision guard, finsk bounded vocabulary och English internal control med `en/sv/fi` evidence kvarstår från 1.7.3.

v1.7.3:s mixed-language model safety, v1.7.2:s multi-turn-liveness, v1.7.1:s dispatch-reconciliation och v1.7.0:s semantiska modellgolv bevaras.

Börja med [START_HERE_SV.md](START_HERE_SV.md). För uppgradering från 1.8.8, se [UPPDATERA_TILL_1_8_9.md](UPPDATERA_TILL_1_8_9.md); från äldre versioner, se även [UPPDATERA_TILL_1_8_8.md](UPPDATERA_TILL_1_8_8.md), [UPPDATERA_TILL_1_8_7.md](UPPDATERA_TILL_1_8_7.md), [UPPDATERA_TILL_1_8_6.md](UPPDATERA_TILL_1_8_6.md), [UPPDATERA_TILL_1_8_5.md](UPPDATERA_TILL_1_8_5.md), [UPPDATERA_TILL_1_8_4.md](UPPDATERA_TILL_1_8_4.md), [UPPDATERA_TILL_1_8_3.md](UPPDATERA_TILL_1_8_3.md), [UPPDATERA_TILL_1_8_2.md](UPPDATERA_TILL_1_8_2.md), [UPPDATERA_TILL_1_8_1.md](UPPDATERA_TILL_1_8_1.md), [UPPDATERA_TILL_1_8_0.md](UPPDATERA_TILL_1_8_0.md), [UPPDATERA_TILL_1_7_9.md](UPPDATERA_TILL_1_7_9.md), [UPPDATERA_TILL_1_7_8.md](UPPDATERA_TILL_1_7_8.md) och [UPPDATERA_TILL_1_7_7.md](UPPDATERA_TILL_1_7_7.md).

| Underlag | Innehåll |
|---|---|
| [RISKANALYS_FUNKTION_V1_8_7.md](docs/RISKANALYS_FUNKTION_V1_8_7.md) | Funktionell riskanalys av hela applikationen, kända okända och åtgärder |
| [TAB_HEALTH_DAYBREAK_V1_8_3.md](docs/TAB_HEALTH_DAYBREAK_V1_8_3.md) | Tidsgränser, flikhälsa, återhämtningsstege, Daybreak-rotation och paus |
| [RESPONSE_OBSERVATION_V1_8_2.md](docs/RESPONSE_OBSERVATION_V1_8_2.md) | Fynd i live-export, spärr mot oavslutad JSON, observationsspår |
| [QUEUE_SCHEDULER_V1_8_1.md](docs/QUEUE_SCHEDULER_V1_8_1.md) | Schema per köplats, `QUEUE_WAIT`, AI `SET_SCHEDULE`, kö-set-uppdatering |
| [LEARNING_CONTROL_V1_8_0.md](docs/LEARNING_CONTROL_V1_8_0.md) | EIC Learning & Continuity Control: tre lager, keypoints, obligationer, risker |
| [RUNTIME_CONTROL_V1_7_7.md](docs/RUNTIME_CONTROL_V1_7_7.md) | AI runtime-control, riskanalys, FULL/COMPACT-promptprofil |
| [OWNER_STATE_CURRENT_FOCUS_V1_7_6.md](docs/OWNER_STATE_CURRENT_FOCUS_V1_7_6.md) | Owner-state/current_focus restart- och replay-kontrakt |
| [STORAGE_RETENTION_V1_7_5.md](docs/STORAGE_RETENTION_V1_7_5.md) | Autonom high-water-retention och checkpointkompaktering |
| [ORDERED_LOOP_QUEUE_V1_7_4.md](docs/ORDERED_LOOP_QUEUE_V1_7_4.md) | Ordered cyclic slots, quantum continuity och duplicate-GFW semantics |
| [MODEL_LANGUAGE_ROBUSTNESS_V1_7_3.md](docs/MODEL_LANGUAGE_ROBUSTNESS_V1_7_3.md) | Root cause, språk-/evidencekontrakt och acceptance fixture |
| [MULTITURN_LIVENESS_V1_7_2.md](docs/MULTITURN_LIVENESS_V1_7_2.md) | Bevarat flerturns-kontrakt |
| [MODEL_COMPATIBILITY_V1_7_0.md](docs/MODEL_COMPATIBILITY_V1_7_0.md) | Bevarat modellgolv/reasoningkontrakt |
| [RELEASE_NOTES.md](docs/RELEASE_NOTES.md) | Versionshistorik |
| [BUILD_VERIFICATION.json](BUILD_VERIFICATION.json) | Genomförda kontroller och verifieringsgränser |
| [INTEGRITY.json](INTEGRITY.json) | SHA-256 för paketfilerna |

## Testa koden

```sh
npm test
node --test tests/v192-drift-settings-vault.test.mjs
NODE_PATH="$(npm root -g)" node tools/verify-drift-settings-vault.mjs   # kräver Playwright + Chromium
node --test tests/v191-safety-policy-vault.test.mjs
NODE_PATH="$(npm root -g)" node tools/verify-safety-policy-vault.mjs   # kräver Playwright + Chromium
node --test tests/v190-warm-resume.test.mjs tests/v190-panel-edit-guard.test.mjs tests/v190-work-mode-startup.test.mjs
NODE_PATH="$(npm root -g)" node tools/verify-panel-edit-guard.mjs   # kräver Playwright + Chromium
node --test tests/v189-queue-start-discovery.test.mjs
NODE_PATH="$(npm root -g)" node tools/verify-queue-start-panel.mjs   # kräver Playwright + Chromium
node --test tests/v187-eic-surface-new-ui.test.mjs
NODE_PATH="$(npm root -g)" node tools/verify-eic-surface.mjs   # kräver Playwright + Chromium
node --test tests/v186-hold-ladder-model-picker.test.mjs
NODE_PATH="$(npm root -g)" node tools/verify-model-picker.mjs   # kräver Playwright + Chromium
node --test tests/v185-saved-missions.test.mjs
NODE_PATH="$(npm root -g)" node tools/verify-saved-mission-admin.mjs   # kräver Playwright + Chromium
NODE_PATH="$(npm root -g)" node tools/verify-processing-notice.mjs   # kräver Playwright + Chromium
node --test tests/v184-pattern-attributes.test.mjs
NODE_PATH="$(npm root -g)" node tools/verify-sidepanel-patterns.mjs   # kräver Playwright + Chromium
node --test tests/v183-tab-health-daybreak.test.mjs
NODE_PATH="$(npm root -g)" node tools/verify-content-health.mjs   # kräver Playwright + Chromium
node --test tests/v182-response-observation.test.mjs
node --test tests/v181-queue-schedule.test.mjs
node --test tests/v180-learning-control.test.mjs
node --test tests/v179-stale-rotation-overlay.test.mjs
node --test tests/v178-prompt-continuity.test.mjs
node --test tests/v177-runtime-control.test.mjs tests/v177-runtime-control-e2e.test.mjs
node --test tests/v176-owner-state-current-focus.test.mjs
node --test tests/v175-storage-retention.test.mjs
node --test tests/v174-ordered-loop-queue.test.mjs
node --test tests/v173-language-model-safety.test.mjs
node --test tests/v170-model-compatibility.test.mjs
```

Ingen ny produktionsdependency och ingen ny Chrome-behörighet har lagts till i 1.7.7–1.9.2. Valvet använder den befintliga behörigheten `bookmarks`.
