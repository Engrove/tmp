# v0.11.21 architecture

## Incident

The v0.11.20 live run reached canonical baseline delivery, but initialization terminalized with
`NANO_ANALYSIS_FAILED`.

The exported decision trace records:

- `baselineCandidate=null`;
- `baselineParseErrors=["MAIN_TASK_BASELINE_NOT_FOUND"]`;
- `baselineResponseExtraction.canonicalTextLength=24`;
- `baselineResponseExtraction.complete=true`;
- `baselineResponseExtraction.baselineSchemaVisible=false`;
- `inputBudget.responseRecoveryComplete=true`;
- `inputBudget.semanticCoverage=null`;
- final validation failure
  `BASELINE_ANALYSIS_CANDIDATE_REQUIRED,BASELINE_ANALYSIS_SEMANTIC_COVERAGE_REQUIRED`.

At the same time, the target UI visibly contains a full `eic.main-task-baseline.v2` assistant
answer after a completed reasoning disclosure. The visible disclosure text
`Arbetade i 51 sekunder >` is exactly 24 characters.

## Root cause

v0.11.19/v0.11.20 made a top-level `[data-message-author-role]` node the canonical rendered-message
unit. Current ChatGPT can represent one conceptual assistant turn with more than one role-bearing
fragment, including a completed reasoning-duration disclosure and the final answer.

`getPageState()` selected the last assistant record. Therefore a role-bearing lifecycle fragment
could become:

- `latestAssistant`;
- response hash/identity;
- response-complete evidence;
- baseline response input;
- Capture turn.

The extraction itself was internally complete for that fragment, so recovery honestly reported
"complete" for the wrong owner. Nano was downstream of the ownership error.

## Canonical invariant

A semantic response is owned by one **conceptual conversation turn**, not by an arbitrary
role-bearing descendant.

For every candidate role node:

1. locate the nearest known ChatGPT conversation-turn shell;
2. use that shell as the canonical owner only if every role-bearing descendant has the same role;
3. otherwise fail back to the original role node, avoiding user/assistant merging;
4. deduplicate role-bearing fragments by canonical owner;
5. remove assistant lifecycle/reasoning status lines from semantic text;
6. compute response hashes, completeness, Capture text and structured-payload visibility from the
   same owner.

This preserves the existing response lifecycle and only repairs which DOM object is permitted to
enter it.

## Lifecycle text is not a response

The content bridge now rejects both transient status text and completed timed disclosure shapes,
including supported Swedish/English variants of:

- `Thinking` / `Tänker`;
- `Working` / `Arbetar`;
- `Worked for 51 seconds >`;
- `Arbetade i 51 sekunder >`;
- corresponding Thought/Reasoned/Analyzed variants.

A standalone lifecycle fragment cannot be a response candidate or Session Capture turn. When the
same text appears as a line inside a safe conceptual assistant turn, that line is stripped while
the final answer remains.

## Structured baseline preservation

`canonicalMessageRecord()` reads the safe turn owner rather than only the first role fragment.
`pre`/`code` discovery and baseline-schema visibility therefore span the complete conceptual turn.
The existing richer-rendered-response fallback remains intact.

## Deliberately unchanged

No new retry, timeout, Nano fallback, baseline semantic relaxation, parser tolerance or
human-boundary bypass is introduced. v0.11.20 runtime-root/receipt and USER_PAUSE repairs remain
byte-for-byte except for release identity where applicable.

## Release identity

v0.11.21 uses config/runtime schema v21, export v26, storage namespace `v1121`, current Session DB
namespace and v0.11.21 response-settle alarm identity.

## Claim boundary

The root-cause model is supported by the supplied v0.11.20 live export/audit plus the exact source
preimage and is repaired at source/package scope. Only Desktop Chrome can prove that the current
ChatGPT DOM actually resolves to the intended conceptual turn during a fresh live run.
