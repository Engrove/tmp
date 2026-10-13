# Greenfield 1.9.12 – verifierad återkontroll och återupptagning

Komplett Chrome-tillägg. Installera enligt `UPPDATERA_TILL_1_9_12.md` och kontrollera **Körande motor v1.9.12** i panelen. Manifest, motor, innehållsbrygga och panel har samstämmiga versionsfält. [E207]

Diagnostiken visade motor 1.9.10 och observationsadapter 7 samtidigt som panelen visade 1.9.11. Den manuella knappen rapporterade framgång med vanlig modellkompatibilitet, trots att sändningen krävde ett separat kvitto på högsta tänkenivå. Felet reproducerades i oförändrad handler i 6/6 försök. [E201–E203]

## Ändrat

- **Kontrollera modell igen** kör samma maximumkontroll som före sändning. När den och de ordinarie sändvillkoren är godkända tas spärren bort och workerns nästa steg köas. [E206]
- Varje worker får ett eget resultat. En saknad flik avbryter inte nästa kontroll. Pausade workers behåller sitt läge; schema, kvalitet, budget och osäkra tidigare utskick respekteras i provade scenarier. [E206]
- STOP under kontrollen får inte skrivas över. Explicit kvotåterhämtning finns kvar och kräver färska godkända avläsningar. [E206]
- Panelen visar körande motorversion och varnar när panel, motor och tillägg har olika versioner. Resultatet skiljer verifierade, blockerade och överhoppade workers. [E206,E207]

Thinking-styrningen från 1.9.11 ingår: Balanserad höjs till det upptäckta maximumet och en redan högsta nivå verifieras utan modellnavigationsklick. Menytester passerar även för **Extra hög, 4 av 4**, omrendering och ny session. [E206]

Den senare bilagans **Extension context invalidated** reproduceras i äldre kod. Leveransens befintliga livscykelskydd stoppar den döda anslutningen utan ohanterat undantag i 6/6 felinjicerade försök. Ladda om tillägget och dess ChatGPT-flikar enligt installationen. [E208,E209]

## Verifiering och gränser

**80/80 tillgängliga tester passerar.** Den manuella kontrollens falska framgångar går från **6/6 till 0/6**. Verkliga runtimefunktioner provas från kontroll till utskick och WAITING, med simulerade Chrome-API:er. Ett utskick och korrekt användarturskvitto verifieras. [E203,E206]

Det reproducerade handlerfelet klassas som BOH: deterministiskt under kända villkor. De fem rotorsaksbevisen, frekvenserna, kodskillnaden och öppna antaganden finns i `rare/`. Ingen full G5-certifiering görs för användarens levande Chrome-miljö. Exakt menyimplementation och orsaken till blandade körande versioner är inte verifierade här. [E203,E206,A201,A202]

Äldre changeloggar är historik. Aktuella instruktioner finns i dokumentet för 1.9.12. Äldre 1.9.11-evidens för historikens E101–E106 följer med i paketets `verification/`.

## Upprepa tester

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
python3 rare/repro_harness/verify_release.py
```

Återskapa det negativa fallet med den oförändrade äldre handlern:

```sh
GREENFIELD_RECHECK_BASELINE=rare/repro_harness/background-1.9.11.js node --test --test-name-pattern='manual recheck performs maximum' tests/model-recheck.test.mjs
```

Det negativa testet förväntas misslyckas. JSDOM används av testerna, inte tilläggets runtime. [E203,E206,E207]

Evidens-ID hänvisar till `rare/evidence_log.md`.
