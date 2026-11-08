# G2 – konkurrerande hypoteser före experiment

| ID | Konjunktion och mekanism | Falsifierande förutsägelse / experiment | Status |
| --- | --- | --- | --- |
| H201 | Ny panel ∧ gammal körande motor ∧ gammal Thinking-adapter ger tidigare menyfel | runtime-version är ny i diagnostiken, eller samma menytext godkänns av gamla adaptern; jämför versioner och baseline-adapter | LEVER [E201,E202] |
| H202 | Manuell kontroll ∧ vanligt modellgodkännande ∧ inget maximumkvitto rapporterar framgång utan färdig kontroll | verklig panelhandler anropar maximeringen och kräver kvitto före framgång; instrumentera verklig funktion | LEVER |
| H203 | Schemapaus/kvot/kapacitetskö ∧ uppstart blockerar processen efter godkänd modell | global paus/kvot/kö saknas och initiering är osänd; loggprojektion och kontrollerat experiment | LEVER |
| H204 | Saknad flik i annan worker ∧ global manuell kontroll avbryter hela batchen | frisk worker kontrolleras och väcks även om första fliken saknas; injicera ett enda tab-fel | LEVER, separat möjligt fel |

H201 innehåller en orsak utanför programmets egen källkod: Chrome kan köra en äldre inläst kodgeneration. Exakt hur blandningen uppstod är ännu inte bevisat. [A202]

## Efter experimenten

- H202 är bevisad för den deterministiska falska framgången: 6/6 före, 0/6 efter rättningen. [E203,E206]
- H201 är verifierat miljövillkor. Installationsorsaken är öppen. Samma handlerfel finns även i 1.9.11, så versionsskillnaden ersätter inte H202. [E201,E202,E203,A202]
- H203 är falsifierad som förklaring till den reproducerade falska framgången; de globala spärrarna finns inte i fältloggen. [E201,E203]
- H204 är ett separat deterministiskt fel i batchens felisolering. Det är inte belagt som just denna fältkörnings blockerare; historiska DETACHED-poster är inte bevis på live-bindningar. [E204,E206]

G0 avslutar RARE för dessa deterministiska kodfel. G4/G5 för hela användarmiljön markeras inte som uppfyllda: A201/A202 kvarstår.

## Senare bilaga: invaliderad kontext

Tre förklaringar jämfördes: fel i aktuell overlay-sträng, synkront API-kast från äldre dirty-callback, eller asynkront API-kast från aktuell callback. Strängraden innehåller inget Chrome-API; den äldre callbacken reproducerar exakt feltexten i 6/6 försök och den nya hanterar samma kast i 6/6. Exakt ålder på Chrome-felposten är fortfarande okänd. [E208,E209,A202]
