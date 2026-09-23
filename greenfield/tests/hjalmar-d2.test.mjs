import test from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_SCHEMA } from "../lib/contracts.mjs";
import {
  buildHjalmarPrompt,
  reconcileHjalmarRuntimeFacts,
  runtimeNanoTaskAssessment,
  validateHjalmarDecision,
  validateHjalmarEvidenceBinding
} from "../lib/hjalmar-d2.mjs";

function base(patch = {}) {
  return {
    schema: ANALYSIS_SCHEMA,
    disposition: "CONTINUE",
    targetDisposition: "CONTINUE",
    objectiveStatus: "PENDING",
    nanoTaskAssessment: "NOT_REQUESTED",
    progressEvidence: "Latest target response requests another bounded step.",
    analysis: "Mission is not complete.",
    nextPrompt: "Continue with the next verified step.",
    exactTarget: "Managed ChatGPT session",
    ownerEvidence: "Latest assistant response",
    reversibility: "YES",
    rollbackPath: "Issue a corrective follow-up prompt",
    readbackPlan: "Read the next assistant response",
    materialAmbiguity: "NONE",
    humanAuthorityRequired: false,
    confidence: "HIGH",
    ...patch
  };
}

test("fixed D2 accepts grounded continuation", () => {
  assert.deepEqual(validateHjalmarDecision(base()), { ok: true, errors: [] });
});

test("material ambiguity cannot pass as CONTINUE", () => {
  const r = validateHjalmarDecision(base({ materialAmbiguity: "Target identity unclear" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("AMBIGUITY_REQUIRES_READ"));
});

test("READ_REQUIRED carries one next prompt", () => {
  const r = validateHjalmarDecision(base({
    disposition: "READ_REQUIRED",
    materialAmbiguity: "Need owner state",
    nextPrompt: "Read the current owner state and report it without changing anything."
  }));
  assert.equal(r.ok, true);
});

test("human authority must block", () => {
  const r = validateHjalmarDecision(base({ humanAuthorityRequired: true }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("HUMAN_AUTHORITY_MUST_BLOCK"));
});

test("BLOCKED must not smuggle a continuation prompt", () => {
  const r = validateHjalmarDecision(base({
    disposition: "BLOCKED",
    humanAuthorityRequired: true,
    nextPrompt: "keep going"
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("NEXT_PROMPT_MUST_BE_EMPTY"));
});


test("Hjalmar D2 treats a queued operator instruction as mandatory next-step input", () => {
  const prompt = buildHjalmarPrompt({
    goal: "Finish the task",
    turn: 3,
    lastPrompt: "Continue",
    assistantResponse: "Current step complete",
    operatorInstruction: "Also verify the exported artifact."
  });
  assert.match(prompt, /OPERATOR ONE-SHOT INSTRUCTION FOR NEXT PROMPT/);
  assert.match(prompt, /Also verify the exported artifact\./);
  assert.match(prompt, /TARGET_DISPOSITION is optional A2A protocol metadata/i);
});


test("Hjalmar evidence binding requires protocol metadata to be mirrored without forcing final disposition", () => {
  const d = base({
    disposition: "CONTINUE",
    targetDisposition: "CONTINUE",
    objectiveStatus: "PENDING"
  });
  const r = validateHjalmarEvidenceBinding(d, { targetDisposition: "BLOCKED" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("TARGET_DISPOSITION_MISMATCH"));
});

test("Hjalmar cannot claim Nano task satisfaction without actual completed task result", () => {
  const d = base({
    nanoTaskAssessment: "SATISFIED"
  });
  const r = validateHjalmarEvidenceBinding(d, {
    targetDisposition: "CONTINUE",
    nanoTask: { requested: true, status: "RUNNING", result: "" }
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("NANO_TASK_FALSE_SATISFIED"));
});


test("completed requested Nano task cannot be misreported as NOT_REQUESTED", () => {
  const d = base({
    nanoTaskAssessment: "NOT_REQUESTED",
    nextPrompt: "Continue with new evidence."
  });
  const nanoTask = {
    requested: true,
    status: "COMPLETED",
    result: "NANO_TEST_ANSWER=703"
  };
  const r = validateHjalmarEvidenceBinding(d, {
    targetDisposition: "CONTINUE",
    nanoTask
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("NANO_TASK_REQUESTED_MISMATCH"));
});

test("runtime reconciliation owns Nano task assessment and consumes reissued directive", () => {
  const nanoTask = {
    requested: true,
    status: "COMPLETED",
    result: "NANO_TEST_ANSWER=703"
  };
  const model = base({
    nanoTaskAssessment: "NOT_REQUESTED",
    nextPrompt: "NANO_TASK: Calculate 37 * 19 and return NANO_TEST_ANSWER=<integer>."
  });
  const r = reconcileHjalmarRuntimeFacts(model, {
    targetDisposition: "CONTINUE",
    nanoTask
  });
  assert.equal(runtimeNanoTaskAssessment(nanoTask), "UNVERIFIED");
  assert.equal(r.decision.nanoTaskAssessment, "UNVERIFIED");
  assert.doesNotMatch(r.decision.nextPrompt, /(^|\n)\s*NANO_TASK\s*:/i);
  assert.match(r.decision.nextPrompt, /completed exactly once/i);
  assert.ok(r.corrections.some((item) => item.code === "NANO_TASK_ASSESSMENT_RUNTIME_OVERRIDE"));
  assert.ok(r.corrections.some((item) => item.code === "CONSUMED_NANO_TASK_DIRECTIVE_REMOVED"));
  assert.deepEqual(
    validateHjalmarEvidenceBinding(r.decision, {
      targetDisposition: "CONTINUE",
      nanoTask
    }),
    { ok: true, errors: [] }
  );
});

test("runtime reconciliation mirrors protocol BLOCKED metadata without forcing controller BLOCKED", () => {
  const model = base({
    disposition: "CONTINUE",
    targetDisposition: "CONTINUE",
    objectiveStatus: "PENDING",
    nextPrompt: "keep going"
  });
  const r = reconcileHjalmarRuntimeFacts(model, {
    targetDisposition: "BLOCKED",
    nanoTask: null
  });
  assert.equal(r.decision.disposition, "CONTINUE");
  assert.equal(r.decision.targetDisposition, "BLOCKED");
  assert.equal(r.decision.objectiveStatus, "PENDING");
  assert.equal(r.decision.nextPrompt, "keep going");
  assert.ok(r.corrections.some((item) => item.code === "TARGET_DISPOSITION_RUNTIME_OVERRIDE"));
});

test("runtime reconciliation mirrors protocol DONE metadata without forcing controller DONE", () => {
  const model = base({
    disposition: "CONTINUE",
    targetDisposition: "CONTINUE",
    objectiveStatus: "PENDING",
    nextPrompt: "continue real objective"
  });
  const r = reconcileHjalmarRuntimeFacts(model, {
    targetDisposition: "DONE",
    nanoTask: null
  });
  assert.equal(r.decision.disposition, "CONTINUE");
  assert.equal(r.decision.targetDisposition, "DONE");
  assert.equal(r.decision.objectiveStatus, "PENDING");
  assert.equal(r.decision.nextPrompt, "continue real objective");
});


test("deterministically satisfied Nano task owns Hjalmar assessment", () => {
  const nanoTask = {
    requested: true,
    status: "COMPLETED",
    semanticStatus: "SATISFIED",
    result: "GREENFIELD_OK"
  };
  const model = base({
    nanoTaskAssessment: "UNVERIFIED",
    nextPrompt: "Continue with new evidence."
  });
  const r = reconcileHjalmarRuntimeFacts(model, {
    targetDisposition: "CONTINUE",
    nanoTask
  });
  assert.equal(runtimeNanoTaskAssessment(nanoTask), "SATISFIED");
  assert.equal(r.decision.nanoTaskAssessment, "SATISFIED");
  assert.ok(r.corrections.some((item) => item.code === "NANO_TASK_ASSESSMENT_RUNTIME_OVERRIDE"));
});

test("terminal failed Nano task reissue is sanitized instead of forcing a caller-visible blocker", () => {
  const nanoTask = {
    requested: true,
    status: "FAILED",
    semanticStatus: "UNVERIFIED",
    result: "",
    error: "MODEL_ERROR"
  };
  const model = base({
    nanoTaskAssessment: "NOT_REQUESTED",
    nextPrompt: "NANO_TASK: Repeat the failed local task."
  });
  const r = reconcileHjalmarRuntimeFacts(model, {
    targetDisposition: "CONTINUE",
    nanoTask
  });
  assert.equal(r.decision.nanoTaskAssessment, "FAILED");
  assert.doesNotMatch(r.decision.nextPrompt, /(^|\n)\s*NANO_TASK\s*:/i);
  assert.match(r.decision.nextPrompt, /failure evidence/i);
  assert.ok(r.corrections.some((item) => item.code === "CONSUMED_NANO_TASK_DIRECTIVE_REMOVED"));
});

test("prompt-closure context requirement remains a non-blocking Nano terminal outcome", () => {
  const nanoTask = {
    requested: true,
    status: "CONTEXT_REQUIRED",
    semanticStatus: "UNVERIFIED",
    result: "",
    error: "NANO_CONTEXT_REQUIRED: manifest data is absent"
  };
  const model = base({
    nanoTaskAssessment: "SATISFIED",
    nextPrompt: "NANO_TASK: Read the existing manifest and classify it."
  });
  const r = reconcileHjalmarRuntimeFacts(model, {
    targetDisposition: "CONTINUE",
    nanoTask
  });
  assert.equal(runtimeNanoTaskAssessment(nanoTask), "CONTEXT_REQUIRED");
  assert.equal(r.decision.disposition, "CONTINUE");
  assert.equal(r.decision.objectiveStatus, "PENDING");
  assert.equal(r.decision.nanoTaskAssessment, "CONTEXT_REQUIRED");
  assert.doesNotMatch(r.decision.nextPrompt, /(^|\n)\s*NANO_TASK\s*:/i);
  assert.match(r.decision.nextPrompt, /prompt|context|inline/i);
  assert.ok(r.corrections.some((item) => item.code === "NANO_TASK_ASSESSMENT_RUNTIME_OVERRIDE"));
  assert.ok(r.corrections.some((item) => item.code === "CONSUMED_NANO_TASK_DIRECTIVE_REMOVED"));
});

test("runtime repairs a false Hjalmar BLOCKED caused only by Nano missing prompt context", () => {
  const nanoTask = {
    requested: true,
    status: "CONTEXT_REQUIRED",
    semanticStatus: "UNVERIFIED",
    result: "",
    error: "NANO_CONTEXT_REQUIRED: source rows are absent"
  };
  const model = base({
    disposition: "BLOCKED",
    objectiveStatus: "BLOCKED",
    nanoTaskAssessment: "CONTEXT_REQUIRED",
    nextPrompt: ""
  });
  const r = reconcileHjalmarRuntimeFacts(model, {
    targetDisposition: "CONTINUE",
    nanoTask
  });
  assert.equal(r.decision.disposition, "CONTINUE");
  assert.equal(r.decision.objectiveStatus, "PENDING");
  assert.match(r.decision.nextPrompt, /Continue the objective in EIC/i);
  assert.ok(r.corrections.some((item) => item.code === "NANO_TASK_CONTEXT_REQUIRED_CONTINUATION_OVERRIDE"));
});

test("unknown Nano effect cannot be normalized into ordinary CONTINUE", () => {
  const nanoTask = {
    requested: true,
    status: "UNKNOWN_EFFECT",
    semanticStatus: "UNVERIFIED",
    result: ""
  };
  const model = base({
    disposition: "CONTINUE",
    nanoTaskAssessment: "UNVERIFIED",
    nextPrompt: "Continue anyway."
  });
  const r = reconcileHjalmarRuntimeFacts(model, {
    targetDisposition: "CONTINUE",
    nanoTask
  });
  assert.equal(r.decision.disposition, "BLOCKED");
  assert.equal(r.decision.objectiveStatus, "BLOCKED");
  assert.equal(r.decision.nextPrompt, "");
  assert.ok(r.corrections.some((item) => item.code === "NANO_TASK_UNKNOWN_EFFECT_RUNTIME_OVERRIDE"));
});


test("Hjalmar prompt is bounded for Chrome Nano small context and omits raw turn transcripts", () => {
  const huge = "Y".repeat(50000);
  const prompt = buildHjalmarPrompt({
    goal: huge,
    turn: 9,
    lastPrompt: huge,
    assistantResponse: huge,
    targetDisposition: "CONTINUE",
    targetResponse: {
      status: "CONTINUE",
      summary: huge,
      blockers: [huge, huge, huge],
      nextSuggestedAction: huge
    },
    currentObjective: huge,
    previousDecision: {
      disposition: "CONTINUE",
      objectiveStatus: "PENDING",
      progressEvidence: huge,
      nextPrompt: huge,
      materialAmbiguity: huge,
      confidence: "HIGH"
    },
    operatorInstruction: huge,
    nanoObservation: {
      summary: huge,
      materialFacts: [huge, huge, huge, huge, huge],
      uncertainties: [huge, huge, huge],
      continuityRisk: "LOW",
      recommendedFocus: huge,
      confidence: "HIGH"
    },
    nanoTask: {
      requested: true,
      requestId: "nano-1",
      status: "COMPLETED",
      semanticStatus: "SATISFIED",
      sourceTask: huge,
      result: huge,
      error: huge
    }
  });
  assert.ok(prompt.length < 6200, `Hjalmar prompt too large: ${prompt.length}`);
  assert.doesNotMatch(prompt, /LAST PROMPT:/);
  assert.doesNotMatch(prompt, /LATEST ASSISTANT RESPONSE:/);
});
