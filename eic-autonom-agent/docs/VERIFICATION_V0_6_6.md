# Verification — v0.6.6

## Automated checks

The local verification contract includes:

- Node test suite;
- static validator;
- JavaScript syntax checks;
- package generation;
- ZIP CRC verification;
- build-info digest verification;
- source archive byte comparison.

The v0.6.6 regression fixtures verify both positive and negative behavior:

- English-only `LanguageModel` capability is present;
- `sv` is absent from `MODEL_OUTPUT_OPTIONS`;
- synchronous and asynchronous invalid-context paths stop the local bridge;
- same-version reinjection no longer returns before disposing a stale bridge.

## Evidence boundary

Local tests can verify source behavior, static wiring and package integrity. They cannot prove real Gemini Nano inference, a particular Chrome runtime's installed language support, or desktop browser lifecycle behavior. Those require a fresh desktop-Chrome run and direct observation.

A Chrome error page from v0.6.5 is evidence of the historical failing runtime, not proof that v0.6.6 is installed or browser-E2E passed.
