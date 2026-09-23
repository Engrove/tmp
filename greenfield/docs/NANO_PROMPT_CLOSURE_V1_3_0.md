# Nano prompt-closure contract — Greenfield v1.3.0

## Core invariant

Nano is stateless and zero-context outside the current model invocation.

`knowledge(Nano task) = content explicitly supplied in that invocation`

The model's reasoning difficulty is not a Greenfield gate. A Nano task may be analytically
complex if its prompt is self-contained.

## Nano cannot implicitly know

- EIC or EIC Backend state;
- project records, Greenfield Works or prior mission turns;
- files, directories, ZIP members, mailboxes, repositories or artifacts;
- owner-route results;
- browser/DOM state except text explicitly copied into the prompt;
- web/API data;
- previous Nano calls, previous ChatGPT turns or hidden context.

Locators and references are not data. `/srv/...`, "the existing manifest", "the uploaded ZIP"
or "our current project state" do not provide Nano with the referenced content.

## Direct task request

Backward-compatible simple form:

`NANO_TASK: Calculate 37 * 19 and return only the integer.`

Preferred data-bearing form:

`NANO_TASK: {"schema":"eic.greenfield.nano-task.request.v2","knowledgeBoundary":"PROMPT_ONLY","instruction":"Classify each supplied field as SOURCE or DERIVED.","context":{"fields":[...]},"output":"Return JSON only."}`

The JSON must remain on the one `NANO_TASK:` line. `context` is serialized into the execution
prompt and therefore becomes part of Nano's knowledge for that one call.

## Admission and failure semantics

1. EIC should only author Nano work whose required information is in the prompt.
2. Runtime preflight catches obvious external-access and unresolved-reference patterns.
3. A preflight rejection creates `CONTEXT_REQUIRED` with `promptCalls=0`.
4. An admitted task is wrapped in a runtime prompt saying the prompt is Nano's entire world.
5. If Nano still detects missing information, it must return:
   `NANO_CONTEXT_REQUIRED: <brief missing information>`.
6. Runtime converts that output to terminal `CONTEXT_REQUIRED`.
7. Hjalmar/controller treat `CONTEXT_REQUIRED` as evidence for continuation in EIC, not as a
   mission blocker and not as authorization to replay the same task.

The deterministic preflight is intentionally not presented as a complete natural-language
proof of self-containment. The model-side fail-closed response and EIC-side A2A contract are
additional safeguards.

## Observer

Nano Observer is allowed because its entire input is constructed locally and bounded before
the call. It may reason only over those fields. `materialFacts` must come from supplied fields;
missing information belongs in `uncertainties`; risk/focus are local advisory judgments.

Observer output does not become project, owner, runtime, repository or artifact truth.
