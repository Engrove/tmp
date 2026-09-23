# Priority Capacity Scheduler — Greenfield v1.3.6

## Goal

Bound the number of ChatGPT turns that Greenfield can keep in flight across one Chrome profile
without forcing every Greenfield session to run strictly one-at-a-time.

Normal default:

- configured capacity: `2`;
- operator range: `1..4`;
- one managed process per Chrome window;
- every individual process remains serial.

## Two independent concurrency controls

### 1. Prompt send lease

The existing profile-global send lease protects the page-effect boundary. It allows only one
Greenfield process to perform the actual composer/post effect at a time.

### 2. Active-turn capacity

`lib/global-capacity-scheduler.mjs` owns the longer-lived ChatGPT turn slots. A process acquires a
slot immediately before dispatch preparation and retains it through `WAITING` until the causally
paired completed assistant response is committed as `RESPONSE_CAPTURED`.

Local `ANALYZING`, Nano and Hjalmar work do not consume a ChatGPT slot.

## Priority

Base priorities:

| Value | Rank | UI |
| --- | ---: | --- |
| `LOW` | 0 | Låg |
| `NORMAL` | 1 | Normal |
| `HIGH` | 2 | Hög |
| `URGENT` | 3 | Brådskande |

Priority is process-local and non-preemptive. An operator change affects the next scheduling
decision but never aborts a ChatGPT turn already in progress.

## Starvation prevention

A strict priority queue can starve lower-priority work. v1.3.6 therefore computes:

`effectiveRank = min(URGENT, baseRank + floor(waitMs / 180000))`

The scheduler then orders waiters by:

1. `effectiveRank` descending;
2. `readySinceMs` ascending;
3. `ticketSeq` ascending;
4. `processId` lexical as a deterministic final tie-break.

Consequences:

- `HIGH` reaches effective `URGENT` after 3 minutes;
- `NORMAL` reaches effective `URGENT` after 6 minutes;
- `LOW` reaches effective `URGENT` after 9 minutes;
- once an older low-priority waiter reaches the same effective level as later urgent arrivals,
  the older `readySinceMs` wins.

Therefore later high/urgent arrivals cannot indefinitely overtake an already-waiting low-priority
session, provided active slots eventually release and the process remains runnable. The guarantee
is about scheduler admission, not a promise that ChatGPT itself will finish a turn within a fixed
wall-clock time.

## Capacity and rate-limit state

The v1.3.5 rate-limit state machine remains authoritative:

| Rate-limit state | Effective scheduler capacity |
| --- | ---: |
| `NORMAL` | operator configured `1..4` |
| `COOLDOWN` | `0` new turns |
| `SERIAL_RECOVERY` | `1` |

Capacity changes are non-preemptive. If two turns are active when effective capacity is lowered to
one, both are allowed to finish; no third turn starts until active count is below the effective
limit.

## Persistence and restart

Scheduler state is stored under:

`eic.gf.global-capacity-scheduler.v1`

On MV3 service-worker hydration Greenfield reconstructs active-turn ownership before hydrated
process ticks:

- `WAITING` is treated as an active ChatGPT turn;
- `SENDING`/`RECOVERING`/`DETACHED` with a dispatch that may have crossed the side-effect boundary
  is conservatively treated as active;
- only previously persisted capacity waiters whose current process/prompt still matches are
  restored as waiters;
- stale scheduler records are removed by reconciliation.

This keeps restart recovery compatible with the existing exact-once rule.

## Wake-up model

A capacity denial does not start a new one-second polling loop. The process remains durable and
is awakened when:

- an active turn releases a slot;
- priority changes;
- configured/effective capacity changes;
- the existing 30-second watchdog provides fallback reconciliation.

Existing prompt-pause/rate-limit timing retries are capped at 30 seconds rather than one second
where the caller is waiting for a known future gate time.

## Release rules

A scheduler slot is released when:

- the causally paired completed assistant response is captured;
- dispatch is proven to have had no effect;
- final gate revalidation aborts before any page effect;
- the operator stops/cancels the process.

If dispatch effect is possible or transport status is unknown, the slot remains held and the
existing exact-once reconciliation path decides what happened. Unknown effect is never converted
into free capacity merely to keep the queue moving.

## Operator UI

The side panel exposes:

- `Max parallella Greenfield` (`1..4`, default `2`) for the Chrome profile;
- per-session priority (`Låg`, `Normal`, `Hög`, `Brådskande`);
- scheduler readback showing active/effective/configured capacity, waiting count, queue position
  and effective aged priority when applicable.

## Acceptance boundary

Deterministic tests cover capacity, priority ordering, aging, non-preemption and restart
reconciliation. Source/package verification cannot prove ChatGPT's current service-side rate
limits. Final live acceptance therefore requires an operator-run Desktop Chrome test with multiple
Greenfield windows.
