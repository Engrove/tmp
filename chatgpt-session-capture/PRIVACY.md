# Privacy statement

ChatGPT Session Capture performs local collection only. This statement applies to version 1.1.2.

- It contains no analytics, telemetry, advertising code or external JavaScript dependencies.
- It does not transmit captured data to a server.
- Capture records are stored in the extension origin's local IndexedDB until exported or deleted.
- ZIP exports are generated locally by an offscreen extension document.
- The default `ai-transcript` profile does not capture page network traffic, Chrome Debugger traffic, IndexedDB, Cache Storage, page globals, React properties, full-page HTML or cookies.
- Browser-visible reasoning summaries are collected only when they are exposed in the ChatGPT page UI during the controlled sweep.
- Attachment and image references do not imply that attachment bodies were captured. This is stated explicitly in `attachments/manifest.json`.
- Conversation text (messages, code, reasoning summaries) is stored exactly as rendered and is never rewritten by the redaction step. Signed query parameters (`sig`, `token`, `key`, `expires`, …) are redacted in link, image and attachment URLs.
- Unless the user explicitly enables sensitive capture, evidence mode redacts:
  - authentication, cookie, CSRF, API-key, session/device-identifier and `*-token` headers;
  - fields with such names at any depth of a stored record;
  - JSON string fields with such names inside captured bodies and storage values (for example `accessToken` in `/api/auth/session`);
  - JSON Web Tokens and `Bearer` credentials anywhere in captured strings;
  - signed URL parameters.
- MHTML page snapshots (deep network mode) are captured only when sensitive capture is enabled, because they cannot be redacted without corrupting them.
- Redaction is pattern-based. It cannot recognise every secret format; an evidence-mode archive must be treated as containing credentials-adjacent data.

Conversation content and filenames may themselves be confidential. Treat every exported archive as a sensitive document.
