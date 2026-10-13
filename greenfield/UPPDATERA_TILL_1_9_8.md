# Uppdatera till Greenfield 1.9.8 RC1 Thinking

1. Använd **Pausa nya utskick** och låt redan skickat arbete stämmas av. Spara en kopia av befintlig tilläggsmapp och exportera körläget med den befintliga exportfunktionen.
2. Packa upp leveransen. Kopiera innehållet i `greenfield` över samma befintliga tilläggsmapp. Behåll installationens ID och lokala tillstånd; paketet innehåller inga förinställda uppdrag eller kördata.
3. Välj **Läs in igen** för Greenfield i `chrome://extensions`. Läs in berörda ChatGPT-flikar igen efter att pågående utskick stämts av. Panelen ska visa **v1.9.8 RC1**.
4. Återuppta utskick. Vid nästa tillåtna sändning väljer och verifierar Greenfield högsta tillgängliga tänkenivå. Detta sker även före det första initieringspinget i en ny session.

Ingen ny inställning behöver aktiveras. Panelens lägsta tänkenivå är fortsatt ett golv; Greenfield försöker nu välja högsta tillgängliga nivå ovanför detta golv.

## Kort driftkontroll för kandidaten

Starta ett GFW i en ny EIC-session med Balanserad valt. När sändningen blir tillåten ska nivån höjas före första prompten. I gränssnittet från bilagorna ska Pro väljas om det är tillgängligt. Händelsen `THINKING_MAXIMUM_VERIFIED` ska visa nivå, valmetod och sessionsnummer.

Kontrollera sedan en ny session och ett andra arbetsfönster. Båda ska få egna verifieringar. Om menyn är okänd eller valet inte bekräftas ska panelen visa orsaken och ingen ny prompt skickas.

Om du redan har modellmenyn öppen kan Greenfield be dig stänga den. Därefter försöker processen igen enligt befintlig återkontroll, normalt tidigast efter cirka 30 sekunder. Automationen ska inte stänga en meny som du öppnat före försöket.

Status: kod och riktade DOM-tester verifierade; liveacceptans i din Chrome-installation återstår. Detta är en RC-kandidat.
