# Uppdatera Greenfield 1.8.0 → 1.8.1

1. Pausa nya Greenfield-utskick.
2. Säkerhetskopiera den unpacked extension-mappen (spara gärna aktiv kö som kö-set).
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.1.zip`.
4. Kopiera innehållet över samma unpacked Chrome-mapp så extension-ID/lokal state bevaras.
5. I `chrome://extensions`, välj **Läs in igen**. Greenfield injicerar själv den nya content-bryggan när den ser versionsbytet i fliken.
6. Verifiera att panelen visar `Greenfield v1.8.1`.
7. Verifiera live:
   - Välj ett kö-set, ändra Aktiv kö och klicka **Uppdatera valt** två gånger. Setet ska ha samma namn och det nya antalet uppdrag.
   - Ge en plats ett körfönster som stänger om några minuter. Den pågående turen ska bli klar, platsen parkeras (`SCHEDULE_WINDOW_CLOSED`) och nästa plats startar. Utan annan körbar plats ska panelen visa ”Kön väntar” och overlayen nedräkningen till nästa start.
   - FULL-prompten innehåller `control.workQueue.scheduleRule` och `SET_SCHEDULE` i `runtimeControlContract`. Varje prompt innehåller `control.workQueue.schedule`.

Befintliga köer och kö-set saknar schema och körs som tidigare, alltid öppna.

Lokal paketverifiering kan verifiera koden och regressionerna. Den ersätter inte live Chrome/ChatGPT-acceptans.
