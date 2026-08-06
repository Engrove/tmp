# Desktop Chrome Acceptance — EIC Autonom Agent v0.6.4

Testerna nedan är inte körda av leverantören. De kräver load-unpacked i operatörens
desktop-Chrome. Källkodsnivån är verifierad genom 194 automatiska tester och replay mot
v0.6.3-runtimeexporten.

## Förutsättning — bevisa vilken kandidat som körs

1. Ladda `eic-autonom-agent-v0.6.4.zip` uppackad via `chrome://extensions` → Load unpacked.
2. Exportera state direkt efter laddning.
3. **PASS** när `build.status = "PACKAGED"`, `build.version = "0.6.4"` och `build.packageDigest`
   matchar `CHECKSUMS_SHA256_V0_6_4.txt`. Detta är kravet som v0.6.3-exporten inte kunde uppfylla.

## A — Nano-inputen ryms i contextfönstret

1. Aktivera Nano. Notera `contextWindow` i panelen.
2. Kör minst tre turer mot en session med långa svar.
3. **PASS** när `nanoTelemetry.lastInputBudget.withinBudget = true`, `promptChars ≤ maxPromptChars`
   och auditloggen saknar `QuotaExceededError`.
4. **PASS** på degradering: om ett `QuotaExceededError` ändå uppstår ska nästa auditpost visa
   `Nano-input krympt till … tecken (försök 2)` och därefter ett verkligt Nano-resultat med
   `decisionSource: NANO`.

## B — Nano fattar besluten

1. Kör tio turer.
2. **PASS** när minst åtta av tio har `lastSource: "NANO"` och `lastInputChars > 0`.
3. **FAIL** om `DETERMINISTIC_RECOVERY` dominerar utan att Nano-hosten är avstängd.

## C — Kontinuiteten kompakteras

1. Kör tills continuity passerar tio turer.
2. **PASS** när `compactionGeneration > 0` och `compaction.removedItems + mergedItems > 0`.
3. **PASS** när `position.workUnit` motsvarar den faktiskt pågående arbetsenheten och
   `position.phase = "active"`.

## D — Anti-loop mäter verkligt arbete

1. Kör turer där målsessionen levererar konkreta `EIC_NEXT`.
2. **PASS** när `productiveActionCount > 0` och `stagnationCycles` nollställs vid progress.
3. **PASS** när en anti-loop-korrigering loggas som
   `Anti-loop-korrigering bifogad till konkret åtgärd` och den skickade prompten fortfarande
   innehåller målsessionens konkreta åtgärd.
4. **FAIL** om samma generiska owner-read-prompt skickas två turer i rad.

## E — Blockerarlivscykel

1. Låt en blockerare ligga oasserterad i sex turer.
2. **PASS** när den får `open: false` och `closedReason` som börjar på `STALE_NO_REASSERTION`,
   och `unlockedBy` fortfarande är tom.

## F — Starta Ny Session pausar tills sessionen initierats

1. Klicka **Starta Ny Session** med en giltig startprompt.
2. **PASS** när auditloggen visar `Sessionsinitiering avancerade` med
   `PENDING_TAB_READY → PENDING_COMPOSER_STABLE → PENDING_PROMPT_ACK`.
3. **PASS** när ingen prompt utöver engångsstarten levereras innan
   `Sessionsinitiering verifierad` loggats.
4. **PASS** när gaten når `INITIALIZED` först efter målsessionens första kompletta svar.
5. Upprepa med en långsam/överbelastad session: **PASS** när ingen `FAILED_TIMEOUT` inträffar
   medan målsessionen genererar.
6. **FAIL** om en continuation-prompt skickas medan gaten står i `PENDING_FIRST_RESPONSE`.

## G — Bevarade v0.6.3-egenskaper

1. Ingen revisionstorm: `stateRevision` per minut ska ligga i samma storleksordning som i
   v0.6.3-exporten (≈0,45/min), inte tusentals.
2. Callback at-most-once: `deterministicDispatchAttempts ≤ 2`.
3. Mjölnar visar `CANDIDATE_DETECTED`/`READ_REQUIRED` utan dispatch; `VERIFIED_EFFECT` endast
   efter dispatch + readback.
4. Inga nya permissions; host allowlist oförändrad.

## Rapportering

Exportera state efter körningen. Exporten innehåller nu `build`, `nanoTelemetry.lastInputBudget`,
`sessionInitGate` och `antiLoop.concreteActionCount`, vilket gör samtliga PASS/FAIL ovan
falsifierbara utan att lita på loggtext.
