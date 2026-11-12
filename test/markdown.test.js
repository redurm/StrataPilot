'use strict';

/*
 * Unit tests for renderer/markdown.js (no DOM needed; the dual export tail makes it requireable).
 *
 * The list of syntax cases is borrowed from the sibling project MarkdownViewer (its `web/check.mjs`):
 * that app renders the full CommonMark set, and its case list is the closest thing to a specification of
 * "what a markdown file actually contains". What differs here is deliberate and pinned below under
 * "deliberately unsupported", because this renderer's job is a chat transcript, not a document.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { mdToHtml, escapeHtml, linkify, fenceFor } = require('../renderer/markdown');

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

test('fenced code block keeps its content verbatim, records the language and offers copy', () => {
  const html = mdToHtml('```js\nconst x = 1; // **not bold** <div>\n```\nafter');
  assert.ok(html.includes('<pre class="code" data-lang="js">'), html);
  assert.ok(html.includes('// **not bold** &lt;div&gt;'), `fence body must survive: ${html}`);
  assert.ok(!html.includes('<strong>not bold</strong>'), 'fence content must not be markdown-processed');
  assert.ok(html.includes('data-copy'), 'copy button expected');
  assert.ok(html.includes('<p>after</p>'));
});

test('fence trailing newline is trimmed and unknown fence keeps empty data-lang', () => {
  const html = mdToHtml('```\nline1\n```');
  assert.ok(html.includes('data-lang=""'), html);
  assert.ok(html.includes('line1'), html);
  assert.ok(!html.includes('```'), `the closing fence belongs to the fence, not the body: ${html}`);
});

test('tilde fences work, and a tilde fence does not close a backtick fence', () => {
  const html = mdToHtml('~~~bash\nls -la\n~~~');
  assert.ok(html.includes('data-lang="bash"'), html);
  assert.ok(html.includes('ls') && html.includes('-la'), html);
  assert.ok(!html.includes('~~~'), `the closing tilde fence must not be part of the body: ${html}`);
  const mixed = mdToHtml('```\n~~~\nstill code\n```');
  assert.ok(mixed.includes('~~~'), `a tilde line inside a backtick fence is code: ${mixed}`);
});

test('a longer fence holds a markdown sample (the CODE0 leak, #44 class bug)', () => {
  const html = mdToHtml('````\n```js\nlet a = 1;\n```\n````');
  assert.ok(!html.includes('CODE'), `the placeholder marker leaked into the text: ${html}`);
  assert.ok(html.includes('```js'), html);
  assert.ok(html.includes('let a = 1;'), html);
});

test('an info string containing a backtick is not a fence', () => {
  const html = mdToHtml('```js `not a fence`\nplain text stays prose');
  assert.ok(!html.includes('<pre class="code"'), html);
  assert.ok(html.includes('<p>'), html);
  assert.ok(html.includes('plain text stays prose'), html);
});

test('an unterminated fence still renders as a code block', () => {
  const html = mdToHtml('```py\nprint(1)');
  assert.ok(html.includes('data-lang="py"'), html);
  assert.ok(html.includes('print'), html);
  assert.ok(html.includes('1'), html);
});

test('a fence inside a blockquote and inside a list item keeps working', () => {
  const quoted = mdToHtml('> ```\n> code in quote\n> ```');
  assert.ok(quoted.includes('<blockquote>'), quoted);
  assert.ok(quoted.includes('code in quote'), quoted);
  assert.equal((quoted.match(/<pre class="code"/g) || []).length, 1, quoted);
  const listed = mdToHtml('- item\n\n  ```\n  listed code\n  ```');
  assert.ok(listed.includes('listed code'), listed);
  assert.ok(listed.includes('<li>'), listed);
});

/* ---- escaping (the reason there is no raw HTML support) ---- */

test('mdToHtml escapes < > & " \' in text', () => {
  const html = mdToHtml(`<script>alert("x & 'y'")</script>`);
  assert.ok(!html.includes('<script>'), html);
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x &amp; &#39;y&#39;&quot;)&lt;/script&gt;'), html);
});

test('a NUL in the source cannot break the placeholder mechanism', () => {
  const html = mdToHtml('a' + String.fromCharCode(0) + 'b ```\nx\n```');
  assert.ok(!html.includes('CODE'), html);
  assert.ok(html.includes('<pre class="code"'), html);
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

test('a table interrupts a paragraph without a blank line', () => {
  const html = mdToHtml('intro text\n| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert.ok(html.includes('<p>intro text</p>'), html);
  assert.ok(html.includes('<table class="md-table">'), html);
});

/* ---- headings, rules, paragraphs ---- */

test('headings, lists, blockquote still render', () => {
  const html = mdToHtml('# Title\n\n- one\n- two\n\n1. first\n\n> quoted **text**');
  assert.ok(html.includes('<h1 class="md-h">Title</h1>'));
  assert.ok(html.includes('<ul>\n<li>one</li>\n<li>two</li>\n</ul>'));
  assert.ok(html.includes('<ol>\n<li>first</li>\n</ol>'));
  assert.ok(html.includes('<blockquote>quoted <strong>text</strong></blockquote>'));
});

test('an empty heading does not emit an empty tag', () => {
  assert.equal(mdToHtml('#\n\ntext'), '<p>text</p>');
});

test('setext h1: "===" under a paragraph is a heading, "---" stays a rule', () => {
  const h1 = mdToHtml('Title\n=====\nbody');
  assert.ok(h1.includes('<h1 class="md-h">Title</h1>'), h1);
  assert.ok(h1.includes('<p>body</p>'), h1);
  const rule = mdToHtml('Some text\n---\nmore');
  assert.ok(rule.includes('<p>Some text</p>'), `--- after a paragraph must not become a heading: ${rule}`);
  assert.ok(rule.includes('<hr>'), rule);
});

test('a single newline inside a paragraph is a line break', () => {
  assert.equal(mdToHtml('line one\nline two'), '<p>line one<br>line two</p>');
});

/* ---- nested lists, task lists ---- */

test('nested lists keep their depth (ul in ul, ol in ul, three levels)', () => {
  const html = mdToHtml('- a\n  - b\n    - c\n- d');
  assert.ok(html.startsWith('<ul>'), html);
  assert.equal((html.match(/<ul>/g) || []).length, 3, html);
  assert.ok(html.includes('<li>a\n<ul>'), html);
  assert.ok(html.includes('<li>d</li>'), html);
  assert.ok(!html.includes('<li>c</li>\n</ul>\n</ul>\n<li>d'), 'closing tags must nest, not stack');
  const mixed = mdToHtml('- a\n  1. b\n- c');
  assert.ok(mixed.includes('<ol>'), mixed);
  assert.equal((mixed.match(/<ul>/g) || []).length, 1, mixed);
});

test('an ordered list keeps its starting number and its kind', () => {
  const html = mdToHtml('3. three\n4. four');
  assert.ok(html.includes('<ol start="3">'), html);
  const switched = mdToHtml('1. one\n\n- bullet');
  assert.ok(switched.includes('<ol>'), switched);
  assert.ok(switched.includes('<ul>'), switched);
});

test('a wrapped list item without a marker stays one item (lazy continuation)', () => {
  const html = mdToHtml('- first line\n  wrapped line');
  assert.equal((html.match(/<li/g) || []).length, 1, html);
  assert.ok(html.includes('first line<br>wrapped line'), html);
});

test('task lists become disabled checkboxes, not literal brackets', () => {
  const html = mdToHtml('- [x] done\n- [ ] todo');
  assert.ok(html.includes('<ul class="md-task-list">'), html);
  assert.ok(html.includes('<li class="task"><input type="checkbox" disabled checked>done</li>'), html);
  assert.ok(html.includes('<li class="task"><input type="checkbox" disabled>todo</li>'), html);
  assert.ok(!html.includes('[x]'), html);
});

test('a loose list keeps its paragraph breaks, a tight one does not', () => {
  const tight = mdToHtml('- a\n- b');
  assert.ok(!tight.includes('<p>'), tight);
  const loose = mdToHtml('- a\n\n- b');
  assert.ok(loose.includes('<li><p>a</p></li>'), loose);
});

/* ---- blockquotes, GitHub alerts ---- */

test('a multi-line blockquote is one blockquote, and nesting nests', () => {
  const one = mdToHtml('> line one\n> line two');
  assert.equal((one.match(/<blockquote>/g) || []).length, 1, one);
  assert.ok(one.includes('line one<br>line two'), one);
  const nested = mdToHtml('> a\n>\n> > b');
  assert.ok((nested.match(/<blockquote>/g) || []).length >= 2, nested);
  const lazy = mdToHtml('> quoted\ncontinued without the marker');
  assert.equal((lazy.match(/<blockquote>/g) || []).length, 1, lazy);
});

test('GitHub alerts become a class-tagged box, and the body is parsed exactly once', () => {
  const html = mdToHtml('> [!WARNING]\n> careful **now**');
  assert.ok(html.includes('<div class="md-alert md-alert-warning">'), html);
  assert.ok(html.includes('<p class="md-alert-title">Warning</p>'), html);
  assert.ok(html.includes('careful <strong>now</strong>'), html);
  assert.equal(html.split('careful').length - 1, 1, `alert body parsed twice: ${html}`);
  for (const kind of ['note', 'tip', 'important', 'caution']) {
    const one = mdToHtml(`> [!${kind.toUpperCase()}]\nbody`);
    assert.ok(one.includes(`md-alert-${kind}`), one);
  }
});

/* ---- indented code ---- */

test('four-space indented text becomes a code block, but not inside a paragraph', () => {
  const code = mdToHtml('para\n\n    indented code\n    two lines');
  assert.ok(code.includes('data-lang="indented"'), code);
  assert.ok(code.includes('indented code\ntwo lines'), code);
  const paragraph = mdToHtml('para\n    still the same paragraph');
  assert.ok(!paragraph.includes('<pre'), paragraph);
  assert.ok(paragraph.includes('para<br>    still the same paragraph'), paragraph);
});

test('a list marker indented four spaces with no open list is code', () => {
  const html = mdToHtml('prose\n\n    - marker as code');
  assert.ok(html.includes('data-lang="indented"'), html);
  assert.ok(html.includes('- marker as code'), html);
  assert.ok(!html.includes('<ul>'), html);
});

/* ---- links, images, autolinks ---- */

test('markdown links keep their href untouched by the bare-url pass', () => {
  const html = mdToHtml('[docs](https://example.com/a) and https://example.com/b');
  assert.ok(html.includes('<a href="https://example.com/a" target="_blank" rel="noreferrer">docs</a>'), html);
  assert.ok(html.includes('<a href="https://example.com/b" target="_blank" rel="noreferrer">https://example.com/b</a>'), html);
});

test('a link label may contain code and emphasis', () => {
  const html = mdToHtml('[**bold** and `code`](https://example.com/a)');
  assert.ok(html.includes('<a href="https://example.com/a" target="_blank" rel="noreferrer"><strong>bold</strong> and <code class="inline">code</code></a>'), html);
});

test('parentheses and a title inside the target of an inline link', () => {
  const parens = mdToHtml('[wiki](https://example.com/wiki/Foo_(bar))');
  assert.ok(parens.includes('href="https://example.com/wiki/Foo_(bar)"'), parens);
  const titled = mdToHtml('[x](https://example.com/a "the title")');
  assert.ok(titled.includes('href="https://example.com/a"'), titled);
  assert.ok(!titled.includes('the title&quot;'), `the title must not stay in the href: ${titled}`);
});

test('reference links resolve, and the definition line does not render', () => {
  const html = mdToHtml('see [foo][1] and [1][] and [1] here\n\n[1]: https://example.com/x');
  assert.ok(html.includes('<a href="https://example.com/x" target="_blank" rel="noreferrer">foo</a>'), html);
  assert.ok(html.includes('<a href="https://example.com/x" target="_blank" rel="noreferrer">1</a>'), html);
  assert.ok(!html.includes('<p>[1]'), `definition line leaked: ${html}`);
  assert.equal((html.match(/<a /g) || []).length, 3, `each form once: ${html}`);
});

test('a collapsed reference to an undefined label stays visible as written', () => {
  const html = mdToHtml('[bar][]');
  assert.ok(html.includes('[bar][]'), html);
});

test('an unresolved reference stays visible as written', () => {
  const html = mdToHtml('[text][nope]');
  assert.ok(html.includes('[text][nope]'), html);
  assert.ok(!html.includes('<a'), html);
});

test('a reference definition inside a code sample is not collected', () => {
  const html = mdToHtml('```\n[1]: https://example.com\n```');
  assert.ok(html.includes('[1]: https://example.com'), html);
  assert.ok(!html.includes('<a href="https://example.com"'), html);
});

test('javascript: and other non-http targets are text, never a link', () => {
  const html = mdToHtml('[click](javascript:alert(1)) and [mail](data:text/html,x)');
  assert.ok(!html.includes('<a href="javascript:'), html);
  assert.ok(!html.includes('<a href="data:'), html);
  assert.ok(html.includes('md-broken-link'), html);
});

test('an image reference is a chip that links out (CSP blocks remote img)', () => {
  const html = mdToHtml('![the alt text](https://example.com/a.png)');
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes('<span class="md-img">'), html);
  assert.ok(html.includes('<a href="https://example.com/a.png" target="_blank" rel="noreferrer">the alt text</a>'), html);
});

test('an autolink in angle brackets becomes one anchor', () => {
  const html = mdToHtml('<https://example.com/a>');
  assert.equal((html.match(/<a /g) || []).length, 1, html);
  assert.ok(html.includes('>https://example.com/a</a>'), html);
});

test('inline code protects emphasis inside it', () => {
  const html = mdToHtml('run `a **b** c` now');
  assert.ok(html.includes('<code class="inline">a **b** c</code>'), html);
  assert.ok(!html.includes('<strong>b</strong>'), html);
});

/* ---- deliberately unsupported: pinned so the deviation stays a decision, not an accident ---- */

test('raw HTML, footnotes, math and ==mark== stay visible text (chat renderer, not a document)', () => {
  const html = mdToHtml('<div align="center">hi</div>\n\n[^1]: note\n\n$$x^2$$\n\n==marked==');
  assert.ok(html.includes('&lt;div align=&quot;center&quot;&gt;hi&lt;/div&gt;'), html);
  assert.ok(html.includes('$$x^2$$'), html);
  assert.ok(html.includes('==marked=='), html);
  assert.ok(!html.includes('<sup>'), html);
  assert.ok(!html.includes('<mark>'), html);
});

test('a CJK answer renders as CJK (nothing in the block pass splits on it)', () => {
  const html = mdToHtml('## 標題\n\n- 第一項\n  - 巢狀\n\n> 引文 **重要**');
  assert.ok(html.includes('<h2 class="md-h">標題</h2>'), html);
  assert.ok(html.includes('<li>第一項\n<ul>'), html);
  assert.ok(html.includes('<blockquote>引文 <strong>重要</strong></blockquote>'), html);
});

/* ---- the fence the Markdown Viewer handoff rebuilds ---- */

test('a fence handed to the viewer is longer than anything it has to hold', () => {
  // CommonMark only closes a fence with a run at least as long as the one that opened it, so wrapping a
  // copied block in three backticks ends the block early when the copy itself is a fenced block
  assert.equal(fenceFor('plain text'), '```');
  assert.equal(fenceFor('a `b` c'), '```');
  assert.equal(fenceFor('```js\nlet a = 1;\n```'), '````');
  assert.equal(fenceFor('````x`````'), '`'.repeat(6), 'a run of five needs a fence of six');
  assert.equal(fenceFor(null), '```');

  // the round trip is what matters: this renderer must read the wrapper back as ONE block, because the
  // same text is what the external viewer is handed
  const inner = '```js\nlet a = 1;\n```';
  const fence = fenceFor(inner);
  const html = mdToHtml(`[title](x)\n\n${fence}markdown\n${inner}\n${fence}\n\ntail`);
  assert.equal((html.match(/<pre class="code"/g) || []).length, 1, html);
  assert.ok(html.includes('<code>```js\nlet a = 1;\n```</code>'), html);
  assert.ok(html.includes('<p>tail</p>'), 'the text after the block must not be swallowed by it: ' + html);
});

test('a relative or non-http target is shown as a dead link, not made clickable', () => {
  // a chat answer has no base URL, so docs/readme.md resolves to nothing here; and javascript:, file:
  // or data: targets would hand the click straight to the shell, which is exactly what this must not do
  for (const source of ['[title](x)', '[title](docs/readme.md)', '[a](javascript:alert(1))', '[b](file:///C:/x)', '[c](data:text/html,x)']) {
    const html = mdToHtml(source);
    assert.ok(!html.includes('<a href'), `made clickable: ${source} -> ${html}`);
    assert.ok(html.includes('md-broken-link'), `the target vanished without a trace: ${source} -> ${html}`);
  }
});
