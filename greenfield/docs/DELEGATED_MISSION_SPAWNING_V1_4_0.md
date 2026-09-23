# Delegated mission spawning — v1.4.0

## Purpose

Allow EIC to create durable follow-up work autonomously without allowing a supervising
Greenfield worker to create new Chrome Greenfield queue activity in its own session.

## Ownership rule

The supervising worker may request a new durable mission, but it never inserts that mission into
its own work queue.

Flow:

`SUPERVISOR EIC RESPONSE -> DURABLE DELEGATION REGISTRY -> OTHER LIVE QUEUE WORKER TICK -> TARGET QUEUE ADD`

The target must already be a different live queue-managed Greenfield worker. No new Chrome window
or ChatGPT conversation is created merely to satisfy the delegation. If no eligible worker exists,
the request remains `PENDING`.

Temporary bounded work that is genuinely part of the supervising mission may still run locally in
the supervising Chrome session. Only durable schedulable follow-up work belongs in
`missionDelegations`.

## Response contract

Queued EIC-A2A responses may add:

```json
{
  "missionDelegations": [
    {
      "requestId": "stable-id-for-this-logical-mission",
      "label": "Short label",
      "mission": "Durable mission text",
      "priority": "LOW|NORMAL|HIGH|URGENT",
      "relation": "SUPPORTS_CURRENT|UNBLOCKS_CURRENT"
    }
  ]
}
```

Rules:

- maximum 3 requests per response;
- `requestId` is idempotency identity and must be reused for retries of the same logical mission;
- reusing one `requestId` for different mission content is rejected;
- `DONE` cannot carry new mission delegations;
- child priority is capped at the source mission priority;
- schema-degraded control salvage never executes delegation effects;
- supervising queue is never the target;
- source mission continues normally unless its own independent disposition is `BLOCKED`, `PAUSE`,
  `YIELD`, rotation or terminal;
- lack of another worker is not permission to self-create.

## Persistence

Delegations use profile-local `chrome.storage.local` registry:

`eic.gf.mission-delegation.registry.v1`

States:

- `PENDING`
- `ASSIGNED`
- `APPLIED`
- `COMPLETED`

`ASSIGNED` is replayable by the same target worker so an unknown-effect/readback interruption does
not cause a second worker to create the same mission.

The delegated child also stores provenance in its queue item:

- request id;
- source window/queue/item/process;
- relation;
- creator marker `EIC_DELEGATED_FROM_OTHER_GFW`.

Queue-side deduplication checks both active items and terminal history.

## Dependency relation

`SUPPORTS_CURRENT` means the supervisor continues its own work while another worker performs the
delegated durable mission.

`UNBLOCKS_CURRENT` means the child is intended to remove a blocker. When the child reaches `DONE`,
a still-live source worker's blocked queue item is made immediately retryable. If the source window
no longer exists, the existing v1.3.9 blocker cooldown/retry mechanism remains the fallback after
queue restoration.

## Terminal boundary

`DONE` remains terminal. A completed source or child mission is never automatically revived.
Future work is represented by a new mission with a new request identity.
