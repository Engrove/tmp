(() => {
  'use strict';

  const REASONING_TOGGLE = /^(arbetade\s+i|analyserar|analys|tänker|tanke|worked\s+for|analyzing|analysis|thinking|thought)\b/i;
  const FILE_NAME = /([^<>:"/\\|?*\r\n]+?\.(?:txt|md|markdown|pdf|zip|json|csv|xml|yaml|yml|log|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|svg|mp3|wav|mp4|mov|tar|gz|tgz|7z))/i;
  const SENSITIVE_QUERY = /^(?:token|access_token|id_token|refresh_token|auth|authorization|session|session_id|signature|sig|key|api_key|secret|credential|policy|expires|x-amz-signature|x-amz-credential|x-amz-security-token|x-goog-signature|x-goog-credential)$/i;

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

  function normalizePlainText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function textOf(element) {
    return normalizePlainText(element?.innerText || element?.textContent || '');
  }

  function sanitizeUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^(?:javascript|data|blob):/i.test(raw)) return '[local-or-active-resource-omitted]';
    try {
      const htmlEncoded = raw.includes('&amp;');
      const parsed = new URL(raw.replaceAll('&amp;', '&'), location.href);
      for (const key of [...parsed.searchParams.keys()]) {
        if (SENSITIVE_QUERY.test(key)) parsed.searchParams.set(key, '[REDACTED]');
      }
      const output = parsed.href;
      return htmlEncoded ? output.replaceAll('&', '&amp;') : output;
    } catch (_) {
      return raw;
    }
  }

  function isVisuallyIrrelevant(element) {
    if (!(element instanceof Element)) return false;
    const tag = element.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'template', 'svg', 'path', 'use'].includes(tag)) return true;
    if (element.getAttribute('aria-hidden') === 'true') return true;
    if (element.classList.contains('sr-only')) return true;
    return false;
  }

  function escapeMarkdownText(text) {
    return String(text || '').replace(/([\\`*_{}\[\]<>])/g, '\\$1');
  }

  function codeFenceFor(text) {
    const matches = String(text || '').match(/`+/g) || [];
    const max = matches.reduce((value, item) => Math.max(value, item.length), 0);
    return '`'.repeat(Math.max(1, max + 1));
  }

  function tableToMarkdown(table) {
    const rows = [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')]
      .map((row) => [...row.querySelectorAll(':scope > th, :scope > td')].map((cell) => normalizePlainText(cell.innerText || cell.textContent || '').replace(/\|/g, '\\|')))
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

  function domToMarkdown(root) {
    if (!root) return '';

    function render(node, context = {}) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
      if (!(node instanceof Element) || isVisuallyIrrelevant(node)) return '';

      const tag = node.tagName.toLowerCase();
      const childText = () => [...node.childNodes].map((child) => render(child, context)).join('');

      if (tag === 'br') return '\n';
      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1));
        return `${'#'.repeat(level)} ${normalizePlainText(childText())}\n\n`;
      }
      if (tag === 'p') return `${normalizePlainText(childText())}\n\n`;
      if (tag === 'strong' || tag === 'b') return `**${normalizePlainText(childText())}**`;
      if (tag === 'em' || tag === 'i') return `*${normalizePlainText(childText())}*`;
      if (tag === 'del' || tag === 's') return `~~${normalizePlainText(childText())}~~`;
      if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') {
        const value = node.textContent || '';
        const fence = codeFenceFor(value);
        return `${fence}${value}${fence}`;
      }
      if (tag === 'pre') {
        const value = (node.textContent || '').replace(/\n+$/, '');
        const code = node.querySelector('code');
        const className = code?.className || node.className || '';
        const language = (String(className).match(/(?:language-|lang-)([\w+-]+)/i) || [])[1] || '';
        const fence = '`'.repeat(Math.max(3, codeFenceFor(value).length));
        return `\n${fence}${language}\n${value}\n${fence}\n\n`;
      }
      if (tag === 'a') {
        const label = normalizePlainText(childText()) || normalizePlainText(node.getAttribute('aria-label'));
        const href = sanitizeUrl(node.getAttribute('href') || '');
        if (!href || href === '[local-or-active-resource-omitted]') return label;
        return `[${label || href}](${href})`;
      }
      if (tag === 'img') {
        const alt = normalizePlainText(node.getAttribute('alt') || '');
        const src = sanitizeUrl(node.getAttribute('src') || '');
        return alt ? `![${escapeMarkdownText(alt)}](${src || '#'})` : '';
      }
      if (tag === 'blockquote') {
        const content = normalizePlainText(childText());
        return `${content.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
      }
      if (tag === 'ul' || tag === 'ol') {
        const ordered = tag === 'ol';
        const items = [...node.children].filter((child) => child.tagName?.toLowerCase() === 'li');
        return `${items.map((item, index) => {
          const rendered = normalizePlainText([...item.childNodes].map((child) => render(child, { ...context, listItem: true })).join(''));
          const prefix = ordered ? `${index + 1}. ` : '- ';
          return `${prefix}${rendered.replace(/\n/g, '\n  ')}`;
        }).join('\n')}\n\n`;
      }
      if (tag === 'li') return normalizePlainText(childText());
      if (tag === 'table') return `${tableToMarkdown(node)}\n\n`;
      if (tag === 'hr') return '\n---\n\n';
      if (tag === 'button') return normalizePlainText(childText() || node.getAttribute('aria-label') || '');
      if (tag === 'details') {
        const summary = normalizePlainText(node.querySelector(':scope > summary')?.innerText || 'Details');
        const clone = node.cloneNode(true);
        clone.querySelector(':scope > summary')?.remove();
        return `**${summary}**\n\n${normalizePlainText(domToMarkdown(clone))}\n\n`;
      }

      const content = childText();
      if (['div', 'section', 'article', 'main', 'header', 'footer'].includes(tag)) return `${content}\n`;
      return content;
    }

    return normalizePlainText(render(root))
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function findReasoningSections(element) {
    const sections = [];
    const seen = new Set();

    for (const button of element.querySelectorAll('button[aria-expanded]')) {
      const title = textOf(button);
      if (!REASONING_TOGGLE.test(title)) continue;
      let content = null;
      const controls = button.getAttribute('aria-controls');
      if (controls) content = document.getElementById(controls);
      if (!content && button.nextElementSibling) content = button.nextElementSibling;
      if (!content && button.parentElement) {
        content = [...button.parentElement.children].find((child) => child !== button && textOf(child)) || null;
      }
      const section = content && button.parentElement?.contains(content) ? button.parentElement : button.closest('div');
      if (section && seen.has(section)) continue;
      if (section) seen.add(section);
      sections.push({ type: 'aria-button', toggle: button, content, section, title });
    }

    for (const detail of element.querySelectorAll('details')) {
      if (seen.has(detail)) continue;
      seen.add(detail);
      sections.push({
        type: 'details',
        toggle: detail.querySelector('summary'),
        content: detail,
        section: detail,
        title: textOf(detail.querySelector('summary')) || 'Details'
      });
    }
    return sections;
  }

  function extractReasoningPanels(element, includeEvidence = false) {
    return findReasoningSections(element).map((item, index) => {
      const content = item.content;
      const allButtons = content ? [...content.querySelectorAll('button')] : [];
      const steps = [...new Set(allButtons
        .map((button) => textOf(button))
        .filter((text) => text && text !== item.title && !REASONING_TOGGLE.test(text))
      )];
      const text = content ? textOf(content) : '';
      const markdown = content ? domToMarkdown(content) : '';
      const durationMatch = item.title.match(/(?:arbetade\s+i|worked\s+for)\s+(.+)$/i);
      const result = {
        index,
        type: item.type,
        title: item.title,
        durationLabel: durationMatch?.[1] || null,
        expanded: item.type === 'details' ? Boolean(item.section?.open) : item.toggle?.getAttribute('aria-expanded') === 'true',
        contentFound: Boolean(content),
        text,
        markdown,
        steps,
        extractionMethod: item.type === 'details' ? 'html-details' : 'aria-expanded-sibling'
      };
      if (includeEvidence) result.html = item.section?.outerHTML || content?.outerHTML || null;
      return result;
    });
  }

  function preferredMessageRoot(element, role) {
    const roleRoot = element.querySelector(`[data-message-author-role="${CSS.escape(role)}"]`) ||
      element.querySelector('[data-message-author-role]');
    if (role === 'assistant') return roleRoot?.querySelector('.markdown') || roleRoot || null;
    if (role === 'user') {
      return roleRoot?.querySelector('[class*="whitespace-pre-wrap"], .markdown') || roleRoot || null;
    }
    return roleRoot || null;
  }

  function cloneWithoutReasoning(element) {
    const clone = element.cloneNode(true);
    for (const section of findReasoningSections(clone)) section.section?.remove();
    for (const node of clone.querySelectorAll('script,style,svg,[aria-hidden="true"],.sr-only')) node.remove();
    return clone;
  }

  function collectLinks(root) {
    const links = [];
    for (const anchor of root?.querySelectorAll?.('a[href]') || []) {
      const text = textOf(anchor) || anchor.getAttribute('aria-label') || '';
      const href = sanitizeUrl(anchor.getAttribute('href'));
      if (!href) continue;
      links.push({ text, href });
    }
    const seen = new Set();
    return links.filter((item) => {
      const key = `${item.text}\n${item.href}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function collectAttachments(element) {
    const output = [];
    const candidates = [...element.querySelectorAll('a,button,[aria-label],img')];
    for (const node of candidates) {
      const label = normalizePlainText(node.getAttribute?.('aria-label') || node.getAttribute?.('alt') || textOf(node));
      const match = label.match(FILE_NAME);
      const src = node.getAttribute?.('href') || node.getAttribute?.('src') || '';
      let decodedSrc = src;
      try { decodedSrc = decodeURIComponent(src); } catch (_) {}
      const srcLeaf = decodedSrc.split(/[/?#]/).filter(Boolean).at(-1) || decodedSrc;
      const srcMatch = srcLeaf.match(FILE_NAME);
      const displayName = (match?.[1] || srcMatch?.[1] || '').trim() || null;
      if (!displayName) continue;
      output.push({
        displayName,
        kind: node.tagName?.toLowerCase() === 'img' ? 'image' : 'file-reference',
        renderedRepresentationCaptured: true,
        fileContentCaptured: false,
        url: src ? sanitizeUrl(src) : null,
        ariaLabel: node.getAttribute?.('aria-label') || null,
        alt: node.getAttribute?.('alt') || null
      });
    }
    const merged = new Map();
    for (const item of output) {
      const key = item.displayName.toLocaleLowerCase();
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
    const preferred = preferredMessageRoot(element, role);
    const fallback = preferred || cloneWithoutReasoning(element);
    const finalText = textOf(fallback);
    const finalMarkdown = domToMarkdown(fallback) || finalText;
    const reasoning = role === 'assistant' ? extractReasoningPanels(element, includeEvidence) : [];
    const stableKey = messageId || dataTestId || turnId || `${role}-${fnv1a(`${finalText}\n${reasoning.map((item) => item.text).join('\n')}`)}`;
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
      reasoning,
      links: collectLinks(preferred || element),
      attachments: collectAttachments(element),
      pageUrl: location.href,
      evidenceIncluded: includeEvidence
    };

    if (includeEvidence) {
      const rect = element.getBoundingClientRect();
      result.browserVisibleText = textOf(element);
      result.textContent = element.textContent || '';
      result.html = element.outerHTML;
      result.finalHtml = preferred?.outerHTML || null;
      result.geometry = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    }
    return result;
  }

  globalThis.CgscCaptureCore = {
    REASONING_TOGGLE,
    fnv1a,
    attributesToObject,
    normalizePlainText,
    sanitizeUrl,
    domToMarkdown,
    findReasoningSections,
    extractReasoningPanels,
    collectLinks,
    collectAttachments,
    getRole,
    extractTurn
  };
})();
