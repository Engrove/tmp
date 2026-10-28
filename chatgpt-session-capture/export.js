(() => {
  'use strict';

  const activeUrls = new Set();
  const URL_LIFETIME_MS = 10 * 60 * 1000;
  // Error kinds produced by the capture pipeline itself. They can mean that a
  // turn record was lost and therefore block a VERIFIED verdict. Other error
  // records (failed page requests, debugger commands, page hooks) describe the
  // observed page or optional evidence and are reported separately.
  const PIPELINE_ERROR_KIND = /^(?:bridge-|background-)|chunk-error|serialization-error|transport-error/;
  const conversationIdFromUrl = (url) => globalThis.CgscCaptureCore?.conversationIdFromUrl(url) ?? null;

  function iso(value) {
    return value ? new Date(value).toISOString() : null;
  }

  function pretty(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }

  function turnSortKey(record) {
    const data = record.data || {};
    return {
      numeric: Number.isFinite(data.turnIndex)
        ? data.turnIndex
        : Number((String(data.dataTestId || '').match(/conversation-turn-(\d+)/i) || [])[1]),
      scan: Number.isFinite(data.firstSeenScanIndex)
        ? data.firstSeenScanIndex
        : (Number.isFinite(data.scanIndex) ? data.scanIndex : Number.MAX_SAFE_INTEGER),
      dom: Number.isFinite(data.domIndex) ? data.domIndex : Number.MAX_SAFE_INTEGER,
      time: record.capturedAt || 0
    };
  }

  // Turns with a numeric index are ordered by it; turns without one keep the
  // order in which the sweep first saw them and follow the numbered turns.
  function compareTurns(a, b) {
    const ka = turnSortKey(a);
    const kb = turnSortKey(b);
    const na = Number.isFinite(ka.numeric);
    const nb = Number.isFinite(kb.numeric);
    if (na && nb && ka.numeric !== kb.numeric) return ka.numeric - kb.numeric;
    if (na !== nb) return na ? -1 : 1;
    if (ka.scan !== kb.scan) return ka.scan - kb.scan;
    if (ka.dom !== kb.dom) return ka.dom - kb.dom;
    return ka.time - kb.time;
  }

  function roleLabel(role) {
    const labels = {
      user: 'User',
      assistant: 'Assistant',
      system: 'System',
      tool: 'Tool',
      developer: 'Developer'
    };
    return labels[role] || role || 'Unknown';
  }

  function normalizeReasoning(data) {
    if (Array.isArray(data.reasoning)) return data.reasoning;
    if (Array.isArray(data.details)) {
      return data.details.map((detail, index) => ({
        index,
        type: 'legacy-details',
        title: detail.summary || 'Details',
        durationLabel: null,
        expanded: Boolean(detail.open),
        contentFound: Boolean(detail.text),
        text: detail.text || '',
        markdown: detail.text || '',
        steps: [],
        extractionMethod: 'legacy-details'
      }));
    }
    return [];
  }

  function normalizeTurn(record, index) {
    const data = record.data || {};
    const turnIndex = Number.isFinite(data.turnIndex)
      ? data.turnIndex
      : Number((String(data.dataTestId || '').match(/conversation-turn-(\d+)/i) || [])[1]) || null;
    const finalText = data.finalText || data.text || data.textContent || '';
    const finalMarkdown = data.finalMarkdown || finalText;
    const pageUrl = data.pageUrl || record.pageUrl || null;
    return {
      sequence: index + 1,
      turnIndex,
      role: data.role || 'unknown',
      messageId: data.messageId || null,
      turnId: data.turnId || null,
      dataTestId: data.dataTestId || null,
      stableKey: data.stableKey || null,
      modelSlug: data.modelSlug || null,
      conversationId: conversationIdFromUrl(pageUrl),
      capturedAt: iso(record.capturedAt),
      firstSeenAt: iso(data.firstSeenAt),
      firstSeenScanIndex: Number.isFinite(data.firstSeenScanIndex) ? data.firstSeenScanIndex : null,
      observations: Number(data.observations) || 1,
      finalAnswer: {
        text: finalText,
        markdown: finalMarkdown
      },
      messageParts: Array.isArray(data.messages) ? data.messages.map((message) => ({
        messageId: message.messageId || null,
        role: message.role || null,
        markdown: message.markdown || '',
        text: message.text || ''
      })) : [],
      browserVisibleReasoning: normalizeReasoning(data).map((item) => ({
        index: item.index ?? 0,
        type: item.type || 'unknown',
        title: item.title || '',
        durationLabel: item.durationLabel || null,
        expanded: Boolean(item.expanded),
        contentFound: item.contentFound !== false,
        text: item.text || '',
        markdown: item.markdown || item.text || '',
        steps: Array.isArray(item.steps) ? item.steps : [],
        extractionMethod: item.extractionMethod || null
      })),
      unclassifiedToggles: Array.isArray(data.unclassifiedToggles) ? data.unclassifiedToggles : [],
      links: Array.isArray(data.links) ? data.links : [],
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
      evidenceIncluded: Boolean(data.evidenceIncluded)
    };
  }

  function buildStructuredSession(session, turns) {
    return {
      schema: 'cgsc.browser-transcript/1.2',
      generatedAt: iso(Date.now()),
      capture: {
        id: session.id,
        profile: session.captureProfile || session.options?.captureProfile || 'unknown',
        extensionVersion: session.extensionVersion || null,
        title: session.title || 'ChatGPT session',
        conversationId: session.conversationId || conversationIdFromUrl(session.startUrl),
        startedAt: iso(session.startedAt),
        stoppedAt: iso(session.stoppedAt),
        status: session.status || null,
        startUrl: session.startUrl || null,
        currentUrl: session.currentUrl || null,
        options: session.options || {}
      },
      scope: {
        containsBrowserRenderedConversationText: true,
        containsBrowserVisibleReasoningSummaries: true,
        containsHiddenModelChainOfThought: false,
        attachmentBodiesIncludedOnlyWhenExplicitlyMarked: true,
        messageTextIsVerbatimExceptLineEndings: true
      },
      messages: turns.map(normalizeTurn)
    };
  }

  function buildMarkdown(session, turns, completeness = null) {
    const normalized = turns.map(normalizeTurn);
    const lines = [
      `# ${session.title || 'ChatGPT session'}`,
      '',
      `- Capture ID: \`${session.id}\``,
      `- Capture profile: \`${session.captureProfile || session.options?.captureProfile || 'unknown'}\``,
      `- Conversation ID: \`${session.conversationId || conversationIdFromUrl(session.startUrl) || 'unknown'}\``,
      `- Started: ${iso(session.startedAt)}`,
      `- Stopped: ${session.stoppedAt ? iso(session.stoppedAt) : 'capture was still active at export'}`,
      `- Captured turns: ${normalized.length}`,
      ...(completeness ? [`- Completeness verdict: \`${completeness.status}\` (see diagnostics/completeness.json)`] : []),
      '',
      '> Scope: browser-rendered conversation text and browser-visible expandable reasoning summaries. This file does not claim hidden model chain-of-thought or server-only data.',
      '> Turn boundaries are marked with `<!-- cgsc:turn ... -->` comments; conversation/session.json is authoritative if message text itself contains Markdown headings.',
      ''
    ];

    for (const turn of normalized) {
      lines.push(`<!-- cgsc:turn sequence=${turn.sequence} index=${turn.turnIndex ?? 'none'} role=${turn.role} -->`);
      lines.push(`## ${turn.sequence}. ${roleLabel(turn.role)}`);
      lines.push('');
      const metadata = [];
      if (turn.turnIndex != null) metadata.push(`Turn: \`${turn.turnIndex}\``);
      if (turn.messageId) metadata.push(`Message ID: \`${turn.messageId}\``);
      if (turn.modelSlug) metadata.push(`Model: \`${turn.modelSlug}\``);
      if (metadata.length) lines.push(`${metadata.join(' · ')}`, '');

      if (turn.browserVisibleReasoning.length) {
        lines.push('### Browser-visible reasoning summary', '');
        for (const panel of turn.browserVisibleReasoning) {
          lines.push(`#### ${panel.title || `Reasoning panel ${panel.index + 1}`}`, '');
          if (panel.durationLabel) lines.push(`- Duration label: ${panel.durationLabel}`);
          lines.push(`- Expanded during capture: ${panel.expanded ? 'yes' : 'no'}`);
          lines.push(`- Content found: ${panel.contentFound ? 'yes' : 'no'}`);
          const body = panel.markdown || panel.text;
          // Step labels are listed separately only when the body does not already contain them.
          const extraSteps = panel.steps.filter((step) => !body.includes(step));
          if (body) lines.push('', body);
          if (extraSteps.length) {
            lines.push('', '**Visible steps**', '');
            for (const step of extraSteps) lines.push(`- ${step}`);
          }
          lines.push('');
        }
      }

      lines.push(turn.role === 'assistant' ? '### Final answer' : '### Message', '');
      if (turn.messageParts.length > 1) {
        turn.messageParts.forEach((part, index) => {
          lines.push(`#### Part ${index + 1}${part.messageId ? ` (message \`${part.messageId}\`)` : ''}`, '');
          lines.push(part.markdown || part.text || '_No text captured_', '');
        });
      } else {
        lines.push(turn.finalAnswer.markdown || turn.finalAnswer.text || '_No text captured_', '');
      }

      if (turn.attachments.length) {
        lines.push('### Attachment references', '');
        for (const attachment of turn.attachments) {
          lines.push(`- ${attachment.kind === 'image' ? 'Image' : 'File'}: ${attachment.displayName || 'unnamed attachment'} — file content captured: ${attachment.fileContentCaptured ? 'yes' : 'no'}`);
        }
        lines.push('');
      }
      lines.push(`<!-- cgsc:end-turn sequence=${turn.sequence} -->`, '');
    }
    // Message text is emitted verbatim, so blank lines are not collapsed here.
    return `${lines.join('\n').trimEnd()}\n`;
  }

  function collectAttachments(turns) {
    const items = [];
    turns.map(normalizeTurn).forEach((turn) => {
      for (const attachment of turn.attachments) {
        items.push({
          turnSequence: turn.sequence,
          turnIndex: turn.turnIndex,
          role: turn.role,
          messageId: turn.messageId,
          ...attachment
        });
      }
    });
    return {
      schema: 'cgsc.attachment-manifest/1.2',
      generatedAt: iso(Date.now()),
      count: items.length,
      imageCount: items.filter((item) => item.kind === 'image').length,
      contentCapturedCount: items.filter((item) => item.fileContentCaptured).length,
      referencesOnlyCount: items.filter((item) => !item.fileContentCaptured).length,
      items
    };
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

  function sweepEvents(records) {
    return records
      .filter((record) => record.kind === 'sweep-progress' && ['sweep-start', 'sweep-complete', 'sweep-aborted'].includes(record.data?.stage))
      .sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0));
  }

  function latestSweepSummary(session, records) {
    const completions = sweepEvents(records).filter((record) => record.data.stage === 'sweep-complete');
    const latest = completions.at(-1);
    if (latest) return { summary: latest.data, source: 'sweep-complete-record', capturedAt: latest.capturedAt };
    if (session.fullCaptureResult?.sweep) return { summary: session.fullCaptureResult.sweep, source: 'session-fallback', capturedAt: session.lastFullCaptureAt || null };
    return { summary: null, source: null, capturedAt: null };
  }

  function buildCompleteness(session, records, turns, attachments) {
    const kinds = {};
    for (const record of records) kinds[record.kind] = (kinds[record.kind] || 0) + 1;
    const normalized = turns.map(normalizeTurn);
    const turnIndices = normalized.map((turn) => turn.turnIndex).filter(Number.isFinite).sort((a, b) => a - b);
    const gaps = missingIntegers(turnIndices);
    const { summary: sweep, source: sweepSource, capturedAt: sweepCapturedAt } = latestSweepSummary(session, records);
    const events = sweepEvents(records);
    const abortedAfterCompletion = events.filter((record) => record.data.stage === 'sweep-aborted' && (record.capturedAt || 0) > (sweepCapturedAt || 0)).length;
    const reasoningPanels = normalized.flatMap((turn) => turn.browserVisibleReasoning);
    const errors = records.filter((record) => /error|failed/i.test(record.kind));
    const pipelineErrors = errors.filter((record) => PIPELINE_ERROR_KIND.test(record.kind));
    const evidenceErrors = errors.filter((record) => !PIPELINE_ERROR_KIND.test(record.kind));
    const responseBodies = records.filter((record) => record.kind === 'cdp-network-response-body');
    const bodyErrors = responseBodies.filter((record) => record.data?.body?.captureError);
    const expansionFailures = Number(sweep?.expansion?.failed || 0);
    const reasoningContentFailures = reasoningPanels.filter((panel) => !panel.contentFound).length;

    // Cross-check: every turn the content script observed in the sweep must
    // exist in storage. A record lost in transit (service-worker restart,
    // stopped capture, dropped port) is detected here.
    const storedKeys = new Set(normalized.map((turn) => turn.stableKey).filter(Boolean));
    const observedKeys = Array.isArray(sweep?.observedStableKeys) ? sweep.observedStableKeys : null;
    const missingFromStore = observedKeys ? observedKeys.filter((key) => !storedKeys.has(key)) : null;
    const observedKeySet = new Set(observedKeys || []);
    const storedNotObserved = observedKeys ? [...storedKeys].filter((key) => !observedKeySet.has(key)) : null;
    const observedIndices = Array.isArray(sweep?.turnIndices) ? sweep.turnIndices : [];
    const storedIndexSet = new Set(turnIndices);
    const observedIndicesMissingFromStore = observedIndices.filter((value) => !storedIndexSet.has(value));

    const captureConversationId = session.conversationId || conversationIdFromUrl(session.startUrl);
    const turnConversationIds = [...new Set(normalized.map((turn) => turn.conversationId).filter(Boolean))];
    const foreignConversationTurns = captureConversationId
      ? normalized.filter((turn) => turn.conversationId && turn.conversationId !== captureConversationId).length
      : 0;

    const topVerified = Boolean(sweep?.topVerified);
    const bottomVerified = Boolean(sweep?.bottomVerified);
    const firstAtTop = Number.isFinite(sweep?.firstTurnIndexAtVerifiedTop) ? sweep.firstTurnIndexAtVerifiedTop : null;
    const contiguousFromTurnOne = turnIndices.length > 0 && turnIndices[0] === 1 && gaps.length === 0;
    // The first turn is proven by the verified top of the scroll container, not
    // by assuming ChatGPT numbers turns from 1.
    const firstTurnProven = firstAtTop != null ? (turnIndices[0] === firstAtTop) : contiguousFromTurnOne;
    const transport = sweep?.transport || null;

    const checks = {
      completedSweepRecorded: Boolean(sweep),
      sweepCompletionRecordStored: sweepSource === 'sweep-complete-record',
      topVerified,
      bottomVerified,
      firstTurnAtVerifiedTop: firstTurnProven,
      everyTurnHasNumericIndex: normalized.length > 0 && turnIndices.length === normalized.length,
      contiguousTurnIndices: turnIndices.length > 0 && gaps.length === 0,
      sweepObservationsAvailable: observedKeys !== null,
      everyObservedTurnStored: observedKeys !== null && missingFromStore.length === 0 && observedIndicesMissingFromStore.length === 0,
      lastTurnMatchesSweep: !Number.isFinite(sweep?.maximumTurnIndex) || turnIndices.at(-1) === sweep.maximumTurnIndex,
      noTurnFromAnotherConversation: foreignConversationTurns === 0,
      noTransportFailure: !transport || (Number(transport.turnRecordsFailed || 0) === 0 && Number(transport.recordsFailed || 0) === 0),
      noExpansionFailure: expansionFailures === 0,
      everyReasoningPanelHasContent: reasoningContentFailures === 0,
      noPipelineErrorRecord: pipelineErrors.length === 0
    };
    const failedChecks = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);

    let status;
    if (!sweep) status = 'NO_COMPLETED_SWEEP_RECORDED';
    else if (!failedChecks.length) status = 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT';
    else status = 'CAPTURED_WITH_UNVERIFIED_BOUNDARIES_OR_GAPS';

    return {
      schema: 'cgsc.completeness/1.2',
      generatedAt: iso(Date.now()),
      sessionId: session.id,
      status,
      failedChecks,
      checks,
      captureProfile: session.captureProfile || session.options?.captureProfile || 'unknown',
      captureOptions: session.options || {},
      captureStatus: session.status || null,
      conversation: {
        captureConversationId,
        turnConversationIds,
        foreignConversationTurns
      },
      counts: {
        storedRecords: records.length,
        uniqueTurns: turns.length,
        numericTurnIds: turnIndices.length,
        observedTurnsInSweep: observedKeys ? observedKeys.length : null,
        observedTurnsMissingFromStore: missingFromStore ? missingFromStore.length : null,
        storedTurnsNotObservedInSweep: storedNotObserved ? storedNotObserved.length : null,
        browserVisibleReasoningPanels: reasoningPanels.length,
        reasoningPanelsNotExpanded: reasoningPanels.filter((panel) => !panel.expanded).length,
        reasoningPanelsMissingContent: reasoningContentFailures,
        attachmentReferences: attachments.count,
        imageReferences: attachments.imageCount,
        attachmentBodiesCaptured: attachments.contentCapturedCount,
        responseBodies: responseBodies.length,
        responseBodyErrors: bodyErrors.length,
        errorRecords: errors.length,
        pipelineErrorRecords: pipelineErrors.length,
        evidenceErrorRecords: evidenceErrors.length
      },
      turnSequence: {
        minimumTurnIndex: turnIndices[0] ?? null,
        maximumTurnIndex: turnIndices.at(-1) ?? null,
        firstTurnIndexAtVerifiedTop: firstAtTop,
        missingTurnIndices: gaps,
        contiguousFromTurnOne,
        observedIndicesMissingFromStore,
        observedStableKeysMissingFromStore: missingFromStore ? missingFromStore.slice(0, 200) : null
      },
      sweep: sweep ? { ...sweep, observedStableKeys: undefined, observedStableKeyCount: observedKeys ? observedKeys.length : null } : null,
      sweepSource,
      abortedSweepsAfterLatestCompletion: abortedAfterCompletion,
      boundaries: { topVerified, bottomVerified },
      virtualizationObserved: Boolean(sweep?.virtualizationObserved),
      unclassifiedToggleLabels: [...new Set([
        ...(sweep?.unclassifiedToggleLabels || []),
        ...normalized.flatMap((turn) => turn.unclassifiedToggles)
      ])].slice(0, 100),
      kinds,
      limitations: [
        'Completeness applies only to text and UI data that became observable in the browser during this capture and sweep.',
        'Browser-visible reasoning summaries are separated from final answers. Hidden model chain-of-thought is not browser-exposed and is not present.',
        'An attachment reference does not mean the attachment body was captured. Consult attachments/manifest.json.',
        'A VERIFIED_COMPLETE_BROWSER_TRANSCRIPT verdict requires every entry in "checks" to be true: a stored sweep-completion record, a stabilized top whose first turn is the lowest stored turn index, a verified bottom, contiguous numeric turn indices, every turn observed by the sweep present in storage, no turn from another conversation, no transport or pipeline error, no expansion failure and content for every reasoning panel.',
        'unclassifiedToggleLabels lists expandable controls inside assistant turns that were not recognised as reasoning panels and were not opened. They do not affect the verdict; inspect them if the conversation used a UI feature whose label is listed.',
        'Site DOM changes can invalidate selectors; such a capture must not be treated as complete without the listed boundary and sequence checks.'
      ],
      responseBodyErrors: bodyErrors.map((record) => ({
        requestId: record.data?.requestId,
        error: record.data?.body?.captureError,
        requestMeta: record.data?.requestMeta || null
      })),
      pipelineErrorRecords: pipelineErrors.map((record) => ({ kind: record.kind, capturedAt: iso(record.capturedAt), data: record.data })),
      evidenceErrorRecords: evidenceErrors.slice(0, 500).map((record) => ({ kind: record.kind, capturedAt: iso(record.capturedAt), data: record.data }))
    };
  }

  function buildAiInstructions(session, completeness) {
    const failed = completeness.failedChecks?.length ? completeness.failedChecks.map((item) => `\`${item}\``).join(', ') : 'none';
    return `# AI-to-AI review instructions\n\n` +
      `This ZIP is a ChatGPT browser-session capture produced locally by ChatGPT Session Capture ${session.extensionVersion || 'unknown'}.\n\n` +
      `## Read order\n\n` +
      `1. \`conversation/session.md\` — primary human- and AI-readable transcript.\n` +
      `2. \`diagnostics/completeness.json\` — capture boundaries, sequence gaps, cross-checks and verdict.\n` +
      `3. \`conversation/session.json\` — structured message objects; authoritative for turn boundaries.\n` +
      `4. \`attachments/manifest.json\` — attachment and image references and whether file bodies were actually captured.\n` +
      `5. \`manifest/sha256sums.txt\` — SHA-256 of every other file in this archive (\`sha256sum -c\` after extraction).\n\n` +
      `## Interpretation contract\n\n` +
      `- Treat "Browser-visible reasoning summary" as UI text exposed by the browser, not as hidden model chain-of-thought.\n` +
      `- Treat "Final answer" as the assistant response presented to the user.\n` +
      `- Message text and code blocks are verbatim (indentation and blank lines preserved); only line endings are normalized.\n` +
      `- Turn boundaries in session.md are the \`<!-- cgsc:turn ... -->\` comments. Headings inside message text are message content.\n` +
      `- Do not infer attachment contents when \`fileContentCaptured\` is false.\n` +
      `- Do not claim the transcript is complete unless the verdict is \`VERIFIED_COMPLETE_BROWSER_TRANSCRIPT\`; the \`checks\` object lists each condition.\n` +
      `- Capture profile: \`${session.captureProfile || session.options?.captureProfile || 'unknown'}\`.\n` +
      `- Completeness verdict: \`${completeness.status}\`.\n` +
      `- Failed checks: ${failed}.\n` +
      `- Unique turns: ${completeness.counts.uniqueTurns}.\n` +
      `- Browser-visible reasoning panels: ${completeness.counts.browserVisibleReasoningPanels}.\n` +
      `- Unrecognised expandable controls in assistant turns: ${completeness.unclassifiedToggleLabels.length ? completeness.unclassifiedToggleLabels.map((label) => `"${label}"`).join(', ') : 'none'}.\n\n` +
      `## Archive scope\n\n` +
      `This archive records browser-visible text/data collected after capture started. It does not reconstruct server-only state and does not contain hidden model reasoning.\n`;
  }

  function escapeHtml(text) {
    return String(text || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function buildSafeTurnsHtml(session, turns) {
    const blocks = turns.map((record, index) => {
      const turn = normalizeTurn(record, index);
      const raw = record.data?.html || '[raw DOM not included in this capture profile]';
      return `<section class="turn role-${escapeHtml(turn.role)}">
<header><strong>${turn.sequence}. ${escapeHtml(roleLabel(turn.role))}</strong><code>${escapeHtml(turn.messageId || turn.dataTestId || turn.stableKey || '')}</code></header>
<h3>Browser-visible reasoning</h3><pre>${escapeHtml(turn.browserVisibleReasoning.map((item) => `${item.title}\n${item.text}`).join('\n\n'))}</pre>
<h3>Final text</h3><pre>${escapeHtml(turn.finalAnswer.text)}</pre>
<details><summary>Escaped captured DOM source</summary><pre class="dom-source">${escapeHtml(raw)}</pre></details>
</section>`;
    }).join('\n');

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(session.title || 'ChatGPT session')}</title>
<style>body{font-family:system-ui,sans-serif;max-width:1100px;margin:auto;padding:24px;background:#111;color:#eee}.turn{border:1px solid #444;border-radius:10px;margin:18px 0;padding:16px;background:#181818}.turn header{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #333;padding-bottom:10px}.turn pre{white-space:pre-wrap;overflow-wrap:anywhere}.dom-source{font-family:ui-monospace,monospace;font-size:12px}.role-user{border-left:5px solid #6aa9ff}.role-assistant{border-left:5px solid #64d79a}code{overflow-wrap:anywhere;color:#bbb}</style>
</head><body><h1>${escapeHtml(session.title || 'ChatGPT session')}</h1>${blocks}</body></html>`;
  }

  async function sha256Hex(bytes) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  const encoder = new TextEncoder();

  // NDJSON is assembled as Blob parts so that a large evidence capture never
  // has to exist as one JavaScript string (V8 caps strings at ~512 MiB).
  async function buildEvidenceNdjson(records, externalFiles) {
    const parts = [];
    for (const record of records) {
      let line = record;
      const external = externalFiles.get(record.id);
      if (external) {
        line = {
          ...record,
          data: { ...record.data, result: { ...record.data.result, data: null, externalFile: external.path, byteLength: external.byteLength } }
        };
      }
      parts.push(JSON.stringify(line), '\n');
    }
    return new Uint8Array(await new Blob(parts).arrayBuffer());
  }

  async function createArchive(sessionId) {
    const session = await CgscDB.getSession(sessionId);
    if (!session) throw new Error('Session not found.');
    const records = await CgscDB.getRecords(sessionId);
    const turns = records.filter((record) => record.kind === 'conversation-turn').sort(compareTurns);
    const attachments = collectAttachments(turns);
    const completeness = buildCompleteness(session, records, turns, attachments);
    const structured = buildStructuredSession(session, turns);
    const transcriptOnly = (session.captureProfile || session.options?.captureProfile) === 'ai-transcript';
    const zip = new CgscZip.ZipBuilder();
    const modifiedAt = new Date();
    const checksums = [];

    async function add(name, content) {
      const bytes = content instanceof Uint8Array ? content : encoder.encode(String(content));
      checksums.push(`${await sha256Hex(bytes)}  ${name}`);
      zip.add(name, bytes, modifiedAt);
    }

    await add('AI_TO_AI_INSTRUCTIONS.md', buildAiInstructions(session, completeness));
    await add('conversation/session.md', buildMarkdown(session, turns, completeness));
    await add('conversation/session.json', pretty(structured));
    await add('diagnostics/completeness.json', pretty(completeness));
    await add('attachments/manifest.json', pretty(attachments));
    await add('manifest/session.json', pretty({
      id: session.id,
      title: session.title,
      captureProfile: session.captureProfile || session.options?.captureProfile || 'unknown',
      extensionVersion: session.extensionVersion,
      exportedByVersion: globalThis.chrome?.runtime?.getManifest?.().version ?? null,
      conversationId: session.conversationId || null,
      startedAt: iso(session.startedAt),
      stoppedAt: iso(session.stoppedAt),
      status: session.status,
      stopReason: session.stopReason || null,
      startUrl: session.startUrl,
      currentUrl: session.currentUrl,
      options: session.options,
      exportedAt: iso(Date.now())
    }));

    if (!transcriptOnly) {
      // MHTML snapshots are written once as files and referenced from the NDJSON.
      const externalFiles = new Map();
      let mhtmlIndex = 0;
      for (const record of records) {
        if (record.kind === 'debugger-mhtml-snapshot' && typeof record.data?.result?.data === 'string') {
          mhtmlIndex += 1;
          const path = `evidence/mhtml/${String(mhtmlIndex).padStart(4, '0')}.mhtml`;
          const bytes = encoder.encode(record.data.result.data);
          externalFiles.set(record.id, { path, byteLength: bytes.byteLength });
          await add(path, bytes);
        }
      }
      await add('evidence/records.ndjson', await buildEvidenceNdjson(records, externalFiles));
      await add('evidence/turns.safe.html', buildSafeTurnsHtml(session, turns));
      await add('evidence/record-kinds.json', pretty(completeness.kinds));
    }

    zip.add('manifest/sha256sums.txt', `${checksums.join('\n')}\n`, modifiedAt);
    return {
      blob: await zip.build(),
      summary: { status: completeness.status, failedChecks: completeness.failedChecks, uniqueTurns: completeness.counts.uniqueTurns }
    };
  }

  function revokeUrl(blobUrl) {
    if (blobUrl && activeUrls.has(blobUrl)) {
      URL.revokeObjectURL(blobUrl);
      activeUrls.delete(blobUrl);
    }
  }

  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.target !== 'offscreen') return false;

      if (message.type === 'OFFSCREEN_DIRECT_DOWNLOAD') {
        try {
          const anchor = document.createElement('a');
          anchor.href = message.blobUrl;
          anchor.download = message.filename || 'chatgpt-session-capture.zip';
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: String(error) });
        }
        return false;
      }

      if (message.type === 'OFFSCREEN_REVOKE_URL') {
        revokeUrl(message.blobUrl);
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === 'OFFSCREEN_EXPORT') {
        createArchive(message.sessionId)
          .then(({ blob, summary }) => {
            const blobUrl = URL.createObjectURL(blob);
            activeUrls.add(blobUrl);
            // Released by the background when the download ends, or here at the latest.
            setTimeout(() => revokeUrl(blobUrl), URL_LIFETIME_MS);
            sendResponse({ ok: true, blobUrl, size: blob.size, summary });
          })
          .catch((error) => sendResponse({ ok: false, error: String(error), stack: error?.stack || null }));
        return true;
      }

      return false;
    });
  }

  globalThis.CgscExport = {
    compareTurns,
    normalizeTurn,
    buildMarkdown,
    buildStructuredSession,
    buildCompleteness,
    buildAiInstructions,
    buildSafeTurnsHtml,
    collectAttachments,
    createArchive
  };
})();
