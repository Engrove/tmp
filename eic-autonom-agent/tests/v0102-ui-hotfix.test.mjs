import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

test("v0.10.2 side-panel identity is rendered from APP_VERSION", () => {
  const html = read("../sidepanel.html");
  const source = read("../sidepanel.js");
  assert.match(html, /id="appVersion">v—<\/small>/u);
  assert.doesNotMatch(html, /v0\.10\.[01]/u);
  assert.match(source, /document\.title = `EIC Autonom Agent v\$\{APP_VERSION\}`/u);
  assert.match(source, /elements\.appVersion\.textContent = `v\$\{APP_VERSION\}`/u);
});

test("v0.10.2 renderControls receives windowContext explicitly", () => {
  const source = read("../sidepanel.js");
  assert.match(source, /function renderControls\(run, hasTarget, windowContext = \{\}\)/u);
  assert.match(source, /renderControls\(run, Boolean\(windowContext\.selectedTabId\), windowContext\);/u);
  const start = source.indexOf("function renderControls");
  const end = source.indexOf("function renderSnapshot", start);
  const body = source.slice(start, end);
  assert.match(body, /renderSessionContext\(run, windowContext\);/u);
});

test("v0.10.2 hotfix remains aligned in current app/content versions", async () => {
  const manifest = JSON.parse(read("../manifest.json"));
  const pkg = JSON.parse(read("../package.json"));
  const contracts = await import("../lib/contracts.mjs");
  assert.equal(manifest.version, "0.10.11");
  assert.equal(pkg.version, "0.10.11");
  assert.equal(contracts.APP_VERSION, "0.10.11");
  assert.equal(contracts.CONTENT_SCRIPT_VERSION, "0.10.11");
});
