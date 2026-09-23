# Model and language robustness — v1.7.3

## Purpose

Greenfield runs in a continuously mixed-language environment. Internal Greenfield/A2A control semantics use English for deterministic machine-to-machine behavior, while operator text and browser evidence may contain English, Swedish and Finnish in the same session.

## Incident fixed

The v1.7.2 UI observer admitted the global selector `button[aria-label*='Djup' i]`. A ChatGPT control such as `Nåla fast Djupanalys för lokal GPU-server` was therefore collected as reasoning-effort evidence. The safety lexicon then interpreted the Swedish word `fast` in `nåla fast` as the English effort label `Fast`, producing rank 0 while the actual composer control `Djupgående` produced rank 3. The conflicting ranks yielded `THINKING_EFFORT_UNKNOWN` and a fail-closed safety hold.

## v1.7.3 invariants

1. **Structural control identity precedes lexical classification.** Composer-local reasoning controls are preferred over weaker document-global candidates.
2. **No broad Swedish `Djup` substring selector.** `Djupanalys` must not become an effort control solely because its label contains `Djup`.
3. **Language-aware lexical interpretation.** The known Swedish UI phrase `nåla fast` / `fäst fast` is an action phrase; its `fast` token must not be interpreted as English Fast reasoning.
4. **Mixed language is normal.** English, Swedish and Finnish may coexist in UI labels, operator content and source evidence.
5. **Raw evidence is preserved.** Quoted UI/source labels are not translated before evidence evaluation or audit.
6. **English internal control plane.** A2A control prose, Nano directives/prompts and Hjalmar internal control prompts use English. Operator-facing UI may preserve the operator language.
7. **Ambiguity is not downgrade proof.** `THINKING_EFFORT_UNKNOWN` or `MODEL_IDENTITY_UNKNOWN` from mixed labels means the proof is ambiguous; it does not prove that the selected model or effort was downgraded. Re-read the raw controls and structural provenance before recommending a model change.

## Supported language baseline

The v1.7.3 bounded lexical baseline explicitly includes:

- English (`en`)
- Swedish (`sv`)
- Finnish (`fi`)

The list is not a claim that every ChatGPT localization string is known. Unknown labels continue to follow fail-closed/current policy rules when the configured effort floor cannot be established.

## Nano and EIC

Every A2A envelope carries `languageContext` using schema `eic.greenfield.language-context.v1`. It states English as the internal control language, `en/sv/fi` as continuously expected ambient languages, and `rawEvidenceLanguage=preserve`.

Nano remains prompt-only. Its prompt is English, but supplied evidence may contain Swedish/Finnish/English together. Nano must preserve quoted labels and must not map an incidental token to an English control meaning without structural/local-language context.

The receiving EIC session applies the same boundary. It must not treat a mixed-language parsing failure as owner evidence that the model changed.

## Acceptance fixture

This diagnostic set must resolve to `Djupgående` without ambiguity:

- `Nåla fast Djupanalys för lokal GPU-server`
- `Öppna konversationsalternativ för Djupanalys för lokal GPU-server`
- `Djupgående, klicka för att ta bort`
- `Djupgående`

Expected:
- effort label: `Djupgående`
- ambiguous: `false`
- Swedish `nåla fast`: not an English Fast-effort signal

## Claim boundary

Source/package tests verify the implementation against supplied fixtures. They do not prove the currently installed Chrome/ChatGPT DOM or selected provider model. Live acceptance remains a separate browser/runtime observation.
