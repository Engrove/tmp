import { GREENFIELD_PRIORITY_LABELS, normalizeGreenfieldPriority } from "./global-capacity-scheduler.mjs";
import { selectNextMissionItem } from "./mission-work-queue.mjs";
import { queuePlanningFields } from "./queue-planning.mjs";
import { WAITING_REFRESH_ACTIONS, waitingRefreshSchedule } from "./waiting-refresh.mjs";
import { queueItemNextRunnableAtMs, scheduleClosesAtMs } from "./queue-schedule.mjs";

// v1.7.9 operator overview for the in-page overlay. Pure: derived from process
// state plus an optional read-only queue snapshot. Countdowns are sent as
// absolute times so the content script can tick them locally between syncs.

const PHASE_TEXT = Object.freeze({
  SENDING: "Förbereder utskick",
  ANALYZING: "Analyserar svaret",
  ROTATING: "Byter till ny chatt",
  RECOVERING: "Återhämtning pågår",
  DETACHED: "Fliken är frånkopplad",
  QUEUE_WAIT: "Kön väntar på schemalagd köplats"
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
  const source = String(value || "");
  const tagged = source.match(/\bGf\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9])/i);
  if (tagged) return tagged[1];
  const bare = source.match(/\bGF-[A-Za-z0-9_-]*[A-Za-z0-9]/i);
  return bare ? bare[0] : "";
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

function staleCountdown(process, rotateText) {
  if (process?.phase !== "WAITING" || process?.lastPrompt?.acknowledged !== true) return [];
  const refresh = process.waitingRefresh;
  const matches = Boolean(
    refresh &&
    refresh.promptHash === (process.lastPrompt?.hash || "") &&
    Number(refresh.turn || 0) === Number(process.turn || 0)
  );
  const schedule = waitingRefreshSchedule({
    staleSince: matches ? refresh.staleSince : (process.lastPrompt?.sentAt || process.lastMaterialAt || process.startedAt || ""),
    stage: matches ? refresh.stage : ""
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
    const at = queueItemNextRunnableAtMs(candidate, now);
    if (Number.isFinite(at) && at > now && (!best || at < best.at)) best = { at, item: candidate };
  }
  return best;
}

export function managedOverlayOverview(process, { queue = null, now = Date.now() } = {}) {
  // v1.8.1: an idle queue worker shows when and with which GFW the queue resumes.
  if (process?.phase === "QUEUE_WAIT") {
    const next = queue ? earliestQueueStart(queue, now) : null;
    const wakeAtMs = next?.at || Number(process.queueWait?.nextWakeAtMs || 0);
    return {
      mission: `Kö väntar · ingen köplats inom sitt schema`,
      status: [
        next?.item ? `Nästa: ${missionName(next.item, null)}` : "",
        process.queueWait?.reason ? `Orsak: ${process.queueWait.reason}` : ""
      ].filter(Boolean).join(" · "),
      phaseText: PHASE_TEXT.QUEUE_WAIT,
      countdown: wakeAtMs > now ? [{ template: "Nästa schemalagda start om {t}", atMs: wakeAtMs }] : [],
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
  const countdown = staleCountdown(process, rotateText);
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
  if (!phaseText && process?.phase === "WAITING" && process?.lastPrompt?.acknowledged !== true) {
    phaseText = "Väntar på bekräftat utskick";
  }

  const profile = (process?.pendingPrompt || process?.lastPrompt)?.promptProfile?.profile || "";
  const status = [
    `Tur ${Number(process?.turn || 0)}`,
    `Session ${Number(process?.sessionSeq || 1)}`,
    ctx ? `Aktivering #${Math.max(1, Number(ctx.activationCount || 0))}` : "",
    profile ? `Prompt ${profile}` : "",
    ctx ? `Nästa i kö: ${nextName || "ingen annan körbar"}` : "",
    process?.safety?.hold?.code ? `Spärr: ${process.safety.hold.code}` : ""
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
