# Schemalagd kö i Greenfield 1.8.1

Operatörsbeslut (2026-09-24):

- Varje köplats har **veckofönster i lokal tid plus en valfri paus-till**.
- När fönstret stänger blir **pågående tur klar, sedan sker köbyte**.
- AI:n får ändra **aktuell plats schema fritt inom gränser**. En senare operatörsändring vinner alltid.

## Modell

```json
"schedule": {
  "windows": [{ "days": [1,2,3,4,5], "start": "22:00", "end": "06:00" }],
  "pauseUntilMs": 0,
  "updatedBy": "OPERATOR | AI",
  "updatedAtMs": 0
}
```

- `days`: ISO-veckodagar, där 1 = måndag och 7 = söndag.
- `start` och `end` anges som `HH:MM` i profilens lokala tidszon. Slut före start betyder att fönstret går över midnatt och hör till startdagen. `24:00` betyder dygnets slut. Start lika med slut avvisas.
- Högst 7 fönster. Utan fönster är platsen alltid öppen.
- `pauseUntilMs` är en engångspaus på högst 30 dagar framåt. En passerad paus tas bort vid normalisering.
- `schedule: null` betyder inget schema. Tidigare köer och köplatser är därför oförändrade.

En plats är **körbar** när dess status tillåter det (READY, en utgången PAUSED eller en förfallen BLOCKED) **och** schemat tillåter det: ingen aktiv paus, och fönster saknas eller nuvarande tid ligger i ett fönster.

## Beteende

| Situation | Vad Greenfield gör |
|---|---|
| Kön väljer nästa plats | Platser utanför sitt schema hoppas över. Listordningen gäller i övrigt oförändrad. |
| Fönstret stänger eller paus börjar medan en tur pågår | Turen avbryts aldrig. Efter att svaret fångats och analyserats parkeras platsen med bevarad kvantprogress (den besvarade turen räknas) och utfallet `SCHEDULE_WINDOW_CLOSED`/`SCHEDULE_PAUSED`. Därefter startar nästa körbara plats. |
| Ingen annan körbar plats | Platsen parkeras ändå. Processen går till den nya terminala fasen `QUEUE_WAIT`, släpper kapacitet och prompt-lease, och köns väckarlarm sätts till tidigaste möjliga start. |
| En prompt som aldrig skickats, utanför schemat | Spärren i `tickSending` parkerar platsen innan något postas. Den fångar återupptagen missionspaus, rotation, återhämtning och aktiveringsrace. En prompt som redan har en dispatch-post rörs aldrig. |
| Schemat öppnar | Väckarlarmet, en schemaändring i panelen eller omstarts-reconcile aktiverar platsen. Den återupptas i ny chatt från sin checkpoint. |
| Operatören stoppar kön i `QUEUE_WAIT` | Processen går till STOPPED. |

## AI: `runtimeControl` `SET_SCHEDULE`

- **Fält:** `windows` (array; `[]` rensar) och `pauseUntil` (ISO-8601 med offset, eller `""`/`null` för att rensa). Minst ett av dem måste finnas. Ett utelämnat fält behåller sitt värde.
- **Validering:** strikt. Okända fält, fel format, en paus som redan passerat och en paus längre än 30 dagar ger `INVALID`. Värden kläms aldrig in i gränserna.
- **Operatörsföreträde:** en operatörsändring efter att prompten skickades ger `REJECTED (OPERATOR_PRECEDENCE)`.
- **Idempotens:** ett schema som redan gäller ger `ALREADY_APPLIED`.
- **Verkan:** omedelbar. Tillåter det nya schemat inte körning nu är svaret det sista som används, och platsen parkeras.
- **FULL-prompten:** `control.workQueue.scheduleRule` beskriver regeln och gör schemaläggaren obligatorisk för tidsberoende arbete. Tidsberoende arbete är sådant som väntar på en känd tidpunkt, bara ska köras vissa tider eller annars skulle kosta turer på väntan eller polling.
- **Varje prompt (FULL och COMPACT):** `control.workQueue.schedule` visar:
  - tidszon, offset och `localNow`;
  - fönster och `pauseUntil`;
  - `openNow`, `blockReason`, `closesAt` och `nextOpenAt`;
  - `likelyLastTurnInWindow`.
- **`likelyLastTurnInWindow`:** när fönstret stänger inom ungefär en tur (senaste uppmätta svarstid, annars 10 min) blir `checkpointRequired=true`. AI:n checkpointar då, och lärandekontrollen markerar keypointen `CHECKPOINT_HANDOFF_STOP_OR_TERMINAL_CLOSE`.

## Panel och overlay

- Varje plats i Aktiv kö visar sitt schema: öppet till, utanför fönster och öppnar, eller pausad. Knappen **Schema** öppnar en redigerare för fönster och paus-till. Redigeraren ligger utanför listan så att ändringar inte går förlorade när listan ritas om.
- Kö-set sparar platsernas fönster. En engångspaus sparas aldrig i ett set.
- **Uppdatera valt** skriver över valt kö-set med aktiv kö. Namn och id behålls, och ett andra klick krävs som bekräftelse.
- Overlayen räknar ned till att körfönstret stänger. I `QUEUE_WAIT` visar den nästa GFW och tid till nästa schemalagda start.

## Promptstorlek (samma fixtur som 1.8.0)

| Prompt | 1.8.0 | 1.8.1 |
|---|---|---|
| FULL | 45 715 | 49 399 (`scheduleRule` 1 417, tillstånd 316) |
| COMPACT | 6 834 | 7 327 |

## Gränser

- Tiden är webbläsarprofilens lokala tid. Vid sommartidsskifte räknas ett fönster i väggklocktid, så ett nattfönster kan bli en timme längre eller kortare.
- Chrome-alarm kan komma sent när datorn sover. Då startar platsen när Chrome vaknar.
- En nedgradering till en version före 1.8.1 tappar schemat vid normalisering.
- Spärren gäller bara prompter utan dispatch-post. En prompt som avbröts före effekt (t.ex. rate-limit) och sedan skickas om hanteras av den befintliga dispatch-logiken.
- Ingen live-acceptans i Chrome/ChatGPT är gjord.
