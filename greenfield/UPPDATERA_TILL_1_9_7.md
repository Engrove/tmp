# Uppdatera Greenfield till 1.9.7 RC1

Denna version lägger till minsta väntetid efter färdig kvant per GFW i uppdragskön. Initieringen från 1.9.6 behålls: öppna rätt projekt, svara READY, invänta nästa prompt.

1. Spara en kopia av nuvarande tilläggsmapp och använd befintliga **Pausa och exportera** om du behöver en körlägeskopia före uppdateringen.
2. Packa upp paketet. Kopiera innehållet i `greenfield` över **samma befintliga tilläggsmapp**, så att installationens ID och lokala körläge behålls. Paketet innehåller ingen förinställd runtime-state.
3. Välj **Läs in igen** för Greenfield i `chrome://extensions`, och läs in berörda ChatGPT-flikar igen. Panelen ska visa **v1.9.7 RC1**. Återuppta nya utskick med den befintliga knappen när uppdateringen är klar.

## Ange intervallet

Öppna uppdragets **Schema**. Ange **Minsta väntetid efter färdig kvant**, välj **Minuter** eller **Timmar**, och välj **Spara schema**. Hela tal, 0 till högst 30 dygn; 0 innebär ingen väntetid.

Exempel: 3 interaktioner per kvant och 2 timmar väntetid. Första kvantens tre interaktioner körs normalt. När kvanten är färdig börjar två timmar väntetid. Under tiden hoppas GFW:t över medan andra körbara uppdrag fortsätter. När väntetiden har löpt ut kan nästa kvant köras vid uppdragets tur i kön och inom dess eventuella körfönster. Efter att den kvanten blir färdig börjar två nya timmar väntetid.

Dubbletter av samma sparade GFW i samma kö delar intervall och senaste avslutstid. Övriga köinställningar för varje plats behålls. Olika arbetsfönsters köer är självständiga. Paus, stängt körfönster eller tidig överlämning under en ofärdig kvant startar ingen ny intervallperiod. En pågående tur får avslutas.

Körtidpunkten sparas över omläsning/återstart. Om alla köplatser väntar går arbetsfönstret till QUEUE_WAIT och väcks vid nästa möjliga körning. Köset sparar intervallinställningen; när ett köset laddas börjar det en ny kö utan gamla körtidpunkter, precis som dess befintliga körläge återställs.

Aktuell verifiering och fortsättningspunkt finns i `steps/R8A` i fortsättningspaketet. Denna nya funktion har testats lokalt och är ännu inte liveprovad i Chrome här.
