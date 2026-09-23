# Greenfield v1.3.7 — Serial Multi-Mission Worker Queue

> **v1.5.1 isolation note:** this historical release used Chrome-window-scoped queue storage.
> Current v1.5.1 runtime uses `workerId`-scoped queue/process ownership; a fresh window starts empty
> and does not adopt another worker queue. See `WORKER_ISOLATION_QUEUE_SETS_PAUSE_V1_5_1.md`.

> **v1.7.4 scheduling supersession:** sections 4, 5, 8 and 11 below describe the historical v1.3.7 policy. Current v1.7.4 uses explicit **ordered cyclic slots**: inner-worker selection follows `order` and wraps after the last runnable slot; per-slot priority belongs to the outer profile-global capacity scheduler and no longer reorders the inner queue. The same saved GFW may occupy multiple slots, unfinished per-slot quantum progress survives early yield/pause/block, and logical GFW continuation is shared across duplicate slots. See `ORDERED_LOOP_QUEUE_V1_7_4.md`.


## 1. Objective

A Greenfield Chrome window is a worker that can service multiple saved missions **serially**
through one managed ChatGPT tab. The worker never runs two mission prompts concurrently inside
the same window. Multiple Greenfield windows remain independent workers coordinated by the
existing profile-global capacity scheduler.

This design reduces simultaneously loaded/active ChatGPT mission conversations while preserving
multi-window throughput as an operator choice.

## 2. Ownership and persistence

Queue state is persisted per Chrome window under the Greenfield local-storage queue key. A queue
item contains the mission identity, saved-mission locator, priority, manual order, interaction
quantum, lifecycle status, optional process snapshot, and restart handoff.

The browser queue is orchestration state only. It does not become the owner of project history,
repository truth, artifacts, memory, or EIC backend state. The final prompt before a yield or
terminal response explicitly tells EIC to persist durable state to the correct owner surfaces.

## 3. Queue lifecycle

Queue item states:

- `READY` — runnable;
- `ACTIVE` — the worker's only active mission;
- `PAUSED` — not runnable until its pause time;
- `DONE` — terminal history;
- `BLOCKED` — terminal/blocker history;
- `STOPPED` — terminal history.

A normalized queue permits at most one `ACTIVE` item and derives `activeItemId` from the actual
active item. A stale active pointer is not retained.

The worker lifecycle is:

1. select the next runnable mission;
2. restore or create the mission process;
3. navigate the managed tab to the EIC GPT root;
4. optionally perform the configured hard reload;
5. verify fresh chat, ready composer, and zero user turns;
6. run the mission up to its interaction quantum;
7. checkpoint via the final normal EIC prompt;
8. park the mission if it will continue later, or move terminal state to history;
9. wait the configured inter-mission switch delay;
10. activate the next selected mission.

## 4. Selection policy

Selection uses:

`effectivePriority DESC -> manual order ASC -> readySinceMs ASC -> itemId ASC`

Priority values are `LOW`, `NORMAL`, `HIGH`, and `URGENT`. Every complete configured aging step
raises effective priority by one level, capped at `URGENT`.

Paused missions become runnable only when `pauseUntilMs` is due.

## 5. Interaction quantum

`maxInteractions` is a mission's completed-interaction budget for one active quantum.

Before each queued prompt, `queueTurnControl` calculates:

- `interactionInQuantum`;
- `maxInteractions`;
- `finalInteractionInQuantum`;
- `checkpointRequired`.

The final allowed interaction is known **before** the prompt is sent. This lets the same useful
work prompt also serve as the checkpoint prompt instead of adding a separate extra ChatGPT turn.

The active mission's `maxInteractions` cannot be changed mid-flight. This prevents the UI from
moving the boundary behind an already composed/sent prompt. Priority may still be changed because
it is non-preemptive.

If the quantum is exhausted but no other runnable queue item exists, the current mission may
continue with a reset quantum rather than perform a pointless chat switch.

## 6. EIC checkpoint contract

Every queued EIC-A2A prompt carries queue-turn metadata. EIC is instructed to persist durable
mission status/knowledge when:

- `checkpointRequired=true`; or
- it returns `DONE`;
- it returns controller `BLOCKED`;
- it returns `YIELD_TO_QUEUE`;
- it returns `PAUSE_PROCESS`;
- it returns `STOP_PROCESS`.

Checkpoint requirements:

- use the correct owner surface for each durable fact/effect;
- use route-native write/readback when available;
- do not dump transient chat, hidden reasoning, or irrelevant context;
- for work that will continue, leave a restart-safe next action/handoff.

`YIELD_TO_QUEUE` is valid only with response status `CONTINUE` and a non-empty next action.

## 7. Chat isolation and hard reload

The **fresh ChatGPT conversation** is the mission isolation boundary.

For queue switching, Greenfield navigates the existing managed tab to the EIC GPT root. It then
requires:

- page load complete;
- content bridge available;
- `userCount === 0`;
- composer ready;
- composer empty;
- no generation in progress.

If a non-fresh chat is observed, the session-rotation path re-navigates before allowing a send.

When enabled, `chrome.tabs.reload(tab.id, {bypassCache:true})` runs after the fresh-chat navigation
as a browser preflight. It is not treated as proof that conversation history was cleared.

## 8. Adjustable operator parameters

Profile-global parameters exposed in the UI:

| Parameter | Range/default | Purpose |
|---|---:|---|
| Prompt-post delay | `0..300 s` | minimum spacing of ChatGPT prompt posts profile-wide |
| Max active Greenfield turns | `1..4`, default `2` | multi-window concurrency ceiling |
| Default mission quantum | `1..50`, default `5` | interactions before queue yield |
| Queue priority aging | `30..3600 s`, default `180` | starvation resistance |
| Inter-mission switch delay | `0..300 s`, default `5` | avoids bursty navigation/bootstrap |
| Hard reload after navigation | on, default | optional browser-state preflight |
| Post-reload settle | `0..30 s`, default `2` | settle before readiness verification |

These are operator settings; changing them does not require rebuilding the extension.

## 9. Multi-window scheduler relationship

The queue is the **inner serial scheduler**. The existing profile-global capacity scheduler is the
**outer scheduler**.

Example: eight saved missions may be split across two Greenfield windows. Each window runs one
mission at a time; the global scheduler independently limits how many ChatGPT turns may be active
across the profile.

During rate-limit cooldown the existing circuit breaker can reduce effective global capacity to
zero. During serial recovery it can reduce capacity to one. Queue state remains durable while a
worker waits.

## 10. Recovery invariants

- no mission switch crosses a prompt side-effect whose outcome is unknown;
- active queue state is persisted and read back;
- mission resume uses the stored process/handoff but starts in a fresh ChatGPT conversation;
- retries/recovery do not intentionally count as completed mission interactions;
- terminal queue items are removed from the active list and retained in bounded history;
- an audit failure stops queue advancement rather than pretending the transition completed.

## 11. Acceptance

Automated package tests cover queue normalization, persistence/readback, duplicate prevention,
priority/aging, pause readiness, quantum boundary, active-quantum immutability, EIC yield
validation, version coherence, UI wiring, fresh-chat verification, optional hard reload, switch
delay, terminal advancement wiring, and retention of the profile-global scheduler.

Automated source tests do not establish live ChatGPT service behavior. Operator live acceptance
should therefore validate at minimum:

1. two or more queued missions serially in one window;
2. fresh ChatGPT conversation at every mission switch;
3. owner checkpoint/handoff before a parked mission is replaced;
4. `DONE` and controller `BLOCKED` disappear from active queue and appear in history;
5. a parked mission resumes without replaying already completed work;
6. rate-limit warning/cooldown leaves queue/process state recoverable;
7. two Greenfield windows can coexist with global capacity first set to `1`, then optionally `2`.
