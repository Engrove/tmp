(() => {
  'use strict';

  // A turn is observed many times during a sweep. A later observation can be
  // poorer than an earlier one (content not yet rendered after a virtualized
  // remount, a reasoning panel that collapsed again), so observations are
  // merged field by field instead of last-write-wins.

  function contentLength(data) {
    return String(data?.finalMarkdown || data?.finalText || '').length;
  }

  function panelScore(panel) {
    return (panel?.contentFound ? 4e12 : 0) + (panel?.expanded ? 2e12 : 0) + String(panel?.markdown || panel?.text || '').length;
  }

  function mergeReasoning(previous, incoming) {
    const before = Array.isArray(previous) ? previous : [];
    const after = Array.isArray(incoming) ? incoming : [];
    const length = Math.max(before.length, after.length);
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const a = before[index];
      const b = after[index];
      const chosen = !a ? b : (!b ? a : (panelScore(b) >= panelScore(a) ? b : a));
      output.push({ ...chosen, index });
    }
    return output;
  }

  function unionBy(previous, incoming, keyOf) {
    const merged = new Map();
    for (const item of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]) {
      const key = keyOf(item);
      if (!merged.has(key)) merged.set(key, item);
    }
    return [...merged.values()];
  }

  const CONTENT_FIELDS = ['finalText', 'finalMarkdown', 'messages', 'links', 'html', 'finalHtml', 'browserVisibleText', 'textContent', 'geometry'];

  function mergeTurnData(previous, incoming, context = {}) {
    const scan = Number.isFinite(incoming?.scanIndex) ? incoming.scanIndex : null;
    if (!previous) {
      return {
        ...incoming,
        firstSeenScanIndex: scan,
        firstSeenAt: context.capturedAt ?? null,
        lastSeenScanIndex: scan,
        observations: 1,
        shorterObservationsIgnored: 0
      };
    }

    const previousFirst = Number.isFinite(previous.firstSeenScanIndex) ? previous.firstSeenScanIndex
      : (Number.isFinite(previous.scanIndex) ? previous.scanIndex : null);
    const firstSeenScanIndex = previousFirst == null ? scan : (scan == null ? previousFirst : Math.min(previousFirst, scan));
    const keepPrevious = contentLength(previous) > contentLength(incoming);
    const merged = { ...incoming };
    if (keepPrevious) {
      for (const field of CONTENT_FIELDS) {
        if (field in previous) merged[field] = previous[field];
        else delete merged[field];
      }
    }
    merged.reasoning = mergeReasoning(previous.reasoning, incoming.reasoning);
    merged.attachments = unionBy(previous.attachments, incoming.attachments,
      (item) => `${item?.kind}\n${item?.url || ''}\n${String(item?.displayName || '').toLocaleLowerCase()}`);
    merged.unclassifiedToggles = [...new Set([...(previous.unclassifiedToggles || []), ...(incoming.unclassifiedToggles || [])])];
    merged.firstSeenScanIndex = firstSeenScanIndex;
    merged.firstSeenAt = previous.firstSeenAt ?? context.previousCapturedAt ?? context.capturedAt ?? null;
    merged.lastSeenScanIndex = scan;
    merged.observations = (Number(previous.observations) || 1) + 1;
    merged.shorterObservationsIgnored = (Number(previous.shorterObservationsIgnored) || 0) + (keepPrevious ? 1 : 0);
    return merged;
  }

  globalThis.CgscTurnMerge = { mergeTurnData, mergeReasoning };
})();
