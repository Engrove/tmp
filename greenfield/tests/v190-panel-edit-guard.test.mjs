import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  UNSAVED_CLASS,
  beginPending,
  containerHeld,
  controlEdited,
  forceSet,
  guardedHtml,
  guardedSet,
  releaseControl
} from "../lib/panel-edit-guard.mjs";

// Element-like fakes: the guard only uses value/checked/type/tagName,
// dataset, classList, contains() and ownerDocument.activeElement.
function fakeDocument() {
  return { activeElement: null };
}
function fakeElement(doc, { tagName = "INPUT", type = "text", value = "", checked = false } = {}) {
  const classes = new Set();
  const node = {
    tagName, type, value, checked, dataset: {}, ownerDocument: doc, innerHTML: "", children: [],
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name)
    },
    contains(other) { return other === node || node.children.includes(other); }
  };
  return node;
}
const unsaved = (el) => el.classList.contains(UNSAVED_CLASS);

test("v1.9.0 edit guard: an untouched control shows storage on every render", () => {
  const doc = fakeDocument();
  const delay = fakeElement(doc, { type: "number", value: "5" });
  assert.equal(guardedSet(delay, "5"), "EQUAL");
  assert.equal(guardedSet(delay, "9"), "WRITTEN");
  assert.equal(delay.value, "9");
  assert.equal(unsaved(delay), false);
});

test("v1.9.0 edit guard: an operator edit survives re-renders, marked unsaved, until it is saved", () => {
  const doc = fakeDocument();
  const delay = fakeElement(doc, { type: "number", value: "5" });
  guardedSet(delay, "5");
  delay.value = "17"; // typed, cursor already left the field
  for (let i = 0; i < 5; i += 1) assert.equal(guardedSet(delay, "5"), "KEPT_EDIT");
  assert.equal(delay.value, "17");
  assert.equal(controlEdited(delay), true);
  assert.equal(unsaved(delay), true);
  // saved: storage now equals the control
  assert.equal(guardedSet(delay, "17"), "EQUAL");
  assert.equal(unsaved(delay), false);
  assert.equal(controlEdited(delay), false);
  // a later change from storage (another window) is shown again
  assert.equal(guardedSet(delay, "20"), "WRITTEN");
  assert.equal(delay.value, "20");
});

test("v1.9.0 edit guard: a clicked checkbox stays as clicked; reverting it by hand releases it", () => {
  const doc = fakeDocument();
  const box = fakeElement(doc, { type: "checkbox", checked: false });
  assert.equal(guardedSet(box, true), "WRITTEN");
  box.checked = false; // operator click
  assert.equal(guardedSet(box, true), "KEPT_EDIT");
  assert.equal(box.checked, false);
  assert.equal(unsaved(box), true);
  box.checked = true; // clicked back
  assert.equal(guardedSet(box, true), "EQUAL");
  assert.equal(unsaved(box), false);
  assert.equal(guardedSet(box, false), "WRITTEN");
  assert.equal(box.checked, false);
});

test("v1.9.0 edit guard: focus alone keeps the value (no unsaved mark); after blur storage is shown", () => {
  const doc = fakeDocument();
  const select = fakeElement(doc, { tagName: "SELECT", type: "select-one", value: "NORMAL" });
  guardedSet(select, "NORMAL");
  doc.activeElement = select;
  assert.equal(guardedSet(select, "HIGH"), "KEPT_FOCUS");
  assert.equal(select.value, "NORMAL");
  assert.equal(unsaved(select), false);
  doc.activeElement = null;
  assert.equal(guardedSet(select, "HIGH"), "WRITTEN");
  assert.equal(select.value, "HIGH");
});

test("v1.9.0 edit guard: release after a save shows the stored (normalised) value; forceSet resets", () => {
  const doc = fakeDocument();
  const settle = fakeElement(doc, { type: "number", value: "2" });
  guardedSet(settle, "2");
  settle.value = "99";
  assert.equal(guardedSet(settle, "2"), "KEPT_EDIT");
  // the background clamped 99 to 30
  releaseControl(settle);
  assert.equal(unsaved(settle), false);
  assert.equal(guardedSet(settle, "30"), "WRITTEN");
  assert.equal(settle.value, "30");

  const draft = fakeElement(doc, { tagName: "TEXTAREA", type: "textarea", value: "" });
  guardedSet(draft, "");
  draft.value = "utkast";
  assert.equal(guardedSet(draft, ""), "KEPT_EDIT");
  doc.activeElement = draft;
  assert.equal(forceSet(draft, ""), "WRITTEN");
  assert.equal(draft.value, "");
  assert.equal(guardedSet(draft, ""), "EQUAL");
});

test("v1.9.0 edit guard: a rebuilt container is kept while a field in it has focus or a change is pending", () => {
  const doc = fakeDocument();
  const list = fakeElement(doc, { tagName: "DIV", type: "" });
  const field = fakeElement(doc, { tagName: "SELECT", type: "select-one", value: "NORMAL" });
  const button = fakeElement(doc, { tagName: "BUTTON", type: "button" });
  list.children.push(field, button);

  assert.equal(guardedHtml(list, "<row>1</row>"), "WRITTEN");
  assert.equal(guardedHtml(list, "<row>1</row>"), "UNCHANGED");
  doc.activeElement = field;
  assert.equal(containerHeld(list), true);
  assert.equal(guardedHtml(list, "<row>2</row>"), "KEPT");
  assert.equal(list.innerHTML, "<row>1</row>");
  // a focused button (↑/↓/×) does not hold the list
  doc.activeElement = button;
  assert.equal(guardedHtml(list, "<row>2</row>"), "WRITTEN");

  doc.activeElement = null;
  const releaseA = beginPending(list);
  const releaseB = beginPending(list);
  assert.equal(guardedHtml(list, "<row>3</row>"), "KEPT");
  releaseA();
  releaseA(); // idempotent
  assert.equal(guardedHtml(list, "<row>3</row>"), "KEPT");
  releaseB();
  assert.equal(containerHeld(list), false);
  assert.equal(guardedHtml(list, "<row>3</row>"), "WRITTEN");

  doc.activeElement = field;
  assert.equal(guardedHtml(list, "<row>4</row>", { force: true }), "WRITTEN");
  // a dropdown is its own container for its options
  const options = fakeElement(doc, { tagName: "SELECT", type: "select-one" });
  guardedHtml(options, "<option>a</option>");
  doc.activeElement = options;
  assert.equal(guardedHtml(options, "<option>a</option><option>b</option>"), "KEPT");
});

test("v1.9.0 panel: every periodically rendered control goes through the guard", () => {
  const js = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../sidepanel.css", import.meta.url), "utf8");
  for (const id of [
    "postDelay", "maxActiveSessions", "workModeEnabled", "workModeEndpoint", "schedulerPriority",
    "defaultMissionQuantumInteractions", "queuePriorityAgingSeconds", "queueSwitchDelaySeconds",
    "queueSwitchHardReload", "queueSwitchSettleSeconds", "warmQueueResume", "nextInstruction", "auditEnabled"
  ]) {
    assert.match(js, new RegExp(`guardedSet\\(\\$\\("${id}"\\)`), `${id} rendered through guardedSet`);
    assert.doesNotMatch(js, new RegExp(`\\$\\("${id}"\\)\\.(value|checked) = `), `${id} not written directly`);
  }
  for (const id of ["missionQueueList", "savedMissionCleanupList"]) {
    assert.doesNotMatch(js, new RegExp(`\\$\\("${id}"\\)\\.innerHTML`), `${id} not rebuilt directly`);
  }
  assert.doesNotMatch(js, /\bselect\.innerHTML\s*=/, "dropdown options not rebuilt directly");
  // the process broadcast no longer wipes an unsent draft
  assert.doesNotMatch(js, /if \(!state\.nextInstruction\) \$\("nextInstruction"\)\.value = ""/);
  assert.match(html, /<input id="warmQueueResume" type="checkbox" checked>/);
  assert.match(js, /warmQueueResume: \$\("warmQueueResume"\)\.checked === true/);
  assert.match(css, /\.gf-unsaved\s*\{/);
});
