# Changelog v0.8.1

## Fixed

- `content.js` rapporterade felaktigt bridgeversion `0.7.8` medan background och kontraktet krävde `0.8.0`. Detta gjorde att `ensureContentScript()` alltid avvisade en korrekt injicerad bridge.
- App-, manifest-, package-, UI- och content-bridge-version är nu `0.8.1`.
- Felmeddelandet för bridge-verifiering visar förväntad och observerad version.
- Versionsetiketter från v0.7.8 har tagits bort från de aktiva dropdown-etiketterna. Interna kompatibilitets-ID:n behålls för migrering och lagrad konfiguration.
- Export- och paketnamn härleds nu från aktuell versionskälla.

## Regression protection

- Source validation kräver att `content.js`-versionen matchar packageversionen.
- Regressionstest kräver versionsidentitet över APP_VERSION, CONTENT_SCRIPT_VERSION, content bridge och sidepanel.
- Regressionstest kräver att historiska kompatibilitets-ID:n inte exponeras som aktuella dropdownversioner.
