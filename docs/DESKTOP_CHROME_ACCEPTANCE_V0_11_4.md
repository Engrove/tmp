# Desktop Chrome acceptance — v0.11.4

Status: NOT RUN

## Actor/capability oracle

1. Load the exact v0.11.4 BROWSER candidate.
2. Start/continue a mission whose next EIC-owned operation requires a route available to the connected EIC AI session.
3. Verify the target returns `EIC_NEXT_ACTOR: EIC_AI_SESSION` and Nano exposes only EIC-AI-compatible continuation actions for that turn.
4. Verify Agent/Nano do not claim or execute EIC Backend/project/memory/artifact/APIG/Git/Workspace capability themselves.

## True external-system oracle

5. Produce a valid turn with `EIC_NEXT_ACTOR: EXTERNAL_SYSTEM`.
6. Verify Core resolves the turn to `WAIT_EXTERNAL_EVENT`.
7. Verify runtime reaches `PROGRAM_BLOCKED` / `EXTERNAL_SYSTEM_UNAVAILABLE_TO_AGENT`.
8. Verify material target dispatch count remains zero.
9. Verify no `CHAT_CONTROL_CONTINUATION` is inserted into the same ChatGPT conversation.
10. Verify no Nano requeue or same-input loop occurs.

## Local Agent oracle

11. Produce a valid local-extension next step with `EIC_NEXT_ACTOR: AGENT`.
12. Verify only Agent-local actions are available; no target/EIC or external-system execution action is selected.

## Continuity regression

13. Re-run the unchanged v0.11.3 closure checks that remain applicable:
    - Capture + Session Memory creation/persistence;
    - Raw Session Context selection;
    - normal reload/reconnect;
    - hard reload/bypass-cache/reconnect;
    - continued Nano turn after reload;
    - no duplicate prompt/effect;
    - no stranded Nano RUNNING/host ownership;
    - no capture-cancel loop.

Any code change after packaging invalidates the candidate and requires repackage/reverification.
