import {
  captureEvidenceBundle
} from "./cdp-evidence.mjs";
import {
  createBrowserActionReceipt
} from "./browser-action-contract.mjs";
import {
  createBrowserObservation,
  observationElementByRef
} from "./browser-observation.mjs";

const FORBIDDEN_METHODS = new Set([
  "Runtime.evaluate",
  "Runtime.callFunctionOn",
  "Network.getResponseBody",
  "Network.getRequestPostData",
  "Network.setRequestInterception",
  "Fetch.enable",
  "Storage.setCookies",
  "Network.setCookie",
  "Network.setCookies"
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function send(chromeApi, session, methods, method, params = undefined) {
  if (FORBIDDEN_METHODS.has(method)) throw new Error(`BROWSER_EXECUTOR_METHOD_FORBIDDEN:${method}`);
  if (!chromeApi?.debugger?.sendCommand) throw new Error("BROWSER_EXECUTOR_CDP_UNAVAILABLE");
  const target = { tabId: Number(session.tabId) };
  const result = params === undefined
    ? await chromeApi.debugger.sendCommand(target, method)
    : await chromeApi.debugger.sendCommand(target, method, params);
  methods.push(method);
  return result;
}

function quadCenter(model = {}) {
  const quad = model.content || model.padding || model.border || model.margin;
  if (!Array.isArray(quad) || quad.length < 8) throw new Error("BROWSER_ACTION_ELEMENT_BOX_UNAVAILABLE");
  const xs = [quad[0], quad[2], quad[4], quad[6]].map(Number);
  const ys = [quad[1], quad[3], quad[5], quad[7]].map(Number);
  if (![...xs, ...ys].every(Number.isFinite)) throw new Error("BROWSER_ACTION_ELEMENT_BOX_INVALID");
  return {
    x: xs.reduce((sum, value) => sum + value, 0) / xs.length,
    y: ys.reduce((sum, value) => sum + value, 0) / ys.length
  };
}

async function focusElement(chromeApi, session, methods, backendNodeId) {
  await send(chromeApi, session, methods, "DOM.focus", { backendNodeId });
}

async function clickElement(chromeApi, session, methods, backendNodeId, clickCount = 1) {
  const box = await send(chromeApi, session, methods, "DOM.getBoxModel", { backendNodeId });
  const point = quadCenter(box?.model || {});
  await send(chromeApi, session, methods, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount
  });
  await send(chromeApi, session, methods, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount
  });
}

async function key(chromeApi, session, methods, keyName, {
  shift = false,
  ctrl = false
} = {}) {
  const modifiers = (shift ? 8 : 0) | (ctrl ? 2 : 0);
  await send(chromeApi, session, methods, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: keyName,
    code: keyName,
    modifiers
  });
  await send(chromeApi, session, methods, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: keyName,
    code: keyName,
    modifiers
  });
}

async function historyAction(chromeApi, session, methods, delta) {
  const history = await send(chromeApi, session, methods, "Page.getNavigationHistory");
  const currentIndex = Number(history?.currentIndex);
  const entry = history?.entries?.[currentIndex + delta];
  if (!entry?.id) throw new Error(delta < 0 ? "BROWSER_ACTION_BACK_UNAVAILABLE" : "BROWSER_ACTION_FORWARD_UNAVAILABLE");
  await send(chromeApi, session, methods, "Page.navigateToHistoryEntry", { entryId: entry.id });
}

async function waitFor(chromeApi, session, methods, action, element) {
  const deadline = Date.now() + action.args.timeoutMs;
  if (action.args.condition === "duration") {
    await sleep(action.args.timeoutMs);
    return;
  }
  while (Date.now() <= deadline) {
    try {
      if (action.args.condition === "document_ready") {
        await send(chromeApi, session, methods, "DOM.getDocument", { depth: 0, pierce: false });
        return;
      }
      await send(chromeApi, session, methods, "DOM.describeNode", {
        backendNodeId: element.backendNodeId,
        depth: 0,
        pierce: false
      });
      if (action.args.condition === "element_present") return;
    } catch (error) {
      if (action.args.condition === "element_absent") return;
      if (Date.now() > deadline) throw error;
    }
    await sleep(100);
  }
  throw new Error(`BROWSER_ACTION_WAIT_TIMEOUT:${action.args.condition}`);
}

export async function executeBrowserAction(chromeApi, {
  action,
  surface,
  session,
  observation = null,
  now = Date.now()
} = {}) {
  const methods = [];
  const startedAt = new Date(now).toISOString();
  const element = action.target.elementRef
    ? observationElementByRef(observation, action.target.elementRef)
    : null;
  let output = {};
  let effectReadback = "DISPATCH_RECEIPT_ONLY";
  try {
    switch (action.operation) {
      case "observe": {
        const axResult = await send(chromeApi, session, methods, "Accessibility.getFullAXTree", { depth: -1 });
        output.observation = await createBrowserObservation({
          surface,
          axResult,
          evidenceRefs: []
        });
        effectReadback = "OBSERVATION_DIGEST_VERIFIED";
        break;
      }
      case "capture": {
        output.capture = await captureEvidenceBundle(chromeApi, { session, surface });
        effectReadback = "CAPTURE_BODY_REQUIRES_STORAGE_READBACK";
        break;
      }
      case "scroll":
        await send(chromeApi, session, methods, "Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: 1,
          y: 1,
          deltaX: action.args.deltaX,
          deltaY: action.args.deltaY
        });
        break;
      case "click":
        await clickElement(chromeApi, session, methods, element.backendNodeId, 1);
        break;
      case "double_click":
        await clickElement(chromeApi, session, methods, element.backendNodeId, 2);
        break;
      case "focus":
        await focusElement(chromeApi, session, methods, element.backendNodeId);
        break;
      case "type":
        await focusElement(chromeApi, session, methods, element.backendNodeId);
        await send(chromeApi, session, methods, "Input.insertText", { text: action.args.text });
        break;
      case "clear":
        await focusElement(chromeApi, session, methods, element.backendNodeId);
        await key(chromeApi, session, methods, "a", { ctrl: true });
        await key(chromeApi, session, methods, "Backspace");
        break;
      case "select":
        await focusElement(chromeApi, session, methods, element.backendNodeId);
        await key(chromeApi, session, methods, "Home");
        for (let index = 0; index < action.args.index; index += 1) {
          await key(chromeApi, session, methods, "ArrowDown");
        }
        await key(chromeApi, session, methods, "Enter");
        break;
      case "check":
      case "uncheck": {
        const desired = action.operation === "check";
        const current = element.checked === true || element.checked === "true";
        if (current !== desired) await clickElement(chromeApi, session, methods, element.backendNodeId, 1);
        else effectReadback = "OBSERVATION_ALREADY_MATCHED";
        break;
      }
      case "keypress":
        await key(chromeApi, session, methods, action.args.key, { shift: action.args.shift });
        break;
      case "navigate": {
        const result = await send(chromeApi, session, methods, "Page.navigate", { url: action.args.url });
        if (result?.errorText) throw new Error(`BROWSER_ACTION_NAVIGATE_FAILED:${result.errorText}`);
        effectReadback = "NAVIGATION_PENDING_NEW_DOCUMENT_EPOCH";
        break;
      }
      case "back":
        await historyAction(chromeApi, session, methods, -1);
        effectReadback = "NAVIGATION_PENDING_NEW_DOCUMENT_EPOCH";
        break;
      case "forward":
        await historyAction(chromeApi, session, methods, 1);
        effectReadback = "NAVIGATION_PENDING_NEW_DOCUMENT_EPOCH";
        break;
      case "reload":
        await send(chromeApi, session, methods, "Page.reload", { ignoreCache: false });
        effectReadback = "NAVIGATION_PENDING_NEW_DOCUMENT_EPOCH";
        break;
      case "wait_for":
        await waitFor(chromeApi, session, methods, action, element);
        effectReadback = "WAIT_CONDITION_OBSERVED";
        break;
      default:
        throw new Error(`BROWSER_ACTION_EXECUTOR_UNSUPPORTED:${action.operation}`);
    }
    return {
      ok: true,
      output,
      receipt: createBrowserActionReceipt({
        action,
        status: "DISPATCHED",
        methods,
        startedAt,
        completedAt: new Date().toISOString(),
        targetAfter: {
          tabId: surface.tabId,
          surfaceId: surface.surfaceId,
          documentEpoch: surface.documentEpoch,
          origin: surface.origin
        },
        effectReadback
      })
    };
  } catch (error) {
    return {
      ok: false,
      output,
      receipt: createBrowserActionReceipt({
        action,
        status: "FAILED",
        methods,
        startedAt,
        completedAt: new Date().toISOString(),
        targetAfter: null,
        effectReadback: "FAILED",
        error: error?.message || error
      }),
      error
    };
  }
}

export const BROWSER_EXECUTOR_FORBIDDEN_METHODS = FORBIDDEN_METHODS;
