(() => {
  'use strict';

  // Labels of browser-visible reasoning/activity toggles (English and Swedish UI).
  // A label must start with one of these words; the look-ahead replaces \b,
  // which is ASCII-only in JavaScript and therefore unreliable for å/ä/ö.
  const REASONING_TOGGLE = /^(?:arbetade\s+i|arbetar|analyserade|analyserar|analys|tänkte|tänker|tanke|resonerade|resonerar|worked\s+for|working|analyzed|analyzing|analysis|reasoned|reasoning|thinking|thought)(?![\p{L}\p{N}])/iu;
  // Additional disclosure labels that are safe to open during a sweep.
  const SAFE_EXPAND = /^(?:show\s+more|read\s+more|see\s+more|continue|visa\s+mer|läs\s+mer|fortsätt)(?![\p{L}\p{N}])/iu;
  const FILE_NAME = /([^<>:"/\\|?*\r\n]+?\.(?:txt|md|markdown|pdf|zip|json|csv|xml|yaml|yml|log|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|svg|mp3|wav|mp4|mov|tar|gz|tgz|7z|py|ipynb))(?![\p{L}\p{N}])/iu;
  const SENSITIVE_QUERY = /^(?:token|access_token|id_token|refresh_token|auth|authorization|session|session_id|signature|sig|key|api_key|secret|credential|policy|expires|x-amz-signature|x-amz-credential|x-amz-security-token|x-goog-signature|x-goog-credential)$/i;
  const PRESERVING_WHITE_SPACE = /^(?:pre|pre-wrap|pre-line|break-spaces)$/;
  const MIN_IMAGE_EDGE = 24;

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    const value = String(text || '');
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function attributesToObject(element) {
    const attributes = {};
    for (const attribute of element?.attributes || []) attributes[attribute.name] = attribute.value;
    return attributes;
  }

  // Single-line labels, titles and table cells.
  function normalizeInline(text) {
    return String(text || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Prose blocks: removes trailing spaces and runs of blank lines but never
  // leading indentation.
  function normalizeBlockText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/ /g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Message text that must stay byte-identical apart from line endings and
  // surrounding blank lines (user messages, code).
  function normalizeVerbatimText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/^(?:[ \t]*\n)+/, '')
      .replace(/\s+$/, '');
  }

  // Kept for callers of the 1.1.x API; it no longer strips indentation.
  const normalizePlainText = normalizeBlockText;

  function textOf(element) {
    return normalizeBlockText(element?.innerText || element?.textContent || '');
  }

  function inlineTextOf(element) {
    return normalizeInline(element?.innerText || element?.textContent || '');
  }

  function sanitizeUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^(?:javascript|data|blob):/i.test(raw)) return '[local-or-active-resource-omitted]';
    let parsed;
    try {
      parsed = new URL(raw, location.href);
    } catch (_) {
      return raw;
    }
    const sensitive = [...new Set([...parsed.searchParams.keys()].filter((key) => SENSITIVE_QUERY.test(key)))];
    // Absolute URLs without sensitive parameters are returned exactly as written.
    if (!sensitive.length) return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : parsed.href;
    for (const key of sensitive) parsed.searchParams.set(key, 'REDACTED');
    return parsed.href;
  }

  function isVisuallyIrrelevant(element) {
    if (!(element instanceof Element)) return false;
    const tag = element.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'template', 'svg', 'path', 'use'].includes(tag)) return true;
    if (element.hidden) return true;
    if (element.getAttribute('aria-hidden') === 'true') return true;
    if (element.classList.contains('sr-only')) return true;
    return false;
  }

  function preservesWhiteSpace(element, cache) {
    if (!element || !element.isConnected) return false;
    if (cache.has(element)) return cache.get(element);
    let value = false;
    try {
      value = PRESERVING_WHITE_SPACE.test(getComputedStyle(element).whiteSpace || '');
    } catch (_) {
      value = false;
    }
    cache.set(element, value);
    return value;
  }

  function escapeMarkdownText(text) {
    return String(text || '').replace(/([\\`*_{}\[\]<>])/g, '\\$1');
  }

  function longestBacktickRun(text) {
    const matches = String(text || '').match(/`+/g) || [];
    return matches.reduce((value, item) => Math.max(value, item.length), 0);
  }

  function tableToMarkdown(table) {
    const rows = [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr')]
      .map((row) => [...row.querySelectorAll(':scope > th, :scope > td')].map((cell) => {
        const lines = String(cell.innerText || cell.textContent || '')
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map(normalizeInline)
          .filter(Boolean);
        return lines.join('<br>').replace(/\|/g, '\\|');
      }))
      .filter((row) => row.length);
    if (!rows.length) return '';
    const width = Math.max(...rows.map((row) => row.length));
    for (const row of rows) while (row.length < width) row.push('');
    const header = rows[0];
    const body = rows.slice(1);
    return [
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      ...body.map((row) => `| ${row.join(' | ')} |`)
    ].join('\n');
  }

  function codeLanguage(pre, code) {
    for (const element of [code, pre]) {
      const match = String(element?.className || '').match(/(?:^|\s)(?:language-|lang-)([\w+#.-]+)/i);
      if (match) return match[1];
    }
    return '';
  }

  // Converts rendered DOM to Markdown. Code and white-space-preserving text is
  // replaced by placeholders while the surrounding prose is normalized, so
  // indentation and blank lines inside code survive unchanged.
  function domToMarkdown(root, options = {}) {
    if (!root) return '';
    const skip = options.skip || [];
    const isSkipped = (node) => skip.some((item) => item === node);
    const verbatim = [];
    const whiteSpaceCache = new WeakMap();
    const protect = (value) => {
      verbatim.push(value);
      return `\u0000CGSC${verbatim.length - 1}\u0000`;
    };

    function render(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.nodeValue || '';
        if (preservesWhiteSpace(node.parentElement, whiteSpaceCache)) return value ? protect(value) : '';
        return value.replace(/[ \t\n\r\f]+/g, ' ');
      }
      if (!(node instanceof Element) || isVisuallyIrrelevant(node) || isSkipped(node)) return '';

      const tag = node.tagName.toLowerCase();
      const childText = () => [...node.childNodes].map(render).join('');

      if (tag === 'br') return '\n';
      if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag.slice(1)))} ${normalizeInline(childText())}\n\n`;
      if (tag === 'p') return `\n\n${normalizeBlockText(childText())}\n\n`;
      if (tag === 'strong' || tag === 'b' || tag === 'em' || tag === 'i' || tag === 'del' || tag === 's') {
        const inner = normalizeInline(childText());
        if (!inner) return '';
        const marker = tag === 'strong' || tag === 'b' ? '**' : (tag === 'del' || tag === 's' ? '~~' : '*');
        return `${marker}${inner}${marker}`;
      }
      if (tag === 'code' && !node.closest('pre')) {
        const value = node.textContent || '';
        const fence = '`'.repeat(longestBacktickRun(value) + 1);
        const pad = /^`|`$/.test(value) ? ' ' : '';
        return protect(`${fence}${pad}${value}${pad}${fence}`);
      }
      if (tag === 'pre') {
        // ChatGPT renders a language label and a copy button inside <pre>;
        // the code itself is the <code> element.
        const code = node.querySelector('code');
        const value = String(code ? code.textContent : node.textContent || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
        const fence = '`'.repeat(Math.max(3, longestBacktickRun(value) + 1));
        return `\n\n${protect(`${fence}${codeLanguage(node, code)}\n${value}\n${fence}`)}\n\n`;
      }
      if (tag === 'a') {
        const label = normalizeInline(childText()) || normalizeInline(node.getAttribute('aria-label'));
        const href = sanitizeUrl(node.getAttribute('href') || '');
        if (!href || href === '[local-or-active-resource-omitted]') return label;
        return `[${label || href}](${href})`;
      }
      if (tag === 'img') {
        const alt = normalizeInline(node.getAttribute('alt') || '');
        const src = sanitizeUrl(node.getAttribute('src') || '');
        return alt ? `![${escapeMarkdownText(alt)}](${src || '#'})` : '';
      }
      if (tag === 'blockquote') {
        const content = normalizeBlockText(childText());
        return `\n\n${content.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
      }
      if (tag === 'ul' || tag === 'ol') {
        const ordered = tag === 'ol';
        const first = ordered ? (Number.parseInt(node.getAttribute('start') || '1', 10) || 1) : 1;
        const items = [...node.children].filter((child) => child.tagName?.toLowerCase() === 'li');
        return `\n\n${items.map((item, index) => {
          const rendered = normalizeBlockText([...item.childNodes].map(render).join(''));
          const prefix = ordered ? `${first + index}. ` : '- ';
          return `${prefix}${rendered.replace(/\n/g, '\n  ')}`;
        }).join('\n')}\n\n`;
      }
      if (tag === 'li') return normalizeBlockText(childText());
      if (tag === 'table') return `\n\n${tableToMarkdown(node)}\n\n`;
      if (tag === 'hr') return '\n\n---\n\n';
      if (tag === 'button') return normalizeInline(childText() || node.getAttribute('aria-label') || '');
      if (tag === 'details') {
        const summaryElement = node.querySelector(':scope > summary');
        const summary = normalizeInline(summaryElement?.innerText || summaryElement?.textContent || 'Details');
        const body = [...node.childNodes].filter((child) => child !== summaryElement).map(render).join('');
        return `\n\n**${summary}**\n\n${normalizeBlockText(body)}\n\n`;
      }

      const content = childText();
      if (['div', 'section', 'article', 'main', 'header', 'footer', 'figure', 'figcaption'].includes(tag)) return `\n${content}\n`;
      return content;
    }

    const normalized = normalizeBlockText(render(root));
    return normalized.replace(/\u0000CGSC(\d+)\u0000/g, (_, index) => verbatim[Number(index)]);
  }

  function messageRootsOf(turn) {
    const roots = [...turn.querySelectorAll('[data-message-author-role]')];
    if (turn.matches?.('[data-message-author-role]')) roots.unshift(turn);
    return topLevelOnly(roots);
  }

  function topLevelOnly(nodes) {
    return nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
  }

  function answerBlocksOf(root) {
    return topLevelOnly([...root.querySelectorAll('.markdown, [class*="whitespace-pre-wrap"]')]);
  }

  function lowestCommonAncestor(a, b) {
    if (!a || !b) return a || b || null;
    let current = a;
    while (current && !current.contains(b)) current = current.parentElement;
    return current;
  }

  // Finds the element that holds a toggle's disclosed content. A candidate is
  // rejected if it contains a message root, contains the toggle, or is the last
  // answer block of its message (that block is the final answer, which is
  // what a collapsed panel's sibling heuristic would otherwise pick up).
  function reasoningContentFor(button, turn) {
    const valid = (candidate, allowLastAnswer = false) => {
      if (!candidate || candidate === button || candidate.contains(button)) return false;
      if (candidate.matches?.('[data-message-author-role]') || candidate.querySelector?.('[data-message-author-role]')) return false;
      if (!turn.contains(candidate)) return false;
      if (!allowLastAnswer) {
        const root = button.closest('[data-message-author-role]') || turn;
        const lastAnswer = answerBlocksOf(root).at(-1);
        if (lastAnswer && (candidate === lastAnswer || candidate.contains(lastAnswer))) return false;
      }
      return true;
    };

    const controls = button.getAttribute('aria-controls');
    if (controls) {
      let target = null;
      try { target = turn.querySelector(`#${CSS.escape(controls)}`) || document.getElementById(controls); } catch (_) {}
      if (valid(target, true)) return target;
    }
    if (button.getAttribute('aria-expanded') !== 'true') return null;

    for (let sibling = button.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      if (inlineTextOf(sibling)) return valid(sibling) ? sibling : null;
    }
    const parent = button.parentElement;
    const parentHoldsOnlyToggle = parent && [...parent.children].every((child) => child === button || !inlineTextOf(child));
    if (parentHoldsOnlyToggle && parent !== turn) {
      for (let sibling = parent.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        if (inlineTextOf(sibling)) return valid(sibling) ? sibling : null;
      }
    }
    return null;
  }

  function findReasoningSections(element) {
    const sections = [];
    const seenToggles = new Set();

    for (const button of element.querySelectorAll('button[aria-expanded]')) {
      const title = inlineTextOf(button) || normalizeInline(button.getAttribute('aria-label'));
      if (!REASONING_TOGGLE.test(title) || seenToggles.has(button)) continue;
      seenToggles.add(button);
      const content = reasoningContentFor(button, element);
      sections.push({
        type: 'aria-button',
        toggle: button,
        content,
        section: content ? lowestCommonAncestor(button, content) : button,
        title,
        expanded: button.getAttribute('aria-expanded') === 'true'
      });
    }

    for (const detail of element.querySelectorAll('details')) {
      if (sections.some((item) => item.content && (item.content === detail || item.content.contains(detail)))) continue;
      const summary = detail.querySelector(':scope > summary');
      const title = inlineTextOf(summary) || 'Details';
      // A <details> block inside the rendered answer is answer content, not a reasoning panel.
      if (detail.closest('.markdown') && !REASONING_TOGGLE.test(title)) continue;
      sections.push({
        type: 'details',
        toggle: summary,
        content: detail,
        section: detail,
        title,
        expanded: Boolean(detail.open)
      });
    }
    return sections;
  }

  function extractReasoningPanels(element, includeEvidence = false, sections = findReasoningSections(element)) {
    return sections.map((item, index) => {
      const content = item.content;
      const skip = item.type === 'details' && item.toggle ? [item.toggle] : [];
      const steps = content ? [...new Set([...content.querySelectorAll('button')]
        .map((button) => inlineTextOf(button))
        .filter((text) => text && text !== item.title && !REASONING_TOGGLE.test(text)))] : [];
      let text = content ? textOf(content) : '';
      if (item.type === 'details' && item.toggle) {
        const summaryText = textOf(item.toggle);
        if (summaryText && text.startsWith(summaryText)) text = text.slice(summaryText.length).trim();
      }
      const markdown = content ? domToMarkdown(content, { skip }) : '';
      const durationMatch = item.title.match(/(?:arbetade\s+i|tänkte\s+i|resonerade\s+i|worked\s+for|thought\s+for|reasoned\s+for)\s+(.+)$/iu);
      const result = {
        index,
        type: item.type,
        title: item.title,
        durationLabel: durationMatch?.[1] || null,
        expanded: Boolean(item.expanded),
        contentFound: Boolean(content) && Boolean(text || markdown),
        text,
        markdown,
        steps,
        extractionMethod: item.type === 'details'
          ? 'html-details'
          : (item.toggle?.getAttribute('aria-controls') && content ? 'aria-controls' : 'aria-expanded-sibling')
      };
      if (includeEvidence) result.html = item.section?.outerHTML || content?.outerHTML || null;
      return result;
    });
  }

  // Returns the blocks that make up the visible message(s) of a turn, in
  // document order, excluding reasoning toggles and their disclosed content.
  function finalContentParts(element, role, sections) {
    const excluded = sections.flatMap((item) => [item.toggle, item.content]).filter(Boolean);
    const isExcluded = (node) => excluded.some((item) => item === node || item.contains(node));
    const roots = messageRootsOf(element);
    const parts = [];
    for (const root of (roots.length ? roots : [element])) {
      const rootRole = root.getAttribute('data-message-author-role') || role;
      const messageId = root.getAttribute('data-message-id') || null;
      const blocks = topLevelOnly([...root.querySelectorAll('.markdown')].filter((node) => !isExcluded(node)));
      const userBlocks = blocks.length ? [] : topLevelOnly([...root.querySelectorAll('[class*="whitespace-pre-wrap"]')].filter((node) => !isExcluded(node)));
      const chosen = blocks.length ? blocks : userBlocks;
      if (chosen.length) {
        for (const block of chosen) parts.push({ root, block, messageId, role: rootRole, fallback: false });
      } else {
        parts.push({ root, block: root, messageId, role: rootRole, fallback: true, skip: excluded.filter((node) => root.contains(node)) });
      }
    }
    return parts;
  }

  function renderPart(part) {
    if (part.fallback) {
      const markdown = domToMarkdown(part.block, { skip: part.skip });
      return { markdown, text: markdown };
    }
    const verbatim = /whitespace-pre-wrap/.test(String(part.block.className || ''));
    const raw = part.block.innerText || part.block.textContent || '';
    const text = verbatim ? normalizeVerbatimText(raw) : normalizeBlockText(raw);
    return { markdown: domToMarkdown(part.block), text };
  }

  function collectLinks(roots) {
    const links = [];
    for (const root of Array.isArray(roots) ? roots : [roots]) {
      for (const anchor of root?.querySelectorAll?.('a[href]') || []) {
        const text = inlineTextOf(anchor) || anchor.getAttribute('aria-label') || '';
        const href = sanitizeUrl(anchor.getAttribute('href'));
        if (!href) continue;
        links.push({ text, href });
      }
    }
    const seen = new Set();
    return links.filter((item) => {
      const key = `${item.text}\n${item.href}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Largest size known from layout, attributes or the decoded image. A broken
  // image (for example an expired signed URL) is laid out as a small alt-text
  // box, so layout alone would misclassify it as an icon.
  function imageSize(image) {
    let rect = { width: 0, height: 0 };
    try { rect = image.getBoundingClientRect(); } catch (_) {}
    return {
      width: Math.max(rect.width || 0, Number(image.getAttribute('width')) || 0, image.naturalWidth || 0),
      height: Math.max(rect.height || 0, Number(image.getAttribute('height')) || 0, image.naturalHeight || 0)
    };
  }

  function collectAttachments(element) {
    const output = [];
    let imageOrdinal = 0;
    for (const node of element.querySelectorAll('a,button,[aria-label],img')) {
      const isImage = node.tagName?.toLowerCase() === 'img';
      const label = normalizeInline(node.getAttribute?.('aria-label') || node.getAttribute?.('alt') || inlineTextOf(node));
      const match = label.match(FILE_NAME);
      const src = node.getAttribute?.('href') || node.getAttribute?.('src') || '';
      let decodedSrc = src;
      try { decodedSrc = decodeURIComponent(src); } catch (_) {}
      const srcLeaf = decodedSrc.split(/[/?#]/).filter(Boolean).at(-1) || decodedSrc;
      const srcMatch = srcLeaf.match(FILE_NAME);
      let displayName = (match?.[1] || srcMatch?.[1] || '').trim() || null;

      if (!displayName && isImage) {
        // Images such as uploads are often served without a file-name extension.
        const { width, height } = imageSize(node);
        const alt = normalizeInline(node.getAttribute('alt'));
        const sizeUnknown = width === 0 && height === 0;
        if (!src || (sizeUnknown ? !alt : (width < MIN_IMAGE_EDGE || height < MIN_IMAGE_EDGE))) continue;
        imageOrdinal += 1;
        displayName = alt || `image ${imageOrdinal}`;
      }
      if (!displayName) continue;
      output.push({
        displayName,
        kind: isImage ? 'image' : 'file-reference',
        renderedRepresentationCaptured: true,
        fileContentCaptured: false,
        url: src ? sanitizeUrl(src) : null,
        ariaLabel: node.getAttribute?.('aria-label') || null,
        alt: node.getAttribute?.('alt') || null
      });
    }
    const merged = new Map();
    for (const item of output) {
      // Images are distinguished by URL because many share an alt text such as "Uploaded image".
      const key = item.kind === 'image' && item.url ? `image\n${item.url}` : `name\n${item.displayName.toLocaleLowerCase()}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, item);
        continue;
      }
      merged.set(key, {
        ...existing,
        kind: existing.kind === 'image' || item.kind === 'image' ? 'image' : 'file-reference',
        url: existing.url || item.url || null,
        ariaLabel: existing.ariaLabel || item.ariaLabel || null,
        alt: existing.alt || item.alt || null
      });
    }
    return [...merged.values()];
  }

  function getRole(element) {
    return element.getAttribute('data-message-author-role') ||
      element.getAttribute('data-turn') ||
      element.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role') ||
      element.getAttribute('data-author') ||
      'unknown';
  }

  function unclassifiedToggles(element) {
    return [...element.querySelectorAll('button[aria-expanded]')]
      .map((button) => inlineTextOf(button) || normalizeInline(button.getAttribute('aria-label')) || '[no label]')
      .filter((label) => !REASONING_TOGGLE.test(label) && !SAFE_EXPAND.test(label));
  }

  function extractTurn(element, context = {}) {
    const includeEvidence = Boolean(context.includeEvidence);
    const role = getRole(element);
    const dataTestId = element.getAttribute('data-testid') ||
      element.querySelector('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid') || null;
    const turnIndexMatch = String(dataTestId || '').match(/conversation-turn-(\d+)/i);
    const turnIndex = turnIndexMatch ? Number(turnIndexMatch[1]) : null;
    const messageRoot = element.querySelector('[data-message-id]');
    const messageId = element.getAttribute('data-message-id') || messageRoot?.getAttribute('data-message-id') || null;
    const turnId = element.getAttribute('data-turn-id') || element.getAttribute('data-turn-id-container') || null;
    const sections = role === 'assistant' ? findReasoningSections(element) : [];
    const reasoning = role === 'assistant' ? extractReasoningPanels(element, includeEvidence, sections) : [];
    const parts = finalContentParts(element, role, sections);
    const rendered = parts.map((part) => ({ part, ...renderPart(part) }));
    const messages = rendered.map(({ part, markdown, text }) => ({
      messageId: part.messageId,
      role: part.role,
      markdown,
      text,
      extraction: part.fallback ? 'message-root-without-reasoning' : 'content-block'
    }));
    // Consecutive blocks of the same message are joined into one entry.
    const mergedMessages = [];
    for (const message of messages) {
      const previous = mergedMessages.at(-1);
      if (previous && previous.messageId === message.messageId && previous.role === message.role) {
        previous.markdown = [previous.markdown, message.markdown].filter(Boolean).join('\n\n');
        previous.text = [previous.text, message.text].filter(Boolean).join('\n\n');
      } else {
        mergedMessages.push({ ...message });
      }
    }
    const finalMarkdown = mergedMessages.map((message) => message.markdown).filter(Boolean).join('\n\n');
    const finalText = mergedMessages.map((message) => message.text).filter(Boolean).join('\n\n');
    const stableKey = messageId || dataTestId || turnId || `${role}-${fnv1a(finalText)}`;
    const attachments = collectAttachments(element);
    const result = {
      stableKey,
      sweepRunId: context.sweepRunId || null,
      scanIndex: context.scanIndex,
      domIndex: context.domIndex,
      role,
      turnIndex,
      turnId,
      messageId,
      dataTestId,
      modelSlug: messageRoot?.getAttribute('data-message-model-slug') || null,
      attributes: includeEvidence ? attributesToObject(element) : undefined,
      finalText,
      finalMarkdown,
      messages: mergedMessages,
      reasoning,
      unclassifiedToggles: role === 'assistant' ? unclassifiedToggles(element) : [],
      links: collectLinks(parts.map((part) => part.block)),
      attachments,
      pageUrl: location.href,
      evidenceIncluded: includeEvidence
    };
    result.contentHash = fnv1a(JSON.stringify([
      finalMarkdown,
      reasoning.map((item) => [item.title, item.expanded, item.contentFound, item.markdown]),
      attachments.map((item) => [item.displayName, item.url]),
      result.unclassifiedToggles
    ]));

    if (includeEvidence) {
      const rect = element.getBoundingClientRect();
      result.browserVisibleText = textOf(element);
      result.textContent = element.textContent || '';
      result.html = element.outerHTML;
      result.finalHtml = parts.map((part) => part.block.outerHTML).join('\n') || null;
      result.geometry = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    }
    return result;
  }

  function conversationIdFromUrl(url) {
    try {
      const match = new URL(String(url || ''), 'https://chatgpt.com/').pathname.match(/(?:^|\/)c\/([0-9A-Za-z-]{8,})(?:\/|$)/);
      return match ? match[1] : null;
    } catch (_) {
      return null;
    }
  }

  function isSafeExpandLabel(label) {
    const value = normalizeInline(label);
    return REASONING_TOGGLE.test(value) || SAFE_EXPAND.test(value);
  }

  globalThis.CgscCaptureCore = {
    REASONING_TOGGLE,
    SAFE_EXPAND,
    fnv1a,
    attributesToObject,
    normalizeInline,
    normalizeBlockText,
    normalizeVerbatimText,
    normalizePlainText,
    sanitizeUrl,
    domToMarkdown,
    findReasoningSections,
    extractReasoningPanels,
    collectLinks,
    collectAttachments,
    getRole,
    extractTurn,
    conversationIdFromUrl,
    isSafeExpandLabel
  };
})();
