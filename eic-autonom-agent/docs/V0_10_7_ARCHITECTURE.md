# EIC Autonom Agent v0.10.7 — Delivery-regulator lifecycle hotfix

## Scope

v0.10.7 is a bounded forward-only hotfix built from the exact v0.10.6 source package
`ff7a6a4136b178c4fbd35fb476f61e906fcc93e43682729df82a6cebfbf0938c`
and the v0.10.6 Desktop Chrome export captured on 2026-08-06.

It addresses one runtime defect:

- a valid turn-bound `EIC_AUTONOMY: CONTINUE` entered `SOFT_PAUSED` with
  `DIRECT_PROGRAM_DELTA_ZERO`;
- the preserved response was then rearmed approximately every 30 seconds.

No storage schema, export schema, Prompt API provider, mandate protocol or permission change is introduced.

## Root cause

The deterministic CONTINUE branch in `lib/fallback-planner.mjs` returned `action=CONTINUE`
and `progressDelta=0`, but did not emit the delivery fields required by the v0.9.3 gate:

- `directProgramDelta`;
- `requiredControl`;
- `omissionFailure`;
- `unlocksNextAction`;
- `boundedStop`.

`background.js` evaluated `evaluateDirectProgramDelta()` before later autonomous
classification could compensate. Missing fields therefore became zero/false and the
delivery gate rejected the branch.

The rejection entered auto-recoverable `SOFT_PAUSED/NO_PROGRESS`. Because the response
identity remained pending and the deterministic source was not consumed, the same
observation was eligible for fast-path recovery again.

## Design

### Complete deterministic delivery contract

`deriveContinuationDeliveryContract()` now classifies every deterministic, turn-bound
CONTINUE before the gate:

- concrete bounded work: `directProgramDelta=1`;
- owner-control prerequisite: `directProgramDelta=0`, `requiredControl=true`, explicit
  `omissionFailure`, and exact `unlocksNextAction`;
- non-CONTINUE or missing action: bounded non-delivery.

A target action that requires Hjalmar local control to obtain fresh owner facts is admitted
only as the single required control action. Target text remains untrusted continuation data.

### Stable zero-delta wait

`resolveDeliveryRegulatorDisposition()` separates admission from lifecycle handling.

A genuine rejected zero-delta CONTINUE:

1. consumes the current response identity;
2. clears the pending observation and pending deterministic request;
3. stores `deliveryWait.status=WAITING_OWNER_EVIDENCE`;
4. suspends the response timeout because no prompt is outstanding;
5. enters `WAITING_FOR_RESPONSE`;
6. does not schedule a deterministic callback.

The branch may resume only after a new response identity or fresh owner evidence starts a
new decision cycle.

### UI projection

The attention router exposes `DELIVERY_OWNER_WAIT` as:

`Väntar på extern owner/locator`

This replaces the misleading combination of a paused run and `Ingen åtgärd krävs`.

## Safety boundary

The hotfix does not:

- infer an owner from target text;
- treat `TARGET_SESSION_OWNER` as resolved;
- bypass the delivery gate;
- turn a zero-delta action into success;
- grant Git, project, runtime, release or deployment authority;
- claim installed Desktop Chrome behavior from source tests.

## Changed surfaces

- `lib/delivery-kernel.mjs`
- `lib/fallback-planner.mjs`
- `background.js`
- `lib/attention-router.mjs`
- current-version contracts and documentation
- focused block/emit and lifecycle fixtures
