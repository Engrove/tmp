# Uppdatera Greenfield 1.9.1 → 1.9.2

1. Säkerhetskopiera tilläggsmappen.
2. Packa upp `EIC_Autonom_Agent_Greenfield_v1.9.2.zip` och kopiera innehållet över **samma mapp** som Chrome redan använder. Då behålls extension-ID och all lokal state. De driftinställningar du har sparat tidigare kopieras till bokmärkesvalvet vid första start (se avsnitt 3).
3. I `chrome://extensions`: välj **Läs in igen**. En omstart av Chrome räcker inte; se steg 3 i [UPPDATERA_TILL_1_9_1.md](UPPDATERA_TILL_1_9_1.md).
4. Panelen ska visa `Greenfield v1.9.2`. Två rader börjar med **Bokmärkesvalv (driftinställningar):**:
   - under **Drift**, vid Max parallella;
   - under **Uppdragskö → Grundparametrar för uppdragskö**.

   Raden **Bokmärkesvalv:** under Drift → Körkrav finns kvar som förut.

Version 1.9.2 lägger driftinställningarna i samma bokmärkesvalv som körkraven fick i 1.9.1.

## 1. Vad som följer med till en ny installationsmapp

**Sedan 1.9.1:** körkraven.

**Nytt i 1.9.2:**

| Inställning | Var i panelen |
|---|---|
| Paus mellan analys och post | Drift |
| Max parallella Greenfield | Drift |
| Standard max interaktioner per uppdrag/kvant | Uppdragskö → Grundparametrar |
| Cooldown före nytt försök för blockerad GFW | Uppdragskö → Grundparametrar |
| Minsta paus före nästa uppdrags navigation | Uppdragskö → Grundparametrar |
| Ctrl-F5/hård reload efter navigation | Uppdragskö → Grundparametrar |
| Stabilisering efter hård reload | Uppdragskö → Grundparametrar |
| Varm återupptagning | Uppdragskö → Grundparametrar |

**Följer inte med, med avsikt:**

- **Reserverad plats och Arbetslägets ansvariga worker.** De pekar på Chrome-fönster i just den installationen och betyder inget i en annan.
- **Arbetsläge på/av.** Det slås på vid varje start sedan 1.9.0.
- **Arbetslägets adress.** Den har inte begärts i valvet.
- **Sparade uppdrag och kö-set.** De har egna valv sedan tidigare.
- **Processer, köer och förbrukningshistorik.** Flytta dem med **Exportera/Importera säkerhetskopia**.

## 2. Så fungerar det

Driftinställningarna ligger i samma bokmärkesmapp som körkraven, **EIC Greenfield · Run requirements v1**. De har en egen post, så att spara det ena rör aldrig det andra.

**Varje inställning har sin egen sparningstid.** För varje inställning gäller den senast sparade versionen i Chrome-profilen.
- Bara en inställning du faktiskt ändrar räknas som sparad. Ett oförändrat värde som skickas med räknas inte.
- Panelen skickar bara de grundparametrar du ändrat. Ett värde som formuläret fortfarande visar sedan tidigare kan därför inte skriva över ett nyare.
- Sparar du en enda inställning kan de sju andra aldrig skrivas över med standardvärden eller äldre värden.

**Spara.** Alla tre sparvägarna går via tilläggets bakgrund:
- reglaget Paus mellan analys och post;
- reglaget Max parallella;
- knappen Spara grundparametrar.

Bakgrunden gör en sparning i tre steg:
1. Den stämmer av installationen mot valvet, så att nyare värden från andra installationer tas in.
2. Den sparar ändringen i installationen och stämplar bara de inställningar du ändrade. Tiden blir aldrig äldre än den inställningens kända tid, även om en annan dators klocka gick före. Din senaste ändring vinner alltså alltid.
3. Den stämmer av igen i båda riktningar, inställning för inställning:
   - nyare värden i valvet tas in i installationen;
   - nyare värden i installationen skrivs till valvet: först till en mellanmapp, sedan läses de tillbaka och jämförs, och först därefter ersätts den gamla posten.

**Vid start** (en gång per Chrome-session och efter **Läs in igen**) och direkt efter en import av säkerhetskopia görs samma avstämning:

| Läge | Vad Greenfield gör |
|---|---|
| Ny installationsmapp (nytt ID) och valvet har driftinställningar | Valvets värden tas i bruk, även för schemaläggaren (Max parallella). Incidentloggen visar `DRIFT_SETTINGS_RESTORED`. |
| En inställning är nyare i valvet | Valvets värde tas i bruk för den inställningen. |
| En inställning är nyare i installationen | Valvet uppdateras för den inställningen. |
| Värden från 1.9.1 eller äldre och tomt valv | Värdena kopieras till valvet, om något skiljer sig från standard. De räknas som äldre än varje sparning i 1.9.2. |
| Värden från 1.9.1 eller äldre och valvet har värden | För varje inställning gäller en sparning i 1.9.2 framför ett äldre värde. Ett äldre värde som skiljer sig från standard gäller framför ett standardvärde som en annan installation bara fört med sig. |
| Standardvärden som aldrig sparats och tomt valv | Inget görs. |

Avstämningarna körs en i taget. Om bokmärkes-API:t inte svarar inom 8 s får anroparen ett fel, men nästa avstämning väntar ändå tills den förra verkligen har slutat. En äldre avstämning kan därför aldrig skriva över en nyare.

En pågående tur behåller det den redan har tagit, alltså dess promptpaus och dess köbyte, precis som när du sparar under drift. Nästa tur använder de nya värdena.

**Ett fel i bokmärkena stoppar aldrig Greenfield.**
- Svarar bokmärkes-API:t inte inom 8 s, eller ger det fel, startar Greenfield med installationens egna värden. Raden visar felet.
- Lyckas inte valvet vid en sparning är värdena ändå sparade i installationen. Valvet stäms av vid nästa start eller sparning, och då går inget av valvets andra värden förlorat.
- En skadad, ofullständig eller ogiltig valvpost används aldrig. Det gäller till exempel ett värde utanför panelens gränser eller en saknad sparningstid. Posten räknas då som saknad.

**En skrivare åt gången.** Inställningsposten skrivs av tilläggets bakgrund och av sidopanelen, som synkar sparade uppdrag. Panel och bakgrund är olika JavaScript-kontexter. I 1.9.2 tar varje skrivare samma lås via Chromes Web Locks, som delas av panel och bakgrund (kontrollerat i Chromium 141). Skrivaren läser posten på nytt inne i låset. Arbetslägets påslagning vid start, adoptionen från valvet och panelens synk av sparade uppdrag kan därför inte skriva tillbaka varandras gamla värden.

**Raden "Bokmärkesvalv (driftinställningar):":**

| Text | Betydelse |
|---|---|
| sparade … | Valvet har just skrivits. |
| N värde(n) hämtade från valvet … | Installationen tog så många värden från valvet. Raden står kvar så länge Chrome-sessionen varar. |
| hämtade från valvet och stämmer med det … | Värdena kom från valvet vid en tidigare start, i en tidigare Chrome-session eller före **Läs in igen**, och installationen och valvet stämmer nu. Gäller tills du sparar en driftinställning. |
| stämmer med valvet … | Installationen och valvet har samma värden. |
| inget giltigt sparat värde … | Valvet saknar driftinställningar. Spara en gång. |
| kunde inte läsas eller uppdateras … | Valvet kunde inte användas. Sparade värden gäller i installationen tills det lyckas. |
| inte tillgängligt … | Bokmärkes-API:t saknas. Värdena gäller bara denna installation. |
| kontrolleras vid start … | Bakgrunden har ännu inte stämt av i denna start. |

## 3. Gränser

- **Driftinställningar sparade i 1.9.1 eller äldre, i en mapp du inte längre använder,** finns inte i valvet. Uppdatera den gamla mappen på plats (steg 2–3 ovan), eller ställ in värdena en gång och spara.
- **Säkerhetskopia:** varje driftinställning behåller det senast sparade av installationens och kopians värde. Därefter stäms de av mot valvet, och det som är nyare i valvet vinner. Importmeddelandet säger det.
- **Samma Chrome-session:** startar en installation om sin bakgrund i samma Chrome-session används det redan avstämda resultatet, och bokmärkena läses inte igen. Har en annan installation sparat under tiden tas dess värden in vid nästa sparning eller nästa start av Chrome.
- **Chrome Sync:** är bokmärkessynk påslagen följer mappen med till andra datorer i samma Chrome-konto.
  - Möts två kopior tas varje inställning från den kopia som sparade den senast. Vid lika tid avgör värdet, så att alla datorer väljer samma.
  - Kopiorna skrivs sedan tillbaka som en.
  - Sparningstiderna fungerar som en logisk klocka. En sparning blir alltid senare än den senaste tid installationen har sett för inställningen, även om en annan dators klocka gick dagar före. En klocka som går fel kan alltså aldrig låsa ett värde.

## 4. Kontroller i leveransen

- `node --test tests/v192-drift-settings-vault.test.mjs`: 26 tester. De täcker:
  - sektionerna och att de inte påverkar varandra;
  - avvisade poster;
  - sammanslagningen per inställning och stämplingen;
  - låset, både vid start och mot panelens synk av sparade uppdrag;
  - de tre sparvägarna;
  - ny mapp, uppgradering på plats, två mappar och skrivfel;
  - de fall som granskningen reproducerade: ofullständig avstämning, nyare valv mitt i sessionen, panelens synk av sparade uppdrag, två äldre installationer, en klocka som går före (också dagar före), inaktuella formulärvärden och kön vid timeout;
  - två kopior via Chrome Sync;
  - säkerhetskopia;
  - avsändarkontrollen och ett trasigt bokmärkes-API.
- Hela sviten: `npm test`.
- Chromium (Playwright, riktig Chrome-profil, oförändrat tillägg), `tools/verify-drift-settings-vault.mjs`. Alla åtta värden ställs in med panelens egna kontroller.
  - **Ny mapp:** spara i mapp A, ladda mapp B → återställt i lagringen, i kontrollerna och i schemaläggarens kapacitet.
  - **Negativ kontroll:** samma steg med 1.9.1 → standardvärden.
  - **Uppdatering på plats:** 1.9.1-värden, **Läs in igen**, sedan ny mapp → värdena följde med.

  Resultaten finns i `verification/v192-*.json`.
