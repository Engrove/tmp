// One failed ChatGPT rotation yields the window for five minutes; then
// another queued mission is selected. A failed mission keeps its own fence.
export const ROTATION_TIMEOUT_COOLDOWN_MS = 5 * 60 * 1000;
export const ROTATION_TIMEOUT_BLANK_URL = 'about:blank';
export function rotationTimeoutCooldownUntil(now = Date.now()) {
  return Math.max(0, Math.trunc(Number(now))) + ROTATION_TIMEOUT_COOLDOWN_MS;
}
export function rotationBlankEligible(process, tab) {
  return Boolean(process && tab && Number.isInteger(tab.id) &&
    process.tabId === tab.id && process.windowId === tab.windowId &&
    tab.url !== ROTATION_TIMEOUT_BLANK_URL &&
    !process.pendingPrompt?.dispatch && Number(process.pendingPrompt?.sendAttempts || 0) === 0 &&
    !process.sessionRotation?.readinessTimeout?.aboutBlank?.attempted);
}
