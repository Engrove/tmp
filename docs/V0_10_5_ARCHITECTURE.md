# v0.10.5 architecture — Autostart transaction integrity

## Purpose

v0.10.5 is a bounded repair release for the v0.10.4 Autostart transaction. It does not change the established mission, capture, TTL, attention, Mjölnar or owner-authority models.

## Contract-owned state versions

`lib/contracts.mjs` owns:

- config schema `eic.autonom.config.v13`;
- config version `13`;
- runtime schema `eic.autonom.runtime.v13`;
- runtime version `13`;
- export schema `eic.autonom.export.v20`;
- export version `20`.

Default creation, load validation and save must refer to the same constants. Literal duplicate state versions in `background.js` are forbidden.

## Autostart phases

1. resolve preset;
2. reject an active non-terminal run;
3. obtain explicit confirmation when required;
4. materialize quick profile, capture policy, mission mode and Mjölnar mode;
5. invoke native LanguageModel creation inside the operator gesture;
6. attach a rejection handler synchronously;
7. persist the exact prepared config;
8. link the active ChatGPT tab;
9. verify selected-tab and controller-surface readback;
10. verify Nano admission;
11. start the mission without a second config save.

A failed phase prevents later phases. A mission is never started without tab/controller readback and a ready Nano host when the selected preset requires Nano.

## D1/D2 confirmation

D1 and D2 use two explicit sidepanel clicks. The first click arms the exact preset for 30 seconds. The second click is the native model-activation gesture. A changed preset or expired confirmation requires re-arming.

## Error handling

The model activation promise is converted into a handled outcome immediately. Later config/link operations cannot leave an immediate activation rejection unobserved.

## Boundaries

This architecture is source/package behavior. Installed Desktop Chrome behavior remains pending until the v0.10.5 acceptance matrix is executed.
