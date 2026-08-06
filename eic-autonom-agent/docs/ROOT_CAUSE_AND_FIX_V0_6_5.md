# Root cause and fix — EIC Autonom Agent v0.6.5

## Scope

This release was produced from the supplied v0.6.4 source bundle and the supplied 2026-08-02 failure analysis. The analysis was checked against the actual source before patching.

The supplied `incident_reproduction_scripts.mjs` contains multiple independent snippets with repeated top-level imports and cannot run as one Node module. The relevant defects were therefore reproduced with independent, source-bound scripts and then covered by permanent regression tests.

## Verified root-cause chain

### 1. Protocol completion could be hidden

`parseTargetResult` required the protocol trailer to be the exact final four non-empty lines. Real browser `innerText` can append benign tool or UI lines after the assistant answer. The target result then became invalid, so turn-bound `DONE`/`CONTINUE` and deterministic progress were not available to the owner pipeline.

`content.js` independently required a `Status:` line that the EIC response contract never specifies. That made `protocolCompletionCandidate` false and disabled the intended foreground-completion override.

### 2. Nano input budgeting could invert an explicit drop

`compactContextText(value, 0)` used `Number(maxLength) || 4000`, so a deliberate zero allocation returned 4,000 characters.

The continuity projection retained large `antiLoop` arrays while evidence-bearing fields were trimmed. The prompt builder estimated a fixed frame using a constant and could finish several shrink rounds while still far above the requested limit.

The panel stopped shrinking after the bounded ladder but still called the model. Budgeting also reused the preceding task-session usage even when a clean base-session clone path was available.

### 3. Nano claim protection was not atomic

`processPendingNano` checked `modelBusy` and `activeNanoRequestId`, then awaited token measurements and hashing before setting them. A second poll could enter the same region. A losing invocation could later clear the shared flags in `finally` while the winner still ran.

### 4. UI errors were not durable evidence

`showError` only changed sidepanel state and wrote to the console. Pipeline errors could be visible to the operator but absent from the exported audit.

### 5. Destructiveness classification was language-dependent and fail-open

The classifier's high-risk patterns were predominantly English. Swedish instructions such as `utför merge`, `mergeauktorisation`, `migrera` and `starta om` could miss all rules. Unmatched non-empty text defaulted to level 1 `READ_ONLY`.

### 6. Recovery and lifecycle limits were present but ineffective

`recoveryBudget` was configurable and `consecutiveNoProgress` existed in run state, but neither affected control flow. Anti-loop escalation stopped at five cycles and repeated a bounded replan indefinitely.

A lifecycle gap extended the response deadline by the observed gap with no cumulative cap.

## Implemented corrections

### Protocol and foreground

- Search for exactly one contiguous protocol block in the last 24 non-empty lines.
- Preserve uniqueness and contradiction checks.
- Accept bounded benign trailing DOM text.
- Remove the non-contract `Status:` requirement from the content-script completion predicate.

### Nano prompt and budget

- Treat finite zero as zero in `compactContextText`.
- Ensure section allocations never sum above the caller's variable budget.
- Build a compact Nano-only projection that removes full anti-loop histories and retains scalar stagnation.
- Compact the run envelope and target result.
- Measure the actual fixed prompt shell and shrink against the exact final length.
- Fail closed after the degrade ladder: no model inference is started when the character or measured-token budget is still exceeded.
- Use the base session's current context usage when clone support is available, rather than the preceding task-session terminal usage.

### Concurrency and observability

- Add a synchronous, token-owned Nano dispatch lock before the first `await`.
- Only the invocation that owns the token may clear the lock.
- Add `ADD_AUDIT` and persist sidepanel errors through the background owner.

### Risk and language

- Add Swedish patterns for the destructiveness ladder.
- Treat unmatched non-empty actions as `UNCLASSIFIED`, level 6, with Hjalmar mental control required.
- Keep workbench capping bounded without matching the substring `lease` inside `release`.
- Declare local model text input/output for Swedish and English.

### Bounded recovery

- Cap cumulative lifecycle deadline extension.
- Increment/reset `consecutiveNoProgress` from deterministic progress.
- Enforce configured `recoveryBudget`.
- Escalate at eight stagnation cycles to `HUMAN_HANDOFF_REQUIRED`.
- Hold `NO_PROGRESS_BUDGET_EXHAUSTED` until explicit operator resume.

## Deliberately rejected change

The failure analysis proposed making additional Nano fields, including `verifiedFacts`, mandatory and promoting them during replay. The existing source explicitly defines verified facts as operator/local-evidence owned and prevents Nano or target output from promoting them.

v0.6.5 preserves that trust boundary. Model-provided claims remain target claims, inferences or context evidence until an owning evidence path promotes them.

## Residual items

The release does not claim that every D-01–D-32 observation is independently fixed. The direct incident chain and the source-verified structural defects above are addressed.

Items based on incomplete browser capture or requiring a live Chrome/ChatGPT owner surface—such as a claimed false prompt ACK, a specific composer error banner, token-efficiency measurements and exact desktop timing—remain desktop acceptance items rather than local Node proof.

Secondary content-quality observations (historic intent quality, list semantics and historical prompt wording) are not silently rewritten because their correct values depend on runtime evidence and task context.
