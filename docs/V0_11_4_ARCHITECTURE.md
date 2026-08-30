# v0.11.4 architecture — actor/capability topology

## Problem closed by this candidate

v0.11.3 could represent `AGENT` and `EXTERNAL_SYSTEM` in EIC-AA/5, but it had no first-class
`EIC_AI_SESSION` actor. A target answer could therefore describe an EIC owner-route operation as
an external-system step or as Agent work. Nano saw the same ambiguous actor vocabulary and the
controller could materialize an `EXTERNAL_OWNER_EXECUTE` result back into the same EIC chat.
That conflated **owner**, **executor** and **communication recipient**.

## Universal actor topology

The topology is task-domain independent.

| Actor | Capability boundary |
| --- | --- |
| `EIC_AI_SESSION` | Connected ChatGPT EIC session. May use only EIC/tool/owner routes actually exposed in that session; owner readback remains required. |
| `AGENT` | Chrome-extension runtime only: controller/session/browser lifecycle, local Capture/Memory, chat-control transport and Nano host. No implicit EIC Backend/project/memory-domain/artifact/APIG/Git/Workspace/repository access. |
| `NANO` | Bounded local reasoning over explicitly supplied context only. No implicit EIC identity, hidden EIC state, source/repo/artifact access or source-code introspection. Never an EIC-AA/5 execution actor. |
| `EXTERNAL_SYSTEM` | A real producer outside `EIC_AI_SESSION`, `AGENT` and `NANO`. Never an alias for an EIC AI tool/owner-route step. |
| `OPERATOR_ACTION` / `OPERATOR_DECISION` | Human mechanical action / human decision only. |
| `NONE` | Terminal/no executor. |

Owner and executor are separate. Task type does not grant capability.

## Protocol change

`EIC_NEXT_ACTOR` now accepts:

`EIC_AI_SESSION | AGENT | OPERATOR_ACTION | OPERATOR_DECISION | EXTERNAL_SYSTEM | NONE`

Existing v0.11.3 actors remain parse-compatible.

## Runtime routing

Every registered micro-action carries `executorActor` and `requiredCapability`.
`availableMicroActions()` filters the action set by the explicit target actor before Nano chooses.

- `EIC_AI_SESSION` → target/EIC continuation actions.
- `AGENT` → local controller action only.
- `EXTERNAL_SYSTEM` → `WAIT_EXTERNAL_EVENT` only (plus terminal stop).
- operator actors / `NONE` → no autonomous execution action.
- absent actor/owner no longer grants Agent-local capability.

A Nano-selected action that is incompatible with the target actor is replaced by Core fallback from
the actor-compatible set.

## True external dependency

A true external dependency must not be bounced into the same EIC chat. `WAIT_EXTERNAL_EVENT`
therefore enters `PROGRAM_BLOCKED` with:

- material target dispatch = 0;
- chat-control = 0;
- explicit `EXTERNAL_SYSTEM_UNAVAILABLE_TO_AGENT` runtime disposition.

If the work is actually executable through an EIC owner/tool route exposed to the connected
ChatGPT session, the target must instead return `EIC_NEXT_ACTOR: EIC_AI_SESSION`.

## Mandate propagation

Built-in Nano and target mandates carry the topology for every scenario profile. Existing
`WORKSPACE_AWARE_GENERAL` / `EIC_WORKSPACE_GENERAL` persisted profiles are refreshed from
`nano-core-workspace-v4` / `target-workspace-v4` to v5 during normal config loading.
