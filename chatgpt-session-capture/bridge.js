(() => {
  'use strict';

  if (window.__CGSC_BRIDGE_INSTALLED__) return;
  Object.defineProperty(window, '__CGSC_BRIDGE_INSTALLED__', { value: true });

  const PAGE_SOURCE = 'CGSC_PAGE_V1';
  const BRIDGE_SOURCE = 'CGSC_BRIDGE_V1';
  const token = crypto.randomUUID();
  const port = chrome.runtime.connect({ name: 'cgsc-stream' });
  const commandWaiters = new Map();
  let enabled = false;
  let sessionId = null;
  let captureOptions = {};
  let pageHookReady = false;
  let sweepRunning = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

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

  function portPost(message) {
    try {
      port.postMessage(message);
    } catch (error) {
      console.warn('[CGSC] Port send failed', error);
    }
  }

  function transmitRecord(record) {
    if (!enabled || !sessionId || !record) return;
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

    const maxChunk = 320 * 1024;
    if (json.length <= maxChunk) {
      portPost({ type: 'record', sessionId, record: JSON.parse(json) });
      return;
    }

    const transferId = crypto.randomUUID();
    const chunkCount = Math.ceil(json.length / maxChunk);
    portPost({
      type: 'record-begin',
      sessionId,
      transferId,
      charLength: json.length,
      chunkCount
    });
    for (let index = 0; index < chunkCount; index += 1) {
      portPost({
        type: 'record-chunk',
        sessionId,
        transferId,
        index,
        data: json.slice(index * maxChunk, (index + 1) * maxChunk)
      });
    }
    portPost({ type: 'record-end', sessionId, transferId });
  }

  function shouldAcceptPageRecord(record) {
    const kind = String(record?.kind || '');
    if (/runtime/i.test(kind)) return Boolean(captureOptions.captureRuntime);
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
      if (enabled && shouldAcceptPageRecord(event.data.payload)) transmitRecord(event.data.payload);
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

  port.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === 'capture-status') {
      enabled = Boolean(message.enabled);
      sessionId = message.sessionId || null;
      captureOptions = message.options || {};
      sendPageConfig();
    }
  });

  port.onDisconnect.addListener(() => {
    enabled = false;
    sessionId = null;
    captureOptions = {};
    sendPageConfig();
  });

  portPost({ type: 'hello', url: location.href, title: document.title });

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

  function setScrollTop(container, value) {
    if (container === document.documentElement || container === document.body || container === document.scrollingElement) {
      window.scrollTo(0, value);
    } else {
      container.scrollTop = value;
    }
  }

  function getScrollTop(container) {
    if (container === document.documentElement || container === document.body || container === document.scrollingElement) {
      return window.scrollY || document.documentElement.scrollTop || 0;
    }
    return container.scrollTop;
  }

  function getScrollHeight(container) {
    if (container === document.documentElement || container === document.body || container === document.scrollingElement) {
      return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    }
    return container.scrollHeight;
  }

  function getClientHeight(container) {
    if (container === document.documentElement || container === document.body || container === document.scrollingElement) {
      return window.innerHeight;
    }
    return container.clientHeight;
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

    const safePattern = /^(show more|read more|continue|visa mer|läs mer|fortsätt|analyzing|analysis|thought|thinking|worked for|analyserar|analys|tanke|tänker|arbetade)\b/i;
    for (const button of document.querySelectorAll('main button[aria-expanded], article button[aria-expanded]')) {
      const label = CgscCaptureCore.normalizePlainText(button.innerText || button.getAttribute('aria-label') || '');
      if (!safePattern.test(label)) continue;
      result.found += 1;
      if (button.getAttribute('aria-expanded') === 'true') {
        result.alreadyOpen += 1;
        continue;
      }
      result.attempted += 1;
      try {
        button.click();
        await sleep(80);
        if (button.getAttribute('aria-expanded') === 'true') result.opened += 1;
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

  function captureVisibleTurns(scanIndex, sweepRunId) {
    const elements = getConversationElements();
    const summaries = [];
    elements.forEach((element, domIndex) => {
      const record = extractTurn(element, scanIndex, domIndex, sweepRunId);
      transmitRecord(record);
      summaries.push({
        stableKey: record.data.stableKey,
        turnIndex: record.data.turnIndex,
        role: record.data.role,
        reasoningPanels: record.data.reasoning?.length || 0,
        reasoningExpanded: (record.data.reasoning || []).filter((item) => item.expanded).length,
        reasoningMissingContent: (record.data.reasoning || []).filter((item) => !item.contentFound).length
      });
    });
    return { count: elements.length, summaries };
  }

  function emitProgress(stage, data = {}) {
    transmitRecord({
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

  async function prepareTop(container, sweepRunId, options, aggregate) {
    let stableRounds = 0;
    let previousHeight = -1;
    let previousFirstKey = '';
    const maxRounds = options.maxTopLoadRounds || 80;
    let rounds = 0;

    for (let round = 0; round < maxRounds && stableRounds < 4; round += 1) {
      rounds = round + 1;
      setScrollTop(container, 0);
      await sleep(options.settleMs || 1000);
      if (options.expandDetails !== false) mergeExpansionStats(aggregate.expansion, await expandSafeContent());
      const captured = captureVisibleTurns(-maxRounds + round, sweepRunId);
      for (const item of captured.summaries) {
        aggregate.uniqueKeys.add(item.stableKey);
        if (Number.isFinite(item.turnIndex)) aggregate.turnIndices.add(item.turnIndex);
      }
      aggregate.renderedCounts.push(captured.count);
      const firstKey = captured.summaries[0]?.stableKey || '';
      const height = getScrollHeight(container);
      const atTop = getScrollTop(container) <= 2;

      if (height === previousHeight && firstKey === previousFirstKey && atTop) stableRounds += 1;
      else stableRounds = 0;

      previousHeight = height;
      previousFirstKey = firstKey;
      emitProgress('loading-oldest', {
        sweepRunId,
        round: round + 1,
        stableRounds,
        scrollHeight: height,
        firstKey,
        renderedTurns: captured.count,
        atTop
      });
    }

    return {
      topVerified: stableRounds >= 4 && getScrollTop(container) <= 2,
      stableRounds,
      rounds,
      firstKey: previousFirstKey,
      scrollHeight: previousHeight
    };
  }

  async function runSweep(options = {}) {
    if (sweepRunning) throw new Error('A sweep is already running in this tab.');
    if (!enabled || !sessionId) throw new Error('Capture is not active for this tab.');
    sweepRunning = true;
    const sweepRunId = crypto.randomUUID();
    const container = findScrollContainer();
    const originalTop = getScrollTop(container);
    const originalHeight = getScrollHeight(container);
    const originalRatio = originalHeight > getClientHeight(container)
      ? originalTop / Math.max(1, originalHeight - getClientHeight(container))
      : 0;
    const aggregate = {
      uniqueKeys: new Set(),
      turnIndices: new Set(),
      renderedCounts: [],
      reasoningPanels: 0,
      reasoningExpanded: 0,
      reasoningMissingContent: 0,
      expansion: { found: 0, alreadyOpen: 0, attempted: 0, opened: 0, failed: 0, failedLabels: [] }
    };

    function consumeCapture(captured) {
      aggregate.renderedCounts.push(captured.count);
      for (const item of captured.summaries) {
        aggregate.uniqueKeys.add(item.stableKey);
        if (Number.isFinite(item.turnIndex)) aggregate.turnIndices.add(item.turnIndex);
        aggregate.reasoningPanels += item.reasoningPanels;
        aggregate.reasoningExpanded += item.reasoningExpanded;
        aggregate.reasoningMissingContent += item.reasoningMissingContent;
      }
    }

    try {
      emitProgress('sweep-start', {
        sweepRunId,
        containerTag: container.tagName || 'document',
        originalTop,
        originalHeight
      });

      const topResult = await prepareTop(container, sweepRunId, options, aggregate);
      setScrollTop(container, 0);
      await sleep(options.settleMs || 1000);

      let position = 0;
      let scanIndex = 0;
      let previousPosition = -1;
      let stagnantRounds = 0;
      let bottomVerified = false;
      const maxSteps = options.maxSweepSteps || 10000;

      while (scanIndex < maxSteps) {
        setScrollTop(container, position);
        await sleep(options.settleMs || 1000);
        const expansion = options.expandDetails === false ? null : await expandSafeContent();
        mergeExpansionStats(aggregate.expansion, expansion);
        if (expansion?.opened) await sleep(250);
        const captured = captureVisibleTurns(scanIndex, sweepRunId);
        consumeCapture(captured);
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
          stagnantRounds += 1;
          if (stagnantRounds >= 3) {
            bottomVerified = true;
            break;
          }
          await sleep(options.settleMs || 1000);
        } else if (Math.abs(actualTop - previousPosition) < 2) {
          stagnantRounds += 1;
          if (stagnantRounds >= 6) break;
        } else {
          stagnantRounds = 0;
        }

        previousPosition = actualTop;
        position = Math.min(maxTop, actualTop + Math.max(250, Math.floor(clientHeight * 0.72)));
        scanIndex += 1;
      }

      setScrollTop(container, getScrollHeight(container));
      await sleep(options.settleMs || 1000);
      if (options.expandDetails !== false) mergeExpansionStats(aggregate.expansion, await expandSafeContent());
      const finalCapture = captureVisibleTurns(scanIndex + 1, sweepRunId);
      consumeCapture(finalCapture);
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
        scans: scanIndex + 2,
        finalHeight,
        restoredTop: restoreTop,
        topVerified: topResult.topVerified,
        bottomVerified,
        firstStableKey: topResult.firstKey || null,
        uniqueTurnCount: aggregate.uniqueKeys.size,
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
        }
      };

      emitProgress('sweep-complete', summary);
      return summary;
    } finally {
      sweepRunning = false;
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
    const capturedKinds = [];

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

    return { ok: true, skipped: capturedKinds.length === 0, capturedKinds };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;
    if (message.type === 'PING_CONTENT') {
      sendResponse({ ok: true, enabled, sessionId, pageHookReady, sweepRunning, url: location.href });
      return false;
    }
    if (message.type === 'RUN_SWEEP') {
      runSweep({ ...captureOptions, ...(message.options || {}) })
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: String(error), stack: error?.stack || null }));
      return true;
    }
    if (message.type === 'CAPTURE_PAGE_STATE') {
      capturePageState({ ...captureOptions, ...(message.options || {}) })
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: String(error), stack: error?.stack || null }));
      return true;
    }
    return false;
  });
})();
