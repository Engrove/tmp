export const NANO_PROVIDER_POLICY = "STANDARD_LANGUAGE_MODEL_ONLY";
export const NANO_PROVIDER_CONTRACT = "CHROME_EXTENSION_PROMPT_API_ENGLISH_OUTPUT_V2";
export const NANO_PROVIDER_OUTPUT_LANGUAGES = Object.freeze(["en"]);
export const NANO_PROVIDER_EXPECTED_OUTPUTS = Object.freeze([
  Object.freeze({ type: "text", languages: NANO_PROVIDER_OUTPUT_LANGUAGES })
]);
export const NANO_PROVIDER_KIND = Object.freeze({
  STANDARD: "LanguageModel"
});

export const NANO_PROVIDER_AVAILABILITY = Object.freeze({
  UNKNOWN: "unknown",
  AVAILABLE: "available",
  DOWNLOADABLE: "downloadable",
  DOWNLOADING: "downloading",
  UNAVAILABLE: "unavailable"
});

function hasCreate(api) {
  return Boolean(api && typeof api.create === "function");
}

export function discoverNanoProviders(root = globalThis) {
  if (!hasCreate(root?.LanguageModel)) return [];
  return [{
    kind: NANO_PROVIDER_KIND.STANDARD,
    api: root.LanguageModel,
    contract: NANO_PROVIDER_CONTRACT,
    priority: 0
  }];
}

export function selectNanoProvider(root = globalThis) {
  return discoverNanoProviders(root)[0] || null;
}

export function nanoProviderInventory(root = globalThis) {
  return discoverNanoProviders(root).map(({ kind, contract, priority }) => ({
    kind,
    contract,
    priority
  }));
}

export function normalizeProviderAvailability(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "available") return NANO_PROVIDER_AVAILABILITY.AVAILABLE;
  if (normalized === "downloadable") return NANO_PROVIDER_AVAILABILITY.DOWNLOADABLE;
  if (normalized === "downloading") return NANO_PROVIDER_AVAILABILITY.DOWNLOADING;
  if (normalized === "unavailable") return NANO_PROVIDER_AVAILABILITY.UNAVAILABLE;
  return NANO_PROVIDER_AVAILABILITY.UNKNOWN;
}

export function providerLanguageOptions() {
  return {
    expectedOutputs: NANO_PROVIDER_EXPECTED_OUTPUTS.map((item) => ({
      type: item.type,
      languages: [...item.languages]
    }))
  };
}

/**
 * Passive readiness probe. Chrome requires the same output-language attestation
 * for availability() and create(). The EIC internal Nano contract uses English
 * output because the Prompt API currently supports en/de/es/fr/ja, not Swedish.
 * This probe never starts a download.
 */
export function providerAvailabilityCall(provider) {
  if (!provider?.api || typeof provider.api.availability !== "function") {
    return Promise.resolve(NANO_PROVIDER_AVAILABILITY.UNKNOWN);
  }
  try {
    return Promise.resolve(provider.api.availability(providerLanguageOptions()))
      .then(normalizeProviderAvailability);
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Current Chrome Extension Prompt API create options.
 * Every session explicitly attests English text output. expectedInputs is
 * intentionally omitted: EIC may carry multilingual evidence and must not falsely
 * claim that all model inputs are English or declare unsupported Swedish.
 */
export function providerCreateOptions({
  systemPrompt = null,
  signal = null,
  monitor = null
} = {}) {
  const options = providerLanguageOptions();
  const prompt = systemPrompt === null || systemPrompt === undefined
    ? ""
    : String(systemPrompt).trim();
  if (prompt) {
    options.initialPrompts = [{ role: "system", content: prompt }];
  }
  if (signal) options.signal = signal;
  if (typeof monitor === "function") options.monitor = monitor;
  return options;
}

export class NanoUserActivationRequiredError extends Error {
  constructor() {
    super("Chrome kräver ett aktivt användarklick för att starta LanguageModel.create().");
    this.name = "NanoUserActivationRequiredError";
    this.reasonCode = "USER_ACTIVATION_REQUIRED";
  }
}

export function userActivationIsActive(navigatorValue = globalThis.navigator) {
  return navigatorValue?.userActivation?.isActive === true;
}

/**
 * Synchronously enters the native create() call while user activation is active.
 * This function contains no await and returns the browser-owned promise unchanged.
 */
export function startOfficialLanguageModelCreate(provider, {
  signal = null,
  monitor = null,
  navigatorValue = globalThis.navigator
} = {}) {
  if (!provider?.api || provider.kind !== NANO_PROVIDER_KIND.STANDARD) {
    throw new TypeError("STANDARD_LANGUAGE_MODEL_PROVIDER_REQUIRED");
  }
  if (!userActivationIsActive(navigatorValue)) {
    throw new NanoUserActivationRequiredError();
  }
  // Activation stays prompt-free but includes the required English output-language
  // attestation. No sampling configuration or input-language claim is added.
  return provider.api.create(providerCreateOptions({
    signal,
    monitor
  }));
}
