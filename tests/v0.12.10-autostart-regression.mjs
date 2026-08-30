import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href + `?v01210=${Date.now()}-${Math.random()}`);

let passed = 0;
const results = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", error: String(error?.stack || error) });
    console.error(`FAIL ${name}\n${error?.stack || error}`);
  }
}

const autostart = await imp("lib/autostart-transaction.mjs");
const presets = await imp("lib/autostart-presets.mjs");
const side = fs.readFileSync(path.join(ROOT, "sidepanel.js"), "utf8");

await test("Autostart-owned link accepts missing cached selected tab", () => {
  const result = autostart.evaluateAutostartPrecondition(
    { selectedTabId: null, linkedTabs: {} },
    { linkActiveTab: true }
  );
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ACTIVE_TAB_BIND_PENDING");
});

await test("Autostart-owned link ignores stale cached unsupported selection", () => {
  const result = autostart.evaluateAutostartPrecondition(
    {
      selectedTabId: 77,
      linkedTabs: {
        "77": { url: "https://example.com/not-the-current-active-tab" }
      }
    },
    { linkActiveTab: true }
  );
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ACTIVE_TAB_BIND_PENDING");
});

await test("non-linking caller still fails closed without selected tab", () => {
  const result = autostart.evaluateAutostartPrecondition(
    { selectedTabId: null, linkedTabs: {} },
    { linkActiveTab: false }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "NO_SELECTED_TAB");
});

await test("all packaged Autostart presets own active-tab linking", () => {
  assert.ok(presets.AUTOSTART_PRESETS.length > 0);
  for (const preset of presets.AUTOSTART_PRESETS) {
    const plan = presets.buildAutostartPlan(preset.id);
    assert.equal(plan.linkActiveTab, true, preset.id);
  }
});

await test("Autostart stages profile without staling Nano", () => {
  assert.match(
    side,
    /applyScenarioPreset\(plan\.configPatch\.quickProfileId,\s*\{\s*markNanoStale:\s*false\s*\}\)/
  );
  assert.match(
    side,
    /function applyScenarioPreset\(presetId,\s*\{\s*markNanoStale = true\s*\} = \{\}\)/
  );
  assert.match(side, /applyNanoProfile\(preset\.nano,\s*\{\s*markStale:\s*markNanoStale\s*\}\)/);
});

await test("Autostart create remains before first awaited active-tab bind", () => {
  const start = side.indexOf("async function autostartClick()");
  const end = side.indexOf("\nasync function activateNanoClick", start);
  assert.ok(start >= 0 && end > start);
  const body = side.slice(start, end);
  const create = body.indexOf("beginNanoCreateFromGestureWithConfig(preparedConfig)");
  const link = body.indexOf('await command("LINK_ACTIVE_TAB")');
  const activationReadback = body.indexOf("await activationOutcomePromise");
  const save = body.indexOf('await command("SAVE_CONFIG"');
  assert.ok(create >= 0 && link > create, `create=${create} link=${link}`);
  assert.ok(activationReadback > link, `link=${link} activation=${activationReadback}`);
  assert.ok(save > activationReadback, `activation=${activationReadback} save=${save}`);
});

await test("failed staged replacement preserves prior verified Nano base", () => {
  assert.match(side, /const priorVerifiedBase = state\.modelSession && state\.modelCanaryVerified && !state\.modelStale/);
  assert.match(side, /const restorePriorVerifiedBase = \(error\) => \{/);
  assert.match(side, /if \(!priorVerifiedBase\?\.session\) return false/);
  assert.match(side, /state\.modelSession = priorVerifiedBase\.session/);
  assert.match(side, /state\.modelCanaryVerified = true/);
  assert.match(side, /event: "replacement-failed-prior-restored"/);
});

await test("stale UI no longer says browser-style restart required", () => {
  assert.doesNotMatch(side, /OMSTART KRÄVS/);
  assert.match(side, /setBadge\(elements\.nanoBadge, "AKTIVERA NANO", "warning"\)/);
});

console.log(JSON.stringify({
  suite: "v0.12.10-autostart-regression",
  total: results.length,
  passed,
  failed: results.length - passed,
  results
}, null, 2));
if (passed !== results.length) process.exit(1);
