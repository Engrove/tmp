# Dispatch reconciliation och liveness – Greenfield 1.7.1

## Problem

Den observerade 1.7.0-körningen kunde fastna i `SENDING` trots att dispatchen var `ACKNOWLEDGED`, `effectPossible=true`, en user turn fanns och ett trusted assistantsvar var färdigt. Den gamla SENDING-gaten krävde därefter fortfarande att renderad user-text-hash var identisk med dispatchens prompt-hash.

Den bifogade runtime-auditen innehåller 19 sådana återkommande stallcykler. I samtliga replayade cykler var dispatchen acknowledged/effect-possible, assistantsvaret trusted och färdigt, och renderad user-hash skilde sig från dispatch-hashen innan `DISPATCH_EFFECT_UNRESOLVED`.

## 1.7.1 identitetsordning

Följande evidensordning används för dispatch/turn-causality:

1. **Materialized user-turn ID** – browserns observerade turn-ID som content bridge publicerar för exakt dispatch.
2. **Persisted materialized ordinal** – user-turn-index som hör till samma materialisering.
3. **Acknowledged dispatch baseline ordinal** – för äldre 1.7.0-state där `effectPossible=true`/`acknowledged=true` men materialized ID saknas.
4. **Legacy text-hash** – begränsad fallback endast när starkare identitetsfält saknas.

Ett explicit materialized turn-ID är bindande. Om ett annat turn-ID observeras blockeras reconciliation; text-hash får inte överrida den konflikten.

Baseline ordinal används inte när dispatch-effekten är okänd. Detta förhindrar att en separat användartur efter ett transportfel felaktigt tilldelas Greenfield-dispatchen.

## Materialiseringskvitto

Efter faktisk DOM-materialisering publicerar content bridge:

- dispatch-ID,
- prompt-hash,
- content `documentId`,
- dynamiskt observerat user-turn-ID,
- user-turn-index,
- aktuell user-count,
- renderad user-text-hash som diagnostik.

Service worker accepterar kvittot endast om det matchar:

- rätt extension/content sender,
- rätt window/tab,
- aktiv `SENDING`-process,
- rätt dispatch-ID,
- rätt pending prompt-hash,
- samma content-document som dispatchens write-ahead-baseline,
- och förväntad ordinal när baseline finns.

Kvittot persisteras innan vidare reconciliation och kan därför användas även om den ursprungliga send-callbacken förloras.

## SENDING-reconciliation

`lib/dispatch-reconciliation.mjs` samlar fence och turn-causality till ett enda produktionsbeslut.

- `WAIT_NO_RESEND` + verifierad turn → `ADVANCE_TO_WAITING`.
- `WAIT_NO_RESEND` + ej verifierbar turn → `HOLD_UNRESOLVED`.
- Exakt materialized ID/ordinal följer med till `lastPrompt`.
- Gammal safety hold rensas när processen faktiskt går till `WAITING`.
- Blind automatic resend är fortsatt förbjuden.

## Restart recovery

Recovery kräver fortsatt exakt konversationsidentitet. Därefter används samma turn-proof-kontrakt som runtime:

- turn-ID-match,
- eller säker ordinalmatch,
- eller legacy-hash när inga starkare identitetsfält finns.

Detta gör runtime och restart recovery konsekventa i stället för att ha två olika bevismodeller.

### Stale recovery-status efter live återanslutning

Om startup tidigare noterade `CONVERSATION_TAB_NOT_RESTORED` men processens senare egna page-state kan läsa **exakt samma beständiga konversations-ID**, reconcileras den statusraden som löst. Ett `RECOVERY_USER_TURN_UNPROVEN` får bara rensas om samma live-observation dessutom klarar turn-proof. `AMBIGUOUS_CONVERSATION` rensas aldrig enbart av att en av kandidaterna råkar vara läsbar.

## Kö/liveness

Köpolicyn är inte ändrad. `BACKGROUND_SLEEP` för ett queue-managed uppdrag är `PARK_AND_SWITCH`. Felet i 1.7.0 låg före analysen: processen nådde aldrig den kod som kunde parkera GF-045 och välja GF-007.

1.7.1 rättar den föregående dispatch-barriären; queue-switch-regeln är fortsatt separat och testad.

## Verifiering

Paketets acceptance består av två typer av evidens:

- Produktfunktionstester för turn-identitet, fence, dispatch-reconciliation, restart recovery och queue-yield.
- Replay av den verkliga bifogade 1.7.0-auditfilen genom `tools/replay-dispatch-audit.mjs`.

Ingen testkod får ersätta produktlogik med en hårdkodad `lastUserHash = promptHash`-genväg. Liveacceptans av 1.7.1 i den installerade ChatGPT/Chrome-ytan återstår tills operatören installerat byggnaden.
