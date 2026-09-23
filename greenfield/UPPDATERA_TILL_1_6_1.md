# Greenfield 1.6.1 RC2 – korrigering av startfelet i RC1

**Startfelet var en regression i den levererade RC1-koden.** Den beräknade SHA-256 på `JSON.stringify(value)` och förutsatte därmed att objektfältens ordning överlevde Chrome-lagring. Identiska data med annan fältordning fick felaktigt fel kontrollsumma. De tidigare lagringsmockarna använde `structuredClone` och missade denna gräns.

Med RC1:s verkliga checkpointmodul och en lagringsadapter som serialiserar och sorterar objektfält reproduceras:

1. Första skrivningen: `CHECKPOINT_WRITE_READBACK_FAILED`.
2. Nästa start: `CHECKPOINT_UNRECOVERABLE` för samma arbetskö.

Det motsvarar feltypen på din skärmbild. Den bifogade NDJSON-loggen innehöll bara `AUDIT_ENABLED`; den innehöll varken själva startfelet eller lagringsposterna. Därför är den exakta posten i din Chrome-profil inte byteverifierad här.

## Installera korrigeringen

1. Säkerhetskopiera din nuvarande tilläggsmapp. Packa upp det nya ZIP-paketet och ersätt programfilerna i **samma mapp som det redan installerade tillägget använder**. Avinstallera inte tillägget och rensa inte dess data.
2. Öppna `chrome://extensions` och välj **Läs in igen** på Greenfield. Kontrollera version **1.6.1-rc.2** och oförändrat tilläggs-ID. Öppna därefter sidopanelen igen.
3. I Körstatus ska **Lagringskontroll vid start** visa **Skrivning och återläsning godkända**. Den kontrollen körs i din installerade Chrome, före migration och nya uppdrag. Återställningsraden visar hur många RC1-poster som reparerats.
4. Välj **Kontrollera modell igen**. Knappen fungerar nu även innan en process har startats. Modellkravet kvarstår: avsedd version, Thinking och tillräcklig avläsbar tänkenivå krävs.

**Bilden visar att den aktiva modellen är GPT-5.6 Luna och att skaparen rekommenderar Sol.** En rekommendation eller en blå växlingsknapp är inte bevis för det aktiva modellvalet. Välj den avsedda modellen och tänkenivån i EIC Chat. RC2 antar inte att ett modellnamn ensamt bevisar djup Thinking. Om nivån inte kan läsas visar kontrollen det och håller utskick.

## Vad RC2 ändrar

- Checkpoints använder ett versionsmärkt, kanoniskt JSON-format med stabil sortering av objektfält. Listornas ordning och alla värden bevaras. SHA-256 täcker också checkpointens metadata.
- Kompatibla RC1-poster läses med en begränsad rekonstruktion av den ursprungliga skrivarens fältordning. **Både samma datainnehåll och exakt samma gamla hash måste stämma.** Kontrollsummekravet har inte stängts av.
- Före reparation sparas samtliga ursprungliga poster i ett separat lokalt reparationsarkiv. Den strandade tomma kön kan återställas utan att du behöver radera den. En återvunnen, ofullständigt publicerad kö med arbete hålls inaktiverad och nya utskick pausas för avstämning.
- Förbrukningsposter och kvotspärrar bevaras vid kompatibel återställning av säkerhetsjournalen. En avbruten reparation kan fortsätta från ett verifierat reparationsarkiv.
- Backupformatet tål också ändrad fältordning vid meddelandeöverföring. Korrekt äldre v2-backup kan fortfarande läsas som ursprunglig JSON-text.
- **Exportera diagnostik** fungerar utan att först avkoda de felaktiga posterna. Exporten innehåller version, startfel, reparationsstatus, råa relevanta lagringsposter och avläst modellinformation. Den ersätter behovet av att fånga startfelet efter att Audit slagits på.
- Okända förbrukningsvärden visas som okända, inte som `0 / 0`. En lagringsspärr visas inte samtidigt som statusmärket NORMAL. Resultatet från modellkontrollen ligger kvar synligt på Körstatus.

Verkligt skadade eller inte exakt rekonstruerbara äldre poster godkänns inte automatiskt. Om en sådan spärr kvarstår: använd **Exportera diagnostik**. Filen kan innehålla uppdragsdata; den skickas inte automatiskt någonstans. Rådata bevaras för riktad felsökning och ska inte rensas för att forcera start.

## Verifiering och kvarvarande gräns

**429/429 automatiserade tester passerar**, varav 22 nya testfall för den här regressionen. De nya fallen omfattar en verklighetstrogen JSON-/fältordningsgräns, den reproducerade tomma RC1-kön, kö med uppdrag, bevarad förbrukning, faktiskt skadad data, avbruten reparation, backupöverföring och start/sändning genom den riktiga bakgrundskoden med simulerade Chrome-API:er.

Den tidigare siffran 407/407 bevisade inte Chrome-kompatibel serialisering. Den här korrigeringen täpper till den luckan. Den har ändå inte installerats i din Chrome-profil här, och modelladapterns aktuella DOM-selektorer är inte liveverifierade mot ditt konto. Startprovet i RC2 ger ett nytt lokalt kvitto när du laddar om tillägget. Långtids-/semesteracceptansen från driftguiden återstår.

Teknisk bakgrund: [Chromiums `base::DictValue`](https://chromium.googlesource.com/chromium/src/+/main/base/values.h) använder en sorterad struktur för objektfält. Den korrekta slutsatsen för tillägget är att fältens insättningsordning inte får användas som integritetsbevis. Källan kontrollerades 8 september 2026.

Se `BUILD_VERIFICATION.json`, `verification/hotfix-tests.tap` och `verification/rc1-reproduction.txt` för leveransens verifieringsunderlag. Den medföljande PDF-rapporten och dokument med 1.6.0 i namnet är historiskt RC1-underlag; den här korrigeringsnoteringen har företräde.
