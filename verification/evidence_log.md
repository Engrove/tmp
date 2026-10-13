# Evidens för Greenfield 1.9.11

VERIFIERAT avser angivet omfång. Ett konstruerat UI i JSDOM bevisar inte hur den inloggade ChatGPT-sidan är implementerad.

| ID | Klass | Verktyg/kommando | Rå underlag/resultat |
| --- | --- | --- | --- |
| E101 | VERIFIERAT i konstruerad DOM | GREENFIELD_BASELINE_ADAPTER=…/thinking-control-1.9.10.js GREENFIELD_FREQUENCY_OUTPUT=…/baseline_frequency.json node --test tests/thinking-ordinal.test.mjs | baseline.tap, baseline_frequency.json: 17 testfall, 15 misslyckanden. Den avgränsade frekvensserien har 6/6 TIMEOUT och ett navigationsklick per försök. Oförändrad 1.9.10-adapter finns i thinking-control-1.9.10.js; hash i source_environment.json. |
| E102 | VERIFIERAT källändring | Python difflib.unified_diff, SHA-256 och bytejämförelse mellan 1.9.10 och 1.9.11 | source_diff.patch, source_environment.json samt aktuell kod i ../greenfield/. Funktionsändringar i thinking-control.js och safety-policy.js; versions-/adapterfält uppdaterade. |
| E103 | VERIFIERAT i Node/JSDOM | GREENFIELD_FREQUENCY_OUTPUT=…/patched_frequency.json node --test --test-reporter=tap tests/*.test.mjs | final-regression.tap: 62/62 PASS, 0 FAIL, 0 SKIP. patched_frequency.json: 0/6 fel, inga navigationsklick i samma sex seedade DOM-fall. Initieringsförkontroll och verkliga submitPrompt-funktionen ger ett enda simulerat Skicka-klick trots upprepat dispatch-ID. |
| E104 | VERIFIERAT i konstruerad DOM | node --test --test-reporter=tap --test-name-pattern='already selected option' tests/thinking-control.test.mjs, sedan E103 | already-maximum-before.tap: 1/1 TIMEOUT när alternativet redan är valt men öppnad meny visar generisk knappetikett. Samma test passerar i final-regression.tap efter att oförändrat val verifieras efter stängning. |
| E105 | VERIFIERAT miljögräns | node --version; läsning av installerat jsdom/package.json; Python shutil.which | source_environment.json: Node v24.19.0, JSDOM 26.1.0; inga av fyra sökta lokala browserkommandon hittades. Ingen inloggad Chrome-körning genomfördes. |
| E106 | VERIFIERAT paketkontroll | Python versions-/manifest-/import-/filkontroll samt node --check | package_verification.json; samtliga kontroller som anges i filen måste vara PASS för leverans. |
| A101 | ANTAGANDE / öppet fältvillkor | Avgränsning mellan bifogad diagnostik och testmiljön | field_diagnostics_projection.json har menytext med Extra hög, 4 av 4 och senare modellista, men saknar exakt underliggande DOM och händelsemål. Testmodellens överensstämmelse med verklig implementation samt samtliga samtidighets-/schemavägar är inte fullt verifierade. |

## RARE-resultat

Klass: deterministiska BOH-fel i avgränsade testmodeller; fältets frekvensklass är inte fastställd. Före/efter för den centrala reproduktionen är 6/6 respektive 0/6. N=6 uppfyller N≥3/p med modellens p=1. Detta är regressionmätning, inte populationsmätning av användarens Chrome. [E101, E103, A101]

Mekanism och tillräcklighet är reproducerade, och rättningen tar bort fel i de provade fallen. Verklig nödvändighet, full förklaringskraft och avsaknad av konkurrerande fältorsaker är inte etablerade. G5 för hela fältfelet markeras därför inte som passerad. Den senare uttryckliga beställningen av kodrättning genomförs med denna begränsning. [E101, E103, E104, A101]

## Upprepa

Från paketets greenfield:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

Visa den äldre adapterns fel på nytt i bash:

```sh
GREENFIELD_BASELINE_ADAPTER=../verification/thinking-control-1.9.10.js node --test tests/thinking-ordinal.test.mjs
```

Det negativa testet förväntas misslyckas. Testerna skapar ingen verklig Chrome-session och skickar inga nätverksanrop till EIC eller ChatGPT. [E101, E103; testkällor]
