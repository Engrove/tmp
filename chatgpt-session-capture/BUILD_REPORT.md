# Build and verification report

Version: **1.1.2** · Date: 2026-10-28

## Method

1. The 1.1.1 release was imported unchanged as a baseline, so that every 1.1.2 change can be reviewed as a diff.
2. A regression harness (`tests/`) was written before the fixes. It loads an unpacked build into Chromium, serves a deterministic mock conversation for `https://chatgpt.com/*`, drives the real background message API, downloads the real ZIP through `chrome.downloads` and validates it with Python's `zipfile`.
3. Each defect was reproduced against 1.1.1, fixed, and the same harness was run against 1.1.2.

Test environment: Chromium 153.0.8010.12 (Playwright 1.63, headless), Node 22.22.0, Python 3.13.17, ESLint 10.1.0.

The mock conversation (`tests/fixtures/mock-chatgpt.cjs`) has 40 turns, of which 20 are loaded initially and 20 are lazy-loaded when the container is scrolled to the top. It uses windowed rendering with node reuse, reasoning toggles (`button[aria-expanded]`) whose state is lost on unmount, code blocks with a language label and a copy button inside `<pre>`, a user message with indented Python, a turn with two assistant message roots, an uploaded image without a file-name extension and a periodic `/api/auth/session` request that returns a bearer token. It reproduces the structural properties the extension depends on; it is not ChatGPT's markup.

## Defect register

Severity: **critical** = wrong verdict or credential leak; **high** = core function fails or transcript content is wrong; **medium** = content missing or misleading UI; **low** = robustness or hygiene.

| # | Severity | Area | Defect in 1.1.1 | Root cause | Evidence |
|---|---|---|---|---|---|
| 1 | critical | verdict | `VERIFIED_COMPLETE_BROWSER_TRANSCRIPT` with 32 of 40 turns after **Stop capture** during a sweep | Records after the stop were dropped; the sweep kept running and its summary (session fallback) was used; the export never compared observed and stored turns, so a truncated tail was invisible | D1, unit `tail truncation` |
| 2 | critical | verdict | Verified verdict after the tab navigated to another conversation | No conversation identity check | E1 |
| 3 | critical | privacy | ChatGPT bearer token exported with sensitive capture off (page network and deep network) | Response bodies are strings; redaction only matched URLs and object keys | C2, I3 |
| 4 | high | lifecycle | **Run full session sweep** fails with `Capture is not active for this tab` after the idle service worker was stopped | `port.onDisconnect` reset the content script's state and the port was never reopened | A2, A3, G2, G3 |
| 5 | high | fidelity | Indentation and blank-line runs removed from every code block and user message | `normalizePlainText` stripped `\n[ \t]+` and collapsed `\n{3,}` over the whole Markdown | B4, B5, B6 |
| 6 | high | fidelity | Code blocks contain `pythonCopy code` | `<pre>.textContent` includes the language label and button | B6, B7 |
| 7 | high | fidelity | Final answer replaced by the expanded reasoning block | `querySelector('.markdown')` took the first `.markdown`, which is the reasoning content when it uses the same class and precedes the answer | B8 |
| 8 | high | fidelity | Only the first message root of a turn captured | `preferredMessageRoot` used one root | B10 |
| 9 | high | verdict | Deep-network transcript never verified | Any `*failed*`/`*error*` record kind, including ordinary page request failures (`cdp-network-loading-failed`), blocked the verdict | I5 |
| 10 | medium | security | A page script can inject a `conversation-turn` record into the transcript | The bridge accepted every record kind from the MAIN world; the token is observable by page scripts | C3 |
| 11 | medium | fidelity | URLs in message text rewritten (`https://example.com.` → `https://example.com/.`) | Message text passed through the URL sanitizer, which re-serialized every URL | B11 |
| 12 | medium | evidence | MHTML corrupted by redaction, and the signed URL not redacted | URL rewriting inside quoted-printable content; a soft line break `=` became `=/` (reproduced on a QP sample: `files.oaiuserconten=/`), and the split URL escaped the pattern | I4, sample below |
| 13 | medium | UI | Sweep and Stop buttons re-enabled 1.5 s into a running sweep; a reopened popup showed default options instead of the running capture's and offered another sweep | Status polling called `applyStatus`, which ignored the busy state; options were not persisted or read back | F1, F3 |
| 14 | medium | fidelity | Reasoning body omitted from `session.md` when the panel contained any button | `if (body && !panel.steps.length)` | unit `reasoning body is printed` (1.1.1 prints no body) |
| 15 | medium | fidelity | Uploaded images without an extension not listed as attachments | File-name regex only | B12 |
| 16 | medium | fidelity | A collapsed reasoning panel could take the answer block as its content | `nextElementSibling` heuristic without expansion or position checks | DOM test `collapsed reasoning panel` |
| 17 | medium | integrity | A poorer later observation of a turn overwrote a complete one | Last write wins | unit `turn-merge` |
| 18 | low | fidelity | Multi-line table cells split the Markdown row | Cell text not joined | B14 |
| 19 | low | lifecycle | Captures stay `active` forever after an extension reload or browser restart | No reconciliation | H1 |
| 20 | low | robustness | Concurrent port messages could be processed out of order (chunk before begin); record count updates raced | Async listener without serialization | code review |
| 21 | low | performance | Four IndexedDB open/close cycles per record | No shared connection | code review |
| 22 | low | robustness | Evidence NDJSON built as one string (V8 limit ~512 MiB); MHTML stored twice | String join; no external reference | code review |
| 23 | low | evidence | Runtime snapshot serialized `outerHTML` for every DOM node referenced by a React fiber | `safeSerialize` of `Node` | code review |
| 24 | low | hygiene | Unused functions `fnv1a` (bridge.js) and `safeName` (export.js) | Dead code | ESLint |

Also changed: Swedish and additional English reasoning labels, unrecognised expandable controls reported, verdict made independent of whether ChatGPT numbers turns from 1, per-file SHA-256 manifest, turn-boundary markers, live sweep progress and remembered options in the popup.

## End-to-end results (same harness, both versions)

**1.1.1: 18/42 · 1.1.2: 42/42.** The complete 1.1.2 run was executed twice (once inside `tests/run-all.sh`), 42/42 both times; earlier revisions of the harness also passed in five further runs.

| ID | Check | 1.1.1 | 1.1.2 | 1.1.1 observation |
|---|---|---|---|---|
| A1 | Capture starts | PASS | PASS |  |
| A2 | Full sweep succeeds after the service worker was terminated between start and sweep | **FAIL** | PASS | `Error: Error: Capture is not active for this tab.` |
| A3 | All 40 turns stored after service-worker restart | **FAIL** | PASS | `sweep failed` |
| B0 | Full sweep succeeds | PASS | PASS |  |
| B1 | ZIP passes CRC validation (zipfile.testzip) | PASS | PASS |  |
| B2 | All 40 turns captured, including 20 lazily loaded older turns | PASS | PASS |  |
| B3 | Verdict is VERIFIED_COMPLETE_BROWSER_TRANSCRIPT | PASS | PASS |  |
| B4 | User Python indentation preserved verbatim (session.json finalAnswer.text) | **FAIL** | PASS | `"Fix this function:\ndef f(x):\nif x:\nreturn 1\n\nreturn 2"` |
| B5 | User Python indentation and blank lines preserved in session.md | **FAIL** | PASS | `expected verbatim user text in session.md` |
| B6 | Assistant code block reproduced verbatim with language tag | **FAIL** | PASS | `python\npythonCopy codedef g(items):\ntotal = 0\nfor item in items:\ntotal += item\n\nreturn total\n` |
| B7 | Code-block header/button text ("Copy code") not mixed into code | **FAIL** | PASS | `Answer for turn 6.\n\npython\npythonCopy codedef g(items):\ntotal = 0\nfor item in items:\ntotal ...` |
| B8 | Turn 2 final answer is the answer, not the expanded reasoning block | **FAIL** | PASS | `### Checking the indentation\n\nReasoning summary for turn 2.\n\nRead file` |
| B9 | Reasoning body text present in session.md even when the panel contains buttons | PASS | PASS |  |
| B10 | Turn with two assistant message roots keeps both parts | **FAIL** | PASS | `Part A of turn 4.` |
| B11 | URL in message text is not rewritten ("https://example.com." stays as typed) | **FAIL** | PASS | `"See https://example.com/. for details."` |
| B12 | Uploaded image without file extension is listed as an attachment reference | **FAIL** | PASS | `[[3,"file-reference","report.pdf"]]` |
| B13 | File chip report.pdf is listed as an attachment reference | PASS | PASS |  |
| B14 | Multi-line table cell stays on one Markdown table row | **FAIL** | PASS | `\| a \| line one\nline two \|` |
| B17 | Reasoning panel without .markdown class captured expanded with content | PASS | PASS |  |
| B15 | Signed attachment URL parameter (sig) is not exported in transcript mode | PASS | PASS |  |
| B16 | Clean capture reports zero error records | PASS | PASS |  |
| C0 | Evidence sweep succeeds | PASS | PASS |  |
| C1 | Page fetch of /api/auth/session was captured (precondition for C2) | PASS | PASS |  |
| C2 | Bearer access token is not exported when sensitive capture is off | **FAIL** | PASS | `token found in export` |
| C3 | A conversation-turn record forged by a page script is rejected | **FAIL** | PASS | `forged turn present in session.md` |
| D1 | Stopping during a sweep never yields a VERIFIED verdict for an incomplete transcript | **FAIL** | PASS | `status=VERIFIED_COMPLETE_BROWSER_TRANSCRIPT turns=32 fullOk=true ` |
| E1 | Sweep after in-app navigation to another conversation is refused or not verified | **FAIL** | PASS | `fullOk=true  status=VERIFIED_COMPLETE_BROWSER_TRANSCRIPT` |
| F1 | Popup keeps Start and Full sweep disabled while a sweep is running (after status polling) | **FAIL** | PASS | `{"start":true,"full":false,"stop":false}` |
| F2 | Popup shows live sweep progress | **FAIL** | PASS | `null` |
| F3 | Reopened popup during the sweep shows the capture options, locked, and the sweep state | **FAIL** | PASS | `{"settleMs":"1000","settleDisabled":false,"full":false,"badge":"AKTIV"}` |
| G1 | Worker killed mid-sweep: export never claims VERIFIED with missing turns | PASS | PASS |  |
| G2 | A second sweep after the worker restart succeeds | **FAIL** | PASS | `Error: Error: Capture is not active for this tab.` |
| G3 | After the second sweep all 40 turns are stored and verified | **FAIL** | PASS | `status=NO_COMPLETED_SWEEP_RECORDED turns=25 failed=` |
| H1 | A capture left active by a reload/restart is marked interrupted | **FAIL** | PASS | `status=active` |
| I0 | Deep-network capture starts (chrome.debugger attached) | PASS | PASS |  |
| I1 | Deep-network sweep succeeds | PASS | PASS |  |
| I2 | Debugger response bodies for /api/auth/session were captured (precondition for I3) | PASS | PASS |  |
| I3 | Bearer access token absent from a deep-network export without sensitive capture | **FAIL** | PASS | `token found in export` |
| I4 | MHTML is skipped without sensitive capture and no evidence/mhtml file exists | **FAIL** | PASS | `["AI_TO_AI_INSTRUCTIONS.md","conversation/session.md","conversation/session.json","diagnostics/co...` |
| I5 | Transcript verdict in deep-network mode is verified | **FAIL** | PASS | `CAPTURED_WITH_UNVERIFIED_BOUNDARIES_OR_GAPS ` |
| J1 | Capture with "reload tab after start" starts and the tab reloads | PASS | PASS |  |
| J2 | Sweep after the reload captures and verifies all 40 turns | PASS | PASS |  |

B9 passes on 1.1.1 only because of defect 7: the reasoning text appears inside the misattributed final answer. Defect 14 is proven by the unit test instead.

## Other verification of 1.1.2

| Check | Result |
|---|---|
| `node --check` on every shipped script | pass |
| ESLint (`tools/lint.sh`: no-undef, no-unused-vars, no-unreachable, …) | 0 problems (1.1.1: 2 unused functions) |
| Node unit tests (`node --test tests/unit/*.test.cjs`): sanitizer, turn merge, verdict logic, ZIP writer validated with Python `zipfile` | 29/29 |
| DOM extraction tests in Chromium (`tests/browser/capture-core.cjs`) | 9/9 |
| End-to-end scenarios (`tests/browser/e2e.cjs`) | 42/42, two complete runs |
| `manifest/sha256sums.txt` checked with `sha256sum -c` on an exported archive | all OK |

MHTML reproduction for defect 12: an `<img>` with a signed URL was encoded as quoted-printable (Python `quopri`), wrapped in an MHTML part and passed through 1.1.1's `sanitizeValue`. Decoded before: `src="https://files.oaiusercontent.com/…&sig=SECRETSIG%2Babc%3D"`. Decoded after: `src="https://files.oaiuserconten=/` followed by a line break and `t.com/…&sig=SECRETSIG%2Babc%3D"`. The host name is corrupted and the signature is still present.

## Not verified

- **Live ChatGPT DOM.** All browser tests use the mock page. Whether ChatGPT currently renders reasoning content with the `.markdown` class, places several message roots in one turn, or numbers turns from 1 could not be checked without a signed-in session. 1.1.2 handles both variants of each of these. `unclassifiedToggleLabels` and `failedChecks` show where a live page differs from the assumptions.
- **In-place upgrade with open tabs.** Replacing the files and reloading the extension could not be exercised: under Playwright an extension becomes unreachable after `chrome.runtime.reload()`, also for an unchanged 1.1.1. The README therefore asks for a reload of ChatGPT tabs that were open before the upgrade.
- **Long sessions.** The harness conversation has 40 turns. Chrome's lifetime limits for a single long-running extension request were not measured; the sweep no longer depends on that request surviving (scenario G).

## Reproducing

```bash
PLAYWRIGHT_MODULE=/path/to/playwright tests/run-all.sh
```

```bash
node tests/browser/e2e.cjs /path/to/unpacked-1.1.1 --json result-1.1.1.json
```
