# Multi-turn liveness – Greenfield 1.7.2

## Observerad defekt

Den bifogade v1.7.1-auditen visar ett flerturnsläge där processens turn var 2 och ChatGPT redan hade två user turns och två assistantsvar, medan Greenfields autonoma turn-proof fortfarande pekade på den föregående user turn. Replayverktyget i paketet identifierar detta genom generiska fältrelationer; inga incidentunika ID:n behövs i produktlogik eller replayregel.

## Lifecycle ownership

Promptobjekt kan samexistera av legitima skäl. Därför får objektets blotta existens inte avgöra ägarskap.

- `SENDING`: `pendingPrompt` är aktuell effect-owner för dispatch/turn identity.
- `WAITING` och `ANALYZING`: den materialiserade `lastPrompt` är aktuell response-owner.
- `DETACHED`/`RECOVERING` med explicit `recoverTo=SENDING`: pending dispatch återtar ägarskapet.
- Stale `pendingPrompt` i ett senare/legacy state får inte ta över en materialiserad `lastPrompt`.
- Saknar aktuell pending dispatch materialiseringsbevis lämnas turn-ID tomt i stället för att återanvända N−1.

## Dispatch reconciliation

När content bridge redan har publicerat aktuell dispatchs materialiserade browserturn är den identiteten starkare än en härledd proof som kan vara stale.

Ordning för aktuell SENDING reconciliation:

1. aktuell `pendingPrompt.dispatch.materializedUserTurnId`;
2. current-turn proof från page observation;
3. säker ordinal/begränsad legacy-fallback enligt 1.7.1-kontraktet.

Exakt konflikt failar fortsatt stängt och ger aldrig blind resend.

## Multi-turn regression

`tests/v172-multiturn-liveness.test.mjs` skapar identiteter med `crypto.randomUUID()` vid testkörning. Testerna verifierar bland annat:

- många successiva SENDING-turner där N måste vinna över N−1;
- current pending utan dispatchbevis får inte låna historical lastPrompt-ID;
- dispatch reconciliation + WAITING response causality över upprepade dynamiska turns;
- full A2A schema/control consistency;
- Hjalmar preview + controller non-lossy handoff;
- stale modelproof-hold reconciliation;
- fleet-details state över reorder/refresh.

Testerna använder produktionsfunktioner; de skriver inte in incidentens kända browser-ID, prompt-hash eller assistant-hash som förväntad produktstate.

## Hjalmar D2 och lossless target handoff

Hjalmar är prompt-bounded. Det är därför tillåtet att target metadata innehåller en förkortad preview, men previewn är explicit märkt med:

- `nextSuggestedActionLength`;
- `nextSuggestedActionComplete`.

Controller har samtidigt kvar det fullständiga target-svaret. Om advisory-outputens `nextPrompt` är en strikt normaliserad prefix av den fulla target-handoff klassas det som objektiv informationsförlust och den fulla handoffen används.

Detta gör den exekverbara continuationen icke-förlustbringande utan att blåsa upp Hjalmars lokala promptbudget.

## Stale model/reasoning hold

En allowed färsk modelproof får inte generellt nollställa safety state. Reconciliation kräver att:

- en gammal hold finns;
- färsk proof är `allowed=true`;
- ingen ny quality incident finns;
- hold-koden är exakt samma som föregående modelproof-kod.

Då kan den holden tas bort. Dispatch/storage/annan oberoende hold lämnas kvar.

## Fleet UI state

`renderFleetStatus()` kan fortfarande rendera om listan. Före omrendering samlas öppna `details.worker-details` in via stabil process-/worker-key. Efter omrendering sätts `open` på samma synliga key. Listordning och periodisk refresh får därför inte i sig stänga operatörens expanderade sektion.

## A2A control metadata

En full canonical response som validerar `eic.a2a.response.v1` är också en giltig control-response för dess status/sessionAction/nextSuggestedAction. Continuation-envelope ska inte rapportera `fullSchemaValid=true` och samtidigt `controlValid=false` för samma fullständigt godkända objekt.

## Verifieringsgräns

Replay av gammal audit visar att den gamla runtimehändelsen matchar den generiska felrelationen. Node-tester verifierar koden i paketet. Live Chrome-acceptans av 1.7.2 kräver installation och en ny flerturnskörning i den aktuella ChatGPT-DOM:en.
