'use strict';

// Deterministic mock of a ChatGPT conversation page, used only by the
// browser tests. It reproduces the structural properties the extension
// depends on, not ChatGPT's exact markup:
//   - article[data-testid="conversation-turn-N"] turns with data-message-author-role roots;
//   - a dedicated scroll container inside <main>;
//   - windowed (virtualized) rendering with keyed node reuse;
//   - lazy loading of older turns when the container is scrolled to the top;
//   - reasoning toggles (button[aria-expanded]) whose state is lost on unmount;
//   - code blocks with a language header and a "Copy code" button inside <pre>;
//   - user text with significant indentation and blank lines;
//   - a turn with two assistant message roots;
//   - an uploaded image without a file-name extension and a file chip;
//   - a periodic fetch of /api/auth/session that returns a bearer token.

const PYTHON_USER_TEXT = [
  'Fix this function:',
  'def f(x):',
  '    if x:',
  '        return 1',
  '',
  '',
  '    return 2'
].join('\n');

const PYTHON_CODE_BLOCK = [
  'def g(items):',
  '    total = 0',
  '    for item in items:',
  '        total += item',
  '',
  '',
  '    return total'
].join('\n');

const FAKE_ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjZ3NjLXRlc3QifQ.c2lnbmF0dXJlLWNnc2MtdGVzdA';

function buildTurns(count) {
  const turns = [];
  for (let index = 1; index <= count; index += 1) {
    const role = index % 2 === 1 ? 'user' : 'assistant';
    const turn = { index, role, messageId: `msg-${String(index).padStart(4, '0')}` };
    if (role === 'user') {
      turn.text = `User message ${index}`;
    } else {
      turn.answerHtml = `<p>Assistant answer ${index}.</p>`;
      if (index % 4 === 0) turn.reasoning = { label: `Thought for ${index}s`, html: `<p>Reasoning summary for turn ${index}.</p>`, markdownClass: false };
    }
    turns.push(turn);
  }

  // Turn 1: indented Python in the user's own message.
  turns[0].text = PYTHON_USER_TEXT;

  // Turn 2: reasoning panel rendered with the same .markdown class as the
  // answer and placed before it in document order.
  turns[1].reasoning = {
    label: 'Thought for 12s',
    html: '<h3>Checking the indentation</h3><p>Reasoning summary for turn 2.</p><button>Read file</button>',
    markdownClass: true
  };
  turns[1].answerHtml = '<p>Answer for turn 2.</p>';

  // Turn 5: URL with trailing punctuation typed by the user.
  turns[4].text = 'See https://example.com. for details.';

  // Turn 6: code block with header and copy button inside <pre>, a table
  // with a multi-line cell and a link with ordinary query parameters.
  turns[5].answerHtml = [
    '<p>Answer for turn 6.</p>',
    '<pre><div class="code-wrap"><div class="code-header">python<button aria-label="Copy">Copy code</button></div>',
    `<div class="code-body"><code class="hljs language-python">${escapeHtml(PYTHON_CODE_BLOCK)}</code></div></div></pre>`,
    '<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody><tr><td>a</td><td>line one<br>line two</td></tr></tbody></table>',
    '<p>Link: <a href="https://example.com/doc?id=5&amp;page=2">doc</a></p>'
  ].join('');

  // Turn 3: user turn with an uploaded image (no extension) and a file chip.
  turns[2].attachmentsHtml = [
    '<div class="attachments">',
    '<img src="https://files.oaiusercontent.com/file-AbC123?se=2026-01-01&amp;sig=SECRETSIG" alt="Uploaded image" width="200" height="120">',
    '<div class="file-chip" aria-label="report.pdf"><span>report.pdf</span><span>PDF</span></div>',
    '</div>'
  ].join('');
  turns[2].text = 'Here is the image and the report.';

  // Turn 4: two assistant message roots inside one turn.
  turns[3].multiMessage = [
    '<div class="markdown prose"><p>Part A of turn 4.</p></div>',
    '<div class="markdown prose"><p>Part B of turn 4.</p></div>'
  ];
  delete turns[3].reasoning;

  return turns;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function buildMockHtml(config = {}) {
  const settings = {
    turnCount: 40,
    initiallyLoaded: 20,
    loadBatch: 10,
    loadDelayMs: 300,
    turnHeight: 320,
    sessionPollMs: 1000,
    ...config
  };
  const turns = buildTurns(settings.turnCount);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mock conversation - CGSC test</title>
<style>
html,body{margin:0;height:100%;font:14px system-ui,sans-serif}
#root{display:flex;height:100%}
nav{width:180px;overflow-y:auto;border-right:1px solid #ccc}
nav .item{height:40px}
main{flex:1;display:flex;flex-direction:column;min-width:0}
#scroller{flex:1;overflow-y:auto}
article{box-sizing:border-box;height:${settings.turnHeight}px;overflow:hidden;padding:6px;border-bottom:1px solid #ddd}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.whitespace-pre-wrap{white-space:pre-wrap}
pre code{white-space:pre}
</style></head>
<body><div id="root"><nav>${Array.from({ length: 30 }, (_, i) => `<div class="item">Chat ${i}</div>`).join('')}</nav>
<main><div id="scroller"><div id="top-spacer"></div><div id="thread"></div><div id="bottom-spacer"></div></div>
<div id="composer"><button aria-expanded="false" aria-haspopup="menu">Model menu</button></div></main></div>
<script>
(() => {
  const SETTINGS = ${JSON.stringify(settings)};
  const TURNS = ${JSON.stringify(turns)};
  const H = SETTINGS.turnHeight;
  const scroller = document.getElementById('scroller');
  const thread = document.getElementById('thread');
  const topSpacer = document.getElementById('top-spacer');
  const bottomSpacer = document.getElementById('bottom-spacer');
  let loadedFrom = Math.max(0, TURNS.length - SETTINGS.initiallyLoaded);
  let loading = false;
  const mounted = new Map();
  window.__mockStats = { mounts: 0, unmounts: 0, loads: 0 };

  function reasoningBlock(turn) {
    const wrap = document.createElement('div');
    wrap.className = 'reasoning-wrap';
    const button = document.createElement('button');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span>' + turn.reasoning.label + '</span>';
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      if (open) {
        button.setAttribute('aria-expanded', 'false');
        wrap.querySelector('.reasoning-content')?.remove();
      } else {
        button.setAttribute('aria-expanded', 'true');
        const content = document.createElement('div');
        content.className = 'reasoning-content' + (turn.reasoning.markdownClass ? ' markdown prose' : '');
        content.innerHTML = turn.reasoning.html;
        wrap.append(content);
      }
    });
    wrap.append(button);
    return wrap;
  }

  function buildTurn(turn) {
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'conversation-turn-' + turn.index);
    article.setAttribute('data-turn', turn.role);
    article.setAttribute('data-turn-id', 'turn-id-' + turn.index);
    const heading = document.createElement('h5');
    heading.className = 'sr-only';
    heading.textContent = turn.role === 'user' ? 'You said:' : 'ChatGPT said:';
    article.append(heading);
    if (turn.role === 'user') {
      const root = document.createElement('div');
      root.setAttribute('data-message-author-role', 'user');
      root.setAttribute('data-message-id', turn.messageId);
      if (turn.attachmentsHtml) root.insertAdjacentHTML('beforeend', turn.attachmentsHtml);
      const text = document.createElement('div');
      text.className = 'whitespace-pre-wrap';
      text.textContent = turn.text;
      root.append(text);
      article.append(root);
      return article;
    }
    const roots = turn.multiMessage || [null];
    roots.forEach((html, messageIndex) => {
      const root = document.createElement('div');
      root.setAttribute('data-message-author-role', 'assistant');
      root.setAttribute('data-message-id', turn.messageId + (messageIndex ? '-' + messageIndex : ''));
      root.setAttribute('data-message-model-slug', 'mock-model');
      const column = document.createElement('div');
      column.className = 'flex flex-col';
      if (turn.reasoning && messageIndex === 0) column.append(reasoningBlock(turn));
      if (html) {
        column.insertAdjacentHTML('beforeend', html);
      } else {
        const answer = document.createElement('div');
        answer.className = 'markdown prose';
        answer.innerHTML = turn.answerHtml;
        column.append(answer);
      }
      root.append(column);
      article.append(root);
    });
    return article;
  }

  function render() {
    const loaded = TURNS.slice(loadedFrom);
    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight;
    const buffer = scroller.clientHeight;
    const first = Math.max(0, Math.floor((viewTop - buffer) / H));
    const last = Math.min(loaded.length - 1, Math.floor((viewBottom + buffer) / H));
    topSpacer.style.height = (first * H) + 'px';
    bottomSpacer.style.height = (Math.max(0, loaded.length - 1 - last) * H) + 'px';
    const wanted = new Set();
    for (let i = first; i <= last; i += 1) wanted.add(loaded[i].index);
    for (const [index, node] of mounted) {
      if (!wanted.has(index)) { node.remove(); mounted.delete(index); window.__mockStats.unmounts += 1; }
    }
    let previous = null;
    for (let i = first; i <= last; i += 1) {
      const turn = loaded[i];
      let node = mounted.get(turn.index);
      if (!node) { node = buildTurn(turn); mounted.set(turn.index, node); window.__mockStats.mounts += 1; }
      if (previous) { if (previous.nextSibling !== node) previous.after(node); }
      else if (thread.firstChild !== node) thread.prepend(node);
      previous = node;
    }
  }

  function maybeLoadOlder() {
    if (loading || loadedFrom === 0 || scroller.scrollTop > 10) return;
    loading = true;
    setTimeout(() => {
      const added = Math.min(SETTINGS.loadBatch, loadedFrom);
      loadedFrom -= added;
      window.__mockStats.loads += 1;
      render();
      scroller.scrollTop += added * H;
      render();
      loading = false;
    }, SETTINGS.loadDelayMs);
  }

  scroller.addEventListener('scroll', () => { render(); maybeLoadOlder(); });
  window.addEventListener('resize', render);
  render();
  scroller.scrollTop = scroller.scrollHeight;
  render();

  if (SETTINGS.sessionPollMs > 0) {
    setInterval(() => { fetch('/api/auth/session').then((r) => r.text()).catch(() => {}); }, SETTINGS.sessionPollMs);
  }
})();
</script></body></html>`;
}

const SESSION_JSON = JSON.stringify({
  user: { id: 'user-test', name: 'Test User', email: 'test@example.invalid' },
  expires: '2099-01-01T00:00:00.000Z',
  accessToken: FAKE_ACCESS_TOKEN
});

module.exports = {
  buildMockHtml,
  buildTurns,
  PYTHON_USER_TEXT,
  PYTHON_CODE_BLOCK,
  FAKE_ACCESS_TOKEN,
  SESSION_JSON
};
