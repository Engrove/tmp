'use strict';

// DOM-level tests of lib/capture-core.js in real Chromium (innerText and
// computed white-space need a rendering engine; jsdom implements neither).
// Usage: node tests/browser/capture-core.cjs [extension-dir]

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const extensionDir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const coreSource = fs.readFileSync(path.join(extensionDir, 'lib', 'capture-core.js'), 'utf8');
const results = [];

// ChatGPT styles user messages with Tailwind's .whitespace-pre-wrap; the
// fixture page defines the same rule because innerText depends on it.
async function withPage(html, fn) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><style>.whitespace-pre-wrap{white-space:pre-wrap}</style></head><body>${html}</body></html>` }));
    await page.goto('https://chatgpt.com/c/11111111-2222-3333-4444-555555555555');
    await page.addScriptTag({ content: coreSource });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function run(name, html, fn) {
  try {
    await withPage(html, fn);
    results.push({ name, pass: true });
  } catch (error) {
    results.push({ name, pass: false, detail: error.message });
  }
}

(async () => {
  await run('reasoning labels: English and Swedish forms, no false prefixes', '', async (page) => {
    const out = await page.evaluate(() => {
      const labels = ['Thought for 12s', 'Thinking', 'Reasoned for 8 seconds', 'Worked for 2m', 'Analyzed', 'Analyzing', 'Tänkte i 12 s', 'Tänker', 'Resonerade i 3 s', 'Arbetade i 2 min', 'Analyserade', 'Analyserar',
        'Thoughtful idea', 'Analysts', 'Sources', 'Model menu', 'Tankesmedja'];
      return Object.fromEntries(labels.map((label) => [label, CgscCaptureCore.REASONING_TOGGLE.test(label)]));
    });
    for (const label of ['Thought for 12s', 'Thinking', 'Reasoned for 8 seconds', 'Worked for 2m', 'Analyzed', 'Analyzing', 'Tänkte i 12 s', 'Tänker', 'Resonerade i 3 s', 'Arbetade i 2 min', 'Analyserade', 'Analyserar']) {
      assert.equal(out[label], true, label);
    }
    for (const label of ['Thoughtful idea', 'Analysts', 'Sources', 'Model menu', 'Tankesmedja']) assert.equal(out[label], false, label);
  });

  await run('markdown: inline code with backticks, ordered list start, code in list item, blockquote',
    `<div id="r" class="markdown"><p>Use <code>a\`b</code> and <strong>bold</strong> text.</p>
     <ol start="3"><li>three</li><li>four<pre><code class="language-c">int main(void) {
    return 0;
}</code></pre></li></ol><blockquote><p>quoted</p></blockquote></div>`,
    async (page) => {
      const md = await page.evaluate(() => CgscCaptureCore.domToMarkdown(document.getElementById('r')));
      assert.match(md, /Use ``a`b`` and \*\*bold\*\* text\./);
      assert.match(md, /^3\. three$/m);
      assert.match(md, /^4\. four/m);
      assert.ok(md.includes('```c\nint main(void) {\n    return 0;\n}\n```'), md);
      assert.match(md, /^> quoted$/m);
    });

  await run('collapsed reasoning panel never captures the answer as reasoning content',
    `<article data-testid="conversation-turn-2" data-turn="assistant"><div data-message-author-role="assistant" data-message-id="m2">
      <div><button aria-expanded="false">Thought for 4s</button></div>
      <div class="markdown"><p>The real answer.</p></div></div></article>`,
    async (page) => {
      const turn = await page.evaluate(() => CgscCaptureCore.extractTurn(document.querySelector('article')));
      assert.equal(turn.reasoning.length, 1);
      assert.equal(turn.reasoning[0].contentFound, false);
      assert.equal(turn.reasoning[0].text, '');
      assert.equal(turn.finalMarkdown, 'The real answer.');
    });

  await run('expanded panel whose content is the last block is rejected; aria-controls content is accepted',
    `<article data-testid="conversation-turn-2" data-turn="assistant"><div data-message-author-role="assistant" data-message-id="m2">
      <div><button aria-expanded="true">Thinking</button></div>
      <div class="markdown"><p>Answer only.</p></div></div></article>
     <article data-testid="conversation-turn-4" data-turn="assistant"><div data-message-author-role="assistant" data-message-id="m4">
      <button aria-expanded="true" aria-controls="panel-4">Thought for 9s</button>
      <div class="markdown"><p>Answer four.</p></div>
      <div id="panel-4"><p>Controlled reasoning.</p></div></div></article>`,
    async (page) => {
      const [two, four] = await page.evaluate(() => [...document.querySelectorAll('article')].map((el) => CgscCaptureCore.extractTurn(el)));
      assert.equal(two.reasoning[0].contentFound, false);
      assert.equal(two.finalMarkdown, 'Answer only.');
      assert.equal(four.reasoning[0].contentFound, true);
      assert.equal(four.reasoning[0].text, 'Controlled reasoning.');
      assert.equal(four.reasoning[0].extractionMethod, 'aria-controls');
      assert.equal(four.finalMarkdown, 'Answer four.');
    });

  await run('details inside an answer stays answer content',
    `<article data-testid="conversation-turn-2" data-turn="assistant"><div data-message-author-role="assistant" data-message-id="m2">
      <div class="markdown"><p>Intro.</p><details><summary>More</summary><p>Hidden part.</p></details></div></div></article>`,
    async (page) => {
      const turn = await page.evaluate(() => CgscCaptureCore.extractTurn(document.querySelector('article')));
      assert.equal(turn.reasoning.length, 0);
      assert.match(turn.finalMarkdown, /\*\*More\*\*/);
      assert.match(turn.finalMarkdown, /Hidden part\./);
    });

  await run('user text: tabs, indentation, trailing blank lines and NBSP preserved verbatim except line endings',
    `<article data-testid="conversation-turn-1" data-turn="user"><div data-message-author-role="user" data-message-id="m1">
      <div class="whitespace-pre-wrap" id="u"></div></div></article>`,
    async (page) => {
      const turn = await page.evaluate(() => {
        document.getElementById('u').textContent = '\tif x:\r\n\t\treturn\u00a01\n\n\n  end  ';
        return CgscCaptureCore.extractTurn(document.querySelector('article'));
      });
      assert.equal(turn.finalText, '\tif x:\n\t\treturn\u00a01\n\n\n  end');
      assert.ok(turn.finalMarkdown.includes('\tif x:'), JSON.stringify(turn.finalMarkdown));
      assert.ok(turn.finalMarkdown.includes('\t\treturn\u00a01\n\n\n  end'), JSON.stringify(turn.finalMarkdown));
    });

  await run('attachments: icon-sized images ignored, large images kept, sensitive URL parameters redacted',
    `<article data-testid="conversation-turn-1" data-turn="user"><div data-message-author-role="user" data-message-id="m1">
      <img src="https://cdn.example/icon" width="16" height="16" alt="">
      <img src="https://files.example/file-1?sig=S&amp;se=1" width="300" height="200" alt="Uploaded image">
      <img src="https://files.example/file-2?sig=T" width="300" height="200" alt="Uploaded image">
      <div class="whitespace-pre-wrap">two images</div></div></article>`,
    async (page) => {
      const turn = await page.evaluate(() => CgscCaptureCore.extractTurn(document.querySelector('article')));
      const images = turn.attachments.filter((item) => item.kind === 'image');
      assert.equal(images.length, 2);
      assert.ok(images.every((item) => /sig=REDACTED/.test(item.url)));
      assert.ok(images.every((item) => item.fileContentCaptured === false));
    });

  await run('links: absolute URLs unchanged, relative URLs resolved, signed URLs redacted',
    `<div id="r" class="markdown"><p><a href="https://Example.com/A?b=1">a</a> <a href="/backend/x">b</a> <a href="https://x.example/f?token=abc">c</a></p></div>`,
    async (page) => {
      const md = await page.evaluate(() => CgscCaptureCore.domToMarkdown(document.getElementById('r')));
      assert.match(md, /\[a\]\(https:\/\/Example\.com\/A\?b=1\)/);
      assert.match(md, /\[b\]\(https:\/\/chatgpt\.com\/backend\/x\)/);
      assert.match(md, /\[c\]\(https:\/\/x\.example\/f\?token=REDACTED\)/);
    });

  await run('conversation id parsing', '', async (page) => {
    const ids = await page.evaluate(() => [
      'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555',
      'https://chatgpt.com/g/g-p-abc/c/68a0b1c2-0000-1111-2222-333344445555?model=x',
      'https://chatgpt.com/',
      'https://chatgpt.com/gpts'
    ].map(CgscCaptureCore.conversationIdFromUrl));
    assert.deepEqual(ids, ['11111111-2222-3333-4444-555555555555', '68a0b1c2-0000-1111-2222-333344445555', null, null]);
  });

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}${result.pass ? '' : `\n      ${result.detail}`}`);
  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} capture-core DOM tests passed.`);
  process.exit(failed ? 1 : 0);
})();
