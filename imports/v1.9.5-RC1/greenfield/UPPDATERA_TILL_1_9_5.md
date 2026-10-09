# Installera Greenfield 1.9.5 RC1

Detta är en installationskandidat med lokal kodverifiering. Aktuell Chrome/ChatGPT-drift är ännu inte liveverifierad. Chrome 138 eller senare krävs enligt manifestet.

1. Klicka **Pausa och exportera** i den nuvarande installationen. Spara kopian och en kopia av tilläggsmappen.
2. Packa upp installationspaketet. Kopiera innehållet i mappen `greenfield` över **samma tilläggsmapp som Chrome redan använder**. Behåll den befintliga mappens sökväg och installation. Då behålls extension-ID och lokal state. Installationspaketet innehåller ingen egen runtime-state.
3. Öppna `chrome://extensions` och klicka **Läs in igen** för Greenfield. Vid en helt ny installation: aktivera utvecklarläge och välj **Läs in okomprimerat**, med mappen som innehåller `manifest.json`.
4. Läs in berörda ChatGPT-flikar igen så att även innehållsskriptet får version 1.9.5. Panelen ska visa **v1.9.5 RC1**. Exportera diagnostik om den visar fel eller återställningsstopp.
5. Kontrollera ett arbetsfönster innan du återupptar hela flottan. Klicka den befintliga knappen för att återuppta nya utskick när status och målflik är korrekta.

## Kort driftkontroll

- Starta ett ofarligt läsuppdrag i ett fönster. I en ny chatt ska ett kort `SESSION_INITIALIZATION`-ping besvaras före arbetsuppdraget. Pinget ska inte förbruka uppdragets interaktionskvant.
- Låt ett uppdrag i en kö tidsvila. Ett annat körbart uppdrag ska fortsätta, medan det pausade behåller sin väcktid. **Pausa nya utskick** gäller globalt.
- Skapa och redigera ett sparat uppdrag via Project ID, projektnamn och GF-ID. Kontrollera att den valda instruktionen och det kompletta ID:t sparas, även efter omläsning.
- Vid ett faktiskt fel om förlorad konversation ska appen återhämta sessionen med missionen kvar. Vid ett faktiskt leveranstimeout får endast en kort **Fortsätt** skickas i den bevisade konversationen; högst två försök, utan omsändning av hela arbetsuppdraget. Dessa providerfel behöver inte framkallas i ett skarpt skrivuppdrag.

Oklar utskickseffekt, saknad behörighet, kvalitetsstopp och skadad lagring behåller sina spärrar. Återläsning av en backup kräver en tom installation och startar inget arbete; skriv inte över aktuell state genom att försöka återimportera en backup under normal uppdatering.

## Innehåll och avgränsning

Kandidaten innehåller de samlade rättelserna R1–R6 och R7A:s avgränsade återhämtning av avbruten terminalpublicering för klassificerade äldre köblockers. `GF-n.z.xxxx` läses som ett helt ID; historiska ID:n kan fortfarande läsas. Ingen registermigration eller automatisk tilldelning av GF-ID:n har gjorts.

Fullständig verifieringsstatus, kvarvarande AC-04-avgränsning och reproduktionsunderlag finns i fortsättningspaketets `steps/R7A/REPORT.md`. Äldre versionsdokument och testresultat i utvecklingspaketet är historik.
