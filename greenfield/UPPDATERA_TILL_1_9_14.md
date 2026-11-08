# Uppdatera till Greenfield 1.9.14

Detta är ett komplett Chrome-tillägg, patchat från den bifogade versionen 1.9.13. JavaScriptfilerna körs direkt; inget byggsteg behövs för installation.

1. Välj **Pausa nya utskick** i Greenfield. Behåll befintliga konversationsflikar. Exportera en återställningskopia med **Pausa och exportera** och spara gärna även diagnostiken.
2. Packa upp ZIP-filen. Kopiera **hela innehållet i `greenfield`** till samma tilläggsmapp som den befintliga installationen använder. Behåll installationens identitet och data genom att uppdatera på samma plats.
3. Öppna `chrome://extensions` och välj **Läs in igen** för Greenfield. Öppna sidopanelen på nytt och kontrollera **Körande motor v1.9.14**. Manifest, motor, sidobrygga och panel ska ha samma version.
4. Öppna de befintliga ChatGPT-flikarna. Tillägget uppdaterar sidobryggan vid kontakt; en flik som visar att anslutningen till tillägget har upphört behöver laddas om. Låt gärna ett pågående ChatGPT-svar bli klart innan manuell omladdning.
5. Återuppta utskick när versionskontrollen är samstämmig. En ny kontroll av modell och högsta tillgängliga tänkenivå sker enligt appens ordinarie sändvillkor.

## Vad händer med redan skadade poster?

En sparad post vars svar enbart består av ett UI-skal repareras när den aktiveras eller når analys-/sändnings-/rotationssteget. Originalprompt, falskt svar, rådgivarbeslut, köfortsättning och sessionsmått bevaras i reparationsposten.

För det verifierade Projekt 38-fallet återställs originalets fullständiga uppdragsram och räknaren till fyra slutförda interaktioner. Appen öppnar den ursprungliga konversationen och observerar dess redan skickade femte interaktion. Den förbereder inget omskick av arbetsprompten. Ett riktigt svar måste passera den vanliga kausalitets-, innehålls- och stabilitetskontrollen innan posten får slutföras.

Om ursprunget, den ursprungliga användarturen eller ett senare osäkert utskick inte kan verifieras behålls spärren. En redan förberedd operatörsinstruktion får inte kastas bort av automatisk reparation. Dessa fall behöver granskas utifrån den sparade diagnostiken.

## Workers som överlappar

Samma GFW får en beständig exekveringsägare. Vid aktivering kan en ny worker ta över när den tidigare workern saknar levande flik och dess tidigare utskick är avslutade enligt sparade kvitton. Ett olöst tidigare utskick stoppar övertagandet. En ersatt worker får inte skicka eller skriva över körningstillstånd; dess historik sparas. Ingen tidsstyrd radering av gamla workers införs.

## Verifiering

Automatiska tester körs med `npm ci --ignore-scripts --no-audit --no-fund` följt av `npm test` i mappen `greenfield`. Testfilerna körs i följd så att samtidiga DOM-testmiljöer inte stör de befintliga menykontrollernas verkliga tidsgränser.

Resultat, ändringsöversikt och replay av den bifogade diagnostiken finns i paketets `verification`-mapp. Testerna använder Node, JSDOM och simulerade Chrome-API:er. Den här leveransen har inte installerats eller livekörts i din inloggade Chrome-session.

## Återgång

Behåll den gamla kodmappen och den exporterade kopian tills uppdateringen är kontrollerad. Vid behov kan kodfilerna återställas på samma plats medan nya utskick är pausade. Version 1.9.13 känner inte till de nya spärrarna för uppdragsägarskap och återfår det kända skalfelet; starta därför inte autonom körning i den gamla versionen som ett sätt att kringgå en återställningsspärr.
