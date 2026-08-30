# v0.11.7 Desktop Chrome acceptance

Status: **PENDING**

## Live oracle

1. Load the exact v0.11.7 BROWSER candidate.
2. Confirm LanguageModel readiness in the linked ChatGPT session.
3. Run one bounded mission through baseline READY.
4. If schema-bound Nano output ends incomplete, observe exactly one terminal `NANO_FAILURE_DIAGNOSTIC` with `errorCode=NANO_INCOMPLETE_JSON`; the same failure generation must not wake the chat again.
5. A complete normal decision/repair may exceed 6,000 characters without failing solely on that threshold while still below the schema-derived hard cap.
6. Continue actor/capability, Capture/Memory and normal/hard reload checks only after the Nano path is clean.

Automated package verification does not by itself satisfy this checklist.
