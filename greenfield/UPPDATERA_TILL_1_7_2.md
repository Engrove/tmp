# Uppdatera Greenfield till 1.7.2

## Syfte

1.7.2 rättar ett flerturns-causality/liveness-fel i 1.7.1. När `lastPrompt` från turn N−1 och `pendingPrompt` för turn N fanns samtidigt kunde den äldre promptens user-turn-identitet väljas. Då kunde prompt N vara skickad och ha ett färdigt assistantsvar medan Greenfield stod kvar i `WAITING` och återläste N−1.

Versionen rättar samtidigt tre observerade följdfel: kollapsande `Uppdrag och identitet`, stale model/reasoning-hold och inkonsekvent `controlValid` för fullständigt A2A-svar. Hjalmar-handoff görs icke-förlustbringande utan att ta bort Hjalmars bounded-context-kontrakt.

## Vad som ändras

- `lib/turn-causality.mjs`: lifecyclefasen avgör om `pendingPrompt` eller `lastPrompt` äger turnen.
- `lib/dispatch-reconciliation.mjs`: aktuell dispatchs `materializedUserTurnId` prioriteras framför härledd turn-proof.
- `lib/continuation-guard.mjs`: strikt prefixförkortning av kanonisk target-handoff återställs dynamiskt.
- `lib/hjalmar-d2.mjs`: bounded preview kompletteras med faktisk längd och completeness-flagga.
- `lib/safety-hold-reconciliation.mjs`: exakt kopplad stale modelproof-hold kan rensas av färsk allowed proof; övriga holds bevaras.
- `lib/panel-details-state.mjs` + `sidepanel.js`: öppna fleet-details följer stabil process-/workeridentitet genom omrendering.
- `lib/response-contract.mjs`/`background.js`: full schema-valid A2A är också control-valid i continuation metadata.
- `tools/replay-multiturn-audit.mjs`: generisk NDJSON-replay för tidigare-turn-bindning.
- `tests/v172-multiturn-liveness.test.mjs`: dynamiska multi-turn-regressioner med runtime-genererade identiteter.

## Installation

1. Pausa nya utskick.
2. Säkerhetskopiera nuvarande uppackade 1.7.1-mapp.
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.7.2.zip`.
4. Kopiera över samma Chrome-extensionmapp.
5. Läs in tillägget igen i `chrome://extensions`.
6. Kontrollera `v1.7.2`.
7. Återgå till rätt managed EIC-konversation.
8. Gör inte manuellt omskick av en tidigare osäker dispatch; låt recovery/reconciliation avgöra faktisk effekt.

## Acceptans

Kör minst tre autonoma turns. För varje turn ska:
- aktuell `SENDING` dispatch få sin egen materialiserade browser-turn;
- `WAITING` endast acceptera det kausalt kopplade assistantsvaret;
- tidigare turn-ID aldrig vinna när aktuell materialiserad turn finns;
- ett redan färdigt aktuellt assistantsvar inte ge tyst vänteloop.

UI-kontroll: expandera `Uppdrag och identitet` och låt minst flera statusrefreshes passera.

Safety-kontroll: en stale modellhold får endast rensas efter färsk allowed proof för samma tidigare modelproof-orsak.

## Rollback

Om 1.7.2 måste återställas:
1. pausa nya utskick;
2. återställ den säkerhetskopierade 1.7.1-mappen över samma extension-ID;
3. läs in tillägget igen;
4. gör inga blinda omskick av dispatch vars effekt är okänd.

Återställning av programfiler ändrar inte i sig redan existerande ChatGPT-turner eller beständig Greenfield-state.
