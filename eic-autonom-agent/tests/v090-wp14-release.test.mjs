import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  APP_VERSION,
  CONTENT_SCRIPT_VERSION,
  CONFIG_SCHEMA,
  RUNTIME_SCHEMA,
  EXPORT_SCHEMA
} from "../lib/contracts.mjs";
import {
  BUILD_PROFILES,
  createManifestForProfile,
  detectBuildProfile
} from "../lib/build-profile.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));

test("v0.9.8 synchronizes package, manifest and runtime versions", () => {
  assert.equal(json("package.json").version, "0.10.11");
  assert.equal(json("manifest.json").version, "0.10.11");
  assert.equal(APP_VERSION, "0.10.11");
  assert.equal(CONTENT_SCRIPT_VERSION, "0.10.11");
  assert.match(read("content.js"), /const VERSION = "0\.10\.10";/);
  assert.match(read("sidepanel.html"), /id="appVersion">v—<\/small>/);
});

test("v0.9.8 advances current durable schemas without aliases", () => {
  assert.equal(CONFIG_SCHEMA, "eic.autonom.config.v13");
  assert.equal(RUNTIME_SCHEMA, "eic.autonom.runtime.v13");
  assert.equal(EXPORT_SCHEMA, "eic.autonom.export.v20");
});

test("WP14 standard profile excludes debugger and general website access", () => {
  const manifest = createManifestForProfile(json("manifest.json"), BUILD_PROFILES.STANDARD);
  assert.equal(detectBuildProfile(manifest), BUILD_PROFILES.STANDARD);
  assert.ok(!manifest.permissions.includes("debugger"));
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.ok(!manifest.host_permissions.includes("http://*/*"));
  assert.ok(!manifest.host_permissions.includes("https://*/*"));
});

test("WP14 browser profile uses debugger with optional, not required, general origins", () => {
  const manifest = createManifestForProfile(json("manifest.json"), BUILD_PROFILES.BROWSER);
  assert.equal(detectBuildProfile(manifest), BUILD_PROFILES.BROWSER);
  assert.ok(manifest.permissions.includes("debugger"));
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
  assert.ok(!manifest.host_permissions.includes("http://*/*"));
  assert.ok(!manifest.host_permissions.includes("https://*/*"));
});

test("WP14 release documents exist and preserve the operator evidence boundary", () => {
  const acceptance = read("docs/DESKTOP_CHROME_ACCEPTANCE_RESULT_V0_9_0.md");
  const verification = read("docs/VERIFICATION_V0_9_0.md");
  const changelog = read("docs/CHANGELOG_V0_9_0.md");
  assert.match(acceptance, /PASS/);
  assert.match(acceptance, /operator-reported/);
  assert.match(acceptance, /No scenario-by-scenario transcript/);
  assert.match(verification, /575\/575 PASS/);
  assert.match(changelog, /EIC_BROWSER_ACTION\/1/);
});

test("WP14 ledger marks WP13 and WP14 implemented before package freeze", () => {
  const ledger = read("docs/V0_9_0_EXECUTION_LEDGER.md");
  assert.match(ledger, /\| WP13 \|[^|]+\| IMPLEMENTED \|/);
  assert.match(ledger, /\| WP14 \|[^|]+\| IMPLEMENTED \|/);
});

test("v0.9.8 package script includes current release documents in both install profiles", () => {
  const script = read("scripts/package.mjs");
  for (const name of [
    "docs/CHANGELOG_V0_9_11.md",
    "docs/VERIFICATION_V0_9_11.md",
    "docs/DESKTOP_CHROME_ACCEPTANCE_V0_9_11.md",
    "docs/V0_9_11_LANGUAGE_ATTESTATION.md"
  ]) assert.match(script, new RegExp(name.replaceAll(".", "\\.")));
});

test("WP14 keeps arbitrary JavaScript execution forbidden", () => {
  const executor = read("lib/browser-action-executor.mjs");
  assert.match(executor, /const FORBIDDEN_METHODS = new Set\(\[/);
  assert.match(executor, /"Runtime\.evaluate"/);
  assert.match(executor, /"Runtime\.callFunctionOn"/);
  assert.match(executor, /BROWSER_EXECUTOR_METHOD_FORBIDDEN/);
  assert.ok(!read("background.js").includes("chrome.tabs.executeScript"));
});
