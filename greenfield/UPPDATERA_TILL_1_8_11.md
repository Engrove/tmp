# Uppdatera Greenfield 1.8.10 → 1.8.11

1. Säkerhetskopiera tilläggsmappen och spara aktiv kö som kö-set.
2. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.11.zip` och kopiera innehållet över **samma mapp** som Chrome redan använder. Då behålls extension-ID, kön och den sparade EIC-adressen.
3. I `chrome://extensions`: välj **Läs in igen**. Panelen ska visa `Greenfield v1.8.11`.
4. Du behöver inte ladda om ChatGPT-fliken. Greenfield laddar in den nya sidbryggan själv (steget `REINJECT_BRIDGE`). En process som redan står i SENDING med ”Oklart om prompten skickades – inget omskick” hittar sin prompt vid nästa omprövning (inom 30 s) och läser svaret. Ingenting skickas om.

## Varför sessionen inte visste att svaret redan var levererat (rapport 2026-09-28, v1.8.10)

- **Diagnostiken 11:22** (köuppdraget på tur 6):
  - Processen stod i SENDING med spärren `DISPATCH_EFFECT_UNRESOLVED` / `AUTONOMOUS_USER_TURN_NOT_RESOLVED` sedan utskicket 10:56.
  - Sändningen var kvitterad av `GENERATION_STARTED` (”Stoppa” syntes), men ingen användartur var kopplad. Före utskicket fanns 5 användarturer.
  - Tur 1–5 hade fångats normalt, och ChatGPT hade svarat färdigt 11:17.
  - Samma mönster fanns i två andra konversationer, vid 4 turer.
- **Svaret var inte problemet.** Tur 6 kom aldrig vidare från utskicket, så svaret lästes aldrig. Ett svar utan JSON tas för övrigt emot som vilket svar som helst; det är nu också testat.
- **Orsak:** kontrollerat i ChatGPT:s egen kod, både build 4da31bb4 och den som din flik laddade 2026-09-28 (manifest 4ad86f39):
  - **Tråden är virtualiserad.** Bara turerna nära det synliga fönstret, plus två extra, ligger i sidan. Innan höjderna är uppmätta räknar tråden med 280 px per tur i ett 800 px fönster, vilket ger ungefär fem turer. Att det gällde i din dolda flik är en slutsats, inte uppmätt. När tur 6 kom till togs tur 1 bort ur sidan, så antalet användarmeddelanden stannade på 5. Greenfield väntade på 6 och letade efter tur nummer 6, och ingen av dem kom.
  - **Långa användarmeddelanden fälls ihop till 20 rader** med ett extra ”…” i sidan. Därför stämde textens kontrollsumma aldrig med promptens.
- **Återskapat:** verktyget `tools/verify-virtualized-thread-dispatch.mjs` bygger en tråd som beter sig så i Chromium.
  - Med v1.8.10 får man exakt diagnostikens läge: `GENERATION_STARTED`, inget kvitto och en olöst tur (5 av 12 kontroller).
  - Med v1.8.11 går alla 12 kontroller igenom.

## Vad som ändras

- **Prompten hittas på sitt eget id.** Varje Greenfield-prompt är ett A2A-meddelande med ett slumpat `messageId`. Greenfield letar upp det användarmeddelande i tråden vars text innehåller just det id:t, oavsett hur många turer som syns.
  - Kvittot bygger på det, och spärren löses på samma sätt.
  - Hittas id:t i två användarmeddelanden kopplas ingen tur.
  - I ChatGPT:s nya gränssnitt gissar Greenfield inte längre på ordningstal när id:t är känt.
- **Skydd mot dubbelsändning:** syns promptens id redan i tråden före utskick skickas den inte igen.
- **Läs svar** (knapp på workerkortet under Körstatus):
  - Greenfield läser svaret i workerns flik direkt, utan att vänta på nästa 30 s-omprövning.
  - Kan prompten ändå inte kopplas automatiskt, kopplas ChatGPT:s senaste användartur till prompten. Villkoret är att turen är nyare än föregående Greenfield-tur och ligger i samma konversation. Du tillfrågas först, och beslutet sparas som ditt (`operatorOverride`).
  - Inget skickas om. Andra spärrar, till exempel modell eller budget, ändras inte.
- **Gå till nästa uppgift i kön** (knapp på workerkortet):
  - Nuvarande uppdrag parkeras med sin checkpoint, och nästa körbara uppgift startar i en ny chatt, som vid köbytet efter 120 min.
  - Den obesvarade turen räknas inte in i kvanten.
  - När det parkerade uppdraget kommer tillbaka får det veta vad som hände med dess senaste prompt: `PROMPT_EFFECT_UNKNOWN` eller `PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE`. Det läser då om owner-state innan det gör något.
  - En paus som uppdraget självt har begärt gäller fortfarande. Ingen plats blir BLOCKED.
  - Finns ingen annan körbar uppgift ändras ingenting.
  - Vill du få med svaret på den senaste prompten, välj **Läs svar** först.

## Gränser

- Live-Chrome mot riktiga ChatGPT är **inte** verifierat i denna leverans.
- Trådens beteende är avläst ur ChatGPT:s produktionskod och återskapat i en syntetisk sida. Hur många turer som ligger i sidan beror på fönsterhöjd, flikens synlighet och svarens längd.
- **Läs svar** kopplar den senaste användarturen. Har du själv skrivit något i fliken efter Greenfields prompt är det den turen som kopplas.

## Om det ändå fastnar

Exportera diagnostiken och skicka den. Följande säger vad som hände:

- `pendingPrompt.dispatch`: `promptMarker`, `materializedUserTurnId` och `materializedBy`.
- `safety.hold.detail`.
