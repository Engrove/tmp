# Verification v0.12.9

This document describes candidate-level verification. It is not Desktop Chrome
runtime acceptance.

## Focused regression

Run from the extracted package root:

```text
node tests/v0.12.9-repair-regression.mjs
```

Expected result: 29 PASS, 0 FAIL.

The suite covers strict nullable ids, UI/mission/CDP/continuity id behavior,
autostart/reload fail-closed behavior, browser-action/risk identity, repeated
transcript turns, virtualized transcript dedupe, schema-source-of-truth,
single-flight initialization, window-scope persistence, read/write separation,
import/rollback commit ordering, CDP compensation, PAUSE/STOP capture
preemption, auto-capture cleanup, capture pointer ordering, sidepanel response
ordering, audit/log serialization, window removal and release identity.

## Static gates

Release generation also runs:

- Node syntax check for every `.js` and `.mjs` shipped in the package.
- Relative import resolution scan.
- Named local import/export binding scan.
- Exact SHA-256 manifest generation and readback for every packaged file except
  `build-info.json`.

## Claim boundary

`desktopChromeAcceptance` remains `NOT_RUN` until the exact packaged v0.12.9
candidate is installed and exercised in Desktop Chrome. Candidate PASS does not
claim live browser runtime acceptance.
