(() => {
  'use strict';

  if (window.__CGSC_BRIDGE_INSTALLED__) return;
  Object.defineProperty(window, '__CGSC_BRIDGE_INSTALLED__', { value: true });

  const PAGE_SOURCE = 'CGSC_PAGE_V1';
  const BRIDGE_SOURCE = 'CGSC_BRIDGE_V1';
  const MAX_CHUNK = 320 * 1024;
  // Record kinds the MAIN-world hook is allowed to submit. Anything else from
  // the page (for example a forged conversation-turn) is discarded.
  const PAGE_RECORD_KIND = /^(?:page-(?:fetch|xhr|websocket|eventsource)-[a-z-]+|page-navigation|page-runtime-snapshot)$/;
  const token = crypto.randomUUID();
  const commandWaiters = new Map();
  // Capture state is owned by the background service worker. It is delivered
  // over the port, by SYNC_STATE and with every RUN_SWEEP/CAPTURE_PAGE_STATE
  // request, and it survives a port disconnect (service-worker restart).
  let enabled = false;
  let sessionId = null;
  let captureOptions = {};
  let pageHookReady = false;
  let sweepRunning = false;
  let abortReason = null;
  let port = null;
  let portGeneration = 0;
  const transport = { posted: 0, failed: 0, reconnects: 0, lastError: null };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function timestamp() {
    return Date.now();
  }

  function sendPageInit() {
    window.postMessage({ source: BRIDGE_SOURCE, type: 'INIT', token }, '*');
  }

  function sendPageConfig() {
    window.postMessage({
      source: BRIDGE_SOURCE,
      type: 'CONFIG',
      token,
      options: {
        pageNetwork: Boolean(enabled && captureOptions.pageNetwork),
        captureRuntime: Boolean(enabled && captureOptions.captureRuntime)
      }
    }, '*');
  }

  sendPageInit();
  const initTimer = setInterval(() => {
    if (pageHookReady) clearInterval(initTimer);
    else sendPageInit();
  }, 500);

  function applyState(state) {
    enabled = Boolean(state?.enabled);
    sessionId = enabled ? (state.sessionId || null) : null;
    captureOptions = enabled ? (state.options || {}) : {};
    if (!enabled && sweepRunning) abortReason = abortReason || 'capture-stopped';
    sendPageConfig();
  }

  function onPortMessage(message) {
    if (message?.type === 'capture-status') applyState(message);
  }

  function connectPort() {
    try {
      const next = chrome.runtime.connect({ name: 'cgsc-stream' });
      next.onMessage.addListener(onPortMessage);
      next.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (port === next) port = null;
      });
      port = next;
      portGeneration += 1;
      if (portGeneration > 1) transport.reconnects += 1;
      next.postMessage({ type: 'hello', url: location.href, title: document.title });
      return next;
    } catch (error) {
      // "Extension context invalidated" after the extension was reloaded.
      transport.lastError = String(error);
      return null;
    }
  }

  // The port is reopened lazily: a disconnect only means the service worker
  // was stopped, and reconnecting starts it again.
  function postWithReconnect(build) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = port || connectPort();
      if (!current) break;
      try {
        build(current);
        return true;
      } catch (error) {
        transport.lastError = String(error);
        if (port === current) port = null;
      }
    }
    return false;
  }

  function transmitJson(json) {
    if (json.length <= MAX_CHUNK) {
      return postWithReconnect((current) => current.postMessage({ type: 'record-json', sessionId, json }));
    }
    const chunkCount = Math.ceil(json.length / MAX_CHUNK);
    // All parts of one transfer go through the same port; a failure restarts
    // the whole transfer on a new port.
    return postWithReconnect((current) => {
      const transferId = crypto.randomUUID();
      current.postMessage({ type: 'record-begin', sessionId, transferId, charLength: json.length, chunkCount });
      for (let index = 0; index < chunkCount; index += 1) {
        current.postMessage({
          type: 'record-chunk',
          sessionId,
          transferId,
          index,
          data: json.slice(index * MAX_CHUNK, (index + 1) * MAX_CHUNK)
        });
      }
      current.postMessage({ type: 'record-end', sessionId, transferId });
    });
  }

  function transmitRecord(record) {
    if (!enabled || !sessionId || !record) return false;
    const normalized = {
      ...record,
      id: record.id || crypto.randomUUID(),
      capturedAt: record.capturedAt || timestamp(),
      pageUrl: record.pageUrl || location.href
    };
    let json;
    try {
      json = JSON.stringify(normalized);
    } catch (error) {
      json = JSON.stringify({
        id: normalized.id,
        kind: 'bridge-serialization-error',
        capturedAt: timestamp(),
        data: { originalKind: normalized.kind, error: String(error) },
        pageUrl: location.href
      });
    }
    const ok = transmitJson(json);
    if (ok) transport.posted += 1;
    else transport.failed += 1;
    return ok;
  }

  function shouldAcceptPageRecord(record) {
    const kind = String(record?.kind || '');
    if (!PAGE_RECORD_KIND.test(kind)) return false;
    if (kind === 'page-runtime-snapshot') return Boolean(captureOptions.captureRuntime);
    return Boolean(captureOptions.pageNetwork);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== PAGE_SOURCE) return;
    if (event.data.token !== token) return;

    if (event.data.type === 'READY') {
      pageHookReady = true;
      sendPageConfig();
      return;
    }

    if (event.data.type === 'COMMAND_RESULT') {
      const result = event.data.payload;
      const waiter = commandWaiters.get(result?.commandId);
      if (waiter) {
        commandWaiters.delete(result.commandId);
        result.ok ? waiter.resolve(result) : waiter.reject(new Error(result.error || 'Page command failed'));
      }
      return;
    }

    if (event.data.type === 'RECORD') {
      const payload = event.data.payload;
      if (enabled && shouldAcceptPageRecord(payload)) transmitRecord({ ...payload, origin: 'page-main-world' });
      return;
    }

    if (event.data.type === 'HOOK_ERROR') {
      if (!enabled || !(captureOptions.pageNetwork || captureOptions.captureRuntime)) return;
      transmitRecord({
        id: crypto.randomUUID(),
        kind: 'page-hook-error',
        capturedAt: timestamp(),
        data: event.data.payload,
        pageUrl: location.href
      });
    }
  });

  connectPort();

  function pageCommand(type, options = {}) {
    const commandId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        commandWaiters.delete(commandId);
        reject(new Error(`Page command timed out: ${type}`));
      }, 120000);
      commandWaiters.set(commandId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      window.postMessage({ source: BRIDGE_SOURCE, token, type, commandId, options }, '*');
    });
  }

  function attributesToObject(element) {
    const attributes = {};
    for (const attribute of element.attributes || []) attributes[attribute.name] = attribute.value;
    return attributes;
  }

  function serializeShadowRoots() {
    const roots = [];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (node.shadowRoot) {
        roots.push({
          hostTag: node.tagName,
          hostId: node.id || null,
          hostClass: node.className || null,
          hostAttributes: attributesToObject(node),
          mode: node.shadowRoot.mode,
          html: node.shadowRoot.innerHTML,
          text: node.shadowRoot.textContent || ''
        });
      }
      node = walker.nextNode();
    }
    return roots;
  }

  function getConversationElements() {
    const primary = [...document.querySelectorAll('[data-testid^="conversation-turn-"]')];
    if (primary.length) return primary;

    const selectors = ['[data-turn-id][data-turn]', '[data-message-author-role]', 'article'];
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)];
      if (nodes.length) {
        return nodes.filter((node, index, all) => !all.some((other, otherIndex) =>
          otherIndex !== index && other.contains(node) && other.matches(selector)
        ));
      }
    }
    return [];
  }

  function captureIncludesEvidence(options = captureOptions) {
    return Boolean(
      options.deepNetwork ||
      options.pageNetwork ||
      options.includeStorage ||
      options.captureRuntime ||
      options.aggressiveRuntime
    );
  }

  function extractTurn(element, scanIndex, domIndex, sweepRunId) {
    const data = CgscCaptureCore.extractTurn(element, {
      scanIndex,
      domIndex,
      sweepRunId,
      includeEvidence: captureIncludesEvidence()
    });
    return {
      id: `turn-${data.stableKey}`,
      kind: 'conversation-turn',
      capturedAt: timestamp(),
      data,
      pageUrl: location.href
    };
  }

  function findScrollContainer() {
    const turn = getConversationElements()[0];
    if (turn) {
      let current = turn.parentElement;
      while (current && current !== document.body) {
        const style = getComputedStyle(current);
        if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 200) {
          return current;
        }
        current = current.parentElement;
      }
    }

    const candidates = [...document.querySelectorAll('main, section, div')]
      .filter((element) => {
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 200;
      })
      .map((element) => {
        const turnCount = element.querySelectorAll(
          '[data-testid^="conversation-turn-"], [data-message-author-role], article'
        ).length;
        const penalty = element.closest('nav, aside') ? 1000000 : 0;
        return {
          element,
          score: turnCount * 10000000 + (element.scrollHeight - element.clientHeight) - penalty
        };
      })
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.element || document.scrollingElement || document.documentElement;
  }

  function isDocumentScroller(container) {
    return container === document.documentElement || container === document.body || container === document.scrollingElement;
  }

  function setScrollTop(container, value) {
    if (isDocumentScroller(container)) window.scrollTo(0, value);
    else container.scrollTop = value;
  }

  function getScrollTop(container) {
    if (isDocumentScroller(container)) return window.scrollY || document.documentElement.scrollTop || 0;
    return container.scrollTop;
  }

  function getScrollHeight(container) {
    if (isDocumentScroller(container)) return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    return container.scrollHeight;
  }

  function getClientHeight(container) {
    if (isDocumentScroller(container)) return window.innerHeight;
    return container.clientHeight;
  }

  async function waitForExpanded(button, timeoutMs = 480) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (button.getAttribute('aria-expanded') === 'true') return true;
      await sleep(40);
    }
    return button.getAttribute('aria-expanded') === 'true';
  }

  async function expandSafeContent() {
    const result = {
      found: 0,
      alreadyOpen: 0,
      attempted: 0,
      opened: 0,
      failed: 0,
      failedLabels: []
    };

    for (const detail of document.querySelectorAll('main details, article details')) {
      result.found += 1;
      if (detail.open) {
        result.alreadyOpen += 1;
        continue;
      }
      result.attempted += 1;
      try {
        detail.open = true;
        detail.open ? result.opened += 1 : result.failed += 1;
      } catch (error) {
        result.failed += 1;
        result.failedLabels.push(`details: ${String(error)}`);
      }
    }

    for (const button of document.querySelectorAll('main button[aria-expanded], article button[aria-expanded]')) {
      const label = CgscCaptureCore.normalizeInline(button.innerText || button.getAttribute('aria-label') || '');
      if (!CgscCaptureCore.isSafeExpandLabel(label)) continue;
      result.found += 1;
      const state = button.getAttribute('aria-expanded');
      if (state === 'true') {
        result.alreadyOpen += 1;
        continue;
      }
      // Only an explicit "false" is clicked, so a toggle is never closed.
      if (state !== 'false') continue;
      result.attempted += 1;
      try {
        button.click();
        if (await waitForExpanded(button)) result.opened += 1;
        else {
          result.failed += 1;
          result.failedLabels.push(label || '[button without label]');
        }
      } catch (error) {
        result.failed += 1;
        result.failedLabels.push(`${label || '[button without label]'}: ${String(error)}`);
      }
    }
    return result;
  }

  function emitProgress(stage, data = {}) {
    return transmitRecord({
      id: crypto.randomUUID(),
      kind: 'sweep-progress',
      capturedAt: timestamp(),
      data: { stage, ...data, pageUrl: location.href },
      pageUrl: location.href
    });
  }

  function mergeExpansionStats(target, current) {
    if (!current) return;
    for (const key of ['found', 'alreadyOpen', 'attempted', 'opened', 'failed']) target[key] += Number(current[key] || 0);
    target.failedLabels.push(...(current.failedLabels || []));
  }

  function missingIntegers(values) {
    const sorted = [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
    if (!sorted.length) return [];
    const missing = [];
    for (let value = sorted[0]; value <= sorted[sorted.length - 1]; value += 1) {
      if (!sorted.includes(value)) missing.push(value);
    }
    return missing;
  }

  class SweepAbortedError extends Error {
    constructor(reason) {
      super(`Sweep aborted: ${reason}`);
      this.name = 'SweepAbortedError';
      this.reason = reason;
    }
  }

  function createSweepContext(options) {
    const expectedConversationId = options.expectedConversationId || CgscCaptureCore.conversationIdFromUrl(location.href);
    const sweepRunId = crypto.randomUUID();
    const sentHashes = new Map();
    const aggregate = {
      uniqueKeys: new Set(),
      turnIndices: new Set(),
      renderedCounts: [],
      reasoningPanels: 0,
      reasoningExpanded: 0,
      reasoningMissingContent: 0,
      unclassifiedToggleLabels: new Set(),
      turnRecordsSent: 0,
      turnRecordsUnchanged: 0,
      turnRecordsFailed: 0,
      expansion: { found: 0, alreadyOpen: 0, attempted: 0, opened: 0, failed: 0, failedLabels: [] }
    };

    function checkpoint() {
      if (abortReason) throw new SweepAbortedError(abortReason);
      if (!enabled || !sessionId) throw new SweepAbortedError('capture-not-active');
      const current = CgscCaptureCore.conversationIdFromUrl(location.href);
      if (expectedConversationId && current !== expectedConversationId) {
        throw new SweepAbortedError(`conversation changed from ${expectedConversationId} to ${current || 'none'}`);
      }
    }

    // Extracts every rendered turn, transmits only turns whose content changed
    // since the last transmission in this sweep and records what was observed.
    function captureVisibleTurns(scanIndex, { countReasoning = true } = {}) {
      const elements = getConversationElements();
      const summaries = [];
      elements.forEach((element, domIndex) => {
        const record = extractTurn(element, scanIndex, domIndex, sweepRunId);
        const data = record.data;
        if (sentHashes.get(data.stableKey) === data.contentHash) {
          aggregate.turnRecordsUnchanged += 1;
        } else if (transmitRecord(record)) {
          sentHashes.set(data.stableKey, data.contentHash);
          aggregate.turnRecordsSent += 1;
        } else {
          aggregate.turnRecordsFailed += 1;
        }
        aggregate.uniqueKeys.add(data.stableKey);
        if (Number.isFinite(data.turnIndex)) aggregate.turnIndices.add(data.turnIndex);
        for (const label of data.unclassifiedToggles || []) aggregate.unclassifiedToggleLabels.add(label);
        if (countReasoning) {
          aggregate.reasoningPanels += data.reasoning?.length || 0;
          aggregate.reasoningExpanded += (data.reasoning || []).filter((item) => item.expanded).length;
          aggregate.reasoningMissingContent += (data.reasoning || []).filter((item) => !item.contentFound).length;
        }
        summaries.push({ stableKey: data.stableKey, turnIndex: data.turnIndex });
      });
      aggregate.renderedCounts.push(elements.length);
      return { count: elements.length, summaries };
    }

    return { sweepRunId, expectedConversationId, aggregate, checkpoint, captureVisibleTurns };
  }

  async function prepareTop(container, sweep, options) {
    let stableRounds = 0;
    let previousHeight = -1;
    let previousFirstKey = '';
    let firstTurnIndex = null;
    const maxRounds = options.maxTopLoadRounds || 80;
    let rounds = 0;

    for (let round = 0; round < maxRounds && stableRounds < 4; round += 1) {
      sweep.checkpoint();
      rounds = round + 1;
      setScrollTop(container, 0);
      await sleep(options.settleMs || 1000);
      sweep.checkpoint();
      if (options.expandDetails !== false) mergeExpansionStats(sweep.aggregate.expansion, await expandSafeContent());
      const captured = sweep.captureVisibleTurns(-maxRounds + round, { countReasoning: false });
      const firstKey = captured.summaries[0]?.stableKey || '';
      const height = getScrollHeight(container);
      const atTop = getScrollTop(container) <= 2;

      if (height === previousHeight && firstKey === previousFirstKey && atTop) stableRounds += 1;
      else stableRounds = 0;

      previousHeight = height;
      previousFirstKey = firstKey;
      firstTurnIndex = captured.summaries[0]?.turnIndex ?? null;
      emitProgress('loading-oldest', {
        sweepRunId: sweep.sweepRunId,
        round: round + 1,
        stableRounds,
        scrollHeight: height,
        firstKey,
        renderedTurns: captured.count,
        uniqueTurnsSoFar: sweep.aggregate.uniqueKeys.size,
        atTop
      });
    }

    const topVerified = stableRounds >= 4 && getScrollTop(container) <= 2;
    return {
      topVerified,
      stableRounds,
      rounds,
      firstKey: previousFirstKey,
      firstTurnIndex: topVerified ? firstTurnIndex : null,
      scrollHeight: previousHeight
    };
  }

  async function runSweep(options = {}) {
    if (sweepRunning) throw new Error('A sweep is already running in this tab.');
    if (!enabled || !sessionId) throw new Error('Capture is not active for this tab.');
    sweepRunning = true;
    abortReason = null;
    const sweep = createSweepContext(options);
    const { sweepRunId, aggregate } = sweep;
    const transportAtStart = { ...transport };
    const container = findScrollContainer();
    const originalTop = getScrollTop(container);
    const originalHeight = getScrollHeight(container);
    const originalRatio = originalHeight > getClientHeight(container)
      ? originalTop / Math.max(1, originalHeight - getClientHeight(container))
      : 0;

    try {
      sweep.checkpoint();
      emitProgress('sweep-start', {
        sweepRunId,
        containerTag: container.tagName || 'document',
        conversationId: sweep.expectedConversationId,
        originalTop,
        originalHeight
      });

      const topResult = await prepareTop(container, sweep, options);
      setScrollTop(container, 0);
      await sleep(options.settleMs || 1000);

      let position = 0;
      let scanIndex = 0;
      let previousPosition = -1;
      let bottomRounds = 0;
      let stuckRounds = 0;
      let bottomVerified = false;
      const maxSteps = options.maxSweepSteps || 10000;

      while (scanIndex < maxSteps) {
        sweep.checkpoint();
        setScrollTop(container, position);
        await sleep(options.settleMs || 1000);
        sweep.checkpoint();
        const expansion = options.expandDetails === false ? null : await expandSafeContent();
        mergeExpansionStats(aggregate.expansion, expansion);
        if (expansion?.opened) await sleep(250);
        const captured = sweep.captureVisibleTurns(scanIndex);
        const actualTop = getScrollTop(container);
        const scrollHeight = getScrollHeight(container);
        const clientHeight = getClientHeight(container);
        const maxTop = Math.max(0, scrollHeight - clientHeight);

        emitProgress('sweeping', {
          sweepRunId,
          scanIndex,
          requestedTop: position,
          actualTop,
          scrollHeight,
          clientHeight,
          renderedTurns: captured.count,
          uniqueTurnsSoFar: aggregate.uniqueKeys.size,
          expansion
        });

        if (actualTop >= maxTop - 3) {
          stuckRounds = 0;
          bottomRounds += 1;
          if (bottomRounds >= 3) {
            bottomVerified = true;
            break;
          }
          await sleep(options.settleMs || 1000);
        } else if (Math.abs(actualTop - previousPosition) < 2) {
          bottomRounds = 0;
          stuckRounds += 1;
          if (stuckRounds >= 6) break;
        } else {
          bottomRounds = 0;
          stuckRounds = 0;
        }

        previousPosition = actualTop;
        position = Math.min(maxTop, actualTop + Math.max(250, Math.floor(clientHeight * 0.72)));
        scanIndex += 1;
      }

      sweep.checkpoint();
      setScrollTop(container, getScrollHeight(container));
      await sleep(options.settleMs || 1000);
      sweep.checkpoint();
      if (options.expandDetails !== false) mergeExpansionStats(aggregate.expansion, await expandSafeContent());
      sweep.captureVisibleTurns(scanIndex + 1);
      const finalMaxTop = Math.max(0, getScrollHeight(container) - getClientHeight(container));
      bottomVerified = bottomVerified || getScrollTop(container) >= finalMaxTop - 3;

      const finalHeight = getScrollHeight(container);
      const restoreTop = originalRatio * Math.max(0, finalHeight - getClientHeight(container));
      setScrollTop(container, restoreTop);

      const turnIndices = [...aggregate.turnIndices].sort((a, b) => a - b);
      const gaps = missingIntegers(turnIndices);
      const renderedMin = aggregate.renderedCounts.length ? Math.min(...aggregate.renderedCounts) : 0;
      const renderedMax = aggregate.renderedCounts.length ? Math.max(...aggregate.renderedCounts) : 0;
      const summary = {
        sweepRunId,
        bridgeVersion: chrome.runtime.getManifest().version,
        conversationId: sweep.expectedConversationId,
        scans: scanIndex + 2,
        finalHeight,
        restoredTop: restoreTop,
        topVerified: topResult.topVerified,
        bottomVerified,
        firstStableKey: topResult.firstKey || null,
        firstTurnIndexAtVerifiedTop: topResult.firstTurnIndex,
        uniqueTurnCount: aggregate.uniqueKeys.size,
        observedStableKeys: [...aggregate.uniqueKeys],
        turnIndices,
        minimumTurnIndex: turnIndices[0] ?? null,
        maximumTurnIndex: turnIndices.at(-1) ?? null,
        missingTurnIndices: gaps,
        contiguousFromTurnOne: turnIndices[0] === 1 && gaps.length === 0,
        renderedTurnCountMin: renderedMin,
        renderedTurnCountMax: renderedMax,
        virtualizationObserved: renderedMin < aggregate.uniqueKeys.size || renderedMin !== renderedMax,
        expansion: {
          ...aggregate.expansion,
          failedLabels: [...new Set(aggregate.expansion.failedLabels)].slice(0, 100)
        },
        reasoning: {
          panelsSeenAcrossScans: aggregate.reasoningPanels,
          panelsExpandedAcrossScans: aggregate.reasoningExpanded,
          panelsMissingContentAcrossScans: aggregate.reasoningMissingContent
        },
        unclassifiedToggleLabels: [...aggregate.unclassifiedToggleLabels].slice(0, 100),
        transport: {
          turnRecordsSent: aggregate.turnRecordsSent,
          turnRecordsUnchanged: aggregate.turnRecordsUnchanged,
          turnRecordsFailed: aggregate.turnRecordsFailed,
          recordsFailed: transport.failed - transportAtStart.failed,
          portReconnects: transport.reconnects - transportAtStart.reconnects,
          lastError: transport.failed > transportAtStart.failed ? transport.lastError : null
        }
      };

      // The completion record is the export's proof of a finished sweep; if it
      // cannot be delivered the sweep is reported as failed.
      if (!emitProgress('sweep-complete', summary)) {
        throw new Error(`Sweep finished but its completion record could not be delivered: ${transport.lastError || 'unknown transport error'}`);
      }
      return summary;
    } catch (error) {
      if (error instanceof SweepAbortedError) {
        setScrollTop(container, originalRatio * Math.max(0, getScrollHeight(container) - getClientHeight(container)));
        emitProgress('sweep-aborted', { sweepRunId, reason: error.reason, uniqueTurnsSoFar: aggregate.uniqueKeys.size });
      }
      throw error;
    } finally {
      sweepRunning = false;
      abortReason = null;
    }
  }

  function storageToObject(storage) {
    const output = {};
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      output[key] = storage.getItem(key);
    }
    return output;
  }

  async function toJsonSafe(root, limits = {}) {
    const maxDepth = Number.isFinite(limits.maxDepth) ? limits.maxDepth : 30;
    const maxNodes = Number.isFinite(limits.maxNodes) ? limits.maxNodes : 500000;
    const maxString = Number.isFinite(limits.maxString) ? limits.maxString : 20 * 1024 * 1024;
    const seen = new WeakMap();
    let nodes = 0;
    let truncated = false;

    function bytesToBase64(bytes) {
      const chunkSize = 0x8000;
      let binary = '';
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      }
      return btoa(binary);
    }

    async function encode(value, depth, path) {
      nodes += 1;
      if (nodes > maxNodes) {
        truncated = true;
        return { __cgsc_truncated__: 'maxNodes', path };
      }
      if (depth > maxDepth) {
        truncated = true;
        return { __cgsc_truncated__: 'maxDepth', path };
      }
      if (value == null) return value ?? null;
      const type = typeof value;
      if (type === 'string') {
        if (value.length > maxString) {
          truncated = true;
          return `${value.slice(0, maxString)}\n[CGSC truncated ${value.length - maxString} characters]`;
        }
        return value;
      }
      if (type === 'number' || type === 'boolean') return value;
      if (type === 'bigint') return { __type__: 'BigInt', value: value.toString() };
      if (type === 'function' || type === 'symbol') return { __type__: type, value: String(value) };
      if (seen.has(value)) return { __ref__: seen.get(value) };
      seen.set(value, path);

      if (value instanceof Date) return { __type__: 'Date', value: value.toISOString() };
      if (value instanceof Blob) {
        const bytes = new Uint8Array(await value.arrayBuffer());
        return { __type__: value instanceof File ? 'File' : 'Blob', name: value.name || null, type: value.type, size: value.size, base64: bytesToBase64(bytes) };
      }
      if (value instanceof ArrayBuffer) {
        const bytes = new Uint8Array(value);
        return { __type__: 'ArrayBuffer', byteLength: bytes.byteLength, base64: bytesToBase64(bytes) };
      }
      if (ArrayBuffer.isView(value)) {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return { __type__: value.constructor?.name || 'TypedArray', byteLength: bytes.byteLength, base64: bytesToBase64(bytes) };
      }
      if (value instanceof Map) {
        const entries = [];
        let index = 0;
        for (const [key, item] of value.entries()) {
          entries.push([await encode(key, depth + 1, `${path}.mapKey${index}`), await encode(item, depth + 1, `${path}.mapValue${index}`)]);
          index += 1;
        }
        return { __type__: 'Map', entries };
      }
      if (value instanceof Set) {
        const values = [];
        let index = 0;
        for (const item of value.values()) values.push(await encode(item, depth + 1, `${path}.set${index++}`));
        return { __type__: 'Set', values };
      }
      if (Array.isArray(value)) {
        const output = [];
        for (let index = 0; index < value.length; index += 1) output.push(await encode(value[index], depth + 1, `${path}[${index}]`));
        return output;
      }
      const output = { __type__: value.constructor?.name || 'Object' };
      for (const key of Reflect.ownKeys(value)) {
        const stringKey = typeof key === 'symbol' ? `[${String(key)}]` : String(key);
        try {
          output[stringKey] = await encode(value[key], depth + 1, `${path}.${stringKey}`);
        } catch (error) {
          output[stringKey] = { __cgsc_error__: String(error) };
        }
      }
      return output;
    }

    return { value: await encode(root, 0, '$'), metadata: { maxDepth, maxNodes, maxString, visitedNodes: nodes, truncated } };
  }

  async function snapshotIndexedDB() {
    if (!indexedDB.databases) return { supported: false, databases: [] };
    const databaseInfos = await indexedDB.databases();
    const databases = [];

    function requestPromise(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    for (const info of databaseInfos) {
      if (!info.name) continue;
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(info.name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`IndexedDB open blocked: ${info.name}`));
      });
      const dbResult = { name: info.name, version: database.version, stores: [] };
      try {
        for (const storeName of database.objectStoreNames) {
          const tx = database.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const metadata = {
            name: storeName,
            keyPath: store.keyPath,
            autoIncrement: store.autoIncrement,
            indexes: [...store.indexNames].map((indexName) => {
              const index = store.index(indexName);
              return {
                name: index.name,
                keyPath: index.keyPath,
                multiEntry: index.multiEntry,
                unique: index.unique
              };
            })
          };
          const keysRequest = store.getAllKeys();
          const valuesRequest = store.getAll();
          const [keys, values] = await Promise.all([
            requestPromise(keysRequest),
            requestPromise(valuesRequest)
          ]);
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error(`IndexedDB transaction aborted: ${info.name}/${storeName}`));
          });

          const records = [];
          for (let index = 0; index < values.length; index += 1) {
            records.push({
              primaryKey: (await toJsonSafe(keys[index])).value,
              value: (await toJsonSafe(values[index])).value
            });
          }
          dbResult.stores.push({ ...metadata, records });
        }
      } finally {
        database.close();
      }
      databases.push(dbResult);
    }
    return { supported: true, databases };
  }

  async function snapshotCaches() {
    if (!('caches' in window)) return { supported: false, caches: [] };
    const cacheNames = await caches.keys();
    const output = [];
    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      const entries = [];
      for (const request of requests) {
        const response = await cache.match(request);
        if (!response) continue;
        const contentType = response.headers.get('content-type') || '';
        let body;
        try {
          if (/text|json|javascript|xml|event-stream|markdown|csv/i.test(contentType)) {
            body = { encoding: 'utf-8', data: await response.clone().text() };
          } else {
            const bytes = new Uint8Array(await response.clone().arrayBuffer());
            let binary = '';
            const chunkSize = 0x8000;
            for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
            body = { encoding: 'base64', data: btoa(binary) };
          }
        } catch (error) {
          body = { encoding: 'capture-error', data: String(error) };
        }
        entries.push({
          request: {
            url: request.url,
            method: request.method,
            headers: Object.fromEntries(request.headers.entries())
          },
          response: {
            url: response.url,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body
          }
        });
      }
      output.push({ name: cacheName, entries });
    }
    return { supported: true, caches: output };
  }

  async function capturePageState(options = {}) {
    if (!enabled || !sessionId) throw new Error('Capture is not active for this tab.');
    const capturedKinds = [];
    const failedBefore = transport.failed;

    if (options.captureRuntime) {
      const doctype = document.doctype
        ? `<!DOCTYPE ${document.doctype.name}${document.doctype.publicId ? ` PUBLIC \"${document.doctype.publicId}\"` : ''}${document.doctype.systemId ? ` \"${document.doctype.systemId}\"` : ''}>`
        : '';
      const scripts = [...document.scripts].map((script, index) => ({
        index,
        src: script.src || null,
        type: script.type || null,
        noncePresent: Boolean(script.nonce),
        text: script.src ? null : script.textContent || ''
      }));
      const serviceWorkers = 'serviceWorker' in navigator
        ? (await navigator.serviceWorker.getRegistrations()).map((registration) => ({
            scope: registration.scope,
            active: registration.active?.scriptURL || null,
            waiting: registration.waiting?.scriptURL || null,
            installing: registration.installing?.scriptURL || null
          }))
        : [];

      transmitRecord({
        id: `page-state-${timestamp()}`,
        kind: 'page-state-snapshot',
        capturedAt: timestamp(),
        data: {
          url: location.href,
          title: document.title,
          referrer: document.referrer,
          readyState: document.readyState,
          characterSet: document.characterSet,
          contentType: document.contentType,
          language: document.documentElement.lang,
          doctype,
          html: `${doctype}\n${document.documentElement.outerHTML}`,
          text: document.documentElement.innerText || document.documentElement.textContent || '',
          shadowRoots: serializeShadowRoots(),
          scripts,
          meta: [...document.querySelectorAll('meta')].map((element) => attributesToObject(element)),
          links: [...document.querySelectorAll('link')].map((element) => attributesToObject(element)),
          documentCookie: options.includeSensitive ? document.cookie : '[not captured: includeSensitive=false]',
          performanceEntries: performance.getEntries().map((entry) => entry.toJSON ? entry.toJSON() : { ...entry }),
          navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON ? entry.toJSON() : { ...entry }),
          serviceWorkers,
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          languages: navigator.languages,
          viewport: {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
            scrollX: window.scrollX,
            scrollY: window.scrollY
          }
        },
        pageUrl: location.href
      });
      capturedKinds.push('page-state-snapshot');

      await pageCommand('CAPTURE_RUNTIME', {
        limits: options.aggressiveRuntime
          ? { maxDepth: 40, maxNodes: 1000000, maxString: 50 * 1024 * 1024 }
          : { maxDepth: 20, maxNodes: 250000, maxString: 10 * 1024 * 1024 }
      });
      capturedKinds.push('page-runtime-snapshot');
    }

    if (options.includeStorage) {
      try {
        transmitRecord({
          id: `web-storage-${timestamp()}`,
          kind: 'web-storage-snapshot',
          capturedAt: timestamp(),
          data: {
            localStorage: storageToObject(localStorage),
            sessionStorage: storageToObject(sessionStorage),
            documentCookie: options.includeSensitive ? document.cookie : '[not captured: includeSensitive=false]'
          },
          pageUrl: location.href
        });
        capturedKinds.push('web-storage-snapshot');
      } catch (error) {
        transmitRecord({
          id: crypto.randomUUID(),
          kind: 'web-storage-snapshot-error',
          capturedAt: timestamp(),
          data: { error: String(error), stack: error?.stack || null },
          pageUrl: location.href
        });
      }

      try {
        transmitRecord({
          id: `indexeddb-${timestamp()}`,
          kind: 'indexeddb-snapshot',
          capturedAt: timestamp(),
          data: await snapshotIndexedDB(),
          pageUrl: location.href
        });
        capturedKinds.push('indexeddb-snapshot');
      } catch (error) {
        transmitRecord({
          id: crypto.randomUUID(),
          kind: 'indexeddb-snapshot-error',
          capturedAt: timestamp(),
          data: { error: String(error), stack: error?.stack || null },
          pageUrl: location.href
        });
      }
      try {
        transmitRecord({
          id: `cachestorage-${timestamp()}`,
          kind: 'cache-storage-snapshot',
          capturedAt: timestamp(),
          data: await snapshotCaches(),
          pageUrl: location.href
        });
        capturedKinds.push('cache-storage-snapshot');
      } catch (error) {
        transmitRecord({
          id: crypto.randomUUID(),
          kind: 'cache-storage-snapshot-error',
          capturedAt: timestamp(),
          data: { error: String(error), stack: error?.stack || null },
          pageUrl: location.href
        });
      }
    }

    const recordsFailed = transport.failed - failedBefore;
    if (recordsFailed) {
      throw new Error(`${recordsFailed} page-state record(s) could not be delivered to the extension: ${transport.lastError || 'unknown transport error'}`);
    }
    return { ok: true, skipped: capturedKinds.length === 0, capturedKinds };
  }

  function adoptRequestState(message) {
    if (message?.sessionId) {
      applyState({ enabled: true, sessionId: message.sessionId, options: message.options || captureOptions });
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;
    if (message.type === 'PING_CONTENT') {
      sendResponse({
        ok: true,
        enabled,
        sessionId,
        pageHookReady,
        sweepRunning,
        url: location.href,
        conversationId: CgscCaptureCore.conversationIdFromUrl(location.href),
        version: chrome.runtime.getManifest().version,
        transport: { ...transport }
      });
      return false;
    }
    if (message.type === 'SYNC_STATE') {
      applyState(message);
      sendResponse({ ok: true, enabled, sessionId, sweepRunning });
      return false;
    }
    if (message.type === 'ABORT_SWEEP') {
      const wasRunning = sweepRunning;
      if (sweepRunning) abortReason = message.reason || 'aborted';
      sendResponse({ ok: true, wasRunning });
      return false;
    }
    if (message.type === 'RUN_SWEEP') {
      adoptRequestState(message);
      runSweep({ ...captureOptions, ...(message.options || {}), expectedConversationId: message.expectedConversationId || null })
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, aborted: error?.name === 'SweepAbortedError', error: String(error), stack: error?.stack || null }));
      return true;
    }
    if (message.type === 'CAPTURE_PAGE_STATE') {
      adoptRequestState(message);
      capturePageState({ ...captureOptions, ...(message.options || {}) })
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: String(error), stack: error?.stack || null }));
      return true;
    }
    return false;
  });
})();
