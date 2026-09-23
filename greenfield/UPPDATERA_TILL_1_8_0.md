# Uppdatera Greenfield 1.7.9 → 1.8.0

1. Pausa nya Greenfield-utskick.
2. Säkerhetskopiera den unpacked extension-mappen (spara gärna aktiv kö som kö-set).
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.0.zip`.
4. Kopiera innehållet över samma unpacked Chrome-mapp så extension-ID/lokal state bevaras.
5. I `chrome://extensions`, välj **Läs in igen**. Greenfield injicerar själv den nya content-bryggan när den ser versionsbytet i fliken.
6. Verifiera att panelen visar `Greenfield v1.8.0`.
7. Verifiera live:
   - första prompten (FULL) innehåller `responseContract.learningControlContract` och `control.learningControl` med `obligations.AIK_DISCOVERY = REQUIRED` och rätt `project.aikScope`
   - en följdprompt (COMPACT) innehåller `control.learningControl` men inte kontraktet
   - EIC-svaret innehåller `learningControl`, och nästa prompt visar `previousResult` respektive `carriedOverObligations` om en REQUIRED-kontroll saknades

Kö, runtime-control, promptprofil, stale-rotation och overlay är oförändrade från 1.7.9.

Lokal paketverifiering kan verifiera koden och regressionerna. Den ersätter inte live Chrome/ChatGPT-acceptans.
