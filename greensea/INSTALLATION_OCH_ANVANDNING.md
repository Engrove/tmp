# GreenSea 0.1.0: installation och användning

GreenSea är en Linux-tjänst skriven i Python. Den driver ett uppdrag självständigt över många prompter mot din lokala `llama-server` (llama.cpp) och har ett eget webbgränssnitt. Den här guiden tar dig från zip-filen till ett körande uppdrag och beskriver sedan drift, API och felsökning.

Innehåll:

1. [Paketets innehåll](#1-paketets-innehåll)
2. [Förutsättningar](#2-förutsättningar)
3. [Installation som systemd-tjänst](#3-installation-som-systemd-tjänst)
4. [Nå webbgränssnittet](#4-nå-webbgränssnittet)
5. [Ditt första uppdrag](#5-ditt-första-uppdrag)
6. [Användning i detalj](#6-användning-i-detalj)
7. [Inställningar](#7-inställningar)
8. [API för skript](#8-api-för-skript)
9. [Drift: logg, säkerhetskopia, uppgradering, avinstallation](#9-drift-logg-säkerhetskopia-uppgradering-avinstallation)
10. [Felsökning](#10-felsökning)
11. [Installation utan internet på servern](#11-installation-utan-internet-på-servern)
12. [Köra utan systemd och köra testerna](#12-köra-utan-systemd-och-köra-testerna)

---

## 1. Paketets innehåll

```
GreenSea_v0.1.0.zip
└── greensea-0.1.0/
    ├── INSTALLATION_OCH_ANVANDNING.md   den här guiden
    ├── README.md                        översikt
    ├── pyproject.toml                   Python-paketet (beroende: aiohttp)
    ├── greensea/                        programkoden + webbgränssnittet (static/)
    ├── deploy/
    │   ├── install.sh                   installerar/uppgraderar tjänsten
    │   ├── build-dist.sh                bygger zip-paketet från git (för utvecklare)
    │   ├── greensea.service             systemd-unit (härdad)
    │   └── greensea.toml.example        exempelkonfiguration
    ├── docs/DESIGN.md                   arkitektur och analys (Greenfield → GreenSea)
    ├── docs/screenshots/                skärmdumpar
    └── tests/                           42 automatiska tester
```

Kontrollsumman ligger i `GreenSea_v0.1.0.zip.sha256`.

## 2. Förutsättningar

### 2.1 Servern

- Linux med systemd, till exempel Debian 12 eller Ubuntu 22.04/24.04.
- **Python 3.11 eller senare** med `venv`. Kontrollera med `python3 --version`.
  - Debian 12 har 3.11 och Ubuntu 24.04 har 3.12.
  - Ubuntu 22.04 har 3.10, vilket är för gammalt. Installera då `python3.11` och `python3.11-venv` och kör `install.sh` med `PYTHON=python3.11` (se 3.2).
- Paket: `sudo apt install -y python3 python3-venv unzip`.
- Internetåtkomst till PyPI under installationen, för `aiohttp`. Utan internet, se [avsnitt 11](#11-installation-utan-internet-på-servern).

### 2.2 llama-server

GreenSea förutsätter en fungerande `llama-server` och pratar med den över HTTP. Ett exempel:

```bash
llama-server -m /models/din-modell.gguf -c 32768 -np 2 --host 127.0.0.1 --port 8080
```

| Flagga | Betydelse för GreenSea |
|---|---|
| `-c 32768 -np 2` | Total kontext och antal parallella slots. När `-np` anges explicit får varje slot `-c / -np`, här 16 384 tokens. GreenSea läser värdet per slot från `/props`. |
| `-np` utelämnad | llama-server väljer slots automatiskt och slår då på delad KV-cache (`-kvu`). Varje slot rapporterar hela kontexten, men parallella slots delar samma minne. Ange hellre `-np`, eller sätt `n_ctx` i GreenSea (avsnitt 7). |
| `--api-key NYCKEL` | Valfri. Samma nyckel anges då i GreenSea (`[llama] api_key`). |
| `--jinja` | Standard i aktuella byggen; behövs för modellens chattmall. |

**Kontextstorlek:** minst **8 192 tokens per slot** rekommenderas, gärna 16 384–32 768. Skälet:
- GreenSeas kontrakt är cirka 1 000–1 200 tokens plus uppdragstexten;
- svaret reserverar `max_tokens` (standard 2 048);
- en ny session behöver plats för checkpointen.

Räkneexempel med GreenSeas egen budgetfunktion och ett uppdrag på 1 200 tecken (kontrakt + uppdrag ≈ 1 850 tokens, försiktigt uppskattat):

| Kontext per slot | `max_tokens` | Plats för checkpoint |
|---|---|---|
| 4 096 | 1 024 | 0 tokens (räcker inte för långa sessioner) |
| 8 192 | 2 048 | ≈ 1 850 tokens |
| 8 192 | 1 024 | ≈ 2 870 tokens |
| 16 384 | 2 048 | ≈ 5 730 tokens |

4 096 tokens per slot räcker alltså inte. Utan checkpoint förlorar en ny session sitt minne av vad som gjorts.

**Modell:** en instruktionstränad modell som följer instruktioner väl. GreenSea kräver JSON-svar och använder llama-serverns grammatikbundna JSON (`response_format`), så formatet tvingas fram. Kvaliteten i innehållet avgörs ändå av modellen. Testa med ett kort uppdrag först (avsnitt 5).

Kontrollera att llama-server svarar:

```bash
curl -s http://127.0.0.1:8080/health                      # {"status":"ok"}
curl -s http://127.0.0.1:8080/props | python3 -c \
  'import json,sys; p=json.load(sys.stdin); print("n_ctx per slot:", p["default_generation_settings"]["n_ctx"], "slots:", p["total_slots"])'
```

## 3. Installation som systemd-tjänst

### 3.1 Packa upp och kontrollera

```bash
sha256sum -c GreenSea_v0.1.0.zip.sha256      # GreenSea_v0.1.0.zip: OK
unzip GreenSea_v0.1.0.zip
cd greensea-0.1.0
```

### 3.2 Installera

```bash
sudo bash deploy/install.sh
# Med en annan Python-tolk:  sudo PYTHON=python3.11 bash deploy/install.sh
```

Skriptet gör följande, och kan köras igen vid uppgradering:

1. Kontrollerar Python ≥ 3.11.
2. Skapar systemanvändaren `greensea`.
3. Kopierar koden till `/opt/greensea/src` och installerar den i `/opt/greensea/venv` (hämtar `aiohttp` från PyPI).
4. Skapar `/etc/greensea/greensea.toml` från exemplet med ett **nytt slumpat inloggningstoken**, som skrivs ut en gång. Finns filen redan behålls den orörd.
5. Validerar konfigurationen (`greensea --check`).
6. Installerar `/etc/systemd/system/greensea.service`, aktiverar den och (om)startar den.

**Spara tokenet** som skrivs ut. Det står också i konfigurationsfilen:

```bash
sudo grep auth_token /etc/greensea/greensea.toml
```

### 3.3 Kontrollera att tjänsten kör

```bash
systemctl status greensea                  # active (running)
journalctl -u greensea -n 20               # "starting …", "listening on http://127.0.0.1:8765/", "llama-server ready (ok)"
curl -s http://127.0.0.1:8765/api/session  # {"app": "GreenSea", "version": "0.1.0", "auth_required": true, …}
```

### 3.4 Anpassa konfigurationen

```bash
sudo nano /etc/greensea/greensea.toml
sudo /opt/greensea/venv/bin/greensea --config /etc/greensea/greensea.toml --check
sudo systemctl restart greensea
```

Det du oftast ändrar:

```toml
[server]
host = "127.0.0.1"        # bara lokalt (rekommenderat; se avsnitt 4)
port = 8765
auth_token = "…"          # skapades av install.sh

[llama]
base_url = "http://127.0.0.1:8080"   # var llama-server lyssnar
api_key = ""                          # om llama-server körs med --api-key
```

**llama-server på en annan dator:** sätt `base_url = "http://<ip>:8080"`. Starta llama-server med `--host 0.0.0.0` (eller värdens IP) och gärna `--api-key`, ange samma nyckel i `api_key`, och begränsa porten i brandväggen till GreenSea-servern. Kontrollera från GreenSea-servern med `curl http://<ip>:8080/health`.

Om llama-server kör som systemd-tjänst på samma maskin kan du låta GreenSea starta efter den:

```bash
sudo systemctl edit greensea
# lägg till:
# [Unit]
# After=llama-server.service
# Wants=llama-server.service
```

Det är inte nödvändigt. GreenSea väntar själv tills llama-server svarar och skickar inget innan dess.

## 4. Nå webbgränssnittet

GreenSea lyssnar som standard bara på `127.0.0.1:8765`. Det finns tre sätt att nå det.

**A. SSH-tunnel (enklast och säkrast).** Kör på din egen dator:

```bash
ssh -L 8765:127.0.0.1:8765 användare@server
```

Öppna sedan http://localhost:8765 i webbläsaren.

**B. Direkt i lokala nätverket.** Ändra `host = "0.0.0.0"` i `[server]`. Behåll `auth_token`: utan token kan alla som når porten styra GreenSea, och tjänsten varnar då i loggen. Öppna porten i brandväggen om det behövs, till exempel `sudo ufw allow 8765/tcp`. Trafiken går okrypterad över nätet.

**C. Bakom en omvänd proxy med TLS.** Behåll `host = "127.0.0.1"` och låt proxyn hantera HTTPS. För nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    proxy_buffering off;          # live-strömmen (Server-Sent Events)
    proxy_read_timeout 1h;
}
```

**Inloggning:** första gången frågar gränssnittet efter tokenet. Inloggningen sparas i en cookie (HttpOnly, SameSite=Strict) i 30 dagar. **Logga ut** finns uppe till höger.

## 5. Ditt första uppdrag

1. Kontrollera pillret uppe till höger. Grön punkt med modellnamn, `n_ctx` och antal slots betyder att llama-server är redo. Röd punkt betyder att den inte är redo; se [felsökning](#10-felsökning).
2. Klicka **+ Nytt** under *Uppdrag*.
3. Fyll i:
   - **Titel**: `Testuppdrag`
   - **Uppdrag**:
     ```
     Skriv en kort guide om att stämma en skivspelares tonarm, i artefakten guide.md.
     Krav: avsnitten Översikt, Verktyg, Steg för steg och Vanliga fel.
     Klart när alla fyra avsnitten finns i guide.md.
     ```
   - **Max turer**: `20`
   - **Starta direkt**: kryssad
4. Klicka **Skapa**. Detaljvyn öppnas:
   - fasen går *Ny session* → *Skickar* → *Genererar* → *Analyserar* → *Skickar* …;
   - fliken **Live** visar modellens text medan den skrivs;
   - **Nästa mål** visar vad modellen ska göra i nästa tur.
5. Efter några turer: titta under **Artefakter** (klicka `guide.md`) och **Minne** (modellens plan och anteckningar).
6. När modellen anser sig klar granskar granskaren påståendet. Fasen blir **Klar**, eller fortsätter om granskaren hittar brister.

**Kontrollera första körningen med din modell** under **Turer**: klicka en tur och se att *tolkning* är `STRICT` och att kvittona är `APPLIED`. Många formatfel tyder på att modellen eller `max_tokens` inte räcker (se avsnitt 10). Kör sedan ett längre uppdrag och se under **Sessioner** att en ny session startar när kontextmätaren passerar det röda strecket. `cache` i turdetaljerna visar hur många tokens llama-server återanvände från sin prefixcache.

## 6. Användning i detalj

### 6.1 Hur ett uppdrag fungerar

Varje **tur** är ett anrop till llama-server:

- GreenSea skickar ett *mål*;
- modellen gör ett steg och svarar med ett JSON-objekt: utdata, artefakter, minne, sammanfattning, status, nästa steg, hinder, fråga och kontroll;
- GreenSea tillämpar artefakt- och minnesändringarna, kvitterar dem i nästa prompt och väljer nästa mål.

En **session** är en följd av turer i samma kontextfönster. När fönstret närmar sig fullt startar GreenSea en ny session. Dess första meddelande innehåller en **checkpoint**:
- framstegsloggen;
- alla minnesanteckningar;
- artefaktindexet;
- öppna hinder;
- slutet av senaste utdata;
- nästa mål.

Så kan ett uppdrag pågå i hundratals turer trots att kontexten är begränsad.

Modellens möjligheter:

| Område | Vad modellen kan göra | Gränser |
|---|---|---|
| Minne | `SET`/`DELETE` av anteckningar (nyckel → text) | 64 nycklar, 2 000 tecken per värde |
| Artefakter | `WRITE` (ersätt) och `APPEND` (lägg till) namngivna textdokument; `READ_ARTIFACT` läser tillbaka | 64 artefakter, 1 MB per artefakt |
| Kontroll | `PAUSE` (60–86 400 s), `ROTATE_SESSION` (ny session), `SET_PRIORITY` (aldrig över din prioritet) | |

Modellen har **inga andra verktyg**: inget skal, inga filer och inget nätverk. Allt den behöver veta måste stå i uppdraget eller i dina instruktioner.

### 6.2 Faser

| Visas som | Kod | Betydelse | Vad du gör |
|---|---|---|---|
| Utkast | `DRAFT` | Skapat, inte startat | **Starta** |
| Ny session | `ROTATING` | Ny kontext byggs från checkpoint | Inget |
| Skickar | `SENDING` | Väntar på llama-server eller en ledig slot, och skickar sedan | Inget |
| Genererar | `GENERATING` | Modellen skriver (se Live) | Inget |
| Analyserar | `ANALYZING` | Svaret tolkas, ändringar tillämpas, granskning | Inget |
| Återhämtar | `RECOVERING` | Tekniskt fel; nytt försök efter en väntetid som växer från 1 s upp till 6 h | **Försök nu** när orsaken är åtgärdad |
| Pausad | `PAUSED` | Av dig, eller tidsatt av modellen | **Återuppta** |
| Väntar på dig | `NEEDS_OPERATOR` | Kräver ditt beslut; frågan visas i en gul ruta | Skicka en instruktion (med *och återuppta*) eller **Återuppta** |
| Klar | `DONE` | Uppdraget är klart | **Öppna igen med instruktionen** för att fortsätta |
| Stoppad | `STOPPED` | Stoppat av dig | **Öppna igen med instruktionen** eller **Ta bort** |

### 6.3 Knappar i detaljvyn

| Knapp | Effekt |
|---|---|
| **Starta** | Startar ett utkast (session 1). |
| **Pausa** | Under *Genererar*/*Analyserar*: pausar **efter** pågående tur, eftersom en tur aldrig avbryts. Under *Skickar*/*Återhämtar*: pausar direkt. |
| **Återuppta** / **Försök nu** | Fortsätter efter paus eller efter *Väntar på dig*. Under *Återhämtar*: gör ett nytt försök direkt. |
| **Ny session** | Nästa tur startar en ny session från checkpoint. Nyttigt om modellen kört fast. |
| **Stoppa** | Avbryter direkt, även en pågående generering. Turen som pågick räknas inte. |
| **Exportera** | Laddar ner hela uppdraget som JSON: turer, prompter, svar, minne, artefakter och händelser. |
| **Ta bort** | Raderar ett utkast, klart eller stoppat uppdrag med all historik. Går inte att ångra. |
| **Prioritet** | Låg/Normal/Hög/Brådskande. Avgör ordningen när flera uppdrag väntar på llama-serverns slots. Väntetid höjer prioriteten med en nivå per 180 s. |

### 6.4 Instruktion till nästa prompt

Rutan **Instruktion till nästa prompt** skickar en engångsinstruktion. Den går före målet i nästa prompt. Använd den för att:
- svara på modellens fråga;
- ändra inriktning;
- ge fakta som saknas.

Med **och återuppta** kryssad återupptas ett pausat uppdrag, eller ett som väntar på dig, direkt. Väntande instruktioner visas under rutan och kan tas bort (✕) så länge de inte har skickats.

För ett **Klart** eller **Stoppat** uppdrag heter knappen **Öppna igen med instruktionen**. Uppdraget fortsätter då i en ny session med din instruktion.

Live-uppdateringarna skriver aldrig över något du håller på att skriva. Osparade ändringar i formulär markeras med streckad ram.

### 6.5 Flikarna

| Flik | Innehåll |
|---|---|
| **Live** | Texten medan modellen skriver, och resonemang från resonerande modeller. Annars visas senaste svaret uppdelat: status, sammanfattning, utdata, nästa steg och ändringar. |
| **Turer** | Alla turer, nyast först. Klicka på en tur för att se mål, föreslaget nästa steg, kvitton, beslut, prompten som skickades och svaret (strukturerat och rått). |
| **Minne** | Modellens anteckningar. |
| **Artefakter** | Dokumenten, med storlek, sha256 och senaste tur. Klicka för att läsa, eller **Ladda ner**. |
| **Sessioner** | Varje kontextsession: orsak, antal turer och tider. |
| **Händelser** | Händelseloggen för uppdraget. |
| **Uppdragstext** | Ändra titel, uppdragstext och max turer. Ändrad uppdragstext börjar gälla i en ny session, som startar automatiskt vid nästa tur. **Spara som mall** sparar uppdraget som mall. |

Kontextmätaren visar hur full den aktuella sessionen är. Det röda strecket markerar gränsen där en ny session startas (standard 75 %).

### 6.6 Mallar

Under **Mallar** sparar du uppdrag du kör ofta: **+ Ny**, fyll i, **Spara**. **Skapa uppdrag från mallen** öppnar formuläret för nytt uppdrag förifyllt. I formuläret *Nytt uppdrag* kan du också välja mall direkt, eller kryssa **Spara även som mall**.

### 6.7 Skriv uppdrag som fungerar

```
Mål: <vad som ska åstadkommas, en mening>
Bakgrund och fakta: <allt modellen behöver veta – den kan inte läsa filer eller söka>
Leverans: <artefakt(er), t.ex. rapport.md med avsnitten A, B, C>
Klart när: <mätbara villkor>
Begränsningar: <omfång, stil, språk, saker som inte ska göras>
```

- Gör leveransen till artefakter. Långa dokument byggs med `APPEND` över flera turer.
- Klara villkor ("Klart när …") gör granskarens bedömning av KLART säker.
- Uppdraget kan skrivas på svenska. Modellen svarar på uppdragets språk om du inte säger något annat.

## 7. Inställningar

**Inställningar** i gränssnittet ändrar körvärdena utan omstart. De gäller från nästa tur. Standardvärdena kommer från konfigurationsfilen, och **Återställ till filens värden** tar bort dina ändringar.

| Inställning (fil: sektion.nyckel) | Standard | Intervall | Förklaring |
|---|---|---|---|
| `generation.max_tokens` | 2048 | 64–32768 | Svarsgräns per tur |
| `generation.temperature` | 0.6 | 0–2 | Lägre ger mer förutsägbart arbete |
| `generation.top_p` | 0.95 | 0–1 | |
| `generation.structured_output` | `json_schema` | `json_schema`, `json_object`, `off` | Grammatikbunden JSON. Byt till `json_object` eller `off` om llama-server avvisar schemat eller modellen fungerar dåligt med det. |
| `generation.store_reasoning` | på | | Sparar resonemang från resonerande modeller; skickas aldrig tillbaka |
| `context.n_ctx` | 0 | 0–4194304 | 0 = per slot från llama-server. Sätt ett värde vid delad KV-cache (`-kvu`). |
| `context.rotate_at` | 0.75 | 0.30–0.95 | Ny session när prompten passerar denna andel av n_ctx |
| `context.checkpoint_share` | 0.35 | 0.10–0.60 | Högsta andel av n_ctx för checkpointen |
| `context.max_session_turns` | 0 | 0–10000 | 0 = obegränsat; annars ny session efter N turer |
| `context.progress_log_items` | 20 | 3–200 | Antal tursammanfattningar i checkpointen |
| `context.artifact_read_chars` | 6000 | 500–200000 | Tecken per `READ_ARTIFACT` |
| `scheduler.max_parallel` | 0 | 0–64 | 0 = llama-serverns `total_slots` |
| `scheduler.aging_seconds` | 180 | 10–3600 | Väntande uppdrag höjs en prioritetsnivå per intervall |
| `timeouts.first_token_seconds` | 900 | 10–86400 | Väntan på första token, inklusive promptbearbetning (kan ta minuter på CPU) |
| `timeouts.stall_seconds` | 180 | 5–86400 | Längsta tid utan data när genereringen har börjat |
| `timeouts.turn_seconds` | 3600 | 30–172800 | Total tid per tur |
| `timeouts.health_interval_seconds` | 15 | 2–3600 | Hälsokontroll mot llama-server |
| `reviewer.mode` | `terminal` | `off`, `terminal`, `every_turn` | `terminal` granskar påståenden om KLART och BLOCKERAD |
| `reviewer.max_tokens` | 600 | 64–8192 | Granskarens svarsgräns |
| `reviewer.max_rejections` | 2 | 1–10 | Därefter avgör du |
| `missions.default_max_turns` | 200 | 1–1000000 | För nya uppdrag |
| `missions.default_priority` | `NORMAL` | `LOW` … `URGENT` | För nya uppdrag |

Längst ned på sidan visas llama-serverns status: adress, modell, build, `n_ctx`, slots och senaste kontroll.

## 8. API för skript

Allt i gränssnittet finns också som HTTP-API. Med inloggning används `Authorization: Bearer <token>`. Alla ändrande anrop (POST/PUT/PATCH/DELETE) kräver dessutom headern `X-GreenSea: 1`.

```bash
GS=http://127.0.0.1:8765
TOKEN=$(sudo sed -n 's/^auth_token = "\(.*\)"/\1/p' /etc/greensea/greensea.toml)
A=(-H "Authorization: Bearer $TOKEN")
W=(-H "Authorization: Bearer $TOKEN" -H "X-GreenSea: 1" -H "Content-Type: application/json")

# Status: llama-server, kapacitet, antal uppdrag per fas
curl -s "${A[@]}" $GS/api/status

# Skapa och starta ett uppdrag
curl -s "${W[@]}" -X POST $GS/api/missions \
  -d '{"title":"Dikt","goal":"Skriv en dikt om havet i artefakten dikt.md. Klart när dikten har fyra strofer.","max_turns":10,"start":true}'
# → {"mission": {"id": "3f2a…", …}}
MID=3f2a…   # id från svaret

curl -s "${A[@]}" $GS/api/missions/$MID                    # detaljer, minne, artefaktindex
curl -s "${A[@]}" "$GS/api/missions/$MID/turns?limit=5"    # senaste turerna
curl -s "${A[@]}" $GS/api/missions/$MID/turns/1            # en tur i sin helhet
curl -s "${A[@]}" $GS/api/missions/$MID/artifacts/dikt.md  # artefaktens text
curl -s "${W[@]}" -X POST $GS/api/missions/$MID/instructions -d '{"text":"Gör den kortare.","resume":true}'
curl -s "${W[@]}" -X POST $GS/api/missions/$MID/pause       # även: start, resume, stop, rotate
curl -s "${W[@]}" -X POST $GS/api/missions/$MID/reopen -d '{"instruction":"Lägg till en femte strof."}'
curl -s "${W[@]}" -X PATCH $GS/api/missions/$MID -d '{"priority":"HIGH","max_turns":50}'
curl -s "${A[@]}" -o greensea-export.json $GS/api/missions/$MID/export
curl -sN "${A[@]}" "$GS/api/stream?mission=$MID"           # live (Server-Sent Events)
```

Utan `auth_token` behövs ingen `Authorization`-header, men `X-GreenSea: 1` krävs alltid för ändrande anrop.

Är uppdraget redan **Klart** när du kör instruktions- eller pausexemplet, svarar GreenSea 409. Det händer med en snabb modell och ett litet uppdrag. Använd då `reopen`.

| Metod och sökväg | Funktion |
|---|---|
| `GET /api/session`, `POST /api/login`, `POST /api/logout` | Inloggning |
| `GET /api/status` | Version, llama-server, kapacitet, faser |
| `GET`/`PUT /api/settings`, `POST /api/settings/reset` | Inställningar (PUT tar delmängd: `{"context":{"rotate_at":0.7}}`) |
| `GET`/`POST /api/missions` | Lista och skapa (`title`, `goal`, `priority`, `max_turns`, `start`) |
| `GET`/`PATCH`/`DELETE /api/missions/{id}` | Detaljer, ändra (`title`, `goal`, `priority`, `max_turns`), ta bort |
| `POST /api/missions/{id}/{start\|pause\|resume\|stop\|rotate\|reopen}` | Åtgärder; `reopen` tar `{"instruction": "…"}` |
| `POST /api/missions/{id}/instructions`, `DELETE …/instructions/{iid}` | Instruktion (`text`, `resume`), ta bort väntande |
| `GET /api/missions/{id}/turns[?before=N&limit=M]`, `GET …/turns/{nr}` | Turer |
| `GET /api/missions/{id}/artifacts/{namn}[?download=1]` | Artefakt som text |
| `GET /api/missions/{id}/events`, `GET /api/events` | Händelser |
| `GET /api/missions/{id}/export` | Fullständig JSON-export |
| `GET`/`POST /api/templates`, `PUT`/`DELETE /api/templates/{id}` | Mallar |
| `GET /api/stream[?mission=id]` | Live-händelser (SSE); tokenström för angivet uppdrag |

Fel svarar med `{"error": "…"}` och statuskoderna 400 (ogiltigt), 401 (inloggning krävs), 403 (saknar `X-GreenSea`), 404 eller 409 (fel fas).

## 9. Drift: logg, säkerhetskopia, uppgradering, avinstallation

### 9.1 Logg och status

```bash
journalctl -u greensea -f          # följ loggen
systemctl restart greensea         # omstart
```

En omstart mitt i en tur är ofarlig. Den avbrutna turen skickas om med exakt samma prompt efter starten (händelsen `RESTART_REDISPATCH`), och ingenting dubbleras.

Händelseloggen i gränssnittet (**Händelser**) visar varje tur som skickats och besvarats, rotationer, fel, beslut och dina åtgärder. Den behåller de senaste cirka 50 000 händelserna.

### 9.2 Säkerhetskopia och återställning

Allt tillstånd ligger i `/var/lib/greensea/greensea.sqlite3`: uppdrag, turer, minne, artefakter, mallar och inställningar. Kopiera inte filen med `cp` medan tjänsten kör, eftersom databasen använder WAL-läge. Använd SQLites backup-funktion, som går bra under drift:

```bash
sudo python3 -c "import sqlite3; s=sqlite3.connect('file:/var/lib/greensea/greensea.sqlite3?mode=ro', uri=True); d=sqlite3.connect('/root/greensea-backup.sqlite3'); s.backup(d); d.close(); print('ok')"
```

Återställ med:

```bash
sudo systemctl stop greensea
sudo cp /root/greensea-backup.sqlite3 /var/lib/greensea/greensea.sqlite3
sudo rm -f /var/lib/greensea/greensea.sqlite3-wal /var/lib/greensea/greensea.sqlite3-shm
sudo chown greensea:greensea /var/lib/greensea/greensea.sqlite3
sudo systemctl start greensea
```

Konfigurationen (`/etc/greensea/greensea.toml`) säkerhetskopieras separat.

### 9.3 Uppgradering

```bash
unzip GreenSea_v<ny>.zip && cd greensea-<ny>
sudo bash deploy/install.sh
```

Konfigurationsfilen och databasen behålls. En äldre GreenSea vägrar starta mot en databas från en nyare version, vilket skyddar mot oavsiktlig nedgradering.

### 9.4 Avinstallation

```bash
sudo systemctl disable --now greensea
sudo rm /etc/systemd/system/greensea.service
sudo systemctl daemon-reload
sudo rm -rf /opt/greensea
# Data och konfiguration (går inte att ångra – ta säkerhetskopia först):
sudo rm -rf /var/lib/greensea /etc/greensea
sudo userdel greensea
```

## 10. Felsökning

| Symptom | Trolig orsak | Åtgärd |
|---|---|---|
| Röd punkt, *llama-server: …* | llama-server kör inte, laddar fortfarande modellen (503) eller har en annan adress | `curl http://127.0.0.1:8080/health`; kontrollera `[llama] base_url`. Uppdragen väntar under tiden, utan att förbruka omförsök. |
| Tjänsten startar inte | Fel i konfigurationen | `sudo /opt/greensea/venv/bin/greensea --config /etc/greensea/greensea.toml --check` och `journalctl -u greensea -n 50` |
| `greensea: … address already in use` | Porten används redan, t.ex. av tjänsten när du startar en manuell kopia | Byt `port` i konfigurationen, eller stoppa den andra processen |
| `greensea: database schema N is newer than this GreenSea` | En äldre version startas mot en databas från en nyare version | Installera den nyare versionen igen, eller återställ en säkerhetskopia från den äldre (9.2) |
| *Väntar på dig: n_ctx okänd* | llama-server rapporterar ingen kontextstorlek | Sätt **n_ctx** under Inställningar och klicka **Återuppta** |
| *Väntar på dig: kontexten räcker inte* (`CONTEXT_TOO_SMALL`) | Kontraktet + uppdraget + checkpoint + `max_tokens` ryms inte i en session | Kortare uppdragstext, lägre `max_tokens`, eller större `-c`/färre `-np` i llama-server |
| *Väntar på dig: llama-server avvisade anropet* (`LLAMA_REQUEST_REJECTED`) | HTTP 4xx: fel API-nyckel, fel modellnamn (routerläge) eller ett JSON-schema som denna llama-version inte stöder | Läs felet i frågerutan och **Händelser**. Vid schemafel: sätt **Strukturerat svar** till `json_object` och klicka **Återuppta**. |
| *Återhämtar* (anslutning, *ingen första token i tid*, *strömmen stannade*) | llama-server nere, överbelastad eller för långsam | Åtgärda llama-server, eller höj **Första token (s)** / **Stopp i strömmen (s)**; sedan **Försök nu** |
| *Väntar på dig: upprepade formatfel* (`PROTOCOL_FAILURES`) | Sex svar i rad utan giltigt JSON-objekt, ofta avhuggna vid `max_tokens` | Höj `max_tokens`, se till att **Strukturerat svar** är `json_schema`, eller byt modell. Kontrollera svaren under **Turer**. |
| *Väntar på dig: fastnat i upprepning* (`REPETITION`) | Modellen föreslår samma steg utan att något förändras, även efter ny session | Ge ett konkret nästa steg som instruktion, eller förtydliga uppdraget |
| *Väntar på dig: turbudgeten är slut* | Max turer uppnått | Höj **Max turer** under *Uppdragstext* och **Återuppta**, eller **Stoppa** |
| *Väntar på dig: granskaren bestrider att det är klart* (`DONE_DISPUTED`) | Modellen säger klart, granskaren håller inte med | Läs frågerutan. Är du nöjd: **Stoppa**. Annars en instruktion om vad som saknas, med *och återuppta*. |
| *Väntar på dig: modellen behöver dig* (`MODEL_BLOCKED`) | Modellen saknar information eller ett beslut | Svara i instruktionsrutan med *och återuppta* |
| Inloggningen fungerar inte | Fel token | `sudo grep auth_token /etc/greensea/greensea.toml`. Efter byte av token: `systemctl restart greensea` och logga in igen. |
| API-anrop ger 403 | Headern `X-GreenSea: 1` saknas | Lägg till den på POST/PUT/PATCH/DELETE |
| `install.sh`: *Python 3.11 or newer is required* | För gammal `python3` | Installera Python ≥ 3.11 och kör `sudo PYTHON=python3.11 bash deploy/install.sh` |
| `install.sh`: *ensurepip is not available* eller venv-fel | `python3-venv` saknas | `sudo apt install python3-venv` (eller `python3.11-venv`) |
| `install.sh` hänger eller felar vid `pip install` | Ingen åtkomst till PyPI | Se [avsnitt 11](#11-installation-utan-internet-på-servern) |
| Live-strömmen uppdateras inte bakom en proxy | Proxyn buffrar SSE | `proxy_buffering off;` (nginx), se avsnitt 4 |

Varje automatiskt beslut syns i **Händelser** och under **Turer** (beslut och kvitton). **Exportera** ger hela underlaget som en JSON-fil.

## 11. Installation utan internet på servern

`install.sh` använder en katalog `wheels/` i det uppackade paketet om den finns, och går då inte ut på nätet.

**1. Hämta paketen på en dator med internet.** Den ska ha samma CPU-arkitektur (`uname -m`) som servern, och helst samma Python-version (`python3 --version`):

```bash
python3 -m venv /tmp/gs-dl                     # egen pip, oberoende av systemets
/tmp/gs-dl/bin/pip download --only-binary=:all: -d wheels \
    "aiohttp>=3.9,<4" typing_extensions "setuptools>=68" wheel
```

`typing_extensions` ska alltid vara med. aiohttp kräver det på Python under 3.13, men `pip download` tar bara med det när nedladdningen körs med en sådan Python.

Har nedladdningsdatorn en annan Python-version än servern, ange serverns version och plattform:

```bash
/tmp/gs-dl/bin/pip download --only-binary=:all: --python-version 3.11 --platform manylinux2014_x86_64 -d wheels \
    "aiohttp>=3.9,<4" typing_extensions "setuptools>=68" wheel
```

Byt `3.11` mot serverns version och `x86_64` mot `aarch64` på ARM.

**2. Installera på servern.** Kopiera `wheels/` in i det uppackade paketet:

```bash
cp -r wheels greensea-0.1.0/
cd greensea-0.1.0
sudo bash deploy/install.sh        # skriver "offline: installing from …/wheels (no network)"
```

Får du `No matching distribution found for …`, saknas ett paket för serverns Python-version eller arkitektur. Ladda ner igen enligt steg 1 med rätt `--python-version` och `--platform`.

## 12. Köra utan systemd och köra testerna

För test eller utveckling som vanlig användare. Packa upp paketet (3.1) och stå i katalogen `greensea-0.1.0`:

```bash
python3 -m venv venv
venv/bin/pip install -e '.[test]'              # -e: ändringar i källkoden gäller direkt
cat > lokal.toml <<'EOF'
[server]
host = "127.0.0.1"
port = 8765
data_dir = "./data"

[llama]
base_url = "http://127.0.0.1:8080"
EOF
venv/bin/greensea --config lokal.toml          # Ctrl-C avslutar
```

Loggen visar `listening on http://127.0.0.1:8765/` och, när llama-server svarar, `llama-server ready (ok)`. Öppna http://127.0.0.1:8765. `lokal.toml` saknar `auth_token`, så ingen inloggning krävs. Kör tjänsten från avsnitt 3 redan på 8765, välj en annan port (till exempel `port = 8766`); annars avslutas GreenSea med `address already in use`.

Testsviten kör GreenSea mot en inbyggd fejkad llama-server och behöver ingen riktig modell:

```bash
venv/bin/python -m pytest -q                  # 42 passed
```

---

Arkitektur, designbeslut och vad som är verifierat beskrivs i [docs/DESIGN.md](docs/DESIGN.md).
