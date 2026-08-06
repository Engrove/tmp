
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  EVIDENCE_LIMITS,
  EVIDENCE_OBSERVATION_STATES,
  EVIDENCE_TYPES,
  appendEvidenceItem,
  createEvidenceItem,
  createEvidenceObservation,
  createEvidenceStore,
  evidenceStoreSummary,
  redactEvidenceText,
  sanitizeEvidenceHeaders,
  sanitizeEvidenceUrl
} from "../lib/evidence-contract.mjs";
import {
  evidenceEventType,
  summarizeAccessibilityTree,
  summarizeCdpEvent,
  summarizeDomSnapshot,
  summarizeNetworkEvent
} from "../lib/evidence-redaction.mjs";
import {
  EVIDENCE_STORAGE_KEYS,
  clearWindowEvidence,
  loadWindowEvidenceStore,
  persistEvidenceItem,
  setEvidenceObservation
} from "../lib/evidence-storage.mjs";
import {
  WP07_CDP_ENABLE_COMMANDS,
  WP07_CDP_SNAPSHOT_COMMANDS,
  WP07_FORBIDDEN_CDP_COMMANDS,
  captureEvidenceBundle,
  enableEvidenceDomains,
  normalizeCdpEvidenceEvent
} from "../lib/cdp-evidence.mjs";
import {
  UI_COMMANDS
} from "../lib/ui-contract.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function fakeStorageArea() {
  const data = {};
  return {
    data,
    async get(keys) {
      if (typeof keys === "string") return { [keys]: data[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, data[key]]));
      return { ...data };
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }
  };
}

function fakeChrome() {
  const local = fakeStorageArea();
  const session = fakeStorageArea();
  const calls = [];
  return {
    calls,
    storage: { local, session },
    debugger: {
      async sendCommand(target, method, params) {
        calls.push({ target, method, params });
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [
              {
                nodeId: "1",
                role: { value: "button" },
                name: { value: "Continue" },
                childIds: []
              },
              {
                nodeId: "2",
                role: { value: "textbox" },
                name: { value: "password=very-secret" },
                value: { value: "never-persist" }
              }
            ]
          };
        }
        if (method === "DOMSnapshot.captureSnapshot") {
          return {
            strings: ["https://example.com/path?token=secret", "DIV", "private text"],
            documents: [
              {
                documentURL: 0,
                nodes: {
                  nodeName: [1, 1],
                  nodeValue: [-1, 2],
                  attributes: [[0, 2]]
                },
                layout: {
                  nodeIndex: [0, 1],
                  bounds: [[0, 0, 100, 30], [0, 40, 200, 20]]
                }
              }
            ]
          };
        }
        if (method === "Page.captureScreenshot") return { data: "aGVsbG8=" };
        return {};
      }
    }
  };
}

const surface = {
  tabId: 77,
  surfaceId: "surface-target",
  documentEpoch: "epoch-1",
  origin: "https://example.com",
  url: "https://example.com/path?token=secret",
  lifecycleState: "READY"
};

const session = {
  state: "ATTACHED",
  tabId: 77,
  surfaceId: "surface-target",
  documentEpoch: "epoch-1",
  origin: "https://example.com"
};

test("WP07 redacts credential-like text and sensitive headers", () => {
  const text = redactEvidenceText(
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz password=hunter2 token=abcdef0123456789abcdef0123456789"
  );
  assert.doesNotMatch(text, /hunter2|abcdefghijklmnopqrstuvwxyz|abcdef0123456789abcdef0123456789/);
  const headers = sanitizeEvidenceHeaders({
    Authorization: "Bearer secret-token-value",
    Cookie: "session=secret",
    "Content-Type": "text/html",
    "X-Api-Key": "secret"
  });
  assert.deepEqual(headers, { "content-type": "text/html" });
});

test("WP07 strips URL credentials, query and fragment", () => {
  assert.equal(
    sanitizeEvidenceUrl("https://user:pass@example.com/path?q=secret#fragment"),
    "https://example.com/path"
  );
});

test("WP07 AX summary never persists field values", () => {
  const summary = summarizeAccessibilityTree({
    nodes: [{
      nodeId: "1",
      role: { value: "textbox" },
      name: { value: "Password token=secretvalue" },
      value: { value: "actual-password" }
    }]
  });
  const json = JSON.stringify(summary);
  assert.doesNotMatch(json, /actual-password|secretvalue/);
  assert.match(json, /REDACTED_FIELD_NAME/);
});

test("WP07 DOM summary excludes strings and attributes", () => {
  const summary = summarizeDomSnapshot({
    strings: ["https://example.com/path?secret=x", "password", "value"],
    documents: [{
      documentURL: 0,
      nodes: { nodeName: [1], nodeValue: [2], attributes: [[1, 2]] },
      layout: { nodeIndex: [0], bounds: [[0, 0, 10, 10]] }
    }]
  });
  const json = JSON.stringify(summary);
  assert.equal(summary.documents[0].documentUrl, "https://example.com/path");
  assert.equal(summary.stringsPersisted, false);
  assert.equal(summary.attributesPersisted, false);
  assert.doesNotMatch(json, /password|value/);
});

test("WP07 network summaries omit bodies, sensitive headers and query strings", () => {
  const payload = summarizeNetworkEvent("Network.responseReceived", {
    requestId: "r1",
    response: {
      url: "https://example.com/api?access_token=secret",
      status: 401,
      mimeType: "application/json",
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "secret",
        Authorization: "Bearer secret"
      }
    }
  });
  const json = JSON.stringify(payload);
  assert.equal(payload.url, "https://example.com/api");
  assert.equal(payload.bodyPersisted, false);
  assert.doesNotMatch(json, /secret|set-cookie|authorization/i);
});

test("WP07 event registry accepts only bounded metadata events", () => {
  assert.equal(evidenceEventType("Runtime.consoleAPICalled"), EVIDENCE_TYPES.CONSOLE);
  assert.equal(evidenceEventType("Network.loadingFailed"), EVIDENCE_TYPES.NETWORK);
  assert.equal(evidenceEventType("Page.frameNavigated"), EVIDENCE_TYPES.NAVIGATION);
  assert.equal(evidenceEventType("Network.dataReceived"), null);
  assert.equal(normalizeCdpEvidenceEvent("Network.getResponseBody", {}), null);
});

test("WP07 evidence store enforces item and durable-byte bounds", async () => {
  let store = createEvidenceStore(1);
  for (let index = 0; index < EVIDENCE_LIMITS.MAX_ITEMS + 30; index += 1) {
    const item = await createEvidenceItem({
      type: EVIDENCE_TYPES.CONSOLE,
      windowId: 1,
      surface,
      payload: { index, text: "x".repeat(200) }
    });
    store = appendEvidenceItem(store, item);
  }
  const summary = evidenceStoreSummary(store);
  assert.ok(summary.count <= EVIDENCE_LIMITS.MAX_CONSOLE_ITEMS);
  assert.ok(summary.durableBytes <= EVIDENCE_LIMITS.MAX_DURABLE_BYTES);
});

test("WP07 durable item write requires local readback", async () => {
  const chromeApi = fakeChrome();
  const result = await persistEvidenceItem(chromeApi, {
    windowId: 3,
    type: EVIDENCE_TYPES.CONSOLE,
    source: "test",
    surface,
    payload: { text: "safe" }
  });
  assert.equal(result.item.type, EVIDENCE_TYPES.CONSOLE);
  const readback = await loadWindowEvidenceStore(chromeApi, 3);
  assert.equal(readback.items[0].digest, result.item.digest);
});

test("WP07 screenshot body is session-only and digest/readback verified", async () => {
  const chromeApi = fakeChrome();
  const result = await persistEvidenceItem(chromeApi, {
    windowId: 4,
    type: EVIDENCE_TYPES.SCREENSHOT,
    source: "test",
    surface,
    payload: { format: "png", rawBodyDurable: false },
    screenshotBase64: "aGVsbG8="
  });
  assert.equal(result.item.bodyStorage, "SESSION_RAW_PNG");
  assert.equal(result.item.bodyBytes, 5);
  assert.equal(result.item.readbackVerified, true);
  assert.ok(chromeApi.storage.session.data[result.item.bodyKey]);
  const localJson = JSON.stringify(chromeApi.storage.local.data);
  assert.doesNotMatch(localJson, /aGVsbG8=/);
});

test("WP07 clear removes durable metadata and session bodies with readback", async () => {
  const chromeApi = fakeChrome();
  const result = await persistEvidenceItem(chromeApi, {
    windowId: 5,
    type: EVIDENCE_TYPES.SCREENSHOT,
    source: "test",
    surface,
    payload: {},
    screenshotBase64: "aGVsbG8="
  });
  await clearWindowEvidence(chromeApi, 5);
  assert.equal(chromeApi.storage.session.data[result.item.bodyKey], undefined);
  const readback = await loadWindowEvidenceStore(chromeApi, 5);
  assert.equal(readback.items.length, 0);
});

test("WP07 observation state persists through owner readback", async () => {
  const chromeApi = fakeChrome();
  const observation = createEvidenceObservation({
    state: EVIDENCE_OBSERVATION_STATES.ACTIVE,
    sessionId: "s1",
    surface
  });
  const stored = await setEvidenceObservation(chromeApi, 6, observation);
  assert.equal(stored.observation.state, EVIDENCE_OBSERVATION_STATES.ACTIVE);
  assert.equal(stored.observation.documentEpoch, surface.documentEpoch);
});

test("WP07 enables only Runtime, Log, Network and Page metadata domains", async () => {
  const chromeApi = fakeChrome();
  const receipts = await enableEvidenceDomains(chromeApi, { session, surface });
  assert.deepEqual(receipts.map((item) => item.method), [...WP07_CDP_ENABLE_COMMANDS]);
  assert.deepEqual(chromeApi.calls.map((call) => call.method), [...WP07_CDP_ENABLE_COMMANDS]);
  assert.equal(chromeApi.calls.find((call) => call.method === "Network.enable").params.maxPostDataSize, 0);
});

test("WP07 snapshot uses AX, DOMSnapshot and screenshot only", async () => {
  const chromeApi = fakeChrome();
  const bundle = await captureEvidenceBundle(chromeApi, { session, surface });
  assert.deepEqual(chromeApi.calls.map((call) => call.method), [...WP07_CDP_SNAPSHOT_COMMANDS]);
  assert.equal(bundle.screenshot.base64, "aGVsbG8=");
  assert.equal(bundle.screenshot.payload.promptDeliveryAllowed, false);
  assert.equal(bundle.screenshot.payload.rawBodyDurable, false);
  for (const forbidden of WP07_FORBIDDEN_CDP_COMMANDS) {
    assert.ok(!chromeApi.calls.some((call) => call.method === forbidden));
  }
});

test("WP07 rejects stale target identity before any CDP command", async () => {
  const chromeApi = fakeChrome();
  await assert.rejects(
    captureEvidenceBundle(chromeApi, {
      session: { ...session, documentEpoch: "old" },
      surface
    }),
    /EVIDENCE_TARGET_IDENTITY_MISMATCH/
  );
  assert.equal(chromeApi.calls.length, 0);
});

test("WP07 adds four closed UI commands", () => {
  assert.equal(Object.keys(UI_COMMANDS).length, 54);
  for (const command of [
    "START_EVIDENCE_OBSERVATION",
    "CAPTURE_EVIDENCE_SNAPSHOT",
    "STOP_EVIDENCE_OBSERVATION",
    "CLEAR_BROWSER_EVIDENCE"
  ]) assert.equal(UI_COMMANDS[command], command);
});

test("WP07 source wiring excludes response-body and arbitrary execution", () => {
  const background = read("background.js");
  const observer = read("lib/cdp-evidence.mjs");
  const html = read("sidepanel.html");
  assert.match(background, /chrome\.debugger\?\.onEvent/);
  assert.match(background, /persistEvidenceItem/);
  assert.match(background, /CAPTURE_EVIDENCE_SNAPSHOT/);
  assert.match(html, /id="browserEvidenceList"/);
  assert.match(html, /id="startEvidenceObservationButton"/);
  assert.doesNotMatch(background, /sendCommand\([^)]*["']Runtime\.evaluate/);
  assert.doesNotMatch(background, /Network\.getResponseBody/);
  assert.doesNotMatch(observer, /execute_javascript|eval\(/);
  assert.match(observer, /Network\.getResponseBody/);
});

test("WP07 storage root is separate from runtime and screenshot bodies", () => {
  assert.equal(EVIDENCE_STORAGE_KEYS.ROOT, "eicAutonomAgent.v3.browserEvidence");
  assert.match(EVIDENCE_STORAGE_KEYS.BODY_PREFIX, /browserEvidenceBody/);
});
