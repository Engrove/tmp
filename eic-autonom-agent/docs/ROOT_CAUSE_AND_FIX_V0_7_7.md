# Root cause and fix — v0.7.7

## Observerat desktopfel

Med v0.7.6 aktiv i den redan kopplade ChatGPT-fliken avvisades **Starta systematisk granskning** efter 20 sekunder:

`Den förberedda ChatGPT-sessionen blev inte verifierat redo inom 20 sekunder (SEND_CONTROL_MISSING).`

Panelen visade samtidigt att samma flik var låst och att ChatGPT genererade i foreground.

## Rotorsak

`evaluateNewSessionReadiness()` behandlade `page.sendFound === false` som ett hårt prefillfel. Detta var oförenligt med `content.js::submitPrompt()`:

1. readiness kördes medan kompositorn ännu var tom;
2. moderna ChatGPT-ytor kan rendera send-kontrollen först när kompositorn innehåller text;
3. `submitPrompt()` skriver faktiskt texten före `getSendButton()`;
4. submit-vägen har dessutom en Enter-fallback om en explicit send-knapp saknas.

Den hårda readiness-kontrollen kunde därför stoppa en session som den verkliga submit-vägen hade kunnat hantera säkert.

En andra konflikt fanns vid pågående svar: startvägen väntade högst 20 sekunder och kastade därefter, trots att effektjournalen redan hade en säker modell för att lämna foreground-/backgroundarbete orört och skicka först när målfliken blivit ledig.

## Rättning

- `sendFound` är rådgivande som standard och blir blockerande endast när `requireSendControl: true` uttryckligen används för diagnostik.
- `allowBusy: true` kan verifiera stabil composer, content bridge, document epoch, URL och conversation locator utan att klassificera pågående arbete som strukturellt fel.
- Båda startkommandona använder denna strukturella beredskap och skapar exakt en köad `PREPARED`-effekt.
- `executePreparedEffectUnlocked()` väntar vid både foreground-generation och aktivt bakgrundsarbete.
- `reconcileEffectRecord()` betraktar båda typerna som `TARGET_BUSY`.
- `PENDING_PROMPT_ACK` tidsgränsas inte medan en redan förberedd engångsprompt väntar på att tidigare arbete ska avslutas.
- Ingen flik eller session skapas eller navigeras.

## Claim boundary

Källkod, rena enhetstester och paketeringskontroller kan verifiera kontraktet. Slutlig Chrome-/ChatGPT-DOM-acceptans kräver installation av v0.7.7 i användarens verkliga profil.

