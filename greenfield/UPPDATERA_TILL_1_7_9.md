# Uppdatera Greenfield 1.7.8 → 1.7.9

1. Pausa nya Greenfield-utskick.
2. Säkerhetskopiera den unpacked extension-mappen (spara gärna aktiv kö som kö-set).
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.7.9.zip`.
4. Kopiera innehållet över samma unpacked Chrome-mapp så extension-ID/lokal state bevaras.
5. I `chrome://extensions`, välj **Läs in igen**. Greenfield injicerar själv den nya content-bryggan (och overlayen) när den ser versionsbytet i fliken.
6. Verifiera att panelen visar `Greenfield v1.7.9`.
7. Verifiera live:
   - overlayen visar GFW-id, plats, interaktion/kvant, TTL-nedräkning och nästa GFW i kön
   - en tur som passerar 120 min utan färdigt svar ger köbyte till nästa körbara köplats; den stallade platsen ligger kvar som redo

Kö, runtime-control och promptprofil är i övrigt oförändrade från 1.7.8.

Lokal paketverifiering kan verifiera koden och regressionerna. Den ersätter inte live Chrome/ChatGPT-acceptans.
