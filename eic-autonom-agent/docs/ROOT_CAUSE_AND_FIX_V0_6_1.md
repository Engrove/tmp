# Root Cause and Fix — v0.6.1

## Incident

En kopplad målchat avslutade med ett komplett svar:

```text
Status: CONTINUE
EIC_NEXT: Låt den ägande trusted sessionen terminalisera generation 48; återläs därefter lock, work package, publication receipt och Forgejo branch/commit.
EIC_COMPLETION_EVIDENCE: NONE
EIC_AUTONOMY: CONTINUE
```

Sidepanelen stod ändå kvar i `WAITING_FOREGROUND` och loggade att ingen ny prompt skickades.

## Rotorsak A: foreground starvation

v0.6.0 använde en synlig Stop-knapp som global generationssignal. En stale, fel-scopad eller ännu renderad Stop-kontroll kunde därför ge `generating=true` även efter att senaste assistantsvaret var komplett.

Backgroundflödet returnerade direkt på `GENERATING_FOREGROUND`:

```text
read page → classify foreground → WAITING_FOREGROUND → return
```

Följande steg nåddes aldrig:

```text
stable response → parse EIC trailer → Nano/fallback → Mjölnar → next prompt
```

### Fix

- Stop-kontroll scopeas till composer/main.
- Kontroller i assistant/user messages, egen EIC UI, hidden/inert eller disabled exkluderas.
- Assistant-streaming och composer-busy mäts separat.
- En terminal EIC-trailer kan sätta `protocolCompletionOverride` när ingen verklig streaming/composer-busy finns.
- `classifyChatGptPage()` har explicit `COMPLETE_PROTOCOL_OVERRIDE`.

## Rotorsak B: Mjölnar-proveniens var omöjlig

v0.6.0 skapade `localMjolnarCandidate()` med:

```text
sourceClass = NANO_PROPOSED
```

Men `handleMjolnarCandidateUnlocked()` accepterade endast:

```text
sourceClass = LOCAL_STATE_MACHINE
```

Alla Nano-genererade Mjölnar-förslag blev därför `HUMAN_REQUIRED` före allowlist, riskklassificering och dispatch.

### Fix

Nano-text förblir opålitlig kandidatdata. Den lokala state machine skapar en trusted trigger först efter att:

1. action code finns i statisk `ACTION_REGISTRY`;
2. exakt target resolverats lokalt;
3. owner surface och readbackplan bundits;
4. destruktivitetsnivå klassificerats;
5. idempotency key skapats.

Den executable kandidaten får därefter `LOCAL_STATE_MACHINE`. Nano kan fortfarande inte skapa permission, owner-evidens eller extern Hjalmar PASS.

## Rotorsak C: PAUSE hade fel semantik

Flera recoverable tillstånd översattes direkt till `SOFT_PAUSED`, `HARD_BLOCKED` eller `HUMAN_REQUIRED`: no-progress, missing Nano host, groundingfel, checkpoint, dead end, okänd Mjölnar-readback och modellens PAUSE.

Det gjorde “fail-closed” liktydigt med “sluta arbeta”, trots att ett säkert owner-read/replan ofta fanns.

### Fix

`EIC_DESTRUCTIVENESS/1` separerar:

- **säkert att fortsätta autonomt** (1–5);
- **kräver extra lokal kontroll men inte människa** (6–9);
- **kräver mänsklig auktoritet** (10).

`resolveAutonomousPause()` konverterar PAUSE under nivå 10 till konkret target `EIC_NEXT`, requested action, tekniskt distinkt alternativ eller owner-read fallback. `READ_REQUIRED` är en aktivitet, inte en mänsklig blockerare.

## Rotorsak D: deterministic fallback var avstängd

Vid tillfällig Nano-host-frånvaro stoppade v0.6.0 även när den lokala parsern redan hade ett komplett turn-bundet `EIC_AUTONOMY: CONTINUE` och `EIC_NEXT`.

### Fix

v8 aktiverar deterministic protocol fallback. Den:

- accepterar endast lokal parseroutput för komplett kontrakt;
- behandlar `EIC_NEXT` som target claim/continuation-data;
- riskklassificerar texten lokalt;
- lägger owner-read framför nivå 6–9 när kontrollfält saknas;
- vägrar nivå 10;
- påstår aldrig att targettext är owner-evidens.

## Säkerhetsinvarianter

Följande är oförändrat fail-closed:

- direkt operatörs-Stop/Paus;
- auth/CAPTCHA/user-presence;
- secrets/credentials;
- irreversibel eller okänd-blast-radius destruktion;
- okänd/ändrad target-identitet;
- storage circuit breaker;
- blind retry efter okänd nivå-10-effekt.
