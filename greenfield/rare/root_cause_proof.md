# Rotorsak och bevisgräns före ändring

## Avgränsat fel: manuell kontroll rapporterar framgång utan sändbar modell

1. Mekanism: exakt handler och modellpolicy körs i harness. Loggens Extra hög utan kvitto godkänns av vanlig policy, men underkänns av requireHighestEffort. Handlern gör noll maximeringsanrop och returnerar ändå ok=true. [E201,E203]
2. Nödvändighet: bryt endast villkoret vanligt modellgodkännande genom effortLabel=Balanserad. Falska framgångar går från 6/6 till 0/6; N=6 ≥ 3/p_baslinje=3. Det bevisar det villkoret i denna harness, inte Chrome-versionens installationsorsak. [E203]
3. Tillräcklighet: fältets kompatibla etikett + null-kvitto reproducerar 6/6 falska framgångar utan kvot, paus eller kapacitetsväntan. [E203]
4. Förklaringskraft: panelen kan visa Extra hög/framgång medan initieringen är PENDING och sändaren fortfarande kräver ett kvitto. Den faktiskt körande adaptern är 1.9.10/7, vars timeout finns i fältloggen. [E201,E202,D201]
5. Konkurrenter för den avgränsade falska framgången: kvot/kapacitet/schemapaus är inte nödvändiga; felet uppträder i en enda worker med simulerat friskt I/O. För hela fältfelet finns fortfarande den okända orsaken till gammal körande kod. [E203,A202]

G0 klassificerar denna mekanism som BOH, varför RARE inte kräver fortsatt sällsynthetsförstärkning. Ingen obegränsad G5-certifiering av den levande Chrome-miljön görs. Den reproducerade mekanismen rättas. [E203,A201,A202]

## Blast radius

Ändringen ska begränsas till manuell modellkontroll, dess återupptagning och tydlig visning av körande version. Samma maximumkontroll som före sändning ska användas. Pausade processer ska förbli pausade, kvalitet/lagring/kvot/budget ska behållas, varje worker ska få ett eget resultat och STOP/processbyte över await ska vinna. Sändning ska fortfarande ägas av den vanliga kön och dess dispatch-spärr. Dessa är verifieringskrav, inte redan verifierade egenskaper.

## G6 – uppmätt efter rättning

Falska framgångar: 6/6 → 0/6 i samma harness. 80/80 tillgängliga tester passerar. Automatisk start och manuell återkontroll passerar den verkliga dispatchkoden till WAITING med ett enda simulerat utskick. Paus/fel i en worker stoppar inte den friska i de provade fallen. Explicit kvotåterhämtning provas separat; spärr från en oobserverad källa får inte lyftas av en frisk grannworker. [E203,E206]

Versionskontrollen visar faktisk körande motor och varnar vid blandning med panel/manifest. Paketets versionsfält och lokala beroenden är kontrollerade. [E202,E206,E207]

Den senare bilagans Extension context invalidated reproduceras i den äldre content-koden, 6/6. Livscykelskyddet i leveransen ger 0/6 med samma felinjektion och avregistrerar den döda anslutningen. Stackrad/källvisning är osamstämmiga, så bilagan bevisar inte ett nytt fel i overlay-funktionen. [E208,E209]

Kvarstående risk: testernas externa händelser är modellerade. Exakt inloggad ChatGPT-meny, Chrome-cache/omladdning och alla samtidighetsordningar är inte bevisade. Äldre frånkopplade processer utan konversations-ID återbinds inte genom en modellkontroll. [A201,A202,E201; `lib/restart-recovery.mjs`]
