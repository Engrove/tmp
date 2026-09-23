import { fleetHealth, reasonLabel, workerReason } from "./lib/operations-view.mjs";
import { auditAsNdjson } from "./lib/audit-store.mjs";
import { modelCreateOptions } from "./lib/model-config.mjs";
import { PHASES, TERMINAL_PHASES, AUDIT_FIFO_LIMIT } from "./lib/contracts.mjs";
import { errorRecord } from "./lib/common.mjs";
import {
  fleetWorkerDetailsKey,
  reconcileOpenFleetWorkerKeys
} from "./lib/panel-details-state.mjs";
import {
  deleteMissionPreset,
  loadOperatorSettings,
  saveMissionPreset,
  saveOperatorSettings
} from "./lib/operator-settings.mjs";
import {
  DEFAULT_GREENFIELD_PRIORITY,
  DEFAULT_MAX_ACTIVE_SESSIONS,
  GREENFIELD_PRIORITY_LABELS
} from "./lib/global-capacity-scheduler.mjs";
import {
  DEFAULT_MISSION_QUANTUM_INTERACTIONS,
  DEFAULT_QUEUE_PRIORITY_AGING_SECONDS,
  DEFAULT_QUEUE_SWITCH_DELAY_SECONDS,
  DEFAULT_QUEUE_SWITCH_HARD_RELOAD,
  DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS
} from "./lib/mission-work-queue.mjs";

const $ = (id) => document.getElementById(id);
const state = {
  windowId: null,
  workerId: "",
  process: null,
  nextInstruction: null,
  busy: false,
  instructionBusy: false,
  auditBusy: false,
  operatorSettings: {
    postDelaySeconds: 0,
    maxActiveSessions: DEFAULT_MAX_ACTIVE_SESSIONS,
    defaultMissionQuantumInteractions: DEFAULT_MISSION_QUANTUM_INTERACTIONS,
    queuePriorityAgingSeconds: DEFAULT_QUEUE_PRIORITY_AGING_SECONDS,
    queueSwitchDelaySeconds: DEFAULT_QUEUE_SWITCH_DELAY_SECONDS,
    queueSwitchHardReload: DEFAULT_QUEUE_SWITCH_HARD_RELOAD,
    queueSwitchSettleSeconds: DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS,
    workModeEnabled: false,
    workModeEndpoint: "https://api.elho.fi/greenfield/work-mode/v1",
    savedMissions: []
  },
  operatorSettingsBusy: false,
  startSchedulerPriority: DEFAULT_GREENFIELD_PRIORITY,
  globalPromptGate: null,
  globalCapacityScheduler: null,
  missionQueue: null,
  missionQueueSets: [],
  fleetStatus: null,
  activeUiTab: "overview",
  queueBusy: false,
  queueSetBusy: false,
  audit: {
    enabled: false,
    mode: "FIFO_ONLY",
    fifoLimit: AUDIT_FIFO_LIMIT,
    events: []
  },
  auditSessionId: `ui-session-${crypto.randomUUID()}`
};

async function appendAudit({
  kind,
  component = "sidepanel",
  severity = "INFO",
  payload = {},
  windowId = state.windowId,
  auditSessionId = state.auditSessionId
} = {}) {
  if (!Number.isInteger(windowId)) return null;
  const result = await chrome.runtime.sendMessage({
    type: "EIC_GF_UI_EVENT",
    windowId,
    auditSessionId,
    kind: kind || "UI_EVENT",
    component,
    severity,
    payload
  });
  if (result?.audit) state.audit = result.audit;
  return result;
}

async function appendAuditError({
  error,
  kind = "SIDEPANEL_ERROR",
  component = "sidepanel",
  severity = "ERROR",
  payload = {},
  ...context
} = {}) {
  return appendAudit({
    ...context,
    kind,
    component,
    severity,
    payload: {
      error: errorRecord(error),
      ...payload
    }
  });
}

function activeProcess(process) {
  return Boolean(process && !TERMINAL_PHASES.has(process.phase));
}

function short(value, max = 900) {
  const s = String(value ?? "").trim();
  return s.length <= max ? s : `${s.slice(0, max)}\n…`;
}

function formatTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function promptPauseRemainingMs(process, now = Date.now()) {
  const until = Number(process?.promptPause?.notBeforeAtMs || 0);
  return until > now ? until - now : 0;
}

function missionPauseRemainingMs(process, now = Date.now()) {
  if (process?.phase !== PHASES.PAUSED || process?.missionPause?.state !== "ARMED") return 0;
  const until = Number(process?.missionPause?.resumeAtMs || 0);
  return until > now ? until - now : 0;
}

function formatCountdown(ms) {
  const seconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  return `${seconds} s`;
}

function formatMissionCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min ${String(seconds).padStart(2, "0")} s`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}

function priorityLabel(value) {
  const key = String(value || DEFAULT_GREENFIELD_PRIORITY).toUpperCase();
  return GREENFIELD_PRIORITY_LABELS[key] || GREENFIELD_PRIORITY_LABELS.NORMAL;
}

function schedulerStatusText(process) {
  const scheduler = state.globalCapacityScheduler;
  const configured = Number(
    scheduler?.configuredCapacity ??
    state.operatorSettings?.maxActiveSessions ??
    DEFAULT_MAX_ACTIVE_SESSIONS
  );
  if (!scheduler) {
    return `Kapacitet 0/${configured} · scheduler laddas`;
  }

  const activeCount = Number(scheduler.activeCount || 0);
  const effective = Number(scheduler.effectiveCapacity ?? configured);
  const waitingCount = Number(scheduler.waitingCount || 0);
  const processId = process?.processId || "";
  const active = (scheduler.activeTurns || []).find((item) => item.processId === processId);
  const waiter = (scheduler.waiters || []).find((item) => item.processId === processId);
  const capText = effective === configured
    ? `${activeCount}/${effective}`
    : `${activeCount}/${effective} effektiv · max ${configured}`;

  if (active) {
    return `Kapacitet ${capText} · denna session har aktiv slot · ${priorityLabel(active.priority)} · väntar ${waitingCount}`;
  }
  if (waiter) {
    const effectivePriority = waiter.effectivePriority || waiter.priority;
    const aging = effectivePriority !== waiter.priority
      ? ` → ${priorityLabel(effectivePriority)} via väntetid`
      : "";
    return `Kapacitet ${capText} · väntar på slot · köplats ${Number(waiter.queueRank || 0) || "—"} · ${priorityLabel(waiter.priority)}${aging}`;
  }
  return `Kapacitet ${capText} · väntar ${waitingCount}`;
}

function statusText(process) {
  if (!process) return "Ingen aktiv process i detta Chrome-fönster.";
  if (process.greenfieldControl?.action === "OPERATOR") {
    return `Operatörsåtgärd krävs: ${process.lastError?.message || process.lastDecision?.analysis || "mänsklig behörighet/åtgärd krävs"}.`;
  }
  if (process.greenfieldControl?.action === "BLOCK" && process.phase === PHASES.BLOCKED) {
    return `Greenfield BLOCK: ${process.lastError?.message || process.lastDecision?.analysis || "ingen säker autonom fortsättning"}.`;
  }
  const rateLimit = state.globalPromptGate?.rateLimit || null;
  if (rateLimit?.state === "COOLDOWN") {
    const remaining = Math.max(0, Number(rateLimit.cooldownUntilMs || 0) - Date.now());
    return `ChatGPT rate-limit cooldown · ${formatCountdown(remaining)} kvar · hela Chrome-profilen spärrad.`;
  }
  if (rateLimit?.state === "SERIAL_RECOVERY") {
    const remaining = Math.max(0, Number(rateLimit.nextSerialNotBeforeAtMs || 0) - Date.now());
    const owner = rateLimit.currentRecoveryProcessId ? ` · recovery ${String(rateLimit.currentRecoveryProcessId).slice(-8)}` : "";
    return `Seriell rate-limit recovery · ${formatCountdown(remaining)} till nästa klient${owner}.`;
  }
  const missionPauseMs = missionPauseRemainingMs(process);
  if (process.phase === PHASES.PAUSED) {
    return missionPauseMs > 0
      ? `Mission pause · ${formatMissionCountdown(missionPauseMs)} kvar före EIC:s planerade nästa autonoma prompt.`
      : "Mission pause har nått väcktiden och väntar på runtime-resume.";
  }
  const pauseMs = promptPauseRemainingMs(process);
  if (pauseMs > 0) {
    return `Global promptpaus · ${formatCountdown(pauseMs)} kvar före nästa ChatGPT-post.`;
  }
  const map = {
    SENDING: "Skickar nästa prompt och verifierar att den landade i mål-sessionen.",
    WAITING: "Väntar eventdrivet på ett nytt färdigt assistantsvar.",
    ANALYZING: "Hjalmar D2 analyserar senaste svaret och väljer nästa säkra fortsättning.",
    RECOVERING: `Återhämtar autonomt: ${process.recovery?.reason || "transient runtime-fel"}.`,
    ROTATING: `Byter EIC-session för samma mission: ${process.sessionRotation?.reason || process.sessionRotation?.reasonCode || "kontrollerad sessionrotation"}.`,
    DETACHED: "Målfliken är tillfälligt frånkopplad. Processen är persistent och försöker återansluta.",
    BLOCKED: `Blockerad av verklig Greenfield-gräns: ${process.lastError?.message || process.lastDecision?.analysis || "okänd"}.`,
    DONE: "Uppdraget är bedömt färdigt med explicit completion-evidens.",
    STOPPED: "Processen stoppades.",
    AUDIT_FAILURE: "Audit kunde inte persisteras. Körningen har stoppats för att felsökningsevidens inte ska tappas."
  };
  return map[process.phase] || process.phase;
}

async function renderAudit() {
  const process = state.process;
  const auditState = state.audit || {
    enabled: false,
    mode: "FIFO_ONLY",
    fifoLimit: AUDIT_FIFO_LIMIT,
    events: []
  };
  const enabled = auditState.enabled === true;
  const rows = Array.isArray(auditState.events) ? auditState.events.slice(-AUDIT_FIFO_LIMIT) : [];

  $("auditEnabled").checked = enabled;
  $("auditEnabled").disabled = state.auditBusy;
  $("exportAudit").disabled = !enabled || state.auditBusy;
  $("auditState").textContent = enabled
    ? `PÅ · persistent · FIFO ${rows.length}/${AUDIT_FIFO_LIMIT}`
    : `AV · endast minnes-FIFO ${rows.length}/${AUDIT_FIFO_LIMIT}`;
  $("auditState").classList.toggle("error", enabled && process?.phase === PHASES.AUDIT_FAILURE);

  const visible = rows.slice().reverse();
  $("auditFeed").innerHTML = visible.length
    ? visible.map((event) => `
        <div class="audit-row">
          <div class="audit-seq">${formatTime(event.timestamp)}</div>
          <div class="audit-kind"><b>${escapeHtml(event.kind)}</b><br>${escapeHtml(event.component)} · ${escapeHtml(event.scope || "RUN")} · ${event.generation == null ? "—" : `g${event.generation}`} · ${event.turn == null ? "—" : `t${event.turn}`}</div>
        </div>`).join("")
    : enabled
      ? '<div class="empty">Persistent Audit är på. Inga nya händelser ännu.</div>'
      : '<div class="empty">Audit är av. De 25 senaste live-händelserna visas här i minnet och persisteras inte.</div>';
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function renderOperatorSettings() {
  const settings = state.operatorSettings || {
    postDelaySeconds: 0,
    maxActiveSessions: DEFAULT_MAX_ACTIVE_SESSIONS,
    defaultMissionQuantumInteractions: DEFAULT_MISSION_QUANTUM_INTERACTIONS,
    queuePriorityAgingSeconds: DEFAULT_QUEUE_PRIORITY_AGING_SECONDS,
    queueSwitchDelaySeconds: DEFAULT_QUEUE_SWITCH_DELAY_SECONDS,
    queueSwitchHardReload: DEFAULT_QUEUE_SWITCH_HARD_RELOAD,
    queueSwitchSettleSeconds: DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS,
    savedMissions: []
  };
  const delay = Number(settings.postDelaySeconds || 0);
  const maxActiveSessions = Number(
    settings.maxActiveSessions ?? DEFAULT_MAX_ACTIVE_SESSIONS
  );
  $("postDelay").value = String(delay);
  $("postDelayValue").textContent = `${delay} s`;
  $("postDelay").disabled = state.operatorSettingsBusy;
  $("maxActiveSessions").value = String(maxActiveSessions);
  $("maxActiveSessionsValue").textContent = String(maxActiveSessions);
  $("maxActiveSessions").disabled = state.operatorSettingsBusy;
  if ($("workModeEnabled")) $("workModeEnabled").checked = settings.workModeEnabled === true;
  if ($("workModeEndpoint")) $("workModeEndpoint").value = settings.workModeEndpoint || "https://api.elho.fi/greenfield/work-mode/v1";
  if ($("workModeState")) $("workModeState").textContent = settings.workModeEnabled === true ? "Aktiv" : "Av";
  if ($("saveWorkMode")) $("saveWorkMode").disabled = state.operatorSettingsBusy;
  if ($("syncWorkMode")) $("syncWorkMode").disabled = state.operatorSettingsBusy || !activeProcess(state.process);

  const active = activeProcess(state.process);
  const selectedPriority = active
    ? String(state.process.schedulerPriority || DEFAULT_GREENFIELD_PRIORITY)
    : state.startSchedulerPriority;
  $("schedulerPriority").value = selectedPriority;
  $("schedulerPriority").disabled = state.operatorSettingsBusy;

  const missions = Array.isArray(settings.savedMissions) ? settings.savedMissions : [];
  for (const id of ["savedMissionSelect", "queueSavedMissionSelect"]) {
    const select = $(id);
    if (!select) continue;
    const multi = id === "queueSavedMissionSelect";
    const selectedValues = multi
      ? new Set([...select.selectedOptions].map((option) => option.value).filter(Boolean))
      : new Set(select.value ? [select.value] : []);
    const emptyLabel = multi ? "Välj ett eller flera sparade uppdrag…" : "Sparade uppdrag…";
    select.innerHTML = (multi ? "" : `<option value="">${emptyLabel}</option>`) + missions
      .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label || item.goal)}</option>`)
      .join("");
    for (const option of select.options) {
      option.selected = selectedValues.has(option.value);
    }
    if (!multi && !missions.some((item) => selectedValues.has(item.id))) select.value = "";
  }

  $("loadSavedMission").disabled = !$("savedMissionSelect").value || state.operatorSettingsBusy;
  $("deleteSavedMission").disabled = !$("savedMissionSelect").value || state.operatorSettingsBusy;
  $("saveMission").disabled = state.operatorSettingsBusy ||
    !(state.process?.goal || $("goal").value.trim());
  $("queueAddMission").disabled = !$("queueSavedMissionSelect").value || state.queueBusy;

  $("defaultMissionQuantumInteractions").value = String(
    settings.defaultMissionQuantumInteractions ?? DEFAULT_MISSION_QUANTUM_INTERACTIONS
  );
  $("queuePriorityAgingSeconds").value = String(
    settings.queuePriorityAgingSeconds ?? DEFAULT_QUEUE_PRIORITY_AGING_SECONDS
  );
  $("queueSwitchDelaySeconds").value = String(
    settings.queueSwitchDelaySeconds ?? DEFAULT_QUEUE_SWITCH_DELAY_SECONDS
  );
  $("queueSwitchHardReload").checked = settings.queueSwitchHardReload == null
    ? DEFAULT_QUEUE_SWITCH_HARD_RELOAD
    : settings.queueSwitchHardReload === true;
  $("queueSwitchSettleSeconds").value = String(
    settings.queueSwitchSettleSeconds ?? DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS
  );
  for (const id of [
    "defaultMissionQuantumInteractions",
    "queuePriorityAgingSeconds",
    "queueSwitchDelaySeconds",
    "queueSwitchHardReload",
    "queueSwitchSettleSeconds",
    "saveQueueSettings"
  ]) {
    if ($(id)) $(id).disabled = state.operatorSettingsBusy || state.queueBusy;
  }
}
async function refreshOperatorSettings() {
  state.operatorSettings = await loadOperatorSettings();
  renderOperatorSettings();
}

async function updatePostDelay() {
  if (state.operatorSettingsBusy) return;
  state.operatorSettingsBusy = true;
  try {
    const postDelaySeconds = Number($("postDelay").value || 0);
    state.operatorSettings = await saveOperatorSettings({ postDelaySeconds });
    await appendAudit({
      kind: "OPERATOR_POST_DELAY_UPDATED",
      component: "sidepanel-settings",
      payload: { postDelaySeconds: state.operatorSettings.postDelaySeconds }
    }).catch(() => undefined);
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
  } finally {
    state.operatorSettingsBusy = false;
    renderOperatorSettings();
  }
}

async function updateMaxActiveSessions() {
  if (state.operatorSettingsBusy) return;
  state.operatorSettingsBusy = true;
  try {
    const maxActiveSessions = Number(
      $("maxActiveSessions").value || DEFAULT_MAX_ACTIVE_SESSIONS
    );
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_SET_MAX_ACTIVE_SESSIONS",
      windowId: state.windowId,
      workerId: state.workerId,
      maxActiveSessions
    });
    if (!result?.ok) {
      throw new Error(result?.error || result?.code || "Kapacitetsändring misslyckades.");
    }
    if (result.operatorSettings) state.operatorSettings = result.operatorSettings;
    if (result.globalCapacityScheduler) {
      state.globalCapacityScheduler = result.globalCapacityScheduler;
    }
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
  } finally {
    state.operatorSettingsBusy = false;
    await render();
  }
}

async function updateSchedulerPriority() {
  if (state.operatorSettingsBusy) return;
  const priority = String($("schedulerPriority").value || DEFAULT_GREENFIELD_PRIORITY);
  if (!activeProcess(state.process)) {
    state.startSchedulerPriority = priority;
    renderOperatorSettings();
    return;
  }

  state.operatorSettingsBusy = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_SET_SCHEDULER_PRIORITY",
      windowId: state.windowId,
      workerId: state.workerId,
      priority
    });
    if (!result?.ok) {
      throw new Error(result?.error || result?.code || "Prioritetsändring misslyckades.");
    }
    state.process = result.process || state.process;
    if (result.globalCapacityScheduler) {
      state.globalCapacityScheduler = result.globalCapacityScheduler;
    }
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
  } finally {
    state.operatorSettingsBusy = false;
    await render();
  }
}

async function saveCurrentMission() {
  if (state.operatorSettingsBusy) return;
  const goal = String(state.process?.goal || $("goal").value || "").trim();
  if (!goal) {
    $("statusDetail").textContent = "Det finns inget uppdrag att spara.";
    return;
  }
  state.operatorSettingsBusy = true;
  try {
    state.operatorSettings = await saveMissionPreset(goal);
    await appendAudit({
      kind: "SAVED_MISSION_STORED",
      component: "sidepanel-settings",
      payload: { goalLength: goal.length, savedCount: state.operatorSettings.savedMissions.length }
    }).catch(() => undefined);
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
  } finally {
    state.operatorSettingsBusy = false;
    renderOperatorSettings();
  }
}

function selectedSavedMission() {
  const id = $("savedMissionSelect").value;
  return (state.operatorSettings?.savedMissions || []).find((item) => item.id === id) || null;
}

function loadSelectedMission() {
  const mission = selectedSavedMission();
  if (!mission) return;
  $("goal").value = mission.goal;
  renderOperatorSettings();
}

async function deleteSelectedMission() {
  const mission = selectedSavedMission();
  if (!mission || state.operatorSettingsBusy) return;
  state.operatorSettingsBusy = true;
  try {
    state.operatorSettings = await deleteMissionPreset(mission.id);
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
  } finally {
    state.operatorSettingsBusy = false;
    renderOperatorSettings();
  }
}


function setUiTab(tab) {
  state.activeUiTab = ["overview", "runtime", "missions", "workmode"].includes(tab) ? tab : "overview";
  document.body.dataset.activeTab = state.activeUiTab;
  $("overviewTabButton").classList.toggle("active", state.activeUiTab === "overview");
  $("runtimeTabButton").classList.toggle("active", state.activeUiTab === "runtime");
  $("missionsTabButton").classList.toggle("active", state.activeUiTab === "missions");
  $("workModeTabButton").classList.toggle("active", state.activeUiTab === "workmode");
}

function queuePriorityOptions(selected) {
  return ["LOW", "NORMAL", "HIGH", "URGENT"]
    .map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(priorityLabel(value))}</option>`)
    .join("");
}

function renderFleetStatus() {
  const fleet = state.fleetStatus || {};
  const workers = Array.isArray(fleet.workers) ? fleet.workers : [];
  const now = Date.now(), health = fleetHealth(state.fleetStatus,now);
  const n = v => Number(v || 0).toLocaleString("sv-SE");
  const age = value => {
    const t = typeof value === "number" ? value : Date.parse(value || "");
    return Number.isFinite(t) && t>0 ? formatMissionCountdown(Math.max(0,now-t)) + " sedan" : "saknas";
  };
  $("opsBanner").dataset.tone=health.tone;
  $("opsTitle").textContent=health.label;
  $("opsDetail").textContent=health.detail;
  $("admissionPause").textContent=fleet.safety?.admissionPaused ? "Återuppta nya utskick" : "Pausa nya utskick";
  $("fleetActive").textContent=n(fleet.activeCount);
  $("fleetCapacity").textContent=`${n(fleet.usedCapacity)}/${n(fleet.effectiveCapacity)}`;
  $("fleetWaiting").textContent=n(fleet.waitingCount);
  $("fleetPaused").textContent=n(workers.filter(r=>r.process?.phase===PHASES.PAUSED || r.process?.safety?.hold || r.process?.safety?.qualityIncident || r.process?.storageRecoveryRequired).length);
  $("fleetRateLimit").textContent=fleet.runtimeFault || fleet.safety?.error ? "SPÄRRAD" : fleet.safety?.providerHold ? "KVOTSPÄRR" : String(fleet.rateLimitState || "OKÄND");
  $("fleetRateLimit").dataset.state=fleet.safety?.providerHold ? "COOLDOWN" : String(fleet.rateLimitState || "UNKNOWN");
  $("fleetHeadline").textContent=`${n(fleet.usedCapacity)} upptagna platser · ${n(fleet.heldCount)} i skyddsväntan`;
  $("fleetWorkMode").textContent=fleet.workModeEnabled ? "På" : "Av";
  $("fleetUpdated").textContent=formatTime(fleet.generatedAt);
  $("fleetFreshness").textContent=fleet.generatedAt ? `Status ${age(fleet.generatedAt)}` : "Inväntar data";
  $("fleetWorkersCount").textContent=String(workers.length);
  $("fleetStorage").textContent=fleet.storage?.known
    ? `${(fleet.storage.bytes/1048576).toFixed(1)} / ${(fleet.storage.limitBytes/1048576).toFixed(0)} MB · ${(fleet.storage.ratio*100).toFixed(0)} % · auto`
    : "Okänd";
  $("storageContractStatus").textContent=fleet.storageContract?.verified ? "Skrivning och återläsning godkända" : "Inte verifierad";
  $("opsWorkerCount").textContent=String(workers.length);
  const gateWait=Math.max(0,Number(fleet.promptGate?.nextAllowedAtMs||0)-now);
  $("fleetPromptGate").textContent=gateWait>0 ? formatCountdown(gateWait) : fleet.promptGate ? "Tidsvillkor uppfyllt" : "Okänd";
  $("fleetGlobalDetail").textContent=`${n(fleet.usedCapacity)}/${n(fleet.effectiveCapacity)} platser · ${n(fleet.waitingCount)} väntar`;
  const u=fleet.safety || {}, policy=u.policy || {};
  $("usageTokens").textContent=u.error || !u.policy ? "Okänt" : n(Number(u.inputTokens24h||0)+Number(u.outputTokens24h||0));
  $("usageTokenSplit").textContent=u.error || !u.policy ? "Förbrukningen kunde inte läsas" : `${n(u.inputTokens24h)} in · ${n(u.outputTokens24h)} ut`;
  $("usageMessages").textContent=u.error || !u.policy ? "Okänt" : `${n(u.messages24h)} / ${n(policy.messages24h)}`;
  $("usageOtherWindows").textContent=u.error || !u.policy ? "Budgetuppgifter saknas" : `3 h: ${n(u.messages3h)}/${n(policy.messages3h)} · 7 d: ${n(u.messages7d)}/${n(policy.messages7d)}`;
  $("usageBudgetMeter").value=policy.tokens24h ? Math.min(100,100*Number(u.chargedTokens24h||0)/policy.tokens24h) : 0;
  $("usageBudgetDetail").textContent=u.error || !u.policy ? "Ingen giltig budgetavläsning" : `Budgetbelastning ≈ ${n(u.chargedTokens24h)} / ${n(policy.tokens24h)} tokens inklusive svarreserv`;
  const previouslyOpenWorkerKeys = reconcileOpenFleetWorkerKeys(
    new Set(
      [...$("fleetWorkers").querySelectorAll("details.worker-details[open][data-worker-key]")]
        .map((details) => details.dataset.workerKey)
        .filter(Boolean)
    ),
    workers
  );
  $("fleetWorkers").innerHTML=workers.length ? workers.map((row,index)=>{
    const p=row.process || {}, q=row.queue || {}, item=q.activeItem || {};
    const workerDetailsKey = fleetWorkerDetailsKey(row);
    const proof=p.safety?.proof || {}, hold=p.safety?.hold;
    const retry=hold?.retryAtMs || p.missionPause?.resumeAtMs || Date.parse(p.recovery?.nextAttemptAt || "") || p.promptPause?.notBeforeAtMs || 0;
    const title=item.label || (p.goal || "Uppdrag").split("\n")[0];
    const tone=p.safety?.qualityIncident || p.storageRecoveryRequired ? "danger" : hold ? "warn" : "neutral";
    const summary=p.lastResponse?.summary || p.lastResponse?.contract?.value?.summary || p.lastDecision?.reason || "";
    return `<article class="fleet-worker" data-tone="${tone}">
      <div class="fleet-worker-head"><strong>${escapeHtml(short(title,110))}</strong><span class="fleet-phase">${escapeHtml(p.phase || "IDLE")}</span></div>
      <p class="worker-reason">${escapeHtml(workerReason(p,now))}</p>
      <div class="worker-model" data-ok="${proof.allowed===true}">${escapeHtml(proof.model || "Modell okänd")} · ${escapeHtml(proof.effort || "Tänkenivå okänd")}</div>
      <div class="fleet-meta"><span>Tur ${n(p.turn)} · session ${n(p.sessionSeq)}</span><span>${escapeHtml(priorityLabel(p.schedulerPriority))}</span><span>${n(q.readyCount)} redo · ${n(q.pausedCount)} sover · ${n(q.blockedCount)} blockerade</span></div>
      <div class="worker-times"><span>Aktivitet: ${escapeHtml(age(p.lastMaterialAt))}</span><span>Avläst: ${escapeHtml(age(p.safety?.lastObservationAtMs))}</span></div>
      ${retry>now ? `<div class="worker-next">Nästa kontroll tidigast ${escapeHtml(formatTime(retry))} · om ${escapeHtml(formatMissionCountdown(retry-now))}</div>` : ""}
      ${summary ? `<p class="worker-summary">${escapeHtml(short(summary,200))}</p>` : ""}
      <details class="worker-details" data-worker-key="${escapeHtml(workerDetailsKey)}"${workerDetailsKey && previouslyOpenWorkerKeys.has(workerDetailsKey) ? " open" : ""}><summary>Uppdrag och identitet</summary><p>${escapeHtml(short(p.goal,1200))}</p><code>${escapeHtml(p.workerId || "")}<br>${escapeHtml(p.processId || "")}</code><p>${escapeHtml(reasonLabel(proof.code))} · ${escapeHtml(p.lastManagedUrl || "Konversationsadress saknas")}</p><p>Modellkontrollen bygger på synligt gränssnitt. Den intygar inte serverns interna modell.</p></details>
    </article>`;
  }).join("") : '<div class="fleet-empty">Inga pågående workers i denna profil.</div>';
  const recovery=fleet.recovery || {};
  $("recoverySummary").textContent=`${n(recovery.restored?.length)} återanslutningar · ${n(recovery.checkpointRepairs?.length)} RC1-poster reparerade · ${n(recovery.unresolved?.length)} oklara · ${n(recovery.errors?.length)} lagrings-/återställningsfel`;
  $("recoveryRows").innerHTML=[...(recovery.unresolved || []),...(recovery.errors || [])].map(r=>`<div class="recovery-row"><strong>${escapeHtml(short(r.goal || r.workerId || "Lagringsfel",130))}</strong><span>${escapeHtml(reasonLabel(r.code))}</span></div>`).join("");
  const events=(u.events || []).slice(-10).reverse();
  $("safetyEvents").innerHTML=events.map(e=>`<li><time>${escapeHtml(formatTime(e.atMs))}</time><span>${escapeHtml(reasonLabel(e.code))}${e.detail ? `<small>${escapeHtml(e.detail)}</small>` : ""}</span></li>`).join("") || '<li>Inga kontrollhändelser ännu.</li>';
  if (!$("safetyPolicyForm").contains(document.activeElement) && !state.safetyPolicyDirty && policy.requiredModel) {
    for (const [key,value] of Object.entries(policy)) if ($(key)) $(key).value=String(value);
  }
}

function renderMissionQueueSets() {
  const sets = Array.isArray(state.missionQueueSets) ? state.missionQueueSets : [];
  const select = $("queueSetSelect");
  if (!select) return;
  const selected = select.value;
  select.innerHTML = sets.length
    ? sets.map((item) =>
        `<option value="${escapeHtml(item.setId)}">${escapeHtml(item.name)} · ${Number(item.itemCount || 0)} uppdrag</option>`
      ).join("")
    : '<option value="">Inga sparade set</option>';
  if (selected && sets.some((item) => item.setId === selected)) select.value = selected;

  const selectedId = select.value;
  const active = activeProcess(state.process);
  const queueRunning = state.missionQueue?.enabled === true;
  $("queueSetApply").disabled = state.queueSetBusy || !selectedId || active || queueRunning;
  $("queueSetDelete").disabled = state.queueSetBusy || !selectedId;
  $("queueSetSave").disabled = state.queueSetBusy || !$("queueSetName").value.trim();
  $("queueSetSelect").disabled = state.queueSetBusy || sets.length === 0;
}

function renderMissionQueue() {
  const queue = state.missionQueue || {
    enabled: false,
    activeItemId: "",
    items: [],
    history: []
  };
  const items = Array.isArray(queue.items) ? queue.items : [];
  const history = Array.isArray(queue.history) ? queue.history : [];
  const activeItem = items.find((item) => item.itemId === queue.activeItemId) || null;
  const now = Date.now();
  const runnableCount = items.filter((item) => {
    if (item.status === "READY") return true;
    if (item.status === "PAUSED") return Number(item.pauseUntilMs || 0) <= now;
    if (item.status === "BLOCKED") return Number(item.blockedRetryAtMs || 0) > 0 &&
      Number(item.blockedRetryAtMs || 0) <= now;
    return false;
  }).length;
  const queueMode = queue.enabled === true;
  $("missionQueueState").textContent = queueMode
    ? `${items.length} köplatser · loopar · ${activeItem ? `aktiv: ${activeItem.label}` : "väntar"}`
    : `${items.length} köplatser · stoppad`;

  $("queueStart").disabled = state.queueBusy || queueMode || items.length === 0 || activeProcess(state.process);
  $("queueStop").disabled = state.queueBusy || !queueMode;
  $("queueClearHistory").disabled = state.queueBusy || history.length === 0;
  $("queueAddMission").disabled = state.queueBusy || !$("queueSavedMissionSelect").value;

  $("missionQueueList").innerHTML = items.length
    ? [...items].sort((a,b) => Number(a.order || 0) - Number(b.order || 0)).map((item) => {
        const active = item.itemId === queue.activeItemId || item.status === "ACTIVE";
        const paused = item.status === "PAUSED";
        const blocked = item.status === "BLOCKED";
        const processCtx = state.process?.queueContext?.itemId === item.itemId
          ? state.process.queueContext
          : null;
        const blockedRetryAtMs = Number(item.blockedRetryAtMs || 0);
        const delegationMeta = item.delegation?.requestId
          ? " · EIC-delegerat från annan GFW"
          : "";
        const progress = processCtx
          ? `${Number(processCtx.interactionCount || 0)}/${Number(processCtx.maxInteractions || item.maxInteractions || 0)} slutförda i kvanten`
          : blocked
            ? blockedRetryAtMs > Date.now()
              ? `temporärt blockerad · nytt försök ${new Date(blockedRetryAtMs).toLocaleTimeString()} · ${Number(item.blockedCount || 1)} blockering(ar)`
              : "temporärt blockerad · redo för nytt försök"
            : paused && Number(item.pauseUntilMs || 0) > Date.now()
              ? `paus till ${new Date(Number(item.pauseUntilMs)).toLocaleTimeString()}`
              : item.hasContinuation
                ? `${Number(item.quantumProgress || 0)}/${Number(item.maxInteractions || 0)} sparade i kvanten · checkpoint finns`
                : "nytt uppdrag";
        return `
          <div class="queue-row ${active ? "active" : ""} ${paused ? "paused" : ""} ${blocked ? "blocked" : ""}" data-item-id="${escapeHtml(item.itemId)}">
            <div class="queue-row-title">
              <strong>${escapeHtml(item.label)}</strong>
              <span class="queue-status-pill">Plats ${Number(item.order || 0) + 1}</span>
              <span class="queue-status-pill">${escapeHtml(item.status)}</span>
            </div>
            <div class="queue-row-controls">
              <select data-queue-field="priority" aria-label="Prioritet">${queuePriorityOptions(item.priority)}</select>
              <input data-queue-field="maxInteractions" type="number" min="1" max="50" step="1" value="${Number(item.maxInteractions || DEFAULT_MISSION_QUANTUM_INTERACTIONS)}" aria-label="Max interaktioner" ${active ? "disabled" : ""}>
              <button class="ghost" data-queue-action="up" title="Flytta upp">↑</button>
              <button class="ghost" data-queue-action="down" title="Flytta ned">↓</button>
              <button class="ghost" data-queue-action="remove" ${active ? "disabled" : ""} title="Ta bort">×</button>
            </div>
            <div class="queue-row-meta">${escapeHtml(priorityLabel(item.priority))} · ${Number(item.maxInteractions || 0)} interaktioner/kvant · ${escapeHtml(progress)}${escapeHtml(delegationMeta)}</div>
          </div>`;
      }).join("")
    : '<div class="empty">Arbetslistan är tom. Lägg till ett eller flera sparade uppdrag.</div>';

  $("missionQueueHistory").innerHTML = history.length
    ? history.slice().reverse().map((item) => `
        <div class="queue-history-row ${item.status === "BLOCKED" ? "blocked" : ""}">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.status)} · ${escapeHtml(item.lastOutcome || "")}${item.completedAt ? ` · ${escapeHtml(formatTime(item.completedAt))}` : ""}</span>
          ${item.lastSummary ? `<div class="queue-row-meta">${escapeHtml(short(item.lastSummary, 500))}</div>` : ""}
          ${item.delegation?.requestId ? `<div class="queue-row-meta">EIC-delegerat från annan GFW</div>` : ""}
        </div>`).join("")
    : '<div class="empty">Ingen historik ännu.</div>';

  if (!activeItem && queueMode && runnableCount === 0 && items.length > 0) {
    $("missionQueueState").textContent = `${items.length} uppdrag · väntar på paus/blocker-cooldown`;
  }
  renderMissionQueueSets();
}

async function mutateMissionQueue(operation, payload = {}) {
  if (state.queueBusy) return null;
  state.queueBusy = true;
  renderMissionQueue();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_QUEUE_MUTATE",
      windowId: state.windowId,
      workerId: state.workerId,
      operation,
      auditSessionId: state.auditSessionId,
      ...payload
    });
    if (!result?.ok) throw new Error(result?.error || result?.code || "Arbetsköändringen misslyckades.");
    state.missionQueue = result.missionQueue || state.missionQueue;
    return result;
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
    throw error;
  } finally {
    state.queueBusy = false;
    renderMissionQueue();
  }
}

async function mutateMissionQueueSet(operation, payload = {}) {
  if (state.queueSetBusy || !state.workerId) return null;
  state.queueSetBusy = true;
  renderMissionQueueSets();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_QUEUE_SET_MUTATE",
      windowId: state.windowId,
      workerId: state.workerId,
      operation,
      auditSessionId: state.auditSessionId,
      ...payload
    });
    if (!result?.ok) throw new Error(result?.error || result?.code || "Kö-set kunde inte ändras.");
    state.missionQueue = result.missionQueue || state.missionQueue;
    state.missionQueueSets = Array.isArray(result.missionQueueSets) ? result.missionQueueSets : state.missionQueueSets;
    return result;
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
    throw error;
  } finally {
    state.queueSetBusy = false;
    renderMissionQueue();
  }
}

async function saveCurrentQueueSet() {
  const name = $("queueSetName").value.trim();
  if (!name) {
    $("statusDetail").textContent = "Ange ett namn på kö-setet.";
    return;
  }
  try {
    await mutateMissionQueueSet("SAVE", { name });
    $("queueSetName").value = "";
  } catch {}
}

async function applySelectedQueueSet() {
  const setId = $("queueSetSelect").value;
  if (!setId) return;
  try {
    await mutateMissionQueueSet("APPLY", { setId });
  } catch {}
}

async function deleteSelectedQueueSet() {
  const setId = $("queueSetSelect").value;
  if (!setId) return;
  try {
    await mutateMissionQueueSet("DELETE", { setId });
  } catch {}
}

async function addSelectedMissionToQueue() {
  const select = $("queueSavedMissionSelect");
  const selectedIds = [...select.selectedOptions]
    .map((option) => option.value)
    .filter(Boolean);
  if (selectedIds.length === 0) return;
  const missions = state.operatorSettings?.savedMissions || [];
  try {
    for (const id of selectedIds) {
      const mission = missions.find((item) => item.id === id);
      if (!mission) continue;
      await mutateMissionQueue("ADD", {
        savedMissionId: mission.id,
        label: mission.label,
        goal: mission.goal,
        priority: DEFAULT_GREENFIELD_PRIORITY,
        maxInteractions: Number(
          state.operatorSettings?.defaultMissionQuantumInteractions ?? DEFAULT_MISSION_QUANTUM_INTERACTIONS
        )
      });
    }
  } catch {}
}

async function startMissionQueue() {
  if (state.queueBusy || activeProcess(state.process)) return;
  state.queueBusy = true;
  $("statusDetail").textContent = "Förbereder arbetskö, Nano och Hjalmar D2…";
  renderMissionQueue();
  try {
    await ensureAnalyzerReadyFromGesture();
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_QUEUE_START",
      windowId: state.windowId,
      workerId: state.workerId,
      auditSessionId: state.auditSessionId
    });
    if (!result?.ok) throw new Error(result?.error || result?.code || "Arbetskön kunde inte startas.");
    state.process = result.process || state.process;
    state.missionQueue = result.missionQueue || state.missionQueue;
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
    await appendAuditError({
      error,
      scope: "WINDOW",
      auditSessionId: state.auditSessionId,
      windowId: state.windowId,
      kind: "MISSION_QUEUE_UI_START_ERROR",
      component: "sidepanel"
    }).catch(() => undefined);
  } finally {
    state.queueBusy = false;
    await snapshot();
  }
}

async function stopMissionQueueUi() {
  if (state.queueBusy) return;
  state.queueBusy = true;
  renderMissionQueue();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_QUEUE_STOP",
      windowId: state.windowId,
      workerId: state.workerId,
      auditSessionId: state.auditSessionId,
      reason: "OPERATOR_QUEUE_STOP"
    });
    if (!result?.ok) throw new Error(result?.error || result?.code || "Arbetskön kunde inte stoppas.");
    state.process = result.process || state.process;
    state.missionQueue = result.missionQueue || state.missionQueue;
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
  } finally {
    state.queueBusy = false;
    await snapshot();
  }
}

async function saveQueueSettings() {
  if (state.operatorSettingsBusy) return;
  // Capture operator input before rendering the busy state. renderOperatorSettings() writes
  // state.operatorSettings back into the controls, so reading the controls after that call
  // would silently submit the previous/default values.
  const patch = {
    defaultMissionQuantumInteractions: Number($("defaultMissionQuantumInteractions").value),
    queuePriorityAgingSeconds: Number($("queuePriorityAgingSeconds").value),
    queueSwitchDelaySeconds: Number($("queueSwitchDelaySeconds").value),
    queueSwitchHardReload: $("queueSwitchHardReload").checked === true,
    queueSwitchSettleSeconds: Number($("queueSwitchSettleSeconds").value)
  };
  state.operatorSettingsBusy = true;
  renderOperatorSettings();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_SET_QUEUE_SETTINGS",
      windowId: state.windowId,
      workerId: state.workerId,
      ...patch
    });
    if (!result?.ok) throw new Error(result?.error || result?.code || "Grundparametrarna kunde inte sparas.");
    state.operatorSettings = result.operatorSettings || state.operatorSettings;
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
  } finally {
    state.operatorSettingsBusy = false;
    renderOperatorSettings();
  }
}

async function handleQueueListClick(event) {
  const button = event.target.closest("[data-queue-action]");
  if (!button || button.disabled) return;
  const row = button.closest("[data-item-id]");
  const itemId = row?.dataset.itemId || "";
  if (!itemId) return;
  const action = button.dataset.queueAction;
  try {
    if (action === "up") await mutateMissionQueue("MOVE_UP", { itemId });
    else if (action === "down") await mutateMissionQueue("MOVE_DOWN", { itemId });
    else if (action === "remove") await mutateMissionQueue("REMOVE", { itemId });
  } catch {}
}

async function handleQueueListChange(event) {
  const field = event.target.dataset.queueField;
  if (!field) return;
  const row = event.target.closest("[data-item-id]");
  const itemId = row?.dataset.itemId || "";
  if (!itemId) return;
  const item = (state.missionQueue?.items || []).find((entry) => entry.itemId === itemId);
  if (!item) return;
  const patch = {
    itemId,
    priority: field === "priority" ? event.target.value : item.priority,
    maxInteractions: field === "maxInteractions" ? Number(event.target.value) : item.maxInteractions
  };
  try {
    await mutateMissionQueue("UPDATE", patch);
  } catch {}
}


async function render() {
  renderFleetStatus();
  const process = state.process;
  const active = activeProcess(process);
  $("phase").textContent = process?.phase || "IDLE";
  $("turn").textContent = process?.turn ?? "—";
  $("statusDetail").textContent = statusText(process);
  const missionPauseMs = missionPauseRemainingMs(process);
  const pauseMs = promptPauseRemainingMs(process);
  const configuredDelay = Number(state.operatorSettings?.postDelaySeconds || 0);
  const pauseState = String(process?.missionPause?.state || "");
  $("missionPauseStatus").textContent = process?.phase === PHASES.PAUSED
    ? `Mission pause aktiv · ${formatMissionCountdown(missionPauseMs)} kvar · väcktid ${formatTime(process?.missionPause?.resumeNotBeforeAt)} · processlokal`
    : pauseState.startsWith("RESUMED")
      ? `Mission pause senast ${pauseState === "RESUMED_EARLY" ? "återupptagen manuellt" : "återupptagen enligt väcktid"}`
      : "Mission pause inactive · EIC-controlled 5 min–24 h";
  $("missionPauseStatus").classList.toggle("active", process?.phase === PHASES.PAUSED);
  const rateLimit = state.globalPromptGate?.rateLimit || null;
  if (rateLimit?.state === "COOLDOWN") {
    const remaining = Math.max(0, Number(rateLimit.cooldownUntilMs || 0) - Date.now());
    $("promptPauseStatus").textContent =
      `Rate-limit cooldown · ${formatCountdown(remaining)} kvar · nivå ${Number(rateLimit.level || 1)} · epoch ${Number(rateLimit.epoch || 0)} · global i Chrome-profilen`;
  } else if (rateLimit?.state === "SERIAL_RECOVERY") {
    const remaining = Math.max(0, Number(rateLimit.nextSerialNotBeforeAtMs || 0) - Date.now());
    $("promptPauseStatus").textContent =
      `Seriell recovery · ${formatCountdown(remaining)} till nästa release · ${Number(rateLimit.serialSuccessCount || 0)}/6 lyckade poster · epoch ${Number(rateLimit.epoch || 0)}`;
  } else {
    $("promptPauseStatus").textContent = pauseMs > 0
      ? `Promptpaus aktiv · ${formatCountdown(pauseMs)} kvar · global i Chrome-profilen`
      : `Promptpaus ${configuredDelay} s · global i Chrome-profilen`;
  }
  $("promptPauseStatus").classList.toggle(
    "active",
    pauseMs > 0 || rateLimit?.state === "COOLDOWN" || rateLimit?.state === "SERIAL_RECOVERY"
  );
  $("schedulerStatus").textContent = schedulerStatusText(process);
  $("schedulerStatus").classList.toggle(
    "active",
    Boolean(
      state.globalCapacityScheduler?.waitingCount ||
      state.globalCapacityScheduler?.activeCount ||
      state.globalCapacityScheduler?.effectiveCapacity !== state.globalCapacityScheduler?.configuredCapacity
    )
  );
  $("continuityLamp").classList.toggle("active", active);
  $("startCard").classList.toggle("hidden", active);
  $("activeCard").classList.toggle("hidden", !process);
  $("goalPreview").textContent = process?.goal || "";
  $("updatedAt").textContent = process ? `Senast commit ${formatTime(process.updatedAt)}` : "—";
  $("responsePreview").textContent = short(process?.lastResponse?.text || "—");

  const nanoView = {};
  if (process?.lastNanoTask) {
    nanoView.task = {
      requestId: process.lastNanoTask.requestId || "",
      status: process.lastNanoTask.status || "",
      semanticStatus: process.lastNanoTask.semanticStatus || "UNVERIFIED",
      promptLanguage: process.lastNanoTask.promptLanguage || "",
      promptPolicy: process.lastNanoTask.promptPolicy || "",
      sourceTask: short(process.lastNanoTask.sourceTask || process.lastNanoTask.task || "", 1600),
      result: short(process.lastNanoTask.result || "", 2400),
      error: short(process.lastNanoTask.error || "", 1200)
    };
  }
  if (process?.lastNano) {
    nanoView.observer = {
      summary: short(process.lastNano.summary || "", 1600),
      confidence: process.lastNano.confidence || "",
      continuityRisk: process.lastNano.continuityRisk || "",
      recommendedFocus: short(process.lastNano.recommendedFocus || "", 1600)
    };
  }
  $("nanoPreview").textContent = Object.keys(nanoView).length
    ? JSON.stringify(nanoView, null, 2)
    : "—";

  $("decisionPreview").textContent = process?.lastDecision
    ? JSON.stringify(process.lastDecision, null, 2)
    : "—";
  $("continuityText").textContent = process?.phase === PHASES.RECOVERING
    ? "Continuity recovering"
    : process?.phase === PHASES.ROTATING
      ? "Continuity rotating session"
      : process?.phase === PHASES.PAUSED
        ? "Continuity paused until scheduled wake"
        : process?.phase === PHASES.DETACHED
          ? "Continuity detached"
          : active
            ? "Continuity active"
            : "Continuity inactive";

  const instructionText = state.nextInstruction?.text || "";
  if (document.activeElement !== $("nextInstruction")) {
    $("nextInstruction").value = instructionText;
  }
  $("instructionState").textContent = instructionText ? "ARMED · nästa prompt" : "Tom";
  $("instructionState").classList.toggle("armed", Boolean(instructionText));
  $("nextInstruction").disabled = !active || state.instructionBusy;
  $("queueInstruction").disabled = !active || state.instructionBusy;
  $("clearInstruction").disabled = !active || state.instructionBusy || !instructionText;

  for (const node of document.querySelectorAll(".rail [data-stage]")) {
    const stage = node.dataset.stage;
    const stageActive = stage === "PROMPT_PAUSE"
      ? pauseMs > 0 && process?.phase !== PHASES.PAUSED
      : stage === "PAUSED"
        ? process?.phase === PHASES.PAUSED
        : process?.phase === stage && pauseMs === 0;
    node.classList.toggle("active", stageActive);
  }
  renderOperatorSettings();
  renderMissionQueue();
  $("resumePause").disabled = process?.phase !== PHASES.PAUSED || state.busy;
  $("stop").disabled = !active || state.busy;
  $("tick").disabled = !active || state.busy;
  await renderAudit();
}

async function snapshot() {
  if (!Number.isInteger(state.windowId)) return;
  const result = await chrome.runtime.sendMessage({
    type: "EIC_GF_GET_SNAPSHOT",
    windowId: state.windowId,
    workerId: state.workerId
  });
  if (result?.ok) {
    state.workerId = String(result.workerId || state.workerId || "");
    state.process = result.process || null;
    state.nextInstruction = result.nextInstruction || null;
    state.globalPromptGate = result.globalPromptGate || null;
    state.globalCapacityScheduler = result.globalCapacityScheduler || null;
    state.missionQueue = result.missionQueue || null;
    state.missionQueueSets = Array.isArray(result.missionQueueSets) ? result.missionQueueSets : [];
    state.fleetStatus = result.fleetStatus || null;
    if (result.audit) state.audit = result.audit;
  }
  if (!result?.ok) $("opsDetail").textContent=result?.error || "Kunde inte läsa driftdata";
  await render();
}

async function ensureAnalyzerReadyFromGesture() {
  if (!globalThis.LanguageModel?.create) {
    const error = new Error("Chrome local LanguageModel saknas. Greenfield kräver Chrome med Prompt API/LanguageModel.");
    error.code = "LANGUAGE_MODEL_UNAVAILABLE";
    await appendAuditError({
      error,
      scope: "WINDOW",
      auditSessionId: state.auditSessionId,
      windowId: state.windowId,
      kind: "LANGUAGE_MODEL_PREFLIGHT_ERROR",
      component: "sidepanel-model"
    }).catch(() => undefined);
    throw error;
  }

  let session = null;
  const systemPrompt = "Return READY only in English.";
  const monitor = (monitor) => {
    monitor.addEventListener?.("downloadprogress", (event) => {
      const loaded = Number(event.loaded ?? 0);
      $("statusDetail").textContent = `Förbereder Nano + Hjalmar D2 · model download ${Math.round(loaded * 100)}%`;
      void appendAudit({
        scope: "WINDOW",
        auditSessionId: state.auditSessionId,
        windowId: state.windowId,
        kind: "LANGUAGE_MODEL_DOWNLOAD_PROGRESS",
        component: "sidepanel-model",
        payload: { loaded }
      }).catch(() => undefined);
    });
  };

  const primary = modelCreateOptions({ systemPrompt, monitor });
  // Chrome's first LanguageModel activation must originate directly from the
  // operator gesture. Invoke create() before the first await in this path.
  let createPromise;
  try {
    createPromise = LanguageModel.create(primary);
  } catch (error) {
    await appendAuditError({
      error,
      scope: "WINDOW",
      auditSessionId: state.auditSessionId,
      windowId: state.windowId,
      kind: "LANGUAGE_MODEL_PREFLIGHT_CREATE_SYNC_ERROR",
      component: "sidepanel-model",
      payload: { options: primary }
    }).catch(() => undefined);
    throw error;
  }

  void appendAudit({
    scope: "WINDOW",
    auditSessionId: state.auditSessionId,
    windowId: state.windowId,
    kind: "LANGUAGE_MODEL_PREFLIGHT_CREATE_ATTEMPT",
    component: "sidepanel-model",
    payload: { options: primary, userGestureDirect: true }
  }).catch(() => undefined);

  try {
    session = await createPromise;
    await appendAudit({
      scope: "WINDOW",
      auditSessionId: state.auditSessionId,
      windowId: state.windowId,
      kind: "LANGUAGE_MODEL_PREFLIGHT_CREATE_OK",
      component: "sidepanel-model",
      payload: { expectedOutputLanguage: "en", userGestureDirect: true }
    });

    const answer = String(await session.prompt("READY") ?? "").trim();
    await appendAudit({
      scope: "WINDOW",
      auditSessionId: state.auditSessionId,
      windowId: state.windowId,
      kind: "LANGUAGE_MODEL_PREFLIGHT_PROMPT_RESULT",
      component: "sidepanel-model",
      payload: { answer }
    });
    if (!answer) {
      const error = new Error("Hjalmar/Nano model preflight gav inget svar.");
      error.code = "LANGUAGE_MODEL_PREFLIGHT_EMPTY";
      throw error;
    }
  } catch (error) {
    await appendAuditError({
      error,
      scope: "WINDOW",
      auditSessionId: state.auditSessionId,
      windowId: state.windowId,
      kind: "LANGUAGE_MODEL_PREFLIGHT_ERROR",
      component: "sidepanel-model"
    }).catch(() => undefined);
    throw error;
  } finally {
    try { session?.destroy?.(); } catch (error) {
      await appendAuditError({
        error,
        scope: "WINDOW",
        auditSessionId: state.auditSessionId,
        windowId: state.windowId,
        kind: "LANGUAGE_MODEL_PREFLIGHT_DESTROY_ERROR",
        component: "sidepanel-model"
      }).catch(() => undefined);
    }
  }
}

async function start() {
  if (state.busy) return;
  const goal = $("goal").value.trim();
  if (!goal) {
    $("statusDetail").textContent = "Skriv ett uppdrag först.";
    return;
  }
  state.busy = true;
  $("start").disabled = true;
  $("statusDetail").textContent = "Förbereder forensisk Audit, Nano och Hjalmar D2…";
  try {
    await ensureAnalyzerReadyFromGesture();
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_START",
      windowId: state.windowId,
      workerId: state.workerId,
      goal,
      auditSessionId: state.auditSessionId,
      schedulerPriority: state.startSchedulerPriority
    });
    if (!result?.ok) throw new Error(result?.error || result?.code || "Start misslyckades.");
    state.process = result.process;
    await chrome.runtime.sendMessage({
      type: "EIC_GF_UI_EVENT",
      windowId: state.windowId,
      workerId: state.workerId,
      kind: "UI_START_CONFIRMED",
      auditSessionId: state.auditSessionId,
      payload: { existing: result.existing === true }
    });
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
    await appendAuditError({
      error,
      scope: "WINDOW",
      auditSessionId: state.auditSessionId,
      windowId: state.windowId,
      kind: "UI_START_ERROR",
      component: "sidepanel"
    }).catch(() => undefined);
  } finally {
    state.busy = false;
    $("start").disabled = false;
    await snapshot();
  }
}

async function setNextInstruction(instruction) {
  if (state.instructionBusy || !activeProcess(state.process)) return;
  state.instructionBusy = true;
  await render();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_SET_NEXT_INSTRUCTION",
      windowId: state.windowId,
      workerId: state.workerId,
      instruction
    });
    if (!result?.ok) throw new Error(result?.error || result?.code || "Tilläggsinstruktionen kunde inte sparas.");
    state.process = result.process || state.process;
    state.nextInstruction = result.nextInstruction || null;
    if (!state.nextInstruction) $("nextInstruction").value = "";
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
  } finally {
    state.instructionBusy = false;
    await snapshot();
  }
}

async function queueInstruction() {
  const value = $("nextInstruction").value.trim();
  if (!value) {
    $("statusDetail").textContent = "Skriv en tilläggsinstruktion först.";
    return;
  }
  await setNextInstruction(value);
}

async function clearInstruction() {
  await setNextInstruction("");
  $("nextInstruction").value = "";
}

async function stop() {
  if (state.busy || !state.process) return;
  state.busy = true;
  await render();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_STOP",
      windowId: state.windowId,
      workerId: state.workerId,
      reason: "OPERATOR_STOP"
    });
    if (!result?.ok) throw new Error(result?.error || "Stop misslyckades.");
    state.process = result.process;
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
  } finally {
    state.busy = false;
    await snapshot();
  }
}

async function resumePauseNow() {
  if (state.busy || state.process?.phase !== PHASES.PAUSED) return;
  state.busy = true;
  await render();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_RESUME_PAUSE_NOW",
      windowId: state.windowId,
      workerId: state.workerId,
      reason: "OPERATOR_RESUME_NOW"
    });
    if (!result?.ok) throw new Error(result?.error || result?.code || "Mission pause kunde inte återupptas.");
    state.process = result.process || state.process;
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
  } finally {
    state.busy = false;
    await snapshot();
  }
}

async function forceTick() {
  if (state.busy || !state.process) return;
  state.busy = true;
  await render();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_FORCE_TICK",
      windowId: state.windowId,
      workerId: state.workerId
    });
    if (result?.ok) state.process = result.process;
  } finally {
    state.busy = false;
    await snapshot();
  }
}

async function setAuditPreference() {
  if (state.auditBusy || !Number.isInteger(state.windowId)) return;
  const requested = $("auditEnabled").checked === true;
  state.auditBusy = true;
  await renderAudit();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_SET_AUDIT_ENABLED",
      windowId: state.windowId,
      workerId: state.workerId,
      enabled: requested,
      auditSessionId: state.auditSessionId
    });
    if (!result?.ok) throw new Error(result?.error || "AUDIT_SETTING_UPDATE_FAILED");
    if (result.audit) state.audit = result.audit;
  } catch (error) {
    $("statusDetail").textContent = error?.message || String(error);
    $("auditEnabled").checked = state.audit?.enabled === true;
  } finally {
    state.auditBusy = false;
    await renderAudit();
  }
}

async function exportAudit() {
  if (state.audit?.enabled !== true) return;
  const filter = state.process
    ? {
        processId: state.process.processId,
        auditSessionId: state.process.auditSessionId || state.auditSessionId,
        windowId: state.windowId,
        since: state.process.startedAt || "",
        includeWindowPrelude: true,
        includeAppEvents: true
      }
    : {
        auditSessionId: state.auditSessionId,
        windowId: state.windowId,
        includeWindowPrelude: true
      };
  const ndjson = await auditAsNdjson(filter);
  const blob = new Blob([ndjson], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const owner = state.process?.processId || `window-${state.windowId ?? "unknown"}`;
  link.href = url;
  link.download = `eic-greenfield-audit-${owner}-${stamp}.ndjson`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  await appendAudit({
    scope: state.process ? "RUN" : "WINDOW",
    process: state.process,
    auditSessionId: state.auditSessionId,
    windowId: state.windowId,
    kind: "AUDIT_EXPORTED",
    component: "sidepanel",
    payload: { owner, bytes: ndjson.length }
  }).catch(() => undefined);
  await renderAudit();
}

async function saveWorkModeSettings() {
  if (state.operatorSettingsBusy) return;
  state.operatorSettingsBusy = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_SET_WORK_MODE",
      windowId: state.windowId,
      workerId: state.workerId,
      enabled: $("workModeEnabled").checked === true,
      endpoint: $("workModeEndpoint").value
    });
    if (!result?.ok) throw new Error(result?.error || result?.code || "Arbetsläge kunde inte sparas.");
    if (result.operatorSettings) state.operatorSettings = result.operatorSettings;
    $("workModeDetail").textContent = state.operatorSettings.workModeEnabled
      ? "Arbetsläge aktivt. Nano/runtime synkar WMT-förkön under aktiva Greenfield-ticks."
      : "Arbetsläge avstängt.";
  } catch (error) {
    $("workModeDetail").textContent = error?.message || String(error);
  } finally {
    state.operatorSettingsBusy = false;
    renderOperatorSettings();
  }
}

async function syncWorkModeNow() {
  if (!activeProcess(state.process)) {
    $("workModeDetail").textContent = "En aktiv Greenfield-process krävs för att binda Arbetsläge till rätt worker.";
    return;
  }
  try {
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_WORK_MODE_SYNC",
      windowId: state.windowId,
      workerId: state.workerId
    });
    $("workModeDetail").textContent = result?.ok
      ? `Synk: ${result.state || "OK"}${result.taskRef ? ` · ${result.taskRef}` : ""}`
      : `Synkfel: ${result?.state || result?.code || result?.error || "UNKNOWN"}`;
    await snapshot();
  } catch (error) {
    $("workModeDetail").textContent = error?.message || String(error);
  }
}

$("overviewTabButton").addEventListener("click", () => setUiTab("overview"));
$("runtimeTabButton").addEventListener("click", () => setUiTab("runtime"));
$("missionsTabButton").addEventListener("click", () => setUiTab("missions"));
$("workModeTabButton").addEventListener("click", () => setUiTab("workmode"));
$("saveWorkMode").addEventListener("click", saveWorkModeSettings);
$("syncWorkMode").addEventListener("click", syncWorkModeNow);
$("queueSavedMissionSelect").addEventListener("change", renderOperatorSettings);
$("queueAddMission").addEventListener("click", addSelectedMissionToQueue);
$("queueSetSelect").addEventListener("change", renderMissionQueueSets);
$("queueSetName").addEventListener("input", renderMissionQueueSets);
$("queueSetSave").addEventListener("click", saveCurrentQueueSet);
$("queueSetApply").addEventListener("click", applySelectedQueueSet);
$("queueSetDelete").addEventListener("click", deleteSelectedQueueSet);
$("queueStart").addEventListener("click", startMissionQueue);
$("queueStop").addEventListener("click", stopMissionQueueUi);
$("queueClearHistory").addEventListener("click", () => {
  void mutateMissionQueue("CLEAR_HISTORY").catch(() => undefined);
});
$("saveQueueSettings").addEventListener("click", saveQueueSettings);
$("missionQueueList").addEventListener("click", (event) => {
  void handleQueueListClick(event);
});
$("missionQueueList").addEventListener("change", (event) => {
  void handleQueueListChange(event);
});

$("start").addEventListener("click", start);
$("stop").addEventListener("click", stop);
$("resumePause").addEventListener("click", resumePauseNow);
$("tick").addEventListener("click", forceTick);
$("queueInstruction").addEventListener("click", queueInstruction);
$("clearInstruction").addEventListener("click", clearInstruction);
$("exportAudit").addEventListener("click", exportAudit);
$("auditEnabled").addEventListener("change", setAuditPreference);
$("postDelay").addEventListener("input", () => {
  $("postDelayValue").textContent = `${Number($("postDelay").value || 0)} s`;
});
$("postDelay").addEventListener("change", updatePostDelay);
$("maxActiveSessions").addEventListener("input", () => {
  $("maxActiveSessionsValue").textContent = String(
    Number($("maxActiveSessions").value || DEFAULT_MAX_ACTIVE_SESSIONS)
  );
});
$("maxActiveSessions").addEventListener("change", updateMaxActiveSessions);
$("schedulerPriority").addEventListener("change", updateSchedulerPriority);
$("saveMission").addEventListener("click", saveCurrentMission);
$("savedMissionSelect").addEventListener("change", renderOperatorSettings);
$("loadSavedMission").addEventListener("click", loadSelectedMission);
$("deleteSavedMission").addEventListener("click", deleteSelectedMission);
$("goal").addEventListener("input", renderOperatorSettings);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "EIC_GF_AUDIT_CHANGED") {
    if (message.windowId !== state.windowId) return;
    if (message.audit) state.audit = message.audit;
    void renderAudit();
    return;
  }
  if (message?.type !== "EIC_GF_SNAPSHOT_CHANGED") return;
  const messageWorkerId = String(
    message.workerId ||
    message.process?.workerId ||
    message.missionQueue?.workerId ||
    ""
  );
  if (messageWorkerId && state.workerId && messageWorkerId !== state.workerId) return;
  if (Number.isInteger(message.process?.windowId) && message.process.windowId !== state.windowId) return;
  if (messageWorkerId && !state.workerId) state.workerId = messageWorkerId;
  state.process = message.process || null;
  state.nextInstruction = message.nextInstruction || null;
  if (message.audit) state.audit = message.audit;
  if (message.missionQueue) state.missionQueue = message.missionQueue;
  if (Array.isArray(message.missionQueueSets)) state.missionQueueSets = message.missionQueueSets;
  if (message.fleetStatus) state.fleetStatus = message.fleetStatus;
  if (!state.nextInstruction) $("nextInstruction").value = "";
  void render();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes["eic.gf.operator.settings.v1"]) {
    void refreshOperatorSettings()
      .then(() => snapshot())
      .catch(() => undefined);
  }
  if (changes["eic.gf.global-capacity-scheduler.v1"]) {
    void snapshot().catch(() => undefined);
  }
  if (state.workerId &&
      changes[`eic.gf.mission-work-queue.worker.${state.workerId}`]) {
    void snapshot().catch(() => undefined);
  }
  if (changes["eic.gf.mission-queue-sets.v1"]) {
    void snapshot().catch(() => undefined);
  }
});

let fleetPollBusy=false;
setInterval(async()=>{
  if (fleetPollBusy || document.visibilityState!=="visible") return;
  fleetPollBusy=true;
  try { await snapshot(); } catch { renderFleetStatus(); } finally { fleetPollBusy=false; }
},5000);
setInterval(()=>renderFleetStatus(),1000);

async function safetyAction(type,extra={}) {
  try {
    const result=await chrome.runtime.sendMessage({type,windowId:state.windowId,...extra});
    if (!result?.ok) throw new Error(result?.code || result?.error || "Kontrollen misslyckades");
    if (result.fleetStatus) state.fleetStatus=result.fleetStatus;
    if (result.inspection) {
      const modelText=result.inspection.model || (result.inspection.allowed ? "Modellnamn ej exponerat" : "Modell okänd");
      const effortText=result.inspection.effort || (result.inspection.allowed ? "Reasoning-kontroll verifierad" : "Tänkenivå okänd");
      $("safetyActionResult").textContent=`${reasonLabel(result.inspection.code)} · ${modelText} · ${effortText}`;
    } else {
      $("safetyActionResult").textContent="Ändringen är sparad.";
    }
    $("opsActionResult").textContent=$("safetyActionResult").textContent;
    renderFleetStatus();
    return result;
  } catch(error) {
    $("safetyActionResult").textContent=reasonLabel(error.message);
    $("opsActionResult").textContent=reasonLabel(error.message);
    $("opsDetail").textContent=reasonLabel(error.message);
    throw error;
  }
}
$("admissionPause").addEventListener("click",()=>{ void safetyAction("EIC_GF_SAFETY_PAUSE",{paused:!state.fleetStatus?.safety?.admissionPaused}).catch(()=>undefined); });
$("modelRecheck").addEventListener("click",()=>{ void safetyAction("EIC_GF_SAFETY_RECHECK").catch(()=>undefined); });
$("recoveryScan").addEventListener("click",()=>{ void safetyAction("EIC_GF_RECOVERY_SCAN").catch(()=>undefined); });
$("inspectActiveModel").addEventListener("click",()=>{ void safetyAction("EIC_GF_SAFETY_INSPECT").catch(()=>undefined); });
$("exportDiagnostics").addEventListener("click",()=>{
  void safetyAction("EIC_GF_EXPORT_DIAGNOSTICS").then(result=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(result.diagnostics,null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download=`Greenfield-diagnostics-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $("opsActionResult").textContent="Diagnostiken har lämnats till Chromes nedladdning. Filen innehåller sparade uppdragsdata; kontrollera att den sparades.";
  }).catch(()=>undefined);
});
$("safetyPolicyForm").addEventListener("input",()=>{state.safetyPolicyDirty=true;});
$("safetyPolicyForm").addEventListener("submit",event=>{
  event.preventDefault();
  const policy={requiredModel:$("requiredModel").value,minimumEffort:$("minimumEffort").value};
  for (const key of ["messages3h","messages24h","messages7d","minGapSeconds","tokens24h","maxPromptTokens","outputReserveTokens"]) policy[key]=Number($(key).value);
  void safetyAction("EIC_GF_SAFETY_UPDATE",{policy}).then(()=>{state.safetyPolicyDirty=false;}).catch(()=>undefined);
});
$("vacationPreset").addEventListener("click",()=>{
  for (const [key,value] of Object.entries({messages3h:12,messages24h:48,messages7d:240,minGapSeconds:300,tokens24h:500000})) $(key).value=String(value);
  state.safetyPolicyDirty=true;
  $("safetyActionResult").textContent="Semesterprofilen är ifylld. Spara körkrav för att tillämpa.";
});
$("exportRecovery").addEventListener("click",()=>{
  void safetyAction("EIC_GF_EXPORT_RECOVERY").then(result=>{
    const blob=new Blob([JSON.stringify(result.backup,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download=`Greenfield-recovery-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
    link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $("backupResult").textContent="Nya utskick är pausade. Kopian har lämnats till Chromes nedladdning; kontrollera att filen sparades.";
  }).catch(error=>{$("backupResult").textContent=reasonLabel(error.message);});
});
$("importRecovery").addEventListener("click",()=>$("importRecoveryFile").click());
$("importRecoveryFile").addEventListener("change",async event=>{
  const file=event.target.files?.[0];event.target.value="";if(!file)return;
  try {
    if(file.size>32*1024*1024)throw Error("BACKUP_SIZE_INVALID");
    const backupJson=await file.text();JSON.parse(backupJson);
    const result=await safetyAction("EIC_GF_IMPORT_RECOVERY",{backupJson});
    $("backupResult").textContent=`Återläst pausat: ${result.restored.processes} processer och ${result.restored.queues} köer. Kontrollera tidigare effekter i EIC innan du startar nytt arbete.`;
  }catch(error){$("backupResult").textContent=reasonLabel(error.message);}
});

setInterval(() => {
  if (promptPauseRemainingMs(state.process) > 0 ||
      missionPauseRemainingMs(state.process) > 0 ||
      state.process?.phase === PHASES.PAUSED) {
    void render();
  }
}, 1000);

window.addEventListener("error", (event) => {
  void appendAuditError({
    error: event?.error || new Error(event?.message || "Sidepanel error"),
    scope: "WINDOW",
    auditSessionId: state.auditSessionId,
    windowId: state.windowId,
    kind: "SIDEPANEL_UNHANDLED_ERROR",
    component: "sidepanel"
  }).catch(() => undefined);
});

window.addEventListener("unhandledrejection", (event) => {
  void appendAuditError({
    error: event?.reason || new Error("Sidepanel unhandled rejection"),
    scope: "WINDOW",
    auditSessionId: state.auditSessionId,
    windowId: state.windowId,
    kind: "SIDEPANEL_UNHANDLED_REJECTION",
    component: "sidepanel"
  }).catch(() => undefined);
});

(async () => {
  try {
    const current = await chrome.windows.getCurrent();
    state.windowId = current.id;
    await refreshOperatorSettings();
    await appendAudit({
      scope: "WINDOW",
      auditSessionId: state.auditSessionId,
      windowId: state.windowId,
      kind: "SIDEPANEL_SESSION_STARTED",
      component: "sidepanel",
      payload: { appVersion: "1.7.6" }
    });
    await snapshot();
  } catch (error) {
    await appendAuditError({
      error,
      scope: "WINDOW",
      auditSessionId: state.auditSessionId,
      windowId: state.windowId,
      kind: "SIDEPANEL_BOOT_ERROR",
      component: "sidepanel"
    }).catch(() => undefined);
    $("statusDetail").textContent = error?.message || String(error);
  }
})();
