# Greenfield 1.7.7 — AI-requested runtime control and FULL/COMPACT prompts

## Root cause of the observed failure (v1.7.6)

`lib/greenfield-control.mjs` classified `sessionAction=STOP_PROCESS` and
`status=DONE` as state `DONE`, but did not set `controllerOverride`.
`applyGreenfieldControlToDecision` therefore returned the local Hjalmar decision
unchanged. When that advisory verdict was `CONTINUE`, `tickAnalyzing` continued
the mission. The DONE commit never ran, so the existing logical-GFW retirement
in `finalizeQueueTerminalAndMaybeAdvance` was never reached, even though the
prompt contract said `DONE`/`STOP_PROCESS` retires all duplicate slots.

## Control model

```
human/operator runtime control > validated Greenfield owner state > AI runtime-control request
```

The EIC AI **requests**; Greenfield is the effect owner. One control point:
`evaluateAndApplyRuntimeControl` (background.js) → `lib/runtime-control.mjs`.

Response field (optional, backward compatible):

```json
"runtimeControl": {
  "target": { "runId": "...", "turn": 7, "queueId": "...", "itemId": "...", "savedMissionId": "..." },
  "actions": [
    { "op": "COMPLETE_MISSION" },
    { "op": "SET_QUANTUM", "maxInteractions": 8 },
    { "op": "SET_PRIORITY", "priority": "LOW" }
  ]
}
```

- `target` is published per prompt in `control.runtimeControl.target` and must be copied verbatim.
  Greenfield compares it with owner state; it never uses AI-supplied IDs as lookup keys.
- Whitelisted operations only (`Map`-based lookup; no inherited keys, property paths or eval).
  At most 4 actions, each op at most once, no unknown fields, JSON size ≤ 4000 chars.
- `COMPLETE_MISSION` requires `status=DONE` or `sessionAction=STOP_PROCESS`.
  It retires every slot of the logical mission (same `savedMissionId`; a slot
  without one retires only itself) through the existing DONE commit.
- Legacy `status=DONE` / `sessionAction=STOP_PROCESS` without `runtimeControl` is
  normalized to `COMPLETE_MISSION` for the prompt's own target. Explicit and legacy
  requests share the same handler, and retirement has one implementation
  (`retireLogicalMissionSlots`).
- `SET_QUANTUM`: integer 1..15 (the operator range is 1..50). Applies to the target
  slot only, from its next quantum or activation. The current quantum stays
  immutable (v1.7.4 rule). Out-of-range values are rejected, never clamped.
- `SET_PRIORITY`: `LOW|NORMAL|HIGH|URGENT`, never above the slot's
  `operatorPriority` (the ceiling the operator assigned). Takes effect immediately and
  non-preemptively in the profile-global capacity scheduler; the inner queue
  order is never changed.
- Receipts `APPLIED | ALREADY_APPLIED | REJECTED | STALE | INVALID` are stored in
  `process.runtimeControl` and returned in the next prompt
  (`control.runtimeControl.lastReceipts`) together with the current slot values.
  They also follow the logical GFW across queue parking, because the process
  snapshot carries them.

## Risk analysis and safeguards

| # | Risk | Safeguard | Test |
|---|------|-----------|------|
| 1 | Wrong GFW retired | Target must match run/turn/queue/item/savedMissionId exactly; retirement set is derived from the fresh queue item, not from AI IDs | unit 5, E2E mismatch |
| 2 | Stale response affects a later activation | `turn` in target (each activation/turn issues a new one); process generation/phase re-checked before every write | unit 5 (`STALE_TURN`) |
| 3 | Same completion applied twice | Retirement is idempotent (no remaining slots → no-op); missing slot → `ALREADY_APPLIED`; slot effects use value idempotency plus an effect ledger | unit 4, replay test |
| 4 | Quantum monopolizes the queue | AI bound 1..15; the current quantum cannot be extended; order rule unchanged; `YIELD_TO_QUEUE` remains the only way to end early | unit 7, E2E set |
| 5 | Priority bypasses scheduler rules | Whitelist plus operator ceiling; priority never reorders the inner queue; capacity-scheduler aging remains | unit 9 |
| 6 | Older AI answer overwrites operator edit | `operatorEditedAtMs` ≥ prompt `issuedAt` → `REJECTED OPERATOR_PRECEDENCE`; an optimistic revision conflict re-validates once; operator edits send only the edited field; a pending operator instruction outranks an AI terminal | unit 12, E2E operator ×2 |
| 7 | Malformed/hostile output mutates state | Closed parser, `Map` op tables (`__proto__` safe), size and field limits, no generic mutation path; a malformed block cannot hide the response status | unit 10, 11 |
| 8 | Duplicate slots left inconsistent | One pure retirement function for all slots of the logical mission; `SET_*` touches only the target slot | unit 2/3, E2E |
| 9 | DONE but queue mutation fails | Stale write → re-derive once from a fresh queue; failure audited; `reconcileTerminalQueueSlot` self-heals before `startMissionQueue` / `wakeMissionQueue` selection; receipts never claim an effect whose write failed | unit receipts |
| 10 | New contract breaks saved GFWs | Field optional; `null`/absent → no-op; legacy items get `operatorPriority = priority`; baseline v1.3.1 contract test still passes | unit 13, session-health |

Mental Hjalmar (same-session review, not owner evidence) challenged replay,
wrong-target mutation, operator precedence, duplicate-slot completion, authority
widening and backward compatibility. The review found and fixed three issues:
(a) an `op` of `"__proto__"` crashed the object-literal op table, now `Map`;
(b) a terminal receipt could claim `APPLIED` while a pending operator instruction
prevented the DONE commit;
(c) a stale side panel resent the old quantum with a priority edit and could make
the operator's own edit fail after an AI quantum change.

## Prompt profile (FULL / COMPACT)

- FULL (the complete session-wide contract) at every session boundary:
  `MISSION_START`, `MISSION_RESTORE`, `SESSION_ROTATION` (rotation or queue activation),
  `IDLE_KEEPALIVE`, a new process/run/session/tab/queue slot/mission text,
  a page reload (F5/Ctrl-F5 → new content `documentId`), or a conversation change.
- COMPACT only for `CONTINUATION`/`READ_REQUIRED` with positive evidence that the
  prompt goes to the same document and conversation as the previous one. It omits
  unchanged session-wide sections (mission text → fingerprint reference,
  presentation, language capsule, response contract body, static queue rules).
  It keeps all per-turn state, the owner-state rule, `control.runtimeControl`
  and, on the final quantum interaction, the checkpoint rule.
- A FULL prompt is re-sent at ordinals 1, 11, 21, … and whenever the EIC returns
  `greenfieldStatusRequest=FULL_NEXT_PROMPT`.
- Dispatch-time guard: a COMPACT prompt whose document or conversation changed
  before the first dispatch is replaced by its precomposed FULL fallback, and the
  hash-bound gate/capacity reservations are re-armed. Every uncertainty resolves
  to FULL.

## Also fixed

`MISSION_RESTORE` (emitted by the queue restore path) was not in
`A2A_MESSAGE_TYPES`, so that activation path failed envelope validation. It is now
an admitted message type.

## Boundaries

Local Node/static and harness E2E verification (the real `background.js` analysis
path with the offscreen model mocked) is not live Chrome/ChatGPT acceptance.
Retirement covers the queue of the current Greenfield worker/Chrome window; the
same `savedMissionId` queued in another worker's queue is not retired.
