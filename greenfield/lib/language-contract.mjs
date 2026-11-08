export const GREENFIELD_LANGUAGE_CONTEXT_SCHEMA = "eic.greenfield.language-context.v1";
export const GREENFIELD_INTERNAL_LANGUAGE = "en";
export const GREENFIELD_AMBIENT_LANGUAGES = Object.freeze(["en", "sv", "fi"]);

export const GREENFIELD_LANGUAGE_CONTEXT = Object.freeze({
  schema: GREENFIELD_LANGUAGE_CONTEXT_SCHEMA,
  internalControlLanguage: GREENFIELD_INTERNAL_LANGUAGE,
  a2aLanguage: GREENFIELD_INTERNAL_LANGUAGE,
  nanoLanguage: GREENFIELD_INTERNAL_LANGUAGE,
  hjalmarLanguage: GREENFIELD_INTERNAL_LANGUAGE,
  operatorFacingLanguagePolicy: "preserve_operator_language_when_practical",
  mixedLanguageExpected: true,
  ambientLanguages: GREENFIELD_AMBIENT_LANGUAGES,
  rawEvidenceLanguage: "preserve",
  semanticRule: "Treat UI, operator and source text as potentially mixed English, Swedish and Finnish. Resolve structural control identity and local language/context before lexical ranking; never reinterpret an incidental token solely by another language's meaning."
});

export function languageContextCapsule() {
  return {
    ...GREENFIELD_LANGUAGE_CONTEXT,
    ambientLanguages: [...GREENFIELD_AMBIENT_LANGUAGES]
  };
}

export const GREENFIELD_MIXED_LANGUAGE_PROMPT_RULE =
  "Internal Greenfield/A2A control prose is English. Supplied UI/operator/source evidence may continuously mix English, Swedish and Finnish. Preserve quoted source labels verbatim and use structural identity plus local language/context before semantic classification; never map an incidental token to an English control meaning when another-language phrase gives it a different meaning.";
