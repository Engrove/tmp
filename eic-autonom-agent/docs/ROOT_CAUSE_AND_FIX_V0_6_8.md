# v0.6.8 — D2 privileged owner-route handoff

## Requested capability

The operator required a fourth Mjölnar rollout mode with elevated responsibility for auth, permissions, merge, release and deploy while leaving the remainder of the extension intact.

## Design finding

v0.6.7 already classified reversible permission, merge, release and deploy operations as destructiveness level 9, but its Mjölnar action registry contained only local Chrome actions. The existing `D2_HUMAN_AUTHORITY` label was used exclusively for level-10 human boundaries and no `D2_LIVE` rollout existed.

The extension has no direct Forgejo, deployment, authorization or production backend. Therefore D2 cannot truthfully perform those owner effects locally. The smallest functional implementation is an explicit privileged handoff to the already-linked ChatGPT target session, which may use its own authorized owner routes.

## Implemented correction

1. Added `D2_LIVE` as an opt-in rollout mode.
2. Added `D2_PRIVILEGED` as a distinct delegation class.
3. Added five exact action codes:
   - `AUTH_OWNER_ROUTE`
   - `CHANGE_PERMISSION`
   - `MERGE_BRANCH`
   - `CREATE_RELEASE`
   - `DEPLOY_PRODUCTION`
4. D2 dispatch requires:
   - exact target;
   - non-local owner route;
   - resolvable owner-evidence locator;
   - explicit governing authority;
   - destructiveness level 9;
   - `reversibility=YES`;
   - exact rollback path;
   - exact readback plan;
   - `humanAuthorityClass=NOT_REQUIRED`;
   - `materialAmbiguity=NONE`;
   - local Hjalmar mental-control `PASS`.
5. The content bridge submits a bounded D2 prompt with a digest and no turn-marker requirement.
6. Prompt acknowledgement creates only `READBACK_PENDING`.
7. A later assistant response creates only `OWNER_RESPONSE_OBSERVED` / `RESPONSE_OBSERVED_UNVERIFIED`.
8. No D2 handoff reaches `VERIFIED_EFFECT` from target text alone.

## Auth boundary

D2 auth means operating through an already-authorized owner route or session. It does not mean entering a password, solving CAPTCHA, reading a token/private key, exposing a secret or satisfying an explicit user-presence factor. Those conditions remain destructiveness level 10 and `HUMAN_AUTHORITY_REQUIRED`.

## Unchanged surfaces

- Existing D0 and D1 action semantics.
- Dynamic v0.6.7 WAITING trigger.
- English-only Nano capability declaration.
- Continuity, migration schemas and storage keys.
- Chrome permission allowlist.
- Host permission allowlist.
- No backend or new network endpoint.
