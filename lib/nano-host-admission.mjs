export const NANO_HOST_TELEMETRY_SCHEMA = "eic.autonom.nano-host-telemetry.v4";

export const NANO_HOST_CREATE_TIMEOUT_MS = 25 * 60 * 1_000;
export const NANO_HOST_PROGRESS_STALL_TIMEOUT_MS = 20 * 60 * 1_000;
export const NANO_HOST_CANARY_TIMEOUT_MS = 2 * 60 * 1_000;
export const NANO_HOST_PROGRESS_EPSILON = 0.0001;

export const NANO_HOST_STATUS = Object.freeze({
  UNKNOWN: "unknown",
  CHECKING: "checking",
  READY_TO_CREATE: "ready_to_create",
  DOWNLOADABLE: "downloadable",
  PREPARING_ASSETS: "preparing_assets",
  DOWNLOADING: "downloading",
  LOADING: "loading",
  VERIFYING: "verifying",
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
  ERROR: "error",
  TIMEOUT: "timeout",
  STALLED: "stalled",
  EXTERNAL_MODEL_ASSET_BLOCKER: "external_model_asset_blocker",
  ABORTED: "aborted"
});

const CURRENT_AVAILABILITY = new Set([
  NANO_HOST_STATUS.AVAILABLE,
  NANO_HOST_STATUS.DOWNLOADABLE,
  NANO_HOST_STATUS.DOWNLOADING,
  NANO_HOST_STATUS.UNAVAILABLE
]);

export class NanoHostCreateTimeoutError extends Error {
  constructor(timeoutMs = NANO_HOST_CREATE_TIMEOUT_MS) {
    super(`Nano-hostens aktivering överskred ${Math.round(timeoutMs / 1_000)} s.`);
    this.name = "NanoHostCreateTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}


export class NanoHostCanaryTimeoutError extends Error {
  constructor(timeoutMs = NANO_HOST_CANARY_TIMEOUT_MS) {
    super(`LanguageModel-verifieringen överskred ${Math.round(timeoutMs / 1_000)} s.`);
    this.name = "NanoHostCanaryTimeoutError";
    this.timeoutMs = timeoutMs;
    this.reasonCode = "CANARY_TIMEOUT";
  }
}

export class NanoHostCanaryFailedError extends Error {
  constructor(message = "LanguageModel returnerade inget verifierbart canary-svar.") {
    super(message);
    this.name = "NanoHostCanaryFailedError";
    this.reasonCode = "CANARY_FAILED";
  }
}

export async function withNanoHostCanaryDeadline(promise, {
  timeoutMs = NANO_HOST_CANARY_TIMEOUT_MS,
  abortController = null
} = {}) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try { abortController?.abort?.("NANO_HOST_CANARY_TIMEOUT"); } catch {}
          reject(new NanoHostCanaryTimeoutError(timeoutMs));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}



export class NanoHostDownloadStallError extends Error {
  constructor(timeoutMs = NANO_HOST_PROGRESS_STALL_TIMEOUT_MS) {
    super(`Chrome on-device LanguageModel-nedladdningen gjorde ingen materiell progress på ${Math.round(timeoutMs / 1_000)} s.`);
    this.name = "NanoHostDownloadStallError";
    this.timeoutMs = timeoutMs;
    this.reasonCode = "DOWNLOAD_STALLED";
  }
}

export class NanoHostExternalModelAssetBlockerError extends Error {
  constructor(timeoutMs = NANO_HOST_PROGRESS_STALL_TIMEOUT_MS) {
    super(`Chrome on-device LanguageModel-assets blev inte körbara inom ${Math.round(timeoutMs / 1_000)} s och ingen faktisk nedladdningsprogress observerades.`);
    this.name = "NanoHostExternalModelAssetBlockerError";
    this.timeoutMs = timeoutMs;
    this.reasonCode = "EXTERNAL_MODEL_ASSET_BLOCKER";
  }
}

export function createNanoDownloadProgressState({
  now = Date.now(),
  timeoutMs = NANO_HOST_PROGRESS_STALL_TIMEOUT_MS
} = {}) {
  return {
    progress: null,
    lastMaterialProgressAt: null,
    stallDeadlineAt: new Date(Number(now) + Number(timeoutMs)).toISOString(),
    timeoutMs: Number(timeoutMs)
  };
}

export function recordNanoDownloadProgress(stateValue, {
  progress = null,
  now = Date.now(),
  timeoutMs = stateValue?.timeoutMs ?? NANO_HOST_PROGRESS_STALL_TIMEOUT_MS
} = {}) {
  const state = {
    ...createNanoDownloadProgressState({ now, timeoutMs }),
    ...(stateValue || {})
  };
  const next = Number(progress);
  const valid = Number.isFinite(next) && next >= 0 && next <= 1;
  const previous = state.progress === null || state.progress === undefined
    ? Number.NaN
    : Number(state.progress);
  const material = valid && next > NANO_HOST_PROGRESS_EPSILON && (
    !Number.isFinite(previous) ||
    next > previous + NANO_HOST_PROGRESS_EPSILON
  );

  if (valid) {
    state.progress = Number.isFinite(previous)
      ? Math.max(previous, next)
      : next;
  }
  if (material) {
    state.lastMaterialProgressAt = new Date(Number(now)).toISOString();
    state.stallDeadlineAt = state.progress >= 1
      ? null
      : new Date(Number(now) + Number(timeoutMs)).toISOString();
  } else if (state.progress >= 1) {
    state.stallDeadlineAt = null;
  } else if (state.stallDeadlineAt === null && valid) {
    state.stallDeadlineAt = new Date(Number(now) + Number(timeoutMs)).toISOString();
  }
  state.timeoutMs = Number(timeoutMs);
  return { state, material };
}

export function nanoDownloadProgressStalled(state, {
  now = Date.now(),
  status = NANO_HOST_STATUS.DOWNLOADING
} = {}) {
  if (![NANO_HOST_STATUS.PREPARING_ASSETS, NANO_HOST_STATUS.DOWNLOADING].includes(status)) {
    return false;
  }
  if (!state?.stallDeadlineAt) return false;
  const deadline = Date.parse(state.stallDeadlineAt);
  return Number.isFinite(deadline) && Number(now) >= deadline &&
    Number(state.progress ?? 0) < 1;
}

export function nanoDownloadBlockerKind(state) {
  const progress = Number(state?.progress ?? 0);
  const materialObserved = Boolean(state?.lastMaterialProgressAt) ||
    progress > NANO_HOST_PROGRESS_EPSILON;
  return materialObserved
    ? "DOWNLOAD_STALLED"
    : "EXTERNAL_MODEL_ASSET_BLOCKER";
}

export function normalizeNanoAvailability(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CURRENT_AVAILABILITY.has(normalized)
    ? normalized
    : NANO_HOST_STATUS.UNKNOWN;
}

export function nanoDownloadFraction(event = {}) {
  const loaded = Number(event?.loaded);
  const total = Number(event?.total);
  if (!Number.isFinite(loaded) || loaded < 0) return null;
  const raw = Number.isFinite(total) && total > 1 ? loaded / total : loaded;
  if (!Number.isFinite(raw)) return null;
  return Math.min(1, Math.max(0, raw));
}

export function nanoHostReady({
  session = null,
  status = NANO_HOST_STATUS.UNKNOWN,
  busy = false,
  stale = false
} = {}) {
  return Boolean(
    session &&
    status === NANO_HOST_STATUS.AVAILABLE &&
    busy !== true &&
    stale !== true
  );
}

export function missionStartAllowed({
  requiresNanoHost = true,
  session = null,
  status = NANO_HOST_STATUS.UNKNOWN,
  busy = false,
  stale = false
} = {}) {
  return requiresNanoHost
    ? nanoHostReady({ session, status, busy, stale })
    : busy !== true;
}

export function buildNanoActivationBinding({
  trustedSession = "",
  version = "",
  modelKind = "",
  languages = [],
  mandateVersion = "",
  systemPrompt = ""
} = {}) {
  return JSON.stringify({
    trustedSession: String(trustedSession),
    version: String(version),
    modelKind: String(modelKind),
    languages: Array.isArray(languages) ? languages.map(String) : [],
    mandateVersion: String(mandateVersion),
    systemPrompt: String(systemPrompt)
  });
}

export function nanoHostUiProjection({
  status = NANO_HOST_STATUS.UNKNOWN,
  availability = NANO_HOST_STATUS.UNKNOWN,
  progress = null,
  detail = ""
} = {}) {
  const safeProgress = Number.isFinite(Number(progress))
    ? Math.min(1, Math.max(0, Number(progress)))
    : null;
  const labels = {
    [NANO_HOST_STATUS.UNKNOWN]: ["OKÄND", "neutral", "Aktivera Chrome on-device LanguageModel med användarklick."],
    [NANO_HOST_STATUS.CHECKING]: ["KONTROLLERAR", "assessing", "Chrome kontrollerar modellens tillgänglighet."],
    [NANO_HOST_STATUS.READY_TO_CREATE]: ["REDO ATT AKTIVERA", "done", "Modellassets är tillgängliga. Starta en verifierad LanguageModel-session med användarklick."],
    [NANO_HOST_STATUS.DOWNLOADABLE]: ["ASSETS KRÄVS", "waiting", "Chrome har begärt modellassets för on-device LanguageModel."],
    [NANO_HOST_STATUS.PREPARING_ASSETS]: ["FÖRBEREDER ASSETS", "waiting", "Chrome förbereder modellassets; ingen faktisk nedladdningsprogress har rapporterats."],
    [NANO_HOST_STATUS.DOWNLOADING]: ["LADDAR NED", "waiting", "Chrome laddar ned on-device LanguageModel-assets."],
    [NANO_HOST_STATUS.LOADING]: ["LÄSER IN", "assessing", "Nedladdningen är klar; Chrome extraherar eller läser in modellen."],
    [NANO_HOST_STATUS.VERIFYING]: ["VERIFIERAR", "assessing", "En native LanguageModel-session är skapad och verifieras med en lokal canary-inferens."],
    [NANO_HOST_STATUS.AVAILABLE]: ["KLAR", "done", "Chrome on-device LanguageModel är tillgänglig."],
    [NANO_HOST_STATUS.UNAVAILABLE]: ["SAKNAS", "blocked", "Chrome rapporterar att den lokala modellen inte är tillgänglig."],
    [NANO_HOST_STATUS.ERROR]: ["FEL", "error", "Chrome on-device LanguageModel kunde inte aktiveras."],
    [NANO_HOST_STATUS.TIMEOUT]: ["TIMEOUT", "error", "LanguageModel-aktiveringen avslutades av watchdog."],
    [NANO_HOST_STATUS.STALLED]: ["NEDLADDNING STANNAD", "error", "En påbörjad LanguageModel-nedladdning gjorde ingen fortsatt materiell progress."],
    [NANO_HOST_STATUS.EXTERNAL_MODEL_ASSET_BLOCKER]: ["BROWSERBLOCKERARE", "blocked", "Chrome gjorde inga körbara modellassets tillgängliga och ingen faktisk nedladdningsprogress observerades."],
    [NANO_HOST_STATUS.ABORTED]: ["AVBRUTEN", "warning", "LanguageModel-aktiveringen avbröts."]
  };
  const [label, tone, fallbackDetail] = labels[status] || labels[NANO_HOST_STATUS.UNKNOWN];
  const indeterminate = [
    NANO_HOST_STATUS.CHECKING,
    NANO_HOST_STATUS.PREPARING_ASSETS,
    NANO_HOST_STATUS.LOADING,
    NANO_HOST_STATUS.VERIFYING
  ].includes(status);
  const shownProgress = status === NANO_HOST_STATUS.AVAILABLE
    ? 1
    : status === NANO_HOST_STATUS.DOWNLOADING
      ? safeProgress
      : null;
  const progressText = status === NANO_HOST_STATUS.DOWNLOADING && safeProgress !== null
    ? `${Math.round(safeProgress * 100)} %`
    : status === NANO_HOST_STATUS.AVAILABLE
      ? "100 %"
      : status === NANO_HOST_STATUS.LOADING
        ? "Extraherar / läser in…"
        : status === NANO_HOST_STATUS.CHECKING
          ? "Kontrollerar…"
          : status === NANO_HOST_STATUS.PREPARING_ASSETS
            ? "Väntar på modellassets…"
          : status === NANO_HOST_STATUS.TIMEOUT
            ? "Tidsgräns nådd"
            : status === NANO_HOST_STATUS.STALLED
            ? "Nedladdning stannad"
            : status === NANO_HOST_STATUS.EXTERNAL_MODEL_ASSET_BLOCKER
              ? "Extern browserblockerare"
            : status === NANO_HOST_STATUS.ABORTED
              ? "Avbruten"
              : status === NANO_HOST_STATUS.UNAVAILABLE
                ? "Inte tillgänglig"
                : status === NANO_HOST_STATUS.ERROR
                  ? "Fel"
                  : status === NANO_HOST_STATUS.DOWNLOADABLE
                    ? "Assets krävs"
                    : status === NANO_HOST_STATUS.READY_TO_CREATE
                      ? "Klicka Aktivera"
                      : status === NANO_HOST_STATUS.VERIFYING
                        ? "Verifierar inferens…"
                        : "Ej kontrollerad";
  return {
    label,
    tone,
    detail: String(detail || fallbackDetail),
    availability: normalizeNanoAvailability(availability),
    indeterminate,
    progress: shownProgress,
    progressText
  };
}

export function withNanoHostCreateDeadline(promise, {
  timeoutMs = NANO_HOST_CREATE_TIMEOUT_MS,
  abortController = null
} = {}) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { abortController?.abort?.("NANO_HOST_CREATE_TIMEOUT"); } catch {}
        reject(new NanoHostCreateTimeoutError(timeoutMs));
      }, timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
