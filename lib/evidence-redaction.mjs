import {
  EVIDENCE_LIMITS,
  EVIDENCE_TYPES,
  redactEvidenceText,
  sanitizeEvidenceHeaders,
  sanitizeEvidenceUrl
} from "./evidence-contract.mjs";

function valueOf(property) {
  return property && typeof property === "object" && "value" in property
    ? property.value
    : property;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function summarizeAccessibilityTree(result = {}) {
  const nodes = Array.isArray(result.nodes) ? result.nodes : [];
  const summary = [];
  for (const node of nodes.slice(0, EVIDENCE_LIMITS.MAX_AX_NODES)) {
    const role = redactEvidenceText(valueOf(node.role), 120);
    const name = redactEvidenceText(valueOf(node.name), 240);
    const passwordLike = /password|textbox|searchbox/i.test(role);
    summary.push({
      nodeId: redactEvidenceText(node.nodeId, 120),
      parentId: redactEvidenceText(node.parentId, 120),
      ignored: Boolean(node.ignored),
      role,
      name: passwordLike ? (name ? "[REDACTED_FIELD_NAME]" : "") : name,
      childCount: Array.isArray(node.childIds) ? node.childIds.length : 0
    });
  }
  return {
    nodeCount: nodes.length,
    returnedNodeCount: summary.length,
    truncated: nodes.length > summary.length,
    nodes: summary
  };
}

export function summarizeDomSnapshot(result = {}) {
  const documents = Array.isArray(result.documents) ? result.documents : [];
  const strings = Array.isArray(result.strings) ? result.strings : [];
  const documentSummaries = documents.slice(0, 32).map((document) => {
    const nodes = document.nodes || {};
    const layout = document.layout || {};
    const documentUrlIndex = Number(document.documentURL);
    const documentUrl = Number.isInteger(documentUrlIndex)
      ? sanitizeEvidenceUrl(strings[documentUrlIndex])
      : "";
    const bounds = Array.isArray(layout.bounds)
      ? layout.bounds.slice(0, EVIDENCE_LIMITS.MAX_LAYOUT_BOUNDS).map((entry) =>
          Array.isArray(entry) ? entry.slice(0, 4).map(number) : [])
      : [];
    return {
      documentUrl,
      nodeCount: Array.isArray(nodes.nodeName) ? nodes.nodeName.length : 0,
      textNodeCount: Array.isArray(nodes.nodeValue)
        ? nodes.nodeValue.filter((index) => Number(index) >= 0).length
        : 0,
      layoutCount: Array.isArray(layout.nodeIndex) ? layout.nodeIndex.length : 0,
      bounds,
      boundsTruncated: Array.isArray(layout.bounds) &&
        layout.bounds.length > EVIDENCE_LIMITS.MAX_LAYOUT_BOUNDS
    };
  });
  return {
    documentCount: documents.length,
    returnedDocumentCount: documentSummaries.length,
    documents: documentSummaries,
    stringsPersisted: false,
    attributesPersisted: false
  };
}

function remoteObjectText(arg) {
  if (!arg || typeof arg !== "object") return "";
  if (typeof arg.value === "string") return arg.value;
  if (typeof arg.description === "string") return arg.description;
  if (typeof arg.unserializableValue === "string") return arg.unserializableValue;
  return "";
}

export function summarizeConsoleEvent(method, params = {}) {
  if (method === "Runtime.consoleAPICalled") {
    return {
      kind: "console",
      level: redactEvidenceText(params.type || "log", 40),
      text: redactEvidenceText((params.args || []).map(remoteObjectText).filter(Boolean).join(" "), 1200),
      timestamp: number(params.timestamp),
      stack: (params.stackTrace?.callFrames || []).slice(0, 5).map((frame) => ({
        functionName: redactEvidenceText(frame.functionName, 160),
        url: sanitizeEvidenceUrl(frame.url),
        lineNumber: number(frame.lineNumber),
        columnNumber: number(frame.columnNumber)
      }))
    };
  }
  if (method === "Runtime.exceptionThrown") {
    const details = params.exceptionDetails || {};
    return {
      kind: "exception",
      level: "error",
      text: redactEvidenceText(
        details.exception?.description || details.text || "Uncaught exception",
        1200
      ),
      url: sanitizeEvidenceUrl(details.url),
      lineNumber: number(details.lineNumber),
      columnNumber: number(details.columnNumber),
      timestamp: number(params.timestamp)
    };
  }
  const entry = params.entry || {};
  return {
    kind: "log",
    level: redactEvidenceText(entry.level || "info", 40),
    source: redactEvidenceText(entry.source || "", 80),
    text: redactEvidenceText(entry.text || "", 1200),
    url: sanitizeEvidenceUrl(entry.url),
    lineNumber: number(entry.lineNumber),
    timestamp: number(entry.timestamp)
  };
}

export function summarizeNetworkEvent(method, params = {}) {
  if (method === "Network.requestWillBeSent") {
    const request = params.request || {};
    return {
      phase: "request",
      requestId: redactEvidenceText(params.requestId, 160),
      loaderId: redactEvidenceText(params.loaderId, 160),
      documentUrl: sanitizeEvidenceUrl(params.documentURL),
      url: sanitizeEvidenceUrl(request.url),
      method: redactEvidenceText(request.method, 20),
      resourceType: redactEvidenceText(params.type, 80),
      initiatorType: redactEvidenceText(params.initiator?.type, 80),
      headers: sanitizeEvidenceHeaders(request.headers),
      timestamp: number(params.timestamp),
      wallTime: number(params.wallTime),
      hasPostData: Boolean(request.hasPostData)
    };
  }
  if (method === "Network.responseReceived") {
    const response = params.response || {};
    return {
      phase: "response",
      requestId: redactEvidenceText(params.requestId, 160),
      loaderId: redactEvidenceText(params.loaderId, 160),
      url: sanitizeEvidenceUrl(response.url),
      status: number(response.status),
      statusText: redactEvidenceText(response.statusText, 160),
      mimeType: redactEvidenceText(response.mimeType, 160),
      protocol: redactEvidenceText(response.protocol, 80),
      resourceType: redactEvidenceText(params.type, 80),
      fromDiskCache: Boolean(response.fromDiskCache),
      fromServiceWorker: Boolean(response.fromServiceWorker),
      headers: sanitizeEvidenceHeaders(response.headers),
      timestamp: number(params.timestamp),
      bodyPersisted: false
    };
  }
  return {
    phase: "failed",
    requestId: redactEvidenceText(params.requestId, 160),
    loaderId: redactEvidenceText(params.loaderId, 160),
    resourceType: redactEvidenceText(params.type, 80),
    errorText: redactEvidenceText(params.errorText, 500),
    canceled: Boolean(params.canceled),
    blockedReason: redactEvidenceText(params.blockedReason, 160),
    timestamp: number(params.timestamp),
    bodyPersisted: false
  };
}

export function summarizeNavigationEvent(method, params = {}) {
  if (method === "Page.frameNavigated") {
    const frame = params.frame || {};
    return {
      phase: "frameNavigated",
      frameId: redactEvidenceText(frame.id, 160),
      parentId: redactEvidenceText(frame.parentId, 160),
      loaderId: redactEvidenceText(frame.loaderId, 160),
      url: sanitizeEvidenceUrl(frame.url),
      mimeType: redactEvidenceText(frame.mimeType, 160),
      secureContextType: redactEvidenceText(frame.secureContextType, 160)
    };
  }
  return {
    phase: "loadEventFired",
    timestamp: number(params.timestamp)
  };
}

export function evidenceEventType(method) {
  if (["Runtime.consoleAPICalled", "Runtime.exceptionThrown", "Log.entryAdded"].includes(method)) {
    return EVIDENCE_TYPES.CONSOLE;
  }
  if (["Network.requestWillBeSent", "Network.responseReceived", "Network.loadingFailed"].includes(method)) {
    return EVIDENCE_TYPES.NETWORK;
  }
  if (["Page.frameNavigated", "Page.loadEventFired"].includes(method)) {
    return EVIDENCE_TYPES.NAVIGATION;
  }
  return null;
}

export function summarizeCdpEvent(method, params = {}) {
  const type = evidenceEventType(method);
  if (type === EVIDENCE_TYPES.CONSOLE) return { type, payload: summarizeConsoleEvent(method, params) };
  if (type === EVIDENCE_TYPES.NETWORK) return { type, payload: summarizeNetworkEvent(method, params) };
  if (type === EVIDENCE_TYPES.NAVIGATION) return { type, payload: summarizeNavigationEvent(method, params) };
  return null;
}
