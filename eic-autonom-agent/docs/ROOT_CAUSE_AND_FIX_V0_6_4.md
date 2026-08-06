# Root Cause and Fix — EIC Autonom Agent v0.6.4

## Bevisunderlag

Analysen utgår från `eic-autonom-agent-v0_6_3-export-1785613986598.json` (132 887 byte,
SHA-256 `97d3c93d1423b77ea6546d4a1a7c666bb52ae49d86fec88d8a4ac11d7810233f`) och från replay
av v0.6.3-källkoden i Node. Varje rotorsak nedan är reproducerad, inte antagen.

## D1 — Nano-inputen översteg värdmodellens contextfönster

**Mekanism.** `buildNanoDecisionPrompt()` byggde prompten från fasta teckentak
(28 000 för senaste svar, 16 000 för konversationsutdrag) plus hela `targetMandate`
och hela continuity-projektionen. Ingen del av kedjan kände till `contextWindow`.

**Bevis.** Replay med exportens config och en 20 k/12 k-observation gav **48 571 tecken**.
Exportens egna auditposter visar `input 33 061`, `33 230`, `35 693`, `36 470 tecken` mot
`contextWindow: 9216` och `QuotaExceededError: The input is too large.` i 10 av 10 försök.

**Fix.** Ny `lib/nano-input-budget.mjs`:
`maxPromptChars = (contextWindow − contextUsage − outputreserv − ramreserv) × säkerhetsfaktor × tecken/token`,
konservativt 2,6 tecken/token. `buildNanoDecisionPromptDetailed()` allokerar budgeten
prioriterat (projektion → svar → mandat → konversationsutdrag) och **konvergerar mot den
faktiska promptlängden** i högst fyra rundor i stället för att lita på en uppskattad ram.
Panelhosten förmäter med `measureInputUsage()` när Chrome exponerar det och behandlar
`QuotaExceededError` som krympsignal (1,0 → 0,6 → 0,35) i stället för körningsfel.

**Verifierat.** Samma indata: 48 648 → 13 421 tecken mot budget 13 527, `withinBudget: true`.

## D2 — Kontinuiteten kompakterades aldrig

**Mekanism.** `compactContinuity()` trimmade först över per-listtak eller 32 000 byte totalt.

**Bevis.** Live-continuity var 18 630 byte → `compactionGeneration: 0`, `removedItems: 0`,
`mergedItems: 0` trots 16 turer.

**Fix.** Semantisk kompaktering körs vid varje beslut: dedupe på normaliserad primärtext
(merge) och åldersgallring mot `position.turnIndex` med garanterat `keepMin`. Dessutom
`projectContinuity({ maxChars })` + `boundProjectionToChars()` som binder projektionen till
promptbudgeten. Intent, position och öppna blockerare gallras aldrig.

## D3 — Anti-loop-räkningen var strukturellt trasig

**Mekanism.** `isAuditAction()` kördes på den sammansatta nyckeln `workUnit|requestedAction`.

**Bevis.** Arbetsenheten var `Reconcile/recreate immutable v6 candidate and verify publication status.`
Ordet `verify` i **arbetsenheten** gjorde varje åtgärd till en auditåtgärd. Replay med
exportens åtta verkliga action keys och `progressDelta = 1` gav audit=1 / productive=0 i
samtliga fall. Exportens `productiveActionCount: 0`, `auditActionCount: 21` är alltså en
artefakt av klassificeraren, inte en mätning av arbetet.

**Fix.** `actionSegmentFromKey()` klassificerar endast åtgärdssegmentet, med samma
effektverbsmedvetna semantik som `isMetaOnlyAction()`. Räkneordningen är omvänd:
verifierad progress rankar över ordval. Nya räknare `concreteActionCount` och
`lastActionClass` skiljer "transport fungerar" från "semantisk framdrift bevisad".

## D4 — Effektlexikonet saknade svenska implementationsverb

**Mekanism.** `CONCRETE_EFFECT` innehöll `reconcile|recreate|create|publish|commit|branch`
men inte de svenska motsvarigheterna. Målsessionen svarar på svenska.

**Bevis.** `isMetaOnlyAction("WP25.2.4 V6R1a — rekonstruera … verifiera …")` returnerade `true`,
vilket gav `targetNextIsConcrete: false` och `deriveDeterministicProgress = 0`.

**Fix.** Lexikonet utökat med `rekonstruera`, `återskapa`, `återställa`, `reparera`, `bygga`,
`generera`, `montera`, `installera`, `initiera`, `migrera`, `packa`, `exportera`, `sätta`,
`frysa`, `signera`, `publicera`, `submit`, `polla`, `push`, `merge`, `chmod` m.fl.
Utökningen kan bara minska falska `META_ONLY` och ger ingen ny behörighet.

## D5 — Anti-loop-omplaneringen förstörde verkligt arbete

**Mekanism och bevis.** D3+D4 gav `stagnationCycles: 12` och `STOP_META_LOOP`.
`shouldPauseForLoop()` skrev då över målsessionens konkreta `requestedAction` med en generisk
stegtext. Dubblettvakten eskalerade den till `PROMPT_REPETITION_OWNER_READ`, vars mall är
`Utför en färsk owner-read för <workUnit> via en ännu oprövad exakt locator…`. Exakt den texten
finns tio gånger i auditloggen. Loopen var självbärande: generisk metaprompt → målsvar utan
kontraktsprogress → ny generisk metaprompt.

**Fix.** En anti-loop-korrigering **bifogas** nu till en konkret, icke-upprepad åtgärd
(`ANTI_LOOP_CORRECTION_ATTACHED`) i stället för att ersätta den. Ersättning sker bara när
åtgärden faktiskt är meta eller när action key upprepas. Anti-loop-funktionen är alltså intakt
men kan inte längre kasta bort en giltig turn-bunden continuation.

## D6 — Blockerare kunde varken återasserteras eller stängas

**Mekanism.** `addUnique()` slängde en upprepad blockerare tyst, så `lastAssertedTurn` fanns
inte. Ingen väg stängde en blockerare. `buildDeterministicDecision()` ekade dessutom tillbaka
projektionens blockerare i varje beslut. Sidodefekt: `list()` läste bara `text|claim`, aldrig
`statement`, så planerarens blockerarkontext var i praktiken alltid tom.

**Bevis.** `workspace_trusted_session_required` låg öppen från `16:42:56` till exporten,
utan `unlockedBy`, genom minst 14 turer.

**Fix.** `upsertBlocker()` uppdaterar `lastAssertedTurn` vid återassertion.
`expireStaleBlockers()` markerar `open: false` med `closedReason: STALE_NO_REASSERTION_AFTER_N_TURNS`
— **detta är uttryckligen inte ett påstående om att blockeraren är löst**. Deterministiska
beslut ekar inte längre blockerare; de bärs som `carriedBlockers` (read-only). `list()` läser
numera även `statement`.

## D7 — Arbetsenheten avancerade aldrig

**Mekanism.** Deterministiska beslut satte `workUnit = projection.position.workUnit`.

**Bevis.** `position.workUnit` låg kvar på takeover-värdet och `position.phase` på `initial`
medan senare turer passerat U1F-R2/R3/R4, publiceringsplan och V6R1a.

**Fix.** En konkret turn-bunden `EIC_NEXT` adopteras som position med
`workUnitSource: "target-eic-next-claim"`; `position.phase` går `initial → active` och
`position.updatedAt` skrivs. Måltexten förblir target claim och blir aldrig owner-bevis.

## D8 — Uttömd recovery-stege upprepade samma sträng

**Fix.** `RECOVERY_LADDER[exhaustionCycles % length]` roterar deterministiskt och
cykelnumret skrivs in i instruktionen, så åtgärdsidentiteten skiljer sig mellan varv.

## D9 — v7→v8-migrationen var inte idempotent (latent, förelåg i v0.6.3)

**Bevis.** `tests/migration-v7-v8.test.mjs` föll intermittent (2 av 10 körningar på pristine
v0.6.3-källa) eftersom `updatedAt` stämplades om även vid `changed: false`.

**Fix.** En no-op-migration bevarar befintliga `updatedAt` och är byte-identisk vid återinträde.

## R5 — "Starta Ny Session" måste pausa tills sessionen verkligen initierats

**Mekanism.** `waitForNewChatTabReady()` returnerade vid första prob där
`composerFound && !generating`. En ChatGPT-SPA rapporterar en composer redan under hydrering.

**Fix.** Ny `lib/session-readiness.mjs`:

1. `evaluateNewSessionReadiness()` kräver stödd sida, composer, **send-kontroll**, ingen
   foreground-generering, inget bakgrundsarbete, `documentEpoch` och verifierad
   content-bridge-version.
2. `advanceReadinessStability()` kräver tre på varandra följande godkända probes med
   oförändrad `documentEpoch`, URL och konversationslocator. Identitetsbyte nollställer.
3. Durable `run.sessionInitGate`:
   `PENDING_TAB_READY → PENDING_COMPOSER_STABLE → PENDING_PROMPT_ACK → PENDING_FIRST_RESPONSE → INITIALIZED`,
   med `FAILED_TIMEOUT` endast före leverans — aldrig medan målsessionen tänker.
4. Spärren sitter i den enda dispatchpunkten `executePreparedEffectUnlocked()`. Endast
   engångsstarten släpps igenom under `PENDING_PROMPT_ACK`. Gaten avanceras tidigare i samma
   tick, vilket gör konstruktionen deadlockfri.
5. En run utan gate (skapad före v0.6.4) spärrar ingenting.

Samma stabilitetskrav gäller nu återanvänd tom flik och operatörsvald flik.

## Build-identitet

Paketeringen skriver `build-info.json` med SHA-256 per fil och en kombinerad
`packageDigest`. Panelen bäddar in den i varje export som `build`. En uppackad källkopia
rapporterar `UNPACKED_NO_BUILD_INFO` i stället för att gissa.

## Invarianter

1. En Nano-prompt får aldrig skickas utan att ha bundits mot värdens contextfönster.
2. `QuotaExceededError` är en krympsignal med bounded stege, inte en körningsfailure.
3. Endast åtgärdssegmentet får klassificeras som meta/audit.
4. Verifierad progress rankar över ordval i åtgärdstexten.
5. En anti-loop-korrigering får aldrig kasta bort en konkret, icke-upprepad åtgärd.
6. En stängd blockerare påstår aldrig att den är löst.
7. Måltext får bli position, aldrig owner-bevis.
8. Ingen autonom promptleverans före verifierad sessionsinitiering.

## Claim boundary

Detta dokument bevisar sourcefel och sourcekorrigering, verifierade genom replay och
194 automatiska tester. Det bevisar **inte** att v0.6.4 är installerad eller fungerar i
operatörens desktop-Chrome. Det kräver load-unpacked och runtimeacceptans enligt
`DESKTOP_CHROME_ACCEPTANCE_V0_6_4.md`.
