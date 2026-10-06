# GreenSea: design och analys (Greenfield 1.9.0 → lokal llama.cpp)

Status: GreenSea 0.1.0, 2026-10-06. Underlag: Greenfield 1.9.0 i denna repo (`greenfield/`) och llama.cpp `master` hämtad 2026-10-06 (`tools/server/README.md`, `server-task.cpp`, `server-context.cpp`, `server-common.cpp`, `server-schema.cpp`, `common/json-schema-to-grammar.cpp`).

## 1. Uppgift och ramar

- **Mål:** en applikation som håller långa autonoma sessioner över många prompter.
- **Ramar:**
  - körs som tjänst på en Linux-server;
  - skriven i Python;
  - har ett eget webbgränssnitt, ingen webbläsarplugin;
  - pratar med en lokal `llama-server` som förutsätts fungera.
- **Antas inte:** EIC eller någon annan backend (AIK, Kaizen, owner-ytor, `api.elho.fi`).

## 2. Vad Greenfield 1.9.0 är, mätt

Greenfield är ett Chrome MV3-tillägg om cirka 33 000 rader JS. `background.js` står ensamt för 10 225 rader. Det driver en anpassad GPT i ChatGPT genom att läsa och skriva sidans DOM. Koden består av tre lager:

1. **Observation av ChatGPT, största delen:**
   - skicka-staket och kausal parning mellan skickad användartur och svar;
   - svarsstabilitet (2,5 s / 3 läsningar), reservvägar för renderaren och virtualiserad tråd (1.8.11);
   - avbrutna JSON-svar (1.8.2);
   - stegen F5/Ctrl-F5 vid 30/60/90/120 min;
   - flikhälsa, Daybreak-spärrar, bevis från modellväljaren och EIC-ytan.
2. **Kontinuitetsstyrning, ytans oberoende idéer:**
   - tillståndsmaskin och kontrollprojektion (`ACTIVE|DONE` × `NEXT|BLOCK|OPERATOR|NONE`);
   - runtime-control med vitlista och kvitton, operatörsföreträde och upprepningsvakt (continuation guard);
   - sessionsrotation med checkpoint;
   - kö och kapacitetsschemaläggare med prioritet och åldring;
   - backoff, händelselogg och redigeringsskydd i panelen.
3. **EIC-specifikt:**
   - Learning & Continuity Control (AIK, Kaizen, Operator Learning) och owner-state/`current_focus`;
   - Work Mode-endpoint och delegering av uppdrag;
   - Chrome Nano (`NANO_TASK`) och Nano Observer.

GreenSea tar lager 2. Lager 1 försvinner av ett strukturellt skäl (avsnitt 3), och lager 3 utesluts av uppgiftens ramar.

## 3. Den avgörande skillnaden: vem äger konversationen

I Greenfield äger ChatGPT konversationen, och Greenfield kan bara observera den. Det mesta av lager 1 är försvar mot den osäkerheten: kom prompten fram, är svaret färdigt och hör det till rätt prompt?

I GreenSea äger tjänsten konversationen. Varje anrop till `llama-server` byggs från databasen: systemmeddelande plus sessionens **färdiga** turer i ordning plus det nya meddelandet. Svaret är HTTP-svaret på just det anropet. Det får fyra verifierbara följder:

| Greenfield-mekanism | Orsak där | I GreenSea |
|---|---|---|
| Skicka-staket, `DISPATCH_EFFECT_UNRESOLVED`, `PAGE_PROMPT_MARKER` | Omsändning skapar dubbletter i ChatGPT-tråden | Turen skrivs till databasen före sändning (write-ahead), och kontexten byggs bara av COMPLETED-turer. En avbruten tur kom aldrig in i kontexten, och llama.cpp har inga sidoeffekter. Därför är omsändning exakt och säker: samma lagrade meddelande skickas igen. |
| Kausal parning, svarsstabilitet, reservvägar för renderaren | DOM-observation | Strukturell parning (request/response). `finish_reason` anger att svaret är färdigt. |
| `runtimeControl.target` (runId, turn, queueId …) | Ett gammalt eller felfångat svar kunde utlösa effekter | Bindningen behövs inte och togs bort. Operatörsföreträde finns kvar (avsnitt 7). |
| FULL/COMPACT, FULL var 10:e prompt | Okänd historikhantering i ChatGPT | Kontraktet ligger i systemmeddelandet i **varje** anrop, per konstruktion. |
| F5/Ctrl-F5 vid 30/60/90/120 min | Ingen signal när genereringen dog | SSE-liveness: tidsgräns för första token, stopp i strömmen och totaltid. När anslutningen stängs stoppar llama-server genereringen. |
| Flikhälsa, Daybreak, modellväljare, EIC-yta | Webbläsarytan | Försvinner. Hälsan är `GET /health` och `GET /props`. |
| Global promptgrind (0–300 s takt) | Leverantörens begränsningar | Behövs inte lokalt. Kapacitetsschemaläggaren är den enda grinden. |
| Varm återupptagning (1.9.0) | En flik delas av köplatser i följd | Behövs inte: varje uppdrag har sin egen kontext i databasen. `cache_prompt` återanvänder KV-cachen för ett oförändrat prefix automatiskt. |
| Nano Task / Nano Observer | En liten lokal modell bredvid en molnmodell | Huvudmodellen är redan lokal, så en delegeringskanal tillför inget. |

Det som finns kvar av Greenfield är alltså styrningen, och det är den GreenSea bygger vidare på.

## 4. Verifierade llama.cpp-fakta som GreenSea bygger på

Hämtade ur källkoden, inte ur minnet:

| Fakta | Källa | Användning |
|---|---|---|
| `GET /health` ger 200 `{"status":"ok"}`, eller 503 under laddning; ingen API-nyckel krävs | README, `/health` | Hälsomonitor |
| `GET /props` ger `default_generation_settings.n_ctx` (per slot), `total_slots`, `model_path`, `build_info`, `is_sleeping`. `/health` och `/props` nollställer inte vilotimern | README, `/props` och "Sleeping on Idle" | n_ctx, kapacitet; övervakningen väcker inte en sovande modell |
| `usage.prompt_tokens` = hela promptens tokenantal, cachade inräknade (`n_prompt_tokens = slot.task->n_tokens()`); `prompt_tokens_details.cached_tokens` separat | `server-task.cpp` `usage_json_oaicompat`, `server-context.cpp` | Kontextmätning: storlek efter tur = prompt + completion |
| `stream_options.include_usage` ger en sista chunk med tom `choices` plus `usage`; `timings` sitter på sista delta | `server-schema.cpp`, `server-task.cpp` | Mätning även vid strömning |
| Kontextöverskridande ger feltypen `exceed_context_size_error` med `n_prompt_tokens` och `n_ctx` | `server-common.cpp`, `server-context.cpp`, `server-task.cpp` | Reservväg till rotation och kalibrering |
| Fel före första chunk ger HTTP-status och `{"error":…}`; fel mitt i strömmen ger `data: {"error":…}` | `server-context.cpp` (`format_error`) | Felklassning |
| `response_format` `{"type":"json_schema","json_schema":{"schema":…}}` eller `{"type":"json_object"}` begränsar svaret med en grammatik | `server-common.cpp` | Strukturerade svar |
| Grammatiken lägger obligatoriska egenskaper först, i schemats ordning. `maxLength` blir repetitionsregler | `common/json-schema-to-grammar.cpp` | Alla fält obligatoriska i ordningen arbete → bedömning. Längdgränser kontrolleras i Python. |
| `cache_prompt` återanvänder det gemensamma prefixet; bara suffixet bearbetas | README, `/completion` | Sessionen växer bara i slutet, så varje tur bearbetar bara nya tokens |
| Verktygsanrop kräver `--jinja` (standard i aktuella byggen) | README | Används inte: modellen får inga verktyg |

## 5. Arkitektur

```
 Webbläsare ── HTTPS/HTTP ──▶ aiohttp (web.py)
                               │  REST + SSE, token/cookie, CSRF-header, CSP
                               ▼
                         Engine (engine.py) ── en asyncio-task per aktivt uppdrag
                          │        │       │
          CapacityScheduler   LlamaMonitor   EventBus ──▶ SSE (token, uppdrag, händelser)
          (prioritet+åldring) (/health,/props)
                          │
                    LlamaClient (llama.py) ── SSE ──▶ llama-server (llama.cpp)
                          │
                    Database (db.py): SQLite WAL, synchronous=FULL, en tråd
```

Rena beslutsmoduler utan I/O, testade isolerat:
- `protocol.py`: kontrakt, rendering och tolkning;
- `effects.py`: validering av effekter och kvitton;
- `control.py`: styrbeslut;
- `context.py`: kontextmätning och checkpoint;
- `reviewer.py`: granskarens prompt och utslag;
- `scheduler.py`: kapacitetsschemaläggning.

### 5.1 Tillståndsmaskin

| Fas | Betydelse | Tillåtna övergångar |
|---|---|---|
| DRAFT | skapat | ROTATING (start), STOPPED |
| SENDING | väntar på llama och kapacitet, skickar | GENERATING, ROTATING, RECOVERING, PAUSED, NEEDS_OPERATOR, STOPPED |
| GENERATING | strömmar svar | ANALYZING, SENDING (endast efter omstart), ROTATING, RECOVERING, PAUSED, NEEDS_OPERATOR, STOPPED |
| ANALYZING | tolkning, effekter, beslut, granskare | SENDING, ROTATING, RECOVERING, PAUSED, DONE, NEEDS_OPERATOR, STOPPED |
| ROTATING | ny session från checkpoint | SENDING, RECOVERING, PAUSED, NEEDS_OPERATOR, STOPPED |
| RECOVERING | backoff efter tekniskt fel | SENDING, ANALYZING, ROTATING, PAUSED, NEEDS_OPERATOR, STOPPED |
| PAUSED | tidsatt (modell) eller öppen (operatör) | SENDING, ROTATING, NEEDS_OPERATOR, STOPPED |
| NEEDS_OPERATOR | väntar på dig, inte terminal | SENDING, ROTATING, STOPPED |
| DONE / STOPPED | avslutad; kan öppnas igen | ROTATING (öppna igen), STOPPED |

Greenfields BLOCKED var terminal. I GreenSea blir en verklig blockering NEEDS_OPERATOR, och uppdraget fortsätter när du svarar med en instruktion.

### 5.2 Turprotokoll och invarianter

```
analys/start ──▶ PREPARED (mål, meddelandetyp)
SENDING      ──▶ DISPATCHED (renderat meddelande lagrat, instruktioner förbrukade)  [en transaktion]
strömning    ──▶ COMPLETED (svar, usage, finish_reason)                              [en transaktion]
ANALYZING    ──▶ effekter + beslut + nästa PREPARED                                  [en transaktion]
```

- **I1:** högst en väntande tur (PREPARED/DISPATCHED) per uppdrag; `pending_turn` kontrollerar det.
- **I2:** sessionens kontext = systemmeddelande + sessionens COMPLETED-turer i ordning, med `<think>`-block strippade. Det är byte-identiskt mellan turer, så prefixcachen träffar.
- **I3:** varje tillståndsbyte är en transaktion under uppdragets lås och kontrollerar fasen på nytt. Runner och operatör kan inte ändra samma uppdrag samtidigt.
- **I4:** effekterna (minne, artefakter, prioritet) tillämpas i samma transaktion som beslutet, alltså exakt en gång.
- **I5:** en instruktion förbrukas av exakt en skickad tur. Den frigörs igen om turen flyttas till en ny session eller överges.
- **I6:** företräde gäller i ordningen operatör > GreenSeas ägartillstånd > modellens begäran.

## 6. Kontextstrategi: varför rotation och inte glidande fönster

Alternativ som valdes bort:
- **llama.cpp context shift** (`--context-shift`, `n_keep`) kastar tokens mekaniskt. Det kan ta sönder JSON-historik och turpar, och det sker utan att GreenSea vet vad som försvann.
- **Låta modellen sammanfatta sin egen kontext** kostar turer, glider över tid och misslyckas just när kontexten redan är full.

GreenSea roterar i stället från ett tillstånd som det själv äger:

- **Mätning.** Kontextens storlek efter en tur är `usage.prompt_tokens + usage.completion_tokens`. Nästa prompt beräknas som den storleken plus en uppskattning av det nya meddelandet. Uppskattningen använder tecken/token-kvoten, som kalibreras mot llamas siffror med glidande medelvärde och 10 % säkerhetsmarginal. Sessionens första meddelande räknas exakt via `/tokenize`.
- **Gräns.** Rotation sker när `prompt > rotate_at·n_ctx` (mjuk gräns) eller `prompt + max_tokens > n_ctx` (hård gräns). Ett sessionsöppnande meddelande som inte ryms ger NEEDS_OPERATOR (`CONTEXT_TOO_SMALL`) i stället för en loop.
- **Checkpoint** i det nya sessionsöppnande meddelandet:
  - framstegsloggen (senaste N sammanfattningar);
  - alla minnesnycklar;
  - artefaktindex med storlek, sha256 och tur;
  - öppna hinder;
  - slutet av senaste utdata;
  - nästa mål.
  
  Budgeten är `min(checkpoint_share·n_ctx, rotate_at·n_ctx − system − max_tokens − 400)`. Trimningen tar bort det minst värdefulla först: äldre logg, utdatans svans, sammanfattningslängd och därefter minnesvärdenas längd. Minnesnycklar, artefaktindex och hinder tas aldrig bort.
- **Minnesbudgeten** meddelas modellen i kontraktet (cirka halva checkpointbudgeten i tecken), så att modellen kan hålla anteckningarna inom det som följer med.
- **Reservväg:** `exceed_context_size_error` leder till rotation. Kvoten kalibreras från `n_prompt_tokens`, och `/props` läses om, eftersom servern kan ha startats om med ett annat `n_ctx`. Ett test hittade just det fallet.
- **Fler rotationsorsaker:**
  - modellens `ROTATE_SESSION` eller operatörens begäran;
  - ändrad uppdragstext;
  - `max_session_turns`;
  - tre formatfel i rad;
  - tre omplaneringar i rad utan framsteg.

## 7. Styrning: beslutstabell (`control.py`)

| Läge | Beslut |
|---|---|
| Inget komplett JSON-objekt (TRUNCATED/NONE/EMPTY) | Fortsätt med samma mål och en notis om vad som hände. Var 3:e fel i följd ger rotation; vid 6 fel går beslutet till operatören. Ofärdig JSON godtas aldrig. |
| `status=DONE` | DONE. Med granskare: ACCEPT ger DONE; REJECT ger fortsättning med granskarens nästa steg. Efter `max_rejections` avslag i följd går tvisten till operatören (`DONE_DISPUTED`). |
| `status=BLOCKED` | NEEDS_OPERATOR med modellens fråga. Med granskare: REJECT med körbart nästa steg ger fortsättning, eftersom ett falskt BLOCKED inte ska stoppa arbetet (jfr Greenfield `TARGET_CONTINUE_EXECUTABLE_NEXT_RECOVERY`). |
| `CONTINUE`, tomt `nextStep`, eller upprepat mål **utan framsteg** | Omplanering med ett fingeravtryckt alternativt steg (Greenfields continuation guard). Var 3:e gång ger rotation, vid 6 går beslutet till operatören. |
| Framsteg | Minst en tillämpad minnes- eller artefakteffekt, eller ny, icke-tom `output`. En omformulerad sammanfattning räknas inte. Därför är ”fortsätt med APPEND” inte en loop. |
| Turbudgeten är slut | NEEDS_OPERATOR (`TURN_BUDGET_EXHAUSTED`). DONE går före. |
| Operatören har begärt paus | PAUSED efter pågående tur; en pågående tur avbryts aldrig. |
| Modellens `PAUSE seconds` | Tidsatt PAUSED, 60–86 400 s. |

Granskaren körs bara där den kan ändra utfallet. Standardläget `terminal` granskar påståenden om KLART och BLOCKERAD, i linje med lärdomen från Greenfield 1.8.14 (ingen analys vid köbyte). Om granskaren inte är tillgänglig gäller påståendet, och det loggas.

## 8. Arbetarkontraktet

- **Systemmeddelandet** (engelska, 4 128 tecken, cirka 1 000–1 200 tokens, plus uppdraget) innehåller:
  - loopen;
  - begränsad kontext och vad som överlever en rotation;
  - ärlighetsregler, överförda från Greenfields `failureAcceptance`/`claimBoundary` och anpassade till att modellen saknar verktyg;
  - svarsformat och statusbetydelser;
  - minnes-, artefakt- och kontrollregler med exakta gränser;
  - uppdraget inom avgränsare.
- **Turmeddelandet** innehåller:
  - en rubrik (typ, tur, session och kontextfyllnad);
  - vid sessionsstart en checkpoint;
  - notiser (kvitton och styrbeslut);
  - begärt artefaktinnehåll;
  - en eventuell operatörsinstruktion;
  - målet.
- **Svarsschemat** har dessa fält: `output, artifacts, memory, summary, status, nextStep, blockers, question, control`.
- **Effekter:**

  | Område | Operationer och gränser |
  |---|---|
  | Minne | SET/DELETE; högst 64 nycklar à 2 000 tecken; högst 16 operationer per svar |
  | Artefakter | WRITE/APPEND; högst 64 st à 1 MB; högst 4 operationer per svar; säkra namn utan `/` och `..` |
  | Kontroll | PAUSE, ROTATE_SESSION, READ_ARTIFACT (högst 2), SET_PRIORITY (aldrig över operatörens tak, avvisas om operatören ändrat efter utskick) |

  Kvittonen `APPLIED`, `ALREADY_APPLIED`, `REJECTED` och `INVALID` skickas i nästa meddelande. Artefaktkvitton innehåller storlek och sha256 lästa ur databasen, det vill säga en återläsning.

## 9. Drift

- **systemd-unit** med `StateDirectory`, `ProtectSystem=strict`, `NoNewPrivileges`, `MemoryDenyWriteExecute`, `SystemCallFilter=@system-service` och tom `CapabilityBoundingSet`. `systemd-analyze verify` passerar utan anmärkning.
- **SIGTERM:**
  - SSE-strömmar stängs aktivt och runners avbryts;
  - avstängning mätt till 1,5 s med en öppen SSE-klient;
  - en avbruten generering skickas om vid start, och händelseloggen visar `RESTART_REDISPATCH`.
- **Säkerhetskopia:** `sqlite3 /var/lib/greensea/greensea.sqlite3 ".backup /säkert/ställe/greensea.bak"` fungerar under drift (WAL).
- **Export:** per uppdrag som JSON med sessioner, turer, instruktioner, minne, artefakter och händelser.

## 10. Verifiering

| Vad | Hur | Resultat |
|---|---|---|
| Hela kedjan över riktig HTTP/SSE mot fejkad llama-server enligt llama.cpp:s trådformat | `tests/` (42 tester) | 42/42 på Python 3.11.17 och 3.13; tre körningar i rad utan flakighet |
| Flertur med minne och artefakter, DONE | `test_engine_e2e` | ok |
| Rotation vid kontexttryck; checkpoint med minne och logg; alla anrop ryms i n_ctx | `test_engine_e2e` | ok |
| Eskalering vid formatfel (reparation → rotation → operatör), avhuggen JSON avvisas | `test_engine_e2e` | ok |
| 503, stopp i strömmen och fel mitt i strömmen ger omförsök med **identiskt** meddelande | `test_engine_e2e` | ok |
| Omstart mitt i generering ger omsändning, inga dubbletter | `test_engine_e2e` | ok |
| Paus/återuppta, stopp avbryter strömmen, öppna igen i ny session, instruktion exakt en gång, granskare avvisar falskt DONE, kapacitet 1 över 3 uppdrag, READ_ARTIFACT, ändrad uppdragstext roterar, tidsatt paus, llama nere utan förbrukade omförsök | `test_engine_operator` | ok |
| Inloggning/CSRF/CSP, livscykel över HTTP, inställningsvalidering, mallar, SSE med tokendeltan | `test_web` | ok |
| Webbgränssnitt i Chromium (Playwright) mot riktig tjänst och demo-llama | skärmdumpar, konsollogg | inga konsolfel; inmatning överlever live-uppdatering; ingen horisontell scroll vid 390 px |

**Inte verifierat i denna leverans:**
- körning mot en riktig `llama-server`-binär och riktiga modeller;
- hur väl en viss modell följer kontraktet;
- drift över flera dygn.

Fejkservern följer trådformatet ur källkoden, men den ersätter inte ett integrationstest på din server. Rekommenderat första test: ett uppdrag med `max_turns=20` och `reviewer.mode=terminal`. Kontrollera sedan:
- fliken Turer: tolkning `STRICT`, kvitton `APPLIED`;
- Sessioner: rotation när kontextmätaren passerar den röda markeringen;
- `cache` i turdetaljerna: tokens återanvända från prefixcachen.

## 11. Risker och möjliga nästa steg

- **Modellens följsamhet** är den största osäkerheten. Grammatikbunden JSON (`json_schema`) eliminerar formatfel men inte innehållsfel. Med resonerande modeller beror samspelet mellan grammatik och tänkande på mall och llama-version. Fungerar det dåligt, byt till `json_object` eller `off`; den toleranta tolkningen finns kvar.
- **Granskaren delar modell med arbetaren.** Ett naturligt tillägg är en separat endpoint för granskaren, till exempel en annan modell.
- **Verktyg** (skal, filer, HTTP) ger modellen handlingsförmåga men också risk. Greenfields runtime-control-disciplin är mallen om det byggs: stängd vitlista, kvitton, exakt en gång, operatörsföreträde, sandlåda. Det är medvetet utelämnat här.
- **Schemafönster och pauser per uppdrag (Greenfield 1.8.1) och reserverad plats (1.8.12)** kan läggas ovanpå `scheduler.py` utan ändring av turprotokollet.
- **Slot-KV spara/återställ** (`--slot-save-path`, `POST /slots/{id}?action=save|restore`) kan korta återstarten för många uppdrag på få slots. Det lönar sig bara om promptbearbetning är flaskhalsen. Nyare byggen cachar redan prompter i värd-RAM (`--cache-ram`, standard 8 GiB).
