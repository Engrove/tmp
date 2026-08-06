# Flikreload och content bridge — v0.6.1

Efter extension reload måste redan öppna ChatGPT-flikar laddas om en gång så att `content.js` v0.6.1 aktiveras. Background verifierar bridge-version och kan återinjicera deklarerad content-fil via `chrome.scripting` när tillåtet.

Reload ändrar `documentEpoch`. Pending observation/effect med gammal epoch får inte fortsätta utan reconciliation. Turn-ID- och user-message-digest-set bevaras bounded i window state så att DOM-virtualisering eller senare meddelanden inte skapar blind dublett.
