'use strict';

/* Unit tests for renderer/markdown.js (no DOM needed; dual export tail makes it requireable). */

const test = require('node:test');
const assert = require('node:assert/strict');

const { mdToHtml, escapeHtml, linkify } = require('../renderer/markdown');

/* ---- escapeHtml ---- */

test('escapeHtml escapes < > & " \'', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(escapeHtml('a<b> & "c" \'d\''), 'a&lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;');
});

/* ---- linkify ---- */

test('linkify turns bare urls into anchors and escapes the rest', () => {
  const out = linkify('see https://example.com/a?b=1&c=2 done');
  assert.ok(out.startsWith('see '));
  assert.ok(out.includes('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noreferrer">'));
  assert.ok(out.endsWith(' done'));
});

test('linkify does not swallow trailing ascii punctuation (, . ; : ! ?)', () => {
  for (const punct of [',', '.', ';', ':', '!', '?']) {
    const out = linkify(`go https://example.com/page${punct} next`);
    assert.ok(
      out.includes('<a href="https://example.com/page" target="_blank" rel="noreferrer">https://example.com/page</a>'),
      `anchor should end before "${punct}": ${out}`,
    );
    assert.ok(out.includes(`</a>${punct} next`), `"${punct}" must stay outside the anchor: ${out}`);
  }
  // a run of punctuation is all pushed outside
  const out = linkify('end https://example.com/x...');
  assert.ok(out.includes('</a>...'), out);
});

test('linkify treats CJK full-width punctuation as a url boundary', () => {
  const cases = ['。', '，', '、', '；', '：', '！', '？', '（', '）', '「', '」', '《'];
  for (const ch of cases) {
    const out = linkify(`網址 https://example.com/page${ch}下一句`);
    assert.ok(
      out.includes('<a href="https://example.com/page" target="_blank" rel="noreferrer">https://example.com/page</a>'),
      `url should stop before "${ch}": ${out}`,
    );
    assert.ok(out.includes(`${ch}下一句`), `"${ch}下一句" must stay as plain text: ${out}`);
  }
});

test('linkify keeps ascii parentheses inside the url (Foo_(bar))', () => {
  const out = linkify('read https://zh.wikipedia.org/wiki/Foo_(bar) now');
  assert.ok(
    out.includes('<a href="https://zh.wikipedia.org/wiki/Foo_(bar)" target="_blank" rel="noreferrer">'),
    out,
  );
});

test('linkify handles null/undefined as empty string', () => {
  assert.equal(linkify(null), '');
  assert.equal(linkify(undefined), '');
});

/* ---- code fences ---- */

test('fenced code block keeps content verbatim and records the language', () => {
  const html = mdToHtml('```js\nconst x = 1; // **not bold** <div>\n```\nafter');
  assert.ok(html.includes('<pre class="code" data-lang="js">'), html);
  assert.ok(html.includes('<code>const x = 1; // **not bold** &lt;div&gt;</code>'), html);
  assert.ok(!html.includes('<strong>not bold</strong>'), 'fence content must not be markdown-processed');
  assert.ok(html.includes('data-copy'), 'copy button expected');
  assert.ok(html.includes('<p>after</p>'));
});

test('fence trailing newline is trimmed and unknown fence keeps empty data-lang', () => {
  const html = mdToHtml('```\nline1\n```');
  assert.ok(html.includes('data-lang=""'), html);
  assert.ok(html.includes('<code>line1</code>'), html);
});

/* ---- escaping through mdToHtml ---- */

test('mdToHtml escapes < > & " \' in text', () => {
  const html = mdToHtml(`<script>alert("x & 'y'")</script>`);
  assert.ok(!html.includes('<script>'), html);
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x &amp; &#39;y&#39;&quot;)&lt;/script&gt;'), html);
});

/* ---- GFM tables ---- */

test('table alignment markers map to al-left / al-center / al-right', () => {
  const html = mdToHtml('| Name | Qty | Price | Note |\n| :--- | :---: | ---: | --- |\n| Apple | 3 | $1 | x |');
  assert.ok(html.includes('<th class="al-left">Name</th>'), html);
  assert.ok(html.includes('<th class="al-center">Qty</th>'), html);
  assert.ok(html.includes('<th class="al-right">Price</th>'), html);
  assert.ok(html.includes('<th>Note</th>'), 'plain delimiter must produce no class');
  assert.ok(html.includes('<td class="al-left">Apple</td>'), html);
  assert.ok(html.includes('<td class="al-center">3</td>'), html);
  assert.ok(html.includes('<td class="al-right">$1</td>'), html);
  assert.ok(html.includes('<td>x</td>'), html);
});

test('table with outer pipes and alignment', () => {
  const html = mdToHtml('| a | b |\n| --- | ---: |\n| 1 | 2 |');
  assert.ok(html.includes('<table class="md-table">'), html);
  assert.ok(html.includes('<td class="al-right">2</td>'), html);
});

test('column-count mismatch: short rows padded, extra cells truncated', () => {
  const html = mdToHtml('| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |');
  assert.ok(html.includes('<tr><td>1</td><td></td></tr>'), `missing cell should be padded: ${html}`);
  assert.ok(html.includes('<tr><td>1</td><td>2</td></tr>'), `extra cell should be dropped: ${html}`);
  assert.ok(!html.includes('>3<'), `truncated cell must not appear: ${html}`);
});

test('escaped \\| inside a cell is not a column separator', () => {
  const html = mdToHtml('| a | b |\n| --- | --- |\n| x\\|y | z |');
  assert.ok(html.includes('<td>x|y</td>'), html);
  assert.ok(html.includes('<td>z</td>'), html);
});

test('bold and inline code inside table cells are rendered', () => {
  const html = mdToHtml('| a | b |\n| --- | --- |\n| **bold** | `code` |');
  assert.ok(html.includes('<td><strong>bold</strong></td>'), html);
  assert.ok(html.includes('<td><code class="inline">code</code></td>'), html);
});

test('a paragraph line with a pipe followed by --- is not a table', () => {
  const html = mdToHtml('a | b\n---\nnext');
  assert.ok(!html.includes('<table'), html);
  assert.ok(html.includes('<hr>'), html);
});

/* ---- misc inline markdown (regression anchors for the table pass) ---- */

test('headings, lists, blockquote still render', () => {
  const html = mdToHtml('# Title\n\n- one\n- two\n\n1. first\n\n> quoted **text**');
  assert.ok(html.includes('<h1 class="md-h">Title</h1>'));
  assert.ok(html.includes('<ul>\n<li>one</li>\n<li>two</li>\n</ul>'));
  assert.ok(html.includes('<ol>\n<li>first</li>\n</ol>'));
  assert.ok(html.includes('<blockquote>quoted <strong>text</strong></blockquote>'));
});

test('markdown links keep their href untouched by the bare-url pass', () => {
  const html = mdToHtml('[docs](https://example.com/a) and https://example.com/b');
  assert.ok(html.includes('<a href="https://example.com/a" target="_blank" rel="noreferrer">docs</a>'), html);
  assert.ok(html.includes('<a href="https://example.com/b" target="_blank" rel="noreferrer">https://example.com/b</a>'), html);
});
