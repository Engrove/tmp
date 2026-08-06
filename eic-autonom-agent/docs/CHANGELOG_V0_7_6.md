# Changelog — v0.7.6

## Fixed

- Avvisar `workUnit` som innehåller ett serialiserat syskonfält som `requestedAction:`.
- Delar samma isoleringsgrind mellan `normalizeDecision()` och `buildTurnObject()`.
- Lägger till exakt incidentregression och positivt prosakontrollfall.

## Preserved

- Addonen skapar aldrig en ny ChatGPT-flik eller session.
- APP_AUDIT_LONG använder endast användarförberedd, vald session.
- v0.7.5:s säkerhets-, continuity-, budget-, trailer- och Mjölnargrindar är oförändrade.
