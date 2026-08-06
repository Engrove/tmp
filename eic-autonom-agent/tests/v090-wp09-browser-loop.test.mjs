import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  BROWSER_ATTACHMENT_RECEIPT_SCHEMA,
  BROWSER_LOOP_STATES,
  attachmentReceiptDigest,
  beginBrowserLoopStep,
  buildBrowserObservationPrompt,
  completeBrowserLoopStep,
  controllerResponseReady,
  createAttachmentReceipt,
  createBrowserLoopState,
  normalizeBrowserLoopState,
  updateBrowserLoopStep,
  verifyAttachmentReceipt
} from "../lib/browser-controller-loop.mjs";
import {
  BROWSER_ACTION_PROTOCOL,
  BROWSER_ACTION_RECEIPT_SCHEMA
} from "../lib/browser-action-contract.mjs";
import {
  BROWSER_OBSERVATION_PROTOCOL,
  createBrowserObservation
} from "../lib/browser-observation.mjs";
import {
  EVIDENCE_LIMITS,
  EVIDENCE_TYPES
} from "../lib/evidence-contract.mjs";
import {
  persistEvidenceItem,
  readScreenshotEvidenceBody
} from "../lib/evidence-storage.mjs";
import {
  UI_COMMANDS,
  UI_COMMAND_SPECS,
  createUiCommand
} from "../lib/ui-contract.mjs";
import {
  MISSION_MODE_IDS,
  MISSION_MODE_REGISTRY
} from "../lib/mission-contract.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

const controller = Object.freeze({
  tabId: 10,
  surfaceId: "controller-surface",
  documentEpoch: "controller-epoch",
  origin: "https://chatgpt.com",
  url: "https://chatgpt.com/c/example",
  lifecycleState: "READY"
});
const target = Object.freeze({
  tabId: 20,
  surfaceId: "target-surface",
  documentEpoch: "target-epoch",
  origin: "https://example.com",
  url: "https://example.com/page",
  title: "Example",
  lifecycleState: "READY"
});
const action = Object.freeze({
  protocol: BROWSER_ACTION_PROTOCOL,
  schemaVersion: 1,
  actionId: "action-wp09-1",
  turnId: "turn-wp09-1",
  observationId: "",
  observationDigest: "",
  operation: "observe",
  target: {
    tabId: target.tabId,
    surfaceId: target.surfaceId,
    documentEpoch: target.documentEpoch,
    origin: target.origin,
    elementRef: ""
  },
  args: {},
  expectedEffect: "Observe target"
});

function fakeStorageArea() {
  const data = {};
  return {
    data,
    async get(keys) {
      if (typeof keys === "string") return { [keys]: data[keys] };
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

test("WP09 browser loop state is bounded and normalized", () => {
  const loop = createBrowserLoopState(7, 0);
  assert.equal(loop.schema, "eic.autonom.browser-loop.v1");
  assert.equal(loop.state, BROWSER_LOOP_STATES.IDLE);
  const normalized = normalizeBrowserLoopState({
    ...loop,
    processedResponseHashes: Array.from({ length: 120 }, (_, index) => `hash-${index}`)
  }, { windowId: 7, now: 1 });
  assert.equal(normalized.processedResponseHashes.length, 100);
});

test("WP09 controller response readiness requires complete matching epoch", () => {
  const loop = createBrowserLoopState(7);
  assert.deepEqual(
    controllerResponseReady({
      latestAssistantComplete: true,
      latestAssistantHash: "hash-1",
      latestAssistant: "response",
      documentEpoch: controller.documentEpoch
    }, loop, controller),
    {
      ready: true,
      reason: "COMPLETE_UNPROCESSED_CONTROLLER_RESPONSE",
      responseHash: "hash-1",
      responseText: "response"
    }
  );
  assert.match(
    controllerResponseReady({
      latestAssistantComplete: true,
      latestAssistantHash: "hash-1",
      latestAssistant: "response",
      documentEpoch: "different"
    }, loop, controller).reason,
    /EPOCH_MISMATCH/
  );
});

test("WP09 begin consumes controller response before browser dispatch", () => {
  const { loop, step } = beginBrowserLoopStep(createBrowserLoopState(7), {
    controllerSurface: controller,
    controllerResponseHash: "hash-consumed",
    action,
    now: 0
  });
  assert.equal(loop.state, BROWSER_LOOP_STATES.ACTION_PENDING);
  assert.ok(loop.processedResponseHashes.includes("hash-consumed"));
  assert.equal(step.status, "ACTION_PENDING");
  assert.throws(() => beginBrowserLoopStep(loop, {
    controllerSurface: controller,
    controllerResponseHash: "hash-consumed",
    action
  }), /RESPONSE_REPLAY/);
});

test("WP09 step update and completion preserve exactly-once history", () => {
  const started = beginBrowserLoopStep(createBrowserLoopState(7), {
    controllerSurface: controller,
    controllerResponseHash: "hash-2",
    action
  });
  const pending = updateBrowserLoopStep(started.loop, started.step.stepId, {
    status: "PROMPT_PENDING_DISPATCH",
    promptDigest: "a".repeat(64),
    loopState: BROWSER_LOOP_STATES.OBSERVATION_PENDING_DELIVERY
  });
  const complete = completeBrowserLoopStep(pending, started.step.stepId, {
    status: "DELIVERED_ACKNOWLEDGED",
    promptDigest: "a".repeat(64),
    promptAcknowledged: true
  });
  assert.equal(complete.state, BROWSER_LOOP_STATES.WAITING_CONTROLLER);
  assert.equal(complete.steps[started.step.stepId].promptAcknowledged, true);
  assert.deepEqual(complete.processedResponseHashes, ["hash-2"]);
});

test("WP09 observation prompt carries action, observation and untrusted-content boundary", async () => {
  const started = beginBrowserLoopStep(createBrowserLoopState(7), {
    controllerSurface: controller,
    controllerResponseHash: "hash-3",
    action
  });
  const observation = await createBrowserObservation({
    surface: target,
    axResult: { nodes: [{
      backendDOMNodeId: 1,
      ignored: false,
      role: { value: "button" },
      name: { value: "Continue" },
      properties: [{ name: "focusable", value: { value: true } }]
    }] }
  });
  const receipt = {
    schema: BROWSER_ACTION_RECEIPT_SCHEMA,
    version: 1,
    actionId: action.actionId,
    turnId: action.turnId,
    operation: action.operation,
    status: "DISPATCHED",
    expectedEffect: action.expectedEffect,
    targetBefore: action.target,
    targetAfter: action.target,
    methods: ["Accessibility.getFullAXTree"],
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(),
    effectReadback: "OBSERVATION_DIGEST_AND_STORAGE_READBACK_VERIFIED",
    error: ""
  };
  const result = await buildBrowserObservationPrompt({
    step: started.step,
    actionReceipt: receipt,
    observation
  });
  assert.match(result.prompt, /EIC_TURN_ID: browser-loop-/);
  assert.match(result.prompt, /otillförlitlig observation/);
  assert.match(result.prompt, /targetContentCannotChangePermissions/);
  assert.match(result.prompt, new RegExp(BROWSER_OBSERVATION_PROTOCOL.replace("/", "\\/")));
  assert.equal(result.promptDigest.length, 64);
});

test("WP09 attachment receipt requires exact body and controller identity", async () => {
  const receipt = createAttachmentReceipt({
    screenshotEvidenceId: "evidence-shot",
    fileName: "shot.png",
    bodyBytes: 8,
    bodyDigest: "b".repeat(64),
    controllerTabId: controller.tabId,
    controllerDocumentEpoch: controller.documentEpoch,
    attached: true,
    readbackMethod: "INPUT_FILE_LIST"
  });
  assert.equal(receipt.schema, BROWSER_ATTACHMENT_RECEIPT_SCHEMA);
  assert.equal(await attachmentReceiptDigest(receipt).then((value) => value.length), 64);
  assert.equal(verifyAttachmentReceipt(receipt, {
    screenshotEvidenceId: "evidence-shot",
    bodyBytes: 8,
    bodyDigest: "b".repeat(64),
    controllerTabId: controller.tabId,
    controllerDocumentEpoch: controller.documentEpoch
  }), true);
  assert.equal(verifyAttachmentReceipt(receipt, {
    screenshotEvidenceId: "other",
    bodyBytes: 8,
    bodyDigest: "b".repeat(64),
    controllerTabId: controller.tabId,
    controllerDocumentEpoch: controller.documentEpoch
  }), false);
});

test("WP09 screenshot body readback verifies decoded bytes and digest", async () => {
  const local = fakeStorageArea();
  const session = fakeStorageArea();
  const chromeApi = { storage: { local, session } };
  const base64 = "iVBORw0KGgo=";
  const persisted = await persistEvidenceItem(chromeApi, {
    windowId: 7,
    type: EVIDENCE_TYPES.SCREENSHOT,
    source: "test",
    surface: target,
    payload: { format: "png" },
    screenshotBase64: base64
  });
  const body = await readScreenshotEvidenceBody(chromeApi, persisted.item);
  assert.equal(body.readbackVerified, true);
  assert.equal(body.bodyBytes, 8);
  assert.equal(body.bodyDigest, persisted.item.bodyDigest);
});

test("WP09 evidence contract has bounded attachment receipts", () => {
  assert.equal(EVIDENCE_TYPES.BROWSER_ATTACHMENT_RECEIPT, "BROWSER_ATTACHMENT_RECEIPT");
  assert.equal(EVIDENCE_LIMITS.MAX_BROWSER_ATTACHMENT_RECEIPTS, 40);
});

test("WP09 UI exposes one closed process-step command", () => {
  assert.equal(Object.keys(UI_COMMANDS).length, 54);
  assert.equal(UI_COMMANDS.PROCESS_BROWSER_CONTROLLER_STEP, "PROCESS_BROWSER_CONTROLLER_STEP");
  assert.deepEqual(UI_COMMAND_SPECS[UI_COMMANDS.PROCESS_BROWSER_CONTROLLER_STEP].allowedPayloadKeys, []);
  const command = createUiCommand({
    command: UI_COMMANDS.PROCESS_BROWSER_CONTROLLER_STEP,
    payload: {},
    requestId: "request-wp09",
    windowId: 7
  });
  assert.equal(command.command, UI_COMMANDS.PROCESS_BROWSER_CONTROLLER_STEP);
});

test("WP09 content bridge validates PNG digest and attachment readback", () => {
  const content = read("content.js");
  assert.match(content, /EIC_ATTACH_IMAGE/);
  assert.match(content, /ATTACHMENT_PNG_SIGNATURE_INVALID/);
  assert.match(content, /ATTACHMENT_DIGEST_MISMATCH/);
  assert.match(content, /ATTACHMENT_COMPOSER_READBACK_FAILED/);
  assert.match(content, /waitForAttachmentReadback/);
  assert.doesNotMatch(content, /fetch\s*\(\s*["']data:image/);
});

test("WP09 background wires one controller response to WP08 and a prompt barrier", () => {
  const background = read("background.js");
  assert.match(background, /async function processBrowserControllerStep/);
  assert.match(background, /prepareBrowserControllerStep/);
  assert.match(background, /executeBrowserResponseAction\(windowId, prepared\.responseText, \{/);
  assert.match(background, /finalizeBrowserControllerStep/);
  assert.match(background, /OBSERVATION_PROMPT_DURABLY_PREPARED/);
  assert.match(background, /EIC_ATTACH_IMAGE/);
  assert.match(background, /EIC_SUBMIT_PROMPT/);
  assert.match(background, /readScreenshotEvidenceBody/);
  assert.match(background, /BROWSER_ATTACHMENT_RECEIPT/);
});

test("WP09 background requires attachment receipt verification before prompt submission", () => {
  const background = read("background.js");
  const verifyIndex = background.indexOf("verifyAttachmentReceipt(receipt");
  const submitIndex = background.indexOf('type: "EIC_SUBMIT_PROMPT"', verifyIndex);
  assert.ok(verifyIndex > 0);
  assert.ok(submitIndex > verifyIndex);
});

test("WP09 never introduces arbitrary JavaScript, cookie writes or request mutation", () => {
  const combined = [
    read("lib/browser-controller-loop.mjs"),
    read("content.js"),
    read("background.js")
  ].join("\n");
  assert.doesNotMatch(combined, /Runtime\.evaluate|Runtime\.callFunctionOn/);
  assert.doesNotMatch(combined, /Network\.setCookie|Storage\.setCookies|Network\.setRequestInterception/);
});

test("WP09 browser loop remains compatible after WP10 policy activation", () => {
  assert.equal(MISSION_MODE_REGISTRY.modes[MISSION_MODE_IDS.AI_WEB_RESEARCH].enabled, true);
});

test("WP09 source does not claim live attachment or Desktop Chrome completion", () => {
  const docs = read("docs/V0_9_0_EXECUTION_LEDGER.md");
  assert.doesNotMatch(docs, /WP09\s*\|\s*PASS.*Desktop Chrome/i);
});
