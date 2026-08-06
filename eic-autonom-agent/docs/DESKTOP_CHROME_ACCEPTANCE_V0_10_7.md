# Desktop Chrome acceptance — EIC Autonom Agent v0.10.7

## Purpose

Verify the installed-extension runtime owner surface for the v0.10.6 self-pause incident.
Source/package PASS is not runtime acceptance.

## Preconditions

1. Use the same Desktop Chrome profile in which the v0.10.6 incident was observed.
2. Restart Chrome first when an update or stale service worker may be pending.
3. Remove or disable the previous unpacked extension instance.
4. Load the extracted v0.10.7 browser package through `chrome://extensions`.
5. Verify the extension card and side-panel header both show `0.10.7`.
6. Clear old extension errors and open the same target ChatGPT continuation session.
7. Export state before reloading if any failure occurs.

## Emit twin — required owner control

Use a target response with:

- one valid EIC-AA/5 trailer;
- `EIC_AUTONOMY: CONTINUE`;
- `EIC_NEXT_ACTOR: EXTERNAL_SYSTEM`;
- a concrete next action that requires mapping `TARGET_SESSION_OWNER` to a route-native
  owner locator.

Expected:

1. `programDeltaGate.allowed=true`.
2. `programDeltaGate.workClass=REQUIRED_OWNER_OR_SAFETY`.
3. The decision carries:
   - `directProgramDelta=0`;
   - `requiredControl=true`;
   - non-empty `omissionFailure`;
   - non-empty `unlocksNextAction`.
4. The run does not enter `SOFT_PAUSED`.
5. Exactly one next continuation effect is prepared/submitted for the response identity.
6. The same response identity is not requeued by a watchdog tick.

## Direct-delta emit twin

Use a valid CONTINUE with a concrete bounded engineering action.

Expected:

- `directProgramDelta>=1`;
- `programDeltaGate.workClass=CORE_DELIVERY`;
- one continuation effect;
- no owner-wait projection.

## Block twin — genuine zero delta

Inject or reproduce a CONTINUE decision with:

- `directProgramDelta=0`;
- `requiredControl=false`;
- empty omission failure;
- empty unlock.

Expected:

1. Gate reason `DIRECT_PROGRAM_DELTA_ZERO`.
2. State `WAITING_FOR_RESPONSE`, not `SOFT_PAUSED`.
3. `deliveryWait.status=WAITING_OWNER_EVIDENCE`.
4. `timeoutSuspended=true` and no response deadline.
5. The current response identity is recorded as processed.
6. Pending observation/request are cleared.
7. No deterministic callback is scheduled for that identity.
8. The attention banner says `Väntar på extern owner/locator`.
9. Repeated watchdog/content/panel ticks do not change the state revision because of
   same-observation rearming.

## Recovery twin

Present a new target response identity with a complete direct-delta or required-control
contract.

Expected:

- the old delivery wait is cleared;
- a new decision cycle starts;
- only the new response identity is processed.

## Evidence to export

- extension identity and build-info;
- run state and last transition;
- `programDeltaGate`;
- `deliveryRegulatorDisposition`;
- `deliveryWait`;
- response identity fields;
- effect journal;
- relevant audit rows and timestamps.

## Acceptance boundary

PASS requires installed Desktop Chrome readback from this checklist. Automated Node tests
and package hashes alone do not prove runtime behavior.
