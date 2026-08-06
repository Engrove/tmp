# EIC review and correction — v0.7.4

## Scope

This review compares the uploaded v0.7.3 source with:

- the live EIC global skill catalog on 2026-08-03;
- the repository-local `EIC.md` contract from `jan-eric_enlund/eic_backend`;
- the live Forgejo source for `scripts/eic_app_audit.py`;
- the addon's own parser, state, UI, validator and test suite.

The review does not claim installed Chrome runtime behavior. Source tests and package validation
are separate from desktop/DOM acceptance.

## Architecture verdict

A new global app-audit skill is not required for the addon-driven flow.

The active global catalog already contains:

- `ai_to_ai_specification_compiler`;
- `nano_ai2ai_start_prompt_compiler`;
- `nano_marker_skeptical_autonomy_guard`;
- the existing coding, owner-route and Workbench orchestration skills.

The addon owns the versioned domain prompt. Nano inserts the two operator fields and carries
continuity, but must not semantically rewrite the invariant protocol prompt before dispatch.
A separate global skill would duplicate the contract and create a drift surface.

EIC must not infer that the Chrome addon is installed. The target session instead recognizes
the explicit request marker `EIC_APP_AUDIT_REQUEST/1`. That marker is a prompt-provenance claim,
not installation evidence.

## Verified corrections

### 1. Workbench Python executable

v0.7.3 used:

```text
python scripts/eic_app_audit.py
```

The EIC Workbench route uses `python3`. The invocation and prompt are corrected.

### 2. Finding status model

v0.7.3 invented `REPRODUCED` as a ledger status. The live ledger has no such state.

Correct model:

```text
OBSERVED
→ REPRODUCTION_REQUIRED
→ ACCEPTED_FINDING
→ PERSISTED
```

Reproduction is a separately logged `step` in phase `REPRODUCTION`, carried as
`reproduction_recorded=true`. Acceptance requires that earlier recorded step.

### 3. Command-specific idempotency

The v0.7.3 prompt stated one universal idempotency formula. The live CLI uses different keys:

- `log-step`: sequence number;
- `log-finding`: fingerprint;
- `review-major`: finding plus review revision;
- `record-sink-receipt`: input-derived receipt ID;
- `checkpoint`: checkpoint ID.

The prompt now describes these separately and permits `replayed=true` only when the CLI
actually returns it.

### 4. ZIP and Forgejo receipts

v0.7.3 required an owner readback locator for every persistence claim and omitted
`bundle_sha256`.

The live ledger requires:

- Forgejo: `owner_readback_locator`;
- `ZIP_BUNDLE`: `bundle_sha256`.

The event schema, parser, durable state and tests now support both shapes.

### 5. First-turn identity binding

v0.7.3 created the addon run and turn IDs after building the prompt. The target session
therefore never received the IDs that its first event was required to echo.

v0.7.4 creates the run and first turn first, then compiles the prompt with exact
`AUDIT_RUN_ID` and `INITIAL_TURN_ID` before digesting or dispatching it.

### 6. Audit-mode start race

v0.7.3 dispatched the start prompt while the run was still `NEW_SESSION` and changed the
mode in a later queue operation.

v0.7.4 initializes `APP_AUDIT_LONG`, the audit state and the effect ceiling before the
first prompt can leave the addon.

### 7. Progress calculation

v0.7.3 calculated valid progress before folding the event, then later recalculated it
against the already-updated state. The second calculation compared the event with itself,
erasing step and coverage progress.

v0.7.4 uses the pre-fold progress stored on the accepted gate. Invalid events count as zero
progress.

### 8. Parser identity and integer handling

v0.7.3:

- allowed missing run/turn IDs to bypass mismatch checks;
- truncated fractional step numbers;
- converted numeric strings to integers.

v0.7.4 requires non-empty identities and a positive JavaScript safe integer.

### 9. Fingerprints and row receipts

v0.7.4 requires:

- a lowercase 64-character SHA-256 fingerprint for every finding event;
- the exact run database path;
- a real ledger row type;
- a row type consistent with the finding transition.

### 10. Secret retention

v0.7.3 classified secret-shaped event content as advisory, after which a valid event could
still be retained in `chrome.storage.local`.

v0.7.4 makes this a blocking gate.

### 11. Export completion

v0.7.3 marked any `EXPORT` phase or `DONE` claim as exported. A later turn could therefore
pass the completion gate without a bundle hash.

v0.7.4 marks export only after a structurally valid `ZIP_BUNDLE` receipt with
`READBACK_VERIFIED` and a SHA-256 bundle digest.

### 12. Required SQLite ledger

The UI previously allowed Workbench audit files to be disabled even though the mode requires
SQLite receipts. The switch is now a locked prerequisite, and the background route rejects a
ledgerless start.

### 13. Checkpoint wording

The addon can checkpoint its own Nano continuity. It cannot create a SQLite checkpoint for
EIC. The prompt now requires EIC to run the ledger's `checkpoint` command before rollover and
does not equate an addon rollover with a database checkpoint.

### 14. Trailer claim

The old prompt said any event after the trailer makes it unreadable. This is not always true;
it depends on the post-DOM line window. The corrected wording says the placement is unsupported
and always rejected because it is structurally unstable.

## Reclassified statements from the v0.7.3 report

- `314/314` tests: source-verified for the uploaded package.
- `VALIDATE PASS`: source-verified for the uploaded package.
- Package digest `966a5828…`: present in the uploaded build manifest.
- “Two-turn readback verification”: corrected to **two-turn ordering gate**. It reduces one
  fabrication pattern but does not verify an owner effect.
- `workspace_trusted_session_required` as ledger blocker: stale for this review. The module is
  present in Forgejo and has been Workbench-tested. This does not prove Chrome runtime behavior.
- Parser not tested against a real installed Chrome/EIC response: retained as an
  **OPEN ACCEPTANCE GAP**, not a source-code blocker.

## Verification

v0.7.4 source verification:

- full Node suite: PASS;
- validator: PASS;
- package generation: required before delivery;
- Chrome installation/DOM acceptance: not performed in this review.

## Claim boundary

A passing addon gate means only that the target-session claim is structurally consistent,
properly ordered and safe to retain. It does not establish that Workbench, SQLite or Forgejo
performed the claimed effect.
