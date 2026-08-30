# Verification v0.12.0

Source preimage:

- `eic-autonom-agent-v0.11.22-browser.zip`
- SHA-256: `b43db1430214fb4594ea9d6f9de8db97636325cd1381f5728d0fa863823daad6`
- Identity: PASS

Automated checks:

- PASS: preimage_sha256 — b43db1430214fb4594ea9d6f9de8db97636325cd1381f5728d0fa863823daad6
- PASS: manifest_version
- PASS: app_version
- PASS: content_version
- PASS: causal_planes
- PASS: effect_lifecycle
- PASS: response_binding_preparse
- PASS: mission_response_bypasses_protocol
- PASS: material_event_closes_stale_owner
- PASS: no_historical_turn_ids_as_owner
- PASS: nano_policy_fence
- PASS: wait_quiescence
- PASS: terminal_atomic_cleanup
- PASS: mission_plane_baseline
- PASS: baseline_schema_v3
- PASS: node_syntax_all — 0 failures across 99 files
- PASS: v0120_regression_suite — PASS v0.12.0 causal control regression suite

Claim boundary: source/package verification only. Desktop Chrome live acceptance is not part of this local build.
