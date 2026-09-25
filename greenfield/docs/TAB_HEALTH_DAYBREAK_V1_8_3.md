# Flikhälsa och Daybreak-hantering i Greenfield 1.8.3

Operatörsrapporter (2026-09-25):

- **Vit ruta.** Chrome visar ibland bara vitt i innehållsfönstret, och då syns inte heller overlayen. Det enda som hjälper är att klistra in URL:en igen.
- **Halvladdat gränssnitt.** ChatGPT renderar ibland gränssnittet ofullständigt, till exempel utan inmatningsfält. Greenfield stod då i SENDING med spärren `THINKING_MODE_UNVERIFIED`.
- **Daybreak.** ChatGPT visar ibland ett spärrkort i sidan: ”This content can't be shown … apply for Daybreak” eller ”Det här innehållet kan inte visas … Daybreak”. Efter det fungerar sessionen inte normalt. Det som hjälper är att rotera samma GFW till en ny chatt.

Operatörsbeslut:
- Daybreak roterar vid första spärren.
- Upprepas spärren inom 24 h pausas GFW:n i 2 h, sedan 6 h, sedan 24 h. Räknaren nollställs efter 24 h utan spärr.
- Platsen blir **aldrig** BLOCKED.
- Omfånget är både Daybreak och flikhälsa.

## Varför Greenfield frös med fliken (fakta i koden fram till 1.8.2)

1. Anropen till innehållsskriptet (`chrome.tabs.sendMessage`) saknade tidsgräns. Chromes dokumentation säger inget om timeout.
2. Tickar körs seriellt per process, och watchdog-larmet köade nya tickar bakom en tick som hängde.
3. Varje fasövergång väntar in `broadcast` → `syncOverlay` → ett meddelande till samma flik.
4. F5-stegen körs bara i WAITING, och en säkerhetsspärr i SENDING laddar aldrig om sidan.

## 1. Tidsgränser (`lib/tab-health.mjs` TAB_HEALTH)

| Anrop | Deadline | Vid timeout |
|---|---|---|
| Sidtillstånd, ping, starta, rotation, panel | 15 s | `CONTENT_BRIDGE_TIMEOUT` → DETACHED → återhämtningsstege |
| Overlay | 5 s | ignoreras, så att fasövergången inte blockeras |
| Injektion av innehållsskriptet | 20 s | fel |
| Utskick av prompt | 90 s | okänd effekt; den befintliga dispatch-avstämningen tar över |
| Preflight vid rate-limit | 60 s | ”RELOAD_REQUIRED” enligt befintlig väg |

## 2. Detektorer

| Villkor | Källa | Gäller |
|---|---|---|
| `BRIDGE_UNRESPONSIVE` | 15 s utan svar från sidan | alla faser |
| `BRIDGE_MISSING` | ”Receiving end does not exist” | alla faser |
| `TAB_DISCARDED` | `tab.discarded` | alla faser |
| `RENDER_STALLED` | Sidan har varit synlig i minst 45 s och en begärd bildruta har inte kommit på minst 45 s | SENDING, WAITING |
| `COMPOSER_MISSING` | Inget inmatningsfält | SENDING |
| `THREAD_MISSING` | URL `/c/<id>` men inga turer | SENDING, WAITING |

Renderingssonden begär en enda bildruta var 10:e sekund, och bara när sidan är synlig. Chrome ritar inte dolda sidor, så en dold sida bedöms aldrig. En flik som Chrome frusit (`tab.frozen`, Chrome 132+) avvaktas utan åtgärd. Greenfields flikar markeras med `autoDiscardable: false`.

## 3. Återhämtningsstege

1. **Återinjicera bryggan.** Bara vid `BRIDGE_MISSING`, eftersom sidan då lever.
2. **F5**, sedan **Ctrl-F5**.
3. **Samma URL** (`tabs.update`). Det är den programmatiska motsvarigheten till att klistra in adressen. Att det fungerar likadant är inte bevisat.
4. **Ny flik** med samma konversation i samma fönster, och den gamla stängs. Det ger garanterat en ny renderare. Processen binds om av den befintliga regeln i DETACHED: exakt en ChatGPT-flik i fönstret.
5. **Ge upp.** Samma GFW roteras till ny chatt, `TAB_HEALTH_RECOVERY_EXHAUSTED`.

**Takt och budget:** gränssnittsvillkor måste bestå i 90 s innan första steget. Mellan stegen går minst 45 s. Högst 5 åtgärder per timme och process; därefter väntar processen och du ser läget.

**Utskick pågår:** inget steg för gränssnittsvillkor tas medan ett utskick har okänd effekt.

**Hängd tick:** om en tick trots tidsgränserna hänger i mer än 3 min laddar watchdog-larmet om fliken. Det sker högst var 5:e minut och bara i faserna WAITING, SENDING, DETACHED, RECOVERING och ROTATING, aldrig under ett pågående utskick. Samtidigt köas inga fler tickar bakom den.

## 4. ChatGPT-spärr (Daybreak)

**Igenkänning** (`content.js`): kortet ligger utanför alla meddelandeturer och innehåller ”Daybreak” plus rubriken (engelska eller svenska) eller ett cybersäkerhetsord (engelska, svenska eller finska). Text om Daybreak inuti ett EIC-svar eller i en operatörsprompt räknas aldrig. Kortet måste ligga efter Greenfields egen tur, ChatGPT får inte längre generera, och kortet måste synas vid två avläsningar minst 3 s isär.

**Åtgärd** (`lib/provider-notice.mjs`):
- **Första spärren:** samma GFW roteras till ny chatt med FULL-prompt, `previousDisposition=PROVIDER_CONTENT_BLOCKED` och `sourceResponseState=PROMPT_BLOCKED_BY_PROVIDER`. Målet citerar kortet och säger:
  - effekterna är okända och ägarens tillstånd ska läsas om;
  - samma begäran ska inte skickas igen ordagrant;
  - kräver målet det spärrade innehållet ska EIC svara BLOCKED eller välja ett annat paket.
- **Upprepning inom 24 h:** platsen pausas med schemaläggarens paus-till (`updatedBy: GREENFIELD`, synlig under Schema) och kön går vidare. Utan annan körbar plats går kön till `QUEUE_WAIT`. Status förblir READY, och GFW:n återupptas i ny chatt när pausen är slut. Utanför kö hålls utskicket med `PROVIDER_CONTENT_BLOCK_PAUSE`.
- **Kvant:** den spärrade turen räknas inte.
- **Lärandekontroll:** keypoint `POST_FAILURE` vid spärr, och `RECURRING` vid upprepning.
- **Aldrig:** Greenfield klickar inte på ”Learn more” eller ansökningslänken.

## Verifiering

- **Node:** `tests/v183-tab-health-daybreak.test.mjs` 10/10. Omfattar:
  - villkor och stege;
  - pausserien 2/6/24 h;
  - lärandekontrollen;
  - E2E för hängd sida (F5, sedan Ctrl-F5, sedan återhämtad);
  - saknat inmatningsfält (90 s, och aldrig under utskick);
  - Daybreak-rotation;
  - Daybreak-paus i kö (READY, cirka 2 h, kön går vidare);
  - ny flik med ombindning i samma konversation;
  - räddning av hängd tick.
- **Riktig DOM:** `tools/verify-content-health.mjs` (Playwright/Chromium) 9/9. Omfattar:
  - engelskt och svenskt kort;
  - inga träffar i EIC-svar eller operatörsbubbla;
  - saknat inmatningsfält;
  - ingen bildruta på 70 s (`frameGapMs` 59 990 i sparad körning) mot en sida som ritas (6 ms).

  Resultatet finns i `verification/v183-content-dom-check.json`.

## Gränser

- **Grafikfel:** en vit ruta där sidans skript kör och bildrutor ritas men skärmen ändå är vit syns inte utan skärmbild. Det kräver behörigheten `<all_urls>` eller `activeTab`, som inte har lagts till.
- **Hela Chrome fryser:** då kan ett tillägg inte göra något.
- **Ny flik:** ombindningen kräver att det bara finns en ChatGPT-flik i workerns fönster. Annars sker session-rotation efter 6 försök, som tidigare.
- **Finska:** rubriken på finska är okänd. Igenkänningen bygger där på ”Daybreak” plus cybersäkerhetsordet.
- **Live:** ingen live-acceptans i Chrome/ChatGPT är gjord.
