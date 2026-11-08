# EIC Company Learning Policy (Elli context model)

Condensed, rule-preserving projection of the previous 18_EIC_COMPANY_LEARNING.md.
The owner-verified `eic_ai_knowledge.ai_payload.context_model_export_profile`
and the `self_learn` response-assessment contract take precedence. This file
governs only what may be sent to the shared company context model; it does not
restrict other authorized retention (AIK Stream/Learned, memory, projects,
repositories, Operator Learning).

## Purpose
The context model gives larger Elli fast, long-lived orientation about the
company, product families and established system roles. Details, current
state and effects still come from factual owners. Describing this purpose does
not prove a deployed interface or a learned capability.

## Eligible content (semantic categories, not a source whitelist)
- Company identity, business orientation and relevant enterprise context.
- Product-family purpose and stable relationships (not model/version specs).
- Established system roles and functions shown to be implemented and working.
  Check implementation, function and lifecycle evidence; exclude EOL, retired,
  superseded and scheduled-for-EOL functions even if they still run, without
  excluding a whole system because one unrelated part retires.
An ordinary verified fact qualifies; it need not be a recurring incident or FAQ.

## Never exported as model facts
- Plans, roadmaps, unfinished or planned functionality (even labelled as plans).
- Version-specific or transient details: release/commit numbers, exact APIs or
  schemas, code, table/field dumps, model specs, prices, inventory,
  transactions, queue counts, current errors, runtime status,
  security-significant addresses or configuration. A date tag does not make
  them eligible.
- Raw prompts, transcripts, logs, transport canaries, experiments, dummy
  controls, policy instructions, technical receipts, unsupported causal
  explanations, contradictions and AI-generated plausibility.

## Audience
Content must be public or non-secret Elho-internal knowledge approved for the
whole direct and indirect audience, including recipients of answers forwarded
by larger Elli. Source access is not destination authorization; labels such as
admin, general, runtime_safe or internal_only do not prove it. Exclude
role-limited content, personal/customer data or cases, private memory and
secrets; removing names or masking credentials does not approve the rest.
Unresolved sensitivity means no candidate (not a manual approval ritual).

## Standalone meaning
Each delivered unit must be understandable without the session, earlier
examples, hidden prompts or a source fetch: include the entity, relationship,
local definitions, conditions and limits. A URL, commit, artifact id or
"see above" cannot replace meaning. Provenance, revisions, verification dates
and audience/lifecycle checks go in side metadata. Preserve scope,
quantifiers, uncertainty and causality; a derived relation needs evidence for
the inference as well as for its parts.

## Selection, preparation, evaluation
- Self-learn needs a lightweight assessment at its keypoint, not a positive
  write after every response. Use the owner's native outcomes. Repair
  recoverable gaps; an unresolved item never blocks unrelated eligible items.
- A fact is one coverage unit; alternate phrasings are not extra facts.
  Generate faithful question-specific variation only when preparation is
  separately authorized. Repair or reject a wrong example without rejecting a
  correct source fact.
- Closed-book questions may name the entity but must not contain the answer
  passage. Keep held-out tasks separate. Testing the same fact is not
  contamination. Do not turn true but hard facts into "unknown".
- This policy sets no variant quota, capacity limit, replay percentage,
  language selection or first-live threshold.

## Holds and publication
- An explicit operator hold overrides per-response capture, AIK
  promotion/revision hooks, Operator Learning exports, administrative enqueue,
  retries, forwarding, dataset compilation, training and publication for this
  destination. Do not evade it by calling a payload a candidate, storing it
  for later backfill or submitting a "harmless" assessment.
- While held, record a local `PAUSED_NO_EXPORT` disposition only (a workflow
  result, not an API enum). Broader method/AIK retention must not trigger
  export.
- A policy install, passed test, generic "continue", timer, code fix or restart
  is not permission to resume. Read the exact stage owner's state; not being
  able to read a permission is not permission.
- Periodic activation of a verified result is a separate decision. Before
  dataset inclusion and live publication recheck source, audience and
  lifecycle. Trace withdrawals to dependent examples; removing an input row
  does not prove removal from a trained adapter.

## Transport and claims
Use the owner-native capsule contract with exact request/event identity for
recovery; never replay reset or previously acknowledged data as a new test;
deduplicate at source level. Keep separate: assessment recorded, candidate
persisted, receiver ACK, content qualified, dataset built, model trained,
evaluation passed, adapter loaded. Low loss or an empty queue does not prove
knowledge gain. Configured skills or activated Knowledge do not prove that an
external client loaded them.
