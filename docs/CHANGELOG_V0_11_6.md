# EIC Autonom Agent v0.11.6

- Preserves the v0.11.5 actor/capability topology and one-diagnostic/no-repeat Nano failure control.
- Reclassifies the historical 6,000-character normal decision ceiling as an advisory telemetry threshold.
- Closes `DECISION_SCHEMA` at the root and nested object surfaces so its serialized output bound is finite and machine-derivable.
- Adds a pure schema-bound calculator using worst-case JSON escaping and a bounded safety margin.
- Uses the schema-derived hard ceiling for both first-pass normal decision inference and the single JSON-format repair pass.
- Keeps raw-chunk, stream-idle and wall-deadline controls hard and independent.
- Preserves early complete-JSON extraction: a complete valid object ends streaming before either advisory or hard bounds matter.
- Preserves v0.11.5 terminal `NANO_FAILURE_DIAGNOSTIC` and same-generation wake suppression.
