(() => {
  'use strict';

  const activeUrls = new Set();

  function iso(value) {
    return value ? new Date(value).toISOString() : null;
  }

  function pretty(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }

  function safeName(value) {
    return String(value || 'item').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'item';
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

  function compareTurns(a, b) {
    const ka = turnSortKey(a);
    const kb = turnSortKey(b);
    if (Number.isFinite(ka.numeric) && Number.isFinite(kb.numeric) && ka.numeric !== kb.numeric) return ka.numeric - kb.numeric;
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
    return {
      sequence: index + 1,
      turnIndex,
      role: data.role || 'unknown',
      messageId: data.messageId || null,
      turnId: data.turnId || null,
      dataTestId: data.dataTestId || null,
      stableKey: data.stableKey || null,
      modelSlug: data.modelSlug || null,
      capturedAt: iso(record.capturedAt),
      firstSeenAt: iso(data.firstSeenAt),
      firstSeenScanIndex: Number.isFinite(data.firstSeenScanIndex) ? data.firstSeenScanIndex : null,
      finalAnswer: {
        text: finalText,
        markdown: finalMarkdown
      },
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
      links: Array.isArray(data.links) ? data.links : [],
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
      evidenceIncluded: Boolean(data.evidenceIncluded)
    };
  }

  function buildStructuredSession(session, turns) {
    return {
      schema: 'cgsc.browser-transcript/1.1',
      generatedAt: iso(Date.now()),
      capture: {
        id: session.id,
        profile: session.captureProfile || session.options?.captureProfile || 'unknown',
        extensionVersion: session.extensionVersion || null,
        title: session.title || 'ChatGPT session',
        startedAt: iso(session.startedAt),
        stoppedAt: iso(session.stoppedAt),
        startUrl: session.startUrl || null,
        currentUrl: session.currentUrl || null,
        options: session.options || {}
      },
      scope: {
        containsBrowserRenderedConversationText: true,
        containsBrowserVisibleReasoningSummaries: true,
        containsHiddenModelChainOfThought: false,
        attachmentBodiesIncludedOnlyWhenExplicitlyMarked: true
      },
      messages: turns.map(normalizeTurn)
    };
  }

  function buildMarkdown(session, turns) {
    const normalized = turns.map(normalizeTurn);
    const lines = [
      `# ${session.title || 'ChatGPT session'}`,
      '',
      `- Capture ID: \`${session.id}\``,
      `- Capture profile: \`${session.captureProfile || session.options?.captureProfile || 'unknown'}\``,
      `- Started: ${iso(session.startedAt)}`,
      `- Stopped: ${session.stoppedAt ? iso(session.stoppedAt) : 'capture was still active at export'}`,
      `- Captured turns: ${normalized.length}`,
      '',
      '> Scope: browser-rendered conversation text and browser-visible expandable reasoning summaries. This file does not claim hidden model chain-of-thought or server-only data.',
      ''
    ];

    for (const turn of normalized) {
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
          if (panel.steps.length) {
            lines.push('', '**Visible steps**', '');
            for (const step of panel.steps) lines.push(`- ${step}`);
          }
          const body = panel.markdown || panel.text;
          if (body && !panel.steps.length) lines.push('', body);
          lines.push('');
        }
      }

      lines.push(turn.role === 'assistant' ? '### Final answer' : '### Message', '');
      lines.push(turn.finalAnswer.markdown || turn.finalAnswer.text || '_No text captured_', '');

      if (turn.attachments.length) {
        lines.push('### Attachment references', '');
        for (const attachment of turn.attachments) {
          lines.push(`- ${attachment.displayName || 'unnamed attachment'} — file content captured: ${attachment.fileContentCaptured ? 'yes' : 'no'}`);
        }
        lines.push('');
      }
    }
    return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()}\n`;
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
      schema: 'cgsc.attachment-manifest/1.1',
      generatedAt: iso(Date.now()),
      count: items.length,
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

  function latestSweepSummary(session, records) {
    const completions = records
      .filter((record) => record.kind === 'sweep-progress' && record.data?.stage === 'sweep-complete')
      .sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
    return completions[0]?.data || session.fullCaptureResult?.sweep || null;
  }

  function buildCompleteness(session, records, turns, attachments) {
    const kinds = {};
    for (const record of records) kinds[record.kind] = (kinds[record.kind] || 0) + 1;
    const normalized = turns.map(normalizeTurn);
    const turnIndices = normalized.map((turn) => turn.turnIndex).filter(Number.isFinite).sort((a, b) => a - b);
    const gaps = missingIntegers(turnIndices);
    const sweep = latestSweepSummary(session, records);
    const reasoningPanels = normalized.flatMap((turn) => turn.browserVisibleReasoning);
    const errors = records.filter((record) => /error|failed/i.test(record.kind));
    const responseBodies = records.filter((record) => record.kind === 'cdp-network-response-body');
    const bodyErrors = responseBodies.filter((record) => record.data?.body?.captureError);
    const topVerified = Boolean(sweep?.topVerified);
    const bottomVerified = Boolean(sweep?.bottomVerified);
    const contiguousFromTurnOne = turnIndices.length > 0 && turnIndices[0] === 1 && gaps.length === 0;
    const expansionFailures = Number(sweep?.expansion?.failed || 0);
    const reasoningContentFailures = reasoningPanels.filter((panel) => !panel.contentFound).length;

    let status = 'CAPTURED_WITHOUT_REPORTED_ERRORS';
    if (!sweep) status = 'NO_COMPLETED_SWEEP_RECORDED';
    else if (topVerified && bottomVerified && contiguousFromTurnOne && expansionFailures === 0 && reasoningContentFailures === 0 && errors.length === 0) {
      status = 'VERIFIED_COMPLETE_BROWSER_TRANSCRIPT';
    } else {
      status = 'CAPTURED_WITH_UNVERIFIED_BOUNDARIES_OR_GAPS';
    }

    return {
      schema: 'cgsc.completeness/1.1',
      generatedAt: iso(Date.now()),
      sessionId: session.id,
      status,
      captureProfile: session.captureProfile || session.options?.captureProfile || 'unknown',
      captureOptions: session.options || {},
      counts: {
        storedRecords: records.length,
        uniqueTurns: turns.length,
        numericTurnIds: turnIndices.length,
        browserVisibleReasoningPanels: reasoningPanels.length,
        reasoningPanelsNotExpanded: reasoningPanels.filter((panel) => !panel.expanded).length,
        reasoningPanelsMissingContent: reasoningContentFailures,
        attachmentReferences: attachments.count,
        attachmentBodiesCaptured: attachments.contentCapturedCount,
        responseBodies: responseBodies.length,
        responseBodyErrors: bodyErrors.length,
        errorRecords: errors.length
      },
      turnSequence: {
        minimumTurnIndex: turnIndices[0] ?? null,
        maximumTurnIndex: turnIndices.at(-1) ?? null,
        missingTurnIndices: gaps,
        contiguousFromTurnOne
      },
      sweep: sweep || null,
      boundaries: { topVerified, bottomVerified },
      virtualizationObserved: Boolean(sweep?.virtualizationObserved),
      kinds,
      limitations: [
        'Completeness applies only to text and UI data that became observable in the browser during this capture and sweep.',
        'Browser-visible reasoning summaries are separated from final answers. Hidden model chain-of-thought is not browser-exposed and is not present.',
        'An attachment reference does not mean the attachment body was captured. Consult attachments/manifest.json.',
        'A VERIFIED_COMPLETE_BROWSER_TRANSCRIPT verdict requires a stabilized top, verified bottom, contiguous conversation-turn numbering from 1, no recorded expansion failure and no error record.',
        'Site DOM changes can invalidate selectors; such a capture must not be treated as complete without the listed boundary and sequence checks.'
      ],
      responseBodyErrors: bodyErrors.map((record) => ({
        requestId: record.data?.requestId,
        error: record.data?.body?.captureError,
        requestMeta: record.data?.requestMeta || null
      })),
      errorRecords: errors.map((record) => ({ kind: record.kind, capturedAt: iso(record.capturedAt), data: record.data }))
    };
  }

  function buildAiInstructions(session, completeness) {
    return `# AI-to-AI review instructions\n\n` +
      `This ZIP is a ChatGPT browser-session capture produced locally by ChatGPT Session Capture ${session.extensionVersion || 'unknown'}.\n\n` +
      `## Read order\n\n` +
      `1. \`conversation/session.md\` — primary human- and AI-readable transcript.\n` +
      `2. \`diagnostics/completeness.json\` — capture boundaries, sequence gaps, expansion failures and verdict.\n` +
      `3. \`conversation/session.json\` — structured message objects.\n` +
      `4. \`attachments/manifest.json\` — attachment references and whether file bodies were actually captured.\n\n` +
      `## Interpretation contract\n\n` +
      `- Treat \"Browser-visible reasoning summary\" as UI text exposed by the browser, not as hidden model chain-of-thought.\n` +
      `- Treat \"Final answer\" as the assistant response presented to the user.\n` +
      `- Do not infer attachment contents when \`fileContentCaptured\` is false.\n` +
      `- Do not claim the transcript is complete unless the completeness verdict and its supporting boundary/sequence fields justify that claim.\n` +
      `- Capture profile: \`${session.captureProfile || session.options?.captureProfile || 'unknown'}\`.\n` +
      `- Completeness verdict: \`${completeness.status}\`.\n` +
      `- Unique turns: ${completeness.counts.uniqueTurns}.\n` +
      `- Browser-visible reasoning panels: ${completeness.counts.browserVisibleReasoningPanels}.\n\n` +
      `## Archive scope\n\n` +
      `This archive records browser-visible text/data collected after capture started. It does not reconstruct server-only state and does not contain hidden model reasoning.\n`;
  }

  function escapeHtml(text) {
    return String(text || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
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

    zip.add('AI_TO_AI_INSTRUCTIONS.md', buildAiInstructions(session, completeness), modifiedAt);
    zip.add('conversation/session.md', buildMarkdown(session, turns), modifiedAt);
    zip.add('conversation/session.json', pretty(structured), modifiedAt);
    zip.add('diagnostics/completeness.json', pretty(completeness), modifiedAt);
    zip.add('attachments/manifest.json', pretty(attachments), modifiedAt);
    zip.add('manifest/session.json', pretty({
      id: session.id,
      title: session.title,
      captureProfile: session.captureProfile || session.options?.captureProfile || 'unknown',
      extensionVersion: session.extensionVersion,
      startedAt: iso(session.startedAt),
      stoppedAt: iso(session.stoppedAt),
      status: session.status,
      startUrl: session.startUrl,
      currentUrl: session.currentUrl,
      options: session.options,
      exportedAt: iso(Date.now())
    }), modifiedAt);

    if (!transcriptOnly) {
      zip.add('evidence/records.ndjson', `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, modifiedAt);
      zip.add('evidence/turns.raw.json', pretty(turns), modifiedAt);
      zip.add('evidence/turns.safe.html', buildSafeTurnsHtml(session, turns), modifiedAt);
      zip.add('evidence/record-kinds.json', pretty(completeness.kinds), modifiedAt);
      let mhtmlIndex = 0;
      for (const record of records) {
        if (record.kind === 'debugger-mhtml-snapshot' && typeof record.data?.result?.data === 'string') {
          mhtmlIndex += 1;
          zip.add(`evidence/mhtml/${String(mhtmlIndex).padStart(4, '0')}.mhtml`, record.data.result.data, modifiedAt);
        }
      }
    }

    return await zip.build();
  }

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
      if (message.blobUrl && activeUrls.has(message.blobUrl)) {
        URL.revokeObjectURL(message.blobUrl);
        activeUrls.delete(message.blobUrl);
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'OFFSCREEN_EXPORT') {
      createArchive(message.sessionId)
        .then((blob) => {
          const blobUrl = URL.createObjectURL(blob);
          activeUrls.add(blobUrl);
          sendResponse({ ok: true, blobUrl, size: blob.size });
        })
        .catch((error) => sendResponse({ ok: false, error: String(error), stack: error?.stack || null }));
      return true;
    }

    return false;
  });

  globalThis.CgscExport = {
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
