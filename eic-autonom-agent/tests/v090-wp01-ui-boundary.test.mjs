import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  UI_COMMANDS,
  UI_COMMAND_RESULT_SCHEMA,
  UI_COMMAND_SCHEMA,
  UI_COMMAND_SPECS,
  UI_RESPONSE_KINDS,
  UI_SNAPSHOT_SCHEMA,
  createUiCommand,
  createUiSnapshot,
  dispatchUiCommand,
  readUiSnapshotModel,
  unwrapUiCommandResult
} from "../lib/ui-contract.mjs";
import { createUiRuntimeClient } from "../lib/ui-runtime-client.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));

function sampleSnapshot() {
  return createUiSnapshot({
    appVersion: "0.10.12",
    windowId: 7,
    snapshotId: "ui-snapshot-test",
    capturedAt: "2026-08-04T07:00:00.000Z",
    config: { maxTurns: 30 },
    continuity: { stableGoal: "test" },
    window: { alias: "Fönster 7", run: null },
    audit: [{ title: "event" }]
  });
}

test("WP01 command registry is closed and declares response kinds", () => {
  assert.equal(Object.keys(UI_COMMANDS).length, 54);
  assert.deepEqual(
    new Set(Object.values(UI_COMMANDS)),
    new Set(Object.keys(UI_COMMAND_SPECS))
  );
  assert.equal(UI_COMMAND_SPECS.NANO_HEARTBEAT.responseKind, UI_RESPONSE_KINDS.ACK);
  assert.deepEqual(UI_COMMAND_SPECS.START_MISSION.requiredPayloadKeys, ["modeId", "input"]);
  for (const [command, spec] of Object.entries(UI_COMMAND_SPECS)) {
    if ([UI_COMMANDS.NANO_HEARTBEAT, UI_COMMANDS.GET_APPLICATION_LOG, UI_COMMANDS.GET_FULL_AUDIT_BATCH, UI_COMMANDS.ACK_FULL_AUDIT_BATCH].includes(command)) {
      assert.equal(spec.responseKind, UI_RESPONSE_KINDS.ACK, command);
    } else {
      assert.equal(spec.responseKind, UI_RESPONSE_KINDS.SNAPSHOT, command);
    }
  }
});

test("WP01 command envelope keeps payload separate from routing metadata", () => {
  const message = createUiCommand({
    command: UI_COMMANDS.SELECT_TAB,
    windowId: 7,
    requestId: "request-1",
    payload: { tabId: 42 }
  });
  assert.equal(message.schema, UI_COMMAND_SCHEMA);
  assert.equal(message.command, UI_COMMANDS.SELECT_TAB);
  assert.equal(message.windowId, 7);
  assert.deepEqual(message.payload, { tabId: 42 });
  assert.equal(Object.hasOwn(message, "tabId"), false);

  assert.throws(
    () => createUiCommand({
      command: UI_COMMANDS.SELECT_TAB,
      windowId: 7,
      payload: { tabId: 42, arbitraryAuthority: true }
    }),
    /UI_COMMAND_PAYLOAD_KEY_NOT_ALLOWED/
  );
  assert.throws(
    () => createUiCommand({ command: "EXECUTE_JAVASCRIPT", windowId: 7 }),
    /UNKNOWN_UI_COMMAND/
  );
});

test("WP01 uiSnapshot is versioned and detached from runtime objects", () => {
  const config = { nested: { value: 1 } };
  const window = { run: { state: "IDLE" } };
  const snapshot = createUiSnapshot({
    appVersion: "0.10.12",
    windowId: 7,
    snapshotId: "snapshot-1",
    capturedAt: "2026-08-04T07:00:00.000Z",
    config,
    continuity: {},
    window,
    audit: []
  });
  assert.equal(snapshot.schema, UI_SNAPSHOT_SCHEMA);
  assert.equal(snapshot.snapshotVersion, 3);
  assert.equal(readUiSnapshotModel(snapshot).config.nested.value, 1);
  config.nested.value = 2;
  window.run.state = "STOPPED";
  assert.equal(readUiSnapshotModel(snapshot).config.nested.value, 1);
  assert.equal(readUiSnapshotModel(snapshot).window.run.state, "IDLE");
  assert.equal(snapshot.config, undefined);
  assert.equal(snapshot.window, undefined);
});

test("WP01 dispatcher returns a bound snapshot result", async () => {
  const message = createUiCommand({
    command: UI_COMMANDS.GET_SNAPSHOT,
    windowId: 7,
    requestId: "request-snapshot"
  });
  const result = await dispatchUiCommand(message, {
    [UI_COMMANDS.GET_SNAPSHOT]: async ({ windowId, payload }) => {
      assert.equal(windowId, 7);
      assert.deepEqual(payload, {});
      return sampleSnapshot();
    }
  });
  assert.equal(result.schema, UI_COMMAND_RESULT_SCHEMA);
  assert.equal(result.command, UI_COMMANDS.GET_SNAPSHOT);
  assert.equal(result.requestId, "request-snapshot");
  assert.equal(result.responseKind, UI_RESPONSE_KINDS.SNAPSHOT);
  assert.equal(result.uiSnapshot.schema, UI_SNAPSHOT_SCHEMA);
  assert.equal(
    unwrapUiCommandResult(result, {
      command: UI_COMMANDS.GET_SNAPSHOT,
      requestId: "request-snapshot"
    }).snapshotId,
    "ui-snapshot-test"
  );
});

test("WP01 dispatcher keeps heartbeat acknowledgement separate from uiSnapshot", async () => {
  const message = createUiCommand({
    command: UI_COMMANDS.NANO_HEARTBEAT,
    windowId: 7,
    requestId: "request-heartbeat",
    payload: { requestId: "nano-1", claimId: "claim-1", outputChars: 3, chunkCount: 1 }
  });
  const result = await dispatchUiCommand(message, {
    [UI_COMMANDS.NANO_HEARTBEAT]: async ({ payload }) => ({
      ok: true,
      requestId: payload.requestId,
      heartbeatAt: "2026-08-04T07:00:01.000Z"
    })
  });
  assert.equal(result.responseKind, UI_RESPONSE_KINDS.ACK);
  assert.equal(Object.hasOwn(result, "uiSnapshot"), false);
  assert.equal(result.data.requestId, "nano-1");
});

test("WP01 runtime client creates and validates the full request/result round trip", async () => {
  let sent = null;
  const client = createUiRuntimeClient({
    getWindowId: () => 7,
    sendMessage: async (message) => {
      sent = message;
      return dispatchUiCommand(message, {
        [UI_COMMANDS.GET_SNAPSHOT]: async () => sampleSnapshot()
      });
    }
  });
  const snapshot = await client.dispatch(UI_COMMANDS.GET_SNAPSHOT);
  assert.equal(sent.schema, UI_COMMAND_SCHEMA);
  assert.equal(sent.windowId, 7);
  assert.equal(snapshot.schema, UI_SNAPSHOT_SCHEMA);
});

test("WP01 result validation rejects cross-request response confusion", () => {
  assert.throws(
    () => unwrapUiCommandResult({
      ok: true,
      schema: UI_COMMAND_RESULT_SCHEMA,
      resultVersion: 1,
      requestId: "wrong-request",
      command: UI_COMMANDS.GET_SNAPSHOT,
      responseKind: UI_RESPONSE_KINDS.SNAPSHOT,
      uiSnapshot: sampleSnapshot()
    }, {
      command: UI_COMMANDS.GET_SNAPSHOT,
      requestId: "expected-request"
    }),
    /UI_COMMAND_RESULT_REQUEST_ID_MISMATCH/
  );
});

test("WP01 source wiring centralizes dispatch outside the DOM renderer", () => {
  const panel = read("sidepanel.js");
  const background = read("background.js");
  assert.match(panel, /createUiRuntimeClient/);
  assert.match(panel, /readUiSnapshotModel/);
  assert.doesNotMatch(panel, /type:\s*["']EIC_UI_COMMAND["']/);
  assert.match(background, /const UI_COMMAND_HANDLERS = Object\.freeze/);
  assert.match(background, /dispatchUiCommand\(message, UI_COMMAND_HANDLERS\)/);
  assert.doesNotMatch(background, /switch\s*\(message\.command\)/);
});

test("WP01 keeps application and manifest versions synchronized with standard permissions", () => {
  const manifest = json("manifest.json");
  const pkg = json("package.json");
  const contract = read("docs/V0_9_0_WP01_UI_RUNTIME_BOUNDARY.md");
  assert.equal(pkg.version, "0.10.12");
  assert.equal(manifest.version, "0.10.12");
  assert.deepEqual(manifest.permissions, ["sidePanel", "storage", "tabs", "scripting", "alarms"]);
  assert.deepEqual(manifest.host_permissions, ["https://chatgpt.com/*", "https://chat.openai.com/*"]);
  assert.match(contract, /does not create the Mission domain, change persistent storage schemas/i);
});

test("WP01 documentation retains its boundary while the ledger advances", () => {
  const ledger = read("docs/V0_9_0_EXECUTION_LEDGER.md");
  const contract = read("docs/V0_9_0_WP01_UI_RUNTIME_BOUNDARY.md");
  assert.match(ledger, /\| WP01 \|.*\| IMPLEMENTED \|/);
  assert.match(ledger, /## WP01 receipt[\s\S]*WP02 remains blocked until explicit operator approval/);
  assert.match(contract, /uiSnapshot/);
  assert.match(contract, /No Mission Control visual redesign/i);
  assert.match(contract, /WP02/i);
});
