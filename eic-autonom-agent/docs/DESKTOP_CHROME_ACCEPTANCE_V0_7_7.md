# Desktop Chrome acceptance — v0.7.7

## Förutsättningar

1. Extrahera v0.7.7-källpaketet.
2. Ladda katalogen som opaketerat tillägg i den redan använda Chrome-profilen.
3. Behåll den förberedda ChatGPT-fliken öppen och kopplad.
4. Notera flikantal före testet.

## Fall A — tom kompositor utan synlig send-knapp

1. Låt målfliken vara idle med tom kompositor.
2. Starta systematisk granskning.
3. Godkänt: inget `SEND_CONTROL_MISSING`; prompten skrivs och skickas via aktuell send-kontroll eller Enter-fallback.
4. Godkänt: ingen ny flik eller session skapas.

## Fall B — foreground-generation pågår

1. Starta ett svar manuellt i den kopplade målfliken.
2. Medan svaret genereras, tryck **Starta systematisk granskning**.
3. Godkänt: runnen skapas i vänteläge; pågående svar lämnas orört.
4. Godkänt: exakt en startprompt levereras först efter att generationen har avslutats.
5. Underkänt: 20-sekundersfel, avbrott av svaret eller dubbel prompt.

## Fall C — bakgrundsarbete

1. Låt ChatGPT rapportera aktivt bakgrundsarbete.
2. Starta läget.
3. Godkänt: prompten köas och skickas först efter owner-observerad idle state.

## Fall D — fältisolering

1. Kör det kontaminerade `workUnit`-fallet från v0.7.6.
2. Godkänt: `FIELD_ISOLATION_VIOLATION`.
3. Kör legitim prosa som nämner `requestedAction` utan fältsyntax.
4. Godkänt: prosan accepteras.

## Readback

Registrera:

- visad addonversion;
- utfallet för A–D;
- flikantal före/efter;
- om samma tab-ID/session användes;
- exakt feltext vid underkänt fall.

