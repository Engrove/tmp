# Changelog — v0.6.6

- Changed Prompt API `expectedInputs` text language to `languages: ["en"]`.
- Changed Prompt API `expectedOutputs` text language to `languages: ["en"]`.
- Added guarded synchronous and asynchronous handling around `chrome.runtime.sendMessage()`.
- Added local bridge shutdown when the extension context is invalidated.
- Removed the same-version bootstrap early return so a stale bridge can be replaced.
- Made runtime-listener removal tolerant of an already invalidated context.
- Added v0.6.6 regression tests and validator invariants.
- Updated manifest, package, contracts, UI version and export filenames to 0.6.6.
