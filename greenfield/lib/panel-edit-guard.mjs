// v1.9.0 panel edit guard.
//
// The side panel re-renders from storage every 5 s, on every storage change
// and on every process broadcast (several per second in a busy fleet). Until
// 1.8.14 each render wrote the stored values back into the controls and
// rebuilt the queue rows and the saved-mission dropdowns, so a checkbox that
// had just been clicked flipped back, a typed number was replaced and an open
// dropdown was destroyed under the cursor (operator report 2026-10-06).
//
// Rules:
//   * A settings control keeps the operator's value while it has focus or
//     differs from the value the panel last rendered into it (an unsaved
//     edit). Such a control gets UNSAVED_CLASS when the stored value differs.
//     Saving (or reverting by hand) releases it; storage is then shown again.
//   * A rebuilt container (queue rows, dropdown options) is not rebuilt while
//     one of its fields has focus or while a change from it is being applied,
//     and never when the markup is unchanged.
// DOM-only, no chrome.* access; element-like objects suffice for tests.

export const UNSAVED_CLASS = "gf-unsaved";

const FIELD_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
const lastHtml = new WeakMap();

export function isField(el) {
  return Boolean(el && FIELD_TAGS.has(String(el.tagName || "").toUpperCase()));
}

function isToggle(el) {
  return el?.type === "checkbox" || el?.type === "radio";
}

function hasFocus(el) {
  return Boolean(el) && el.ownerDocument?.activeElement === el;
}

/** Current value of a control as a string ("true"/"false" for checkboxes). */
export function readControl(el) {
  if (!el) return "";
  return isToggle(el) ? (el.checked === true ? "true" : "false") : String(el.value ?? "");
}

function storedText(el, stored) {
  return isToggle(el) ? (stored === true ? "true" : "false") : String(stored ?? "");
}

function setUnsaved(el, unsaved) {
  el.classList?.toggle?.(UNSAVED_CLASS, unsaved);
}

function write(el, text) {
  if (isToggle(el)) el.checked = text === "true";
  else el.value = text;
  el.dataset.gfStored = text;
  setUnsaved(el, false);
}

/** True when the operator changed the control since the panel last rendered it. */
export function controlEdited(el) {
  const rendered = el?.dataset?.gfStored;
  return rendered !== undefined && readControl(el) !== rendered;
}

/**
 * Render a stored value into a control unless the operator holds it.
 * Returns EQUAL, WRITTEN, KEPT_EDIT, KEPT_FOCUS or MISSING.
 */
export function guardedSet(el, stored) {
  if (!el) return "MISSING";
  const next = storedText(el, stored);
  if (readControl(el) === next) {
    el.dataset.gfStored = next;
    setUnsaved(el, false);
    return "EQUAL";
  }
  if (controlEdited(el)) {
    setUnsaved(el, true);
    return "KEPT_EDIT";
  }
  if (hasFocus(el)) return "KEPT_FOCUS";
  write(el, next);
  return "WRITTEN";
}

/** Write a stored value regardless of focus or edits (an explicit reset). */
export function forceSet(el, stored) {
  if (!el) return "MISSING";
  write(el, storedText(el, stored));
  return "WRITTEN";
}

/**
 * The operator's edit has been handled (saved, applied or rejected): the
 * next render shows storage again once the control loses focus.
 */
export function releaseControl(el) {
  if (!el) return;
  el.dataset.gfStored = readControl(el);
  setUnsaved(el, false);
}

/** True while a field inside the container has focus or a change from it is pending. */
export function containerHeld(container) {
  if (!container) return false;
  if (Number(container.dataset?.gfPending || 0) > 0) return true;
  const active = container.ownerDocument?.activeElement || null;
  return Boolean(active && isField(active) && (active === container || container.contains?.(active)));
}

/**
 * Replace a container's markup unless it is unchanged or held.
 * Returns UNCHANGED, KEPT, WRITTEN or MISSING. A container must be written
 * only through this function (it remembers the last markup it wrote).
 */
export function guardedHtml(container, html, { force = false } = {}) {
  if (!container) return "MISSING";
  const text = String(html ?? "");
  if (!force && lastHtml.get(container) === text) return "UNCHANGED";
  if (!force && containerHeld(container)) return "KEPT";
  container.innerHTML = text;
  lastHtml.set(container, text);
  return "WRITTEN";
}

/** Hold a container while a change made in it is applied; returns the release. */
export function beginPending(container) {
  if (!container) return () => {};
  container.dataset.gfPending = String(Number(container.dataset.gfPending || 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = Math.max(0, Number(container.dataset.gfPending || 0) - 1);
    if (left) container.dataset.gfPending = String(left);
    else delete container.dataset.gfPending;
  };
}
