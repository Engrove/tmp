# Changelog v0.11.14

- Removed the structured `USER_PAUSE` protocol marker from the lexical level-10 effect pattern.
- Real `USER_PAUSE` remains level 10 through the trusted structured `pauseOrigin` branch.
- Preserved all other level-10 authentication, credential, irreversible, policy and safety patterns.
- Rotated current-only config/runtime/audit storage namespace to v114 and export schema/version to v21.
- Preserved the v0.11.13 central owner-bound human-wait transition invariant unchanged.
- Added regression coverage for protocol-marker mention vs structured user-pause semantics.
- Bumped the destructiveness classifier revision to `EIC_DESTRUCTIVENESS/1@0.11.14` so persisted classifications identify the changed semantics.
