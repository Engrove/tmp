/**
 * v0.10.12: the gate that would have stopped v0.10.11 from shipping.
 *
 * v0.10.11 declared `CONTENT_SCRIPT_VERSION = "0.10.11"` while `content.js`
 * still said `const VERSION = "0.10.10";`. `ensureContentScript` compares the
 * injected bridge's reported version against the contract, so every
 * `LINK_ACTIVE_TAB` and every Autostart failed before a run could be created.
 * The per-file SHA-256 manifest verified faithfully that the wrong file had been
 * packaged unchanged.
 *
 * This suite closes it three ways: parity across all five version surfaces, an
 * executed `EIC_PING` against the real content bridge, and the same ping against
 * the content.js extracted from the built browser ZIP when one is present.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { APP_VERSION, CONTENT_SCRIPT_VERSION } from "../lib/contracts.mjs";
import {
  RELEASE_IDENTITY_SURFACES,
  evaluateReleaseIdentity,
  parseContentScriptVersion,
  releaseIdentityFailureDetail
} from "../lib/release-identity.mjs";
import {
  AUTOSTART_ABORT_REASON,
  evaluateAutostartPrecondition
} from "../lib/autostart-transaction.mjs";
import { createContentScriptChrome, installFakeDom } from "./helpers/fake-dom.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const pkg = JSON.parse(read("package.json"));
const manifest = JSON.parse(read("manifest.json"));
const contentSource = read("content.js");

/** Boot a content-script source string and ask the bridge who it is. */
async function pingContentBridge(source, label) {
  const chrome = createContentScriptChrome();
  const restore = installFakeDom({ chrome });
  try {
    // Indirect eval keeps the IIFE in global scope, which is where a real
    // content script runs.
    (0, eval)(source);
    assert.ok(chrome.__listeners.length >= 1, `${label}: bridge registrerade ingen onMessage-lyssnare`);
    return await chrome.ask({ type: "EIC_PING" });
  } finally {
    restore();
  }
}

test("v0.10.12 alla fem versionsytor är identiska", () => {
  const verdict = evaluateReleaseIdentity({
    packageVersion: pkg.version,
    manifestVersion: manifest.version,
    appVersion: APP_VERSION,
    contentScriptVersion: CONTENT_SCRIPT_VERSION,
    contentSourceVersion: parseContentScriptVersion(contentSource)
  });
  assert.equal(verdict.ok, true, releaseIdentityFailureDetail(verdict));
  assert.deepEqual(verdict.mismatches, []);
  assert.deepEqual(verdict.errors, []);
  assert.equal(RELEASE_IDENTITY_SURFACES.length, 5);
  for (const surface of RELEASE_IDENTITY_SURFACES) {
    assert.equal(verdict.surfaces[surface], pkg.version, `${surface} avviker`);
  }
});

test("v0.10.12 identitetsgrinden fångar exakt v0.10.11:s glapp", () => {
  const verdict = evaluateReleaseIdentity({
    packageVersion: "0.10.11",
    manifestVersion: "0.10.11",
    appVersion: "0.10.11",
    contentScriptVersion: "0.10.11",
    contentSourceVersion: "0.10.10"
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.mismatches.length, 1);
  assert.match(verdict.mismatches[0], /contentSourceVersion=0\.10\.10/);
  assert.match(releaseIdentityFailureDetail(verdict), /RELEASE_IDENTITY_MISMATCH/);
});

test("v0.10.12 en saknad versionsliteral är ett fel, inte ett tyst pass", () => {
  assert.equal(parseContentScriptVersion("const OTHER = \"1.2.3\";"), "");
  const verdict = evaluateReleaseIdentity({
    packageVersion: "0.10.12",
    manifestVersion: "0.10.12",
    appVersion: "0.10.12",
    contentScriptVersion: "0.10.12",
    contentSourceVersion: ""
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((entry) => entry.includes("contentSourceVersion")));
});

test("v0.10.12 den riktiga content-bridgen svarar på EIC_PING med rätt version", async () => {
  const response = await pingContentBridge(contentSource, "källträd");
  assert.equal(response.ok, true);
  assert.equal(
    response.version,
    CONTENT_SCRIPT_VERSION,
    "bryggan måste rapportera exakt den version ensureContentScript kräver"
  );
  assert.equal(response.version, APP_VERSION);
  assert.equal(response.supported, true);
  assert.ok(response.documentEpoch);
});

test("v0.10.12 ensureContentScript skulle acceptera den paketerade bryggan", async () => {
  // This mirrors the exact comparison in background.js: ping.version must equal
  // CONTENT_SCRIPT_VERSION, otherwise the bridge is rejected and no run starts.
  const response = await pingContentBridge(contentSource, "källträd");
  const accepted = Boolean(response?.ok) && response.version === CONTENT_SCRIPT_VERSION;
  assert.equal(accepted, true,
    `ensureContentScript hade avvisat bryggan: förväntad ${CONTENT_SCRIPT_VERSION}, observerad ${response.version}`);
  assert.match(read("background.js"), /Content bridge kunde inte verifieras/);
});

test("v0.10.12 den byggda browser-ZIP:en bär en bridge med rätt version", async (t) => {
  const dist = path.resolve(root, "..", `eic-autonom-agent-v${pkg.version}-dist`);
  const zipPath = path.join(dist, `eic-autonom-agent-v${pkg.version}-browser.zip`);
  if (!fs.existsSync(zipPath)) {
    t.skip(`ingen byggd browser-ZIP på ${zipPath}; kör npm run package först`);
    return;
  }
  const packaged = execFileSync("python3", [
    "-c",
    "import sys,zipfile;sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read('content.js').decode('utf-8'))",
    zipPath
  ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

  assert.equal(
    parseContentScriptVersion(packaged),
    pkg.version,
    "content.js i browser-paketet bär fel runtimeversion"
  );
  const response = await pingContentBridge(packaged, "browser-ZIP");
  assert.equal(response.ok, true);
  assert.equal(response.version, CONTENT_SCRIPT_VERSION);
});

test("v0.10.12 paketeringen vägrar bygga vid identitetsglapp", () => {
  const packageScript = read("scripts/package.mjs");
  assert.match(packageScript, /evaluateReleaseIdentity/);
  assert.match(packageScript, /RELEASE_IDENTITY_MISMATCH/);
  assert.match(packageScript, /process\.exit\(1\)/);
  // The gate must run before anything is copied into a stage directory.
  assert.ok(
    packageScript.indexOf("evaluateReleaseIdentity") < packageScript.indexOf("function createStage"),
    "identitetsgrinden måste ligga före stage-kopieringen"
  );
});

test("v0.10.12 Autostart förkontrollerar synkront före modellaktivering", () => {
  assert.equal(evaluateAutostartPrecondition({}).ok, false);
  assert.equal(evaluateAutostartPrecondition({}).reason, "NO_SELECTED_TAB");

  const wrongHost = evaluateAutostartPrecondition({
    selectedTabId: 7,
    linkedTabs: { 7: { url: "https://example.com/x" } }
  });
  assert.equal(wrongHost.ok, false);
  assert.equal(wrongHost.reason, "UNSUPPORTED_TARGET_HOST");
  assert.equal(wrongHost.code, "AUTOSTART_PRECONDITION_FAILED");

  const good = evaluateAutostartPrecondition({
    selectedTabId: 7,
    linkedTabs: { 7: { url: "https://chatgpt.com/c/abc" } }
  });
  assert.equal(good.ok, true);

  // An unknown URL must not block: the async readback owns that case.
  assert.equal(evaluateAutostartPrecondition({
    selectedTabId: 7,
    linkedTabs: { 7: {} }
  }).ok, true);
});

test("v0.10.12 Autostart-rollback klassificeras inte som operatörsavbrott", () => {
  const panel = read("sidepanel.js");
  const block = panel.match(/async function autostartClick\([\s\S]*?\n\}/)?.[0] || "";
  assert.ok(block, "autostartClick måste finnas");

  // The synchronous precheck must precede native create().
  assert.ok(
    block.indexOf("evaluateAutostartPrecondition") < block.indexOf("beginNanoCreateFromGestureWithConfig"),
    "förkontrollen måste ligga före LanguageModel.create()"
  );
  // …but it must not introduce an await before create(), which would break the
  // v0.9.11 user-gesture law.
  const beforeCreate = block
    .slice(0, block.indexOf("beginNanoCreateFromGestureWithConfig"))
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  assert.doesNotMatch(beforeCreate, /\bawait\b/, "ingen await får ligga före native create()");

  assert.match(block, /abortNanoHostCreate\(AUTOSTART_ABORT_REASON\.AUTOSTART_PRECONDITION_FAILED\)/);
  assert.equal(AUTOSTART_ABORT_REASON.AUTOSTART_PRECONDITION_FAILED, "AUTOSTART_PRECONDITION_FAILED");
  assert.match(panel, /\[AUTOSTART_ABORT_REASON\.AUTOSTART_PRECONDITION_FAILED\]:/);
  assert.match(panel, /Operatören avbröt inte/);
  // The stale reason must distinguish the two causes, since it is what the
  // export and the Nano host telemetry carry.
  assert.match(panel, /\? "AUTOSTART_PRECONDITION_FAILED"\s*\n?\s*: "CREATE_ABORTED"/);
});
