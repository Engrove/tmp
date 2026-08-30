# EIC Autonom Agent v0.10.2 hotfix architecture

v0.10.2 is a source-compatible hotfix over the v0.10.1 current-only architecture.

It changes no persisted schema. Config/runtime remain v12, export remains v19, and the
v0.10.1 IndexedDB namespace remains the current session-context owner.

The hotfix has two rules:

1. Application identity in the side panel is rendered from `APP_VERSION`; HTML must not
   carry a release-specific version literal.
2. `renderControls` receives the current window context explicitly. It may not close over
   an undeclared `windowContext` identifier.

No compatibility adapter, migration or runtime effect is added.
