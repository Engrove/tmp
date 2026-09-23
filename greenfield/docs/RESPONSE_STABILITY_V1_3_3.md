# Greenfield response stability v1.3.3

## Incident

A live v1.3.2 continuation observed a hidden `EXPLICIT_TURN_SHELL` as structurally trusted
with `assistantTextLength=42`, `parseMode=NONE`, `A2A_RESPONSE_NOT_FOUND` and
`CONTROL_STATUS_NOT_FOUND`. The compact EIC response begins with exactly 42 characters:

```text
{"schema":"eic.a2a.response.v1","status":"
```

The response-stability layer could previously accept those repeated bytes as
`STABLE_TERMINAL_RESPONSE` because structural ownership, causal pairing, hash stability,
read count and age all passed before protocol parsing occurred.

## Fix

`lib/response-stability.mjs` now detects canonical `eic.a2a.response.v1` object starts and
checks whether at least one matching top-level JSON object has structurally closed while
respecting quoted strings and escapes.

When a canonical object has started but none has closed, stability returns:

```text
complete=false
reason=OBSERVATION_CANONICAL_A2A_RESPONSE_INCOMPLETE
candidate=null
```

This makes the normal waiting/refresh path continue observing the response instead of
handing an obviously partial canonical object to the terminal parser.

## Non-expansion guarantees

The guard does not:

- change `parseTargetResponse()` semantics;
- change `ROTATE_SESSION_NOW` handling;
- make protocol presence mandatory;
- hold ordinary prose that contains no canonical A2A object start;
- reject complete hidden structurally trusted responses;
- reinterpret `ROLE_NODE_FALLBACK` ownership.

## Regression triplet

1. Exact 42-character hidden/trusted canonical prefix: must remain non-terminal.
2. Complete hidden/trusted A2A response with `ROTATE_SESSION_NOW`: must terminalize normally.
3. Stable protocol-absent prose: must terminalize normally.

Live Desktop Chrome acceptance is still required to prove the provider/renderer behavior
after installation.
