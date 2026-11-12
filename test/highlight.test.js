'use strict';

/*
 * The dependency-free highlighter (renderer/highlight.js).
 *
 * Order matters here: the first test is about safety, the rest about colour. A highlighter that colours
 * a code block but lets a fragment of it become markup would be a vulnerability dressed as cosmetics,
 * so the escaping guarantee is pinned before any language case.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { highlightCode, languageOf } = require('../renderer/highlight.js');
const { mdToHtml, codeHtml, escapeHtml } = require('../renderer/markdown.js');

test('index.html loads highlight.js before markdown.js (the browser has no require to fall back on)', () => {
  // markdown.js prefers window.hlHighlight and only reaches for require() in the tests; loaded the other
  // way round, every code block would come out uncoloured and nothing would throw
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const at = (name) => html.indexOf(`<script src="${name}"></script>`);
  assert.ok(at('highlight.js') >= 0 && at('markdown.js') >= 0, 'both scripts must be listed in index.html');
  assert.ok(at('highlight.js') < at('markdown.js'), 'highlight.js must load first');
});

const SPAN = /<span class="hl-[a-z]+">|<\/span>/g;
const unspanned = (html) => html.replace(SPAN, '');

/* ---- the guarantee that comes first ---- */

test('a code block can never become markup, however the language is spelled', () => {
  for (const lang of ['js', 'html', 'xml', 'markdown', 'diff', 'mermaid', 'madeup', '']) {
    for (const attack of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=x>']) {
      const out = highlightCode(attack, lang);
      // the strongest way to say it: colour may wrap tokens, it may never change a single character
      assert.equal(unspanned(out), escapeHtml(attack), `[${lang}] colouring changed the code: ${out}`);
      assert.ok(!unspanned(out).includes('<'), `a raw angle bracket survived [${lang}]: ${out}`);
      assert.ok(out.includes('&lt;'), 'the reader must still see the angle brackets');
    }
  }
});

test('colouring loses no characters: strip the spans and the code is exactly what was written', () => {
  const samples = [
    ['js', 'const re = /a"\'b/g; // 中文 "quote"\nclass A extends B { #x = 1; }'],
    ['py', 'def f(x):  # 註解\n    return f"{x}" + """block"""'],
    ['bash', 'ls -la "$DIR" | grep -E "\\d+" # $HOME'],
    ['diff', '+++ b/file.c\n-const int x = 1;\n+const int x = 2;'],
    ['xml', '<a href="x">é & </a>'],
    ['sql', 'SELECT * FROM t WHERE name = \'a\' -- done'],
    ['yaml', 'key: "v"  # comment\n- item'],
    ['madeup', 'plain 漢字 <>&"\''],
  ];
  for (const [lang, code] of samples) {
    assert.equal(unspanned(highlightCode(code, lang)), escapeHtml(code), `[${lang}] ${code}`);
  }
});

test('highlighting is pure: the same input colours the same way twice (no state between blocks)', () => {
  // the transcript renders a block, then re-renders it on every re-render of the message; a highlighter
  // holding state between calls would make the second copy differ from the first
  const code = 'let a = "open\n};\nlet b = 1;';
  assert.equal(highlightCode(code, 'js'), highlightCode(code, 'js'));
  highlightCode('/* unclosed block comment', 'css');
  assert.equal(highlightCode('body { }', 'css'), highlightCode('body { }', 'css'));
});

/* ---- the rules that decide what a token is ---- */

test('a comment wins over the quotes inside it', () => {
  const out = highlightCode('// "not a string" // again', 'js');
  assert.equal((out.match(/hl-str/g) || []).length, 0, out);
  assert.equal((out.match(/class="hl-com"/g) || []).length, 1, out);
  assert.match(out, /&quot;not a string&quot;/, 'the comment text must stay readable');
});

test('a string that is never closed stops at the line end, so the next line is still code', () => {
  // models open a quote and run out of answer; a regex greedy to the end of the block would print the
  // rest of the file in string colour and hide the real mistake
  const out = highlightCode('let a = "one\ntwo = 3;', 'js');
  const strings = out.match(/<span class="hl-str">[\s\S]*?<\/span>/g) || [];
  assert.ok(strings.length >= 1, out);
  for (const token of strings) assert.ok(!token.includes('\n'), `a string token crossed a line: ${token}`);
  assert.match(out.split('\n')[1], /<span class="hl-num">3<\/span>/, 'the line after the broken quote must still read as code');
});

test('keywords and numbers do not fire inside an identifier', () => {
  const out = highlightCode('keywords key _key key1 0x1f 1_000 null', 'js');
  assert.equal(unspanned(out), escapeHtml('keywords key _key key1 0x1f 1_000 null'));
  assert.ok(!out.includes('hl-kw">key') && !out.includes('hl-kw">keywords'), `"key" was coloured inside a longer word: ${out}`);
  assert.match(out, /<span class="hl-num">0x1f<\/span>/, 'hex should colour');
  assert.match(out, /<span class="hl-num">1_000<\/span>/, 'a digit separator is part of the number');
  assert.match(out, /<span class="hl-kw">null<\/span>/);
});

test('diff colours a line start, never an operator in the middle of a line', () => {
  const out = highlightCode('+added\n-removed\n++ header\na + b\n--- old\n@@ -1 +1 @@', 'diff');
  assert.equal((out.match(/class="hl-add"/g) || []).length, 2, out);
  assert.equal((out.match(/class="hl-remove"/g) || []).length, 2, out);
  assert.ok(out.includes('\na + b\n'), `a mid-line plus was coloured: ${out}`);
  assert.match(out, /<span class="hl-meta">@@[^<]*<\/span>/, 'the hunk marker is the one line that is neither + nor -');
});

test('a tag and its attributes are recognisable in html', () => {
  const out = highlightCode('<div class="a">x</div>', 'html');
  assert.match(out, /<span class="hl-tag">&lt;div<\/span>/);
  assert.match(out, /<span class="hl-attr">class<\/span>/);
  assert.match(out, /<span class="hl-str">&quot;a&quot;<\/span>/);
});

/* ---- what it deliberately does not do ---- */

test('an unknown or plain language escapes and colours nothing (a new language costs a rule set, not a fix)', () => {
  for (const lang of ['madeup', 'text', 'txt', '', null, 'plaintext']) {
    const out = highlightCode('let a = "b"; // c', lang);
    assert.equal(out, escapeHtml('let a = "b"; // c'), `[${lang}] ${out}`);
  }
  // markdown and docbook are marked-up prose: colouring their punctuation would fight the transcript's
  // own rendering, so they are on the plain list instead of being half-highlighted
  assert.equal(languageOf('markdown'), null);
  assert.equal(highlightCode('# title\n- item **b**', 'md'), escapeHtml('# title\n- item **b**'));
});

test('the fence info string is matched loosely, the way models actually write it', () => {
  // ```js, ```JavaScript, ```ts and ```c++ all appear in answers; failing to recognise them costs colour
  assert.equal(languageOf('JavaScript'), 'js');
  assert.equal(languageOf('JS'), 'js');
  assert.equal(languageOf('tsx'), 'js');
  assert.equal(languageOf('shell-session'), 'bash');
  assert.equal(languageOf('c++'), 'cpp');
  assert.equal(languageOf('py3'), 'py');
  assert.equal(languageOf('python'), 'py');
  assert.equal(languageOf('c#'), 'csharp');
  assert.equal(languageOf('unknownlang'), null);
  assert.equal(languageOf(undefined), null);
});

/* ---- the seam the transcript uses ---- */

test('codeHtml is what mdToHtml puts inside a fence, and the copy path still sees plain text', () => {
  const source = '```js\nconst n = 1;\n```';
  const html = mdToHtml(source);
  assert.match(html, /<span class="hl-kw">const<\/span>/, 'the fence must be coloured');
  assert.match(html, /<pre class="code" data-lang="js">/, html);
  const code = html.match(/<code>([\s\S]*?)<\/code>/)[1];
  assert.equal(unspanned(code), escapeHtml('const n = 1;'), 'selection and copy must not pick up span text');
  assert.equal(codeHtml('x', 'nope'), escapeHtml('x'));
});
