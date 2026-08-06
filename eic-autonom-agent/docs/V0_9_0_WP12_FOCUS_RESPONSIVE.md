# v0.9.0 WP12 — Focus Mode, responsiveness and accessibility

## Scope

WP12 changes presentation only. Browser protocols, permissions, risk decisions, recovery
semantics and persistence schemas remain unchanged.

### Focus Mode

- A header control and `Alt+F` shortcut toggle Focus Mode.
- The preference is stored only in panel `sessionStorage` under
  `eic.autonom.ui-focus.v1`.
- Secondary regions may be hidden only when explicitly marked
  `data-focus-secondary="true"`.
- Approval, recovery, boundary and primary run-status surfaces remain visible.
- Active Mission Control view is preserved inside the UI-only preference.

### Operational status priority

The panel derives one visual tone from snapshot-owned fields:

- `IDLE`
- `ACTIVE`
- `ATTENTION`
- `BLOCKED`

Recovery/blocked states override active states. Changes are announced through an
`aria-live="assertive"` status region.

### Responsive and accessible behavior

- One primary vertical page scroll.
- Horizontal tab navigation with 40 px touch targets at narrow widths.
- Single-column action dock and form grids at 420 px.
- Skip link, `:focus-visible`, reduced-motion and forced-colors support.
- Safety cards receive explicit primary styling in Focus Mode.
- Layout remains bounded at a readable maximum width on larger side panels.

## Non-goals

- No new background command.
- No config/runtime/export schema change.
- No permission or host change.
- No browser action, evidence, approval or recovery semantic change.
- No live Desktop Chrome acceptance; that remains WP13.

## Verification

- Focused WP12 contract: 15/15 PASS.
- Full regression: 575/575 PASS.
- Validator, background smoke, full syntax, packaged-source replay, build-info and ZIP
  integrity are required before the WP12 gate is frozen.
