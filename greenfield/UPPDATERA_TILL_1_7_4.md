# Uppdatera Greenfield till 1.7.4

## Vad 1.7.4 ändrar

1. Worker-kön följer explicit listordning och loopar cykliskt.
2. Kvant räknas per köplats och ofärdig kvant bevaras över tidig yield/pause/block.
3. Samma sparade GFW får finnas i flera köplatser med olika position, prioritet och kvant.
4. Duplicate slots delar mission continuation men inte sina scheduling-parametrar.
5. Queue-managed `PAUSE_PROCESS` blockerar inte hela workern när annan runnable slot finns.
6. DONE/STOP_PROCESS avslutar hela den logiska sparade GFW:n och tar bort dess duplicate slots.
7. Queue-managed `CONTINUE + BACKGROUND_SLEEP` parkerar missionen och får aldrig flytta den till Klart/avslutade; endast `DONE`/`STOP_PROCESS` är logiskt terminala.
8. Varje Greenfield-prompt visar aktuell kvantposition för EIC, inklusive t.ex. `Hög · 1 interaktioner/kvant · 0/1 slutförda i kvanten`, plus ett engelskt planningHint.
9. Prompten bär ungefärlig föregående response-roundtrip och, från andra slot-varvet, ungefärlig loop-roundtrip för samma köplats.
10. EIC kan returnera `greenfieldStatusRequest:"FULL_NEXT_PROMPT"`; Greenfield levererar då ett bounded full process-control statusobjekt i just den GFW:ns nästa prompt.
11. v1.7.3 mixed-language model safety och English internal A2A/en-sv-fi evidence är oförändrat bevarat.

## Rekommenderad uppdatering från 1.7.3

1. Pausa nya utskick.
2. Spara den aktuella Uppdragskön som ett kö-set om du vill ha en extra konfigurationsbackup.
3. Säkerhetskopiera den nuvarande unpacked extension-mappen.
4. Packa upp `EIC_Autonom_Agent_Greenfield_v1.7.4.zip`.
5. Kopiera innehållet över samma mapp som Chrome redan använder.
6. Välj **Läs in igen** på Greenfield i `chrome://extensions`.
7. Kontrollera att panelen visar `v1.7.4`.
8. Verifiera att den aktiva köns ordning och kvanta ser korrekta ut innan nya autonoma utskick släpps.
9. Om Chrome skapade en ny extension-identitet i stället för att behålla den gamla: anta inte att aktiv runtime-kö följde med. Ladda i så fall ett sparat kö-set och starta den avsedda kön på nytt.
10. Kör liveacceptansen i `docs/ORDERED_LOOP_QUEUE_V1_7_4.md`.

## Viktig semantik

En rad i kön är en **slot**, inte en unik GFW-definition.

Det betyder att följande är avsiktligt giltigt:

```text
Plats 1: GF-007  HIGH    kvant 10
Plats 2: GF-045  HIGH    kvant 1
Plats 3: GF-007  NORMAL  kvant 2
```

Körordningen är 1 -> 2 -> 3 -> 1 ... så länge respektive slot är runnable. Prioriteten avgör endast hur den aktiva slotten konkurrerar om profilglobal ChatGPT-kapacitet.

Om GF-007 själv svarar terminalt med DONE/STOP_PROCESS tas båda GF-007-slots bort eftersom de representerar samma logiska sparade mission.

## Claim boundary

Lokala Node-/syntax-/pakettester kan verifiera implementeringen och paketets bytes. De verifierar inte att en viss Chrome-installation redan kör 1.7.4 eller att en aktiv v1.7.3-kö migrerats korrekt. Det kräver live runtime-observation efter reload.
