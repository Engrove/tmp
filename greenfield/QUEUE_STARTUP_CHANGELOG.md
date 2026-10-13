# 1.9.11 — köuppstart och Thinking, 2026-10-13

Den gamla adaptern kunde tolka en namngiven navigationsknapp som ett nivåalternativ när kontrollen inte matchade role=slider eller input range. Testmodellen gav modellnavigation följd av timeout i 6/6 körningar. En annan reproducerad väg väntade på en etikettförändring trots att högsta alternativet redan var valt och etiketten återställdes först när menyn stängdes. [E101, E104]

## Ändrat

1. Läs numeriska ARIA-reglage även utan slider-roll. Exkludera uttryckliga progress-/meter-roller. [E102]
2. Läs annonserad position från text, aria-label, aria-valuetext eller aria-describedby, exempelvis Extra hög, 4 av 4. Position och antal måste vara entydiga och följa en känd tänkenivåetikett. [E102]
3. Höj med pilhändelser när det behövs. Omrenderade noder hämtas på nytt; utebliven ökning godtas inte. Numeriska reglage har pilreservväg när End inte stöds. [E102, E103]
4. Klicka inte en ensam namngiven knapp utan valstruktur. Behåll stöd för uttryckliga alternativlistor och otillgängliga högre alternativ. [E102, E103]
5. Verifiera redan högsta alternativ efter menyernas stängning, utan krav på ett nytt nivåbyte. Kräv konsekvent återläsning för annonserad maxnivå. [E102, E103, E104]
6. Lägg till ORDINAL_MAXIMUM som strategi i gemensam policy. Behåll modell-/nivåkrav, kvittots livslängd och kontrollen precis före sändning. [E102, E103]
7. Registrera kontrollattribut och nivåaktioner i befintlig diagnostik. Versionsmärk applikationen 1.9.11 och observationsadaptern 8. [E102, E106]

## Påverkansområde

Ändringen påverkar automatisk tänkenivåkontroll och dess kvitto, plus versions-/diagnostikmetadata. Lagringsformat, behörigheter, GFW-ID och schemapolicys ändras inte. Modellgolv, operatörsutkast och osäkra tidigare utskickseffekter går fortsatt genom befintliga kontroller. [E102, E103, E106]

Den senaste användarinstruktionen beställer uttryckligen kodrättning och applikationsleverans efter rapporten om ofullständig G5. Leveransen genomför detta utan att ändra evidensgränsen: mekanismerna är bevisade i testmodeller, inte som unik rotorsak till samtliga fälthändelser. [E101, E104, A101]
