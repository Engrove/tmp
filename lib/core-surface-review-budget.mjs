import { sha256Hex } from "./common.mjs";
import {
  buildCoreSurfaceReviewPromptDetailed
} from "./core-surface-review.mjs";
import {
  nanoBudgetExhausted,
  nanoDegradeLadder,
  resolveNanoInputBudget
} from "./nano-input-budget.mjs";

export const CORE_SURFACE_REVIEW_INPUT_BUDGET_ERROR =
  "CoreSurfaceReviewInputBudgetError";

export class CoreSurfaceReviewInputBudgetError extends Error {
  constructor(message, telemetry = null) {
    super(message);
    this.name = CORE_SURFACE_REVIEW_INPUT_BUDGET_ERROR;
    this.telemetry = telemetry;
  }
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isQuotaExceededError(error) {
  return error?.name === "QuotaExceededError";
}

function boundedAttemptTelemetry({
  attempt,
  budget,
  built,
  measuredInputTokens,
  inputDigest,
  event,
  reportedContextWindow,
  reportedContextUsage
}) {
  return {
    schema: "eic.autonom.core-review-input-budget.v1",
    event,
    hostContextWindow: numericOrNull(reportedContextWindow),
    hostContextUsage: numericOrNull(reportedContextUsage),
    effectiveContextWindow: numericOrNull(budget.contextWindow),
    effectiveContextUsage: numericOrNull(budget.contextUsage),
    availableTokens: numericOrNull(budget.availableTokens),
    budgetStrategy: String(budget.strategy || ""),
    projectionStrategy: String(built.budget?.strategy || ""),
    maxPromptChars: Number(budget.maxPromptChars || 0),
    promptChars: built.prompt.length,
    measuredInputTokens: measuredInputTokens === null
      ? null
      : numericOrNull(measuredInputTokens),
    degradeAttempt: attempt,
    droppedSections: [...(built.budget?.droppedSections || [])].slice(0, 12),
    truncatedSections: [...(built.budget?.truncatedSections || [])].slice(0, 12),
    sectionUsage: Object.fromEntries(
      Object.entries(built.budget?.sections || {}).slice(0, 12).map(([key, value]) => [
        key,
        {
          limitChars: Number(value?.limitChars || 0),
          actualChars: Number(value?.actualChars || 0),
          sourceChars: Number(value?.sourceChars || 0)
        }
      ])
    ),
    inputDigest: String(inputDigest || "")
  };
}

function terminalBudgetError(lastTelemetry, reason) {
  const detail = lastTelemetry
    ? `${lastTelemetry.promptChars}/${lastTelemetry.maxPromptChars} chars; ` +
      `${lastTelemetry.measuredInputTokens ?? "unmeasured"}/${lastTelemetry.availableTokens} tokens; ` +
      `attempt=${lastTelemetry.degradeAttempt}`
    : "no bounded projection available";
  return new CoreSurfaceReviewInputBudgetError(
    `CORE_SURFACE_REVIEW_INPUT_BUDGET_EXHAUSTED:${reason}:${detail}`,
    lastTelemetry
  );
}

/**
 * Executes exactly one Core Surface Review through the existing Nano budget semantics.
 *
 * The caller supplies the real host measurement and model invocation functions. Every
 * retry rebuilds a section-bounded projection using a smaller Nano budget. A real
 * QuotaExceededError is a shrink signal only while a smaller, non-identical projection
 * remains. Exhaustion becomes one explicit terminal Core Review budget error.
 */
export async function executeCoreSurfaceReviewWithBudget({
  input = {},
  contextWindow = null,
  contextUsage = 0,
  measureInputUsage = null,
  invoke,
  onTelemetry = null,
  minPromptChars = 2_400,
  maxPromptChars = 48_000
} = {}) {
  if (typeof invoke !== "function") {
    throw new TypeError("CORE_SURFACE_REVIEW_INVOKE_REQUIRED");
  }

  const attempts = [];
  let previousRejectedPrompt = null;
  let lastTelemetry = null;

  for (let attempt = 0; !nanoBudgetExhausted(attempt); attempt += 1) {
    const budget = resolveNanoInputBudget({
      contextWindow,
      contextUsage,
      degradeFactor: nanoDegradeLadder(attempt),
      minPromptChars,
      maxPromptChars
    });
    const built = buildCoreSurfaceReviewPromptDetailed({
      ...input,
      maxPromptChars: budget.maxPromptChars,
      projectionLevel: attempt
    });

    let measuredInputTokens = null;
    if (typeof measureInputUsage === "function") {
      try {
        const measured = Number(await measureInputUsage(built.prompt));
        measuredInputTokens = Number.isFinite(measured) ? measured : null;
      } catch {
        measuredInputTokens = null;
      }
    }

    const inputDigest = await sha256Hex(built.prompt);
    const charsOverBudget = !built.budget.withinBudget ||
      built.prompt.length > budget.maxPromptChars;
    const tokensOverBudget = budget.availableTokens <= 0 ||
      (measuredInputTokens !== null &&
        measuredInputTokens > budget.availableTokens);
    const identicalToRejected = previousRejectedPrompt !== null &&
      built.prompt === previousRejectedPrompt;

    let event = "READY_TO_SEND";
    if (charsOverBudget) event = "CHAR_BUDGET_EXCEEDED";
    else if (tokensOverBudget) event = "TOKEN_BUDGET_EXCEEDED";
    else if (identicalToRejected) event = "IDENTICAL_RETRY_BLOCKED";

    lastTelemetry = boundedAttemptTelemetry({
      attempt,
      budget,
      built,
      measuredInputTokens,
      inputDigest,
      event,
      reportedContextWindow: contextWindow,
      reportedContextUsage: contextUsage
    });
    attempts.push(lastTelemetry);
    if (typeof onTelemetry === "function") await onTelemetry(lastTelemetry);

    if (charsOverBudget || tokensOverBudget || identicalToRejected) {
      if (nanoBudgetExhausted(attempt + 1)) {
        throw terminalBudgetError(
          lastTelemetry,
          charsOverBudget
            ? "CHAR_BUDGET"
            : tokensOverBudget
              ? "TOKEN_BUDGET"
              : "IDENTICAL_PROJECTION"
        );
      }
      continue;
    }

    try {
      const result = await invoke(built.prompt, {
        budget,
        projection: built.budget,
        telemetry: lastTelemetry
      });
      const completedTelemetry = {
        ...lastTelemetry,
        event: "COMPLETED"
      };
      attempts[attempts.length - 1] = completedTelemetry;
      if (typeof onTelemetry === "function") await onTelemetry(completedTelemetry);
      return {
        result,
        prompt: built.prompt,
        budget: built.budget,
        telemetry: completedTelemetry,
        attempts
      };
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;
      previousRejectedPrompt = built.prompt;
      const quotaTelemetry = {
        ...lastTelemetry,
        event: "QUOTA_REJECTED"
      };
      attempts[attempts.length - 1] = quotaTelemetry;
      lastTelemetry = quotaTelemetry;
      if (typeof onTelemetry === "function") await onTelemetry(quotaTelemetry);
      if (nanoBudgetExhausted(attempt + 1)) {
        throw terminalBudgetError(lastTelemetry, "HOST_QUOTA_REJECTED");
      }
    }
  }

  throw terminalBudgetError(lastTelemetry, "LADDER_EXHAUSTED");
}
