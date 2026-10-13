# Uppdatera till Greenfield 1.9.10 RC1 Thinking Menu

1. Pausa nya utskick och stäm av eventuellt pågående arbete. Behåll en kopia av den befintliga tilläggsmappen och exportera körläget med befintlig funktion.
2. Kopiera innehållet i paketets `greenfield` över samma installerade tilläggsmapp. Behåll installationens ID och lokala tillstånd.
3. Välj **Läs in igen** på Greenfield i `chrome://extensions`. Läs därefter in berörda ChatGPT-flikar igen. Panelen ska visa **v1.9.10 RC1**.
4. Välj rätt ChatGPT-flik och återuppta utskick. **Kontrollera modellen igen** återställer spärren mot identiska menyförsök och begär en ny kontroll.

## Förväntat beteende

Greenfield ska nå tänkenivåns reglage, välja och läsa tillbaka dess högsta tillgängliga nivå och stänga reglaget före utskick. En redan öppen modellmeny ska kunna stängas om den säkert hör till kompositorns kontroll. Modellalternativ som 6, GPT-5.6, GPT-5.5 eller Pro får inte väljas för att imitera ett tänkenivåval.

Om gränssnittet fortfarande inte kan verifieras stoppas utskicket. Samma oförändrade fel ska då inte ge nya klick eller växling mellan öppet- och timeoutfel. Ändringar i den relevanta kontrollen, en ny session eller **Kontrollera modellen igen** medger nästa försök.

Vid kvarstående problem innehåller **Exportera diagnostik** nu vilka popupfönster/reglage adaptern observerade, deras roller och värden, öppningsmetod samt vilket steg som misslyckades. Ingen prompttext läggs till av denna diagnostik.

Automatiska tester är genomförda. Acceptans i den aktuella inloggade Chrome-sessionen är ännu inte verifierad.
