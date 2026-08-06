# Verifiering — v0.7.6

## Automatiska kontroller

- Fokuserat test: `node --test tests/v076-field-isolation.test.mjs`
- Full svit: `npm test`
- Strukturvalidator: `npm run validate`
- Paketering: `npm run package`
- ZIP CRC verifieras av packager för installations- och källarkiv.

## Regressioner

`tests/v076-field-isolation.test.mjs` verifierar:

1. exakt observerad korrupt sträng avvisas;
2. `buildTurnObject()` avvisar strängen oberoende av sidepanelgrinden;
3. vanlig prosa som nämner `requestedAction` utan fältsyntax tillåts;
4. `normalizeDecision()` använder den gemensamma grinden.

Förväntat totalresultat: 345 tester, 0 fel.

## Manuell runtimekontroll

Se `DESKTOP_CHROME_ACCEPTANCE_V0_7_6.md`. Automatisk testning bevisar parser-, konstruktions- och paketinvarianterna men inte aktuell ChatGPT-DOM eller Chrome Prompt API-runtime.
