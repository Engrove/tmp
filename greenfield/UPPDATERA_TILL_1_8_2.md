# Uppdatera Greenfield 1.8.1 → 1.8.2

1. Pausa nya Greenfield-utskick.
2. Säkerhetskopiera den unpacked extension-mappen (spara gärna aktiv kö som kö-set).
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.2.zip`.
4. Kopiera innehållet över samma unpacked Chrome-mapp så extension-ID/lokal state bevaras.
5. I `chrome://extensions`, välj **Läs in igen**. Greenfield injicerar själv den nya content-bryggan när den ser versionsbytet i fliken.
6. Verifiera att panelen visar `Greenfield v1.8.2`.
7. Verifiera live:
   - Under långa djupgående svar ska inga svar på några få tecken (`{`, `{"schema": …`) längre fångas. I en ny diagnostikexport ska `samples[].responseChars` för nya turer inte vara under cirka 50 när EIC svarar med JSON.
   - `Exportera diagnostik` innehåller `responseObservation` med spår per process och per parkerad köplats.
   - Om ett färdigt svar ändå inte tas emot: exportera diagnostik. Posterna i `responseObservation` visar orsaken även med Audit avslaget.

Kö, schema, runtime-control, promptprofil och lärandekontroll är oförändrade från 1.8.1.

Lokal paketverifiering kan verifiera koden och regressionerna. Den ersätter inte live Chrome/ChatGPT-acceptans.
