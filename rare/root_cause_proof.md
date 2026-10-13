# G5 – rotorsaksbevis (före ändring)

**Rotorsak.** I ChatGPT:s nya modellmeny exponeras nivåannonsen "Extra hög, 4 av 4." i två DOM-noder som inte är nästlade. `ordinalControls()` i `lib/thinking-control.js` räknar varje nod som en egen nivåkontroll. Därför avbryter `maximize()` med `THINKING_CONTROL_AMBIGUOUS` (rad 339) innan den har läst att nivån redan är maximal. Bakgrunden lägger då en skyddsspärr på den sändande processen, och upprepningsskyddet gör spärren permanent.

## 1. Mekanism (kausal kedja)

1. Kön startar och processen går till `SENDING` med en initieringsprompt. Före sändning kräver bakgrunden ett kvitto på högsta nivå och skickar `EIC_GF_ENSURE_HIGHEST_THINKING`. [E303, E314]
2. Hovring visar bara en tooltip, så adaptern öppnar menyn med tangentbordet. [E302]
3. Menyn innehåller `Välj modell` (text "Extra hög"), `Prestanda` (tom text), annonsen och instruktionen som separata noder. [E302, E304]
4. Inga reglage finns (`sliders []`), så koden går in i ordinalgrenen. Där är rad 339 den enda vägen till AMBIGUOUS. [E302, E306]
5. `ordinalControls` hittar annonsen i två icke-nästlade element, så `length 2` ger `fail`. [E306, E307]
6. `holdForSafety` sätter `safety.hold`, och processen står kvar i `SENDING`. [E310, E314]
7. Var 30:e sekund görs en ny kontroll. Den ger samma `surfaceKey`, och adaptern returnerar då det sparade felet utan någon UI-åtgärd. Spärren blir alltså permanent. [E310]

## 2. Nödvändighet

Bara villkoret "andra exponeringen" bryts, med samma rigg, adapter och frön (variant `plain`): **0/10** AMBIGUOUS och 10/10 VERIFIED vid 4/4. N=10 ≥ 3/p_baslinje = 3/1.0. [E307]

## 3. Tillräcklighet

Villkoret tvingas fram: `describedby` ger **10/10** och `arialabel` ger **10/10** THINKING_CONTROL_AMBIGUOUS. Startnivån spelar ingen roll: 4/4 och 1/4 ger samma utfall. [E307, E308]

## 4. Förklaringskraft

- Felet är identiskt i båda fönstren och båda workers, eftersom det är deterministiskt för menyns struktur. [E303]
- Panelen visar "Extra hög" och vanlig modellkompatibilitet, men sändningen kräver det separata maximumkvittot. [E314]
- Spärren släpper aldrig. Den förklaras av upprepningsskyddet H306. [E310]
- Leveransens 80/80 tester passerade, eftersom testmodellen lägger annonsen inuti kontrollern och den inre-filtreringen då ger exakt en kandidat. [E309]
- Felet är inte sällsynt. Det är en BOH som har uppstått genom en ändring i ChatGPT:s gränssnitt (E304), och inte genom en kodändring i Greenfield.
- Fältets första `UNAVAILABLE` (PREFLIGHT) är kortvarig och omprövas, så den förklarar inte spärren. [E303]

## 5. Inga levande konkurrenter

H302, H303, H304 och H305 är falsifierade. H306 är en verifierad förstärkare inom samma kedja. [hypotheses.md]

**Öppet antagande A301:** om den andra exponeringen är `aria-describedby` eller `aria-label`. Båda ger samma mekanism. En åtgärd måste därför fungera för båda och får inte bero på A301.

**G5: PASSERAD** för den avgränsade mekanismen. Ingen påstådd liveverifiering. [A303]

## G6 – uppmätt efter åtgärd (1.9.13)

**Åtgärd** (`lib/thinking-control.js`): `ordinalControls()` = `collapseAnnouncement(ordinalCandidates())`. Kandidater med identiskt läge, maximum och nivå slås ihop till en kontroll endast om de leder till exakt **ett** tangentbordsmål som inte är själva menyn. Alla andra kombinationer är fortsatt tvetydiga. Vid fel loggas de råa kandidaterna (`ordinalCandidates` med `describedBy`), så att A301 kan avgöras vid nästa fältexport. `adapterVersion` 8 → 9, appversion 1.9.13, så att flikarnas sidkod byts ut (`background.js:662–676`).

**Blast radius:** tre interna anrop i samma fil (`effortSurface`, `SELECT_MAXIMUM`, `readOrdinal`). Inga andra moduler läser funktionerna. [E306, grep]

| Mätning | Före (1.9.12) | Efter (1.9.13) | Evidens |
|---|---|---|---|
| Fältmeny, `describedby`, 4/4 | 10/10 AMBIGUOUS | 0/10 | E316, E317 |
| Fältmeny, `arialabel`, 4/4 | 10/10 AMBIGUOUS | 0/10 | E316, E317 |
| Fältmeny, `describedby`/`arialabel`, 1/4 | 10/10 AMBIGUOUS | 0/10; 3 pilsteg på `Prestanda`, 0 navigeringsklick | E316, E317 |
| Två olika kontroller med identisk annons | – | 10/10 AMBIGUOUS (avsiktligt) | E318 |
| Riktig bakgrundsförkontroll + `submitPrompt` | hold `THINKING_CONTROL_AMBIGUOUS` | släppt, exakt ett utskick | E319 |
| Paketets tester | 80/80 | 86/86 (6 nya; 0/6 mot 1.9.12) | E319 |
| v1.9.0-sviten (740) | 611 pass | 611 pass, samma 129 fel | E320 |

N=10 per cell. Baslinjen p=1,0 kräver N ≥ 3, alltså ger N=10 marginal.

**Kvarstående risk:**
- A301: vilket attribut ChatGPT faktiskt använder. Åtgärden täcker båda varianterna.
- A302: variant `plain` från en lägre nivå ger fortfarande TIMEOUT. Felet är säkert (spärren behålls och inga felaktiga klick görs), och varianten motsäger fältet.
- A303: ingen livekörning i inloggad Chrome.
- Den kortvariga `THINKING_CONTROL_UNAVAILABLE` vid PREFLIGHT, 7–25 s efter start, är inte utredd. Den försenar starten med cirka 30 s men blockerar inte. [E303]
