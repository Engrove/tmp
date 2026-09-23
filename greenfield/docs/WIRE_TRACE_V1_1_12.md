# Wire Trace — Greenfield v1.1.12 Audit control and FIFO

## Persist-off path

Producer:
`audit(...)` / UI/content forensic event

-> event constructor:
`makeAuditEvent(...)`

-> volatile transport:
background-owned metadata-only FIFO, max 25 per window + bounded APP feed

-> consumer:
side panel `state.audit.events`

-> invariant:
`audit.enabled=false` means `writeAuditEvent()` is not called.

## Persist-on path

Producer:
same event producers

-> noise gate:
unchanged high-frequency polling kinds may be coalesced within 5 seconds

-> persistence:
`writeAuditEvent()` -> IndexedDB `auditEvents`

-> retention:
`pruneAudit(maxEvents=5000)` in bounded delete batches

-> read:
time-bearing indexes + reverse cursor + bounded limit

-> UI:
still uses FIFO for normal render; IndexedDB is used for bounded backfill/export, not every
snapshot render.

## Toggle

Side panel checkbox
-> `EIC_GF_SET_AUDIT_ENABLED`
-> `chrome.storage.local["eic.gf.audit.enabled"]`
-> background `auditEnabled`
-> `AUDIT_ENABLED` or `AUDIT_DISABLED` event
-> returned `audit` snapshot
-> checkbox/feed readback.

Upgrade with no stored setting resolves to `false`.

## Payload boundary

`PAGE_STATE_OBSERVED`:
- IDs/hashes/lengths/trust/signals/autonomous pairing retained;
- raw `assistantText` removed;
- raw `autonomousTurn.assistantText` removed.

The operational response text remains available to the process state machine and is not
removed from response capture itself.

## Failure boundary

Persistence off:
- no IndexedDB Audit write;
- no persistence-derived `AUDIT_FAILURE`.

Persistence on:
- process-scoped durable Audit write failure remains fail-closed as `AUDIT_FAILURE`.
