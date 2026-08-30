# EIC Autonom Agent v0.11.7

- Preserves the v0.11.6 schema-derived normal-decision hard ceiling and 6,000-character advisory threshold.
- Adds a typed `NanoIncompleteJsonError` for schema-bound Prompt API calls that end without a complete parseable top-level JSON object.
- Makes JSON completeness an explicit `promptNano` postcondition whenever `stopOnCompleteJson=true`.
- Applies the same postcondition to streaming and request-mode Prompt API paths.
- Keeps exactly one JSON-format repair pass; an incomplete repair terminalizes once with the typed diagnostic instead of bubbling a generic caller parse error.
- Preserves v0.11.5 actor/capability separation, true `EXTERNAL_SYSTEM` no-chat-loop routing, one `NANO_FAILURE_DIAGNOSTIC` per failure generation and same-generation wake suppression.
- Keeps raw-chunk, stream-idle, wall-deadline and schema-derived hard output bounds unchanged.
