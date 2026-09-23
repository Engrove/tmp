# Session postmortem — v1.1.6

## Observed failure

The live run blocked with:

`A2A_RESPONSE_NOT_FOUND, CONTROL_SCHEMA_ANCHOR_NOT_FOUND`

The parser was not the first failing component.

## Verified event chain

1. Prompt dispatch was write-ahead fenced and acknowledged.
2. Process persisted `SENDING -> WAITING` with readback.
3. ChatGPT DOM became unstable while the tab was hidden.
4. The latest assistant observation collapsed to the 38-character fragment:

   `EIC sade:{\n"schema": "eic.a2a.response`

5. The selected message owner was the fallback role node rather than a verified full turn owner.
6. Response stability used repeated hash/time only and accepted four identical partial reads as `STABLE_TERMINAL_RESPONSE`.
7. `parseTargetResponse()` then received bytes that did not contain the full schema anchor and correctly returned both parser errors.
8. Runtime incorrectly converted an observation-quality failure into semantic `TARGET_RESPONSE_CONTRACT_INVALID -> BLOCKED`.

## v1.1.7 fix

- full turn ownership is resolved through explicit turn shells or a bounded homogeneous role ancestor;
- owner provenance/trust is transported with the page state;
- `documentId` is now actually returned by `pageState()`;
- response candidate identity binds document + message + hash + assistant count;
- untrusted/incoherent observations cannot terminalize and remain in WAITING;
- parsing occurs only after trusted candidate stability;
- exact v1.1.6 38-character fragment is a regression fixture;
- Nano Observer and Hjalmar prompts are compacted for Chrome's small local model context.

The renderer-safe response parser remains defense-in-depth for complete-but-damaged plaintext; it is no longer used as a substitute for missing DOM bytes.
