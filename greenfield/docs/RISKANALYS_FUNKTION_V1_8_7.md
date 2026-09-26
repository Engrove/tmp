# Funktionell riskanalys – EIC Autonom Agent Greenfield v1.8.7

Datum: 2026-09-26. Omfattning: **funktion** (att rätt arbete utförs, i rätt yta, utan att stanna eller förstöras) – inte säkerhet/sekretess.
Underlag: koden i v1.8.7 (background.js 9 000 rader, content.js, sidepanel.js, offscreen.js, 60 lib-moduler), `npm test`, DOM-verktygen i `tools/` samt operatörens rapporter och exporter 2026-09-25/26.

## Metod och skala

Varje funktion bedöms utifrån: externt beroende → felmod → konsekvens → hur felet upptäcks → befintlig mitigering (med kodreferens) → restrisk → åtgärd.

| Nivå | Sannolikhet (S) | Konsekvens (K) |
|---|---|---|
| **H** | Har inträffat, eller styrs av en extern part utan förvarning | Kön står still, fel yta/fel svar används, arbete förloras |
| **M** | Kan inträffa i normal drift | Fördröjning som återhämtas automatiskt eller med ett operatörsgrepp |
| **L** | Kräver ovanlig kombination | Brus eller kosmetiskt fel |

Restrisk = sammanvägning av S och K **efter** befintlig mitigering. "Verifierat" betyder test- eller verktygsutfall i detta repo. "Bedömning" markeras uttryckligen.

## Sammanfattning – högsta restrisker

| # | Risk | S | K | Rest | Status |
|---|---|---|---|---|---|
| 1 | Custom GPT:er avvecklas 11 december (ChatGPT-banner 2026-09-26: "GPT:er som inte migreras kommer inte att vara tillgängliga efter 11 december") | H | H | **H** | Ingen mitigering i koden. Hela EIC-ytan bygger på `/g/g-<id>` och fästa GPT:er. |
| 2 | Konversationsvyn i ChatGPT:s nya skal är overifierad: hur turer, stoppknapp och streaming märks | H | H | **H** | Exporten 2026-09-26 täcker bara startsidor: 0 träffar på `data-message-author-role`, `data-testid="stop-button"` och `send-button`. |
| 3 | Modellspärren för väljarläget "Pro" | H | H | **H** | `THINKING_MODE_UNVERIFIED` (verifierat, `tools/verify-eic-surface.mjs`). Varje köplats hålls. Kräver ett policybeslut av operatören. |
| 4 | UI-drift i ChatGPT generellt, en återkommande grundorsak (v1.8.5 notis, v1.8.6 modellväljare, v1.8.7 skal/GPT-val/notistext) | H | M | **M–H** | Spärrarna stänger säkert (fail-closed), men varje drift stoppar produktionen tills en patch finns. |
| 5 | Tidsstegen 30/60/90/120 min bortser från pågående generering | M | H | **M–H** | `lib/waiting-refresh.mjs` `evaluateWaitingRefresh` använder bara kvitterad prompt och fullständigt svar, inte `generating`. Långa Pro-svar ("Våra system bearbetar…") laddas om vid 30 min och överges vid 120 min. |
| 6 | Fel i hela miljön hanteras per köplats | M | M | **M** | Om EIC inte går att välja blir varje köplats BLOCKED efter 120 s och köas om efter 180 s, och kön roterar igenom alla platser. Inget skickas, men det blir mycket omsättning och brus. |

## Riskregister per funktionsområde

### A. EIC-yta och GPT-identitet (`lib/safety-policy.js` `eicSurfaceProof`, `lib/managed-eic-surface.mjs`)

| Felmod | S | K | Mitigering (v1.8.7) | Rest |
|---|---|---|---|---|
| Den nya URL-formen utan slug (`/g/g-<id>/c/…`) tolkas som fel GPT | H | H | Identitet = id-token (`gptRef`, `sameGpt`). Den namngivna roten behålls (`preferNamedRoot`). Verifierat: v1.8.6 fallerar, v1.8.7 godkänner (tests/v187 repro 1–5). | L |
| Köstart från "/" går till standardchatt | H | H | `resolveManagedGptRoot` använder aldrig en generisk rot. Utan känd EIC-adress blir det `EIC_GPT_ROOT_UNKNOWN`. Verifierat E2E: v1.8.6 navigerar till `https://chatgpt.com/`, v1.8.7 till EIC. | L |
| En ny chatt landar i standardchatt | M | H | Landningskontroll i `tickRotating`: först slug-lös adress, sedan klick på fäst GPT (högst 3 klick), annars BLOCKED `SESSION_ROTATION_EIC_NOT_SELECTED` efter 120 s. Aldrig SENDING i standardchatt (verifierat E2E). | L–M |
| Vid "/" bevisas EIC bara genom GPT-namnet (piller och rubrik) | M | M | Namnet ska matcha slugen i den verifierade roten. Tvetydigt namn, namnkonflikt eller saknat namn ger nej. Id-kontroll så snart URL:en har `/g/`. En omdöpt GPT eller två GPT:er med samma namn ger spärr, inte fel yta. | L–M |
| Klick på fäst GPT är ett syntetiskt `click()` | M | M | Verifierat bara mot handskriven DOM. Om ChatGPT ignorerar syntetiska klick blir det spärr efter 120 s. Operatören kan välja EIC för hand, vilket godtas. | M |
| EIC ligger inte bland Fästa | M | M | `PINNED_GPT_NOT_FOUND`. Inga klick i "Senaste". Operatörstext: fäst EIC. | L |

### B. Utskick exakt en gång (`content.js` `submitPrompt`, `authorizeDispatch`, `lib/send-fence.mjs`, `lib/dispatch-reconciliation.mjs`)

| Felmod | S | K | Mitigering | Rest |
|---|---|---|---|---|
| Kvittot går förlorat (transport, omladdning) | M | H | Persistent dispatch-id, materialiseringskvitto och `UNKNOWN_EFFECT`. Aldrig blint omskick (`DISPATCH_EFFECT_UNRESOLVED`). | L (men kräver operatörsavstämning) |
| Skrivfältet eller skicka-knappen hittas inte i nytt skal | M | H | Selektorer: `div[contenteditable][role=textbox]` och `form button[type=submit]`. Verifierat mot DOM-strukturen från 2026-09-26 (startsidor). | M, tills konversationsvyn är verifierad (risk 2) |
| Modellbeviset vid utskick | H | H | Kontroll före och efter `EIC_GF_AUTHORIZE_DISPATCH` (content.js). Ytan med namnbevis är verifierad. | Se risk 3 |

### C. Svarsobservation (`content.js` `canonicalEntries`, `generationSignals`, `lib/response-stability.mjs`, `lib/response-observation.mjs`, `lib/turn-causality.mjs`)

| Felmod | S | K | Mitigering | Rest |
|---|---|---|---|---|
| Turmarkörer ändras (`data-message-author-role`, `conversation-turn-*`, `data-turn-id`) | H | H | Flera selektorer med reservvägar. Kausal parning mot det egna utskickets tur-id. | **H** (risk 2; ingen export av konversationsvyn i nya skalet) |
| Stoppknappen känns inte igen, så "genererar" missas | M | H | Tre signaler (stoppknapp, streaming-attribut, upptaget skrivfält), svarsstabilitet och spärr mot oavslutad JSON-fångst (v1.8.2) | M |
| Väntetexten tolkas som svar | H | H | v1.8.7: "begäran" och ensam statusrubrik ("Planerade åtkomst") räknas som status. Verifierat: v1.8.6 gav assistenttexten `Planerade åtkomstVåra system bearbetar…`, v1.8.7 ger tom text (26/26). | L–M (bygger på text och skärmbild, inte DOM-export) |
| Operatören skriver i samma flik | M | M | Hanteras som extern interfoliering, inte kapning (FUNCTIONAL_BASELINE) | L |

### D. Modell- och tänknivåspärr (`lib/safety-policy.js` `evaluateModel`, `lib/model-observation.js`)

| Felmod | S | K | Mitigering | Rest |
|---|---|---|---|---|
| Väljaren visar "Pro" (data-selected-reasoning-effort="medium") | H | H | Hålls som `THINKING_MODE_UNVERIFIED` utan sticky karantän. Ingen tyst policyändring. | **H** tills operatören beslutat (risk 3) |
| Ny etikett eller texter på andra språk | M | M | Semantisk rankning, fail-closed | M |
| Nedgradering mitt i ett svar | L | H | `IN_FLIGHT_QUALITY_QUARANTINE` (sticky) för entydiga koder | L |

### E. Tidsstege och sessionsrotation (`lib/waiting-refresh.mjs`, `tickWaiting`, `armSessionRotation`)

| Felmod | S | K | Mitigering | Rest |
|---|---|---|---|---|
| Svaret uteblir (hängande session) | M | M | F5 vid 30 min, Ctrl-F5 vid 60/90 min, rotation eller köbyte vid 120 min (körs även under modellspärr sedan v1.8.6) | L |
| Legitimt långt svar (Pro/"bearbetar lite till") avbryts | M | H | Ingen: stegen räknar tid, inte aktivitet | **M–H** (risk 5) |
| Rotation till fel GPT | M | H | v1.8.7 landningskontroll | L |

### F. Arbetskö, schema, kvanta, kö-set (`lib/mission-work-queue.mjs`, `lib/queue-schedule.mjs`, `lib/mission-queue-sets.mjs`, `finalizeQueueTerminalAndMaybeAdvance`)

| Felmod | S | K | Mitigering | Rest |
|---|---|---|---|---|
| En köplats blir BLOCKED | M | M | Köas om med paus (180 s) och kön går vidare (`requeueBlockedMissionWorkItem`) | L |
| Miljöfel blockerar alla köplatser i tur och ordning | M | M | Inget skickas. Ingen hållning på miljönivå. | M (risk 6) |
| Utebliven retirering av en köplats (DONE sparades men köskrivningen föll bort) | L | M | Självläkning (`reconcileTerminalQueueSlot`) | L |
| Schemafönster eller paus | L | M | QUEUE_WAIT och väckningslarm, grind före utskick (v1.8.1) | L |

### G. Analys (Nano och Hjalmar D2 i `offscreen.js`, `lib/nano*.mjs`, `lib/hjalmar-d2.mjs`)

| Felmod | S | K | Mitigering | Rest |
|---|---|---|---|---|
| Prompt API/LanguageModel saknas eller modellen laddas ned | M | H | Förkontroll vid köstart (`ensureAnalyzerReadyFromGesture`, `LANGUAGE_MODEL_UNAVAILABLE`), tidsgränser och granskad reservväg | M (Chrome styr API:t; `minimum_chrome_version` 138) |
| Analysen missförstår svaret | M | M | Hjalmar D2 är evidensbunden och protokollstatus är bara rådgivande. Upprepningsskydd (`continuation-guard`). | M (bedömning) |

### H. Flik- och sidhälsa, Daybreak, kvotgränser (`lib/tab-health.mjs`, `lib/provider-notice.mjs`, `quotaSignal`)

| Felmod | S | K | Mitigering | Rest |
|---|---|---|---|---|
| Fliken kastas eller ritas inte | M | M | `autoDiscardable:false`, renderprobe, åtgärdsbudget 5 per timme, räddning vid stillastående tick efter 3 min | L |
| Daybreak-, kvot- eller rate-limittext ändras | M | M | Textmönster på sv, en och fi (`PROVIDER_NOTICE_HEADLINES`, `quotaSignal`) | M (textdrift, samma klass som risk 4) |
| GPT-migreringsbannern tolkas som spärr | L | M | Verifierat med antagen markup: ingen spärr, kvot eller rate-limit | L |

### I. Omstart, återställning, lagring (`lib/restart-recovery.mjs`, `lib/durable-checkpoint.mjs`, `lib/storage-retention.mjs`, `lib/operator-backup.mjs`, bokmärkesvalvet)

| Felmod | S | K | Mitigering | Rest |
|---|---|---|---|---|
| Service workern stängs av (MV3) | H | M | Larm, hydrering och bevisad konversationsidentitet (`conversationKey`, oberoende av slug) | L |
| Chrome startas om mitt i ett utskick | M | H | Kontrollpunkt, `RECOVERY_USER_TURN_UNPROVEN`, inget blint omskick | L |
| Sparade uppdrag går förlorade | L | H | Bokmärkesvalv i Chrome-profilen med skrivning och återläsning, lokal cache | L |
| Lagringstillväxt | L | M | Retention och `unlimitedStorage` | L |

### J. Arbetsläge (WMT, `lib/work-mode.mjs`, api.elho.fi)

| Felmod | S | K | Mitigering | Rest |
|---|---|---|---|---|
| Uppstarten av en uppgift fallerar | M | M | Pekaren sätts tillbaka till READY och fönstret stängs (`WORK_MODE_MATERIALIZATION_FAILED`). Ett fel i statusrapporten till endpointen ignoreras. | L |
| EIC-adressen saknas | L | M | `WAIT_EIC_URL` | L |
| GPT-avvecklingen | H | H | – | **H** (risk 1) |

### K. Panel och overlay (`sidepanel.js`, `lib/operations-view.mjs`, `lib/overlay-summary.mjs`)

| Felmod | S | K | Mitigering | Rest |
|---|---|---|---|---|
| Operatören ser en teknisk kod i stället för en orsak | M | L | `reasonLabel` på svenska; v1.8.7 även för köstartsfel | L |
| Spärrstatus syns inte | L | M | Driftöversikt och händelselogg | L |

## Kända okända (kräver underlag, inga antaganden)

1. **Konversations-DOM i nya skalet**: en användartur, ett pågående svar (stoppknapp, "Våra system bearbetar…" med rubriken) och ett färdigt svar. Operatören exporterar detta. Det saneras lokalt innan något sparas som fixtur (tokens, e-post, id:n bort).
2. **Om navigering till `/g/g-<id>-eic` väljer EIC i nya skalet.** Skärmbilden 2026-09-26 visar en sådan URL i en pågående EIC-konversation, vilket talar för ja. Fallbackkedjan i v1.8.7 gör svaret icke-kritiskt.
3. **Om ChatGPT tar emot syntetiska klick** på fästa GPT:er. Det avgörs vid första riktiga köstart; spåren `SESSION_ROTATION_EIC_SELECT_ATTEMPT` visar utfallet.
4. **Vad "plugin" innebär efter 11 december**, och om EIC kan migreras med bibehållen URL-, id- och chattyta.
5. **Den engelska och finska texten** i piller, knappar och notiser (inga prov).

## Åtgärder i prioritetsordning

| Prio | Åtgärd | Typ | Beslut/underlag |
|---|---|---|---|
| 1 | Beslut om "Pro": ska väljarläget "Pro" (effort `medium` enligt DOM-attributet) räknas som godkänd tänknivå? | Policy | Operatören |
| 2 | Export av konversationsvyn i nya skalet och replay i DOM-verktyg (turer, stoppknapp, notis) | Verifiering | Operatörens export |
| 3 | Plan för GPT → plugin före 11 december: testmigrera EIC i en kopia och mät ytan (URL, id, namn, skrivfält) | Förstudie | Operatören |
| 4 | Aktivitetsmedveten tidsstege: skjut upp F5 och rotation medan ChatGPT bevisligen genererar, med ett tak | Policyförslag | Operatören |
| 5 | Hållning på miljönivå: när EIC inte kan väljas pausas kön en gång i stället för att blockera varje köplats | Förbättring | – |
| 6 | Kanariefågel för UI-kontraktet i panelen: vilka selektorer och texter matchar på den levande sidan, med tidig varning för drift | Förbättring | – |

## Genomfört i v1.8.7 (verifierat)

- GPT-identitet utan slug, köstart och rotation utan standardchatt, landningskontroll, val av fäst GPT, ytvakt som godtar EIC vid "/" och inte stör en rotation, ny väntetext.
- Tester: `tests/v187-eic-surface-new-ui.test.mjs`, 13 st. Alla 13 fallerar mot v1.8.6 och passerar mot v1.8.7. Hela sviten: se `verification/`.
- DOM: `tools/verify-eic-surface.mjs` 26/26 (samma verktyg mot v1.8.6-skripten: 9/26).
