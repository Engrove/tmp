import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MISSION_CONTROL_VIEW,
  MISSION_CONTROL_SHELL_SCHEMA,
  MISSION_CONTROL_VIEW_IDS,
  MISSION_CONTROL_VIEW_REGISTRY,
  createMissionControlShell,
  missionShellSummary,
  resolveMissionControlView
} from "../lib/mission-control-shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, enabled) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) { return this.values.has(name); }
}

class FakeNode {
  constructor() {
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.focused = false;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  toggleAttribute(name, force) {
    if (force) this.attributes.set(name, "");
    else this.attributes.delete(name);
  }
  hasAttribute(name) { return this.attributes.has(name); }
  addEventListener(type, listener) {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
  }
  emit(type, extra = {}) {
    const event = { key: "", preventDefault() {}, ...extra };
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
  focus() { this.focused = true; }
}

function fakeShell() {
  const buttons = {};
  const panels = {};
  for (const id of Object.values(MISSION_CONTROL_VIEW_IDS)) {
    buttons[id] = new FakeNode();
    panels[id] = new FakeNode();
  }
  return { buttons, panels };
}

test("WP03 closed view registry exposes exactly the five approved views", () => {
  assert.equal(MISSION_CONTROL_SHELL_SCHEMA, "eic.autonom.mission-control-shell.v1");
  assert.deepEqual(Object.keys(MISSION_CONTROL_VIEW_REGISTRY), [
    "RUN", "SURFACES", "EVIDENCE", "MISSIONS", "SETTINGS"
  ]);
  assert.equal(DEFAULT_MISSION_CONTROL_VIEW, "RUN");
});

test("WP03 view resolution fails closed for unknown views", () => {
  assert.equal(resolveMissionControlView("RUN").label, "Körning");
  assert.throws(() => resolveMissionControlView("BROWSER"), /MISSION_CONTROL_VIEW_UNKNOWN/);
});

test("WP03 shell activates exactly one panel and one selected tab", () => {
  const { buttons, panels } = fakeShell();
  const shell = createMissionControlShell({ buttons, panels });
  assert.equal(shell.getActiveView(), "RUN");
  assert.equal(buttons.RUN.getAttribute("aria-selected"), "true");
  assert.equal(panels.RUN.hasAttribute("hidden"), false);
  for (const id of ["SURFACES", "EVIDENCE", "MISSIONS", "SETTINGS"]) {
    assert.equal(buttons[id].getAttribute("aria-selected"), "false");
    assert.equal(panels[id].hasAttribute("hidden"), true);
  }
  buttons.EVIDENCE.emit("click");
  assert.equal(shell.getActiveView(), "EVIDENCE");
  assert.equal(panels.EVIDENCE.classList.contains("is-active"), true);
  assert.equal(panels.RUN.hasAttribute("hidden"), true);
});

test("WP03 shell supports bounded keyboard navigation", () => {
  const { buttons, panels } = fakeShell();
  const shell = createMissionControlShell({ buttons, panels });
  buttons.RUN.emit("keydown", { key: "ArrowLeft", preventDefault() {} });
  assert.equal(shell.getActiveView(), "SETTINGS");
  buttons.SETTINGS.emit("keydown", { key: "Home", preventDefault() {} });
  assert.equal(shell.getActiveView(), "RUN");
  buttons.RUN.emit("keydown", { key: "End", preventDefault() {} });
  assert.equal(shell.getActiveView(), "SETTINGS");
  buttons.SETTINGS.emit("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.equal(shell.getActiveView(), "RUN");
});

test("WP03 Mission summary renders only the active WP02 Mission", () => {
  const summary = missionShellSummary({
    activeMissionId: "mission-1",
    missions: {
      "mission-1": {
        missionId: "mission-1",
        modeId: "APP_AUDIT_LONG",
        state: "RUNNING",
        currentStep: "Inventory",
        surfaceRoles: {
          CHATGPT_CONTROLLER: "controller:tab-7",
          WEB_TARGET: null
        }
      }
    }
  });
  assert.equal(summary.modeLabel, "APP_AUDIT_LONG");
  assert.equal(summary.stateLabel, "RUNNING");
  assert.equal(summary.stepLabel, "Inventory");
  assert.equal(summary.controllerSurfaceLabel, "controller:tab-7");
  assert.equal(summary.webTargetSurfaceLabel, "Ej bunden");
});

test("WP03 Mission summary has a bounded legacy fallback", () => {
  const summary = missionShellSummary(null, {
    mode: "WAITING_CONTINUE",
    state: "PAUSED",
    activeWorkUnit: "Read owner state"
  });
  assert.equal(summary.activeMissionId, null);
  assert.equal(summary.modeLabel, "WAITING_CONTINUE");
  assert.equal(summary.stateLabel, "PAUSED");
  assert.equal(summary.stepLabel, "Read owner state");
  assert.equal(summary.controllerSurfaceLabel, "Ej bunden");
});

test("WP03 HTML contains the five accessible views", () => {
  const html = read("sidepanel.html");
  assert.match(html, /class="mission-topbar"/);
  assert.match(html, /role="tablist"/);
  for (const [viewId, spec] of Object.entries(MISSION_CONTROL_VIEW_REGISTRY)) {
    assert.match(html, new RegExp(`data-mission-view="${viewId}"`));
    assert.match(html, new RegExp(`id="${spec.panelId}"`));
    assert.match(html, new RegExp(`data-mission-view-panel="${viewId}"`));
  }
});

test("WP03 preserves the four run command controls in the persistent action dock", () => {
  const html = read("sidepanel.html");
  const dock = html.slice(html.indexOf('class="action-dock"'));
  for (const id of ["startWaitingButton", "pauseButton", "resumeButton", "stopButton"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1);
    assert.match(dock, new RegExp(`id="${id}"`));
  }
});

test("WP03 CSS makes header/navigation and action dock sticky and responsive", () => {
  const css = read("sidepanel.css");
  assert.match(css, /\.mission-topbar\s*\{[\s\S]*position:\s*sticky/);
  assert.match(css, /\.action-dock\s*\{[\s\S]*position:\s*sticky/);
  assert.match(css, /\.mission-view\[hidden\]/);
  assert.match(css, /@media \(max-width: 520px\)/);
});

test("WP03 panel reads the Mission summary without changing command transport", () => {
  const panel = read("sidepanel.js");
  assert.match(panel, /createMissionControlShell/);
  assert.match(panel, /missionShellSummary\(missions, run\)/);
  assert.match(panel, /renderMissionControlSummary\(model\.missions, run\)/);
  assert.doesNotMatch(panel, /type:\s*"EIC_UI_COMMAND"/);
});

test("WP03 contract blocks WP04 semantics and browser enablement", () => {
  const contract = read("docs/V0_9_0_WP03_MISSION_CONTROL_SHELL.md");
  assert.match(contract, /WP04 owns the semantic migration/);
  assert.match(contract, /does not:[\s\S]*enable `AI_WEB_RESEARCH`/);
  assert.match(contract, /does not:[\s\S]*add browser permissions/);
});

test("WP03 receipt remains recorded after the approved WP04 transition", () => {
  const ledger = read("docs/V0_9_0_EXECUTION_LEDGER.md");
  assert.match(ledger, /\| WP03 \|.*\| IMPLEMENTED \|/);
  assert.match(ledger, /## WP03 receipt/);
  assert.match(ledger, /\| WP04 \|.*\| IMPLEMENTED \|/);
  assert.match(ledger, /\| WP05 \|.*\| IMPLEMENTED \|/);
  assert.match(ledger, /\| WP06 \|.*\| IMPLEMENTED \|/);
  assert.match(ledger, /\| WP07 \|.*\| IMPLEMENTED \|/);
  assert.match(ledger, /\| WP08 \|.*\| IMPLEMENTED \|/);
});
