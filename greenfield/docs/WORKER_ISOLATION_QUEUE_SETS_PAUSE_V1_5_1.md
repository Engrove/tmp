# Greenfield v1.5.1 — worker isolation, named queue sets, and mission-pause precedence

## 1. Ownership model

v1.5.1 separates identities that v1.5.0 could accidentally conflate:

- `workerId`: random Greenfield-worker identity for the current browser lifecycle;
- `windowId`: transient Chrome attachment only;
- `queueId`: durable identity of one worker queue record;
- `itemId`: one queue incarnation of a mission;
- `processId` + `runId` + `generation`: one runtime lineage/incarnation.

A worker binding is stored in `chrome.storage.session` in both directions:

- `eic.gf.worker-binding.window.<windowId>`
- `eic.gf.worker-binding.worker.<workerId>`

This survives Manifest V3 service-worker suspension while a Chrome session remains live. Closing a
window releases both bindings. A newly created browser/window lifecycle gets a new `workerId`.

## 2. Queue and process isolation

Worker queues are stored at:

`eic.gf.mission-work-queue.worker.<workerId>`

Process state is stored at:

`eic.gf.process.worker.<workerId>`

Legacy `eic.gf.mission-work-queue.window.<windowId>` and
`eic.gf.process.window.<windowId>` records are never runtime ownership sources in v1.5.1. They are
left untouched as quarantined historical bytes.

There is no "empty new window -> newest orphan queue" rule. A missing worker queue means a new empty
queue.

The profile-global queue registry is metadata-only and serialized in-process. It records worker,
queue revision, current window attachment, item count, active-item id, enabled state and update time.
It does not mirror queue item/process snapshot bodies.

Each worker queue also carries an optimistic `revision`. A save is accepted only when the caller's
revision matches the currently stored worker queue. Concurrent same-worker read/modify/write paths
therefore cannot silently lose an update: one revision advances and a stale contender fails closed
with `MISSION_WORK_QUEUE_STALE_WRITE`. The in-process serialization tail consumes expected
rejections so this fail-closed path does not leak an unhandled promise rejection.

## 3. Runtime lineage

A queue item may resume a `processSnapshot` only when the snapshot's `workerId` exactly matches the
queue `workerId`. A mismatched or legacy snapshot is treated as a continuation hint only and a fresh
`processId`/`runId` is created.

Current-operation tokens compare:

`workerId + processId + runId + generation`

The process store enumerates only process records whose worker has a valid two-way live
`chrome.storage.session` binding.

## 4. Side-panel and wake fencing

Protected side-panel mutations send `workerId` together with `windowId`. Background verifies the
current binding before start/stop, queue mutation, queue-set mutation, instruction, scheduler,
settings and force-tick effects.

Mission queue wake alarms encode both `workerId` and `windowId`. The alarm handler verifies the
current session binding before waking a queue. A stale alarm from a closed worker therefore cannot
act on a new worker that later receives the same numeric Chrome window id.

## 5. Named queue sets

The Missions tab exposes **Sparade kö-set**:

- save current queue as a named set;
- apply a selected set to a stopped/idle worker;
- delete a named set.

Store key:

`eic.gf.mission-queue-sets.v1`

A set is configuration-only. Each template item stores:

- saved mission id;
- label;
- mission text/goal;
- priority;
- max interactions/quantum;
- order.

Applying a set creates new queue item IDs and forces every item to `READY`. It strips:

- process snapshots;
- resume/checkpoint state;
- mission-pause state;
- delegation runtime state;
- blocker/error state;
- activation/completion timestamps and outcomes.

Set writes are serialized to prevent lost updates from simultaneous Greenfield windows.

## 6. `PAUSE_PROCESS` precedence

v1.5.0 could evaluate a queue quantum/yield before the normal mission-pause transition. For a
queue-managed mission, `PAUSE_PROCESS` could therefore be parked and another queue item activated
instead of holding the worker.

v1.5.1 applies this ordering:

1. if `sessionAction == PAUSE_PROCESS`: **hold current mission for process pause**;
2. otherwise if `sessionAction == YIELD_TO_QUEUE`: park and switch;
3. otherwise if queue quantum is exhausted: park and switch;
4. otherwise continue current mission.

`PAUSE_PROCESS` is therefore stronger than quantum expiry. `pauseSeconds: 600` produces a not-before
wake exactly 600,000 ms after the pause record's owner time. No autonomous Greenfield prompt is
admissible through the mission-pause path before that point unless the operator explicitly uses the
manual early-resume control.

## 7. Migration boundary

Automatic v1.3.9 orphan queue recovery is intentionally removed. It could not prove whether a new
Chrome window represented the same logical worker or a different parallel worker, so it violated
the stronger isolation invariant.

Named queue sets are the safe reusable configuration mechanism for new workers. Runtime continuation
within a still-live browser session remains worker-bound through `chrome.storage.session`.

## 8. Acceptance boundary

Automated source/unit/static/syntax tests can verify ownership rules, deterministic state
transitions, concurrency handling and pause arithmetic. They cannot prove the operator's installed
Desktop Chrome/ChatGPT wall-clock behavior. Live multi-window and 600-second timing acceptance is a
separate external runtime acceptance step.
