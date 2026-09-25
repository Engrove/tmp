# Uppdatera Greenfield 1.8.3 → 1.8.4

1. Pausa nya Greenfield-utskick.
2. Säkerhetskopiera den unpacked extension-mappen. Spara gärna aktiv kö som kö-set.
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.4.zip`.
4. Kopiera innehållet över samma unpacked Chrome-mapp så att extension-ID och lokal state bevaras.
5. I `chrome://extensions`: välj **Läs in igen**, öppna **Fel** för Greenfield och välj **Ta bort alla**. Det gamla ”Pattern attribute value GPT[- ]…”-felet ligger kvar tills du tar bort det.
6. Verifiera att panelen visar `Greenfield v1.8.4`.
7. Verifiera att felet inte återkommer: öppna **Körkrav** och skriv `foo` i Modellgolv. **Spara körkrav** ska stoppas i fältet, och **Fel** ska förbli tomt. Återställ sedan värdet, till exempel `GPT-5.6`.

Ändringen gäller bara fältets mönster i panelen. Det har inga effekter på runtime, kö eller sparad state. Ett redan sparat modellgolv godtas oförändrat.
