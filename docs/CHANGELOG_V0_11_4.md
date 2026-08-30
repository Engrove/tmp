# EIC Autonom Agent v0.11.4

- Adds first-class `EIC_NEXT_ACTOR: EIC_AI_SESSION`.
- Introduces a universal actor/capability topology for EIC AI, Agent runtime, Nano, external systems and operator actions.
- Makes actor capability independent of task domain: coding, investigation, analysis and all other tasks use the same boundary.
- Prevents `AGENT` and `NANO` from being treated as if they had implicit EIC Backend/project/memory/artifact/APIG/Git/Workspace/repository access.
- Makes Nano receive the actor/capability topology and actor-filtered micro-action catalog on every decision.
- Adds `executorActor` and `requiredCapability` to registered micro-actions.
- Adds `WAIT_EXTERNAL_EVENT` for real external producers.
- Prevents a true `EXTERNAL_SYSTEM` dependency from being converted into `CHAT_CONTROL_CONTINUATION` to the same EIC chat.
- Fails true external dependencies closed to `PROGRAM_BLOCKED` with zero material target dispatch and zero chat-control.
- Keeps legacy `REQUEST_EXTERNAL_OWNER`/`EXTERNAL_OWNER_EXECUTE` only as compatibility vocabulary; normal actor-aware routing does not expose it to Nano.
- Refreshes built-in Nano/target mandate profiles to actor-aware versions.
