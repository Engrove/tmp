# Thinking-rättning 1.9.8 RC1

## Orsak

1.9.7 observerade tänkenivån men saknade kod som valde en högre nivå. Etiketten Balanserad saknades i nivåtolkningen. En strukturellt identifierad kontroll med okänd etikett kunde godkännas som Extended. Dessutom utgick kompositorns prioriterade nivåobservation från `#prompt-textarea`, som saknas i den bifogade nya kompositorn.

Bilagans knapp har `data-codex-intelligence-trigger`, `data-composer-navigation-target="reasoning"` och `data-selected-reasoning-effort="max"`, med synlig text Extra hög. Skärmbilderna visar också Pro längst till höger i reglaget. Ett minimikrav på Heavy/Max räcker därför inte för att bevisa att högsta tillgängliga val gjorts.

## Ändringar

- `lib/thinking-control.js`: styr den identifierade tänkenivåkontrollen i kompositorn. Avgränsar öppnad meny via kopplad popup eller entydigt nytillkommet reglage. Väljer numeriskt maximum eller högsta kända, aktiverade menyalternativ. Modellundermenyer räknas inte som tänkenivåer. Inga koordinatklick, modell-API-anrop eller ändringar av prompten görs.
- `lib/model-observation.js`: stöder kompositorn utan gammalt element-ID, läser vald nivå och publicerar dokumentlokalt verifieringskvitto. Dolda mätetiketter används inte som vald text.
- `lib/safety-policy.js`: känner igen Balanserad/Balanced och andra låga nivåer. Enbart förekomsten av en okänd kontroll ger inte längre tillstånd. Ny sändning kräver verifierat maximum utöver befintliga modell- och nivåkrav.
- `background.js`: kör förkontrollen efter avstämning av tidigare sändning och före sändgrindarna. Gör ny återläsning innan utskick. Vid kapacitetsväntan eller sidbyte kan ett nytt val behövas. Verifierar processägarskap före och efter UI-operationen.
- `content.js`: kontrollerar sida, EIC-identitet, utkast, pågående generering och leverantörsväntan. Kontrollerar maximum igen omedelbart före Skicka-klicket. Tidigare sändkvitton och skyddet mot dubbelsändning bevaras.
- `lib/operations-view.mjs`: svenska statusorsaker när valet inte kan verifieras.
- Manifest, injektionslista, content bridge, versionskonstant och panel uppdaterade till 1.9.8.

Varje valförsök har en tidsbudget på sex sekunder. Kvittot binds till URL, vald kontroll, synlig modellkontroll och dokumentets adapterinstans, med högst 60 sekunders giltighet. Mutationer i kontrollen, öppning av modellmenyn och omladdning upphäver kvittot. Inget kvitto delas mellan fönster.

## Verifiering

22 riktade tester finns i `tests/thinking-control.test.mjs`. De täcker avläsning av bifogad knapp, nivåklassificering, slider/range/meny, Pro över Extra hög, dynamiskt maximum, inaktiverat alternativ, dialoger, utkast, generering, leverantörsväntan, fel dokument/GPT, kvotspärr, modellundermeny, utebliven återläsning, sessionsbyte, utgångna kvitton, separata dokument, ägarbyte, osäker tidigare effekt samt sändfunktionens sista spärr och deduplicering.

Testmiljön är Node med jsdom. Layoutmått, sliderhändelser och externa Chrome-gränser simuleras. Ett positivt sändtest kör den modifierade `submitPrompt` och bekräftar exakt ett klick, även vid återanrop med samma dispatch-ID. Ett negativt test återställer Balanserad efter bakgrundens auktorisering och verifierar noll klick.

Bilagans HTML innehåller inte den öppna reglagemenyn. Reglagets faktiska händelsehantering i inloggad Chrome är därför **NOT_VERIFIED**. Ingen ändring har installerats i användarens Chrome. Tidigare fullständig projekttestsvit saknas i källpaketet. Leveransen ska inte beskrivas som fullständigt liveverifierad.

Den tidigare kodgranskningens övriga fynd är inte rättade här. I synnerhet kan Nano-förkontrollen fortfarande hindra en startbegäran innan den når detta flöde.

## Underlag

Bas: `EIC_Autonom_Agent_Greenfield_v1.9.7_RC1.zip`, SHA-256 `6743d6d1859f44b5c9a5846a268ca48f1bbd299e55940abde9645a8b8ddaf865`.

Operatörens tre skärmbilder och `Inklistrad text(20261013-032903).txt` har använts för inspektion. Endast tänkenivåknappen har extraherats till testfixturen; resten av den privata sidkopian ingår inte i leveransen.
