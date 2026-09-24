// v1.8.1 per-slot queue scheduler.
//
// A queue slot may carry weekly run windows in the operator's local time zone
// plus an optional one-shot pauseUntil. A slot is runnable only when it is not
// paused and, if it has windows, the current local time is inside one of them.
// An in-flight turn is never interrupted: the gate is evaluated before a slot is
// activated and after each captured response (see background.js).
//
// Pure module: every function takes explicit times; local-time arithmetic uses
// the runtime's time zone (the Chrome profile's OS zone).

export const QUEUE_SCHEDULE_SCHEMA = "eic.greenfield.queue-schedule.v1";
export const MAX_SCHEDULE_WINDOWS = 7;
export const MAX_SCHEDULE_PAUSE_DAYS = 30;
export const MAX_SCHEDULE_PAUSE_MS = MAX_SCHEDULE_PAUSE_DAYS * 24 * 60 * 60 * 1000;
export const SCHEDULE_BLOCK = Object.freeze({
  PAUSED: "SCHEDULE_PAUSED",
  OUTSIDE_WINDOW: "OUTSIDE_RUN_WINDOW"
});
export const SCHEDULE_EDITORS = Object.freeze(["OPERATOR", "AI"]);

const DAY_NAMES_EN = Object.freeze(["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
const DAY_NAMES_SV = Object.freeze(["", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"]);
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;
// Coverage chains longer than this are treated as "open" for closesAt purposes.
const MAX_CHAIN_DAYS = 8;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function minutesOf(value, { allowEndOfDay = false } = {}) {
  if (allowEndOfDay && value === "24:00") return 1440;
  const match = TIME_RE.exec(String(value ?? ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** ISO weekday of a local date: 1 = Monday .. 7 = Sunday. */
export function isoWeekday(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function localAt(date, dayOffset, minuteOfDay) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + dayOffset,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
    0,
    0
  ).getTime();
}

/**
 * Strict parse of one window {days, start, end}. Returns { ok, window } or
 * { ok:false, error }. end < start crosses midnight into the next day; end
 * "24:00" is the end of the start day; start === end is rejected.
 */
export function parseScheduleWindow(raw) {
  if (!isPlainObject(raw)) return { ok: false, error: "WINDOW_NOT_OBJECT" };
  const extra = Object.keys(raw).find((key) => !["days", "start", "end"].includes(key));
  if (extra) return { ok: false, error: `WINDOW_UNKNOWN_FIELD:${String(extra).slice(0, 32)}` };
  if (!Array.isArray(raw.days) || raw.days.length === 0 || raw.days.length > 7) {
    return { ok: false, error: "WINDOW_DAYS_INVALID" };
  }
  if (!raw.days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) {
    return { ok: false, error: "WINDOW_DAYS_INVALID" };
  }
  if (new Set(raw.days).size !== raw.days.length) return { ok: false, error: "WINDOW_DAYS_DUPLICATE" };
  const start = minutesOf(raw.start);
  const end = minutesOf(raw.end, { allowEndOfDay: true });
  if (start === null) return { ok: false, error: "WINDOW_START_INVALID" };
  if (end === null) return { ok: false, error: "WINDOW_END_INVALID" };
  if (start === end) return { ok: false, error: "WINDOW_EMPTY" };
  return {
    ok: true,
    window: {
      days: [...raw.days].sort((a, b) => a - b),
      start: raw.start,
      end: raw.end
    }
  };
}

/**
 * Tolerant normalization for stored state: invalid windows are dropped, an
 * expired or out-of-range pause is cleared. Returns null for "no schedule".
 */
export function normalizeQueueSchedule(value, { now = Date.now() } = {}) {
  if (!value || typeof value !== "object") return null;
  const windows = (Array.isArray(value.windows) ? value.windows : [])
    .map((row) => parseScheduleWindow(row))
    .filter((row) => row.ok)
    .map((row) => row.window)
    .slice(0, MAX_SCHEDULE_WINDOWS);
  const pause = Math.floor(Number(value.pauseUntilMs || 0));
  const pauseUntilMs = Number.isFinite(pause) && pause > Number(now) && pause <= Number(now) + MAX_SCHEDULE_PAUSE_MS
    ? pause
    : 0;
  if (!windows.length && !pauseUntilMs) return null;
  return {
    schema: QUEUE_SCHEDULE_SCHEMA,
    windows,
    pauseUntilMs,
    updatedBy: SCHEDULE_EDITORS.includes(value.updatedBy) ? value.updatedBy : "OPERATOR",
    updatedAtMs: Math.max(0, Math.floor(Number(value.updatedAtMs || 0)))
  };
}

/**
 * Strict parse of an operator/AI schedule edit. Fields:
 *   windows:    array (replaces all windows; [] clears) - optional
 *   pauseUntil: ISO-8601 timestamp, or "" / null to clear - optional
 * At least one field must be present. Absent fields keep the current value.
 */
export function parseScheduleEdit(raw, { now = Date.now(), current = null, editor = "OPERATOR" } = {}) {
  if (!isPlainObject(raw)) return { ok: false, error: "SCHEDULE_NOT_OBJECT" };
  const extra = Object.keys(raw).find((key) => !["windows", "pauseUntil"].includes(key));
  if (extra) return { ok: false, error: `SCHEDULE_UNKNOWN_FIELD:${String(extra).slice(0, 32)}` };
  const hasWindows = Object.prototype.hasOwnProperty.call(raw, "windows");
  const hasPause = Object.prototype.hasOwnProperty.call(raw, "pauseUntil");
  if (!hasWindows && !hasPause) return { ok: false, error: "SCHEDULE_EMPTY_EDIT" };

  const base = normalizeQueueSchedule(current, { now });
  let windows = base?.windows || [];
  if (hasWindows) {
    if (!Array.isArray(raw.windows)) return { ok: false, error: "SCHEDULE_WINDOWS_NOT_ARRAY" };
    if (raw.windows.length > MAX_SCHEDULE_WINDOWS) return { ok: false, error: "SCHEDULE_TOO_MANY_WINDOWS" };
    const parsed = raw.windows.map((row) => parseScheduleWindow(row));
    const bad = parsed.find((row) => !row.ok);
    if (bad) return { ok: false, error: bad.error };
    windows = parsed.map((row) => row.window);
  }

  let pauseUntilMs = base?.pauseUntilMs || 0;
  if (hasPause) {
    if (raw.pauseUntil === null || raw.pauseUntil === "") {
      pauseUntilMs = 0;
    } else {
      if (typeof raw.pauseUntil !== "string" || raw.pauseUntil.length > 40 ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw.pauseUntil)) {
        return { ok: false, error: "SCHEDULE_PAUSE_UNTIL_FORMAT" };
      }
      const at = Date.parse(raw.pauseUntil);
      if (!Number.isFinite(at)) return { ok: false, error: "SCHEDULE_PAUSE_UNTIL_FORMAT" };
      if (at <= Number(now)) return { ok: false, error: "SCHEDULE_PAUSE_UNTIL_NOT_FUTURE" };
      if (at > Number(now) + MAX_SCHEDULE_PAUSE_MS) return { ok: false, error: "SCHEDULE_PAUSE_UNTIL_TOO_FAR" };
      pauseUntilMs = at;
    }
  }

  const schedule = windows.length || pauseUntilMs
    ? {
        schema: QUEUE_SCHEDULE_SCHEMA,
        windows,
        pauseUntilMs,
        updatedBy: SCHEDULE_EDITORS.includes(editor) ? editor : "OPERATOR",
        updatedAtMs: Math.max(0, Math.floor(Number(now)))
      }
    : null;
  return { ok: true, schedule };
}

function windowMinutes(window) {
  return {
    start: minutesOf(window.start),
    end: minutesOf(window.end, { allowEndOfDay: true })
  };
}

/** The window occurrence containing atMs as {startMs, endMs}, or null. */
export function containingWindow(schedule, atMs) {
  const windows = Array.isArray(schedule?.windows) ? schedule.windows : [];
  const date = new Date(Number(atMs));
  const minute = date.getHours() * 60 + date.getMinutes();
  const today = isoWeekday(date);
  const yesterday = today === 1 ? 7 : today - 1;
  let best = null;
  for (const window of windows) {
    const { start, end } = windowMinutes(window);
    if (start === null || end === null) continue;
    let hit = null;
    if (end > start) {
      if (window.days.includes(today) && minute >= start && minute < end) {
        hit = { startMs: localAt(date, 0, start), endMs: localAt(date, 0, end) };
      }
    } else if (window.days.includes(today) && minute >= start) {
      hit = { startMs: localAt(date, 0, start), endMs: localAt(date, 1, end) };
    } else if (window.days.includes(yesterday) && minute < end) {
      hit = { startMs: localAt(date, -1, start), endMs: localAt(date, 0, end) };
    }
    if (hit && (!best || hit.endMs > best.endMs)) best = hit;
  }
  return best;
}

/** "" when the schedule allows the slot to run at atMs, else the block reason. */
export function scheduleBlockReason(schedule, atMs) {
  if (!schedule) return "";
  if (Number(schedule.pauseUntilMs || 0) > Number(atMs)) return SCHEDULE_BLOCK.PAUSED;
  const windows = Array.isArray(schedule.windows) ? schedule.windows : [];
  if (windows.length && !containingWindow(schedule, atMs)) return SCHEDULE_BLOCK.OUTSIDE_WINDOW;
  return "";
}

export function scheduleAllows(schedule, atMs) {
  return scheduleBlockReason(schedule, atMs) === "";
}

/**
 * Earliest time >= fromMs at which the schedule allows running, or null when
 * no window occurs within the next 8 days (cannot happen for a valid window).
 */
export function nextScheduleOpenAtMs(schedule, fromMs) {
  const start = Math.max(Number(fromMs), Number(schedule?.pauseUntilMs || 0));
  if (!schedule) return Number(fromMs);
  const windows = Array.isArray(schedule.windows) ? schedule.windows : [];
  if (!windows.length) return start;
  if (containingWindow(schedule, start)) return start;
  const base = new Date(start);
  let best = null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = isoWeekday(new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset));
    for (const window of windows) {
      if (!window.days.includes(day)) continue;
      const { start: minute } = windowMinutes(window);
      if (minute === null) continue;
      const at = localAt(base, offset, minute);
      if (at > start && (best === null || at < best)) best = at;
    }
  }
  return best;
}

/**
 * When the current allowance ends: end of the (chained) window containing
 * atMs. null when the schedule has no windows (open-ended) or does not allow
 * running at atMs.
 */
export function scheduleClosesAtMs(schedule, atMs) {
  if (!schedule || !scheduleAllows(schedule, atMs)) return null;
  const windows = Array.isArray(schedule.windows) ? schedule.windows : [];
  if (!windows.length) return null;
  let current = containingWindow(schedule, atMs);
  if (!current) return null;
  let end = current.endMs;
  const limit = Number(atMs) + MAX_CHAIN_DAYS * DAY_MS;
  while (end < limit) {
    const next = containingWindow(schedule, end);
    if (!next || next.endMs <= end) break;
    end = next.endMs;
  }
  return end >= limit ? null : end;
}

/** Earliest time a queue item (status + schedule) may become runnable. */
export function queueItemNextRunnableAtMs(item, now = Date.now()) {
  if (!item) return null;
  let base = null;
  if (item.status === "READY") base = Number(now);
  else if (item.status === "PAUSED") base = Math.max(Number(now), Number(item.pauseUntilMs || 0));
  else if (item.status === "BLOCKED") {
    const retryAt = Number(item.blockedRetryAtMs || 0);
    base = retryAt > 0 ? Math.max(Number(now), retryAt) : null;
  }
  if (base === null) return null;
  return nextScheduleOpenAtMs(item.schedule || null, base);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "LOCAL";
  } catch {
    return "LOCAL";
  }
}

export function utcOffsetText(atMs) {
  const offset = -new Date(Number(atMs)).getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Local ISO-8601 with offset, e.g. 2026-09-24T08:15:00+02:00. */
export function localIso(atMs) {
  if (atMs === null || atMs === undefined || !Number.isFinite(Number(atMs))) return "";
  const d = new Date(Number(atMs));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${utcOffsetText(atMs)}`;
}

function dayRange(days, names) {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return names === DAY_NAMES_SV ? "Alla dagar" : "Every day";
  const parts = [];
  let runStart = sorted[0];
  let prev = sorted[0];
  for (const day of [...sorted.slice(1), null]) {
    if (day !== null && day === prev + 1) {
      prev = day;
      continue;
    }
    const dash = names === DAY_NAMES_SV ? "–" : "-";
    parts.push(runStart === prev ? names[runStart] : prev === runStart + 1
      ? `${names[runStart]},${names[prev]}`
      : `${names[runStart]}${dash}${names[prev]}`);
    runStart = day;
    prev = day;
  }
  return parts.join(",");
}

/** Short operator text, e.g. "Mån–Fre 22:00–06:00 · paus till 25/9 08:00". */
export function scheduleSummarySv(schedule, { now = Date.now() } = {}) {
  if (!schedule) return "";
  const parts = (schedule.windows || []).map((window) =>
    `${dayRange(window.days, DAY_NAMES_SV)} ${window.start}–${window.end}`);
  if (Number(schedule.pauseUntilMs || 0) > Number(now)) {
    const d = new Date(Number(schedule.pauseUntilMs));
    parts.push(`paus till ${d.getDate()}/${d.getMonth() + 1} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }
  return parts.join(" · ");
}

function scheduleSummaryEn(schedule) {
  return (schedule?.windows || []).map((window) =>
    `${dayRange(window.days, DAY_NAMES_EN)} ${window.start}-${window.end}`).join("; ");
}

/**
 * English machine state for the prompt capsule (control.workQueue.schedule).
 * estimatedTurnMs sizes likelyLastTurnInWindow: a prompt sent now is expected
 * to be answered after the window closes, so this response is the last one
 * Greenfield will use before parking the slot.
 */
export function schedulePromptState(schedule, { now = Date.now(), estimatedTurnMs = null } = {}) {
  const normalized = normalizeQueueSchedule(schedule, { now });
  const block = scheduleBlockReason(normalized, now);
  const closesAtMs = scheduleClosesAtMs(normalized, now);
  const nextOpenMs = block ? nextScheduleOpenAtMs(normalized, now) : null;
  const turnMs = Number.isFinite(Number(estimatedTurnMs)) && Number(estimatedTurnMs) > 0
    ? Number(estimatedTurnMs)
    : 10 * 60 * 1000;
  return {
    schema: QUEUE_SCHEDULE_SCHEMA,
    timeZone: localTimeZone(),
    utcOffset: utcOffsetText(now),
    localNow: localIso(now),
    localWeekday: DAY_NAMES_EN[isoWeekday(new Date(Number(now)))],
    windows: normalized?.windows?.map((window) => ({ ...window, days: [...window.days] })) || [],
    windowsText: scheduleSummaryEn(normalized) || "NONE_ALWAYS_OPEN",
    pauseUntil: normalized?.pauseUntilMs ? localIso(normalized.pauseUntilMs) : "",
    openNow: !block,
    blockReason: block,
    closesAt: closesAtMs ? localIso(closesAtMs) : "",
    nextOpenAt: nextOpenMs ? localIso(nextOpenMs) : "",
    likelyLastTurnInWindow: Boolean(closesAtMs && closesAtMs - Number(now) <= turnMs),
    lastEditedBy: normalized?.updatedBy || ""
  };
}
