# Uppdatera till Greenfield 1.9.18

Detta är den fullständiga appen, med workeråterställning och alla tidigare
korrigeringar från 1.9.17 Initialization ACK.

1. Pausa nya utskick. Låt eventuella pågående svar avslutas och bevara deras
   konversationer. Exportera diagnostik/pausad säkerhetskopia före uppdatering.
2. Spara föregående programfiler som återställningskopia. Byt hela innehållet
   i den befintliga tilläggsmappen mot denna leveranss `greenfield/`.
   Avinstallera inte tillägget; behåll dess lagring och samma installationsmapp.
3. Välj **Läs in igen** för Greenfield på `chrome://extensions`. Öppna panelen
   igen. Panel och **Körande motor** ska båda visa **1.9.18**. Ladda vid behov om
   ChatGPT-flikarna vid en säker turgräns.

## När Starta arbetskö blockeras av en worker

Välj **Uppdragskö → Hantera worker-krockar**. Samma kontroll visas automatiskt
vid kända ägarskapsfel under köstart.

- **Inget hinder i ägarregistret:** starta kön. Modell-, schema-, effekt- och
  operatörsspärrar kontrolleras fortfarande separat.
- **Aktiv worker:** öppna dess tidigare konversation. Stoppa kön i dess panel
  och läs färdigt eventuellt utskick. Kontrollera därefter worker-krockarna igen.
  Ett stopp bevisar inte att ett redan skickat arbete saknar effekter.
- **Saknad historik/oklart utskick:** öppna originalkonversationen om adressen
  finns. Kontrollera uppdragets aktuella tillstånd och tidigare effekter med
  EIC/uppdragsägaren. Under **Stäm av och tillåt övertagande**, ange det verkliga
  kvittot och vad som återstår, bekräfta avstämningen och välj **Spara avstämning**.
  Klicka sedan **Starta arbetskö**. Avstämningen är knuten till detta GFW,
  denna köplats, worker och den kontrollerade källversionen. Ändrad historik
  eller en aktiv tidigare worker spärrar ett inaktuellt godkännande.
- **Skadad checkpoint:** exportera diagnostik. Ett godkännande kan inte göra
  en trasig lagringspost till verifierad data. Radera inte lagringen som genväg.

Ett manuellt kvitto ska innehålla ägarreferens, verifierade tidigare effekter,
öppna skyldigheter och säker fortsättning. Skriv inte tokens eller hemligheter.
Det är operatörens avstämning, inte automatiskt ägar-PASS. Om effekterna ännu
är oklara ska inget övertagande godkännas.

## Kvittera återställningsnotisen

På **Körstatus** finns **Kvittera återställningsnotisen** när okvitterade poster
visas. Detta nollställer notisräknaren för just dessa händelser även efter omstart.
Poster och avstämningsspärrar finns kvar under **Återställning**. Nya eller ändrade
händelser visas igen. Lagringsfel döljs inte. Köer som aldrig startats redovisas
separat och räknas inte längre som workers som behöver återställning.

**Öppna originalkonversation** öppnar saknad konversation i ett separat fönster,
eller fokuserar den befintliga fliken. Välj **Sök återställda flikar** efter att
sidan laddats. Återanslutning kräver matchande originalkonversation och användartur.
Kön kan sedan återuppta sin tidigare körfas enligt sina ordinarie spärrar.
Flera kopior av samma konversation eller ett fönster med annat arbete byts inte
ut automatiskt. Lämna en originalflik i ett separat, ledigt fönster.

## Verifieringsnivå

Tillägget körs direkt från `greenfield/`; npm behövs bara för tester.
För reproduktion: `npm ci --ignore-scripts --no-audit --no-fund`, sedan `npm test`.
Leveransens faktiskt körda kommandon, källhashar och begränsningar finns under
`../verification/1.9.18/` och i `../release-status.json`.

Lokal testning och loggreplay är separata från installation och verklig Chrome-
acceptans. Denna filleverans installerar inte tillägget och tilldelar inte något
GFW slutstatus PASS. Äldre instruktioner i paketet är historik.
