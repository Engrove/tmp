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

export function assertAutostartTabBinding(windowContext = {}) {
  const selectedTabId = Number(windowContext?.selectedTabId);
  const linked = Number.isInteger(selectedTabId)
    ? windowContext?.linkedTabs?.[String(selectedTabId)]
    : null;
  const controller = windowContext?.surfacePair?.surfaces?.CHATGPT_CONTROLLER || null;

  if (!Number.isInteger(selectedTabId) || !linked) {
    throw new Error("AUTOSTART_TAB_BINDING_READBACK_FAILED: ingen vald kopplad ChatGPT-flik.");
  }
  if (Number(controller?.tabId) !== selectedTabId) {
    throw new Error("AUTOSTART_CONTROLLER_BINDING_READBACK_FAILED: controller-ytan matchar inte vald ChatGPT-flik.");
  }
  return {
    selectedTabId,
    conversationKey: String(linked.conversationKey || ""),
    controllerLifecycleState: String(controller.lifecycleState || "")
  };
}
