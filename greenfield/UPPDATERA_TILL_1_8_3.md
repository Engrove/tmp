# Uppdatera Greenfield 1.8.2 → 1.8.3

1. Pausa nya Greenfield-utskick.
2. Säkerhetskopiera den unpacked extension-mappen (spara gärna aktiv kö som kö-set).
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.3.zip`.
4. Kopiera innehållet över samma unpacked Chrome-mapp så extension-ID/lokal state bevaras.
5. I `chrome://extensions`, välj **Läs in igen**. Greenfield injicerar själv den nya content-bryggan när den ser versionsbytet i fliken.
6. Verifiera att panelen visar `Greenfield v1.8.3`.
7. Verifiera live när det inträffar:
   - **Vit ruta eller sida som inte svarar:** panelen visar ”Flikåterhämtning: …”, och Greenfield laddar om, laddar om hårt, öppnar samma URL och till sist en ny flik.
   - **Inmatningsfältet saknas i SENDING:** omladdning efter cirka 90 s.
   - **Daybreak-kort:** samma GFW fortsätter i ny chatt. Vid upprepning inom 24 h pausas GFW:n (panelen: Schema, paus till …) och kön går vidare. Platsen blir aldrig BLOCKED.
   - Exportera diagnostik efteråt. `responseObservation` visar stegen (`TAB_RECOVERY_…`, `PROVIDER_CONTENT_BLOCKED:…`).

Ha gärna bara en ChatGPT-flik per workerfönster. Steget ”ny flik” binder om processen bara när exakt en sådan flik finns.

Lokal paketverifiering kan verifiera koden och regressionerna. Den ersätter inte live Chrome/ChatGPT-acceptans.
