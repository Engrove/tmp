# v0.9.9 Native LanguageModel Provider Policy

## Scope

This document governs the current v0.9.9 runtime provider choice for the local Chrome model. It is forward-only and does not preserve application compatibility with earlier EIC versions.

## Source evidence

The v0.7.8, v0.8.1 and v0.8.2 source packages all supported two browser surfaces:

- `globalThis.LanguageModel`
- `globalThis.ai.languageModel`

Their activation path called the selected provider's `create()` directly inside the operator gesture and supplied only the options supported by that provider.

The v0.9.8 field export proves that the current runtime selected `LanguageModel` and remained in `PREPARING_ASSETS` with no positive progress. It does not prove that `ai.languageModel` is present or runnable on the field host.

## Current provider law

v0.9.9 uses `LEGACY_NATIVE_FIRST` provider arbitration:

1. select `globalThis.ai.languageModel` when it exposes `create()`;
2. otherwise select `globalThis.LanguageModel` when it exposes `create()`;
3. otherwise fail closed with `LANGUAGE_MODEL_API_MISSING`.

This is a native provider choice, not a storage, export or UI compatibility adapter.

The selected provider is immutable for the lifetime of the base model session. Task sessions must use the same provider.

## Provider-specific invocation

For `ai.languageModel`:

- call `create()` directly inside the user gesture;
- send the historical `initialPrompts` contract;
- do not send standardized `expectedInputs`, `expectedOutputs` or `AbortSignal` fields;
- normalize legacy `capabilities().available` values such as `readily`, `after-download` and `no`.

For `LanguageModel`:

- keep the current English input/output modality declaration;
- pass `AbortSignal`;
- use `availability()` with the same modality declaration as `create()`.

## Evidence and logging

Every admission report and application-log event must include:

- selected provider kind;
- provider contract;
- provider policy;
- ordered inventory of detected providers.

A successful model session is not claimed until `create()` resolves with a real session object.
