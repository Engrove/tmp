# v0.9.3 Forward-only policy

## Binding decision

Starting with v0.9.3, EIC Autonom Agent supports only the contract shipped by the running version.

Backward compatibility is not a product requirement for v0.9.3 or any later release.

## Required behavior

1. Older config/runtime/continuity schemas are not migrated.
2. Older export schemas are rejected.
3. UI commands without the exact current schema are rejected.
4. Older UI snapshots and transitional aliases are rejected.
5. Removed fields, states, commands, package aliases and semantics may disappear without adapters.
6. Tests for deleted compatibility behavior are removed from the acceptance gate.
7. A current-version reset may initialize fresh state; it must not reinterpret old bytes as current truth.
8. Historical documentation is non-normative.

## Current contract

- Config `eic.autonom.config.v10`
- Runtime `eic.autonom.runtime.v10`
- Continuity `eic.nano.continuity.v4`
- Export `eic.autonom.export.v13`, version 13
- UI command `eic.autonom.ui-command.v2`
- UI snapshot `eic.autonom.ui-snapshot.v3`
- Turn `EIC-AA/4`

## Safety

Forward-only does not weaken trusted-session, claim, owner-route, approval, effect, recovery or destructive-action gates. It removes compatibility obligations only.

An unsupported version must fail closed with an exact current-contract error. It must never be silently converted.

## Upgrade consequence

Installing v0.9.3 over an earlier version starts from the v0.9.3 storage namespace. Older local state remains outside the active namespace and is not adopted. Export/import requires an exact v13 export.
