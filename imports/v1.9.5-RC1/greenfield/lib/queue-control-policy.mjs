import { isExplicitBackgroundSleepAction, isExplicitPauseAction, isExplicitQueueYieldAction } from "./session-rotation.mjs";

export const QUEUE_AFTER_RESPONSE = Object.freeze({
  HOLD_FOR_PROCESS_PAUSE: "HOLD_FOR_PROCESS_PAUSE",
  PARK_AND_SWITCH: "PARK_AND_SWITCH",
  CONTINUE_CURRENT: "CONTINUE_CURRENT"
});

export function queueAfterResponseAction({
  queueManaged = false,
  queueQuantumReached = false,
  sessionAction = "KEEP",
  scheduleBlocked = false
} = {}) {
  if (!queueManaged) return QUEUE_AFTER_RESPONSE.CONTINUE_CURRENT;

  // v1.8.1: the slot's run window closed (or pauseUntil began) while this turn
  // ran. The turn was allowed to finish; no further prompt is sent to it now.
  if (scheduleBlocked === true) return QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH;

  // In queue-managed mode, every bounded scheduling handoff parks the logical
  // mission so the worker can keep advancing in explicit queue order. A timed
  // PAUSE_PROCESS becomes queue-local when another runnable slot exists; when
  // none exists the background runtime falls back to the ordinary process pause.
  if (isExplicitPauseAction(sessionAction) ||
      isExplicitBackgroundSleepAction(sessionAction) ||
      isExplicitQueueYieldAction(sessionAction) ||
      queueQuantumReached === true) {
    return QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH;
  }

  return QUEUE_AFTER_RESPONSE.CONTINUE_CURRENT;
}
