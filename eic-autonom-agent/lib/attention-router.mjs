export const ATTENTION_TONE = Object.freeze({
  NONE: "NONE",
  INFO: "INFO",
  WARNING: "WARNING",
  CRITICAL: "CRITICAL"
});

function target({ id, tone, label, detail, view, anchorId, priority }) {
  return Object.freeze({ id, tone, label, detail, view, anchorId, priority });
}

export function deriveAttentionTarget({
  windowContext = {},
  config = {},
  now = Date.now()
} = {}) {
  const run = windowContext.run || null;
  const review = windowContext.coreSurfaceReview || null;
  const approval = windowContext.browserApproval || null;
  const recovery = windowContext.browserRecovery || null;
  const captureGuard = windowContext.autoCaptureGuard || null;
  const nano = windowContext.nanoHostTelemetry || null;

  if (run?.state === "AWAITING_OPERATOR_DECISION" || run?.operatorDecision) {
    return target({
      id: "OPERATOR_DECISION",
      tone: ATTENTION_TONE.CRITICAL,
      label: "Materiellt beslut krävs",
      detail: "Öppna den bundna nivå-10-gränsen och lämna ett exakt beslutskvitto.",
      view: "RUN",
      anchorId: "boundaryAuthorization",
      priority: 100
    });
  }
  if (run?.state === "AWAITING_OPERATOR_ACTION" || run?.operatorAction) {
    return target({
      id: "OPERATOR_ACTION",
      tone: ATTENTION_TONE.WARNING,
      label: "Mekanisk operatörsåtgärd krävs",
      detail: run?.operatorAction?.instruction || "Öppna den väntande operatoråtgärden.",
      view: "RUN",
      anchorId: "operatorActionCard",
      priority: 90
    });
  }
  if (approval?.state === "PENDING") {
    return target({
      id: "BROWSER_APPROVAL",
      tone: ATTENTION_TONE.WARNING,
      label: "Browseråtgärd väntar på beslut",
      detail: approval?.reason || approval?.actionType || "Öppna browsergodkännandet.",
      view: "RUN",
      anchorId: "browserApprovalCard",
      priority: 80
    });
  }
  if (recovery && !["IDLE", "READY"].includes(String(recovery.state || "IDLE"))) {
    return target({
      id: "BROWSER_RECOVERY",
      tone: ATTENTION_TONE.WARNING,
      label: "Browser recovery krävs",
      detail: recovery.reason || "Återbind browserytan och verifiera target.",
      view: "RUN",
      anchorId: "browserRecoveryCard",
      priority: 70
    });
  }
  // v0.10.11: a FAILED initialization is the only phase the operator must act on.
  // v0.10.10 excluded FAILED from routing entirely, which was harmless only
  // because nothing ever assigned that state.
  if (String(run?.sessionContextInit?.state || "") === "FAILED") {
    return target({
      id: "SESSION_CONTEXT_INIT_FAILED",
      tone: ATTENTION_TONE.CRITICAL,
      label: "Baselinefrågan kunde inte levereras",
      detail: run.sessionContextInit.error ||
        "Sessionsinitieringen avbröts innan huvuduppgiftsfrågan skickades. Ingen prompt nådde målsessionen.",
      view: "RUN",
      anchorId: "sessionContextInitFailureCard",
      priority: 95
    });
  }
  if (run?.sessionContextInit &&
      !["READY", "FAILED"].includes(String(run.sessionContextInit.state || ""))) {
    const labels = {
      WAITING_CHAT_READY: "Väntar på initiering av sessionskontext",
      CATCH_ARMED: "Sessions-catch är armerad",
      CATCH_CAPTURED: "Sessions-catch mottagen — kontexten är inte komplett",
      BASELINE_REQUEST_DISPATCHED: "Begär huvuduppgiftsbaslinje",
      WAITING_BASELINE_RESPONSE: "Väntar på huvuduppgiftsbaslinje",
      NANO_ANALYZING: "Nano analyserar sessionskontext"
    };
    return target({
      id: "SESSION_CONTEXT_INIT",
      tone: ATTENTION_TONE.INFO,
      label: labels[run.sessionContextInit.state] || "Initierar sessionskontext",
      detail: "All annan agentbearbetning väntar tills catch, baseline och Nano-spårkontroll är slutförda.",
      view: "RUN",
      anchorId: "statusHeading",
      priority: 68
    });
  }
  if (run?.deliveryWait?.status === "WAITING_OWNER_EVIDENCE") {
    return target({
      id: "DELIVERY_OWNER_WAIT",
      tone: ATTENTION_TONE.INFO,
      label: "Väntar på extern owner/locator",
      detail: run.deliveryWait.omissionFailure ||
        run.deliveryWait.unlocksNextAction ||
        "Delivery regulator väntar på ny route-native ägarevidens eller en ny response identity.",
      view: "RUN",
      anchorId: "statusHeading",
      priority: 65
    });
  }
  if (review?.status === "PROPOSAL_READY" && review?.proposal) {
    const dueAt = Date.parse(String(review.autoApplyAt || ""));
    const remainingMs = Number.isFinite(dueAt) ? Math.max(0, dueAt - now) : null;
    const auto = config.autoApplyCoreSurfaceReviewEnabled !== false && review.autoApplyEnabled;
    return target({
      id: "CORE_SURFACE_REVIEW",
      tone: ATTENTION_TONE.WARNING,
      label: auto ? "Nano-förslag väntar" : "Nano-förslag kräver beslut",
      detail: auto && remainingMs !== null
        ? `Autoappliceras om ${Math.ceil(remainingMs / 1000)} s om du inte accepterar eller nekar.`
        : "Öppna Inställningar för att acceptera, neka eller omvärdera.",
      view: "SETTINGS",
      anchorId: "coreSurfaceReviewCard",
      priority: 60
    });
  }
  if (captureGuard?.status === "FAILED") {
    return target({
      id: "CAPTURE_FAILED",
      tone: ATTENTION_TONE.WARNING,
      label: "Session Capture misslyckades",
      detail: captureGuard.error || "Öppna Session Capture för detaljer och manuell retry.",
      view: "SETTINGS",
      anchorId: "sessionContextCard",
      priority: 50
    });
  }
  if (nano?.stale === true) {
    return target({
      id: "NANO_STALE",
      tone: ATTENTION_TONE.INFO,
      label: "Nano behöver återskapas",
      detail: nano.staleDetail || "Öppna Nano-kortet och aktivera modellen igen.",
      view: "RUN",
      anchorId: "nanoHostCard",
      priority: 40
    });
  }
  return target({
    id: "NONE",
    tone: ATTENTION_TONE.NONE,
    label: "Ingen åtgärd krävs",
    detail: "Inga väntande operatorbeslut, Nano-förslag eller recoveryobjekt.",
    view: "RUN",
    anchorId: "",
    priority: 0
  });
}
