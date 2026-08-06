/**
 * Deterministic input budgeting for the local Nano decision prompt.
 *
 * v0.6.3 built the decision prompt from fixed character caps (28 000 + 16 000)
 * plus the full target mandate and the full continuity projection. On a Chrome
 * Nano host with a 9 216 token context window that produced 33 000–48 000 char
 * prompts and a hard `QuotaExceededError: The input is too large.` on every
 * turn, which silently degraded the whole run to DETERMINISTIC_RECOVERY.
 *
 * This module converts the host-reported token window into a character budget
 * and allocates it across prompt sections by priority. It is pure and testable;
 * the panel host may refine it with `measureInputUsage()` when Chrome exposes it.
 */

export const NANO_BUDGET_DEFAULTS = Object.freeze({
  // Conservative: assume FEW characters per token so the char budget stays below
  // the real token budget for Swedish text with accented characters.
  charsPerToken: 2.6,
  // Room for the decision JSON the model must still be able to emit.
  outputReserveTokens: 1_400,
  // Margin for per-request framing the host adds around the prompt.
  frameReserveTokens: 256,
  safetyFactor: 0.9,
  fallbackContextWindow: 6_144,
  minPromptChars: 2_400,
  maxPromptChars: 48_000
});

export const NANO_BUDGET_STRATEGIES = Object.freeze({
  HOST_WINDOW: "HOST_WINDOW",
  FALLBACK_WINDOW: "FALLBACK_WINDOW",
  FLOOR_CLAMPED: "FLOOR_CLAMPED"
});

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/**
 * @returns {{contextWindow:number, contextUsage:number, availableTokens:number,
 *   maxPromptChars:number, degradeFactor:number, strategy:string}}
 */
export function resolveNanoInputBudget({
  contextWindow = null,
  contextUsage = 0,
  outputReserveTokens = NANO_BUDGET_DEFAULTS.outputReserveTokens,
  frameReserveTokens = NANO_BUDGET_DEFAULTS.frameReserveTokens,
  charsPerToken = NANO_BUDGET_DEFAULTS.charsPerToken,
  safetyFactor = NANO_BUDGET_DEFAULTS.safetyFactor,
  minPromptChars = NANO_BUDGET_DEFAULTS.minPromptChars,
  maxPromptChars = NANO_BUDGET_DEFAULTS.maxPromptChars,
  degradeFactor = 1
} = {}) {
  const hostWindow = positiveNumber(contextWindow, 0);
  const usableWindow = hostWindow || NANO_BUDGET_DEFAULTS.fallbackContextWindow;
  const usage = nonNegativeNumber(contextUsage, 0);
  const reserve = nonNegativeNumber(outputReserveTokens, NANO_BUDGET_DEFAULTS.outputReserveTokens) +
    nonNegativeNumber(frameReserveTokens, NANO_BUDGET_DEFAULTS.frameReserveTokens);
  const factor = Math.min(1, Math.max(0.1, positiveNumber(safetyFactor, NANO_BUDGET_DEFAULTS.safetyFactor)));
  const degrade = Math.min(1, Math.max(0.15, positiveNumber(degradeFactor, 1)));

  const availableTokens = Math.max(0, Math.floor((usableWindow - usage - reserve) * factor));
  const rawChars = Math.floor(
    availableTokens * positiveNumber(charsPerToken, NANO_BUDGET_DEFAULTS.charsPerToken) * degrade
  );
  const floor = Math.max(512, Math.floor(nonNegativeNumber(minPromptChars, NANO_BUDGET_DEFAULTS.minPromptChars)));
  const ceiling = Math.max(floor, Math.floor(positiveNumber(maxPromptChars, NANO_BUDGET_DEFAULTS.maxPromptChars)));
  const clamped = Math.min(ceiling, Math.max(floor, rawChars));

  return {
    contextWindow: usableWindow,
    contextUsage: usage,
    availableTokens,
    maxPromptChars: clamped,
    degradeFactor: degrade,
    strategy: rawChars < floor
      ? NANO_BUDGET_STRATEGIES.FLOOR_CLAMPED
      : hostWindow
        ? NANO_BUDGET_STRATEGIES.HOST_WINDOW
        : NANO_BUDGET_STRATEGIES.FALLBACK_WINDOW
  };
}

/**
 * Allocates a character budget across the variable prompt sections.
 * Priority order (highest first): continuity projection, latest target response,
 * target mandate, conversation excerpt. The fixed frame (task text, run state and
 * output contract) is never trimmed; it is subtracted first.
 */
export function allocateNanoSectionBudget(maxPromptChars, {
  fixedChars = 0,
  minProjectionChars = 700,
  minResponseChars = 900
} = {}) {
  const total = Math.max(0, Math.floor(nonNegativeNumber(maxPromptChars, 0)));
  const variable = Math.max(0, total - Math.max(0, Math.floor(nonNegativeNumber(fixedChars, 0))));

  if (variable <= minProjectionChars + minResponseChars) {
    // Explicit zero/small budgets must stay additive. v0.6.4 forced at least
    // 256 + 256 characters even when `variableChars` was zero, so the section
    // allocator itself could exceed the caller's budget before framing.
    const projection = Math.max(0, Math.floor(variable * 0.45));
    return {
      variableChars: variable,
      projectionChars: projection,
      responseChars: Math.max(0, variable - projection),
      mandateChars: 0,
      conversationChars: 0,
      dropped: ["conversationExcerpt", "targetMandate"]
    };
  }

  const projection = Math.max(minProjectionChars, Math.floor(variable * 0.26));
  const response = Math.max(minResponseChars, Math.floor(variable * 0.44));
  const mandate = Math.max(
    0,
    Math.min(Math.floor(variable * 0.14), variable - projection - response)
  );
  const conversation = Math.max(0, variable - projection - response - mandate);
  const dropped = [];
  if (conversation < 400) dropped.push("conversationExcerpt");

  return {
    variableChars: variable,
    projectionChars: projection,
    responseChars: response,
    mandateChars: mandate,
    conversationChars: conversation < 400 ? 0 : conversation,
    dropped
  };
}

/**
 * Bounded shrink ladder used after a real QuotaExceededError. Never returns an
 * empty ladder, so the caller always has a terminal attempt to report honestly.
 */
export function nanoDegradeLadder(attempt = 0) {
  const ladder = [1, 0.6, 0.35];
  const index = Math.min(ladder.length - 1, Math.max(0, Math.floor(Number(attempt) || 0)));
  return ladder[index];
}

export function nanoBudgetExhausted(attempt = 0) {
  return Math.floor(Number(attempt) || 0) >= 3;
}
