# Verification — v0.9.6

## Direct source gates

- Exact v0.9.5 baseline before mutation: **644/644 PASS**.
- Focused Nano-host admission suite: **15/15 PASS**.
- Full regression: **659/659 PASS**.
- Validator: **PASS**.
- Syntax: **121/121 PASS**.
- Package/ZIP CRC, path, symlink and encryption checks: **PASS**.
- Frozen source rerun: focused **15/15**, full **659/659**, validator and syntax **PASS**.

## Required invariants

1. `LanguageModel.create()` is called before any `await` in the activation function.
2. Duplicate activation clicks reuse one in-flight create promise.
3. Abort and watchdog terminate host admission without creating a mission.
4. Telemetry distinguishes checking, downloadable, downloading, loading, available, timeout, aborted and error.
5. Download 100% changes to indeterminate loading.
6. Start controls remain disabled until a real session is available.
7. Stable unpacked extension identity is present in the manifest.
8. v0.9.3+ forward-only policy remains intact.

## Development identity

The bundled public manifest key resolves to the development extension ID:

`ebphijbinncmomgdjijpfbbfeonobbli`

The private key used to derive the public identity is not part of the source or runtime packages.

## Runtime boundary

Desktop Chrome and the actual built-in model are separate owner surfaces. Source and package tests do not prove that Chrome downloaded, loaded or executed Nano.
