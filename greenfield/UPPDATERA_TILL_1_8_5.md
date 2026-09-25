# Uppdatera Greenfield 1.8.4 → 1.8.5

1. Pausa nya Greenfield-utskick. Spara gärna aktiv kö som kö-set.
2. Säkerhetskopiera den uppackade tilläggsmappen.
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.5.zip` och kopiera innehållet över samma mapp som Chrome redan använder, så att extension-ID och lokal state bevaras.
4. I `chrome://extensions`: välj **Läs in igen**. Panelen ska visa `Greenfield v1.8.5`.
5. Öppna **Uppdragskö → Sparade uppdrag**. Räknaren visar `N / 64` och hur många GF-ID som har dubbletter. **Städa sparade uppdrag** listar alla sparade uppdrag; äldre dubbletter och uppdrag utan GF-ID är märkta.
6. Importera de normaliserade texterna: **Import och export** → klistra in texterna med rubriker `### GF-001` … → **Förhandsgranska**. Kontrollera varje rad (ny, ändras, oförändrad, dubbletter, ignorerade rader) och slutsumman `Efter import: N / 64`. Välj sedan **Genomför import**.
7. Statusraden ska säga ”Import klar … Varje post är återläst ur bokmärkesvalvet” och hur många platser i kö-set som uppdaterades.
8. **Exportera alla** sparar en JSON-fil som kan importeras igen.

## Vad som händer med dina data

- Ett sparat uppdrag med samma GF-ID på första raden uppdateras på plats med samma id. Köplatser och kö-set som pekar på det får den nya texten.
- Inget raderas automatiskt. Taket är 64. Ett nytt uppdrag i ett fullt valv nekas med ett synligt fel under **Spara aktuellt uppdrag** och i administrationskortet.
- 1.8.4 hade taket 24 och raderade utan varning. Sparades ett nytt uppdrag via panelen raderades det äldsta. Skrevs en post med äldre `updatedAt`, som i ett bulkskript, raderades den nya posten själv och sparningen gav `SAVED_MISSION_VAULT_COMMIT_READBACK_MISMATCH`. Uppdrag som redan raderats så kan inte hämtas ur valvet, men kö-set som pekade på dem har kvar sin kopia av texten.
- En pågående process byter text först vid köplatsens nästa aktivering. Mål, fortsättning och kvitton ändras inte.
