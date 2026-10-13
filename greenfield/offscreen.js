import { createAnalysisBudget } from "./lib/analysis-deadline.mjs";
import {
  modelAvailabilityOptions,
  modelCreateOptions,
  modelFallbackCreateOptions
} from "./lib/model-config.mjs";
import {
  NANO_RESPONSE_SCHEMA,
  buildNanoPrompt,
  normalizeNanoResult,
  validateNanoResult
} from "./lib/nano.mjs";
import {
  NANO_CONTEXT_REQUIRED_PREFIX,
  NANO_KNOWLEDGE_BOUNDARY,
  NANO_TASK_STATUS,
  evaluateNanoTaskSemanticStatus,
  extractNanoContextRequirement
} from "./lib/nano-task.mjs";
import {
  ANALYSIS_RESPONSE_SCHEMA,
  buildHjalmarPrompt,
  normalizeHjalmarDecision,
  validateHjalmarDecision
} from "./lib/hjalmar-d2.mjs";

const LOCAL_MODEL_PROMPT_CHAR_BUDGET = Object.freeze({
  nano: 3400,
  hjalmar: 6200,
  nanoTask: 2600
});

function serializeError(error) {
  return {
    name: String(error?.name || "Error"),
    code: String(error?.code || ""),
    message: String(error?.message || error || "Unknown error").slice(0, 4000),
    stack: String(error?.stack || "").slice(0, 12000)
  };
}

function forensic(token, kind, payload = {}, severity = "INFO") {
  try {
    chrome.runtime.sendMessage({
      type: "EIC_GF_FORENSIC_EVENT",
      token: token || null,
      event: { kind, component: "offscreen-model", severity, payload }
    }).catch?.(() => undefined);
  } catch {}
}

function availabilityValue(value) {
  return String(value ?? "").toLowerCase();
}

async function languageModelAvailability(token, budget) {
  if (!globalThis.LanguageModel) return "unavailable";
  if (typeof LanguageModel.availability === "function") {
    try {
      const options = modelAvailabilityOptions();
      forensic(token, "LANGUAGE_MODEL_AVAILABILITY_ATTEMPT", { options });
      const value = availabilityValue(await budget.wait(() => LanguageModel.availability(options), "model availability"));
      forensic(token, "LANGUAGE_MODEL_AVAILABILITY_RESULT", { value, options });
      return value;
    } catch (error) {
      forensic(token, "LANGUAGE_MODEL_AVAILABILITY_ERROR", { error: serializeError(error) }, "ERROR");
      if (error?.code === "ANALYSIS_TIMEOUT") throw error;
    }
  }
  if (typeof LanguageModel.capabilities === "function") {
    try {
      const caps = await budget.wait(() => LanguageModel.capabilities(), "model capabilities");
      const value = availabilityValue(caps?.available || caps?.availability || "unknown");
      forensic(token, "LANGUAGE_MODEL_CAPABILITIES_RESULT", { value, caps });
      return value;
    } catch (error) {
      forensic(token, "LANGUAGE_MODEL_CAPABILITIES_ERROR", { error: serializeError(error) }, "ERROR");
      if (error?.code === "ANALYSIS_TIMEOUT") throw error;
    }
  }
  return typeof LanguageModel.create === "function" ? "unknown" : "unavailable";
}

function destroyLateSession(session) {
  return session?.destroy?.();
}

function extractJson(text) {
  const source = String(text ?? "").trim();
  if (!source) throw Object.assign(new Error("ANALYSIS_EMPTY"), { code: "ANALYSIS_EMPTY" });
  try { return JSON.parse(source); } catch {}
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try { return JSON.parse(fenced.trim()); } catch {}
  }
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(source.slice(start, end + 1)); } catch {}
  }
  throw Object.assign(new Error("ANALYSIS_JSON_INVALID"), { code: "ANALYSIS_JSON_INVALID" });
}

async function createSession({ token, stage, systemPrompt, budget }) {
  let session = null;
  const primary = modelCreateOptions({ systemPrompt });
  forensic(token, "LANGUAGE_MODEL_CREATE_ATTEMPT", { stage, options: primary });
  try {
    session = await budget.wait(() => LanguageModel.create(primary), `${stage} model create`, { onLateResolve: destroyLateSession });
    forensic(token, "LANGUAGE_MODEL_CREATE_RESULT", { stage, ok: true, optionMode: "initialPrompts" });
    return session;
  } catch (error) {
    forensic(token, "LANGUAGE_MODEL_CREATE_PRIMARY_ERROR", {
      stage,
      error: serializeError(error),
      optionMode: "initialPrompts"
    }, "ERROR");
    if (!(error instanceof TypeError)) throw error;
  }

  const fallback = modelFallbackCreateOptions({ systemPrompt });
  forensic(token, "LANGUAGE_MODEL_CREATE_ATTEMPT", { stage, options: fallback, fallback: true });
  session = await budget.wait(() => LanguageModel.create(fallback), `${stage} model create fallback`, { onLateResolve: destroyLateSession });
  forensic(token, "LANGUAGE_MODEL_CREATE_RESULT", { stage, ok: true, optionMode: "systemPrompt" });
  return session;
}

async function runStructured({
  token,
  budget,
  stage,
  systemPrompt,
  prompt,
  schema,
  normalize,
  validate
}) {
  const started = performance.now();
  let session = null;
  let rawOutput = "";
  try {
    const promptBudget = Number(LOCAL_MODEL_PROMPT_CHAR_BUDGET[stage] || 0);
    if (promptBudget > 0 && prompt.length > promptBudget) {
      const error = new Error(`${stage} prompt exceeds the local-model context budget.`);
      error.code = "LOCAL_MODEL_CONTEXT_BUDGET_EXCEEDED";
      forensic(token, "LOCAL_MODEL_CONTEXT_BUDGET_EXCEEDED", {
        stage,
        promptChars: prompt.length,
        budgetChars: promptBudget
      }, "ERROR");
      throw error;
    }
    session = await createSession({ token, stage, systemPrompt, budget });
    if (!session || typeof session.prompt !== "function") {
      const error = new Error("LanguageModel session is not promptable.");
      error.code = "ANALYZER_SESSION_INVALID";
      throw error;
    }

    forensic(token, "LANGUAGE_MODEL_PROMPT_ATTEMPT", {
      stage,
      promptChars: prompt.length,
      contextBudgetChars: Number(LOCAL_MODEL_PROMPT_CHAR_BUDGET[stage] || 0),
      responseConstraint: schema
    });
    try {
      rawOutput = String(await budget.wait(
        () => session.prompt(prompt, { responseConstraint: schema }),
        `${stage} prompt`
      ) ?? "");
    } catch (error) {
      forensic(token, "LANGUAGE_MODEL_CONSTRAINED_PROMPT_ERROR", {
        stage,
        error: serializeError(error)
      }, "ERROR");
      if (!(error instanceof TypeError)) throw error;
      rawOutput = String(await budget.wait(
        () => session.prompt(prompt),
        `${stage} unconstrained prompt`
      ) ?? "");
    }

    forensic(token, "LANGUAGE_MODEL_PROMPT_RESULT", {
      stage,
      rawOutput,
      rawOutputChars: rawOutput.length,
      durationMs: Math.round(performance.now() - started)
    });

    const parsed = extractJson(rawOutput);
    const normalized = normalize(parsed);
    const validation = validate(normalized);
    forensic(token, `${stage.toUpperCase()}_VALIDATION_RESULT`, {
      validation,
      normalized
    }, validation.ok ? "INFO" : "ERROR");
    if (!validation.ok) {
      const error = new Error(`${stage.toUpperCase()}_INVALID:${validation.errors.join(",")}`);
      error.code = `${stage.toUpperCase()}_INVALID`;
      error.validation = validation;
      throw error;
    }

    return {
      normalized,
      rawOutput,
      durationMs: Math.round(performance.now() - started)
    };
  } catch (error) {
    // Preserve bounded model evidence for deterministic runtime fallback.
    try {
      if (error && typeof error === "object" && !("rawOutput" in error)) {
        error.rawOutput = rawOutput;
      }
    } catch {}
    forensic(token, "LANGUAGE_MODEL_STAGE_ERROR", {
      stage,
      error: serializeError(error),
      validation: error?.validation || null,
      rawOutput: String(rawOutput || "").slice(0, 12000)
    }, "ERROR");
    throw error;
  } finally {
    try {
      session?.destroy?.();
      forensic(token, "LANGUAGE_MODEL_SESSION_DESTROYED", { stage });
    } catch (error) {
      forensic(token, "LANGUAGE_MODEL_DESTROY_ERROR", { stage, error: serializeError(error) }, "ERROR");
    }
  }
}

async function runNanoTask(task, token, execute = false, budget = null) {
  if (!task?.requested || !String(task.task || "").trim()) return null;
  if ([
    NANO_TASK_STATUS.COMPLETED,
    NANO_TASK_STATUS.CONTEXT_REQUIRED,
    NANO_TASK_STATUS.FAILED,
    NANO_TASK_STATUS.UNKNOWN_EFFECT
  ].includes(task.status)) {
    forensic(token, "NANO_TASK_REUSED_TERMINAL", {
      requestId: task.requestId || "",
      status: task.status
    });
    return task;
  }
  if (execute !== true) {
    // Do not lie about a prior unknown effect. Exact-once safety forbids replay,
    // but UNKNOWN_EFFECT is distinct from a verified task failure.
    const uncertain = {
      ...task,
      status: NANO_TASK_STATUS.UNKNOWN_EFFECT,
      semanticStatus: "UNVERIFIED",
      result: String(task.result || ""),
      error: "NANO_TASK_EFFECT_UNKNOWN_NO_REPLAY",
      completedAt: null
    };
    forensic(token, "NANO_TASK_REPLAY_BLOCKED", {
      requestId: task.requestId || "",
      priorStatus: task.status || "",
      reason: uncertain.error
    }, "ERROR");
    return uncertain;
  }
  const started = performance.now();
  let session = null;
  let promptCalls = 0;
  const base = {
    ...task,
    requested: true,
    status: NANO_TASK_STATUS.RUNNING,
    result: "",
    error: "",
    promptCalls: 0
  };
  const sourceTask = String(task.sourceTask || task.task || "");
  const executionPrompt = String(task.executionPrompt || task.task || "");
  forensic(token, "NANO_TASK_REQUEST_START", {
    requestId: task.requestId || "",
    sourceResponseHash: task.sourceResponseHash || "",
    isolation: "FRESH_ONE_PROMPT_SESSION",
    sourceTask,
    executionPrompt,
    promptLanguage: task.promptLanguage || "en",
    promptPolicy: task.promptPolicy || "PROMPT_CLOSED_EXECUTION_V2",
    knowledgeBoundary: task.knowledgeBoundary || NANO_KNOWLEDGE_BOUNDARY,
    promptClosure: task.promptClosure || null
  });
  try {
    const taskBudget = LOCAL_MODEL_PROMPT_CHAR_BUDGET.nanoTask;
    if (executionPrompt.length > taskBudget) {
      const error = new Error("Nano task prompt exceeds the local-model context budget.");
      error.code = "NANO_TASK_CONTEXT_BUDGET_EXCEEDED";
      forensic(token, "NANO_TASK_CONTEXT_BUDGET_EXCEEDED", {
        requestId: task.requestId || "",
        promptChars: executionPrompt.length,
        budgetChars: taskBudget
      }, "ERROR");
      throw error;
    }
    const options = modelCreateOptions();
    forensic(token, "NANO_TASK_SESSION_CREATE_ATTEMPT", {
      requestId: task.requestId || "",
      options,
      hasSystemPrompt: false
    });
    session = await budget.wait(
      () => LanguageModel.create(options),
      "nano-task model create",
      { onLateResolve: destroyLateSession }
    );
    forensic(token, "NANO_TASK_SESSION_CREATE_RESULT", {
      requestId: task.requestId || "",
      ok: true,
      hasSystemPrompt: false
    });
    if (!session || typeof session.prompt !== "function") {
      const error = new Error("Nano task session is not promptable.");
      error.code = "NANO_TASK_SESSION_INVALID";
      throw error;
    }
    const raw = String(await budget.wait(() => {
      promptCalls += 1;
      forensic(token, "NANO_TASK_PROMPT_ATTEMPT", {
      requestId: task.requestId || "",
      promptCalls,
      contextBudgetChars: LOCAL_MODEL_PROMPT_CHAR_BUDGET.nanoTask,
      promptLanguage: task.promptLanguage || "en",
      promptPolicy: task.promptPolicy || "PROMPT_CLOSED_EXECUTION_V2",
      knowledgeBoundary: task.knowledgeBoundary || NANO_KNOWLEDGE_BOUNDARY,
      promptClosure: task.promptClosure || null,
      prompt: executionPrompt
      });
      return session.prompt(executionPrompt);
    }, "nano-task prompt") ?? "");
    const contextRequired = extractNanoContextRequirement(raw);
    if (contextRequired?.required === true) {
      const bounded = {
        ...base,
        status: NANO_TASK_STATUS.CONTEXT_REQUIRED,
        semanticStatus: "UNVERIFIED",
        result: raw.slice(0, 12000),
        error: `${NANO_CONTEXT_REQUIRED_PREFIX} ${contextRequired.reason}`,
        promptCalls,
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - started)
      };
      forensic(token, "NANO_TASK_CONTEXT_REQUIRED", bounded, "WARN");
      return bounded;
    }
    const completedBase = {
      ...base,
      status: NANO_TASK_STATUS.COMPLETED,
      result: raw.slice(0, 12000),
      promptCalls,
      completedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started)
    };
    const completed = {
      ...completedBase,
      semanticStatus: evaluateNanoTaskSemanticStatus(completedBase)
    };
    forensic(token, "NANO_TASK_RESULT_COMMIT", completed);
    return completed;
  } catch (error) {
    const unknown = error?.code === "ANALYSIS_TIMEOUT" && promptCalls > 0;
    const failed = {
      ...base,
      status: unknown ? NANO_TASK_STATUS.UNKNOWN_EFFECT : NANO_TASK_STATUS.FAILED,
      semanticStatus: "UNVERIFIED",
      error: `${error?.code ? `${error.code}: ` : ""}${serializeError(error).message}`,
      promptCalls,
      executionStatus: unknown ? "UNKNOWN_EFFECT" : promptCalls === 0 ? "NOT_EXECUTED" : "FAILED",
      completedAt: unknown ? null : new Date().toISOString(),
      durationMs: Math.round(performance.now() - started)
    };
    forensic(token, "NANO_TASK_ERROR", {
      ...failed,
      errorRecord: serializeError(error)
    }, "ERROR");
    return failed;
  } finally {
    try {
      session?.destroy?.();
      forensic(token, "NANO_TASK_SESSION_DESTROYED", {
        requestId: task.requestId || "",
        promptCalls
      });
    } catch (error) {
      forensic(token, "NANO_TASK_SESSION_DESTROY_ERROR", {
        requestId: task.requestId || "",
        error: serializeError(error)
      }, "ERROR");
    }
  }
}

function runtimeNanoObserverFallback(input, nanoTask, error) {
  const taskStatus = String(nanoTask?.status || "NOT_REQUESTED");
  const semanticStatus = String(nanoTask?.semanticStatus || "UNVERIFIED");
  const result = String(nanoTask?.result || "").trim();
  return normalizeNanoResult({
    summary: nanoTask?.requested
      ? `Runtime fallback after Nano Observer model-output failure. Nano Task status=${taskStatus}; semanticStatus=${semanticStatus}.`
      : "Runtime fallback after Nano Observer model-output failure. No isolated Nano Task was requested.",
    intent: "Preserve canonical runtime evidence and continue to Hjalmar D2 without replaying side effects.",
    materialFacts: [
      `protocolDisposition=${String(input.targetDisposition || "UNKNOWN")}`,
      input.responseExcerpt ? `responseExcerpt=${String(input.responseExcerpt).slice(0, 650)}` : "",
      nanoTask?.requested ? `nanoTask.status=${taskStatus}` : "nanoTask.requested=false",
      nanoTask?.requestId ? `nanoTask.requestId=${String(nanoTask.requestId)}` : "",
      result ? `nanoTask.result=${result.slice(0, 600)}` : ""
    ].filter(Boolean),
    uncertainties: [
      `Nano Observer model output was unusable: ${String(error?.code || error?.message || "UNKNOWN").slice(0, 600)}`
    ],
    continuityRisk: taskStatus === NANO_TASK_STATUS.UNKNOWN_EFFECT ? "MATERIAL" : "LOW",
    recommendedFocus: taskStatus === NANO_TASK_STATUS.CONTEXT_REQUIRED
      ? "Continue in EIC with the missing context, or construct a new prompt-closed Nano task containing the required data inline."
      : "Use persisted runtime evidence plus the bounded response excerpt; treat A2A protocol disposition as advisory metadata only.",
    confidence: "HIGH"
  });
}

function runtimeHjalmarFallback(input, nanoObservation, nanoTask, error) {
  const target = String(input.targetDisposition || "UNKNOWN").toUpperCase();
  const taskStatus = String(nanoTask?.status || "NOT_REQUESTED").toUpperCase();
  const taskSemantic = String(nanoTask?.semanticStatus || "UNVERIFIED").toUpperCase();
  const taskRequested = nanoTask?.requested === true;

  let disposition = "CONTINUE";
  let objectiveStatus = "PENDING";
  let nextPrompt = String(input.targetContinuationInstruction || "").trim();

  if (taskStatus === NANO_TASK_STATUS.UNKNOWN_EFFECT) {
    // v1.9.3 (contract C14/F16): a lost prompt-only Nano result is not a
    // mission blocker; continue without it and never replay the task.
    nextPrompt = nextPrompt ||
      "The local Nano task requested by the previous target response has no recoverable result and will not be replayed. Continue the current objective in EIC without that Nano result. Do not request the same Nano task again.";
  } else if (taskStatus === NANO_TASK_STATUS.CONTEXT_REQUIRED) {
    disposition = "CONTINUE";
    objectiveStatus = "PENDING";
    nextPrompt = nextPrompt ||
      "Continue the current objective in EIC using the required owner/context data. Do not delegate the same missing-context task to Nano again; only issue a new Nano task if every required input is embedded in its single prompt.";
  } else if (!nextPrompt) {
    if (taskRequested && taskStatus === NANO_TASK_STATUS.COMPLETED) {
      nextPrompt = "Continue the current objective using the persisted local Nano Task evidence. Do not request the same Nano task again.";
    } else if (taskRequested && taskStatus === NANO_TASK_STATUS.FAILED) {
      nextPrompt = "Continue the current objective using the persisted Nano Task failure evidence. Do not request the same Nano task again.";
    } else {
      nextPrompt = "Continue the current objective using the latest completed assistant response and bounded local analysis evidence.";
    }
  }

  const assessment = !taskRequested
    ? "NOT_REQUESTED"
    : taskStatus === NANO_TASK_STATUS.CONTEXT_REQUIRED
      ? "CONTEXT_REQUIRED"
      : taskStatus === NANO_TASK_STATUS.FAILED
        ? "FAILED"
        : taskSemantic === "SATISFIED"
        ? "SATISFIED"
        : taskSemantic === "UNSATISFIED"
          ? "UNSATISFIED"
          : "UNVERIFIED";

  return normalizeHjalmarDecision({
    disposition,
    targetDisposition: target,
    objectiveStatus,
    nanoTaskAssessment: assessment,
    progressEvidence: taskRequested
      ? `Protocol targetDisposition=${target}; persisted nanoTask.status=${taskStatus}; nanoTask.semanticStatus=${taskSemantic}.`
      : `Protocol targetDisposition=${target}; no isolated Nano Task was requested.`,
    analysis: `Runtime-bounded Hjalmar fallback used because the local Hjalmar model output failed validation: ${String(error?.code || error?.message || "UNKNOWN").slice(0, 1000)}`,
    nextPrompt,
    exactTarget: String(input.currentObjective || input.goal || "Current autonomous objective").slice(0, 1000),
    ownerEvidence: `Runtime-owned process/Nano Task evidence is authoritative; A2A target disposition=${target} is advisory metadata only.`,
    reversibility: "YES",
    rollbackPath: "No external mutation is authorized by this advisory decision; retain the persisted process state and re-evaluate from canonical evidence on the next turn.",
    readbackPlan: "Read back the next target response and persisted process state before admitting another continuation.",
    materialAmbiguity: "NONE",
    humanAuthorityRequired: false,
    confidence: "MEDIUM"
  });
}

async function runStructuredWithFallback(args, fallbackFactory, fallbackKind) {
  try {
    const run = await runStructured(args);
    return { ...run, fallbackApplied: false, fallbackError: null };
  } catch (error) {
    // v1.9.3 (contract C14/F16): the local model is optional advisory
    // analysis. Every failure of that layer (output drift, a model that is
    // still downloadable or downloading, create or prompt errors, quota,
    // timeouts) falls back to the deterministic runtime decision instead of
    // stalling the mission in recovery. Only a fallback that itself fails
    // validation is rethrown.
    const normalized = fallbackFactory(error);
    const validation = args.validate(normalized);
    if (!validation.ok) throw error;
    forensic(args.token, fallbackKind, {
      error: serializeError(error),
      rawOutput: String(error?.rawOutput || "").slice(0, 12000),
      fallback: normalized,
      validation
    }, "ERROR");
    return {
      normalized,
      rawOutput: String(error?.rawOutput || ""),
      durationMs: 0,
      fallbackApplied: true,
      fallbackError: serializeError(error)
    };
  }
}

// v1.9.3 (contract C14/F16): Nano is optional prompt-only advisory transport.
// Without a local LanguageModel a requested Nano task ends FAILED (it was
// never executed, so it has no effect) and the analysis falls back to the
// deterministic runtime decision; neither stalls the mission in recovery.
// A model that is still downloadable or downloading cannot be created from
// the offscreen document (no user gesture), so it counts as missing until the
// download from the panel has finished.
function localModelMissing(availability) {
  return ["unavailable", "downloadable", "downloading"].includes(availability) || !globalThis.LanguageModel?.create;
}

function localModelUnavailableError(availability) {
  const error = new Error("Chrome local LanguageModel is unavailable.");
  error.code = "ANALYZER_UNAVAILABLE";
  error.availability = availability;
  return error;
}

async function runNanoTaskOnly(input, token, budget) {
  let availability, availabilityError;
  try { availability = await languageModelAvailability(token, budget); }
  catch (error) { availability = "unavailable"; availabilityError = error; }
  if (localModelMissing(availability)) {
    const error = availabilityError || localModelUnavailableError(availability);
    const task = input.nanoTask || null;
    if (!task?.requested || !String(task.task || "").trim()) {
      return { ok: true, nanoTask: null, modelAvailability: availability, localModelUnavailable: true };
    }
    // Terminal evidence is reused and an interrupted task stays UNKNOWN_EFFECT
    // (runNanoTask without execute never touches the model). Only a task this
    // call was asked to start is reported as not executed.
    if (input.executeNanoTask !== true) {
      const reused = await runNanoTask(task, token, false);
      return { ok: true, nanoTask: reused, modelAvailability: availability, localModelUnavailable: true };
    }
    const failed = {
      ...task,
      requested: true,
      status: NANO_TASK_STATUS.FAILED,
      semanticStatus: "UNVERIFIED",
      result: "",
      error: availabilityError
        ? `${error.code}: the Nano task was not executed.`
        : "LOCAL_LANGUAGE_MODEL_UNAVAILABLE: the Nano task was not executed.",
      promptCalls: 0,
      executionStatus: "NOT_EXECUTED",
      completedAt: new Date().toISOString(),
      durationMs: 0
    };
    forensic(token, "NANO_TASK_NOT_EXECUTED_MODEL_UNAVAILABLE", {
      requestId: task.requestId || "",
      availability,
      error: serializeError(error)
    }, "WARN");
    return { ok: true, nanoTask: failed, modelAvailability: availability, localModelUnavailable: true };
  }
  const nanoTask = await runNanoTask(input.nanoTask || null, token, input.executeNanoTask === true, budget);
  return {
    ok: true,
    nanoTask,
    modelAvailability: availability
  };
}

async function analyzePipeline(input, token, budget) {
  let availability, availabilityError;
  try { availability = await languageModelAvailability(token, budget); }
  catch (error) { availability = "unavailable"; availabilityError = error; }
  if (localModelMissing(availability)) {
    const error = availabilityError || localModelUnavailableError(availability);
    const nanoTask = await runNanoTask(input.nanoTask || null, token, false);
    const nanoObservation = {
      ...runtimeNanoObserverFallback(input, nanoTask, error),
      knowledgeBoundary: NANO_KNOWLEDGE_BOUNDARY,
      inputScope: "BOUNDED_PROMPT_FIELDS_ONLY"
    };
    const decision = runtimeHjalmarFallback(input, nanoObservation, nanoTask, error);
    const validation = validateHjalmarDecision(decision);
    forensic(token, "ANALYSIS_PIPELINE_MODEL_UNAVAILABLE_FALLBACK", {
      error: serializeError(error),
      availability,
      decision,
      validation
    }, validation.ok ? "WARN" : "ERROR");
    if (!validation.ok) throw error;
    return {
      ok: true,
      nanoTask,
      nano: nanoObservation,
      nanoRawOutput: "",
      nanoDurationMs: 0,
      nanoFallbackApplied: true,
      decision,
      rawOutput: "",
      durationMs: 0,
      hjalmarFallbackApplied: true,
      localModelUnavailable: true,
      modelAvailability: availability
    };
  }

  // v1.1.5: Nano Task side effects are executed and durably committed by
  // background.js before this advisory pipeline starts. This call only reuses
  // the terminal task evidence; it never initiates a second task effect.
  const nanoTask = await runNanoTask(input.nanoTask || null, token, false);

  forensic(token, "NANO_REQUEST_START", {
    responseHash: input.responseHash || "",
    turn: input.turn || 0,
    nanoTaskRequestId: nanoTask?.requestId || ""
  });
  const nanoRun = await runStructuredWithFallback({
    token,
    budget,
    stage: "nano",
    systemPrompt: "You are EIC Nano Observer. Return compact evidence-bounded English JSON only.",
    prompt: buildNanoPrompt({
      ...input,
      nanoTask
    }),
    schema: NANO_RESPONSE_SCHEMA,
    normalize: normalizeNanoResult,
    validate: validateNanoResult
  }, (error) => runtimeNanoObserverFallback(input, nanoTask, error), "NANO_OBSERVER_RUNTIME_FALLBACK");
  const nanoObservation = {
    ...nanoRun.normalized,
    knowledgeBoundary: NANO_KNOWLEDGE_BOUNDARY,
    inputScope: "BOUNDED_PROMPT_FIELDS_ONLY"
  };
  forensic(token, "NANO_RESULT_COMMIT", {
    result: nanoObservation,
    durationMs: nanoRun.durationMs,
    nanoTask,
    knowledgeBoundary: NANO_KNOWLEDGE_BOUNDARY,
    inputScope: nanoObservation.inputScope,
    fallbackApplied: nanoRun.fallbackApplied === true
  });

  forensic(token, "HJALMAR_D2_REQUEST_START", {
    turn: input.turn || 0,
    nanoSchema: nanoRun.normalized.schema,
    targetDisposition: input.targetDisposition || "UNKNOWN",
    nanoTaskRequestId: nanoTask?.requestId || ""
  });
  const hjalmarRun = await runStructuredWithFallback({
    token,
    budget,
    stage: "hjalmar",
    systemPrompt: "You are EIC Hjalmar D2. Apply the fixed control contract and return evidence-bounded English JSON only.",
    prompt: buildHjalmarPrompt({
      ...input,
      nanoObservation,
      nanoTask
    }),
    schema: ANALYSIS_RESPONSE_SCHEMA,
    normalize: normalizeHjalmarDecision,
    validate: validateHjalmarDecision
  }, (error) => runtimeHjalmarFallback(input, nanoObservation, nanoTask, error), "HJALMAR_RUNTIME_FALLBACK");
  forensic(token, "HJALMAR_D2_RESULT_COMMIT", {
    decision: hjalmarRun.normalized,
    durationMs: hjalmarRun.durationMs,
    targetDisposition: input.targetDisposition || "UNKNOWN",
    nanoTask,
    fallbackApplied: hjalmarRun.fallbackApplied === true
  });

  return {
    ok: true,
    nanoTask,
    nano: nanoObservation,
    nanoRawOutput: nanoRun.rawOutput,
    nanoDurationMs: nanoRun.durationMs,
    nanoFallbackApplied: nanoRun.fallbackApplied === true,
    decision: hjalmarRun.normalized,
    rawOutput: hjalmarRun.rawOutput,
    durationMs: hjalmarRun.durationMs,
    hjalmarFallbackApplied: hjalmarRun.fallbackApplied === true,
    modelAvailability: availability
  };
}

globalThis.addEventListener?.("error", (event) => {
  forensic(null, "OFFSCREEN_UNHANDLED_ERROR", {
    error: serializeError(event?.error || new Error(event?.message || "Offscreen error"))
  }, "ERROR");
});
globalThis.addEventListener?.("unhandledrejection", (event) => {
  forensic(null, "OFFSCREEN_UNHANDLED_REJECTION", {
    error: serializeError(event?.reason || new Error("Unhandled rejection"))
  }, "ERROR");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  if (!["EIC_GF_RUN_NANO_TASK", "EIC_GF_ANALYZE_PIPELINE"].includes(type)) return false;
  const operation = Promise.resolve().then(() => {
    const budget = createAnalysisBudget(message.deadlineAtMs);
    return type === "EIC_GF_RUN_NANO_TASK"
      ? runNanoTaskOnly(message.input || {}, message.token || null, budget)
      : analyzePipeline(message.input || {}, message.token || null, budget);
  });
  operation
    .then(sendResponse)
    .catch((error) => sendResponse({
      ok: false,
      code: error?.code || error?.name || "ANALYSIS_ERROR",
      error: error?.message || String(error),
      detail: String(error?.validation ? JSON.stringify(error.validation) : "")
    }));
  return true;
});
