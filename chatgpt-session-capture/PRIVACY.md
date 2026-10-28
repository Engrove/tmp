# Privacy statement

ChatGPT Session Capture 1.1.0 performs local collection only.

- It contains no analytics, telemetry, advertising code or external JavaScript dependencies.
- It does not transmit captured data to a server.
- Capture records are stored in the extension origin's local IndexedDB until exported or deleted.
- ZIP exports are generated locally by an offscreen extension document.
- The default `ai-transcript` profile does not capture page network traffic, Chrome Debugger traffic, IndexedDB, Cache Storage, page globals, React properties, full-page HTML or cookies.
- Browser-visible reasoning summaries are collected only when they are exposed in the ChatGPT page UI during the controlled sweep.
- Attachment references do not imply that attachment bodies were captured. This is stated explicitly in `attachments/manifest.json`.
- Evidence mode recursively redacts common authentication headers, cookies, CSRF/API keys, OpenAI session/device identifiers and signed URL parameters unless the user explicitly enables sensitive capture.

Conversation content and filenames may themselves be confidential. Treat every exported archive as a sensitive document.
