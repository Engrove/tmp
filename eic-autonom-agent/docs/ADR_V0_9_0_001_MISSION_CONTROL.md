# ADR 001 — Mission Control shell

## Status
Accepted for v0.9.0 planning.

## Decision
Replace the current long feature stack with a persistent shell containing Körning, Webbytor,
Evidens, Uppdrag and Inställningar. Existing functions become mission modes.

## Rationale
The browser subsystem would otherwise become another large card and increase coupling between
rendering, configuration and runtime behavior.

## Consequences
WP01 must establish a snapshot/command seam before WP03 changes layout. WP04 must preserve every
inventoried v0.8.2 function or document its replacement.
