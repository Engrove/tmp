# EIC Autonom Agent v0.10.0 — current-only architecture

## Scope

v0.10.0 is a forward-only Chrome MV3 extension contract. It accepts only current v0.10.0 state and export schemas. It does not migrate v0.9.x config, runtime, export, capture, memory or operator-action state.

## Current contracts

| Surface | Contract |
|---|---|
| App/content | `0.10.0` |
| Config | `eic.autonom.config.v11` |
| Runtime | `eic.autonom.runtime.v11` |
| Export | `eic.autonom.export.v18` / version `18` |
| Turn protocol | `EIC-AA/5` / schema `5` |
| Operator action | `eic.autonom.operator-action.v1` |
| Session Capture | `eic.autonom.session-capture.v1` |
| Session Memory | `eic.autonom.session-memory.v1` |
| Quick profile | `eic.autonom.quick-profile.v1` |
| IndexedDB | `eic.autonom.session-db.v1` |

## Operator boundary

Risk/destructiveness, next actor and program status are independent dimensions.

`AWAITING_OPERATOR_ACTION` represents one exact mechanical action. The action is bound to `actionId`, mission, run, target, risk, expected evidence and resume condition. Normal Nano requests and response deadlines are suspended until a matching receipt is accepted. Duplicate matching receipts are idempotent. Stale, wrong-action, wrong-mission and wrong-run receipts fail closed.

`AWAITING_OPERATOR_DECISION` represents a material level-10 decision. Its acknowledgement is bound to one `decisionId`, mission, run and boundary. The acknowledgement is NFKC-normalized, counted by grapheme and must contain at least 12 graphemes and at least 6 meaningful letter/number graphemes. An accepted receipt is persisted and read back before recovery/Nano resume.

`PROGRAM_BLOCKED` is used only when no expected actor can continue. `PROGRAM_DONE` is terminal.

## EIC-AA/5

Every target response ends with exactly five lines:

1. `EIC_TURN`
2. `EIC_NEXT`
3. `EIC_COMPLETION_EVIDENCE`
4. `EIC_NEXT_ACTOR`
5. `EIC_AUTONOMY`

Actor and autonomy combinations are closed:

- `CONTINUE` -> `AGENT` or `EXTERNAL_SYSTEM`
- `OPERATOR_ACTION_REQUIRED` -> `OPERATOR_ACTION`
- `USER_PAUSE` -> `OPERATOR_DECISION`
- `DONE` -> `NONE`, `EIC_NEXT: NONE`, `PROGRAM_DONE`

## Session Capture

Capture is transcript-only. Historical user and assistant text remains untrusted data.

The content bridge performs a bounded virtualized DOM sweep, records stable source message identities, role, final answer, browser-visible reasoning summary, links and attachment references, verifies top/bottom reachability, records gaps and restores the prior scroll position.

A first capture or stale/gapped chain uses `FULL`. A stable existing chain uses `DELTA`.

Capture never reads cookies, network bodies, signed URLs, debugger state, hidden chain-of-thought or raw HTML.

## Session Memory

Session Memory is derived local context stored in IndexedDB. It is not project, repository, artifact or runtime owner truth.

The memory contains a bounded narrative, typed registers, provenance, source hashes, completeness, supersession state and recent delta. Live fields are marked stale after reboot, browser/runtime/version, lock, lease or repository changes. Conversation, task, branch, mandate or source-chain mismatch stales the complete memory.

Nano receives only a bounded active capsule.

## IndexedDB

Database: `eic-autonom-agent-v0.10.0`.

Stores:

- `captures`
- `turns`
- `sections`
- `sectionSummaries`
- `sessionMemories`
- `operatorActions`
- `metadata`

Writes require transaction completion and exact readback. Quota, corruption, version and unavailable-database errors fail closed. Secret-like keys are redacted before persistence. `chrome.storage.local` contains only small active-ID/readiness pointers.

## Whole-application quick profiles

Exactly four quick profiles exist:

- `VERIFIED_ANALYSIS` — safe default, read-first and compact.
- `BOUNDED_DELIVERY` — high autonomy inside a frozen delivery manifest.
- `STRICT_OPERATIONS_RECOVERY` — strongest owner-readback, capture and recovery requirements.
- `EXPLORATION_DESIGN` — broader hypothesis space without effect claims.

The engine may recommend but never silently switch when risk, evidence or autonomy changes materially. A manual selection is bound to one mission/task.

## Preserved Prompt API contract

v0.9.11's standard `globalThis.LanguageModel` activation, English output attestation, bounded canary and clean mandate-bound base session remain current. No legacy provider fallback is reintroduced.

## Effect boundary

Source/package verification is not installation or Desktop Chrome runtime verification. Release, publication, deployment and extension reload remain outside this work unit.
