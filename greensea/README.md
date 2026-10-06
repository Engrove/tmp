# GreenSea 0.1.0

GreenSea driver ett uppdrag självständigt över hundratals prompter mot en lokal **llama.cpp** (`llama-server`) på din egen server. Den körs som en systemd-tjänst, är skriven i Python och har ett eget webbgränssnitt. Den är inte en Chrome-plugin.

GreenSea bygger på idéerna i Greenfield 1.9.0, men flyttade från ChatGPT-fliken till en tjänst som själv äger konversationen. Varför och hur beskrivs i [docs/DESIGN.md](docs/DESIGN.md).

## Vad den gör

- **Långa sessioner.** Ett uppdrag går tur för tur: GreenSea skickar ett mål, modellen gör ett steg och rapporterar i JSON, och GreenSea väljer nästa mål. Det pågår tills uppdraget är klart, behöver dig eller turbudgeten tar slut.
- **Kontexten tar aldrig slut.** GreenSea mäter kontextens fyllnad med llama-serverns egna `usage`-siffror. Innan fönstret blir fullt startas en ny session. Dess första meddelande bär en checkpoint ur databasen: framstegslogg, minnesanteckningar, artefaktindex, öppna hinder och nästa steg.
- **Modellens arbetsyta.** Modellen kan spara *minnesanteckningar* (nyckel → värde) och *artefakter* (namngivna textdokument, WRITE/APPEND/READ). Varje begäran valideras och kvitteras i nästa prompt.
- **Krascha säkert.** Varje tur skrivs till SQLite innan den skickas (write-ahead). Efter strömavbrott eller omstart skickas en avbruten tur igen, med exakt samma meddelande, och ingenting dubbleras i kontexten.
- **Du styr.** Du kan pausa (efter pågående tur), återuppta, stoppa, starta en ny session, ge en engångsinstruktion till nästa prompt, ändra prioritet och uppdragstext, och öppna ett avslutat uppdrag igen.
- **Granskare.** Ett andra, avgränsat anrop kontrollerar påståenden om KLART och BLOCKERAD innan de får verkan. Det går att stänga av eller köra varje tur.
- **Flera uppdrag samtidigt.** En kapacitetsschemaläggare fördelar llama-serverns slots efter prioritet. Väntetid höjer prioriteten, så inget uppdrag svälts ut.

## Krav

- Linux med systemd, Python ≥ 3.11 (testat på 3.11 och 3.13).
- En fungerande `llama-server` (llama.cpp). Rekommenderat:
  ```
  llama-server -m modell.gguf -c 32768 -np 2 --jinja --host 127.0.0.1 --port 8080
  ```
  - `-c`/`-np`: GreenSea läser kontextstorleken per slot från `/props` (`default_generation_settings.n_ctx`).
  - `--jinja` är standard i aktuella byggen och krävs för modellens chattmall.
  - Strukturerade svar (`response_format` med JSON-schema) används som standard.
- Ett beroende: `aiohttp`.

## Installation som tjänst

**Steg-för-steg-guide:** [INSTALLATION_OCH_ANVANDNING.md](INSTALLATION_OCH_ANVANDNING.md) (installation, användning, API, drift, felsökning).

```bash
sha256sum -c GreenSea_v0.1.0.zip.sha256
unzip GreenSea_v0.1.0.zip && cd greensea-0.1.0
sudo bash deploy/install.sh
```

Skriptet gör följande:
- skapar systemanvändaren `greensea`;
- installerar i `/opt/greensea` (venv);
- skriver `/etc/greensea/greensea.toml` med ett nytt inloggningstoken (en befintlig fil behålls);
- installerar `greensea.service` med härdning och startar den.

Databasen hamnar i `/var/lib/greensea/greensea.sqlite3`.

```bash
journalctl -u greensea -f                 # logg
sudo systemctl restart greensea           # omstart (pågående tur skickas om)
/opt/greensea/venv/bin/greensea --config /etc/greensea/greensea.toml --check
```

### Manuellt / utveckling

```bash
python3 -m venv venv && ./venv/bin/pip install -e '.[test]'
./venv/bin/greensea --config deploy/greensea.toml.example   # (ändra data_dir först)
./venv/bin/python -m pytest -q
```

## Åtkomst och säkerhet

- `host = "127.0.0.1"` (standard) gör gränssnittet nåbart bara från servern. Använd en SSH-tunnel, `ssh -L 8765:127.0.0.1:8765 server`, eller en omvänd proxy med TLS.
- Lyssnar GreenSea på nätverket måste `server.auth_token` vara satt. Inloggningen ger en HttpOnly-cookie med SameSite=Strict, och skript kan använda `Authorization: Bearer <token>`.
- Alla ändrande API-anrop kräver headern `X-GreenSea: 1`. Det stoppar CSRF från främmande sidor.
- Strikt Content-Security-Policy gäller. Modellens text visas alltid som text, aldrig som HTML.
- Modellen har **inga verktyg**: inget skal, inga filer och inget nätverk. Den kan bara skriva till GreenSeas eget minne och sina artefakter.

## Konfiguration

`[server]` och `[llama]` läses vid start. Övriga sektioner är standardvärden som du kan ändra under **Inställningar** i gränssnittet. Ändringarna sparas i databasen och gäller från nästa tur. Se [deploy/greensea.toml.example](deploy/greensea.toml.example).

| Inställning | Standard | Betydelse |
|---|---|---|
| `generation.max_tokens` | 2048 | Svarsgräns per tur. Långa leveranser byggs med APPEND över flera turer. |
| `generation.structured_output` | `json_schema` | Grammatikbunden JSON. Prova `json_object` eller `off` om modellen/mallen har problem. |
| `context.rotate_at` | 0.75 | Ny session när prompten passerar denna andel av n_ctx. |
| `context.checkpoint_share` | 0.35 | Högsta andel av n_ctx för checkpointen i en ny session. |
| `scheduler.max_parallel` | 0 | 0 = llama-serverns `total_slots`. |
| `timeouts.first_token_seconds` | 900 | Inkluderar promptbearbetning, som kan ta minuter på CPU. |
| `reviewer.mode` | `terminal` | `off`, `terminal` (granskar KLART/BLOCKERAD) eller `every_turn`. |

## Så skriver du ett bra uppdrag

- Ange **mål, acceptanskriterier och leverans**, till exempel: ”Leverera `rapport.md` med avsnitten …; klart när …”.
- Stora leveranser ska vara artefakter. Modellen bygger dem med APPEND och läser tillbaka med READ_ARTIFACT.
- Fakta som modellen inte kan veta ska stå i uppdraget. Den har ingen åtkomst till filer eller nätet.
- Uppdragstexten kan vara på svenska. Kontrollkontraktet till modellen är på engelska, eftersom små lokala modeller följer det bäst så.

## Gränssnittet

- **Uppdrag**: listan och detaljvyn. Detaljvyn visar fas, tur/budget, session, kontextmätare med rotationsgräns, nästa mål, engångsinstruktion och flikarna Live (tokenström), Turer (prompt, svar, kvitton, beslut), Minne, Artefakter, Sessioner, Händelser och Uppdragstext.
- **Mallar**: sparade uppdrag som startas med ett klick.
- **Händelser**: tjänstens händelselogg (dispatch, svar, rotationer, fel, beslut).
- **Inställningar**: körinställningar och llama-serverns status.

Live-uppdateringar skriver aldrig över ett fält du redigerar. Osparade ändringar markeras med streckad ram.

Skärmdumpar från verifieringskörningen (demo-llama, därför modellnamnet `fake.gguf`):
[Turer](docs/screenshots/turer.png) · [Artefakter](docs/screenshots/artefakter.png) · [Mobil](docs/screenshots/mobil.png)

## Begränsningar (ärligt)

- Verifierat mot en protokolltrogen fejkad llama-server. Den bygger på llama.cpp-källan, `tools/server` på master 2026-10. Mot en riktig `llama-server`-binär har GreenSea **inte körts i denna leverans**.
- Granskaren använder samma modell som arbetaren och kan dela dess blinda fläckar. Tvister är därför begränsade och går till dig.
- Tokenräkning för fortsättningsturer är en uppskattning, kalibrerad mot `usage`. Missar fångas av llama-serverns `exceed_context_size_error` och leder till rotation.
- En enda process med SQLite. Det räcker för en server med en eller några llama-instanser.

## Struktur

```
greensea/        Python-paketet
  engine.py      motor: runner per uppdrag, turprotokoll, rotation, operatörsåtgärder
  control.py     deterministisk styrning (fortsätt/klart/operatör/paus, upprepningsvakt)
  effects.py     minne/artefakter/kontroll: validering, kvitton
  protocol.py    systemkontrakt, turmeddelanden, svarsschema, tolkning
  context.py     tokenräkning, rotationsbeslut, checkpoint
  reviewer.py    granskare
  scheduler.py   kapacitetsschemaläggare (prioritet + åldring)
  llama.py       llama-server-klient (SSE, tidsgränser, felklassning)
  monitor.py     hälsa och /props
  db.py          SQLite (WAL, en skrivtråd, transaktion per tillståndsbyte)
  web.py         REST + SSE + statiskt gränssnitt
  static/        webbgränssnittet (HTML/CSS/JS utan byggsteg)
deploy/          systemd-unit, exempelkonfiguration, install.sh
docs/DESIGN.md   analysen Greenfield → GreenSea
tests/           42 tester mot en fejkad llama-server
```
