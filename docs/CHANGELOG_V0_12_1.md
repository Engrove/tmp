# EIC Autonom Agent v0.12.1

## NANO_TASK — isolated one-prompt local LLM harness

v0.12.1 adds `NANO_TASK:` as an ACCEPTANCE_HARNESS-plane directive for testing local LanguageModel behaviour without giving the task mission/control authority.

Preferred syntax:

```text
<ordinary EIC Autonom Agent mission text>

NANO_TASK: {Write the isolated one-prompt experiment here}
```

A prompt may also contain only:

```text
NANO_TASK: {experiment}
```

### Isolation contract

- The directive owns the remainder of the prompt and is removed from an EIC-managed new-session mission prompt before that mission is started.
- NANO_TASK state lives in `window.nanoTaskHarness`, outside `run`, continuity, causal CONTROL state and ordinary `pendingNanoRequest`.
- Execution waits until the local Nano host is available and idle, but does not block or acquire normal mission/Nano ownership.
- The task uses a newly created `LanguageModel` session with **no cloned base session and no EIC/Nano system prompt**.
- Exactly one `session.prompt(task)` call is allowed.
- There is no semantic retry, repair pass, continuation, recovery handoff or protocol parser.
- The fresh session is destroyed immediately after success or failure.
- The result is stored only on the isolated harness record and rendered in the Nano UI status.
- A distinct human user turn containing a new NANO_TASK may create a new harness request; the same source/task is deduplicated.

### Direct-target limitation

When the operator manually types a NANO_TASK directive directly into an already-open target ChatGPT conversation, the extension can observe and dispatch it to the isolated harness, but it cannot retroactively remove text already delivered to the target model. For strict mission invisibility, use the EIC-managed mission/start-prompt path, where the directive is stripped before target dispatch.
