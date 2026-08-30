import { nullableInteger } from "./common.mjs";
export const AUTOSTART_CONFIRMATION_TTL_MS = 30_000;

function normalizePresetId(value) {
  const id = String(value || "").trim();
  if (!id) throw new Error("AUTOSTART_PRESET_ID_REQUIRED");
  return id;
}

export function evaluateAutostartConfirmation({
  presetId,
  requiresConfirmation = false,
  pending = null,
  now = Date.now(),
  ttlMs = AUTOSTART_CONFIRMATION_TTL_MS
} = {}) {
  const id = normalizePresetId(presetId);
  const timestamp = Number(now);
  const boundedTtl = Math.max(1_000, Number(ttlMs) || AUTOSTART_CONFIRMATION_TTL_MS);

  if (!requiresConfirmation) {
    return {
      confirmed: true,
      reason: "NOT_REQUIRED",
      pending: null
    };
  }

  const expiresAt = Number(pending?.expiresAt);
  const matching = String(pending?.presetId || "") === id;
  if (matching && Number.isFinite(expiresAt) && expiresAt >= timestamp) {
    return {
      confirmed: true,
      reason: "SECOND_EXPLICIT_CLICK",
      pending: null
    };
  }

  return {
    confirmed: false,
    reason: matching && Number.isFinite(expiresAt) && expiresAt < timestamp
      ? "EXPIRED_REARMED"
      : "ARMED",
    pending: {
      schema: "eic.autonom.autostart-confirmation.v1",
      version: 1,
      presetId: id,
      armedAt: timestamp,
      expiresAt: timestamp + boundedTtl
    }
  };
}

export function autostartActivationOutcome(promise) {
  return Promise.resolve(promise).then(
    (session) => ({ ok: true, session, error: null }),
    (error) => ({ ok: false, session: null, error })
  );
}

export const AUTOSTART_ABORT_REASON = Object.freeze({
  /** The operator pressed the activation control again to cancel. */
  OPERATOR_ABORT: "OPERATOR_ABORT",
  /** A precondition of the Autostart transaction failed after activation began. */
  AUTOSTART_PRECONDITION_FAILED: "AUTOSTART_PRECONDITION_FAILED"
});

/**
 * v0.10.12: a **synchronous** precondition check, safe to call inside the
 * operator gesture before `LanguageModel.create()`.
 *
 * The v0.9.11 activation law requires create() to run in the click before any
 * await, so the bridge handshake — which needs a message round trip — cannot
 * precede it. When the Autostart plan itself owns LINK_ACTIVE_TAB, cached
 * selected-tab state is deliberately not treated as authoritative: the active
 * tab is bound and verified after create(). For flows that do not own linking,
 * the cached selected-tab/host checks remain fail-closed.
 *
 * The genuinely asynchronous preconditions (active-tab binding readback and the
 * content-bridge version handshake) still run after create(); when they fail,
 * rollback is classified as AUTOSTART_PRECONDITION_FAILED rather than an
 * operator abort.
 */
export function evaluateAutostartPrecondition(windowContext = {}, {
  supportedHosts = ["chatgpt.com", "chat.openai.com"],
  linkActiveTab = false
} = {}) {
  if (linkActiveTab === true) {
    return {
      ok: true,
      code: "",
      reason: "ACTIVE_TAB_BIND_PENDING",
      detail: "Autostart kopplar och verifierar den aktiva ChatGPT-fliken efter den användargesterade modellstarten."
    };
  }

  const selectedTabId = nullableInteger(windowContext?.selectedTabId);
  if (selectedTabId === null) {
    return {
      ok: false,
      code: "AUTOSTART_PRECONDITION_FAILED",
      reason: "NO_SELECTED_TAB",
      detail: "Ingen ChatGPT-flik är vald. Välj och koppla målfliken innan Autostart."
    };
  }
  const linked = windowContext?.linkedTabs?.[String(selectedTabId)] || null;
  const url = String(linked?.url || "");
  if (!url) {
    return {
      ok: true,
      code: "",
      reason: "TAB_URL_UNKNOWN",
      detail: "Flikens URL är ännu inte känd; kontrollen görs i stället efter readback."
    };
  }
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = "";
  }
  if (hostname && !supportedHosts.includes(hostname)) {
    return {
      ok: false,
      code: "AUTOSTART_PRECONDITION_FAILED",
      reason: "UNSUPPORTED_TARGET_HOST",
      detail: `Vald flik är ${hostname}, inte en ChatGPT-session. Autostart avbröts före modellaktivering.`
    };
  }
  return { ok: true, code: "", reason: "PRECONDITION_SATISFIED", detail: "" };
}

export function assertAutostartTabBinding(windowContext = {}) {
  const selectedTabId = nullableInteger(windowContext?.selectedTabId);
  const linked = selectedTabId !== null
    ? windowContext?.linkedTabs?.[String(selectedTabId)]
    : null;
  const controller = windowContext?.surfacePair?.surfaces?.CHATGPT_CONTROLLER || null;

  if (selectedTabId === null || !linked) {
    throw new Error("AUTOSTART_TAB_BINDING_READBACK_FAILED: ingen vald kopplad ChatGPT-flik.");
  }
  if (nullableInteger(controller?.tabId) !== selectedTabId) {
    throw new Error("AUTOSTART_CONTROLLER_BINDING_READBACK_FAILED: controller-ytan matchar inte vald ChatGPT-flik.");
  }
  return {
    selectedTabId,
    conversationKey: String(linked.conversationKey || ""),
    controllerLifecycleState: String(controller.lifecycleState || "")
  };
}
