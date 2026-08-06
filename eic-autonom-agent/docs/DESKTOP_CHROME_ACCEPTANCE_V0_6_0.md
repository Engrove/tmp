# Desktop Chrome acceptance — EIC Autonom Agent v0.6.0

## Claim boundary

Körs i användarens inloggade desktop Chrome. Lokala Node-tester ersätter inte detta.

Registrera datum/tid, Chrome-version, extensionversion, exact conversation, startstate, observerat utfall, export/logg och PASS/FAIL/PENDING.

## A. Installation och migration

- Installera/ladda om v0.6.0 och ChatGPT-tab.
- Aktivera Nano utan language-option-fel.
- Importera v0.5.3/v6-export och verifiera v7/v2-state.

## B. Raw EIC-AA startprompt

- Starta med en prompt som redan har turnless 3-raderskontrakt.
- Verifiera att user message är byte-/textmässigt originalet, utan extra wrapper.
- Verifiera promptdigest-ACK och att continuity är seedad före första assistantsvar.
- Upprepa med bound 4-raderskontrakt och dess befintliga turn-ID.

## C. Interim response → full response

- Låt första observerade assistanttext vara `EIC-startmeny —` eller annan kort mellanrendering.
- Låt samma assistant message växa till ett fullständigt svar.
- Förväntat: kort hash blir aldrig slutlig beslutsgrund; candidate resetas eller observation supersederas.
- Förväntat: full response analyseras och autonom continuation fortsätter.

## D. Hashändring under pipeline

Upprepa hashändring:

1. före Nano-claim;
2. under inferens före decision;
3. före repair-resultat;
4. efter decision men före promptsubmit.

Förväntat: gammal request/effect blir `SUPERSEDED`/`CANCELLED_SUPERSEDED`, ingen stale prompt skickas.

## E. Nano clone och rotation

- Kör flera långa startpromptchunks och minst tio continuation-analyser.
- Verifiera clone per task och destroy efter varje task.
- Context usage får inte ackumuleras i bassessionen till omstart efter varje analys.
- Simulera task `QuotaExceededError`/`InvalidStateError`: en fresh-clone retry.
- Verifiera att verklig base invalidity visar exakt stale reason.

## F. Parser

- Giltig 4-rad och 3-rad.
- Trailing text efter trailer ska avvisas.
- Dubbla markörer ska avvisas.
- `DONE` med next, `CONTINUE` med evidence och `PAUSE` utan unlock ska avvisas.

## G. Befintliga kritiska regressioner

- egen badge triggar inte background;
- duplicate suppression efter senare user message;
- sidepanel close ger `NANO_HOST_REQUIRED` utan target-authored fallback;
- svenska/engelska trusted background-signaler;
- frozen/discarded/minimized/screen lock/system awake;
- real sleep/wake återupptas korrekt;
- locator promotion och mismatch;
- Mjölnar provenance/D2;
- storage rejection öppnar circuit breaker.

## Slutacceptans

Browser PASS kräver exporterad evidens för samtliga kritiska fall. Source/packageacceptans rapporteras separat.
