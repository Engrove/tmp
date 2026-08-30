# v0.11.6 architecture — schema-safe Nano decision output bounds

## Live defect

v0.11.5 successfully surfaced the hidden Nano root error and proved one-shot diagnostic propagation.
The captured failure was `NANO_OUTPUT_OVERRUN` at 6,001 characters against a 6,000-character hard limit.
Source inspection showed that the 6,000 limit was shared by the normal decision path and its single
JSON-format repair pass even though the bounded decision schema itself can legitimately serialize
beyond 6,000 characters.

The failure was therefore an implementation/contract mismatch, not evidence of a stale Nano host.

## Two-tier policy

Normal `eic.nano.microdecision.v2` output now has two independent character levels:

1. `NANO_DECISION_SOFT_OUTPUT_CHARS = 6000`
   - telemetry/advisory only;
   - crossing it never terminalizes an otherwise bounded decision.
2. `NANO_DECISION_HARD_OUTPUT_CHARS`
   - derived at module initialization from the closed `DECISION_SCHEMA`;
   - includes worst-case JSON escaping (`\uXXXX`) plus a fixed bounded margin;
   - derivation fails closed if the schema is not fully bounded or exceeds the configured 512,000-character safety maximum.

The current closed schema derives a contract bound of 256,567 characters and a hard limit of
258,615 characters. This is intentionally conservative. Liveness does not rely on this character
cap alone: raw chunk count, stream-idle timeout, wall deadline and early complete-JSON termination
remain independent controls.

## Closed schema

`additionalProperties: false` is set on:

- the decision root object;
- `trackControl`;
- `operatorCandidate`.

All declared string, array and numeric surfaces used by the decision contract are bounded, so the
hard output ceiling is deterministic instead of historical.

## First pass and repair

The same two-tier policy is used for:

- normal decision inference;
- the single JSON-format repair pass.

Baseline analysis, baseline recovery and core-surface review retain their separate existing
mode-specific limits. Non-decision prompt paths retain the prior 6,000-character default unless
they already supply an explicit mode-specific limit.

## Preserved controls

v0.11.6 does not change:

- actor/capability routing;
- true `EXTERNAL_SYSTEM` no-chat-loop behavior;
- Nano failure diagnostic payload content;
- one diagnostic per failure generation;
- same-generation wake suppression;
- raw-chunk cap;
- stream-idle timeout;
- wall deadline;
- one-repair semantics.
