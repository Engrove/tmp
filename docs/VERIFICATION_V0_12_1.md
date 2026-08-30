# Verification v0.12.1

Verification scope for the NANO_TASK feature:

1. Directive parser separates mission text from the NANO_TASK remainder.
2. Task-only prompts produce no normal mission text.
3. Harness lifecycle is PENDING -> RUNNING -> COMPLETED/FAILED.
4. Completion rejects `promptCalls != 1`.
5. Sidepanel execution creates a fresh provider session and calls `session.prompt()` exactly once.
6. NANO_TASK never uses `clone()` or the shared/base Nano session.
7. Background NANO_TASK writes target only `context.nanoTaskHarness`; no ordinary Nano request, run causal state or continuity write is performed by task lifecycle handlers.
8. Normal Nano/Core Surface Review scheduling is serialized while NANO_TASK inference is in flight, without transferring mission/control ownership to NANO_TASK.
9. JavaScript syntax validation covers all `.js`/`.mjs` files.
10. Package ZIP integrity and build-info file hashes are verified after packaging.

Desktop Chrome live acceptance is separate from static/package verification.
