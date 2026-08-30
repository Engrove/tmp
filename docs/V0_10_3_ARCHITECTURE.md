# EIC Autonom Agent v0.10.3 architecture

## Scope

v0.10.3 has two bounded changes:

1. background-owned automatic Session Capture for terminal ChatGPT assistant states;
2. a source-bound Nano review of settings and the three core surfaces.

## Automatic capture owner

The background service worker reads the linked ChatGPT page, normalizes its response state and admits capture only when:

- automatic capture is enabled;
- the linked target is current;
- the latest message is an assistant candidate;
- the response state is `COMPLETE_STABLE` or `COMPLETE_PROTOCOL_OVERRIDE`;
- the conversation/document/message fingerprint differs from the last successful capture;
- no capture is in flight.

The side panel is a view and manual control surface. It is not the automatic capture scheduler.

## Review lifecycle

The first successful capture in one application session creates one `eic.autonom.core-surface-review.v1` pending request. Later captures in the same application session do not create another automatic request.

The local Nano host analyzes:

- all supplied settings;
- the private Nano mandate;
- the target-session mandate;
- the compact continuity projection;
- the source-bound active Session Memory capsule.

The transcript and memory capsule are untrusted data. The review cannot change project identity, target mode, Mjölnar rollout, permissions, credentials, release, deployment or owner authority.

Lifecycle:

`PENDING_ANALYSIS -> ANALYZING -> PROPOSAL_READY -> APPLIED|DECLINED`

`FAILED` is terminal for the automatic attempt. A later attempt requires the manual reevaluation button.

## Apply boundary

Nano writes only a proposal. The operator must explicitly apply or decline it.

On apply:

- safe config fields are saved through the current config owner;
- rewritten mandates receive content-addressed custom versions;
- continuity receives a source-bound `UNTRUSTED_TRANSCRIPT_DERIVED` reviewed context;
- the Nano base session is marked stale when its mandate or whole-app profile changes.

No external or repository effect is authorized.
