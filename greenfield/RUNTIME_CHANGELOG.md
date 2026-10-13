# Greenfield 1.9.9 RC1 Runtime — 2026-10-13

## Underlag och orsak

Skärmbilden visar `Uncaught Error: Extension context invalidated` på `content.js:1414`. Den bifogade texten visar samma `scheduleDirty`-kod som i basversionen och Thinking-kandidaten. Kodraden räcker därför inte för att avgöra vilken av dem som var installerad.

`chrome.runtime.sendMessage(...).catch(...)` fångar bara en avvisad Promise. Om API-anropet kastar direkt, såsom i den rapporterade händelsen, nås aldrig `.catch`. Sidans MutationObserver och andra timers kan fortsätta leva och utlösa fler anrop. En omladdning eller ersättning av tillägget är en möjlig förklaring till den ogiltiga anslutningen; bilden fastställer inte vilken åtgärd som föregick felet.

Panelen visar dessutom `ACTIVE_CHATGPT_TAB_REQUIRED`, medan aktiv flik är `chrome://extensions`. Startvägen kräver en ChatGPT-flik i rätt fönster om ingen giltig tidigare processflik kan användas. Bilden är förenlig med att starten försöktes från tilläggssidan. Detta är en separat startspärr och inte bevis för fel i Thinking-valet eller schemapausen.

## Ändringar

- Sidans fem typer av meddelanden till bakgrunden går genom en asynkron wrapper som hanterar både direkt kastade undantag och avvisade Promise-anrop. Vanliga transportfel förblir fel och kan inte godkänna ett utskick.
- När anslutningen är ogiltig kopplas DOM-observatör, statusruta, återkommande timers, fellyssnare, meddelandelyssnare och den gamla Thinking-adaptern bort. Städningen kan anropas flera gånger.
- Sena svar från en ersatt brygga ignoreras. Den gamla bryggans städning gäller dess egen Thinking-adapter, så att den nya instansen inte stängs av.
- Pågående operationer kontrollerar bryggans livscykel vid asynkrona gränser och direkt före Skicka-klicket. Ett redan utfört klick behåller `effectPossible: true` vid efterföljande fel. Befintliga dispatchkvitton och dokumentidentitet bevaras vid återinjektion i samma sidkontext.
- Fel vid svar på en stängd meddelandekanal utlöser inte ett andra svar som påstår att ingen effekt är möjlig.
- `ACTIVE_CHATGPT_TAB_REQUIRED` visas nu som: ”Välj ChatGPT-fliken i detta Chrome-fönster och starta arbetskön igen”. Flikvalet och startkravet är oförändrade.
- Runtimeversionen höjs till 1.9.9 för att den befintliga versionskontrollen ska begära ny sidkod.

## Verifiering och avgränsning

34 riktade tester passerar: 22 Thinking-tester och 12 fall för sidans livscykel, återinjektion, synkron/asynkron invalidering, saknat runtime-ID, vanliga mottagarfel, sen återkoppling, avbrott före/efter klick samt startmeddelandet. Livscykeltesterna kör hela sidbryggan i jsdom med simulerade Chrome-API:er. Utskickstester använder produktionsfunktionerna med kontrollerade sidtillstånd. Thinking-testernas formulär stoppar jsdoms oimplementerade standardsändning; själva Skicka-klicket mäts fortsatt.

Alla levererade JavaScript- och MJS-filer syntaxkontrolleras. Testresultat, versionsdiffar och kontrollsummor finns i paketet. Ingen livekörning i användarens Chrome har genomförts, och den ursprungliga fullständiga projekttestsviten saknades i källunderlaget.

Denna rättning ersätter inte tidigare analys av parallella workers och schemapauser. De dokumenterade bristerna i Nano-förkontroll, initieringshantering, uppstartskö, schemaretry, köägarskap och global felklassning kvarstår. Inga påståenden om att dessa är lösta ingår.

En redan ogiltig tilläggskontext kan inte återupplivas av den gamla koden. Berörda ChatGPT-flikar behöver läsas in igen efter uppdateringen. Kördata återställs inte och tillägget installeras inte automatiskt av detta paket.
