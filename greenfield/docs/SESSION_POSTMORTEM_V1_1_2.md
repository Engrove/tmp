# v1.1.2 live shakedown postmortem

## What passed

The first English Nano Task executed exactly once and returned exactly
`NANO_TEST_ANSWER=703`. Canonical target disposition was `CONTINUE`, and Hjalmar/runtime
reconciliation did not block the turn.

## Failure on the next target response

The captured ChatGPT DOM plaintext contained quoted literals inside
`nextSuggestedAction` without JSON escape characters. The strict target-response parser
therefore emitted `A2A_RESPONSE_NOT_FOUND` and status `UNKNOWN`.

The runtime then made two incorrect decisions:

1. it entered ANALYZING despite the invalid canonical target contract;
2. deterministic continuation admission allowed `targetDisposition=UNKNOWN`.

Because no canonical response value existed, `NANO_TASK:` extraction received an empty
source and the local Nano Task did not execute. Hjalmar repeated the raw directive, which
became the next objective.

## UI defect

The side panel had a `nanoPreview` element but `render()` never assigned it. In addition,
target response capture cleared `lastNanoTask`. Thus an earlier successful Nano Task was
not visible even though Audit contained its result.

## v1.1.3 repair

- strict-first parser with bounded renderer quote repair;
- complete schema validation after any repair;
- invalid target-response barrier before model analysis;
- independent continuation guard against `UNKNOWN`;
- preserve latest Nano Task across response capture;
- render Nano Task + Nano Observer in the side panel;
- carry prompt language/policy in bounded A2A analysis evidence.

The repair deliberately preserves the English-only Nano execution contract introduced in
v1.1.2.
