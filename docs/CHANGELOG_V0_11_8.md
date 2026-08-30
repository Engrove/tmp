# EIC Autonom Agent v0.11.8

- Preserves the v0.11.7 typed schema-bound Nano JSON-completeness postcondition and single format-repair semantics.
- Preserves the v0.11.6 6,000-character advisory threshold and schema-derived hard output ceiling.
- Adds a session-init baseline-correction generation fence keyed to the initialization episode (`needKey` + pre-baseline catch response identity), not to each fresh correction response identity.
- Allows exactly one Nano-rejected baseline to create one corrective baseline target prompt in the same init episode.
- A second Nano non-ACCEPT in the same init episode transitions session initialization to `FAILED` / run state `PROGRAM_BLOCKED` with failure code `BASELINE_CORRECTION_EXHAUSTED`.
- The exhausted path creates no third baseline target wake and preserves bounded rejection reason/violations in local Agent-owned state.
- A genuinely new initialization episode or a new pre-baseline catch identity may re-arm one correction generation.
- Preserves v0.11.5 actor/capability separation, true `EXTERNAL_SYSTEM` no-chat-loop routing, one terminal Nano diagnostic per failure generation and same-generation wake suppression.
