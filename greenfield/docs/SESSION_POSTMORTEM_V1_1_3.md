# v1.1.3 live shakedown postmortem

## What happened

The first v1.1.3 target response was captured completely and was visibly a canonical
`eic.a2a.response.v1` response with `status=CONTINUE`. It contained an English `NANO_TASK:`
directive and requested quoted prompt metadata in the next continuation.

The runtime emitted `RESPONSE_STATUS_PARSED` with:

- `status=UNKNOWN`;
- `parseMode=NONE`;
- `repairApplied=false`;
- error `A2A_RESPONSE_NOT_FOUND`.

The new v1.1.3 contract-invalid barrier then worked as designed and committed the process
to `BLOCKED` before Nano/Hjalmar. The block was therefore a parser false negative, not a
Nano or continuation-admission failure.

## Root cause

The v1.1.3 bounded renderer-repair algorithm used a punctuation-only heuristic:
a quote followed by `,` was treated as a structural JSON string close.

The actual rendered string contained:

`nanoTask.promptLanguage="en", nanoTask.promptPolicy="ENGLISH_DIRECT_EXECUTION_V1", ...`

The closing quote around `en` is embedded content inside the outer
`nextSuggestedAction` JSON string, but because it is followed by a comma the repair
scanner incorrectly closed the outer string. The same happened around the policy value.
The repaired candidate therefore remained invalid and no canonical response object was
found.

The synthetic v1.1.3 regression fixture missed this exact condition because its embedded
quoted metadata was followed by prose (`and`) rather than a comma.

## Why the Nano panel was empty in this run

No Nano Task executed in this run. The canonical-response barrier fired first, so
`lastNanoTask` correctly remained empty. This is distinct from the earlier v1.1.2 UI
binding defect, which v1.1.3 had already patched.

## v1.1.4 repair

- grammar-aware quote closure using JSON container/role context;
- an object string value followed by comma closes only when the following token is a
  valid object key;
- normal multi-item arrays remain parseable;
- candidate recovery is schema-anchored and full schema validation remains mandatory;
- the exact live comma-followed quoted-metadata pattern is now a regression test.

The fail-closed contract-invalid barrier is intentionally retained for responses that
remain genuinely unparseable after the bounded repair.
