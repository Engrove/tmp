## v1.9.53 — automatic worker takeover and generation fencing

- Worker collisions no longer gate a new session or require an operator reconciliation receipt.
- Ownership is fenced by `(workerId, processId)`, not by workerId alone.
- Superseded queue slots are fenced by exact `(workerId, queueId, itemId, savedMissionId)` identity.
- Prior uncertain effects are transferred to a fresh no-replay quarantine prompt; prior prompt hashes cannot be reused.
- Legacy ownership-wait pauses are cleared on queue read; ownership-only blocked slots are eligible for automatic takeover.
- Queue-state integrity errors remain isolated to their affected slot and do not stop independent queue work.

## v1.9.52 – återstart av QUEUE_WAIT och komprimering av sessionsarkiv

- Rättar ownership-recovery: `QUEUE_WAIT` är terminal processfas men saknades i listan över faser som får återstartas efter en observerad respons där causal-pairing-kvittot gått förlorat. Detta kunde lämna uppdrag permanent i `MISSION_PRIOR_EFFECT_UNRESOLVED`.
- Återstart sker i en ny konversation med no-replay-karantän och färsk owner-read. Krav på observerad tidigare respons, prompt-/user-turn-identitet, ingen pending dispatch och ingen levande gammal process kvarstår. Oobserverade/okända utskick förblir spärrade.
- Ownership-inventeringen behåller alla distinkta processgenerationer per GFW och deduplicerar endast samma process-ID. Ownership-liveness jämför exakt worker-ID och process-ID.
- Sessionsstartarkiv kan gzip-komprimeras reversibelt med kontrollsumma. Innehållet raderas inte.
- Startdiagnostiken visar GFW-identitet, felkod och pending dispatch-data per köpost.
- Operatörens budgetar, modellkrav, scheman, prioriteringar och övriga säkerhetsgränser är oförändrade.

## v1.9.51 – bindande GFW-policy och aldrig BLOCKED i operatörslistan

- FULL GFW-prompt innehåller bindande Project71-policyinstruktion, med krav på aktuell M1070, relevanta AIK Stream-meddelanden, dynamisk Fleet Supervisor-upplösning via M1057, isolering av repo/branch/runtime-effekter och mission-first execution.
- COMPACT-promptar ärver den oförändrade FULL-policyinstruktionen.
- Operatörens kölista, köhistorik, fleet worker-lista och promptens window-queue-projektion exponerar inte statusen BLOCKED. Interna karantäner visas som VÄNTAR/PAUSED med bevarad orsak.
- AI:s egna BLOCKED-beslut blir tidsstyrd PAUSED med exponentiell återkontroll. Okänd effekt och obekräftad initiering förblir spärrade internt tills korrekt owner-avstämning; de presenteras inte som BLOCKED i listan och skickas inte om blint.
- Operatörens STOP/PAUSE, schema, R3 och dubbel-effekt-skydd är oförändrade.

## v1.9.50 – korrekt köbyte efter avslutad initiering

Ägarskapskontrollen känner nu igen en verifierat avslutad sessionsinitiering och dess fortfarande osända arbetsuppdrag. Den gamla stoppade körningen hindrar då inte nästa köplats. Detta rättar den reproducerade övergången GF-2.105.1029 → GF-4.59.1030, där den avslutade initieringens svar låg i sessionInitialization.response medan lastResponse avsiktligt var tomt.

Nästa tillåtna köplats aktiveras automatiskt efter kvantum eller vid den beständiga köns återförsök. Pågående eller osäkra arbetsutskick och en faktiskt aktiv ägare behåller sina skydd; en sådan köplats fördröjer inte oberoende körbara uppdrag. Köväntans tid och orsak uppdateras efter återförsök.

Samtliga tidigare funktioner, inklusive kalendernollställning och knappen Nollställ alla räknare, ingår. Se ../INSTALLATION.txt och ../RAPPORT_v1.9.50.txt för uppdatering, verifiering och avgränsningar.

## v1.9.49 – manuell nollställning av förbrukningsräknare

Knappen ”Nollställ alla räknare” finns direkt under förbrukningsöversikten. Den nollställer tokens, svarreserv och antalet utskick för tre timmar, kalenderdygn och kalendervecka i hela tilläggsprofilen. Senaste manuella nollställningen visas i panelen. Befintliga gränsvärden, utskicksintervall, köer och pågående uppdrag behålls.

Nollställningen sparas under samma lås som budgetreservation och sändningsauktorisering. Körkvitton ligger kvar; sena svar från tidigare sända turer återför inte gammal förbrukning. En tidigare osänd reservation som faktiskt sänds efter nollställningen kontrolleras och räknas i den nya perioden. Budgetspärrade workers väcks för ordinarie kontroll. Operatörspaus, schema, modellkrav och verkliga leverantörsspärrar gäller fortsatt.

Automatiska dygns- och veckoskiften från 1.9.48 kvarstår: 00:00 respektive måndag 00:00 i Europe/Helsinki. Se ../INSTALLATION.txt och ../RAPPORT_v1.9.49.txt.

## Version 1.9.48 (2026-11-06)

- Calendar day and Monday-start calendar week budgets in Europe/Helsinki, with DST-aware local midnight boundaries.
- Preserve configured limits and compatible stored setting names; expose exact period metadata in usage summaries.
- Re-evaluate old rolling quota holds through the normal safety-hold and dispatch pipeline.
- Recheck first send authorization against its current period under the usage journal lock; preserve original charge periods for late responses and idempotent retries.
- Preserve unfinished receipts and full current-week accounting on 25-hour Sundays; no midnight deletion or worker restart.
- Update Swedish budget labels and reset explanations. 1088/1088 local tests passed, including 34 new period and continuity tests.

## Version 1.9.44 (2026-11-04)

- Valbar resonemangsnivå per köplats i samma redigerare som schemat: Låg, Balanserad, Hög eller Extra hög.
- Sparning, uppdatering, bokmärkesvalv, applicering och säkerhetskopiering bevarar nivån. Äldre poster använder Extra hög.
- Verifiera exakt vald nivå före varje utskick. Anpassa reglage i båda riktningarna; Pro väljs aldrig som reserv.
- Bind kvitton och sista sändningsauktorisering till aktuell köplatsnivå. En ändring gäller nästa osända prompt; en redan skickad tur behåller sitt ursprungliga kvitto.
- Rensa schema bevarar sparad resonemangsnivå; dubbletter av samma uppdrag kan ha olika nivåer.
- Se ../RAPPORT_v1.9.44.txt för verifiering och begränsningar.

## Version 1.9.41 (2026-11-01)

- Lossless, keyed and checksummed gzip storage for large protected records; preserve independent primary and WAL, original JSON and revisions.
- Compact existing records under the checkpoint writer lock; retain unresolved or damaged evidence.
- Independent minute maintenance alarm and startup execution; per-storage in-flight deduplication and one-minute throttle.
- Report actual cleanup outcome, bytes freed, protected data and errors; replace unconditional auto status.
- Preserve physical diagnostic evidence even on decode failure; keep backups as original JSON.
- Include explicit verified expansion before downgrading to older storage readers. See ../INSTALLATION.txt.
- 843/843 local tests passed; no live Chrome installation or EIC dispatch verification.

## Version 1.9.40 (2026-11-01)

- Finish durable parks even when successor activation is blocked or eligibility changes.
- Recover exact completed-turn ANALYZING handoff checkpoints on tick/restart without replay.
- Keep speculative activation changes private; preserve watchdogs for duplicate process IDs.
- Arm durable queue wake for ready work without an active slot; retain compact queue diagnostics.
- See ../RAPPORT_v1.9.40.txt for evidence, tests and live-browser limits.

## v1.9.39 – återhämtning av återställt oskickat initieringsutkast

Kall köstart kan arkivera och tömma en exakt verifierad äldre Greenfield-initiering med NO_EFFECT_CONFIRMED. Ny initiering skapas via ordinarie kontrollkedja. Okända och ändrade utkast bevaras. Startväntan räknas i driftöversikten och kompakt startdiagnostik bevaras vid exportbegränsning. Se ../RAPPORT_v1.9.39.txt och ../INSTALLATION.txt.

## Version 1.9.38 (2026-10-30)

- Bind the Extra hög receipt to the selection (label, reasoning value, model, menu state), not to DOM node identity. Selection-preserving re-commits, child remounts and moves of the unchanged control no longer revoke it.
- Revoke permanently on a definite change: menu opened, reasoning value changed, model attribute changed, Pro or a recognized non-target level shown. Reverting the DOM never restores a revoked receipt.
- Use-time validation unchanged: identical present control, URL, selection key, model key, closed menu, enabled control, 60 s TTL.
- receiptStatus exposes the revocation reason and a bounded trail (8) of tolerated control events.
- Send-time model refusals carry stage and receipt reason (PRE_DISPATCH / PRE_STAGE / POST_STAGE) into hold.detail, dispatch.error and the incident log.

## Version 1.9.37 (2026-10-30)

- Separate original dispatch quality from next-prompt composer state; validate prompt/run/session/turn/transport identity and receipt freshness at original observation.
- Reconcile legacy composer quarantine only against original receipt and same exact observed user/conversation; bounded durable resolution ledger.
- Preserve page-health recovery while quarantined; never dispatch in reconciliation tick.
- Bound every thinking UI failure cache to 30 seconds.
- Preserve 45-second recovery spacing across changed tab conditions.
- Prefer structurally identified composer controls and exclude hidden/inert ancestors.
- Bind detached SENDING through its actual resumePhase.
- Repair stale regression harness dependencies and update obsolete rotation cooldown assertion.

## Version 1.9.36 (2026-10-30)

- Skilj passiv hjälptext från faktisk kontrollmeny och kontrollera samtliga kvarvarande kandidater vid stängning.
- Tidsbegränsa spärren för THINKING_MENU_CLOSE_FAILED till 30 sekunder; bakgrunden använder adapterns återförsökstid.
- Bevara skydd för operatörsutkast, navigation, oklara utskick och faktisk resonemangsnivå.
- Regression mot bifogad trigger-HTML och simulerad tooltip-återkomst enligt diagnostiken.

## Version 1.9.35 (2026-10-26)

- Föräldralösa STOPPED/DETACHED uppdrag med observerat svar men förlorat kausalitetskvitto kan starta ny, aldrig tidigare utskickad EIC-owner-state-läsning genom beständig karantänmarkör. Okänd gammal effekt kvarstår som UNVERIFIED och får inte upprepas.
- Ägarskapskonflikt är en väntan (PAUSED/VÄNTAR), inte BLOCKED eller en ackumulerande felräknare. Alla andra körbara köplatser prövas.
- Ägarskapsrelaterade BLOCKED-markeringar från 1.9.34 migreras automatiskt på start eller väckning, men potentiellt pågående lokala utskick undantas.
- Verkligt aktiva workers, in-flight effekter, skadade checkpoints och opålitlig eller saknad extern effekt kräver fortfarande säker avstämning; inga direkta dubbelsändningar tillåts.
- Samtliga versionsidentiteter och integritetsfiler genereras på nytt.

## Version 1.9.34 (2026-10-26)

- Proven bridge-version defect in v1.9.33 resolved (`content.js` shipped 1.9.32 but `APP_VERSION` was 1.9.33). The browser could never observe a matching `EIC_GF_PING` after re-injection.
- Bound failed repair attempts per tab to once per minute, with reset after successful PING or real tab navigation; never retry on each 1.2-second rotation tick.
- New semantic version and byte-integrity release gate; installed verifier distinguishes semantic version mismatch from file-hash mismatch.
- Three tests reproduced this defect (3/3 RED on old version, 3/3 GREEN after changes). Existing queue, owner and dispatch semantics unchanged.
- Full native EIC acceptance remains open; see `../SYSTEMATISK_KOANALYS_v1.9.34.md`.

## v1.9.31 — cold handoff provenance and Chromium offline smoke

- Strictly source-bind cached owner readback to current mission, source turn, prompt, response, queue identity and run before using it in the first/rotation capsule; no invented owner acceptance.
- Omit unverifiable AI-generated previous work objectives on cold session rotation, preventing circular side missions through a "hint" field. Keep prior owner confirmation as a scoped, expiring reference only; always reread before effects.
- Add a reproducible offline Chromium content bridge/READY DOM smoke harness. No new runtime blockers or permissions.

## 1.9.30 — focus-cycle and owner-first chat rotation
- Session broker operative prompt ceiling: 15 -> 6; three-quantum ceiling unchanged.
- A2A FULL/COMPACT carries a six-position per-turn focus instruction (no new response fields).
- Cold rotations clear prior conversation counters, prefer current owner receipts and force fresh owner re-read instead of inheriting an AI nextSuggestedAction as authority.
- Cold queue activation preserves unsent bootstrap-held work without consuming its turn; warm queue resume retains its proven conversation semantics.
- Existing prompt fences, exact-once effects and 1.9.29 READY hash handling unchanged.
- Tests: 290/290 non-DOM and new focus tests passed. 14 DOM-dependent test suites require jsdom not available in this build environment; native Chrome authentication was not tested.

## 1.9.29 — 2026-10-23

- Preserve assistant HTML block and br boundaries before ACK validation, including hidden tabs.
- Keep inline characters contiguous, user prompt extraction unchanged, and exact ACK/session/turn checks intact.
- Add transcript-derived DOM regression and work-release tests for the 2026-10-23 incident.

# Greenfield 1.9.9 RC1 Runtime — 2026-10-13

## Underlag och orsak

Skärmbilden visar `Uncaught Error: Extension context invalidated` på `content.js:1414`. Den bifogade texten visar samma `scheduleDirty`-kod som i basversionen och Thinking-kandidaten. Kodraden räcker därför inte för att avgöra vilken av dem som var installerad.

`chrome.runtime.sendMessage(...).catch(...)` fångar bara en avvisad Promise. Om API-anropet kastar direkt, såsom i den rapporterade händelsen, nås aldrig `.catch`. Sidans MutationObserver och andra timers kan fortsätta leva och utlösa fler anrop. En omladdning eller ersättning av tillägget är en möjlig förklaring till den ogiltiga anslutningen; bilden fastställer inte vilken åtgärd som föregick felet.

Panelen visar dessutom `ACTIVE_CHATGPT_TAB_REQUIRED`, medan aktiv flik är `chrome://extensions`. Startvägen kräver en ChatGPT-flik i rätt fönster om ingen giltig tidigare processflik kan användas. Bilden är förenlig med att starten försöktes från tilläggssidan. Detta är en separat startspärr och inte bevis för fel i Thinking-valet eller schemapausen.

## Ändringar

- Sidans fem typer av meddelanden till bakgrunden går genom en asynkron wrapper som hanterar både direkt kastade undantag och avvisade Promise-anrop. Vanliga transportfel förblir fel och kan inte godkänna ett utskick.
- När anslutningen är ogiltig kopplas DOM-observatör, statusruta, återkommande timers, fellyssnare, meddelandelyssnare och den gamla Thinking-adaptern bort. Städningen kan anropas flera gånger.
- Sena svar från en ersatt brygga ignoreras. Den gamla bryggans städning gäller dess egen Thinking-adapter, så att den nya instansen inte stängs av.
- Pågående operationer kontrollerar bryggans livscykel vid asynkrona gränser och direkt före Skicka-klicket. Ett redan utfört klick behåller `effectPossible: true` vid efterföljande fel. Befintliga dispatchkvitton och dokumentidentitet bevaras vid återinjektion i samma sidkontext.
- Fel vid svar på en stängd meddelandekanal utlöser inte ett andra svar som påstår att ingen effekt är möjlig.
- `ACTIVE_CHATGPT_TAB_REQUIRED` visas nu som: ”Välj ChatGPT-fliken i detta Chrome-fönster och starta arbetskön igen”. Flikvalet och startkravet är oförändrade.
- Runtimeversionen höjs till 1.9.9 för att den befintliga versionskontrollen ska begära ny sidkod.

## Verifiering och avgränsning

34 riktade tester passerar: 22 Thinking-tester och 12 fall för sidans livscykel, återinjektion, synkron/asynkron invalidering, saknat runtime-ID, vanliga mottagarfel, sen återkoppling, avbrott före/efter klick samt startmeddelandet. Livscykeltesterna kör hela sidbryggan i jsdom med simulerade Chrome-API:er. Utskickstester använder produktionsfunktionerna med kontrollerade sidtillstånd. Thinking-testernas formulär stoppar jsdoms oimplementerade standardsändning; själva Skicka-klicket mäts fortsatt.

Alla levererade JavaScript- och MJS-filer syntaxkontrolleras. Testresultat, versionsdiffar och kontrollsummor finns i paketet. Ingen livekörning i användarens Chrome har genomförts, och den ursprungliga fullständiga projekttestsviten saknades i källunderlaget.

Denna rättning ersätter inte tidigare analys av parallella workers och schemapauser. De dokumenterade bristerna i Nano-förkontroll, initieringshantering, uppstartskö, schemaretry, köägarskap och global felklassning kvarstår. Inga påståenden om att dessa är lösta ingår.

En redan ogiltig tilläggskontext kan inte återupplivas av den gamla koden. Berörda ChatGPT-flikar behöver läsas in igen efter uppdateringen. Kördata återställs inte och tillägget installeras inte automatiskt av detta paket.


### 1.9.32 | 2026-10-26 | Session-rotation and mission-queue liveness

- `ROTATION_TIMEOUT_COOLDOWN_MS=300000`; guarded one-shot blank navigation and exact persisted queue-level cooldown.
- Mission owner-blocker isolation with bounded retry; next eligible mission is evaluated without weakening the dispatch fence.
- Durable alarm purges prior historical mission snapshots in 128-key batches and records unresolved source effects as compact ownership tombstones before deleting payloads.
- 10,000,000-byte UTF-8 JSON log budget, FIFO (oldest first) and bounded diagnostic exports.
- Explicit recovery tests for active queue history, one-shot navigation, cooldown, independent successor, archive protections and retention.

## v1.9.52 – återstart av QUEUE_WAIT och komprimering av sessionsarkiv

- Rättar ett konkret ownership-recovery-fel: `QUEUE_WAIT` är en terminal processfas men saknades i listan över faser som får återstartas efter ett observerat svar med förlorad causal-pairing. Sådana uppdrag kunde därför fastna i `MISSION_PRIOR_EFFECT_UNRESOLVED` och återkommande köväntan.
- Återstarten använder alltid en ny konversation och en uttrycklig no-replay-karantän. Den kräver fortfarande en observerad tidigare respons, exakt prompt-/user-turn-identitet, ingen pending dispatch, ingen levande gammal process och ny ägarinläsning. Okända utskick utan observerad respons förblir spärrade.
- Liveness-kontrollen jämför nu både worker-ID och process-ID, så en gammal process i samma worker inte förväxlas med den nya processen.
- Session-start-arkiv blir reversibelt gzip-komprimerbara. Innehållet raderas inte och kontrollsumma/längd verifieras vid återläsning.
- Startdiagnostiken visar nu köpostens GFW-identitet, felkod och utskicksstatus så att nästa felanalys kan knyta symptom till rätt mission och process.
- Ingen ändring av operatörens modellkrav, promptbudgetar, scheman, prioriteringar eller no-replay-skydd.
