# EIC Autonom Agent v0.8.2 — changelog

## Fixed

- Isolated durable continuity per Chrome window/run.
- Prevented cross-window and cross-run intent, claim, blocker and completion bleed.
- Preserved ARCHAEOLOGY_LONG and APP_AUDIT_LONG across same-target pause/resume and
  Stop→Start/Continue.
- Blocked silent specialized-mode transfer to another tab or conversation.
- Preserved operator/start-analysis intent against takeover inference.
- Promoted continuity locators together with ChatGPT `g:`→`c:` conversation promotion.
- Added a 180-second hard Nano wall-clock timeout with abort/reset handling.
- Prevented specialized-mode Nano analysis on incomplete dynamic-stability snapshots.
- Separated evidence requirements from executable next directions.
- Reconciled historical unconfirmed start receipts from later matching assistant replies.
- Reduced dependence on rendered assistant-node counts.
- Synchronized export schema and top-level version to v10.

## Added

- `lib/scoped-continuity.mjs`
- `lib/response-completion-policy.mjs`
- `lib/start-receipt-reconcile.mjs`
- v0.8.2 runtime-isolation regression suite.

## Unchanged

- Generic continuation defaults.
- Existing Nano and target mandates unless a profile is explicitly selected.
- ARCHAEOLOGY_LONG effect ceiling and research-only contract.
- APP_AUDIT_LONG contract.
- USER_PAUSE level-10 semantics.
- Host permissions and Chrome permission allowlist.
