import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  evaluateReleaseIdentity,
  parseContentScriptVersion,
  releaseIdentityFailureDetail
} from "../lib/release-identity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));
const json = (relative) => JSON.parse(read(relative));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const pkg = json("package.json");
const manifest = json("manifest.json");
const contracts = read("lib/contracts.mjs");
const background = read("background.js");
const nano = read("lib/nano-pipeline.mjs");
const delivery = read("lib/delivery-kernel.mjs");
const fallbackPlanner = read("lib/fallback-planner.mjs");
const forward = read("lib/forward-only-policy.mjs");
const ui = read("lib/ui-contract.mjs");
const prompt = read("lib/prompt-contract.mjs");
const startSession = read("lib/start-session.mjs");
const taskIntegrity = read("lib/task-integrity.mjs");
const archaeologyPrompt = read("lib/archaeology-prompt.mjs");
const appAuditPrompt = read("lib/app-audit-prompt.mjs");
const decisionGrounding = read("lib/decision-grounding.mjs");
const autoRuntimeGuards = read("lib/auto-runtime-guards.mjs");
const coreSurfaceReview = read("lib/core-surface-review.mjs");
const autostartPresets = read("lib/autostart-presets.mjs");
const autostartTransaction = read("lib/autostart-transaction.mjs");
const attentionRouter = read("lib/attention-router.mjs");
const runtimeHardening = read("lib/runtime-hardening.mjs");
const fullAudit = read("lib/full-audit-log.mjs");
const mainTaskGuard = read("lib/main-task-guard.mjs");
const sessionContextInit = read("lib/session-context-init.mjs");
const mjolnar = read("lib/mjolnar.mjs");
const missionStateMachine = read("lib/mission-state-machine.mjs");
const sessionCapture = read("lib/session-capture.mjs");
const content = read("content.js");
const sidepanel = read("sidepanel.js");
const sidepanelHtml = read("sidepanel.html");
const profiles = read("lib/core-profiles.mjs");
const packageScript = read("scripts/package.mjs");
const eic = read("EIC.md");
const readme = read("README.md");

check(exists("docs/V0_10_12_ARCHITECTURE.md") &&
  exists("docs/V0_10_12_CHANGE_MANIFEST.json") &&
  exists("docs/CHANGELOG_V0_10_12.md") &&
  exists("docs/VERIFICATION_V0_10_12.md") &&
  exists("docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_12.md") &&
  exists("docs/V0_10_12_INCIDENT_ANALYSIS.md"),
  "v0.10.12 current documents missing.");
check(pkg.version === "0.10.12", "package.json must be 0.10.12.");
check(manifest.version === "0.10.12", "manifest.json must be 0.10.12.");
check(contracts.includes('APP_VERSION = "0.10.12"'), "APP_VERSION 0.10.12 missing.");
check(contracts.includes('CONTENT_SCRIPT_VERSION = "0.10.12"'), "content version 0.10.12 missing.");
check(sessionContextInit.includes('SESSION_CONTEXT_INIT_SCHEMA = "eic.autonom.session-context-init.v1"') &&
  sessionContextInit.includes("WAITING_CHAT_READY") &&
  sessionContextInit.includes("CATCH_ARMED") &&
  sessionContextInit.includes("WAITING_BASELINE_RESPONSE") &&
  sessionContextInit.includes("NANO_ANALYZING") &&
  sessionContextInit.includes("READY"),
  "universal session-context initialization state machine missing.");
check(contracts.includes('CONFIG_SCHEMA = "eic.autonom.config.v13"'), "config v13 missing.");
check(contracts.includes("CONFIG_VERSION = 13"), "config version owner constant missing.");
check(contracts.includes('RUNTIME_SCHEMA = "eic.autonom.runtime.v13"'), "runtime v13 missing.");
check(contracts.includes("RUNTIME_VERSION = 13"), "runtime version owner constant missing.");
check(contracts.includes('CONTINUITY_SCHEMA = "eic.nano.continuity.v4"'), "continuity v4 missing.");
check(contracts.includes('EXPORT_SCHEMA = "eic.autonom.export.v20"'), "export v20 missing.");
check(contracts.includes("EXPORT_VERSION = 20"), "export version 20 missing.");
check(contracts.includes("NANO_WALL_TIMEOUT_MS = 1_800_000"), "Nano wall timeout owner missing.");
check(typeof manifest.key === "string" && manifest.key.length > 300,
  "manifest key must pin one stable unpacked extension identity.");
const nanoHostAdmission = read("lib/nano-host-admission.mjs");
check(nanoHostAdmission.includes("NANO_HOST_CREATE_TIMEOUT_MS") &&
  nanoHostAdmission.includes("missionStartAllowed") &&
  nanoHostAdmission.includes("withNanoHostCreateDeadline"),
  "Nano host admission contract missing.");
check(background.includes('eic.autonom.nano-host-telemetry.v4') &&
  background.includes("createDeadlineAt") &&
  background.includes("lastProgressAt") &&
  background.includes("canaryVerified"),
  "Nano host admission telemetry is not owner-persisted.");

check(forward.includes('FORWARD_ONLY_SINCE = "0.9.3"'), "forward-only policy start missing.");
check(forward.includes('mode: "CURRENT_VERSION_ONLY"'), "current-version-only mode missing.");
check(forward.includes("migrateOlderState: false"), "old-state migration must be false.");
check(forward.includes("acceptOlderExports: false"), "older exports must be rejected.");
check(background.includes("currentStateOrFresh") && background.includes("assertCurrentExport"),
  "background must enforce current-only state and import.");
const loadCurrentStateBlock = background.match(/function loadCurrentState\([\s\S]*?\n\}/)?.[0] || "";
check(loadCurrentStateBlock.includes("version: CONFIG_VERSION") &&
  loadCurrentStateBlock.includes("version: RUNTIME_VERSION") &&
  !loadCurrentStateBlock.includes("version: 12"),
  "current config/runtime loader must use contract-owned v13 constants.");
check(background.includes("current.version = CONFIG_VERSION"),
  "config save path must use the contract-owned version.");
check(!/migration-v[0-9]+-v[0-9]+/.test(background), "background imports a migration module.");

for (const name of [
  "lib/migration-v2-v3.mjs",
  "lib/migration-v3-v4.mjs",
  "lib/migration-v4-v5.mjs",
  "lib/migration-v5-v6.mjs",
  "lib/migration-v6-v7.mjs",
  "lib/migration-v7-v8.mjs",
  "lib/migration-v8-v9.mjs"
]) check(!exists(name), `obsolete migration module remains: ${name}`);

check(ui.includes('UI_COMMAND_SCHEMA = "eic.autonom.ui-command.v2"'), "UI command v2 missing.");
check(ui.includes('UI_COMMAND_RESULT_SCHEMA = "eic.autonom.ui-command-result.v2"'), "UI result v2 missing.");
check(ui.includes('UI_SNAPSHOT_SCHEMA = "eic.autonom.ui-snapshot.v3"'), "UI snapshot v3 missing.");
check(ui.includes("UI_COMMAND_SCHEMA_UNSUPPORTED"), "UI schema fail-closed check missing.");
check(!ui.includes("LEGACY_UI_SNAPSHOT_SCHEMA"), "legacy UI snapshot alias remains.");

check(prompt.includes('TURN_PROTOCOL = "EIC-AA/5"'), "EIC-AA/5 missing.");
check(prompt.includes("TURN_SCHEMA_VERSION = 5"), "turn schema v5 missing.");
check(prompt.includes('canonicalSource: "JSON"') &&
  !/EIC_MACHINE_ENVELOPE/.test(prompt.match(/export async function compileTurnPrompt[\s\S]*?export function stripProtocolNoise/)?.[0] || ""),
  "canonical JSON-only target prompt missing.");
check(startSession.includes("TURN_BOUND_5") && startSession.includes("TURNLESS_4") &&
  !startSession.includes("TURN_BOUND_4") && !startSession.includes("TURNLESS_3") &&
  !startSession.includes("EIC-AA/3"),
  "start-session still contains retired response contracts.");
check(taskIntegrity.includes("EIC_NEXT_ACTOR") && taskIntegrity.includes("Fem syntaktiskt giltiga"),
  "protocol repair does not require the five-line EIC-AA/5 footer.");
check(archaeologyPrompt.includes("exakt fem rader") &&
  archaeologyPrompt.includes("EIC_NEXT_ACTOR:") &&
  !archaeologyPrompt.includes("FULL_STOP"),
  "archaeology prompt is not current EIC-AA/5.");
check(appAuditPrompt.includes("femradiga EIC-AA/5-trailer") &&
  !appAuditPrompt.includes("fyraradiga EIC-AA/3-trailer"),
  "app-audit prompt still references the retired EIC-AA/3 trailer.");
check(!decisionGrounding.includes('targetStatus === "FULL_STOP"') &&
  !decisionGrounding.includes('["DONE", "FULL_STOP"]'),
  "decision grounding still accepts retired FULL_STOP.");
check(autoRuntimeGuards.includes("NANO_AUTO_RESTART_COOLDOWN_MS") &&
  autoRuntimeGuards.includes("evaluateAutoCapture") &&
  autoRuntimeGuards.includes("isAutoCaptureTerminalResponse") &&
  autoRuntimeGuards.includes("COMPLETE_PROTOCOL_OVERRIDE") &&
  autoRuntimeGuards.includes("evaluateInterruptedNanoRecovery"),
  "runtime lifecycle and capture eligibility guards missing.");
check(sidepanel.includes("maybeAutoRestartNano") &&
  background.includes("scheduleBackgroundAutoSessionCapture") &&
  background.includes("isAutoCaptureTerminalResponse(linked)") &&
  !sidepanel.includes("function scheduleAutoSessionCapture") &&
  sidepanelHtml.includes('id="autoRestartNanoOnChange"') &&
  sidepanelHtml.includes('id="autoSessionCaptureEnabled"'),
  "background-owned automatic restart/capture integration missing.");
check(coreSurfaceReview.includes("CORE_SURFACE_REVIEW_RESPONSE_SCHEMA") &&
  coreSurfaceReview.includes("shouldScheduleAutomaticCoreSurfaceReview") &&
  background.includes("createPendingCoreSurfaceReview") &&
  sidepanel.includes("processPendingCoreSurfaceReview") &&
  sidepanelHtml.includes('id="applyCoreSurfaceReviewButton"') &&
  sidepanelHtml.includes('id="declineCoreSurfaceReviewButton"') &&
  sidepanelHtml.includes('id="reevaluateCoreSurfacesButton"'),
  "Nano settings/core-surface review chain missing.");
check(coreSurfaceReview.includes("CORE_SURFACE_REVIEW_DEFERRAL_SCHEMA") &&
  coreSurfaceReview.includes("createCoreSurfaceReviewDeferral") &&
  coreSurfaceReview.includes("replayDeferredCoreSurfaceReview") &&
  background.includes("maybeReplayDeferredCoreSurfaceReview") &&
  background.includes("session-context-ready") &&
  background.includes("nano-host-${event}") &&
  sidepanel.includes("automaticCoreSurfaceReviewHasPriority") &&
  sidepanel.includes("prioriteras den före vanlig mission-Nano"),
  "v0.10.10 exactly-once deferred core-surface review replay missing.");
check(autoRuntimeGuards.includes("createAutoCaptureGuard") &&
  autoRuntimeGuards.includes("runBlocksAutomaticCapture") &&
  !autoRuntimeGuards.includes("documentEpoch:"),
  "automatic capture identity/guard is not stable and current.");
check(background.includes("signalAutomaticCaptureCancellation") &&
  background.includes("EIC_CANCEL_CAPTURE") &&
  content.includes("SESSION_CAPTURE_CANCELLED"),
  "Pause/Stop capture cancellation chain missing.");
check(coreSurfaceReview.includes("CORE_SURFACE_AUTO_APPLY_TTL_MS") &&
  coreSurfaceReview.includes("coreSurfaceAutoApplyDue") &&
  background.includes("processExpiredCoreSurfaceReviews") &&
  sidepanelHtml.includes('id="autoApplyCoreSurfaceReviewEnabled"'),
  "five-minute core-surface review TTL chain missing.");
check(autostartPresets.includes("MJOLNAR_D2") &&
  autostartPresets.includes("CONTEXT_ONLY") &&
  sidepanelHtml.includes('id="autostartPresetSelect"') &&
  sidepanelHtml.includes('id="autostartButton"'),
  "ordered Autostart preset surface missing.");
const autostartBlock = sidepanel.match(/async function autostartClick\([\s\S]*?\n\}/)?.[0] || "";
check(autostartTransaction.includes("SECOND_EXPLICIT_CLICK") &&
  autostartTransaction.includes("AUTOSTART_TAB_BINDING_READBACK_FAILED"),
  "Autostart confirmation/readback transaction contract missing.");
check(!autostartBlock.includes("confirm(") &&
  autostartBlock.includes("autostartActivationOutcome(beginNanoCreateFromGestureWithConfig(preparedConfig))") &&
  autostartBlock.indexOf("autostartActivationOutcome(beginNanoCreateFromGestureWithConfig(preparedConfig))") <
    autostartBlock.indexOf('await command("SAVE_CONFIG"'),
  "Autostart must enter native create from the operator gesture before its first await.");
check(autostartBlock.includes("assertAutostartTabBinding") &&
  autostartBlock.indexOf("assertAutostartTabBinding") < autostartBlock.indexOf("startMissionMode"),
  "Autostart must verify tab/controller readback before mission start.");
check(autostartBlock.includes("{ persistConfig: false }"),
  "Autostart mission start must not perform a second implicit config save.");
check(attentionRouter.includes("deriveAttentionTarget") &&
  attentionRouter.includes("OPERATOR_DECISION") &&
  attentionRouter.includes("CORE_SURFACE_REVIEW") &&
  sidepanelHtml.includes('id="attentionBanner"'),
  "clickable attention-routing contract missing.");
check(sidepanelHtml.includes('id="appVersion"') &&
  sidepanel.includes('elements.appVersion.textContent = `v${APP_VERSION}`') &&
  sidepanel.includes('document.title = `EIC Autonom Agent v${APP_VERSION}`'),
  "UI version must be rendered from APP_VERSION.");
check(sidepanel.includes("function renderControls(run, hasTarget, windowContext = {})") &&
  sidepanel.includes("renderControls(run, Boolean(windowContext.selectedTabId), windowContext);"),
  "renderControls must receive its windowContext explicitly.");
check(!sidepanelHtml.includes("v0.10.0") && !sidepanelHtml.includes("v0.10.1") && !sidepanelHtml.includes("v0.10.2") && !sidepanelHtml.includes("v0.10.3") && !sidepanelHtml.includes("v0.10.4"),
  "sidepanel HTML contains a stale hard-coded application version.");
check(background.includes("lastAcknowledgedMandateReceipt") &&
  background.includes("INTERRUPTED_REQUEUED_ONCE"),
  "ACK-bound mandate reference or interrupted Nano recovery missing.");
check(nano.includes("NANO DECISION REQUEST v12"), "compact Nano prompt v12 missing.");
check(nano.includes("REFERENCE_PLUS_DELTA"), "progressive context strategy missing.");
check(nano.includes("fullMandateChars: 0") && nano.includes("fullConversationChars: 0"),
  "Nano prompt must exclude full mandate/conversation.");
check(!nano.includes('label: "TARGET RESPONSE"') && !nano.includes('label: "RECENT CONVERSATION"'),
  "Nano still copies target/conversation prose.");
check(exists("lib/operator-action.mjs") && background.includes("submitOperatorActionEvidence"),
  "operator-action owner chain missing.");
check(exists("lib/level10-ack.mjs") && background.includes("acceptOperatorDecisionReceipt"),
  "level-10 acknowledgement owner chain missing.");
check(exists("lib/session-db.mjs") && background.includes("openSessionDatabase"),
  "IndexedDB session persistence missing.");
check(exists("lib/session-capture.mjs") && background.includes("EIC_CAPTURE_TRANSCRIPT"),
  "Session Capture integration missing.");
check(exists("lib/session-memory.mjs") && background.includes("buildActiveMemoryCapsule"),
  "Session Memory integration missing.");
check(ui.includes("SUBMIT_OPERATOR_ACTION_RECEIPT") &&
  ui.includes("CAPTURE_SESSION") &&
  ui.includes("PURGE_SESSION_CONTEXT"),
  "v0.10 closed UI commands missing.");

check(runtimeHardening.includes("projectRunIntoContinuity") &&
  runtimeHardening.includes("continuitySemanticallyEqual") &&
  runtimeHardening.includes("evaluateNanoDiscrimination") &&
  runtimeHardening.includes("MISSION_NANO_HAS_PRIORITY"),
  "runtime hardening contract missing.");
check(fullAudit.includes("FULL_AUDIT_MAX_SEGMENT_BYTES") &&
  fullAudit.includes("FULL_AUDIT_MAX_SEGMENTS") &&
  fullAudit.includes("validateFullAuditDirectoryName") &&
  contracts.includes("fullAuditLoggingEnabled: false") &&
  background.includes("persistFullAuditQueueFailSoft") &&
  sidepanel.includes("showDirectoryPicker"),
  "default-OFF fail-soft full audit contract missing.");
check(fullAudit.includes("isFullAuditSegmentName") &&
  sidepanel.includes("verifyFullAuditDirectoryWrite") &&
  sidepanel.includes("FULL_AUDIT_WRITE_READBACK_MISMATCH") &&
  sidepanel.includes("eicAutonomAgent.fullAuditSink.v1") &&
  !sidepanel.includes("FULL_AUDIT_DIRECTORY_MUST_BE_EXISTING_TEMP_FOLDER"),
  "v0.10.10 audit permission/write-readback/retention contract missing.");
check(background.includes("sessionContextInitBlocksWork") &&
  background.includes("SESSION_CONTEXT_BASELINE_REQUEST") &&
  background.includes("startMissionAfterSessionInit") &&
  background.includes("launchDeferredMission"),
  "manual/autostart session-context gate integration missing.");
check(content.includes("eic-autonom-agent-process-overlay") &&
  content.includes("data-eic-own-ui") &&
  content.includes("sessionStorage"),
  "ChatGPT process overlay contract missing.");
check(sidepanel.includes("HOST_STREAM_STALLED") &&
  sidepanel.includes("NANO_STREAM_IDLE_TIMEOUT_MS"),
  "bounded Nano stream idle watchdog missing.");
check(mainTaskGuard.includes('MAIN_TASK_BASELINE_SCHEMA = "eic.main-task-baseline.v1"') &&
  mainTaskGuard.includes("MAIN_TASK_BASELINE_REQUEST_PROMPT") &&
  mainTaskGuard.includes("JUSTIFIED_DETOUR") &&
  mainTaskGuard.includes("eightyTwenty") &&
  mainTaskGuard.includes("globalSkills") &&
  nano.includes("NANO DECISION REQUEST v12") &&
  nano.includes("trackControl") &&
  background.includes("armMainTaskBaselineRequest") &&
  background.includes("mainTaskBaselinePresent"),
  "v0.10.10 Nano main-task/80-20/global-skill guard missing.");
check(mjolnar.includes('M2_MANDATE_PROTOCOL = "EIC_M2_MANDATE/1"') &&
  mjolnar.includes("M2_OPERATOR_EQUIVALENT_LEVEL = 9.9999") &&
  mjolnar.includes("actualOperatorApproval: false") &&
  mjolnar.includes("LEVEL_10_REQUIRES_ACTUAL_OPERATOR"),
  "Mjölnar M2 operator-equivalent mandate contract missing.");
check(sessionCapture.includes("reconcileMonotonicCapture") &&
  sessionCapture.includes("DELTA_FROM_STABLE_GAPPED_BASELINE") &&
  sessionCapture.includes("inferTargetProjectBinding") &&
  autoRuntimeGuards.includes("latestMessageHash"),
  "monotonic target-bound Session Capture hardening missing.");
check(missionStateMachine.includes("deriveRunNextAction") &&
  taskIntegrity.includes("OWNER_RECEIPT_REQUIRED"),
  "mission/claim projection hardening missing.");
check(background.includes("lastLeaseUntil = request.claimLeaseUntil") &&
  background.includes("existing?.periodInMinutes") &&
  content.includes("visibilityStateAtStart"),
  "watchdog, Nano lease or prompt-ack timing hardening missing.");

for (const token of [
  "DIRECT_PROGRAM_DELTA_ZERO",
  "REQUIRED_CONTROL_UNLOCKS_DELIVERY",
  "OWNER_LIVE",
  "OWNER_RECEIPT",
  "PROGRAM_DONE",
  "SENSITIVE_TRANSPORT_KEYS",
  "createProgressiveContextRouter",
  "deriveContinuationDeliveryContract",
  "resolveDeliveryRegulatorDisposition",
  "WAIT_FOR_NEW_EVIDENCE",
  "WAITING_OWNER_EVIDENCE",
  "requiresNewResponseIdentity"
]) check(delivery.includes(token), `delivery kernel missing ${token}.`);
check(fallbackPlanner.includes("deriveContinuationDeliveryContract") &&
  fallbackPlanner.includes("const deliveryContract = deriveContinuationDeliveryContract") &&
  fallbackPlanner.includes("...deliveryContract"),
  "deterministic CONTINUE is not delivery-contract complete.");
check(background.includes("evaluateDirectProgramDelta") &&
  background.includes("resolveDeliveryRegulatorDisposition") &&
  background.includes("DELIVERY_REGULATOR_DISPOSITIONS.WAIT_FOR_NEW_EVIDENCE") &&
  background.includes("run.lastProcessedResponseIdentity") &&
  background.includes("run.pendingObservation = null") &&
  background.includes("STATES.WAITING_FOR_RESPONSE") &&
  background.includes("run.timeoutSuspended = true") &&
  background.includes("resolveCompletionState"),
  "delivery/completion lifecycle is not wired into background.");
const deliveryWaitSlice = background.match(
  /const deliveryDisposition = resolveDeliveryRegulatorDisposition[\s\S]*?let autonomy = assessAutonomousDecision/
)?.[0] || "";
check(deliveryWaitSlice &&
  !deliveryWaitSlice.includes("STATES.SOFT_PAUSED") &&
  !deliveryWaitSlice.includes("setTimeout(() => tickWindow"),
  "zero-delta delivery rejection may still self-pause or rearm the same observation.");
check(attentionRouter.includes("DELIVERY_OWNER_WAIT") &&
  attentionRouter.includes("Väntar på extern owner/locator"),
  "owner-evidence wait is not projected to the attention surface.");

// v0.10.11 prompt-critical delivery and initialization liveness gates.
check(background.includes("applyNanoDecisionCommandUnlocked") &&
  background.includes("applyDeterministicDecisionInBand") &&
  !background.includes("scheduleDeterministicDecision"),
  "deterministic decision must be applied in-band, not from a detached callback.");
const inBandBlock = background.match(
  /async function applyDeterministicDecisionInBand\([\s\S]*?\n\}/
)?.[0] || "";
check(Boolean(inBandBlock) &&
  !inBandBlock.includes("setTimeout") &&
  inBandBlock.includes("recordDeterministicDispatchFailureUnlocked"),
  "in-band deterministic application must own its failure instead of detaching it.");
check(background.includes("run.deterministicDispatchFailure = {") &&
  background.includes("mission.deterministic.dispatch-failed") &&
  background.includes("stackDigest"),
  "deterministic dispatch failures must be persisted, audited and application-logged.");
check(background.includes("observationProducedDeliveredTurn") &&
  background.includes("DELIVERED_EFFECT_STATUSES"),
  "delivered-turn invariant for lastProcessed* bookkeeping missing.");
const exhaustedBlock = background.match(
  /const exhaustedObservation = run\.pendingObservation;[\s\S]*?run\.pendingObservation = null;/
)?.[0] || "";
check(exhaustedBlock.includes("if (observationProducedDeliveredTurn(run, exhaustedObservation))"),
  "an undelivered observation must not be recorded as processed.");
check(sessionContextInit.includes("SESSION_CONTEXT_INIT_STALL_LIMIT_MS") &&
  sessionContextInit.includes("evaluateSessionContextInitStall") &&
  sessionContextInit.includes("failSessionContextInit") &&
  sessionContextInit.includes("retrySessionContextInit") &&
  background.includes("applySessionContextInitFailure") &&
  background.includes("evaluateSessionContextInitStall(run.sessionContextInit"),
  "session-context initialization liveness bound or FAILED assignment missing.");
check(background.includes("retrySessionContextInitialization") &&
  /pauseRequiresHuman[\s\S]{0,600}sessionContextInit\?\.state \|\| ""\) === "FAILED"/.test(background) &&
  ui.includes("RETRY_SESSION_CONTEXT_INIT") &&
  sidepanelHtml.includes('id="sessionContextInitFailureCard"') &&
  sidepanelHtml.includes('id="retrySessionContextInitButton"') &&
  sidepanel.includes("renderSessionContextInitFailure") &&
  attentionRouter.includes("SESSION_CONTEXT_INIT_FAILED"),
  "operator route for a failed session-context initialization missing.");
check(packageScript.includes("evaluateReleaseIdentity") &&
  packageScript.includes("RELEASE_IDENTITY_MISMATCH"),
  "the package script must refuse to build a version-inconsistent package.");
check(autostartTransaction.includes("evaluateAutostartPrecondition") &&
  autostartTransaction.includes("AUTOSTART_PRECONDITION_FAILED") &&
  sidepanel.includes("abortNanoHostCreate(AUTOSTART_ABORT_REASON.AUTOSTART_PRECONDITION_FAILED)") &&
  autostartBlock.includes("evaluateAutostartPrecondition") &&
  autostartBlock.indexOf("evaluateAutostartPrecondition") <
    autostartBlock.indexOf("beginNanoCreateFromGestureWithConfig"),
  "Autostart must precheck synchronously and classify its rollback as a precondition failure.");
check(autoRuntimeGuards.includes("autoCaptureDeferDelayMs") &&
  autoRuntimeGuards.includes("AUTO_CAPTURE_DEFER_BACKOFF_MAX_MS") &&
  background.includes("autoCaptureDefers") &&
  background.includes("autoCaptureDeferDelayMs("),
  "bounded backoff for the deferred automatic capture retry chain missing.");
check(!sessionContextInit.includes('progress: "3/5 · Baselinefråga"') &&
  sessionContextInit.includes('progress: "3/6 · Catch mottagen"') &&
  sessionContextInit.includes('progress: "6/6 · Nano"'),
  "initialization overlay phases must be uniquely numbered.");

check(profiles.includes("CURRENT_NANO_MANDATE") && profiles.includes("CURRENT_TARGET_MANDATE"),
  "current mandates missing.");
for (const profileId of [
  "VERIFIED_ANALYSIS",
  "BOUNDED_DELIVERY",
  "STRICT_OPERATIONS_RECOVERY",
  "EXPLORATION_DESIGN"
]) check(profiles.includes(`id: "${profileId}"`), `whole-app profile missing: ${profileId}.`);
check((profiles.match(/id: "(?:VERIFIED_ANALYSIS|BOUNDED_DELIVERY|STRICT_OPERATIONS_RECOVERY|EXPLORATION_DESIGN)"/g) || []).length === 4,
  "whole-app quick-profile registry must contain exactly four profiles.");
check(!profiles.includes("LEGACY_NANO_MANDATE") && !profiles.includes("LEGACY_TARGET_MANDATE"),
  "legacy mandate exports remain.");

for (const name of [
  "docs/V0_9_3_FORWARD_ONLY_POLICY.md",
  "docs/V0_9_3_DELIVERY_CONTEXT_ARCHITECTURE.md",
  "docs/V0_9_11_LANGUAGE_ATTESTATION.md",
  "docs/V0_10_1_ARCHITECTURE.md",
  "docs/CHANGELOG_V0_10_1.md",
  "docs/VERIFICATION_V0_10_1.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_1.md",
  "docs/V0_10_2_ARCHITECTURE.md",
  "docs/CHANGELOG_V0_10_2.md",
  "docs/VERIFICATION_V0_10_2.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_2.md",
  "tests/v0102-ui-hotfix.test.mjs",
  "tests/v010-operator-action.test.mjs",
  "tests/v010-level10-ack.test.mjs",
  "tests/v010-session-capture.test.mjs",
  "tests/v010-session-memory.test.mjs",
  "tests/v010-quick-profiles.test.mjs",
  "tests/v010-session-db.test.mjs",
  "tests/v0101-runtime-fixes.test.mjs",
  "tests/v01011-deterministic-dispatch-liveness.test.mjs",
  "tests/v01011-runtime-integration.test.mjs",
  "tests/helpers/fake-chrome.mjs",
  "tests/helpers/fake-dom.mjs",
  "tests/v01012-release-identity.test.mjs",
  "lib/release-identity.mjs"
]) check(exists(name), `required current-version file missing: ${name}`);

check(/no backward compatibility/i.test(eic), "EIC.md must codify no backward compatibility.");
check(/no backward compatibility/i.test(readme), "README must codify no backward compatibility.");
check(!/aliasZip|unversioned/i.test(packageScript), "package script still creates compatibility alias.");
check(packageScript.includes("CHANGELOG_V0_10_12.md") &&
  packageScript.includes("VERIFICATION_V0_10_12.md") &&
  packageScript.includes("DESKTOP_CHROME_ACCEPTANCE_V0_10_12.md") &&
  packageScript.includes("V0_10_12_ARCHITECTURE.md") &&
  packageScript.includes("V0_10_12_CHANGE_MANIFEST.json") &&
  packageScript.includes("V0_10_12_INCIDENT_ANALYSIS.md") &&
  packageScript.includes("V0_10_6_REMEDIATION_MATRIX.md") &&
  packageScript.includes("V0_9_11_LANGUAGE_ATTESTATION.md"),
  "current release documents missing from package roots.");

const codeFiles = [];
for (const rootName of ["background.js", "content.js", "sidepanel.js", "lib", "scripts", "tests"]) {
  const start = path.join(root, rootName);
  if (!fs.existsSync(start)) continue;
  const walk = (candidate) => {
    const stat = fs.statSync(candidate);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(candidate)) walk(path.join(candidate, entry));
    } else if (/\.(?:js|mjs)$/.test(candidate)) codeFiles.push(candidate);
  };
  walk(start);
}
for (const file of codeFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  check(result.status === 0, `syntax failed: ${path.relative(root, file)} ${result.stderr || ""}`.trim());
}

if (failures.length) {
  console.error("VALIDATE FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`VALIDATE PASS: v${pkg.version} current-only delivery/context contract; ${codeFiles.length}/${codeFiles.length} syntax checks PASS.`);
