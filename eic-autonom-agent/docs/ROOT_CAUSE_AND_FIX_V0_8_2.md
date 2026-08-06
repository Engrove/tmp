# EIC Autonom Agent v0.8.2 — root cause and fix

## Scope

v0.8.2 is a bounded runtime-correctness release. It does not redesign the v0.8.1
continuation protocol, ARCHAEOLOGY_LONG research contract, APP_AUDIT_LONG, core-profile
selectors, Mjölnar, or USER_PAUSE.

## Incident evidence

A v0.8.1 runtime export and browser transcript showed:

1. continuity from another work context inside the active research window;
2. ARCHAEOLOGY_LONG changed to WAITING_CONTINUE after Stop followed by generic
   Start/Continue;
3. a start-analysis research intent replaced by a takeover-derived release intent after
   ChatGPT promoted a `g:` locator to a `c:` conversation locator;
4. Nano streams lasting several minutes without a wall-clock abort;
5. Nano starting on a temporarily stable but incomplete specialized-mode response;
6. required evidence reused as a recovery action;
7. a delivered start prompt remaining `SUBMITTED_UNCONFIRMED`;
8. count-based session-init logic exposed to ChatGPT DOM virtualization;
9. export schema `v9` paired with top-level version `8`.

## Root causes

### Global continuity singleton

Runtime state was window-scoped under `runtime.windows`, but continuity was read and
written through one storage singleton. A second window or run could therefore inherit
intent, claims, blockers, anti-loop data or completion state from an unrelated context.

### Non-sticky specialized mode

Generic Start/Continue always created `WAITING_CONTINUE`. The runtime research ceiling is
conditional on `run.mode === ARCHAEOLOGY_LONG`, so the ceiling disappeared even though
research constraints remained in prompt text.

### Locator-promotion/takeover conflict

The start receipt learned the post-submit conversation locator, but durable continuity did
not. Generic takeover then treated the promoted conversation as ungrounded and was allowed
to replace the established start-analysis intent.

### Missing hard Nano deadline

Output-size and chunk-count ceilings did not bound elapsed time. A slow or stalled stream
could keep the panel occupied for an unbounded period.

### Dynamic stability in specialized modes

Repeated hash stability was sufficient to start Nano even while an assistant response was
not confirmed complete. This is useful for generic continuation but unsafe for long
research and audit modes.

### Mixed action and evidence queues

Start-analysis `requiredEvidence` was stored in `nextDirections`. Deterministic recovery
could therefore select an evidence specification as the next executable action.

## Fixes

- Continuity is stored inside each window context and bound to window, run and conversation.
  The old singleton is migration input only and is adopted only on an exact conversation
  match or an unambiguous empty legacy context.
- ARCHAEOLOGY_LONG and APP_AUDIT_LONG are sticky across same-target pause/resume and
  Stop→Start/Continue. A changed tab or conversation blocks silent specialized-mode reuse.
- `g:`→`c:` promotion updates both receipt and scoped continuity locator.
- TAKEOVER_BOOTSTRAP may initialize an empty/takeover-owned intent but cannot replace an
  operator or start-analysis-owned intent.
- Nano has a 180-second wall-clock deadline, abort request and host reset path.
- Specialized modes require strict assistant completion or protocol-completion override
  before Nano analysis.
- Evidence requirements have a separate durable collection and are not recovery actions.
- A later matching assistant response reconciles an unconfirmed start receipt.
- Session-init progression prefers stable response identity/hash over rendered assistant
  counts.
- Export contract is `eic.autonom.export.v10` with top-level version `10`.

## Compatibility boundary

Existing config/runtime schema version 8 and continuity schema version 2 remain readable.
The new continuity scope and evidence-requirement fields are additive. Historical
compatibility profile IDs remain internal and existing default behavior is retained for
generic continuation mode.
