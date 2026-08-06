# ADR 003 — Dual build permission boundary

## Status
Accepted for v0.9.0 planning.

## Decision
One source tree produces a standard package and a browser-enabled package.

- Standard: current restricted ChatGPT permissions; no `debugger`; no general website access.
- Browser: explicit optional host access and bounded `debugger` use for AI_WEB_RESEARCH.

## Rationale
A single privileged manifest would permanently weaken the privacy and review boundary for users who
only need continuation/audit functions.

## Consequences
WP06 owns build profiles, permission tests and package checks. A build-profile mix-up is a release
blocker.
