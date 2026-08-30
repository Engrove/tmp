# EIC Autonom Agent v0.12.14 — autonom återhämtning av strandat kausalt ägarskap

Basversion: v0.12.13. Denna release rättar en regression som v0.12.13 själv
införde. v0.12.13:s detektion var korrekt; dess *åtgärd* var det inte.

## Fältincidenten (2026-08-30T15:08Z)

| Tid | Händelse |
|---|---|
| `15:08:14.169` | `owner=OWNER_ACTIVE` — frisk |
| `15:08:16.844` | `NANO_CLAIM` **startar** |
| `15:08:16.844` | Strand öppnas: `OWNER_CONSUMED_WITHOUT_SUCCESSOR … ingen aktiv kausal effect äger nästa steg` |
| `15:08:16.899` | Nano-analys startar (`nano-request-a54fcbc6`, claim `nano-claim-3214c6a9`) |
| `15:08:26 → 15:09:06` | `NANO_HEARTBEAT` löpande |
| `15:09:06.369` | Nano-beslut: verdict **ACCEPT**, `durationMs: 49183` |
| `15:09:06.547` | `session-context-init.ready` **READY** — *"Vanlig agentbearbetning får nu fortsätta."* |
| **`15:09:06.642`** | **ERROR_TERMINAL** `CAUSAL_OWNER_STRANDED_NO_PRODUCER · ageMs=49797` |
| `15:09:06 → 15:19:27` | 10+ minuter av enbart `GET_SNAPSHOT`-polling |

Strandet deklarerade "ingen producent" i **samma millisekund** som producenten
claimades, och dödade körningen **95 ms efter** att den blivit redo att fortsätta.

## Tre defekter i v0.12.13

### 1. Ingen producentkontroll
Felkoden heter `CAUSAL_OWNER_STRANDED_NO_PRODUCER`, men koden frågade aldrig om
en producent fanns. En levande `pendingNanoRequest` **är** producenten. Nanos
egen analys tog 49,2 s medan strandets gräns är 45 s — kollisionen är därför
strukturell, inte en kapplöpning: varje Nano-analys som passerar gränsen hade
dödat sin egen körning.

`classifyCausalOwnershipProducer()` klassificerar nu varje delsystem som
legitimt äger nästa steg: `NANO_PENDING`, `SESSION_INIT`, `RESPONSE_CANDIDATE`,
`PENDING_OBSERVATION`, `WAITING_OBSERVATION`, `PREPARED_EFFECT`,
`OPERATOR_PENDING`, `PAGE_GENERATING`. Strandet öppnas bara när ingen av dem
håller turen. Klassificeringen är medvetet generös: en falsk "producent aktiv"
kostar en tick till av väntan, medan en falsk "ingen producent" är exakt det som
dödade 15:08-körningen.

### 2. Strandet rensades bara i den friska grenen
`run.causalOwnershipStrand = null` låg inuti
`if (causalLegacyEffect?.effectId) { if (desynced) {…} else { HÄR } }`. När en
tur avslutas normalt blir `latestEffect(run)` null, hela blocket hoppades över,
och strandet överlevde orört — samtidigt som eskaleringsblocket kördes
**ovillkorligt** varje tick utan att någonsin omvärdera.

Klassificering sker nu före mutation och rensningen är ovillkorlig: den nås när
det inte finns någon legacy-effect alls, när ägarskapet återsynkat, och när en
producent är aktiv.

### 3. `ERROR_TERMINAL` som åtgärd
Ett terminalt tillstånd kräver en människa. För en agent vars hela syfte är
autonomi byter det en tyst deadlock mot ett högljutt stopp — halva jobbet.

Åtgärdsstegen är nu `HOLD → REARM → REARM → RECOVER`. Ingen pinne avslutar
körningen; `CAUSAL_OWNERSHIP_RECOVERY_ACTION` innehåller inget `TERMINALIZE`.

## Åtgärdsstegen

| Läge | Åtgärd |
|---|---|
| Producent aktiv | `CLEAR` — strandet stängs, producenten äger turen |
| Ägarskap återsynkat | `CLEAR` |
| Inom gränsen | `HOLD` — vanlig bearbetning får hela gränsen på sig |
| Över gränsen, budget kvar | `REARM` — engångstillstånd för admission, legacy-anspråket pensioneras |
| Budget slut | `RECOVER` — turen lämnas till `STATES.RECOVERING` |

`REARM` gör tre saker: utfärdar ett `causalOwnershipRearm`-tillstånd bundet till
effect-id och den redan konsumerade response-hashen, pensionerar det strandade
legacy-anspråket (`effectJournal = []`) så nästa tick klassificerar `NO_EFFECT`,
och startar om gränsen. I v0.12.12-incidenten var konsumerad hash `a37a87d6`
och den levande `4bb78cf4` — olika, så en återarmning hade släppt igenom svaret.

Tillståndet konsumeras av **båda** admission-gates. Ett tillstånd som bara en
grind respekterade skulle återinföra exakt den split-brain v0.12.13 skrevs för
att stoppa.

## Återarmningsbudget

Eftersom en `REARM` pensionerar effekten ser nästa tick inget strand alls, och
en strand-lokal räknare skulle nollställas varje gång. Budgeten bärs därför på
run-nivå (`run.causalOwnershipRearmLedger`) och är förankrad i `lastProgressAt`:
återarmningar ackumuleras bara medan körningen **inte** gör framsteg. En
bearbetad observation nollställer stegen, så en frisk körning som träffar
divergensen en gång per dag driver aldrig mot recovery.

## Ändrade filer

- `lib/causal-ownership-liveness.mjs` — producentklassificering, åtgärdsplan,
  återarmningstillstånd, budget-carry-forward
- `background.js` — omstrukturerad kausal preflight, autonom åtgärdsstege,
  tillstånd inkopplat i båda admission-gates
- `lib/state-machine.mjs` — `causalOwnershipRearm`, `causalOwnershipRearmLedger`
- `tests/v0.12.14-autonomy-regression.mjs` — ny svit, 50 assertions
- `tests/v0.12.13-control-plane-regression.mjs` — fyra påståenden justerade:
  gränsen ska fortfarande nås, men terminalisering är inte längre åtgärden

## Verifiering

181 assertions över 7 sviter, 0 fel.

## Kvarstående, ej åtgärdat

Punkt 9 i den ursprungliga analysen — stale Nano-proposals — är fortfarande
inte åtgärdad. Mönstret återkommer i v0.12.13-loggen vid `15:10:54.623`, där
`STORE_CORE_SURFACE_REVIEW_PROPOSAL` avfyras efter att körningen redan var
terminal. Det ligger utanför den kausala kedjan och förtjänar egen behandling.
