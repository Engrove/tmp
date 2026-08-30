# Changelog v0.11.19

## Fixed

- Conversation changes now rebase conversation-owned continuity instead of promoting stale
  `intent`, `workUnit`, `mainTaskBaseline`, claims or anti-loop state into the new chat.
- Every mission start owns a fresh main-task baseline gate, including a new mission started in the
  same conversation.
- Ordinary assistant responses can no longer be promoted to `NANO_ANALYZING` merely because an old
  `mainTaskBaseline` exists.
- Runtime observation, baseline parsing and Session Capture now share one canonical rendered-message
  extraction model. Nested role fragments are ignored and structured code/JSON content is preserved.
- Known-incomplete rendered-response extraction is ineligible for Nano admission and cannot consume
  semantic baseline-correction budget.
- Session Memory no longer merges prior-memory section summaries across conversation/capture
  boundaries. Invalid provenance produces `RESET_REQUIRED`, and freshness evaluation preserves that
  state.
- Transient ChatGPT request-placeholder assistant nodes such as `Tänker`/`Thinking` are excluded
  from durable Capture/Session Memory.
- A manual session-init retry rotates `needKey` and clears the prior exhausted baseline-correction
  fence. Post-delivery reconcile preserves the delivered baseline anchors while starting a fresh
  bounded analysis episode without re-sending the baseline prompt.
- Terminal baseline-correction exhaustion now finalizes Nano ownership before returning, releasing any
  deferred automatic Session Capture so typed init failures retain forensic context.
- The EIC-AA/5 parser now selects the final exact contiguous trailer and permits only EIC metadata
  (`Status`, `Time`, `Project`, etc.) after it, reducing false protocol-repair churn.
- Genuine external investigative dependencies now enter passive `WAIT_EXTERNAL_EVENT` with suspended
  timeout and no repeated chat-control instead of false `PROGRAM_BLOCKED`.

## Preserved

- v0.11.18 causal response-owner exclusion and 120-second transient session-init liveness bounds.
- Strict owner/executor separation: AGENT/NANO do not impersonate EIC owner routes or a genuine
  `EXTERNAL_SYSTEM`.
- Bounded semantic baseline correction remains one chat correction per initialization episode.
- Production/runtime acceptance remains separate from source/package verification.
