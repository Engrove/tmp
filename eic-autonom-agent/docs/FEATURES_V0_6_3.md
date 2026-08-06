# Features — EIC Autonom Agent v0.6.3

## Revision-storm protection

- Beständig `ARMED/DISPATCHED`-gate för deterministic callback.
- Högst två callback-dispatchförsök.
- 15-sekunders callback-lease.
- Inga durable writes från watchdog/content-ticks medan callbacken redan äger requesten.
- Identiska audit-events coalescas med `repeatCount`.

## Deterministic source exhaustion

- Protocol/recovery-source får en lokal repair.
- Ett återstående groundingfel terminaliserar sourceförsöket.
- Samma observation återarmas inte omedelbart.
- Färsk owner-state eller ny response identity krävs före nytt beslut.

## Concrete action grounding

Stöd för bland annat:

- `reconcile`, `recreate`, `create`, `publish`;
- `materialize`, `restore`, `rebuild`, `prepare`, `stage`, `apply`;
- `commit`, `branch`;
- dotted owner routes;
- snake-case locators;
- `verify_remote=true`;
- status/result/hash/digest/receipt/locator/delta/parity/readback.

## Protocol fast path

Ett validerat turn-bundet `EIC_AUTONOMY: CONTINUE` med konkret `EIC_NEXT` får fortsätta deterministiskt utan att Nano blir ett obligatoriskt mellanled.

## Bounded deterministic repair

När actionen är för abstrakt men kan repareras utan ny authority:

- exact tab/conversation target binds;
- owner-read/reconcile görs explicit;
- observerbart outputkontrakt läggs till;
- target claim hålls skild från owner evidence.

## Mjölnar state integrity

- Semantisk riskbedömning: `CANDIDATE_DETECTED`.
- Saknad nivå 6–9-kontroll: `READ_REQUIRED`.
- Faktisk delegerad action: dispatchstates.
- Endast matchande readback: `VERIFIED_EFFECT`.

## Autonom PAUS-adjudikering

- Nivå 1–5 fortsätter.
- Nivå 6–9 kör lokal Hjalmar mental control och owner-read.
- Endast nivå 10 eller direkt operatörsingripande skapar verklig PAUS.
- Workbench/Workspace/work package/lock/lease är högst nivå 5 utan separat nivå-10-signal.

## Durable import recovery

v0.6.2-exporter med:

- `ASSESSING`;
- `DETERMINISTIC_PENDING`;
- gamla requestfält utan dispatchstate;
- `GROUNDING_REJECTED: META_ONLY_ACTION`;
- hög stateRevision;

kan importeras. Saknade v0.6.3-fält defaultas säkert och samma giltiga turn-resultat behandlas en gång.

## Förbjudna effektiva stopp

Följande får inte ensamt stoppa appen:

- Nano parse/groundingfel under nivå 1–9;
- en meta-only-felklassificering som kan repareras lokalt;
- stale callback utan okänd effekt;
- Workbench-/owner-fencing;
- saknad kandidatbranch;
- owner-read som returnerar NOT_FOUND;
- checkpointgräns;
- promptrepetition där distinkt owner-read/replan finns.

Följande förblir verkliga stopp:

- direkt operatörs-Stop/Paus;
- auth/CAPTCHA/user-presence;
- secrets/credentials;
- irreversibel eller okänd blast-radius destruction;
- materiellt safety/policy-undantag;
- okänd tidigare nivå-10-effekt.
