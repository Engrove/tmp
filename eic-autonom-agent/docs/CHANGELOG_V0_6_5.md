# Changelog — v0.6.5

## Fixed

- Protocol parser accepts a unique contiguous EIC trailer followed by bounded benign DOM text.
- Content script no longer requires an undocumented `Status:` line.
- Explicit zero Nano section budgets remain zero.
- Nano prompt assembly converges to the requested character ceiling.
- Full anti-loop histories no longer dominate Nano decision context.
- Nano inference is blocked when the measured input remains over budget.
- Clone-capable sessions use base-session context usage for budget resolution.
- Nano request dispatch is protected by a synchronous token-owned lock.
- Sidepanel errors are written to durable audit.
- Swedish destructiveness terms are classified; unknown non-empty actions fail closed.
- `release` no longer triggers the workbench `lease` cap by substring.
- Lifecycle deadline extension is cumulative and capped.
- `recoveryBudget` and `consecutiveNoProgress` are active.
- Eight stagnant cycles require operator handoff.
- LanguageModel input/output languages include Swedish and English.

## Tests

Added incident-focused regression tests for:

- zero/small section budgets;
- 2,400-character incident prompt;
- trailing DOM text and duplicate protocol markers;
- Swedish merge authorization and unknown actions;
- atomic dispatch-lock ownership;
- lifecycle extension cap;
- eight-cycle handoff;
- browser-entrypoint wiring for budget, audit and protocol fixes.

## Compatibility

- Manifest V3.
- Storage, config, runtime and export schemas remain v8.
- Existing compatible v8 exports remain importable.
- Runtime version is 0.6.5.
