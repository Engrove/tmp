# v0.9.3 Delivery and context architecture

## Goal

No backward compatibility is required for v0.9.3 or later; this architecture defines only current contracts.

Keep EIC's skeptical safety control while preventing control-plane work from outrunning delivery.

## Delivery regulator

Every material continuation is evaluated against:

```text
PRIMARY_PROGRAM_GOAL
ACTIVE_MILESTONE
BOUNDED_CURRENT_UNIT
PROPOSED_ACTION
DIRECT_PROGRAM_DELTA
```

Allowed:

- `DIRECT_PROGRAM_DELTA` 1–3; or
- one required owner/safety action with both an omission failure and the exact next delivery action it unlocks.

Denied:

- `DIRECT_PROGRAM_DELTA=0` without the exact required-control exception.

A denied branch produces a bounded stop, not another audit, receipt, context, fixture, wording pass or equivalent retry.

## Admission chain

Before a work slice that needs them, the runtime can project:

```text
CAN_EDIT
CAN_TEST
CAN_PERSIST
CAN_PUBLISH
CAN_INSTALL
CAN_READ_BACK
```

Only capabilities required by the bounded unit are checked. Missing later-stage capabilities do not block an earlier deliverable unless they are part of its Definition of Done.

## Progressive context router

Nano receives reference-plus-delta context:

- task binding;
- mandate ref/hash;
- program goal, milestone and unit;
- owner evidence references;
- blocker set;
- next direction;
- response hash;
- bounded observation anchors.

It does not receive full previous assistant prose or full conversation replay by default.

## Judgment and hard boundaries

The prompt states goals, interfaces, evidence classes and hard safety constraints. It avoids brittle micro-rules and duplicated tool prose. Nano may use judgment inside those boundaries.

## Evidence taxonomy

| Class | Meaning |
|---|---|
| OWNER_LIVE | fresh read from the current fact owner |
| OWNER_RECEIPT | route-native readback of a durable effect |
| OWNER_HISTORICAL | owner record at a stated earlier point |
| DERIVED_VIEW | projection or summary |
| LOCAL_CANDIDATE | session/local bytes not owner-persisted |
| ROUTING_CONTEXT | session/work coordination only |
| DRY_RUN | request validation without effect |

## Completion

- `UNIT_DONE`: bounded unit complete.
- `MILESTONE_CONTINUE`: program has more work.
- `PROGRAM_BLOCKED`: no admitted next action until the stated unlock.
- `PROGRAM_DONE`: whole mandate terminal.

Only `PROGRAM_DONE` maps to `EIC_AUTONOMY:DONE`.
