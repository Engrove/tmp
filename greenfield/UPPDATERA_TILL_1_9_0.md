# Uppdatera Greenfield 1.8.14 → 1.9.0

1. Säkerhetskopiera tilläggsmappen och spara aktiv kö som kö-set.
2. Packa upp `EIC_Autonom_Agent_Greenfield_v1.9.0.zip` och kopiera innehållet över **samma mapp** som Chrome redan använder. Då behålls extension-ID, köerna, reservationen och fönstrens worker-bindning.
3. I `chrome://extensions`: välj **Läs in igen**. Panelen ska visa `Greenfield v1.9.0`.
4. Två saker ändras när du läser in igen:
   - **Arbetsläge slås på.** Det gäller även om du tidigare hade stängt av det. Se avsnitt 3.
   - **Varm återupptagning är på.** En ny inställning med standardvärde på. Se avsnitt 1.

   Inga andra inställningar ändras.

Version 1.9.0 innehåller tre delar:

- en parkerad GFW fortsätter i sin egen chatt;
- panelen skriver inte längre över det du håller på att ändra;
- Arbetsläge är påslaget vid start.

## 1. Varm återupptagning: GFW:n fortsätter i sin egen chatt

### Så var det i 1.8.14

Varje gång en parkerad GFW fick tur i kön igen öppnades en **ny** ChatGPT-chatt och en **FULL** prompt skickades. Det gällde efter en fullbordad kvant, efter YIELD, PAUSE eller SLEEP, och när ett schemafönster stängdes. Diagnostiken 2026-10-05 visade två följder:

- FULL-prompterna stod för 94 % av alla skickade tokens;
- 58–88 nya chattar öppnades per dygn.

### Så är det nu

GFW:n går tillbaka till **sin egen konversation**, som den lämnade, och fortsätter där.

**Promptprofil.** Den följer samma regler som inom en pågående körning sedan 1.7.7:
- en kort prompt (COMPACT) när konversationen och uppdragstexten är desamma;
- FULL var tionde prompt;
- FULL när uppdragstexten har ändrats under parkeringen;
- FULL vid minsta tvivel om identiteten.

**Vad prompten säger.** GFW:n parkerades medan andra köplatser körde. Dess tidigare turer i chatten är dess egen kontext. Owner-state kan ha ändrats, så den ska läsas om innan något görs, och avklarat arbete ska inte göras om.

**Varm återupptagning planeras bara när allt detta gäller:**

- Den parkerade GFW:ns senaste prompt besvarades och svaret fångades färdigt.
- Parkeringen var ett vanligt köbyte:
  - kvanten fullbordad;
  - YIELD, PAUSE eller SLEEP;
  - schemafönster stängt eller pausat;
  - köparkering.

  Inte efter ett svar som aldrig blev klart (köbytet vid 120 min), Daybreak, en sidhälsorotation eller **Gå till nästa uppgift i kön**.
- AI:n begärde inte ny chatt (`ROTATE_SESSION_NOW`) i sitt senaste svar.
- Konversationens adress är känd och entydig.
- Ingen annan GFW har svarat i samma konversation, så två köplatser delar aldrig chatt.
- Chatten har färre än 10 Greenfield-prompter.
- Det har gått högst 24 timmar sedan GFW:n lämnade chatten.

I alla andra fall används den kalla vägen från 1.8.14: ny chatt och FULL.

### Kontrollen på sidan innan något skickas

Greenfield öppnar konversationen och kontrollerar fem saker. Inget skickas förrän alla stämmer.

- **Rätt konversation.** Sidan visar just den konversationen och inte en omdirigering.
- **Tråden har laddats.**
- **Inget svar pågår.**
- **Inmatningen är klar och tom.** Ett utkast som någon har lämnat i rutan räknas inte som tomt.
- **Ingen har skrivit i chatten sedan.** Det senaste användarmeddelandet är GFW:ns egen förra prompt.

Om något inte stämmer överges den varma vägen, till exempel:

- en raderad chatt som leder någon annanstans (efter 15 s);
- du har själv skrivit i chatten;
- sidan blir inte klar inom 90 s.

Då öppnas en ny chatt med FULL prompt som i 1.8.14. Ingenting skickas i den gamla chatten. Den vanliga modellkontrollen gäller som förut före varje utskick.

### Inställning

Fliken **Uppdrag**, under Grundparametrar: **Fortsätt i GFW:ns egen chatt när den kommer tillbaka i kön (varm återupptagning)**. Avkryssad och sparad ger samma beteende som 1.8.14.

### Var det syns

Händelseloggen i diagnostiken:

- `QUEUE_ITEM_ACTIVATED` visar beslutet (`warmResume`: warm eller cold med skäl, till exempel `CHAT_PROMPT_CAP_REACHED`) och promptprofilen.
- `WARM_RESUME_READY` visar att konversationen bekräftades på sidan.
- `WARM_RESUME_ABANDONED` visar varför den varma vägen övergavs, till exempel `CONVERSATION_NOT_SHOWN` eller `CONVERSATION_CONTINUED_ELSEWHERE`.

## 2. Panelen skriver inte över det du håller på med

### Felet

Panelen ritas om var 5:e sekund, vid varje ändring i lagringen och vid varje processhändelse. Med flera aktiva fönster blir det flera gånger per sekund. Varje omritning gjorde tre saker:

- skrev de sparade värdena tillbaka i fälten;
- byggde om kölistans rader;
- byggde om listorna med sparade uppdrag och kö-set.

Följden:

- en kryssruta som du just klickat i hoppade tillbaka;
- en siffra som du skrev ersattes;
- en öppen dropdown stängdes eller byttes under markören;
- ett ej skickat instruktionsutkast raderades.

I Chromium-kontrollen underkändes 1.8.14 på 9 av 12 punkter. 1.9.0 klarar alla 12.

### Så är det nu

- **Ändrade fält behålls.** Ett fält du har ändrat men inte sparat behåller ditt värde. Det markeras med **streckad gul ram** så länge det skiljer sig från det sparade värdet.
- **Spara.** När du sparar (**Spara grundparametrar**, **Spara Arbetsläge**) försvinner markeringen. Fälten visar då det sparade värdet, som bakgrunden kan ha justerat inom tillåtna gränser.
- **Misslyckad sparning.** Dina värden står kvar, markerade, så att du kan försöka igen.
- **Fält under markören.** Ett fält där markören står skrivs aldrig över.
- **Kölistan byggs inte om medan markören står i ett fält i en köplats.** Det gäller till exempel en öppen prioritetslista eller en siffra du skriver. När ändringen har verkställts visas raden direkt, och markören står kvar i samma fält.

  Observera: så länge markören står i ett köplatsfält uppdateras listans status inte. Den uppdateras när du lämnar fältet.
- **Dropdowns.** Listorna med sparade uppdrag och kö-set byggs bara om när innehållet faktiskt har ändrats, och aldrig medan de är öppna.
- **Instruktionsutkast.** Ett utkast till tilläggsinstruktion står kvar, markerat, tills du väljer **Lägg till** eller **Rensa**.
- **Ändringar från andra fönster.** Ett värde som ett annat fönster har sparat visas så snart fältet inte är ändrat och inte har markören.

## 3. Arbetsläge är på vid start

### Så är det nu

**Aktivera Arbetsläge** slås på varje gång Chrome startar profilen och när tillägget installeras, uppdateras eller läses in igen. Stänger du av det i panelen gäller det tills nästa start. En väckning av tilläggets bakgrund slår inte på det.

**Ansvarig worker.** Uppgiftshämtningen görs av **en** worker:

- Den sparade ansvariga workern behåller rollen så länge den kör.
- Om den inte längre finns tar en körande worker över rollen, sparar det och hämtar.

  Exempel: fönstret har stängts, eller workern återställdes inte efter en omstart av Chrome. I 1.8.14 blev Arbetsläge då stående på utan att något hämtades.
- Ska rollen tas över och det fönster som har den reserverade platsen (1.8.12) kör, är det det fönstret som tar rollen.

### Var det syns

Händelseloggen i diagnostiken visar:

- `WORK_MODE_ENABLED_AT_STARTUP` (`startup` eller `installed`);
- `WORK_MODE_SUPERVISOR_CLAIMED` (`NO_SUPERVISOR` eller `SUPERVISOR_NOT_LIVE`).

### Gräns

Uppgifter hämtas som förut under en körande GFW:s tick. Är ingen GFW igång hämtas inget, även om Arbetsläge är på.

## Gränser

- **Live-Chrome och live-ChatGPT är inte verifierade** i denna leverans.
  - Den varma vägen är prövad mot Greenfields riktiga bakgrundskod i testmiljön, med syntetiska sidor. Den är inte prövad mot ChatGPT:s verkliga beteende i långa trådar, till exempel hur snabbt en lång tråd laddas eller om modellväljaren är densamma när en äldre chatt öppnas.
  - Kontrollerna ovan stoppar utskicket i stället för att gissa. Det värsta som kan hända är att GFW:n fortsätter i ny chatt med FULL prompt, som i 1.8.14.
- **Besparingen är inte uppmätt i drift.** I testet var den korta prompten under hälften av den fulla. Siffrorna från 2026-10-05 beskriver hur det var före ändringen.
- **Längre chattar.** En chatt kan nu bära upp till 9 Greenfield-prompter innan taket ger ny chatt. Långa trådar kan bli långsammare i ChatGPT.
- **Panelen är verifierad i Chromium** med den riktiga panelkoden och en simulerad bakgrund (`tools/verify-panel-edit-guard.mjs`). Den är inte verifierad i det installerade tillägget.
- **Arbetsläge** är verifierat mot bakgrundskoden med en lokal ersättning för nätverket. Att EIC:s endpoint svarar är inte verifierat.
