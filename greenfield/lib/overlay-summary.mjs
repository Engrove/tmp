import { GREENFIELD_PRIORITY_LABELS, normalizeGreenfieldPriority } from "./global-capacity-scheduler.mjs";
import { selectNextMissionItem } from "./mission-work-queue.mjs";
import { queuePlanningFields } from "./queue-planning.mjs";
import { WAITING_REFRESH_ACTIONS, waitingRefreshSchedule } from "./waiting-refresh.mjs";
import { queueItemNextRunnableAtMs, scheduleClosesAtMs } from "./queue-schedule.mjs";
import { tabHealthStatusSv } from "./tab-health.mjs";
import { gfwIdentityInText } from "./gfw-identity.mjs";

// v1.7.9 operator overview for the in-page overlay. Pure: derived from process
// state plus an optional read-only queue snapshot. Countdowns are sent as
// absolute times so the content script can tick them locally between syncs.

const PHASE_TEXT = Object.freeze({
  SENDING: "Förbereder utskick",
  ANALYZING: "Analyserar svaret",
  ROTATING: "Byter till ny chatt",
  RECOVERING: "Återhämtning pågår",
  DETACHED: "Fliken är frånkopplad",
  QUEUE_WAIT: "Kön väntar på körbar köplats"
});

const STEP_TEXT = Object.freeze({
  [WAITING_REFRESH_ACTIONS.F5]: "F5",
  [WAITING_REFRESH_ACTIONS.CTRL_F5]: "Ctrl-F5"
});

function firstLine(value, max = 80) {
  return String(value || "").split(/\r?\n/, 1)[0].trim().slice(0, max);
}

/** "Projekt: 59 - ... - Gf: GF-002." -> "GF-002"; empty when no GFW id is present. */
export function gfwIdentity(value) {
  return gfwIdentityInText(String(value || "").split(/\r?\n/, 1)[0]);
}

function missionName(item, process) {
  return gfwIdentity(item?.label) ||
    gfwIdentity(item?.goal) ||
    gfwIdentity(process?.goal) ||
    firstLine(item?.label || process?.goal, 40) ||
    "Uppdrag";
}

function sortedSlots(queue) {
  return (Array.isArray(queue?.items) ? queue.items : [])
    .slice()
    .sort((a, b) => (Number(a.order) - Number(b.order)) || String(a.itemId).localeCompare(String(b.itemId)));
}

function staleCountdown(process, rotateText, now) {
  if (process?.safety?.qualityIncident || process?.phase !== "WAITING" || process?.lastPrompt?.acknowledged !== true) return [];
  const refresh = process.waitingRefresh;
  const matches = Boolean(
    refresh &&
    refresh.promptHash === (process.lastPrompt?.hash || "") &&
    Number(refresh.turn || 0) === Number(process.turn || 0)
  );
  if (matches && Number(refresh.generationHoldUntilMs || 0) > now) {
    return [{
      template: "Generering observerad · maximal respit {t}",
      atMs: Number(refresh.generationHoldUntilMs)
    }];
  }
  const schedule = waitingRefreshSchedule({
    staleSince: matches ? refresh.staleSince : (process.lastPrompt?.sentAt || process.lastMaterialAt || process.startedAt || ""),
    stage: matches ? refresh.stage : "",
    requestedAt: matches ? refresh.requestedAt : ""
  });
  if (!schedule) return [];
  const segments = [{ template: `TTL {t} → ${rotateText}`, atMs: schedule.rotateAtMs }];
  if (schedule.nextAction !== WAITING_REFRESH_ACTIONS.ROTATE) {
    segments.push({ template: `nästa ${STEP_TEXT[schedule.nextAction]} om {t}`, atMs: schedule.nextAtMs });
  }
  return segments;
}

function earliestQueueStart(queue, now) {
  let best = null;
  for (const candidate of sortedSlots(queue)) {
    const runnableAt = queueItemNextRunnableAtMs(candidate, now);
    if (!Number.isFinite(runnableAt)) continue;
    const at = Math.max(runnableAt, Number(queue.cooldownUntilMs || 0));
    if (!best || at < best.at) best = { at, item: candidate };
  }
  return best;
}

export function managedOverlayOverview(process, { queue = null, now = Date.now() } = {}) {
  // v1.8.1: an idle queue worker shows when and with which GFW the queue resumes.
  if (process?.phase === "QUEUE_WAIT") {
    const next = queue ? earliestQueueStart(queue, now) : null;
    const wakeAtMs = next?.at || Number(process.queueWait?.nextWakeAtMs || 0);
    const ownershipRecheck = next?.item?.lastOutcome === "MISSION_OWNERSHIP_WAIT";
    const retry = ownershipRecheck || next?.item?.status === "BLOCKED" ||
      next?.item?.resume?.ownerWait?.state === "WAIT";
    const countdownText = ownershipRecheck ? "Ny ägarskapskontroll om {t}" :
      retry || !next ? "Nästa kökontroll om {t}" : "Nästa möjliga start om {t}";
    const expiredText = ownershipRecheck ? "Tid för ny ägarskapskontroll" : "Kökontroll inväntas";
    return {
      mission: `Kö väntar · ingen körbar köplats`,
      status: [
        next?.item ? `${retry ? "Omprövas" : "Nästa"}: ${missionName(next.item, null)}` : "",
        ownershipRecheck ? "Väntar på ägarskapskontroll" :
          process.queueWait?.reason ? `Orsak: ${process.queueWait.reason}` : ""
      ].filter(Boolean).join(" · "),
      phaseText: wakeAtMs && wakeAtMs <= now ? expiredText : PHASE_TEXT.QUEUE_WAIT,
      countdown: wakeAtMs > now ? [{ template: countdownText, atMs: wakeAtMs, expiredText }] : [],
      title: [
        queue?.queueId ? `Kö: ${queue.queueId}` : "",
        `Process: ${process?.processId || "?"}`,
        `Fönster ${process?.windowId ?? "?"} · Flik ${process?.tabId ?? "?"}`
      ].filter(Boolean).join("\n")
    };
  }
  const ctx = process?.queueContext?.itemId ? process.queueContext : null;
  const slots = ctx && queue?.queueId === ctx.queueId ? sortedSlots(queue) : [];
  const item = ctx ? slots.find((candidate) => candidate.itemId === ctx.itemId) || null : null;
  const name = missionName(item, process);

  let mission = `${name} · ej köstyrd`;
  let nextName = "";
  if (ctx) {
    const planning = queuePlanningFields(ctx);
    const pending = Number(ctx.pendingMaxInteractions);
    const quantum = Number.isInteger(pending) && pending > 0 && pending !== planning.maxInteractions
      ? `kvant ${planning.maxInteractions} → ${pending} nästa`
      : `kvant ${planning.maxInteractions}`;
    const position = item ? `${slots.indexOf(item) + 1}/${slots.length}` : "?";
    const priority = GREENFIELD_PRIORITY_LABELS[normalizeGreenfieldPriority(ctx.priority)];
    mission = `${name} · Plats ${position} · ${priority} · Interaktion ${planning.interactionInQuantum}/${planning.maxInteractions} (${quantum})`;
    if (item) {
      const next = selectNextMissionItem(queue, { afterOrder: Number(item.order), excludeItemId: item.itemId });
      nextName = next ? missionName(next, null) : "";
    }
  }

  const rotateText = ctx && nextName ? `köbyte till ${nextName}` : "ny chatt";
  const countdown = staleCountdown(process, rotateText, now);
  // v1.8.1: the active slot's run window end (the slot parks after that turn).
  const windowClosesAtMs = ctx ? scheduleClosesAtMs(item?.schedule || ctx.schedule || null, now) : null;
  if (windowClosesAtMs && windowClosesAtMs > now) {
    countdown.push({ template: "körfönster stänger om {t}", atMs: windowClosesAtMs });
  }
  const pauseAtMs = Date.parse(String(process?.missionPause?.resumeNotBeforeAt || ""));
  if (!countdown.length && process?.phase === "PAUSED" && Number.isFinite(pauseAtMs)) {
    countdown.push({ template: "Paus · återupptas om {t}", atMs: pauseAtMs });
  }
  let phaseText = PHASE_TEXT[process?.phase] || "";
  if(process?.phase==='ROTATING' && process.sessionStart?.policy==='ARCHIVE_COMPOSER_AND_START') {
    phaseText='Förbereder session automatiskt';
  } else if (process?.phase === "ROTATING" && process.sessionRotation?.readinessWait?.code === "SESSION_ROTATION_COMPOSER_DRAFT_PRESENT") {
    phaseText = process.sessionRotation.readinessWait.reason === 'KNOWN_DRAFT_RECOVERY_PENDING'
      ? "Återställer verifierat Greenfield-utkast"
      : process.sessionRotation.readinessWait.reviewRequired
      ? "Utkast bevarat – ägarskap kunde inte verifieras"
      : "Kontrollerar utkast före sessionsstart";
  }
  if (process?.sessionInitialization?.status === "PENDING" &&
      ["SENDING", "WAITING"].includes(process?.phase)) {
    phaseText = process.phase === "SENDING" ? "Initierar session" : "Väntar på initieringssvar";
  } else if (process?.pendingPrompt?.transportKind === "DELIVERY_CONTINUATION") {
    phaseText = "Förbereder kort Fortsätt efter leveranstimeout";
  }
  if (!phaseText && process?.phase === "WAITING" && process?.lastPrompt?.acknowledged !== true) {
    phaseText = "Väntar på bekräftat utskick";
  }

  if (process?.safety?.qualityIncident) phaseText = "Svar i karantän · väntar på verifiering av den skickade turen";

  const profile = (process?.pendingPrompt || process?.lastPrompt)?.promptProfile?.profile || "";
  const pacing = process?.safety?.hold?.code === "LOCAL_PACING_WAIT";
  if (pacing && Number(process.safety.hold.retryAtMs) > now)
    countdown.push({ template: "Tidsvillkor för utskick om {t}", atMs: Number(process.safety.hold.retryAtMs) });
  const status = [
    `Tur ${Number(process?.turn || 0)}`,
    `Session ${Number(process?.sessionSeq || 1)}`,
    ctx ? `Aktivering #${Math.max(1, Number(ctx.activationCount || 0))}` : "",
    profile ? `Prompt ${profile}` : "",
    ctx ? `Nästa i kö: ${nextName || "ingen annan körbar"}` : "",
    pacing ? "Tidsväntan före utskick" : process?.safety?.hold?.code ? `Spärr: ${process.safety.hold.code}` : "",
    // v1.8.3: tab recovery in progress (visible once the page paints again).
    tabHealthStatusSv(process?.tabHealth)
  ].filter(Boolean).join(" · ");

  const title = [
    firstLine(item?.label || process?.goal, 200),
    ctx ? `savedMissionId: ${ctx.savedMissionId || "–"}` : "",
    ctx ? `Köplats: ${ctx.itemId}` : "",
    ctx ? `Kö: ${ctx.queueId}` : "",
    `Process: ${process?.processId || "?"}`,
    `Fönster ${process?.windowId ?? "?"} · Flik ${process?.tabId ?? "?"}`
  ].filter(Boolean).join("\n");

  return { mission, status, phaseText, countdown, title };
}
