# Greenfield 1.9.10 RC1 Thinking Menu — 2026-10-13

## Faktiskt felunderlag

Användarens diagnostik `Greenfield-diagnostics-2026-10-13T04-58-29-219Z.json` anger appVersion 1.9.9 och ingen global runtimeFault. Händelserna visar följande lokal tid, Europe/Helsinki:

| Tid | Ny spärr |
| --- | --- |
| 07:56:02 | THINKING_CONTROL_UNAVAILABLE |
| 07:56:38 | THINKING_SELECTION_TIMEOUT |
| 07:57:09 | THINKING_MENU_ALREADY_OPEN |
| 07:58:15 | THINKING_SELECTION_TIMEOUT |

Processen står i SENDING, tur 1, session 1. Initieringen är PENDING, dispatch saknas och kvitto på högsta tänkenivå saknas. Den valda synliga etiketten är Extra hög. Det bevisar inte att högsta tillgängliga nivå är vald.

Skärmbilden visar en modellista med 6, GPT-5.6 Sol, GPT-5.5 och ett inaktiverat Pro-alternativ. Tidigare bilder visar ett separat horisontellt tänkenivåreglage. Den tidigare bifogade HTML-koden har en kompositorknapp med `data-composer-navigation-target="reasoning"`, `data-selected-reasoning-effort="max"`, `aria-label="Välj ChatGPT-modell"` och Radix-ID. Den öppna menyns/reglagets DOM har inte tillhandahållits.

## Brister i 1.9.9-koden

1. Öppningen använde bara `HTMLElement.click()`. Koden skilde inte öppningssättet för ett hovringsreglage från ett klick som öppnar modellistan. Den saknade även tooltip-rollen i popupurvalet och krävde `aria-expanded=true` för reservsökningen efter ett ensamt nytt reglage.
2. En redan expanderad knapp avvisades direkt med THINKING_MENU_ALREADY_OPEN. Ingen återhämtning gjordes även om en tidigare Greenfield-åtgärd lämnat menyn öppen.
3. Felstädningen krävde `current === owner`. En ny DOM-knapp efter omrendering kunde därför lämnas öppen. Ett knappklick användes också som generell stängningsåtgärd, trots att ett hovringsreglage och en modellmeny kan ha olika livscykler.
4. Den oförändrade felbilden medförde återkommande nya försök. Diagnostiken saknade uppgift om vilket menyförsök och vilken kontroll som faktiskt observerats.
5. Ett ensamt namngivet Pro-alternativ i en modellista kunde i vissa strukturer misstas för tänkenivå. Det nya urvalet avvisar modellistor före val av tänkealternativ.

Bristerna ovan är belagda i koden. Att just användarens reglage aktiveras av hovring är en arbetshypotes som stämmer med de olika visade ytorna; den är inte liveverifierad. Kandidaten stöder därför flera kontrollerade öppningssätt och kräver synligt reglage/val och bekräftat resultat.

## Rättning

- Sök först med pointer-/mus-händelser för hovring och rörelse. Stöd även tangentbordsöppning för menyer och ett villkorat klick som reservväg. Ingen modell väljs genom dessa öppningsåtgärder.
- Identifiera popup via aria-controls, aria-describedby, aria-labelledby eller en unik ny yta/reglage efter öppningsåtgärden. Tooltip och reglage utan aria-expanded stöds.
- Återhämta en redan öppen meny endast när den kan kopplas till den unika kompositorknappen. Orelaterade eller tvetydiga menyer lämnas kvar.
- Stäng med lämnahändelser och Escape, läs tillbaka att ytan är stängd och återfinn knappen efter omrendering. Klick som stängningsreserv används endast när den ägda dropdown-knappen fortfarande är expanderad.
- Samma fel och samma kontrolltillstånd återanvänder felresultatet utan nya gränssnittsåtgärder. En ändrad relevant kontroll eller URL tillåter omprövning. Operatörens befintliga **Kontrollera modellen igen** nollställer detta minne utan att godkänna en overifierad tänkenivå.
- Lagra en avgränsad diagnos av öppningsmetod, steg, synliga popuproller/reglagevärden och städning i den befintliga diagnostikexporten. Befintliga skydd för utkast, generering, kvoter, effektosäkerhet och sessionsbyte gäller fortsatt.

Bakgrundens återkommande tillståndskontroll finns kvar. Det som stoppas är upprepade menyåtgärder när inget relevant har ändrats; detta är inte en avstängning av hela workern.

## Tester och begränsningar

44 riktade Node/jsdom-tester passerar: 34 tidigare fall och 10 nya. Nya fall omfattar en knapp med olika beteende för hovring och klick, tidigare öppen modellmeny, ersatt DOM-knapp, modellistans Pro-alternativ, oförändrade återförsök, okänd menyägare, timeout med städning, vägrad stängning, orelaterade menyer och manuell återkontroll. Tre av regressionfallen kördes mot 1.9.9-adaptern och misslyckades där som förväntat; baslinjeloggen innehåller därför avsiktliga FAIL-resultat.

Testerna använder den fångade stängda knappen och modellerade öppna menyer/händelser. De bevisar inte att den aktuella ChatGPT-installationens fullständiga händelsehantering motsvarar testmodellen. Ingen inloggad livekörning är utförd. Den ursprungliga fullständiga projekttestsviten saknades i källunderlaget.

All levererad JS/MJS syntaxkontrolleras. Paketet innehåller testlogg, baslinjereproduktion, versionsdiffar och kontrollsummor. Tidigare identifierade problem med köägarskap, initieringshantering, Nano-förkontroll, schemaretry och global felklassning är inte åtgärdade i denna kandidat.

## Komponentreferenser

Radix dokumenterar hovring med separat öppnings-/stängningsfördröjning samt tangentbordsöppning och Escape för dropdownmenyer. Det stödjer valen av generella komponenthändelser, men bevisar inte ChatGPT:s aktuella komposition av dessa komponenter:

- https://www.radix-ui.com/primitives/docs/components/hover-card
- https://www.radix-ui.com/primitives/docs/components/dropdown-menu
- https://www.radix-ui.com/primitives/docs/components/tooltip
