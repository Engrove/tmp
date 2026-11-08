# Uppdatera till Greenfield 1.9.9 RC1 Runtime

1. Använd **Pausa nya utskick** och låt redan skickat arbete stämmas av. Spara en kopia av befintlig tilläggsmapp och exportera körläget med den befintliga exportfunktionen.
2. Packa upp paketet. Kopiera innehållet i `greenfield` över samma befintliga tilläggsmapp. Behåll installationens ID och lokala tillstånd.
3. Välj **Läs in igen** för Greenfield i `chrome://extensions`. Läs därefter in berörda ChatGPT-flikar igen. Panelen ska visa **v1.9.9 RC1**. Ett skript från den gamla versionen får inte den nya felhanteringen förrän det ersatts.
4. Välj ChatGPT-fliken i det Chrome-fönster där arbetskön ska köras. Starta kön därifrån och återuppta utskick. En aktiv `chrome://extensions`-flik kan inte användas som startflik.

Detta paket innehåller även Thinking-rättningen från 1.9.8. Högsta tillgängliga nivå väljs och verifieras före nästa tillåtna sändning, även före initieringen i en ny session. Ingen extra inställning krävs.

## Driftkontroll

- En ny session som börjar med Balanserad ska få högsta tillgängliga nivå före första prompten. I det visade gränssnittet är det Pro om detta är tillgängligt.
- Start från tilläggssidan ska ge ett begripligt meddelande om att välja ChatGPT-fliken i samma fönster.
- Vid nästa tilläggsomladdning ska sidskript från 1.9.9 upphöra med notifieringar när den ogiltiga anslutningen upptäcks. Läs in flikarna igen för att återansluta dem.
- Fel som redan finns i Chromes fellista kan ligga kvar som historik. Kontrollera nytillkomna fel efter omladdningen.

Kandidaten har kontrollerats med riktade automatiska tester. Verifiering i din inloggade Chrome-installation återstår.
