# Greenfield 1.7.6 — Owner-state/current_focus contract

`project.current_focus` is `STEERING_POINTER_NOT_FACT_OWNER`.

1. Before selecting the first bounded work package, read fresh subject-project owner state.
2. When the subject is project-bound, read and reconcile `project.current_focus`.
3. If `current_focus` conflicts with newer exact owner evidence, the newer owner evidence governs.
4. Do not repeat a completed objective/effect merely because `current_focus` is stale.
5. Update `current_focus` only after a material steering/restart-state change.
6. A `current_focus` write is complete only after owner readback.
7. If the focus metadata write is unavailable but unrelated work is safe, preserve the restart pointer through another correct durable owner/chronology route, route the metadata defect to its owner, do not blind-retry, and continue unrelated safe work.
8. Before any material effect, revalidate the exact effect target and owner.
9. Before pause/yield/block/done/handoff, persist material mission state and update `current_focus` only if restart/lead state materially changed.
10. Do not repeat the same objective/effect probe without a material owner-state delta.

This release is intentionally limited to prompt/owner-state safety. It does not close GF-001 issue #1 M3 and does not claim live Chrome acceptance from Node/static tests.
