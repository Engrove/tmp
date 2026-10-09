// v1.9.3 window queue overview (operator request 2026-10-07): every
// Greenfield prompt lists the GF missions in this Chrome window's queue, their
// order, state, quantum and schedule, so the receiving EIC sees what runs and
// what waits. Read-only transport facts at prompt build time. Pure.

import { text } from "./common.mjs";
import { gfwIdentityInText } from "./gfw-identity.mjs";
import { MAX_QUEUE_ITEMS, queueTurnControl } from "./mission-work-queue.mjs";
import {
  localIso,
  nextScheduleOpenAtMs,
  normalizeQueueSchedule,
  queueItemNextRunnableAtMs,
  scheduleBlockReason,
  scheduleSummaryEn
} from "./queue-schedule.mjs";

export const WINDOW_QUEUE_OVERVIEW_SCHEMA = "eic.greenfield.window-queue-overview.v1";
export const WINDOW_QUEUE_OVERVIEW_MAX_SLOTS = MAX_QUEUE_ITEMS;

export const WINDOW_QUEUE_OVERVIEW_RULE = "Read-only overview of every slot in this Chrome window's Greenfield queue when this prompt was built, in explicit queue order. For awareness only; it changes nothing. Only the slot marked current is yours: change it only through runtimeControl (SET_SCHEDULE, SET_QUANTUM, SET_PRIORITY) and add durable work only through missionDelegations, which Greenfield appends to this same queue.";

/** First GF id in the slot label or mission text, e.g. "GF-061". */
export function gfIdOf(item = {}) {
  for (const source of [item.label, item.goal]) {
    const key = gfwIdentityInText(String(source || "").split(/\r?\n/, 1)[0]);
    if (key) return key;
  }
  return "";
}

function scheduleOverview(item, now) {
  const schedule = normalizeQueueSchedule(item?.schedule || null, { now });
  if (!schedule) return { windows: "ALWAYS_OPEN", openNow: true };
  const block = scheduleBlockReason(schedule, now);
  const nextOpen = block ? nextScheduleOpenAtMs(schedule, now) : null;
  return {
    windows: scheduleSummaryEn(schedule) || "ALWAYS_OPEN",
    ...(schedule.pauseUntilMs ? { pauseUntil: localIso(schedule.pauseUntilMs) } : {}),
    openNow: !block,
    ...(nextOpen ? { nextOpenAt: localIso(nextOpen) } : {})
  };
}

function slotOverview(item, index, { now, currentItemId, currentQuantum }) {
  const current = Boolean(currentItemId) && String(item?.itemId || "") === currentItemId;
  // Running progress lives in the process; the durable slot is updated when
  // parked. Use the same projection as control.workQueue for this slot only.
  const quantum = current ? currentQuantum : null;
  // The slot this prompt is built for is the running one, even while the
  // activation that marks it ACTIVE has not been persisted yet.
  const status = current ? "ACTIVE" : String(item?.status || "").toUpperCase();
  const nextRunnable = ["PAUSED", "BLOCKED"].includes(status) ? queueItemNextRunnableAtMs(item, now) : null;
  // Compact on purpose: this list is in every prompt. Ids are kept only for
  // the current slot (the one runtimeControl may target).
  const slot = {
    position: index + 1,
    gf: gfIdOf(item),
    label: text(item?.label || "", 80),
    status,
    ...(current ? { current: true, itemId: String(item?.itemId || "") } : {}),
    priority: String(item?.priority || "NORMAL").toUpperCase(),
    maxInteractions: quantum?.maxInteractions ?? Math.max(1, Math.floor(Number(item?.maxInteractions || 1))),
    completedInteractions: quantum?.completedInteractions ?? Math.max(0, Math.floor(Number(item?.quantumProgress || 0))),
    schedule: scheduleOverview(item, now)
  };
  if (nextRunnable) slot.nextRunnableAt = localIso(nextRunnable);
  if (item?.delegation?.requestId) slot.delegatedBy = text(item.delegation.requestId, 120);
  return slot;
}

/**
 * Overview of one window's queue. queue: the worker's mission work queue;
 * currentItemId: the slot this prompt belongs to (empty for a non-queue run).
 * currentQueueContext: live counters for that exact queue and slot, if known.
 * Returns null when the window has no queue slots.
 */
export function windowQueueOverview(queue = null, { now = Date.now(), currentItemId = "", currentQueueContext = null } = {}) {
  const items = Array.isArray(queue?.items) ? queue.items : [];
  if (!items.length) return null;
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (Number(a.item?.order ?? a.index) - Number(b.item?.order ?? b.index)) || (a.index - b.index));
  const shown = ordered.slice(0, WINDOW_QUEUE_OVERVIEW_MAX_SLOTS);
  const current = String(currentItemId || "");
  const currentQuantum = current &&
    String(currentQueueContext?.queueId || "") === String(queue?.queueId || "") &&
    String(currentQueueContext?.itemId || "") === current
    ? queueTurnControl({ queueContext: currentQueueContext }, { now })
    : null;
  return {
    schema: WINDOW_QUEUE_OVERVIEW_SCHEMA,
    queueId: String(queue?.queueId || ""),
    enabled: queue?.enabled !== false,
    slotCount: items.length,
    ...(ordered.length > shown.length ? { omittedSlots: ordered.length - shown.length } : {}),
    builtAt: localIso(now),
    rule: WINDOW_QUEUE_OVERVIEW_RULE,
    slots: shown.map(({ item }, index) => slotOverview(item, index, { now, currentItemId: current, currentQuantum }))
  };
}
