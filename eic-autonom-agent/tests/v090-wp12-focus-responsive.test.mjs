import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OPERATIONAL_TONES,
  UI_DENSITIES,
  UI_FOCUS_SESSION_KEY,
  createUiFocusPreference,
  normalizeUiFocusPreference,
  operationalToneLabel,
  resolveOperationalTone,
  toggleUiFocusPreference
} from "../lib/ui-focus-mode.mjs";
import { UI_COMMANDS, UI_COMMAND_SPECS } from "../lib/ui-contract.mjs";

test("WP12 Focus Mode preference is versioned and UI-only", () => {
  const value = createUiFocusPreference();
  assert.equal(value.schema, "eic.autonom.ui-focus.v1");
  assert.equal(value.enabled, false);
  assert.equal(value.density, UI_DENSITIES.COMFORTABLE);
  assert.equal(UI_FOCUS_SESSION_KEY, "eic.autonom.ui-focus.v1");
});

test("WP12 Focus Mode normalization fails safe to comfortable and disabled", () => {
  const value = normalizeUiFocusPreference({ enabled: "yes", density: "UNKNOWN", activeView: "" });
  assert.equal(value.enabled, false);
  assert.equal(value.density, UI_DENSITIES.COMFORTABLE);
  assert.equal(value.activeView, "RUN");
});

test("WP12 Focus Mode toggle preserves active view and timestamps the preference", () => {
  const value = toggleUiFocusPreference(createUiFocusPreference({ activeView: "EVIDENCE" }), {
    activeView: "SURFACES",
    now: Date.parse("2026-08-04T12:00:00.000Z")
  });
  assert.equal(value.enabled, true);
  assert.equal(value.activeView, "SURFACES");
  assert.equal(value.updatedAt, "2026-08-04T12:00:00.000Z");
});

test("WP12 blocked recovery has highest operational priority", () => {
  assert.equal(resolveOperationalTone({
    runState: "RUNNING",
    recoveryState: "REBIND_REQUIRED",
    evidenceState: "ACTIVE"
  }), OPERATIONAL_TONES.BLOCKED);
});

test("WP12 approvals and stale evidence produce attention tone", () => {
  assert.equal(resolveOperationalTone({
    approvalState: "PENDING",
    evidenceState: "STALE"
  }), OPERATIONAL_TONES.ATTENTION);
});

test("WP12 active and idle operational tones are calibrated", () => {
  assert.equal(resolveOperationalTone({ missionState: "RUNNING" }), OPERATIONAL_TONES.ACTIVE);
  assert.equal(resolveOperationalTone({}), OPERATIONAL_TONES.IDLE);
  assert.match(operationalToneLabel(OPERATIONAL_TONES.BLOCKED), /blockerad|recovery/i);
});

test("WP12 header exposes keyboard-accessible Focus Mode and live status", () => {
  const html = readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  assert.match(html, /class="skip-link"/);
  assert.match(html, /id="focusModeButton"[^>]*aria-keyshortcuts="Alt\+F"|aria-keyshortcuts="Alt\+F"[^>]*id="focusModeButton"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /id="missionStatusAnnouncer"/);
  assert.match(html, /aria-live="assertive"/);
});

test("WP12 safety-critical cards stay primary while secondary cards are marked", () => {
  const html = readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  assert.match(html, /id="browserApprovalCard"[^>]*data-focus-primary="true"|data-focus-primary="true"[^>]*id="browserApprovalCard"/);
  assert.match(html, /id="browserRecoveryCard"[^>]*data-focus-primary="true"|data-focus-primary="true"[^>]*id="browserRecoveryCard"/);
  assert.match(html, /aria-labelledby="nanoHeading"[^>]*data-focus-secondary="true"/);
  assert.match(html, /aria-labelledby="logHeading"[^>]*data-focus-secondary="true"/);
});

test("WP12 Focus Mode CSS hides only explicitly secondary regions", () => {
  const css = readFileSync(new URL("../sidepanel.css", import.meta.url), "utf8");
  assert.match(css, /body\.focus-mode \[data-focus-secondary="true"\]/);
  assert.match(css, /body\.focus-mode \[data-focus-primary="true"\]/);
  assert.doesNotMatch(css, /body\.focus-mode \.browser-(approval|recovery)\s*\{\s*display:\s*none/i);
});

test("WP12 responsive layout keeps one primary scroll and touch targets", () => {
  const css = readFileSync(new URL("../sidepanel.css", import.meta.url), "utf8");
  assert.match(css, /body\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /min-height:\s*40px/);
  assert.match(css, /action-dock-controls[\s\S]*grid-template-columns:\s*1fr/);
});

test("WP12 accessibility supports focus-visible, reduced motion and forced colors", () => {
  const css = readFileSync(new URL("../sidepanel.css", import.meta.url), "utf8");
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /forced-colors:\s*active/);
});

test("WP12 panel stores Focus Mode in sessionStorage, never runtime config", () => {
  const panel = readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(panel, /sessionStorage\.getItem\(UI_FOCUS_SESSION_KEY\)/);
  assert.match(panel, /sessionStorage\.setItem\(UI_FOCUS_SESSION_KEY/);
  assert.match(panel, /document\.body\.classList\.toggle\("focus-mode"/);
  assert.doesNotMatch(panel, /command\("SAVE_CONFIG",\s*\{[^}]*focusMode/s);
});

test("WP12 operational tone is rendered from verified snapshot fields", () => {
  const panel = readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(panel, /resolveOperationalTone\(\{/);
  assert.match(panel, /windowContext\.browserRecovery\?\.state/);
  assert.match(panel, /windowContext\.browserApproval\?\.state/);
  assert.match(panel, /model\?\.evidence\?\.observation\?\.state/);
  assert.match(panel, /document\.body\.dataset\.operationalTone/);
});

test("WP12 does not expand the background command surface", () => {
  assert.equal(Object.keys(UI_COMMANDS).length, 54);
  assert.equal(Object.keys(UI_COMMAND_SPECS).length, 54);
});

test("WP12 does not alter browser protocols, permissions or start WP13", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const focus = readFileSync(new URL("../lib/ui-focus-mode.mjs", import.meta.url), "utf8");
  const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.deepEqual(manifest.permissions, ["sidePanel", "storage", "tabs", "scripting", "alarms"]);
  assert.deepEqual(manifest.host_permissions, ["https://chatgpt.com/*", "https://chat.openai.com/*"]);
  assert.doesNotMatch(focus, /EIC_BROWSER_ACTION|chrome\.debugger|permissions\.request/);
  assert.doesNotMatch(background, /FOCUS_MODE/);
  assert.doesNotMatch(focus, /DESKTOP_CHROME_ACCEPTANCE|WP13/);
});
