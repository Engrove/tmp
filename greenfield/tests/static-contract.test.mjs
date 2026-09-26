import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const audit = fs.readFileSync(new URL("../lib/audit-store.mjs", import.meta.url), "utf8");
const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const offscreen = fs.readFileSync(new URL("../offscreen.js", import.meta.url), "utf8");
const sidepanel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");

test("runtime uses per-process keyed queue, not legacy global operationQueue", () => {
  assert.match(background, /createKeyedQueue/);
  assert.match(background, /queues\.enqueue\(processId/);
  assert.doesNotMatch(background, /operationQueue/);
});

test("v1.1.12 Audit persistence defaults off while FIFO observability remains live", () => {
  assert.match(background, /AUDIT_SETTING_KEY = "eic\.gf\.audit\.enabled"/);
  assert.match(background, /let auditEnabled = AUDIT_DEFAULT_ENABLED/);
  assert.match(background, /if \(!auditEnabled\) return \{ \.\.\.event, persisted: false, persistenceMode: "FIFO_ONLY" \}/);
  assert.match(background, /EIC_GF_SET_AUDIT_ENABLED/);
  assert.match(background, /pushVolatileAudit/);
  assert.match(sidepanel, /auditEnabled/);
  assert.match(sidepanel, /SIDEPANEL_SESSION_STARTED/);
  assert.match(sidepanel, /LANGUAGE_MODEL_PREFLIGHT_ERROR/);
  assert.doesNotMatch(sidepanel, /import \{ appendAudit, appendAuditError, readAudit/);
});

test("one managed target is bound by window and tab identity and gets overlay", () => {
  assert.match(background, /tab\.windowId !== process\.windowId/);
  assert.match(background, /process\.tabId/);
  assert.match(background, /EIC_GF_OVERLAY_UPDATE/);
  assert.match(content, /eic-gf-linked-overlay/);
  assert.match(content, /CONNECTED/);
});

test("manifest has no rollout/mode options and includes continuity infrastructure", () => {
  assert.equal(manifest.version, "1.8.8");
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.ok(manifest.permissions.includes("alarms"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("unlimitedStorage"));
  assert.ok(manifest.permissions.includes("bookmarks"));
  assert.equal(JSON.stringify(manifest).includes("D0_LIVE"), false);
  assert.equal(JSON.stringify(manifest).includes("SHADOW"), false);
});

test("one-shot next instruction is app-owned, audited and enters next A2A envelope", () => {
  assert.match(background, /EIC_GF_SET_NEXT_INSTRUCTION/);
  assert.match(background, /NEXT_INSTRUCTION_QUEUED/);
  assert.match(background, /NEXT_INSTRUCTION_CONSUMED/);
  assert.match(background, /ANALYSIS_INVALIDATED_BY_OPERATOR_INSTRUCTION/);
  assert.match(background, /operatorInstruction: latestInstruction/);
  assert.match(background, /A2A_ENVELOPE_COMPOSED/);
});

test("Nano precedes fixed Hjalmar D2 in the local analysis pipeline", () => {
  assert.match(offscreen, /NANO_REQUEST_START/);
  assert.match(offscreen, /NANO_RESULT_COMMIT/);
  assert.match(offscreen, /HJALMAR_D2_REQUEST_START/);
  assert.match(background, /EIC_GF_ANALYZE_PIPELINE/);
});

test("Prompt API session declares output language", () => {
  assert.match(sidepanel, /modelCreateOptions/);
  assert.match(offscreen, /modelCreateOptions/);
  const model = fs.readFileSync(new URL("../lib/model-config.mjs", import.meta.url), "utf8");
  assert.match(model, /expectedOutputs/);
});

test("duplicate prompt auto-resend path is absent", () => {
  assert.match(background, /reconcileDispatchObservation/);
  assert.match(background, /automaticResend: false/);
  assert.doesNotMatch(background, /SEND_UNCERTAIN_MS/);
});


test("SENDING imports its dispatch reconciliation and no tick exception can escape forensic Audit", () => {
  assert.match(background, /import\s*\{\s*reconcileDispatchObservation\s*\}\s*from\s*["']\.\/lib\/dispatch-reconciliation\.mjs["']/);
  assert.match(background, /PROMPT_DISPATCH_FENCE_EVALUATED/);
  assert.match(background, /PROCESS_TICK_UNHANDLED_ERROR/);
  assert.match(background, /PROCESS_TICK_RECOVERY_ERROR/);
  assert.match(background, /handleUnhandledTickError/);
});

test("unknown send transport can only replay the same dispatch id in the same content document", () => {
  assert.match(background, /REPLAY_SAME_DISPATCH_ID/);
  assert.match(background, /dispatchId: pending\.dispatch\?\.operationId \|\| operationId/);
  assert.match(content, /dispatchRecords/);
  assert.match(content, /PROMPT_DISPATCH_IDEMPOTENT_RECEIPT/);
  assert.match(content, /const DOCUMENT_ID/);
});

test("multi-window analysis shares one offscreen host without a global process lock", () => {
  assert.match(background, /chrome\.runtime\.getContexts/);
  assert.match(background, /OFFSCREEN_DOCUMENT/);
  assert.match(background, /offscreenCreating/);
  assert.match(background, /reasons: \["WORKERS"\]/);
});

test("first LanguageModel activation is invoked directly from the Start user gesture", () => {
  const createIndex = sidepanel.indexOf("createPromise = LanguageModel.create(primary)");
  const auditIndex = sidepanel.indexOf('kind: "LANGUAGE_MODEL_PREFLIGHT_CREATE_ATTEMPT"');
  assert.ok(createIndex >= 0);
  assert.ok(auditIndex > createIndex);
  assert.match(sidepanel, /userGestureDirect: true/);
});


test("A2A response protocol is optional metadata and controller disposition owns continuation", () => {
  const a2a = fs.readFileSync(new URL("../lib/a2a.mjs", import.meta.url), "utf8");
  assert.match(background, /RESPONSE_STATUS_PARSED/);
  assert.match(background, /RESPONSE_PROTOCOL_OPTIONAL_ABSENT_OR_INVALID/);
  assert.match(background, /protocolRequiredForContinuation:\s*false/);
  assert.match(background, /CONTINUATION_DISPOSITION_BOUND/);
  assert.match(background, /previousDisposition:\s*d\.disposition/);
  assert.doesNotMatch(background, /TARGET_BLOCKED_BARRIER/);
  assert.doesNotMatch(background, /TARGET_DONE_BARRIER/);
  assert.doesNotMatch(background, /TARGET_RESPONSE_CONTRACT_INVALID/);
  assert.match(a2a, /preferred but optional/i);
  assert.match(a2a, /do not depend on protocol presence/i);
});



test("WAITING never transitions directly from A2A protocol metadata to DONE or BLOCKED", () => {
  const start = background.indexOf("async function tickWaiting");
  const end = background.indexOf("async function ensureOffscreenAnalyzer", start);
  assert.ok(start >= 0 && end > start);
  const waiting = background.slice(start, end);
  assert.doesNotMatch(waiting, /commitTransition\([^\n]+PHASES\.DONE/);
  assert.doesNotMatch(waiting, /TARGET_BLOCKED_BARRIER/);
  assert.doesNotMatch(waiting, /TARGET_DONE_BARRIER/);
  assert.doesNotMatch(waiting, /TARGET_RESPONSE_CONTRACT_INVALID/);
  assert.match(waiting, /PHASES\.ANALYZING/);
  assert.match(waiting, /protocolRequiredForContinuation:\s*false/);
});

test("manual chat interleaving is audited, persisted as bounded evidence and not admitted as autonomous", () => {
  const causality = fs.readFileSync(new URL("../lib/turn-causality.mjs", import.meta.url), "utf8");
  const a2a = fs.readFileSync(new URL("../lib/a2a.mjs", import.meta.url), "utf8");
  assert.match(background, /EXTERNAL_TURN_INTERLEAVED/);
  assert.match(background, /responseInterleave/);
  assert.match(background, /persistedForResponseEvidence:\s*true/);
  assert.match(background, /admissibleAsAutonomousResponse:\s*false/);
  assert.match(causality, /externalAssistantInterleaveEvidence/);
  assert.match(causality, /AUTONOMOUS_USER_TURN_ID_MISMATCH/);
  assert.match(causality, /pairedUserTurnId/);
  assert.match(a2a, /externalInterleave/);
  assert.ok((background.match(/responseInterleave:\s*null/g) || []).length >= 2,
    "responseInterleave must reset on both normal continuation and idle keepalive turn creation");
  assert.doesNotMatch(background, /TEST_ONLY_ADMISSION_DELAY|MANUAL_INTERLEAVE_HOLD_MS/);
});

test("Nano task lane is fresh one-prompt and does not blind replay unknown effect", () => {
  assert.match(offscreen, /NANO_TASK_REQUEST_START/);
  assert.match(offscreen, /NANO_TASK_RESULT_COMMIT/);
  assert.match(offscreen, /NANO_TASK_REPLAY_BLOCKED/);
  assert.match(offscreen, /session\.prompt\(executionPrompt\)/);
  assert.match(background, /NANO_TASK_WRITE_AHEAD/);
  assert.match(background, /replayOnUnknownForbidden:\s*true/);
});

test("continuation admission is deterministic and emits bounded analysis evidence", () => {
  assert.match(background, /CONTINUATION_ADMISSION_EVALUATED/);
  assert.match(background, /CONTINUATION_ADMISSION_BLOCKED/);
  assert.match(background, /analysisEvidence/);
  assert.match(background, /objectiveState/);
});


test("v1.2.3 background resolves dedicated Greenfield control before terminal phase handling", () => {
  assert.match(background, /resolveGreenfieldControl/);
  assert.match(background, /GREENFIELD_CONTROL_RESOLVED/);
  assert.match(background, /applyGreenfieldControlToDecision/);
  assert.match(background, /greenfieldControl\.action/);
});

test("v1.8.8 identity is consistent across runtime surfaces", () => {
  const contracts = fs.readFileSync(new URL("../lib/contracts.mjs", import.meta.url), "utf8");
  const panelHtml = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  assert.match(contracts, /APP_VERSION = "1\.8\.8"/);
  assert.match(content, /const CONTENT_VERSION = "1\.8\.8"/);
  assert.match(content, /EIC Greenfield v\$\{CONTENT_VERSION\}/);
  assert.match(sidepanel, /appVersion: "1\.8\.8"/);
  assert.match(panelHtml, /Greenfield <span>v1\.8\.8<\/span>/);
});


test("v1.1.2 reconciles Hjalmar mirror facts and sanitizes consumed Nano task directives", () => {
  assert.match(background, /HJALMAR_RUNTIME_FACTS_RECONCILED/);
  assert.match(background, /reconcileHjalmarRuntimeFacts/);
  assert.match(background, /modelEvidenceBinding/);
  assert.match(background, /runtimeCorrections/);
  const hjalmar = fs.readFileSync(new URL("../lib/hjalmar-d2.mjs", import.meta.url), "utf8");
  assert.match(hjalmar, /NANO_TASK_REQUESTED_MISMATCH/);
  assert.match(hjalmar, /CONSUMED_NANO_TASK_DIRECTIVE_REMOVED/);
  assert.match(hjalmar, /runtimeNanoTaskAssessment/);
});


test("v1.3.0 gives Nano a prompt-closed English runtime-owned execution prompt and audits source separately", () => {
  const nanoTask = fs.readFileSync(new URL("../lib/nano-task.mjs", import.meta.url), "utf8");
  const a2a = fs.readFileSync(new URL("../lib/a2a.mjs", import.meta.url), "utf8");
  assert.match(nanoTask, /NANO_TASK_LANGUAGE = "en"/);
  assert.match(nanoTask, /PROMPT_CLOSED_EXECUTION_V2/);
  assert.match(nanoTask, /Do not output source code unless the task explicitly asks for source code/);
  assert.match(nanoTask, /sourceTask/);
  assert.match(nanoTask, /executionPrompt/);
  assert.match(offscreen, /promptLanguage/);
  assert.match(offscreen, /promptPolicy/);
  assert.match(offscreen, /session\.prompt\(executionPrompt\)/);
  assert.match(background, /sourceTask: nanoTask\.sourceTask \|\| nanoTask\.task/);
  assert.match(background, /executionPrompt: nanoTask\.executionPrompt \|\| nanoTask\.task/);
  assert.match(a2a, /nanoTaskLanguage: "en"/);
  assert.match(a2a, /dedicated English line beginning exactly/);
});


test("renderer quote repair remains available but UNKNOWN protocol status is no longer terminal", () => {
  const responseContract = fs.readFileSync(new URL("../lib/response-contract.mjs", import.meta.url), "utf8");
  const continuationGuard = fs.readFileSync(new URL("../lib/continuation-guard.mjs", import.meta.url), "utf8");
  assert.match(responseContract, /REPAIRED_UNESCAPED_QUOTES/);
  assert.match(responseContract, /repairLikelyUnescapedStringQuotes/);
  assert.match(background, /RESPONSE_PROTOCOL_OPTIONAL_ABSENT_OR_INVALID/);
  assert.doesNotMatch(continuationGuard, /TARGET_DISPOSITION_UNKNOWN/);
});

test("v1.1.3 surfaces Nano task and observer results in the side panel without clearing the last task on response capture", () => {
  assert.match(sidepanel, /\$\("nanoPreview"\)\.textContent/);
  assert.match(sidepanel, /nanoView\.task/);
  assert.match(sidepanel, /nanoView\.observer/);
  assert.match(sidepanel, /promptLanguage/);
  assert.match(sidepanel, /promptPolicy/);
  assert.doesNotMatch(background, /lastNanoTask:\s*null/);
});

test("v1.1.3 bounded analysisEvidence carries Nano prompt metadata", () => {
  assert.match(background, /promptLanguage:\s*result\.nanoTask\.promptLanguage/);
  assert.match(background, /promptPolicy:\s*result\.nanoTask\.promptPolicy/);
});


test("v1.1.5 durably commits isolated Nano Task before advisory Nano/Hjalmar stages", () => {
  const taskCall = background.indexOf('type: "EIC_GF_RUN_NANO_TASK"');
  const pipelineCall = background.indexOf('type: "EIC_GF_ANALYZE_PIPELINE"');
  assert.ok(taskCall >= 0);
  assert.ok(pipelineCall > taskCall);
  assert.match(background, /persistNanoTaskCheckpoint/);
  assert.match(background, /NANO_TASK_DURABLE_COMMIT/);
  assert.match(background, /NANO_TASK_PIPELINE_READBACK/);
  assert.match(offscreen, /EIC_GF_RUN_NANO_TASK/);
});

test("v1.1.5 treats observer/Hjalmar model-format failures as audited advisory fallback", () => {
  assert.match(offscreen, /runStructuredWithFallback/);
  assert.match(offscreen, /NANO_OBSERVER_RUNTIME_FALLBACK/);
  assert.match(offscreen, /HJALMAR_RUNTIME_FALLBACK/);
  assert.match(offscreen, /Runtime-bounded Hjalmar fallback/);
});

test("v1.1.5 preserves unknown exact-once Nano effects as UNKNOWN_EFFECT instead of false FAILED", () => {
  const nanoTask = fs.readFileSync(new URL("../lib/nano-task.mjs", import.meta.url), "utf8");
  assert.match(nanoTask, /UNKNOWN_EFFECT/);
  assert.match(offscreen, /NANO_TASK_EFFECT_UNKNOWN_NO_REPLAY/);
  assert.match(offscreen, /status:\s*NANO_TASK_STATUS\.UNKNOWN_EFFECT/);
});

test("v1.1.5 A2A sanitizer retains Nano prompt metadata and line-scopes the directive", () => {
  const a2a = fs.readFileSync(new URL("../lib/a2a.mjs", import.meta.url), "utf8");
  const nanoTask = fs.readFileSync(new URL("../lib/nano-task.mjs", import.meta.url), "utf8");
  assert.match(a2a, /promptLanguage:\s*text\(value\.nanoTask\.promptLanguage/);
  assert.match(a2a, /promptPolicy:\s*text\(value\.nanoTask\.promptPolicy/);
  assert.match(a2a, /ends at the first newline/);
  assert.match(nanoTask, /const lineEnd = source\.indexOf\("\\n", taskStart\)/);
});

test("v1.3.0 enforces Nano prompt-closure without imposing a task-complexity ceiling", () => {
  const nanoTask = fs.readFileSync(new URL("../lib/nano-task.mjs", import.meta.url), "utf8");
  const a2a = fs.readFileSync(new URL("../lib/a2a.mjs", import.meta.url), "utf8");
  assert.match(nanoTask, /NANO_KNOWLEDGE_BOUNDARY = "PROMPT_ONLY"/);
  assert.match(nanoTask, /NANO_CONTEXT_REQUIRED_PREFIX/);
  assert.match(nanoTask, /assessNanoTaskPromptClosure/);
  assert.match(background, /NANO_TASK_PROMPT_CLOSURE_REJECTED/);
  assert.match(offscreen, /NANO_TASK_CONTEXT_REQUIRED/);
  assert.match(a2a, /MODEL_CAPABILITY_NOT_ARTIFICIALLY_LIMITED/);
  assert.match(a2a, /fact\/data item required/i);
});


test("v1.1.6 separates renderer-degraded response control from full JSON schema validity", () => {
  const responseContract = fs.readFileSync(new URL("../lib/response-contract.mjs", import.meta.url), "utf8");
  assert.match(responseContract, /CONTROL_PLANE_SALVAGE/);
  assert.match(responseContract, /extractRendererSafeControl/);
  assert.match(background, /RESPONSE_SCHEMA_DEGRADED_CONTROL_ACCEPTED/);
  assert.match(background, /hasCanonicalResponseControl/);
  assert.match(background, /controlOk/);
});

test("v1.1.6 exact-literal verifier recognizes the direct grammar and preserves raw whitespace semantics", () => {
  const nanoTask = fs.readFileSync(new URL("../lib/nano-task.mjs", import.meta.url), "utf8");
  assert.match(nanoTask, /and nothing else/);
  assert.match(nanoTask, /canonicalExactLineResult/);
  assert.doesNotMatch(nanoTask, /const trimmed = raw\\.trim\\(\\)/);
});


test("v1.1.9 response observation closes structural, causal and interleave producer-to-consumer wires before parsing", () => {
  const causality = fs.readFileSync(new URL("../lib/turn-causality.mjs", import.meta.url), "utf8");
  assert.match(content, /documentId:\s*DOCUMENT_ID/);
  assert.match(content, /expectedUserTurnId/);
  assert.match(content, /resolvedUserTurnId/);
  assert.match(content, /lastAssistantOwnerKind/);
  assert.match(content, /lastAssistantOwnerTrusted/);
  assert.match(content, /assistantTextLength/);
  assert.match(causality, /pairedUserTurnId:\s*resolvedUserTurnId/);
  assert.match(background, /RESPONSE_OBSERVATION_HELD/);
  assert.match(background, /EXTERNAL_TURN_INTERLEAVED/);
  assert.match(background, /identityKey:\s*advanced\.candidate\?\.identityKey/);
});

test("v1.1.7 keeps Chrome Nano model prompts compact and does not forward raw turn transcripts", () => {
  const nano = fs.readFileSync(new URL("../lib/nano.mjs", import.meta.url), "utf8");
  const hjalmar = fs.readFileSync(new URL("../lib/hjalmar-d2.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(nano, /LAST PROMPT:/);
  assert.doesNotMatch(nano, /LATEST ASSISTANT RESPONSE:/);
  assert.doesNotMatch(hjalmar, /LAST PROMPT:/);
  assert.doesNotMatch(hjalmar, /LATEST ASSISTANT RESPONSE:/);
  assert.match(background, /modelContextPolicy:\s*"NANO_PROMPT_CLOSED_SMALL_CONTEXT_V2"/);
});

test("v1.1.7 local-model context budgets have producer and execution consumer ends", () => {
  const offscreen = fs.readFileSync(new URL("../offscreen.js", import.meta.url), "utf8");
  assert.match(offscreen, /LOCAL_MODEL_PROMPT_CHAR_BUDGET/);
  assert.match(offscreen, /nano:\s*3400/);
  assert.match(offscreen, /hjalmar:\s*6200/);
  assert.match(offscreen, /nanoTask:\s*2600/);
  assert.match(offscreen, /LOCAL_MODEL_CONTEXT_BUDGET_EXCEEDED/);
  assert.match(offscreen, /NANO_TASK_CONTEXT_BUDGET_EXCEEDED/);
  assert.match(offscreen, /contextBudgetChars/);
});


test("v1.1.12 persistent Audit reads are indexed and bounded, never global getAll", () => {
  const contracts = fs.readFileSync(new URL("../lib/contracts.mjs", import.meta.url), "utf8");
  assert.match(contracts, /AUDIT_DB_VERSION = 3/);
  assert.match(contracts, /AUDIT_FIFO_LIMIT = 25/);
  assert.match(contracts, /MAX_PERSISTED_AUDIT_EVENTS = 5_000/);
  assert.match(audit, /byProcessTime/);
  assert.match(audit, /byWindowTime/);
  assert.match(audit, /openCursor/);
  assert.match(audit, /pruneAudit/);
  assert.doesNotMatch(audit, /\.getAll\(/);
});

test("v1.1.12 Audit write path no longer serializes on a global counter", () => {
  assert.doesNotMatch(audit, /GLOBAL_COUNTER_KEY/);
  assert.doesNotMatch(audit, /counters\.get/);
  assert.doesNotMatch(audit, /counters\.put/);
  assert.match(audit, /eventKey: `time:/);
});

test("v1.1.12 ordinary side-panel Audit rendering uses FIFO state, not IndexedDB history", () => {
  assert.match(sidepanel, /state\.audit/);
  assert.match(sidepanel, /AUDIT_FIFO_LIMIT/);
  assert.match(sidepanel, /EIC_GF_AUDIT_CHANGED/);
  assert.doesNotMatch(sidepanel, /readAudit\(/);
  assert.match(sidepanel, /if \(state\.audit\?\.enabled !== true\) return/);
});

test("v1.1.12 PAGE_STATE_OBSERVED omits repeated raw assistant response text", () => {
  const begin = background.indexOf('await audit(process, "PAGE_STATE_OBSERVED"');
  const end = background.indexOf('}).catch(() => undefined);', begin);
  assert.ok(begin >= 0 && end > begin);
  const block = background.slice(begin, end);
  assert.match(block, /assistantHash:/);
  assert.match(block, /assistantTextLength:/);
  assert.doesNotMatch(block, /\n\s*assistantText:/);
  assert.doesNotMatch(block, /autonomousTurn:\s*state\.autonomousTurn \|\| null/);
  assert.match(block, /assistantTextLength: Number\(state\.autonomousTurn\.assistantTextLength/);
});

test("v1.1.12 high-frequency unchanged Audit diagnostics are coalesced before persistence", () => {
  assert.match(background, /AUDIT_NOISE_KINDS/);
  assert.match(background, /PROCESS_TICK/);
  assert.match(background, /PAGE_STATE_OBSERVED/);
  assert.match(background, /RESPONSE_OBSERVATION_HELD/);
  assert.match(background, /RESPONSE_STABILITY_SAMPLE/);
  assert.match(background, /AUDIT_NOISE_SAMPLE_MS/);
  assert.match(background, /persistenceMode: "COALESCED"/);
});


test("v1.2.0 wires extension-wide prompt pause into SENDING without replacing exact-once dispatch", () => {
  const gate = fs.readFileSync(new URL("../lib/global-prompt-gate.mjs", import.meta.url), "utf8");
  const settings = fs.readFileSync(new URL("../lib/operator-settings.mjs", import.meta.url), "utf8");
  const panelHtml = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  assert.match(gate, /GLOBAL_PROMPT_GATE_KEY = "eic\.gf\.global-prompt-post-gate\.v1"/);
  assert.match(gate, /reserveGlobalPromptSlot/);
  assert.match(gate, /claimGlobalPromptSend/);
  assert.match(gate, /commitGlobalPromptPost/);
  assert.match(gate, /lastPromptPostedAtMs/);
  assert.match(gate, /activeLease/);
  assert.match(settings, /MAX_POST_DELAY_SECONDS = 300/);
  assert.match(background, /GLOBAL_PROMPT_PAUSE_ARMED/);
  assert.match(background, /GLOBAL_PROMPT_PAUSE_EXTENDED/);
  assert.match(background, /GLOBAL_PROMPT_POST_COMMITTED/);
  assert.match(background, /claimGlobalPromptSend/);
  assert.match(background, /reconcileDispatchObservation/);
  assert.match(panelHtml, /data-stage="PROMPT_PAUSE"/);
  assert.match(panelHtml, /Paus mellan analys och post/);
  assert.match(sidepanel, /promptPauseRemainingMs/);
});

test("v1.2.0 keeps saved missions persistent and bounded", () => {
  const settings = fs.readFileSync(new URL("../lib/operator-settings.mjs", import.meta.url), "utf8");
  const panelHtml = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  // v1.8.5 raised the bound from 24 to 64 and replaced silent pruning with a refusal.
  assert.match(settings, /MAX_SAVED_MISSIONS = 64/);
  assert.match(settings, /saveMissionPreset/);
  assert.match(settings, /deleteMissionPreset/);
  assert.match(sidepanel, /saveCurrentMission/);
  assert.match(sidepanel, /loadSelectedMission/);
  assert.match(panelHtml, /Sparade uppdrag/);
});

test("v1.2.1 breaks deterministic owner-untrusted polling without weakening hidden-fragment or causal isolation guards", () => {
  const stability = fs.readFileSync(new URL("../lib/response-stability.mjs", import.meta.url), "utf8");
  assert.match(stability, /RESPONSE_CAUSAL_FALLBACK_MIN_MS/);
  assert.match(stability, /RESPONSE_CAUSAL_FALLBACK_READS/);
  assert.match(stability, /pairedUserResolvedBy === "USER_TURN_ID"/);
  assert.match(stability, /responseSlotClosed !== true/);
  assert.match(stability, /visibilityState \|\| "unknown"\) === "visible"/);
  assert.match(background, /RESPONSE_CAUSAL_FALLBACK_ADMITTED/);
  assert.match(content, /COHERENT_ROLE_REPLICA/);
  assert.match(content, /stableEntryIndex/);
});


test("v1.3.2 Session Health is wired from post boundary through response capture and resets on rotation", () => {
  const a2a = fs.readFileSync(new URL("../lib/a2a.mjs", import.meta.url), "utf8");
  const state = fs.readFileSync(new URL("../lib/state.mjs", import.meta.url), "utf8");
  const health = fs.readFileSync(new URL("../lib/session-health.mjs", import.meta.url), "utf8");
  assert.match(state, /createSessionHealthState/);
  assert.match(background, /markSessionHealthPromptPosted/);
  assert.match(background, /markSessionHealthFirstResponse/);
  assert.match(background, /completeSessionHealthTurn/);
  assert.match(background, /resetSessionHealthForRotation/);
  assert.match(background, /markSessionHealthRecovery/);
  assert.match(a2a, /sessionHealthControl/);
  assert.match(a2a, /ADVISORY_PROXY_NOT_TOKEN_COUNT/);
  assert.match(a2a, /text: JSON\.stringify\(envelope\)/);
  assert.doesNotMatch(a2a, /JSON\.stringify\(envelope,\s*null,\s*2\)/);
  assert.match(health, /pressureBand/);
  assert.doesNotMatch(health, /ROTATE_SESSION_NOW/);
});

test("v1.3.3 canonical A2A partial-response hold is wired before terminal parsing", () => {
  const stability = fs.readFileSync(new URL("../lib/response-stability.mjs", import.meta.url), "utf8");
  assert.match(stability, /A2A_RESPONSE_SCHEMA/);
  assert.match(stability, /canonicalA2AResponseStructurallyIncomplete/);
  assert.match(stability, /OBSERVATION_CANONICAL_A2A_RESPONSE_INCOMPLETE/);
  assert.match(background, /advanceResponseCandidate/);
  assert.match(background, /parseTargetResponse/);
});

