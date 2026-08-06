# Changelog v0.8.0

## Added

- Isolerat `ARCHAEOLOGY_LONG` för analys, reverse engineering och forskning.
- Sex forskningsscenarier, där ERP reverse engineering är ett av flera.
- `EIC_ARCHAEOLOGY_REQUEST/1` och `EIC_ARCHAEOLOGY_EVENT/1`.
- Workspace-aware Nano- och targetprofiler.
- Snabbprofil och separata dropdowns för kärnyta 1, 2 och kontinuitetsvy 3.
- Strikt `USER_PAUSE` som nivå-10-operatörsgräns.
- Runtime-effektgräns för ARCHAEOLOGY_LONG.

## Compatibility

- v0.7.8 Nano- och targetmandat bevaras ordagrant som standardprofiler.
- Befintliga run modes aktiveras och beter sig som tidigare om ingen ny profil väljs.
- Permissions och host allowlist är oförändrade.
- Config/runtime/export-scheman är oförändrade; nya configfält är additiva och valfria.
