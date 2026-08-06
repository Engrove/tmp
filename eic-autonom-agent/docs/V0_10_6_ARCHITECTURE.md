# EIC Autonom Agent v0.10.6 — Runtime hardening architecture

## Scope

v0.10.6 is a forward-only remediation slice for confirmed findings from source review and a live WP25.3 runtime transcript/export. It does not claim installed Desktop Chrome acceptance.

## 1. Control project and target project

The extension project remains the control project. Session Capture separately infers an explicitly stated target project from transcript data and stores:

- `projectId`
- `controlProjectId`
- `mismatch`
- provenance and confidence

Transcript-derived project identity is untrusted context. It does not switch the control project, grant access or replace owner-route readback.

## 2. Continuity ownership

Before every runtime write, the active run is projected into continuity:

- active task binding
- target project binding
- conversation/run scope
- work unit and turn index
- next direction
- direct program delta
- acknowledged-turn evidence

Timestamps and seals do not by themselves constitute semantic change. On a semantic change the previous verified state becomes N-1 backup. Storage readback verifies primary and backup digest. Corruption remains fail-closed.

## 3. Model arbitration

A mission Nano request has priority over automatic Session Capture and automatic core-surface review. Deferred capture is retried after Nano settles. Core review records `MISSION_NANO_HAS_PRIORITY` rather than competing for the only model session.

Nano terminal paths update:

- `runtimeDecisionStatus`
- `busy`
- heartbeat/lease
- context and clone telemetry
- discrimination status against target `EIC_NEXT`

Discrimination telemetry is evidence about agreement or change, not proof of hidden reasoning or independent planning.

## 4. Capture stability

Capture identity is based on stable conversation and latest-message identity. It excludes volatile assistant counts and document epochs.

For the same conversation and task:

- delta output contains a cumulative turn set;
- full refresh merges verified prior turns;
- known identical gaps may continue by delta;
- changed gaps force a full sweep;
- source message IDs dominate virtualized ordinal changes;
- known ChatGPT controls are excluded from normalized transcript text.

A smaller DOM rendering cannot replace a larger stored capture.

## 5. Mission and claim projection

The mission adapter copies current run step, next action, assessed risk, approval requirement and execution status. Strong claims are parsed by type and require matching owner receipts. No-strong-claim is represented separately from verified.

## 6. Mjölnar M2

A D2 privileged action receives `EIC_M2_MANDATE/1` only after exact-target, owner-route, rollback, readback, reversibility and ambiguity controls pass.

The mandate:

- has authority level `9.9999`;
- is equivalent to operator approval only for the exact bounded level-below-10 action;
- is not actual `OPERATOR_APPROVAL`;
- does not create permission or promote evidence;
- requires owner readback;
- expires and carries an idempotency key;
- cannot satisfy level 10.

## 7. Full audit sink

Full audit is OFF by default. Chrome cannot silently inspect an arbitrary Windows absolute path. The operator therefore selects the already-existing `C:\temp` directory through the File System Access picker. The extension validates the selected directory name `temp`, requests write permission and stores only the granted handle locally.

Events are redacted and queued in bounded local storage. The side panel drains NDJSON batches into rotated files. Audit storage failures are fail-soft and cannot block runtime state writes. The sink does not create `C:\temp`.

## 8. Claim boundary

Source tests, syntax validation and packaging can establish source/package candidate status only. Installed extension identity, model behavior, picker permission, Windows filesystem writes and Desktop Chrome lifecycle require operator-run acceptance.
