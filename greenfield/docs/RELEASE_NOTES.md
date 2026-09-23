# 1.7.9 – stale queue rotation and overlay overview

- Efter 120 min utan färdigt svar (efter F5 vid 30 och Ctrl-F5 vid 60/90 min) gör en köstyrd körning ett fullständigt köbyte. Chatten överges, köplatsen parkeras som redo med oförändrad kvantprogress (den obesvarade turen räknas inte) och nästa körbara köplats i listordning aktiveras.
- Den parkerade GFW:n återupptas senare i ny chatt med `previousDisposition=SESSION_UNRESPONSIVE` och `sourceResponseState=PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE`. FULL-prompten beskriver regeln i `queueControl.staleSessionSemantics`.
- Utan annan körbar köplats, eller med stoppad kö, byter samma GFW till ny chatt som tidigare.
- Park-logiken delas nu av analysvägen och stallvägen (`parkSlotAndActivateNext`).
- Overlayen i fliken visar GFW-id, köplats, prioritet, interaktion/kvant och väntande kvantändring, samt en lokal nedräkning till köbytet och nästa F5/Ctrl-F5. Den visar också tur, session, aktivering, promptprofil, nästa GFW i kön och eventuell spärr. Nedräkningen körs i sidan mellan statussynkar och stoppas när ingen deadline finns.
- Lokal Node/static/harness-verifiering är inte samma sak som live Chrome/ChatGPT-acceptans.

---

# 1.7.8 – same-conversation reload keeps COMPACT prompts

- Rotorsak i live-körd 1.7.7: en tur på 33,7 min utlöste Greenfields egen stale-ladder-F5 (`tabs.reload` av samma `/c/`-konversation) efter 30 min. Nytt `documentId` räknades som sessionsgräns och tur 2 skickades FULL (`DOCUMENT_OR_CONVERSATION_CHANGED`).
- Kontinuitet förankras nu i konversationen där föregående svar fångades (`lastResponse.observation.conversationKey`), inte i sidans dokument-id.
- Omladdning av samma konversation, både Greenfields F5/Ctrl-F5 och manuell F5, behåller COMPACT. Ny chatt eller annan konversation ger FULL (`CONVERSATION_CHANGED`). Dispatch-vakten jämför bara konversationen.
- Regressionstest kör det live-körda förloppet genom verklig svarsfångst samt tolv verkliga turer: FULL exakt vid 1 och 11.
- Lokal Node/static/harness-verifiering är inte samma sak som live Chrome/ChatGPT-acceptans.

---

# 1.7.7 – AI runtime control and FULL/COMPACT prompts

- Rotorsak 1.7.6: `STOP_PROCESS`/`DONE` klassades som terminala men utan `controllerOverride`, så en lokal Hjalmar-`CONTINUE` kunde köra vidare och kö-retirement nåddes aldrig. Nu verkställs godkänd terminal kontroll.
- Nytt valfritt svarsfält `runtimeControl` med whitelistade operationer `COMPLETE_MISSION`, `SET_QUANTUM` (1..15, nästa kvant) och `SET_PRIORITY` (högst operatörens tak).
- Legacy `DONE`/`STOP_PROCESS` normaliseras till samma `COMPLETE_MISSION`-handler; retirement av alla slots med samma `savedMissionId` har en enda ren implementation.
- Target-bindning (`runId`, `turn`, `queueId`, `itemId`, `savedMissionId`), replay-ledger, operatörsföreträde (`operatorEditedAtMs`, väntande instruktion) och kvitton i nästa prompt.
- Felaktigt target tillsammans med `DONE` blockerar (fail closed) i stället för att pensionera.
- Terminal kö-retirement försöker om en gång vid stale revision och självläker före nästa köval.
- FULL/COMPACT-promptprofil: FULL vid varje sessionsgräns och var tionde prompt; COMPACT uppgraderas till FULL före utskick om dokument/konversation ändrats.
- `MISSION_RESTORE` accepteras som A2A-meddelandetyp.
- Panelens köändring skickar bara det ändrade fältet.
- Lokal Node/static/harness-verifiering är inte samma sak som live Chrome/ChatGPT-acceptans.

---

# 1.7.6 – owner-state/current_focus resume safety

- Alla Greenfield-genererade A2A-envelopes bär ett explicit owner-state/current_focus-kontrakt.
- `project.current_focus` är `STEERING_POINTER_NOT_FACT_OWNER`; nyare exakt owner-evidence vinner konflikt.
- Project-bound continuation kräver färsk subject-project owner-state och reconcile av `current_focus` före första bounded work package.
- Focus-write sker bara vid material steering/restart delta och är komplett först efter owner readback.
- Metadata-write failure är scoped: bevara restart pointer via korrekt durable owner/chronology-route, route felet, gör ingen blind retry och fortsätt unrelated safe work.
- Completed effects får inte replayas från stale focus.
- Exakt effect target/owner revalideras före material effect.
- Pause/yield/block/done/handoff persisterar material mission state och uppdaterar focus endast vid material restart delta.
- GF-001 issue #1:s separata M3 work-package/receipt-kontrakt ingår inte i denna release.
- Lokal Node/static verifiering är inte samma sak som live Chrome/ChatGPT-acceptans.

---

# 1.7.5 – autonomous storage retention

- Tar bort den hårda `LOCAL_STORAGE_PRESSURE`-dispatchspärren vid 90 %.
- Kör automatisk retention vid startup/recovery-scan och före dispatch: trigger 80 %, mål 70 %.
- Checkpoints behåller i steady state primärvärdet plus en checksummad slot; äldre alternerande slot tas bort efter verifierad publish/readback.
- Vid fortsatt tryck raderas äldsta obundna worker-bundles (process + queue + checkpoints) först; live-bundna workers revalideras precis före deletion och bevaras.
- Queue history sänks från 100 till 30 terminala slots per worker.
- Manifestet lägger till `unlimitedStorage` som kvotbuffert så retention kan slutföras även för en profil som redan ligger nära den nominella Chrome-kvoten.
- v1.7.4 ordered cyclic queue, v1.7.3 mixed-language safety och övriga dispatch-/provider-/modelgränser bevaras.

---

# 1.7.4 – ordered cyclic queue, quantum-aware A2A and process-status request

- Worker-kön är en explicit ordnad cyklisk slotlista och loopar så länge kön är aktiv och runnable work finns.
- Samma sparade GFW får förekomma flera gånger med olika position, prioritet och kvant; slots delar logisk continuation men inte scheduling-parametrar.
- Ofärdig per-slot-kvant överlever yield/pause/block; full kvant nollställer bara den slotten inför dess nästa varv.
- `CONTINUE + BACKGROUND_SLEEP` på final quantum parkerar missionen och får inte gå till Klart/avslutade. Endast `DONE`/`STOP_PROCESS` är terminalt för den logiska GFW:n.
- Varje queue-prompt exponerar exakt kvantposition via `operatorDisplay`/`planningHint`, samt approximate response-roundtrip och loop-roundtrip när de finns.
- EIC kan begära `greenfieldStatusRequest=FULL_NEXT_PROMPT`; Greenfield levererar ett one-shot bounded `eic.greenfield.process-status.v1` i samma GFW:s nästa prompt.
- v1.7.3 mixed-language safety och English-internal/en-sv-fi-evidence-kontrakt bevaras.
- Ingen ny Chrome-behörighet eller extern dependency.

---

# 1.7.3 – mixed-language model safety + English internal control plane

- Rättar falsk `THINKING_EFFORT_UNKNOWN` där svenska `Nåla fast Djupanalys ...` kunde fångas av en för bred `aria-label*='Djup'`-selektor och ordet `fast` därefter feltolkas som engelska Fast-effort.
- Composer-lokal reasoning-kontroll prioriteras framför svagare dokumentglobala kandidater; den breda `Djup`-substringselektorn är borttagen.
- Språktolkning hanterar den kända svenska actionfrasen `nåla fast`/`fäst fast` innan effort-ranking och har bounded stöd för finska model/reasoning-termer.
- Greenfield A2A/Nano/Hjalmar inner workings använder engelska. `languageContext` deklarerar samtidigt att engelska, svenska och finska kontinuerligt kan blandas i UI/operator/source-evidence och att rå labels ska bevaras.
- Mixed-language ambiguity är inte bevis för faktisk modelldowngrade. EIC/Nano ska kontrollera råa labels, strukturell control-provenance och färsk proof innan modellbyte rekommenderas.
- v1.7.2:s multi-turn-liveness och tidigare fail-closed/exact-once-gränser bevaras.
- Ingen ny Chrome-behörighet eller produktionsdependency. Live Chrome/ChatGPT-acceptans är separat från source/package-test.

---

# 1.7.2 – flerturns-liveness och persistent UI-state

- Rättar v1.7.1-felet där `lastPrompt` från föregående turn kunde vinna över aktuell `pendingPrompt` under `SENDING` och därmed binda turn N till N−1.
- Turn ownership är lifecycle-baserad: pending äger SENDING; materialiserad lastPrompt äger WAITING/ANALYZING; SENDING-recovery följer explicit recoverTo.
- Aktuell dispatchs materialiserade browser user-turn-ID prioriteras framför härledd äldre turn-proof.
- Dynamiska regressioner använder runtime-genererade ID:n och produktionsfunktionerna över upprepade turns.
- Fullt schema-giltigt A2A-svar är också control-valid.
- Hjalmar D2 behåller bounded preview; controller återställer full kanonisk handoff vid strikt prefixförlust.
- Färsk allowed modelproof kan endast rensa den stale hold som exakt härstammar från föregående modelproof; andra safety-holds bevaras.
- Fleet `Uppdrag och identitet` bevarar open-state med stabil process-/workeridentitet över periodisk render/reorder.
- Generisk runtime-audit replay finns i `tools/replay-multiturn-audit.mjs`.
- Ingen ny Chrome-behörighet eller produktionsdependency.

---

# 1.7.1 – dispatch-reconciliation och kö-liveness

- Rättar v1.7.0-felet där en `ACKNOWLEDGED` dispatch kunde fastna i `SENDING` när ChatGPTs renderade user-text-hash skilde sig från dispatchens prompt-hash trots att user turn och trusted assistantsvar redan fanns.
- Content bridge publicerar ett separat materialiseringskvitto med dynamiskt observerat user-turn-ID och ordinal. Service worker binder kvittot till rätt worker, flik, content-document, dispatch-ID och pending prompt före persistens.
- `SENDING` använder materialiserat turn-ID eller verifierad persistent ordinal som kausal identitet. Ett exakt ID-mismatch failar stängt även om text-hash råkar matcha.
- Acknowledged/effect-possible state från 1.7.0 kan använda sitt persistenta `baselineUserCount` som förväntad ordinal. Okänd transporteffekt får inte använda baseline-ordinal som bevis.
- Restart recovery använder samma turn-proof-kontrakt som runtime: exakt konversation plus turn-ID/ordinal; hash är endast legacy-fallback när starkare identitetsfält saknas.
- Ett stale `CONVERSATION_TAB_NOT_RESTORED`-kvitto tas bort när processens egen live page-state verifierar exakt samma konversation. `AMBIGUOUS_CONVERSATION` och obevisad turn-recovery döljs inte.
- Gammal `safety.hold` rensas när en verifierad dispatch faktiskt går vidare till `WAITING`.
- `BACKGROUND_SLEEP`-köpolicyn är oförändrad och fortsatt `PARK_AND_SWITCH`; fixen tar bort den föregående SENDING-deadlock som hindrade analysen och därmed nästa READY-uppdrag.
- Den verkliga bifogade 1.7.0-auditen replayades: 19/19 identifierade stallcykler hade `ACKNOWLEDGED`, `effectPossible=true`, trusted färdigt assistantsvar, renderad hash-mismatch och efterföljande `DISPATCH_EFFECT_UNRESOLVED`.
- Lokal verifiering: 456/456 Node-tester PASS. Liveacceptans av 1.7.1 i användarens installerade Chrome-profil återstår.

---

# 1.7.0 – semantiskt modellgolv och robust reasoning-avläsning

- Modellkravet är nu ett numeriskt minimum när explicit GPT-version syns. Standard `GPT-5.6` accepterar 5.6-familjer och högre versioner, inklusive framtida `GPT-6 Astra`, utan familje-whitelist.
- Familjenamn som Sol, Luna och Astra påverkar inte kompatibilitetsbeslutet. Skaparens rekommendation är fortsatt diagnostik, inte automatisk aktuell-modellevidens.
- Avsaknad av exponerat modellnamn stoppar inte ensam en korrekt EIC-yta när reasoning-kontrollen kan verifieras och inga negativa signaler finns.
- `Djupgående`/`Deep` rankas som Heavy/Max. Okänd framtida reasoningetikett kan godtas vid Extended när kontrollen strukturellt är identifierad; Heavy kräver fortsatt rankbar hög nivå.
- Generiska, men begränsade, model/reasoning-selectorer har lagts till. Semantiskt lika modellkontroller med samma numeriska version är inte längre tvetydiga; konflikt mellan olika versioner eller mellan degraderat och normalt läge är fortsatt tvetydig.
- Explicit äldre modellversion, Auto/Instant/mini/Nano/Fast/fallback, Work/Codex, kvot/fallback och för låg effort stoppar fortsatt.
- 15 nya v1.7.0-regressioner täcker Sol/Luna/Astra, framtida familjenamn, numeriskt modellgolv, modellnamn som inte exponeras, `Djupgående`, okänd reasoningetikett och negativ evidens.
- Lokal verifiering: 442/442 Node-tester PASS och 103/103 JS/MJS `node --check` PASS. Live Chrome/EIC-DOM-acceptans har inte körts i byggmiljön.

---

# 1.6.1 RC2 – korrigerat startfel i RC1

- Rättar CHECKPOINT_WRITE_READBACK_FAILED följt av CHECKPOINT_UNRECOVERABLE när Chrome ändrar objektfältens ordning. Detta var ett fel i RC1, inte ett bevis för att användarens uppdrag var skadade.
- Kanonisk JSON och checksummad checkpointmetadata. Exakt verifierad migrering av kompatibla RC1-köer/journaler med separat originalarkiv och pausad återställning av oklart arbete.
- Nytt lagringsprov vid installerad startup, rå diagnostikexport och modellkontroll även utan aktiv process. Rekommenderad modell skiljs från uttryckligt aktuellt modellval.
- 429/429 tester passerar; 22 nya fall prövar serialisering och återställning som RC1:s testmiljö missade.
- Ingen installation i användarens profil eller liveacceptans av EIC-DOM påstås. Följ UPPDATERA_TILL_1_6_1.md.

---

# 1.6.0 RC1 – modellkrav, förbrukning och återställning

Releasekandidat 2026-09-08, byggd från användarens exakta 1.5.3-paket.

- Krav på godkänd Thinking-modell och minsta tänkenivå, med färska UI-kvitton före utskick och före analys. Nano är rådgivande; upptäckt nedgradering under tur ger karantän.
- Profilgemensamma lokala budgetar och uppskattad tokenförbrukning. Atomisk reservation och tillstånd vid sändningsgränsen. Ingen påstådd avläsning av återstående OpenAI-kvot.
- Två checksummade checkpoints, unik konversations-/prompthashbaserad återanslutning efter uppdatering/Chrome-start, rekonstruerade alarm och tydlig spärr vid osäkert utskick eller skadad lagring.
- Ny Körstatus med orsaker, förbrukning, modell, nästa kontroll, lagring, återställning och händelser. Pausad backupexport/återläsning.
- 407/407 tester passerar: originalets 324 plus 83 nya. Syntax och paketreferenser kontrollerade. Live Chrome/EIC, visuell panelacceptans och långtidsprov återstår.

Se `START_HERE_SV.md` och `docs/SAFETY_RECOVERY_V1_6_0.md`. Dessa kontrakt gäller framför äldre versionsformuleringar nedan.

---

# v1.5.3 — durable queue sets and Greenfield fleet status

- Saved mission queue sets now use an extension-ID-independent Chrome-profile bookmark vault with staged commit/readback and local-cache restoration.
- Existing local queue sets are migrated automatically into the durable vault on first read.
- Added a dedicated `Körstatus` tab optimized for above-the-fold fleet monitoring: active workers, capacity, waiting/paused counts, current mission, turn, queue state, rate-limit and prompt-gate state.
- Existing Drift, Uppdragskö and Arbetsläge tabs remain configuration/operation surfaces.

# v1.5.2

See `CHANGE_MANIFEST_V1_5_2.json` and `WORK_MODE_BACKGROUND_SURFACE_V1_5_2.md`.

# EIC Autonom Agent Greenfield v1.5.1

## Purpose

v1.5.1 closes the cross-window ownership defect family in the v1.5.0 work-queue model, restores
named reusable queue sets, and fixes queue-managed mission pauses being overridden by queue
switching.

## Fixed

- **Worker identity:** persistent runtime ownership is keyed by random `workerId`, not Chrome
  numeric `windowId`. `windowId` is a temporary browser attachment only.
- **No implicit orphan adoption:** a fresh Greenfield window starts with a fresh empty queue. It
  never adopts the newest vanished-window queue and never imports legacy per-window queue state.
- **No runtime snapshot contamination:** a queue snapshot can preserve process lineage only inside
  the same worker. Mismatched/legacy snapshots start a fresh process/run.
- **Process/token fencing:** process state is worker-keyed and current-token validation includes
  `workerId`, `processId`, `runId` and `generation`.
- **Side-panel ownership:** queue/start/stop/instruction/scheduler mutations validate the side-panel
  worker/window binding before execution.
- **Queue registry and same-worker write races:** profile-global registry writes are serialized; the
  registry stores metadata only and no longer mirrors other workers' queue bodies. Worker queues
  carry an optimistic revision so concurrent same-worker updates fail closed with
  `MISSION_WORK_QUEUE_STALE_WRITE` instead of silently overwriting one another. Lock-tail
  bookkeeping consumes expected rejections so a stale-write rejection cannot become an unhandled
  promise rejection.
- **Queue wake alarms:** wake alarms include and verify the worker identity, preventing a stale alarm
  from acting on a later Chrome window that reuses the same numeric id.
- **Named queue sets:** the Missions view can save, apply and delete named queue configurations.
  Templates contain configuration only; applying them creates fresh `READY` item identities and
  strips all runtime/process/resume/pause/delegation/error state.
- **600-second pause / pause precedence:** `PAUSE_PROCESS` now wins over queue quantum expiration.
  A queued mission requesting `pauseSeconds: 600` uses the mission-level not-before pause and cannot
  be parked/switched merely because its interaction quantum also ended. `YIELD_TO_QUEUE` remains a
  separate explicit switch action.

## Compatibility and migration

v1.5.1 deliberately does **not** auto-migrate v1/v2 queue records stored under
`eic.gf.mission-work-queue.window.<windowId>`. Those records are quarantined because a Chrome
window number cannot prove worker ownership. v1.5.1 worker queues use
`eic.gf.mission-work-queue.worker.<workerId>` and the v2 registry is metadata-only.

`chrome.storage.session` keeps the worker binding across MV3 service-worker suspension/restart while
the browser session remains live. A fully new browser/window lifecycle gets a new worker identity.
Reusable queue configuration across such lifecycles should be saved as a named queue set.

## Verification

The v1.5.1 regression suite covers:

- distinct worker identity and numeric-window-id reuse;
- fresh-worker empty queue and quarantine of legacy window records;
- concurrent two-worker queue-registry writes;
- worker-keyed process-store filtering and exact owner-token fencing;
- pause-vs-quantum precedence and exact 600-second not-before arithmetic;
- queue-set runtime-state stripping, fresh item IDs and concurrent set writes;
- static absence of orphan-rebind logic and presence of worker-bound side-panel mutation wiring;
- the full pre-existing Greenfield test suite.

## Claim boundary

Local source/unit/static/syntax/package-integrity verification applies to the packaged tree. Desktop
Chrome/ChatGPT end-to-end timing and multi-window acceptance still require execution in an installed
operator browser runtime; this package does not claim that external live acceptance was executed.

---

# EIC Autonom Agent Greenfield v1.5.0

## Purpose

v1.5.0 is a liveness and release-hygiene update over v1.4.0. It repairs a cross-feature failure
between response-producer-loss recovery and the profile-global capacity scheduler while preserving
exact-once dispatch and the scheduler's strict active-prompt mismatch protection.

## Fixed

- **Producer-loss re-arm deadlock:** an acknowledged autonomous turn whose response slot is closed
  by a later user turn now releases/cancels the obsolete scheduler ownership before a new
  continuation prompt hash is armed.
- **Idle-keepalive re-arm deadlock:** the same scheduler handoff is performed before an idle
  keepalive replaces an abandoned prompt.
- **In-place stale-slot self-heal:** SENDING detects the exact same-process/different-prompt mismatch
  while the replacement prompt has no dispatch effect, cancels the obsolete slot and retries instead
  of entering an endless capacity-wait watchdog loop.
- **Release hygiene:** removed the unused development-only `tmp_probe.mjs` probe from the package.

## Regression coverage

- same-process old-hash -> new-hash admission remains blocked until the obsolete scheduler owner is
  explicitly cancelled;
- producer-loss recovery cancels scheduler ownership before the SENDING transition carrying the
  replacement prompt;
- idle keepalive applies the same ordering;
- the shipped package excludes the temporary probe.

## Claim boundary

Local source/unit/static/syntax verification applies to the packaged tree. Desktop Chrome/ChatGPT
end-to-end acceptance still requires execution in an installed operator browser runtime.

---

# EIC Autonom Agent Greenfield v1.4.0

## Purpose

v1.4.0 adds delegated AI mission spawning while preserving the Greenfield ownership boundary:
a supervising worker may request durable follow-up missions, but another already-running
queue-managed Greenfield worker must accept and create them in that worker's own Chrome queue.

## Added

- optional queued EIC-A2A `missionDelegations` response field, maximum three requests per response;
- persistent delegation registry in `chrome.storage.local`;
- strict self-target prohibition: the source/supervising window can never claim its own request;
- worker-side acceptance on the target worker's own process tick;
- stable `requestId` idempotency and conflict rejection;
- queue/history deduplication by delegated request id;
- delegated child provenance shown in the mission queue;
- delegated priority capped at source priority;
- `SUPPORTS_CURRENT` and `UNBLOCKS_CURRENT` relations;
- child `DONE` may immediately make a still-live blocked source item retryable;
- pending delegation survives absence of an eligible worker rather than creating work locally.

## Preserved boundaries

- delegation does not itself pause, yield, rotate or stop the supervising mission;
- no new Chrome window/chat is created by the supervising worker for delegated durable work;
- temporary bounded work that belongs to the supervising mission may still run locally;
- schema-degraded response salvage never executes delegation mutations;
- `DONE` remains terminal.

## Verification boundary

Automated local unit/static/syntax/package checks validate the source behavior. Live Desktop
Chrome/ChatGPT acceptance remains a separate operator runtime test.

Details: `docs/DELEGATED_MISSION_SPAWNING_V1_4_0.md`.

---

# EIC Autonom Agent Greenfield v1.3.9

## Purpose

v1.3.9 repairs autonomous queue continuity. A mission-level `BLOCKED` outcome now means
temporary queue parking and reprioritization, not removal from the work queue. The release also
makes the queue durable across worker-window recreation and fixes persistence of the queue base
parameters.

## Fixed

- controller-level `BLOCKED` remains in the active mission queue with checkpoint/resume state;
- blocked missions yield to other runnable work and become eligible again after the configured
  priority-aging interval, preventing immediate hot-loop retries;
- queue wake alarms include future blocked-retry timestamps as well as timed pauses;
- terminal `DONE` remains terminal history; `STOPPED` remains terminal; audit/integrity failure
  is terminal `FAILED` history and never uses the retryable `BLOCKED` meaning;
- v1 queue migration restores retryable historical `BLOCKED` entries to the active queue while
  leaving `DONE` and audit failures in history;
- a profile-local queue registry mirrors per-window queues and can rebind an orphaned durable
  queue when Chrome recreates the worker window with a new id after restart/update;
- a rebound previously `ACTIVE` item is made `READY` with a restart-safe owner-state recovery
  objective instead of remaining permanently tied to a vanished window;
- **Grundparametrar för uppdragskö** are captured before the busy render can overwrite the form,
  then normalized, written to `chrome.storage.local`, and read back through operator settings;
- the side panel now shows `BLOCKED` in the active queue with its retry time and labels terminal
  history as **Klart / avslutade**.

## Verification boundary

Automated local Node/unit/static/syntax checks validate the source/package behavior described
above. Live Desktop Chrome/ChatGPT installation acceptance remains an operator runtime step and
is not inferred from source tests.

Details: `docs/BLOCKED_QUEUE_DURABILITY_V1_3_9.md`.

---

# EIC Autonom Agent Greenfield v1.3.8

## Purpose

v1.3.8 repairs live scheduler ownership and assistant-response completion without changing the
mission authority boundary.

## Fixed

- scheduler hydration now reconciles durable process records against exact live Chrome
  window/tab surfaces, pruning stale active/waiter ghost slots;
- managed tab/window close immediately releases scheduler ownership while leaving the process
  durable for bounded recovery;
- conceptual assistant turn text excludes known reasoning/lifecycle presentation fragments;
- response stability independently rejects lifecycle-only trusted observations, including the
  exact ten-character `Working...` incident class;
- complete later EIC-A2A controls such as `PAUSE_PROCESS` with `pauseSeconds=300` remain available
  to the existing parser/control state machine;
- `adoptGlobalTurnSlot()` is now explicitly restricted to owner-observed effect reconciliation,
  preventing ordinary admission code from using it as a capacity bypass.

## Verification boundary

The package includes deterministic regressions for the observed response and capacity failures.
Live Desktop Chrome/ChatGPT acceptance remains a separate post-installation check.

Details: `docs/RESPONSE_AND_CAPACITY_LIVENESS_V1_3_8.md`.

---

# EIC Autonom Agent Greenfield v1.3.7

## Purpose

v1.3.7 turns each Greenfield Chrome window into a serial multi-mission worker while retaining
the profile-global multi-window capacity scheduler and rate-limit circuit breaker. The release
is designed to reduce the number of simultaneously active ChatGPT conversations without giving
up the ability to run more than one Greenfield window.

## Added

- **Uppdragskö** side-panel view built from saved missions;
- per-window queue with persistent queue/readback state;
- per-mission `LOW|NORMAL|HIGH|URGENT` priority and manual order;
- per-mission interaction quantum, default `5`, adjustable `1..50`;
- queue priority aging, globally adjustable `30..3600 s`;
- inter-mission switch delay, globally adjustable `0..300 s`;
- fresh-conversation mission switching in the same managed ChatGPT tab;
- optional Ctrl-F5-equivalent hard reload after fresh-chat navigation;
- post-reload settle time, globally adjustable `0..30 s`;
- EIC-A2A queue-turn control and explicit `YIELD_TO_QUEUE` action;
- last-quantum/terminal prompt checkpoint instruction requiring durable owner persistence
  and restart-safe handoff where the mission will continue;
- automatic removal of terminal `DONE`, controller `BLOCKED`, `STOPPED` and audit-failure
  missions from the active queue into history;
- mission resume from persisted Greenfield process/handoff state in a fresh ChatGPT conversation.

## Retained

- multiple Greenfield Chrome windows;
- profile-global max-active-turn scheduler (`1..4`, default `2`);
- priority aging and non-preemptive active turns;
- profile-global ordinary prompt delay (`0..300 s`);
- v1.3.5 global rate-limit cooldown/serial recovery;
- exact-once send fence and existing recovery/session-rotation mechanisms;
- saved-mission vault and Greenfield Works ownership boundary.

## Isolation rule

A hard reload is not treated as a new mission context. The worker first navigates to the EIC
GPT root and verifies a fresh chat (`userCount === 0`) with an empty/ready composer. Optional
`bypassCache` reload then acts only as a browser-state preflight before the queued mission is
posted.

## Checkpoint rule

Queued mission prompts carry a control capsule that tells EIC when a quantum boundary is
approaching. The prompt also requires owner-safe checkpointing when EIC returns
`DONE`, `BLOCKED`, `YIELD_TO_QUEUE`, `PAUSE_PROCESS`, or `STOP_PROCESS`. Durable project/repo/
artifact/memory state must go to the relevant owner route; transient conversation text and
hidden reasoning are not checkpoint material.

## Verification boundary

The package's automated Node/static/syntax/integrity checks validate the local source/package
contract. They do not prove live Desktop Chrome behavior or ChatGPT service-side rate limits.
Live acceptance therefore remains an installation/runtime validation step, not a missing
source feature.

---

# EIC Autonom Agent Greenfield v1.3.6

## Purpose

v1.3.6 replaces unbounded normal-mode ChatGPT-turn concurrency with a profile-global,
priority-aware capacity scheduler while preserving the v1.3.5 rate-limit circuit breaker and
exact-once send fence.

## Added

- normal default capacity `2`, operator-adjustable `1..4`;
- per-process priority `LOW|NORMAL|HIGH|URGENT`;
- starvation-safe aging: +1 effective priority level per 180 seconds waited;
- deterministic tie-break `readySinceMs -> ticketSeq -> processId`;
- non-preemptive active turns;
- persistent active-turn and waiter state across MV3 service-worker hydration;
- automatic effective capacity `0` in cooldown and `1` in serial recovery;
- event-driven queue wake-up on slot release, priority change and capacity change;
- side-panel capacity, priority, queue-rank and scheduler-state controls/readback;
- dedicated scheduler unit/regression coverage.

## Anti-starvation guarantee

Priority may reorder young waiters, but it cannot indefinitely exclude lower-priority work. A
`LOW` waiter reaches effective `URGENT` after 540 seconds. At equal effective priority the oldest
ready waiter wins, so later urgent arrivals cannot continually overtake it. Priority changes do
not preempt a turn already in progress.

## Verification boundary

Source/unit/static/syntax/package-integrity verification is performed in the release build.
Live Desktop Chrome/ChatGPT acceptance with multiple simultaneous Greenfield windows is a separate
operator installation test and is not inferred from source tests.

---

# EIC Autonom Agent Greenfield v1.3.5

## Purpose

v1.3.5 adds a profile-global ChatGPT rate-limit circuit breaker with serialized client recovery,
per-client first-release browser recovery, and an expanded `0..300` second ordinary prompt-spacing
control. v1.3.4 is intentionally not shipped; the release line advances directly from v1.3.3 to
v1.3.5.

## Added

- shared `COOLDOWN -> SERIAL_RECOVERY -> NORMAL` rate-limit state;
- cooldown escalation `180/360/720/900` seconds for distinct incidents;
- serialized success ramp `180/150/120/90/90/90` seconds;
- per-epoch affected/prepared/recovered process tracking;
- first-release safe structural modal dismissal or Ctrl-F5-equivalent hard-reload fallback;
- final global-gate revalidation immediately before the page effect;
- rate-limit state/readback in the side panel;
- deterministic v1.3.5 rate-limit recovery and source-wiring regressions;
- `docs/RATE_LIMIT_RECOVERY_V1_3_5.md`.

## Warning-dialog boundary

The acknowledgement caption is not used as a selector. Detection combines modal structure with
multilingual request/throttle signals. A click is admitted only for an unambiguous single neutral
action and must be verified by modal disappearance plus composer readiness. Otherwise the client
uses a hard reload with `bypassCache:true`.

## Exact-once boundary

A rate-limit warning that is proven to have rejected the post before materialization is recorded
as no-effect. If effect status is uncertain, the existing exact-once fence still forbids blind
resend.

## Verification boundary

The local source/package verification can prove deterministic gate behavior and package integrity.
It cannot prove ChatGPT's current service-side quota model or live warning UX. Live Desktop
Chrome/ChatGPT rate-limit acceptance remains an operator-run step after installation.

---

# EIC Autonom Agent Greenfield v1.3.3

## Purpose

v1.3.3 fixes response-capture liveness for canonical A2A output without changing the
session-rotation, Session Health, mission-pause, Nano or owner-boundary contracts.

## Fixed

- a hidden but structurally trusted `EXPLICIT_TURN_SHELL` can no longer terminalize while
  it contains only an unclosed canonical `eic.a2a.response.v1` object;
- the live 42-character compact prefix
  `{"schema":"eic.a2a.response.v1","status":"` is held until the canonical object closes;
- `ROTATE_SESSION_NOW` therefore remains available to the existing control parser and
  session-rotation state machine once the complete response becomes observable.

## Compatibility boundary

The guard is structural and schema-specific. It does not convert protocol validity into a
new stability requirement. Complete malformed A2A objects still reach `parseTargetResponse()`;
complete hidden trusted responses can still become stable terminal responses; ordinary
protocol-absent prose is unchanged.

## Verification boundary

Deterministic Node regression, JavaScript syntax/import checks and final package
integrity/reopen checks verify the source/package fix. Live Desktop Chrome/ChatGPT rotation
acceptance remains an operator-run step after installation.

---

# EIC Autonom Agent Greenfield v1.3.2

## Purpose

v1.3.2 adds advisory Session Health telemetry and minified A2A JSON while preserving the v1.3.1
mission, pause, rotation, Nano and owner-boundary semantics.

## Added

- persistent per-ChatGPT-session health state with reset on session rotation;
- actual-post-boundary TTFR observation and response completion timing;
- clean per-session TTFR median baseline and relative latency ratio;
- Greenfield-managed prompt/response character-count context proxy;
- recovery-churn tracking;
- bounded `LOW|WATCH|ELEVATED|HIGH` pressure band with explicit signals;
- top-level `sessionHealth` capsule in every A2A envelope;
- compact `responseContract.sessionHealthControl` advisory boundary;
- `docs/SESSION_HEALTH_V1_3_2.md`;
- deterministic Session Health regression coverage.

## Prompt diet

A2A transport now uses minified JSON instead of two-space pretty JSON. This removes presentation
whitespace without deleting v1.3.1 response-contract semantics. The Session Health capsule is
additive.

## Safety boundary

Session Health is proxy telemetry, not model token truth and not an autonomous control owner.
Greenfield does not rotate solely because a local pressure band is elevated. EIC corroborates
physical pressure with semantic session-health risk and may use prompt-only Nano as a second
opinion when ambiguity remains.

## Timing separation

TTFR begins only at the actual prompt-post boundary. `PAUSE_PROCESS` and the profile-global
0–90 second post gate occur before that boundary and therefore do not inflate TTFR.

## Verification boundary

Deterministic source tests verify telemetry math, reset/idempotency, transport minification and
preserved control semantics. Live Desktop Chrome/ChatGPT Session Health calibration remains an
operator-run acceptance step after installation.

---

# EIC Autonom Agent Greenfield v1.3.1

## Purpose

v1.3.1 adds durable EIC-requested timed mission pause and removes the identical
`mission`/`objective` duplication at mission start without changing the mission authority
boundary.

## Added

- `sessionAction=PAUSE_PROCESS` with `pauseSeconds=300..86400`;
- dedicated `PAUSED` runtime phase and persisted `missionPause` receipt;
- one-shot `chrome.alarms` wake signal with process-state rehydration for Chrome 138+;
- side-panel mission-pause countdown and explicit early-resume action;
- `responseContract.pauseControl` plus a short EIC instruction in every A2A envelope;
- `docs/TIMED_MISSION_PAUSE_V1_3_1.md`;
- compact mission-start objective distinct from the invariant full mission.

## Separation from the 0–90 second gate

Timed mission pause is process-local scheduling. The existing 0–90 second gate remains
profile-global prompt-post spacing and still executes after a mission pause wakes and the process
returns to `SENDING`.

## Wake boundary

The requested resume instant is a not-before target, not an exact execution SLA. Chrome alarms
may be delayed and do not wake a sleeping device. Persisted process state is therefore the owner;
the alarm is recreated on hydration and overdue pauses resume when runtime becomes available.

## Verification boundary

Deterministic Node regressions, JavaScript syntax/import checks and final package
integrity/reopen checks verify source/package invariants. Live Desktop Chrome/ChatGPT wall-clock
acceptance remains `NOT_RUN` until the operator installs and exercises the extension.

---

# EIC Autonom Agent Greenfield v1.3.0

## Purpose

v1.3.0 replaces the accidental "Nano may know EIC context" behavior with a strict prompt-only
epistemic contract. Nano may perform simple or complex reasoning, but every required fact and
data item must be supplied in that invocation's prompt.

## Added

- `PROMPT_ONLY` Nano knowledge boundary and `PROMPT_CLOSED_EXECUTION_V2`;
- structured one-line `eic.greenfield.nano-task.request.v2` for inline data-bearing tasks;
- deterministic prompt-closure preflight for obvious external-state dependencies;
- terminal `CONTEXT_REQUIRED` Nano state with zero model calls when preflight rejects;
- `NANO_CONTEXT_REQUIRED:` fail-closed model response for missing information discovered after
  admission;
- A2A response-contract capability declaration: no EIC/project/file/tool/browser/web/API/
  chat-history/previous-turn/hidden-context access, while reasoning depth is not artificially
  limited;
- prompt-only metadata on Nano Task and Nano Observer evidence;
- regression fixtures covering the prior impossible CSV/JSON metadata task, accepted complex
  inline-context work, legacy arithmetic, context-required reconciliation and continuation.

## Behavior

A reference such as "read the existing CSV/JSON metadata" is not a valid Nano task because the
data is outside the Nano prompt. EIC must read that data through the correct source and either
do the analysis itself or embed the necessary content into a new prompt. Conversely, a complex
classification task is valid when the full dataset needed for the answer is included inline.

`CONTEXT_REQUIRED` is a Nano terminal result, not a Greenfield mission blocker. The same
missing-context task is not replayed blindly.

Nano Observer remains present, but its `summary`, `intent`, `materialFacts`, `uncertainties`,
`continuityRisk` and `recommendedFocus` are explicitly scoped to the bounded fields in its own
prompt and remain advisory.

## Verification boundary

Deterministic Node regressions, JavaScript syntax/import checks and package-integrity/reopen
checks verify the candidate source/package behavior. Live Desktop Chrome/ChatGPT acceptance is
not claimed by source tests and remains an operator-run gate after installation.

---

# EIC Autonom Agent Greenfield v1.2.3

## Purpose

v1.2.3 adds unattended cross-session continuity. Greenfield can move the same active mission to
a fresh EIC/ChatGPT conversation when the current chat is stale, lost or proactively judged by
EIC to be at material context-noise/drift risk.

## Added

- explicit response control `sessionAction=KEEP|ROTATE_SESSION_NOW|STOP_PROCESS`;
- `SESSION_ROTATION` continuation envelope and persisted `sessionSeq`;
- non-terminal `ROTATING` state with write-ahead handoff state;
- custom-GPT root resolution from the managed tab URL with persisted fallback;
- stale WAIT exhaustion changes from terminal BLOCK to session rotation;
- bounded detached-tab rebind followed by rotation when the original session is unavailable;
- new-chat freshness checks before dispatch;
- old-generation invalidation so the prior session cannot reclaim control after handoff.

## Safety and continuity

Rotation never means mission restart. Canonical mission identity/text remains stable and current
work is reconstructed from Greenfield Works and fresh owner state. Completed work must not be
replayed. Unknown prompt-send effect remains fail-closed and is not retried through a new chat.
`STOP_PROCESS` and `status=DONE` remain explicit terminal controls.

## Verification boundary

Deterministic Node regressions, syntax/import checks and package-integrity checks cover the
candidate source/package behavior. Live Desktop Chrome/ChatGPT multi-session acceptance remains
a separate operator-run gate after installation.

---

# EIC Autonom Agent Greenfield v1.2.2

## Purpose

v1.2.2 aligns the browser controller with Greenfield global continuation semantics and the
Greenfield Works execution-state contract. It fixes the false-stop class where an otherwise
valid `status=CONTINUE` response with a concrete `nextSuggestedAction` could be terminated
because scoped `blockers[]` text caused Hjalmar to return `BLOCKED`.

## Greenfield control plane

- adds `GREENFIELD_STATE=ACTIVE|DONE`;
- adds `GREENFIELD_ACTION=NEXT|BLOCK|OPERATOR|NONE`;
- treats target `blockers[]` as scoped evidence only, never as a direct browser stop signal;
- projects `CONTINUE + nextSuggestedAction` to `NEXT` when no independent human/safety/
  owner/exact-once hard stop exists;
- keeps actual human authority as `OPERATOR`;
- keeps exact-once unknown effect and genuinely missing executable continuation as `BLOCK`;
- preserves the original Hjalmar disposition in audit when a controller projection occurs.

## Saved missions

Saved missions are no longer durable only in extension-local storage. v1.2.2 keeps
`chrome.storage.local` as a cache and mirrors the canonical browser preset into a versioned
Chrome-profile bookmark vault. The vault is independent of the extension installation and
extension ID, restores local cache on a fresh install in the same Chrome profile, migrates
legacy v1.2.1 local presets on first load, and performs durable delete readback.

The persistence guarantee is intentionally scoped to the same Chrome profile/bookmark data.
Deleting the Chrome profile or bookmark data deletes the vault. Greenfield Works continues to
own mission-definition chronology and session receipts; the bookmark vault owns only browser
saved-preset persistence.

## Verification boundary

The Node regression suite, syntax/import checks, package integrity, package reopen and
uninstall/new-extension-ID vault simulation are release gates. Live Desktop Chrome/ChatGPT
acceptance remains an operator-run gate after installation.

---

# EIC Autonom Agent Greenfield v1.2.1

## Purpose

v1.2.1 repairs a deterministic WAITING/FORENSIC-Audit loop observed in v1.2.0 when a
causally correct, complete assistant response was classified as `ROLE_NODE_FALLBACK` /
`ownerTrusted=false` by the current ChatGPT DOM renderer.

## Response ownership repair

- preserves structural owner trust as the normal path;
- recognizes byte-coherent duplicate same-role/same-message renderer replicas as
  `COHERENT_ROLE_REPLICA`;
- deduplicates canonical entries by stable role/message id;
- adds a strictly bounded `CAUSAL_VISIBLE_FALLBACK` for visible exact-ID paired autonomous
  responses only;
- fallback requires at least 5 seconds and 5 stable reads before terminalization;
- hidden fallback fragments, ordinal-only pairing, causal mismatch and closed response slots
  remain fail-closed;
- emits `RESPONSE_CAUSAL_FALLBACK_ADMITTED` when the exceptional path is actually used.

## Audit/UI repair

Unchanged linked-tab overlay content is idempotent. Observation-time overlay sync no longer
adds repeated `MANAGED_TAB_OVERLAY_SYNCED` / `MANAGED_TAB_OVERLAY_RENDERED` noise when the
rendered state has not changed.

## Verification boundary

The source/package regression suite includes the captured v1.2.0 owner-untrusted loop,
the historical v1.1.6 hidden-fragment regression, and manual-interleave causal isolation.
Live Desktop Chrome acceptance remains a separate operator-run gate.

---

# EIC Autonom Agent Greenfield v1.2.0

## Purpose

v1.2.0 adds cross-window prompt-post pacing inside one Chrome profile so independent Greenfield
sessions cannot all post immediately after analysis. It also carries forward the v1.1.13 local
candidate controls for saved missions and the 0–90 second operator delay.

## Added

- extension-wide `chrome.storage.local` global prompt-post gate;
- persisted future prompt-slot reservation per autonomous prompt;
- actual-post-time recheck immediately before dispatch;
- short persisted send lease to prevent simultaneous cross-window page effects;
- prompt-post timestamp commit on acknowledged/effect-possible send and reconciliation;
- visible **Prompt pause** stage and live countdown in the status graphic;
- persistent 0–90 s **Paus mellan analys och post** control;
- up to 24 persistent saved mission presets.

## Safety and continuity

The prompt gate does not replace the existing exact-once dispatch fence. Unknown send effects
remain reconciliation-only and are never blindly replayed. Confirmed no-effect paths release the
send lease; successful or later materialized effects commit the actual prompt-post timestamp.

## Scope boundary

The shared gate is global only inside the same Chrome profile and installed extension instance.
Chrome profiles have independent extension storage and therefore independent gates.

## Verification boundary

Local deterministic tests and package readback validate source/package behavior. Live Desktop
Chrome multi-window acceptance is a separate operator-run gate and is not implied by source tests.

---

# EIC Autonom Agent Greenfield v1.1.12

## Purpose

v1.1.12 is an Audit stability release for long-running multi-window operation.

The source-level v1.1.11 investigation found five compounding Audit risks:

1. persistent Audit appended without retention/rotation;
2. side-panel reads materialized the complete global Audit store with `getAll()` before filtering;
3. every persistent write contended on one global IndexedDB sequence counter;
4. high-frequency WAIT polling repeatedly persisted structurally identical diagnostics;
5. `PAGE_STATE_OBSERVED` persisted raw assistant text and also transported the autonomous
   turn object containing the same response text, amplifying repeated payload size.

The observed Chrome crash causal chain remains a runtime hypothesis until a live Chrome
heap/quota/crash trace proves it. v1.1.12 removes the source-level mechanisms that made the
hypothesis plausible.

## Operator-controlled Audit

Persistent Audit is **off by default**.

The side panel now exposes a `Persistent Audit` checkbox.

### Checkbox off

- no Audit event is written to IndexedDB;
- a volatile rolling FIFO keeps only the 25 most recent event headers for the current
  side-panel view;
- FIFO data is in memory only and can disappear on MV3 service-worker/extension reload;
- NDJSON export is disabled because no new persistent background log is being produced.

### Checkbox on

- Audit events are persisted;
- persistent retention is bounded to 5,000 events;
- legacy excess history is pruned in bounded batches;
- repetitive `PROCESS_TICK`, `PAGE_STATE_OBSERVED`, `RESPONSE_OBSERVATION_HELD` and
  `RESPONSE_STABILITY_SAMPLE` events are sampled/coalesced when their material signature
  is unchanged within 5 seconds;
- NDJSON export is available.

The setting is stored in `chrome.storage.local`. Upgrading from a version without this
setting resolves to the safe default `false`.

## IndexedDB write-path repair

v1.1.12 no longer reads/writes the legacy `__global__` audit counter for each event.
Event identity uses timestamp + UUID and no cross-window counter hot spot is required.

The legacy counter store is left in the schema only for non-destructive upgrade
compatibility.

## IndexedDB read-path repair

Audit DB schema version is 3 and adds time-bearing indexes:

- `byTimestamp`;
- `byProcessTime`;
- `byRunTime`;
- `byWindowTime`;
- `bySessionTime`;
- `byScopeTime`.

`readAudit()` uses reverse cursors with a bounded limit. It does not call
`auditEvents.getAll()`.

The live side-panel feed normally reads the background-owned 25-event FIFO, so ordinary UI
renders no longer materialize persistent Audit history at all.

## Payload repair

`PAGE_STATE_OBSERVED` no longer persists raw `assistantText` or
`autonomousTurn.assistantText`.

It retains the state needed for diagnosis:

- document/message/user identity;
- hashes;
- text lengths;
- owner trust;
- generation/composer signals;
- autonomous pairing metadata;
- response-slot closure.

Raw captured assistant response evidence remains available at the response-capture boundary
when persistent Audit is explicitly enabled; it is not duplicated on every WAIT poll.

## Audit failure semantics

When persistent Audit is off, a process cannot enter `AUDIT_FAILURE` because IndexedDB
Audit persistence is not attempted.

When the operator explicitly enables persistent Audit, a process-scoped persistence failure
remains terminal `AUDIT_FAILURE`; that preserves the existing fail-closed contract for a
run whose operator requested durable forensic evidence.

## Unchanged runtime behavior

v1.1.11 stale-session liveness behavior remains unchanged:

- 30m -> F5;
- 60m -> Ctrl-F5;
- 90m -> Ctrl-F5;
- 120m -> `BLOCKED`.

Exact-once dispatch, causal response ownership, manual chat coexistence, Nano Task,
Nano Observer, Hjalmar D2, EIC-A2A/1 and continuation admission are unchanged except for
Audit telemetry volume/persistence.

## Verification boundary

Deterministic/static tests validate the v1.1.12 source/package invariants, including default
off, FIFO 25, bounded retention, no global-counter write path, no `getAll()` Audit read,
payload de-duplication and v1.1.12 identity.

These tests do not constitute live Desktop Chrome acceptance. Long-run multi-window Chrome
validation remains an operator runtime test.
