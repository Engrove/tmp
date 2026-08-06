import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));

test("v0.9.8 release keeps the standard permission baseline unchanged", () => {
  const manifest = json("manifest.json");
  const pkg = json("package.json");
  assert.equal(manifest.version, "0.10.11");
  assert.equal(pkg.version, "0.10.11");
  assert.deepEqual(manifest.permissions, ["sidePanel", "storage", "tabs", "scripting", "alarms"]);
  assert.equal(manifest.permissions.includes("debugger"), false);
  assert.deepEqual(manifest.host_permissions, ["https://chatgpt.com/*", "https://chat.openai.com/*"]);
  assert.equal(Object.hasOwn(manifest, "optional_host_permissions"), false);
});

test("EIC.md codifies forward-only delivery and bounded work units", () => {
  const text = read("EIC.md");
  assert.match(text, /v0\.9\.3/);
  assert.match(text, /no backward compatibility/i);
  assert.match(text, /BOUNDED_CURRENT_UNIT/);
  assert.match(text, /DIRECT_PROGRAM_DELTA/);
});

test("WP00 ledger covers WP00 through WP14 and preserves manual gate progression", () => {
  const text = read("docs/V0_9_0_EXECUTION_LEDGER.md");
  for (let index = 0; index <= 14; index += 1) {
    assert.match(text, new RegExp(`WP${String(index).padStart(2, "0")}`));
  }
  assert.match(text, /\| WP00 \|.*\| IMPLEMENTED \|/);
  assert.match(text, /## WP00 receipt[\s\S]*WP01 remains blocked\s*until the operator explicitly approves it/);
});

test("WP00 architecture and inventory documents exist", () => {
  const required = [
    "docs/V0_9_0_REQUIREMENTS_BASELINE.md",
    "docs/V0_9_0_CONTROL_INVENTORY.md",
    "docs/V0_9_0_STATE_MAP.md",
    "docs/ADR_V0_9_0_001_MISSION_CONTROL.md",
    "docs/ADR_V0_9_0_002_EXPLICIT_SURFACE_ROLES.md",
    "docs/ADR_V0_9_0_003_DUAL_BUILD_PERMISSIONS.md",
    "docs/ADR_V0_9_0_004_BROWSER_PROTOCOL.md",
    "docs/ADR_V0_9_0_005_EVIDENCE_RECOVERY.md",
    "docs/ADR_V0_9_0_006_MANUAL_GATES.md"
  ];
  for (const relative of required) assert.equal(fs.existsSync(path.join(root, relative)), true, relative);
});

test("WP00 records exact source and transcript identities", () => {
  const text = read("docs/V0_9_0_REQUIREMENTS_BASELINE.md");
  assert.match(text, /46bd49e0310ff39b9da906ae024e834ba47ddacc2ae0700b62fd7603b9328c9d/);
  assert.match(text, /d4fc78c8690861af1bfb3cdb14c1cf3a5e79191ff627b24faeb51a091a5c2a26/);
  assert.match(text, /reference-only attachments/);
});

test("Desktop acceptance is retained only as an operator attestation", () => {
  const text = read("docs/DESKTOP_CHROME_ACCEPTANCE_RESULT_V0_8_2.md");
  assert.match(text, /operator attestation/i);
  assert.match(text, /not established/i);
});
