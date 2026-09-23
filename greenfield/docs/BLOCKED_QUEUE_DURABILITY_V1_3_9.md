# EIC Autonom Agent Greenfield v1.3.9 — blocked queue continuity and persistence

> **Historical behavior superseded by v1.5.1:** the automatic orphan-window queue rebind and
> legacy per-window migration described in this document are no longer runtime behavior. v1.5.1
> uses worker-scoped identity and quarantines legacy window-keyed state to prevent cross-window
> contamination. See `WORKER_ISOLATION_QUEUE_SETS_PAUSE_V1_5_1.md`.


## Purpose

v1.3.9 restores the work-queue semantics required for autonomous Greenfield operation:

- `BLOCKED` means temporarily parked and reprioritized, not removed from the mission queue;
- `DONE` remains completed and never becomes runnable again;
- the queue survives service-worker/browser/extension lifecycle changes even when Chrome assigns
  a replacement window id;
- queue base parameters persist instead of being rewritten to the previous/default values during
  save.

## Queue state semantics

The mission work queue uses these operational meanings:

- `READY` — runnable;
- `ACTIVE` — the one mission currently owned by the worker;
- `PAUSED` — retained and runnable after its pause timestamp;
- `BLOCKED` — retained and temporarily non-runnable until its retry timestamp;
- `DONE` — terminal history;
- `STOPPED` — terminal history;
- `FAILED` — terminal audit/integrity failure history.

A controller-level process `BLOCKED` phase remains terminal for that particular ChatGPT process.
Before the process is released, Greenfield writes a queue checkpoint containing the process
snapshot, resume record, blocker summary/error and retry timestamp. The queue item itself remains
active queue state.

The retry cooldown reuses the configured queue priority-aging interval. That makes the blocker
temporary without creating an immediate blocker/retry hot loop. When another runnable mission
exists, that mission is selected first. When the retry timestamp becomes due, the existing
mission-queue wake alarm makes the blocked item runnable again.

## Upgrade migration

Stored `eic.greenfield.mission-work-queue.v1` queues are migrated on read.

- historical retryable `BLOCKED` entries are returned to the active queue;
- migrated blockers receive a recovery objective that requires current owner-state readback and
  forbids repeating verified completed work;
- historical `DONE` entries remain history;
- historical audit-failure records that used the old `BLOCKED` label are normalized to terminal
  `FAILED` history.

This migration is necessary because v1.3.7/v1.3.8 removed controller `BLOCKED` items from the
active queue.

## Durable queue registry

The original queue storage key is window-scoped:

`eic.gf.mission-work-queue.window.<windowId>`

Chrome may assign a new window id after restart, so that key alone is not a stable logical worker
identity. v1.3.9 therefore mirrors queue snapshots into:

`eic.gf.mission-work-queue.registry.v1`

The registry stores the stable `queueId`, its last window binding, the normalized queue snapshot
and update time. Queue writes persist the window key and registry in the same storage operation
and verify both on readback.

When a window has no non-empty exact queue, Greenfield compares registry/legacy bindings with the
currently live Chrome window ids. A queue bound only to a vanished window may be rebound to the
current worker window. A previously `ACTIVE` item is converted to `READY` during such a rebind so
it cannot remain permanently tied to a vanished process/window. Its restart objective instructs
EIC to re-read current owner state and continue from durable state.

Multiple live Greenfield windows remain isolated: a queue bound to another currently live window
is not adopted.

## Queue base-parameter save bug

The side-panel save handler previously did this in the wrong order:

1. mark settings busy;
2. render;
3. read the form.

The render function writes `state.operatorSettings` back into the controls. Therefore step 2
could overwrite the operator's edited values before step 3 read them, causing the save request to
submit the previous/default values.

v1.3.9 captures all queue-setting form values first, then renders the busy state, sends the
captured patch, and finally renders the owner readback. The existing operator-settings module
continues to normalize and persist the values in `chrome.storage.local`.

## Verification

The v1.3.9 regression set covers:

- blocked item remains in active queue;
- other runnable work wins while blocker cooldown is active;
- blocked item becomes runnable after cooldown;
- legacy blocked history is migrated back to active queue;
- `DONE` remains terminal history;
- legacy audit failure remains terminal as `FAILED`;
- durable queue registry rebinds an orphaned queue to a recreated window;
- rebound `ACTIVE` becomes `READY`;
- queue base parameters round-trip through profile-local operator settings;
- UI captures the edited queue settings before busy-state rendering.

Automated source/unit/static/syntax tests do not constitute live Desktop Chrome/ChatGPT
acceptance. Installed runtime acceptance remains separate.
