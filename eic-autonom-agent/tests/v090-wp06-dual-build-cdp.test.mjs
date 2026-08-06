import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUILD_PROFILES,
  BROWSER_OPTIONAL_HOSTS,
  createManifestForProfile,
  detectBuildProfile,
  exactOriginPattern
} from "../lib/build-profile.mjs";
import {
  containsExactOriginPermission,
  requestExactOriginPermission,
  revokeExactOriginPermission
} from "../lib/browser-permission.mjs";
import {
  CDP_SESSION_STATES,
  attachBoundedCdp,
  cdpSessionMatchesSurface,
  detachBoundedCdp,
  markCdpSessionStale
} from "../lib/cdp-session.mjs";
import { UI_COMMANDS, UI_COMMAND_SPECS } from "../lib/ui-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseManifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

function targetSurface(overrides = {}) {
  return {
    role: "WEB_TARGET",
    surfaceId: "surface-target-1",
    tabId: 42,
    windowId: 7,
    url: "https://example.org/research?q=1",
    origin: "https://example.org",
    lifecycleState: "READY",
    documentEpoch: "epoch-1",
    ...overrides
  };
}

test("WP06 standard profile remains least-privileged", () => {
  const manifest = createManifestForProfile(baseManifest, BUILD_PROFILES.STANDARD);
  assert.equal(detectBuildProfile(manifest), BUILD_PROFILES.STANDARD);
  assert.equal(manifest.permissions.includes("debugger"), false);
  assert.equal("optional_host_permissions" in manifest, false);
  assert.deepEqual(manifest.host_permissions, [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*"
  ]);
});

test("WP06 browser profile adds debugger only with optional web origins", () => {
  const manifest = createManifestForProfile(baseManifest, BUILD_PROFILES.BROWSER);
  assert.equal(detectBuildProfile(manifest), BUILD_PROFILES.BROWSER);
  assert.equal(manifest.permissions.includes("debugger"), true);
  assert.deepEqual(manifest.optional_host_permissions, [...BROWSER_OPTIONAL_HOSTS]);
  assert.equal(manifest.host_permissions.includes("http://*/*"), false);
  assert.equal(manifest.host_permissions.includes("https://*/*"), false);
  assert.match(manifest.name, /Browser$/);
});

test("WP06 detects mixed privileged manifests fail-closed", () => {
  const invalid = {
    ...baseManifest,
    permissions: [...baseManifest.permissions, "debugger"],
    host_permissions: [...baseManifest.host_permissions, "https://*/*"]
  };
  assert.throws(() => detectBuildProfile(invalid), /BUILD_PROFILE_PERMISSION_MIX_INVALID/);
});

test("WP06 exact origin patterns reject non-web and ChatGPT targets", () => {
  assert.equal(exactOriginPattern("https://example.org/a"), "https://example.org/*");
  assert.equal(exactOriginPattern("http://localhost:8080/a"), "http://localhost:8080/*");
  assert.throws(() => exactOriginPattern("file:///tmp/a"), /PROTOCOL_UNSUPPORTED/);
  assert.throws(() => exactOriginPattern("https://chatgpt.com/c/1"), /CHATGPT_FORBIDDEN/);
});

test("WP06 permission request uses one exact origin and verifies readback", async () => {
  const calls = [];
  let granted = false;
  const chromeApi = {
    permissions: {
      async request(value) {
        calls.push(["request", value]);
        granted = true;
        return true;
      },
      async contains(value) {
        calls.push(["contains", value]);
        return granted;
      },
      async remove(value) {
        calls.push(["remove", value]);
        granted = false;
        return true;
      }
    }
  };
  const requested = await requestExactOriginPermission(
    chromeApi,
    BUILD_PROFILES.BROWSER,
    "https://example.org/path"
  );
  assert.deepEqual(requested, {
    pattern: "https://example.org/*",
    requested: true,
    granted: true
  });
  assert.deepEqual(calls[0], ["request", { origins: ["https://example.org/*"] }]);
  assert.deepEqual(calls[1], ["contains", { origins: ["https://example.org/*"] }]);

  const contained = await containsExactOriginPermission(chromeApi, "https://example.org/other");
  assert.equal(contained.granted, true);

  const revoked = await revokeExactOriginPermission(
    chromeApi,
    BUILD_PROFILES.BROWSER,
    "https://example.org/other"
  );
  assert.equal(revoked.granted, false);
  assert.deepEqual(calls.at(-2), ["remove", { origins: ["https://example.org/*"] }]);
  assert.deepEqual(calls.at(-1), ["contains", { origins: ["https://example.org/*"] }]);
});

test("WP06 standard profile cannot request web permission", async () => {
  const chromeApi = {
    permissions: {
      request: async () => true,
      contains: async () => true,
      remove: async () => true
    }
  };
  await assert.rejects(
    requestExactOriginPermission(chromeApi, BUILD_PROFILES.STANDARD, "https://example.org"),
    /BROWSER_PROFILE_REQUIRED/
  );
});

test("WP06 bounded CDP session attaches only after exact-origin grant", async () => {
  const calls = [];
  const chromeApi = {
    debugger: {
      async attach(target, version) {
        calls.push(["attach", target, version]);
      },
      async detach(target) {
        calls.push(["detach", target]);
      },
      async sendCommand() {
        calls.push(["sendCommand"]);
      }
    }
  };
  const surface = targetSurface();
  const session = await attachBoundedCdp(chromeApi, {
    profile: BUILD_PROFILES.BROWSER,
    surface,
    permissionGranted: true,
    now: Date.parse("2026-08-04T10:00:00Z")
  });
  assert.equal(session.state, CDP_SESSION_STATES.ATTACHED);
  assert.equal(session.tabId, 42);
  assert.equal(session.surfaceId, surface.surfaceId);
  assert.equal(session.documentEpoch, surface.documentEpoch);
  assert.equal(cdpSessionMatchesSurface(session, surface), true);
  assert.deepEqual(calls, [["attach", { tabId: 42 }, "1.3"]]);

  const detached = await detachBoundedCdp(chromeApi, session, {
    now: Date.parse("2026-08-04T10:01:00Z")
  });
  assert.equal(detached.state, CDP_SESSION_STATES.DETACHED);
  assert.deepEqual(calls.at(-1), ["detach", { tabId: 42 }]);
  assert.equal(calls.some(([name]) => name === "sendCommand"), false);
});

test("WP06 CDP attach fails closed on profile, permission, lifecycle and identity", async () => {
  const chromeApi = { debugger: { attach: async () => {} } };
  const surface = targetSurface();
  await assert.rejects(
    attachBoundedCdp(chromeApi, {
      profile: BUILD_PROFILES.STANDARD,
      surface,
      permissionGranted: true
    }),
    /BROWSER_PROFILE_REQUIRED/
  );
  await assert.rejects(
    attachBoundedCdp(chromeApi, {
      profile: BUILD_PROFILES.BROWSER,
      surface,
      permissionGranted: false
    }),
    /EXACT_ORIGIN_PERMISSION_REQUIRED/
  );
  await assert.rejects(
    attachBoundedCdp(chromeApi, {
      profile: BUILD_PROFILES.BROWSER,
      surface: targetSurface({ lifecycleState: "LOADING" }),
      permissionGranted: true
    }),
    /TARGET_NOT_READY/
  );
  await assert.rejects(
    attachBoundedCdp(chromeApi, {
      profile: BUILD_PROFILES.BROWSER,
      surface: targetSurface({ documentEpoch: "" }),
      permissionGranted: true
    }),
    /TARGET_IDENTITY_REQUIRED/
  );
});

test("WP06 target identity change invalidates attached session", async () => {
  const chromeApi = { debugger: { attach: async () => {} } };
  const surface = targetSurface();
  const session = await attachBoundedCdp(chromeApi, {
    profile: BUILD_PROFILES.BROWSER,
    surface,
    permissionGranted: true
  });
  assert.equal(cdpSessionMatchesSurface(session, {
    ...surface,
    documentEpoch: "epoch-2"
  }), false);
  assert.equal(markCdpSessionStale(session).state, CDP_SESSION_STATES.STALE);
});

test("WP06 adds four closed capability commands", () => {
  const expected = [
    "ATTACH_WEB_TARGET_DEBUGGER",
    "DETACH_WEB_TARGET_DEBUGGER",
    "REQUEST_WEB_TARGET_PERMISSION",
    "REVOKE_WEB_TARGET_PERMISSION"
  ];
  for (const command of expected) {
    assert.equal(UI_COMMANDS[command], command);
    assert.deepEqual(UI_COMMAND_SPECS[command].allowedPayloadKeys, []);
    assert.deepEqual(UI_COMMAND_SPECS[command].requiredPayloadKeys, []);
  }
});

test("WP06 boundary remains separated after WP07 evidence capture", () => {
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const packageScript = fs.readFileSync(path.join(root, "scripts/package.mjs"), "utf8");
  const html = fs.readFileSync(path.join(root, "sidepanel.html"), "utf8");
  assert.match(packageScript, /-standard\.zip/);
  assert.match(packageScript, /-browser\.zip/);
  assert.match(packageScript, /createManifestForProfile/);
  assert.match(background, /requestExactOriginPermission/);
  assert.match(background, /attachBoundedCdp/);
  const observer = fs.readFileSync(path.join(root, "lib/cdp-evidence.mjs"), "utf8");
  assert.doesNotMatch(background, /chrome\.debugger\.sendCommand/);
  assert.match(observer, /DOMSnapshot\.captureSnapshot/);
  assert.match(observer, /Accessibility\.getFullAXTree/);
  assert.match(observer, /Page\.captureScreenshot/);
  assert.match(observer, /Runtime\.evaluate/);
  assert.doesNotMatch(observer, /send\(chromeApi, session, "Runtime\.evaluate"/);
  assert.match(html, /Bevilja exakt origin/);
  assert.match(html, /Anslut CDP/);
});

test("WP06 source manifest remains the standard profile", () => {
  assert.equal(detectBuildProfile(baseManifest), BUILD_PROFILES.STANDARD);
  assert.equal(baseManifest.permissions.includes("debugger"), false);
  assert.equal("optional_host_permissions" in baseManifest, false);
});
