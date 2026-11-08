# Greenfield v1.9.20 – utkast som blockerar köstart

Denna version rättar hur ett stoppat utskick lämnar oskickad text i ChatGPTs
skrivfält. Ett befintligt utkast visas nu som en konkret spärr med villkoret
att skrivfältet ska vara tomt. Det skickas eller raderas inte automatiskt.

## Uppdatera befintligt tillägg

1. Pausa nya utskick i Greenfield. Behåll fönster och konversationer öppna.
2. Ersätt filerna i den befintliga tilläggsmappen med innehållet i `greenfield/`.
   Läs in samma tillägg igen. Avinstallera inte och radera inte tilläggets data.
3. Kontrollera att panel, motor och överlägg visar 1.9.20. Läs vid behov in den
   berörda ChatGPT-fliken igen för att ersätta den gamla sidans anslutning.
4. I det visade Projekt 71-fönstret: spara eventuell egen text separat och töm
   det oskickade startutkastet som avser Projekt 59. Tryck inte på Skicka.
   Kontrollera övriga nya köfönster för samma tydliga utkastspärr.
5. Återuppta nya utskick. En aldrig skickad v1.9.19-start som hunnit få
   `SESSION_ROTATION_CHAT_READY_TIMEOUT` kan återgå till observation vid nästa
   återställningskontroll (normalt inom en minut). Samma worker, köplats och
   uppdrag måste fortfarande äga starten; paus, kvotspärr eller ändrat ägarskap
   ger ingen återställning. Initieringskvittens och utskickskontroller gäller.

Ett eget utkast måste sparas innan skrivfältet töms. Återställningen gäller
enbart första starten utan tidigare prompt, svar, försök eller dispatch.
Äldre frånkopplade uppdrag med obesvarade utskick behöver fortfarande avstämmas
i originalkonversationen. Det är inte tillåtet att kringgå den spärren.

## Ändrat beteende

- Utskickstillstånd kontrolleras innan prompttext läggs i skrivfältet och igen
  efter redigeringen, med samma idempotenta dispatch-id.
- Ett senare fel före klick återställer endast det oförändrade utkast som just
  försöket skrev i ett tomt fält. Mänskliga ändringar, gamla utkast, nytt dokument
  och möjliga utskick bevaras.
- Lokal utskickspaus behåller sin exakta tid för nästa försök.
- Panel och överlägg visar när ett utkast blockerar sessionbytet. Ingen ny
  AI-prompt skickas på oförändrat underlag. Lokal observation fortsätter.
- `Fortsätt` efter leveransfel har fortsatt högst tre försök enligt 1.9.19.
  Det gäller redan skickade turer, inte ett oskickat startutkast.

## Verifieringsgräns

Aktuella käll- och testkvitton finns i `verification/1.9.20/` i paketets rot.
Historiska rapporter gäller sina tidigare versioner. Lokala tester och replay
är inte bevis på installation, faktisk Chrome-körning eller terminalt PASS för
ett GFW-uppdrag. De senare behöver observeras efter uppdateringen.
