'use strict';

/*
 * Unit tests for renderer/paste.js (#61) - the one decision the composer makes about the clipboard.
 *
 * The bug these cases exist for: Word, Excel, PowerPoint and a PDF reader put a **bitmap rendering of
 * the selection** on the Windows clipboard next to the text (Excel does it for every cell copy). The
 * paste event then carries both, and app.js used to ask only "is `files` non-empty?" - so the prose was
 * thrown away and the user watched their sentence arrive as `pasted-1.png`.
 *
 * Every case below is the shape of a real paste event, measured on Windows with the Electron 40 this
 * repo pins: the clipboard was filled with raw Win32 `SetClipboardData` (CF_UNICODETEXT / CF_DIB /
 * CF_HDROP) or with `webContents.copy()` / `webContents.copyImageAt()`, then pasted into a `<textarea>`
 * with `webContents.paste()`. The table in renderer/paste.js holds the measurements; the bare objects
 * here stand in for them, which is the whole reason this logic lives in its own file.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { pasteIntent, pastedFiles, pasteName } = require('../renderer/paste');

const NO_PATH = () => '';

function fakeFile(name, type = 'image/png', size = 286) {
  return { name, type, size };
}

/** Stand in for `DataTransfer`: items mirrors files unless a case wants them to disagree. */
function fakeClipboard({ files = [], items, text = '', html = '' } = {}) {
  const list = items === undefined ? files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })) : items;
  return {
    files,
    items: list,
    types: files.length ? ['Files'] : ['text/plain'],
    getData: (kind) => (kind === 'text/plain' ? text : kind === 'text/html' ? html : ''),
  };
}

/* ---- the #61 case: prose plus a picture OF that prose ---- */

test('#61: a clipboard bitmap next to prose does not steal the paste from the text', () => {
  const intent = pasteIntent(fakeClipboard({ files: [fakeFile('image.png')], text: 'hello from word' }), NO_PATH);
  assert.equal(intent.action, 'text', 'the text must reach the composer');
  assert.equal(intent.reason, 'text-with-clipboard-image');
  // the bitmap is still reported, so the caller can say what it decided to skip
  assert.equal(intent.files.length, 1);
});

test('a whitespace-only text part is not prose (Word writes an empty text run for a picture copy)', () => {
  const intent = pasteIntent(fakeClipboard({ files: [fakeFile('image.png')], text: '  \r\n \n' }), NO_PATH);
  assert.deepEqual({ action: intent.action, reason: intent.reason }, { action: 'attach', reason: 'clipboard-image-only' });
});

test('a screenshot stays an attachment (CF_DIB alone: files, no text at all)', () => {
  const intent = pasteIntent(fakeClipboard({ files: [fakeFile('image.png')] }), NO_PATH);
  assert.deepEqual({ action: intent.action, reason: intent.reason }, { action: 'attach', reason: 'clipboard-image-only' });
});

test('a browser "Copy image" stays an attachment (text/html is on the clipboard, text/plain is empty)', () => {
  const intent = pasteIntent(fakeClipboard({ files: [fakeFile('image.png')], html: '<img src="https://example.com/cat.png">' }), NO_PATH);
  assert.equal(intent.action, 'attach');
  assert.equal(intent.reason, 'clipboard-image-only');
});

/* ---- a copied file is still what the user meant ---- */

test('a file with a real path wins over the text on the clipboard (Explorer / VS Code file copy)', () => {
  const file = fakeFile('report.pdf', 'application/pdf', 4096);
  const intent = pasteIntent(fakeClipboard({ files: [file], text: 'report.pdf' }), () => 'C:\\reports\\report.pdf');
  assert.deepEqual({ action: intent.action, reason: intent.reason }, { action: 'attach', reason: 'file-on-disk' });
});

test('one file on disk in a mixed list is enough to attach the whole paste', () => {
  const files = [fakeFile('image.png'), fakeFile('data.csv', 'text/csv', 12)];
  const intent = pasteIntent(fakeClipboard({ files, text: 'a1\tb1' }), (f) => (f.name === 'data.csv' ? 'C:\\tmp\\data.csv' : ''));
  assert.equal(intent.action, 'attach');
  assert.equal(intent.reason, 'file-on-disk');
});

/* ---- nothing to attach ---- */

test('plain text paste is left to the browser (files empty)', () => {
  const intent = pasteIntent(fakeClipboard({ text: 'copied from a browser page' }), NO_PATH);
  assert.deepEqual({ action: intent.action, reason: intent.reason }, { action: 'text', reason: 'no-files' });
  assert.deepEqual(intent.files, []);
});

test('a clipboardData without getData does not throw (defensive: the flag is a DOM nicety)', () => {
  const intent = pasteIntent({ files: [fakeFile('image.png')] }, NO_PATH);
  assert.equal(intent.action, 'attach');
});

/* ---- pastedFiles ---- */

test('pastedFiles reads files first, then falls back to items', () => {
  const fromFiles = fakeFile('a.png');
  assert.deepEqual(pastedFiles(fakeClipboard({ files: [fromFiles] })), [fromFiles]);
  const viaItems = fakeFile('b.png');
  assert.deepEqual(pastedFiles({ files: [], items: [{ kind: 'file', type: 'image/png', getAsFile: () => viaItems }] }), [viaItems]);
});

test('pastedFiles skips string items, items with no getAsFile, and a null entry', () => {
  const kept = fakeFile('c.png');
  const items = [
    { kind: 'string', type: 'text/plain', getAsFile: () => null },
    { kind: 'file', type: 'image/png' },
    null,
    { kind: 'file', type: 'image/png', getAsFile: () => kept },
  ];
  assert.deepEqual(pastedFiles({ files: [], items }), [kept]);
});

test('pastedFiles survives a clipboardData with neither files nor items', () => {
  assert.deepEqual(pastedFiles({}), []);
});

/* ---- pasteName ---- */

test('pasteName keeps a name that means something and renames the generic ones', () => {
  const tab = { images: [], attachments: [], inlines: [] };
  for (const generic of ['image.png', 'IMAGE12.png', 'blob', 'blob.png', 'clipboard', 'screenshot', 'screen-shot.png', '未命名', 'untitled.png']) {
    const out = pasteName(tab, fakeFile(generic));
    assert.match(out, /^pasted-\d+\.(png|jpe?g|gif|webp|bmp|tiff)$/, `${generic} should have been renamed: ${out}`);
  }
  // names with a date or real words in them carry information, so they stay: Chromium's "image.png" is
  // the thing that never tells you anything
  assert.equal(pasteName(tab, fakeFile('Screenshot 2026-01-02 at 09.31.12.png')), 'Screenshot 2026-01-02 at 09.31.12.png');
  assert.equal(pasteName(tab, fakeFile('quarterly chart.png')), 'quarterly chart.png');
});

test('pasteName takes the extension from the type, not from the useless name Chromium gives', () => {
  const tab = { images: [], attachments: [], inlines: [] };
  assert.match(pasteName(tab, fakeFile('image.png', 'image/bmp')), /\.bmp$/);
  assert.match(pasteName(tab, fakeFile('image.png', 'image/webp')), /\.webp$/);
  // an unknown type falls back to whatever the given name claimed, then to png
  assert.match(pasteName(tab, fakeFile('blob.tiff', 'image/unknown')), /\.tiff$/);
  assert.match(pasteName(tab, fakeFile('', 'application/octet-stream')), /\.png$/);
});

test('pasteName never reuses a name a chip already carries', () => {
  const tab = { images: [], attachments: [], inlines: [] };
  const first = pasteName(tab, fakeFile('image.png'));
  const second = pasteName(tab, fakeFile('image.png'));
  assert.notEqual(first, second, 'two pastes in one tab cannot share a name');
  const clash = { images: [{ name: second }], attachments: [], inlines: [] };
  const third = pasteName(clash, fakeFile('image.png'));
  assert.notEqual(third, second);
  assert.notEqual(third, first);
});

/* ---- wiring: the file has to be loaded, and the helpers must not be declared twice ---- */

test('index.html loads paste.js before app.js, which is the only thing that makes the globals exist', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const at = (name) => order.indexOf(name);
  assert.ok(at('paste.js') >= 0, 'paste.js is not loaded by index.html at all');
  assert.ok(at('paste.js') < at('app.js'), 'paste.js must be loaded before app.js calls into it');
});

test('app.js calls the decision instead of re-implementing it, and no renderer script re-declares the moved helpers', () => {
  // a top-level `const` declared in two classic scripts is a load-time SyntaxError no `node --check`
  // can see, because each file parses on its own - so the move has to be pinned from the outside
  const dir = path.join(__dirname, '..', 'renderer');
  const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  assert.match(app, /pasteIntent\(/, 'app.js must ask paste.js what the paste means');
  assert.match(app, /pasteName\(/, 'app.js still names the clipboard images through paste.js');
  for (const name of ['function pasteName', 'function pastedFiles', 'pasteSeq', 'GENERIC_PASTE_NAME', 'const IMAGE_EXT']) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.js') || file === 'paste.js') continue;
      assert.ok(!fs.readFileSync(path.join(dir, file), 'utf8').includes(name), `${file} still declares ${name}, which paste.js owns now`);
    }
  }
});
