# EIC Autonom Agent v0.11.5

- Preserves the v0.11.4 universal actor/capability topology and `EIC_AI_SESSION` routing.
- Captures the underlying terminal Nano failure in `nanoFailureFence.v2` with bounded request/error/input/material identity.
- Adds optional `diagnostics.nanoFailure` to the canonical EIC-AA/5 JSON envelope.
- Replaces repeated `NANO_FAILURE_INPUT_UNCHANGED` wakes with one `NANO_FAILURE_DIAGNOSTIC` control turn per failure generation.
- Persists a one-shot `nanoFailureDiagnosticReceipt` keyed to the exact failure diagnostic.
- After the diagnostic has been materialized, identical failed input enters `PROGRAM_BLOCKED` with zero additional chat-control.
- A materially new input/failure generation clears the old diagnostic receipt and may produce one new diagnostic.
- Does not guess the underlying provider failure class; the exact live error remains a Desktop Chrome evidence item.
