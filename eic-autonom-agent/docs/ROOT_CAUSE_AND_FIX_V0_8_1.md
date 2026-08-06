# Root cause and fix v0.8.1

## Incident

Sidepanelen rapporterade:

`Content bridge 0.8.0 kunde inte verifieras.`

och en ChatGPT-flik kunde inte kopplas.

## Root cause

`lib/contracts.mjs` krävde `CONTENT_SCRIPT_VERSION = "0.8.0"`, men den faktiska content-bron i `content.js` rapporterade:

`const VERSION = "0.7.8";`

`background.js::ensureContentScript()` injicerade därför filen korrekt men avvisade sedan dess `EIC_PING` eftersom versionerna aldrig kunde matcha.

Detta var ett sourcefel i v0.8.0, inte endast en gammal flikcache.

## Fix

1. Alla aktiva versionsytor har höjts och synkroniserats till `0.8.1`.
2. Source validation läser även `content.js` och kräver exakt versionmatchning.
3. Bridgefelet visar både förväntad och observerad version.
4. Paket- och exportnamn härleds från versionskontraktet.
5. Historiska v0.7.8-etiketter har avlägsnats från dropdowns, medan interna kompatibilitets-ID:n bevaras för bakåtkompatibilitet.

## Runtime note

Efter att den nya unpacked extension-katalogen har laddats om bör den redan öppna ChatGPT-fliken laddas om en gång. Därefter kan den aktiva ChatGPT-fliken kopplas. Den nya bron kan även återinjiceras automatiskt, men flikreload är den säkraste acceptansvägen efter extensionuppdatering.
