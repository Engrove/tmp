import { sanitizeText } from "./common.mjs";
import { PAUSE_ORIGINS } from "./state-machine.mjs";
import {
  NANO_ANALYSIS_MODES,
  deriveObservationAnchors,
  hasGroundedContext
} from "./nano-pipeline.mjs";
import {
  classifyDestructiveness,
  resolveAutonomousPause,
  runHjalmarMentalControl
} from "./destructiveness.mjs";
import { isMetaOnlyAction } from "./decision-grounding.mjs";
import { deriveContinuationDeliveryContract } from "./delivery-kernel.mjs";
import {
  MAIN_TASK_BASELINE_REQUEST_PROMPT,
  MAIN_TASK_TRACK_STATUS,
  MAIN_TASK_RELATION,
  EIGHTY_TWENTY_VERDICT
} from "./main-task-guard.mjs";

function list(values, max = 8, maxLength = 1800) {
  return (Array.isArray(values) ? values : [])
    // v0.6.4: blocker items carry `statement`, so v0.6.3 silently produced an empty
    // blocker list here and the planner's blocker context was always missing.
    .map((value) => sanitizeText(
      typeof value === "string" ? value : value?.text || value?.claim || value?.statement,
      maxLength
    ))
    .filter(Boolean)
    .slice(0, max);
}


function uniqueText(values, max = 12, maxLength = 1800) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = sanitizeText(typeof value === "string" ? value : value?.text || value?.claim, maxLength);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= max) break;
  }
  return result;
}

/**
 * Deterministic sources may repair their own locally-authored decision exactly once.
 * This is not a model retry. It turns an otherwise meta-only continuation into an
 * exact owner-read/reconcile instruction with an observable output. Target text
 * remains continuation data and never becomes verified owner evidence.
 */
export function repairDeterministicDecision(decisionValue = {}, {
  run = {},
  observation = {},
  continuityProjection = {},
  validationErrors = []
} = {}) {
  const decision = { ...decisionValue };
  const action = String(decision.action || "").toUpperCase();
  const targetResult = observation?.targetResult || {};
  const requested = sanitizeText(decision.requestedAction || targetResult.next, 5000);

  if (action !== "CONTINUE" || !requested) {
    return { decision, repaired: false, reason: "NOT_REPAIRABLE_CONTINUE" };
  }

  const exactTarget = sanitizeText(
    decision.exactTarget ||
    `tab:${run?.targetTabId || "UNKNOWN"}|conversation:${run?.conversationKey || "UNKNOWN"}`,
    1600
  );
  const ownerRoute = sanitizeText(
    decision.ownerRoute ||
    (targetResult?.valid
      ? "TARGET_RESPONSE_PROTOCOL_AND_EIC_STATE_MACHINE"
      : "EIC_STATE_MACHINE"),
    1200
  );

  const needsActionRepair = isMetaOnlyAction(requested);
  const needsContextRepair = validationErrors.includes("UNGROUNDED_CONTINUATION") ||
    validationErrors.includes("TAKEOVER_CONTEXT_EMPTY");
  if (!needsActionRepair && !needsContextRepair) {
    return { decision, repaired: false, reason: "NO_DETERMINISTIC_REPAIR_NEEDED" };
  }

  if (needsActionRepair) {
    decision.requestedAction = sanitizeText(
      `Anropa den exakta ägarrutten ${ownerRoute} för målet ${exactTarget}; ` +
      `genomför endast den avgränsade owner-read/reconcile-effekten och returnera locator, ` +
      `observerat resultat, förändringsdelta och nästa bounded steg. Fortsätt därefter med: ${requested}`,
      5000
    );
  } else {
    decision.requestedAction = requested;
  }

  decision.workUnit = sanitizeText(
    decision.workUnit ||
    continuityProjection?.position?.workUnit ||
    targetResult.next ||
    "Deterministisk continuation recovery",
    2400
  );
  decision.intent = sanitizeText(
    decision.intent || decision.taskIntent || continuityProjection?.intent || "Fortsätt den aktiva EIC-uppgiften.",
    6000
  );
  decision.taskIntent = decision.intent;
  decision.contextEvidence = uniqueText([
    ...(decision.contextEvidence || decision.evidenceAnchors || []),
    targetResult?.valid
      ? `Turn-bundet målprotokoll: status=${String(targetResult.status || "UNKNOWN")}; turn=${String(targetResult.turnId || "NONE")}`
      : "",
    requested ? `Målsessionens continuation-data: ${requested}` : "",
    // v0.7.0: anchors observed by the local controller, not authored by any model.
    ...deriveObservationAnchors(observation, { max: 4 })
  ], 8);
  decision.evidenceAnchors = decision.contextEvidence;
  decision.targetClaims = uniqueText([
    ...(decision.targetClaims || []),
    requested ? `Målsessionen föreslog: ${requested}` : ""
  ], 8);
  decision.requiredEvidence = uniqueText([
    ...(decision.requiredEvidence || []),
    `Owner-readback via ${ownerRoute} för ${exactTarget} med exakt locator, observerat resultat och förändringsdelta.`
  ], 8);
  decision.reason = sanitizeText(
    `${decision.reason || "Deterministisk recovery."} Lokal deterministic repair applicerades utan ny behörighet.`,
    1600
  );
  decision.deterministicRepair = {
    code: needsActionRepair ? "META_ONLY_TO_OWNER_READ" : "GROUNDING_CONTEXT_REPAIR",
    validationErrors: uniqueText(validationErrors, 8, 160),
    exactTarget,
    ownerRoute
  };
  Object.assign(decision, deriveContinuationDeliveryContract({
    requestedAction: decision.requestedAction,
    targetStatus: "CONTINUE",
    controlVerdict: needsActionRepair ? "READ_REQUIRED" : "NOT_REQUIRED",
    exactTarget,
    ownerRoute
  }));
  return {
    decision,
    repaired: true,
    reason: decision.deterministicRepair.code
  };
}

/**
 * Produces a bounded deterministic decision when the local LanguageModel host
 * is unavailable. It never promotes target text to verified facts and never
 * bypasses a hard boundary. The result is intentionally conservative but
 * remains productive in Max Autonomous Mode.
 */
export function buildDeterministicDecision({
  run,
  observation,
  continuityProjection = {},
  maxAutonomousMode = false,
  requestMode = NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS
} = {}) {
  const targetResult = observation?.targetResult || {};
  const recoveryReason = sanitizeText(
    run?.pendingNanoRequest?.recoveryReason || run?.nanoTelemetry?.lastError || "",
    1600
  );
  const nextDirections = list(continuityProjection?.nextDirections)
    .filter((value) => !/^required\s+evidence\s*:/i.test(value));
  const evidenceRequirements = list(continuityProjection?.evidenceRequirements);
  const activeBlockers = list(continuityProjection?.blockers);
  const inferredWorkUnit = sanitizeText(
    continuityProjection?.position?.workUnit ||
    targetResult.next ||
    "Fortsätt den aktiva arbetsenheten.",
    3000
  );

  if (observation?.mainTaskBaselineRequired === true) {
    const anchors = deriveObservationAnchors(observation, { max: 6 });
    const exactTarget = sanitizeText(
      `tab:${run?.targetTabId || "UNKNOWN"}|conversation:${run?.conversationKey || "UNKNOWN"}`,
      1600
    );
    return {
      analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
      intent: "Initiera den kopplade sessionens huvuduppgiftskontext före vanlig agentbearbetning.",
      taskIntent: "Initiera den kopplade sessionens huvuduppgiftskontext före vanlig agentbearbetning.",
      action: "CONTINUE",
      progressDelta: 0,
      directProgramDelta: 0,
      requiredControl: true,
      omissionFailure: "Utan ett strukturerat eic.main-task-baseline.v1-svar saknar Nano stabilt huvudmål, 80/20-prioritet och live global-skill-routingkontext.",
      unlocksNextAction: "Analysera det returnerade eic.main-task-baseline.v1-svaret med Nano och slutför sessionsinitieringen.",
      boundedStop: false,
      deliveryClass: "REQUIRED_SESSION_CONTEXT_CONTROL",
      reason: "Den första sessionsåtgärden är en deterministisk huvuduppgiftsfråga. Nano får inte författa eller ersätta denna prompt.",
      workUnit: "Hämta fullständig huvuduppgiftsbaslinje för den aktuella ChatGPT-sessionen.",
      workUnitSource: "deterministic-session-context-init",
      requestedAction: MAIN_TASK_BASELINE_REQUEST_PROMPT,
      requiredEvidence: [
        "Ett komplett JSON-objekt enligt eic.main-task-baseline.v1 följt av EIC-AA/5.",
        "Aktiva och nödvändiga global skills hämtade från live global.get/global.skill.payload.get."
      ],
      verifiedFacts: [],
      targetClaims: anchors.map((anchor) => `Målsessionen visade före initiering: ${anchor}`),
      inferences: [
        "Sessionskontexten saknar ännu en validerad huvuduppgiftsbaslinje; all vanlig agentbearbetning är spärrad."
      ],
      evidenceAnchors: anchors.length ? anchors : ["Sessions-catch har fångat ett stabilt assistantsvar."],
      contextEvidence: anchors.length ? anchors : ["Sessions-catch har fångat ett stabilt assistantsvar."],
      attempts: [],
      blockers: [],
      carriedBlockers: activeBlockers,
      alternatives: [],
      continueCriteria: [
        "Ett komplett eic.main-task-baseline.v1-svar har observerats och validerats."
      ],
      stopCriteria: [
        "Ett validerat eic.main-task-baseline.v1-svar finns för den aktuella sessionen.",
        "Operatören stoppar initieringen."
      ],
      completionEvidence: "",
      completionConfirmed: false,
      pauseOrigin: PAUSE_ORIGINS.NONE,
      boundaryEvidence: "",
      unlockEvent: "Ett komplett validerat eic.main-task-baseline.v1-svar observeras.",
      destructivenessLevel: 1,
      destructivenessRationale: "Deterministisk promptleverans utan extern effekt.",
      exactTarget,
      ownerRoute: "CHATGPT_SESSION_CONTEXT",
      rollbackPath: "NOT_REQUIRED_TRANSIENT",
      readbackPlan: "OBSERVE_EXACT_BASELINE_RESPONSE_IDENTITY",
      materialAmbiguity: "NONE",
      trackControl: {
        schema: "eic.main-task-track.v1",
        version: 1,
        status: MAIN_TASK_TRACK_STATUS.BASELINE_REQUESTED,
        baselinePresent: false,
        currentActionRelation: MAIN_TASK_RELATION.UNKNOWN,
        eightyTwentyVerdict: EIGHTY_TWENTY_VERDICT.UNKNOWN,
        activeGlobalSkills: [],
        requiredGlobalSkills: [],
        skillGaps: [],
        detourReason: "",
        returnCondition: "",
        correctionPrompt: MAIN_TASK_BASELINE_REQUEST_PROMPT,
        updatedAt: null
      }
    };
  }

  const takeoverUngrounded = requestMode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP &&
    !hasGroundedContext(continuityProjection);
  if (takeoverUngrounded) {
    // v0.6.9 returned this PAUSE with empty intent, workUnit and context arrays. The
    // consumer gate in `applyNanoDecisionCommand()` then rejected the addon's own
    // decision with TASK_INTENT_EMPTY, WORK_UNIT_EMPTY, TAKEOVER_CONTEXT_EMPTY, and
    // `repairDeterministicDecision()` declined it as NOT_REPAIRABLE_CONTINUE. The run
    // died in RECOVERING behind an unreachable resume plan. The PAUSE is now a
    // well-formed local statement of the exact blocker. It still authors no target
    // prompt: `requestedAction` stays empty and the action stays PAUSE.
    const anchors = deriveObservationAnchors(observation, { max: 6 });
    return {
      analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
      intent: sanitizeText(
        continuityProjection?.intent ||
        "Grunda övertagandet av den kopplade målsessionen innan någon målprompt författas.",
        6000
      ),
      action: "PAUSE",
      progressDelta: 0,
      reason: recoveryReason
        ? `Nano-host saknas eller misslyckades för första takeover-analysen: ${recoveryReason}. Addonet skickar ingen generisk eller ogrundad målprompt.`
        : "Nano-host saknas för första takeover-analysen. Addonet skickar ingen generisk eller ogrundad målprompt.",
      workUnit: sanitizeText(
        continuityProjection?.position?.workUnit ||
        "Etablera takeover-grundning (intent, arbetsenhet, kontextankare) via lokal Nano.",
        2400
      ),
      workUnitSource: "deterministic-takeover-recovery",
      requestedAction: "",
      requiredEvidence: ["En claimad, grounding-validerad Nano-takeoveranalys för exakt samma bevarade observation."],
      verifiedFacts: [],
      targetClaims: anchors.map((anchor) => `Målsessionen visade: ${anchor}`),
      inferences: ["Takeover-grundning saknas lokalt; målsessionens text får inte författa nästa instruktion."],
      evidenceAnchors: anchors,
      contextEvidence: anchors,
      attempts: [{
        action: "Vänta på lokal Nano-takeover",
        outcome: recoveryReason ? "recovery" : "timeout",
        reason: recoveryReason || "Ingen claimad Nano-analys fanns före claim-deadline."
      }],
      // v0.6.4: a deterministic planner echoing the projection's open blockers back
      // into every decision re-asserted them forever, so a blocker could never go
      // stale or be closed. They are carried as read-only context instead.
      blockers: [],
      carriedBlockers: activeBlockers,
      alternatives: [
        "Återskapa den lokala Nano-bassessionen och återköa exakt samma bevarade observation.",
        "Kör om takeover-analysen med en isolerad task-session och bunden outputstorlek."
      ],
      continueCriteria: ["En grounding-validerad Nano-takeoveranalys finns för den bevarade observationen."],
      stopCriteria: ["En grounding-validerad Nano-baslinje finns för den bevarade observationen.", "Operatören stoppar körningen."],
      completionEvidence: "",
      completionConfirmed: false,
      pauseOrigin: PAUSE_ORIGINS.NANO_HOST_REQUIRED,
      boundaryEvidence: "Takeover-kontext saknar ännu lokal Nano-grundning.",
      unlockEvent: "Aktivera Chrome on-device LanguageModel och återuppta.",
      destructivenessLevel: 3,
      destructivenessRationale: "Lokal Nano-host/recovery är en reversibel runtimeåtgärd.",
      exactTarget: `tab:${run?.targetTabId || "UNKNOWN"}|conversation:${run?.conversationKey || "UNKNOWN"}`,
      ownerRoute: "LOCAL_NANO_HOST",
      rollbackPath: "NOT_REQUIRED_TRANSIENT",
      readbackPlan: "RETRY_SAME_PRESERVED_OBSERVATION",
      materialAmbiguity: "NONE"
    };
  }

  if (targetResult.valid && targetResult.status === "CONTINUE" && targetResult.next) {
    const exactTarget = sanitizeText(
      `tab:${run?.targetTabId || "UNKNOWN"}|conversation:${run?.conversationKey || "UNKNOWN"}`,
      1600
    );
    const ownerRoute = "TARGET_RESPONSE_PROTOCOL_AND_EIC_STATE_MACHINE";
    // v0.6.4: v0.6.3 always reused the stored work unit, so `position.workUnit`
    // froze at the takeover value while later turns had long since moved on. A
    // concrete turn-bound EIC_NEXT is the target's own bounded work unit. It is
    // adopted as the position only; it stays a target claim and never becomes an
    // owner-verified fact.
    const targetWorkUnit = !isMetaOnlyAction(targetResult.next)
      ? sanitizeText(targetResult.next, 2400)
      : "";
    const assessment = classifyDestructiveness({
      proposedAction: targetResult.next,
      requestedAction: targetResult.next,
      exactTarget,
      ownerSurface: ownerRoute
    });
    const control = runHjalmarMentalControl({
      assessment,
      exactTarget,
      ownerRoute,
      mandate: "EIC_AUTONOMY_CONTINUE_AND_EIC_NEXT",
      rollbackPath: assessment.level <= 5 ? "NOT_REQUIRED_OR_TRANSIENT" : "ROLLBACK_REQUIRED_BEFORE_EFFECT",
      readbackPlan: "RE_READ_EXACT_OWNER_STATE_AFTER_EFFECT",
      materialAmbiguity: assessment.level <= 5 ? "NONE" : "UNKNOWN"
    });
    const disposition = resolveAutonomousPause({
      decision: { requestedAction: targetResult.next, alternatives: nextDirections },
      targetResult,
      assessment,
      control
    });
    const deliveryContract = deriveContinuationDeliveryContract({
      requestedAction: disposition.requestedAction,
      targetStatus: targetResult.status,
      controlVerdict: control.verdict,
      exactTarget,
      ownerRoute
    });
    return {
      ...deliveryContract,
      analysisMode: requestMode,
      intent: sanitizeText(continuityProjection?.intent, 6000),
      action: disposition.action,
      progressDelta: 0,
      reason: recoveryReason
        ? `Deterministisk recovery återställde ett komplett turn-bundet EIC_AUTONOMY: CONTINUE + EIC_NEXT efter lokal Nano-avvikelse: ${recoveryReason}`
        : "Deterministisk v0.6.4-policy accepterade ett komplett turn-bundet EIC_AUTONOMY: CONTINUE + EIC_NEXT och klassificerade effekten lokalt.",
      workUnit: targetWorkUnit || inferredWorkUnit,
      workUnitSource: targetWorkUnit ? "target-eic-next-claim" : "continuity-position",
      requestedAction: disposition.requestedAction,
      requiredEvidence: uniqueText([
        ...evidenceRequirements,
        ...(control.verdict === "READ_REQUIRED"
          ? ["Färsk owner-read för exakt mål, mandat, rollback och readback före effekt."]
          : [])
      ], 8),
      verifiedFacts: [],
      targetClaims: [`Målsessionen föreslog: ${sanitizeText(targetResult.next, 1600)}`],
      inferences: ["EIC_NEXT behandlas som mål-sessionens continuation-data, inte som owner-bevis."],
      evidenceAnchors: [`EIC_NEXT: ${sanitizeText(targetResult.next, 1200)}`],
      attempts: [],
      // v0.6.4: a deterministic planner echoing the projection's open blockers back
      // into every decision re-asserted them forever, so a blocker could never go
      // stale or be closed. They are carried as read-only context instead.
      blockers: [],
      carriedBlockers: activeBlockers,
      alternatives: nextDirections,
      continueCriteria: ["Lokal riskklassificering är under nivå 10."],
      stopCriteria: ["Endast deterministisk nivå 10 eller direkt operatörsstopp ger verklig PAUS."],
      completionEvidence: "",
      completionConfirmed: false,
      pauseOrigin: PAUSE_ORIGINS.NONE,
      boundaryEvidence: "",
      unlockEvent: "",
      destructivenessLevel: assessment.level,
      destructivenessRationale: assessment.rationale,
      exactTarget,
      ownerRoute,
      rollbackPath: assessment.level <= 5 ? "NOT_REQUIRED_OR_TRANSIENT" : "ROLLBACK_REQUIRED_BEFORE_EFFECT",
      readbackPlan: "RE_READ_EXACT_OWNER_STATE_AFTER_EFFECT",
      materialAmbiguity: assessment.level <= 5 ? "NONE" : "UNKNOWN",
      hjalmarMentalControl: control.verdict
    };
  }

  if (targetResult.valid && targetResult.status === "USER_PAUSE" && targetResult.next) {
    const exactTarget = sanitizeText(
      `tab:${run?.targetTabId || "UNKNOWN"}|conversation:${run?.conversationKey || "UNKNOWN"}`,
      1600
    );
    return {
      analysisMode: requestMode,
      intent: sanitizeText(continuityProjection?.intent, 6000),
      action: "PAUSE",
      progressDelta: 0,
      reason: "Turn-bunden USER_PAUSE är ett explicit nivå-10-operatörsval och får inte omvandlas till autonom fortsättning.",
      workUnit: inferredWorkUnit,
      requestedAction: sanitizeText(targetResult.next, 5000),
      requiredEvidence: ["Lokalt operatörsbeslut för exakt mål, alternativ och konsekvens."],
      verifiedFacts: [],
      targetClaims: [`Målsessionen begärde USER_PAUSE: ${sanitizeText(targetResult.next, 1600)}`],
      inferences: ["USER_PAUSE är målsessionens begäran; auktorisering måste ske i den lokala panelen."],
      evidenceAnchors: [`EIC_AUTONOMY: USER_PAUSE`, `EIC_NEXT: ${sanitizeText(targetResult.next, 1200)}`],
      attempts: [],
      blockers: [],
      carriedBlockers: activeBlockers,
      alternatives: [],
      continueCriteria: ["Operatören har gjort och lokalt motiverat det exakta nivå-10-valet."],
      stopCriteria: ["USER_PAUSE förblir strikt tills lokal operatorauktorisering eller Stop."],
      completionEvidence: "",
      completionConfirmed: false,
      pauseOrigin: PAUSE_ORIGINS.USER_PAUSE,
      boundaryEvidence: sanitizeText(targetResult.next, 1600),
      unlockEvent: sanitizeText(targetResult.next, 1600),
      destructivenessLevel: 10,
      destructivenessRationale: "EIC_AUTONOMY: USER_PAUSE",
      exactTarget,
      ownerRoute: "TARGET_RESPONSE_PROTOCOL_AND_LOCAL_OPERATOR_PANEL",
      rollbackPath: "OPERATOR_DECISION_REQUIRED",
      readbackPlan: "RE_READ_EXACT_OWNER_STATE_AFTER_OPERATOR_DECISION",
      materialAmbiguity: "PRESENT",
      hjalmarMentalControl: "HUMAN_REQUIRED"
    };
  }

  if (targetResult.valid && targetResult.status === "PAUSE" && targetResult.next) {
    const exactTarget = sanitizeText(
      `tab:${run?.targetTabId || "UNKNOWN"}|conversation:${run?.conversationKey || "UNKNOWN"}`,
      1600
    );
    const ownerRoute = "TARGET_RESPONSE_PROTOCOL_AND_EIC_STATE_MACHINE";
    const assessment = classifyDestructiveness({
      proposedAction: targetResult.next,
      requestedAction: targetResult.next,
      exactTarget,
      ownerSurface: ownerRoute,
      pauseOrigin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE
    });
    const control = runHjalmarMentalControl({
      assessment,
      exactTarget,
      ownerRoute,
      mandate: "EIC_AUTONOMY_PAUSE_AND_UNLOCK_ACTION",
      rollbackPath: assessment.level <= 5 ? "NOT_REQUIRED_OR_TRANSIENT" : "ROLLBACK_REQUIRED_BEFORE_EFFECT",
      readbackPlan: "RE_READ_EXACT_OWNER_STATE_AFTER_EFFECT",
      materialAmbiguity: assessment.level <= 5 ? "NONE" : "UNKNOWN"
    });
    return {
      analysisMode: requestMode,
      intent: sanitizeText(continuityProjection?.intent, 6000),
      action: "PAUSE",
      progressDelta: 0,
      reason: assessment.humanDecisionRequired
        ? "Turn-bunden PAUS klassificerades deterministiskt som nivå 10."
        : "Turn-bunden PAUS klassificerades under nivå 10 och ska omvandlas till autonom CONTINUE.",
      workUnit: inferredWorkUnit,
      requestedAction: sanitizeText(targetResult.next, 5000),
      requiredEvidence: control.verdict === "READ_REQUIRED"
        ? ["Färsk owner-read för exakt mål, mandat, rollback och readback före effekt."]
        : [],
      verifiedFacts: [],
      targetClaims: [`Målsessionen begärde PAUS med unlock: ${sanitizeText(targetResult.next, 1600)}`],
      inferences: ["PAUS är mål-sessionens continuation-data; endast lokal nivå-10-klassificering får skapa verklig mänsklig paus."],
      evidenceAnchors: [`EIC_NEXT: ${sanitizeText(targetResult.next, 1200)}`],
      attempts: [],
      // v0.6.4: a deterministic planner echoing the projection's open blockers back
      // into every decision re-asserted them forever, so a blocker could never go
      // stale or be closed. They are carried as read-only context instead.
      blockers: [],
      carriedBlockers: activeBlockers,
      alternatives: nextDirections,
      continueCriteria: ["Nivå 1–9 fortsätter autonomt efter eventuell lokal Hjalmar-kontroll."],
      stopCriteria: ["Endast deterministisk nivå 10 eller direkt operatörsstopp ger verklig PAUS."],
      completionEvidence: "",
      completionConfirmed: false,
      pauseOrigin: PAUSE_ORIGINS.OPERATOR_PROXY_CANDIDATE,
      boundaryEvidence: assessment.humanDecisionRequired ? sanitizeText(targetResult.next, 1600) : "",
      unlockEvent: sanitizeText(targetResult.next, 1600),
      destructivenessLevel: assessment.level,
      destructivenessRationale: assessment.rationale,
      exactTarget,
      ownerRoute,
      rollbackPath: assessment.level <= 5 ? "NOT_REQUIRED_OR_TRANSIENT" : "ROLLBACK_REQUIRED_BEFORE_EFFECT",
      readbackPlan: "RE_READ_EXACT_OWNER_STATE_AFTER_EFFECT",
      materialAmbiguity: assessment.level <= 5 ? "NONE" : "UNKNOWN",
      hjalmarMentalControl: control.verdict
    };
  }

  if (targetResult.valid && targetResult.status === "DONE" && targetResult.completionEvidence) {
    return {
      analysisMode: requestMode,
      intent: sanitizeText(continuityProjection?.intent, 6000),
      action: "DONE",
      progressDelta: 1,
      reason: "Målsessionen svarade med ett unikt, turn-bundet DONE och konkret completion evidence för aktuell tur.",
      workUnit: inferredWorkUnit,
      requestedAction: "",
      requiredEvidence: [],
      verifiedFacts: [],
      targetClaims: [
        "Målsessionen deklarerade turn-bundet DONE.",
        `Målsessionens completion evidence: ${sanitizeText(targetResult.completionEvidence, 1600)}`
      ],
      inferences: ["Addonet avslutar endast sin egen run; detta är inte bevis för extern installation, deployment eller owner-route-effekt."],
      evidenceAnchors: [`EIC_COMPLETION_EVIDENCE: ${sanitizeText(targetResult.completionEvidence, 1200)}`],
      attempts: [],
      blockers: [],
      alternatives: [],
      continueCriteria: [],
      stopCriteria: ["Målsessionens aktuella turn är färdig med angiven completion evidence."],
      completionEvidence: sanitizeText(targetResult.completionEvidence, 1600),
      completionConfirmed: true,
      pauseOrigin: PAUSE_ORIGINS.NONE,
      boundaryEvidence: "",
      unlockEvent: "",
      destructivenessLevel: 1,
      destructivenessRationale: "Att avsluta den lokala runnen efter turn-bundet DONE har ingen extern destruktiv effekt.",
      exactTarget: `tab:${run?.targetTabId || "UNKNOWN"}|conversation:${run?.conversationKey || "UNKNOWN"}`,
      ownerRoute: "TARGET_RESPONSE_PROTOCOL_AND_EIC_STATE_MACHINE",
      rollbackPath: "REOPEN_LOCAL_RUN_FROM_DURABLE_CONTINUITY",
      readbackPlan: "READ_LOCAL_RUN_STATE",
      materialAmbiguity: "NONE"
    };
  }

  const alternatives = [
    ...nextDirections,
    "Aktivera eller återskapa den lokala Nano-sessionen.",
    "Återuppta den bevarade observationen genom en ny exakt Nano-claim."
  ].filter((value, index, all) => value && all.indexOf(value) === index).slice(0, 8);

  return {
    analysisMode: requestMode,
    intent: sanitizeText(continuityProjection?.intent, 6000),
    action: "PAUSE",
    progressDelta: 0,
    reason: recoveryReason
      ? `Deterministic fallback aktiverades efter lokal Nano-avvikelse: ${recoveryReason}. Utan ett unikt turn-bundet EIC_NEXT eller DONE får fallback inte skapa ett semantiskt nästa steg.`
      : "Nano-modellhostet svarade inte inom claim-deadline. Utan ett unikt turn-bundet EIC_NEXT eller DONE får deterministic fallback inte skapa ett semantiskt nästa steg.",
    workUnit: inferredWorkUnit,
    requestedAction: "",
    requiredEvidence: [],
    verifiedFacts: [],
    targetClaims: [],
    inferences: [recoveryReason
      ? `Lokal Nano-avvikelse: ${recoveryReason}`
      : "Det lokala språkmodellshostet var inte tillgängligt inom beslutsgraceperioden."],
    evidenceAnchors: [],
    attempts: [{
      action: recoveryReason ? "Deterministisk återhämtning efter Nano-avvikelse" : "Vänta på lokal Nano-modell",
      outcome: recoveryReason ? "recovery" : "timeout",
      reason: recoveryReason || "Ingen claimad Nano-output inom graceperioden."
    }],
    blockers: [],
    carriedBlockers: activeBlockers,
    alternatives,
    continueCriteria: [],
    stopCriteria: ["En terminal Nano-analys eller en verifierad ny owner-observation finns.", "Operatören stoppar körningen."],
    completionEvidence: "",
    completionConfirmed: false,
    pauseOrigin: PAUSE_ORIGINS.NANO_HOST_REQUIRED,
    boundaryEvidence: "Semantisk continuation saknar verifierad Nano-output.",
    unlockEvent: "Aktivera eller återskapa Chrome on-device LanguageModel; owner-state återköar samma observation.",
    destructivenessLevel: 3,
    destructivenessRationale: "Nano-host-recovery är en lokal reversibel runtimeåtgärd.",
    exactTarget: `tab:${run?.targetTabId || "UNKNOWN"}|conversation:${run?.conversationKey || "UNKNOWN"}`,
    ownerRoute: "LOCAL_NANO_HOST",
    rollbackPath: "NOT_REQUIRED_TRANSIENT",
    readbackPlan: "RETRY_SAME_PRESERVED_OBSERVATION",
    materialAmbiguity: "NONE"
  };
}
