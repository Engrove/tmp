# Installera Greenfield 1.9.11

1. Pausa nya utskick. Behåll en kopia av befintlig tilläggsmapp och exportera körläget om det innehåller pågående arbete.
2. Packa upp leveransen. Kopiera innehållet i **greenfield** över samma tilläggsmapp som Chrome redan använder. **Avinstallera inte tillägget.** En ny separat installation kan få annan identitet och sakna det tidigare körläget.
3. Öppna `chrome://extensions` och välj **Läs in igen** för Greenfield. Ladda därefter om ChatGPT-flikarna som Greenfield styr. Kontrollera att panelen visar **v1.9.11**.
4. I det berörda arbetsfönstret: välj **Kontrollera modellen igen** och återuppta utskick/kön.

Ingen byggning eller npm-installation behövs för att använda tillägget. Mappen greenfield innehåller manifest, skript, panel, ikoner och runtime-moduler. [E106 i `verification/evidence_log.md`]

Vid en helt ny installation: aktivera utvecklarläge i `chrome://extensions`, välj **Läs in okomprimerat tillägg** och peka på den uppackade mappen greenfield. Använd därefter ordinarie Greenfield-konfiguration.

## Beteende efter uppdatering

- Ny session på Balanserad: adaptern söker kontrollens högsta tillgängliga nivå, ändrar och verifierar den före initieringsprompten. [E102, E103]
- Redan Extra hög, 4 av 4: adaptern verifierar positionen och stänger menyn utan att klicka på modellnavigationen. [E103]
- Utebliven eller motsägelsefull återläsning: sändningen förblir spärrad; diagnostiken visar kontrollen och utförda nivåaktioner. [E102, E103]

Automatiska tester är genomförda. Acceptans i din inloggade Chrome-miljö är ännu inte verifierad. [E105, A101]
