import {
  EVIDENCE_TYPES
} from "./evidence-contract.mjs";
import {
  summarizeAccessibilityTree,
  summarizeCdpEvent,
  summarizeDomSnapshot
} from "./evidence-redaction.mjs";
import {
  cdpSessionMatchesSurface
} from "./cdp-session.mjs";

export const WP07_CDP_ENABLE_COMMANDS = Object.freeze([
  "Runtime.enable",
  "Log.enable",
  "Network.enable",
  "Page.enable"
]);

export const WP07_CDP_DISABLE_COMMANDS = Object.freeze([
  "Network.disable",
  "Log.disable",
  "Runtime.disable",
  "Page.disable"
]);

export const WP07_CDP_SNAPSHOT_COMMANDS = Object.freeze([
  "Accessibility.getFullAXTree",
  "DOMSnapshot.captureSnapshot",
  "Page.captureScreenshot"
]);

const MAX_RAW_CDP_RESULT_CHARS = 8_000_000;

const FORBIDDEN_COMMANDS = Object.freeze([
  "Runtime.evaluate",
  "Runtime.callFunctionOn",
  "Network.getResponseBody",
  "Network.getRequestPostData",
  "Storage.getCookies",
  "Network.getAllCookies"
]);

function assertRawResultBound(label, value) {
  const chars = JSON.stringify(value || {}).length;
  if (chars > MAX_RAW_CDP_RESULT_CHARS) {
    throw new Error(`EVIDENCE_${label}_TOO_LARGE:${chars}`);
  }
}

function assertSession(session, surface) {
  if (session?.state !== "ATTACHED") throw new Error("EVIDENCE_CDP_SESSION_NOT_ATTACHED");
  if (!cdpSessionMatchesSurface(session, surface)) {
    throw new Error("EVIDENCE_TARGET_IDENTITY_MISMATCH");
  }
}

async function send(chromeApi, session, method, params = undefined) {
  if (FORBIDDEN_COMMANDS.includes(method)) throw new Error(`EVIDENCE_CDP_COMMAND_FORBIDDEN:${method}`);
  if (!chromeApi?.debugger?.sendCommand) throw new Error("EVIDENCE_CDP_SEND_UNAVAILABLE");
  const target = { tabId: Number(session.tabId) };
  return params === undefined
    ? chromeApi.debugger.sendCommand(target, method)
    : chromeApi.debugger.sendCommand(target, method, params);
}

export async function enableEvidenceDomains(chromeApi, {
  session,
  surface
} = {}) {
  assertSession(session, surface);
  const receipts = [];
  for (const method of WP07_CDP_ENABLE_COMMANDS) {
    const params = method === "Network.enable"
      ? {
          maxTotalBufferSize: 2_000_000,
          maxResourceBufferSize: 250_000,
          maxPostDataSize: 0
        }
      : undefined;
    await send(chromeApi, session, method, params);
    receipts.push({ method, ok: true });
  }
  return receipts;
}

export async function disableEvidenceDomains(chromeApi, {
  session,
  surface,
  tolerateMissing = true
} = {}) {
  if (!session || session.state !== "ATTACHED") return [];
  if (!cdpSessionMatchesSurface(session, surface)) {
    if (tolerateMissing) return [];
    throw new Error("EVIDENCE_TARGET_IDENTITY_MISMATCH");
  }
  const receipts = [];
  for (const method of WP07_CDP_DISABLE_COMMANDS) {
    try {
      await send(chromeApi, session, method);
      receipts.push({ method, ok: true });
    } catch (error) {
      if (!tolerateMissing) throw error;
      receipts.push({ method, ok: false, error: String(error?.message || error) });
    }
  }
  return receipts;
}

export async function captureEvidenceBundle(chromeApi, {
  session,
  surface
} = {}) {
  assertSession(session, surface);
  const axResult = await send(chromeApi, session, "Accessibility.getFullAXTree", {
    depth: -1
  });
  assertRawResultBound("AX_TREE", axResult);
  const domResult = await send(chromeApi, session, "DOMSnapshot.captureSnapshot", {
    computedStyles: [],
    includePaintOrder: true,
    includeDOMRects: true,
    includeBlendedBackgroundColors: false,
    includeTextColorOpacities: false
  });
  assertRawResultBound("DOM_SNAPSHOT", domResult);
  const screenshotResult = await send(chromeApi, session, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    optimizeForSpeed: true
  });
  if (!screenshotResult?.data) throw new Error("EVIDENCE_SCREENSHOT_BODY_MISSING");
  return {
    ax: {
      type: EVIDENCE_TYPES.AX_TREE,
      payload: summarizeAccessibilityTree(axResult)
    },
    dom: {
      type: EVIDENCE_TYPES.DOM_SNAPSHOT,
      payload: summarizeDomSnapshot(domResult)
    },
    screenshot: {
      type: EVIDENCE_TYPES.SCREENSHOT,
      payload: {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
        rawBodyDurable: false,
        pixelRedactionApplied: false,
        promptDeliveryAllowed: false
      },
      base64: screenshotResult.data
    },
    receipts: WP07_CDP_SNAPSHOT_COMMANDS.map((method) => ({ method, ok: true }))
  };
}

export function normalizeCdpEvidenceEvent(method, params = {}) {
  return summarizeCdpEvent(method, params);
}

export function isWp07EvidenceMethod(method) {
  return Boolean(normalizeCdpEvidenceEvent(method, {}));
}

export const WP07_FORBIDDEN_CDP_COMMANDS = FORBIDDEN_COMMANDS;
