# Uppdatera Greenfield 1.7.7 → 1.7.8

1. Pausa nya Greenfield-utskick.
2. Säkerhetskopiera den unpacked extension-mappen (spara gärna aktiv kö som kö-set).
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.7.8.zip`.
4. Kopiera innehållet över samma unpacked Chrome-mapp så extension-ID/lokal state bevaras.
5. I `chrome://extensions`, välj **Läs in igen**.
6. Verifiera att panelen visar `Greenfield v1.7.8`.
7. Verifiera live:
   - andra prompten i samma konversation har `promptProfile.profile = COMPACT`, även om turen tog över 30 min och Greenfield gjorde sin egen F5
   - byte av konversation eller rotation ger `promptProfile.profile = FULL`

Ändringen gäller bara hur FULL/COMPACT väljs. Runtime-control, kö och svarskontrakt är oförändrade från 1.7.7. Om en pågående process fångade sitt senaste svar redan i 1.7.7 saknar svaret det nya konversationsfältet. Nästa prompt blir då FULL, och därefter COMPACT som vanligt.

Lokal paketverifiering kan verifiera koden och regressionerna. Den ersätter inte live Chrome/ChatGPT-acceptans.
