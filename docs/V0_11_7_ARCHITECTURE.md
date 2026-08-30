# v0.11.7 Architecture — Schema-bound Nano completeness

## Failure boundary

A Prompt API call with a response constraint is not successful merely because the host stream/request ends normally. When `stopOnCompleteJson=true`, the owned result must contain one complete parseable top-level JSON object.

v0.11.7 moves that invariant into `promptNano`:

1. streaming/request output is still bounded by raw-chunk, idle, wall and output hard limits;
2. complete JSON still terminates early;
3. natural host completion without a complete JSON object throws `NanoIncompleteJsonError` with code `NANO_INCOMPLETE_JSON`;
4. the typed error carries only bounded output/request telemetry and is handled by the existing terminal Nano failure path;
5. the normal caller retains exactly one JSON-format repair pass; if that repair also ends incomplete, the typed error terminalizes once.

## Preserved boundaries

- 6,000 characters remains advisory only for normal decisions.
- The v0.11.6 schema-derived hard output ceiling is unchanged.
- Baseline/core-review mode-specific bounds are unchanged.
- Actor/capability topology and true external no-chat-loop behavior are unchanged.
- Failure diagnostic generation/suppression is unchanged.
