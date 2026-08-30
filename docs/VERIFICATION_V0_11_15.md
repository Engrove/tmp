# Verification v0.11.15

Required source/package checks:

- exact v0.11.14 preimage SHA-256 match;
- all JavaScript/module syntax checks;
- all JSON parse checks;
- response-settle liveness unit tests;
- exact live-shaped incident replay: exported v0.11.14 candidate hash/epoch at `stableReads=1` plus the later owner tick must settle the unchanged response to read 2;
- counterexample: genuine foreground streaming/composer-busy evidence must remain `GENERATING_FOREGROUND` and must not be normalized as terminal;
- event-chain fixture: first read -> lost volatile timer -> durable owner wake -> same response settles -> `OPERATOR_ACTION_REQUIRED` remains boundary-eligible;
- static ordering: liveness/foreground normalization precedes the foreground early-return and ordinary settle gate remains downstream;
- typed bounded timeout fixture;
- v0.11.14 lexical `USER_PAUSE` regression;
- v0.11.13 owner-bound functional and state-space regression;
- release-identity consistency;
- fresh post-package extraction repeat;
- ZIP CRC/path/symlink/encryption/duplicate checks and exact build-info payload hashes.

Desktop Chrome runtime acceptance remains separate from source/package verification.
