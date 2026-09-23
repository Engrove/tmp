# Greenfield v1.7.4 — Ordered Cyclic Queue

## Purpose

This release changes the worker-local mission queue from priority-first selection to an explicit ordered cyclic slot list.

The contract is intentionally split:

- **inner scheduler (one Greenfield worker):** explicit queue slot order;
- **outer scheduler (Chrome profile):** active slot priority and global capacity.

A slot priority therefore never jumps ahead of another slot inside the same worker.

## Slot versus logical GFW identity

Each queue row is a scheduling slot:

```text
slot identity       = itemId
logical saved GFW   = savedMissionId
slot scheduling     = order + priority + maxInteractions + quantumProgress
logical continuity  = processSnapshot + resume
```

The same `savedMissionId` may appear in several slots. Each duplicate slot has its own position, priority, quantum and quantum-progress state. The newest logical mission checkpoint/resume is propagated across those slots so the second occurrence continues the same GFW instead of replaying `MISSION_START`.

Delegation request IDs retain exact-once semantics and are not made duplicable by this change.

## Ordered cyclic selection

Runnable slots are considered by:

```text
order ASC -> itemId ASC
```

After a slot yields, pauses, blocks, exhausts its quantum or terminates, the persisted `cursorOrder` points at the slot just left. Greenfield selects the first runnable slot after that position. If none exists after it, selection wraps to the first runnable slot.

This continues while the queue is enabled and at least one slot is runnable.

Paused and blocked slots are skipped until their owner-time wake/retry boundary. Skipping a temporarily unavailable slot does not reorder the stored queue.

## Quantum contract

`maxInteractions` is the configured interaction quantum for one queue slot.

A slot starts a new full quantum at `0/max` only after its previous quantum was actually completed. Early scheduling interruptions do not silently grant a fresh quantum:

- `YIELD_TO_QUEUE` before max -> preserve completed quantum progress;
- queue-local `PAUSE_PROCESS`/`BACKGROUND_SLEEP` before max -> preserve progress;
- retryable `BLOCKED` -> preserve current slot progress;
- session rotation -> preserve progress;
- full quantum -> reset current slot to zero for its next cycle.

This directly prevents a partially used `8/10` slot from returning as an unrelated fresh `0/10` quantum merely because it was parked/recovered.

## Pause, block and terminal semantics with duplicate slots

Duplicate slots represent one logical saved GFW.

### Pause

In queue-managed mode `PAUSE_PROCESS` and `BACKGROUND_SLEEP` checkpoint the logical GFW and pause every slot with the same non-empty `savedMissionId` until the same not-before time. If another logical mission slot is runnable, the worker continues immediately with that next slot. If no other slot can run, Greenfield falls back to the normal process-level timed pause.

### Blocked

A retryable `BLOCKED` state propagates the same checkpoint and retry boundary across duplicate slots of that saved GFW. This prevents a second occurrence from bypassing the logical blocker and hot-looping the same mission.

### Done/stop

`status=DONE` or `STOP_PROCESS` closes the logical saved GFW. Every duplicate slot with that `savedMissionId` is retired from the active queue, so a later occurrence cannot silently restart a mission the AI explicitly completed/stopped.

## Manual runtime changes

The operator may add, remove, reorder, reprioritize or change the future quantum of non-active slots while the queue is running. The active slot's current quantum remains immutable until its boundary, while priority remains non-preemptively mutable as before.

A repeated click on **Lägg till valda** may add another scheduling slot for the same saved GFW. Duplicate slots are intentionally retained by saved queue sets.

## A2A/EIC contract

Every queue-managed EIC-A2A envelope exposes `ORDERED_CYCLIC_SLOTS` semantics:

- explicit list order owns inner scheduling;
- priority owns only outer capacity competition while the slot is active;
- quantum is per slot;
- incomplete quantum survives early yield/pause/block;
- duplicate slots share logical mission continuation;
- queue loops while enabled;
- AI terminal commands close the logical GFW;
- operator edits/stops remain authoritative controls.

All machine-control prose remains English. UI/operator/source evidence may continue to mix English, Swedish and Finnish per the v1.7.3 language contract.

## Queue awareness in every EIC prompt

For a queue-managed turn, `control.workQueue` now includes both machine fields and an operator-readable planning line. Example:

```text
Hög · 1 interaktioner/kvant · 0/1 slutförda i kvanten
```

The same object exposes:

- `completedInteractions`
- `interactionInQuantum`
- `maxInteractions`
- `remainingInteractionsIncludingCurrent`
- `finalInteractionInQuantum`
- `operatorDisplay`
- `planningHint`
- `activationCount`
- `responseRoundTripApproxMs`
- `loopRoundTripApproxMs`

`planningHint` is English machine-control prose. It tells the EIC AI which interaction of the active quantum it is handling, so the AI can deliberately split large work across the available quantum instead of treating every prompt as an unlimited work window.

`responseRoundTripApproxMs` is the browser-observed approximate elapsed time from actual prompt post to completed assistant response. `loopRoundTripApproxMs` is the approximate time from the prior departure of this exact queue slot until the slot becomes active again. The latter therefore includes time spent on other queue slots and any waits. These are operational timing proxies, not provider compute-time, token or billing claims.

## One-shot full Greenfield process status

A valid EIC response may request:

```json
"greenfieldStatusRequest": "FULL_NEXT_PROMPT"
```

The request is one-shot. Greenfield adds `processStatus` to that same logical GFW's next generated prompt while retaining the normal mission/objective/control/session-health envelope. If the GFW is parked, yielded or rotated before its next prompt, the request follows that GFW's persisted continuation and is not leaked to another queue slot.

`processStatus` uses `eic.greenfield.process-status.v1` and is a bounded control-plane snapshot. It includes process/run/worker lineage, phase, objective state, current queue quantum/timing, recent session-health samples, prompt/response hashes and timestamps, recovery, rotation/pause, safety/control and decision capsules. Prompt bodies, response bodies, hidden reasoning and credentials are deliberately omitted.

## v1.7.3 BACKGROUND_SLEEP terminality regression

The exact failure family reported from v1.7.3 is now guarded:

```text
status=CONTINUE
sessionAction=BACKGROUND_SLEEP
finalInteractionInQuantum=true
```

This is a parking/scheduling decision, not mission completion. The logical GFW remains in the active queue model (normally `PAUSED` until its not-before time), its current slot quantum is reset only because that quantum completed, and another runnable slot may proceed. It must not enter `Klart/avslutade`.

Only a real terminal EIC signal (`status=DONE` or `STOP_PROCESS`) retires the logical saved GFW and all duplicate slots.

## Migration

The persisted mission-work-queue schema is normalized to `eic.greenfield.mission-work-queue.v4`. Existing v3 queue records remain readable through the durable checkpoint owner and acquire `cursorOrder=-1` plus `quantumProgress=0` unless stronger current process state provides an active progress value.

For a live unpacked Chrome installation, prefer copying the new package over the same extension directory and pressing **Läs in igen** so the extension identity/local storage remains stable. If a new unpacked extension identity/path is used, active local runtime state must not be assumed to transfer. Save a queue set first when preserving configuration matters.

## Acceptance targets

1. Different slot priorities do not alter explicit inner queue order.
2. After the last runnable slot, selection wraps to the first.
3. A 2-interaction slot shows `0/2 -> 1/2 -> switch`, then `0/2` on its next completed cycle.
4. An early yield from `8/10` resumes at `8/10`, not `0/10`.
5. The same saved GFW can exist in at least two slots with different order/priority/quantum.
6. Duplicate slots continue the same logical mission checkpoint rather than replaying mission start.
7. Queue-local pause lets another runnable logical mission proceed.
8. DONE/STOP_PROCESS removes all duplicate slots of the completed logical GFW.
9. Saved queue sets preserve intentional duplicates and their per-slot settings.
10. `CONTINUE + BACKGROUND_SLEEP` on a final quantum parks and never enters history/terminal state.
11. Every queue prompt exposes exact quantum planning state and preserves approximate response/loop roundtrip when observed.
12. `greenfieldStatusRequest=FULL_NEXT_PROMPT` yields one bounded `processStatus` capsule in that same GFW's next prompt.
13. Existing mixed-language model-safety and multi-turn liveness regressions remain green.

Automated package tests prove source behavior only. Live Chrome/ChatGPT acceptance remains a separate runtime claim.
