import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BROWSER_ACTION_PROTOCOL,
  BROWSER_ACTIONS,
  BROWSER_ACTION_RECEIPT_SCHEMA,
  FORBIDDEN_BROWSER_ACTIONS,
  parseBrowserActionResponse,
  normalizeBrowserAction,
  validateBrowserAction
} from "../lib/browser-action-contract.mjs";
import {
  BROWSER_OBSERVATION_PROTOCOL,
  createBrowserObservation,
  verifyBrowserObservation
} from "../lib/browser-observation.mjs";
import {
  BROWSER_EXECUTOR_FORBIDDEN_METHODS,
  executeBrowserAction
} from "../lib/browser-action-executor.mjs";
import {
  UI_COMMANDS,
  UI_COMMAND_SPECS,
  createUiCommand
} from "../lib/ui-contract.mjs";
import {
  EVIDENCE_TYPES,
  EVIDENCE_LIMITS
} from "../lib/evidence-contract.mjs";

const surface = Object.freeze({
  tabId: 41,
  surfaceId: "surface-web-41",
  documentEpoch: "epoch-7",
  origin: "https://example.com",
  url: "https://example.com/page?q=secret",
  title: "Example"
});

function axNode({
  id = 1,
  role = "button",
  name = "Continue",
  disabled = false,
  checked = false,
  editable = false
} = {}) {
  return {
    backendDOMNodeId: id,
    ignored: false,
    role: { value: role },
    name: { value: name },
    properties: [
      { name: "focusable", value: { value: true } },
      { name: "disabled", value: { value: disabled } },
      { name: "checked", value: { value: checked } },
      { name: "editable", value: { value: editable } }
    ]
  };
}

async function observation(now = Date.now()) {
  return createBrowserObservation({
    surface,
    now,
    axResult: {
      nodes: [
        axNode({ id: 11, role: "button", name: "Continue" }),
        axNode({ id: 12, role: "textbox", name: "Search", editable: true }),
        axNode({ id: 13, role: "textbox", name: "Password", editable: true }),
        axNode({ id: 14, role: "checkbox", name: "Accept", checked: false }),
        axNode({ id: 15, role: "combobox", name: "Region" }),
        axNode({ id: 16, role: "button", name: "Disabled", disabled: true })
      ]
    }
  });
}

function actionValue({
  operation = "observe",
  obs = null,
  elementRef = "",
  args = {},
  actionId = "action-1",
  turnId = "turn-1",
  target = surface,
  extra = {}
} = {}) {
  return {
    protocol: BROWSER_ACTION_PROTOCOL,
    schemaVersion: 1,
    actionId,
    turnId,
    observationId: obs?.observationId || (operation === "observe" ? "" : "observation-placeholder"),
    observationDigest: obs?.observationDigest || (operation === "observe" ? "" : "0".repeat(64)),
    operation,
    target: {
      tabId: target.tabId,
      surfaceId: target.surfaceId,
      documentEpoch: target.documentEpoch,
      origin: target.origin,
      ...(elementRef ? { elementRef } : {})
    },
    args,
    expectedEffect: `Perform ${operation}`,
    ...extra
  };
}

function responseFor(value) {
  return `Plan text\n${BROWSER_ACTION_PROTOCOL}\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
}

function fakeChrome(handler = {}) {
  const methods = [];
  return {
    methods,
    debugger: {
      async sendCommand(target, method, params) {
        methods.push({ target, method, params });
        if (handler[method]) return handler[method](params, methods);
        if (method === "Accessibility.getFullAXTree") {
          return { nodes: [axNode({ id: 21, role: "button", name: "Observed" })] };
        }
        if (method === "DOM.getBoxModel") {
          return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
        }
        if (method === "Page.getNavigationHistory") {
          return {
            currentIndex: 1,
            entries: [{ id: 1 }, { id: 2 }, { id: 3 }]
          };
        }
        if (method === "Page.captureScreenshot") return { data: "aGVsbG8=" };
        if (method === "DOMSnapshot.captureSnapshot") return { documents: [], strings: [] };
        if (method === "Page.navigate") return { frameId: "frame-1" };
        return {};
      }
    }
  };
}

test("WP08 registry is the exact fixed action registry", () => {
  assert.deepEqual(BROWSER_ACTIONS, [
    "observe", "scroll", "click", "double_click", "focus", "type", "clear",
    "select", "check", "uncheck", "keypress", "navigate", "back", "forward",
    "reload", "wait_for", "capture"
  ]);
  assert.deepEqual(FORBIDDEN_BROWSER_ACTIONS, [
    "eval", "execute_javascript", "run_script", "call_function", "set_cookie", "modify_request"
  ]);
});

test("WP08 parser accepts exactly one structured action and ignores narrative", () => {
  const parsed = parseBrowserActionResponse(responseFor(actionValue()));
  assert.equal(parsed.kind, "ACTION");
  assert.equal(parsed.action.operation, "observe");
  assert.equal(parsed.action.target.surfaceId, surface.surfaceId);
});

test("WP08 parser returns NO_ACTION when marker is absent", () => {
  assert.deepEqual(parseBrowserActionResponse("ordinary response"), { kind: "NO_ACTION", action: null });
});

test("WP08 parser rejects multiple action markers", () => {
  assert.throws(
    () => parseBrowserActionResponse(`${responseFor(actionValue())}\n${BROWSER_ACTION_PROTOCOL}\n{}`),
    /BROWSER_ACTION_COUNT_INVALID:2/
  );
});

test("WP08 rejects unknown top-level and target fields", () => {
  assert.throws(
    () => normalizeBrowserAction(actionValue({ extra: { policyOverride: true } })),
    /BROWSER_ACTION_FIELDS_UNKNOWN:policyOverride/
  );
  const value = actionValue();
  value.target.selector = "body";
  assert.throws(() => normalizeBrowserAction(value), /BROWSER_ACTION_TARGET_FIELDS_UNKNOWN:selector/);
});

test("WP08 rejects forbidden and unknown operations", () => {
  assert.throws(
    () => normalizeBrowserAction(actionValue({ operation: "eval" })),
    /BROWSER_ACTION_OPERATION_FORBIDDEN:eval/
  );
  assert.throws(
    () => normalizeBrowserAction(actionValue({ operation: "teleport" })),
    /BROWSER_ACTION_OPERATION_UNKNOWN:teleport/
  );
});

test("WP08 operation arguments are strictly bounded", () => {
  assert.throws(
    () => normalizeBrowserAction(actionValue({ operation: "scroll", args: { deltaY: 9000 } })),
    /BROWSER_ACTION_SCROLL_INVALID/
  );
  assert.throws(
    () => normalizeBrowserAction(actionValue({ operation: "keypress", args: { key: "F12" } })),
    /BROWSER_ACTION_KEY_FORBIDDEN/
  );
  assert.throws(
    () => normalizeBrowserAction(actionValue({ operation: "wait_for", args: { condition: "script" } })),
    /BROWSER_ACTION_WAIT_CONDITION_INVALID/
  );
});

test("WP08 typing and navigation reject secret-bearing inputs", () => {
  assert.throws(
    () => normalizeBrowserAction(actionValue({
      operation: "type",
      elementRef: "el-x",
      args: { text: "password=supersecret" }
    })),
    /BROWSER_ACTION_SENSITIVE_TEXT_FORBIDDEN/
  );
  assert.throws(
    () => normalizeBrowserAction(actionValue({
      operation: "navigate",
      args: { url: "https://example.com/?token=secret-value" }
    })),
    /BROWSER_ACTION_NAVIGATE_SECRET_FORBIDDEN/
  );
});

test("WP08 observation is digest-verifiable and redacts sensitive field names", async () => {
  const obs = await observation();
  assert.equal(obs.protocol, BROWSER_OBSERVATION_PROTOCOL);
  assert.equal(await verifyBrowserObservation(obs), true);
  assert.equal(obs.page.url, "https://example.com/page");
  const sensitive = obs.elements.find((item) => item.backendNodeId === 13);
  assert.equal(sensitive.name, "[REDACTED_FIELD_NAME]");
  assert.equal(sensitive.sensitive, true);
});

test("WP08 validation binds action to current target and fresh observation", async () => {
  const obs = await observation(1_000_000);
  const button = obs.elements.find((item) => item.backendNodeId === 11);
  const result = await validateBrowserAction(actionValue({
    operation: "click",
    obs,
    elementRef: button.ref
  }), {
    surface,
    observation: obs,
    now: 1_005_000
  });
  assert.equal(result.element.backendNodeId, 11);
});

test("WP08 validation rejects observation digest tampering and expiry", async () => {
  const obs = await observation(1_000_000);
  const button = obs.elements.find((item) => item.backendNodeId === 11);
  const action = actionValue({ operation: "click", obs, elementRef: button.ref });
  const tampered = structuredClone(obs);
  tampered.elements[0].name = "tampered";
  await assert.rejects(
    validateBrowserAction(action, { surface, observation: tampered, now: 1_005_000 }),
    /BROWSER_ACTION_OBSERVATION_DIGEST_INVALID/
  );
  await assert.rejects(
    validateBrowserAction(action, { surface, observation: obs, now: 1_100_000 }),
    /BROWSER_ACTION_OBSERVATION_EXPIRED/
  );
});

test("WP08 validation rejects stale target identity and replay ids", async () => {
  await assert.rejects(
    validateBrowserAction(actionValue(), {
      surface: { ...surface, documentEpoch: "epoch-new" }
    }),
    /BROWSER_ACTION_TARGET_IDENTITY_MISMATCH/
  );
  await assert.rejects(
    validateBrowserAction(actionValue(), {
      surface,
      consumedActionIds: ["action-1"]
    }),
    /BROWSER_ACTION_REPLAY_ACTION_ID/
  );
  await assert.rejects(
    validateBrowserAction(actionValue(), {
      surface,
      consumedTurnIds: ["turn-1"]
    }),
    /BROWSER_ACTION_REPLAY_TURN_ID/
  );
});

test("WP08 validation rejects cross-origin navigation", async () => {
  const obs = await observation();
  await assert.rejects(
    validateBrowserAction(actionValue({
      operation: "navigate",
      obs,
      args: { url: "https://other.example/path" }
    }), { surface, observation: obs }),
    /BROWSER_ACTION_CROSS_ORIGIN_NAVIGATION_FORBIDDEN/
  );
});

test("WP08 validation enforces element capabilities and state", async () => {
  const obs = await observation();
  const search = obs.elements.find((item) => item.backendNodeId === 12);
  const password = obs.elements.find((item) => item.backendNodeId === 13);
  const checkbox = obs.elements.find((item) => item.backendNodeId === 14);
  const combo = obs.elements.find((item) => item.backendNodeId === 15);
  const disabled = obs.elements.find((item) => item.backendNodeId === 16);

  await assert.rejects(
    validateBrowserAction(actionValue({ operation: "type", obs, elementRef: password.ref, args: { text: "safe" } }), { surface, observation: obs }),
    /BROWSER_ACTION_TEXT_TARGET_FORBIDDEN/
  );
  await assert.rejects(
    validateBrowserAction(actionValue({ operation: "click", obs, elementRef: disabled.ref }), { surface, observation: obs }),
    /BROWSER_ACTION_ELEMENT_DISABLED/
  );
  await assert.rejects(
    validateBrowserAction(actionValue({ operation: "select", obs, elementRef: checkbox.ref, args: { index: 1 } }), { surface, observation: obs }),
    /BROWSER_ACTION_SELECT_TARGET_INVALID/
  );
  await assert.rejects(
    validateBrowserAction(actionValue({ operation: "check", obs, elementRef: combo.ref }), { surface, observation: obs }),
    /BROWSER_ACTION_CHECK_TARGET_INVALID/
  );
  const typed = await validateBrowserAction(
    actionValue({ operation: "type", obs, elementRef: search.ref, args: { text: "safe" } }),
    { surface, observation: obs }
  );
  assert.equal(typed.element.editable, true);
});

test("WP08 executor observes and creates a digest-verifiable observation", async () => {
  const chromeApi = fakeChrome();
  const action = normalizeBrowserAction(actionValue());
  const result = await executeBrowserAction(chromeApi, {
    action,
    surface,
    session: surface
  });
  assert.equal(result.ok, true);
  assert.equal(await verifyBrowserObservation(result.output.observation), true);
  assert.deepEqual(chromeApi.methods.map((entry) => entry.method), ["Accessibility.getFullAXTree"]);
  assert.equal(result.receipt.schema, BROWSER_ACTION_RECEIPT_SCHEMA);
});

test("WP08 executor click uses bounded DOM and Input methods only", async () => {
  const obs = await observation();
  const button = obs.elements.find((item) => item.backendNodeId === 11);
  const action = normalizeBrowserAction(actionValue({ operation: "click", obs, elementRef: button.ref }));
  const chromeApi = fakeChrome();
  const result = await executeBrowserAction(chromeApi, {
    action,
    surface,
    session: surface,
    observation: obs
  });
  assert.equal(result.ok, true);
  assert.deepEqual(chromeApi.methods.map((entry) => entry.method), [
    "DOM.getBoxModel", "Input.dispatchMouseEvent", "Input.dispatchMouseEvent"
  ]);
});

test("WP08 executor type and clear never invoke runtime evaluation", async () => {
  const obs = await observation();
  const search = obs.elements.find((item) => item.backendNodeId === 12);
  for (const operation of ["type", "clear"]) {
    const args = operation === "type" ? { text: "query" } : {};
    const action = normalizeBrowserAction(actionValue({ operation, obs, elementRef: search.ref, args }));
    const chromeApi = fakeChrome();
    const result = await executeBrowserAction(chromeApi, {
      action, surface, session: surface, observation: obs
    });
    assert.equal(result.ok, true);
    const methods = chromeApi.methods.map((entry) => entry.method);
    assert.ok(methods.includes("DOM.focus"));
    assert.equal(methods.some((method) => BROWSER_EXECUTOR_FORBIDDEN_METHODS.has(method)), false);
  }
});

test("WP08 executor navigation and history use Page methods with new-epoch receipt", async () => {
  const obs = await observation();
  for (const [operation, args, expectedMethod] of [
    ["navigate", { url: "https://example.com/next" }, "Page.navigate"],
    ["back", {}, "Page.navigateToHistoryEntry"],
    ["forward", {}, "Page.navigateToHistoryEntry"],
    ["reload", {}, "Page.reload"]
  ]) {
    const action = normalizeBrowserAction(actionValue({ operation, obs, args }));
    const chromeApi = fakeChrome();
    const result = await executeBrowserAction(chromeApi, {
      action, surface, session: surface, observation: obs
    });
    assert.equal(result.ok, true);
    assert.ok(chromeApi.methods.some((entry) => entry.method === expectedMethod));
    assert.equal(result.receipt.effectReadback, "NAVIGATION_PENDING_NEW_DOCUMENT_EPOCH");
  }
});

test("WP08 executor wait_for observes only bounded DOM methods", async () => {
  const obs = await observation();
  const button = obs.elements.find((item) => item.backendNodeId === 11);
  const action = normalizeBrowserAction(actionValue({
    operation: "wait_for",
    obs,
    elementRef: button.ref,
    args: { condition: "element_present", timeoutMs: 100 }
  }));
  const chromeApi = fakeChrome();
  const result = await executeBrowserAction(chromeApi, {
    action, surface, session: surface, observation: obs
  });
  assert.equal(result.ok, true);
  assert.deepEqual(chromeApi.methods.map((entry) => entry.method), ["DOM.describeNode"]);
  assert.equal(result.receipt.effectReadback, "WAIT_CONDITION_OBSERVED");
});

test("WP08 executor capture delegates only to bounded WP07 snapshot commands", async () => {
  const obs = await observation();
  const action = normalizeBrowserAction(actionValue({ operation: "capture", obs }));
  const chromeApi = fakeChrome();
  const result = await executeBrowserAction(chromeApi, {
    action,
    surface,
    session: { ...surface, state: "ATTACHED" },
    observation: obs
  });
  assert.equal(result.ok, true);
  assert.deepEqual(chromeApi.methods.map((entry) => entry.method), [
    "Accessibility.getFullAXTree",
    "DOMSnapshot.captureSnapshot",
    "Page.captureScreenshot"
  ]);
});

test("WP08 forbidden CDP methods are an explicit immutable deny set", () => {
  for (const method of [
    "Runtime.evaluate",
    "Runtime.callFunctionOn",
    "Network.getResponseBody",
    "Network.setRequestInterception",
    "Storage.setCookies"
  ]) {
    assert.equal(BROWSER_EXECUTOR_FORBIDDEN_METHODS.has(method), true);
  }
});


test("WP08 adds one closed internal dispatch command with a bounded response payload", () => {
  assert.equal(Object.keys(UI_COMMANDS).length, 54);
  assert.equal(UI_COMMANDS.EXECUTE_BROWSER_RESPONSE_ACTION, "EXECUTE_BROWSER_RESPONSE_ACTION");
  assert.deepEqual(
    UI_COMMAND_SPECS[UI_COMMANDS.EXECUTE_BROWSER_RESPONSE_ACTION].allowedPayloadKeys,
    ["responseText"]
  );
  assert.throws(
    () => createUiCommand({
      command: UI_COMMANDS.EXECUTE_BROWSER_RESPONSE_ACTION,
      windowId: 1,
      payload: { responseText: "", policy: "override" }
    }),
    /UI_COMMAND_PAYLOAD_KEY_NOT_ALLOWED/
  );
  assert.throws(
    () => createUiCommand({
      command: UI_COMMANDS.EXECUTE_BROWSER_RESPONSE_ACTION,
      windowId: 1,
      payload: { responseText: "x".repeat(80_001) }
    }),
    /UI_COMMAND_BROWSER_RESPONSE_INVALID/
  );
});

test("WP08 evidence store has explicit bounded observation and action receipt classes", () => {
  assert.equal(EVIDENCE_TYPES.BROWSER_OBSERVATION, "BROWSER_OBSERVATION");
  assert.equal(EVIDENCE_TYPES.BROWSER_ACTION_RECEIPT, "BROWSER_ACTION_RECEIPT");
  assert.equal(EVIDENCE_LIMITS.MAX_BROWSER_OBSERVATIONS, 12);
  assert.equal(EVIDENCE_LIMITS.MAX_BROWSER_ACTION_RECEIPTS, 100);
});

test("WP08 background has one exactly-once barrier and no eval or request mutation", () => {
  const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(source, /executeBrowserResponseAction\(windowId, responseText, \{/);
  assert.match(source, /status:\s*"PENDING_DISPATCH"/);
  assert.match(source, /consumedActionIds/);
  assert.match(source, /consumedTurnIds/);
  assert.match(source, /EVIDENCE_TYPES\.BROWSER_OBSERVATION/);
  assert.match(source, /EVIDENCE_TYPES\.BROWSER_ACTION_RECEIPT/);
  assert.match(source, /EXECUTE_BROWSER_RESPONSE_ACTION/);
  assert.doesNotMatch(source, /chrome\.scripting\.executeScript\([^)]*responseText/s);
  assert.doesNotMatch(source, /Runtime\.evaluate/);
  assert.doesNotMatch(source, /Network\.setRequestInterception/);
});
